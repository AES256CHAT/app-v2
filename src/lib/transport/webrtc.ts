// Direct device-to-device link over a WebRTC data channel. No signalling server: the
// session descriptions travel as ratchet-encrypted 🛡️CONN envelopes (QR / text). By default
// there are no ICE servers at all (host candidates only → same LAN); an optional public STUN
// server can be enabled by the user for internet paths (it only learns the public IP).
//
// Payloads on the channel are the same ratchet messages as everywhere else, so the link
// adds DTLS on top of end-to-end encryption and never handles plaintext.

const CHUNK = 16 * 1024;
const GATHER_TIMEOUT_MS = 3000;
export const PUBLIC_STUN = 'stun:stun.l.google.com:19302';

export interface PeerHandlers {
	onOpen: () => void;
	onClose: () => void;
	onMessage: (bytes: Uint8Array) => void;
}

export class PeerLink {
	private pc: RTCPeerConnection;
	private dc: RTCDataChannel | null = null;
	private incoming: { buf: Uint8Array; off: number } | null = null;
	closed = false;

	constructor(
		private handlers: PeerHandlers,
		stun = false
	) {
		this.pc = new RTCPeerConnection({ iceServers: stun ? [{ urls: PUBLIC_STUN }] : [] });
		this.pc.onconnectionstatechange = () => {
			const s = this.pc.connectionState;
			if (s === 'failed' || s === 'disconnected' || s === 'closed') this.close();
		};
	}

	get open(): boolean {
		return this.dc?.readyState === 'open';
	}

	async createOffer(): Promise<string> {
		this.wire(this.pc.createDataChannel('aes256chat', { ordered: true }));
		await this.pc.setLocalDescription(await this.pc.createOffer());
		await this.gathered();
		return JSON.stringify(this.pc.localDescription);
	}

	async acceptOffer(offerJson: string): Promise<string> {
		this.pc.ondatachannel = (e) => this.wire(e.channel);
		await this.pc.setRemoteDescription(parseSdp(offerJson, 'offer'));
		await this.pc.setLocalDescription(await this.pc.createAnswer());
		await this.gathered();
		return JSON.stringify(this.pc.localDescription);
	}

	async finish(answerJson: string): Promise<void> {
		await this.pc.setRemoteDescription(parseSdp(answerJson, 'answer'));
	}

	/** Length-prefixed frames split into 16 KiB chunks (data channels dislike large messages). */
	send(bytes: Uint8Array): boolean {
		if (!this.dc || this.dc.readyState !== 'open') return false;
		const header = new Uint8Array(4);
		new DataView(header.buffer).setUint32(0, bytes.length, false);
		this.dc.send(header.buffer as ArrayBuffer);
		for (let i = 0; i < bytes.length; i += CHUNK) this.dc.send(bytes.slice(i, i + CHUNK).buffer as ArrayBuffer);
		return true;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		try {
			this.dc?.close();
			this.pc.close();
		} catch {
			/* ignore */
		}
		this.handlers.onClose();
	}

	private wire(dc: RTCDataChannel): void {
		this.dc = dc;
		dc.binaryType = 'arraybuffer';
		dc.onopen = () => this.handlers.onOpen();
		dc.onclose = () => this.close();
		dc.onmessage = (e) => this.onChunk(new Uint8Array(e.data as ArrayBuffer));
	}

	private onChunk(chunk: Uint8Array): void {
		if (!this.incoming) {
			if (chunk.length !== 4) return; // protocol violation → drop
			const len = new DataView(chunk.buffer, chunk.byteOffset).getUint32(0, false);
			if (len > 64 * 1024 * 1024) return this.close();
			this.incoming = { buf: new Uint8Array(len), off: 0 };
			if (len === 0) this.finishFrame();
			return;
		}
		const room = this.incoming.buf.length - this.incoming.off;
		if (chunk.length > room) return this.close();
		this.incoming.buf.set(chunk, this.incoming.off);
		this.incoming.off += chunk.length;
		if (this.incoming.off === this.incoming.buf.length) this.finishFrame();
	}

	private finishFrame(): void {
		const buf = this.incoming!.buf;
		this.incoming = null;
		this.handlers.onMessage(buf);
	}

	private gathered(): Promise<void> {
		if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				this.pc.removeEventListener('icegatheringstatechange', check);
				clearTimeout(timer);
				resolve();
			};
			const check = () => {
				if (this.pc.iceGatheringState === 'complete') done();
			};
			const timer = setTimeout(done, GATHER_TIMEOUT_MS);
			this.pc.addEventListener('icegatheringstatechange', check);
		});
	}
}

function parseSdp(json: string, expected: 'offer' | 'answer'): RTCSessionDescriptionInit {
	const d = JSON.parse(json) as Partial<RTCSessionDescriptionInit>;
	if (d.type !== expected || typeof d.sdp !== 'string') throw new Error('invalid session description');
	return { type: d.type, sdp: d.sdp };
}

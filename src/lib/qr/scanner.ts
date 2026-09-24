// Camera QR scanner on zxing-wasm. The WASM binary is bundled locally (CSP forbids CDNs).

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

let prepared = false;
function prepare(): void {
	if (prepared) return;
	prepareZXingModule({
		overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) }
	});
	prepared = true;
}

export class QrScanner {
	private stream: MediaStream | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private canvas = document.createElement('canvas');
	private busy = false;
	private lastText = '';

	constructor(
		private video: HTMLVideoElement,
		private onText: (text: string) => void,
		private intervalMs = 150,
		private facing: 'environment' | 'user' = 'environment'
	) {}

	async start(): Promise<void> {
		prepare();
		this.stream = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: { ideal: this.facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
			audio: false
		});
		this.video.srcObject = this.stream;
		this.video.setAttribute('playsinline', 'true');
		await this.video.play();
		this.tick();
	}

	private tick(): void {
		this.timer = setTimeout(async () => {
			if (!this.stream) return;
			if (!this.busy && this.video.readyState >= 2) {
				this.busy = true;
				try {
					await this.scanFrame();
				} catch {
					/* frame errors are expected while focusing */
				} finally {
					this.busy = false;
				}
			}
			this.tick();
		}, this.intervalMs);
	}

	private async scanFrame(): Promise<void> {
		const w = this.video.videoWidth;
		const h = this.video.videoHeight;
		if (!w || !h) return;
		this.canvas.width = w;
		this.canvas.height = h;
		const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return;
		ctx.drawImage(this.video, 0, 0, w, h);
		const img = ctx.getImageData(0, 0, w, h);
		const results = await readBarcodes(img, { formats: ['QRCode'], tryHarder: false, maxNumberOfSymbols: 1 });
		for (const r of results) {
			if (r.text && r.text !== this.lastText) {
				this.lastText = r.text;
				this.onText(r.text);
			}
		}
	}

	stop(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
		this.video.srcObject = null;
	}
}

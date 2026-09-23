// Live links: one optional WebRTC data channel per contact. Signalling rides on the ratchet
// as 🛡️CONN envelopes; once open, messages are sent directly instead of copied/shared.

import { browser } from '$app/environment';
import type { PlainConn } from '$lib/crypto/message';
import { PeerLink } from '$lib/transport/webrtc';
import { vault } from '$lib/vault/vault.svelte';
import type { ContactRecord } from './contacts.svelte';
import { messages, type DirectTransport } from './messages.svelte';
import { toast } from './toast.svelte';
import { t } from '$lib/i18n/index.svelte';

export type LiveStatus = 'idle' | 'offering' | 'answering' | 'connecting' | 'connected';

export interface PendingSignal {
	role: 'offer' | 'answer';
	/** ratchet message bytes → shown as 🛡️CONN QR / text */
	payload: Uint8Array;
}

class LiveState {
	status = $state<Record<string, LiveStatus>>({});
	pending = $state<Record<string, PendingSignal | undefined>>({});
	stunEnabled = $state(false);
	private links = new Map<string, PeerLink>();

	constructor() {
		if (browser) {
			try {
				this.stunEnabled = localStorage.getItem('stunEnabled') === '1';
			} catch {
				/* ignore */
			}
		}
	}

	setStun(on: boolean): void {
		this.stunEnabled = on;
		try {
			localStorage.setItem('stunEnabled', on ? '1' : '0');
		} catch {
			/* ignore */
		}
	}

	statusOf(contactId: string): LiveStatus {
		return this.status[contactId] ?? 'idle';
	}

	isConnected(contactId: string): boolean {
		return this.links.get(contactId)?.open === true;
	}

	/** Direct transport for the messages store, or undefined when no link is open. */
	transportFor(contactId: string): DirectTransport | undefined {
		const link = this.links.get(contactId);
		if (!link?.open) return undefined;
		return async (raw) => link.send(raw);
	}

	private newLink(contact: ContactRecord): PeerLink {
		this.links.get(contact.id)?.close();
		const link = new PeerLink(
			{
				onOpen: () => this.set(contact.id, 'connected', undefined),
				onClose: () => {
					if (this.links.get(contact.id) === link) {
						this.links.delete(contact.id);
						this.set(contact.id, 'idle', undefined);
					}
				},
				onMessage: (bytes) => void this.onMessage(contact, bytes)
			},
			this.stunEnabled
		);
		this.links.set(contact.id, link);
		return link;
	}

	private set(id: string, status: LiveStatus, pending: PendingSignal | undefined): void {
		this.status = { ...this.status, [id]: status };
		this.pending = { ...this.pending, [id]: pending };
	}

	/** Step 1 (either side): create an offer envelope for the contact to import. */
	async offer(contact: ContactRecord): Promise<void> {
		const link = this.newLink(contact);
		const sdp = await link.createOffer();
		const payload = await messages.encryptFor(contact, { t: 'conn', role: 'offer', sdp, ts: Date.now() });
		this.set(contact.id, 'offering', { role: 'offer', payload });
	}

	/** Incoming 🛡️CONN from the inbox: answer an offer automatically, or finish with an answer. */
	async handleSignal(contact: ContactRecord, sig: PlainConn): Promise<void> {
		if (sig.role === 'offer') {
			const link = this.newLink(contact);
			const sdp = await link.acceptOffer(sig.sdp);
			const payload = await messages.encryptFor(contact, { t: 'conn', role: 'answer', sdp, ts: Date.now() });
			this.set(contact.id, 'answering', { role: 'answer', payload });
			return;
		}
		const link = this.links.get(contact.id);
		if (!link || this.statusOf(contact.id) !== 'offering') throw new Error('no pending offer for this answer');
		await link.finish(sig.sdp);
		this.set(contact.id, 'connecting', undefined);
	}

	disconnect(contactId: string): void {
		this.links.get(contactId)?.close();
		this.links.delete(contactId);
		this.set(contactId, 'idle', undefined);
	}

	private async onMessage(contact: ContactRecord, bytes: Uint8Array): Promise<void> {
		try {
			const r = await messages.receive(bytes, contact);
			if (r.plain.t !== 'conn') toast.show(t('inboxReceived', { name: r.contact.name }));
		} catch {
			/* undecryptable frame: ignore */
		}
	}

	reset(): void {
		for (const l of this.links.values()) l.close();
		this.links.clear();
		this.status = {};
		this.pending = {};
	}
}

export const live = new LiveState();
vault.onChange((s) => {
	if (s !== 'unlocked') live.reset();
});

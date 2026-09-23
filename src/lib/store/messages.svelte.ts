// Messages per contact. Ephemeral mode keeps them in memory only; persist mode also writes
// them encrypted to the vault. Sending advances the ratchet and yields envelope text;
// receiving trial-decrypts against every contact (no sender identifier on the wire).

import { AuthError } from '$lib/crypto/aead';
import { encodeEnvelope } from '$lib/crypto/envelope';
import { decodePlain, encodePlain } from '$lib/crypto/message';
import { ratchetDecrypt, ratchetEncrypt } from '$lib/crypto/ratchet';
import { vault } from '$lib/vault/vault.svelte';
import { contacts, sessionOfRecord, type ContactRecord } from './contacts.svelte';

export type MsgStatus = 'encrypted' | 'copied' | 'shared' | 'received';

export interface ChatMessage {
	id: string;
	contactId: string;
	dir: 'in' | 'out';
	ts: number;
	body: string;
	status: MsgStatus;
	/** outgoing only: envelope parts, kept so the user can copy/share again */
	envelope?: string[];
}

export class NoMatchingContactError extends Error {
	constructor() {
		super('no contact could decrypt this message');
		this.name = 'NoMatchingContactError';
	}
}

const T = 'messages';

class MessagesState {
	byContact = $state<Record<string, ChatMessage[]>>({});
	unread = $state<Record<string, number>>({});
	private loaded = new Set<string>();

	private persist(): boolean {
		return vault.info?.history === 'persist';
	}

	list(contactId: string): ChatMessage[] {
		return this.byContact[contactId] ?? [];
	}

	last(contactId: string): ChatMessage | undefined {
		const l = this.list(contactId);
		return l[l.length - 1];
	}

	async load(contactId: string): Promise<void> {
		if (this.loaded.has(contactId)) return;
		this.loaded.add(contactId);
		if (!this.persist()) return;
		const rows = await vault.list<ChatMessage>(T, { k1: contactId });
		const existing = this.byContact[contactId] ?? [];
		const merged = [...rows.map((r) => r.value), ...existing].sort((a, b) => a.ts - b.ts);
		this.byContact = { ...this.byContact, [contactId]: merged };
	}

	async loadAll(): Promise<void> {
		for (const c of contacts.items) await this.load(c.id);
	}

	private async store(msg: ChatMessage): Promise<void> {
		const l = this.byContact[msg.contactId] ?? [];
		this.byContact = { ...this.byContact, [msg.contactId]: [...l, msg] };
		if (this.persist()) await vault.put(T, msg.id, msg, { k1: msg.contactId, ts: msg.ts });
	}

	async setStatus(msg: ChatMessage, status: MsgStatus): Promise<void> {
		const next = { ...msg, status };
		this.byContact = {
			...this.byContact,
			[msg.contactId]: this.list(msg.contactId).map((m) => (m.id === msg.id ? next : m))
		};
		if (this.persist()) await vault.put(T, msg.id, next, { k1: msg.contactId, ts: msg.ts });
	}

	markRead(contactId: string): void {
		if (this.unread[contactId]) this.unread = { ...this.unread, [contactId]: 0 };
	}

	async send(contact: ContactRecord, body: string): Promise<ChatMessage> {
		const ts = Date.now();
		const { state, message } = await ratchetEncrypt(sessionOfRecord(contact), encodePlain({ t: 'text', body, ts }));
		await contacts.saveSession(contact.id, state);
		const msg: ChatMessage = {
			id: crypto.randomUUID(),
			contactId: contact.id,
			dir: 'out',
			ts,
			body,
			status: 'encrypted',
			envelope: encodeEnvelope('msg', message)
		};
		await this.store(msg);
		return msg;
	}

	/** Sealed sender: try every contact's session; the ratchet's AEAD rejects all but the right one. */
	async receive(payload: Uint8Array): Promise<{ contact: ContactRecord; message: ChatMessage }> {
		if (!contacts.loaded) await contacts.refresh();
		for (const c of contacts.items) {
			try {
				const { state, plaintext } = await ratchetDecrypt(sessionOfRecord(c), payload);
				const plain = decodePlain(plaintext);
				await contacts.saveSession(c.id, state);
				await this.load(c.id);
				const msg: ChatMessage = {
					id: crypto.randomUUID(),
					contactId: c.id,
					dir: 'in',
					ts: Date.now(),
					body: plain.body,
					status: 'received'
				};
				await this.store(msg);
				this.unread = { ...this.unread, [c.id]: (this.unread[c.id] ?? 0) + 1 };
				return { contact: c, message: msg };
			} catch (e) {
				if (e instanceof AuthError) continue;
				// "too many skipped" or malformed header: also not decryptable by this contact
				if (e instanceof Error && /skipped|short/.test(e.message)) continue;
				throw e;
			}
		}
		throw new NoMatchingContactError();
	}

	async clearContact(contactId: string): Promise<void> {
		const { [contactId]: _drop, ...rest } = this.byContact;
		void _drop;
		this.byContact = rest;
		this.loaded.delete(contactId);
		if (this.persist()) await vault.deleteWhere(T, contactId);
	}

	reset(): void {
		this.byContact = {};
		this.unread = {};
		this.loaded.clear();
	}
}

export const messages = new MessagesState();
vault.onChange((s) => {
	if (s !== 'unlocked') messages.reset();
});

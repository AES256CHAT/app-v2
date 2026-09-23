// Messages per contact. Ephemeral mode keeps them in memory only; persist mode also writes
// them encrypted to the vault. Sending advances the ratchet and yields an envelope (text
// parts, or an .aes256 file for attachments); receiving trial-decrypts against every contact
// (no sender identifier on the wire).

import { AuthError } from '$lib/crypto/aead';
import { b64uDecode, b64uEncode } from '$lib/crypto/bytes';
import { encodeEnvelope } from '$lib/crypto/envelope';
import { envelopeFileName, wrapFileEnvelope } from '$lib/crypto/fileenvelope';
import { decodePlain, encodePlain, type Plain } from '$lib/crypto/message';
import { ratchetDecrypt, ratchetEncrypt } from '$lib/crypto/ratchet';
import { vault } from '$lib/vault/vault.svelte';
import { contacts, sessionOfRecord, type ContactRecord } from './contacts.svelte';

export type MsgStatus = 'encrypted' | 'copied' | 'shared' | 'downloaded' | 'received';

export interface FileInfo {
	name: string;
	mime: string;
	size: number;
}

export interface ChatMessage {
	id: string;
	contactId: string;
	dir: 'in' | 'out';
	ts: number;
	body: string;
	status: MsgStatus;
	/** outgoing text: envelope parts, kept so the user can copy/share again */
	envelope?: string[];
	/** attachment metadata; bytes live in the attachment store under the message id */
	file?: FileInfo;
	/** outgoing file: name of the .aes256 envelope file */
	envelopeFile?: string;
}

export class NoMatchingContactError extends Error {
	constructor() {
		super('no contact could decrypt this message');
		this.name = 'NoMatchingContactError';
	}
}

const T = 'messages';
const T_ATT = 'attachments';

interface StoredAttachment {
	plain: string; // b64u decrypted file bytes
	envelope?: string; // b64u .aes256 bytes (outgoing only)
}

class MessagesState {
	byContact = $state<Record<string, ChatMessage[]>>({});
	unread = $state<Record<string, number>>({});
	private loaded = new Set<string>();
	/** decrypted attachment bytes + outgoing envelope bytes, keyed by message id */
	private attachments = new Map<string, { plain: Uint8Array; envelope?: Uint8Array }>();
	private urls = new Map<string, string>();

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

	private async storeAttachment(id: string, plain: Uint8Array, envelope?: Uint8Array): Promise<void> {
		this.attachments.set(id, { plain, envelope });
		if (this.persist()) {
			const rec: StoredAttachment = { plain: b64uEncode(plain), envelope: envelope ? b64uEncode(envelope) : undefined };
			await vault.put(T_ATT, id, rec);
		}
	}

	async attachment(id: string): Promise<{ plain: Uint8Array; envelope?: Uint8Array } | null> {
		const mem = this.attachments.get(id);
		if (mem) return mem;
		if (!this.persist()) return null;
		const rec = await vault.get<StoredAttachment>(T_ATT, id);
		if (!rec) return null;
		const v = { plain: b64uDecode(rec.plain), envelope: rec.envelope ? b64uDecode(rec.envelope) : undefined };
		this.attachments.set(id, v);
		return v;
	}

	/** Object URL for previewing an image attachment (cached, revoked on reset). */
	async previewUrl(msg: ChatMessage): Promise<string | null> {
		if (!msg.file) return null;
		const cached = this.urls.get(msg.id);
		if (cached) return cached;
		const att = await this.attachment(msg.id);
		if (!att) return null;
		const url = URL.createObjectURL(new Blob([att.plain as BlobPart], { type: msg.file.mime }));
		this.urls.set(msg.id, url);
		return url;
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

	private async encryptFor(contact: ContactRecord, plain: Plain): Promise<Uint8Array> {
		const { state, message } = await ratchetEncrypt(sessionOfRecord(contact), encodePlain(plain));
		await contacts.saveSession(contact.id, state);
		return message;
	}

	async send(contact: ContactRecord, body: string): Promise<ChatMessage> {
		const ts = Date.now();
		const message = await this.encryptFor(contact, { t: 'text', body, ts });
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

	async sendFile(contact: ContactRecord, data: Uint8Array, info: FileInfo): Promise<ChatMessage> {
		const ts = Date.now();
		const message = await this.encryptFor(contact, { t: 'file', ...info, size: data.length, ts, data });
		const envelope = wrapFileEnvelope(message);
		const msg: ChatMessage = {
			id: crypto.randomUUID(),
			contactId: contact.id,
			dir: 'out',
			ts,
			body: '',
			status: 'encrypted',
			file: { ...info, size: data.length },
			envelopeFile: envelopeFileName(ts)
		};
		await this.storeAttachment(msg.id, data, envelope);
		await this.store(msg);
		return msg;
	}

	/** Sealed sender: try every contact's session; the ratchet's AEAD rejects all but the right one. */
	async receive(payload: Uint8Array): Promise<{ contact: ContactRecord; message: ChatMessage }> {
		if (!contacts.loaded) await contacts.refresh();
		for (const c of contacts.items) {
			let plaintext: Uint8Array;
			try {
				const r = await ratchetDecrypt(sessionOfRecord(c), payload);
				plaintext = r.plaintext;
				await contacts.saveSession(c.id, r.state);
			} catch (e) {
				if (e instanceof AuthError) continue;
				if (e instanceof Error && /skipped|short/.test(e.message)) continue;
				throw e;
			}
			const plain = decodePlain(plaintext);
			await this.load(c.id);
			const msg: ChatMessage = {
				id: crypto.randomUUID(),
				contactId: c.id,
				dir: 'in',
				ts: Date.now(),
				body: plain.t === 'text' ? plain.body : '',
				status: 'received',
				...(plain.t === 'file' ? { file: { name: plain.name, mime: plain.mime, size: plain.size } } : {})
			};
			if (plain.t === 'file') await this.storeAttachment(msg.id, plain.data);
			await this.store(msg);
			this.unread = { ...this.unread, [c.id]: (this.unread[c.id] ?? 0) + 1 };
			return { contact: c, message: msg };
		}
		throw new NoMatchingContactError();
	}

	async clearContact(contactId: string): Promise<void> {
		for (const m of this.list(contactId)) {
			this.attachments.delete(m.id);
			const u = this.urls.get(m.id);
			if (u) URL.revokeObjectURL(u);
			this.urls.delete(m.id);
			if (this.persist() && m.file) await vault.delete(T_ATT, m.id);
		}
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
		for (const a of this.attachments.values()) {
			a.plain.fill(0);
			a.envelope?.fill(0);
		}
		this.attachments.clear();
		for (const u of this.urls.values()) URL.revokeObjectURL(u);
		this.urls.clear();
	}
}

export const messages = new MessagesState();
vault.onChange((s) => {
	if (s !== 'unlocked') messages.reset();
});

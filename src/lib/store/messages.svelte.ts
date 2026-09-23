// Messages per contact. Ephemeral mode keeps them in memory only; persist mode also writes
// them encrypted to the vault. Sending advances the ratchet and yields an envelope (text
// parts, or an .aes256 file for attachments); receiving trial-decrypts against every contact
// (no sender identifier on the wire). All ratchet steps run under the contact's session lock.

import { AuthError } from '$lib/crypto/aead';
import { b64uDecode, b64uEncode } from '$lib/crypto/bytes';
import { encodeEnvelope } from '$lib/crypto/envelope';
import { envelopeFileName, wrapFileEnvelope } from '$lib/crypto/fileenvelope';
import { decodePlain, encodePlain, type Plain } from '$lib/crypto/message';
import { ratchetDecrypt, ratchetEncrypt } from '$lib/crypto/ratchet';
import { Mutex } from '$lib/util/mutex';
import { vault } from '$lib/vault/vault.svelte';
import { contacts, type ContactRecord } from './contacts.svelte';

export type MsgStatus = 'encrypted' | 'copied' | 'shared' | 'downloaded' | 'delivered' | 'received';

/** Optional direct transport (live WebRTC link). Returns true when the bytes went out. */
export type DirectTransport = (raw: Uint8Array) => Promise<boolean>;

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

/** Ratchet failures that mean "not for this session" rather than a bug. */
function notForThisSession(e: unknown): boolean {
	return e instanceof AuthError || (e instanceof Error && /skipped|short|invalid|point|scalar/i.test(e.message));
}

class MessagesState {
	byContact = $state<Record<string, ChatMessage[]>>({});
	unread = $state<Record<string, number>>({});
	private loaded = new Set<string>();
	/** decrypted attachment bytes + outgoing envelope bytes, keyed by message id */
	private attachments = new Map<string, { plain: Uint8Array; envelope?: Uint8Array }>();
	private urls = new Map<string, string>();
	/** trial decryption touches every session → serialise it globally */
	private receiveLock = new Mutex();

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
		const seen = new Set(existing.map((m) => m.id));
		const merged = [...rows.map((r) => r.value).filter((m) => !seen.has(m.id)), ...existing].sort((a, b) => a.ts - b.ts);
		this.byContact = { ...this.byContact, [contactId]: merged };
	}

	async loadAll(): Promise<void> {
		await vault.pruneMessages();
		for (const c of contacts.items) await this.load(c.id);
	}

	private async store(msg: ChatMessage): Promise<void> {
		const l = this.byContact[msg.contactId] ?? [];
		this.byContact = { ...this.byContact, [msg.contactId]: [...l, msg] };
		if (this.persist()) await vault.put(T, msg.id, msg, { k1: msg.contactId, ts: msg.ts });
	}

	private async storeAttachment(msg: ChatMessage, plain: Uint8Array, envelope?: Uint8Array): Promise<void> {
		this.attachments.set(msg.id, { plain, envelope });
		if (this.persist()) {
			const rec: StoredAttachment = { plain: b64uEncode(plain), envelope: envelope ? b64uEncode(envelope) : undefined };
			await vault.put(T_ATT, msg.id, rec, { k1: msg.contactId, ts: msg.ts });
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

	/** Encrypt under the contact's session lock; the advanced state is persisted before returning. */
	async encryptFor(contact: ContactRecord, plain: Plain): Promise<Uint8Array> {
		return contacts.withSession(contact.id, async (session) => {
			const { state, message } = await ratchetEncrypt(session, encodePlain(plain));
			return { state, result: message };
		});
	}

	async send(contact: ContactRecord, body: string, direct?: DirectTransport): Promise<ChatMessage> {
		const ts = Date.now();
		const message = await this.encryptFor(contact, { t: 'text', body, ts });
		const delivered = direct ? await direct(message) : false;
		const msg: ChatMessage = {
			id: crypto.randomUUID(),
			contactId: contact.id,
			dir: 'out',
			ts,
			body,
			status: delivered ? 'delivered' : 'encrypted',
			envelope: encodeEnvelope('msg', message)
		};
		await this.store(msg);
		return msg;
	}

	async sendFile(contact: ContactRecord, data: Uint8Array, info: FileInfo, direct?: DirectTransport): Promise<ChatMessage> {
		const ts = Date.now();
		const message = await this.encryptFor(contact, { t: 'file', ...info, size: data.length, ts, data });
		const delivered = direct ? await direct(message) : false;
		const envelope = wrapFileEnvelope(message);
		const msg: ChatMessage = {
			id: crypto.randomUUID(),
			contactId: contact.id,
			dir: 'out',
			ts,
			body: '',
			status: delivered ? 'delivered' : 'encrypted',
			file: { ...info, size: data.length },
			envelopeFile: envelopeFileName(ts)
		};
		await this.storeAttachment(msg, data, envelope);
		await this.store(msg);
		return msg;
	}

	/** Decrypt with one specific contact's session (live link: the peer is known). */
	private async decryptWith(contact: ContactRecord, payload: Uint8Array): Promise<Plain | null> {
		return contacts.withSession(contact.id, async (session) => {
			try {
				const r = await ratchetDecrypt(session, payload);
				return { state: r.state, result: decodePlain(r.plaintext) };
			} catch (e) {
				if (notForThisSession(e)) return { state: null, result: null };
				throw e;
			}
		});
	}

	/** Sealed sender: try every contact; the ratchet's AEAD rejects all but the right one. */
	async receiveRaw(payload: Uint8Array, only?: ContactRecord): Promise<{ contact: ContactRecord; plain: Plain }> {
		return this.receiveLock.run(async () => {
			if (!contacts.loaded) await contacts.refresh();
			const candidates = only ? [only] : contacts.items;
			for (const c of candidates) {
				const plain = await this.decryptWith(c, payload);
				if (plain) return { contact: c, plain };
			}
			throw new NoMatchingContactError();
		});
	}

	async receive(payload: Uint8Array, only?: ContactRecord): Promise<{ contact: ContactRecord; message: ChatMessage; plain: Plain }> {
		const { contact: c, plain } = await this.receiveRaw(payload, only);
		if (plain.t === 'conn') {
			// Live-link signalling is handled by the live store; nothing to show in the thread.
			return { contact: c, plain, message: { id: '', contactId: c.id, dir: 'in', ts: plain.ts, body: '', status: 'received' } };
		}
		return { contact: c, plain, message: await this.storeIncoming(c, plain) };
	}

	async storeIncoming(c: ContactRecord, plain: Plain): Promise<ChatMessage> {
		if (plain.t === 'conn') throw new Error('not a chat message');
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
		if (plain.t === 'file') await this.storeAttachment(msg, plain.data);
		await this.store(msg);
		this.unread = { ...this.unread, [c.id]: (this.unread[c.id] ?? 0) + 1 };
		return msg;
	}

	async clearContact(contactId: string): Promise<void> {
		for (const m of this.list(contactId)) {
			this.attachments.delete(m.id);
			const u = this.urls.get(m.id);
			if (u) URL.revokeObjectURL(u);
			this.urls.delete(m.id);
		}
		const { [contactId]: _drop, ...rest } = this.byContact;
		void _drop;
		this.byContact = rest;
		this.loaded.delete(contactId);
		if (this.persist()) {
			await vault.deleteWhere(T, contactId);
			await vault.deleteWhere(T_ATT, contactId);
		}
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

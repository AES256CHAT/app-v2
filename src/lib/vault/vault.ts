// The local vault: one data-encryption key (DEK) wrapped by an Argon2id-derived KEK.
// Plain TypeScript (no Svelte runes) so it is unit-testable; the UI binds via vault.svelte.ts.
//
// Access control lives here too: failed unlocks are counted in plaintext meta (they must be
// counted while locked), with exponential lockout and optional self-destruct.

import Dexie from 'dexie';
import { aesGcmDecrypt, aesGcmEncrypt, AuthError } from '$lib/crypto/aead';
import { b64uDecode, b64uEncode, concat, randomBytes, utf8, wipe } from '$lib/crypto/bytes';
import { DEFAULT_KDF, deriveKek } from '$lib/crypto/kdf';
import { VaultDb, type EncryptedRecord, type HistoryMode, type VaultMeta } from './db';

export type VaultStatus = 'loading' | 'none' | 'locked' | 'unlocked';

export interface CreateOptions {
	history: HistoryMode;
	retentionDays?: number;
	destroyAfterFails?: boolean;
}

export const MIN_PASSPHRASE_LEN = 10;
export const DESTROY_AFTER = 10;
const AAD_DEK = utf8.encode('AES256CHAT-dek-v1');

export class LockedError extends Error {
	constructor() {
		super('vault is locked');
		this.name = 'LockedError';
	}
}

export class LockoutError extends Error {
	constructor(public until: number) {
		super('too many attempts');
		this.name = 'LockoutError';
	}
}

export class DestroyedError extends Error {
	constructor() {
		super('vault destroyed after too many failed attempts');
		this.name = 'DestroyedError';
	}
}

/** Lockout after n failed attempts: none for the first 2, then 30 s doubling, capped at 30 min. */
export function lockoutMs(failed: number): number {
	if (failed < 3) return 0;
	return Math.min(30_000 * 2 ** (failed - 3), 30 * 60_000);
}

type Listener = (status: VaultStatus) => void;

export class Vault {
	private db: VaultDb;
	private dek: Uint8Array | null = null;
	private meta: VaultMeta | null = null;
	private listeners = new Set<Listener>();
	status: VaultStatus = 'loading';

	constructor(dbName = 'aes256chat') {
		this.db = new VaultDb(dbName);
	}

	// --- lifecycle -----------------------------------------------------------------------------

	async init(): Promise<VaultStatus> {
		this.meta = (await this.db.meta.get('v1')) ?? null;
		this.setStatus(this.meta ? 'locked' : 'none');
		return this.status;
	}

	get info(): Readonly<Pick<VaultMeta, 'history' | 'retentionDays' | 'destroyAfterFails' | 'failedAttempts' | 'lockoutUntil' | 'createdAt'>> | null {
		return this.meta;
	}

	onChange(fn: Listener): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private setStatus(s: VaultStatus): void {
		this.status = s;
		for (const fn of this.listeners) fn(s);
	}

	async create(pw: string, opts: CreateOptions): Promise<void> {
		if (this.meta) throw new Error('vault exists');
		if (pw.length < MIN_PASSPHRASE_LEN) throw new Error('passphrase too short');
		const salt = randomBytes(16);
		const dek = randomBytes(32);
		const kek = await deriveKek(pw, salt, DEFAULT_KDF);
		const iv = randomBytes(12);
		const wrapped = await aesGcmEncrypt(kek, iv, dek, AAD_DEK);
		wipe(kek);
		const meta: VaultMeta = {
			id: 'v1',
			version: 1,
			salt: b64uEncode(salt),
			kdf: DEFAULT_KDF,
			wrappedDek: b64uEncode(concat(iv, wrapped)),
			createdAt: Date.now(),
			history: opts.history,
			retentionDays: opts.retentionDays ?? 7,
			destroyAfterFails: opts.destroyAfterFails ?? false,
			failedAttempts: 0,
			lockoutUntil: 0
		};
		await this.db.meta.put(meta);
		this.meta = meta;
		this.dek = dek;
		this.setStatus('unlocked');
	}

	async unlock(pw: string): Promise<void> {
		if (!this.meta) throw new Error('no vault');
		if (this.dek) return;
		const now = Date.now();
		if (this.meta.lockoutUntil > now) throw new LockoutError(this.meta.lockoutUntil);
		const kek = await deriveKek(pw, b64uDecode(this.meta.salt), this.meta.kdf);
		const packed = b64uDecode(this.meta.wrappedDek);
		try {
			this.dek = await aesGcmDecrypt(kek, packed.slice(0, 12), packed.slice(12), AAD_DEK);
		} catch (e) {
			if (!(e instanceof AuthError)) throw e;
			await this.registerFailure();
			throw e;
		} finally {
			wipe(kek);
		}
		if (this.meta.failedAttempts !== 0 || this.meta.lockoutUntil !== 0) {
			await this.db.meta.update('v1', { failedAttempts: 0, lockoutUntil: 0 });
			this.meta = { ...this.meta, failedAttempts: 0, lockoutUntil: 0 };
		}
		this.setStatus('unlocked');
	}

	private async registerFailure(): Promise<void> {
		if (!this.meta) return;
		const failed = this.meta.failedAttempts + 1;
		if (this.meta.destroyAfterFails && failed >= DESTROY_AFTER) {
			await this.destroy();
			throw new DestroyedError();
		}
		const lockoutUntil = Date.now() + lockoutMs(failed);
		await this.db.meta.update('v1', { failedAttempts: failed, lockoutUntil });
		this.meta = { ...this.meta, failedAttempts: failed, lockoutUntil };
	}

	lock(): void {
		wipe(this.dek);
		this.dek = null;
		if (this.meta) this.setStatus('locked');
	}

	async changePassphrase(oldPw: string, newPw: string): Promise<void> {
		if (!this.meta || !this.dek) throw new LockedError();
		if (newPw.length < MIN_PASSPHRASE_LEN) throw new Error('passphrase too short');
		// Re-verify the old passphrase before re-wrapping.
		const oldKek = await deriveKek(oldPw, b64uDecode(this.meta.salt), this.meta.kdf);
		const packed = b64uDecode(this.meta.wrappedDek);
		try {
			await aesGcmDecrypt(oldKek, packed.slice(0, 12), packed.slice(12), AAD_DEK);
		} finally {
			wipe(oldKek);
		}
		const salt = randomBytes(16);
		const kek = await deriveKek(newPw, salt, DEFAULT_KDF);
		const iv = randomBytes(12);
		const wrapped = await aesGcmEncrypt(kek, iv, this.dek, AAD_DEK);
		wipe(kek);
		const patch = { salt: b64uEncode(salt), kdf: DEFAULT_KDF, wrappedDek: b64uEncode(concat(iv, wrapped)) };
		await this.db.meta.update('v1', patch);
		this.meta = { ...this.meta, ...patch };
	}

	async updateSettings(patch: Partial<Pick<VaultMeta, 'history' | 'retentionDays' | 'destroyAfterFails'>>): Promise<void> {
		if (!this.meta || !this.dek) throw new LockedError();
		await this.db.meta.update('v1', patch);
		this.meta = { ...this.meta, ...patch };
		if (patch.history === 'ephemeral') await this.db.records.where('table').equals('messages').delete();
	}

	/** Wipes everything. Irreversible by design. */
	async destroy(): Promise<void> {
		wipe(this.dek);
		this.dek = null;
		this.meta = null;
		await this.db.delete();
		this.db = new VaultDb(this.db.name);
		this.setStatus('none');
	}

	// --- encrypted records -----------------------------------------------------------------------

	private requireDek(): Uint8Array {
		if (!this.dek) throw new LockedError();
		return this.dek;
	}

	private aad(table: string, id: string): Uint8Array {
		return utf8.encode(`${table}\u0000${id}`);
	}

	async put<T>(table: string, id: string, value: T, index?: { k1?: string; ts?: number }): Promise<void> {
		const dek = this.requireDek();
		const iv = randomBytes(12);
		const ct = await aesGcmEncrypt(dek, iv, utf8.encode(JSON.stringify(value)), this.aad(table, id));
		const rec: EncryptedRecord = { table, id, iv, ct, ...index };
		await this.db.records.put(rec);
	}

	async get<T>(table: string, id: string): Promise<T | undefined> {
		const dek = this.requireDek();
		const rec = await this.db.records.get({ table, id });
		if (!rec) return undefined;
		return this.open<T>(dek, rec);
	}

	async list<T>(table: string, opts: { k1?: string; limit?: number } = {}): Promise<{ id: string; value: T }[]> {
		const dek = this.requireDek();
		let coll = opts.k1
			? this.db.records.where('[table+k1+ts]').between([table, opts.k1, Dexie.minKey], [table, opts.k1, Dexie.maxKey])
			: this.db.records.where('table').equals(table);
		if (opts.limit) coll = coll.limit(opts.limit);
		const recs = await coll.toArray();
		return Promise.all(recs.map(async (r) => ({ id: r.id, value: await this.open<T>(dek, r) })));
	}

	async delete(table: string, id: string): Promise<void> {
		this.requireDek();
		await this.db.records.where('[table+id]').equals([table, id]).delete();
	}

	async deleteWhere(table: string, k1: string): Promise<void> {
		this.requireDek();
		await this.db.records.where('[table+k1+ts]').between([table, k1, Dexie.minKey], [table, k1, Dexie.maxKey]).delete();
	}

	/** Delete persisted messages older than `retentionDays` (0 = never). */
	async pruneMessages(now = Date.now()): Promise<number> {
		if (!this.meta || !this.dek) return 0;
		const days = this.meta.retentionDays;
		if (this.meta.history !== 'persist' || days <= 0) return 0;
		const cutoff = now - days * 86_400_000;
		return this.db.records
			.where('table')
			.equals('messages')
			.filter((r) => (r.ts ?? 0) < cutoff)
			.delete();
	}

	private async open<T>(dek: Uint8Array, rec: EncryptedRecord): Promise<T> {
		const pt = await aesGcmDecrypt(dek, rec.iv, rec.ct, this.aad(rec.table, rec.id));
		return JSON.parse(utf8.decode(pt)) as T;
	}
}

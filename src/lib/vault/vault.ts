// The local vault: one data-encryption key (DEK) wrapped by an Argon2id-derived KEK.
// Plain TypeScript (no Svelte runes) so it is unit-testable; the UI binds via vault.svelte.ts.
//
// Access control lives here too: failed unlocks are counted *before* the expensive KDF in a
// read-modify-write transaction on plaintext meta (they must be counted while locked), with
// exponential lockout and optional self-destruct. Index columns (record ids, grouping keys)
// are HMACs under a separate index key so the database reveals no contact IDs. The wrapped
// secret is DEK(32) ‖ IDX(32); a passphrase change rotates the DEK and keeps IDX.

import Dexie from 'dexie';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { aesGcmDecrypt, aesGcmEncrypt, AuthError } from '$lib/crypto/aead';
import { b64uDecode, b64uEncode, concat, randomBytes, utf8, wipe } from '$lib/crypto/bytes';
import { DEFAULT_KDF, deriveKek, type KdfParams } from '$lib/crypto/kdf';
import { VaultDb, type EncryptedRecord, type HistoryMode, type VaultMeta } from './db';

export type VaultStatus = 'loading' | 'none' | 'locked' | 'unlocked';

export interface CreateOptions {
	history: HistoryMode;
	retentionDays?: number;
	destroyAfterFails?: boolean;
}

export const MIN_PASSPHRASE_LEN = 12;
export const DESTROY_AFTER = 10;
const AAD_DEK = utf8.encode('AES256CHAT-dek-v1');
/** Sanity bounds for KDF params read from the database (a tampered DB must not DoS the app). */
const KDF_MAX = { m: 1024 * 1024, t: 20, p: 4 };

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

export interface IndexOpts {
	/** plaintext grouping key; stored as HMAC */
	k1?: string;
	/** sort key; stored rounded to the hour to limit timing metadata */
	ts?: number;
}

export class Vault {
	private db: VaultDb;
	private dek: Uint8Array | null = null;
	private idxKey: Uint8Array | null = null;
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

	private setKeys(secret: Uint8Array | null): void {
		wipe(this.dek, this.idxKey);
		this.dek = secret ? secret.slice(0, 32) : null;
		this.idxKey = secret ? secret.slice(32, 64) : null;
	}

	async create(pw: string, opts: CreateOptions): Promise<void> {
		if (this.meta) throw new Error('vault exists');
		if (pw.length < MIN_PASSPHRASE_LEN) throw new Error('passphrase too short');
		const salt = randomBytes(16);
		const dek = randomBytes(64); // DEK ‖ IDX
		const meta: VaultMeta = {
			id: 'v1',
			version: 1,
			salt: b64uEncode(salt),
			kdf: DEFAULT_KDF,
			wrappedDek: await this.wrap(dek, pw, salt, DEFAULT_KDF),
			createdAt: Date.now(),
			history: opts.history,
			retentionDays: opts.retentionDays ?? 7,
			destroyAfterFails: opts.destroyAfterFails ?? false,
			failedAttempts: 0,
			lockoutUntil: 0
		};
		await this.db.meta.put(meta);
		this.meta = meta;
		this.setKeys(dek);
		this.setStatus('unlocked');
	}

	private async wrap(secret: Uint8Array, pw: string, salt: Uint8Array, kdf: KdfParams): Promise<string> {
		const kek = await deriveKek(pw, salt, kdf);
		const iv = randomBytes(12);
		const wrapped = await aesGcmEncrypt(kek, iv, secret, AAD_DEK);
		wipe(kek);
		return b64uEncode(concat(iv, wrapped));
	}

	private async unwrap(pw: string, meta: VaultMeta): Promise<Uint8Array> {
		const kdf = meta.kdf;
		if (!(kdf.m > 0 && kdf.m <= KDF_MAX.m && kdf.t > 0 && kdf.t <= KDF_MAX.t && kdf.p > 0 && kdf.p <= KDF_MAX.p)) {
			throw new Error('invalid vault parameters');
		}
		const kek = await deriveKek(pw, b64uDecode(meta.salt), kdf);
		const packed = b64uDecode(meta.wrappedDek);
		try {
			return await aesGcmDecrypt(kek, packed.slice(0, 12), packed.slice(12), AAD_DEK);
		} finally {
			wipe(kek);
		}
	}

	async unlock(pw: string): Promise<void> {
		if (!this.meta) throw new Error('no vault');
		if (this.dek) return;

		// Count pessimistically, in a transaction on fresh meta, *before* the slow KDF: killing
		// the tab or racing a second tab cannot skip the increment. An active lockout refuses
		// the attempt without counting it. The lockout written here applies to the *next* attempt.
		const now = Date.now();
		const { meta: fresh, locked } = await this.db.transaction('rw', this.db.meta, async () => {
			const m = await this.db.meta.get('v1');
			if (!m) throw new Error('no vault');
			if (m.lockoutUntil > now) return { meta: m, locked: true };
			const failed = m.failedAttempts + 1;
			const next = { ...m, failedAttempts: failed, lockoutUntil: now + lockoutMs(failed) };
			await this.db.meta.put(next);
			return { meta: next, locked: false };
		});
		this.meta = fresh;
		if (locked) throw new LockoutError(fresh.lockoutUntil);

		let secret: Uint8Array;
		try {
			secret = await this.unwrap(pw, fresh);
		} catch (e) {
			if (!(e instanceof AuthError)) throw e;
			// The failed attempt is already recorded. Self-destruct on the tenth.
			if (fresh.destroyAfterFails && fresh.failedAttempts >= DESTROY_AFTER) {
				await this.destroy();
				throw new DestroyedError();
			}
			throw e;
		}
		// Success: undo the provisional count.
		await this.db.meta.update('v1', { failedAttempts: 0, lockoutUntil: 0 });
		this.meta = { ...fresh, failedAttempts: 0, lockoutUntil: 0 };
		if (secret.length === 32) secret = await this.migrateV1(secret, pw);
		this.setKeys(secret);
		this.setStatus('unlocked');
	}

	/**
	 * Vaults created before the index-key change hold a 32-byte secret and plaintext record
	 * ids. Add an index key, re-key every record to HMAC ids (the AAD includes the id, so each
	 * record is decrypted with its old id and re-encrypted under the new one) and re-wrap.
	 */
	private async migrateV1(dek: Uint8Array, pw: string): Promise<Uint8Array> {
		if (!this.meta) throw new Error('no vault');
		const idx = randomBytes(32);
		const secret = concat(dek, idx);
		const key = (v: string) => b64uEncode(hmac(sha256, idx, utf8.encode(v)).slice(0, 20));
		const old = await this.db.records.toArray();
		const rekeyed: EncryptedRecord[] = [];
		for (const r of old) {
			const pt = await aesGcmDecrypt(dek, r.iv, r.ct, this.aad(r.table, r.id));
			const id = key(r.id);
			const iv = randomBytes(12);
			const rec: EncryptedRecord = { table: r.table, id, iv, ct: await aesGcmEncrypt(dek, iv, pt, this.aad(r.table, id)) };
			if (r.k1 !== undefined) rec.k1 = key(r.k1);
			if (r.ts !== undefined) rec.ts = this.hourly(r.ts);
			rekeyed.push(rec);
			wipe(pt);
		}
		const salt = randomBytes(16);
		const patch = { salt: b64uEncode(salt), kdf: DEFAULT_KDF, wrappedDek: await this.wrap(secret, pw, salt, DEFAULT_KDF) };
		await this.db.transaction('rw', this.db.records, this.db.meta, async () => {
			await this.db.records.clear();
			await this.db.records.bulkPut(rekeyed);
			await this.db.meta.update('v1', patch);
		});
		this.meta = { ...this.meta, ...patch };
		return secret;
	}

	lock(): void {
		this.setKeys(null);
		if (this.meta) this.setStatus('locked');
	}

	/** Re-verifies the old passphrase, generates a fresh DEK and re-encrypts every record. */
	async changePassphrase(oldPw: string, newPw: string): Promise<void> {
		if (!this.meta || !this.dek || !this.idxKey) throw new LockedError();
		if (newPw.length < MIN_PASSPHRASE_LEN) throw new Error('passphrase too short');
		wipe(await this.unwrap(oldPw, this.meta)); // throws AuthError on wrong passphrase
		const oldDek = this.dek;
		const newDek = randomBytes(32);
		const salt = randomBytes(16);
		const wrappedDek = await this.wrap(concat(newDek, this.idxKey), newPw, salt, DEFAULT_KDF);
		const patch = { salt: b64uEncode(salt), kdf: DEFAULT_KDF, wrappedDek };
		// Re-encrypt outside the transaction (Dexie transactions must not await foreign promises),
		// then swap everything in one atomic write.
		const all = await this.db.records.toArray();
		const rewrapped: EncryptedRecord[] = [];
		for (const r of all) {
			const pt = await aesGcmDecrypt(oldDek, r.iv, r.ct, this.aad(r.table, r.id));
			const iv = randomBytes(12);
			rewrapped.push({ ...r, iv, ct: await aesGcmEncrypt(newDek, iv, pt, this.aad(r.table, r.id)) });
			wipe(pt);
		}
		await this.db.transaction('rw', this.db.records, this.db.meta, async () => {
			await this.db.records.bulkPut(rewrapped);
			await this.db.meta.update('v1', patch);
		});
		this.meta = { ...this.meta, ...patch };
		this.setKeys(concat(newDek, this.idxKey));
	}

	async updateSettings(patch: Partial<Pick<VaultMeta, 'history' | 'retentionDays' | 'destroyAfterFails'>>): Promise<void> {
		if (!this.meta || !this.dek) throw new LockedError();
		await this.db.meta.update('v1', patch);
		this.meta = { ...this.meta, ...patch };
		if (patch.history === 'ephemeral') {
			await this.db.records.where('table').anyOf('messages', 'attachments').delete();
		}
	}

	/** Wipes everything. Irreversible by design. */
	async destroy(): Promise<void> {
		this.setKeys(null);
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

	/** Opaque, keyed index value: the DB never shows a contact ID. */
	private idx(value: string): string {
		if (!this.idxKey) throw new LockedError();
		return b64uEncode(hmac(sha256, this.idxKey, utf8.encode(value)).slice(0, 20));
	}

	private aad(table: string, id: string): Uint8Array {
		return utf8.encode(`${table}\u0000${id}`);
	}

	private hourly(ts?: number): number | undefined {
		return ts === undefined ? undefined : Math.floor(ts / 3_600_000) * 3_600_000;
	}

	async put<T>(table: string, id: string, value: T, index?: IndexOpts): Promise<void> {
		const dek = this.requireDek();
		const sid = this.idx(id);
		const iv = randomBytes(12);
		const ct = await aesGcmEncrypt(dek, iv, utf8.encode(JSON.stringify(value)), this.aad(table, sid));
		const rec: EncryptedRecord = { table, id: sid, iv, ct };
		if (index?.k1 !== undefined) rec.k1 = this.idx(index.k1);
		if (index?.ts !== undefined) rec.ts = this.hourly(index.ts);
		await this.db.records.put(rec);
	}

	async get<T>(table: string, id: string): Promise<T | undefined> {
		const dek = this.requireDek();
		const rec = await this.db.records.get({ table, id: this.idx(id) });
		if (!rec) return undefined;
		return this.open<T>(dek, rec);
	}

	async list<T>(table: string, opts: { k1?: string; limit?: number } = {}): Promise<{ value: T }[]> {
		const dek = this.requireDek();
		let coll = opts.k1
			? this.db.records.where('[table+k1+ts]').between([table, this.idx(opts.k1), Dexie.minKey], [table, this.idx(opts.k1), Dexie.maxKey])
			: this.db.records.where('table').equals(table);
		if (opts.limit) coll = coll.limit(opts.limit);
		const recs = await coll.toArray();
		return Promise.all(recs.map(async (r) => ({ value: await this.open<T>(dek, r) })));
	}

	async delete(table: string, id: string): Promise<void> {
		this.requireDek();
		await this.db.records.where('[table+id]').equals([table, this.idx(id)]).delete();
	}

	async deleteWhere(table: string, k1: string): Promise<void> {
		this.requireDek();
		await this.db.records.where('[table+k1+ts]').between([table, this.idx(k1), Dexie.minKey], [table, this.idx(k1), Dexie.maxKey]).delete();
	}

	/** Delete persisted messages and attachments older than `retentionDays` (0 = never). */
	async pruneMessages(now = Date.now()): Promise<number> {
		if (!this.meta || !this.dek) return 0;
		const days = this.meta.retentionDays;
		if (this.meta.history !== 'persist' || days <= 0) return 0;
		const cutoff = now - days * 86_400_000;
		return this.db.records
			.where('table')
			.anyOf('messages', 'attachments')
			.filter((r) => (r.ts ?? 0) < cutoff)
			.delete();
	}

	private async open<T>(dek: Uint8Array, rec: EncryptedRecord): Promise<T> {
		const pt = await aesGcmDecrypt(dek, rec.iv, rec.ct, this.aad(rec.table, rec.id));
		return JSON.parse(utf8.decode(pt)) as T;
	}
}

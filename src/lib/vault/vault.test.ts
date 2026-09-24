import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthError } from '$lib/crypto/aead';
import { DestroyedError, LockedError, LockoutError, Vault, lockoutMs } from './vault';

const PW = 'correct horse battery staple';
let n = 0;

function fresh() {
	return new Vault(`test-${Date.now()}-${n++}`);
}

async function expireLockout(v: Vault) {
	await (v as unknown as { db: { meta: { update: (id: string, p: object) => Promise<number> } } }).db.meta.update('v1', { lockoutUntil: 0 });
}

describe('vault', () => {
	let v: Vault;
	beforeEach(async () => {
		v = fresh();
		expect(await v.init()).toBe('none');
	});

	it('creates, stores encrypted records, locks and unlocks', async () => {
		await v.create(PW, { history: 'persist' });
		expect(v.status).toBe('unlocked');
		await v.put('contacts', 'c1', { name: 'Bob' });
		await v.put('messages', 'm1', { body: 'hi' }, { k1: 'c1', ts: 1 });
		await v.put('messages', 'm2', { body: 'yo' }, { k1: 'c1', ts: 2 });
		expect(await v.get('contacts', 'c1')).toEqual({ name: 'Bob' });
		expect((await v.list<{ body: string }>('messages', { k1: 'c1' })).map((m) => m.value.body).sort()).toEqual(['hi', 'yo']);

		v.lock();
		expect(v.status).toBe('locked');
		await expect(v.get('contacts', 'c1')).rejects.toThrow(LockedError);

		// Re-open the same database from a new instance, as after an app restart.
		const again = new Vault((v as unknown as { db: { name: string } }).db.name);
		expect(await again.init()).toBe('locked');
		await again.unlock(PW);
		expect(await again.get('contacts', 'c1')).toEqual({ name: 'Bob' });
	});

	it('rejects short passphrases', async () => {
		await expect(v.create('short', { history: 'ephemeral' })).rejects.toThrow(/short/);
	});

	it('counts failures, locks out exponentially, resets on success', async () => {
		await v.create(PW, { history: 'ephemeral' });
		v.lock();
		await expect(v.unlock('wrong passphrase')).rejects.toThrow(AuthError);
		await expect(v.unlock('wrong passphrase')).rejects.toThrow(AuthError);
		expect(v.info?.failedAttempts).toBe(2);
		await expect(v.unlock('wrong passphrase')).rejects.toThrow(AuthError); // 3rd → 30 s lockout
		expect(v.info?.lockoutUntil).toBeGreaterThan(Date.now());
		await expect(v.unlock(PW)).rejects.toThrow(LockoutError);
		// Simulate lockout expiry (the counter lives in the DB, not in memory).
		await expireLockout(v);
		await v.unlock(PW);
		expect(v.info?.failedAttempts).toBe(0);
	});

	it('self-destructs after 10 failures when enabled', async () => {
		await v.create(PW, { history: 'ephemeral', destroyAfterFails: true });
		await v.put('contacts', 'c1', { name: 'Bob' });
		v.lock();
		for (let i = 0; i < 9; i++) {
			await expireLockout(v);
			await expect(v.unlock('nope nope nope')).rejects.toThrow(AuthError);
		}
		await expireLockout(v);
		await expect(v.unlock('nope nope nope')).rejects.toThrow(DestroyedError);
		expect(v.status).toBe('none');
		expect(await v.init()).toBe('none');
	});

	it('changes the passphrase, rotates the DEK and re-encrypts records', async () => {
		await v.create(PW, { history: 'persist' });
		await v.put('contacts', 'c1', { name: 'Bob' });
		const inner = v as unknown as { dek: Uint8Array; db: { records: { toArray: () => Promise<{ ct: Uint8Array }[]> } } };
		const dekBefore = inner.dek.slice();
		const ctBefore = (await inner.db.records.toArray())[0].ct.slice();
		await expect(v.changePassphrase('wrong passphrase', 'new passphrase 123')).rejects.toThrow(AuthError);
		await v.changePassphrase(PW, 'new passphrase 123');
		expect(inner.dek).not.toEqual(dekBefore);
		expect((await inner.db.records.toArray())[0].ct).not.toEqual(ctBefore);
		v.lock();
		await expect(v.unlock(PW)).rejects.toThrow(AuthError);
		await v.unlock('new passphrase 123');
		expect(await v.get('contacts', 'c1')).toEqual({ name: 'Bob' });
	});

	it('prunes old messages in persist mode and wipes them when switching to ephemeral', async () => {
		await v.create(PW, { history: 'persist', retentionDays: 7 });
		const now = Date.now();
		await v.put('messages', 'old', { body: 'old' }, { k1: 'c1', ts: now - 8 * 86_400_000 });
		await v.put('messages', 'new', { body: 'new' }, { k1: 'c1', ts: now });
		expect(await v.pruneMessages(now)).toBe(1);
		expect((await v.list<{ body: string }>('messages', { k1: 'c1' })).map((m) => m.value.body)).toEqual(['new']);
		await v.updateSettings({ history: 'ephemeral' });
		expect(await v.list('messages')).toEqual([]);
	});

	it('a killed attempt still counts and a second instance sees the lockout', async () => {
		await v.create(PW, { history: 'ephemeral' });
		const name = (v as unknown as { db: { name: string } }).db.name;
		v.lock();
		for (let i = 0; i < 3; i++) await expect(v.unlock('wrong passphrase')).rejects.toThrow(AuthError);
		const other = new Vault(name);
		await other.init();
		await expect(other.unlock(PW)).rejects.toThrow(LockoutError);
	});

	it('migrates a pre-index-key vault (32-byte secret, plaintext ids) on unlock', async () => {
		// Build a v1-style vault by hand: plaintext ids, DEK-only wrapped secret.
		const { aesGcmEncrypt } = await import('$lib/crypto/aead');
		const { b64uEncode, concat, randomBytes, utf8 } = await import('$lib/crypto/bytes');
		const { DEFAULT_KDF, deriveKek } = await import('$lib/crypto/kdf');
		const db = (v as unknown as { db: import('./db').VaultDb }).db;
		const dek = randomBytes(32);
		const salt = randomBytes(16);
		const kek = await deriveKek(PW, salt, DEFAULT_KDF);
		const iv = randomBytes(12);
		const wrapped = await aesGcmEncrypt(kek, iv, dek, utf8.encode('AES256CHAT-dek-v1'));
		await db.meta.put({
			id: 'v1', version: 1, salt: b64uEncode(salt), kdf: DEFAULT_KDF, wrappedDek: b64uEncode(concat(iv, wrapped)),
			createdAt: 1, history: 'persist', retentionDays: 7, destroyAfterFails: false, failedAttempts: 0, lockoutUntil: 0
		});
		const put = async (table: string, id: string, value: object, k1?: string, ts?: number) => {
			const riv = randomBytes(12);
			const ct = await aesGcmEncrypt(dek, riv, utf8.encode(JSON.stringify(value)), utf8.encode(`${table}\u0000${id}`));
			await db.records.put({ table, id, iv: riv, ct, ...(k1 ? { k1 } : {}), ...(ts ? { ts } : {}) });
		};
		await put('contacts', 'CD3GXAWZ64VA073C', { id: 'CD3GXAWZ64VA073C', name: 'Bob' });
		await put('messages', 'm1', { id: 'm1', body: 'hi' }, 'CD3GXAWZ64VA073C', 1000);

		const fresh = new Vault(db.name);
		expect(await fresh.init()).toBe('locked');
		await fresh.unlock(PW);
		expect(await fresh.get('contacts', 'CD3GXAWZ64VA073C')).toEqual({ id: 'CD3GXAWZ64VA073C', name: 'Bob' });
		expect((await fresh.list<{ body: string }>('messages', { k1: 'CD3GXAWZ64VA073C' })).map((m) => m.value.body)).toEqual(['hi']);
		// No plaintext contact id left in the database.
		const ids = (await db.records.toArray()).map((r) => r.id + (r.k1 ?? ''));
		expect(ids.join(' ')).not.toContain('CD3GXAWZ64VA073C');
		// Re-lock/unlock uses the new 64-byte secret.
		fresh.lock();
		await fresh.unlock(PW);
		expect(await fresh.get('contacts', 'CD3GXAWZ64VA073C')).toBeTruthy();
	});

	it('lockout schedule', () => {
		expect(lockoutMs(1)).toBe(0);
		expect(lockoutMs(3)).toBe(30_000);
		expect(lockoutMs(4)).toBe(60_000);
		expect(lockoutMs(20)).toBe(30 * 60_000);
	});
});

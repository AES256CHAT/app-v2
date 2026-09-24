import { describe, expect, it } from 'vitest';
import { AuthError } from '$lib/crypto/aead';
import { backupFileName, isBackup, openBackup, sealBackup, type BackupPayload } from './backup';

const payload: BackupPayload = {
	v: 1,
	createdAt: 1,
	me: { edSec: 'a', xSec: 'b', kemSeed: 'c', createdAt: 1, name: 'Alice' },
	contacts: [{ id: 'X', name: 'Bob' }],
	messages: [{ id: 'm', body: 'hi' }]
};

describe('backup', () => {
	it('round-trips and rejects wrong passphrase or tampering', async () => {
		const bytes = await sealBackup(payload, 'korrekt pferd batterie', { m: 8192, t: 1, p: 1 });
		expect(isBackup(bytes)).toBe(true);
		expect(await openBackup(bytes, 'korrekt pferd batterie')).toEqual(payload);
		await expect(openBackup(bytes, 'falsch')).rejects.toThrow(AuthError);
		const bad = bytes.slice();
		bad[bad.length - 1] ^= 1;
		await expect(openBackup(bad, 'korrekt pferd batterie')).rejects.toThrow(AuthError);
		expect(isBackup(new Uint8Array(10))).toBe(false);
		expect(backupFileName(0)).toMatch(/^aes256chat-backup-\d{8}\.a256bak$/);
	});
});

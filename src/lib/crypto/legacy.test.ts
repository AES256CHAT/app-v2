import { describe, expect, it } from 'vitest';
import { utf8 } from './bytes';
import {
	LEGACY,
	LegacyError,
	legacyDecryptFile,
	legacyDecryptMessage,
	legacyEncryptFile,
	legacyEncryptMessage
} from './legacy';
// Reference ciphertexts produced by the verbatim v1 functions (scratch script, not this port).
import vectors from './__fixtures__/legacy-vectors.json';

describe('legacy password mode (v1 / Astoris compatible)', () => {
	it('decrypts 🛡️QR-ENC: produced by v1', async () => {
		expect(await legacyDecryptMessage(vectors.military, vectors.password)).toBe(vectors.text);
	});

	it('decrypts 🔐QR: (PBKDF2-SHA512 500k) produced by v1 format', async () => {
		expect(await legacyDecryptMessage(vectors.quantum, vectors.password)).toBe(vectors.text);
	}, 20_000);

	it('decrypts 🔒ENC: (PBKDF2-SHA256 100k, 16-byte salt) and unmarked old format', async () => {
		expect(await legacyDecryptMessage(vectors.old, vectors.password)).toBe(vectors.text);
		expect(await legacyDecryptMessage(vectors.old.slice(LEGACY.old.length), vectors.password)).toBe(vectors.text);
	});

	it('decrypts 🔐FILE: produced by v1 with metadata', async () => {
		const { data, meta } = await legacyDecryptFile(vectors.file, vectors.password);
		expect(utf8.decode(data)).toBe(vectors.fileContent);
		expect(meta).toEqual({ name: 'notes.txt', type: 'text/plain', size: vectors.fileContent.length });
	});

	it('writes the current v1 format and reads it back', async () => {
		const ct = await legacyEncryptMessage('Ping', 'pw');
		expect(ct.startsWith(LEGACY.military)).toBe(true);
		expect(await legacyDecryptMessage(ct, 'pw')).toBe('Ping');
		const f = await legacyEncryptFile(utf8.encode('abc'), { name: 'a.txt', type: 'text/plain', size: 3 }, 'pw');
		expect(f.startsWith(LEGACY.file)).toBe(true);
		expect(utf8.decode((await legacyDecryptFile(f, 'pw')).data)).toBe('abc');
	});

	it('fails cleanly on wrong password or damaged data', async () => {
		await expect(legacyDecryptMessage(vectors.military, 'wrong')).rejects.toThrow(LegacyError);
		await expect(legacyDecryptMessage(vectors.military.slice(0, -4) + 'AAAA', vectors.password)).rejects.toThrow(
			LegacyError
		);
		await expect(legacyDecryptFile(vectors.military, vectors.password)).rejects.toThrow(LegacyError);
	});
});

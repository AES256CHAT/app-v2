import { describe, expect, it } from 'vitest';
import { randomBytes, utf8 } from './bytes';
import { envelopeFileName, isFileEnvelope, unwrapFileEnvelope, wrapFileEnvelope } from './fileenvelope';
import { decodePlain, encodePlain, sanitizeName } from './message';

describe('plain body framing', () => {
	it('round-trips text', () => {
		const p = decodePlain(encodePlain({ t: 'text', body: 'Grüße 🛡️', ts: 123 }));
		expect(p).toEqual({ t: 'text', body: 'Grüße 🛡️', ts: 123 });
	});

	it('round-trips a file without base64 overhead', () => {
		const data = randomBytes(5000);
		const enc = encodePlain({ t: 'file', name: 'bild.jpg', mime: 'image/jpeg', size: 0, ts: 5, data });
		expect(enc.length).toBeLessThan(5000 + 120);
		const p = decodePlain(enc);
		if (p.t !== 'file') throw new Error();
		expect(p.name).toBe('bild.jpg');
		expect(p.size).toBe(5000);
		expect(p.data).toEqual(data);
	});

	it('rejects garbage and unknown types', () => {
		expect(() => decodePlain(new Uint8Array([9, 0, 2, 123, 125]))).toThrow();
		expect(() => decodePlain(utf8.encode('{"t":"text"}'))).toThrow();
	});

	it('sanitises received file names', () => {
		expect(sanitizeName('../../etc/passwd')).toBe('.._.._etc_passwd');
		expect(sanitizeName('a\u0000b\n.txt')).toBe('ab.txt');
		expect(sanitizeName('   ')).toBe('file');
	});
});

describe('file envelope', () => {
	it('wraps and unwraps with magic', () => {
		const msg = randomBytes(80);
		const env = wrapFileEnvelope(msg);
		expect(isFileEnvelope(env)).toBe(true);
		expect(isFileEnvelope(msg)).toBe(false);
		expect(unwrapFileEnvelope(env)).toEqual(msg);
		expect(envelopeFileName(0)).toMatch(/^aes256chat-\d{8}-\d{6}\.aes256$/);
	});
});

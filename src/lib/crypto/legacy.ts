// Password mode — byte-for-byte compatible with AES256CHAT v1 and the Astoris "Tresor".
// Ported from components/telegram-encryption-plugin.tsx (v1) lines 767–1044. Do not change
// formats here; add new formats elsewhere.
//
//   🛡️QR-ENC:  PBKDF2-SHA512/100k, salt 32, iv 12               (current v1 format, write + read)
//   🔐QR:      PBKDF2-SHA512/<iterations, default 500k>, 32/12  (read only)
//   🔒ENC:     PBKDF2-SHA256/100k, salt 16, iv 12               (read only, also used when no marker)
//   🔐FILE:    like 🛡️QR-ENC + u32 metadata length + JSON meta   (write + read)

import { b64Decode, b64Encode, concat, randomBytes, readU32be, u32be, utf8 } from './bytes';

export const LEGACY = {
	military: '🛡️QR-ENC:',
	quantum: '🔐QR:',
	old: '🔒ENC:',
	file: '🔐FILE:'
} as const;

export const LEGACY_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const LEGACY_DEFAULT_QUANTUM_ITERATIONS = 500_000;

export interface LegacyFileMeta {
	name: string;
	type: string;
	size: number;
}

async function pbkdf2Key(
	pw: string,
	salt: Uint8Array,
	iterations: number,
	hash: 'SHA-512' | 'SHA-256',
	usages: KeyUsage[]
): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey('raw', utf8.encode(pw) as BufferSource, 'PBKDF2', false, [
		'deriveKey'
	]);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		usages
	);
}

const gcm = (iv: Uint8Array): AesGcmParams => ({ name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 });

export class LegacyError extends Error {
	constructor(msg: string) {
		super(msg);
		this.name = 'LegacyError';
	}
}

export async function legacyEncryptMessage(text: string, pw: string): Promise<string> {
	const salt = randomBytes(32);
	const iv = randomBytes(12);
	const key = await pbkdf2Key(pw, salt, 100_000, 'SHA-512', ['encrypt']);
	const ct = new Uint8Array(await crypto.subtle.encrypt(gcm(iv), key, utf8.encode(text) as BufferSource));
	return LEGACY.military + b64Encode(concat(salt, iv, ct));
}

export async function legacyDecryptMessage(
	encrypted: string,
	pw: string,
	quantumIterations = LEGACY_DEFAULT_QUANTUM_ITERATIONS
): Promise<string> {
	let text = encrypted.trim();
	let format: 'military' | 'quantum' | 'old' = 'old';
	if (text.startsWith(LEGACY.military)) {
		text = text.slice(LEGACY.military.length);
		format = 'military';
	} else if (text.startsWith(LEGACY.quantum)) {
		text = text.slice(LEGACY.quantum.length);
		format = 'quantum';
	} else if (text.startsWith(LEGACY.old)) {
		text = text.slice(LEGACY.old.length);
	}
	try {
		const combined = b64Decode(text);
		let salt: Uint8Array, iv: Uint8Array, data: Uint8Array, key: CryptoKey;
		if (format === 'military') {
			[salt, iv, data] = [combined.slice(0, 32), combined.slice(32, 44), combined.slice(44)];
			key = await pbkdf2Key(pw, salt, 100_000, 'SHA-512', ['decrypt']);
		} else if (format === 'quantum') {
			[salt, iv, data] = [combined.slice(0, 32), combined.slice(32, 44), combined.slice(44)];
			key = await pbkdf2Key(pw, salt, quantumIterations, 'SHA-512', ['decrypt']);
		} else {
			[salt, iv, data] = [combined.slice(0, 16), combined.slice(16, 28), combined.slice(28)];
			key = await pbkdf2Key(pw, salt, 100_000, 'SHA-256', ['decrypt']);
		}
		const pt = await crypto.subtle.decrypt(gcm(iv), key, data as BufferSource);
		return utf8.decode(new Uint8Array(pt));
	} catch {
		throw new LegacyError('decryption failed');
	}
}

export async function legacyEncryptFile(data: Uint8Array, meta: LegacyFileMeta, pw: string): Promise<string> {
	if (data.length > LEGACY_MAX_FILE_BYTES) throw new LegacyError('file too large');
	const salt = randomBytes(32);
	const iv = randomBytes(12);
	const key = await pbkdf2Key(pw, salt, 100_000, 'SHA-512', ['encrypt']);
	const ct = new Uint8Array(await crypto.subtle.encrypt(gcm(iv), key, data as BufferSource));
	const metaBytes = utf8.encode(JSON.stringify({ name: meta.name, type: meta.type, size: meta.size }));
	return LEGACY.file + b64Encode(concat(salt, iv, u32be(metaBytes.length), metaBytes, ct));
}

export async function legacyDecryptFile(
	encrypted: string,
	pw: string
): Promise<{ data: Uint8Array; meta: LegacyFileMeta }> {
	const text = encrypted.trim();
	if (!text.startsWith(LEGACY.file)) throw new LegacyError('not a legacy file');
	try {
		const combined = b64Decode(text.slice(LEGACY.file.length));
		const salt = combined.slice(0, 32);
		const iv = combined.slice(32, 44);
		const metaLen = readU32be(combined, 44);
		const meta = JSON.parse(utf8.decode(combined.slice(48, 48 + metaLen))) as LegacyFileMeta;
		const ct = combined.slice(48 + metaLen);
		const key = await pbkdf2Key(pw, salt, 100_000, 'SHA-512', ['decrypt']);
		const pt = await crypto.subtle.decrypt(gcm(iv), key, ct as BufferSource);
		return { data: new Uint8Array(pt), meta };
	} catch {
		throw new LegacyError('decryption failed');
	}
}

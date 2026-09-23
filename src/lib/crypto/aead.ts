// AES-256-GCM via Web Crypto. Keys are imported non-extractable per call.

const GCM_TAG_BITS = 128;

async function importKey(raw: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
	if (raw.length !== 32) throw new Error('AES-256 key must be 32 bytes');
	return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [usage]);
}

export async function aesGcmEncrypt(
	key: Uint8Array,
	iv: Uint8Array,
	plaintext: Uint8Array,
	aad?: Uint8Array
): Promise<Uint8Array> {
	if (iv.length !== 12) throw new Error('GCM IV must be 12 bytes');
	const k = await importKey(key, 'encrypt');
	const ct = await crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: iv as BufferSource,
			tagLength: GCM_TAG_BITS,
			...(aad ? { additionalData: aad as BufferSource } : {})
		},
		k,
		plaintext as BufferSource
	);
	return new Uint8Array(ct);
}

export async function aesGcmDecrypt(
	key: Uint8Array,
	iv: Uint8Array,
	ciphertext: Uint8Array,
	aad?: Uint8Array
): Promise<Uint8Array> {
	if (iv.length !== 12) throw new Error('GCM IV must be 12 bytes');
	const k = await importKey(key, 'decrypt');
	try {
		const pt = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: iv as BufferSource,
				tagLength: GCM_TAG_BITS,
				...(aad ? { additionalData: aad as BufferSource } : {})
			},
			k,
			ciphertext as BufferSource
		);
		return new Uint8Array(pt);
	} catch {
		// Web Crypto throws an opaque OperationError; normalise it.
		throw new AuthError();
	}
}

/** Thrown when authentication fails (wrong key, tampered data, wrong AAD). */
export class AuthError extends Error {
	constructor() {
		super('authentication failed');
		this.name = 'AuthError';
	}
}

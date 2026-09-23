// Passphrase → key-encryption-key via Argon2id (hash-wasm). Parameters are stored with the
// vault so they can be raised later without breaking existing vaults.

import { argon2id } from 'hash-wasm';

export interface KdfParams {
	/** memory in KiB */
	m: number;
	/** iterations */
	t: number;
	/** parallelism */
	p: number;
}

/** 64 MiB, 3 passes: ~0.2 s on desktop, ~1–2 s on phones. OWASP-recommended class. */
export const DEFAULT_KDF: KdfParams = { m: 65536, t: 3, p: 1 };

export async function deriveKek(pw: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): Promise<Uint8Array> {
	if (salt.length < 16) throw new Error('salt too short');
	return argon2id({
		password: pw,
		salt,
		parallelism: params.p,
		iterations: params.t,
		memorySize: params.m,
		hashLength: 32,
		outputType: 'binary'
	});
}

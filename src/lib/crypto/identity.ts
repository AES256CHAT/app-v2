// Device identity: Ed25519 (signatures) + X25519 (DH) + ML-KEM-768 (post-quantum KEM).
// One identity per device. Contact IDs and safety numbers are derived from the public bundle.

import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { b32Encode, concat, randomBytes, utf8 } from './bytes';

export const ED_PUB_LEN = 32;
export const X_PUB_LEN = 32;
export const KEM_PUB_LEN = 1184;
export const BUNDLE_LEN = ED_PUB_LEN + X_PUB_LEN + KEM_PUB_LEN; // 1248
export const SIG_LEN = 64;

export interface KeyPair {
	pub: Uint8Array;
	sec: Uint8Array;
}

export interface PublicBundle {
	ed: Uint8Array;
	x: Uint8Array;
	kem: Uint8Array;
}

export interface Identity {
	ed: KeyPair;
	x: KeyPair;
	/** ML-KEM keypair is regenerated from a 64-byte seed to keep storage small. */
	kemSeed: Uint8Array;
	kem: KeyPair;
	createdAt: number;
}

export function generateIdentity(): Identity {
	const edSec = ed25519.utils.randomSecretKey();
	const xSec = x25519.utils.randomSecretKey();
	const kemSeed = randomBytes(64);
	const kem = ml_kem768.keygen(kemSeed);
	return {
		ed: { pub: ed25519.getPublicKey(edSec), sec: edSec },
		x: { pub: x25519.getPublicKey(xSec), sec: xSec },
		kemSeed,
		kem: { pub: kem.publicKey, sec: kem.secretKey },
		createdAt: Date.now()
	};
}

/** Rebuild an identity from its stored secrets. */
export function identityFromSecrets(
	edSec: Uint8Array,
	xSec: Uint8Array,
	kemSeed: Uint8Array,
	createdAt: number
): Identity {
	const kem = ml_kem768.keygen(kemSeed);
	return {
		ed: { pub: ed25519.getPublicKey(edSec), sec: edSec },
		x: { pub: x25519.getPublicKey(xSec), sec: xSec },
		kemSeed,
		kem: { pub: kem.publicKey, sec: kem.secretKey },
		createdAt
	};
}

export function bundleOf(id: Identity): PublicBundle {
	return { ed: id.ed.pub, x: id.x.pub, kem: id.kem.pub };
}

export function encodeBundle(b: PublicBundle): Uint8Array {
	if (b.ed.length !== ED_PUB_LEN || b.x.length !== X_PUB_LEN || b.kem.length !== KEM_PUB_LEN) {
		throw new Error('invalid public bundle');
	}
	return concat(b.ed, b.x, b.kem);
}

export function decodeBundle(bytes: Uint8Array): PublicBundle {
	if (bytes.length !== BUNDLE_LEN) throw new Error('invalid public bundle length');
	return {
		ed: bytes.slice(0, ED_PUB_LEN),
		x: bytes.slice(ED_PUB_LEN, ED_PUB_LEN + X_PUB_LEN),
		kem: bytes.slice(ED_PUB_LEN + X_PUB_LEN)
	};
}

/** Anonymous contact ID: 16 base32 chars of SHA-256(bundle). ~80 bits, collision-safe for contact lists. */
export function contactId(b: PublicBundle): string {
	return b32Encode(sha256(encodeBundle(b))).slice(0, 16);
}

export function formatId(id: string): string {
	return id.match(/.{1,4}/g)?.join('-') ?? id;
}

/**
 * Safety number: 60 digits, identical on both devices regardless of who computes it.
 * Each half is derived from one party's bundle (5200 SHA-512 iterations, like Signal),
 * halves are sorted so the result is order-independent.
 */
export function safetyNumber(a: PublicBundle, b: PublicBundle): string {
	const half = (bundle: PublicBundle): string => {
		const enc = encodeBundle(bundle);
		let h = sha512(concat(utf8.encode('AES256CHAT-SN-v1'), enc));
		for (let i = 1; i < 5200; i++) h = sha512(concat(h, enc));
		let digits = '';
		for (let i = 0; i < 6; i++) {
			const chunk = h.slice(i * 5, i * 5 + 5);
			const n = chunk.reduce((acc, byte) => acc * 256n + BigInt(byte), 0n);
			digits += (n % 100000n).toString().padStart(5, '0');
		}
		return digits;
	};
	return [half(a), half(b)].sort().join('');
}

export function formatSafetyNumber(sn: string): string {
	return sn.match(/.{5}/g)?.join(' ') ?? sn;
}

export function sign(id: Identity, message: Uint8Array): Uint8Array {
	return ed25519.sign(message, id.ed.sec);
}

export function verify(edPub: Uint8Array, message: Uint8Array, sig: Uint8Array): boolean {
	try {
		return ed25519.verify(sig, message, edPub);
	} catch {
		return false;
	}
}

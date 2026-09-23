// Byte helpers shared by all crypto modules. No dependencies, browser + Node.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8 = {
	encode: (s: string): Uint8Array => encoder.encode(s),
	decode: (b: Uint8Array): string => decoder.decode(b)
};

export function concat(...parts: Uint8Array[]): Uint8Array {
	const len = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(len);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

export function randomBytes(n: number): Uint8Array {
	const b = new Uint8Array(n);
	crypto.getRandomValues(b);
	return b;
}

/** Constant-time comparison. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

/** Best-effort zeroisation of key material. */
export function wipe(...arrs: (Uint8Array | null | undefined)[]): void {
	for (const a of arrs) a?.fill(0);
}

export function u32be(n: number): Uint8Array {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, n >>> 0, false);
	return b;
}

export function readU32be(b: Uint8Array, off: number): number {
	return new DataView(b.buffer, b.byteOffset + off, 4).getUint32(0, false);
}

// --- Base64 (standard, used by the legacy password format) ---------------------------------

export function b64Encode(bytes: Uint8Array): string {
	// Chunked to avoid call-stack limits on multi-MB files.
	let bin = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(bin);
}

export function b64Decode(s: string): Uint8Array {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

// --- Base64url without padding (used by all v2 envelopes) -----------------------------------

export function b64uEncode(bytes: Uint8Array): string {
	return b64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(s: string): Uint8Array {
	const std = s.replace(/-/g, '+').replace(/_/g, '/');
	const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4));
	return b64Decode(std + pad);
}

/** Crockford-style base32 (no padding), for human-readable contact IDs. */
const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
export function b32Encode(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += B32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += B32[(value << (5 - bits)) & 31];
	return out;
}

/** Length-prefixed (u16) byte string, for simple binary framing. */
export function packLp(b: Uint8Array): Uint8Array {
	if (b.length > 0xffff) throw new Error('field too long');
	return concat(new Uint8Array([b.length >>> 8, b.length & 0xff]), b);
}

export function readLp(b: Uint8Array, off: number): { value: Uint8Array; next: number } {
	if (off + 2 > b.length) throw new Error('truncated');
	const len = (b[off] << 8) | b[off + 1];
	const start = off + 2;
	if (start + len > b.length) throw new Error('truncated');
	return { value: b.slice(start, start + len), next: start + len };
}

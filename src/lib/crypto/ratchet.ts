// Double Ratchet (Signal spec) over X25519 + HKDF-SHA512 + AES-256-GCM.
//
// Deviation from the spec, needed because there is no server: the responder ("Bob")
// gets an initial sending chain derived from the handshake secret, so *either* side may
// send the first message. That chain is Alice's initial receiving chain under DHr = ephB.
// Everything else follows https://signal.org/docs/specifications/doubleratchet/.
//
// All functions are pure: they return a new state and never mutate the input. That makes
// trial decryption against several contacts (sealed sender) trivial.

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { aesGcmDecrypt, aesGcmEncrypt, AuthError } from './aead';
import { b64uDecode, b64uEncode, concat, equalBytes, readU32be, u32be, utf8 } from './bytes';
import type { KeyPair } from './identity';

export const MAX_SKIP = 500;
export const HEADER_LEN = 32 + 4 + 4;

const INFO_RK = utf8.encode('AES256CHAT-rk-v1');
const INFO_MK = utf8.encode('AES256CHAT-mk-v1');
const ZERO32 = new Uint8Array(32);

export interface RatchetState {
	dhs: KeyPair;
	dhr: Uint8Array | null;
	rk: Uint8Array;
	cks: Uint8Array | null;
	ckr: Uint8Array | null;
	ns: number;
	nr: number;
	pn: number;
	/** key: `${b64u(dhPub)}:${n}` → message key */
	skipped: Map<string, Uint8Array>;
	/** Session associated data (binds identities), mixed into every AEAD. */
	ad: Uint8Array;
}

export interface Header {
	dh: Uint8Array;
	pn: number;
	n: number;
}

// --- KDFs ----------------------------------------------------------------------------------

function kdfRk(rk: Uint8Array, dhOut: Uint8Array): [Uint8Array, Uint8Array] {
	const out = hkdf(sha512, dhOut, rk, INFO_RK, 64);
	return [out.slice(0, 32), out.slice(32, 64)];
}

function kdfCk(ck: Uint8Array): [Uint8Array, Uint8Array] {
	const mk = hmac(sha512, ck, new Uint8Array([0x01])).slice(0, 32);
	const next = hmac(sha512, ck, new Uint8Array([0x02])).slice(0, 32);
	return [next, mk];
}

function messageKeyAndIv(mk: Uint8Array): [Uint8Array, Uint8Array] {
	const out = hkdf(sha512, mk, ZERO32, INFO_MK, 44);
	return [out.slice(0, 32), out.slice(32, 44)];
}

function generateDh(): KeyPair {
	const sec = x25519.utils.randomSecretKey();
	return { pub: x25519.getPublicKey(sec), sec };
}

function dh(pair: KeyPair, pub: Uint8Array): Uint8Array {
	return x25519.getSharedSecret(pair.sec, pub);
}

// --- Header codec ----------------------------------------------------------------------------

export function encodeHeader(h: Header): Uint8Array {
	return concat(h.dh, u32be(h.pn), u32be(h.n));
}

export function decodeHeader(b: Uint8Array): Header {
	if (b.length < HEADER_LEN) throw new Error('message too short');
	return { dh: b.slice(0, 32), pn: readU32be(b, 32), n: readU32be(b, 36) };
}

// --- Init --------------------------------------------------------------------------------------

/** Initiator (offer creator). `bobEph` is the responder's ephemeral key from the answer. */
export function initAlice(
	sk: Uint8Array,
	bobInitialChain: Uint8Array,
	bobEph: Uint8Array,
	ad: Uint8Array
): RatchetState {
	const dhs = generateDh();
	const [rk, cks] = kdfRk(sk, dh(dhs, bobEph));
	return { dhs, dhr: bobEph, rk, cks, ckr: bobInitialChain, ns: 0, nr: 0, pn: 0, skipped: new Map(), ad };
}

/** Responder (answer creator). `eph` is the responder's own ephemeral keypair. */
export function initBob(
	sk: Uint8Array,
	bobInitialChain: Uint8Array,
	eph: KeyPair,
	ad: Uint8Array
): RatchetState {
	return { dhs: eph, dhr: null, rk: sk, cks: bobInitialChain, ckr: null, ns: 0, nr: 0, pn: 0, skipped: new Map(), ad };
}

// --- Encrypt / decrypt -----------------------------------------------------------------------------

function clone(s: RatchetState): RatchetState {
	return {
		dhs: { pub: s.dhs.pub.slice(), sec: s.dhs.sec.slice() },
		dhr: s.dhr ? s.dhr.slice() : null,
		rk: s.rk.slice(),
		cks: s.cks ? s.cks.slice() : null,
		ckr: s.ckr ? s.ckr.slice() : null,
		ns: s.ns,
		nr: s.nr,
		pn: s.pn,
		skipped: new Map([...s.skipped].map(([k, v]) => [k, v.slice()])),
		ad: s.ad
	};
}

export async function ratchetEncrypt(
	state: RatchetState,
	plaintext: Uint8Array
): Promise<{ state: RatchetState; message: Uint8Array }> {
	const s = clone(state);
	if (!s.cks) throw new Error('no sending chain');
	const [ck, mk] = kdfCk(s.cks);
	s.cks = ck;
	const header: Header = { dh: s.dhs.pub, pn: s.pn, n: s.ns };
	s.ns += 1;
	const hdr = encodeHeader(header);
	const [key, iv] = messageKeyAndIv(mk);
	const ct = await aesGcmEncrypt(key, iv, plaintext, concat(s.ad, hdr));
	return { state: s, message: concat(hdr, ct) };
}

export async function ratchetDecrypt(
	state: RatchetState,
	message: Uint8Array
): Promise<{ state: RatchetState; plaintext: Uint8Array }> {
	const s = clone(state);
	const header = decodeHeader(message);
	const hdr = message.slice(0, HEADER_LEN);
	const ct = message.slice(HEADER_LEN);
	const aad = concat(s.ad, hdr);

	// 1. Skipped message key?
	const skippedKey = `${b64uEncode(header.dh)}:${header.n}`;
	const mkSkipped = s.skipped.get(skippedKey);
	if (mkSkipped) {
		s.skipped.delete(skippedKey);
		const [key, iv] = messageKeyAndIv(mkSkipped);
		return { state: s, plaintext: await aesGcmDecrypt(key, iv, ct, aad) };
	}

	// 2. New ratchet key → DH ratchet step.
	if (!s.dhr || !equalBytes(header.dh, s.dhr)) {
		skipMessageKeys(s, header.pn);
		dhRatchet(s, header);
	}

	// 3. Symmetric ratchet.
	skipMessageKeys(s, header.n);
	if (!s.ckr) throw new AuthError();
	const [ck, mk] = kdfCk(s.ckr);
	s.ckr = ck;
	s.nr += 1;
	const [key, iv] = messageKeyAndIv(mk);
	const plaintext = await aesGcmDecrypt(key, iv, ct, aad); // throws AuthError → state discarded
	return { state: s, plaintext };
}

function skipMessageKeys(s: RatchetState, until: number): void {
	if (s.nr + MAX_SKIP < until) throw new Error('too many skipped messages');
	if (!s.ckr || !s.dhr) return;
	const dhKey = b64uEncode(s.dhr);
	while (s.nr < until) {
		const [ck, mk] = kdfCk(s.ckr);
		s.ckr = ck;
		s.skipped.set(`${dhKey}:${s.nr}`, mk);
		s.nr += 1;
	}
	// Bound memory: drop the oldest entries beyond the limit.
	while (s.skipped.size > MAX_SKIP) {
		const oldest = s.skipped.keys().next().value as string;
		s.skipped.delete(oldest);
	}
}

function dhRatchet(s: RatchetState, header: Header): void {
	s.pn = s.ns;
	s.ns = 0;
	s.nr = 0;
	s.dhr = header.dh;
	[s.rk, s.ckr] = kdfRk(s.rk, dh(s.dhs, s.dhr));
	s.dhs = generateDh();
	[s.rk, s.cks] = kdfRk(s.rk, dh(s.dhs, s.dhr));
}

// --- Serialisation (for the encrypted vault) -------------------------------------------------------

export interface RatchetStateJson {
	v: 1;
	dhsPub: string;
	dhsSec: string;
	dhr: string | null;
	rk: string;
	cks: string | null;
	ckr: string | null;
	ns: number;
	nr: number;
	pn: number;
	skipped: [string, string][];
	ad: string;
}

export function serializeState(s: RatchetState): RatchetStateJson {
	return {
		v: 1,
		dhsPub: b64uEncode(s.dhs.pub),
		dhsSec: b64uEncode(s.dhs.sec),
		dhr: s.dhr ? b64uEncode(s.dhr) : null,
		rk: b64uEncode(s.rk),
		cks: s.cks ? b64uEncode(s.cks) : null,
		ckr: s.ckr ? b64uEncode(s.ckr) : null,
		ns: s.ns,
		nr: s.nr,
		pn: s.pn,
		skipped: [...s.skipped].map(([k, v]) => [k, b64uEncode(v)]),
		ad: b64uEncode(s.ad)
	};
}

export function deserializeState(j: RatchetStateJson): RatchetState {
	if (j.v !== 1) throw new Error('unsupported ratchet state version');
	return {
		dhs: { pub: b64uDecode(j.dhsPub), sec: b64uDecode(j.dhsSec) },
		dhr: j.dhr ? b64uDecode(j.dhr) : null,
		rk: b64uDecode(j.rk),
		cks: j.cks ? b64uDecode(j.cks) : null,
		ckr: j.ckr ? b64uDecode(j.ckr) : null,
		ns: j.ns,
		nr: j.nr,
		pn: j.pn,
		skipped: new Map(j.skipped.map(([k, v]) => [k, b64uDecode(v)])),
		ad: b64uDecode(j.ad)
	};
}

// Contact handshake, exchanged as two QR codes / text envelopes (no server):
//
//   A (initiator)  ── offer  ──▶  B (responder)
//   A              ◀── answer ──  B
//
// Shared secret = HKDF( DH(idA,idB) ‖ DH(ephA,idB) ‖ DH(idA,ephB) ‖ DH(ephA,ephB) ‖ ML-KEM-768 ss )
// — the PQXDH pattern: classical X25519 plus a post-quantum KEM, both must break.
// Both messages are signed with the sender's Ed25519 identity key. The answer additionally
// commits to the hash of the offer it responds to.

import { x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { concat, equalBytes, packLp, readLp, readU64be, u64be, utf8, wipe } from './bytes';
import {
	BUNDLE_LEN,
	KEM_PUB_LEN,
	SIG_LEN,
	X_PUB_LEN,
	bundleOf,
	contactId,
	decodeBundle,
	encodeBundle,
	sign,
	verify,
	type Identity,
	type KeyPair,
	type PublicBundle
} from './identity';
import { initAlice, initBob, type RatchetState } from './ratchet';

const VERSION = 1;
const KEM_CT_LEN = 1088;
const MAX_NAME_BYTES = 48;
const TAG_OFFER = utf8.encode('AES256CHAT-offer-v1');
const TAG_ANSWER = utf8.encode('AES256CHAT-answer-v1');
const INFO_SK = utf8.encode('AES256CHAT-PQXDH-v1');

export interface Contact {
	id: string;
	name: string;
	bundle: PublicBundle;
}

export interface PendingOffer {
	eph: KeyPair;
	offer: Uint8Array;
}

export class HandshakeError extends Error {
	constructor(msg: string) {
		super(msg);
		this.name = 'HandshakeError';
	}
}

function ephemeral(): KeyPair {
	const sec = x25519.utils.randomSecretKey();
	return { pub: x25519.getPublicKey(sec), sec };
}

function encodeName(name: string): Uint8Array {
	const b = utf8.encode(name.trim());
	if (b.length === 0 || b.length > MAX_NAME_BYTES) throw new HandshakeError('invalid name');
	return b;
}

export function offerHash(offer: Uint8Array): Uint8Array {
	return sha256(offer);
}

// --- Offer -----------------------------------------------------------------------------------------
// layout: v(1) ‖ bundle(64) ‖ kemPub(1184) ‖ eph(32) ‖ ts(8, ms since epoch) ‖ lp(name) ‖ sig(64)

export function createOffer(me: Identity, myName: string): PendingOffer {
	const eph = ephemeral();
	const body = concat(
		new Uint8Array([VERSION]),
		encodeBundle(bundleOf(me)),
		me.kem.pub,
		eph.pub,
		u64be(Date.now()),
		packLp(encodeName(myName))
	);
	const sig = sign(me, concat(TAG_OFFER, body));
	return { eph, offer: concat(body, sig) };
}

interface ParsedOffer {
	bundle: PublicBundle;
	kemPub: Uint8Array;
	eph: Uint8Array;
	ts: number;
	name: string;
}

function parseOffer(offer: Uint8Array): ParsedOffer {
	const minLen = 1 + BUNDLE_LEN + KEM_PUB_LEN + X_PUB_LEN + 8 + 2 + SIG_LEN;
	if (offer.length < minLen) throw new HandshakeError('offer too short');
	if (offer[0] !== VERSION) throw new HandshakeError('unsupported offer version');
	let off = 1;
	const bundle = decodeBundle(offer.slice(off, off + BUNDLE_LEN));
	off += BUNDLE_LEN;
	const kemPub = offer.slice(off, off + KEM_PUB_LEN);
	off += KEM_PUB_LEN;
	const eph = offer.slice(off, off + X_PUB_LEN);
	off += X_PUB_LEN;
	const ts = readU64be(offer, off);
	off += 8;
	const { value: nameBytes, next } = readLp(offer, off);
	const sig = offer.slice(next);
	if (sig.length !== SIG_LEN) throw new HandshakeError('malformed offer');
	if (!verify(bundle.ed, concat(TAG_OFFER, offer.slice(0, next)), sig)) throw new HandshakeError('bad offer signature');
	return { bundle, kemPub, eph, ts, name: utf8.decode(nameBytes) };
}

/** Read-only peek so the UI can show "Add <name>?" before committing. */
export function peekOffer(offer: Uint8Array): Contact {
	const p = parseOffer(offer);
	return { id: contactId(p.bundle), name: p.name, bundle: p.bundle };
}

// --- Answer ----------------------------------------------------------------------------------------
// layout: v(1) ‖ bundle(64) ‖ eph(32) ‖ kemCt(1088) ‖ offerHash(32) ‖ lp(name) ‖ sig(64)

const ANSWER_HASH_OFFSET = 1 + BUNDLE_LEN + X_PUB_LEN + KEM_CT_LEN;
const ANSWER_MIN_LEN = ANSWER_HASH_OFFSET + 32 + 2 + SIG_LEN;

/** Which offer does this answer belong to? Lets the UI look up the pending offer before verifying. */
export function answerOfferHash(answer: Uint8Array): Uint8Array {
	if (answer.length < ANSWER_MIN_LEN) throw new HandshakeError('answer too short');
	return answer.slice(ANSWER_HASH_OFFSET, ANSWER_HASH_OFFSET + 32);
}

export function acceptOffer(
	me: Identity,
	myName: string,
	offer: Uint8Array,
	maxAgeMs = Number.POSITIVE_INFINITY
): { answer: Uint8Array; session: RatchetState; contact: Contact } {
	const o = parseOffer(offer);
	// Stale codes are refused: the initiator has long discarded the ephemeral secret.
	if (Date.now() - o.ts > maxAgeMs || o.ts - Date.now() > 86_400_000) throw new HandshakeError('offer expired');
	const myBundle = bundleOf(me);
	if (equalBytes(encodeBundle(o.bundle), encodeBundle(myBundle))) throw new HandshakeError('cannot add yourself');

	const eph = ephemeral();
	const { cipherText, sharedSecret: kemSs } = ml_kem768.encapsulate(o.kemPub);

	// Bob's view (me = B): dh1 = DH(idA,idB), dh2 = DH(ephA,idB), dh3 = DH(idA,ephB), dh4 = DH(ephA,ephB)
	const dh1 = x25519.getSharedSecret(me.x.sec, o.bundle.x);
	const dh2 = x25519.getSharedSecret(me.x.sec, o.eph);
	const dh3 = x25519.getSharedSecret(eph.sec, o.bundle.x);
	const dh4 = x25519.getSharedSecret(eph.sec, o.eph);
	const { sk, bobChain } = deriveSecrets(dh1, dh2, dh3, dh4, kemSs);
	wipe(dh1, dh2, dh3, dh4, kemSs);

	const body = concat(
		new Uint8Array([VERSION]),
		encodeBundle(myBundle),
		eph.pub,
		cipherText,
		offerHash(offer),
		packLp(encodeName(myName))
	);
	const sig = sign(me, concat(TAG_ANSWER, body));
	const ad = sessionAd(o.bundle, myBundle);
	const session = initBob(sk, bobChain, eph, ad);
	return {
		answer: concat(body, sig),
		session,
		contact: { id: contactId(o.bundle), name: o.name, bundle: o.bundle }
	};
}

export function finalizeOffer(
	me: Identity,
	pending: PendingOffer,
	answer: Uint8Array
): { session: RatchetState; contact: Contact } {
	if (answer.length < ANSWER_MIN_LEN) throw new HandshakeError('answer too short');
	if (answer[0] !== VERSION) throw new HandshakeError('unsupported answer version');
	let off = 1;
	const bundle = decodeBundle(answer.slice(off, off + BUNDLE_LEN));
	off += BUNDLE_LEN;
	const ephB = answer.slice(off, off + X_PUB_LEN);
	off += X_PUB_LEN;
	const kemCt = answer.slice(off, off + KEM_CT_LEN);
	off += KEM_CT_LEN;
	const hash = answer.slice(off, off + 32);
	off += 32;
	const { value: nameBytes, next } = readLp(answer, off);
	const sig = answer.slice(next);
	if (sig.length !== SIG_LEN) throw new HandshakeError('malformed answer');
	if (!verify(bundle.ed, concat(TAG_ANSWER, answer.slice(0, next)), sig)) throw new HandshakeError('bad answer signature');
	if (!equalBytes(hash, offerHash(pending.offer))) throw new HandshakeError('answer does not match this offer');

	const myBundle = bundleOf(me);
	if (equalBytes(encodeBundle(bundle), encodeBundle(myBundle))) throw new HandshakeError('cannot add yourself');
	const kemSs = ml_kem768.decapsulate(kemCt, me.kem.sec);
	const dh1 = x25519.getSharedSecret(me.x.sec, bundle.x);
	const dh2 = x25519.getSharedSecret(pending.eph.sec, bundle.x);
	const dh3 = x25519.getSharedSecret(me.x.sec, ephB);
	const dh4 = x25519.getSharedSecret(pending.eph.sec, ephB);
	const { sk, bobChain } = deriveSecrets(dh1, dh2, dh3, dh4, kemSs);
	wipe(dh1, dh2, dh3, dh4, kemSs);

	const ad = sessionAd(myBundle, bundle);
	const session = initAlice(sk, bobChain, ephB, ad);
	return { session, contact: { id: contactId(bundle), name: utf8.decode(nameBytes), bundle } };
}

// --- Shared derivations --------------------------------------------------------------------------

function deriveSecrets(
	dh1: Uint8Array,
	dh2: Uint8Array,
	dh3: Uint8Array,
	dh4: Uint8Array,
	kemSs: Uint8Array
): { sk: Uint8Array; bobChain: Uint8Array } {
	// Leading 0xFF block as in X3DH, zero salt, domain-separated info.
	const ikm = concat(new Uint8Array(32).fill(0xff), dh1, dh2, dh3, dh4, kemSs);
	const out = hkdf(sha512, ikm, new Uint8Array(64), INFO_SK, 64);
	wipe(ikm);
	return { sk: out.slice(0, 32), bobChain: out.slice(32, 64) };
}

/** Associated data binding both identities (initiator first) into every message. */
function sessionAd(initiator: PublicBundle, responder: PublicBundle): Uint8Array {
	return sha256(concat(encodeBundle(initiator), encodeBundle(responder)));
}

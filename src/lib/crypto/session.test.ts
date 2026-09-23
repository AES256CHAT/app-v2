import { describe, expect, it } from 'vitest';
import { AuthError } from './aead';
import { utf8 } from './bytes';
import { HandshakeError, acceptOffer, createOffer, finalizeOffer, peekOffer } from './handshake';
import { generateIdentity } from './identity';
import {
	MAX_SKIP,
	deserializeState,
	ratchetDecrypt,
	ratchetEncrypt,
	serializeState,
	type RatchetState
} from './ratchet';

async function pair() {
	const alice = generateIdentity();
	const bob = generateIdentity();
	const pending = createOffer(alice, 'Alice');
	const accepted = acceptOffer(bob, 'Bob', pending.offer);
	const finalized = finalizeOffer(alice, pending, accepted.answer);
	return { alice, bob, a: finalized.session, b: accepted.session, accepted, finalized };
}

const enc = (s: string) => utf8.encode(s);
const dec = (b: Uint8Array) => utf8.decode(b);

async function send(from: RatchetState, to: RatchetState, text: string) {
	const e = await ratchetEncrypt(from, enc(text));
	const d = await ratchetDecrypt(to, e.message);
	expect(dec(d.plaintext)).toBe(text);
	return { from: e.state, to: d.state };
}

describe('handshake', () => {
	it('establishes matching contacts and names', async () => {
		const { alice, bob, accepted, finalized } = await pair();
		expect(accepted.contact.name).toBe('Alice');
		expect(finalized.contact.name).toBe('Bob');
		expect(accepted.contact.bundle.ed).toEqual(alice.ed.pub);
		expect(finalized.contact.bundle.ed).toEqual(bob.ed.pub);
		expect(peekOffer(createOffer(alice, 'Alice').offer).id).toBe(accepted.contact.id);
	});

	it('refuses expired offers', async () => {
		const alice = generateIdentity();
		const bob = generateIdentity();
		const pending = createOffer(alice, 'Alice');
		await new Promise((r) => setTimeout(r, 5));
		expect(() => acceptOffer(bob, 'Bob', pending.offer, 1)).toThrow(/expired/);
		expect(() => acceptOffer(bob, 'Bob', pending.offer, 60_000)).not.toThrow();
	});

	it('rejects tampered offer, self-add, and mismatched answer', async () => {
		const alice = generateIdentity();
		const bob = generateIdentity();
		const pending = createOffer(alice, 'Alice');
		const bad = pending.offer.slice();
		bad[5] ^= 1;
		expect(() => acceptOffer(bob, 'Bob', bad)).toThrow(HandshakeError);
		expect(() => acceptOffer(alice, 'Alice', pending.offer)).toThrow(HandshakeError);
		const otherPending = createOffer(alice, 'Alice');
		const answerForOther = acceptOffer(bob, 'Bob', otherPending.offer).answer;
		expect(() => finalizeOffer(alice, pending, answerForOther)).toThrow(/does not match/);
	});
});

describe('double ratchet', () => {
	it('alice sends first, then ping-pong', async () => {
		let { a, b } = await pair();
		({ from: a, to: b } = await send(a, b, 'hi bob'));
		({ from: b, to: a } = await send(b, a, 'hi alice'));
		({ from: a, to: b } = await send(a, b, 'again'));
		({ from: b, to: a } = await send(b, a, 'and again'));
	});

	it('bob may send first (no server, no fixed initiator)', async () => {
		let { a, b } = await pair();
		({ from: b, to: a } = await send(b, a, 'bob first'));
		({ from: b, to: a } = await send(b, a, 'bob second'));
		({ from: a, to: b } = await send(a, b, 'alice replies'));
		({ from: b, to: a } = await send(b, a, 'bob after ratchet'));
	});

	it('both send before either receives (concurrent start)', async () => {
		let { a, b } = await pair();
		const ea = await ratchetEncrypt(a, enc('from alice'));
		const eb = await ratchetEncrypt(b, enc('from bob'));
		a = ea.state;
		b = eb.state;
		const da = await ratchetDecrypt(a, eb.message);
		const db = await ratchetDecrypt(b, ea.message);
		expect(dec(da.plaintext)).toBe('from bob');
		expect(dec(db.plaintext)).toBe('from alice');
		a = da.state;
		b = db.state;
		({ from: a, to: b } = await send(a, b, 'settled'));
		({ from: b, to: a } = await send(b, a, 'yes'));
	});

	it('out-of-order and lost messages via skipped keys', async () => {
		let { a, b } = await pair();
		const m1 = await ratchetEncrypt(a, enc('1'));
		const m2 = await ratchetEncrypt(m1.state, enc('2'));
		const m3 = await ratchetEncrypt(m2.state, enc('3'));
		a = m3.state;
		let r = await ratchetDecrypt(b, m3.message);
		expect(dec(r.plaintext)).toBe('3');
		r = await ratchetDecrypt(r.state, m1.message);
		expect(dec(r.plaintext)).toBe('1');
		b = r.state;
		// reply, then late arrival of m2 from the previous chain
		({ from: b, to: a } = await send(b, a, 'reply'));
		r = await ratchetDecrypt(b, m2.message);
		expect(dec(r.plaintext)).toBe('2');
		// replay must fail
		await expect(ratchetDecrypt(r.state, m2.message)).rejects.toThrow();
	});

	it('refuses to skip more than MAX_SKIP', async () => {
		let { a, b } = await pair();
		for (let i = 0; i <= MAX_SKIP; i++) a = (await ratchetEncrypt(a, enc('x'))).state;
		const far = await ratchetEncrypt(a, enc('too far'));
		await expect(ratchetDecrypt(b, far.message)).rejects.toThrow(/skipped/);
	});

	it('rejects tampered ciphertext and foreign sessions without mutating state', async () => {
		const { a, b } = await pair();
		const other = await pair();
		const e = await ratchetEncrypt(a, enc('secret'));
		const tampered = e.message.slice();
		tampered[tampered.length - 1] ^= 1;
		await expect(ratchetDecrypt(b, tampered)).rejects.toThrow(AuthError);
		await expect(ratchetDecrypt(other.b, e.message)).rejects.toThrow(AuthError);
		// b is untouched: original still decrypts
		expect(dec((await ratchetDecrypt(b, e.message)).plaintext)).toBe('secret');
	});

	it('state survives serialisation', async () => {
		let { a, b } = await pair();
		({ from: a, to: b } = await send(a, b, 'one'));
		const m = await ratchetEncrypt(a, enc('skip me'));
		a = m.state;
		({ from: a, to: b } = await send(a, b, 'three'));
		const bRestored = deserializeState(JSON.parse(JSON.stringify(serializeState(b))));
		const aRestored = deserializeState(JSON.parse(JSON.stringify(serializeState(a))));
		expect(dec((await ratchetDecrypt(bRestored, m.message)).plaintext)).toBe('skip me');
		await send(bRestored, aRestored, 'after restore');
	});
});

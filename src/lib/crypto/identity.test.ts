import { describe, expect, it } from 'vitest';
import { utf8 } from './bytes';
import {
	BUNDLE_LEN,
	bundleOf,
	contactId,
	decodeBundle,
	encodeBundle,
	formatId,
	formatSafetyNumber,
	generateIdentity,
	identityFromSecrets,
	safetyNumber,
	sign,
	verify
} from './identity';

describe('identity', () => {
	it('generates a complete key set and round-trips the bundle', () => {
		const id = generateIdentity();
		const b = bundleOf(id);
		const enc = encodeBundle(b);
		expect(enc.length).toBe(BUNDLE_LEN);
		const dec = decodeBundle(enc);
		expect(encodeBundle(dec)).toEqual(enc);
	});

	it('restores the same identity from secrets', () => {
		const id = generateIdentity();
		const again = identityFromSecrets(id.ed.sec, id.x.sec, id.kemSeed, id.createdAt);
		expect(encodeBundle(bundleOf(again))).toEqual(encodeBundle(bundleOf(id)));
		expect(again.kem.sec).toEqual(id.kem.sec);
	});

	it('derives a stable 16-char ID and formats it in groups', () => {
		const id = generateIdentity();
		const cid = contactId(bundleOf(id));
		expect(cid).toMatch(/^[A-Z0-9]{16}$/);
		expect(cid).toBe(contactId(bundleOf(id)));
		expect(formatId(cid)).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
		expect(contactId(bundleOf(generateIdentity()))).not.toBe(cid);
	});

	it('safety number is 60 digits and order independent', () => {
		const a = bundleOf(generateIdentity());
		const b = bundleOf(generateIdentity());
		const sn = safetyNumber(a, b);
		expect(sn).toMatch(/^\d{60}$/);
		expect(safetyNumber(b, a)).toBe(sn);
		expect(formatSafetyNumber(sn).split(' ')).toHaveLength(12);
		expect(safetyNumber(a, bundleOf(generateIdentity()))).not.toBe(sn);
	});

	it('signs and verifies, rejects tampering', () => {
		const id = generateIdentity();
		const msg = utf8.encode('hello');
		const sig = sign(id, msg);
		expect(verify(id.ed.pub, msg, sig)).toBe(true);
		expect(verify(id.ed.pub, utf8.encode('hellO'), sig)).toBe(false);
		sig[0] ^= 1;
		expect(verify(id.ed.pub, msg, sig)).toBe(false);
	});
});

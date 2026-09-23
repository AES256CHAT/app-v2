import { describe, expect, it } from 'vitest';
import { randomBytes } from './bytes';
import { PartAssembler, encodeEnvelope, parseEnvelope } from './envelope';

describe('envelope', () => {
	it('single part round-trip, tolerates surrounding text', () => {
		const payload = randomBytes(100);
		const [text] = encodeEnvelope('msg', payload);
		expect(text.startsWith('🛡️MSG:')).toBe(true);
		const p = parseEnvelope(`Hey, hier: ${text} \nLG`);
		expect(p.type).toBe('complete');
		if (p.type === 'complete') {
			expect(p.kind).toBe('msg');
			expect(p.payload).toEqual(payload);
		}
	});

	it('splits large payloads and reassembles in any order', () => {
		const payload = randomBytes(9000);
		const parts = encodeEnvelope('offer', payload, 1000);
		expect(parts.length).toBe(Math.ceil(Math.ceil(9000 / 3) * 4 / 1000));
		for (const p of parts) expect(p.length).toBeLessThanOrEqual(1000 + 30);
		const asm = new PartAssembler();
		const shuffled = [...parts].sort(() => Math.random() - 0.5);
		let result = null;
		for (const t of shuffled) {
			const parsed = parseEnvelope(t);
			expect(parsed.type).toBe('part');
			if (parsed.type === 'part') result = asm.add(parsed) ?? result;
		}
		expect(result?.kind).toBe('offer');
		expect(result?.payload).toEqual(payload);
	});

	it('reports progress and prunes stale groups', () => {
		const parts = encodeEnvelope('msg', randomBytes(3000), 1000);
		const asm = new PartAssembler();
		const first = parseEnvelope(parts[0]);
		if (first.type !== 'part') throw new Error();
		asm.add(first, 1000);
		expect(asm.progress(first.gid)).toEqual({ have: 1, total: parts.length });
		asm.prune(500, 2000);
		expect(asm.progress(first.gid)).toBeNull();
	});

	it('recognises legacy markers and rejects garbage', () => {
		expect(parseEnvelope('🛡️QR-ENC:abc=').type).toBe('legacy');
		expect(parseEnvelope('🔐FILE:abc=')).toMatchObject({ type: 'legacy', format: 'file' });
		expect(parseEnvelope('nothing here').type).toBe('none');
		expect(parseEnvelope('🛡️MSG:not-base64!!').type).toBe('none');
	});
});

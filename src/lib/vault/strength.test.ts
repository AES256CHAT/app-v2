import { describe, expect, it } from 'vitest';
import { WORDS, estimate, suggestPassphrase } from './strength';

describe('passphrase strength', () => {
	it('rejects short, common and patterned passphrases', () => {
		expect(estimate('kurz').score).toBe(0);
		expect(estimate('passwort1234').score).toBe(0);
		expect(estimate('aaaaaaaaaaaa').score).toBeLessThanOrEqual(1);
		expect(estimate('123456789012').score).toBeLessThanOrEqual(1);
		expect(estimate('qwertzuiopas').hints).toContain('sequence');
	});

	it('rates word passphrases and long mixed strings well', () => {
		expect(estimate('ampel gurke stiefel wolke nadel zopf').score).toBeGreaterThanOrEqual(3);
		expect(estimate('Tr0ub4dor&3-xkcd!!').score).toBeGreaterThanOrEqual(2);
		expect(estimate('zehn zeichen mindestens').score).toBeGreaterThanOrEqual(1);
	});

	it('suggests six distinct-looking words from the list', () => {
		const s = suggestPassphrase();
		const parts = s.split(' ');
		expect(parts).toHaveLength(6);
		for (const w of parts) expect(WORDS).toContain(w);
		expect(estimate(s).score).toBeGreaterThanOrEqual(3);
		expect(new Set(WORDS).size).toBeGreaterThanOrEqual(500);
	});
});

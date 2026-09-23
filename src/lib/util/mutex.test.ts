import { describe, expect, it } from 'vitest';
import { KeyedMutex, Mutex } from './mutex';

describe('mutex', () => {
	it('serialises overlapping critical sections', async () => {
		const m = new Mutex();
		const log: string[] = [];
		const job = (name: string, ms: number) =>
			m.run(async () => {
				log.push(name + ':in');
				await new Promise((r) => setTimeout(r, ms));
				log.push(name + ':out');
			});
		await Promise.all([job('a', 20), job('b', 1), job('c', 1)]);
		expect(log).toEqual(['a:in', 'a:out', 'b:in', 'b:out', 'c:in', 'c:out']);
	});

	it('releases the lock when the section throws', async () => {
		const m = new Mutex();
		await expect(m.run(async () => { throw new Error('x'); })).rejects.toThrow('x');
		expect(await m.run(async () => 42)).toBe(42);
	});

	it('keys are independent', async () => {
		const km = new KeyedMutex();
		const log: string[] = [];
		await Promise.all([
			km.run('a', async () => { await new Promise((r) => setTimeout(r, 15)); log.push('a'); }),
			km.run('b', async () => { log.push('b'); })
		]);
		expect(log).toEqual(['b', 'a']);
	});
});

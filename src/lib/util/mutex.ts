// Minimal async mutex: serialises critical sections (e.g. read → ratchet → write of a session).

export class Mutex {
	private tail: Promise<void> = Promise.resolve();

	run<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this.tail;
		let release!: () => void;
		this.tail = new Promise<void>((res) => (release = res));
		return prev.then(fn).finally(release);
	}
}

/** One mutex per key, created on demand. */
export class KeyedMutex {
	private locks = new Map<string, Mutex>();

	run<T>(key: string, fn: () => Promise<T>): Promise<T> {
		let m = this.locks.get(key);
		if (!m) {
			m = new Mutex();
			this.locks.set(key, m);
		}
		return m.run(fn);
	}
}

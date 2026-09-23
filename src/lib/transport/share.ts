// Getting envelopes out of the device: share sheet or clipboard (with auto-clear).

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export async function copyText(text: string, clearAfterMs = 60_000): Promise<void> {
	await navigator.clipboard.writeText(text);
	if (clearTimer) clearTimeout(clearTimer);
	if (clearAfterMs > 0) {
		clearTimer = setTimeout(async () => {
			try {
				// Only clear if the clipboard still holds our text.
				const cur = await navigator.clipboard.readText().catch(() => null);
				if (cur === null || cur === text) await navigator.clipboard.writeText('');
			} catch {
				/* ignore */
			}
		}, clearAfterMs);
	}
}

export function canShare(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareText(text: string): Promise<boolean> {
	if (!canShare()) return false;
	try {
		await navigator.share({ text });
		return true;
	} catch (e) {
		if ((e as Error).name === 'AbortError') return false;
		throw e;
	}
}

// Getting envelopes out of the device: share sheet, clipboard (with auto-clear), or download.
// On Capacitor the native plugins are used; in browsers the Web APIs.

import { isNative, nativeReadClipboard, nativeShareFile, nativeShareText, nativeWriteClipboard } from '$lib/native/platform';

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export async function copyText(text: string, clearAfterMs = 60_000): Promise<void> {
	if (isNative()) await nativeWriteClipboard(text);
	else await navigator.clipboard.writeText(text);
	if (clearTimer) clearTimeout(clearTimer);
	if (clearAfterMs > 0) {
		clearTimer = setTimeout(async () => {
			try {
				// Only clear if the clipboard still holds our text.
				const cur = isNative() ? await nativeReadClipboard() : await navigator.clipboard.readText().catch(() => null);
				if (cur === text) {
					if (isNative()) await nativeWriteClipboard('');
					else await navigator.clipboard.writeText('');
				}
			} catch {
				/* ignore */
			}
		}, clearAfterMs);
	}
}

export async function readClipboardText(): Promise<string | null> {
	if (isNative()) return nativeReadClipboard();
	try {
		return await navigator.clipboard.readText();
	} catch {
		return null;
	}
}

export function canShare(): boolean {
	return isNative() || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');
}

export async function shareText(text: string): Promise<boolean> {
	if (isNative()) return nativeShareText(text);
	if (!canShare()) return false;
	try {
		await navigator.share({ text });
		return true;
	} catch (e) {
		if ((e as Error).name === 'AbortError') return false;
		throw e;
	}
}

export function canShareFiles(file: File): boolean {
	return canShare() && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

/** Share sheet when the platform can share files, otherwise a plain download. Returns how it went out. */
export async function shareOrDownload(bytes: Uint8Array, name: string, mime: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
	if (isNative()) return (await nativeShareFile(bytes, name)) ? 'shared' : 'cancelled';
	const file = new File([bytes as BlobPart], name, { type: mime });
	if (canShareFiles(file)) {
		try {
			await navigator.share({ files: [file] });
			return 'shared';
		} catch (e) {
			if ((e as Error).name === 'AbortError') return 'cancelled';
		}
	}
	download(file, name);
	return 'downloaded';
}

/** Share a PNG (or any blob) through the share sheet, else download it. */
export async function shareOrDownloadBlob(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	return shareOrDownload(bytes, name, blob.type || 'application/octet-stream');
}

export function download(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.rel = 'noopener';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

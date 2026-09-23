// Thin platform layer: same call sites for web, PWA and Capacitor (Android/iOS).

import { Capacitor } from '@capacitor/core';
import { b64Encode } from '$lib/crypto/bytes';

export function isNative(): boolean {
	return Capacitor.isNativePlatform();
}

export async function nativeShareText(text: string): Promise<boolean> {
	const { Share } = await import('@capacitor/share');
	try {
		await Share.share({ text });
		return true;
	} catch {
		return false; // dismissed
	}
}

/** Write to the app cache and hand the file to the share sheet. */
export async function nativeShareFile(bytes: Uint8Array, name: string): Promise<boolean> {
	const { Filesystem, Directory } = await import('@capacitor/filesystem');
	const { Share } = await import('@capacitor/share');
	const { uri } = await Filesystem.writeFile({ path: `share/${name}`, data: b64Encode(bytes), directory: Directory.Cache, recursive: true });
	try {
		await Share.share({ files: [uri] });
		return true;
	} catch {
		return false;
	} finally {
		// Best effort: the encrypted file has no value once shared.
		setTimeout(() => Filesystem.deleteFile({ path: `share/${name}`, directory: Directory.Cache }).catch(() => {}), 60_000);
	}
}

export async function nativeWriteClipboard(text: string): Promise<void> {
	const { Clipboard } = await import('@capacitor/clipboard');
	await Clipboard.write({ string: text });
}

export async function nativeReadClipboard(): Promise<string | null> {
	const { Clipboard } = await import('@capacitor/clipboard');
	try {
		const r = await Clipboard.read();
		return r.type?.startsWith('text') ? r.value : null;
	} catch {
		return null;
	}
}

/** "Open with" / deep links: an .aes256 file or a shared envelope URL arrives here. */
export async function registerNativeHandlers(onFile: (bytes: Uint8Array, name: string) => void, onText: (text: string) => void): Promise<void> {
	if (!isNative()) return;
	const { App } = await import('@capacitor/app');
	const { Filesystem, Directory } = await import('@capacitor/filesystem');
	// Leftover encrypted share files from a previous run (app killed before the delayed delete).
	Filesystem.rmdir({ path: 'share', directory: Directory.Cache, recursive: true }).catch(() => {});
	App.addListener('appUrlOpen', async ({ url }) => {
		try {
			// content:// only — file:// would let another app point us at our own private files.
			if (url.startsWith('content://')) {
				const r = await Filesystem.readFile({ path: url });
				const data = typeof r.data === 'string' ? Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)) : new Uint8Array(await r.data.arrayBuffer());
				onFile(data, url.split('/').pop() ?? 'file.aes256');
			} else {
				const u = new URL(url);
				const text = u.searchParams.get('text');
				if (text) onText(text);
			}
		} catch {
			/* unreadable intent payload */
		}
	});
}

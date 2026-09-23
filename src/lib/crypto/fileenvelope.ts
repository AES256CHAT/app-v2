// Binary envelope for attachments: an `.aes256` file = MAGIC ‖ ratchet message.
// Text envelopes cannot carry megabytes through chat apps; files travel as files.

import { concat, equalBytes, utf8 } from './bytes';

export const FILE_MAGIC = utf8.encode('A256CHAT-F1\n');
export const FILE_EXT = '.aes256';
export const FILE_MIME = 'application/vnd.aes256chat';

export function wrapFileEnvelope(ratchetMessage: Uint8Array): Uint8Array {
	return concat(FILE_MAGIC, ratchetMessage);
}

export function isFileEnvelope(bytes: Uint8Array): boolean {
	return bytes.length > FILE_MAGIC.length && equalBytes(bytes.slice(0, FILE_MAGIC.length), FILE_MAGIC);
}

export function unwrapFileEnvelope(bytes: Uint8Array): Uint8Array {
	if (!isFileEnvelope(bytes)) throw new Error('not an aes256chat file');
	return bytes.slice(FILE_MAGIC.length);
}

export function envelopeFileName(ts = Date.now()): string {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `aes256chat-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${FILE_EXT}`;
}

// Plaintext body carried inside a ratchet message. Binary framing so attachments avoid
// base64 bloat:  type(1) ‖ u16 metaLen ‖ metaJSON ‖ rawData
//
//   type 1 = text  (meta: {body, ts}, no data)
//   type 2 = file  (meta: {name, mime, size, ts}, data = file bytes)

import { concat, utf8 } from './bytes';

export type PlainText = { t: 'text'; body: string; ts: number };
export type PlainFile = { t: 'file'; name: string; mime: string; size: number; ts: number; data: Uint8Array };
export type Plain = PlainText | PlainFile;

export const MAX_TEXT_CHARS = 20_000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_NAME_CHARS = 120;

function frame(type: number, meta: object, data: Uint8Array = new Uint8Array(0)): Uint8Array {
	const m = utf8.encode(JSON.stringify(meta));
	if (m.length > 0xffff) throw new Error('metadata too large');
	return concat(new Uint8Array([type, m.length >>> 8, m.length & 0xff]), m, data);
}

export function encodePlain(p: Plain): Uint8Array {
	if (p.t === 'text') {
		if (p.body.length > MAX_TEXT_CHARS) throw new Error('message too long');
		return frame(1, { body: p.body, ts: p.ts });
	}
	if (p.data.length > MAX_FILE_BYTES) throw new Error('file too large');
	return frame(2, { name: p.name.slice(0, MAX_NAME_CHARS), mime: p.mime, size: p.data.length, ts: p.ts }, p.data);
}

export function decodePlain(bytes: Uint8Array): Plain {
	if (bytes.length < 3) throw new Error('bad message body');
	const type = bytes[0];
	const len = (bytes[1] << 8) | bytes[2];
	if (3 + len > bytes.length) throw new Error('bad message body');
	const meta = JSON.parse(utf8.decode(bytes.slice(3, 3 + len))) as Record<string, unknown>;
	const data = bytes.slice(3 + len);
	if (type === 1) {
		if (typeof meta.body !== 'string' || typeof meta.ts !== 'number') throw new Error('bad text body');
		return { t: 'text', body: meta.body.slice(0, MAX_TEXT_CHARS), ts: meta.ts };
	}
	if (type === 2) {
		if (typeof meta.name !== 'string' || typeof meta.ts !== 'number') throw new Error('bad file body');
		if (data.length > MAX_FILE_BYTES) throw new Error('file too large');
		return {
			t: 'file',
			name: sanitizeName(meta.name),
			mime: typeof meta.mime === 'string' ? meta.mime : 'application/octet-stream',
			size: data.length,
			ts: meta.ts,
			data
		};
	}
	throw new Error('unknown body type');
}

/** Strip path separators and control characters from a received file name. */
export function sanitizeName(name: string): string {
	const cleaned = name
		.replace(/[\\/]/g, '_')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.trim()
		.slice(0, MAX_NAME_CHARS);
	return cleaned || 'file';
}

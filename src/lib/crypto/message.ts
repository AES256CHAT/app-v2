// Plaintext body carried inside a ratchet message. Binary framing so attachments avoid
// base64 bloat:  type(1) ‖ u16 metaLen ‖ metaJSON ‖ rawData
//
//   type 1 = text  (meta: {body, ts}, no data)
//   type 2 = file  (meta: {name, mime, size, ts}, data = file bytes)
//   type 3 = conn  (meta: {role, ts}, data = WebRTC session description JSON) — live signalling

import { concat, utf8 } from './bytes';

export type PlainText = { t: 'text'; body: string; ts: number };
export type PlainFile = { t: 'file'; name: string; mime: string; size: number; ts: number; data: Uint8Array };
export type PlainConn = { t: 'conn'; role: 'offer' | 'answer'; sdp: string; ts: number };
export type Plain = PlainText | PlainFile | PlainConn;

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
	if (p.t === 'conn') return frame(3, { role: p.role, ts: p.ts }, utf8.encode(p.sdp));
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
			mime: safeMime(meta.mime),
			size: data.length,
			ts: meta.ts,
			data
		};
	}
	if (type === 3) {
		if ((meta.role !== 'offer' && meta.role !== 'answer') || typeof meta.ts !== 'number') throw new Error('bad conn body');
		if (data.length > 64 * 1024) throw new Error('conn body too large');
		return { t: 'conn', role: meta.role, sdp: utf8.decode(data), ts: meta.ts };
	}
	throw new Error('unknown body type');
}

/** Strip path separators and control characters from a received file name. */
export function sanitizeName(name: string): string {
	const cleaned = name
		.replace(/[\\/]/g, '_')
		// control chars and Unicode bidi/format controls (RTL-override spoofing like "rechnung\u202Efdp.apk")
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
		.replace(/^\.+/, '')
		.trim()
		.slice(0, MAX_NAME_CHARS);
	return cleaned || 'file';
}

const MIME_ALLOW = /^(image\/(jpeg|png|webp|gif|avif|bmp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|ogg|wav|mp4|aac|webm)|application\/(pdf|zip|json|gzip|x-7z-compressed)|text\/(plain|csv|markdown))$/i;

/** Sender-supplied MIME types are only honoured from an allowlist; anything else is opaque. */
export function safeMime(mime: unknown): string {
	return typeof mime === 'string' && MIME_ALLOW.test(mime) ? mime.toLowerCase() : 'application/octet-stream';
}

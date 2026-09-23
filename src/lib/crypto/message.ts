// Plaintext body carried inside a ratchet message. Small JSON; binary attachments come in phase 4.

import { utf8 } from './bytes';

export type Plain = { t: 'text'; body: string; ts: number };

export const MAX_TEXT_CHARS = 20_000;

export function encodePlain(p: Plain): Uint8Array {
	if (p.body.length > MAX_TEXT_CHARS) throw new Error('message too long');
	return utf8.encode(JSON.stringify(p));
}

export function decodePlain(bytes: Uint8Array): Plain {
	const j = JSON.parse(utf8.decode(bytes)) as Partial<Plain>;
	if (j.t !== 'text' || typeof j.body !== 'string' || typeof j.ts !== 'number') throw new Error('bad message body');
	return { t: 'text', body: j.body.slice(0, MAX_TEXT_CHARS), ts: j.ts };
}

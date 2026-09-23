// Text envelopes: the only thing that ever leaves the device. Base64url payload behind an
// emoji marker so it survives any chat app, plus splitting for Telegram's 4096-char limit.
//
//   🛡️MSG:<b64u>                       single-part
//   🛡️MSG:<gid>.<i>.<n>:<b64u>         part i of n, gid = 6 random b64u chars
//
// Legacy password-mode markers (🛡️QR-ENC:, 🔐QR:, 🔒ENC:, 🔐FILE:) are recognised but handled
// by legacy.ts.

import { b64uDecode, b64uEncode, randomBytes } from './bytes';

export type EnvelopeKind = 'msg' | 'offer' | 'answer' | 'conn' | 'file';

export const PREFIX: Record<EnvelopeKind, string> = {
	msg: '🛡️MSG:',
	offer: '🛡️ID:',
	answer: '🛡️OK:',
	conn: '🛡️CONN:',
	file: '🛡️FILE:'
};

export const LEGACY_PREFIX = {
	military: '🛡️QR-ENC:',
	quantum: '🔐QR:',
	old: '🔒ENC:',
	file: '🔐FILE:'
} as const;

/** Telegram hard limit is 4096 chars per message; leave headroom for the marker. */
export const DEFAULT_PART_CHARS = 3800;

export type Parsed =
	| { type: 'complete'; kind: EnvelopeKind; payload: Uint8Array }
	| { type: 'part'; kind: EnvelopeKind; gid: string; index: number; total: number; data: string }
	| { type: 'legacy'; format: keyof typeof LEGACY_PREFIX; text: string }
	| { type: 'none' };

export function encodeEnvelope(kind: EnvelopeKind, payload: Uint8Array, partChars = DEFAULT_PART_CHARS): string[] {
	const data = b64uEncode(payload);
	const prefix = PREFIX[kind];
	if (data.length <= partChars) return [prefix + data];
	const gid = b64uEncode(randomBytes(6)).slice(0, 6);
	const total = Math.ceil(data.length / partChars);
	const parts: string[] = [];
	for (let i = 0; i < total; i++) {
		parts.push(`${prefix}${gid}.${i + 1}.${total}:${data.slice(i * partChars, (i + 1) * partChars)}`);
	}
	return parts;
}

const PART_RE = /^([A-Za-z0-9_-]{6})\.(\d{1,3})\.(\d{1,3}):([A-Za-z0-9_-]+)$/;
const SINGLE_RE = /^[A-Za-z0-9_-]+$/;

/** Find and parse the first envelope inside arbitrary text (users paste with surrounding noise). */
export function parseEnvelope(text: string): Parsed {
	const t = text.trim();
	for (const [kind, prefix] of Object.entries(PREFIX) as [EnvelopeKind, string][]) {
		const at = t.indexOf(prefix);
		if (at === -1) continue;
		// Take the token following the marker up to the first whitespace.
		const rest = t.slice(at + prefix.length).split(/\s/)[0];
		const part = PART_RE.exec(rest);
		if (part) {
			return { type: 'part', kind, gid: part[1], index: Number(part[2]), total: Number(part[3]), data: part[4] };
		}
		if (SINGLE_RE.test(rest)) {
			try {
				return { type: 'complete', kind, payload: b64uDecode(rest) };
			} catch {
				return { type: 'none' };
			}
		}
		return { type: 'none' };
	}
	for (const [format, prefix] of Object.entries(LEGACY_PREFIX) as [keyof typeof LEGACY_PREFIX, string][]) {
		const at = t.indexOf(prefix);
		if (at !== -1) return { type: 'legacy', format, text: t.slice(at).split(/\s/)[0] };
	}
	return { type: 'none' };
}

/** Collects multi-part envelopes; returns the payload once all parts of a group arrived. */
export class PartAssembler {
	private groups = new Map<string, { kind: EnvelopeKind; total: number; parts: Map<number, string>; seen: number }>();

	add(p: Extract<Parsed, { type: 'part' }>, now = Date.now()): { kind: EnvelopeKind; payload: Uint8Array } | null {
		if (p.index < 1 || p.index > p.total) return null;
		let g = this.groups.get(p.gid);
		if (!g || g.total !== p.total || g.kind !== p.kind) {
			g = { kind: p.kind, total: p.total, parts: new Map(), seen: now };
			this.groups.set(p.gid, g);
		}
		g.parts.set(p.index, p.data);
		g.seen = now;
		if (g.parts.size < g.total) return null;
		let data = '';
		for (let i = 1; i <= g.total; i++) data += g.parts.get(i);
		this.groups.delete(p.gid);
		try {
			return { kind: g.kind, payload: b64uDecode(data) };
		} catch {
			return null; // corrupt part: drop the group, the sender can resend
		}
	}

	progress(gid: string): { have: number; total: number } | null {
		const g = this.groups.get(gid);
		return g ? { have: g.parts.size, total: g.total } : null;
	}

	/** Drop incomplete groups older than `maxAgeMs`. */
	prune(maxAgeMs: number, now = Date.now()): void {
		for (const [gid, g] of this.groups) if (now - g.seen > maxAgeMs) this.groups.delete(gid);
	}
}

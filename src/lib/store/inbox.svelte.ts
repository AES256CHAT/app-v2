// Everything that comes *into* the app as text: pasted, scanned, or read from the clipboard.

import { PartAssembler, parseEnvelope, type EnvelopeKind } from '$lib/crypto/envelope';
import { messages, NoMatchingContactError, type ChatMessage } from './messages.svelte';
import type { ContactRecord } from './contacts.svelte';

export type ImportResult =
	| { type: 'message'; contact: ContactRecord; message: ChatMessage }
	| { type: 'handshake'; kind: 'offer' | 'answer'; payload: Uint8Array }
	| { type: 'legacy'; text: string }
	| { type: 'partial'; have: number; total: number }
	| { type: 'unknown' }
	| { type: 'no-contact' }
	| { type: 'error'; message: string };

class InboxState {
	progress = $state<{ have: number; total: number } | null>(null);
	/** A handshake envelope handed over to /contacts/add. */
	handoff: { kind: 'offer' | 'answer'; payload: Uint8Array } | null = null;
	private assembler = new PartAssembler();

	async importText(text: string): Promise<ImportResult> {
		this.assembler.prune(10 * 60_000);
		const tokens = text.split(/\s+/).filter((t) => t.includes('🛡️') || t.includes('🔐') || t.includes('🔒'));
		let partial: ImportResult | null = null;
		for (const tok of tokens) {
			const p = parseEnvelope(tok);
			if (p.type === 'complete') return this.handleComplete(p.kind, p.payload);
			if (p.type === 'legacy') return { type: 'legacy', text: p.text };
			if (p.type === 'part') {
				const done = this.assembler.add(p);
				if (done) {
					this.progress = null;
					return this.handleComplete(done.kind, done.payload);
				}
				const pr = this.assembler.progress(p.gid);
				if (pr) {
					this.progress = pr;
					partial = { type: 'partial', ...pr };
				}
			}
		}
		return partial ?? { type: 'unknown' };
	}

	private async handleComplete(kind: EnvelopeKind, payload: Uint8Array): Promise<ImportResult> {
		if (kind === 'offer' || kind === 'answer') {
			this.handoff = { kind, payload };
			return { type: 'handshake', kind, payload };
		}
		if (kind === 'msg') {
			try {
				const r = await messages.receive(payload);
				return { type: 'message', ...r };
			} catch (e) {
				if (e instanceof NoMatchingContactError) return { type: 'no-contact' };
				return { type: 'error', message: (e as Error).message };
			}
		}
		return { type: 'unknown' };
	}

	takeHandoff(): { kind: 'offer' | 'answer'; payload: Uint8Array } | null {
		const h = this.handoff;
		this.handoff = null;
		return h;
	}

	/** Needs a user gesture in browsers; returns null when not permitted. */
	async readClipboard(): Promise<string | null> {
		try {
			return await navigator.clipboard.readText();
		} catch {
			return null;
		}
	}
}

export const inbox = new InboxState();

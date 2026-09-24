// Everything that comes *into* the app: pasted or scanned text, clipboard, or an .aes256 file.

import { PartAssembler, parseEnvelope, type EnvelopeKind } from '$lib/crypto/envelope';
import { isFileEnvelope, unwrapFileEnvelope } from '$lib/crypto/fileenvelope';
import { MAX_FILE_BYTES } from '$lib/crypto/message';
import { decodeImage, isImageBytes } from '$lib/qr/decode-image';

const MAX_IMPORT_BYTES = MAX_FILE_BYTES + 4096;
import { readClipboardText } from '$lib/transport/share';
import { live } from './live.svelte';
import { messages, NoMatchingContactError, type ChatMessage } from './messages.svelte';
import type { ContactRecord } from './contacts.svelte';

export type ImportResult =
	| { type: 'message'; contact: ContactRecord; message: ChatMessage }
	| { type: 'handshake'; kind: 'offer' | 'answer'; payload: Uint8Array }
	| { type: 'live'; contact: ContactRecord; role: 'offer' | 'answer' }
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
			if (p.type === 'legacy') {
				this.legacyHandoff = p.text;
				return { type: 'legacy', text: p.text };
			}
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

	/** An .aes256 attachment file (share target, "open with", or file picker). */
	async importFile(file: File | Blob): Promise<ImportResult> {
		if (file.size > MAX_IMPORT_BYTES) return { type: 'error', message: 'file too large' };
		const bytes = new Uint8Array(await file.arrayBuffer());
		if (isFileEnvelope(bytes)) return this.receiveMessage(unwrapFileEnvelope(bytes));
		// A picture (shared QR sheet, screenshot, photo): decode every code in it.
		if (isImageBytes(bytes)) {
			const texts = await decodeImage(new Blob([bytes as BlobPart]));
			if (texts.length === 0) return { type: 'unknown' };
			return this.importText(texts.join('\n'));
		}
		// Maybe a text envelope saved as .txt
		if (bytes.length < 2_000_000) {
			const text = new TextDecoder().decode(bytes);
			if (text.includes('🛡️') || text.includes('🔐') || text.includes('🔒')) return this.importText(text);
		}
		return { type: 'unknown' };
	}

	private async handleComplete(kind: EnvelopeKind, payload: Uint8Array): Promise<ImportResult> {
		if (kind === 'offer' || kind === 'answer') {
			this.handoff = { kind, payload };
			return { type: 'handshake', kind, payload };
		}
		if (kind === 'msg' || kind === 'conn') return this.receiveMessage(payload);
		return { type: 'unknown' };
	}

	private async receiveMessage(payload: Uint8Array): Promise<ImportResult> {
		try {
			const r = await messages.receive(payload);
			if (r.plain.t === 'conn') {
				await live.handleSignal(r.contact, r.plain);
				return { type: 'live', contact: r.contact, role: r.plain.role };
			}
			return { type: 'message', contact: r.contact, message: r.message };
		} catch (e) {
			if (e instanceof NoMatchingContactError) return { type: 'no-contact' };
			return { type: 'error', message: (e as Error).message };
		}
	}

	/** Text received via the share target / native intent while locked; processed on the home screen. */
	pendingShare: string | null = null;
	pendingFile: File | null = null;

	takePendingShare(): string | null {
		const t = this.pendingShare;
		this.pendingShare = null;
		return t;
	}

	/** Legacy passphrase text handed over to /tools/password. */
	legacyHandoff: string | null = null;

	takeLegacyHandoff(): string | null {
		const h = this.legacyHandoff;
		this.legacyHandoff = null;
		return h;
	}

	takeHandoff(): { kind: 'offer' | 'answer'; payload: Uint8Array } | null {
		const h = this.handoff;
		this.handoff = null;
		return h;
	}

	/** Needs a user gesture in browsers; returns null when not permitted. */
	async readClipboard(): Promise<string | null> {
		return readClipboardText();
	}
}

export const inbox = new InboxState();

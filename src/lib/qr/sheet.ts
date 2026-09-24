// Envelope → one PNG "sheet" with all QR frames laid out in a grid. Shared as an image through
// any messenger; the receiver imports the picture and the app decodes every code in it.

import QRCode from 'qrcode';
import { encodeEnvelope, type EnvelopeKind } from '$lib/crypto/envelope';

/** Coarser than on-screen frames: messengers re-encode pictures as JPEG and downscale to ~1280 px. */
const SHEET_FRAME_CHARS = 400;
const CELL = 420; // px per QR incl. padding
const QR = 380;
const HEADER = 96;
const FOOTER = 56;

export interface QrSheet {
	blob: Blob;
	frames: number;
	fileName: string;
}

export async function qrSheetPng(kind: EnvelopeKind, payload: Uint8Array, opts: { title: string; hint: string; ts?: number }): Promise<QrSheet> {
	const texts = encodeEnvelope(kind, payload, SHEET_FRAME_CHARS);
	const n = texts.length;
	const cols = n === 1 ? 1 : 2;
	const rows = Math.ceil(n / cols);
	const canvas = document.createElement('canvas');
	canvas.width = cols * CELL;
	canvas.height = HEADER + rows * CELL + FOOTER;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('canvas unavailable');

	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = '#0b0f14';
	ctx.font = 'bold 34px system-ui, sans-serif';
	ctx.fillText(opts.title, 24, 48);
	ctx.font = '22px system-ui, sans-serif';
	ctx.fillStyle = '#3b4756';
	ctx.fillText(opts.hint, 24, 80);

	for (let i = 0; i < n; i++) {
		const tile = document.createElement('canvas');
		await QRCode.toCanvas(tile, texts[i], { errorCorrectionLevel: 'M', margin: 1, width: QR, color: { dark: '#000000', light: '#ffffff' } });
		const x = (i % cols) * CELL + (CELL - QR) / 2;
		const y = HEADER + Math.floor(i / cols) * CELL + (CELL - QR) / 2;
		ctx.drawImage(tile, x, y);
		if (n > 1) {
			ctx.fillStyle = '#0b0f14';
			ctx.font = 'bold 20px system-ui, sans-serif';
			ctx.fillText(`${i + 1}/${n}`, x, y + QR + 26);
		}
	}
	ctx.fillStyle = '#6b7785';
	ctx.font = '18px system-ui, sans-serif';
	ctx.fillText('aes256chat.org', 24, canvas.height - 20);

	const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
	if (!blob) throw new Error('png encoding failed');
	const d = new Date(opts.ts ?? Date.now());
	const pad = (v: number) => String(v).padStart(2, '0');
	const fileName = `aes256chat-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
	return { blob, frames: n, fileName };
}

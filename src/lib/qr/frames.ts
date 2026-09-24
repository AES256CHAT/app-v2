// Envelope → one or more QR images (animated when the payload exceeds one comfortable code).

import QRCode from 'qrcode';
import { encodeEnvelope, type EnvelopeKind } from '$lib/crypto/envelope';

/** ~600 chars ≈ QR version 20 at level L: dense but reliably scannable on phone screens. */
export const QR_FRAME_CHARS = 600;

export interface QrFrames {
	texts: string[];
	images: string[]; // data: URLs
}

/** Coarser frames for phone-to-phone scanning with fixed-focus front cameras. */
export const QR_FRAME_CHARS_COARSE = 280;

export async function qrFrames(kind: EnvelopeKind, payload: Uint8Array, size = 320, chars = QR_FRAME_CHARS): Promise<QrFrames> {
	const texts = encodeEnvelope(kind, payload, chars);
	const images = await Promise.all(
		texts.map((t) => QRCode.toDataURL(t, { errorCorrectionLevel: 'L', margin: 1, width: size }))
	);
	return { texts, images };
}

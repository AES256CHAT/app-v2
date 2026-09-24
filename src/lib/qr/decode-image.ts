// Decode every QR code in a picture (a shared sheet, a screenshot, a photo of a screen).

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

let prepared = false;

export function isImageBytes(b: Uint8Array): boolean {
	return (
		(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || // PNG
		(b[0] === 0xff && b[1] === 0xd8) || // JPEG
		(b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) // WEBP
	);
}

/** Returns the decoded texts (frames) found in the image, in reading order. */
export async function decodeImage(blob: Blob): Promise<string[]> {
	if (!prepared) {
		prepareZXingModule({ overrides: { locateFile: (p: string, prefix: string) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) } });
		prepared = true;
	}
	const bmp = await createImageBitmap(blob);
	// Cap the working size: huge photos are slow and gain nothing for QR.
	const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bmp.width * scale);
	canvas.height = Math.round(bmp.height * scale);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return [];
	ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
	bmp.close();
	const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const results = await readBarcodes(img, { formats: ['QRCode'], tryHarder: true, tryRotate: true, tryInvert: true, maxNumberOfSymbols: 64 });
	// Sort by position (row-major) so multi-frame sheets come out in order even if the assembler did not need it.
	return results
		.filter((r) => r.isValid && r.text)
		.sort((a, b) => {
			const ay = a.position.topLeft.y, by = b.position.topLeft.y;
			return Math.abs(ay - by) > 40 ? ay - by : a.position.topLeft.x - b.position.topLeft.x;
		})
		.map((r) => r.text);
}

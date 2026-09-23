// Client-side image downscaling so photos stay small (and EXIF/GPS is dropped on re-encode).

export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_QUALITY = 0.82;

export function isImage(mime: string): boolean {
	return /^image\/(jpeg|png|webp|gif|heic|heif|avif|bmp)$/i.test(mime);
}

export async function downscaleImage(file: File | Blob, maxEdge = IMAGE_MAX_EDGE): Promise<Blob> {
	if (typeof createImageBitmap !== 'function') return file;
	let bmp: ImageBitmap;
	try {
		bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		return file; // unsupported format (e.g. HEIC on some platforms) → send as-is
	}
	const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
	const w = Math.max(1, Math.round(bmp.width * scale));
	const h = Math.max(1, Math.round(bmp.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) return file;
	ctx.drawImage(bmp, 0, 0, w, h);
	bmp.close();
	const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', IMAGE_QUALITY));
	return blob && blob.size < file.size ? blob : file;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

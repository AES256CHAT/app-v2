import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PW = 'zehn zeichen mindestens';

async function onboard(page: Page, name: string) {
	await page.goto('/');
	await page.getByLabel(/Anzeigename|display name/i).fill(name);
	const pw = page.locator('input[type="password"]');
	await pw.nth(0).fill(PW);
	await pw.nth(1).fill(PW);
	await page.getByRole('button', { name: /Tresor anlegen|Create vault/ }).click();
	await page.getByTestId('me').waitFor();
}

async function envelope(page: Page) {
	const f = page.getByTestId('envelope-text');
	await expect(f).not.toHaveValue('', { timeout: 15_000 });
	return f.inputValue();
}

async function pasteHandshake(page: Page, text: string) {
	await page.getByRole('tab', { name: /Code scannen|Scan code/ }).click();
	const field = page.getByTestId('paste-field');
	if (!(await field.isVisible())) {
		await page.getByRole('button', { name: /als Text einfügen|Paste code/ }).click({ timeout: 3000 }).catch(() => {});
	}
	await field.waitFor();
	await field.fill(text);
	await page.getByRole('button', { name: /Übernehmen|Apply/ }).click();
}

async function connect(a: Page, b: Page) {
	await a.getByTestId('add-contact').click();
	const offer = await envelope(a);
	await b.getByTestId('add-contact').click();
	await pasteHandshake(b, offer);
	await b.getByRole('button', { name: /^Hinzufügen$|^Add$/ }).click();
	const answer = await envelope(b);
	await pasteHandshake(a, answer);
	await a.getByTestId('done').waitFor();
	await a.getByRole('link', { name: /Zurück|Back/ }).click();
	await b.getByRole('button', { name: /Zum Kontakt|Open contact/ }).click();
	await b.getByRole('link', { name: /Zurück|Back/ }).click();
}

test('attachments travel as encrypted .aes256 files', async ({ browser }) => {
	const ctxA = await browser.newContext({ acceptDownloads: true });
	const ctxB = await browser.newContext({ acceptDownloads: true });
	const a = await ctxA.newPage();
	const b = await ctxB.newPage();
	await onboard(a, 'Alice');
	await onboard(b, 'Bob');
	await connect(a, b);

	// A attaches a text file → headless has no share sheet → .aes256 download.
	await a.getByTestId('contact-list').getByRole('link', { name: /Bob/ }).click();
	const content = Buffer.from('Vertrag Entwurf v3\n'.repeat(500));
	const downloadPromise = a.waitForEvent('download');
	await a.getByTestId('file-input').setInputFiles({ name: 'vertrag.txt', mimeType: 'text/plain', buffer: content });
	const dl = await downloadPromise;
	expect(dl.suggestedFilename()).toMatch(/^aes256chat-\d{8}-\d{6}\.aes256$/);
	const encPath = await dl.path();
	const enc = readFileSync(encPath!);
	expect(enc.subarray(0, 12).toString()).toBe('A256CHAT-F1\n');
	expect(enc.includes(Buffer.from('Vertrag Entwurf'))).toBe(false); // ciphertext, not plaintext
	await expect(a.getByTestId('msg-out').last()).toContainText('vertrag.txt');
	await expect(a.getByTestId('msg-out').last()).toContainText(/als Datei gespeichert|saved as file/);

	// B opens the .aes256 file via the import sheet → decrypted attachment appears.
	await b.getByTestId('home-import').click();
	await b.getByTestId('inbox-file-input').setInputFiles({ name: dl.suggestedFilename(), mimeType: 'application/octet-stream', buffer: enc });
	await expect(b).toHaveURL(/\/chat\//);
	const bubble = b.getByTestId('msg-in').last();
	await expect(bubble).toContainText('vertrag.txt');
	await expect(bubble).toContainText(/\d+ KB/);

	// B saves the decrypted file: identical content.
	const saved = b.waitForEvent('download');
	await bubble.getByTestId('file-save').click();
	const plain = readFileSync((await (await saved).path())!);
	expect(plain.equals(content)).toBe(true);

	// Replaying the same .aes256 file is rejected.
	await b.getByTestId('chat-import').click();
	await b.getByTestId('inbox-file-input').setInputFiles({ name: 'again.aes256', mimeType: 'application/octet-stream', buffer: enc });
	await expect(b.getByRole('alert')).toBeVisible();
	await b.getByTestId('inbox-close').click();

	// An image goes through the downscaler and arrives as JPEG with a preview.
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBBAMDAB1wBf1zqK5CAAAAAElFTkSuQmCC',
		'base64'
	);
	const dl2p = a.waitForEvent('download');
	await a.getByTestId('file-input').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
	const enc2 = readFileSync((await (await dl2p).path())!);
	await b.getByTestId('chat-import').click();
	await b.getByTestId('inbox-file-input').setInputFiles({ name: 'img.aes256', mimeType: 'application/octet-stream', buffer: enc2 });
	await expect(b.getByTestId('msg-in').last().locator('img')).toBeVisible();

	// Text still works after file messages (same ratchet).
	await b.getByTestId('composer').fill('Datei ist da');
	await b.getByTestId('send').click();
	await expect(b.getByTestId('msg-out').last()).toContainText('Datei ist da');
});

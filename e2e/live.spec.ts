import { expect, test, type Page } from '@playwright/test';

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

async function importInChat(page: Page, text: string) {
	await page.getByTestId('chat-import').click();
	await page.getByTestId('inbox-paste').click();
	await page.getByTestId('inbox-field').fill(text);
	await page.getByTestId('inbox-submit').click();
}

test('direct WebRTC link: signalling via 🛡️CONN envelopes, then instant delivery', async ({ browser }) => {
	const a = await (await browser.newContext()).newPage();
	const b = await (await browser.newContext()).newPage();
	await onboard(a, 'Alice');
	await onboard(b, 'Bob');
	await connect(a, b);
	await a.getByTestId('contact-list').getByRole('link', { name: /Bob/ }).click();
	await b.getByTestId('contact-list').getByRole('link', { name: /Alice/ }).click();

	// A offers a live link → encrypted CONN envelope.
	await a.getByTestId('chat-live').click();
	await a.getByTestId('live-offer').click();
	const connOffer = await envelope(a);
	expect(connOffer.startsWith('🛡️CONN:')).toBe(true);

	// B imports it → auto-answer envelope.
	await importInChat(b, connOffer);
	await b.getByTestId('chat-live').click();
	const connAnswer = await envelope(b);
	expect(connAnswer.startsWith('🛡️CONN:')).toBe(true);
	await b.getByTestId('live-close').click();

	// A imports the answer → data channel opens on both sides (loopback host candidates).
	await a.getByTestId('live-import-answer').click();
	await a.getByTestId('inbox-paste').click();
	await a.getByTestId('inbox-field').fill(connAnswer);
	await a.getByTestId('inbox-submit').click();
	await expect(a.getByTestId('live-dot')).toBeVisible({ timeout: 15_000 });
	await expect(b.getByTestId('live-dot')).toBeVisible({ timeout: 15_000 });

	// Messages now arrive instantly without any import, marked as delivered directly.
	await a.getByTestId('composer').fill('Live hallo');
	await a.getByTestId('send').click();
	await expect(a.getByTestId('msg-out').last()).toContainText(/direkt zugestellt|delivered directly/);
	await expect(b.getByTestId('msg-in').last()).toContainText('Live hallo', { timeout: 10_000 });

	await b.getByTestId('composer').fill('Live zurück');
	await b.getByTestId('send').click();
	await expect(a.getByTestId('msg-in').last()).toContainText('Live zurück', { timeout: 10_000 });

	// A file goes over the channel too (chunked frames).
	await b.getByTestId('file-input').setInputFiles({ name: 'big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(300_000, 3) });
	await expect(a.getByTestId('msg-in').last()).toContainText('big.bin', { timeout: 15_000 });
	await expect(b.getByTestId('msg-out').last()).toContainText(/direkt zugestellt|delivered directly/);

	// Disconnect → back to envelope mode.
	await a.getByTestId('chat-live').click();
	await a.getByRole('button', { name: /Verbindung trennen|Disconnect/ }).click();
	await a.getByTestId('live-close').click();
	await expect(a.getByTestId('live-dot')).toHaveCount(0);
	await expect(b.getByTestId('live-dot')).toHaveCount(0, { timeout: 15_000 });
});

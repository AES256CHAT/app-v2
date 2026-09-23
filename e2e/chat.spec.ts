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

async function sendAndGrab(page: Page, text: string): Promise<string> {
	await page.getByTestId('composer').fill(text);
	await page.getByTestId('send').click();
	// Headless has no share sheet → copied to clipboard; read it back.
	await expect(page.getByTestId('msg-out').last()).toContainText(text.slice(0, 20));
	return page.evaluate(() => navigator.clipboard.readText());
}

async function importText(page: Page, opener: string, text: string) {
	await page.getByTestId(opener).click();
	await page.getByTestId('inbox-paste').click();
	await page.getByTestId('inbox-field').fill(text);
	await page.getByTestId('inbox-submit').click();
}

test('text messages travel both ways as envelopes, incl. multi-part and replay rejection', async ({ browser }) => {
	const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
	const ctxB = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
	const a = await ctxA.newPage();
	const b = await ctxB.newPage();
	await onboard(a, 'Alice');
	await onboard(b, 'Bob');
	await connect(a, b);

	// A → B
	await a.getByTestId('contact-list').getByText('Bob').click();
	const env1 = await sendAndGrab(a, 'Hallo Bob 👋');
	expect(env1.startsWith('🛡️MSG:')).toBe(true);
	await importText(b, 'home-import', env1);
	await expect(b).toHaveURL(/\/chat\//);
	await expect(b.getByTestId('msg-in').last()).toContainText('Hallo Bob 👋');

	// B → A (ratchet turns over)
	const env2 = await sendAndGrab(b, 'Hi Alice, angekommen!');
	await importText(a, 'chat-import', env2);
	await expect(a.getByTestId('msg-in').last()).toContainText('Hi Alice, angekommen!');

	// Long message → several parts, pasted as one block
	const long = 'Lorem ipsum dolor sit amet. '.repeat(300);
	const env3 = await sendAndGrab(a, long);
	expect(env3.split('\n').length).toBeGreaterThan(1);
	await importText(b, 'chat-import', env3);
	await expect(b.getByTestId('msg-in').last()).toContainText('Lorem ipsum dolor sit amet.');

	// Replaying an old envelope is rejected, own envelope too
	await importText(b, 'chat-import', env1);
	await expect(b.getByRole('alert')).toBeVisible();
	await b.getByTestId('inbox-close').click();
	await importText(a, 'chat-import', env1);
	await expect(a.getByRole('alert')).toBeVisible();
	await a.getByTestId('inbox-close').click();

	// Home shows preview + unread badge on B after a fresh message from A
	const env4 = await sendAndGrab(a, 'Noch eine');
	await b.getByRole('link', { name: /Zurück|Back/ }).click();
	await importText(b, 'home-import', env4);
	await expect(b).toHaveURL(/\/chat\//);
	await b.getByRole('link', { name: /Zurück|Back/ }).click();
	await expect(b.getByTestId('contact-list')).toContainText('Noch eine');

	// Ephemeral mode: lock → unlock → thread is empty again
	await a.getByRole('link', { name: /Zurück|Back/ }).click();
	await a.getByRole('button', { name: /Jetzt sperren|Lock now/ }).click();
	await a.locator('input[type="password"]').fill(PW);
	await a.getByRole('button', { name: /Entsperren|Unlock/ }).click();
	await a.getByTestId('contact-list').getByText('Bob').click();
	await expect(a.getByTestId('msg-out')).toHaveCount(0);
});

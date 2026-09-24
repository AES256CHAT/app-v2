import { expect, test, type Page } from '@playwright/test';
import { PW, connect, onboard } from './helpers';

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
	await a.getByTestId('contact-list').getByRole('link', { name: /Bob/ }).click();
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
	await a.getByTestId('contact-list').getByRole('link', { name: /Bob/ }).click();
	await expect(a.getByTestId('msg-out')).toHaveCount(0);
});

import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PW, connect, envelope, importInChat, onboard, pasteScan } from './helpers';

async function sendAndGrab(page: Page, text: string): Promise<string> {
	await page.getByTestId('composer').fill(text);
	await page.getByTestId('send').click();
	await expect(page.getByTestId('msg-out').last()).toContainText(text.slice(0, 20));
	return page.evaluate(() => navigator.clipboard.readText());
}

test('backup → restore on a new device → stale session renewed → messaging works again', async ({ browser }) => {
	const perms = ['clipboard-read', 'clipboard-write'];
	const a = await (await browser.newContext({ acceptDownloads: true, permissions: perms })).newPage();
	const b = await (await browser.newContext({ permissions: perms })).newPage();
	await onboard(a, 'Alice');
	await onboard(b, 'Bob');
	await connect(a, b);

	// Some traffic first, so B's session with Alice is "in use" (replace needs confirmation later).
	await a.getByTestId('contact-list').getByRole('link', { name: /Bob/ }).click();
	const first = await sendAndGrab(a, 'Vor dem Backup');
	await b.getByTestId('contact-list').getByRole('link', { name: /Alice/ }).click();
	await importInChat(b, first);
	await expect(b.getByTestId('msg-in').last()).toContainText('Vor dem Backup');
	await a.getByRole('link', { name: /Zurück|Back/ }).click();

	// A creates a backup with the master passphrase (download in headless).
	await a.getByRole('link', { name: /Einstellungen|Settings/ }).click();
	await a.getByTestId('backup-pw').fill(PW);
	const dl = a.waitForEvent('download');
	await a.getByTestId('backup-create').click();
	const file = await dl;
	expect(file.suggestedFilename()).toMatch(/^aes256chat-backup-\d{8}\.a256bak$/);
	const bytes = readFileSync((await file.path())!);
	expect(bytes.subarray(0, 12).toString()).toBe('A256CHAT-BK1');
	expect(bytes.includes(Buffer.from('Bob'))).toBe(false); // encrypted

	// "New phone" C restores it from the onboarding screen.
	const c = await (await browser.newContext({ permissions: perms })).newPage();
	await c.goto('/');
	await c.getByTestId('onb-restore').click();
	await c.getByTestId('restore-file').setInputFiles({ name: 'b.a256bak', mimeType: 'application/octet-stream', buffer: bytes });
	await c.getByTestId('restore-pw').fill('falsches passwort 123');
	await c.getByRole('button', { name: /Backup prüfen|Check backup/ }).click();
	await expect(c.getByRole('alert')).toBeVisible();
	await c.getByTestId('restore-pw').fill(PW);
	await c.getByRole('button', { name: /Backup prüfen|Check backup/ }).click();
	await expect(c.getByTestId('restore-confirm')).toContainText('Alice');
	await c.getByTestId('restore-apply').click();
	await expect(c.getByTestId('contact-list')).toContainText('Bob');
	// Same identity as A.
	await a.getByRole('link', { name: /Zurück|Back/ }).click();
	await a.getByTestId('me').waitFor();
	expect(await c.locator('[data-testid="me"] code').innerText()).toBe(await a.locator('[data-testid="me"] code').innerText());

	// Restored session is stale: sending is blocked, renewal offered.
	await c.getByTestId('contact-list').getByRole('link', { name: /Bob/ }).click();
	await expect(c.getByTestId('stale-banner')).toBeVisible();
	await expect(c.getByTestId('send')).toBeDisabled();
	await c.getByTestId('rekey').click();
	await expect(c).toHaveURL(/rekey=/);
	const offer = await envelope(c);

	// B imports the renewal code → confirms replacing the existing connection → reply code.
	await importInChat(b, offer);
	await expect(b).toHaveURL(/\/contacts\/add/);
	await expect(b.getByTestId('confirm')).toContainText('Alice');
	await b.getByRole('button', { name: /^Hinzufügen$|^Add$/ }).click();
	await expect(b.getByTestId('replace')).toBeVisible();
	await b.getByRole('button', { name: /^Ersetzen$|^Replace$/ }).click();
	const answer = await envelope(b);

	// C scans the reply → connection fresh → banner gone → messages flow again.
	await c.getByTestId('both-scan').click();
	await pasteScan(c, answer);
	await expect(c.getByTestId('done')).toBeVisible();
	await c.getByTestId('open-chat').click();
	await expect(c.getByTestId('stale-banner')).toHaveCount(0);
	const env = await sendAndGrab(c, 'Zurück aus dem Backup');
	await b.getByTestId('b-done').click();
	await b.getByTestId('open-chat').click();
	await importInChat(b, env);
	await expect(b.getByTestId('msg-in').last()).toContainText('Zurück aus dem Backup');
});

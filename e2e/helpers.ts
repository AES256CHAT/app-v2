import { expect, type Page } from '@playwright/test';

export const PW = 'zehn zeichen mindestens';

export async function onboard(page: Page, name: string) {
	await page.goto('/');
	await page.getByLabel(/Anzeigename|display name/i).fill(name);
	const pw = page.locator('input[type="password"]');
	await pw.nth(0).fill(PW);
	await pw.nth(1).fill(PW);
	await page.getByRole('button', { name: /Tresor anlegen|Create vault/ }).click();
	await page.getByTestId('me').waitFor();
}

export async function envelope(page: Page) {
	const f = page.getByTestId('envelope-text');
	await expect(f).not.toHaveValue('', { timeout: 15_000 });
	return f.inputValue();
}

/** Paste into the QrScan fallback field (no camera in headless). */
export async function pasteScan(page: Page, text: string) {
	const field = page.getByTestId('paste-field');
	if (!(await field.isVisible())) {
		await page.getByRole('button', { name: /als Text einfügen|Paste code/ }).click({ timeout: 3000 }).catch(() => {});
	}
	await field.waitFor();
	await field.fill(text);
	await page.getByRole('button', { name: /Übernehmen|Apply/ }).click();
}

/** Default pairing: both show their code; B scans first, A scans the reply. Ends on the home list. */
export async function connect(a: Page, b: Page) {
	await a.getByTestId('add-contact').click();
	const offer = await envelope(a);

	await b.getByTestId('add-contact').click();
	await b.getByTestId('both-scan').click();
	await pasteScan(b, offer);
	await b.getByTestId('confirm').waitFor();
	await b.getByRole('button', { name: /^Hinzufügen$|^Add$/ }).click();
	const answer = await envelope(b);

	await a.getByTestId('both-scan').click();
	await pasteScan(a, answer);
	await a.getByTestId('done').waitFor();
	await b.getByTestId('b-done').click();
	await b.getByTestId('done').waitFor();

	await a.getByRole('link', { name: /Zurück|Back/ }).click();
	await b.getByRole('link', { name: /Zurück|Back/ }).click();
	await a.getByTestId('contact-list').waitFor();
	await b.getByTestId('contact-list').waitFor();
	return { offer, answer };
}

export async function importInChat(page: Page, text: string) {
	await page.getByTestId('chat-import').click();
	await page.getByTestId('inbox-paste').click();
	await page.getByTestId('inbox-field').fill(text);
	await page.getByTestId('inbox-submit').click();
}

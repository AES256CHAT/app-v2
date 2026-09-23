import { expect, test, type Page } from '@playwright/test';

const PW = 'zehn zeichen mindestens';

async function onboard(page: Page, name: string) {
	await page.goto('/');
	await expect(page).toHaveURL(/\/onboarding$/);
	await page.getByLabel(/Anzeigename|display name/i).fill(name);
	const pwFields = page.locator('input[type="password"]');
	await pwFields.nth(0).fill(PW);
	await pwFields.nth(1).fill(PW);
	await page.getByRole('button', { name: /Tresor anlegen|Create vault/ }).click();
	await expect(page).toHaveURL(/\/$/);
}

async function readEnvelopeText(page: Page): Promise<string> {
	const field = page.getByTestId('envelope-text');
	await expect(field).not.toHaveValue('', { timeout: 15_000 });
	return field.inputValue();
}

async function pasteEnvelope(page: Page, text: string) {
	await page.getByRole('tab', { name: /Code scannen|Scan code/ }).click();
	// Without a camera the paste field opens by itself; otherwise open it.
	const field = page.getByTestId('paste-field');
	const toggle = page.getByRole('button', { name: /als Text einfügen|Paste code/ });
	if (!(await field.isVisible())) await toggle.click({ timeout: 3000 }).catch(() => {});
	await field.waitFor();
	await field.fill(text);
	await page.getByRole('button', { name: /Übernehmen|Apply/ }).click();
}

test('two devices add each other via offer/answer envelopes (text transport)', async ({ browser }) => {
	// Two isolated contexts = two devices with separate IndexedDBs. No camera: paste fallback.
	const a = await (await browser.newContext({ permissions: [] })).newPage();
	const b = await (await browser.newContext({ permissions: [] })).newPage();
	await onboard(a, 'Alice');
	await onboard(b, 'Bob');

	// A shows offer.
	await a.getByTestId('add-contact').click();
	const offerText = await readEnvelopeText(a);
	expect(offerText.split('\n').length).toBeGreaterThan(1); // multi-frame

	// B pastes offer, confirms, gets answer.
	await b.getByTestId('add-contact').click();
	await pasteEnvelope(b, offerText);
	await expect(b.getByTestId('confirm')).toContainText('Alice');
	await b.getByRole('button', { name: /^Hinzufügen$|^Add$/ }).click();
	await expect(b.getByTestId('answer')).toBeVisible();
	const answerText = await readEnvelopeText(b);

	// A pastes answer → done.
	await pasteEnvelope(a, answerText);
	await expect(a.getByTestId('done')).toContainText('Bob');

	// In-app navigation only: a full reload drops the memory-only key and lands on /lock (by design).
	await a.getByRole('link', { name: /Zum Kontakt|Open contact/ }).click();
	await b.getByRole('button', { name: /Zum Kontakt|Open contact/ }).click();
	await expect(a).toHaveURL(/\/contacts\/[A-Z0-9]{16}$/);
	await expect(b).toHaveURL(/\/contacts\/[A-Z0-9]{16}$/);

	// Safety numbers match on both sides.
	const snA = (await a.getByTestId('safety-number').innerText()).replace(/\s+/g, '');
	const snB = (await b.getByTestId('safety-number').innerText()).replace(/\s+/g, '');
	expect(snA).toMatch(/^\d{60}$/);
	expect(snA).toBe(snB);

	// Home lists show each other, and the contact ID on A is B's own ID.
	const idOnA = await a.getByTestId('contact-id').innerText();
	await a.getByRole('link', { name: /Zurück|Back/ }).click();
	await b.getByRole('link', { name: /Zurück|Back/ }).click();
	await expect(a.getByTestId('contact-list')).toContainText('Bob');
	await expect(b.getByTestId('contact-list')).toContainText('Alice');
	expect(idOnA).toBe(await b.locator('[data-testid="me"] code').innerText());

	// Pasting the same answer again is handled cleanly (re-adds the same contact, no crash).
	await a.getByTestId('add-contact').click();
	await pasteEnvelope(a, answerText);
	await expect(a.getByRole('alert').or(a.getByTestId('done'))).toBeVisible();
	await a.getByRole('link', { name: /Zurück|Back/ }).or(a.getByRole('link', { name: /Zum Kontakt|Open contact/ })).first().click();
});

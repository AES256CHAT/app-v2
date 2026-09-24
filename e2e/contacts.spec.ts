import { expect, test } from '@playwright/test';
import { connect, envelope, onboard, pasteScan } from './helpers';

test('guided pairing: A shows, B scans, B shows reply, A scans — safety numbers match', async ({ browser }) => {
	const a = await (await browser.newContext()).newPage();
	const b = await (await browser.newContext()).newPage();
	await onboard(a, 'Alice');
	await onboard(b, 'Bob');

	// Step-by-step path is still reachable from the default screen.
	await a.getByTestId('add-contact').click();
	await a.getByTestId('role-steps').click();
	await expect(a.getByText(/So funktioniert es|How it works/)).toBeVisible();
	await a.getByTestId('role-show').click();
	await expect(a.getByTestId('step')).toHaveText(/1 von 3|1 of 3/);
	const offer = await envelope(a);
	expect(offer.split('\n').length).toBeGreaterThan(1); // multi-frame

	await b.getByTestId('add-contact').click();
	await b.getByTestId('role-steps').click();
	await b.getByTestId('role-scan').click();
	await expect(b.getByTestId('step')).toHaveText(/1 von 3|1 of 3/);
	await pasteScan(b, offer);
	await expect(b.getByTestId('confirm')).toContainText('Alice');
	await b.getByRole('button', { name: /^Hinzufügen$|^Add$/ }).click();
	await expect(b.getByTestId('step')).toHaveText(/2 von 3|2 of 3/);
	const answer = await envelope(b);

	await a.getByTestId('a-next').click();
	await expect(a.getByTestId('step')).toHaveText(/2 von 3|2 of 3/);
	await pasteScan(a, answer);
	await expect(a.getByTestId('done')).toContainText('Bob');
	await expect(a.getByTestId('step')).toHaveText(/3 von 3|3 of 3/);
	await b.getByTestId('b-done').click();
	await expect(b.getByTestId('done')).toContainText('Alice');

	// In-app navigation only: a full reload drops the memory-only key and lands on /lock (by design).
	await a.getByTestId('open-chat').click();
	await b.getByTestId('open-chat').click();
	await a.getByRole('link', { name: /Bob/ }).first().click(); // header → contact detail
	await b.getByRole('link', { name: /Alice/ }).first().click();
	const snA = (await a.getByTestId('safety-number').innerText()).replace(/\s+/g, '');
	const snB = (await b.getByTestId('safety-number').innerText()).replace(/\s+/g, '');
	expect(snA).toMatch(/^\d{60}$/);
	expect(snA).toBe(snB);

	const idOnA = await a.getByTestId('contact-id').innerText();
	await a.getByRole('link', { name: /Zurück|Back/ }).click();
	await b.getByRole('link', { name: /Zurück|Back/ }).click();
	await expect(a.getByTestId('contact-list')).toContainText('Bob');
	await expect(b.getByTestId('contact-list')).toContainText('Alice');
	expect(idOnA).toBe(await b.locator('[data-testid="me"] code').innerText());

	// The same reply code cannot be used twice.
	await a.getByTestId('add-contact').click();
	await a.getByTestId('both-scan').click();
	await pasteScan(a, answer);
	await expect(a.getByRole('alert')).toContainText(/bereits verwendet|already been used/);
});

test('helper connect() works end to end', async ({ browser }) => {
	const a = await (await browser.newContext()).newPage();
	const b = await (await browser.newContext()).newPage();
	await onboard(a, 'Alice');
	await onboard(b, 'Bob');
	await connect(a, b);
	await expect(a.getByTestId('contact-list')).toContainText('Bob');
	await expect(b.getByTestId('contact-list')).toContainText('Alice');
});

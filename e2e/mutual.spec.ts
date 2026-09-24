import { expect, test, type Page } from '@playwright/test';
import { envelope, onboard, pasteScan } from './helpers';

/** Headless has no camera, so QrScan opens its paste field; pasting stands in for scanning. */
test('face-to-face mode: both show and scan, roles resolve automatically', async ({ browser }) => {
	const a = await (await browser.newContext()).newPage();
	const b = await (await browser.newContext()).newPage();
	await onboard(a, 'Alice');
	await onboard(b, 'Bob');

	for (const p of [a, b]) {
		await p.getByTestId('add-contact').click();
		await p.getByTestId('role-mutual').click();
		await expect(p.getByTestId('step')).toHaveText(/1 von 3|1 of 3/);
	}
	// Both phones "see" each other's offer.
	const offerA = await envelope(a);
	const offerB = await envelope(b);
	await pasteScan(b, offerA);
	await pasteScan(a, offerB);

	// Exactly one side switches to the reply code (the smaller contact ID), the other keeps scanning.
	const responder: Page = (await a.getByTestId('mutual-done').isVisible({ timeout: 25_000 }).catch(() => false)) ? a : b;
	const initiator: Page = responder === a ? b : a;
	await expect(responder.getByTestId('mutual-done')).toBeVisible();
	await expect(responder.getByTestId('step')).toHaveText(/2 von 3|2 of 3/);
	await expect(initiator.getByTestId('step')).toHaveText(/1 von 3|1 of 3/);

	// The initiator "sees" the reply code → connected; the responder confirms.
	const answer = await envelope(responder);
	expect(answer.startsWith('🛡️OK:')).toBe(true);
	await pasteScan(initiator, answer);
	await expect(initiator.getByTestId('done')).toBeVisible();
	await responder.getByTestId('mutual-done').click();
	await expect(responder.getByTestId('done')).toBeVisible();

	// Same safety number on both sides.
	for (const p of [a, b]) await p.getByTestId('open-chat').click();
	await a.getByRole('link', { name: /Bob/ }).first().click();
	await b.getByRole('link', { name: /Alice/ }).first().click();
	const snA = (await a.getByTestId('safety-number').innerText()).replace(/\s+/g, '');
	const snB = (await b.getByTestId('safety-number').innerText()).replace(/\s+/g, '');
	expect(snA).toBe(snB);
});

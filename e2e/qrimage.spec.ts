import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { connect, onboard } from './helpers';

test('a message travels as a QR image (sheet) and is decoded from the picture', async ({ browser }) => {
	const a = await (await browser.newContext({ acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] })).newPage();
	const b = await (await browser.newContext({ acceptDownloads: true })).newPage();
	await onboard(a, 'Alice');
	await onboard(b, 'Bob');
	await connect(a, b);

	// A writes a long message (several frames) and exports it as one PNG sheet.
	await a.getByTestId('contact-list').getByRole('link', { name: /Bob/ }).click();
	const text = 'QR-Bild-Test: ' + 'Lorem ipsum dolor sit amet, consetetur sadipscing elitr. '.repeat(30);
	await a.getByTestId('composer').fill(text);
	await a.getByTestId('send').click();
	await expect(a.getByTestId('msg-out').last()).toContainText('QR-Bild-Test');
	const dl = a.waitForEvent('download');
	await a.getByTestId('msg-image').last().click();
	const png = readFileSync((await (await dl).path())!);
	expect(png.subarray(1, 4).toString()).toBe('PNG');
	if (process.env.SHOTS_DIR) writeFileSync(`${process.env.SHOTS_DIR}/qr-sheet.png`, png);

	// B imports the picture → all frames decoded → message appears.
	await b.getByTestId('home-import').click();
	await b.getByTestId('inbox-image-input').setInputFiles({ name: 'sheet.png', mimeType: 'image/png', buffer: png });
	await expect(b).toHaveURL(/\/chat\//, { timeout: 20_000 });
	await expect(b.getByTestId('msg-in').last()).toContainText('QR-Bild-Test');

	// Contact codes work as images too: B's offer sheet decoded by A on the add screen is out of scope
	// here, but the handshake QR button must exist.
	await b.getByRole('link', { name: /Zurück|Back/ }).click();
	await b.getByTestId('add-contact').click();
	await expect(b.getByTestId('share-image')).toBeVisible();
});

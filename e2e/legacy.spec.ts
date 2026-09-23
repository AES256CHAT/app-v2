import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PW = 'zehn zeichen mindestens';
const vectors = JSON.parse(readFileSync('src/lib/crypto/__fixtures__/legacy-vectors.json', 'utf8')) as {
	password: string;
	text: string;
	military: string;
	file: string;
	fileContent: string;
};

async function onboard(page: Page, name: string) {
	await page.goto('/');
	await page.getByLabel(/Anzeigename|display name/i).fill(name);
	const pw = page.locator('input[type="password"]');
	await pw.nth(0).fill(PW);
	await pw.nth(1).fill(PW);
	await page.getByRole('button', { name: /Tresor anlegen|Create vault/ }).click();
	await page.getByTestId('me').waitFor();
}

test('passphrase tool stays byte-compatible with v1 and is reachable from the inbox', async ({ page }) => {
	await onboard(page, 'Alice');

	// Pasting a legacy ciphertext into the inbox opens the tool prefilled.
	await page.getByTestId('home-import').click();
	await page.getByTestId('inbox-paste').click();
	await page.getByTestId('inbox-field').fill(vectors.military);
	await page.getByTestId('inbox-submit').click();
	await expect(page).toHaveURL(/\/tools\/password$/);
	await expect(page.getByTestId('pw-input')).toHaveValue(vectors.military);

	// Decrypt the v1 reference ciphertext.
	await page.getByTestId('pw-key').fill(vectors.password);
	await page.getByTestId('pw-run').click();
	await expect(page.getByTestId('pw-output')).toHaveValue(vectors.text);

	// Wrong passphrase fails cleanly.
	await page.getByTestId('pw-key').fill('falsch');
	await page.getByTestId('pw-run').click();
	await expect(page.getByRole('alert')).toBeVisible();

	// v1 file format decrypts with metadata.
	await page.getByTestId('pw-input').fill(vectors.file);
	await page.getByTestId('pw-key').fill(vectors.password);
	await page.getByTestId('pw-run').click();
	await expect(page.getByTestId('pw-file-out')).toContainText('notes.txt');

	// Encrypt → output carries the v1 marker → decrypt round-trips.
	await page.getByRole('tab', { name: /Verschlüsseln|Encrypt/ }).click();
	await page.getByTestId('pw-input').fill('Hallo aus v2');
	await page.getByTestId('pw-key').fill('geheim 123');
	await page.getByTestId('pw-run').click();
	const ct = await page.getByTestId('pw-output').inputValue();
	expect(ct.startsWith('🛡️QR-ENC:')).toBe(true);
	await page.getByRole('tab', { name: /Entschlüsseln|Decrypt/ }).click();
	await page.getByTestId('pw-input').fill(ct);
	await page.getByTestId('pw-key').fill('geheim 123');
	await page.getByTestId('pw-run').click();
	await expect(page.getByTestId('pw-output')).toHaveValue('Hallo aus v2');

	// Reachable from settings.
	await page.getByRole('link', { name: /Zurück|Back/ }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByTestId('pw-tool-link')).toBeVisible();
});

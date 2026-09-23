import { expect, test } from '@playwright/test';

const PW = 'zehn zeichen mindestens';

test('onboarding → home → lock → wrong → unlock, guard survives reload', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/onboarding$/);

	await page.getByLabel(/Anzeigename|display name/i).fill('Alice');
	const pwFields = page.locator('input[type="password"]');
	await pwFields.nth(0).fill(PW);
	await pwFields.nth(1).fill(PW);
	await page.getByRole('button', { name: /Tresor anlegen|Create vault/ }).click();

	await expect(page).toHaveURL(/\/$/);
	const me = page.getByTestId('me');
	await expect(me).toContainText('Alice');
	await expect(me.locator('code')).toHaveText(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);

	// Reload: vault exists but key is memory-only → lock screen.
	await page.reload();
	await expect(page).toHaveURL(/\/lock$/);
	await page.goto('/onboarding');
	await expect(page).toHaveURL(/\/lock$/);

	// Wrong passphrase is rejected, correct one unlocks with data intact.
	await page.locator('input[type="password"]').fill('falsches passwort 123');
	await page.getByRole('button', { name: /Entsperren|Unlock/ }).click();
	await expect(page.getByRole('alert')).toContainText(/Falsches|Wrong/);
	await page.locator('input[type="password"]').fill(PW);
	await page.getByRole('button', { name: /Entsperren|Unlock/ }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('me')).toContainText('Alice');

	// Manual lock.
	await page.getByRole('button', { name: /Jetzt sperren|Lock now/ }).click();
	await expect(page).toHaveURL(/\/lock$/);
});

test('third failure triggers a lockout countdown', async ({ page }) => {
	await page.goto('/onboarding');
	await page.getByLabel(/Anzeigename|display name/i).fill('Bob');
	const pwFields = page.locator('input[type="password"]');
	await pwFields.nth(0).fill(PW);
	await pwFields.nth(1).fill(PW);
	await page.getByRole('button', { name: /Tresor anlegen|Create vault/ }).click();
	await expect(page).toHaveURL(/\/$/);
	await page.getByRole('button', { name: /Jetzt sperren|Lock now/ }).click();

	for (let i = 0; i < 3; i++) {
		await page.locator('input[type="password"]').fill(`wrong attempt ${i}`);
		await page.getByRole('button', { name: /Entsperren|Unlock/ }).click();
		await expect(page.getByRole('alert').or(page.getByRole('status'))).toBeVisible();
	}
	await expect(page.getByRole('status')).toContainText(/Warte|Wait/);
	await expect(page.getByRole('button', { name: /Entsperren|Unlock/ })).toBeDisabled();
});

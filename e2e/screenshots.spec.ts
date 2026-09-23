// Visual review helper, not a test: SHOTS_DIR=/path npx playwright test screenshots
// Captures every screen in a real (unlocked) state at 390/820/1440 × light/dark.
import { test, type Browser, type Page } from '@playwright/test';

const DIR = process.env.SHOTS_DIR;
const PW = 'zehn zeichen mindestens';
const WIDTHS = [390, 820, 1440] as const;
const SCHEMES = ['light', 'dark'] as const;

test.skip(!DIR, 'set SHOTS_DIR to capture screenshots');
test.setTimeout(120_000);

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
	await test.expect(f).not.toHaveValue('', { timeout: 15_000 });
	return f.inputValue();
}

async function paste(page: Page, text: string) {
	await page.getByRole('tab', { name: /Code scannen|Scan code/ }).click();
	const field = page.getByTestId('paste-field');
	if (!(await field.isVisible())) {
		await page.getByRole('button', { name: /als Text einfügen|Paste code/ }).click({ timeout: 3000 }).catch(() => {});
	}
	await field.waitFor();
	await field.fill(text);
	await page.getByRole('button', { name: /Übernehmen|Apply/ }).click();
}

async function shot(page: Page, name: string, width: number, scheme: string) {
	await page.waitForTimeout(300);
	await page.screenshot({ path: `${DIR}/${name}_${width}_${scheme}.png`, fullPage: true });
}

for (const scheme of SCHEMES) {
	for (const width of WIDTHS) {
		test(`screens ${width} ${scheme}`, async ({ browser }: { browser: Browser }) => {
			const height = width < 800 ? 844 : 900;
			const perms = ['clipboard-read', 'clipboard-write'];
			const ctxA = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: 'de-DE', permissions: perms, acceptDownloads: true });
			const ctxB = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: 'de-DE', permissions: perms });
			const a = await ctxA.newPage();
			const b = await ctxB.newPage();

			await a.goto('/');
			await shot(a, '01_onboarding', width, scheme);
			await onboard(a, 'Alice');
			await onboard(b, 'Bob');
			await shot(a, '02_home_empty', width, scheme);

			await a.getByTestId('add-contact').click();
			const offer = await envelope(a);
			await shot(a, '03_add_show', width, scheme);

			await b.getByTestId('add-contact').click();
			await b.getByRole('tab', { name: /Code scannen|Scan code/ }).click();
			await b.getByTestId('paste-field').waitFor({ timeout: 5000 }).catch(() => {});
			await shot(b, '04_add_scan', width, scheme);
			await paste(b, offer);
			await b.getByTestId('confirm').waitFor();
			await shot(b, '05_add_confirm', width, scheme);
			await b.getByRole('button', { name: /^Hinzufügen$|^Add$/ }).click();
			const answer = await envelope(b);
			await shot(b, '06_add_answer', width, scheme);

			await paste(a, answer);
			await a.getByTestId('done').waitFor();
			await shot(a, '07_add_done', width, scheme);

			await a.getByRole('link', { name: /Zum Kontakt|Open contact/ }).click();
			await a.getByTestId('safety-number').waitFor();
			await shot(a, '08_contact_detail', width, scheme);
			await a.getByRole('link', { name: /Zurück|Back/ }).click();
			await a.getByTestId('contact-list').waitFor();
			await shot(a, '09_home_list', width, scheme);

			// Chat: A sends two, B imports one and replies; import sheet; settings.
			await a.getByTestId('contact-list').getByRole('link', { name: /Bob/ }).click();
			await a.getByTestId('composer').fill('Hallo Bob 👋 – das ist ein verschlüsselter Umschlag, der über Telegram wandert.');
			await a.getByTestId('send').click();
			await a.getByTestId('msg-out').first().waitFor();
			await a.bringToFront();
			const env1 = await a.evaluate(() => navigator.clipboard.readText());
			await b.bringToFront();
			await b.getByRole('button', { name: /Zum Kontakt|Open contact/ }).click();
			await b.getByRole('link', { name: /Zurück|Back/ }).click();
			await b.getByTestId('contact-list').getByRole('link', { name: /Alice/ }).click();
			await b.getByTestId('chat-import').click();
			await shot(b, '11_import_sheet', width, scheme);
			await b.getByTestId('inbox-paste').click();
			await b.getByTestId('inbox-field').fill(env1);
			await b.getByTestId('inbox-submit').click();
			await b.getByTestId('msg-in').first().waitFor();
			await b.getByTestId('composer').fill('Angekommen! 🔐');
			await b.getByTestId('send').click();
			await b.getByTestId('msg-out').first().waitFor();
			await b.bringToFront();
			const env2 = await b.evaluate(() => navigator.clipboard.readText());
			await a.getByTestId('chat-import').click();
			await a.getByTestId('inbox-paste').click();
			await a.getByTestId('inbox-field').fill(env2);
			await a.getByTestId('inbox-submit').click();
			await a.getByTestId('msg-in').first().waitFor();
			// attachments: a text file and a small image
			const dlp = a.waitForEvent('download');
			await a.getByTestId('file-input').setInputFiles({ name: 'vertrag.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(240_000, 7) });
			const encPath = await (await dlp).path();
			const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBBAMDAB1wBf1zqK5CAAAAAElFTkSuQmCC', 'base64');
			const dlp2 = a.waitForEvent('download');
			await a.getByTestId('file-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png });
			await (await dlp2).path();
			await shot(a, '12_chat', width, scheme);
			await b.getByTestId('chat-import').click();
			await b.getByTestId('inbox-file-input').setInputFiles(encPath!);
			await b.getByTestId('file-bubble').first().waitFor();
			await shot(b, '15_chat_file_received', width, scheme);
			await a.getByRole('link', { name: /Zurück|Back/ }).click();
			await a.getByTestId('contact-list').waitFor();
			await shot(a, '13_home_preview', width, scheme);
			await a.getByRole('link', { name: /Einstellungen|Settings/ }).click();
			await a.getByText(/Master-Passwort ändern|Change master/).waitFor();
			await shot(a, '14_settings', width, scheme);
			await a.getByRole('link', { name: /Zurück|Back/ }).click();

			await a.getByRole('button', { name: /Jetzt sperren|Lock now/ }).click();
			await a.locator('input[type="password"]').waitFor();
			await shot(a, '10_lock', width, scheme);

			await ctxA.close();
			await ctxB.close();
		});
	}
}

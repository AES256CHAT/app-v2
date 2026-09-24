<script lang="ts">
	// Restore a backup on a fresh device: pick the file, enter its passphrase, confirm, done.
	// The backup passphrase becomes the master passphrase of the new vault.
	import { goto } from '$app/navigation';
	import { AuthError } from '$lib/crypto/aead';
	import { t } from '$lib/i18n/index.svelte';
	import { toast } from '$lib/store/toast.svelte';
	import type { BackupPayload } from '$lib/vault/backup';
	import { inspectBackup, restoreBackup } from '$lib/vault/backup-service';
	import { vault } from '$lib/vault/vault.svelte';

	let file = $state<File | null>(null);
	let pw = $state('');
	let payload = $state<BackupPayload | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function check(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		if (!file) return;
		busy = true;
		try {
			payload = await inspectBackup(new Uint8Array(await file.arrayBuffer()), pw);
		} catch (err) {
			error = err instanceof AuthError ? t('bkWrongPw') : t('bkInvalid');
		} finally {
			busy = false;
		}
	}

	async function apply() {
		if (!payload) return;
		busy = true;
		try {
			if (vault.status !== 'none') await vault.destroy();
			await restoreBackup(payload, pw);
			toast.show(t('bkRestored', { n: payload.contacts.length }));
			goto('/', { replaceState: true });
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<main class="flex flex-1 flex-col gap-5 p-6">
	<header class="flex items-center gap-3">
		<a href="/onboarding" class="text-muted text-sm" aria-label={t('back')}>←</a>
		<h1 class="text-xl font-semibold">{t('bkRestoreTitle')}</h1>
	</header>
	<p class="text-muted text-sm">{t('bkRestoreIntro')}</p>
	<form class="flex flex-col gap-3" onsubmit={check}>
		<input class="field" type="file" accept=".a256bak" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} data-testid="restore-file" />
		<input class="field" type="password" bind:value={pw} placeholder={t('bkFilePw')} autocomplete="off" required data-testid="restore-pw" />
		{#if error}<p class="text-danger text-sm" role="alert">{error}</p>{/if}
		{#if payload}
			<div class="bg-surface border-border rounded-2xl border p-4 text-sm" data-testid="restore-confirm">
				<p>{t('bkRestoreFound', { name: payload.me.name, n: payload.contacts.length, date: new Date(payload.createdAt).toLocaleDateString() })}</p>
				<p class="text-muted mt-2 text-xs">{t('bkStaleHint')}</p>
				<button type="button" class="btn-primary mt-3 w-full" onclick={apply} disabled={busy} data-testid="restore-apply">{t('bkRestoreApply')}</button>
			</div>
		{:else}
			<button class="btn-primary" type="submit" disabled={busy || !file || !pw}>{t('bkRestoreCheck')}</button>
		{/if}
	</form>
</main>

<style>
	.field {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.6rem 0.75rem;
	}
	.btn-primary {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-radius: 0.75rem;
		padding: 0.7rem 1rem;
		font-weight: 600;
	}
	.btn-primary:disabled {
		opacity: 0.5;
	}
</style>

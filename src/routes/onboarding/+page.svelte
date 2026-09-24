<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';
	import { MIN_PASSPHRASE_LEN } from '$lib/vault/vault';
	import { vault } from '$lib/vault/vault.svelte';
	import { createMe } from '$lib/vault/me';
	import type { HistoryMode } from '$lib/vault/db';

	let name = $state('');
	let pw = $state('');
	let pw2 = $state('');
	let history = $state<HistoryMode>('ephemeral');
	let destroyAfterFails = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const valid = $derived(name.trim().length > 0 && pw.length >= MIN_PASSPHRASE_LEN && pw === pw2);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		if (pw.length < MIN_PASSPHRASE_LEN) return (error = t('onbPassShort', { min: MIN_PASSPHRASE_LEN }));
		if (pw !== pw2) return (error = t('onbPassMismatch'));
		busy = true;
		try {
			await vault.create(pw, { history, destroyAfterFails });
			await createMe(name.trim());
			pw = pw2 = '';
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<main class="flex flex-1 flex-col gap-6 p-6">
	<header class="space-y-2">
		<h1 class="text-2xl font-semibold">{t('onbTitle')}</h1>
		<p class="text-muted text-sm">{t('onbIntro')}</p>
	</header>

	<form class="flex flex-col gap-5" onsubmit={submit}>
		<label class="flex flex-col gap-1">
			<span class="text-sm font-medium">{t('onbName')}</span>
			<input class="field" bind:value={name} maxlength="32" autocomplete="off" required />
			<span class="text-muted text-xs">{t('onbNameHint')}</span>
		</label>

		<label class="flex flex-col gap-1">
			<span class="text-sm font-medium">{t('onbPass')}</span>
			<input class="field" type="password" bind:value={pw} autocomplete="new-password" required />
			<span class="text-muted text-xs">{t('onbPassHint', { min: MIN_PASSPHRASE_LEN })}</span>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-sm font-medium">{t('onbPassRepeat')}</span>
			<input class="field" type="password" bind:value={pw2} autocomplete="new-password" required />
		</label>

		<fieldset class="flex flex-col gap-2">
			<legend class="mb-1 text-sm font-medium">{t('onbHistory')}</legend>
			<label class="option" class:selected={history === 'ephemeral'}>
				<input type="radio" bind:group={history} value="ephemeral" class="mt-1" />
				<span><b>{t('onbEphemeral')}</b><br /><span class="text-muted text-xs">{t('onbEphemeralHint')}</span></span>
			</label>
			<label class="option" class:selected={history === 'persist'}>
				<input type="radio" bind:group={history} value="persist" class="mt-1" />
				<span><b>{t('onbPersist')}</b><br /><span class="text-muted text-xs">{t('onbPersistHint')}</span></span>
			</label>
		</fieldset>

		<label class="option" class:selected={destroyAfterFails}>
			<input type="checkbox" bind:checked={destroyAfterFails} class="mt-1" />
			<span><b>{t('onbDestroy')}</b><br /><span class="text-muted text-xs">{t('onbDestroyHint')}</span></span>
		</label>

		{#if error}<p class="text-danger text-sm" role="alert">{error}</p>{/if}

		<button class="btn-primary" type="submit" disabled={!valid || busy}>
			{busy ? t('onbCreating') : t('onbCreate')}
		</button>
	</form>
	<a href="/restore" class="text-muted self-center text-sm underline" data-testid="onb-restore">{t('onbRestore')}</a>
</main>

<style>
	.field {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.625rem 0.75rem;
		font-size: 1rem;
	}
	.field:focus {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	.option {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.75rem;
		cursor: pointer;
	}
	.option.selected {
		border-color: var(--color-accent);
	}
	.btn-primary {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-radius: 0.75rem;
		padding: 0.75rem 1rem;
		font-weight: 600;
	}
	.btn-primary:disabled {
		opacity: 0.5;
	}
</style>

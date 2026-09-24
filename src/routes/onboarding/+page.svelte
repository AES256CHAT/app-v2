<script lang="ts">
	import { t, type Key } from '$lib/i18n/index.svelte';
	import { MIN_PASSPHRASE_LEN } from '$lib/vault/vault';
	import { estimate, suggestPassphrase } from '$lib/vault/strength';
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

	const strength = $derived(estimate(pw));
	let showPw = $state(false);
	const valid = $derived(name.trim().length > 0 && pw.length >= MIN_PASSPHRASE_LEN && pw === pw2 && strength.score >= 1);

	function suggest() {
		const s = suggestPassphrase();
		pw = s;
		pw2 = s;
		showPw = true;
	}

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
			<input class="field" type={showPw ? 'text' : 'password'} bind:value={pw} autocomplete="new-password" required data-testid="pw1" />
			<span class="text-muted text-xs">{t('onbPassHint', { min: MIN_PASSPHRASE_LEN })}</span>
		</label>
		{#if pw.length > 0}
			<div class="-mt-2 flex flex-col gap-1" data-testid="strength" data-score={strength.score}>
				<div class="flex gap-1" aria-hidden="true">
					{#each [1, 2, 3, 4] as i (i)}
						<span class="h-1.5 flex-1 rounded-full {i <= strength.score ? (strength.score <= 1 ? 'bg-danger' : strength.score === 2 ? 'bg-warn' : 'bg-accent') : 'bg-surface-2'}"></span>
					{/each}
				</div>
				<p class="text-xs {strength.score <= 1 ? 'text-danger' : strength.score === 2 ? 'text-warn' : 'text-muted'}">
					{t(`strength${strength.score}` as Key)}{#if strength.hints[0]} · {t(`hint_${strength.hints[0]}` as Key)}{/if}
				</p>
			</div>
		{/if}
		<div class="-mt-1 flex items-center justify-between gap-3 text-xs">
			<button type="button" class="text-accent font-medium underline" onclick={suggest} data-testid="suggest">{t('pwSuggest')}</button>
			<label class="text-muted flex items-center gap-1"><input type="checkbox" bind:checked={showPw} /> {t('pwShow')}</label>
		</div>
		<label class="flex flex-col gap-1">
			<span class="text-sm font-medium">{t('onbPassRepeat')}</span>
			<input class="field" type={showPw ? 'text' : 'password'} bind:value={pw2} autocomplete="new-password" required data-testid="pw2" />
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

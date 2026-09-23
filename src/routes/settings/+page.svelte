<script lang="ts">
	import { AuthError } from '$lib/crypto/aead';
	import { i18n, t } from '$lib/i18n/index.svelte';
	import { toast } from '$lib/store/toast.svelte';
	import { MIN_PASSPHRASE_LEN } from '$lib/vault/vault';
	import { vault, vaultState } from '$lib/vault/vault.svelte';
	import type { HistoryMode } from '$lib/vault/db';

	const info = $derived(vault.info);
	let history = $state<HistoryMode>(vault.info?.history ?? 'ephemeral');
	let retention = $state(vault.info?.retentionDays ?? 7);
	let destroy = $state(vault.info?.destroyAfterFails ?? false);
	let oldPw = $state('');
	let newPw = $state('');
	let pwError = $state<string | null>(null);
	let confirmWipe = $state(false);

	const autoLockOptions = [1, 2, 5, 10, 30];
	const retentionOptions = [1, 7, 30, 0];

	async function saveHistory(h: HistoryMode) {
		history = h;
		await vault.updateSettings({ history: h });
	}
	async function saveRetention(d: number) {
		retention = d;
		await vault.updateSettings({ retentionDays: d });
	}
	async function saveDestroy(v: boolean) {
		destroy = v;
		await vault.updateSettings({ destroyAfterFails: v });
	}

	async function changePass(e: SubmitEvent) {
		e.preventDefault();
		pwError = null;
		if (newPw.length < MIN_PASSPHRASE_LEN) return (pwError = t('onbPassShort', { min: MIN_PASSPHRASE_LEN }));
		try {
			await vault.changePassphrase(oldPw, newPw);
			oldPw = newPw = '';
			toast.show(t('setPassChanged'));
		} catch (err) {
			pwError = err instanceof AuthError ? t('lockWrong') : (err as Error).message;
		}
	}
</script>

<main class="flex flex-1 flex-col gap-5 p-6">
	<header class="flex items-center gap-3">
		<a href="/" class="text-muted text-sm" aria-label={t('back')}>←</a>
		<h1 class="text-xl font-semibold">{t('settings')}</h1>
	</header>

	<section class="card">
		<label class="row">
			<span>{t('setLanguage')}</span>
			<select class="field" value={i18n.lang} onchange={(e) => i18n.set((e.currentTarget as HTMLSelectElement).value as 'de' | 'en')}>
				<option value="de">Deutsch</option>
				<option value="en">English</option>
			</select>
		</label>
		<label class="row">
			<span>{t('setAutoLock')}</span>
			<select class="field" value={String(vaultState.autoLockMinutes)} onchange={(e) => vaultState.setAutoLockMinutes(Number((e.currentTarget as HTMLSelectElement).value))}>
				{#each autoLockOptions as m (m)}<option value={String(m)}>{t('setMinutes', { n: m })}</option>{/each}
			</select>
		</label>
	</section>

	<section class="card">
		<div class="mb-2 font-medium">{t('setHistory')}</div>
		<label class="option" class:selected={history === 'ephemeral'}>
			<input type="radio" checked={history === 'ephemeral'} onchange={() => saveHistory('ephemeral')} />
			<span><b>{t('onbEphemeral')}</b><br /><span class="text-muted text-xs">{t('onbEphemeralHint')}</span></span>
		</label>
		<label class="option mt-2" class:selected={history === 'persist'}>
			<input type="radio" checked={history === 'persist'} onchange={() => saveHistory('persist')} />
			<span><b>{t('onbPersist')}</b><br /><span class="text-muted text-xs">{t('onbPersistHint')}</span></span>
		</label>
		{#if history === 'persist'}
			<label class="row mt-3">
				<span>{t('setRetention')}</span>
				<select class="field" value={String(retention)} onchange={(e) => saveRetention(Number((e.currentTarget as HTMLSelectElement).value))}>
					{#each retentionOptions as d (d)}
						<option value={String(d)}>{d === 0 ? t('setRetentionNever') : t('setRetentionDays', { n: d })}</option>
					{/each}
				</select>
			</label>
		{/if}
		<label class="option mt-3" class:selected={destroy}>
			<input type="checkbox" checked={destroy} onchange={(e) => saveDestroy((e.currentTarget as HTMLInputElement).checked)} />
			<span><b>{t('setDestroy')}</b><br /><span class="text-muted text-xs">{t('onbDestroyHint')}</span></span>
		</label>
	</section>

	<form class="card flex flex-col gap-2" onsubmit={changePass}>
		<div class="font-medium">{t('setChangePass')}</div>
		<input class="field" type="password" bind:value={oldPw} placeholder={t('setOldPass')} autocomplete="current-password" required />
		<input class="field" type="password" bind:value={newPw} placeholder={t('setNewPass')} autocomplete="new-password" required />
		{#if pwError}<p class="text-danger text-sm" role="alert">{pwError}</p>{/if}
		<button class="btn" type="submit" disabled={!oldPw || !newPw}>{t('save')}</button>
	</form>

	<section class="card">
		<div class="font-medium">{t('setWipe')}</div>
		<p class="text-muted mt-1 text-xs">{t('setWipeHint')}</p>
		{#if !confirmWipe}
			<button class="btn text-danger mt-3" onclick={() => (confirmWipe = true)}>{t('setWipe')}</button>
		{:else}
			<p class="text-danger mt-3 text-sm">{t('setWipeConfirm')}</p>
			<div class="mt-2 flex gap-2">
				<button class="btn" onclick={() => (confirmWipe = false)}>{t('cancel')}</button>
				<button class="btn text-danger font-semibold" onclick={() => vault.destroy()}>{t('yes')}</button>
			</div>
		{/if}
	</section>

	<p class="text-muted text-center text-xs">{t('setAbout')} · {info ? new Date(info.createdAt).toLocaleDateString() : ''}</p>
</main>

<style>
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 1rem;
		padding: 1rem;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.4rem 0;
	}
	.field {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0.6rem;
		padding: 0.45rem 0.6rem;
	}
	.option {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.75rem;
		cursor: pointer;
	}
	.option.selected {
		border-color: var(--color-accent);
	}
	.btn {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.55rem 0.9rem;
		text-align: left;
	}
	.btn:disabled {
		opacity: 0.5;
	}
</style>

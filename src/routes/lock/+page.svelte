<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';
	import { AuthError } from '$lib/crypto/aead';
	import { DESTROY_AFTER, DestroyedError, LockoutError } from '$lib/vault/vault';
	import { vault } from '$lib/vault/vault.svelte';

	let pw = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let waitUntil = $state(0);
	let now = $state(Date.now());
	let confirmReset = $state(false);

	const waitSeconds = $derived(Math.max(0, Math.ceil((waitUntil - now) / 1000)));

	$effect(() => {
		if (waitUntil <= now) return;
		const id = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(id);
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		busy = true;
		try {
			await vault.unlock(pw);
			pw = '';
		} catch (err) {
			if (err instanceof LockoutError) {
				waitUntil = err.until;
				now = Date.now();
			} else if (err instanceof DestroyedError) {
				error = t('lockDestroyed');
			} else if (err instanceof AuthError) {
				const info = vault.info;
				const nextLock = info ? info.lockoutUntil : 0;
				if (nextLock > Date.now()) {
					waitUntil = nextLock;
					now = Date.now();
				}
				error =
					info?.destroyAfterFails
						? t('lockWrongLeft', { n: DESTROY_AFTER - info.failedAttempts })
						: t('lockWrong');
			} else {
				error = (err as Error).message;
			}
			pw = '';
		} finally {
			busy = false;
		}
	}

	async function reset() {
		await vault.destroy();
	}
</script>

<main class="flex flex-1 flex-col items-center justify-center gap-6 p-6">
	<div class="text-5xl" aria-hidden="true">🛡️</div>
	<h1 class="text-2xl font-semibold">{t('lockTitle')}</h1>

	<form class="flex w-full max-w-sm flex-col gap-3" onsubmit={submit}>
		<input
			class="field"
			type="password"
			bind:value={pw}
			placeholder={t('lockPass')}
			autocomplete="current-password"
			disabled={busy || waitSeconds > 0}
			required
		/>
		{#if waitSeconds > 0}
			<p class="text-warn text-sm" role="status">{t('lockWait', { s: waitSeconds })}</p>
		{:else if error}
			<p class="text-danger text-sm" role="alert">{error}</p>
		{/if}
		<button class="btn-primary" type="submit" disabled={busy || waitSeconds > 0 || !pw}>{t('lockUnlock')}</button>
	</form>

	<div class="text-muted mt-6 max-w-sm text-center text-xs">
		<p>{t('lockForgot')}</p>
		{#if !confirmReset}
			<button class="text-danger mt-2 underline" onclick={() => (confirmReset = true)}>{t('lockReset')}</button>
		{:else}
			<p class="text-danger mt-2">{t('lockResetConfirm')}</p>
			<div class="mt-2 flex justify-center gap-4">
				<button class="underline" onclick={() => (confirmReset = false)}>{t('cancel')}</button>
				<button class="text-danger font-semibold underline" onclick={reset}>{t('yes')}</button>
			</div>
		{/if}
	</div>
</main>

<style>
	.field {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.75rem;
		font-size: 1.1rem;
		text-align: center;
	}
	.field:focus {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
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

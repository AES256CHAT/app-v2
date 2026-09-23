<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import { vaultState } from '$lib/vault/vault.svelte';
	import { t } from '$lib/i18n/index.svelte';

	let { children } = $props();

	onMount(() => {
		vaultState.start();
	});

	// Route guard: no vault → onboarding, locked → lock screen, otherwise keep the user out of both.
	$effect(() => {
		const s = vaultState.status;
		const p = page.url.pathname;
		if (s === 'none' && p !== '/onboarding') goto('/onboarding', { replaceState: true });
		else if (s === 'locked' && p !== '/lock') goto('/lock', { replaceState: true });
		else if (s === 'unlocked' && (p === '/lock' || p === '/onboarding')) goto('/', { replaceState: true });
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{t('appName')}</title>
</svelte:head>

<div id="app" class="mx-auto flex min-h-full max-w-xl flex-col">
	{#if vaultState.status === 'loading'}
		<div class="flex flex-1 items-center justify-center text-muted">…</div>
	{:else}
		{@render children()}
	{/if}
</div>

{#if vaultState.lockWarning !== null}
	<div
		class="bg-warn fixed inset-x-0 top-0 z-50 flex items-center justify-between px-4 py-2 text-sm font-medium text-black"
		role="status"
	>
		<span>{t('lockSoon', { s: vaultState.lockWarning })}</span>
		<button class="underline" onclick={() => vaultState.lock()}>{t('lockNow')}</button>
	</div>
{/if}

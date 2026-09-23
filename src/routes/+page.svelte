<script lang="ts">
	// Placeholder home — becomes the chat list in phase 3.
	import { onMount } from 'svelte';
	import { bundleOf, contactId, formatId } from '$lib/crypto/identity';
	import { loadMe } from '$lib/vault/me';
	import { vaultState } from '$lib/vault/vault.svelte';
	import { t } from '$lib/i18n/index.svelte';

	let name = $state('');
	let id = $state('');

	onMount(async () => {
		const me = await loadMe();
		if (me) {
			name = me.name;
			id = formatId(contactId(bundleOf(me.identity)));
		}
	});
</script>

<main class="flex flex-1 flex-col gap-6 p-6">
	<header class="flex items-center justify-between">
		<h1 class="text-xl font-semibold">{t('appName')}</h1>
		<button class="text-muted text-sm underline" onclick={() => vaultState.lock()}>{t('lockNow')}</button>
	</header>
	<section class="bg-surface border-border rounded-xl border p-4" data-testid="me">
		<div class="font-medium">{name}</div>
		<code class="text-muted font-mono text-sm">{id}</code>
	</section>
</main>

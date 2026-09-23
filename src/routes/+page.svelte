<script lang="ts">
	// Home: contact list (becomes the chat list with previews in phase 3).
	import { onMount } from 'svelte';
	import { bundleOf, contactId, formatId } from '$lib/crypto/identity';
	import { t } from '$lib/i18n/index.svelte';
	import { contacts } from '$lib/store/contacts.svelte';
	import { loadMe } from '$lib/vault/me';
	import { vaultState } from '$lib/vault/vault.svelte';

	let name = $state('');
	let id = $state('');

	onMount(async () => {
		const me = await loadMe();
		if (me) {
			name = me.name;
			id = formatId(contactId(bundleOf(me.identity)));
		}
		await contacts.refresh();
	});
</script>

<main class="flex flex-1 flex-col gap-5 p-6">
	<header class="flex items-center justify-between">
		<h1 class="text-xl font-semibold">{t('appName')}</h1>
		<button class="text-muted text-sm underline" onclick={() => vaultState.lock()}>{t('lockNow')}</button>
	</header>

	<section class="bg-surface border-border flex items-center justify-between rounded-xl border p-4" data-testid="me">
		<div>
			<div class="font-medium">{name}</div>
			<div class="text-muted text-xs">{t('myId')}</div>
			<code class="font-mono text-sm">{id}</code>
		</div>
		<a href="/contacts/add" class="btn-primary" data-testid="add-contact">+ {t('addContact')}</a>
	</section>

	{#if contacts.loaded && contacts.items.length === 0}
		<section class="text-muted flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm">
			<p class="text-fg font-medium">{t('homeEmpty')}</p>
			<p class="max-w-xs">{t('homeEmptyHint')}</p>
		</section>
	{:else}
		<ul class="flex flex-col gap-2" data-testid="contact-list">
			{#each contacts.items as c (c.id)}
				<li>
					<a href={`/contacts/${c.id}`} class="bg-surface border-border flex items-center gap-3 rounded-xl border p-3">
						<span class="bg-surface-2 flex h-10 w-10 items-center justify-center rounded-full font-semibold">
							{c.name.slice(0, 1).toUpperCase()}
						</span>
						<span class="flex-1">
							<span class="block font-medium">{c.name}{#if c.verified}<span class="text-accent ml-1 text-xs">✔</span>{/if}</span>
							<code class="text-muted font-mono text-xs">{formatId(c.id)}</code>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.btn-primary {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-radius: 0.75rem;
		padding: 0.5rem 0.9rem;
		font-size: 0.9rem;
		font-weight: 600;
		white-space: nowrap;
	}
</style>

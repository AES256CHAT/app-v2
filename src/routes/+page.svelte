<script lang="ts">
	// Home: chat list with previews, unread counts, and the import entry point.
	import { onMount } from 'svelte';
	import ImportSheet from '$lib/components/ImportSheet.svelte';
	import { bundleOf, contactId, formatId } from '$lib/crypto/identity';
	import { t } from '$lib/i18n/index.svelte';
	import { contacts } from '$lib/store/contacts.svelte';
	import { messages } from '$lib/store/messages.svelte';
	import { loadMe } from '$lib/vault/me';
	import { vaultState } from '$lib/vault/vault.svelte';

	let name = $state('');
	let id = $state('');
	let showImport = $state(false);

	onMount(async () => {
		const me = await loadMe();
		if (me) {
			name = me.name;
			id = formatId(contactId(bundleOf(me.identity)));
		}
		await contacts.refresh();
		await messages.loadAll();
	});

	const fmtDay = (ts: number) => {
		const d = new Date(ts);
		const today = new Date();
		return d.toDateString() === today.toDateString()
			? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			: d.toLocaleDateString();
	};
</script>

<main class="flex flex-1 flex-col gap-4 p-4 sm:p-6">
	<header class="flex items-center justify-between">
		<h1 class="text-xl font-semibold">{t('appName')}</h1>
		<div class="flex items-center gap-3">
			<a href="/settings" class="text-muted text-sm" aria-label={t('settings')}>⚙️</a>
			<button class="text-muted text-sm underline" onclick={() => vaultState.lock()}>{t('lockNow')}</button>
		</div>
	</header>

	<section class="bg-surface border-border flex items-center justify-between gap-3 rounded-xl border p-3" data-testid="me">
		<div class="min-w-0">
			<div class="truncate font-medium">{name}</div>
			<div class="text-muted text-xs">{t('myId')}</div>
			<code class="font-mono text-xs sm:text-sm">{id}</code>
		</div>
		<div class="flex shrink-0 flex-col gap-2">
			<a href="/contacts/add" class="btn-primary text-center" data-testid="add-contact">+ {t('addContact')}</a>
			<button class="btn-secondary" onclick={() => (showImport = true)} data-testid="home-import">📥 {t('inboxTitle')}</button>
		</div>
	</section>

	{#if contacts.loaded && contacts.items.length === 0}
		<section class="text-muted flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm">
			<p class="text-fg font-medium">{t('homeEmpty')}</p>
			<p class="max-w-xs">{t('homeEmptyHint')}</p>
		</section>
	{:else}
		<ul class="flex flex-col gap-2" data-testid="contact-list">
			{#each contacts.items as c (c.id)}
				{@const last = messages.last(c.id)}
				{@const unread = messages.unread[c.id] ?? 0}
				<li>
					<a href={`/chat/${c.id}`} class="bg-surface border-border flex items-center gap-3 rounded-xl border p-3">
						<span class="bg-surface-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-semibold">
							{c.name.slice(0, 1).toUpperCase()}
						</span>
						<span class="min-w-0 flex-1">
							<span class="flex items-baseline justify-between gap-2">
								<span class="truncate font-medium">{c.name}{#if c.verified}<span class="text-accent ml-1 text-xs">✔</span>{/if}</span>
								{#if last}<span class="text-muted shrink-0 text-xs">{fmtDay(last.ts)}</span>{/if}
							</span>
							<span class="text-muted block truncate text-sm">
								{#if last}{last.dir === 'out' ? '🔒 ' : ''}{last.body}{:else}<code class="font-mono text-xs">{formatId(c.id)}</code>{/if}
							</span>
						</span>
						{#if unread > 0}
							<span class="bg-accent text-accent-fg rounded-full px-2 py-0.5 text-xs font-semibold" data-testid="unread">{unread}</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>

{#if showImport}
	<ImportSheet onclose={() => (showImport = false)} />
{/if}

<style>
	.btn-primary {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-radius: 0.75rem;
		padding: 0.45rem 0.8rem;
		font-size: 0.85rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.btn-secondary {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.45rem 0.8rem;
		font-size: 0.85rem;
		white-space: nowrap;
	}
</style>

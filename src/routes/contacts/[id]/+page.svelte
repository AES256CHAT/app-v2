<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { bundleOf, formatId, formatSafetyNumber, safetyNumber } from '$lib/crypto/identity';
	import { t } from '$lib/i18n/index.svelte';
	import { bundleOfRecord, contacts } from '$lib/store/contacts.svelte';
	import { messages } from '$lib/store/messages.svelte';
	import { loadMe } from '$lib/vault/me';

	const id = $derived(page.params.id ?? '');
	const contact = $derived(contacts.get(id));
	let sn = $state('');
	let renaming = $state(false);
	let newName = $state('');
	let confirmDelete = $state(false);

	onMount(async () => {
		if (!contacts.loaded) await contacts.refresh();
		const me = await loadMe();
		const c = contacts.get(id);
		if (me && c) sn = safetyNumber(bundleOf(me.identity), bundleOfRecord(c));
	});

	async function toggleVerified() {
		if (contact) await contacts.update(contact.id, { verified: !contact.verified });
	}

	async function rename() {
		if (contact && newName.trim()) await contacts.update(contact.id, { name: newName.trim() });
		renaming = false;
	}

	async function remove() {
		if (contact) {
			await messages.clearContact(contact.id);
			await contacts.remove(contact.id);
		}
		goto('/');
	}
</script>

<main class="flex flex-1 flex-col gap-5 p-6">
	<header class="flex items-center gap-3">
		<a href="/" class="text-muted text-sm" aria-label={t('back')}>←</a>
		<h1 class="text-xl font-semibold">{contact?.name ?? '…'}</h1>
		{#if contact?.verified}<span class="text-accent text-sm" title={t('contactVerifiedOn')}>✔</span>{/if}
	</header>

	{#if contact}
		<section class="bg-surface border-border rounded-2xl border p-4">
			<div class="text-muted text-xs">ID</div>
			<code class="font-mono text-sm" data-testid="contact-id">{formatId(contact.id)}</code>
			<div class="text-muted mt-2 text-xs">{t('contactAdded', { date: new Date(contact.createdAt).toLocaleDateString() })}</div>
		</section>

		<section class="bg-surface border-border rounded-2xl border p-4">
			<h2 class="font-medium">{t('contactSafety')}</h2>
			<p class="text-muted mt-1 text-xs">{t('contactSafetyHint')}</p>
			<div class="mt-3 grid grid-cols-4 gap-x-3 gap-y-1 font-mono text-sm" data-testid="safety-number">
				{#each formatSafetyNumber(sn).split(' ') as group, i (i)}
					<span>{group}</span>
				{/each}
			</div>
			<label class="mt-4 flex items-center gap-2 text-sm">
				<input type="checkbox" checked={contact.verified} onchange={toggleVerified} />
				{t('contactVerified')}
			</label>
		</section>

		<section class="flex flex-col gap-2">
			{#if renaming}
				<div class="flex gap-2">
					<input class="field flex-1" bind:value={newName} maxlength="32" />
					<button class="btn" onclick={rename}>{t('save')}</button>
					<button class="btn" onclick={() => (renaming = false)}>{t('cancel')}</button>
				</div>
			{:else}
				<button class="btn" onclick={() => ((newName = contact?.name ?? ''), (renaming = true))}>{t('contactRename')}</button>
			{/if}
			{#if !confirmDelete}
				<button class="btn text-danger" onclick={() => (confirmDelete = true)}>{t('contactDelete')}</button>
			{:else}
				<div class="bg-surface border-danger flex flex-col gap-2 rounded-xl border p-3 text-sm">
					<p>{t('contactDeleteConfirm')}</p>
					<div class="flex gap-2">
						<button class="btn" onclick={() => (confirmDelete = false)}>{t('cancel')}</button>
						<button class="btn text-danger font-semibold" onclick={remove}>{t('yes')}</button>
					</div>
				</div>
			{/if}
		</section>
	{/if}
</main>

<style>
	.field {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.5rem 0.75rem;
	}
	.btn {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.6rem 0.9rem;
		text-align: left;
	}
</style>

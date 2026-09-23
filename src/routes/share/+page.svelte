<script lang="ts">
	// PWA share target (GET): /share?text=🛡️MSG:… — parked until the vault is unlocked,
	// then imported from the home screen. Nothing is stored; the URL is replaced right away.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { inbox } from '$lib/store/inbox.svelte';

	onMount(() => {
		const text = [page.url.searchParams.get('text'), page.url.searchParams.get('url'), page.url.searchParams.get('title')]
			.filter(Boolean)
			.join('\n');
		if (text) inbox.pendingShare = text;
		goto('/', { replaceState: true });
	});
</script>

<div class="text-muted flex flex-1 items-center justify-center">…</div>

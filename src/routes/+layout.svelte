<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>AES256CHAT</title>
</svelte:head>

<div id="app" class="mx-auto flex min-h-full max-w-xl flex-col">
	{@render children()}
</div>

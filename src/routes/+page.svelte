<script lang="ts">
	// Phase 0 placeholder — replaced by the chat list in phase 3.
	import { generateIdentity, bundleOf, contactId, formatId } from '$lib/crypto/identity';

	let id = $state<string | null>(null);

	function demo() {
		id = formatId(contactId(bundleOf(generateIdentity())));
	}
</script>

<main class="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
	<h1 class="text-2xl font-semibold">AES256CHAT v2</h1>
	<p class="text-muted max-w-sm text-sm">
		Serverloser, Ende-zu-Ende verschlüsselter Messenger. Phase 0: Krypto-Kern.
	</p>
	<button
		class="bg-accent text-accent-fg rounded-xl px-4 py-2 font-medium"
		onclick={demo}
	>
		Test-Identität erzeugen
	</button>
	{#if id}
		<code class="bg-surface-2 border-border rounded-lg border px-3 py-2 font-mono text-sm">{id}</code>
	{/if}
</main>

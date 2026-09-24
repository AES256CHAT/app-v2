// My identity + profile, stored encrypted in the vault and cached in memory while unlocked.

import { b64uDecode, b64uEncode } from '$lib/crypto/bytes';
import { generateIdentity, identityFromSecrets, type Identity } from '$lib/crypto/identity';
import { vault } from './vault.svelte';

export interface StoredIdentity {
	v: 1;
	edSec: string;
	xSec: string;
	kemSeed: string;
	createdAt: number;
	name: string;
}

export interface Me {
	identity: Identity;
	name: string;
}

let cache: Me | null = null;
vault.onChange((s) => {
	if (s !== 'unlocked') cache = null;
});

export async function createMe(name: string): Promise<Me> {
	const identity = generateIdentity();
	const rec: StoredIdentity = {
		v: 1,
		edSec: b64uEncode(identity.ed.sec),
		xSec: b64uEncode(identity.x.sec),
		kemSeed: b64uEncode(identity.kemSeed),
		createdAt: identity.createdAt,
		name
	};
	await vault.put('identity', 'me', rec);
	cache = { identity, name };
	return cache;
}

export async function loadMe(): Promise<Me | null> {
	if (cache) return cache;
	const rec = await vault.get<StoredIdentity>('identity', 'me');
	if (!rec) return null;
	cache = {
		identity: identityFromSecrets(b64uDecode(rec.edSec), b64uDecode(rec.xSec), b64uDecode(rec.kemSeed), rec.createdAt),
		name: rec.name
	};
	return cache;
}

/** Raw stored identity for backups. */
export async function exportMe(): Promise<StoredIdentity | undefined> {
	return vault.get<StoredIdentity>('identity', 'me');
}

/** Restore an identity from a backup (vault must be unlocked and empty). */
export async function importMe(rec: StoredIdentity): Promise<Me> {
	await vault.put('identity', 'me', rec);
	cache = {
		identity: identityFromSecrets(b64uDecode(rec.edSec), b64uDecode(rec.xSec), b64uDecode(rec.kemSeed), rec.createdAt),
		name: rec.name
	};
	return cache;
}

export async function renameMe(name: string): Promise<void> {
	const rec = await vault.get<StoredIdentity>('identity', 'me');
	if (!rec) throw new Error('no identity');
	await vault.put('identity', 'me', { ...rec, name });
	if (cache) cache = { ...cache, name };
}

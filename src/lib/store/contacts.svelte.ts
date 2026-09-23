// Contacts, their ratchet sessions and my outstanding offers — all encrypted in the vault.

import { b64uDecode, b64uEncode } from '$lib/crypto/bytes';
import {
	acceptOffer,
	answerOfferHash,
	createOffer,
	finalizeOffer,
	offerHash,
	type Contact,
	type PendingOffer
} from '$lib/crypto/handshake';
import { type PublicBundle } from '$lib/crypto/identity';
import { deserializeState, serializeState, type RatchetState, type RatchetStateJson } from '$lib/crypto/ratchet';
import type { Me } from '$lib/vault/me';
import { vault } from '$lib/vault/vault.svelte';

const T_CONTACTS = 'contacts';
const T_OFFERS = 'offers';
const MAX_OFFERS = 5;
const OFFER_TTL_MS = 30 * 86_400_000;

export interface ContactRecord {
	id: string;
	name: string;
	ed: string;
	x: string;
	verified: boolean;
	createdAt: number;
	lastActivity: number;
	session: RatchetStateJson;
}

export interface OfferRecord {
	id: string; // b64u(sha256(offer)).slice(0, 22)
	offer: string;
	ephPub: string;
	ephSec: string;
	createdAt: number;
}

export function bundleOfRecord(r: ContactRecord): PublicBundle {
	return { ed: b64uDecode(r.ed), x: b64uDecode(r.x) };
}

export function sessionOfRecord(r: ContactRecord): RatchetState {
	return deserializeState(r.session);
}

class ContactsState {
	items = $state<ContactRecord[]>([]);
	loaded = $state(false);

	async refresh(): Promise<void> {
		const rows = await vault.list<ContactRecord>(T_CONTACTS);
		this.items = rows.map((r) => r.value).sort((a, b) => b.lastActivity - a.lastActivity);
		this.loaded = true;
	}

	get(id: string): ContactRecord | undefined {
		return this.items.find((c) => c.id === id);
	}

	async add(contact: Contact, session: RatchetState): Promise<ContactRecord> {
		const existing = await vault.get<ContactRecord>(T_CONTACTS, contact.id);
		const now = Date.now();
		const rec: ContactRecord = {
			id: contact.id,
			name: contact.name,
			ed: b64uEncode(contact.bundle.ed),
			x: b64uEncode(contact.bundle.x),
			verified: existing?.verified ?? false,
			createdAt: existing?.createdAt ?? now,
			lastActivity: now,
			session: serializeState(session)
		};
		await vault.put(T_CONTACTS, rec.id, rec);
		await this.refresh();
		return rec;
	}

	async saveSession(id: string, session: RatchetState, touch = true): Promise<void> {
		const rec = await vault.get<ContactRecord>(T_CONTACTS, id);
		if (!rec) throw new Error('unknown contact');
		const next = { ...rec, session: serializeState(session), lastActivity: touch ? Date.now() : rec.lastActivity };
		await vault.put(T_CONTACTS, id, next);
		this.items = this.items.map((c) => (c.id === id ? next : c)).sort((a, b) => b.lastActivity - a.lastActivity);
	}

	async update(id: string, patch: Partial<Pick<ContactRecord, 'name' | 'verified'>>): Promise<void> {
		const rec = await vault.get<ContactRecord>(T_CONTACTS, id);
		if (!rec) throw new Error('unknown contact');
		const next = { ...rec, ...patch };
		await vault.put(T_CONTACTS, id, next);
		this.items = this.items.map((c) => (c.id === id ? next : c));
	}

	async remove(id: string): Promise<void> {
		await vault.delete(T_CONTACTS, id);
		await vault.deleteWhere('messages', id);
		this.items = this.items.filter((c) => c.id !== id);
	}

	// --- offers (my contact codes) ---------------------------------------------------------------

	private async offers(): Promise<OfferRecord[]> {
		const rows = await vault.list<OfferRecord>(T_OFFERS);
		return rows.map((r) => r.value).sort((a, b) => b.createdAt - a.createdAt);
	}

	/** Newest still-valid offer, or a fresh one. */
	async currentOffer(me: Me): Promise<OfferRecord> {
		const all = await this.offers();
		const fresh = all.find((o) => Date.now() - o.createdAt < OFFER_TTL_MS);
		return fresh ?? this.newOffer(me);
	}

	async newOffer(me: Me): Promise<OfferRecord> {
		const p = createOffer(me.identity, me.name);
		const rec: OfferRecord = {
			id: b64uEncode(offerHash(p.offer)).slice(0, 22),
			offer: b64uEncode(p.offer),
			ephPub: b64uEncode(p.eph.pub),
			ephSec: b64uEncode(p.eph.sec),
			createdAt: Date.now()
		};
		await vault.put(T_OFFERS, rec.id, rec);
		// Keep a small window of older offers so answers to a shared code still work.
		const all = await this.offers();
		for (const old of all.slice(MAX_OFFERS)) await vault.delete(T_OFFERS, old.id);
		for (const old of all) if (Date.now() - old.createdAt > OFFER_TTL_MS) await vault.delete(T_OFFERS, old.id);
		return rec;
	}

	/** B side: accept A's offer, store the session, return the answer bytes. */
	async acceptOffer(me: Me, offer: Uint8Array): Promise<{ answer: Uint8Array; contact: ContactRecord }> {
		const r = acceptOffer(me.identity, me.name, offer);
		const contact = await this.add(r.contact, r.session);
		return { answer: r.answer, contact };
	}

	/** A side: match the answer to one of my offers and finalise the session. */
	async finalizeAnswer(me: Me, answer: Uint8Array): Promise<ContactRecord> {
		const id = b64uEncode(answerOfferHash(answer)).slice(0, 22);
		const rec = await vault.get<OfferRecord>(T_OFFERS, id);
		if (!rec) throw new Error('offer-not-found');
		const pending: PendingOffer = {
			offer: b64uDecode(rec.offer),
			eph: { pub: b64uDecode(rec.ephPub), sec: b64uDecode(rec.ephSec) }
		};
		const r = finalizeOffer(me.identity, pending, answer);
		return this.add(r.contact, r.session);
	}
}

export const contacts = new ContactsState();
vault.onChange((s) => {
	if (s !== 'unlocked') {
		contacts.items = [];
		contacts.loaded = false;
	}
});

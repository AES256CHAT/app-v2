// Tiny i18n: DE/EN dictionary, language kept in localStorage (non-secret setting).

import { browser } from '$app/environment';
import { de } from './de';
import { en } from './en';

export type Lang = 'de' | 'en';
export type Key = keyof typeof de;

const dicts: Record<Lang, Record<Key, string>> = { de, en: en as Record<Key, string> };

function detect(): Lang {
	if (!browser) return 'de';
	try {
		const saved = localStorage.getItem('lang');
		if (saved === 'de' || saved === 'en') return saved;
	} catch {
		/* ignore */
	}
	return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

class I18n {
	lang = $state<Lang>(detect());

	set(l: Lang): void {
		this.lang = l;
		try {
			localStorage.setItem('lang', l);
		} catch {
			/* ignore */
		}
	}

	t = (key: Key, vars?: Record<string, string | number>): string => {
		let s = dicts[this.lang][key] ?? dicts.de[key] ?? key;
		if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
		return s;
	};
}

export const i18n = new I18n();
export const t = i18n.t;

// Passphrase strength: a small, honest estimator (no 400 KB dictionary) plus a diceware-style
// suggestion from a built-in German word list. The vault is only as strong as this secret —
// offline brute force runs at Argon2id speed, nothing else protects it.

const COMMON = new Set([
	'password', 'passwort', 'passwort123', 'password123', '123456789012', 'qwertzuiopü', 'qwertyuiop12', 'geheimgeheim',
	'hallohallo12', 'willkommen1', 'willkommen12', 'sonnenschein', 'schatzschatz', 'iloveyou1234', 'fussball1234',
	'admin1234567', 'letmein12345', 'changeme1234', 'aes256chat12', 'masterpasswort', 'meinpasswort', 'test12345678'
]);

export interface Strength {
	/** 0 = unusable, 1 = weak, 2 = okay, 3 = good, 4 = strong */
	score: 0 | 1 | 2 | 3 | 4;
	/** rough entropy estimate in bits */
	bits: number;
	hints: StrengthHint[];
}

export type StrengthHint = 'tooShort' | 'common' | 'repeats' | 'sequence' | 'oneClass' | 'longer' | 'words';

function classes(pw: string): number {
	let n = 0;
	if (/[a-zäöüß]/.test(pw)) n++;
	if (/[A-ZÄÖÜ]/.test(pw)) n++;
	if (/[0-9]/.test(pw)) n++;
	if (/[^A-Za-z0-9äöüÄÖÜß]/.test(pw)) n++;
	return n;
}

function hasSequence(pw: string): boolean {
	const s = pw.toLowerCase();
	const rows = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertzuiop', 'asdfghjkl', 'yxcvbnm', 'qwertyuiop'];
	for (let i = 0; i + 4 <= s.length; i++) {
		const chunk = s.slice(i, i + 4);
		const rev = [...chunk].reverse().join('');
		if (rows.some((r) => r.includes(chunk) || r.includes(rev))) return true;
	}
	return false;
}

export function estimate(pw: string): Strength {
	const hints: StrengthHint[] = [];
	const len = pw.length;
	if (len < 12) hints.push('tooShort');
	const normalized = pw.toLowerCase().replace(/\s+/g, '');
	// Exact hits and the classic "word + digits" shapes built on well-known bases.
	if (COMMON.has(normalized) || /^(passw(or|o)r?[dt]|geheim|hallo|willkommen|qwertz|qwerty|123456|admin|master|schatz|liebe)[a-z]*[0-9!.?*]{0,6}$/.test(normalized)) {
		hints.push('common');
	}
	if (/(.)\1{3,}/.test(pw) || /^(.{1,3})\1+$/.test(pw)) hints.push('repeats');
	if (hasSequence(pw)) hints.push('sequence');
	const cls = classes(pw);
	const words = pw.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3);

	// Entropy: word passphrases count per word (~11 bits for a memorable German word),
	// everything else per character with the observed alphabet.
	let bits: number;
	if (words.length >= 4 && len >= 20) bits = words.length * 11;
	else {
		const alphabet = [26, 26, 10, 33].slice(0, Math.max(cls, 1)).reduce((a, b) => a + b, 0);
		bits = Math.round(len * Math.log2(alphabet));
	}
	if (hints.includes('repeats') || hints.includes('sequence')) bits = Math.round(bits * 0.6);
	if (hints.includes('common')) bits = 10;

	if (cls === 1 && words.length < 4) hints.push('oneClass');
	if (len >= 12 && len < 16 && words.length < 4) hints.push('longer');
	if (words.length < 3 && len < 24) hints.push('words');

	let score: Strength['score'];
	if (len < 12 || hints.includes('common')) score = 0;
	else if (bits < 45) score = 1;
	else if (bits < 60) score = 2;
	else if (bits < 80) score = 3;
	else score = 4;
	return { score, bits, hints };
}

/** Random six-word German passphrase (~54 bits from 512 words) — easy to say, hard to guess. */
export function suggestPassphrase(words = 6): string {
	const out: string[] = [];
	const buf = new Uint32Array(words);
	crypto.getRandomValues(buf);
	for (let i = 0; i < words; i++) out.push(WORDS[buf[i] % WORDS.length]);
	return out.join(' ');
}

// 512 short, concrete, unambiguous German nouns.
export const WORDS = (
	'ampel anker apfel arm arzt ast auge bach ball band bank bart baum beil berg bett biene bild birne blatt blei blitz blume boden bogen bohne boot brett brief brot brücke buch bühne bus butter dach dampf daumen decke dorf draht dose drache dreieck eiche eimer eis eisen elch ente erbse erde esel eule fabrik faden fahne falke farbe fass feder feld fels fenster ferse feuer fisch flagge flasche fleck fliege flöte flügel fluss folie frosch frucht fuchs fuss gabel gans garten gasse gebirge geige geist gitter glas glocke gold gras gurke haar hafen hahn haken hals hammer hand hase haus haut hecke heft helm hemd herz heu himmel hirsch hitze hobel holz honig horn hose hügel huhn hund hut igel insel jacke jäger kabel käfer käse kaffee kaktus kalb kamel kamm kanne karte kasten katze keks kern kerze kessel kette kiefer kind kino kirsche kiste klee kleid knie knopf koffer kohl könig korb korn kran kraut kreide kreis krone krug küche kugel kuh kürbis lachs laden lampe land laub lauch leiter lerche licht lied lilie linse löffel löwe luft luchs mais mantel marke maus meer mehl melone messer milch mond moos möwe mühle mund münze mütze nabel nacht nadel nagel nase nebel nest netz nuss ochse ofen ohr onkel orgel otter palme panda papier pfad pfau pfeil pferd pflug pilz pinsel platz pudel pumpe puppe quelle rabe rad rahmen rasen ratte raum rebe regal regen reh reis ring rock rohr rose rübe ruder sack saft salz samt sand sattel schaf schal schere schiff schild schlaf schloss schnee schuh schule see segel seide seife seil senf sessel sichel sieb silber socke sofa sonne spaten speer spiegel spinne sport stab stadt stahl stamm stein stern stiefel stift stirn stock storch strand strauch stroh stuhl sturm suppe tal tanne tasche tasse tau teich teller teppich tiger tinte tisch tor traube treppe tuch tulpe tunnel turm ufer uhr ulme vase veilchen vogel wache wagen wald wand wanne watte wein welle wespe weste wiese wind winkel wolke wolle wurm wurzel zahn zange zaun zebra zeder zelt ziege zimt zopf zucker zunge zweig zwerg zwiebel ' +
	'adler affe algen amsel angel anzug atlas bagger balken banane barsch becher besen bison blase bluse bohrer bonbon brille brunnen bürste dackel dattel delfin diele dolch donner dübel eidechse eiche elster engel erle esche fackel falter farn fasan feige fenchel fichte finger flamme fohlen forelle friseur gams garn gecko gehweg gel geweih gips giraffe gleis granit greif griff grille grotte habicht hagel hai halle harke harfe hecht heide hering hobby holunder hornisse hummel hummer hütte iltis iris jaguar joghurt jolle kachel kajak kanal kanu kapelle kappe karotte kegel kelle kiesel kiwi klinke kloster knochen kobra kohle kojote kolben kommode kompass konsole koralle kordel kralle krebs kreuz krokus kuchen kupfer kuppel lachs lakritz lasso laterne lava leine leopard libelle limette linde lotse luchs lupe magnet mandel mangold marder marmor maske mauer meise mispel möhre mörtel motte mulde murmel nelke nerz nilpferd nische nudel oase oktopus olive orange orchidee otter palast panther papagei pappel paprika pelikan perle pfanne pfirsich pflaume pinguin pirat pistazie pokal polster puma quark quitte radler rakete raupe reiher rentier rettich rhabarber riegel robbe roggen rolle rüssel salbei salm sardine schakal schaufel schaukel schleuse schnecke scholle schürze schwalbe schwan seehund sellerie sirup skorpion spargel spatz specht sperling spule stachel star stör strauss stute tapir taube teekanne thymian tomate tresor trommel truhe tukan wachtel walnuss walross weizen wiesel wombat zander zeisig zikade zinn zitrone'
).split(/\s+/).filter((w, i, a) => a.indexOf(w) === i);

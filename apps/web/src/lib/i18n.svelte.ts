/**
 * Tiny English / Gujarati dictionary for navigation, page titles and empty states.
 * The locale lives in a runes class shared through context (`setI18n` in the root
 * layout, `getI18n` anywhere below it).
 *
 * Gujarati strings are a first draft and should get a native-speaker review.
 */
import { createContext } from 'svelte';

const en = {
	brand: 'Insider',
	'nav.main': 'Main',
	'nav.today': 'Today',
	'nav.prices': 'Prices',
	'nav.insights': 'Insights',
	'nav.feed': 'Feed',
	'nav.review': 'Review',
	'nav.settings': 'Settings',
	'nav.groups': 'Groups',
	'nav.devices': 'Devices',
	'nav.dictionaries': 'Dictionaries',
	'locale.switch': 'ગુજરાતી',
	'locale.switchLabel': 'Switch language to Gujarati',

	'common.loading': 'Loading…',
	'common.retry': 'Try again',
	'common.all': 'All',
	'common.errorTitle': 'Could not load this',
	'common.offlineTitle': 'Cannot reach the Insider API',
	'common.offlineBody':
		'The app could not connect to the API. In development, start it with bin/insider api and reload.',

	'collector.none': 'No collector',
	'collector.online': 'Collector online',
	'collector.paused': 'Collector paused',
	'collector.silent': 'Collector silent',
	'collector.schema': 'Collector needs update',
	'collector.revoked': 'Collector revoked',
	'collector.unknown': 'Collector status unknown',

	'today.title': 'Today',
	'today.subtitle': 'The evening brief: what moved today and where to buy.',
	'today.empty.title': 'No brief for this day yet',
	'today.empty.body':
		'The brief is written at 19:00 IST from the day’s price moves, mandi spreads, arrival spikes and news. It appears here once the watched groups have posted enough rate lists to compare.',

	'prices.title': 'Prices',
	'prices.subtitle': 'Latest price per commodity and mandi, in ₹ per quintal.',
	'prices.empty.title': 'No prices yet',
	'prices.empty.body':
		'Prices appear here once watched groups post rate lists. Each one is normalized to ₹/quintal and checked before it counts.',
	'trend.empty.title': 'No price history yet',
	'trend.empty.body':
		'The trend chart fills in day by day as rate lists for this commodity are collected and aggregated into daily prices.',
	'market.empty.title': 'No prices from this mandi yet',
	'market.empty.body':
		'Prices for this mandi appear once a watched group posts a rate list that mentions it.',

	'insights.title': 'Insights',
	'insights.subtitle': 'Significant moves, spreads, arrival spikes and conflicting reports.',
	'insights.empty.title': 'No insights yet',
	'insights.empty.body':
		'Insights are detected after daily prices build up: big price moves, wide mandi spreads, arrival spikes and reports that disagree with each other.',

	'feed.title': 'Feed',
	'feed.subtitle': 'Messages from watched groups, newest first.',
	'feed.empty.title': 'No messages yet',
	'feed.empty.body':
		'Messages appear here once the Mac collector uploads them from the watched WhatsApp groups. Check Settings → Devices to see whether the collector is running.',
	'feed.noMatch.title': 'Nothing matches',
	'feed.noMatch.body':
		'No messages match this search or label. Try a different word or clear the filter.',

	'review.title': 'Review',
	'review.subtitle': 'Low-confidence extractions waiting for a person to check them.',
	'review.empty.title': 'Nothing to review',
	'review.empty.body':
		'When the extractor is unsure about a price it lands here instead of the price tables. Approve or reject it, and the correction makes the system more accurate.',

	'settings.title': 'Settings',
	'groups.title': 'Groups',
	'groups.subtitle': 'Choose which WhatsApp groups the collector reads.',
	'groups.empty.title': 'No groups yet',
	'groups.empty.body':
		'Groups appear here after the Mac collector sends the list of groups it can see. Then pick the ones to watch.',
	'devices.title': 'Devices',
	'devices.subtitle': 'Health of the Mac collectors that upload messages.',
	'devices.empty.title': 'No collector registered',
	'devices.empty.body':
		'A collector appears here once the Insider menu-bar app on the team Mac is set up with a device token and sends its first heartbeat.',
	'dictionaries.title': 'Dictionaries',
	'dictionaries.subtitle': 'Commodities, mandis and units the extractor maps names to.',
	'dictionaries.empty.title': 'Nothing here yet',
	'dictionaries.empty.body':
		'The API seeds this list in its first migration. If it is empty, run the migrations for the API.',

	'login.title': 'Sign in',
	'login.body':
		'The team login provider is not decided yet (Bull Connect or Supabase Auth). In development the API accepts every request, so you can use the app without signing in.',
	'login.continue': 'Continue to the app'
} as const;

export type MessageKey = keyof typeof en;

const gu = {
	brand: 'Insider',
	'nav.main': 'મુખ્ય',
	'nav.today': 'આજે',
	'nav.prices': 'ભાવ',
	'nav.insights': 'તારણો',
	'nav.feed': 'સંદેશા',
	'nav.review': 'ચકાસણી',
	'nav.settings': 'સેટિંગ્સ',
	'nav.groups': 'ગ્રુપ',
	'nav.devices': 'ઉપકરણો',
	'nav.dictionaries': 'શબ્દકોશ',
	'locale.switch': 'English',
	'locale.switchLabel': 'ભાષા અંગ્રેજીમાં બદલો',

	'common.loading': 'લોડ થઈ રહ્યું છે…',
	'common.retry': 'ફરી પ્રયાસ કરો',
	'common.all': 'બધા',
	'common.errorTitle': 'આ લોડ થઈ શક્યું નહીં',
	'common.offlineTitle': 'Insider API સુધી પહોંચી શકાતું નથી',
	'common.offlineBody':
		'એપ API સાથે જોડાઈ શકી નહીં. ડેવલપમેન્ટમાં bin/insider api ચલાવો અને પેજ ફરી લોડ કરો.',

	'collector.none': 'કલેક્ટર નથી',
	'collector.online': 'કલેક્ટર ચાલુ',
	'collector.paused': 'કલેક્ટર થોભાવેલ',
	'collector.silent': 'કલેક્ટર શાંત',
	'collector.schema': 'કલેક્ટર અપડેટ કરો',
	'collector.revoked': 'કલેક્ટર રદ',
	'collector.unknown': 'કલેક્ટરની સ્થિતિ અજાણ',

	'today.title': 'આજે',
	'today.subtitle': 'સાંજનો સારાંશ: આજે શું બદલાયું અને ક્યાંથી ખરીદવું.',
	'today.empty.title': 'આ દિવસનો સારાંશ હજી નથી',
	'today.empty.body':
		'સારાંશ રોજ સાંજે 19:00 વાગ્યે દિવસના ભાવફેર, મંડીઓ વચ્ચેના તફાવત, આવકમાં ઉછાળા અને સમાચાર પરથી લખાય છે. જોવાતા ગ્રુપમાં સરખામણી માટે પૂરતા ભાવપત્રક આવે પછી તે અહીં દેખાશે.',

	'prices.title': 'ભાવ',
	'prices.subtitle': 'દરેક જણસ અને મંડીનો તાજો ભાવ, ₹ પ્રતિ ક્વિન્ટલમાં.',
	'prices.empty.title': 'હજી કોઈ ભાવ નથી',
	'prices.empty.body':
		'જોવાતા ગ્રુપમાં ભાવપત્રક આવે પછી ભાવ અહીં દેખાશે. દરેક ભાવ ₹/ક્વિન્ટલમાં ફેરવાય છે અને ગણતરીમાં લેતા પહેલાં ચકાસાય છે.',
	'trend.empty.title': 'હજી ભાવનો ઇતિહાસ નથી',
	'trend.empty.body': 'આ જણસના ભાવપત્રક ભેગા થઈને દૈનિક ભાવ બને તેમ ચાર્ટ દિવસે દિવસે ભરાશે.',
	'market.empty.title': 'આ મંડીના હજી ભાવ નથી',
	'market.empty.body': 'કોઈ જોવાતા ગ્રુપમાં આ મંડીનો ભાવપત્રક આવે પછી ભાવ અહીં દેખાશે.',

	'insights.title': 'તારણો',
	'insights.subtitle': 'મોટા ભાવફેર, મંડી તફાવત, આવકમાં ઉછાળા અને વિરોધાભાસી અહેવાલ.',
	'insights.empty.title': 'હજી કોઈ તારણ નથી',
	'insights.empty.body':
		'દૈનિક ભાવ ભેગા થાય પછી તારણો મળે છે: મોટા ભાવફેર, મંડીઓ વચ્ચે મોટો તફાવત, આવકમાં ઉછાળો અને એકબીજાથી જુદા પડતા અહેવાલ.',

	'feed.title': 'સંદેશા',
	'feed.subtitle': 'જોવાતા ગ્રુપના સંદેશા, નવા પહેલાં.',
	'feed.empty.title': 'હજી કોઈ સંદેશો નથી',
	'feed.empty.body':
		'Mac કલેક્ટર જોવાતા WhatsApp ગ્રુપમાંથી સંદેશા અપલોડ કરે પછી તે અહીં દેખાશે. કલેક્ટર ચાલે છે કે નહીં તે સેટિંગ્સ → ઉપકરણોમાં જુઓ.',
	'feed.noMatch.title': 'કંઈ મળ્યું નહીં',
	'feed.noMatch.body':
		'આ શોધ કે લેબલ સાથે કોઈ સંદેશો મેળ ખાતો નથી. બીજો શબ્દ અજમાવો અથવા ફિલ્ટર હટાવો.',

	'review.title': 'ચકાસણી',
	'review.subtitle': 'ઓછા વિશ્વાસવાળા ભાવ, જે કોઈ વ્યક્તિએ ચકાસવાના છે.',
	'review.empty.title': 'ચકાસવા માટે કંઈ નથી',
	'review.empty.body':
		'જ્યારે સિસ્ટમને કોઈ ભાવ વિશે ખાતરી ન હોય ત્યારે તે ભાવ કોષ્ટકને બદલે અહીં આવે છે. તેને મંજૂર કે નામંજૂર કરો; દરેક સુધારો સિસ્ટમને વધુ સચોટ બનાવે છે.',

	'settings.title': 'સેટિંગ્સ',
	'groups.title': 'ગ્રુપ',
	'groups.subtitle': 'કલેક્ટર કયા WhatsApp ગ્રુપ વાંચે તે પસંદ કરો.',
	'groups.empty.title': 'હજી કોઈ ગ્રુપ નથી',
	'groups.empty.body':
		'Mac કલેક્ટર તેને દેખાતા ગ્રુપની યાદી મોકલે પછી ગ્રુપ અહીં દેખાશે. પછી જોવાના ગ્રુપ પસંદ કરો.',
	'devices.title': 'ઉપકરણો',
	'devices.subtitle': 'સંદેશા અપલોડ કરતા Mac કલેક્ટરની સ્થિતિ.',
	'devices.empty.title': 'કોઈ કલેક્ટર નોંધાયેલ નથી',
	'devices.empty.body':
		'ટીમના Mac પર Insider મેનુ-બાર એપ ડિવાઇસ ટોકન સાથે સેટ થાય અને પહેલો હાર્ટબીટ મોકલે પછી કલેક્ટર અહીં દેખાશે.',
	'dictionaries.title': 'શબ્દકોશ',
	'dictionaries.subtitle': 'જણસ, મંડી અને એકમો, જેના નામ સિસ્ટમ ઓળખે છે.',
	'dictionaries.empty.title': 'હજી અહીં કંઈ નથી',
	'dictionaries.empty.body':
		'API તેના પહેલા માઇગ્રેશનમાં આ યાદી ભરે છે. જો તે ખાલી હોય તો API માટે માઇગ્રેશન ચલાવો.',

	'login.title': 'સાઇન ઇન',
	'login.body':
		'ટીમ લૉગિન કઈ સેવાથી થશે તે હજી નક્કી નથી (Bull Connect કે Supabase Auth). ડેવલપમેન્ટમાં API દરેક વિનંતી સ્વીકારે છે, એટલે સાઇન ઇન વગર એપ વાપરી શકો છો.',
	'login.continue': 'એપ પર આગળ વધો'
} as const satisfies Record<MessageKey, string>;

export type Locale = 'en' | 'gu';

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, gu };

const STORAGE_KEY = 'insider.locale';

function readStoredLocale(): Locale {
	try {
		const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
		return stored === 'gu' ? 'gu' : 'en';
	} catch {
		return 'en';
	}
}

export class I18n {
	locale = $state<Locale>(readStoredLocale());

	/** BCP 47 tag for Intl formatters and `<html lang>`. */
	readonly intlLocale = $derived(this.locale === 'gu' ? 'gu-IN' : 'en-IN');

	constructor() {
		if (typeof document !== 'undefined') document.documentElement.lang = this.locale;
	}

	t = (key: MessageKey): string => dictionaries[this.locale][key];

	set(locale: Locale): void {
		this.locale = locale;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, locale);
		} catch {
			// Storage can be blocked (private mode); the choice still applies for this visit.
		}
		if (typeof document !== 'undefined') document.documentElement.lang = locale;
	}

	toggle = (): void => {
		this.set(this.locale === 'en' ? 'gu' : 'en');
	};
}

export const [getI18n, setI18n] = createContext<I18n>();

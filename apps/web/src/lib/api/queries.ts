/**
 * Query keys and typed fetchers for every read endpoint the web app uses.
 * Components call `createQuery(() => ({ queryKey: keys.x(...), queryFn: () => fetchX(...) }))`.
 */
import type { components, paths } from '@insider/contracts';
import { api, unwrap, unwrapOrNull } from './client.js';

type S = components['schemas'];
export type Brief = S['Brief'];
export type Insight = S['Insight'];
export type InsightType = S['InsightType'];
export type Severity = S['Severity'];
export type LatestPrice = S['LatestPrice'];
export type DailyPricePoint = S['DailyPricePoint'];
export type Message = S['Message'];
export type MessageLabel = S['MessageLabelValue'];
export type MessagePage = S['MessagePage'];
export type MessagePreview = S['MessagePreview'];
export type Chat = S['Chat'];
export type PriceObservation = S['PriceObservation'];
export type ObservationStatus = S['ObservationStatus'];
export type ObservationReview = S['ObservationReview'];
export type Group = S['Group'];
export type GroupUpdate = S['GroupUpdate'];
export type Device = S['Device'];
export type DeviceStatus = S['DeviceStatus'];
export type Commodity = S['Commodity'];
export type Market = S['Market'];
export type Unit = S['Unit'];

type Query<P extends keyof paths> = paths[P] extends { get: { parameters: { query?: infer Q } } }
	? NonNullable<Q>
	: never;

export type LatestPricesParams = Query<'/v1/prices/latest'>;
export type DailyPricesParams = Query<'/v1/prices/daily'>;
export type InsightsParams = Query<'/v1/insights'>;
export type MessagesParams = Query<'/v1/messages'>;
export type ReviewParams = Query<'/v1/review/observations'>;

/** Drop empty filters so they neither reach the URL nor split the cache. */
function clean<T extends object>(params: T): T {
	return Object.fromEntries(
		Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
	) as T;
}

export const keys = {
	brief: (date: string) => ['brief', date] as const,
	latestPrices: (p: LatestPricesParams = {}) => ['prices', 'latest', clean(p)] as const,
	dailyPrices: (p: DailyPricesParams) => ['prices', 'daily', clean(p)] as const,
	insights: (p: InsightsParams = {}) => ['insights', clean(p)] as const,
	messages: (p: MessagesParams = {}) => ['messages', clean(p)] as const,
	chats: () => ['chats'] as const,
	review: (p: ReviewParams = {}) => ['review', clean(p)] as const,
	reviewAll: () => ['review'] as const,
	groups: () => ['groups'] as const,
	devices: () => ['devices'] as const,
	commodities: () => ['dictionaries', 'commodities'] as const,
	markets: () => ['dictionaries', 'markets'] as const,
	units: () => ['dictionaries', 'units'] as const
};

/** The day's brief, or `null` when it has not been generated (404). */
export const fetchBrief = (date: string) =>
	unwrapOrNull(api.GET('/v1/brief/{date}', { params: { path: { date } } }));

export const fetchLatestPrices = (query: LatestPricesParams = {}) =>
	unwrap(api.GET('/v1/prices/latest', { params: { query: clean(query) } }));

export const fetchDailyPrices = (query: DailyPricesParams) =>
	unwrap(api.GET('/v1/prices/daily', { params: { query: clean(query) } }));

export const fetchInsights = (query: InsightsParams = {}) =>
	unwrap(api.GET('/v1/insights', { params: { query: clean(query) } }));

export const fetchMessages = (query: MessagesParams = {}) =>
	unwrap(api.GET('/v1/messages', { params: { query: clean(query) } }));

export const fetchChats = () => unwrap(api.GET('/v1/chats'));

export const fetchReviewQueue = (query: ReviewParams = {}) =>
	unwrap(api.GET('/v1/review/observations', { params: { query: clean(query) } }));

export const reviewObservation = (body: ObservationReview) =>
	unwrap(api.PATCH('/v1/review/observations', { body }));

export const fetchGroups = () => unwrap(api.GET('/v1/groups'));

export const updateGroup = (body: GroupUpdate) => unwrap(api.PATCH('/v1/groups', { body }));

export const fetchDevices = () => unwrap(api.GET('/v1/devices'));

export const fetchCommodities = () => unwrap(api.GET('/v1/dictionaries/commodities'));
export const fetchMarkets = () => unwrap(api.GET('/v1/dictionaries/markets'));
export const fetchUnits = () => unwrap(api.GET('/v1/dictionaries/units'));

/** Today and Feed poll so the page stays current while it is open. */
export const LIVE_REFETCH_MS = 2 * 60 * 1000;

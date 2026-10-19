import type { components } from '@insider/contracts';

type Schemas = components['schemas'];

export type IngestMessage = Schemas['IngestMessage'];
export type IngestMessagesResponse = Schemas['IngestMessagesResponse'];
export type MessageType = Schemas['MessageType'];
export type MediaMeta = Schemas['MediaMeta'];
export type CatalogGroup = Schemas['CatalogGroup'];
export type GroupCatalogResponse = Schemas['GroupCatalogResponse'];
export type DeviceConfig = Schemas['DeviceConfig'];
export type HeartbeatRequest = Schemas['HeartbeatRequest'];

/** Upper bounds from openapi.yaml (IngestMessage / IngestMessagesRequest). */
export const MAX_BATCH = 500;
export const MAX_TEXT_LENGTH = 65_536;
export const MAX_SENDER_NAME_LENGTH = 256;
export const MAX_ID_LENGTH = 128;

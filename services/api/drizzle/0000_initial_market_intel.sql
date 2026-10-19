CREATE SCHEMA IF NOT EXISTS "market_intel";
--> statement-breakpoint
CREATE TYPE "market_intel"."device_status" AS ENUM('active', 'paused', 'silent', 'schema_mismatch', 'revoked');--> statement-breakpoint
CREATE TYPE "market_intel"."extraction_action" AS ENUM('extracted', 'approved', 'edited', 'rejected');--> statement-breakpoint
CREATE TYPE "market_intel"."insight_type" AS ENUM('price_move', 'spread', 'arrival_spike', 'conflict', 'news');--> statement-breakpoint
CREATE TYPE "market_intel"."message_label_value" AS ENUM('price', 'arrivals', 'news', 'advisory', 'noise');--> statement-breakpoint
CREATE TYPE "market_intel"."message_type" AS ENUM('text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contact', 'system', 'other');--> statement-breakpoint
CREATE TYPE "market_intel"."observation_status" AS ENUM('auto', 'needs_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "market_intel"."ocr_status" AS ENUM('pending', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "market_intel"."quality_flag" AS ENUM('ok', 'single_source', 'conflicting', 'out_of_bounds');--> statement-breakpoint
CREATE TYPE "market_intel"."severity" AS ENUM('info', 'notable', 'high');--> statement-breakpoint
CREATE TABLE "market_intel"."collector_device" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"app_version" varchar(32),
	"schema_fingerprint" varchar(128),
	"schema_ok" boolean DEFAULT true NOT NULL,
	"outbox_size" integer,
	"last_heartbeat_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"paused" boolean DEFAULT false NOT NULL,
	"status" "market_intel"."device_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collector_device_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "market_intel"."commodity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"varieties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synonyms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "commodity_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "market_intel"."content_cluster" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"canonical_message_id" bigint,
	"group_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_cluster_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "market_intel"."daily_brief" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"body" text NOT NULL,
	"generated_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "daily_brief_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "market_intel"."daily_price" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"commodity_id" bigint NOT NULL,
	"market_id" bigint NOT NULL,
	"date" date NOT NULL,
	"median_modal" double precision NOT NULL,
	"min" double precision,
	"max" double precision,
	"arrivals_quintal" double precision,
	"source_count" integer NOT NULL,
	"group_count" integer NOT NULL,
	"quality_flag" "market_intel"."quality_flag" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_intel"."extraction_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"observation_id" bigint NOT NULL,
	"action" "market_intel"."extraction_action" NOT NULL,
	"actor" varchar(128) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_intel"."insight" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"type" "market_intel"."insight_type" NOT NULL,
	"commodity_id" bigint,
	"market_id" bigint,
	"severity" "market_intel"."severity" NOT NULL,
	"title" varchar(256) NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_intel"."market" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"district" varchar(128),
	"state" varchar(64) NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lat" double precision,
	"lng" double precision,
	CONSTRAINT "market_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "market_intel"."message_label" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" bigint NOT NULL,
	"label" "market_intel"."message_label_value" NOT NULL,
	"confidence" double precision NOT NULL,
	"model_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_intel"."price_observation" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" bigint NOT NULL,
	"commodity_id" bigint NOT NULL,
	"variety" varchar(64),
	"market_id" bigint NOT NULL,
	"obs_date" date NOT NULL,
	"min_raw" double precision,
	"max_raw" double precision,
	"modal_raw" double precision,
	"unit_id" bigint NOT NULL,
	"min_per_quintal" double precision,
	"max_per_quintal" double precision,
	"modal_per_quintal" double precision,
	"arrivals_quintal" double precision,
	"confidence" double precision NOT NULL,
	"status" "market_intel"."observation_status" DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_intel"."unit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"label" varchar(64) NOT NULL,
	"factor_to_quintal" double precision NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "unit_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "market_intel"."wa_group" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"jid" varchar(128) NOT NULL,
	"name" varchar(256) NOT NULL,
	"member_count" integer,
	"is_watched" boolean DEFAULT false NOT NULL,
	"region_tag" varchar(64),
	"primary_commodities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_group_jid_unique" UNIQUE("jid")
);
--> statement-breakpoint
CREATE TABLE "market_intel"."wa_media" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" bigint NOT NULL,
	"gcs_path" varchar(512) NOT NULL,
	"mime" varchar(128) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploaded" boolean DEFAULT false NOT NULL,
	"ocr_status" "market_intel"."ocr_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_intel"."wa_message" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"device_id" bigint,
	"stanza_id" varchar(128) NOT NULL,
	"sender_hash" varchar(64) NOT NULL,
	"sender_name" varchar(256),
	"sent_at" timestamp with time zone NOT NULL,
	"type" "market_intel"."message_type" NOT NULL,
	"text" text,
	"quoted_stanza_id" varchar(128),
	"is_forwarded" boolean DEFAULT false NOT NULL,
	"content_hash" varchar(64),
	"cluster_id" bigint,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_intel"."content_cluster" ADD CONSTRAINT "content_cluster_canonical_message_id_wa_message_id_fk" FOREIGN KEY ("canonical_message_id") REFERENCES "market_intel"."wa_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."daily_price" ADD CONSTRAINT "daily_price_commodity_id_commodity_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "market_intel"."commodity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."daily_price" ADD CONSTRAINT "daily_price_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "market_intel"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."extraction_event" ADD CONSTRAINT "extraction_event_observation_id_price_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "market_intel"."price_observation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."insight" ADD CONSTRAINT "insight_commodity_id_commodity_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "market_intel"."commodity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."insight" ADD CONSTRAINT "insight_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "market_intel"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."message_label" ADD CONSTRAINT "message_label_message_id_wa_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "market_intel"."wa_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."price_observation" ADD CONSTRAINT "price_observation_message_id_wa_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "market_intel"."wa_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."price_observation" ADD CONSTRAINT "price_observation_commodity_id_commodity_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "market_intel"."commodity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."price_observation" ADD CONSTRAINT "price_observation_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "market_intel"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."price_observation" ADD CONSTRAINT "price_observation_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "market_intel"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."wa_media" ADD CONSTRAINT "wa_media_message_id_wa_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "market_intel"."wa_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."wa_message" ADD CONSTRAINT "wa_message_group_id_wa_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "market_intel"."wa_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."wa_message" ADD CONSTRAINT "wa_message_device_id_collector_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "market_intel"."collector_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."wa_message" ADD CONSTRAINT "wa_message_cluster_id_content_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "market_intel"."content_cluster"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_price_cmd_uq" ON "market_intel"."daily_price" USING btree ("commodity_id","market_id","date");--> statement-breakpoint
CREATE INDEX "extraction_event_observation_idx" ON "market_intel"."extraction_event" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "insight_date_type_idx" ON "market_intel"."insight" USING btree ("date","type");--> statement-breakpoint
CREATE INDEX "message_label_message_idx" ON "market_intel"."message_label" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "price_observation_cmd_idx" ON "market_intel"."price_observation" USING btree ("commodity_id","market_id","obs_date");--> statement-breakpoint
CREATE INDEX "price_observation_message_idx" ON "market_intel"."price_observation" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "price_observation_status_idx" ON "market_intel"."price_observation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "wa_media_message_idx" ON "market_intel"."wa_media" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "wa_media_sha256_idx" ON "market_intel"."wa_media" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_message_group_stanza_uq" ON "market_intel"."wa_message" USING btree ("group_id","stanza_id");--> statement-breakpoint
CREATE INDEX "wa_message_group_sent_idx" ON "market_intel"."wa_message" USING btree ("group_id","sent_at");--> statement-breakpoint
CREATE INDEX "wa_message_content_hash_idx" ON "market_intel"."wa_message" USING btree ("content_hash");
CREATE TYPE "market_intel"."llm_call_outcome" AS ENUM('ok', 'refusal', 'max_tokens', 'invalid_output');--> statement-breakpoint
CREATE TABLE "market_intel"."llm_call" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" bigint NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"model" varchar(64) NOT NULL,
	"prompt_version" varchar(32) NOT NULL,
	"packet_hash" varchar(64) NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"stop_reason" varchar(32),
	"outcome" "market_intel"."llm_call_outcome" NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_intel"."llm_call" ADD CONSTRAINT "llm_call_message_id_wa_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "market_intel"."wa_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_call_message_idx" ON "market_intel"."llm_call" USING btree ("message_id");
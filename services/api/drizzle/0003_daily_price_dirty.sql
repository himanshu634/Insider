CREATE TABLE "market_intel"."daily_price_dirty" (
	"commodity_id" bigint NOT NULL,
	"market_id" bigint NOT NULL,
	"date" date NOT NULL,
	"version" bigserial NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_intel"."daily_price_dirty" ADD CONSTRAINT "daily_price_dirty_commodity_id_commodity_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "market_intel"."commodity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_intel"."daily_price_dirty" ADD CONSTRAINT "daily_price_dirty_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "market_intel"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_price_dirty_cell_uq" ON "market_intel"."daily_price_dirty" USING btree ("commodity_id","market_id","date");
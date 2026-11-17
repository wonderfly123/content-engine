-- Texting is per brand: the brands a member's confirmed number texts for.
-- Hand-written to match memberPhoneBrands in lib/db/schema-conversations.ts.
-- Purely additive: one new table; no existing row changes. Existing confirmed numbers reach no
-- brand until it is turned on for one in that brand's Settings > Channels.
CREATE TABLE "member_phone_brands" (
	"user_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Same as every other public table: RLS on with no policies, so only the server's connection reads it.
ALTER TABLE "member_phone_brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "member_phone_brands_unique" ON "member_phone_brands" USING btree ("user_id","brand_id");--> statement-breakpoint
CREATE INDEX "member_phone_brands_brand_idx" ON "member_phone_brands" USING btree ("brand_id");

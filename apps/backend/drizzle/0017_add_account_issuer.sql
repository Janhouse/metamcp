-- better-auth 1.7 keys accounts on (issuer, account_id) instead of
-- (provider_id, account_id). Existing rows predate the column, so add it
-- nullable, backfill it, and only then enforce NOT NULL + uniqueness.
--
-- Backfilled values must match what the running server computes, or every
-- account linked before this migration stops resolving and users get silently
-- re-provisioned:
--   * email/password  -> `local:credential`      (better-auth built-in)
--   * OIDC via genericOAuth -> `local:oauth:<provider_id>`, pinned by
--     `accountIssuer` in apps/backend/src/auth.ts
--
-- Note: auth.ts URL-encodes the provider ID. That is a no-op for the
-- unreserved characters real provider IDs use; a deployment that set
-- OIDC_PROVIDER_ID to something needing percent-encoding must adjust the
-- backfill below to match.
ALTER TABLE "accounts" ADD COLUMN "issuer" text;--> statement-breakpoint

UPDATE "accounts"
SET "issuer" = CASE
  WHEN "provider_id" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || "provider_id"
END
WHERE "issuer" IS NULL;--> statement-breakpoint

ALTER TABLE "accounts" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint

-- Fails loudly if the table already holds duplicate (provider_id, account_id)
-- rows. better-auth only ever enforced that pairing in application code, so a
-- historical race could have produced one; resolve the duplicates by hand and
-- re-run rather than dropping the constraint.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_issuer_account_id_unique_idx" UNIQUE("issuer","account_id");

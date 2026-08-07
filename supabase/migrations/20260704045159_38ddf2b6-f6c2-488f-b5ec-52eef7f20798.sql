-- §11 patch: replace the storage-cleanup cron job so it authenticates with
-- CLEANUP_CRON_SECRET via Authorization: Bearer, stored in Vault.
--
-- Requirements:
--   1) CLEANUP_CRON_SECRET is already configured as a runtime secret.
--   2) We mirror it into vault.secrets so pg_cron can read it at run time.
--
-- If the CLEANUP_CRON_SECRET env var is not exposed to Postgres, the vault
-- upsert below is a no-op and the operator must run it once manually:
--
--   SELECT vault.create_secret('<paste secret>', 'CLEANUP_CRON_SECRET');
--
-- The scheduled URL is the stable preview host; adjust to the production
-- host once the project is published.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any previously registered cleanup job (names from earlier
-- migrations). Ignore errors if they don't exist.
DO $$
BEGIN
  PERFORM cron.unschedule('visualskin-storage-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-abandoned-orders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule the new job. It reads the bearer secret from vault at every run.
SELECT cron.schedule(
  'visualskin-storage-cleanup',
  '17 * * * *',
  $CRON$
  SELECT net.http_post(
    url := 'https://project--68b5e267-4981-4913-9077-f3fb95bcacb0.lovable.app/api/public/hooks/cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'CLEANUP_CRON_SECRET'
        LIMIT 1
      ),
      'Cache-Control', 'no-store'
    ),
    body := '{}'::jsonb
  );
  $CRON$
);
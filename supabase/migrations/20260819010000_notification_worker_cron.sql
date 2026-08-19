-- Schedule the VisualSkin notification outbox worker from Supabase.
--
-- Before applying this migration, create the worker bearer token manually in
-- Supabase Vault with the name visualskin_notification_cron_secret. The secret
-- value must never be stored in this migration or committed to the repository.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid
    from cron.job
    where jobname = 'visualskin-notification-worker'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end
$$;

select cron.schedule(
  'visualskin-notification-worker',
  '*/2 * * * *',
  $cron$
  select net.http_post(
    url := 'https://www.visualskin.cl/api/public/hooks/notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'visualskin_notification_cron_secret'
        limit 1
      )
    ),
    body := jsonb_build_object('limit', 20)
  ) as request_id;
  $cron$
);

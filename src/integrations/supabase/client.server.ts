// Server-side Supabase admin client — service-role / secret key.
// Bypasses RLS. Use only from trusted server-only paths.
//
// The admin key is resolved via getSupabaseAdminKeyConfig() in server-config.
// This module NEVER falls back to publishable/anon keys and NEVER inherits
// an Authorization header from the caller (buyer or admin) session.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import {
  getSupabaseAdminKeyConfig,
  getSupabaseAdminUrl,
  type SupabaseAdminKeyConfig,
} from '@/lib/server-config';

function createAdminFetch(admin: SupabaseAdminKeyConfig): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request
        ? input.headers
        : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    // Never inherit an Authorization header from the caller's session.
    headers.delete('Authorization');
    headers.set('apikey', admin.key);
    // Legacy JWT service-role keys REQUIRE Authorization: Bearer <key>.
    // New sb_secret_ keys are opaque and must travel only in apikey.
    if (admin.type === 'legacy_service_role') {
      headers.set('Authorization', `Bearer ${admin.key}`);
    }
    return fetch(input, { ...init, headers });
  };
}

function createSupabaseAdminClient() {
  // La URL administrativa se lee EXCLUSIVAMENTE de VISUALSKIN_SUPABASE_ADMIN_URL.
  // Lovable reserva el prefijo SUPABASE_ para secretos, por lo que no puede
  // sobreescribirse SUPABASE_URL / SUPABASE_ADMIN_URL desde el panel.
  // Lanza VISUALSKIN_SUPABASE_ADMIN_URL_NOT_CONFIGURED si falta.
  const SUPABASE_ADMIN_URL = getSupabaseAdminUrl();
  // Throws SUPABASE_ADMIN_KEY_* on any misconfiguration.
  const admin = getSupabaseAdminKeyConfig();

  return createClient<Database>(SUPABASE_ADMIN_URL, admin.key, {
    global: {
      fetch: createAdminFetch(admin),
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

// SECURITY: only for trusted server-side operations; never expose to client code.
// Load inside server handlers:
//   const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});

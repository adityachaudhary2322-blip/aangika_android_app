// Opt-in friend discovery. Deploy: supabase functions deploy discover-friends
//
// Input:  { numbers: string[] }  (E.164, from the caller's own contact picker)
// Output: { matches: [{ id, handle, display_name }] }
//
// Privacy rules (India DPDP Act 2023: purpose-limited, consented):
// - the CALLER must have given discovery consent;
// - only profiles that are discoverable AND have a VERIFIED number can match;
// - the reply lists matches only: nothing reveals whether any other number
//   exists, is registered, or is unverified;
// - numbers are never stored or logged; at most 500 per call.
import { createClient } from 'npm:@supabase/supabase-js@2';

const E164 = /^\+[1-9]\d{6,14}$/;
const MAX_NUMBERS = 500;

// Same rule as src/services/phone.js matchVerified(), kept identical.
function matchVerified(profiles: any[], numbers: string[]) {
  const wanted = new Set(numbers);
  return profiles
    .filter((p) => p.discoverable && p.phone_verified && wanted.has(p.phone_e164))
    .map((p) => ({ id: p.id, handle: p.handle, display_name: p.display_name }));
}

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Sign in first.' }, 401);

    const { data: me } = await asUser.from('profiles').select('discovery_consent_at').eq('id', user.id).maybeSingle();
    if (!me?.discovery_consent_at) return json({ error: 'Give discovery consent first.' }, 403);

    const body = await req.json().catch(() => ({}));
    const numbers = [...new Set((body.numbers ?? []).filter((n: unknown) => typeof n === 'string' && E164.test(n)))]
      .slice(0, MAX_NUMBERS) as string[];
    if (!numbers.length) return json({ matches: [] });

    // Service role only to look across profiles; the reply is filtered below.
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await admin.from('profiles')
      .select('id, handle, display_name, phone_e164, phone_verified, discoverable')
      .in('phone_e164', numbers)
      .eq('discoverable', true)
      .eq('phone_verified', true)
      .neq('id', user.id);
    if (error) return json({ error: 'Lookup failed.' }, 500);
    return json({ matches: matchVerified(data ?? [], numbers) });
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
});

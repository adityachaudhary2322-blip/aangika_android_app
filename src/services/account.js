/**
 * Optional accounts (Supabase). The app works fully signed-out and offline;
 * signing in adds a profile, contacts and (opt-in) friend discovery.
 *
 * Configured by VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (gitignored
 * .env.local locally, environment variables on Render). Without them this
 * module reports `configured: false` and makes no network calls at all.
 * The anon key is public by design: Row Level Security on every table
 * (supabase/migrations) is what protects the data.
 */

import { normaliseList } from './phone.js';

const URL = import.meta.env?.VITE_SUPABASE_URL || '';
const ANON = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

export const isConfigured = () => Boolean(URL && ANON);

let client = null;
async function sb() {
  if (!isConfigured()) throw new Error('Accounts are not configured in this build.');
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(URL, ANON, { auth: { persistSession: true, detectSessionInUrl: true } });
  }
  return client;
}

export async function getSession() {
  if (!isConfigured()) return null;
  const { data } = await (await sb()).auth.getSession();
  return data.session || null;
}

export async function onAuthChange(fn) {
  if (!isConfigured()) return () => {};
  const { data } = (await sb()).auth.onAuthStateChange((_e, session) => fn(session));
  return () => data.subscription.unsubscribe();
}

/** Google sign-in, email + profile scopes only. Redirects back to the app. */
export async function signInWithGoogle() {
  const { error } = await (await sb()).auth.signInWithOAuth({
    provider: 'google',
    options: { scopes: 'email profile', redirectTo: window.location.origin },
  });
  if (error) throw error;
}

/**
 * Account from a phone number alone: no SMS, no Google. An anonymous Supabase
 * session is created on this device and the number (plus a name) is saved to
 * it and made findable. Nobody can sign in to it by typing the number: the
 * account lives in this device's session until Google is linked.
 */
export async function signUpWithNumber({ phone, displayName }) {
  if (!phone) throw new Error('Enter a valid phone number.');
  if (!String(displayName || '').trim()) throw new Error('Enter your name, so friends know it is you.');
  const db = await sb();
  if (!(await getSession())) {
    const { error } = await db.auth.signInAnonymously();
    if (error) {
      throw new Error(/anonymous/i.test(error.message)
        ? 'Number sign-up is not enabled on the server yet (Supabase: Authentication > Sign In / Providers > Allow anonymous sign-ins).'
        : error.message);
    }
  }
  const profile = await saveProfile({ phone, displayName: displayName.trim() });
  await setDiscoverable(true);
  return { ...profile, discoverable: true };
}

/** An account made from a number only (no Google linked yet). */
export const isNumberOnly = (session) => Boolean(session?.user?.is_anonymous);

/** Attach Google to a number-only account, to use it on other devices too. */
export async function linkGoogle() {
  const { error } = await (await sb()).auth.linkIdentity({
    provider: 'google', options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut() {
  if (isConfigured()) await (await sb()).auth.signOut();
}

/** The signed-in user's profile (created on first sign-in). */
export async function getProfile() {
  const s = await getSession();
  if (!s) return null;
  const db = await sb();
  const { data, error } = await db.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Create or update the profile. `deviceId` links the app's existing
 * generated id (Messages / Meet) to the account.
 */
export async function saveProfile({ handle, displayName, role, signLanguage, deviceId, phone } = {}) {
  const s = await getSession();
  if (!s) throw new Error('Sign in first.');
  const row = { id: s.user.id };
  if (handle !== undefined) row.handle = String(handle).toLowerCase();
  if (displayName !== undefined) row.display_name = displayName;
  if (role !== undefined) row.role = role;
  if (signLanguage !== undefined) row.sign_language = signLanguage;
  if (deviceId !== undefined) row.device_id = deviceId;
  if (phone !== undefined) row.phone_e164 = phone || null;       // self-declared; never marked verified here
  const { data, error } = await (await sb()).from('profiles').upsert(row).select().single();
  if (error?.code === '23505') {
    throw new Error(/phone/.test(error.message || '')
      ? 'This number is already used by another Aangika account.'
      : 'That handle is taken; try another.');
  }
  if (error) throw error;
  return data;
}

/** Opt in or out of being findable by people who have your number. */
export async function setDiscoverable(on) {
  const s = await getSession();
  if (!s) throw new Error('Sign in first.');
  const patch = on
    ? { discoverable: true, discovery_consent_at: new Date().toISOString() }
    : { discoverable: false };
  const { error } = await (await sb()).from('profiles').update(patch).eq('id', s.user.id);
  if (error) throw error;
}

/**
 * Ask the server which of these numbers belong to discoverable users. The
 * reply contains matches only (each with `verified`); nothing is learned
 * about numbers that did not match. Requires your own consent first.
 */
export async function discoverFriends(rawNumbers) {
  const numbers = normaliseList(rawNumbers);
  if (!numbers.length) return [];
  const { data, error } = await (await sb()).functions.invoke('discover-friends', { body: { numbers } });
  if (error) throw error;
  return data?.matches || [];
}

export async function addContact(contactId) {
  const s = await getSession();
  if (!s) throw new Error('Sign in first.');
  const { error } = await (await sb()).from('contacts').insert({ owner: s.user.id, contact: contactId });
  if (error && error.code !== '23505') throw error;         // already a contact: fine
}

/** Insert rows as the signed-in user (RLS decides what is allowed). */
export async function insertAsUser(table, rows) {
  const s = await getSession();
  if (!s) throw new Error('Sign in first.');
  const { error } = await (await sb()).from(table).insert(rows.map((r) => ({ ...r, owner: s.user.id })));
  if (error) throw error;
}

/** Rows for the review page (admins only, enforced by RLS). */
export async function listForReview(status = 'pending', limit = 50) {
  const { data, error } = await (await sb()).from('contributions')
    .select('id, created_at, label, sign_language, model_id, model_version, frames, feature_dim, review_status, device')
    .eq('review_status', status).order('created_at', { ascending: true }).limit(limit);
  if (error) throw error;
  return data;
}

export async function review(id, status) {
  const s = await getSession();
  const { error } = await (await sb()).from('contributions')
    .update({ review_status: status, reviewed_by: s.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Chrome Android's Contact Picker, if available (read-only, user-chosen). */
export const contactPickerAvailable = () => typeof navigator !== 'undefined'
  && 'contacts' in navigator && typeof navigator.contacts?.select === 'function';

export async function pickContactNumbers() {
  const picked = await navigator.contacts.select(['tel'], { multiple: true });
  return picked.flatMap((c) => c.tel || []);
}

export default {
  isConfigured, getSession, onAuthChange, signInWithGoogle, signOut, getProfile, saveProfile,
  setDiscoverable, discoverFriends, addContact, contactPickerAvailable, pickContactNumbers,
  signUpWithNumber, isNumberOnly, linkGoogle,
};

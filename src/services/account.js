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
/** Phone OTP costs money per SMS: off unless explicitly enabled. */
export const PHONE_OTP_ENABLED = import.meta.env?.VITE_FEATURE_PHONE_OTP === 'true';

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
  if (phone !== undefined) row.phone_e164 = phone || null;       // verified server-side only
  const { data, error } = await (await sb()).from('profiles').upsert(row).select().single();
  if (error) throw error;
  return data;
}

/** Opt in or out of being findable by people who have your verified number. */
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
 * Ask the server which of these numbers belong to discoverable users with a
 * VERIFIED number. The reply contains matches only; nothing is learned about
 * numbers that did not match. Requires your own consent first.
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
  PHONE_OTP_ENABLED,
};

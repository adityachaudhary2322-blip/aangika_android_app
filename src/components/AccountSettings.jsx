import { useEffect, useState } from 'react';
import { LogIn, LogOut, Users, ShieldCheck, Loader2, Phone } from 'lucide-react';
import account, {
  isConfigured, contactPickerAvailable, pickContactNumbers, isNumberOnly,
} from '../services/account.js';
import { ensureProfile } from '../services/chatStorage.js';
import { toE164 } from '../services/phone.js';

/**
 * Settings > Account. Entirely optional: signed out (or with accounts not
 * configured) the app works exactly as before, including offline.
 */
export default function AccountSettings() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [numbers, setNumbers] = useState('');
  const [matches, setMatches] = useState(null);

  useEffect(() => {
    if (!isConfigured()) return undefined;
    let off = () => {};
    account.getSession().then(setSession).catch(() => {});
    account.onAuthChange(setSession).then((u) => { off = u; });
    return () => off();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    account.getProfile().then(async (p) => {
      // First sign-in: create the profile and link this device's existing ID.
      setProfile(p || await account.saveProfile({ deviceId: ensureProfile().handle }).catch(() => null));
    }).catch((e) => setMsg(e.message));
  }, [session]);

  const run = async (fn) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  if (!isConfigured()) {
    return (
      <section className="mt-4 surface-card p-4">
        <p className="eyebrow">Account</p>
        <p className="mt-1 text-[11px] text-ink-dim">
          Optional. This build has no account server configured, so everything stays on this device.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-4 surface-card p-4">
      <p className="eyebrow">Account (optional)</p>
      {!session && (
        <>
          <p className="mt-1 text-[11px] text-ink-dim">
            Let friends find you by your phone number. The app works fully without an account.
          </p>
          <NumberSignUp
            busy={busy}
            onSubmit={(v) => run(async () => {
              const p = await account.signUpWithNumber(v);
              setSession(await account.getSession());
              setProfile(p);
            })}
          />
          <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-dim">
            <span className="h-px flex-1 bg-card-highest" /> or <span className="h-px flex-1 bg-card-highest" />
          </div>
          <button type="button" disabled={busy} onClick={() => run(account.signInWithGoogle)} className="btn-quiet flex w-full items-center justify-center gap-2 text-xs">
            <LogIn size={14} /> Sign in with Google (same account on all your devices)
          </button>
        </>
      )}

      {session && (
        <div className="mt-2 space-y-3">
          {isNumberOnly(session) ? (
            <div className="rounded-xl border border-subtle p-3 text-[12px]">
              <p className="flex items-center gap-1.5"><Phone size={13} className="text-primary" /> Account on this device, by phone number{profile?.phone_e164 ? ` (${profile.phone_e164})` : ''}.</p>
              <p className="mt-1 text-[11px] text-ink-dim">Signing out or clearing app data loses it. Link Google to keep it and use it on other devices.</p>
              <button type="button" disabled={busy} onClick={() => run(account.linkGoogle)} className="btn-quiet mt-2 w-full text-xs">Link Google</button>
            </div>
          ) : (
            <p className="text-[12px]">Signed in as <b>{session.user.email}</b></p>
          )}
          {profile && (
            <ProfileForm profile={profile} busy={busy} onSave={(p) => run(async () => setProfile(await account.saveProfile(p)))} />
          )}

          <div className="rounded-xl border border-subtle p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><Users size={13} /> Find friends (opt-in)</p>
            {!profile?.discoverable ? (
              <button type="button" onClick={() => setConsentOpen(true)} className="btn-quiet mt-2 w-full text-xs">Turn on friend discovery…</button>
            ) : (
              <>
                <p className="mt-1 text-[11px] text-ink-dim">
                  Discovery is on: people who have your number can find you, and you only see
                  matches.
                  <button type="button" className="ml-1 underline" onClick={() => run(async () => { await account.setDiscoverable(false); setProfile({ ...profile, discoverable: false }); })}>Turn off</button>
                </p>
                <div className="mt-2 flex gap-2">
                  {contactPickerAvailable() && (
                    <button type="button" onClick={() => run(async () => setNumbers((await pickContactNumbers()).join('\n')))} className="btn-quiet px-3 text-xs">Pick contacts</button>
                  )}
                  <button type="button" disabled={busy || !numbers.trim()} onClick={() => run(async () => setMatches(await account.discoverFriends(numbers.split(/[\n,;]+/))))}
                    className="btn-quiet flex-1 text-xs disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : 'Find'}</button>
                </div>
                <textarea value={numbers} onChange={(e) => setNumbers(e.target.value)} rows={2}
                  placeholder="Or type numbers, one per line" aria-label="Phone numbers to look up"
                  className="mt-2 w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-xs" />
                {matches && (
                  <ul className="mt-1 space-y-1 text-[12px]">
                    {!matches.length && <li className="text-ink-dim">No matches.</li>}
                    {matches.map((m) => (
                      <li key={m.id} className="flex items-center gap-2">
                        <b>{m.display_name || m.handle}</b>
                        {m.handle && <span className="text-ink-dim">@{m.handle}</span>}
                        {!m.verified && <span className="text-[10px] text-amber" title="Numbers are not checked by SMS">number not verified</span>}
                        <button type="button" onClick={() => run(() => account.addContact(m.id))} className="ml-auto text-[11px] text-primary">Add</button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <button type="button" onClick={() => run(account.signOut)} className="flex items-center gap-1.5 text-[11px] text-ink-dim"><LogOut size={12} /> Sign out</button>
        </div>
      )}

      {consentOpen && (
        <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-[12px] leading-relaxed" role="dialog" aria-label="Friend discovery consent">
          <p className="flex items-center gap-1.5 font-semibold"><ShieldCheck size={14} /> Before you turn this on</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li><b>What:</b> people who already have your phone number can find your Aangika profile, and you can find theirs.</li>
            <li>Numbers are <b>not checked by SMS</b>, so matches are marked “number not verified”: make sure it is really your friend before sharing anything private. Looking someone up never tells you whether a number that did not match is registered.</li>
            <li>Numbers you look up are <b>used once to find matches and not stored</b>.</li>
            <li>You can <b>turn it off at any time</b>, here. Deleting your account deletes your profile and contacts.</li>
            <li>This follows India's Digital Personal Data Protection Act, 2023: used only for this purpose, with your consent.</li>
          </ul>
          {!profile?.phone_e164 && (
            <p className="mt-1 text-[11px] text-amber">Add your phone number to your profile so others can find you too.</p>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setConsentOpen(false)} className="btn-quiet flex-1 text-xs">Not now</button>
            <button type="button" onClick={() => run(async () => { await account.setDiscoverable(true); setProfile({ ...profile, discoverable: true }); setConsentOpen(false); })}
              className="flex-1 rounded-lg bg-primary py-2 text-xs font-semibold text-surface">I agree, turn it on</button>
          </div>
        </div>
      )}

      {msg && <p className="mt-2 text-[11px] text-rose">{msg}</p>}
    </section>
  );
}

/** Account from a phone number: no SMS code. Pressing the button is the consent to be findable. */
function NumberSignUp({ busy, onSubmit }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const e164 = toE164(phone);
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => { e.preventDefault(); if (e164 && name.trim()) onSubmit({ phone: e164, displayName: name }); }}
    >
      <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel"
        placeholder="Your phone number (98765 43210)" aria-label="Your phone number"
        className="w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-sm" />
      <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60}
        placeholder="Your name (what friends see)" aria-label="Your name"
        className="w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-sm" />
      {phone && !e164 && <p className="text-[11px] text-amber">That does not look like a phone number.</p>}
      <p className="text-[11px] leading-snug text-ink-dim">
        No SMS code. People who already have your number will be able to find you on Aangika;
        you can turn that off any time in this section.
      </p>
      <button type="submit" disabled={busy || !e164 || !name.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 text-sm font-semibold text-surface disabled:opacity-40">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />} Continue with my number
      </button>
    </form>
  );
}

function ProfileForm({ profile, busy, onSave }) {
  const [p, setP] = useState({
    handle: profile.handle || '', displayName: profile.display_name || '',
    role: profile.role || 'other', signLanguage: profile.sign_language || 'ISL', phone: profile.phone_e164 || '',
  });
  const phoneOk = !p.phone || toE164(p.phone);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input value={p.handle} onChange={(e) => setP({ ...p, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="handle" aria-label="Handle" className="rounded-lg border border-subtle bg-surface px-3 py-2 text-xs" />
        <input value={p.displayName} onChange={(e) => setP({ ...p, displayName: e.target.value })} placeholder="Display name" aria-label="Display name" className="rounded-lg border border-subtle bg-surface px-3 py-2 text-xs" />
        <select value={p.role} onChange={(e) => setP({ ...p, role: e.target.value })} aria-label="Role" className="rounded-lg border border-subtle bg-surface px-2 py-2 text-xs">
          {['deaf', 'hard_of_hearing', 'hearing', 'interpreter', 'other'].map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={p.signLanguage} onChange={(e) => setP({ ...p, signLanguage: e.target.value })} aria-label="Sign language" className="rounded-lg border border-subtle bg-surface px-2 py-2 text-xs">
          <option value="ISL">ISL</option><option value="ASL">ASL</option>
        </select>
      </div>
      <input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} placeholder="Phone (optional, +91…)" aria-label="Phone number" className="w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-xs" />
      {profile.phone_e164 && (
        <p className="text-[10px] text-ink-dim">
          {profile.discoverable ? 'People who have this number can find you.' : 'Not findable: turn on friend discovery below.'}
        </p>
      )}
      <button type="button" disabled={busy || !phoneOk} onClick={() => onSave({ ...p, phone: p.phone ? toE164(p.phone) : null })} className="btn-quiet w-full text-xs disabled:opacity-40">Save profile</button>
    </div>
  );
}

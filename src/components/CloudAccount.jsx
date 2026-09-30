import { useEffect, useRef, useState } from 'react';
import { LogIn, LogOut, UserPlus, Loader2, CloudUpload } from 'lucide-react';
import session from '../services/session.js';
import { isNativeApp } from '../services/platform.js';

/**
 * Settings > Account (the Aangika server, Cloudflare). Optional: an account
 * keeps My dictionary on every device you sign in on.
 */
export default function CloudAccount() {
  const [s, setS] = useState(() => session.getSession());
  const [mode, setMode] = useState('login');              // login | register
  const [f, setF] = useState({ username: '', pin: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const googleRef = useRef(null);
  const googleOn = Boolean(session.googleClientId()) && !isNativeApp() && session.googleWebAllowed();   // web: Google's own button
  const nativeOn = isNativeApp() && session.hasNativeGoogle();              // Android app: native sign-in
  const nativeGoogle = () => run(async () => {
    const idToken = await session.nativeGoogleToken();
    if (s) await session.linkGoogle(idToken); else await session.googleLogin(idToken);
  }, s ? 'Google linked: you can sign in with it too.' : null);
  const NativeButton = () => (
    <button type="button" disabled={busy} onClick={nativeGoogle} className="btn-quiet w-full py-2 text-sm">
      <span className="font-bold text-[#4285F4]">G</span> Continue with Google
    </button>
  );

  useEffect(() => session.subscribe(setS), []);

  const run = async (fn, done) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (done) setMsg({ ok: true, text: done }); } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  };

  useEffect(() => {
    if (!googleOn) return;
    session.renderGoogleButton(googleRef.current, (idToken) => run(
      () => (s ? session.linkGoogle(idToken) : session.googleLogin(idToken)),
      s ? 'Google linked: you can sign in with it too.' : null,
    ));
  }, [googleOn, s?.token, s?.user?.google]); // eslint-disable-line react-hooks/exhaustive-deps

  if (s) {
    const u = s.user;
    return (
      <section className="mt-4 surface-card space-y-2 p-4">
        <p className="eyebrow">Account</p>
        <p className="text-sm">Signed in as <b>{u.name}</b>{u.username ? <span className="text-ink-dim"> (@{u.username})</span> : ''}</p>
        <p className="flex items-center gap-1.5 text-[11px] text-ink-dim"><CloudUpload size={12} /> My dictionary is saved to your account and appears on every device you sign in on.</p>
        {u.username && !u.google && (googleOn || nativeOn) && (
          <div>
            <p className="text-[11px] text-ink-dim">Link Google, so you can get back in if you forget your PIN:</p>
            {googleOn ? <div ref={googleRef} className="mt-1" /> : <NativeButton />}
          </div>
        )}
        {msg && <p className={'text-[11px] ' + (msg.ok ? 'text-primary' : 'text-rose')}>{msg.text}</p>}
        <button type="button" disabled={busy} onClick={() => run(() => session.logout())} className="btn-quiet px-3 py-2 text-xs"><LogOut size={14} /> Sign out</button>
      </section>
    );
  }

  const register = mode === 'register';
  return (
    <section className="mt-4 surface-card space-y-2 p-4">
      <p className="eyebrow">Account (optional)</p>
      <p className="text-[11px] text-ink-dim">Sign in to keep My dictionary on all your devices. Everything else works without an account.</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => (register ? session.register(f) : session.login(f)));
        }}
      >
        <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="Username" aria-label="Username"
          autoCapitalize="off" autoCorrect="off" spellCheck={false} className="field py-2 text-sm" />
        {register && (
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Your name (shown in calls)" aria-label="Your name" className="field py-2 text-sm" />
        )}
        <input value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} placeholder={register ? 'Choose a PIN (6+ digits)' : 'PIN'} aria-label="PIN"
          type="password" inputMode="numeric" autoComplete={register ? 'new-password' : 'current-password'} className="field py-2 text-sm" />
        {register && <p className="text-[10px] text-ink-dim">No email or SMS. Remember your PIN: it cannot be reset (linking Google later gives you a way back in).</p>}
        {msg && <p className={'text-[11px] ' + (msg.ok ? 'text-primary' : 'text-rose')}>{msg.text}</p>}
        <button type="submit" disabled={busy || !f.username.trim() || f.pin.length < 6} className="btn-primary w-full py-2 text-sm">
          {busy ? <Loader2 size={14} className="animate-spin" /> : register ? <UserPlus size={14} /> : <LogIn size={14} />} {register ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <button type="button" onClick={() => { setMode(register ? 'login' : 'register'); setMsg(null); }} className="w-full text-center text-[11px] text-primary underline">
        {register ? 'I already have an account' : 'New here? Create an account'}
      </button>
      {googleOn && <div className="flex justify-center pt-1"><div ref={googleRef} /></div>}
      {nativeOn && <NativeButton />}
    </section>
  );
}

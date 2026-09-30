import { LogIn } from 'lucide-react';
import useSession from '../hooks/useSession.js';

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/**
 * "Sign in", or who is signed in: opens the Account page.
 *   variant 'row'  the desktop sidebar (a full-width row above Settings)
 *   variant 'pill' the top bar on phones and in the Android app
 */
export default function AccountButton({ onClick, active = false, variant = 'pill' }) {
  const user = useSession();
  const label = user ? `Account: ${user.name}` : 'Sign in';
  const avatar = user && (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b text-[10px] font-bold text-white">
      {initials(user.name)}
    </span>
  );

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={
          'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-sm font-medium transition '
          + (active ? 'bg-primary/10 text-primary' : user ? 'text-ink hover:bg-card-high' : 'text-primary hover:bg-primary/10')
        }
      >
        {user ? avatar : <LogIn size={17} />}
        <span className="min-w-0 truncate">{user ? user.name : 'Sign in'}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={'pill py-1 ' + (user ? 'border-subtle bg-card text-ink' : 'border-primary/40 bg-primary/10 font-semibold text-primary')}
    >
      {user ? avatar : <LogIn size={13} />}
      <span className="max-w-[7rem] truncate">{user ? user.name.split(/\s+/)[0] : 'Sign in'}</span>
    </button>
  );
}

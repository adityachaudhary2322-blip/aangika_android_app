import { ArrowLeft } from 'lucide-react';
import AccountSettings from '../components/AccountSettings.jsx';

/** The Account page: sign in / create an account, or who is signed in. */
export default function Account({ onBack }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 pb-8 no-scrollbar">
      <header className="flex items-center gap-2 pb-1 pt-4 lg:pt-6">
        <button type="button" onClick={onBack} aria-label="Back" className="btn-icon lg:hidden">
          <ArrowLeft size={18} />
        </button>
        <h1 className="display text-3xl">Account</h1>
      </header>
      <div className="max-w-md">
        <AccountSettings />
      </div>
    </div>
  );
}

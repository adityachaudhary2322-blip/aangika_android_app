# Aangika accounts: Supabase setup (optional)

Accounts are **optional**. Without this setup the app works exactly as before:
signed out, and offline. Everything here is off until you fill in the
environment values below.

> **Free-tier note:** free Supabase projects **pause after about a week without
> activity**. Open the dashboard and restore the project before a demo; the
> app keeps working signed-out while it is paused.

## 1. Create the project

1. Go to https://supabase.com, create a project (free tier) and wait for it to start.
2. **Project Settings → API:** copy the **Project URL** and the **anon public** key.

## 2. Apply the database migration (tables + Row Level Security)

Either:
- **Dashboard:** SQL Editor → paste `supabase/migrations/20260929000001_init.sql` → Run.
- **Or the CLI (PowerShell):**
  ```powershell
  npx supabase login
  npx supabase link --project-ref <your-project-ref>
  npx supabase db push
  ```

The migration creates `profiles`, `contacts`, `contributions` and `admins`, with
**RLS enabled on every table**:
- users read and write **only their own rows**;
- contacts' public cards exclude phone numbers;
- `phone_verified` can only be set by the server;
- contributions are insert-only for their owner and reviewable by admins.

Make yourself the reviewer (for the contributions review page):
```sql
insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
```

## 3. Google sign-in (email + profile scopes only)

1. **Google Cloud Console → APIs & Services → Credentials:** create an **OAuth client ID** (Web application).
   - Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
2. **Supabase → Authentication → Providers → Google:** paste the client ID and secret, and enable it.
3. **Supabase → Authentication → URL configuration:** add your site URL (e.g. `https://isl-connect.onrender.com`) and `http://localhost:5173`.

## 4. Friend discovery function

```powershell
npx supabase functions deploy discover-friends
npx supabase secrets set ALLOWED_ORIGIN=https://isl-connect.onrender.com
```

It only returns people who are **discoverable with a verified number**, and
reveals nothing about numbers that did not match.
- **Phone OTP verification stays off** (`VITE_FEATURE_PHONE_OTP=false`), because each SMS costs money.
- To enable it later, configure an SMS provider in Supabase Auth, then set the flag to `true`.

## 5. Tell the app (values to fill in)

**Local development:** create `C:\dev\aangika\.env.local`. It is git-ignored: never commit it.
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_FEATURE_PHONE_OTP=false
```

**Render:** Dashboard → your static site → **Environment** → add the same three variables → redeploy.

The anon key is designed to be public: **RLS is what protects the data**. Never
put the **service_role** key in the app; it belongs only in the Edge Function's
own environment, which Supabase provides automatically.

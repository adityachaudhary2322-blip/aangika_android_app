-- Aangika accounts, contacts and contributions.
-- Row Level Security is ENABLED ON EVERY TABLE; every policy is written out.
-- Apply: see supabase/README.md.

create extension if not exists citext;

-- ── Profiles ──────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  handle              citext unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name        text check (char_length(display_name) <= 60),
  role                text not null default 'other'
                      check (role in ('deaf', 'hard_of_hearing', 'hearing', 'interpreter', 'other')),
  sign_language       text not null default 'ISL' check (sign_language in ('ISL', 'ASL')),
  device_id           text,                       -- the app's existing generated id, linked on sign-in
  phone_e164          text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  phone_verified      boolean not null default false,
  discoverable        boolean not null default false,   -- opt-in friend discovery
  discovery_consent_at timestamptz,                     -- when the user agreed (DPDP Act 2023)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- A user reads and writes only their own row ...
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- ... plus the public card (handle, name) of people in their contacts. The
-- phone number is never exposed through this: see public.contact_cards.
create policy profiles_select_contacts on public.profiles
  for select using (exists (
    select 1 from public.contacts c where c.owner = auth.uid() and c.contact = profiles.id
  ));

-- phone_verified can only be set by the server (OTP flow), never by the user.
create or replace function public.protect_phone_verified() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.phone_verified := false;
    elsif new.phone_verified is distinct from old.phone_verified
       or new.phone_e164 is distinct from old.phone_e164 then
      new.phone_verified := false;              -- a changed number is unverified again
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_protect before insert or update on public.profiles
  for each row execute function public.protect_phone_verified();

-- Contact cards without phone numbers.
create or replace view public.contact_cards with (security_invoker = true) as
  select id, handle, display_name, role, sign_language from public.profiles;

-- ── Contacts ─────────────────────────────────────────────────────────────
create table if not exists public.contacts (
  owner      uuid not null references public.profiles (id) on delete cascade,
  contact    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, contact),
  check (owner <> contact)
);
alter table public.contacts enable row level security;
create policy contacts_select_own on public.contacts for select using (auth.uid() = owner);
create policy contacts_insert_own on public.contacts for insert with check (auth.uid() = owner);
create policy contacts_delete_own on public.contacts for delete using (auth.uid() = owner);

-- ── Admins (review page) ──────────────────────────────────────────────────
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
create policy admins_select_self on public.admins for select using (auth.uid() = user_id);
-- (rows are added by the project owner in the SQL editor; no insert policy)

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ── Contributions (Phase 7) ──────────────────────────────────────────────
create table if not exists public.contributions (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null references public.profiles (id) on delete cascade,
  created_at     timestamptz not null default now(),
  consent        boolean not null check (consent),     -- per-sample consent, always true when stored
  label          text not null check (char_length(label) between 1 and 64),
  sign_language  text not null check (sign_language in ('ISL', 'ASL')),
  model_id       text not null,
  model_version  text not null,
  landmarks      text,          -- base64 float16 window, the model's input format; never video
  frames         int  not null check (frames between 1 and 400),
  feature_dim    int  not null check (feature_dim between 1 and 4096),
  glove_frames   text,          -- base64 raw 20/24-byte glove frames, if a glove was used
  device         jsonb not null default '{}'::jsonb,
  review_status  text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_by    uuid references auth.users (id),
  reviewed_at    timestamptz
);
alter table public.contributions enable row level security;
create policy contributions_insert_own on public.contributions
  for insert with check (auth.uid() = owner and review_status = 'pending' and reviewed_by is null);
create policy contributions_select_own on public.contributions
  for select using (auth.uid() = owner or public.is_admin());
create policy contributions_delete_own on public.contributions
  for delete using (auth.uid() = owner);
create policy contributions_review_admin on public.contributions
  for update using (public.is_admin()) with check (public.is_admin());

create index if not exists contributions_review_idx on public.contributions (review_status, created_at);

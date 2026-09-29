-- Phone numbers without SMS OTP.
--
-- Accounts can be created from a phone number alone (Supabase anonymous
-- sign-in on the device, no SMS), and a saved number makes the profile
-- findable by people who already have that number. Numbers are therefore
-- self-declared: phone_verified stays false unless the server verifies it
-- (protect_phone_verified, in the init migration, still guards that flag).

-- One account per number, so two profiles cannot claim the same one.
create unique index if not exists profiles_phone_unique
  on public.profiles (phone_e164) where phone_e164 is not null;

-- Discovery looks profiles up by number.
create index if not exists profiles_discoverable_phone_idx
  on public.profiles (phone_e164) where discoverable;

-- Pocket PEC access codes.
--
-- * access_codes: one row per code sold. A code is bound to the first device
--   that redeems it; the same device may redeem it again (reinstall), any
--   other device is refused until the seller resets the binding.
-- * admins: Supabase Auth users allowed to manage codes from the access portal.
-- * Row Level Security: only admins can read or change codes. The app never
--   touches these tables directly; it calls the `redeem` edge function, which
--   runs redeem_access_code() with the service role.

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.access_codes (
  id            bigint generated always as identity primary key,
  code          text not null unique check (code ~ '^PEC-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$'),
  buyer         text,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  redeemed_at   timestamptz,          -- first activation
  last_redeemed_at timestamptz,       -- latest activation (reinstalls)
  device_hash   text,                 -- SHA-256 of the app's device id; null = free
  device_label  text,                 -- phone model, for support
  activations   integer not null default 0,
  revoked_at    timestamptz
);

create index if not exists access_codes_created_at_idx on public.access_codes (created_at desc);

alter table public.admins enable row level security;
alter table public.access_codes enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to authenticated;

drop policy if exists "admins read own row" on public.admins;
create policy "admins read own row" on public.admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "admins read codes" on public.access_codes;
create policy "admins read codes" on public.access_codes
  for select to authenticated using (public.is_admin());

drop policy if exists "admins create codes" on public.access_codes;
create policy "admins create codes" on public.access_codes
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admins update codes" on public.access_codes;
create policy "admins update codes" on public.access_codes
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete codes" on public.access_codes;
create policy "admins delete codes" on public.access_codes
  for delete to authenticated using (public.is_admin() and redeemed_at is null);

-- Atomic redemption. Returns one of: ok, invalid, revoked, used.
create or replace function public.redeem_access_code(p_code text, p_device text, p_label text)
returns table (status text, code_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.access_codes;
begin
  select * into r from public.access_codes where code = p_code for update;
  if not found then
    return query select 'invalid'::text, null::bigint;
    return;
  end if;
  if r.revoked_at is not null then
    return query select 'revoked'::text, r.id;
    return;
  end if;
  if r.device_hash is not null and r.device_hash <> p_device then
    return query select 'used'::text, r.id;
    return;
  end if;
  update public.access_codes
     set device_hash      = p_device,
         device_label     = left(coalesce(p_label, device_label), 80),
         redeemed_at      = coalesce(redeemed_at, now()),
         last_redeemed_at = now(),
         activations      = activations + 1
   where id = r.id;
  return query select 'ok'::text, r.id;
end;
$$;

revoke all on function public.redeem_access_code(text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_access_code(text, text, text) to service_role;

-- Umfassendes Budget – Supabase-Schema
-- Im Supabase-Dashboard unter «SQL Editor» einmalig ausführen.
--
-- Sicherheitsmodell: Alle Nutzdaten sind Ende-zu-Ende-verschlüsselt (Chiffretext). Die Tabellen sind per RLS
-- komplett gesperrt (keine Policies); Zugriff erfolgt ausschliesslich über die unten definierten Funktionen,
-- die immer auf auth.uid() prüfen.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  kdf_salt text not null,
  wrapped_mk jsonb not null,            -- Hauptschlüssel, verschlüsselt mit Passwort-Schlüssel
  recovery_salt text not null,
  recovery_wrapped_mk jsonb not null,   -- Hauptschlüssel, verschlüsselt mit Wiederherstellungscode
  created_at timestamptz not null default now()
);

create table if not exists public.vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version int not null default 1,
  iv text not null,
  ct text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  version int not null default 1,
  iv text not null,
  ct text not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  wrapped_hk jsonb,                     -- Haushaltsschlüssel, verschlüsselt mit dem Hauptschlüssel des Mitglieds
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invites (
  code_hash text primary key,           -- SHA-256 des Einladungscodes (Code selbst kennt der Server nie)
  household_id uuid not null references public.households(id) on delete cascade,
  wrapped_hk jsonb not null,            -- Haushaltsschlüssel, verschlüsselt mit einem aus dem Code abgeleiteten Schlüssel
  created_by uuid references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);

alter table public.profiles          enable row level security;
alter table public.vaults            enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
revoke all on public.profiles, public.vaults, public.households, public.household_members, public.household_invites from anon, authenticated;

-- ---------- Hilfsfunktion ----------
create or replace function public._uid() returns uuid language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'nicht angemeldet' using errcode = '28000'; end if;
  return u;
end $$;

-- ---------- Lesen ----------
create or replace function public.get_my_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public._uid();
begin
  return jsonb_build_object(
    'profile', (select to_jsonb(p) - 'user_id' - 'created_at' from public.profiles p where p.user_id = u),
    'vault',   (select jsonb_build_object('version', v.version, 'iv', v.iv, 'ct', v.ct) from public.vaults v where v.user_id = u),
    'households', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'version', h.version, 'iv', h.iv, 'ct', h.ct, 'wrapped_hk', m.wrapped_hk,
        'members', (select coalesce(jsonb_agg(p2.display_name order by mm.joined_at), '[]'::jsonb)
                    from public.household_members mm left join public.profiles p2 on p2.user_id = mm.user_id
                    where mm.household_id = h.id)))
      from public.household_members m join public.households h on h.id = m.household_id
      where m.user_id = u), '[]'::jsonb));
end $$;

-- ---------- Profil ----------
create or replace function public.create_profile(p_display_name text, p_kdf_salt text, p_wrapped_mk jsonb, p_recovery_salt text, p_recovery_wrapped_mk jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(user_id, display_name, kdf_salt, wrapped_mk, recovery_salt, recovery_wrapped_mk)
  values (public._uid(), left(p_display_name, 60), p_kdf_salt, p_wrapped_mk, p_recovery_salt, p_recovery_wrapped_mk);
end $$;

create or replace function public.update_profile_keys(p_kdf_salt text, p_wrapped_mk jsonb, p_recovery_salt text, p_recovery_wrapped_mk jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set kdf_salt = p_kdf_salt, wrapped_mk = p_wrapped_mk,
    recovery_salt = p_recovery_salt, recovery_wrapped_mk = p_recovery_wrapped_mk
  where user_id = public._uid();
end $$;

create or replace function public.set_display_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set display_name = left(p_name, 60) where user_id = public._uid();
end $$;

-- ---------- Persönlicher Tresor (optimistische Versionsprüfung; -1 = Konflikt) ----------
create or replace function public.put_vault(p_expected int, p_iv text, p_ct text) returns int
language plpgsql security definer set search_path = public as $$
declare u uuid := public._uid(); n int;
begin
  if length(p_ct) > 20000000 then raise exception 'zu gross'; end if;
  if p_expected = 0 then
    insert into public.vaults(user_id, version, iv, ct) values (u, 1, p_iv, p_ct) on conflict (user_id) do nothing;
    get diagnostics n = row_count;
    return case when n = 1 then 1 else -1 end;
  end if;
  update public.vaults set version = version + 1, iv = p_iv, ct = p_ct, updated_at = now()
  where user_id = u and version = p_expected returning version into n;
  return coalesce(n, -1);
end $$;

-- ---------- Haushalt ----------
create or replace function public._is_member(p_household uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = p_household and user_id = auth.uid());
$$;

create or replace function public.create_household(p_iv text, p_ct text, p_wrapped_hk jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := public._uid(); hid uuid;
begin
  insert into public.households(iv, ct, created_by) values (p_iv, p_ct, u) returning id into hid;
  insert into public.household_members(household_id, user_id, wrapped_hk) values (hid, u, p_wrapped_hk);
  return hid;
end $$;

create or replace function public.put_household(p_id uuid, p_expected int, p_iv text, p_ct text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public._uid();
  if not public._is_member(p_id) then raise exception 'kein Mitglied' using errcode = '42501'; end if;
  if length(p_ct) > 20000000 then raise exception 'zu gross'; end if;
  update public.households set version = version + 1, iv = p_iv, ct = p_ct, updated_at = now()
  where id = p_id and version = p_expected returning version into n;
  return coalesce(n, -1);
end $$;

create or replace function public.create_invite(p_household uuid, p_code_hash text, p_wrapped_hk jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._uid();
  if not public._is_member(p_household) then raise exception 'kein Mitglied' using errcode = '42501'; end if;
  delete from public.household_invites where expires_at < now();
  if (select count(*) from public.household_invites where household_id = p_household) >= 20 then
    raise exception 'zu viele offene Einladungen';
  end if;
  insert into public.household_invites(code_hash, household_id, wrapped_hk, created_by, expires_at)
  values (p_code_hash, p_household, p_wrapped_hk, auth.uid(), now() + interval '7 days');
end $$;

-- Einladung einlösen (einmalig verwendbar)
create or replace function public.join_household(p_code_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public._uid(); inv public.household_invites;
begin
  select * into inv from public.household_invites where code_hash = p_code_hash and expires_at > now() for update;
  if not found then raise exception 'Einladung ungültig oder abgelaufen'; end if;
  insert into public.household_members(household_id, user_id, wrapped_hk) values (inv.household_id, u, null)
  on conflict (household_id, user_id) do nothing;
  delete from public.household_invites where code_hash = p_code_hash;
  return jsonb_build_object('household_id', inv.household_id, 'wrapped_hk', inv.wrapped_hk);
end $$;

create or replace function public.set_member_key(p_household uuid, p_wrapped_hk jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.household_members set wrapped_hk = p_wrapped_hk where household_id = p_household and user_id = public._uid();
end $$;

create or replace function public.leave_household(p_household uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.household_members where household_id = p_household and user_id = public._uid();
  delete from public.households h where h.id = p_household
    and not exists (select 1 from public.household_members m where m.household_id = h.id);
end $$;

-- ---------- Konto löschen ----------
create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare u uuid := public._uid();
begin
  delete from public.household_members where user_id = u;
  delete from public.households h where not exists (select 1 from public.household_members m where m.household_id = h.id);
  delete from auth.users where id = u;
end $$;

-- ---------- Rechte: nur angemeldete Nutzer dürfen die Funktionen aufrufen ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.get_my_data(), public.create_profile(text, text, jsonb, text, jsonb),
  public.update_profile_keys(text, jsonb, text, jsonb), public.set_display_name(text),
  public.put_vault(int, text, text), public.create_household(text, text, jsonb),
  public.put_household(uuid, int, text, text), public.create_invite(uuid, text, jsonb),
  public.join_household(text), public.set_member_key(uuid, jsonb), public.leave_household(uuid),
  public.delete_account()
to authenticated;

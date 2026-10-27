-- Umfassendes Budget – Dokument-Ablage (Supabase Storage)
-- Im SQL Editor ausführen, NACHDEM schema.sql ausgeführt wurde. Mehrfaches Ausführen ist unschädlich.
--
-- Alle Dokumente werden im Browser verschlüsselt (AES-256-GCM, pro Dokument ein eigener Schlüssel, der nur im
-- verschlüsselten Buchungseintrag steht). Der Server speichert nur unlesbare Binärdaten.
-- Ablage: Bucket «docs», Pfad «<user-id>/<dokument-id>». Schreiben/Löschen nur im eigenen Ordner; Lesen im eigenen
-- Ordner und im Ordner von Haushaltsmitgliedern (die Dateien sind ohne den Dokumentschlüssel wertlos).

insert into storage.buckets (id, name, public, file_size_limit)
values ('docs', 'docs', false, 15728640)
on conflict (id) do update set public = false, file_size_limit = 15728640;

create or replace function public.shares_household(p_owner text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members a
    join public.household_members b on b.household_id = a.household_id
    where a.user_id = auth.uid() and b.user_id::text = p_owner);
$$;
revoke execute on function public.shares_household(text) from public, anon;
grant execute on function public.shares_household(text) to authenticated;

drop policy if exists docs_insert_own on storage.objects;
drop policy if exists docs_update_own on storage.objects;
drop policy if exists docs_delete_own on storage.objects;
drop policy if exists docs_select on storage.objects;

create policy docs_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy docs_update_own on storage.objects for update to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy docs_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy docs_select on storage.objects for select to authenticated
  using (bucket_id = 'docs' and ((storage.foldername(name))[1] = auth.uid()::text
         or public.shares_household((storage.foldername(name))[1])));

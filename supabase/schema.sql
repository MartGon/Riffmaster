-- Riffmaster sync: what the app keeps in Supabase.
-- Paste the whole file into the dashboard's SQL Editor and run it once.
-- Running it again is safe.
--
-- Each signed-in user only ever sees and changes their own rows and files.
-- The library on each device stays the real copy; this is where devices
-- leave their changes for each other.

-- Songs: the library record (title, settings, file hash...) as the app keeps it.
create table if not exists public.songs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  -- When the song was last changed, in ms since the epoch, by the device's clock.
  updated_at bigint not null,
  record jsonb not null,
  -- When this row last changed on the server, so devices fetch only what is new.
  modified timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

-- Practice takes. A take is never changed, only added or removed:
-- a removed take keeps its row with an empty record.
create table if not exists public.takes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  song_id text not null,
  record jsonb,
  modified timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create index if not exists songs_modified on public.songs (user_id, modified, id);
create index if not exists takes_modified on public.takes (user_id, modified, id);

create or replace function public.touch_modified() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.modified := clock_timestamp();
  return new;
end $$;

drop trigger if exists songs_modified on public.songs;
create trigger songs_modified before insert or update on public.songs
  for each row execute function public.touch_modified();
drop trigger if exists takes_modified on public.takes;
create trigger takes_modified before insert or update on public.takes
  for each row execute function public.touch_modified();

alter table public.songs enable row level security;
alter table public.takes enable row level security;

drop policy if exists "own songs" on public.songs;
create policy "own songs" on public.songs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own takes" on public.takes;
create policy "own takes" on public.takes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Stores songs, keeping the newer of two versions of a song.
-- rows: [{ "id": ..., "updatedAt": ..., "record": {...} }]
create or replace function public.push_songs(rows jsonb) returns void
language sql security invoker set search_path = '' as $$
  insert into public.songs (user_id, id, updated_at, record)
  select auth.uid(), r ->> 'id', (r ->> 'updatedAt')::bigint, r -> 'record'
  from jsonb_array_elements(rows) as r
  on conflict (user_id, id) do update
    set updated_at = excluded.updated_at, record = excluded.record
    where public.songs.updated_at < excluded.updated_at;
$$;

-- Stores takes. A removal is kept even if the take arrives again later.
-- rows: [{ "id": ..., "songId": ..., "record": {...} or null }]
create or replace function public.push_takes(rows jsonb) returns void
language sql security invoker set search_path = '' as $$
  insert into public.takes (user_id, id, song_id, record)
  select auth.uid(), r ->> 'id', r ->> 'songId', nullif(r -> 'record', 'null'::jsonb)
  from jsonb_array_elements(rows) as r
  on conflict (user_id, id) do update
    set record = null
    where excluded.record is null and public.takes.record is not null;
$$;

revoke execute on function public.push_songs(jsonb) from anon, public;
revoke execute on function public.push_takes(jsonb) from anon, public;
grant execute on function public.push_songs(jsonb) to authenticated;
grant execute on function public.push_takes(jsonb) to authenticated;

-- Tab files, one per version of a file, named by its SHA-256 in a folder
-- per user: tabs/<user id>/<hash>. Private: only the owner can read them.
insert into storage.buckets (id, name, public)
values ('tabs', 'tabs', false)
on conflict (id) do nothing;

drop policy if exists "read own tabs" on storage.objects;
create policy "read own tabs" on storage.objects for select to authenticated
  using (bucket_id = 'tabs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "add own tabs" on storage.objects;
create policy "add own tabs" on storage.objects for insert to authenticated
  with check (bucket_id = 'tabs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table user_saved_addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  label        text not null,
  address_text text not null,
  city         text not null,
  state        text not null,
  lat          numeric(10, 7) not null,
  lng          numeric(10, 7) not null,
  created_at   timestamptz not null default now()
);

alter table user_saved_addresses enable row level security;
create policy "users manage own addresses"
  on user_saved_addresses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table recent_locations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  address_text text not null,
  city         text not null,
  state        text not null,
  lat          numeric(10, 7) not null,
  lng          numeric(10, 7) not null,
  used_at      timestamptz not null default now()
);

alter table recent_locations enable row level security;
create policy "users manage own recent locations"
  on recent_locations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_saved_addresses to authenticated;
grant select, insert, update, delete on public.recent_locations to authenticated;

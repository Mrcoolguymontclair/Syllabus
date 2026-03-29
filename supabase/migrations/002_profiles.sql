create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  ical_url text,
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can read and update their own profile"
  on public.profiles
  for all
  using (auth.uid() = id);

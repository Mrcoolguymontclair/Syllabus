create extension if not exists "uuid-ossp";

create table public.assignments (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  ical_uid text not null,
  title text not null,
  description text,
  due_date timestamptz not null,
  class_name text,
  assignment_type text,
  status boolean default false not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, ical_uid)
);

alter table public.assignments enable row level security;

create policy "Users can only access their own assignments"
  on public.assignments
  for all
  using (auth.uid() = user_id);

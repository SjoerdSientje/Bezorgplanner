create table if not exists public.paklijst_history (
  id bigint generated always as identity primary key,
  owner_email text not null,
  generated_at timestamptz not null default now(),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists paklijst_history_owner_generated_idx
  on public.paklijst_history (owner_email, generated_at desc);

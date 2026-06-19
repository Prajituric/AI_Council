-- AI Council v6 — Initial Schema

create extension if not exists "pgcrypto";

-- CHATS
create table if not exists chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null default 'default',
  title       text not null default 'New chat',
  model_ids   text[] default '{}',
  msg_count   integer default 0,
  preview     text default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_chats_user    on chats(user_id, updated_at desc);
create index if not exists idx_chats_updated on chats(updated_at desc);

-- MESSAGES
create table if not exists messages (
  id             uuid primary key default gen_random_uuid(),
  chat_id        uuid not null references chats(id) on delete cascade,
  user_id        text not null default 'default',
  seq            integer not null default 0,
  active_variant integer not null default 0,
  variants       jsonb not null default '[]',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_messages_chat    on messages(chat_id, seq asc);
create index if not exists idx_messages_user    on messages(user_id);

-- STORED FILES
create table if not exists stored_files (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null default 'default',
  r2_key         text not null unique,
  url            text not null,
  name           text not null,
  type           text not null,
  size           bigint default 0,
  chat_id        uuid references chats(id) on delete set null,
  extracted_text text,
  job_id         text,
  created_at     timestamptz default now()
);
create index if not exists idx_files_user    on stored_files(user_id, created_at desc);
create index if not exists idx_files_chat    on stored_files(chat_id);

-- EXTRACTION JOBS
create table if not exists extraction_jobs (
  id             text primary key,
  user_id        text not null default 'default',
  chat_id        uuid references chats(id) on delete set null,
  file_name      text,
  file_type      text,
  status         text not null default 'pending',
  extracted_text text,
  error_msg      text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_jobs_user   on extraction_jobs(user_id, created_at desc);
create index if not exists idx_jobs_status on extraction_jobs(status);

-- PREFERENCES
create table if not exists preferences (
  user_id    text not null default 'default',
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

-- TOKEN USAGE LOG
create table if not exists usage_log (
  id             bigint generated always as identity primary key,
  user_id        text not null default 'default',
  provider       text not null,
  model_name     text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  total_tokens   integer not null default 0,
  created_at     timestamptz default now()
);
create index if not exists idx_usage_user  on usage_log(user_id, created_at desc);
create index if not exists idx_usage_month on usage_log(created_at desc);

-- RESPONSE CACHE
create table if not exists response_cache (
  cache_key      text primary key,
  user_id        text not null default 'default',
  provider       text not null,
  model_name     text not null,
  response_text  text not null,
  hit_count      integer not null default 1,
  created_at     timestamptz default now(),
  last_hit_at    timestamptz default now()
);
create index if not exists idx_cache_created on response_cache(created_at desc);

-- RATE LIMITS
create table if not exists rate_limits (
  id         bigint generated always as identity primary key,
  user_id    text not null,
  created_at timestamptz default now()
);
create index if not exists idx_rate_user_time on rate_limits(user_id, created_at desc);

-- Auto-update chat on new message
create or replace function _touch_chat()
returns trigger language plpgsql as $$
begin
  update chats
  set updated_at = now(),
      msg_count  = (select count(*) from messages where chat_id = new.chat_id)
  where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists trigger_touch_chat on messages;
create trigger trigger_touch_chat
  after insert or update on messages
  for each row execute function _touch_chat();

-- USER SKILLS
create table if not exists user_skills (
  user_id    text not null,
  skill_id   text not null,
  skill_json jsonb not null,
  updated_at timestamptz default now(),
  primary key (user_id, skill_id)
);
create index if not exists idx_user_skills_user on user_skills(user_id);

-- MODEL PERFORMANCE
create table if not exists model_performance (
  model_name    text not null,
  question_type text not null,
  avg_score     numeric not null default 0,
  sample_count  integer not null default 0,
  updated_at    timestamptz default now(),
  primary key (model_name, question_type)
);
create index if not exists idx_perf_type on model_performance(question_type, avg_score desc);

-- NOTIFICATIONS
create table if not exists notifications (
  id         text primary key default gen_random_uuid()::text,
  user_id    text not null default 'default',
  type       text not null,
  message    text not null,
  data       jsonb,
  read       boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_notif_user on notifications(user_id, created_at desc);
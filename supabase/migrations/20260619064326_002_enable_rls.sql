-- Enable RLS on all tables with proper type handling
-- user_id is TEXT (not UUID), so we compare as text

-- Enable RLS on all tables
alter table chats enable row level security;
alter table messages enable row level security;
alter table stored_files enable row level security;
alter table extraction_jobs enable row level security;
alter table preferences enable row level security;
alter table usage_log enable row level security;
alter table response_cache enable row level security;
alter table rate_limits enable row level security;
alter table user_skills enable row level security;
alter table model_performance enable row level security;
alter table notifications enable row level security;

-- CHATS policies
create policy "select_own_chats" on chats for select to authenticated using (user_id = auth.uid()::text);
create policy "insert_own_chats" on chats for insert to authenticated with check (user_id = auth.uid()::text);
create policy "update_own_chats" on chats for update to authenticated using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
create policy "delete_own_chats" on chats for delete to authenticated using (user_id = auth.uid()::text);

-- MESSAGES policies
create policy "select_own_messages" on messages for select to authenticated using (user_id = auth.uid()::text);
create policy "insert_own_messages" on messages for insert to authenticated with check (user_id = auth.uid()::text);
create policy "update_own_messages" on messages for update to authenticated using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
create policy "delete_own_messages" on messages for delete to authenticated using (user_id = auth.uid()::text);

-- STORED_FILES policies
create policy "select_own_files" on stored_files for select to authenticated using (user_id = auth.uid()::text);
create policy "insert_own_files" on stored_files for insert to authenticated with check (user_id = auth.uid()::text);
create policy "update_own_files" on stored_files for update to authenticated using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
create policy "delete_own_files" on stored_files for delete to authenticated using (user_id = auth.uid()::text);

-- EXTRACTION_JOBS policies
create policy "select_own_jobs" on extraction_jobs for select to authenticated using (user_id = auth.uid()::text);
create policy "insert_own_jobs" on extraction_jobs for insert to authenticated with check (user_id = auth.uid()::text);
create policy "update_own_jobs" on extraction_jobs for update to authenticated using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
create policy "delete_own_jobs" on extraction_jobs for delete to authenticated using (user_id = auth.uid()::text);

-- PREFERENCES policies
create policy "select_own_prefs" on preferences for select to authenticated using (user_id = auth.uid()::text);
create policy "insert_own_prefs" on preferences for insert to authenticated with check (user_id = auth.uid()::text);
create policy "update_own_prefs" on preferences for update to authenticated using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
create policy "delete_own_prefs" on preferences for delete to authenticated using (user_id = auth.uid()::text);

-- USAGE_LOG policies (read-only for users, insert allowed)
create policy "select_own_usage" on usage_log for select to authenticated using (user_id = auth.uid()::text);
create policy "insert_own_usage" on usage_log for insert to authenticated with check (user_id = auth.uid()::text);

-- RESPONSE_CACHE policies
create policy "select_own_cache" on response_cache for select to authenticated using (user_id = auth.uid()::text);
create policy "insert_own_cache" on response_cache for insert to authenticated with check (user_id = auth.uid()::text);
create policy "update_own_cache" on response_cache for update to authenticated using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);

-- RATE_LIMITS policies
create policy "select_own_limits" on rate_limits for select to authenticated using (user_id = auth.uid()::text);
create policy "insert_own_limits" on rate_limits for insert to authenticated with check (user_id = auth.uid()::text);
create policy "delete_own_limits" on rate_limits for delete to authenticated using (user_id = auth.uid()::text);

-- USER_SKILLS policies
create policy "select_own_skills" on user_skills for select to authenticated using (user_id = auth.uid()::text);
create policy "insert_own_skills" on user_skills for insert to authenticated with check (user_id = auth.uid()::text);
create policy "update_own_skills" on user_skills for update to authenticated using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
create policy "delete_own_skills" on user_skills for delete to authenticated using (user_id = auth.uid()::text);

-- MODEL_PERFORMANCE is read-only for authenticated users (populated by server)
create policy "select_perf" on model_performance for select to authenticated using (true);

-- NOTIFICATIONS policies
create policy "select_own_notif" on notifications for select to authenticated using (user_id = auth.uid()::text);
create policy "update_own_notif" on notifications for update to authenticated using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
-- SignalScope schema. Run once in Supabase SQL editor.
create table organizations(id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now());
create table memberships(org_id uuid references organizations on delete cascade, user_id uuid references auth.users on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','member')), primary key(org_id,user_id));
create function is_member(o uuid) returns boolean language sql security definer stable set search_path=public
as $$ select exists(select 1 from memberships where org_id=o and user_id=auth.uid()) $$;

create table brands(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, name text not null, domain text, created_at timestamptz default now());
create table competitors(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, brand_id uuid not null references brands on delete cascade, name text not null, domain text);
create table prompts(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, brand_id uuid not null references brands on delete cascade, question text not null check (length(question) between 8 and 300), created_at timestamptz default now());
create table monitoring_runs(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, prompt_id uuid not null references prompts on delete cascade, provider text, model text, status text check (status in ('success','failed')), error text, created_at timestamptz default now());
create table ai_responses(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, run_id uuid not null references monitoring_runs on delete cascade, answer text, brand_mentioned boolean, competitors_mentioned text[] default '{}', created_at timestamptz default now());
create table citations(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, response_id uuid not null references ai_responses on delete cascade, url text, domain text);
create table website_audits(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, brand_id uuid not null references brands on delete cascade, url text, http_status int, created_at timestamptz default now());
create table audit_issues(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, audit_id uuid not null references website_audits on delete cascade, check_name text, passed boolean, severity text, detail text, recommendation text);
create table action_items(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, brand_id uuid not null references brands on delete cascade, issue text, evidence text, why text, recommendation text, priority text, effort text,
  status text not null default 'pending' check (status in ('pending','in_progress','complete')), created_at timestamptz default now());

-- Row-level security: members see only their own organisation's rows.
do $$ declare t text; begin
 foreach t in array array['organizations','memberships','brands','competitors','prompts','monitoring_runs','ai_responses','citations','website_audits','audit_issues','action_items'] loop
  execute format('alter table %I enable row level security', t); end loop; end $$;
create policy org_sel on organizations for select using (is_member(id));
create policy mem_sel on memberships for select using (user_id=auth.uid());
-- Tables the browser may write to:
create policy brands_all on brands for all using (is_member(org_id)) with check (is_member(org_id));
create policy comp_all on competitors for all using (is_member(org_id)) with check (is_member(org_id));
create policy prompts_all on prompts for all using (is_member(org_id)) with check (is_member(org_id));
create policy actions_all on action_items for all using (is_member(org_id)) with check (is_member(org_id));
-- Read-only from the browser; written only by Edge Functions (service role):
create policy runs_sel on monitoring_runs for select using (is_member(org_id));
create policy resp_sel on ai_responses for select using (is_member(org_id));
create policy cit_sel on citations for select using (is_member(org_id));
create policy aud_sel on website_audits for select using (is_member(org_id));
create policy iss_sel on audit_issues for select using (is_member(org_id));

-- Every new user gets their own organisation.
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare o uuid; begin
 insert into organizations(name) values (coalesce(nullif(new.raw_user_meta_data->>'org',''),'My organisation')) returning id into o;
 insert into memberships(org_id,user_id,role) values (o,new.id,'owner'); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

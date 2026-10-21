-- Run AFTER schema.sql. Adds plans, client limits, suspension and the platform admin role.
alter table organizations
  add column status text not null default 'active' check (status in ('active','suspended')),
  add column plan text not null default 'starter',
  add column max_brands int not null default 1,
  add column max_questions int not null default 10,
  add column daily_run_limit int not null default 10;

create table platform_admins(user_id uuid primary key references auth.users on delete cascade);
alter table platform_admins enable row level security;
create policy pa_sel on platform_admins for select using (user_id=auth.uid());

create function is_admin() returns boolean language sql security definer stable set search_path=public
as $$ select exists(select 1 from platform_admins where user_id=auth.uid()) $$;

-- Admins can see/operate on every organisation; clients only their own ACTIVE organisation.
create or replace function is_member(o uuid) returns boolean language sql security definer stable set search_path=public
as $$ select is_admin() or exists(select 1 from memberships m join organizations g on g.id=m.org_id
  where m.org_id=o and m.user_id=auth.uid() and g.status='active') $$;

-- Plan limits enforced in the database (clients cannot bypass them from the browser).
create function enforce_limits() returns trigger language plpgsql security definer set search_path=public as $$
declare mx int; c int; begin
 if is_admin() then return new; end if;
 if tg_table_name='brands' then
  select max_brands into mx from organizations where id=new.org_id; select count(*) into c from brands where org_id=new.org_id;
 else
  select max_questions into mx from organizations where id=new.org_id; select count(*) into c from prompts where org_id=new.org_id;
 end if;
 if c>=mx then raise exception 'Plan limit reached (% allowed). Contact your provider to upgrade.', mx; end if;
 return new; end $$;
create trigger lim_brands before insert on brands for each row execute function enforce_limits();
create trigger lim_prompts before insert on prompts for each row execute function enforce_limits();

-- Make YOURSELF the platform admin (use the email you log in with):
insert into platform_admins(user_id) select id from auth.users where email='demo@gmail.com';

-- ============================================================================
-- App Corrida - Schema do banco de dados (Supabase / PostgreSQL)
-- ============================================================================
-- Este script cria as tabelas, funcoes de seguranca, RLS, politicas e o
-- trigger que cria o perfil do paciente no cadastro.
-- O script foi escrito para ser idempotente: pode ser executado novamente
-- sem quebrar (usa "if not exists", "drop policy if exists" e
-- "create or replace function").
-- Execute no SQL Editor do Supabase.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Extensoes necessarias
-- ----------------------------------------------------------------------------
-- gen_random_uuid() vem da extensao pgcrypto. No Supabase ela ja costuma
-- estar habilitada, mas garantimos aqui por seguranca.
create extension if not exists pgcrypto;


-- ----------------------------------------------------------------------------
-- Tabela profiles
-- ----------------------------------------------------------------------------
-- Cada perfil corresponde a um usuario do Supabase Auth (auth.users).
-- O id do perfil e o mesmo id do usuario de autenticacao.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  role        text not null default 'patient' check (role in ('admin', 'patient')),
  active       boolean not null default true,
  created_at  timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- Tabela races
-- ----------------------------------------------------------------------------
-- Cada prova pertence a um paciente (user_id referencia profiles.id).
-- A coluna race_date e do tipo date e guarda a data no formato ISO (yyyy-mm-dd).
-- A conversao de "DD/MM/YYYY" (vinda da extracao) para ISO e feita no navegador.
create table if not exists public.races (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  name                 text not null,
  url                  text,
  race_date            date,
  location             text,
  distances            text,
  kit_pickup_date      text,
  kit_pickup_location  text,
  route_summary        text,
  notes                text,
  kit_picked_up        boolean not null default false,
  created_at           timestamptz not null default now()
);

-- Indice para acelerar a busca das provas por paciente.
create index if not exists races_user_id_idx on public.races (user_id);


-- ----------------------------------------------------------------------------
-- Funcao de seguranca: is_admin()
-- ----------------------------------------------------------------------------
-- Retorna true quando o usuario que fez a chamada (auth.uid()) tem um perfil
-- com role = 'admin' e active = true.
-- E security definer para conseguir ler profiles sem cair na propria RLS,
-- evitando recursao infinita nas politicas.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.active = true
  );
$$;


-- ----------------------------------------------------------------------------
-- Funcao de seguranca: is_active()
-- ----------------------------------------------------------------------------
-- Retorna true quando o perfil do usuario que chamou esta ativo (active = true).
-- Um paciente desativado nao consegue ler nem gravar nenhum dado.
create or replace function public.is_active()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
  );
$$;


-- ----------------------------------------------------------------------------
-- Habilita Row Level Security (RLS) nas duas tabelas
-- ----------------------------------------------------------------------------
-- Com RLS habilitado, nada e acessivel sem uma politica que permita.
alter table public.profiles enable row level security;
alter table public.races    enable row level security;


-- ----------------------------------------------------------------------------
-- Politicas da tabela profiles
-- ----------------------------------------------------------------------------
-- SELECT: o usuario ve o proprio perfil; o admin ve todos.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  using (id = auth.uid() or public.is_admin());

-- UPDATE: apenas admin edita perfis (por exemplo, ativar/desativar paciente).
-- Pacientes nunca escrevem na tabela profiles.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (public.is_admin())
  with check (public.is_admin());


-- ----------------------------------------------------------------------------
-- Politicas da tabela races
-- ----------------------------------------------------------------------------
-- SELECT: o paciente ativo ve as proprias provas; o admin ve todas.
drop policy if exists races_select on public.races;
create policy races_select on public.races
  for select
  using ((user_id = auth.uid() and public.is_active()) or public.is_admin());

-- INSERT: o paciente ativo so cria provas para si mesmo.
drop policy if exists races_insert on public.races;
create policy races_insert on public.races
  for insert
  with check (user_id = auth.uid() and public.is_active());

-- UPDATE: o paciente ativo so altera as proprias provas.
drop policy if exists races_update on public.races;
create policy races_update on public.races
  for update
  using (user_id = auth.uid() and public.is_active())
  with check (user_id = auth.uid() and public.is_active());

-- DELETE: o paciente ativo apaga as proprias provas; o admin apaga qualquer uma.
drop policy if exists races_delete on public.races;
create policy races_delete on public.races
  for delete
  using ((user_id = auth.uid() and public.is_active()) or public.is_admin());


-- ----------------------------------------------------------------------------
-- Trigger de novo usuario: cria a linha em profiles
-- ----------------------------------------------------------------------------
-- Quando um usuario se cadastra (insert em auth.users), criamos o perfil
-- correspondente com role 'patient' e active true.
-- O full_name vem do metadado enviado no cadastro
-- (new.raw_user_meta_data ->> 'full_name') e o email vem de new.email.
-- A funcao e security definer para conseguir gravar em public.profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role, active)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    'patient',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Recria o trigger de forma idempotente.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Permissoes necessarias no Supabase self-hosted:
-- o GoTrue cria usuarios usando o papel supabase_auth_admin, que por padrao
-- nao tem acesso ao schema public. Sem isto, o trigger acima falha ao ser
-- chamado e o cadastro retorna erro 500 ("Database error saving new user").
grant usage on schema public to supabase_auth_admin;
grant execute on function public.handle_new_user() to supabase_auth_admin;


-- ----------------------------------------------------------------------------
-- Como promover um administrador
-- ----------------------------------------------------------------------------
-- Cadastre o usuario normalmente pela tela de login e depois rode a linha
-- abaixo (sem o comentario), trocando o email pelo email do administrador:
--
-- update public.profiles set role = 'admin' where email = 'admin@exemplo.com';
-- ============================================================================

-- =============================================
-- JOGOS EM FAMÍLIA — Schema Supabase
-- Execute este SQL no SQL Editor do seu projeto
-- em: https://supabase.com/dashboard/project/_/sql
-- =============================================

-- Extensão UUID (já vem ativada por padrão no Supabase)
create extension if not exists "uuid-ossp";

-- =============================================
-- TABELA: game_sessions
-- Representa uma sala/sessão de jogo
-- =============================================
create table if not exists public.game_sessions (
  id            uuid primary key default gen_random_uuid(),
  game_type     text not null default 'bingo',
  -- 'lobby'    = aguardando jogadores
  -- 'playing'  = jogo em andamento
  -- 'finished' = jogo encerrado
  status        text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  current_number integer,
  drawn_numbers  integer[] not null default '{}',
  all_marked     boolean not null default false,
  winner_id      uuid,
  winner_name    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- =============================================
-- TABELA: players
-- Representa cada jogador numa sessão
-- =============================================
create table if not exists public.players (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.game_sessions(id) on delete cascade,
  name             text not null,
  is_ready         boolean not null default false,
  has_marked       boolean not null default false,
  -- card: array 5x5 de números (0 = espaço FREE no centro)
  -- ex: [[1,23,45,67,89],[...],...]
  card             jsonb,
  -- marked_positions: índices planos 0-24 das posições marcadas pelo jogador
  marked_positions integer[] not null default '{}',
  created_at       timestamptz not null default now()
);

-- Índice para buscas por sessão
create index if not exists players_session_id_idx on public.players(session_id);

-- =============================================
-- TRIGGER: atualiza updated_at em game_sessions
-- =============================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.game_sessions;
create trigger set_updated_at
  before update on public.game_sessions
  for each row execute function public.handle_updated_at();

-- =============================================
-- ROW LEVEL SECURITY
-- Política permissiva para usuários anônimos
-- (adequado para jogo local sem autenticação)
-- =============================================
alter table public.game_sessions enable row level security;
alter table public.players enable row level security;

-- Permite leitura e escrita para todos (anon key)
create policy "Acesso público a game_sessions"
  on public.game_sessions for all
  using (true)
  with check (true);

create policy "Acesso público a players"
  on public.players for all
  using (true)
  with check (true);

-- =============================================
-- REALTIME
-- Habilita publicação de mudanças em tempo real
-- =============================================
alter publication supabase_realtime add table public.game_sessions;
alter publication supabase_realtime add table public.players;

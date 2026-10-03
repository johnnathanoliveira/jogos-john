-- =============================================
-- KARAOKÊ — Schema adicional
-- Execute DEPOIS do schema.sql principal
-- =============================================

-- =============================================
-- TABELA: karaoke_songs
-- Fila de músicas de cada jogador na sessão
-- =============================================
create table if not exists public.karaoke_songs (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.game_sessions(id) on delete cascade,
  player_id     uuid not null,
  player_name   text not null,
  youtube_id    text not null,
  song_title    text not null,
  artist        text not null default '',
  thumbnail     text default '',
  lyrics        text,
  -- queued   = aguardando sua vez
  -- singing  = cantando agora
  -- done     = já cantou
  status        text not null default 'queued' check (status in ('queued','singing','done')),
  order_index   integer default 999,
  created_at    timestamptz default now()
);

create index if not exists karaoke_songs_session_id_idx on public.karaoke_songs(session_id);
create index if not exists karaoke_songs_status_idx    on public.karaoke_songs(status);

-- =============================================
-- TABELA: karaoke_ratings
-- Avaliações de estrelas (1-5) por música
-- Um voto por jogador por música (UNIQUE)
-- =============================================
create table if not exists public.karaoke_ratings (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid not null references public.karaoke_songs(id) on delete cascade,
  session_id    uuid not null,
  player_id     uuid not null,
  rating        integer not null check (rating between 1 and 5),
  created_at    timestamptz default now(),
  unique (song_id, player_id)
);

create index if not exists karaoke_ratings_song_id_idx on public.karaoke_ratings(song_id);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
alter table public.karaoke_songs   enable row level security;
alter table public.karaoke_ratings enable row level security;

create policy "Acesso público karaoke_songs"
  on public.karaoke_songs for all using (true) with check (true);

create policy "Acesso público karaoke_ratings"
  on public.karaoke_ratings for all using (true) with check (true);

-- =============================================
-- REALTIME
-- =============================================
alter publication supabase_realtime add table public.karaoke_songs;
alter publication supabase_realtime add table public.karaoke_ratings;

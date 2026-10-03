-- =============================================
-- Migration: adiciona spotify_track_id em karaoke_songs
-- Execute no SQL Editor do Supabase APÓS o karaoke-schema.sql
-- =============================================
ALTER TABLE public.karaoke_songs
  ADD COLUMN IF NOT EXISTS spotify_track_id TEXT;

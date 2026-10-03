'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import type { GameSession, Player, KaraokeSong, KaraokeRating } from '@/lib/types'
import { PLAYER_COLORS, avgRating } from '@/lib/types'

const QRCodeSVG = dynamic(() => import('qrcode.react').then(m => m.QRCodeSVG), {
  ssr: false,
  loading: () => <div className="w-48 h-48 bg-white/10 animate-pulse rounded-xl" />,
})

// ── YouTube IFrame API types ──────────────────────────────
declare global {
  interface Window {
    YT: { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer } & Record<string, unknown>
    onYouTubeIframeAPIReady?: () => void
    // Spotify Web Playback SDK
    onSpotifyWebPlaybackSDKReady?: () => void
    Spotify?: {
      Player: new (opts: {
        name: string
        getOAuthToken: (cb: (token: string) => void) => void
        volume?: number
      }) => SpotifySDKPlayer
    }
  }
}
interface YTPlayer { playVideo(): void; getCurrentTime(): number; destroy(): void }
interface SpotifySDKPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(event: 'ready',                 cb: (d: { device_id: string }) => void): boolean
  addListener(event: 'player_state_changed',  cb: (s: SpotifyPlayState | null) => void): boolean
  getCurrentState(): Promise<SpotifyPlayState | null>
  pause(): Promise<void>
  resume(): Promise<void>
}
interface SpotifyPlayState { position: number; duration: number; paused: boolean }

// ── LRC utilities ─────────────────────────────────────────
interface LrcLine { time: number; text: string }

/** Detecta se o texto está no formato LRC com timestamps */
function isLrc(s: string): boolean {
  // Ex: [00:30.13] ou [01:23:45] ou [1:23.456]
  return /\[\d{1,3}:\d{2}[.:,]\d+\]/m.test(s)
}

/** Converte texto LRC em array de linhas com tempo em segundos */
function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = []
  // Aceita [MM:SS.cs], [MM:SS:cs], [MM:SS,cs] com 1-3 dígitos decimais
  const re = /\[(\d{1,3}):(\d{2})[.:,](\d{1,3})\][^\n]*/gm
  let m
  while ((m = re.exec(lrc)) !== null) {
    const min = parseInt(m[1], 10)
    const sec = parseInt(m[2], 10)
    // Normaliza para ms: "13" → 130ms, "1" → 100ms, "130" → 130ms
    const raw = m[3]
    const ms = parseInt(raw.length === 1 ? raw + '00' : raw.length === 2 ? raw + '0' : raw, 10)
    const t = min * 60 + sec + ms / 1000
    // Remove o timestamp da linha para pegar só o texto
    const text = m[0].replace(/\[\d{1,3}:\d{2}[.:,]\d+\]/g, '').trim()
    if (text) lines.push({ time: t, text })
  }
  return lines.sort((a, b) => a.time - b.time)
}

interface FloatingEmoji { id: string; emoji: string; x: number; playerName: string }

// ══════════════════════════════════════════════════════════
// Página principal
// ══════════════════════════════════════════════════════════
export default function KaraokeHostPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()

  const [session,        setSession]        = useState<GameSession | null>(null)
  const [players,        setPlayers]        = useState<Player[]>([])
  const [songs,          setSongs]          = useState<KaraokeSong[]>([])
  const [ratings,        setRatings]        = useState<KaraokeRating[]>([])
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([])
  const [playerUrl,      setPlayerUrl]      = useState('')
  const [loadError,      setLoadError]      = useState(false)
  // Letras buscadas em tempo real para músicas sem letra salva
  const [liveLyrics,     setLiveLyrics]     = useState<Record<string, string>>({})
  // Conexão Spotify do host (OAuth — para letras sincronizadas de alta qualidade)
  const [spotifyConnected, setSpotifyConnected] = useState(false)

  const emojiChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Verifica status do Spotify + detecta redirect após OAuth
  useEffect(() => {
    fetch('/api/spotify/status').then(r => r.json()).then(d => {
      if (d.connected) setSpotifyConnected(true)
    }).catch(() => {})

    // Redirigido de volta após autenticação
    const url = new URL(window.location.href)
    if (url.searchParams.has('spotify_connected')) {
      setSpotifyConnected(true)
      url.searchParams.delete('spotify_connected')
      window.history.replaceState({}, '', url.toString())
    }
    if (url.searchParams.has('spotify_error')) {
      url.searchParams.delete('spotify_error')
      window.history.replaceState({}, '', url.toString())
    }
  }, [])

  // URL do jogador
  useEffect(() => {
    async function buildUrl() {
      const { hostname, port, protocol } = window.location
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        try {
          const { primary } = await fetch('/api/local-ip').then(r => r.json())
          if (primary) { setPlayerUrl(`${protocol}//${primary}${port ? ':'+port : ''}/karaoke/play/${sessionId}`); return }
        } catch {}
      }
      setPlayerUrl(`${window.location.origin}/karaoke/play/${sessionId}`)
    }
    buildUrl()
  }, [sessionId])

  // Busca inicial
  useEffect(() => {
    async function load() {
      const [{ data: s, error }, { data: p }, { data: so }, { data: r }] = await Promise.all([
        supabase.from('game_sessions').select('*').eq('id', sessionId).single(),
        supabase.from('players').select('*').eq('session_id', sessionId).order('created_at'),
        supabase.from('karaoke_songs').select('*').eq('session_id', sessionId).order('order_index'),
        supabase.from('karaoke_ratings').select('*').eq('session_id', sessionId),
      ])
      if (error || !s) { setLoadError(true); return }
      setSession(s as GameSession)
      setPlayers((p ?? []) as Player[])
      setSongs((so ?? []) as KaraokeSong[])
      setRatings((r ?? []) as KaraokeRating[])
    }
    load()
  }, [sessionId])

  // Realtime
  useEffect(() => {
    const ch = supabase.channel(`karaoke-host-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
        p => setSession(p.new as GameSession))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
        p => setPlayers(prev => [...prev, p.new as Player]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
        p => setPlayers(prev => prev.map(x => x.id === (p.new as Player).id ? p.new as Player : x)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'karaoke_songs', filter: `session_id=eq.${sessionId}` },
        p => {
          if (p.eventType === 'INSERT') setSongs(prev => [...prev, p.new as KaraokeSong].sort((a,b) => a.order_index - b.order_index))
          if (p.eventType === 'UPDATE') setSongs(prev => prev.map(x => x.id === (p.new as KaraokeSong).id ? p.new as KaraokeSong : x))
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'karaoke_ratings', filter: `session_id=eq.${sessionId}` },
        p => setRatings(prev => [...prev, p.new as KaraokeRating]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'karaoke_ratings', filter: `session_id=eq.${sessionId}` },
        p => setRatings(prev => prev.map(x => x.id === (p.new as KaraokeRating).id ? p.new as KaraokeRating : x)))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [sessionId])

  // Emojis broadcast — config explícita para garantir recebimento
  useEffect(() => {
    const ch = supabase
      .channel(`karaoke-emoji-${sessionId}`, {
        config: { broadcast: { self: false, ack: false } },
      })
      .on('broadcast', { event: 'emoji' }, ({ payload }: { payload: { emoji: string; playerName: string } }) => {
        const id = `${Date.now()}-${Math.random()}`
        const x  = 5 + Math.random() * 88
        setFloatingEmojis(prev => [...prev, { id, emoji: payload.emoji, x, playerName: payload.playerName }])
        setTimeout(() => setFloatingEmojis(prev => prev.filter(e => e.id !== id)), 4500)
      })
      .subscribe()
    emojiChannelRef.current = ch
    return () => { supabase.removeChannel(ch) }
  }, [sessionId])

  // Ações
  const allReady         = players.length > 0 && players.every(p => p.is_ready)
  const allSongsSelected = players.length > 0 && players.every(p => songs.some(s => s.player_id === p.id))
  const currentSong      = songs.find(s => s.status === 'singing') ?? null
  const queuedSongs      = songs.filter(s => s.status === 'queued').sort((a,b) => a.order_index - b.order_index)
  const doneSongs        = songs.filter(s => s.status === 'done')
  const currentAvg       = currentSong ? avgRating(ratings, currentSong.id) : 0

  // Busca letras em tempo real se a música atual não tiver letra salva
  useEffect(() => {
    if (!currentSong) return
    if (currentSong.lyrics) return
    if (liveLyrics[currentSong.id]) return
    if (!currentSong.song_title) return

    async function fetchNow() {
      const save = async (lyrics: string) => {
        setLiveLyrics(prev => ({ ...prev, [currentSong!.id]: lyrics }))
        await supabase.from('karaoke_songs').update({ lyrics }).eq('id', currentSong!.id)
      }

      // ── Prioridade 1: Spotify OAuth (letras sincronizadas perfeitas) ──
      if (spotifyConnected && currentSong!.spotify_track_id) {
        try {
          const r = await fetch(`/api/spotify/lyrics?trackId=${currentSong!.spotify_track_id}`)
          const d = await r.json()
          if (d.lyrics) { await save(d.lyrics); return }
          if (d.connected === false) setSpotifyConnected(false) // token expirou
        } catch {}
      }

      // ── Prioridade 2: lrclib (fallback gratuito) ──────────────────────
      try {
        const params = new URLSearchParams({ artist: currentSong!.artist ?? '', title: currentSong!.song_title })
        const r = await fetch(`/api/lyrics?${params}`)
        const d = await r.json()
        if (d.lyrics) await save(d.lyrics)
      } catch {}
    }
    fetchNow()
  }, [currentSong?.id, currentSong?.lyrics, spotifyConnected])

  async function startGame()    { await supabase.from('game_sessions').update({ status: 'playing' }).eq('id', sessionId) }
  async function startSinging() {
    const shuffled = [...songs].sort(() => Math.random() - 0.5)
    await Promise.all(shuffled.map((s, i) => supabase.from('karaoke_songs').update({ order_index: i }).eq('id', s.id)))
    await supabase.from('karaoke_songs').update({ status: 'singing' }).eq('id', shuffled[0].id)
  }
  async function nextSong() {
    if (!currentSong) return
    await supabase.from('karaoke_songs').update({ status: 'done' }).eq('id', currentSong.id)
    const next = queuedSongs[0]
    if (next) await supabase.from('karaoke_songs').update({ status: 'singing' }).eq('id', next.id)
    else       await supabase.from('game_sessions').update({ status: 'finished' }).eq('id', sessionId)
  }

  // Guards
  if (loadError) return (
    <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center">
      <div className="text-center">
        <p className="text-4xl mb-4">😕</p>
        <p className="text-white mb-4">Sala não encontrada.</p>
        <button className="btn-primary" onClick={() => router.push('/')}>Início</button>
      </div>
    </div>
  )
  if (!session) return <Loading />
  if (session.status === 'finished') return <FinishedScreen songs={doneSongs} ratings={ratings} onNewGame={() => router.push('/')} />
  if (session.status === 'lobby')    return <LobbyScreen players={players} playerUrl={playerUrl} allReady={allReady} sessionId={sessionId} onStart={startGame} onBack={() => router.push('/')} spotifyConnected={spotifyConnected} onSpotifyConnect={() => { window.location.href = `/api/spotify/auth?return=${encodeURIComponent(window.location.href)}` }} />
  if (!currentSong)                  return <SongSelectionScreen players={players} songs={songs} allSongsSelected={allSongsSelected} onStart={startSinging} onBack={() => router.push('/')} />

  return (
    <SingingScreen
      currentSong={currentSong}
      floatingEmojis={floatingEmojis}
      avgRatingValue={currentAvg}
      ratingCount={ratings.filter(r => r.song_id === currentSong.id).length}
      onNext={nextSong}
      onBack={() => { if (confirm('Encerrar o jogo?')) router.push('/') }}
    />
  )
}

// ══════════════════════════════════════════════════════════
// Loading
// ══════════════════════════════════════════════════════════
function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center flex-col gap-4">
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className="w-12 h-12 rounded-full border-4 border-pink-500 border-t-transparent" />
      <p className="text-white/50">Carregando sala...</p>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// Lobby
// ══════════════════════════════════════════════════════════
function LobbyScreen({ players, playerUrl, allReady, sessionId, onStart, onBack, spotifyConnected, onSpotifyConnect }: {
  players: Player[]; playerUrl: string; allReady: boolean; sessionId: string
  onStart: () => void; onBack: () => void
  spotifyConnected: boolean; onSpotifyConnect: () => void
}) {
  const readyCount = players.filter(p => p.is_ready).length
  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-950 via-[#0a0a1a] to-[#0a0a1a] p-6 md:p-10">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10 relative">
        <button onClick={onBack} className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-sm flex items-center gap-1 group transition-colors">
          <span className="group-hover:-translate-x-1 transition-transform">←</span> Voltar
        </button>
        <div className="text-5xl mb-2">🎤</div>
        <h1 className="text-6xl md:text-7xl font-black tracking-widest bg-gradient-to-r from-pink-400 to-purple-500 bg-clip-text text-transparent">KARAOKÊ</h1>
        <p className="text-purple-300 text-sm mt-1 tracking-widest uppercase">Sala do host</p>
      </motion.div>
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10">
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}>
          <div className="bg-white/5 rounded-2xl p-6 mb-5 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-lg">Jogadores</h2>
              <span className="bg-purple-600/40 text-purple-300 text-xs font-bold px-3 py-1 rounded-full border border-purple-500/30">{players.length}/8</span>
            </div>
            {players.length === 0 ? (
              <div className="text-center py-8">
                <motion.div animate={{ opacity: [0.4,1,0.4] }} transition={{ duration: 2, repeat: Infinity }} className="text-4xl mb-3">📱</motion.div>
                <p className="text-gray-500 text-sm">Aguardando jogadores escanearem o QR Code...</p>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {players.map((p, i) => {
                    const c = PLAYER_COLORS[i % PLAYER_COLORS.length]
                    return (
                      <motion.div key={p.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                        className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/5">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full ${c.bg} flex items-center justify-center font-black text-white text-sm`}>{p.name[0].toUpperCase()}</div>
                          <span className="text-white font-semibold">{p.name}</span>
                        </div>
                        <span className={`text-sm font-medium flex items-center gap-1 ${p.is_ready ? 'text-emerald-400' : 'text-gray-500'}`}>
                          {p.is_ready ? (<><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"/>Pronto!</>) : (<><span className="w-2 h-2 rounded-full bg-gray-600"/>Aguardando...</>)}
                        </span>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
          {players.length > 0 && <p className="text-center text-gray-500 text-sm mb-3">{readyCount}/{players.length} prontos</p>}
          <motion.button onClick={onStart} disabled={!allReady} whileHover={allReady ? { scale: 1.03 } : {}} whileTap={allReady ? { scale: 0.97 } : {}}
            className={`w-full py-4 rounded-2xl font-black text-xl tracking-wider transition-all duration-300 ${allReady ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white shadow-lg shadow-pink-500/30' : 'bg-white/5 text-gray-600 cursor-not-allowed border border-white/10'}`}>
            {allReady ? '🎤 INICIAR KARAOKÊ!' : 'Aguardando todos ficarem prontos...'}
          </motion.button>

          {/* Conectar Spotify para letras sincronizadas */}
          <div className="mt-3">
            {spotifyConnected ? (
              <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600/10 border border-emerald-600/25">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400 text-sm font-semibold">Spotify conectado — letras sincronizadas ativas! 🎵</span>
              </div>
            ) : (
              <button onClick={onSpotifyConnect}
                className="w-full py-2.5 rounded-xl flex items-center justify-center gap-2 bg-[#1DB954]/10 hover:bg-[#1DB954]/20 border border-[#1DB954]/30 text-[#1DB954] text-sm font-semibold transition-colors">
                <span>🎵</span>
                Conectar Spotify para letras sincronizadas
                <span className="text-xs opacity-60">(recomendado)</span>
              </button>
            )}
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="flex flex-col items-center">
          <div className="bg-white/5 rounded-3xl p-8 border border-white/10 text-center w-full max-w-sm mx-auto">
            <p className="text-gray-400 text-sm uppercase tracking-widest mb-6 font-semibold">📱 Escaneie para entrar</p>
            <div className="bg-white p-4 rounded-2xl inline-block mb-6 shadow-2xl">
              {playerUrl ? <QRCodeSVG value={playerUrl} size={200} bgColor="#ffffff" fgColor="#0a0a1a" level="M" />
                : <div className="w-[200px] h-[200px] bg-gray-100 animate-pulse rounded-lg flex items-center justify-center"><span className="text-gray-400 text-xs">Gerando...</span></div>}
            </div>
            {playerUrl?.includes('localhost') && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2 mb-4 text-xs text-yellow-300">⚠️ Use o IP da máquina para o QR funcionar no celular.</div>
            )}
            <div className="bg-black/40 rounded-xl px-3 py-2 border border-white/10">
              <p className="text-pink-400 text-xs font-mono break-all">{playerUrl}</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// Seleção de músicas
// ══════════════════════════════════════════════════════════
function SongSelectionScreen({ players, songs, allSongsSelected, onStart, onBack }: {
  players: Player[]; songs: KaraokeSong[]; allSongsSelected: boolean; onStart: () => void; onBack: () => void
}) {
  const selectedCount = players.filter(p => songs.some(s => s.player_id === p.id)).length
  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-950 via-[#0a0a1a] to-[#0a0a1a] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm flex items-center gap-1 group transition-colors">
          <span className="group-hover:-translate-x-1 transition-transform">←</span> Voltar
        </button>
        <h1 className="text-3xl font-black bg-gradient-to-r from-pink-400 to-purple-500 bg-clip-text text-transparent tracking-widest">KARAOKÊ</h1>
        <div />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 max-w-2xl mx-auto w-full gap-6">
        <motion.div animate={{ rotate: [0,-8,8,0] }} transition={{ duration: 2, repeat: Infinity, repeatDelay: 2 }} className="text-7xl">🎵</motion.div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-1">Jogadores escolhendo músicas...</h2>
          <p className="text-gray-400">{selectedCount}/{players.length} já escolheram</p>
        </div>
        <div className="w-full space-y-3">
          {players.map((p, i) => {
            const song = songs.find(s => s.player_id === p.id)
            const c    = PLAYER_COLORS[i % PLAYER_COLORS.length]
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="flex items-center gap-4 bg-white/5 rounded-xl px-4 py-3 border border-white/8">
                <div className={`w-10 h-10 rounded-full ${c.bg} flex items-center justify-center font-black text-white text-sm flex-shrink-0`}>{p.name[0].toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{p.name}</p>
                  {song ? <p className="text-emerald-400 text-sm truncate">✓ {song.song_title}{song.artist ? ` — ${song.artist}` : ''}</p>
                        : <p className="text-gray-500 text-sm animate-pulse">🔍 Buscando música...</p>}
                </div>
              </motion.div>
            )
          })}
        </div>
        <motion.button onClick={onStart} disabled={!allSongsSelected} whileHover={allSongsSelected ? { scale: 1.03 } : {}} whileTap={allSongsSelected ? { scale: 0.97 } : {}}
          className={`w-full max-w-sm py-4 rounded-2xl font-black text-xl tracking-wider transition-all duration-300 ${allSongsSelected ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white shadow-lg shadow-pink-500/30' : 'bg-white/5 text-gray-600 cursor-not-allowed border border-white/10'}`}>
          {allSongsSelected ? '🎤 COMEÇAR A CANTAR!' : 'Aguardando todos escolherem...'}
        </motion.button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// Canto — YouTube karaokê em tela cheia (abordagem KaraoQ)
// O vídeo karaokê já tem: música instrumental + letra sincronizada no vídeo
// ══════════════════════════════════════════════════════════
function SingingScreen({ currentSong, floatingEmojis, avgRatingValue, ratingCount, onNext, onBack }: {
  currentSong: KaraokeSong
  floatingEmojis: FloatingEmoji[]; avgRatingValue: number; ratingCount: number
  onNext: () => void; onBack: () => void
}) {
  const [countdown, setCountdown] = useState<number | null>(3)

  // Countdown + limpeza ao trocar música
  useEffect(() => {
    setCountdown(3)
    const t = [
      setTimeout(() => setCountdown(2), 1000),
      setTimeout(() => setCountdown(1), 2000),
      setTimeout(() => setCountdown(null), 3000),
    ]
    return () => t.forEach(clearTimeout)
  }, [currentSong.id])

  return (
    <div className="h-screen bg-black flex flex-col overflow-hidden select-none">

      {/* Top bar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-black/90 border-b border-white/8 z-20">
        <button onClick={onBack}
          className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 group transition-colors flex-shrink-0">
          <span className="group-hover:-translate-x-1 transition-transform">←</span>
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-lg">🎤</span>
          <div className="min-w-0">
            <p className="text-white font-black text-sm leading-tight truncate">{currentSong.player_name}</p>
            <p className="text-gray-500 text-xs truncate">
              {currentSong.song_title}{currentSong.artist ? ` — ${currentSong.artist}` : ''}
            </p>
          </div>
        </div>
        <StarBadge value={avgRatingValue} count={ratingCount} />
        <motion.button onClick={onNext} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          className="flex-shrink-0 bg-gradient-to-r from-pink-500 to-purple-600 text-white font-bold px-4 py-1.5 rounded-xl text-sm shadow-lg flex items-center gap-1">
          Próxima →
        </motion.button>
      </div>

      {/* Área principal */}
      <div className="flex-1 relative overflow-hidden bg-black">

        {/* Countdown — cobre tudo */}
        {countdown !== null && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center"
            style={{ background: 'radial-gradient(ellipse at center, #0d0020 0%, #000 70%)' }}>
            {currentSong.thumbnail && (
              <img src={currentSong.thumbnail} alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-10 blur-3xl scale-110" />
            )}
            <div className="relative z-10 text-center px-8">
              <p className="text-gray-400 text-sm uppercase tracking-widest mb-3">Preparando...</p>
              <p className="text-white font-black text-2xl mb-1 truncate max-w-lg">{currentSong.song_title}</p>
              {currentSong.artist && <p className="text-gray-400 text-base mb-8">{currentSong.artist}</p>}
              <AnimatePresence mode="wait">
                <motion.div key={countdown}
                  initial={{ scale: 3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.3, opacity: 0 }} transition={{ duration: 0.25 }}
                  className="text-[11rem] font-black leading-none"
                  style={{ background: 'linear-gradient(135deg,#ec4899,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'drop-shadow(0 0 60px rgba(236,72,153,1))' }}>
                  {countdown}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* YouTube karaokê — tela cheia */}
        {countdown === null && (
          <iframe
            key={currentSong.id}
            src={`https://www.youtube-nocookie.com/embed/${currentSong.youtube_id}?autoplay=1&controls=1&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1`}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ border: 'none' }}
          />
        )}

        {/* Emojis flutuando sobre o vídeo — z-50 */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-50">
          <AnimatePresence>
            {floatingEmojis.map(e => <EmojiBubble key={e.id} emoji={e.emoji} x={e.x} />)}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ── Bolha de emoji ────────────────────────────────────────
function EmojiBubble({ emoji, x }: { emoji: string; x: number }) {
  // Cor aleatória para cada bolha (baseada no x para ser determinístico)
  const hue = Math.round(x * 3.6)   // 0-360 range

  return (
    <motion.div
      className="absolute"
      style={{ left: `${Math.min(Math.max(x, 6), 86)}%`, bottom: '6%' }}
      initial={{ y: 0, scale: 0, opacity: 1 }}
      animate={{
        y: [0, '-85vh'],
        x: [0, -14, 20, -10, 6, 0],
        scale: [0, 1.4, 1.05, 1.0, 1.0, 3.8],
        opacity: [1, 1, 1, 1, 0.85, 0],
      }}
      transition={{
        duration: 4.0,
        ease: 'easeOut',
        scale:   { times: [0, 0.07, 0.18, 0.5, 0.83, 1] },
        opacity: { times: [0, 0.08, 0.3, 0.7, 0.87, 1] },
        x:       { times: [0, 0.2, 0.4, 0.6, 0.8, 1] },
      }}
    >
      {/* Bolha com vidro fosco e brilho colorido */}
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center text-3xl relative"
        style={{
          background: `radial-gradient(circle at 35% 30%, hsla(${hue},100%,80%,0.35), hsla(${hue},80%,50%,0.1) 70%, transparent)`,
          backdropFilter: 'blur(6px)',
          border: `1.5px solid hsla(${hue},100%,75%,0.5)`,
          boxShadow: `0 6px 24px rgba(0,0,0,0.4), 0 0 16px hsla(${hue},100%,60%,0.3), inset 0 1px 0 rgba(255,255,255,0.3)`,
        }}
      >
        {/* Brilho interior */}
        <div className="absolute top-2 left-3 w-6 h-3 rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.9), transparent)' }} />
        <span className="relative z-10 drop-shadow-lg">{emoji}</span>
      </div>
    </motion.div>
  )
}

// ══════════════════════════════════════════════════════════
// Fim de jogo
// ══════════════════════════════════════════════════════════
function FinishedScreen({ songs, ratings, onNewGame }: { songs: KaraokeSong[]; ratings: KaraokeRating[]; onNewGame: () => void }) {
  const sorted = [...songs].sort((a, b) => avgRating(ratings, b.id) - avgRating(ratings, a.id))
  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-950 via-[#0a0a1a] to-[#0a0a1a] flex flex-col items-center justify-center px-6 py-12">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 12 }} className="text-8xl mb-6">🎤</motion.div>
      <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="text-5xl md:text-6xl font-black text-transparent bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text mb-2 tracking-widest">
        SHOW ENCERRADO!
      </motion.h1>
      <p className="text-gray-400 mb-10">Confira o placar de estrelas</p>
      <div className="w-full max-w-lg space-y-3 mb-10">
        {sorted.map((song, i) => {
          const avg = avgRating(ratings, song.id)
          const cnt = ratings.filter(r => r.song_id === song.id).length
          return (
            <motion.div key={song.id} initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.08 }}
              className={`flex items-center gap-4 rounded-2xl px-5 py-4 border ${i === 0 ? 'bg-yellow-400/10 border-yellow-400/30' : 'bg-white/5 border-white/8'}`}>
              <span className="text-2xl font-black w-8 text-center">{i === 0 ? '🏆' : `#${i+1}`}</span>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold truncate">{song.player_name}</p>
                <p className="text-gray-500 text-sm truncate">{song.song_title}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="flex gap-0.5">{[1,2,3,4,5].map(s => <span key={s} className={`text-lg ${s<=Math.round(avg)?'text-yellow-400':'text-gray-700'}`}>★</span>)}</div>
                <p className="text-white font-bold">{cnt > 0 ? avg.toFixed(1) : '—'}</p>
              </div>
            </motion.div>
          )
        })}
      </div>
      <button onClick={onNewGame} className="btn-primary text-lg px-10 py-4 rounded-2xl">🎮 Novo Jogo</button>
    </div>
  )
}

// ── Helper ────────────────────────────────────────────────
function StarBadge({ value, count }: { value: number; count: number }) {
  return (
    <div className="flex items-center gap-1.5 bg-yellow-400/10 border border-yellow-400/20 rounded-full px-3 py-1 flex-shrink-0">
      <span className="text-yellow-400 text-sm">★</span>
      <span className="text-yellow-300 font-bold text-sm">{count > 0 ? value.toFixed(1) : '—'}</span>
    </div>
  )
}

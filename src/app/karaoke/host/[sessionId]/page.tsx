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
  }
}
interface YTPlayer { playVideo(): void; getCurrentTime(): number; destroy(): void }

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
      queuedSongs={queuedSongs}
      doneSongs={doneSongs}
      floatingEmojis={floatingEmojis}
      avgRatingValue={currentAvg}
      ratingCount={ratings.filter(r => r.song_id === currentSong.id).length}
      liveLyrics={liveLyrics[currentSong.id] ?? null}
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
// Canto — tela cheia + letras sincronizadas + bolhas
// ══════════════════════════════════════════════════════════
function SingingScreen({ currentSong, queuedSongs, doneSongs, floatingEmojis, avgRatingValue, ratingCount, liveLyrics, onNext, onBack }: {
  currentSong: KaraokeSong; queuedSongs: KaraokeSong[]; doneSongs: KaraokeSong[]
  floatingEmojis: FloatingEmoji[]; avgRatingValue: number; ratingCount: number
  liveLyrics: string | null
  onNext: () => void; onBack: () => void
}) {
  const [countdown,    setCountdown]    = useState<number | null>(3)
  const [playbackTime, setPlaybackTime] = useState(0)
  const [syncOffset,   setSyncOffset]   = useState(0)
  const [musicStarted, setMusicStarted] = useState(false)
  const ytContainerRef = useRef<HTMLDivElement>(null)
  const tickRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const ytPlayerRef    = useRef<YTPlayer | null>(null)
  const startTimeRef   = useRef<number>(0)

  // Reinicia ao trocar música
  useEffect(() => {
    setCountdown(3)
    setPlaybackTime(0)
    setSyncOffset(0)
    setMusicStarted(false)
    if (tickRef.current) clearInterval(tickRef.current)
    ytPlayerRef.current?.destroy?.()
    ytPlayerRef.current = null
    const t = [
      setTimeout(() => setCountdown(2), 1000),
      setTimeout(() => setCountdown(1), 2000),
      setTimeout(() => setCountdown(null), 3000),
    ]
    return () => { t.forEach(clearTimeout); if (tickRef.current) clearInterval(tickRef.current) }
  }, [currentSong.id])

  // YouTube IFrame API após countdown (com fallback para timer)
  useEffect(() => {
    if (countdown !== null) return

    const videoId = currentSong.youtube_id

    function startTimerFallback() {
      // Timer fallback: assume música inicia ~2s após montar iframe
      const t0 = Date.now()
      tickRef.current = setInterval(() => {
        const elapsed = (Date.now() - t0) / 1000 - 2 + syncOffset
        setPlaybackTime(Math.max(0, elapsed))
      }, 100)
    }

    function createYTPlayer() {
      if (!ytContainerRef.current) { startTimerFallback(); return }
      ytContainerRef.current.innerHTML = ''
      const el = document.createElement('div')
      ytContainerRef.current.appendChild(el)

      try {
        ytPlayerRef.current = new window.YT.Player(el, {
          height: '180', width: '320', videoId,
          playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady(ev: { target: YTPlayer }) {
              ev.target.playVideo()
              setMusicStarted(true)
              if (tickRef.current) clearInterval(tickRef.current)
              tickRef.current = setInterval(() => {
                try {
                  const t = ev.target.getCurrentTime()
                  if (typeof t === 'number') setPlaybackTime(Math.max(0, t + syncOffset))
                } catch {}
              }, 150)
            },
            onError() { startTimerFallback() },
          },
        })
      } catch { startTimerFallback() }
    }

    // Poll até a API do YouTube estar disponível (máx 8s)
    let attempts = 0
    const pollId = setInterval(() => {
      attempts++
      if (window.YT?.Player) { clearInterval(pollId); createYTPlayer() }
      if (attempts > 80) { clearInterval(pollId); startTimerFallback() }
    }, 100)

    if (!document.getElementById('yt-api-script')) {
      const s = document.createElement('script')
      s.id = 'yt-api-script'
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }

    const prevCb = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prevCb?.(); clearInterval(pollId); createYTPlayer() }

    return () => {
      clearInterval(pollId)
      if (tickRef.current) clearInterval(tickRef.current)
      ytPlayerRef.current?.destroy?.()
    }
  }, [countdown, currentSong.youtube_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync offset: re-aplica ao tempo atual
  useEffect(() => {
    if (ytPlayerRef.current?.getCurrentTime) {
      setPlaybackTime(Math.max(0, ytPlayerRef.current.getCurrentTime() + syncOffset))
    }
  }, [syncOffset])

  // Letras: prioridade: DB → live fetch
  const rawLyrics = currentSong.lyrics || liveLyrics
  const lrcLines  = useMemo(() => {
    if (!rawLyrics) return null
    if (!isLrc(rawLyrics)) return null
    const p = parseLrc(rawLyrics)
    return p.length > 1 ? p : null
  }, [rawLyrics])

  return (
    <div className="h-screen bg-[#06040f] flex flex-col overflow-hidden select-none">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-black/80 border-b border-white/5 z-20">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 group transition-colors flex-shrink-0">
          <span className="group-hover:-translate-x-1 transition-transform">←</span>
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-lg">🎤</span>
          <div className="min-w-0">
            <p className="text-white font-black text-sm leading-tight truncate">{currentSong.player_name}</p>
            <p className="text-gray-500 text-xs truncate">{currentSong.song_title}{currentSong.artist ? ` — ${currentSong.artist}` : ''}</p>
          </div>
        </div>
        <StarBadge value={avgRatingValue} count={ratingCount} />
        {/* Ajuste de sincronismo ±1s */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-gray-600 text-xs hidden sm:inline">Sync:</span>
          <button onClick={() => setSyncOffset(o => o - 1)} className="text-gray-500 hover:text-yellow-400 text-xs px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10">-1s</button>
          <button onClick={() => setSyncOffset(o => o + 1)} className="text-gray-500 hover:text-yellow-400 text-xs px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10">+1s</button>
        </div>
        {queuedSongs.length > 0 && <span className="text-gray-600 text-xs hidden md:block flex-shrink-0">{queuedSongs.length} na fila</span>}
        <motion.button onClick={onNext} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          className="flex-shrink-0 bg-gradient-to-r from-pink-500 to-purple-600 text-white font-bold px-4 py-1.5 rounded-xl text-sm shadow-lg flex items-center gap-1">
          Próxima →
        </motion.button>
      </div>

      {/* ── Área principal ── */}
      <div className="flex-1 relative overflow-hidden">

        {/* Countdown FULL SCREEN */}
        {countdown !== null && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#06040f]">
            {currentSong.thumbnail && (
              <img src={currentSong.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10" />
            )}
            <div className="relative z-10 text-center px-8">
              <p className="text-gray-300 text-sm uppercase tracking-widest mb-3">Preparando...</p>
              <p className="text-white font-black text-3xl mb-1 truncate max-w-lg">{currentSong.song_title}</p>
              {currentSong.artist && <p className="text-gray-400 text-lg mb-8">{currentSong.artist}</p>}
              <AnimatePresence mode="wait">
                <motion.div key={countdown}
                  initial={{ scale: 3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.3, opacity: 0 }} transition={{ duration: 0.25 }}
                  className="text-[11rem] font-black leading-none"
                  style={{ background: 'linear-gradient(135deg,#ec4899,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'drop-shadow(0 0 50px rgba(236,72,153,0.9))' }}>
                  {countdown}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Bolhas de emoji — sempre visíveis */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-40">
          <AnimatePresence>
            {floatingEmojis.map(e => <EmojiBubble key={e.id} emoji={e.emoji} x={e.x} />)}
          </AnimatePresence>
        </div>

        {/* Letras — só quando countdown terminou */}
        {countdown === null && (
          lrcLines
            ? <KaraokeDisplay lines={lrcLines} currentTime={playbackTime} thumbnail={currentSong.thumbnail} />
            : rawLyrics
              ? <PlainLyricsDisplay lyrics={rawLyrics} />
              : <div className="h-full flex flex-col items-center justify-end pb-20 text-center">
                  <span className="text-5xl opacity-20 mb-4 block">🎵</span>
                  <p className="text-gray-400 text-xl font-semibold">Buscando letra...</p>
                  <p className="text-gray-600 text-sm mt-1">Se não encontrar, cante de cor!</p>
                </div>
        )}
      </div>

      {/* YouTube player — pequeno, visível no canto (necessário para IFrame API funcionar corretamente) */}
      {countdown === null && (
        <div
          className="fixed bottom-4 left-4 z-50 rounded-xl overflow-hidden shadow-2xl border border-white/20 bg-black"
          style={{ width: '176px', height: '99px' }}
          title="Reprodutor de áudio"
        >
          <div ref={ytContainerRef} style={{ width: '176px', height: '99px' }} />
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// Display de karaokê — wipe colorido (clip-path) + fundo thumbnail
// ══════════════════════════════════════════════════════════
function KaraokeDisplay({ lines, currentTime, thumbnail }: { lines: LrcLine[]; currentTime: number; thumbnail?: string }) {
  let currentIdx = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) currentIdx = i
    else break
  }

  const currentLine = lines[currentIdx]
  const nextLine    = lines[currentIdx + 1] ?? null
  const prevLine    = lines[currentIdx - 1] ?? null

  // Progresso 0→1 dentro da linha atual
  const nextTime = nextLine?.time ?? currentLine.time + 5
  const lineDur  = Math.max(0.5, nextTime - currentLine.time)
  const elapsed  = currentTime - currentLine.time
  const progress = Math.min(1, Math.max(0, elapsed / lineDur))

  return (
    <div className="h-full flex flex-col items-center justify-end pb-14 px-6 md:px-20 relative overflow-hidden">
      {/* Thumbnail desfocada como fundo */}
      {thumbnail && (
        <img src={thumbnail} alt="" aria-hidden
          className="absolute inset-0 w-full h-full object-cover opacity-25 blur-3xl scale-110 pointer-events-none select-none"
        />
      )}
      {/* Escurece por cima */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#06040f] via-[#06040f]/80 to-[#06040f]/40 pointer-events-none" />

      <div className="relative z-10 w-full max-w-5xl mx-auto flex flex-col items-center">
        {/* Linha anterior */}
        <AnimatePresence>
          {prevLine && (
            <motion.p key={`prev-${currentIdx}`}
              initial={{ opacity: 0.3 }} animate={{ opacity: 0.22 }} exit={{ opacity: 0, y: -10 }}
              className="text-white text-xl md:text-2xl text-center font-semibold mb-5 leading-snug">
              {prevLine.text}
            </motion.p>
          )}
        </AnimatePresence>

        {/* ── Linha atual: wipe colorido esquerda→direita ── */}
        <AnimatePresence mode="wait">
          <motion.div key={`cur-${currentIdx}`}
            initial={{ opacity: 0, scale: 0.93 }} animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.93 }} transition={{ duration: 0.22 }}
            className="relative text-center mb-4 w-full">

            {/* Base (não cantado — escuro) */}
            <p className="font-black leading-tight select-none"
              style={{ fontSize: 'clamp(2.2rem,5.5vw,4rem)', color: 'rgba(255,255,255,0.18)' }}>
              {currentLine.text}
            </p>

            {/* Colorido — sweep via clip-path */}
            <p className="absolute inset-0 font-black leading-tight select-none"
              style={{
                fontSize: 'clamp(2.2rem,5.5vw,4rem)',
                color: '#fde68a',
                textShadow: '0 0 25px rgba(253,230,138,0.7), 0 0 50px rgba(253,230,138,0.3)',
                clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
              }}>
              {currentLine.text}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Barra de progresso */}
        <div className="w-48 h-1.5 rounded-full bg-white/10 mb-5 overflow-hidden">
          <div className="h-full rounded-full"
            style={{ width: `${progress * 100}%`, background: 'linear-gradient(90deg,#ec4899,#fde68a)' }} />
        </div>

        {/* Próxima linha */}
        <AnimatePresence>
          {nextLine && (
            <motion.p key={`next-${currentIdx}`}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 0.55 }} exit={{ opacity: 0 }}
              className="text-white text-2xl md:text-3xl text-center font-bold leading-snug">
              {nextLine.text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Fallback: letra simples (sem LRC) ──────────────────────
function PlainLyricsDisplay({ lyrics }: { lyrics: string | null }) {
  return (
    <div className="h-full flex flex-col items-center justify-end pb-12 px-6 md:px-16">
      <div className="flex-1" />
      {lyrics ? (
        <div className="text-center max-w-3xl">
          <p className="text-gray-400 text-xs uppercase tracking-widest mb-4">Letra completa (sem sincronismo)</p>
          <p className="text-white text-xl leading-loose whitespace-pre-line">{lyrics}</p>
        </div>
      ) : (
        <div className="text-center">
          <span className="text-6xl opacity-20 block mb-4">🎵</span>
          <p className="text-gray-400 text-xl font-semibold">Letra não encontrada</p>
          <p className="text-gray-600 text-sm mt-2">Cante de cor — você consegue!</p>
        </div>
      )}
    </div>
  )
}

// ── Bolha de emoji ────────────────────────────────────────
function EmojiBubble({ emoji, x }: { emoji: string; x: number }) {
  return (
    <motion.div className="absolute" style={{ left: `${Math.min(Math.max(x,4),88)}%`, bottom:'6%' }}
      initial={{ y:0, scale:0, opacity:1 }}
      animate={{ y:[0,-80,-200,-360,-520,'-88vh'], x:[0,-12,16,-8,14,0], scale:[0,1.2,1.05,1,1,1.9], opacity:[1,1,1,1,0.7,0] }}
      transition={{ duration:4, ease:'easeOut', scale:{ times:[0,0.08,0.2,0.5,0.85,1] }, opacity:{ times:[0,0.1,0.4,0.75,0.9,1] }, x:{ times:[0,0.2,0.4,0.6,0.8,1] } }}>
      <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center text-2xl shadow-xl shadow-black/30">{emoji}</div>
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

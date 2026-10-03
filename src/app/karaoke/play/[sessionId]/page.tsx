'use client'

import { useState, useEffect, useRef, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import type { GameSession, Player, KaraokeSong, KaraokeRating, YouTubeResult, SpotifyTrack } from '@/lib/types'
import { KARAOKE_EMOJIS, extractYouTubeId, formatDuration } from '@/lib/types'

type Phase =
  | 'loading'
  | 'session_error'
  | 'enter_name'
  | 'lobby'
  | 'search_song'
  | 'song_ready'
  | 'singing_me'
  | 'watching'
  | 'finished'

// ═══════════════════════════════════════════════════════════════
// Página principal
// ═══════════════════════════════════════════════════════════════
export default function KaraokePlayerPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router        = useRouter()

  const [phase,            setPhase]            = useState<Phase>('loading')
  const [session,          setSession]          = useState<GameSession | null>(null)
  const [player,           setPlayer]           = useState<Player | null>(null)
  const [songs,            setSongs]            = useState<KaraokeSong[]>([])
  const [ratings,          setRatings]          = useState<KaraokeRating[]>([])
  const [myRating,         setMyRating]         = useState<number>(0)
  const [submittingRating, setSubmittingRating] = useState(false)
  const [emojiReady,       setEmojiReady]       = useState(false)

  const emojiChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const playerRef       = useRef<Player | null>(null)
  const STORAGE_KEY     = `karaoke_player_${sessionId}`

  useEffect(() => { playerRef.current = player }, [player])

  // Estado derivado
  const currentSong = songs.find(s => s.status === 'singing') ?? null
  const mySong      = player ? (songs.find(s => s.player_id === player.id) ?? null) : null

  // Fase calculada automaticamente
  useEffect(() => {
    if (!session) return
    if (session.status === 'finished') { setPhase('finished'); return }
    if (!player) return

    if (session.status === 'lobby') { setPhase('lobby'); return }

    if (!mySong)      { setPhase('search_song'); return }
    if (!currentSong) { setPhase('song_ready');  return }
    setPhase(currentSong.player_id === player.id ? 'singing_me' : 'watching')
  }, [session?.status, player?.id, mySong?.id, currentSong?.id]) // eslint-disable-line

  useEffect(() => { setMyRating(0); setSubmittingRating(false) }, [currentSong?.id])

  // Montagem / reconexão via localStorage
  useEffect(() => {
    async function init() {
      const { data: s, error } = await supabase
        .from('game_sessions').select('*').eq('id', sessionId).single()

      if (error || !s || s.game_type !== 'karaoke') { setPhase('session_error'); return }
      setSession(s as GameSession)

      const storedId = localStorage.getItem(STORAGE_KEY)
      if (storedId) {
        const [{ data: p }, { data: so }, { data: r }] = await Promise.all([
          supabase.from('players').select('*').eq('id', storedId).eq('session_id', sessionId).single(),
          supabase.from('karaoke_songs').select('*').eq('session_id', sessionId).order('order_index'),
          supabase.from('karaoke_ratings').select('*').eq('session_id', sessionId),
        ])
        if (p) {
          setPlayer(p as Player)
          setSongs((so ?? []) as KaraokeSong[])
          setRatings((r ?? []) as KaraokeRating[])
          return
        }
      }
      setPhase('enter_name')
    }
    init()
  }, [sessionId]) // eslint-disable-line

  // Realtime
  useEffect(() => {
    const ch = supabase.channel(`karaoke-player-${sessionId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
        p => setSession(p.new as GameSession))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'karaoke_songs', filter: `session_id=eq.${sessionId}` },
        p => setSongs(prev => [...prev, p.new as KaraokeSong].sort((a, b) => a.order_index - b.order_index)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'karaoke_songs', filter: `session_id=eq.${sessionId}` },
        p => setSongs(prev => prev.map(x => x.id === (p.new as KaraokeSong).id ? p.new as KaraokeSong : x)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'karaoke_ratings', filter: `session_id=eq.${sessionId}` },
        p => setRatings(prev => [...prev, p.new as KaraokeRating]))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [sessionId])

  // Canal de emojis
  useEffect(() => {
    const ch = supabase
      .channel(`karaoke-emoji-${sessionId}`, { config: { broadcast: { self: false, ack: false } } })
      .subscribe(status => { if (status === 'SUBSCRIBED') setEmojiReady(true) })
    emojiChannelRef.current = ch
    return () => { supabase.removeChannel(ch); setEmojiReady(false) }
  }, [sessionId])

  // Ações
  async function handleEnterName(name: string) {
    const { data, error } = await supabase
      .from('players').insert({ session_id: sessionId, name: name.trim(), is_ready: false })
      .select('*').single()
    if (error || !data) { alert('Erro ao entrar na sala.'); return }
    setPlayer(data as Player)
    localStorage.setItem(STORAGE_KEY, data.id)
    setPhase('lobby')
  }

  async function handleReady() {
    if (!player) return
    await supabase.from('players').update({ is_ready: true }).eq('id', player.id)
    setPlayer(prev => prev ? { ...prev, is_ready: true } : prev)
  }

  async function handleSendEmoji(emoji: string) {
    if (!emojiReady || !emojiChannelRef.current) return
    await emojiChannelRef.current.send({
      type: 'broadcast', event: 'emoji',
      payload: { emoji, playerName: playerRef.current?.name ?? '' },
    })
  }

  async function handleRating(stars: number) {
    if (!currentSong || !player || submittingRating || myRating === stars) return
    setSubmittingRating(true)
    setMyRating(stars)
    await supabase.from('karaoke_ratings').upsert(
      { song_id: currentSong.id, session_id: sessionId, player_id: player.id, rating: stars },
      { onConflict: 'song_id,player_id' }
    )
    setSubmittingRating(false)
  }

  // Guards
  if (phase === 'session_error') return (
    <MobileShell>
      <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center">
        <p className="text-5xl">😕</p>
        <p className="text-white text-lg font-bold">Sala não encontrada</p>
        <button className="btn-primary px-8 py-3 rounded-2xl" onClick={() => router.push('/')}>Início</button>
      </div>
    </MobileShell>
  )

  if (phase === 'loading') return (
    <MobileShell>
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-14 h-14 rounded-full border-4 border-pink-500 border-t-transparent" />
        <p className="text-white font-semibold">Conectando...</p>
      </div>
    </MobileShell>
  )

  return (
    <MobileShell>
      {phase === 'enter_name'  && <EnterNamePhase onConfirm={handleEnterName} />}
      {phase === 'lobby'       && <LobbyPhase player={player!} onReady={handleReady} />}
      {phase === 'search_song' && (
        <SearchSongPhase
          sessionId={sessionId}
          player={player!}
          onConfirmed={song => setSongs(prev => [...prev, song])}
        />
      )}
      {phase === 'song_ready'  && <SongReadyPhase mySong={mySong!} songs={songs} player={player!} />}
      {phase === 'singing_me'  && <SingingMePhase mySong={mySong!} />}
      {phase === 'watching'    && currentSong && (
        <WatchingPhase
          currentSong={currentSong}
          myRating={myRating}
          ratings={ratings}
          onRating={handleRating}
          onEmoji={handleSendEmoji}
        />
      )}
      {phase === 'finished' && (
        <FinishedPhase songs={songs} ratings={ratings} player={player} onNewGame={() => router.push('/')} />
      )}
    </MobileShell>
  )
}

// ─────────────────────────────────────────────────────────
// Shell mobile
// ─────────────────────────────────────────────────────────
function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-950 via-[#0a0a1a] to-[#0a0a1a] flex flex-col">
      <div className="flex-shrink-0 flex items-center justify-center py-4 border-b border-white/5">
        <h1 className="text-3xl font-black tracking-widest bg-gradient-to-r from-pink-400 to-purple-500 bg-clip-text text-transparent">
          KARAOKÊ
        </h1>
      </div>
      <div className="flex-1 flex flex-col px-4 pb-8 pt-4 overflow-y-auto">{children}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Fase 1 — Entrar com nome
// ─────────────────────────────────────────────────────────
function EnterNamePhase({ onConfirm }: { onConfirm: (n: string) => Promise<void> }) {
  const [name,    setName]    = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return
    setLoading(true); await onConfirm(name.trim()); setLoading(false)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center flex-1 gap-6">
      <motion.div animate={{ rotate: [0,-8,8,0] }} transition={{ duration: 2, repeat: Infinity, repeatDelay: 2 }} className="text-7xl">🎤</motion.div>
      <div className="text-center">
        <h2 className="text-white text-2xl font-bold mb-1">Bem-vindo ao Karaokê!</h2>
        <p className="text-gray-400 text-sm">Qual é o seu nome?</p>
      </div>
      <form onSubmit={submit} className="w-full max-w-xs flex flex-col gap-4">
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome aqui..."
          maxLength={20} autoFocus className="input-dark text-center text-lg w-full" />
        <motion.button type="submit" disabled={name.trim().length < 2 || loading} whileTap={{ scale: 0.95 }}
          className="btn-primary py-4 text-lg rounded-2xl w-full">
          {loading ? 'Entrando...' : 'Entrar na Sala →'}
        </motion.button>
      </form>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────
// Fase 2 — Lobby
// ─────────────────────────────────────────────────────────
function LobbyPhase({ player, onReady }: { player: Player; onReady: () => Promise<void> }) {
  const [loading, setLoading] = useState(false)
  async function handleReady() { setLoading(true); await onReady(); setLoading(false) }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center flex-1 gap-6 text-center">
      {player.is_ready ? (
        <>
          <motion.div animate={{ y: [0,-12,0] }} transition={{ duration: 2, repeat: Infinity }}>
            <span className="text-7xl">⏳</span>
          </motion.div>
          <div>
            <h2 className="text-white text-xl font-bold mb-1">
              Você está pronto, <span className="text-pink-400">{player.name}</span>!
            </h2>
            <p className="text-gray-400 text-sm">Aguardando o host iniciar o karaokê...</p>
          </div>
          <div className="flex items-center gap-2 bg-emerald-600/20 border border-emerald-500/30 rounded-full px-5 py-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-400 text-sm font-semibold">Pronto para cantar</span>
          </div>
        </>
      ) : (
        <>
          <span className="text-7xl">🎤</span>
          <div>
            <h2 className="text-white text-xl font-bold mb-1">
              Olá, <span className="text-pink-400">{player.name}</span>!
            </h2>
            <p className="text-gray-400 text-sm">Clique abaixo quando estiver pronto para o karaokê</p>
          </div>
          <motion.button onClick={handleReady} disabled={loading} whileTap={{ scale: 0.95 }}
            className="btn-primary py-4 px-10 rounded-2xl text-lg">
            {loading ? 'Confirmando...' : '✅ Estou Pronto!'}
          </motion.button>
        </>
      )}
    </motion.div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Fase 3 — Buscar e confirmar música  (Spotify + YouTube)
// ═══════════════════════════════════════════════════════════════
function SearchSongPhase({ sessionId, player, onConfirmed }: {
  sessionId: string; player: Player; onConfirmed: (s: KaraokeSong) => void
}) {
  type Step = 'search' | 'loading' | 'confirm'
  const [step, setStep] = useState<Step>('search')

  // Busca Spotify
  const [query,          setQuery]          = useState('')
  const [spotifyResults, setSpotifyResults] = useState<SpotifyTrack[]>([])
  const [searching,      setSearching]      = useState(false)
  const [noCredentials,  setNoCredentials]  = useState(false)

  // Seleção
  const [spotifyTrack,   setSpotifyTrack]   = useState<SpotifyTrack | null>(null)
  const [youtubeOptions, setYoutubeOptions] = useState<YouTubeResult[]>([])
  const [selectedYt,     setSelectedYt]     = useState<YouTubeResult | null>(null)
  const [noYtKey,        setNoYtKey]        = useState(false)
  const [pasteUrl,       setPasteUrl]       = useState('')
  const [showPaste,      setShowPaste]      = useState(false)

  // Letra
  const [foundLyrics,  setFoundLyrics]  = useState<string | null>(null)
  const [lyricsChecked,setLyricsChecked]= useState(false)
  const [manualLyrics, setManualLyrics] = useState('')
  const [showManual,   setShowManual]   = useState(false)

  const [saving, setSaving] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Busca Spotify com debounce
  useEffect(() => {
    if (!query.trim()) { setSpotifyResults([]); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`)
        const d = await r.json()
        if (d.noCredentials) setNoCredentials(true)
        else setSpotifyResults(d.tracks ?? [])
      } catch {}
      setSearching(false)
    }, 600)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  // Selecionou faixa Spotify → busca YouTube + letra em paralelo
  async function handleTrackSelect(track: SpotifyTrack) {
    setSpotifyTrack(track)
    setStep('loading')
    setYoutubeOptions([]); setSelectedYt(null)
    setFoundLyrics(null); setLyricsChecked(false)
    setShowManual(false); setManualLyrics('')
    setShowPaste(false); setPasteUrl('')

    const [ytRes, lyricsRes] = await Promise.allSettled([
      fetch(`/api/youtube/search?q=${encodeURIComponent(`${track.artist} ${track.name} karaoke`)}`).then(r => r.json()),
      fetch(`/api/lyrics?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.name)}`).then(r => r.json()),
    ])

    if (ytRes.status === 'fulfilled') {
      if (ytRes.value.noKey) setNoYtKey(true)
      else if (ytRes.value.results?.length > 0) {
        setYoutubeOptions(ytRes.value.results)
        setSelectedYt(ytRes.value.results[0])
      }
    }

    if (lyricsRes.status === 'fulfilled' && lyricsRes.value.lyrics) {
      setFoundLyrics(lyricsRes.value.lyrics)
    }
    setLyricsChecked(true)
    setStep('confirm')
  }

  function handlePasteUrl() {
    const id = extractYouTubeId(pasteUrl.trim())
    if (!id) { alert('URL inválida'); return }
    const manual: YouTubeResult = {
      videoId: id, title: 'Vídeo colado manualmente', channelTitle: '',
      thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
    }
    setSelectedYt(manual)
    if (!youtubeOptions.length) setYoutubeOptions([manual])
    setShowPaste(false); setPasteUrl('')
  }

  async function confirmSong() {
    if (!spotifyTrack || !selectedYt) { alert('Escolha um vídeo do YouTube.'); return }
    setSaving(true)
    try {
      const lyrics = manualLyrics.trim() || foundLyrics
      const { data, error } = await supabase.from('karaoke_songs').insert({
        session_id:       sessionId,
        player_id:        player.id,
        player_name:      player.name,
        youtube_id:       selectedYt.videoId,
        song_title:       spotifyTrack.name,
        artist:           spotifyTrack.artist,
        thumbnail:        spotifyTrack.imageUrl || selectedYt.thumbnail,
        lyrics,
        // ID do Spotify — salvo para o host buscar letras sincronizadas via OAuth
        spotify_track_id: spotifyTrack.name !== 'Minha música' ? spotifyTrack.id : null,
      }).select('*').single()
      if (error || !data) throw error
      await supabase.from('players').update({ is_ready: true }).eq('id', player.id)
      onConfirmed(data as KaraokeSong)
    } catch { alert('Erro ao confirmar. Tente novamente.') }
    setSaving(false)
  }

  // ── STEP: search ──────────────────────────────────────────
  if (step === 'search') {
    // Fallback: sem credenciais Spotify → cola link direto
    if (noCredentials) {
      return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-4">
          <div className="text-center">
            <h2 className="text-white text-xl font-bold">Cole o link do YouTube 🎵</h2>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-400/30 rounded-xl p-3 text-xs text-yellow-300 text-center">
            ⚠️ Spotify não configurado — adicione <strong>SPOTIFY_CLIENT_ID</strong> ao <code>.env.local</code>
          </div>
          <input type="url" value={pasteUrl} onChange={e => setPasteUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..." className="input-dark w-full" autoFocus />
          {pasteUrl.trim() && (
            <button onClick={() => {
              const id = extractYouTubeId(pasteUrl.trim())
              if (!id) { alert('URL inválida'); return }
              setSpotifyTrack({ id, name: 'Minha música', artist: '', artists: [], album: '', imageUrl: '', durationMs: 0, previewUrl: null })
              setSelectedYt({ videoId: id, title: 'Minha música', channelTitle: '', thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg` })
              setLyricsChecked(true)
              setStep('confirm')
            }} className="btn-primary py-3 rounded-2xl">
              Carregar vídeo →
            </button>
          )}
        </motion.div>
      )
    }

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-4">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-2xl">🎵</span>
            <h2 className="text-white text-xl font-bold">Buscar no Spotify</h2>
          </div>
          <p className="text-gray-400 text-sm">Nome da música ou artista</p>
        </div>

        <div className="relative">
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Ex: Salmo 91, Evidências, Shape of You..."
            className="input-dark w-full pr-10" autoFocus />
          {searching && (
            <svg className="animate-spin h-4 w-4 text-purple-400 absolute right-3 top-3.5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>

        <AnimatePresence>
          {spotifyResults.map((track, i) => (
            <motion.button key={track.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }} onClick={() => handleTrackSelect(track)}
              className="flex items-center gap-3 bg-white/5 rounded-xl p-3 border border-white/8 text-left hover:bg-white/10 transition-colors">
              {track.imageUrl
                ? <img src={track.imageUrl} alt="" className="w-14 h-14 object-cover rounded-lg flex-shrink-0" />
                : <div className="w-14 h-14 bg-white/10 rounded-lg flex-shrink-0 flex items-center justify-center text-2xl">🎵</div>
              }
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-bold leading-snug truncate">{track.name}</p>
                <p className="text-gray-400 text-xs mt-0.5 truncate">{track.artist}</p>
                <p className="text-gray-600 text-xs truncate">{track.album}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-gray-600 text-xs">{formatDuration(track.durationMs)}</p>
                <span className="text-purple-400 text-lg">›</span>
              </div>
            </motion.button>
          ))}
        </AnimatePresence>

        {query.trim() && !searching && spotifyResults.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-4">Nenhum resultado. Tente outro termo.</p>
        )}
      </motion.div>
    )
  }

  // ── STEP: loading ─────────────────────────────────────────
  if (step === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-6">
        {spotifyTrack?.name && spotifyTrack.name !== 'Minha música' && (
          <div className="flex items-center gap-4 bg-white/5 rounded-2xl p-4 border border-white/10 w-full">
            {spotifyTrack.imageUrl && <img src={spotifyTrack.imageUrl} alt="" className="w-16 h-16 rounded-xl flex-shrink-0" />}
            <div className="min-w-0">
              <p className="text-white font-bold truncate">{spotifyTrack.name}</p>
              <p className="text-gray-400 text-sm truncate">{spotifyTrack.artist}</p>
            </div>
          </div>
        )}
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-10 w-10 text-purple-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-purple-300 font-semibold">Buscando vídeo karaokê e letra...</p>
          <p className="text-gray-500 text-xs">Aguarde alguns segundos</p>
        </div>
      </div>
    )
  }

  // ── STEP: confirm ─────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">

      {/* Voltar */}
      <button onClick={() => { setStep('search'); setSpotifyTrack(null) }}
        className="text-gray-400 text-sm flex items-center gap-1 hover:text-gray-200 transition-colors w-fit">
        ← Buscar outra música
      </button>

      {/* Faixa do Spotify */}
      {spotifyTrack && spotifyTrack.name !== 'Minha música' && (
        <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex items-center gap-4">
          {spotifyTrack.imageUrl
            ? <img src={spotifyTrack.imageUrl} alt="" className="w-16 h-16 rounded-xl flex-shrink-0" />
            : <div className="w-16 h-16 bg-white/10 rounded-xl flex-shrink-0 flex items-center justify-center text-3xl">🎵</div>
          }
          <div className="min-w-0">
            <p className="text-white font-bold leading-tight truncate">{spotifyTrack.name}</p>
            <p className="text-gray-400 text-sm truncate">{spotifyTrack.artist}</p>
            {spotifyTrack.album && <p className="text-gray-600 text-xs truncate">{spotifyTrack.album}</p>}
          </div>
        </div>
      )}

      {/* Status da letra */}
      {lyricsChecked && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${
          foundLyrics
            ? 'bg-emerald-600/15 border-emerald-500/30 text-emerald-300'
            : 'bg-yellow-500/10 border-yellow-400/30 text-yellow-300'
        }`}>
          {foundLyrics ? (
            <div>
              <p className="font-semibold">✅ Letra sincronizada encontrada!</p>
              <p className="text-xs mt-1 opacity-70 italic line-clamp-2">
                {foundLyrics.replace(/^\[[\d:.]+\]\s*/gm, '').split('\n').filter(Boolean).slice(0, 2).join(' · ')}
              </p>
            </div>
          ) : (
            <div>
              <p className="font-semibold">⚠️ Letra não encontrada automaticamente</p>
              <p className="text-xs mt-1 opacity-80">Cole abaixo ou continue sem letra</p>
            </div>
          )}
        </div>
      )}

      {/* Input manual de letra */}
      {!foundLyrics && lyricsChecked && !showManual && (
        <button onClick={() => setShowManual(true)}
          className="w-full py-2.5 rounded-xl text-xs font-semibold bg-purple-600/20 border border-purple-500/30 text-purple-300">
          ✏️ Colar letra manualmente
        </button>
      )}
      {showManual && (
        <div className="flex flex-col gap-2">
          <textarea value={manualLyrics} onChange={e => setManualLyrics(e.target.value)}
            placeholder={"Cole a letra aqui:\n\nPrimeira linha\nSegunda linha..."}
            rows={6} className="input-dark w-full text-sm leading-relaxed resize-none" autoFocus />
          {manualLyrics.trim() && <p className="text-emerald-400 text-xs text-center">✅ Letra adicionada!</p>}
        </div>
      )}

      {/* Seleção de vídeo YouTube */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-gray-400 text-xs uppercase tracking-widest font-semibold">🎬 Vídeo karaokê</p>
          <button onClick={() => setShowPaste(p => !p)}
            className="text-purple-400 text-xs hover:text-purple-300 transition-colors">
            {showPaste ? '← Voltar' : '🔗 Colar link'}
          </button>
        </div>

        {showPaste ? (
          <div className="flex gap-2">
            <input type="url" value={pasteUrl} onChange={e => setPasteUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..." className="input-dark flex-1 text-sm" autoFocus />
            <button onClick={handlePasteUrl} disabled={!pasteUrl.trim()}
              className="px-3 py-2 bg-purple-600/30 border border-purple-500/40 text-purple-300 rounded-xl text-xs font-semibold whitespace-nowrap">
              OK
            </button>
          </div>
        ) : youtubeOptions.length > 0 ? (
          <div className="space-y-2">
            {youtubeOptions.slice(0, 4).map(yt => (
              <button key={yt.videoId} onClick={() => setSelectedYt(yt)}
                className={`w-full flex items-center gap-3 rounded-xl p-2.5 border text-left transition-colors ${
                  selectedYt?.videoId === yt.videoId
                    ? 'bg-purple-600/25 border-purple-500/50'
                    : 'bg-white/5 border-white/8 hover:bg-white/10'
                }`}>
                <img src={yt.thumbnail} alt="" className="w-16 h-10 object-cover rounded-lg flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-white text-xs font-semibold line-clamp-2 leading-snug">{yt.title}</p>
                  <p className="text-gray-500 text-xs truncate">{yt.channelTitle}</p>
                </div>
                {selectedYt?.videoId === yt.videoId && <span className="text-purple-400 flex-shrink-0 font-bold">✓</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-yellow-500/10 border border-yellow-400/30 rounded-xl p-3">
            <p className="text-yellow-300 text-xs text-center mb-2">
              {noYtKey ? '⚠️ YouTube API não configurada.' : '⚠️ Nenhum vídeo encontrado.'}<br/>
              Cole o link de um vídeo karaokê do YouTube:
            </p>
            <div className="flex gap-2">
              <input type="url" value={pasteUrl} onChange={e => setPasteUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..." className="input-dark flex-1 text-xs" />
              <button onClick={handlePasteUrl} disabled={!pasteUrl.trim()}
                className="px-3 py-1.5 bg-yellow-500/20 border border-yellow-400/40 text-yellow-300 rounded-lg text-xs">OK</button>
            </div>
          </div>
        )}
      </div>

      {/* Botão confirmar */}
      <motion.button onClick={confirmSong} disabled={saving || !selectedYt} whileTap={{ scale: 0.95 }}
        className="btn-primary py-4 rounded-2xl text-lg mt-1">
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Confirmando...
          </span>
        ) : !selectedYt ? 'Escolha um vídeo ↑' : '🎤 Confirmar esta música!'}
      </motion.button>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────
// Fase 4 — Música confirmada, aguardando
// ─────────────────────────────────────────────────────────
function SongReadyPhase({ mySong, songs, player }: { mySong: KaraokeSong; songs: KaraokeSong[]; player: Player }) {
  const selectedCount = songs.length
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center flex-1 gap-6 text-center">
      <span className="text-7xl">✅</span>
      <div>
        <h2 className="text-white text-xl font-bold mb-1">Música confirmada!</h2>
        <p className="text-pink-400 font-semibold">{mySong.song_title}</p>
        {mySong.artist && <p className="text-gray-500 text-sm">{mySong.artist}</p>}
      </div>
      <div className="bg-white/5 rounded-2xl px-6 py-4 border border-white/10">
        <p className="text-gray-400 text-sm">
          {selectedCount} música{selectedCount !== 1 ? 's' : ''} selecionada{selectedCount !== 1 ? 's' : ''}
        </p>
        <p className="text-gray-500 text-xs mt-1">Aguardando o host iniciar o show...</p>
      </div>
      <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} className="text-4xl">🎵</motion.div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────
// Fase 5 — Minha vez de cantar!
// ─────────────────────────────────────────────────────────
function SingingMePhase({ mySong }: { mySong: KaraokeSong }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center flex-1 gap-6 text-center">
      <motion.div animate={{ scale: [1, 1.1, 1], rotate: [-5, 5, -5, 0] }}
        transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1 }} className="text-8xl">🎤</motion.div>
      <div>
        <motion.h2 animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 1, repeat: Infinity }}
          className="text-4xl font-black text-transparent bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text mb-3 tracking-wider">
          É SUA VEZ!
        </motion.h2>
        <p className="text-white text-xl font-bold">{mySong.song_title}</p>
        {mySong.artist && <p className="text-gray-400 text-base mt-1">{mySong.artist}</p>}
      </div>
      <div className="bg-purple-600/20 border border-purple-500/30 rounded-2xl px-6 py-4 text-sm text-purple-300 max-w-xs">
        🎵 A letra está aparecendo na tela principal. Canta com tudo! 🎶
      </div>
      <div className="flex gap-4 text-3xl">
        {['🎤','🎵','🎶','🎸','🥳'].map((e, i) => (
          <motion.span key={i} animate={{ y: [0, -8, 0] }} transition={{ duration: 1.5, delay: i * 0.2, repeat: Infinity }}>
            {e}
          </motion.span>
        ))}
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────
// Fase 6 — Assistindo (avaliar + emojis)
// ─────────────────────────────────────────────────────────
function WatchingPhase({ currentSong, myRating, ratings, onRating, onEmoji }: {
  currentSong: KaraokeSong; myRating: number; ratings: KaraokeRating[]
  onRating: (stars: number) => void; onEmoji: (emoji: string) => Promise<void>
}) {
  const count = ratings.filter(r => r.song_id === currentSong.id).length
  const avg   = count > 0
    ? ratings.filter(r => r.song_id === currentSong.id).reduce((s, r) => s + r.rating, 0) / count
    : 0

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-5">
      <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center">
        <p className="text-gray-400 text-xs uppercase tracking-widest mb-2">Cantando agora</p>
        <p className="text-2xl font-black text-white">{currentSong.player_name}</p>
        <p className="text-pink-400 text-sm mt-1 font-semibold truncate">{currentSong.song_title}</p>
        {currentSong.artist && <p className="text-gray-500 text-xs">{currentSong.artist}</p>}
      </div>

      <div className="bg-white/5 rounded-2xl p-5 border border-white/10">
        <p className="text-gray-400 text-sm uppercase tracking-widest mb-4 text-center font-semibold">Avalie o canto ⭐</p>
        <div className="flex justify-center gap-3 mb-3">
          {[1,2,3,4,5].map(star => (
            <motion.button key={star} onClick={() => onRating(star)} whileTap={{ scale: 0.8 }}
              className={`text-4xl transition-transform ${star <= myRating ? 'text-yellow-400 scale-110' : 'text-gray-700 hover:text-yellow-300'}`}>
              ★
            </motion.button>
          ))}
        </div>
        {myRating > 0 && (
          <p className="text-center text-emerald-400 text-sm font-semibold">
            Você deu {myRating} estrela{myRating !== 1 ? 's' : ''}!
          </p>
        )}
        {count > 0 && (
          <p className="text-center text-gray-500 text-xs mt-1">
            Média: {avg.toFixed(1)} ({count} voto{count !== 1 ? 's' : ''})
          </p>
        )}
      </div>

      <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
        <p className="text-gray-400 text-sm uppercase tracking-widest mb-3 text-center font-semibold">Mande emojis 🎉</p>
        <div className="grid grid-cols-5 gap-2">
          {KARAOKE_EMOJIS.map(emoji => (
            <motion.button key={emoji} onClick={() => onEmoji(emoji)} whileTap={{ scale: 0.7 }}
              className="aspect-square rounded-xl bg-white/5 hover:bg-white/15 flex items-center justify-center text-2xl transition-colors active:bg-purple-600/30 border border-white/8">
              {emoji}
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────
// Fase 7 — Fim de jogo
// ─────────────────────────────────────────────────────────
function FinishedPhase({ songs, ratings, player, onNewGame }: {
  songs: KaraokeSong[]; ratings: KaraokeRating[]; player: Player | null; onNewGame: () => void
}) {
  const sorted = [...songs].sort((a, b) => {
    const avg = (s: KaraokeSong) => {
      const r = ratings.filter(x => x.song_id === s.id)
      return r.length ? r.reduce((sum, x) => sum + x.rating, 0) / r.length : 0
    }
    return avg(b) - avg(a)
  })
  const isTop = sorted[0]?.player_id === player?.id

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6 py-4 text-center">
      <motion.div initial={{ scale: 0, rotate: -15 }} animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200 }} className="text-7xl">
        {isTop ? '🏆' : '🎤'}
      </motion.div>
      <div>
        <h2 className="text-3xl font-black text-transparent bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text">
          Show encerrado!
        </h2>
        {isTop && <p className="text-yellow-400 font-bold mt-1">Você foi o campeão do show! 🥳</p>}
      </div>

      <div className="w-full space-y-2">
        {sorted.map((s, i) => {
          const r = ratings.filter(x => x.song_id === s.id)
          const avg = r.length ? r.reduce((sum, x) => sum + x.rating, 0) / r.length : 0
          const isMe = s.player_id === player?.id
          return (
            <div key={s.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
              isMe ? 'bg-purple-600/20 border-purple-500/30' : 'bg-white/5 border-white/8'
            }`}>
              <span className="font-black w-6 text-center text-sm">{i === 0 ? '🏆' : `#${i+1}`}</span>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-white font-bold text-sm truncate">{s.player_name}{isMe ? ' (você)' : ''}</p>
                <p className="text-gray-500 text-xs truncate">{s.song_title}</p>
              </div>
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map(x => (
                  <span key={x} className={`text-sm ${x <= Math.round(avg) ? 'text-yellow-400' : 'text-gray-700'}`}>★</span>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <button onClick={onNewGame} className="btn-primary px-8 py-4 rounded-2xl text-base">🎮 Novo Jogo</button>
    </motion.div>
  )
}

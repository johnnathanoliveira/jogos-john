'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { drawNumber } from '@/lib/bingo-utils'
import type { GameSession, Player } from '@/lib/types'
import { PLAYER_COLORS } from '@/lib/types'
import { BingoGlobe } from '@/components/BingoGlobe'

// QRCodeSVG só renderiza no cliente
const QRCodeSVG = dynamic(
  () => import('qrcode.react').then(m => m.QRCodeSVG),
  {
    ssr: false,
    loading: () => (
      <div className="w-48 h-48 bg-white/10 animate-pulse rounded-xl" />
    ),
  }
)

// =============================================
// Página do Host
// =============================================
export default function BingoHostPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()

  const [session, setSession] = useState<GameSession | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [spinning, setSpinning] = useState(false)
  const [playerUrl, setPlayerUrl] = useState('')
  const [showConfetti, setShowConfetti] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const spinningRef = useRef(false)
  // sessionRef sempre aponta para os dados mais recentes da sessão
  // (evita stale closure no auto-spin async)
  const sessionRef = useRef<GameSession | null>(null)
  useEffect(() => { sessionRef.current = session }, [session])

  // URL do jogador — usa IP local de rede quando em localhost,
  // para que o QR Code funcione no celular na mesma rede Wi-Fi.
  useEffect(() => {
    async function buildPlayerUrl() {
      const { hostname, port, protocol } = window.location
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'

      if (isLocalhost) {
        try {
          const res = await fetch('/api/local-ip')
          const { primary } = await res.json()
          if (primary) {
            const portStr = port ? `:${port}` : ''
            setPlayerUrl(`${protocol}//${primary}${portStr}/bingo/play/${sessionId}`)
            return
          }
        } catch {
          // fallback: continua com localhost
        }
      }

      // Produção (Vercel) ou acesso já feito pelo IP: usa o origin diretamente
      setPlayerUrl(`${window.location.origin}/bingo/play/${sessionId}`)
    }

    buildPlayerUrl()
  }, [sessionId])

  // Busca inicial
  useEffect(() => {
    async function fetchData() {
      const [{ data: sessionData, error }, { data: playersData }] = await Promise.all([
        supabase.from('game_sessions').select('*').eq('id', sessionId).single(),
        supabase.from('players').select('*').eq('session_id', sessionId).order('created_at'),
      ])

      if (error || !sessionData) {
        setLoadError(true)
        return
      }

      setSession(sessionData as GameSession)
      setPlayers((playersData as Player[]) ?? [])
      if (sessionData.status === 'finished') setShowConfetti(true)
    }
    fetchData()
  }, [sessionId])

  // Assinaturas Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`host-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          const updated = payload.new as GameSession
          setSession(updated)
          if (updated.status === 'finished') setShowConfetti(true)
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
        (payload) => setPlayers(prev => [...prev, payload.new as Player])
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
        (payload) =>
          setPlayers(prev =>
            prev.map(p => (p.id === (payload.new as Player).id ? (payload.new as Player) : p))
          )
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
        (payload) =>
          setPlayers(prev => prev.filter(p => p.id !== (payload.old as { id: string }).id))
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [sessionId])

  // Estado derivado
  const allReady    = players.length > 0 && players.every(p => p.is_ready)
  const allMarked   = players.length > 0 && players.every(p => p.has_marked)
  const isFirstDraw = (session?.drawn_numbers.length ?? 0) === 0

  // --- Ação de sorteio (usa sessionRef para evitar stale closure) ---
  const doSpin = useCallback(async () => {
    if (spinningRef.current) return
    spinningRef.current = true
    setSpinning(true)

    // Animação do globo girando
    await new Promise(r => setTimeout(r, 2500))

    const s = sessionRef.current
    if (!s) { setSpinning(false); spinningRef.current = false; return }

    const newNumber = drawNumber(s.drawn_numbers)
    if (!newNumber) {
      setSpinning(false)
      spinningRef.current = false
      return
    }

    await supabase
      .from('players')
      .update({ has_marked: false })
      .eq('session_id', sessionId)

    await supabase
      .from('game_sessions')
      .update({
        current_number: newNumber,
        drawn_numbers: [...s.drawn_numbers, newNumber],
        all_marked: false,
      })
      .eq('id', sessionId)

    setSpinning(false)
    spinningRef.current = false
  }, [sessionId])

  // --- Auto-sorteio: dispara 1.5s após todos marcarem (ou ao iniciar) ---
  useEffect(() => {
    if (session?.status !== 'playing') return
    if (spinningRef.current) return

    const shouldSpin = isFirstDraw || allMarked
    if (!shouldSpin) return

    const delay = isFirstDraw ? 2500 : 1500
    const t = setTimeout(() => doSpin(), delay)
    return () => clearTimeout(t)
  }, [allMarked, isFirstDraw, session?.status, doSpin])

  // --- Iniciar jogo ---
  async function startGame() {
    if (!allReady) return
    await supabase.from('game_sessions').update({ status: 'playing' }).eq('id', sessionId)
  }

  // --- Render ---
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a1a]">
        <div className="text-center">
          <p className="text-3xl mb-4">😕</p>
          <p className="text-white text-lg mb-4">Sala não encontrada.</p>
          <button className="btn-primary" onClick={() => router.push('/')}>Voltar ao Início</button>
        </div>
      </div>
    )
  }

  if (!session) return <LoadingScreen />

  if (session.status === 'finished') {
    return (
      <>
        <WinnerScreen winnerName={session.winner_name ?? 'Alguém'} onNewGame={() => router.push('/')} />
        {showConfetti && <ConfettiEffect />}
      </>
    )
  }

  if (session.status === 'lobby') {
    return (
      <LobbyScreen
        players={players}
        playerUrl={playerUrl}
        allReady={allReady}
        onStart={startGame}
        sessionId={sessionId}
      />
    )
  }

  return (
    <PlayingScreen
      session={session}
      players={players}
      spinning={spinning}
      allMarked={allMarked}
      isFirstDraw={isFirstDraw}
    />
  )
}

// =============================================
// Tela: Carregando
// =============================================
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#0a0a1a] flex flex-col items-center justify-center gap-4">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className="w-12 h-12 rounded-full border-4 border-yellow-400 border-t-transparent"
      />
      <p className="text-white/60">Carregando sala...</p>
    </div>
  )
}

// =============================================
// Tela: Lobby (aguardando jogadores)
// =============================================
interface LobbyScreenProps {
  players: Player[]
  playerUrl: string
  allReady: boolean
  sessionId: string
  onStart: () => void
}

function LobbyScreen({ players, playerUrl, allReady, onStart, sessionId }: LobbyScreenProps) {
  const readyCount = players.filter(p => p.is_ready).length
  const router = useRouter()

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-950 via-[#0a0a1a] to-[#0a0a1a] p-6 md:p-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-10 relative"
      >
        {/* Botão Voltar */}
        <button
          onClick={() => router.push('/')}
          className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm font-medium group"
        >
          <span className="group-hover:-translate-x-1 transition-transform">←</span>
          Voltar
        </button>

        <h1 className="text-6xl md:text-7xl font-black tracking-widest text-transparent bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text">
          BINGO
        </h1>
        <p className="text-indigo-300 text-sm mt-1 tracking-widest uppercase">Sala do host</p>
      </motion.div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
        {/* Coluna Esquerda: jogadores */}
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
          {/* Status */}
          <div className="bg-white/5 rounded-2xl p-6 mb-6 border border-white/10">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-bold text-lg">Jogadores na sala</h2>
              <span className="bg-indigo-600/40 text-indigo-300 text-xs font-bold px-3 py-1 rounded-full border border-indigo-500/30">
                {players.length} / 8
              </span>
            </div>

            {players.length === 0 ? (
              <div className="text-center py-8">
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="text-4xl mb-3"
                >
                  📱
                </motion.div>
                <p className="text-gray-500 text-sm">Aguardando jogadores escanearem o QR Code...</p>
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {players.map((player, i) => {
                    const color = PLAYER_COLORS[i % PLAYER_COLORS.length]
                    return (
                      <motion.div
                        key={player.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full ${color.bg} flex items-center justify-center font-black text-white text-sm`}>
                            {player.name[0].toUpperCase()}
                          </div>
                          <span className="text-white font-semibold">{player.name}</span>
                        </div>
                        <div className={`flex items-center gap-2 text-sm font-medium ${player.is_ready ? 'text-emerald-400' : 'text-gray-500'}`}>
                          {player.is_ready ? (
                            <>
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                              Pronto!
                            </>
                          ) : (
                            <>
                              <span className="w-2 h-2 rounded-full bg-gray-600" />
                              Aguardando...
                            </>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Botão Iniciar */}
          <div>
            {players.length > 0 && (
              <p className="text-center text-sm text-gray-500 mb-3">
                {readyCount}/{players.length} jogadores prontos
              </p>
            )}
            <motion.button
              onClick={onStart}
              disabled={!allReady}
              whileHover={allReady ? { scale: 1.03 } : {}}
              whileTap={allReady ? { scale: 0.97 } : {}}
              className={`
                w-full py-4 rounded-2xl font-black text-xl tracking-wider transition-all duration-300
                ${allReady
                  ? 'bg-gradient-to-r from-yellow-400 to-orange-500 text-gray-900 shadow-lg shadow-yellow-500/30 animate-pulse-glow'
                  : 'bg-white/5 text-gray-600 cursor-not-allowed border border-white/10'
                }
              `}
            >
              {allReady ? '🎮 INICIAR JOGO!' : 'Aguardando todos ficarem prontos...'}
            </motion.button>
          </div>
        </motion.div>

        {/* Coluna Direita: QR Code */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col items-center"
        >
          <div className="bg-white/5 rounded-3xl p-8 border border-white/10 card-glow text-center w-full max-w-sm mx-auto">
            <p className="text-gray-400 text-sm uppercase tracking-widest mb-6 font-semibold">
              📱 Escaneie para jogar
            </p>

            {/* QR Code */}
            <div className="bg-white p-4 rounded-2xl inline-block mb-6 shadow-2xl">
              {playerUrl ? (
                <QRCodeSVG
                  value={playerUrl}
                  size={200}
                  bgColor="#ffffff"
                  fgColor="#0a0a1a"
                  level="M"
                />
              ) : (
                <div className="w-[200px] h-[200px] bg-gray-100 animate-pulse rounded-lg flex items-center justify-center">
                  <span className="text-gray-400 text-xs">Gerando...</span>
                </div>
              )}
            </div>

            {/* Aviso se ainda for localhost */}
            {playerUrl?.includes('localhost') && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2 mb-4 text-xs text-yellow-300">
                ⚠️ URL com <strong>localhost</strong> não funciona no celular.<br />
                Acesse esta página pelo IP da sua máquina na rede.
              </div>
            )}

            {/* URL */}
            <p className="text-gray-400 text-xs mb-2">ou acesse:</p>
            <div className="bg-black/40 rounded-xl px-3 py-2 border border-white/10">
              <p className="text-yellow-400 text-xs font-mono break-all">{playerUrl}</p>
            </div>

            <div className="mt-5 flex flex-col gap-2 text-xs text-gray-500">
              <p>📲 Aponte a câmera do celular para o QR Code</p>
              <p>✏️ Coloque seu nome e escolha uma cartela</p>
              <p>✅ Toque em <strong className="text-gray-300">Pronto!</strong> para confirmar</p>
            </div>
          </div>

          {/* ID da sala */}
          <p className="text-gray-600 text-xs mt-4">
            ID da sala: <span className="font-mono text-gray-500">{sessionId.slice(0, 8)}...</span>
          </p>
        </motion.div>
      </div>
    </div>
  )
}

// =============================================
// Tela: Jogando
// =============================================
interface PlayingScreenProps {
  session: GameSession
  players: Player[]
  spinning: boolean
  allMarked: boolean
  isFirstDraw: boolean
}

function PlayingScreen({ session, players, spinning, allMarked, isFirstDraw }: PlayingScreenProps) {
  const drawnCount  = session.drawn_numbers.length
  const markedCount = players.filter(p => p.has_marked).length
  const willSpinSoon = (isFirstDraw || allMarked) && !spinning

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0d0b2a] to-[#0a0a1a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              if (confirm('Sair do jogo em andamento? Os jogadores perderão o progresso.')) {
                window.location.href = '/'
              }
            }}
            className="text-gray-500 hover:text-gray-300 transition-colors text-sm flex items-center gap-1 group"
          >
            <span className="group-hover:-translate-x-1 transition-transform">←</span>
            Sair
          </button>
          <h1 className="text-3xl font-black tracking-widest bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
            BINGO
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white/5 rounded-full px-4 py-1.5 text-sm border border-white/10">
            <span className="text-yellow-400 font-bold">{drawnCount}</span>
            <span className="text-gray-500"> / 80 sorteados</span>
          </div>
          <div className="bg-white/5 rounded-full px-4 py-1.5 text-sm border border-white/10">
            <span className="text-emerald-400 font-bold">{markedCount}</span>
            <span className="text-gray-500"> / {players.length} marcaram</span>
          </div>
        </div>
      </div>

      {/* Conteúdo principal */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-0">

        {/* Coluna Esquerda: Globo + controle */}
        <div className="lg:col-span-2 flex flex-col items-center justify-center px-6 py-8 border-r border-white/5">
          <BingoGlobe currentNumber={session.current_number} spinning={spinning} />

          <div className="mt-10 w-full max-w-xs">
            {/* Status automático — substitui o botão GIRAR */}
            <AnimatePresence mode="wait">
              {spinning && (
                <motion.div
                  key="spinning"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex flex-col items-center gap-2"
                >
                  <div className="flex items-center gap-2 text-yellow-400 font-bold text-lg">
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Sorteando...
                  </div>
                </motion.div>
              )}

              {willSpinSoon && (
                <motion.div
                  key="will-spin"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex flex-col items-center gap-2"
                >
                  <motion.div
                    animate={{ scale: [1, 1.06, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                    className="text-3xl"
                  >
                    🎲
                  </motion.div>
                  <p className="text-emerald-400 font-bold text-sm text-center">
                    {isFirstDraw ? 'Iniciando o jogo...' : 'Todos marcaram! Sorteando...'}
                  </p>
                </motion.div>
              )}

              {!spinning && !willSpinSoon && (
                <motion.div
                  key="waiting"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex flex-col items-center gap-2"
                >
                  <p className="text-yellow-400/70 text-sm animate-pulse text-center">
                    ⏳ Aguardando marcações...
                  </p>
                  <p className="text-gray-600 text-xs">
                    {markedCount}/{players.length} confirmaram
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Coluna Direita: grid de números + jogadores */}
        <div className="lg:col-span-3 flex flex-col px-6 py-6 overflow-y-auto gap-6">

          {/* Grid de números 1-100 */}
          <div>
            <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-3 font-semibold">
              Números sorteados
            </h3>
            <NumbersGrid
              drawnNumbers={session.drawn_numbers}
              currentNumber={session.current_number}
            />
          </div>

          {/* Status dos jogadores */}
          <div>
            <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-3 font-semibold">
              Status dos jogadores
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {players.map((player, i) => {
                const color = PLAYER_COLORS[i % PLAYER_COLORS.length]
                return (
                  <div
                    key={player.id}
                    className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/5"
                  >
                    <div className={`w-8 h-8 rounded-full ${color.bg} flex items-center justify-center font-black text-white text-xs flex-shrink-0`}>
                      {player.name[0].toUpperCase()}
                    </div>
                    <span className="text-white text-sm font-medium truncate flex-1">{player.name}</span>
                    <div className={`text-xs font-semibold flex-shrink-0 ${player.has_marked ? 'text-emerald-400' : 'text-gray-500'}`}>
                      {player.has_marked ? '✓ Marcou' : '⏳'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================
// Grid de números 1–80
// =============================================
function NumbersGrid({
  drawnNumbers,
  currentNumber,
}: {
  drawnNumbers: number[]
  currentNumber: number | null
}) {
  const drawnSet = new Set(drawnNumbers)

  return (
    <div className="grid grid-cols-10 gap-1">
      {Array.from({ length: 80 }, (_, i) => {
        const n = i + 1
        const isDrawn   = drawnSet.has(n)
        const isCurrent = n === currentNumber

        return (
          <motion.div
            key={n}
            className={`
              aspect-square rounded-lg flex items-center justify-center
              text-xs font-bold transition-all duration-300
              ${isCurrent
                ? 'bg-yellow-400 text-gray-900 scale-110 shadow-lg shadow-yellow-400/50 z-10 relative'
                : isDrawn
                  ? 'bg-indigo-600/60 text-indigo-200 border border-indigo-500/40'
                  : 'bg-white/5 text-gray-600 border border-white/5'
              }
            `}
            animate={isCurrent ? { scale: [1, 1.2, 1.1] } : {}}
            transition={{ duration: 0.4 }}
          >
            {n}
          </motion.div>
        )
      })}
    </div>
  )
}

// =============================================
// Tela: Vencedor
// =============================================
function WinnerScreen({ winnerName, onNewGame }: { winnerName: string; onNewGame: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-yellow-950 via-[#0a0a1a] to-[#0a0a1a] flex flex-col items-center justify-center px-6 text-center">
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 12 }}
        className="text-9xl mb-6"
      >
        🏆
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-6xl md:text-8xl font-black tracking-widest text-yellow-400 mb-4 animate-winner-glow"
      >
        VENCEDOR!
      </motion.h1>

      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.5, type: 'spring' }}
        className="mb-10"
      >
        <p className="text-gray-400 text-lg mb-2">O grande campeão desta rodada é</p>
        <p className="text-4xl md:text-5xl font-black text-white text-glow-white">{winnerName}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9 }}
        className="flex flex-col sm:flex-row gap-4"
      >
        <button onClick={onNewGame} className="btn-primary text-lg px-10 py-4 rounded-2xl">
          🎮 Novo Jogo
        </button>
      </motion.div>
    </div>
  )
}

// =============================================
// Efeito de confetes
// =============================================
const CONFETTI_COLORS = ['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f97316', '#06b6d4']

function ConfettiEffect() {
  const pieces = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    duration: `${Math.random() * 2 + 2.5}s`,
    delay: `${Math.random() * 2.5}s`,
    width: `${Math.random() * 8 + 5}px`,
    height: `${Math.random() * 14 + 6}px`,
    borderRadius: Math.random() > 0.5 ? '50%' : '2px',
  }))

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {pieces.map(p => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: p.left,
            backgroundColor: p.color,
            width: p.width,
            height: p.height,
            borderRadius: p.borderRadius,
            animationDuration: p.duration,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  )
}

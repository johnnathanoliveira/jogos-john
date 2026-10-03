'use client'

import { useState, useEffect, useRef, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import {
  generateBingoCard,
  checkBingo,
  validateMarking,
  isFreeSpace,
} from '@/lib/bingo-utils'
import type { GameSession, Player, BingoCard as BingoCardType } from '@/lib/types'
import { BingoCard } from '@/components/BingoCard'

type Phase = 'loading' | 'enter_name' | 'select_card' | 'waiting' | 'playing' | 'finished'

// =============================================
// Página do Jogador (mobile)
// =============================================
export default function BingoPlayerPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()

  const [phase, setPhase]                       = useState<Phase>('loading')
  const [session, setSession]                   = useState<GameSession | null>(null)
  const [player, setPlayer]                     = useState<Player | null>(null)
  const [previewCard, setPreviewCard]           = useState<BingoCardType>(() => generateBingoCard())
  const [markedPositions, setMarkedPositions]   = useState<number[]>([])
  const [bingoMsg, setBingoMsg]                 = useState<{ ok: boolean; text: string } | null>(null)
  const [newNumberAlert, setNewNumberAlert]     = useState<number | null>(null)
  const [winningPattern, setWinningPattern]     = useState<number[] | undefined>()
  const [sessionError, setSessionError]         = useState(false)

  const prevCurrentNumberRef = useRef<number | null>(null)
  const playerRef            = useRef<Player | null>(null)
  const STORAGE_KEY          = `bingo_player_${sessionId}`

  // Mantém playerRef sempre atualizado
  useEffect(() => { playerRef.current = player }, [player])

  // =============================================
  // Montagem: verificar reconexão via localStorage
  // =============================================
  useEffect(() => {
    async function init() {
      try {
      // 1) Verifica se a sessão existe
      const { data: sessionData, error: sessionErr } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('id', sessionId)
        .single()

      if (sessionErr || !sessionData) {
        console.error('Sessão não encontrada:', sessionErr)
        setSessionError(true)
        return
      }
      setSession(sessionData as GameSession)

      // 2) Tenta reconectar jogador existente
      const storedPlayerId = localStorage.getItem(STORAGE_KEY)
      if (storedPlayerId) {
        const { data: playerData } = await supabase
          .from('players')
          .select('*')
          .eq('id', storedPlayerId)
          .eq('session_id', sessionId)
          .single()

        if (playerData) {
          const p = playerData as Player
          setPlayer(p)
          setMarkedPositions(p.marked_positions ?? [])
          prevCurrentNumberRef.current = sessionData.current_number

          if (sessionData.status === 'finished') {
            setPhase('finished')
          } else if (sessionData.status === 'playing') {
            setPhase('playing')
          } else if (p.is_ready) {
            setPhase('waiting')
          } else if (p.card) {
            setPhase('select_card')
          } else {
            setPhase('enter_name')
          }
          return
        }
      }

      // 3) Sem reconexão: iniciar fluxo
      if (sessionData.status === 'finished') {
        setPhase('finished')
      } else {
        setPhase('enter_name')
      }
      } catch (err) {
        console.error('Erro ao inicializar página do jogador:', err)
        setSessionError(true)
      }
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // =============================================
  // Realtime: sessão
  // =============================================
  useEffect(() => {
    const channel = supabase
      .channel(`player-session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          const updated = payload.new as GameSession
          setSession(updated)

          if (updated.status === 'playing' && phase !== 'playing') {
            setPhase('playing')
          }
          if (updated.status === 'finished') {
            setPhase('finished')
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [sessionId, phase])

  // =============================================
  // Realtime: jogador (para resetar has_marked)
  // =============================================
  useEffect(() => {
    const p = playerRef.current
    if (!p) return

    const channel = supabase
      .channel(`player-self-${p.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'players', filter: `id=eq.${p.id}` },
        (payload) => {
          setPlayer(payload.new as Player)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [player?.id])

  // =============================================
  // Alerta: novo número sorteado
  // =============================================
  useEffect(() => {
    const num = session?.current_number
    if (num && num !== prevCurrentNumberRef.current) {
      prevCurrentNumberRef.current = num
      setNewNumberAlert(num)
      setTimeout(() => setNewNumberAlert(null), 3500)
    }
  }, [session?.current_number])

  // =============================================
  // Ações do jogador
  // =============================================
  async function handleEnterName(name: string) {
    const { data, error } = await supabase
      .from('players')
      .insert({ session_id: sessionId, name: name.trim() })
      .select('*')
      .single()

    if (error || !data) {
      alert('Erro ao entrar na sala. Tente novamente.')
      return
    }

    const p = data as Player
    setPlayer(p)
    localStorage.setItem(STORAGE_KEY, p.id)
    setPhase('select_card')
  }

  async function handleConfirmCard() {
    if (!player) return

    const { error } = await supabase
      .from('players')
      .update({ card: previewCard, is_ready: true })
      .eq('id', player.id)

    if (error) { alert('Erro ao confirmar cartela.'); return }

    setPlayer(prev => prev ? { ...prev, card: previewCard, is_ready: true } : prev)
    setPhase('waiting')
  }

  function handleMarkCell(idx: number) {
    if (isFreeSpace(idx)) return
    setMarkedPositions(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    )
  }

  async function handleAlreadyMarked() {
    const p = playerRef.current
    if (!p || p.has_marked) return

    await supabase
      .from('players')
      .update({ has_marked: true, marked_positions: markedPositions })
      .eq('id', p.id)
  }

  async function handleBingo() {
    const p = playerRef.current
    if (!p?.card || !session) return

    setBingoMsg(null)

    // Validação 1: todas as posições marcadas têm números sorteados?
    const markingValid = validateMarking(p.card, markedPositions, session.drawn_numbers)
    if (!markingValid) {
      setBingoMsg({ ok: false, text: 'Você marcou um número que ainda não foi sorteado! 🤔' })
      return
    }

    // Validação 2: existe padrão vencedor?
    const result = checkBingo(markedPositions)
    if (!result.won) {
      setBingoMsg({ ok: false, text: 'Ainda não é bingo! Continue marcando. 😅' })
      return
    }

    // Vencedor! Atualiza a sessão
    const { error } = await supabase
      .from('game_sessions')
      .update({ status: 'finished', winner_id: p.id, winner_name: p.name })
      .eq('id', sessionId)
      .eq('status', 'playing')

    if (error) {
      setBingoMsg({ ok: false, text: 'Outro jogador ganhou primeiro! Boa sorte na próxima. 🎲' })
      return
    }

    setWinningPattern(result.pattern)
    setBingoMsg({ ok: true, text: '🎉 BINGO! Você ganhou!' })
  }

  // =============================================
  // Guards
  // =============================================
  if (sessionError) {
    return (
      <MobileWrapper>
        <div className="text-center py-20 flex flex-col items-center gap-4">
          <p className="text-6xl">😕</p>
          <p className="text-white text-xl font-bold">Sala não encontrada</p>
          <p className="text-gray-400 text-sm max-w-xs">
            O link pode ter expirado ou a sala foi encerrada.
          </p>
          <button
            className="btn-primary mt-2 px-8 py-3 rounded-2xl"
            onClick={() => router.push('/')}
          >
            Ir ao Início
          </button>
        </div>
      </MobileWrapper>
    )
  }

  if (phase === 'loading') {
    return (
      <MobileWrapper>
        <div className="flex flex-col items-center justify-center flex-1 gap-5">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-14 h-14 rounded-full border-4 border-yellow-400 border-t-transparent"
          />
          <p className="text-white font-semibold text-lg">Conectando...</p>
          <p className="text-gray-500 text-sm">Carregando a sala de bingo</p>
        </div>
      </MobileWrapper>
    )
  }

  // =============================================
  // Render por fase
  // =============================================
  return (
    <MobileWrapper>
      {/* Banner: novo número */}
      <AnimatePresence>
        {newNumberAlert && (
          <motion.div
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            className="fixed top-0 inset-x-0 z-50 bg-yellow-400 text-gray-900 flex items-center justify-center gap-3 py-4 shadow-2xl"
          >
            <span className="text-2xl">🎱</span>
            <span className="text-2xl font-black tracking-wide">
              Número {newNumberAlert}!
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {phase === 'enter_name' && <EnterNamePhase onConfirm={handleEnterName} />}
      {phase === 'select_card' && player && (
        <SelectCardPhase
          playerName={player.name}
          previewCard={previewCard}
          onSwap={() => setPreviewCard(generateBingoCard())}
          onConfirm={handleConfirmCard}
        />
      )}
      {phase === 'waiting' && player && <WaitingPhase playerName={player.name} />}
      {phase === 'playing' && player?.card && session && (
        <PlayingPhase
          player={player}
          session={session}
          markedPositions={markedPositions}
          winningPattern={winningPattern}
          bingoMsg={bingoMsg}
          newNumberAlert={newNumberAlert}
          onMark={handleMarkCell}
          onAlreadyMarked={handleAlreadyMarked}
          onBingo={handleBingo}
        />
      )}
      {phase === 'finished' && (
        <FinishedPhase
          isWinner={session?.winner_id === player?.id}
          winnerName={session?.winner_name ?? ''}
          onNewGame={() => router.push('/')}
        />
      )}
    </MobileWrapper>
  )
}

// =============================================
// Wrapper mobile
// =============================================
function MobileWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-950 via-[#0a0a1a] to-[#0a0a1a] flex flex-col">
      {/* Header fixo */}
      <div className="flex-shrink-0 flex items-center justify-center py-4 border-b border-white/5">
        <h1 className="text-3xl font-black tracking-widest bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
          BINGO
        </h1>
      </div>
      <div className="flex-1 flex flex-col px-4 pb-8 pt-4 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

// =============================================
// Fase 1: Digite seu nome
// =============================================
function EnterNamePhase({ onConfirm }: { onConfirm: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || name.trim().length < 2) return
    setLoading(true)
    await onConfirm(name.trim())
    setLoading(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center flex-1 gap-6"
    >
      <motion.div
        animate={{ rotate: [0, -8, 8, -8, 0] }}
        transition={{ duration: 2, repeat: Infinity, repeatDelay: 2 }}
        className="text-7xl"
      >
        🎱
      </motion.div>

      <div className="text-center">
        <h2 className="text-white text-2xl font-bold mb-1">Bem-vindo!</h2>
        <p className="text-gray-400 text-sm">Qual é o seu nome?</p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xs flex flex-col gap-4">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Seu nome aqui..."
          maxLength={20}
          autoFocus
          className="input-dark text-center text-lg w-full"
        />
        <motion.button
          type="submit"
          disabled={name.trim().length < 2 || loading}
          whileTap={{ scale: 0.95 }}
          className="btn-primary py-4 text-lg rounded-2xl w-full"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Entrando...
            </span>
          ) : (
            'Entrar na Sala →'
          )}
        </motion.button>
      </form>
    </motion.div>
  )
}

// =============================================
// Fase 2: Escolha a cartela
// =============================================
interface SelectCardPhaseProps {
  playerName: string
  previewCard: BingoCardType
  onSwap: () => void
  onConfirm: () => Promise<void>
}

function SelectCardPhase({ playerName, previewCard, onSwap, onConfirm }: SelectCardPhaseProps) {
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    await onConfirm()
    setLoading(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-5"
    >
      <div className="text-center">
        <h2 className="text-white text-xl font-bold">
          Olá, <span className="text-yellow-400">{playerName}</span>! 👋
        </h2>
        <p className="text-gray-400 text-sm mt-1">Essa é sua cartela. Gostou?</p>
      </div>

      {/* Preview da cartela */}
      <motion.div
        key={JSON.stringify(previewCard[0])}
        initial={{ opacity: 0, scale: 0.95, rotateY: 15 }}
        animate={{ opacity: 1, scale: 1, rotateY: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className="bg-white/5 rounded-2xl p-4 border border-white/10"
      >
        <BingoCard card={previewCard} markedPositions={[]} interactive={false} />
      </motion.div>

      {/* Ações */}
      <div className="flex flex-col gap-3">
        <motion.button
          onClick={onSwap}
          whileTap={{ scale: 0.95 }}
          className="btn-secondary py-3.5 rounded-2xl flex items-center justify-center gap-2 text-base"
        >
          <span className="text-lg">🔄</span>
          Trocar Cartela
        </motion.button>

        <motion.button
          onClick={handleConfirm}
          disabled={loading}
          whileTap={{ scale: 0.95 }}
          className="btn-primary py-4 rounded-2xl text-lg"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Confirmando...
            </span>
          ) : (
            '✅ Pronto! Quero essa cartela'
          )}
        </motion.button>
      </div>
    </motion.div>
  )
}

// =============================================
// Fase 3: Aguardando início
// =============================================
function WaitingPhase({ playerName }: { playerName: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center flex-1 gap-6 text-center"
    >
      <motion.div
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className="text-7xl"
      >
        ⏳
      </motion.div>

      <div>
        <h2 className="text-white text-xl font-bold mb-2">
          Você está pronto, <span className="text-yellow-400">{playerName}</span>!
        </h2>
        <p className="text-gray-400 text-sm">Aguardando os outros jogadores...</p>
        <p className="text-gray-500 text-xs mt-2">O host iniciará o jogo em breve</p>
      </div>

      <div className="flex items-center gap-2 bg-emerald-600/20 border border-emerald-500/30 rounded-full px-5 py-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-emerald-400 text-sm font-semibold">Pronto para jogar</span>
      </div>
    </motion.div>
  )
}

// =============================================
// Fase 4: Jogando
// =============================================
interface PlayingPhaseProps {
  player: Player
  session: GameSession
  markedPositions: number[]
  winningPattern?: number[]
  bingoMsg: { ok: boolean; text: string } | null
  newNumberAlert: number | null
  onMark: (idx: number, num: number) => void
  onAlreadyMarked: () => Promise<void>
  onBingo: () => Promise<void>
}

function PlayingPhase({
  player,
  session,
  markedPositions,
  winningPattern,
  bingoMsg,
  newNumberAlert,
  onMark,
  onAlreadyMarked,
  onBingo,
}: PlayingPhaseProps) {
  const [marking, setMarking]   = useState(false)
  const [callBingo, setCallBingo] = useState(false)

  const hasMarked      = player.has_marked
  const currentNumber  = session.current_number
  const drawnNumbers   = session.drawn_numbers
  const noNumberYet    = drawnNumbers.length === 0

  async function handleMark() {
    if (hasMarked || marking) return
    setMarking(true)
    await onAlreadyMarked()
    setMarking(false)
  }

  async function handleBingo() {
    if (callBingo) return
    setCallBingo(true)
    await onBingo()
    setCallBingo(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col gap-4"
      // Espaço para o banner de número
      style={{ paddingTop: newNumberAlert ? 64 : 0, transition: 'padding-top 0.3s' }}
    >
      {/* Número atual */}
      <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center">
        {noNumberYet ? (
          <p className="text-gray-500 text-sm py-1">Aguardando o primeiro número...</p>
        ) : (
          <>
            <p className="text-gray-500 text-xs uppercase tracking-widest mb-1">Número atual</p>
            <motion.p
              key={currentNumber}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
              className="text-6xl font-black text-yellow-400 text-glow-gold leading-none"
            >
              {currentNumber}
            </motion.p>
          </>
        )}
      </div>

      {/* Últimos números sorteados */}
      {drawnNumbers.length > 0 && (
        <div>
          <p className="text-gray-600 text-xs mb-2 uppercase tracking-widest">
            Últimos sorteados ({drawnNumbers.length}/100)
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {[...drawnNumbers].reverse().slice(0, 15).map((n, i) => (
              <div
                key={`${n}-${i}`}
                className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold
                  ${n === currentNumber
                    ? 'bg-yellow-400 text-gray-900'
                    : 'bg-indigo-800/60 text-indigo-200 border border-indigo-600/30'
                  }`}
              >
                {n}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cartela */}
      <div className="bg-white/5 rounded-2xl p-3 border border-white/10">
        <div className="text-center mb-2">
          <p className="text-gray-500 text-xs uppercase tracking-widest">Sua cartela</p>
        </div>
        <BingoCard
          card={player.card!}
          markedPositions={markedPositions}
          drawnNumbers={drawnNumbers}
          currentNumber={currentNumber}
          winningPattern={winningPattern}
          onMark={onMark}
          interactive={true}
        />
      </div>

      {/* Mensagem de bingo (erro ou sucesso) */}
      <AnimatePresence>
        {bingoMsg && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`rounded-xl px-4 py-3 text-sm font-semibold text-center border
              ${bingoMsg.ok
                ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-300'
                : 'bg-red-600/20 border-red-500/30 text-red-300'
              }`}
          >
            {bingoMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Botões de ação */}
      <div className="flex flex-col gap-3 mt-1">
        {/* Já Marquei */}
        <motion.button
          onClick={handleMark}
          disabled={hasMarked || marking || noNumberYet}
          whileTap={!hasMarked && !marking ? { scale: 0.95 } : {}}
          className={`
            py-4 rounded-2xl font-bold text-lg transition-all duration-300
            flex items-center justify-center gap-2
            ${hasMarked
              ? 'bg-emerald-700/40 border border-emerald-600/40 text-emerald-400 cursor-default'
              : noNumberYet
                ? 'bg-white/5 border border-white/10 text-gray-600 cursor-not-allowed'
                : 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 active:scale-95'
            }
          `}
        >
          {marking ? (
            <>
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Enviando...
            </>
          ) : hasMarked ? (
            <>✓ Já Marquei!</>
          ) : (
            <>👆 Já Marquei!</>
          )}
        </motion.button>

        {/* BINGO! */}
        <motion.button
          onClick={handleBingo}
          disabled={callBingo || markedPositions.length === 0}
          whileTap={!callBingo ? { scale: 0.92 } : {}}
          className="btn-bingo w-full disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100"
        >
          {callBingo ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Verificando...
            </span>
          ) : (
            'BINGO! 🎱'
          )}
        </motion.button>
      </div>

      {/* Nome do jogador */}
      <p className="text-center text-gray-600 text-xs mt-2">
        Jogando como <span className="text-gray-400 font-semibold">{player.name}</span>
      </p>
    </motion.div>
  )
}

// =============================================
// Fase 5: Jogo encerrado
// =============================================
interface FinishedPhaseProps {
  isWinner: boolean
  winnerName: string
  onNewGame: () => void
}

function FinishedPhase({ isWinner, winnerName, onNewGame }: FinishedPhaseProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center flex-1 text-center gap-6 py-8"
    >
      <motion.div
        initial={{ scale: 0, rotate: -15 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.1 }}
        className="text-8xl"
      >
        {isWinner ? '🏆' : '🎉'}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        {isWinner ? (
          <>
            <h2 className="text-5xl font-black text-yellow-400 text-glow-gold mb-2 tracking-wider">
              VENCEDOR!
            </h2>
            <p className="text-white text-lg">Parabéns! Você ganhou! 🎊</p>
          </>
        ) : (
          <>
            <h2 className="text-3xl font-black text-white mb-2">Fim de jogo!</h2>
            <p className="text-gray-400 text-lg mb-1">O vencedor foi</p>
            <p className="text-2xl font-black text-yellow-400">{winnerName}</p>
            <p className="text-gray-500 text-sm mt-2">Melhor sorte na próxima! 😄</p>
          </>
        )}
      </motion.div>

      <motion.button
        onClick={onNewGame}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="btn-primary text-base px-8 py-4 rounded-2xl"
      >
        🎮 Jogar Novamente
      </motion.button>
    </motion.div>
  )
}

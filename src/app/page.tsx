'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { motion } from 'framer-motion'

// ── Posições fixas das estrelas (sem Math.random() no servidor) ───────────────
const STARS = [
  { left:'8%',   top:'12%', s:1.8, d:2.1 }, { left:'23%',  top:'5%',  s:1.2, d:3.0 },
  { left:'45%',  top:'9%',  s:2.2, d:1.8 }, { left:'67%',  top:'3%',  s:1.5, d:2.7 },
  { left:'82%',  top:'14%', s:1.0, d:2.3 }, { left:'91%',  top:'8%',  s:1.9, d:1.6 },
  { left:'5%',   top:'35%', s:1.3, d:3.2 }, { left:'18%',  top:'42%', s:2.0, d:1.9 },
  { left:'34%',  top:'28%', s:1.1, d:2.5 }, { left:'53%',  top:'38%', s:1.7, d:2.0 },
  { left:'72%',  top:'31%', s:1.4, d:2.8 }, { left:'88%',  top:'40%', s:2.1, d:1.7 },
  { left:'12%',  top:'65%', s:1.6, d:3.1 }, { left:'29%',  top:'72%', s:1.0, d:2.4 },
  { left:'47%',  top:'58%', s:1.8, d:1.5 }, { left:'61%',  top:'68%', s:2.3, d:2.6 },
  { left:'78%',  top:'62%', s:1.2, d:2.2 }, { left:'95%',  top:'55%', s:1.5, d:1.8 },
  { left:'3%',   top:'88%', s:1.9, d:2.0 }, { left:'38%',  top:'91%', s:1.1, d:3.3 },
  { left:'56%',  top:'85%', s:2.0, d:1.6 }, { left:'74%',  top:'93%', s:1.4, d:2.9 },
  { left:'92%',  top:'81%', s:1.7, d:2.1 }, { left:'15%',  top:'22%', s:1.3, d:2.3 },
  { left:'41%',  top:'17%', s:1.0, d:3.0 }, { left:'69%',  top:'24%', s:2.2, d:1.9 },
]

// ── Definição dos jogos ────────────────────────────────────────────────────────
const GAMES = [
  {
    id: 'bingo',
    emoji: '🎱',
    name: 'BINGO',
    tagline: 'Sorteio ao vivo com globo animado',
    players: '2–8 jogadores',
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
    glow: 'rgba(245,158,11,0.5)',
    available: true,
  },
  {
    id: 'karaoke',
    emoji: '🎤',
    name: 'KARAOKÊ',
    tagline: 'Cante, avalie e mande emojis',
    players: '2–8 jogadores',
    color: '#ec4899',
    gradient: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
    glow: 'rgba(236,72,153,0.5)',
    available: true,
  },
]

const COMING_SOON = [
  { emoji: '🃏', name: 'TRUCO', tagline: 'Jogo de cartas clássico' },
  { emoji: '🔤', name: 'STOP',  tagline: 'Palavras por letra' },
]

// ── Página ─────────────────────────────────────────────────────────────────────
export default function HomePage() {
  const router    = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  async function createRoom(gameId: string) {
    if (loading) return
    setLoading(gameId)
    try {
      const { data, error } = await supabase
        .from('game_sessions')
        .insert({ game_type: gameId, status: 'lobby' })
        .select('id').single()
      if (error) throw error
      router.push(gameId === 'karaoke' ? `/karaoke/host/${data.id}` : `/bingo/host/${data.id}`)
    } catch {
      alert('Erro ao criar sala. Verifique as configurações do Supabase.')
      setLoading(null)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05040f] flex flex-col items-center justify-center px-4 py-12">

      {/* ── Fundo ─────────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Orbe central */}
        <motion.div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full"
          animate={{ scale: [1, 1.08, 1], opacity: [0.3, 0.45, 0.3] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
          style={{ background: 'radial-gradient(ellipse, #4f46e5 0%, #7c3aed 50%, transparent 75%)', filter: 'blur(80px)', top: '-10%' }}
        />
        {/* Orbe inferior esquerdo */}
        <motion.div className="absolute -bottom-32 -left-20 w-[600px] h-[400px] rounded-full"
          animate={{ scale: [1, 1.1, 1], opacity: [0.18, 0.28, 0.18] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
          style={{ background: 'radial-gradient(ellipse, #f59e0b 0%, #ef4444 60%, transparent 75%)', filter: 'blur(90px)' }}
        />
        {/* Orbe inferior direito */}
        <motion.div className="absolute -bottom-24 -right-24 w-[500px] h-[350px] rounded-full"
          animate={{ scale: [1, 1.12, 1], opacity: [0.15, 0.22, 0.15] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
          style={{ background: 'radial-gradient(ellipse, #ec4899 0%, #8b5cf6 60%, transparent 75%)', filter: 'blur(90px)' }}
        />
        {/* Grade sutil */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)', backgroundSize: '60px 60px' }}
        />
      </div>

      {/* ── Estrelas (posições fixas) ──────────────────────────── */}
      {mounted && STARS.map((s, i) => (
        <motion.div key={i} className="fixed rounded-full bg-white pointer-events-none"
          style={{ left: s.left, top: s.top, width: s.s, height: s.s }}
          animate={{ opacity: [0.1, 0.85, 0.1] }}
          transition={{ duration: s.d, delay: i * 0.15, repeat: Infinity }}
        />
      ))}

      {/* ── Conteúdo ───────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-3xl">

        {/* Header */}
        <motion.div className="text-center mb-14"
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          <motion.div className="text-7xl mb-5 inline-block"
            animate={{ rotate: [0, -8, 8, -8, 0], scale: [1, 1.06, 1] }}
            transition={{ duration: 3, repeat: Infinity, repeatDelay: 3 }}
          >
            🎮
          </motion.div>

          <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-none mb-4">
            <span className="text-white">Jogos em </span>
            <span style={{ background: 'linear-gradient(90deg,#f59e0b,#ec4899,#8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Família
            </span>
          </h1>

          <p className="text-indigo-300/70 text-lg max-w-sm mx-auto leading-relaxed">
            Escolha um jogo, compartilhe o QR Code e divirta-se juntos!
          </p>
        </motion.div>

        {/* Cards dos jogos disponíveis */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
          {GAMES.map((g, i) => (
            <motion.button key={g.id}
              onClick={() => createRoom(g.id)}
              disabled={!!loading}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.12 + 0.3 }}
              whileHover={{ y: -6, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="relative rounded-3xl overflow-hidden text-left cursor-pointer"
              style={{ boxShadow: `0 0 0 1px rgba(255,255,255,0.08), 0 20px 50px ${g.glow}` }}
            >
              {/* Fundo gradiente */}
              <div className="absolute inset-0" style={{ background: g.gradient, opacity: 0.9 }} />

              {/* Brilho superior */}
              <div className="absolute top-0 inset-x-0 h-1/2 pointer-events-none"
                style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.18), transparent)' }} />

              {/* Conteúdo */}
              <div className="relative p-8 flex flex-col gap-4">
                <motion.div className="text-6xl leading-none"
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.6 }}
                >
                  {g.emoji}
                </motion.div>

                <div>
                  <h2 className="text-4xl font-black text-white tracking-widest leading-none mb-1 drop-shadow">
                    {g.name}
                  </h2>
                  <p className="text-white/75 text-sm font-medium">{g.tagline}</p>
                </div>

                <div className="flex items-center justify-between mt-1">
                  <span className="text-white/60 text-xs flex items-center gap-1">
                    <span>👥</span> {g.players}
                  </span>

                  <div className="flex items-center gap-2 bg-black/25 backdrop-blur-sm rounded-xl px-4 py-2 text-white font-bold text-sm">
                    {loading === g.id ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Criando...
                      </>
                    ) : (
                      <>Criar Sala <span>→</span></>
                    )}
                  </div>
                </div>
              </div>
            </motion.button>
          ))}
        </div>

        {/* Em breve */}
        <motion.div className="grid grid-cols-2 gap-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
          {COMING_SOON.map(g => (
            <div key={g.name}
              className="rounded-2xl p-5 flex items-center gap-4 opacity-40 cursor-not-allowed"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.12)' }}>
              <span className="text-3xl">{g.emoji}</span>
              <div>
                <p className="text-white font-black text-lg leading-none tracking-widest">{g.name}</p>
                <p className="text-gray-500 text-xs mt-0.5">{g.tagline}</p>
                <p className="text-gray-600 text-xs mt-1">Em breve...</p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Rodapé */}
        <motion.p className="text-center text-indigo-400/30 text-xs mt-10"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
          💻 Abra no computador/TV · 📱 Jogadores entram pelo celular
        </motion.p>
      </div>
    </div>
  )
}

'use client'

import { motion, AnimatePresence } from 'framer-motion'

interface BingoGlobeProps {
  currentNumber: number | null
  spinning: boolean
}

export function BingoGlobe({ currentNumber, spinning }: BingoGlobeProps) {
  return (
    <div className="relative flex flex-col items-center select-none">
      {/* Halo de brilho externo */}
      <motion.div
        className="absolute w-72 h-72 rounded-full pointer-events-none"
        animate={{
          opacity: spinning ? [0.4, 1, 0.4] : [0.2, 0.5, 0.2],
          scale: spinning ? [1, 1.15, 1] : [1, 1.05, 1],
        }}
        transition={{ duration: spinning ? 0.5 : 2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          background: 'radial-gradient(circle, rgba(245,158,11,0.45) 0%, transparent 70%)',
          filter: 'blur(24px)',
        }}
      />

      {/* Bola principal */}
      <motion.div
        className="relative w-56 h-56 md:w-64 md:h-64"
        animate={spinning
          ? { rotate: 360 }
          : { y: [0, -10, 0] }
        }
        transition={spinning
          ? { duration: 0.45, repeat: Infinity, ease: 'linear' }
          : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }
        }
      >
        {/* Corpo da bola */}
        <div
          className="w-full h-full rounded-full overflow-hidden"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #fde68a, #f59e0b 40%, #d97706 70%, #92400e)',
            boxShadow: spinning
              ? '0 0 70px rgba(245,158,11,0.9), 0 0 140px rgba(245,158,11,0.4), 0 20px 60px rgba(0,0,0,0.6)'
              : '0 0 30px rgba(245,158,11,0.5), 0 20px 60px rgba(0,0,0,0.6)',
            transition: 'box-shadow 0.4s',
          }}
        >
          {/* Brilho superior */}
          <div
            className="absolute top-6 left-10 w-20 h-12 rounded-full opacity-50 pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.9), transparent)' }}
          />

          {/* Listras de rotação */}
          {spinning && (
            <div className="absolute inset-0 overflow-hidden rounded-full pointer-events-none">
              <div className="globe-stripe absolute inset-y-0 w-10 bg-white/15 blur-sm" style={{ left: '20%' }} />
              <div className="globe-stripe absolute inset-y-0 w-7 bg-white/10 blur-sm" style={{ left: '55%', animationDelay: '0.25s' }} />
              <div className="globe-stripe absolute inset-y-0 w-5 bg-white/08 blur-sm" style={{ left: '75%', animationDelay: '0.5s' }} />
            </div>
          )}

          {/* Conteúdo central */}
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatePresence mode="wait">
              {spinning ? (
                <motion.span
                  key="question"
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: [0.5, 1, 0.5], scale: [0.9, 1.1, 0.9] }}
                  exit={{ opacity: 0, scale: 0 }}
                  transition={{ duration: 0.4, repeat: Infinity }}
                  className="text-7xl font-black text-white/80 select-none"
                  style={{ textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}
                >
                  ?
                </motion.span>
              ) : currentNumber !== null ? (
                <motion.span
                  key={currentNumber}
                  initial={{ scale: 0, opacity: 0, rotate: -20 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 14 }}
                  className="text-7xl font-black text-white select-none leading-none"
                  style={{ textShadow: '0 3px 12px rgba(0,0,0,0.7)' }}
                >
                  {currentNumber}
                </motion.span>
              ) : (
                <motion.span
                  key="idle"
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="text-5xl select-none"
                >
                  🎱
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* Label do número atual */}
      <AnimatePresence>
        {!spinning && currentNumber !== null && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ delay: 0.3 }}
            className="mt-5 text-center"
          >
            <p className="text-yellow-400/70 text-sm uppercase tracking-widest font-semibold">
              Número sorteado
            </p>
            <p className="text-4xl font-black text-yellow-300 text-glow-gold">
              {currentNumber}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Label idle */}
      <AnimatePresence>
        {!spinning && currentNumber === null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-5 text-center"
          >
            <p className="text-gray-500 text-sm">Pronto para sortear!</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { isFreeSpace } from '@/lib/bingo-utils'
import type { BingoCard as BingoCardType } from '@/lib/types'

interface BingoCardProps {
  card: BingoCardType
  markedPositions: number[]
  drawnNumbers?: number[]
  currentNumber?: number | null
  winningPattern?: number[]
  onMark?: (idx: number, num: number) => void
  interactive?: boolean
}

const COL_HEADERS = ['B', 'I', 'N', 'G', 'O']

export function BingoCard({
  card,
  markedPositions,
  drawnNumbers = [],
  currentNumber = null,
  winningPattern,
  onMark,
  interactive = false,
}: BingoCardProps) {
  const marked = new Set(markedPositions)
  const drawn = new Set(drawnNumbers)
  const winning = new Set(winningPattern ?? [])

  return (
    <div className="select-none w-full">
      {/* Cabeçalho B I N G O */}
      <div className="grid grid-cols-5 gap-1.5 mb-1.5">
        {COL_HEADERS.map(h => (
          <div key={h} className="aspect-square flex items-center justify-center text-xl font-black text-yellow-400 drop-shadow">
            {h}
          </div>
        ))}
      </div>

      {/* Células 5x5 */}
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: 25 }, (_, idx) => {
          const row = Math.floor(idx / 5)
          const col = idx % 5
          const num = card[row][col]

          const isFree     = isFreeSpace(idx)
          const isMarked   = marked.has(idx) || isFree
          const isDrawn    = drawn.has(num)
          const isCurrent  = num === currentNumber && !isFree
          const isWinning  = winning.has(idx) || (isFree && winning.size > 0)
          const canInteract = interactive && !isFree && isDrawn

          // ---- estilos da célula ----
          let cellClass = 'aspect-square rounded-xl flex items-center justify-center font-bold text-sm transition-all duration-200 relative overflow-hidden '

          if (isWinning) {
            cellClass += 'bg-yellow-400 text-gray-900 shadow-lg shadow-yellow-400/60 scale-105 z-10 '
          } else if (isFree) {
            cellClass += 'bg-gradient-to-br from-yellow-400 to-orange-500 text-gray-900 cursor-default '
          } else if (isMarked) {
            cellClass += 'bg-emerald-600 text-white '
          } else if (isCurrent) {
            cellClass += 'bg-yellow-400/15 text-yellow-300 border-2 border-yellow-400 '
          } else if (isDrawn) {
            cellClass += 'bg-indigo-900/60 text-indigo-200 border border-indigo-500/30 '
          } else {
            cellClass += 'bg-white/5 text-gray-400 border border-white/8 '
          }

          if (canInteract)  cellClass += 'cursor-pointer active:scale-90 hover:brightness-125 '
          if (interactive && !isFree && !isDrawn) cellClass += 'cursor-not-allowed '

          return (
            <motion.button
              key={idx}
              type="button"
              onClick={() => canInteract && onMark?.(idx, num)}
              disabled={!canInteract || isFree}
              whileTap={canInteract ? { scale: 0.85 } : {}}
              className={cellClass}
            >
              {/* Brilho para célula vencedora */}
              {isWinning && (
                <div className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent pointer-events-none" />
              )}

              {/* Pulsação no número atual */}
              {isCurrent && !isMarked && (
                <motion.div
                  className="absolute inset-0 rounded-xl border-2 border-yellow-400 pointer-events-none"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 0.7, repeat: Infinity }}
                />
              )}

              {/* Conteúdo da célula */}
              <AnimatePresence mode="wait" initial={false}>
                {isFree ? (
                  <motion.span key="free" className="text-lg leading-none">⭐</motion.span>
                ) : isMarked ? (
                  <motion.span
                    key="marked"
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                    className="text-lg leading-none"
                  >
                    ✓
                  </motion.span>
                ) : (
                  <span key="num">{num}</span>
                )}
              </AnimatePresence>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

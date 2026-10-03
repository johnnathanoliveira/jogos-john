import type { BingoCard, BingoWinResult } from './types'

// =============================================
// Geração de cartelas
// =============================================

/**
 * Gera uma cartela de bingo 5x5 com números aleatórios de 1 a 80.
 * A posição central [2][2] (índice 12) é o espaço FREE (valor 0).
 */
export function generateBingoCard(): BingoCard {
  const numbers = new Set<number>()
  while (numbers.size < 24) {
    numbers.add(Math.floor(Math.random() * 80) + 1)  // 1–80
  }
  const nums = Array.from(numbers)

  const card: BingoCard = []
  let idx = 0
  for (let row = 0; row < 5; row++) {
    const rowArr: number[] = []
    for (let col = 0; col < 5; col++) {
      if (row === 2 && col === 2) {
        rowArr.push(0) // FREE
      } else {
        rowArr.push(nums[idx++])
      }
    }
    card.push(rowArr)
  }
  return card
}

/**
 * Gera N cartelas únicas para o jogador escolher.
 */
export function generateCardOptions(count = 3): BingoCard[] {
  return Array.from({ length: count }, () => generateBingoCard())
}

// =============================================
// Utilitários de índice
// =============================================

/** Converte (row, col) para índice plano 0-24 */
export function flatIndex(row: number, col: number): number {
  return row * 5 + col
}

/** Converte índice plano 0-24 para (row, col) */
export function toRowCol(idx: number): [number, number] {
  return [Math.floor(idx / 5), idx % 5]
}

/** Retorna true se o índice é o espaço FREE (centro) */
export function isFreeSpace(idx: number): boolean {
  return idx === 12
}

// =============================================
// Lógica de vitória
// =============================================

/**
 * Todos os padrões vencedores possíveis:
 * 5 linhas + 5 colunas + 2 diagonais = 12 padrões
 */
export const WIN_PATTERNS: number[][] = [
  // Linhas
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
  // Colunas
  [0, 5, 10, 15, 20],
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],
  // Diagonais
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
]

/**
 * Verifica se o jogador completou alguma linha/coluna/diagonal.
 * O espaço FREE (índice 12) é sempre considerado marcado.
 */
export function checkBingo(markedPositions: number[]): BingoWinResult {
  const marked = new Set(markedPositions)
  marked.add(12) // FREE sempre marcado

  for (const pattern of WIN_PATTERNS) {
    if (pattern.every(idx => marked.has(idx))) {
      return { won: true, pattern }
    }
  }
  return { won: false }
}

/**
 * Valida se todas as posições marcadas pelo jogador têm
 * números que foram realmente sorteados. Impede marcações inválidas.
 */
export function validateMarking(
  card: BingoCard,
  markedPositions: number[],
  drawnNumbers: number[]
): boolean {
  const drawn = new Set(drawnNumbers)

  for (const pos of markedPositions) {
    if (isFreeSpace(pos)) continue // FREE sempre válido
    const [row, col] = toRowCol(pos)
    const num = card[row][col]
    if (!drawn.has(num)) return false // Marcou algo que não foi sorteado!
  }
  return true
}

// =============================================
// Sorteio de números
// =============================================

/**
 * Sorteia um número aleatório de 1-80 que ainda não foi sorteado.
 * Retorna null se todos os números já foram sorteados.
 */
export function drawNumber(drawnNumbers: number[]): number | null {
  const available: number[] = []
  for (let i = 1; i <= 80; i++) {  // 1–80
    if (!drawnNumbers.includes(i)) available.push(i)
  }
  if (available.length === 0) return null
  return available[Math.floor(Math.random() * available.length)]
}

/**
 * Verifica se um número está na cartela e retorna o índice plano,
 * ou -1 caso não esteja.
 */
export function findNumberInCard(card: BingoCard, num: number): number {
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if (card[row][col] === num) return flatIndex(row, col)
    }
  }
  return -1
}

/**
 * Retorna todos os índices planos de números da cartela
 * que já foram sorteados (auxilia no highlight automático).
 */
export function getDrawnIndicesInCard(card: BingoCard, drawnNumbers: number[]): number[] {
  const drawn = new Set(drawnNumbers)
  const indices: number[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if (card[row][col] !== 0 && drawn.has(card[row][col])) {
        indices.push(flatIndex(row, col))
      }
    }
  }
  return indices
}

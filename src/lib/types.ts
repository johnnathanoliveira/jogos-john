// =============================================
// Tipos centrais da aplicação
// =============================================

export type GameType = 'bingo'

export type SessionStatus = 'lobby' | 'playing' | 'finished'

export interface GameSession {
  id: string
  game_type: GameType
  status: SessionStatus
  current_number: number | null
  drawn_numbers: number[]
  all_marked: boolean
  winner_id: string | null
  winner_name: string | null
  created_at: string
  updated_at: string
}

/** Cartela 5x5 de bingo. Valor 0 = espaço FREE (posição central [2][2]) */
export type BingoCard = number[][]

export interface Player {
  id: string
  session_id: string
  name: string
  is_ready: boolean
  has_marked: boolean
  card: BingoCard | null
  marked_positions: number[]
  created_at: string
}

export interface BingoWinResult {
  won: boolean
  pattern?: number[] // índices planos 0-24 que formam a linha vencedora
}

/** Mapa de cores por índice do jogador (até 8 jogadores) */
export const PLAYER_COLORS = [
  { bg: 'bg-blue-500',   text: 'text-blue-400',   border: 'border-blue-500',   hex: '#3b82f6' },
  { bg: 'bg-purple-500', text: 'text-purple-400',  border: 'border-purple-500', hex: '#a855f7' },
  { bg: 'bg-pink-500',   text: 'text-pink-400',    border: 'border-pink-500',   hex: '#ec4899' },
  { bg: 'bg-emerald-500',text: 'text-emerald-400', border: 'border-emerald-500',hex: '#10b981' },
  { bg: 'bg-orange-500', text: 'text-orange-400',  border: 'border-orange-500', hex: '#f97316' },
  { bg: 'bg-cyan-500',   text: 'text-cyan-400',    border: 'border-cyan-500',   hex: '#06b6d4' },
  { bg: 'bg-rose-500',   text: 'text-rose-400',    border: 'border-rose-500',   hex: '#f43f5e' },
  { bg: 'bg-lime-500',   text: 'text-lime-400',    border: 'border-lime-500',   hex: '#84cc16' },
]

// =============================================
// Tipos do Karaokê
// =============================================

export interface KaraokeSong {
  id: string
  session_id: string
  player_id: string
  player_name: string
  youtube_id: string
  song_title: string
  artist: string
  thumbnail: string
  lyrics: string | null
  spotify_track_id: string | null   // ID do track no Spotify (para buscar letras sincronizadas)
  status: 'queued' | 'singing' | 'done'
  order_index: number
  created_at: string
}

export interface KaraokeRating {
  id: string
  song_id: string
  session_id: string
  player_id: string
  rating: number
  created_at: string
}

export interface YouTubeResult {
  videoId: string
  title: string
  channelTitle: string
  thumbnail: string
}

/** Track retornado pela busca do Spotify */
export interface SpotifyTrack {
  id:         string
  name:       string        // título da música
  artist:     string        // artista principal
  artists:    string[]      // todos os artistas
  album:      string        // nome do álbum
  imageUrl:   string        // capa do álbum
  durationMs: number        // duração em ms
  previewUrl: string | null // preview de 30s (pode ser null)
}

/** Formata duração em ms para "m:ss" */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Emojis disponíveis para reação durante o karaokê */
export const KARAOKE_EMOJIS = ['🔥','❤️','🎉','👏','😍','🎤','⭐','💃','🕺','🥳','😂','🫶','🏆','💯','🎸']

/** Avalia média de rating de uma lista de ratings */
export function avgRating(ratings: KaraokeRating[], songId: string): number {
  const r = ratings.filter(x => x.song_id === songId)
  if (r.length === 0) return 0
  return r.reduce((s, x) => s + x.rating, 0) / r.length
}

/** Extrai o video ID de uma URL do YouTube */
export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\n?#]+)/,
    /(?:youtu\.be\/)([^&\n?#]+)/,
    /(?:youtube\.com\/embed\/)([^&\n?#]+)/,
    /(?:youtube\.com\/shorts\/)([^&\n?#]+)/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

/** Tenta separar artista e título de um nome de vídeo YouTube ("Artista - Música") */
export function parseYouTubeTitle(title: string): { artist: string; songTitle: string } {
  // 1. Decodifica HTML entities (YouTube API retorna &amp;, &quot;, etc.)
  let t = title
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')

  // 2. Remove emojis e símbolos decorativos
  t = t.replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, '').trim()

  // 3. "Canal | Conteúdo — Título" → pega só após "|"
  const pipe = t.match(/^[^|]+\|\s*(.+)$/)
  if (pipe) t = pipe[1].trim()

  // 4. Separa "Artista - Música" ou "Música — Artista"
  const dash = t.match(/^(.+?)\s*[-–—]\s*(.+)$/)
  if (dash) {
    const artist = dash[1].trim()
    const song = dash[2]
      .replace(/\s*[\(\[][^)\]]*(?:official|video|audio|lyric|letra|ft\.|feat\.|karaoke|karaokê|instrumental|playback|remastered|\d{4})[^)\]]*[\)\]]/gi, '')
      .replace(/\s*[\(\[][^)\]]*[\)\]]/g, '')
      .trim()
    return { artist, songTitle: song || dash[2].trim() }
  }
  return { artist: '', songTitle: t }
}

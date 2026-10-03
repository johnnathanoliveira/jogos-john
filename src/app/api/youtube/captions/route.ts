import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/youtube/captions?videoId=<id>
 *
 * Busca as legendas (timedtext) do YouTube para um vídeo específico.
 * Tenta múltiplos idiomas (pt-BR, pt, en) e converte para formato LRC.
 *
 * Usa o endpoint público não-oficial do YouTube que retorna legendas
 * com timestamps sincronizados com o VÍDEO (não com a gravação Spotify).
 * Isso garante sincronismo automático perfeito.
 */

const LANGS = ['pt-BR', 'pt', 'en', 'es', 'pt_BR']

function msToLrc(ms: number): string {
  const s  = ms / 1000
  const m  = Math.floor(s / 60)
  const se = s % 60
  const cs = Math.round((se - Math.floor(se)) * 100)
  return `[${String(m).padStart(2,'0')}:${String(Math.floor(se)).padStart(2,'0')}.${String(cs).padStart(2,'0')}]`
}

async function tryFetchCaptions(videoId: string, lang: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3&xorb=2&xobt=3&xovt=3`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        Referer: 'https://www.youtube.com/',
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) return null

    const data = await res.json()
    const events = data?.events

    if (!Array.isArray(events) || events.length === 0) return null

    // Converte eventos para LRC
    const lines: string[] = []
    for (const ev of events) {
      if (!ev.segs || ev.tStartMs == null) continue
      const text = ev.segs
        .map((s: { utf8?: string }) => s.utf8 ?? '')
        .join('')
        .replace(/\n/g, ' ')
        .trim()
      if (!text || text === ' ') continue
      lines.push(`${msToLrc(ev.tStartMs)}${text}`)
    }

    if (lines.length < 3) return null // Muito poucas linhas, provavelmente inválido
    return lines.join('\n')
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get('videoId')?.trim()
  if (!videoId) {
    return NextResponse.json({ lyrics: null, error: 'videoId obrigatório' }, { status: 400 })
  }

  // Tenta cada idioma em sequência
  for (const lang of LANGS) {
    const lrc = await tryFetchCaptions(videoId, lang)
    if (lrc) {
      return NextResponse.json({ lyrics: lrc, source: 'youtube-captions', lang })
    }
  }

  return NextResponse.json({ lyrics: null, error: 'Legendas não disponíveis para este vídeo.' })
}

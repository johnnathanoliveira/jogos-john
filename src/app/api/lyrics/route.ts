import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/lyrics?artist=<artist>&title=<title>
 * Usa lrclib.net — retorna LRC sincronizado quando disponível.
 * Tenta múltiplas estratégias antes de desistir.
 */

function cleanArtist(s: string): string {
  return s
    .replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '')
    .replace(/\s*official$/i, '').replace(/\s*music$/i, '')
    .replace(/\s+(playback|karaoke|karaokê|backing\s*track)$/gi, '')
    .trim()
}

function cleanTitle(s: string): string {
  return s
    .replace(/\s*[\(\[][^)\]]*(official|video|audio|lyric|letra|live|remix|remastered|karaoke|karaokê|instrumental|playback|ao\s+vivo|\d{4})[^)\]]*[\)\]]/gi, '')
    .replace(/\s*[\(\[][^)\]]*[\)\]]/g, '')
    .replace(/\s+-\s+playback\s*$/gi, '')  // "Música - Playback" → "Música"
    .replace(/\s+playback\s*$/gi, '')
    .trim()
}

interface LrcResult { lyrics: string; synced: boolean }

async function getExact(artist: string, track: string): Promise<LrcResult | null> {
  if (!artist || !track) return null
  try {
    const url = new URL('https://lrclib.net/api/get')
    url.searchParams.set('artist_name', artist)
    url.searchParams.set('track_name', track)
    const res = await fetch(url.toString(), {
      next: { revalidate: 3600 },
      headers: { 'User-Agent': 'JogosEmFamilia/1.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const d = await res.json()
    if (d.instrumental) return null
    if (d.syncedLyrics?.trim().length > 10) return { lyrics: d.syncedLyrics, synced: true }
    if (d.plainLyrics?.trim().length > 10)  return { lyrics: d.plainLyrics.replace(/\n{3,}/g, '\n\n').trim(), synced: false }
  } catch {}
  return null
}

async function search(q: string, trackName?: string, artistName?: string): Promise<LrcResult | null> {
  try {
    const url = new URL('https://lrclib.net/api/search')
    if (q)          url.searchParams.set('q', q)
    if (trackName)  url.searchParams.set('track_name', trackName)
    if (artistName) url.searchParams.set('artist_name', artistName)
    const res = await fetch(url.toString(), {
      next: { revalidate: 3600 },
      headers: { 'User-Agent': 'JogosEmFamilia/1.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const items = await res.json()
    if (!Array.isArray(items)) return null
    for (const d of items.slice(0, 5)) {
      if (d.instrumental) continue
      if (d.syncedLyrics?.trim().length > 10) return { lyrics: d.syncedLyrics, synced: true }
      if (d.plainLyrics?.trim().length > 10)  return { lyrics: d.plainLyrics.replace(/\n{3,}/g, '\n\n').trim(), synced: false }
    }
  } catch {}
  return null
}

export async function GET(request: NextRequest) {
  const rawArtist = request.nextUrl.searchParams.get('artist')?.trim() ?? ''
  const rawTitle  = request.nextUrl.searchParams.get('title')?.trim()  ?? ''

  if (!rawTitle) return NextResponse.json({ lyrics: null, synced: false }, { status: 400 })

  const artist = cleanArtist(rawArtist)
  const title  = cleanTitle(rawTitle)

  // ── Estratégia 1: match exato (artista limpo + título limpo) ─
  let r = await getExact(artist, title)
  if (r) return NextResponse.json(r)

  // ── Estratégia 2: invertido (título como artista, artista como título) ─
  if (artist && title && artist !== title) {
    r = await getExact(title, artist)
    if (r) return NextResponse.json(r)
  }

  // ── Estratégia 3: artista limpo + título bruto ────────────────
  if (rawTitle !== title) {
    r = await getExact(artist, rawTitle.replace(/\s+-\s+playback\s*$/gi, '').trim())
    if (r) return NextResponse.json(r)
  }

  // ── Estratégia 4: busca por nome da faixa (sem artista) ──────
  r = await search('', title)
  if (r) return NextResponse.json(r)

  // ── Estratégia 5: busca geral "artista + título" ─────────────
  if (artist) {
    r = await search(`${artist} ${title}`)
    if (r) return NextResponse.json(r)
  }

  // ── Estratégia 6: só o título original sem limpeza extra ──────
  if (rawTitle !== title) {
    r = await search('', rawTitle.split('-')[0].trim())
    if (r) return NextResponse.json(r)
  }

  // ── Estratégia 7: primeiras palavras do título (pode ajudar com psalms etc.) ─
  const titleWords = title.split(/\s+/).slice(0, 3).join(' ')
  if (titleWords.length > 3 && titleWords !== title) {
    r = await search('', titleWords, artist)
    if (r) return NextResponse.json(r)
  }

  return NextResponse.json({ lyrics: null, synced: false, error: 'Letra não encontrada.' })
}

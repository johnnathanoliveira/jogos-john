import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/spotify/lyrics?trackId=<spotifyTrackId>
 *
 * Busca letras sincronizadas no endpoint interno do Spotify
 * (mesma fonte usada pelo app oficial — powered by Musixmatch).
 *
 * Requer que o host tenha autenticado via /api/spotify/auth.
 * Retorna as letras no formato LRC ([mm:ss.cs]linha) para
 * compatibilidade com o componente SyncedLyrics da tela do host.
 *
 * Trata automaticamente tokens expirados com o refresh_token.
 */

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

// ── Converte milissegundos para timestamp LRC "[mm:ss.cs]" ─
function msToLrc(ms: number): string {
  const totalSec  = ms / 1000
  const min       = Math.floor(totalSec / 60)
  const sec       = totalSec % 60
  const centisec  = Math.round((sec - Math.floor(sec)) * 100)
  return `[${String(min).padStart(2,'0')}:${String(Math.floor(sec)).padStart(2,'0')}.${String(centisec).padStart(2,'0')}]`
}

// ── Renova o access token usando o refresh token ──────────
async function doRefresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number } | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) return null
  try {
    const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    })
    if (!res.ok) return null
    const { access_token, expires_in } = await res.json()
    return { accessToken: access_token, expiresIn: expires_in }
  } catch { return null }
}

// ── Busca letras no endpoint interno do Spotify ───────────
async function fetchSpotifyLyrics(trackId: string, accessToken: string) {
  const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`
  const res = await fetch(url, {
    headers: {
      Authorization:          `Bearer ${accessToken}`,
      'app-platform':         'WebPlayer',
      'spotify-app-version':  '1.2.46.575.gbcfe2b15',
    },
    next: { revalidate: 3600 },
  })
  return res
}

// ── Handler principal ─────────────────────────────────────
export async function GET(request: NextRequest) {
  const trackId = request.nextUrl.searchParams.get('trackId')?.trim()
  if (!trackId) {
    return NextResponse.json({ error: 'trackId obrigatório' }, { status: 400 })
  }

  let accessToken = request.cookies.get('spotify_access_token')?.value

  // Tenta renovar se não tiver access_token
  let refreshedToken: string | null = null
  let newExpiresIn = 3540
  if (!accessToken) {
    const refreshToken = request.cookies.get('spotify_refresh_token')?.value
    if (!refreshToken) {
      return NextResponse.json({ error: 'not_connected', connected: false })
    }
    const refreshed = await doRefresh(refreshToken)
    if (!refreshed) {
      return NextResponse.json({ error: 'token_expired', connected: false })
    }
    accessToken     = refreshed.accessToken
    refreshedToken  = refreshed.accessToken
    newExpiresIn    = refreshed.expiresIn - 60
  }

  // Busca letras
  let res = await fetchSpotifyLyrics(trackId, accessToken)

  // Token expirado durante a requisição — tenta renovar e repetir
  if (res.status === 401) {
    const refreshToken = request.cookies.get('spotify_refresh_token')?.value
    if (refreshToken) {
      const refreshed = await doRefresh(refreshToken)
      if (refreshed) {
        accessToken    = refreshed.accessToken
        refreshedToken = refreshed.accessToken
        newExpiresIn   = refreshed.expiresIn - 60
        res = await fetchSpotifyLyrics(trackId, accessToken)
      }
    }
    if (res.status === 401) {
      return NextResponse.json({ error: 'token_invalid', connected: false })
    }
  }

  // Sem letra para esta faixa
  if (res.status === 404) {
    return NextResponse.json({ error: 'no_lyrics', connected: true, lyrics: null })
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('Spotify lyrics error', res.status, body)
    return NextResponse.json({ error: 'spotify_error', connected: true, lyrics: null })
  }

  const data = await res.json()
  const spotifyLyrics = data?.lyrics

  if (!spotifyLyrics?.lines?.length) {
    return NextResponse.json({ error: 'empty_lyrics', connected: true, lyrics: null })
  }

  // Converte para formato LRC
  const lrcLines = (spotifyLyrics.lines as Array<{ startTimeMs: string; words: string }>)
    .filter(l => l.words && l.words.trim() !== '♪' && l.words.trim() !== '')
    .map(l => `${msToLrc(parseInt(l.startTimeMs, 10))}${l.words}`)
    .join('\n')

  if (!lrcLines.trim()) {
    return NextResponse.json({ error: 'empty_lines', connected: true, lyrics: null })
  }

  const synced = spotifyLyrics.syncType === 'LINE_SYNCED'
  const response = NextResponse.json({ connected: true, lyrics: lrcLines, synced })

  // Atualiza cookies se o token foi renovado
  if (refreshedToken) {
    const isProduction = process.env.NODE_ENV === 'production'
    response.cookies.set('spotify_access_token', refreshedToken, {
      httpOnly: true, maxAge: newExpiresIn, path: '/', sameSite: 'lax', secure: isProduction,
    })
    response.cookies.set('spotify_connected', '1', {
      httpOnly: false, maxAge: newExpiresIn, path: '/', sameSite: 'lax',
    })
  }

  return response
}

import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/spotify/search?q=<query>
 *
 * Busca músicas no Spotify usando Client Credentials Flow.
 * Nenhum login do usuário necessário — só client_id + client_secret.
 * Token é cacheado em memória e renovado automaticamente.
 */

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

// ── Cache do token (em memória, dura até expirar) ──────────
let tokenCache: { token: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token
  }

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Spotify auth: ${res.status} — ${body}`)
  }

  const data = await res.json()
  tokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // expira 1 min antes
  }
  return tokenCache.token
}

// ── Handler ────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()

  if (!q) {
    return NextResponse.json({ error: 'Parâmetro "q" obrigatório.' }, { status: 400 })
  }

  // Credenciais não configuradas
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.json(
      { noCredentials: true, error: 'SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET não configurados.' },
      { status: 200 }
    )
  }

  try {
    const token = await getToken()

    const url = new URL('https://api.spotify.com/v1/search')
    url.searchParams.set('q', q)
    url.searchParams.set('type', 'track')
    url.searchParams.set('limit', '8')
    url.searchParams.set('market', 'BR') // Prioriza conteúdo disponível no Brasil

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 300 },
    })

    if (!res.ok) {
      if (res.status === 401) {
        // Token expirou inesperadamente — limpa e tenta de novo na próxima chamada
        tokenCache = null
      }
      const body = await res.text()
      throw new Error(`Spotify search: ${res.status} — ${body}`)
    }

    const data = await res.json()

    const tracks = (data.tracks?.items ?? []).map((item: {
      id: string
      name: string
      artists: Array<{ name: string }>
      album: { name: string; images: Array<{ url: string }> }
      duration_ms: number
      preview_url: string | null
    }) => ({
      id:         item.id,
      name:       item.name,
      artist:     item.artists[0]?.name ?? '',
      artists:    item.artists.map(a => a.name),
      album:      item.album.name,
      imageUrl:   item.album.images[0]?.url ?? '',
      durationMs: item.duration_ms,
      previewUrl: item.preview_url,
    }))

    return NextResponse.json({ tracks })
  } catch (err) {
    console.error('Spotify search error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

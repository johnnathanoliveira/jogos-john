import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/spotify/auth?return=<url>
 *
 * Inicia o OAuth Authorization Code Flow do Spotify.
 * O parâmetro "return" é a URL para onde o usuário volta após autenticar.
 */

const CLIENT_ID    = process.env.SPOTIFY_CLIENT_ID
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI ?? 'http://localhost:3000/api/spotify/callback'

export async function GET(request: NextRequest) {
  if (!CLIENT_ID) {
    return NextResponse.json({ error: 'SPOTIFY_CLIENT_ID não configurado.' }, { status: 500 })
  }

  // Passa a URL de retorno no state (codificada em base64)
  const returnUrl = request.nextUrl.searchParams.get('return') ?? '/'
  const state     = Buffer.from(returnUrl).toString('base64')

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    response_type: 'code',
    redirect_uri:  REDIRECT_URI,
    state,
    // Escopos necessários para o Web Playback SDK
    scope: [
      'streaming',                   // ← obrigatório para Web Playback SDK
      'user-read-email',
      'user-read-private',
      'user-modify-playback-state',  // controlar play/pause/seek
      'user-read-playback-state',    // ler estado atual
    ].join(' '),
  })

  return NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  )
}

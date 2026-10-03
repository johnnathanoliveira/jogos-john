import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/spotify/callback?code=<code>&state=<state>
 *
 * Callback do OAuth. Troca o código pelo access_token,
 * armazena nos cookies e redireciona de volta para a página do host.
 */

const CLIENT_ID    = process.env.SPOTIFY_CLIENT_ID!
const CLIENT_SECRET= process.env.SPOTIFY_CLIENT_SECRET!
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI ?? 'http://localhost:3000/api/spotify/callback'

export async function GET(request: NextRequest) {
  const code  = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state') ?? ''
  const error = request.nextUrl.searchParams.get('error')

  // Decodifica a URL de retorno do state
  let returnUrl = '/'
  try { returnUrl = Buffer.from(state, 'base64').toString('utf-8') } catch {}

  // Usuário negou o acesso
  if (error || !code) {
    return NextResponse.redirect(new URL(`${returnUrl}?spotify_error=denied`))
  }

  // Troca o código pelo token
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    console.error('Spotify token exchange failed:', err)
    return NextResponse.redirect(new URL(`${returnUrl}?spotify_error=token`))
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json()

  // Armazena tokens em cookies e redireciona de volta
  const response = NextResponse.redirect(new URL(`${returnUrl}?spotify_connected=1`))

  // access_token: visível ao servidor (httpOnly) + curta duração
  response.cookies.set('spotify_access_token', access_token, {
    httpOnly: true,
    maxAge:   expires_in - 60,          // expira 1 min antes
    path:     '/',
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
  })

  // refresh_token: persistente, usado para renovar o access_token
  if (refresh_token) {
    response.cookies.set('spotify_refresh_token', refresh_token, {
      httpOnly: true,
      maxAge:   30 * 24 * 60 * 60,      // 30 dias
      path:     '/',
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
    })
  }

  // Flag de status (não-httpOnly para leitura pelo frontend)
  response.cookies.set('spotify_connected', '1', {
    httpOnly: false,
    maxAge:   expires_in - 60,
    path:     '/',
    sameSite: 'lax',
  })

  return response
}

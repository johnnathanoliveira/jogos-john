import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/spotify/play
 * Body: { trackId: string, deviceId?: string }
 * Inicia a reprodução de uma faixa no dispositivo do Web Playback SDK.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get('spotify_access_token')?.value
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 })

  const { trackId, deviceId } = await request.json()
  if (!trackId) return NextResponse.json({ error: 'trackId required' }, { status: 400 })

  const url = `https://api.spotify.com/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  })

  if (res.status === 204 || res.status === 202 || res.status === 200) {
    return NextResponse.json({ ok: true })
  }

  // 403 = falta scope 'streaming' → usuário precisa reconectar
  if (res.status === 403) {
    return NextResponse.json(
      { error: 'missing_scope', message: 'Reconecte o Spotify — o token não tem permissão de reprodução.' },
      { status: 403 }
    )
  }

  const body = await res.text().catch(() => '')
  console.error('Spotify play error:', res.status, body)
  return NextResponse.json({ error: body, status: res.status }, { status: 502 })
}

/**
 * PUT /api/spotify/play
 * Body: { deviceId: string }
 * Transfere a sessão Spotify para o dispositivo do SDK.
 */
export async function PUT(request: NextRequest) {
  const token = request.cookies.get('spotify_access_token')?.value
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 })

  const { deviceId } = await request.json()

  const res = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  })

  const ok = res.status >= 200 && res.status < 300
  return NextResponse.json({ ok })
}

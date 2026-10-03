import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/spotify/play
 * Body: { trackId: string, deviceId: string }
 *
 * Inicia a reprodução de uma faixa no dispositivo do Spotify Web Playback SDK.
 * Requer que o host esteja autenticado (cookie spotify_access_token).
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get('spotify_access_token')?.value
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 })

  const { trackId, deviceId } = await request.json()
  if (!trackId) return NextResponse.json({ error: 'trackId required' }, { status: 400 })

  const res = await fetch(
    `https://api.spotify.com/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`,
    {
      method: 'PUT',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
    }
  )

  // 204 = sucesso sem corpo, 202 = accepted
  if (res.status === 204 || res.status === 202 || res.status === 200) {
    return NextResponse.json({ ok: true })
  }

  const err = await res.text().catch(() => '')
  console.error('Spotify play error:', res.status, err)
  return NextResponse.json({ error: err, status: res.status }, { status: 502 })
}

/**
 * PUT /api/spotify/play — transfere a sessão Spotify para o dispositivo do SDK
 * Body: { deviceId: string }
 */
export async function PUT(request: NextRequest) {
  const token = request.cookies.get('spotify_access_token')?.value
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 })

  const { deviceId } = await request.json()

  await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  })

  return NextResponse.json({ ok: true })
}

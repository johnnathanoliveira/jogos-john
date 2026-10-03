import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/spotify/token
 *
 * Expõe o access_token do Spotify para uso no Spotify Web Playback SDK
 * (client-side). O token fica em cookie httpOnly, então o SDK não consegue
 * lê-lo diretamente — esse endpoint serve como proxy seguro.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get('spotify_access_token')?.value
  if (!token) return NextResponse.json({ token: null, connected: false })
  return NextResponse.json({ token, connected: true })
}

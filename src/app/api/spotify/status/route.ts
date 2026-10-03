import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/spotify/status
 *
 * Informa se o host está autenticado com o Spotify.
 * Retorna: { connected: boolean }
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get('spotify_access_token')?.value
  return NextResponse.json({ connected: !!token })
}

/**
 * DELETE /api/spotify/status
 *
 * Desconecta removendo os cookies de autenticação.
 */
export async function DELETE() {
  const res = NextResponse.json({ disconnected: true })
  res.cookies.delete('spotify_access_token')
  res.cookies.delete('spotify_refresh_token')
  res.cookies.delete('spotify_connected')
  return res
}

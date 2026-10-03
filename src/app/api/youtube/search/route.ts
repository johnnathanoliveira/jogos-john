import { NextRequest, NextResponse } from 'next/server'

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY

/** Decodifica HTML entities do YouTube (ex: &amp; → &, &quot; → ") */
function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/**
 * GET /api/youtube/search?q=<query>
 * Proxy server-side para YouTube Data API v3.
 * Mantém a API key segura (nunca exposta ao browser).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()

  if (!q) {
    return NextResponse.json({ error: 'Parâmetro "q" obrigatório.' }, { status: 400 })
  }

  // Sem chave: informa o cliente para usar o modo de colar link
  if (!YOUTUBE_API_KEY) {
    return NextResponse.json(
      { error: 'YOUTUBE_API_KEY não configurada. Use "Colar link" para adicionar músicas.', noKey: true },
      { status: 200 }
    )
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search')
    url.searchParams.set('part', 'snippet')
    // Busca livre — o usuário pesquisa o que quiser (karaokê, playback, original, etc.)
    url.searchParams.set('q', q)
    url.searchParams.set('type', 'video')
    url.searchParams.set('videoCategoryId', '10') // Music category
    url.searchParams.set('maxResults', '8')
    url.searchParams.set('safeSearch', 'moderate')
    url.searchParams.set('key', YOUTUBE_API_KEY)

    const res = await fetch(url.toString(), { next: { revalidate: 300 } })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('YouTube API error:', err)
      return NextResponse.json(
        { error: 'Erro na API do YouTube. Verifique a chave ou a cota.' },
        { status: 502 }
      )
    }

    const data = await res.json()

    const results = (data.items ?? []).map((item: {
      id: { videoId: string }
      snippet: {
        title: string
        channelTitle: string
        thumbnails: { medium?: { url: string }; default?: { url: string } }
      }
    }) => ({
      videoId:      item.id.videoId,
      // Decodifica HTML entities que o YouTube retorna (ex: &amp; → &)
      title:        decodeHtml(item.snippet.title),
      channelTitle: decodeHtml(item.snippet.channelTitle),
      thumbnail:    item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? '',
    }))

    return NextResponse.json({ results })
  } catch (err) {    console.error('YouTube search error:', err)
    return NextResponse.json({ error: 'Erro interno ao buscar no YouTube.' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import os from 'os'

/**
 * Retorna o IP local mais adequado para gerar o QR Code.
 * Prefere 192.168.x.x (Wi-Fi doméstico) → 10.x.x.x (rede corporativa)
 * → outros, ignorando adaptadores virtuais (WSL, Docker, VPN, Hyper-V).
 */

// Prefixos de nomes de adaptadores virtuais a ignorar (Windows)
const VIRTUAL_ADAPTERS = ['vethernet', 'docker', 'vmware', 'virtualbox', 'wsl', 'loopback', 'pseudo', 'teredo']

function isVirtualAdapter(name: string): boolean {
  const lower = name.toLowerCase()
  return VIRTUAL_ADAPTERS.some(v => lower.includes(v))
}

function ipScore(ip: string): number {
  if (ip.startsWith('192.168.')) return 10   // ← Wi-Fi doméstico (melhor)
  if (ip.startsWith('10.'))      return 8    // ← Rede corporativa
  if (ip.startsWith('172.16.') ||
      ip.startsWith('172.17.') ||
      ip.startsWith('172.18.') ||
      ip.startsWith('172.19.') ||
      ip.startsWith('172.2')   ||
      ip.startsWith('172.3'))   return 2     // ← Docker / WSL / VPN (pior)
  return 5
}

export async function GET() {
  const nets = os.networkInterfaces()
  const candidates: Array<{ ip: string; score: number }> = []

  for (const [name, addrs] of Object.entries(nets)) {
    if (isVirtualAdapter(name)) continue  // pula adaptadores virtuais pelo nome

    for (const net of addrs ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        candidates.push({ ip: net.address, score: ipScore(net.address) })
      }
    }
  }

  // Ordena do maior score (melhor) para o menor
  candidates.sort((a, b) => b.score - a.score)

  const ips = candidates.map(c => c.ip)

  return NextResponse.json({
    ips,
    primary: ips[0] ?? null,
  })
}

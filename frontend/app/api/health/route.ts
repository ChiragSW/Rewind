import { NextResponse } from 'next/server'

export async function GET() {
  const backendBase = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')
  try {
    const res = await fetch(`${backendBase}/health`, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      return NextResponse.json({ status: 'ok', backend: data, mode: 'live' })
    }
    return NextResponse.json({ status: 'degraded', mode: 'synthetic' })
  } catch {
    return NextResponse.json({ status: 'offline', mode: 'synthetic' })
  }
}

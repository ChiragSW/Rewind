import { NextRequest, NextResponse } from 'next/server'

const getBackendUrl = () => process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'
const getBackendToken = () => process.env.BACKEND_TOKEN || process.env.NEXT_PUBLIC_BACKEND_TOKEN || 'local-operator-a'

async function handleProxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const backendBase = getBackendUrl().replace(/\/+$/, '')
  const token = getBackendToken()

  const subPath = path.join('/')
  const targetPath = subPath === 'health' || subPath === 'ready' ? `/${subPath}` : `/api/${subPath}`
  const targetUrl = new URL(targetPath, backendBase)

  // Append query parameters
  request.nextUrl.searchParams.forEach((val, key) => {
    targetUrl.searchParams.set(key, val)
  })

  const headers = new Headers()
  headers.set('Authorization', `Bearer ${token}`)
  const contentType = request.headers.get('content-type')
  if (contentType) {
    headers.set('content-type', contentType)
  }

  const options: RequestInit = {
    method: request.method,
    headers,
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      options.body = await request.text()
    } catch {
      // no body
    }
  }

  try {
    const backendRes = await fetch(targetUrl.toString(), options)
    const data = await backendRes.text()

    return new NextResponse(data, {
      status: backendRes.status,
      headers: {
        'content-type': backendRes.headers.get('content-type') || 'application/json',
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: 'BACKEND_UNAVAILABLE',
          message: `Unable to connect to backend at ${backendBase}. Ensure backend is running.`,
          details: err?.message,
        },
      },
      { status: 503 }
    )
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handleProxy(request, context)
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handleProxy(request, context)
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

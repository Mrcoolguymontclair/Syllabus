import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  console.log('[auth/callback] incoming params:', Object.fromEntries(searchParams))

  if (!code) {
    console.error('[auth/callback] no code in request — full URL:', request.url)
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent('No code returned from OAuth provider')}`)
  }

  const supabase = createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession error:', error)
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(error.message)}`
    )
  }

  console.log('[auth/callback] session exchange succeeded, redirecting to /dashboard')
  return NextResponse.redirect(`${origin}/dashboard`)
}

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { categorizeEvents, type CategorizedEvent } from '@/lib/categorize'
import ical, { type VEvent, type ParameterValue } from 'node-ical'

interface ParsedEvent {
  ical_uid: string
  title: string
  description: string
  due_date: string
}

function resolveParameterValue(value: ParameterValue | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.val
}

export async function POST(request: Request) {
  console.log('SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
  console.log('SERVICE_KEY prefix:', process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 20))
  console.log('ANON_KEY prefix:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 20))

  // Auth check — use anon client so session cookies are read correctly
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Validate request body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('ical_url' in body) ||
    typeof (body as Record<string, unknown>).ical_url !== 'string' ||
    !(body as Record<string, unknown>).ical_url
  ) {
    return NextResponse.json(
      { error: 'Missing or invalid ical_url in request body' },
      { status: 400 }
    )
  }

  const icalUrl = (body as { ical_url: string }).ical_url
  const normalizedUrl = icalUrl.replace(/^webcal:\/\//i, 'https://')

  // Fetch and parse iCal
  let rawEvents: Awaited<ReturnType<typeof ical.async.fromURL>>
  try {
    rawEvents = await ical.async.fromURL(normalizedUrl)
  } catch (err) {
    console.error('[api/sync] fromURL failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch or parse iCal URL' },
      { status: 422 }
    )
  }

  const now = new Date()
  const parsedEvents: ParsedEvent[] = Object.values(rawEvents)
    .filter((component): component is VEvent => {
      if (!component || component.type !== 'VEVENT') return false
      const event = component as VEvent
      return event.start instanceof Date && event.start > now
    })
    .map((event) => ({
      ical_uid: event.uid,
      title: resolveParameterValue(event.summary) || '(No title)',
      description: resolveParameterValue(event.description),
      due_date: event.start.toISOString(),
    }))

  if (parsedEvents.length === 0) {
    return NextResponse.json({ synced: 0, events: [] })
  }

  // Categorize with Gemini
  let categorized: CategorizedEvent[]
  try {
    categorized = await categorizeEvents(parsedEvents)
  } catch (err) {
    console.error('categorizeEvents failed:', err)
    return NextResponse.json({ error: 'Gemini failed', detail: String(err) }, { status: 500 })
  }

  // Upsert using service role client so RLS doesn't block writes
  const serviceClient = createServiceRoleClient()
  const { error: upsertError } = await serviceClient
    .from('assignments')
    .upsert(
      categorized.map((e) => ({
        user_id: user.id,
        ical_uid: e.ical_uid,
        title: e.title,
        description: e.description,
        due_date: e.due_date,
        class_name: e.class_name,
        assignment_type: e.assignment_type,
      })),
      { onConflict: 'user_id,ical_uid' }
    )

  if (upsertError) {
    console.error('[api/sync] upsert failed:', upsertError)
    return NextResponse.json(
      { error: 'Failed to save assignments to database' },
      { status: 500 }
    )
  }

  // Persist the iCal URL and last synced time to the user's profile
  const syncedAt = new Date().toISOString()
  const { error: profileError } = await serviceClient
    .from('profiles')
    .upsert({ id: user.id, ical_url: normalizedUrl, updated_at: syncedAt, last_synced_at: syncedAt })

  if (profileError) {
    console.error('[api/sync] profile upsert failed:', profileError)
  }

  // Re-fetch full rows (with id) so the client has everything it needs
  const { data: fullRows } = await serviceClient
    .from('assignments')
    .select('id, ical_uid, title, description, due_date, class_name, assignment_type, status')
    .eq('user_id', user.id)
    .order('due_date', { ascending: true })

  return NextResponse.json({
    synced: categorized.length,
    events: fullRows ?? [],
    last_synced_at: syncedAt,
  })
}

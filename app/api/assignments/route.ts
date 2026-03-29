import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const VALID_TYPES = ['Homework', 'Test', 'Quiz', 'Reading', 'Project', 'Lab', 'Other']

function normalizeClassName(s: string): string {
  return s.trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

export async function POST(request: Request) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>

  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }
  if (typeof raw.due_date !== 'string' || !raw.due_date) {
    return NextResponse.json({ error: 'Due date is required' }, { status: 400 })
  }

  const assignmentType = typeof raw.assignment_type === 'string' && VALID_TYPES.includes(raw.assignment_type)
    ? raw.assignment_type
    : 'Homework'

  const className = typeof raw.class_name === 'string' && raw.class_name.trim()
    ? normalizeClassName(raw.class_name)
    : 'Unknown'

  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient
    .from('assignments')
    .insert({
      user_id: user.id,
      ical_uid: `manual-${crypto.randomUUID()}`,
      title: raw.title.trim(),
      description: '',
      due_date: new Date(raw.due_date + 'T00:00:00').toISOString(),
      class_name: className,
      assignment_type: assignmentType,
      status: false,
    })
    .select()
    .single()

  if (error) {
    console.error('[api/assignments] insert failed:', error)
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

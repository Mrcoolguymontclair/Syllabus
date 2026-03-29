import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const VALID_TYPES = ['Homework', 'Test', 'Quiz', 'Reading', 'Project', 'Lab', 'Other']

function normalizeClassName(s: string): string {
  return s.trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

async function authenticateAndVerifyOwnership(
  request: Request,
  assignmentId: string
) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const serviceClient = createServiceRoleClient()
  const { data: existing } = await serviceClient
    .from('assignments')
    .select('user_id')
    .eq('id', assignmentId)
    .single()

  if (!existing || existing.user_id !== user.id) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }

  return { user, serviceClient }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateAndVerifyOwnership(request, params.id)
  if ('error' in auth) return auth.error

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
  const update: Record<string, unknown> = {}

  if ('status' in raw && typeof raw.status === 'boolean') {
    update.status = raw.status
  }
  if ('class_name' in raw && typeof raw.class_name === 'string' && raw.class_name.trim()) {
    update.class_name = normalizeClassName(raw.class_name)
  }
  if ('assignment_type' in raw && typeof raw.assignment_type === 'string' && VALID_TYPES.includes(raw.assignment_type)) {
    update.assignment_type = raw.assignment_type
  }
  if ('title' in raw && typeof raw.title === 'string' && raw.title.trim()) {
    update.title = raw.title.trim()
  }
  if ('due_date' in raw && typeof raw.due_date === 'string' && raw.due_date) {
    // Handle both ISO strings and YYYY-MM-DD date inputs
    const d = raw.due_date.length === 10
      ? new Date(raw.due_date + 'T00:00:00')
      : new Date(raw.due_date)
    if (!isNaN(d.getTime())) {
      update.due_date = d.toISOString()
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  update.updated_at = new Date().toISOString()

  const { data, error } = await auth.serviceClient
    .from('assignments')
    .update(update)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    console.error('[api/assignments] update failed:', error)
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateAndVerifyOwnership(request, params.id)
  if ('error' in auth) return auth.error

  const { error } = await auth.serviceClient
    .from('assignments')
    .delete()
    .eq('id', params.id)

  if (error) {
    console.error('[api/assignments] delete failed:', error)
    return NextResponse.json({ error: 'Failed to delete assignment' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/useTheme'

// ── Types ────────────────────────────────────────────────────────────────────

interface Assignment {
  id: string
  ical_uid: string
  title: string
  description: string
  due_date: string
  class_name: string
  assignment_type: string
  status: boolean
}

type SortKey = 'title' | 'class_name' | 'assignment_type' | 'due_date'
type SortDir = 'asc' | 'desc'

// ── Constants ────────────────────────────────────────────────────────────────

const ASSIGNMENT_TYPES = ['Homework', 'Test', 'Quiz', 'Reading', 'Project', 'Lab', 'Other'] as const

const TYPE_COLORS: Record<string, string> = {
  Homework: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  Test: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  Quiz: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  Reading: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  Project: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  Lab: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  Other: 'bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-300',
}

const TYPE_SELECT_COLORS: Record<string, string> = {
  Homework: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
  Test: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
  Quiz: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700',
  Reading: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700',
  Project: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700',
  Lab: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-700',
  Other: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700/40 dark:text-gray-300 dark:border-gray-600',
}

const GROUP_ORDER: Record<string, number> = { Overdue: 0, Today: 1, Tomorrow: 2, 'This Week': 3, Later: 4 }

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeClassName(s: string): string {
  return s.trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function toDateInputValue(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dueDateColor(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  if (diff < 0) return 'text-red-600 font-semibold'
  if (diff < 1) return 'text-red-600 font-semibold'
  if (diff < 3) return 'text-amber-600 font-semibold'
  return 'text-gray-500 dark:text-gray-400'
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function dateGroupLabel(iso: string): string {
  const now = new Date()
  const due = new Date(iso)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays = Math.round((dueStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return 'Overdue'
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays <= 7) return 'This Week'
  return 'Later'
}

async function patchAssignment(id: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/assignments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `PATCH failed (${res.status})`)
  }
}

async function deleteAssignment(id: string): Promise<void> {
  const res = await fetch(`/api/assignments/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `DELETE failed (${res.status})`)
  }
}

// ── Badge component ──────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[type] ?? TYPE_COLORS.Other}`}>
      {type}
    </span>
  )
}

// ── Sort arrow ───────────────────────────────────────────────────────────────

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="ml-1 text-gray-300 dark:text-gray-600">&#8597;</span>
  return <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
}

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onUndo, visible }: { message: string; onUndo: () => void; visible: boolean }) {
  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
    >
      <div className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-3">
        <span>{message}</span>
        <button onClick={onUndo} className="text-blue-300 dark:text-blue-600 hover:text-blue-200 dark:hover:text-blue-500 font-medium">Undo</button>
      </div>
    </div>
  )
}

// ── Editable cells ───────────────────────────────────────────────────────────

function EditableTitle({ value, onSave, muted }: { value: string; onSave: (v: string) => void; muted: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit() {
    setEditing(false)
    const t = draft.trim()
    if (t && t !== value) onSave(t)
    else setDraft(value)
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`text-left font-medium max-w-xs truncate cursor-text hover:underline underline-offset-2 decoration-dashed decoration-gray-300 dark:decoration-gray-600 ${muted ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}
      >
        {value}
      </button>
    )
  }
  return (
    <input ref={inputRef} value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
      className="w-full border border-blue-300 dark:border-blue-600 rounded px-1.5 py-0.5 text-sm font-medium bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

function EditableClassName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit() {
    setEditing(false)
    const t = draft.trim()
    if (t && t !== value) onSave(normalizeClassName(t))
    else setDraft(value)
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-left hover:underline underline-offset-2 decoration-dashed decoration-gray-300 dark:decoration-gray-600 cursor-text">
        {value}
      </button>
    )
  }
  return (
    <input ref={inputRef} value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
      className="w-full border border-blue-300 dark:border-blue-600 rounded px-1.5 py-0.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

function EditableAssignmentType({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState(value)
  const selectRef = useRef<HTMLSelectElement>(null)

  useEffect(() => { setCurrent(value) }, [value])
  useEffect(() => { if (editing) selectRef.current?.focus() }, [editing])

  function commit(v: string) {
    setEditing(false)
    if (v !== value) onSave(v)
  }

  if (!editing) {
    return <button onClick={() => setEditing(true)} className="cursor-pointer"><TypeBadge type={value} /></button>
  }
  return (
    <select
      ref={selectRef}
      value={current}
      onChange={(e) => { setCurrent(e.target.value); commit(e.target.value) }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
      className={`rounded-full px-2 py-0.5 text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer ${TYPE_SELECT_COLORS[current] ?? TYPE_SELECT_COLORS.Other}`}
    >
      {ASSIGNMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  )
}

function EditableDueDate({ value, onSave, muted }: { value: string; onSave: (v: string) => void; muted: boolean }) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit(dateStr: string) {
    setEditing(false)
    if (!dateStr) return
    const newIso = new Date(dateStr + 'T00:00:00').toISOString()
    if (newIso !== value) onSave(newIso)
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`whitespace-nowrap cursor-text hover:underline underline-offset-2 decoration-dashed decoration-gray-300 dark:decoration-gray-600 ${muted ? 'line-through text-gray-400 dark:text-gray-500' : dueDateColor(value)}`}
      >
        {formatDueDate(value)}
      </button>
    )
  }
  return (
    <input
      ref={inputRef}
      type="date"
      defaultValue={toDateInputValue(value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        if (e.key === 'Escape') setEditing(false)
      }}
      className="border border-blue-300 dark:border-blue-600 rounded px-1.5 py-0.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

// ── Add Task inline form ─────────────────────────────────────────────────────

function AddTaskForm({
  onCreated,
  onCancel,
  existingClasses,
}: {
  onCreated: (a: Assignment) => void
  onCancel: () => void
  existingClasses: string[]
}) {
  const [title, setTitle] = useState('')
  const [className, setClassName] = useState('')
  const [type, setType] = useState<string>('Homework')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !dueDate) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          class_name: className.trim() || undefined,
          assignment_type: type,
          due_date: dueDate,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to create')
        return
      }
      const created: Assignment = await res.json()
      onCreated(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Title *</label>
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Assignment title"
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Class</label>
          <input list="class-options" value={className} onChange={(e) => setClassName(e.target.value)}
            placeholder="Class name"
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <datalist id="class-options">
            {existingClasses.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {ASSIGNMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Due Date *</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" required />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            {saving ? 'Adding…' : 'Add'}
          </button>
          <button type="button" onClick={onCancel}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-2">
            Cancel
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </form>
  )
}

// ── Trash icon ───────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
    </svg>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const { dark, toggle: toggleTheme } = useTheme()

  // Data
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [initializing, setInitializing] = useState(true)

  // Profile / sync
  const [savedIcalUrl, setSavedIcalUrl] = useState<string | null>(null)
  const [icalUrlInput, setIcalUrlInput] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [showUrlEditor, setShowUrlEditor] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  // UI
  const [showAddForm, setShowAddForm] = useState(false)
  const [filterClass, setFilterClass] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [hideCompleted, setHideCompleted] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('due_date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Toast
  const [toast, setToast] = useState<{ id: string; message: string; prevStatus: boolean } | null>(null)
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(id: string, message: string, prevStatus: boolean) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ id, message, prevStatus })
    setToastVisible(true)
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false)
      toastTimerRef.current = setTimeout(() => setToast(null), 300)
    }, 3000)
  }

  function handleToastUndo() {
    if (!toast) return
    toggleStatus(toast.id, !toast.prevStatus)
    setToastVisible(false)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setTimeout(() => setToast(null), 300)
  }

  // ── Load on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [profileRes, assignmentsRes] = await Promise.all([
        supabase.from('profiles').select('ical_url, last_synced_at').eq('id', user.id).maybeSingle(),
        supabase
          .from('assignments')
          .select('id, ical_uid, title, description, due_date, class_name, assignment_type, status')
          .eq('user_id', user.id)
          .order('due_date', { ascending: true }),
      ])

      if (profileRes.data?.ical_url) {
        setSavedIcalUrl(profileRes.data.ical_url)
        setIcalUrlInput(profileRes.data.ical_url)
      }
      if (profileRes.data?.last_synced_at) {
        setLastSyncedAt(profileRes.data.last_synced_at)
      }
      if (assignmentsRes.data) {
        setAssignments(assignmentsRes.data as Assignment[])
      }
      setInitializing(false)
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ─────────────────────────────────────────────────────────

  // Bug #6: filter out Unknown / empty / null
  const classNames = useMemo(
    () => Array.from(new Set(assignments.map((a) => a.class_name)))
      .filter((c) => c && c !== 'Unknown')
      .sort(),
    [assignments]
  )

  // Bug #2: Left column shows all (or hides completed), then applies class/type filters
  const todoList = useMemo(() => {
    let list = [...assignments]
    if (hideCompleted) list = list.filter((a) => !a.status)
    if (filterClass !== 'all') list = list.filter((a) => a.class_name === filterClass)
    if (filterType !== 'all') list = list.filter((a) => a.assignment_type === filterType)
    return list.sort((a, b) => {
      // Completed items always sink to the bottom
      if (a.status !== b.status) return a.status ? 1 : -1
      const av = a[sortKey], bv = b[sortKey]
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [assignments, filterClass, filterType, hideCompleted, sortKey, sortDir])

  // Bug #7 + #13: Right column filters out completed and applies class/type filters
  const upcomingGroups = useMemo(() => {
    let list = assignments.filter((a) => !a.status)
    if (filterClass !== 'all') list = list.filter((a) => a.class_name === filterClass)
    if (filterType !== 'all') list = list.filter((a) => a.assignment_type === filterType)
    const sorted = [...list].sort((a, b) => a.due_date.localeCompare(b.due_date))
    const groups: { label: string; items: Assignment[] }[] = []
    let currentLabel = ''
    for (const a of sorted) {
      const label = dateGroupLabel(a.due_date)
      if (label !== currentLabel) {
        groups.push({ label, items: [] })
        currentLabel = label
      }
      groups[groups.length - 1].items.push(a)
    }
    groups.sort((a, b) => (GROUP_ORDER[a.label] ?? 99) - (GROUP_ORDER[b.label] ?? 99))
    return groups
  }, [assignments, filterClass, filterType])

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  async function handleSync(url?: string) {
    const syncUrl = url ?? savedIcalUrl ?? icalUrlInput.trim()
    if (!syncUrl) { setSyncError('Please enter a Schoology iCal URL.'); return }

    setSyncing(true)
    setSyncError(null)
    setSyncMessage(null)

    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ical_url: syncUrl }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSyncError(body.error ?? `Sync failed (${res.status})`)
        return
      }
      const data = await res.json()
      setAssignments(data.events as Assignment[])
      setSavedIcalUrl(syncUrl.replace(/^webcal:\/\//i, 'https://'))
      setLastSyncedAt(data.last_synced_at)
      setShowUrlEditor(false)
      setSyncMessage(`${data.synced} assignment${data.synced !== 1 ? 's' : ''} synced.`)
      setTimeout(() => setSyncMessage(null), 4000)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSyncing(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const toggleStatus = useCallback(async (id: string, current: boolean) => {
    setAssignments((prev) => prev.map((a) => (a.id === id ? { ...a, status: !current } : a)))
    if (!current) showToast(id, 'Task marked complete', current)
    try {
      await patchAssignment(id, { status: !current })
    } catch {
      setAssignments((prev) => prev.map((a) => (a.id === id ? { ...a, status: current } : a)))
    }
  }, [])

  const updateField = useCallback(async (id: string, field: string, value: string) => {
    const normalized = field === 'class_name' ? normalizeClassName(value) : value
    setAssignments((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: normalized } : a)))
    try {
      await patchAssignment(id, { [field]: normalized })
    } catch {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('assignments')
        .select('id, ical_uid, title, description, due_date, class_name, assignment_type, status')
        .eq('user_id', user.id)
        .order('due_date', { ascending: true })
      if (data) setAssignments(data as Assignment[])
    }
  }, [supabase])

  const handleDelete = useCallback(async (id: string) => {
    const prev = assignments
    setAssignments((p) => p.filter((a) => a.id !== id))
    try {
      await deleteAssignment(id)
    } catch {
      setAssignments(prev)
    }
  }, [assignments])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  function handleTaskCreated(a: Assignment) {
    setAssignments((prev) => [...prev, a])
    setShowAddForm(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const needsSetup = !savedIcalUrl && !showUrlEditor

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 sm:px-8 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Syllabus</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM15.657 5.404a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.06l1.06-1.06zM6.464 14.596a.75.75 0 10-1.06-1.06l-1.06 1.06a.75.75 0 001.06 1.06l1.06-1.06zM18 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0118 10zM5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 015 10zM14.596 15.657a.75.75 0 001.06-1.06l-1.06-1.061a.75.75 0 10-1.06 1.06l1.06 1.06zM5.404 6.464a.75.75 0 001.06-1.06l-1.06-1.06a.75.75 0 10-1.06 1.06l1.06 1.06z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M7.455 2.004a.75.75 0 01.26.77 7 7 0 009.958 7.967.75.75 0 011.067.853A8.5 8.5 0 116.647 1.921a.75.75 0 01.808.083z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            <button onClick={handleSignOut} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 underline">Sign out</button>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 sm:px-8 py-6">
        <div className="max-w-7xl mx-auto">

          {/* First-time setup or URL editor */}
          {(needsSetup || showUrlEditor) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm dark:shadow-gray-900/50 border border-gray-200 dark:border-gray-800 p-6 mb-6 max-w-2xl">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                {needsSetup ? 'Connect Schoology' : 'Change iCal URL'}
              </h2>
              <div className="flex gap-3">
                <input type="url" value={icalUrlInput} onChange={(e) => setIcalUrlInput(e.target.value)}
                  placeholder="webcal:// or https://app.schoology.com/ical/..."
                  className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={() => handleSync(icalUrlInput.trim())} disabled={syncing}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
                  {syncing ? 'Syncing…' : 'Sync'}
                </button>
                {showUrlEditor && (
                  <button onClick={() => setShowUrlEditor(false)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-3">Cancel</button>
                )}
              </div>
              {syncError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{syncError}</p>}
            </div>
          )}

          {initializing ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-24">Loading…</p>
          ) : assignments.length === 0 && !needsSetup ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-24">No assignments yet. Click Sync to import from Schoology.</p>
          ) : assignments.length > 0 && (
            <>
              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="all">All classes</option>
                  {classNames.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="all">All types</option>
                  {ASSIGNMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                  <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                  Hide completed
                </label>
              </div>

              {/* Two-column layout */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* LEFT — To Do */}
                <div className="lg:col-span-2">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">To Do</h2>
                    <button onClick={() => setShowAddForm(true)}
                      className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
                      + Add task
                    </button>
                  </div>

                  {showAddForm && (
                    <AddTaskForm
                      onCreated={handleTaskCreated}
                      onCancel={() => setShowAddForm(false)}
                      existingClasses={classNames}
                    />
                  )}

                  {todoList.length === 0 ? (
                    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center">
                      <p className="text-sm text-gray-400 dark:text-gray-500">
                        {assignments.every((a) => a.status)
                          ? 'All done! Nothing left to do.'
                          : 'No assignments match your filters.'}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm dark:shadow-gray-900/50 border border-gray-200 dark:border-gray-800 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 dark:bg-gray-800/50 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                              <th className="px-4 py-3 w-10"></th>
                              <ThSortable label="Title" sortKey="title" active={sortKey} dir={sortDir} onSort={handleSort} />
                              <ThSortable label="Class" sortKey="class_name" active={sortKey} dir={sortDir} onSort={handleSort} />
                              <ThSortable label="Type" sortKey="assignment_type" active={sortKey} dir={sortDir} onSort={handleSort} />
                              <ThSortable label="Due" sortKey="due_date" active={sortKey} dir={sortDir} onSort={handleSort} />
                              <th className="px-2 py-3 w-8"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {todoList.map((a) => (
                              <tr key={a.id} className={`group transition-colors ${a.status ? 'bg-gray-50/60 dark:bg-gray-800/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
                                <td className="px-4 py-3">
                                  <input type="checkbox" checked={a.status} onChange={() => toggleStatus(a.id, a.status)}
                                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                                </td>
                                <td className="px-4 py-3">
                                  <EditableTitle value={a.title} muted={a.status} onSave={(v) => updateField(a.id, 'title', v)} />
                                </td>
                                <td className={`px-4 py-3 ${a.status ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>
                                  <EditableClassName value={a.class_name} onSave={(v) => updateField(a.id, 'class_name', v)} />
                                </td>
                                <td className={`px-4 py-3 ${a.status ? 'opacity-50' : ''}`}>
                                  <EditableAssignmentType value={a.assignment_type} onSave={(v) => updateField(a.id, 'assignment_type', v)} />
                                </td>
                                <td className="px-4 py-3">
                                  <EditableDueDate value={a.due_date} muted={a.status} onSave={(v) => updateField(a.id, 'due_date', v)} />
                                </td>
                                <td className="px-2 py-3">
                                  {a.ical_uid.startsWith('manual-') && (
                                    <button
                                      onClick={() => handleDelete(a.id)}
                                      className="text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                                      title="Delete task"
                                    >
                                      <TrashIcon />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT — Upcoming */}
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">Upcoming</h2>
                  <div className="space-y-4">
                    {upcomingGroups.map((group) => (
                      <div key={group.label}>
                        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">{group.label}</h3>
                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                          {group.items.map((a) => (
                            <div key={a.id} className="px-4 py-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate text-gray-900 dark:text-white">{a.title}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-gray-400 dark:text-gray-500">{a.class_name}</span>
                                    <TypeBadge type={a.assignment_type} />
                                  </div>
                                </div>
                                <span className={`text-xs whitespace-nowrap mt-0.5 ${dueDateColor(a.due_date)}`}>
                                  {formatDueDate(a.due_date)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {upcomingGroups.length === 0 && (
                      <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No upcoming assignments.</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom sync bar */}
      {savedIcalUrl && !showUrlEditor && (
        <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-4 sm:px-8 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
            <span>
              {lastSyncedAt ? `Last synced: ${timeAgo(lastSyncedAt)}` : 'Not synced yet'}
              {syncMessage && <span className="ml-3 text-green-600 dark:text-green-400 font-medium">{syncMessage}</span>}
              {syncError && <span className="ml-3 text-red-600 dark:text-red-400">{syncError}</span>}
            </span>
            <div className="flex items-center gap-4">
              <button onClick={() => handleSync()} disabled={syncing}
                className="text-blue-600 hover:text-blue-700 font-medium disabled:text-blue-400 transition-colors">
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
              <button onClick={() => setShowUrlEditor(true)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                Change URL
              </button>
            </div>
          </div>
        </footer>
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} onUndo={handleToastUndo} visible={toastVisible} />}
    </main>
  )
}

// ── Sortable header ──────────────────────────────────────────────────────────

function ThSortable({ label, sortKey: key, active, dir, onSort }: {
  label: string; sortKey: SortKey; active: SortKey; dir: SortDir; onSort: (k: SortKey) => void
}) {
  return (
    <th className="px-4 py-3">
      <button onClick={() => onSort(key)} className="flex items-center gap-0.5 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
        {label}
        <SortArrow active={active === key} dir={dir} />
      </button>
    </th>
  )
}

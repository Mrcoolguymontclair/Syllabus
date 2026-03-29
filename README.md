# Schoology To-Do

AI-powered to-do list that syncs your Schoology assignments and categorizes them automatically.

## What it does

- Imports assignments from your Schoology calendar via iCal feed
- Uses Groq (Llama 3.3 70B) to automatically categorize each assignment by class and type (Homework, Test, Quiz, etc.)
- Stores everything in Supabase with per-user row-level security
- Two-column dashboard: an interactive to-do list on the left and a grouped timeline on the right
- Inline editing for title, class, type, and due date
- Manual task entry for assignments not in Schoology
- Filtering by class, type, and completion status
- Sortable columns with optimistic UI updates

## Tech stack

- **Framework:** Next.js 14 (App Router, TypeScript)
- **Styling:** Tailwind CSS
- **Database:** Supabase (PostgreSQL + Auth + RLS)
- **AI categorization:** Groq API (Llama 3.3 70B Versatile)
- **iCal parsing:** node-ical
- **Auth:** Google OAuth via Supabase Auth
- **Deployment:** Vercel

## Getting started (self-host)

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Groq](https://console.groq.com) API key
- Google OAuth credentials configured in your Supabase project (Authentication > Providers > Google)

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/syllabus.git
cd syllabus
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up Supabase

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Enable Google OAuth under **Authentication > Providers > Google**
3. Add your local and production URLs to **Authentication > URL Configuration > Redirect URLs**:
   - `http://localhost:3000/auth/callback`
   - `https://your-domain.com/auth/callback`

### 4. Set up environment variables

Create a `.env.local` file in the project root:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GROQ_API_KEY=your-groq-api-key
```

### 5. Run database migrations

Open the **Supabase SQL Editor** and run these files in order:

1. `supabase/migrations/001_initial.sql` — creates the `assignments` table with RLS
2. `supabase/migrations/002_profiles.sql` — creates the `profiles` table with RLS
3. `supabase/migrations/003_last_synced.sql` — adds `last_synced_at` to profiles

### 6. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with Google.

## Environment variables

| Variable | Description | Where to find it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | Supabase Dashboard > Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key | Supabase Dashboard > Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) | Supabase Dashboard > Settings > API |
| `GROQ_API_KEY` | Groq API key for AI categorization | [console.groq.com](https://console.groq.com) |

## How to get your Schoology iCal URL

1. Log in to Schoology
2. Go to **Calendar** (top navigation bar)
3. Click the **Subscribe** or **iCal** button (usually a small calendar icon in the top-right of the calendar view)
4. Copy the `webcal://` link that appears
5. Paste it into the Schoology To-Do sync input — the app automatically converts `webcal://` to `https://`

## Deployment (Vercel)

1. Push the repo to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Add all four environment variables in Vercel's project settings
4. Deploy — Vercel auto-detects Next.js and configures the build
5. Add your Vercel domain to Supabase's redirect URLs:
   - `https://your-app.vercel.app/auth/callback`

# Supabase setup for TruthSpotter

## Tables

| Table | Purpose |
|-------|---------|
| `conversations` | One chat thread per user (linked to `auth.users`) |
| `messages` | User claims and assistant verification results |

## Apply schema (choose one)

### Option A — Supabase Dashboard (recommended)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **SQL Editor** → **New query**.
3. Paste the contents of [`truthspotter_schema.sql`](./truthspotter_schema.sql).
4. Click **Run**.

### Option B — Supabase CLI

```bash
cd chatwiz-next
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

## Frontend env (`chatwiz-next/.env`)

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key
```

Find these under **Project Settings → API**.

## Auth

Enable **Email** provider under **Authentication → Providers** so sign-up/sign-in on `/auth` works.

## `verification_status` values

| Value | Meaning |
|-------|---------|
| `verified` | Claim supported by evidence |
| `refuted` | Claim contradicted / not supported |
| `unverified` | Not yet verified or inconclusive |
| `partially_verified` | Mixed / partial support |

Legacy values `true` / `false` are still allowed in the database for older rows.

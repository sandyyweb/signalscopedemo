# SignalScope – setup (about 30 minutes)

Stack: static frontend (index.html) + Supabase (Postgres, Auth, Edge Functions) + Gemini API. No build step.

## 1. Supabase
1. Create a project at supabase.com.
2. SQL Editor → paste and run `supabase/schema.sql` (tables, row-level security, auto-created organisation per signup).
3. Authentication → Providers → Email: enable. Set Site URL to your deployed site URL (needed for confirmation and reset emails).

## 2. Edge Functions (needs the Supabase CLI)
```
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GEMINI_API_KEY=your_key
# optional: GEMINI_MODEL=..., GROUNDING=true (adds search grounding + citations; may cost extra), DAILY_RUN_LIMIT=50
supabase functions deploy run-audit
supabase functions deploy run-tracker
```
SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided to functions automatically. Never put the service-role key in index.html.

## 3. Frontend
Open `index.html`, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Project Settings → API). Deploy the folder to Vercel or Netlify (drag and drop works). Push the code to a private GitHub repo.

## 4. Test before inviting anyone
- Sign up two accounts; confirm each sees only its own brands, questions and results.
- Run an audit on a public site; try http://localhost and a private IP (must be rejected).
- Add questions and competitors, run a question, check the report and CSV.
- Verify `Deno.resolveDns` works in your Edge Function runtime (the SSRF check depends on it).

## Known limits
- One provider (Gemini API), one page per audit, mention detection is name matching (no aliases yet).
- Grounding citations come back as provider redirect links; the domain comes from the title field.
- No billing yet (Phase 6). Have a developer review RLS, key handling and URL fetching before taking paying customers.

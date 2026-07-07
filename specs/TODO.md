# IDMR AI — TODO / backlog

Running list of deferred ideas. See `audit-2026-04-08.md` for the original roadmap.

## Done
- **Local multi-chat history** ✅ — multiple localStorage conversations + collapsible sidebar (switch/create/delete), auto-title from first user message, per-conversation persistence. Store (`src/lib/conversations.ts`) mirrors the planned Supabase `conversations`/`messages` shape so migration is read-here → insert-there.

## Next up
- **Users / auth + server-side chat history** (audit 3b–3e) — split Supabase admin vs user clients, add Supabase Auth (`@supabase/ssr`), enable the commented-out `conversations`/`messages` tables + RLS in `supabase/schema.sql`, persist server-side, and add a "sign in to save this conversation" migration that POSTs existing local conversations into DB rows owned by the user. Requires privacy policy + data-retention/delete story before launch.
- **Server-side Haiku auto-titling** — replace the client-side truncated title with a cheap Haiku call for a 3–5 word title (audit 3d). Deferred; the truncation is fine for local-only.

## SoundCloud follow-ups
- **Snippet-match checker (deferred).** 18 SoundCloud lectures have audio but no matching transcript in the 99-doc library (list preserved in `scripts/soundcloud-urls.json` under `_unresolved`/`_excluded`). Idea: transcribe a ~30–60s snippet of each (WisprFlow/Whisper), embed it, run it through `searchByContent`/`match_chunks`, and see whether it clusters strongly on one existing document — i.e. detect lectures that ARE transcribed under a different title, which the official site's fuzzy search can't reliably surface.
  - Reuses existing infra (`getEmbedding()` + `match_chunks`); only new piece is the external transcription step. ~small script for the text→match half.
  - **Calibrate first** on the 10 already-matched lectures: confirm a known snippet retrieves its own transcript with a clear similarity gap over runners-up; that gap becomes the threshold.
  - **Watch for false positives:** Kinley reuses theology/phrasing across lectures, so pure semantic similarity lights up many docs. Add a verbatim distinctive-phrase check (proper nouns, spoken dates, unusual phrasings) to confirm "same lecture," not just "same topic."
  - Shares the audio-ingestion half with the streaming-pipeline idea below.
- **Audio/video streaming pipeline (future, engineering exercise).** A streaming portion that plays mp3s/mp4s sent out daily — for building streaming/data-pipeline skills and practical use. First concrete task: transcribe the Dr. Robert Harris "Founders Church representatives" video (Jarrett has it; no transcript exists) and add it to the library.

## Untranscribed lectures worklist
The 18 SoundCloud lectures with no transcript are candidates for transcription into the library. Full URLs + notes live in `scripts/soundcloud-urls.json`.

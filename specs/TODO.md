# IDMR AI — TODO / backlog

Running list of deferred ideas. See `audit-2026-04-08.md` for the original roadmap.

## Done
- **Local multi-chat history** ✅ — multiple localStorage conversations + collapsible sidebar (switch/create/delete), auto-title from first user message, per-conversation persistence. Store (`src/lib/conversations.ts`) mirrors the planned Supabase `conversations`/`messages` shape so migration is read-here → insert-there.

## Next up
- **Users / auth + server-side chat history** (audit 3b–3e) — split Supabase admin vs user clients, add Supabase Auth (`@supabase/ssr`), enable the commented-out `conversations`/`messages` tables + RLS in `supabase/schema.sql`, persist server-side, and add a "sign in to save this conversation" migration that POSTs existing local conversations into DB rows owned by the user. Requires privacy policy + data-retention/delete story before launch.
- **Server-side Haiku auto-titling** — replace the client-side truncated title with a cheap Haiku call for a 3–5 word title (audit 3d). Deferred; the truncation is fine for local-only.

## Retrieval quality (found 2026-07-07)
Diagnosed from a real query ("Summarize the Sunday Morning in 74/75 transcript"): the model answered that only metadata/transcriber's notes were retrieved. Root cause is retrieval, NOT missing data — all 98 real transcripts are fully chunked (audited: 96 docs 21+ chunks, only the junk "Transcripts" index doc is thin). Two defects:
- **A. Proofreaders'-notes boilerplate embedded as content.** ✅ DONE (2026-07-07). Added `scripts/strip-boilerplate.ts` — normalizes whitespace (the raw files hard-wrap mid-phrase), then removes the transcriber's/proofreader's convention sentences + scaffolding (underscore rules, "Page: Subject:" footers, catalog/cassette lines) by pattern, while PRESERVING contextual framing (DISPUTANTS, PRESENT ON TAPE, SPEAKER/READER, SUBJECT, location, "PLEASE NOTE" provenance). Wired into `scripts/chunk.ts`; validated with `scripts/preview-strip.ts` (full removed-text dump — confirmed zero convention text survives across all 99 files and no sermon text is removed). Re-chunked + re-embedded (9784 chunks). Also added retry-with-backoff to `scripts/embed.ts` for free-tier statement timeouts. Verified in the live DB: all boilerplate phrases gone, teaching queries still strong, title lookups intact.
- **B. Brittle title resolution.** `searchByTitle` uses ILIKE substring on the catalog title, so a reference by in-content heading ("Sunday Morning in 74/75"), date, or catalog# ("74 TV") returns 0 and silently falls back to weak content search. **Fix:** fuzzy-resolve references via pg_trgm similarity (extension + `documents_title_trgm_idx` already exist) and index the content heading/date/catalog# as alias fields so headings resolve to the right document.
- Minor: drop or exclude the junk "Transcripts" document (a scraped index page, 2 chunks) from retrieval.

## SoundCloud follow-ups
- **Snippet-match checker (deferred).** 18 SoundCloud lectures have audio but no matching transcript in the 99-doc library (list preserved in `scripts/soundcloud-urls.json` under `_unresolved`/`_excluded`). Idea: transcribe a ~30–60s snippet of each (WisprFlow/Whisper), embed it, run it through `searchByContent`/`match_chunks`, and see whether it clusters strongly on one existing document — i.e. detect lectures that ARE transcribed under a different title, which the official site's fuzzy search can't reliably surface.
  - Reuses existing infra (`getEmbedding()` + `match_chunks`); only new piece is the external transcription step. ~small script for the text→match half.
  - **Calibrate first** on the 10 already-matched lectures: confirm a known snippet retrieves its own transcript with a clear similarity gap over runners-up; that gap becomes the threshold.
  - **Watch for false positives:** Kinley reuses theology/phrasing across lectures, so pure semantic similarity lights up many docs. Add a verbatim distinctive-phrase check (proper nouns, spoken dates, unusual phrasings) to confirm "same lecture," not just "same topic."
  - Shares the audio-ingestion half with the streaming-pipeline idea below.
- **Audio/video streaming pipeline (future, engineering exercise).** A streaming portion that plays mp3s/mp4s sent out daily — for building streaming/data-pipeline skills and practical use. First concrete task: transcribe the Dr. Robert Harris "Founders Church representatives" video (Jarrett has it; no transcript exists) and add it to the library.

## Untranscribed lectures worklist
The 18 SoundCloud lectures with no transcript are candidates for transcription into the library. Full URLs + notes live in `scripts/soundcloud-urls.json`.

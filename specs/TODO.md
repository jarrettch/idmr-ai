# IDMR AI — TODO / backlog

Running list of deferred ideas. See `audit-2026-04-08.md` for the original roadmap.

## Next up
- **Local multi-chat history** — multiple conversations in localStorage + a sidebar / new-chat, structured to mirror the eventual Supabase `conversations`/`messages` shape so the later auth migration is trivial. (Chosen over transcript-hunting as the bigger near-term win.)

## SoundCloud follow-ups
- **Snippet-match checker (deferred).** 18 SoundCloud lectures have audio but no matching transcript in the 99-doc library (list preserved in `scripts/soundcloud-urls.json` under `_unresolved`/`_excluded`). Idea: transcribe a ~30–60s snippet of each (WisprFlow/Whisper), embed it, run it through `searchByContent`/`match_chunks`, and see whether it clusters strongly on one existing document — i.e. detect lectures that ARE transcribed under a different title, which the official site's fuzzy search can't reliably surface.
  - Reuses existing infra (`getEmbedding()` + `match_chunks`); only new piece is the external transcription step. ~small script for the text→match half.
  - **Calibrate first** on the 10 already-matched lectures: confirm a known snippet retrieves its own transcript with a clear similarity gap over runners-up; that gap becomes the threshold.
  - **Watch for false positives:** Kinley reuses theology/phrasing across lectures, so pure semantic similarity lights up many docs. Add a verbatim distinctive-phrase check (proper nouns, spoken dates, unusual phrasings) to confirm "same lecture," not just "same topic."
  - Shares the audio-ingestion half with the streaming-pipeline idea below.
- **Audio/video streaming pipeline (future, engineering exercise).** A streaming portion that plays mp3s/mp4s sent out daily — for building streaming/data-pipeline skills and practical use. First concrete task: transcribe the Dr. Robert Harris "Founders Church representatives" video (Jarrett has it; no transcript exists) and add it to the library.

## Untranscribed lectures worklist
The 18 SoundCloud lectures with no transcript are candidates for transcription into the library. Full URLs + notes live in `scripts/soundcloud-urls.json`.

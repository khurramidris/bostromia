# Smallville — Generative Agents

An interactive 2D simulation of an 18-resident rural town (`80×46` tiles, 3 districts, 14 buildings, 32 persistent objects) modelled on Park et al. (2023), *"Generative Agents: Interactive Simulacra of Human Behavior"* (UIST '23).

## Environment Variables & Secrets

All API keys run strictly on the server (`server.ts`). In local development, `server.ts` loads `.env.local` first, then `.env` (never commit real keys—configure secrets via AI Studio **Settings → Secrets**):

- `GEMINI_API_KEY`: Used for Gemini reasoning and dense memory embeddings (`gemini-embedding-2`).
- `OPENROUTER_API_KEY`: Optional primary OpenRouter key. When set (`LLM_PROVIDER="auto"`), agent reasoning routes through OpenRouter.
- `OPENROUTER_MODEL`: Defaults to `nvidia/nemotron-3-ultra-550b-a55b:free`.
- `LLM_PROVIDER`: `auto | gemini | openrouter` (default `auto`).
- `GEMINI_MODEL`, `MODEL_CONVERSE`, `MODEL_REFLECT`, `MODEL_PLAN`: Optional global or per-job model overrides.
- `ENABLE_SERVER_SAVES`: `false` by default (town state saves per browser in IndexedDB + JSON Export/Import). When `true`, server saves isolate cleanly per browser `x-world-id` UUID under `data/worlds/<uuid>.json`.
- `MAX_LLM_CALLS_PER_DAY`: Global upstream daily call limit (default `2000`).
- `APP_ACCESS_TOKEN`: Optional shared access token required via `x-app-token` on `/api/*` routes when deploying publicly.

### OpenRouter Free-Model Caps & Privacy Note
- OpenRouter `:free` endpoints allow up to **20 requests/minute** and **50 requests/day** (raised to **1,000/day** after buying ≥ 10 OpenRouter credits).
- Free OpenRouter/NVIDIA endpoints may log prompts upstream for provider telemetry—avoid sending sensitive data.

## Scripts & Verification
- `npm run dev` — Start Express + Vite dev server on port `3000`.
- `npm test` — Run all `node:test` suites (`tsx --test "src/**/*.test.ts"`).
- `npm run lint` — TypeScript check (`tsc --noEmit`).
- `npm run build` — Production frontend build (`vite build`).

## Workspace Tabs

- **Town Map**: 60 fps HTML5 Canvas map across North Ridge, Main Street, and Southside Creek with sleeping animations, dialogue indicators, live inspector (`Plan`, virtualized `Memory` with clickable `evidenceIds`, `Social`, `Talks` with optional inner thoughts, and `Interact`).
- **Chronicle**: Virtualized timeline filterable by Conversations, Reflections, Sleep Consolidation, Reactions, Plans, Town Events, Interviews, and Whispers.
- **Society**: Directed Theory of Mind network, district occupancy, dual-process greeting counters, LLM calls/tokens, and rumor spread trackers.
- **Experiments**: Replicate Park et al. (2023)'s Valentine's Day party & mayoral race emergence, chart awareness & network density trajectories, toggle controlled ablations (`No Reflection`, `No Planning`, `No Memory Retrieval`, `No System-2 Gate`), run side-by-side comparisons, and evaluate residents on the 25-question interview battery + 1–5 rubric judge.
- **Architecture**: Tune scheduler budget presets (`Thrifty` / `Balanced` / `Research`), inspect the live cognition queue, retry backoff timers, per-job p50/p95 latencies, editable `$/1M` token cost estimator, and export/import world JSON snapshots.
- **Diagnostics**: Run `validateWorld()` structural checks and multi-day deterministic mock-LLM headless benchmarks inside a background Web Worker.

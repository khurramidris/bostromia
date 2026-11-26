# Bostromia (Smallville — Generative Agents) Workspace Rules

## Architecture & Stack
- **Frontend**: React 19, Vite 8, Tailwind CSS v4, Three.js (`src/components/iso3d/`), HTML5 Canvas (`src/components/SmallvilleMapCanvas.tsx`), Zustand-style client store (`src/store/smallvilleStore.ts`), Web Worker headless runner (`src/simulation/headless.worker.ts`).
- **Simulation Engine**: `src/simulation/` (18-resident rural town, `80×46` tiles, cognition scheduler, memory retrieval, psychology, social fabric, economy, institutions, paper experiments, world validation, deterministic mock LLM).
- **Server**: Express + Vite server in `server.ts` with helpers in `src/server/` (`rateLimit.ts`, `validate.ts`).
- **Runtime / Tooling**: TypeScript (`tsc --noEmit`), `tsx`, Node built-in `node:test`, `npm` / `bun`.

## Verification Commands
Run these after code changes (in order from fastest to fullest):
1. `npm run lint` — TypeScript check (`tsc --noEmit`)
2. `npm test` — All `node:test` suites (`tsx --test --test-concurrency=2 "src/**/*.test.ts"`)
3. `npm run build` — Production Vite bundle (`vite build`)
4. For targeted runs: `npx tsx --test <path/to/file.test.ts>`

## Project Invariants
- **Server-only secrets**: All API keys (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `APP_ACCESS_TOKEN`) belong strictly in `server.ts`. Never expose secrets to client bundles or commit `.env` / `.env.local`.
- **Determinism in tests**: Simulation and headless benchmarks under `src/simulation/*.test.ts` rely on `mockLlm.ts` and deterministic validation (`validateWorld.ts`); keep tests fast, offline, and deterministic.
- **Note on `npm run clean`**: `package.json` defines `rm -rf dist server.js` (POSIX); on Windows PowerShell, use `Remove-Item -Recurse -Force dist, server.js` if cleaning manually.

## Clean Ownership Boundaries for Parallel Agents / `/swarm`
When splitting work across parallel workers, separate along these non-overlapping tracks:
- **Simulation core**: `src/simulation/` (avoid concurrent edits to `types.ts` and `engine.ts` from multiple workers)
- **Server & API**: `server.ts` and `src/server/`
- **Client state & services**: `src/store/` and `src/services/`
- **UI views**: `src/components/`
- **3D isometric renderer**: `src/components/iso3d/`

---
name: blog-pipeline-dev
description: Use when doing development work in nextassist-blog-automation — adding or editing a pipeline stage agent, changing the orchestration in src/pipeline.ts, touching the AI provider layer, the JSON persistence files, or the "escritório" dashboard. Not for writing blog content itself.
---

# Blog Pipeline — Development Playbook

This repo runs a multi-agent pipeline (`src/pipeline.ts`) that researches,
writes, edits, and publishes one blog post a day for NextAssist, with a
live dashboard. This skill is the checklist for making code changes to
that pipeline safely and consistently. For deep architectural context, see
`.claude/agents/blog-pipeline-dev.md` (or delegate to that agent).

## Before changing anything

1. Read `src/pipeline.ts` end to end — it is short and is the map of the
   whole system (stage order, event shape, error handling).
2. Identify which layer you're touching:
   - **A stage agent** (`src/agents/*.ts`) — logic for one step.
   - **The orchestrator** (`src/pipeline.ts`) — sequencing, events, error
     isolation.
   - **A lib** (`src/lib/*.ts`) — shared infra (AI calls, storage, image
     gen, Instagram, Search Console, Firebase auth, data source).
   - **Persistence** (`src/contentCalendar.ts`, `history.ts`,
     `runsHistory.ts`, `performance.ts`, `conversions.ts` + their JSON
     files in the repo root).
   - **The dashboard** (`src/server.ts` + `web/public/app.js`).

## Adding a new pipeline stage agent

1. Create `src/agents/<name>.ts`:
   ```ts
   import { runAgent } from "../lib/anthropic.js";

   const SYSTEM = `...persona and instructions, in Portuguese...`;

   export async function myStage(...args): Promise<MyResult> {
     return runAgent({
       system: SYSTEM,
       prompt: `...`,
       useWebSearch: false, // true only for research-style stages
       maxTokens: 1500,
     });
   }
   ```
   Always go through `runAgent()` — never call the OpenAI/Anthropic SDKs
   directly. It handles the primary/fallback provider switch and usage
   tracking.
2. If the result needs structure, return typed JSON and parse it with
   `extractJson<T>()` from `src/lib/anthropic.ts`.
3. Register the stage in `src/pipeline.ts`:
   - Add its id to the `AgentId` union.
   - Call it inside `runPipeline()`, wrapped with `emit(onEvent, {agent,
     status: "working", ...})` before and `status: "done" | "error"`
     after, matching the existing try/catch structure.
   - If it's optional/best-effort (like Instagram), guard it on config
     presence and emit `status: "done"` with an explanatory message when
     skipped — never let an optional stage throw and abort a pipeline
     that already published the post.
4. If the dashboard should reflect the new stage, update
   `web/public/app.js` (`buildDesks()` / `renderKpis()` / related render
   functions) using the same Portuguese labels as `pipeline.ts`.
5. Add any new env vars to `src/config.ts`: `required("X")` for mandatory
   ones, `process.env.X ?? default` for optional ones. Add a one-line
   comment if the variable's purpose or default isn't obvious from its
   name.

## Persistence changes

State lives as flat JSON files in the repo root, each backed by a
`src/*.ts` module and read through `src/lib/dataSource.ts`, which has two
modes (`config.dataSource`): `"local"` (disk) and `"github"` (hosted
dashboard reads raw files from the GitHub repo). When adding/changing a
persisted field:
- Update the TypeScript type and the read/write logic in the matching
  module.
- Check whether the `"github"` read path in `dataSource.ts` also needs the
  change — the hosted dashboard doesn't share a filesystem with the
  pipeline runner.
- Don't reach for a database — flat JSON is the intended scale for this
  project.

## Conventions to match

- ESM + explicit `.js` extensions on relative imports, even in `.ts`
  source (`import { x } from "./y.js"`).
- No linter/formatter configured — mirror the exact style of the file
  you're editing rather than reformatting.
- User-facing strings and agent prompts are Portuguese (PT-BR).
- Error isolation: a non-critical stage failing must never take down an
  already-published post. Follow the Instagram step's pattern.

## Commands

| Purpose | Command |
|---|---|
| Run the pipeline once | `npm run run` |
| Start the dashboard | `npm run office` |
| Run tests | `npm test` |
| Build for production | `npm run build` |
| Run the built server | `npm start` |
| One-off SEO backfill script | `npm run update:seo` |

## Before calling it done

- `npm test` must pass.
- If you touched `pipeline.ts` or any stage agent, run `npm run run` as a
  smoke test (requires real API keys in `.env`) and confirm the affected
  stage's event/status looks right in the console or dashboard.
- If you touched the dashboard, open it (`npm run office`) and visually
  confirm the change.

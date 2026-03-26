# Development Plan

## Phase 0: Project Skeleton (sequential — must complete before all other phases)

Everything else depends on this. Sets up the repo, tooling, shared types, and test infrastructure.

- [x] Initialize `package.json` with pnpm, configure dependencies:
  - `@actions/core`, `@actions/github`, `cloudflare`, `jsonc-parser`, `yaml`
  - Dev: `vitest`, `typescript`, `@vercel/ncc`, `@types/node`
- [x] Create `tsconfig.json`
- [x] Create `action.yml` with all inputs/outputs defined
- [x] Create `src/types.ts` — all shared interfaces:
  - `WorkerConfig` (path, workingDirectory)
  - `D1Binding` (binding name, database_name, database_id, migrations_dir)
  - `WranglerConfig` (worker name, d1_databases)
  - `PreviewResult` (worker name, preview URL)
  - `DatabaseResult` (original name, preview name, preview ID, migrations applied)
  - `ActionInputs` (all parsed action inputs)
- [x] Set up vitest config
- [x] Verify the skeleton builds and tests run (even if no tests yet)

---

## Phase 1: Independent Modules (parallel — no cross-dependencies)

These four modules depend only on `types.ts` and external libraries. They can be built simultaneously by separate agents or in any order.

### Track A: `src/config.ts` — Parse Workers Input

Parse the YAML `workers` input into `WorkerConfig[]`. Handle both simple form (list of strings) and expanded form (objects with `path` + `working_directory`). Infer `working_directory` from config path when not specified.

Tests (`src/__tests__/config.test.ts`):
- [ ] Parses simple string list → `WorkerConfig[]` with inferred working directories
- [ ] Parses expanded object list → `WorkerConfig[]` with explicit working directories
- [ ] Parses mixed list (strings and objects)
- [ ] Resolves relative paths against repo root
- [ ] Throws on empty input
- [ ] Throws on invalid YAML

### Track B: `src/wrangler.ts` — Parse & Rewrite Wrangler Configs

Use `jsonc-parser` to extract D1 bindings and worker name from wrangler.jsonc, and to rewrite `database_id` and `database_name` fields in place.

Tests (`src/__tests__/wrangler.test.ts`):
- [ ] Extracts worker name from config
- [ ] Extracts D1 bindings (database_name, database_id, migrations_dir)
- [ ] Handles config with no D1 bindings → empty array
- [ ] Rewrites database_id and database_name for each binding
- [ ] Preserves comments in JSONC after rewrite
- [ ] Preserves formatting/whitespace after rewrite
- [ ] Handles multiple D1 bindings in one config
- [ ] Handles `.json` files (not just `.jsonc`)

### Track C: `src/d1.ts` — D1 Database Lifecycle

Wraps the Cloudflare SDK for D1 create/delete/list. Handles pagination, rate limiting with exponential backoff, and 404s on delete.

Tests (`src/__tests__/d1.test.ts`) — mock the Cloudflare SDK:
- [ ] `createDatabase` calls SDK with correct name and account_id, returns uuid
- [ ] `deleteDatabase` calls SDK with correct uuid and account_id
- [ ] `deleteDatabase` swallows 404 errors (already deleted), logs warning
- [ ] `deleteDatabase` rethrows non-404 errors
- [ ] `listPreviewDatabases` filters by `preview-pr-{N}-` prefix
- [ ] `listPreviewDatabases` paginates through all results
- [ ] Retries on rate limit (429) with exponential backoff, max 3 retries
- [ ] Fails after max retries exhausted

### Track D: `src/comment.ts` — PR Comment Management

Create or update a PR comment with the `<!-- cf-preview-stack -->` marker. Format active preview and teardown tables.

Tests (`src/__tests__/comment.test.ts`) — mock `@actions/github`:
- [ ] Creates new comment when no existing comment found
- [ ] Updates existing comment when marker found
- [ ] Formats active preview table with worker URLs and database info
- [ ] Formats teardown message
- [ ] Includes marker in comment body
- [ ] Skips commenting when `comment` input is `false`

---

## Phase 2: Composed Modules (parallel — depend on Phase 1)

These modules compose Phase 1 modules. They can be built in parallel with each other but require their Phase 1 dependencies to exist.

### Track E: `src/teardown.ts` — Database Teardown (depends on: Track C)

Orchestrates listing and deleting all preview databases for a given PR number.

Tests (`src/__tests__/teardown.test.ts`):
- [ ] Lists and deletes all databases matching PR prefix
- [ ] Handles no databases to delete (clean state)
- [ ] Continues deleting remaining databases if one delete fails
- [ ] Logs warnings for failed deletes, does not throw
- [ ] Returns list of deleted database names

### Track F: `src/preview.ts` — Migrations & Version Upload (depends on: Track B)

Shell out to `wrangler d1 migrations apply` and `wrangler versions upload --preview-alias`. Parse preview URL from wrangler output.

Tests (`src/__tests__/preview.test.ts`) — mock `child_process.exec`:
- [ ] Runs migrations for each D1 binding with a migrations_dir
- [ ] Skips migrations for bindings without migrations_dir
- [ ] Runs `wrangler versions upload --preview-alias pr-{N}` with correct cwd
- [ ] Parses preview URL from wrangler stdout
- [ ] Passes `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as env vars
- [ ] Throws on non-zero exit code with stderr in error message
- [ ] Returns `PreviewResult` with worker name and URL

### Track G: `src/cleanup.ts` — Orphan Cleanup (depends on: Track C, Track D)

List all preview databases, extract unique PR numbers, check GitHub API for open PRs, delete databases for closed PRs.

Tests (`src/__tests__/cleanup.test.ts`):
- [ ] Extracts unique PR numbers from database names
- [ ] Checks each PR's open/closed status via GitHub API
- [ ] Deletes databases for closed/merged PRs only
- [ ] Leaves databases for open PRs untouched
- [ ] Logs summary of cleaned-up PRs

---

## Phase 3: Orchestration & Integration (sequential — depends on all above)

### `src/index.ts` — Entry Point

Wire everything together. Read action inputs, dispatch to the correct lifecycle path based on event type.

Tests (`src/__tests__/index.test.ts`):
- [ ] On `opened` event: calls teardown → provision → migrate → upload → comment
- [ ] On `synchronize` event: same as opened
- [ ] On `reopened` event: same as opened
- [ ] On `closed` event: calls teardown → teardown comment
- [ ] On `cleanup: true`: calls cleanup logic
- [ ] Sets outputs: `preview_urls`, `database_ids`, `preview_alias`
- [ ] Deduplicates D1 databases shared across workers (same database_name)
- [ ] Handles worker with no D1 bindings (still uploads preview version)

### Build & Package

- [ ] `ncc build src/index.ts -o dist`
- [ ] Verify `dist/index.js` is generated
- [ ] Verify action runs with `node dist/index.js`

---

## Dependency Graph

```
Phase 0 (skeleton + types)
    │
    ├─── Phase 1A (config)
    ├─── Phase 1B (wrangler)  ──── Phase 2F (preview)
    ├─── Phase 1C (d1)        ──┬─ Phase 2E (teardown)
    │                           └─ Phase 2G (cleanup)
    └─── Phase 1D (comment)   ──── Phase 2G (cleanup)
                                      │
                               Phase 3 (index + build)
```

All Phase 1 tracks are fully parallel. Within Phase 2, tracks E/F/G are parallel with each other. Phase 3 is sequential and comes last.

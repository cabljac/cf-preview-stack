# cf-preview-stack

**Vercel-style preview environments for Cloudflare Workers + D1.**

One GitHub Action step. Isolated D1 databases per pull request. Preview versions of your existing Workers with stable aliased URLs. Automatic cleanup on merge/close.

---

## Overview

`cf-preview-stack` is a GitHub Action that gives Cloudflare Workers projects the same preview environment experience that Vercel and Netlify provide out of the box. For every pull request, it provisions isolated D1 databases, runs migrations, rewrites wrangler configs with preview database IDs, and uploads a preview version of each Worker using Cloudflare's native versioning system — then cleans up the databases when the PR closes.

It works *with* the Cloudflare platform, not against it. Worker previews use `wrangler versions upload --preview-alias`, which is Cloudflare's built-in mechanism for per-branch preview URLs. The action fills the gap that Cloudflare doesn't solve: the *stateful resource lifecycle* — creating and destroying isolated D1 databases (and eventually R2 buckets, KV namespaces) per PR so each preview version runs against its own data.

---

## How It Works With Cloudflare's Preview System

Cloudflare Workers already support preview versions natively:

- `wrangler versions upload` uploads a new version of a Worker *without* deploying it to production.
- The `--preview-alias` flag assigns a stable, human-readable URL: `<alias>-<worker-name>.<subdomain>.workers.dev`.
- Versions track code and config (including bindings), but *not* the state of storage resources like D1.

This action leverages that system. It does **not** create separate preview Workers or manage Worker lifecycle at all. Instead, it:

1. Creates ephemeral D1 databases and runs migrations against them.
2. Rewrites wrangler configs to bind to the preview databases.
3. Calls `wrangler versions upload --preview-alias pr-{N}` to create a preview version that uses the isolated data.

The result: your production Worker is untouched. The preview version runs at a stable URL like `pr-42-api.your-subdomain.workers.dev`, backed by its own database. When the PR closes, only the ephemeral databases are deleted — the preview version simply becomes stale and is eventually garbage-collected by Cloudflare.

---

## Goals

- **Zero-config for simple cases.** Point it at your wrangler configs, provide credentials, done.
- **Framework-agnostic.** Works with plain Workers, Astro, Remix, SvelteKit, Nuxt, Hono — anything that uses a `wrangler.jsonc` with D1 bindings.
- **Platform-native.** Uses `wrangler versions upload --preview-alias` — Cloudflare's own preview mechanism. No shadow Workers, no naming hacks.
- **Composable.** The action runs *after* your build step, so your existing CI pipeline doesn't change.
- **Stateless.** Every run tears down preview databases and recreates from scratch. No state files, no artifacts, no remote backends.
- **Focused.** Handles D1 lifecycle + preview version uploads. Does not try to be a general-purpose IaC tool.

## Non-Goals (v1)

- KV namespace provisioning (v2)
- R2 bucket provisioning (v2)
- Service binding rewriting between preview workers (v2 — document as known limitation)
- Seed data or production cloning (out of scope — migrations only)
- Custom domains or routes for preview versions
- Owning the build step
- Managing Worker lifecycle (Cloudflare handles this via versions)

---

## Usage

### Minimal (static wrangler config)

```yaml
name: Preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  preview:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write  # for PR comments
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/cf-preview-stack@v1
        with:
          cloudflare_api_token: ${{ secrets.CF_API_TOKEN }}
          cloudflare_account_id: ${{ secrets.CF_ACCOUNT_ID }}
          workers: |
            - ./api/wrangler.jsonc
            - ./web/wrangler.jsonc
```

### With a framework build step (Astro, Remix, etc.)

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - run: npm ci && npm run build
    if: github.event.action != 'closed'
  - uses: your-org/cf-preview-stack@v1
    with:
      cloudflare_api_token: ${{ secrets.CF_API_TOKEN }}
      cloudflare_account_id: ${{ secrets.CF_ACCOUNT_ID }}
      workers: |
        - ./wrangler.jsonc
```

### Monorepo with per-worker working directories

```yaml
steps:
  - uses: actions/checkout@v4
  - run: npm ci && npm run build --workspaces
    if: github.event.action != 'closed'
  - uses: your-org/cf-preview-stack@v1
    with:
      cloudflare_api_token: ${{ secrets.CF_API_TOKEN }}
      cloudflare_account_id: ${{ secrets.CF_ACCOUNT_ID }}
      workers: |
        - path: ./packages/api/wrangler.jsonc
          working_directory: ./packages/api
        - path: ./packages/web/wrangler.jsonc
          working_directory: ./packages/web
```

---

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `cloudflare_api_token` | Yes | — | Cloudflare API token with Workers Scripts and D1 permissions. |
| `cloudflare_account_id` | Yes | — | Cloudflare account ID. |
| `workers` | Yes | — | YAML list of wrangler config paths. Accepts a simple list of paths or objects with `path` and `working_directory`. |
| `github_token` | No | `${{ github.token }}` | GitHub token for posting PR comments. |
| `comment` | No | `true` | Whether to post/update a summary comment on the PR. |
| `wrangler_version` | No | `latest` | Wrangler version to install. Pin to a specific version for stability (e.g. `3.99.0`). |

### `workers` input format

**Simple form** — action infers `working_directory` from the config file's parent directory:

```yaml
workers: |
  - ./api/wrangler.jsonc
  - ./web/wrangler.jsonc
```

**Expanded form** — explicit `working_directory` (used as cwd for `wrangler versions upload` and migration paths):

```yaml
workers: |
  - path: ./api/wrangler.jsonc
    working_directory: ./api
  - path: ./packages/web/wrangler.jsonc
    working_directory: ./packages/web
```

---

## Outputs

| Name | Description |
|------|-------------|
| `preview_urls` | JSON object mapping worker name → preview `*.workers.dev` URL. |
| `database_ids` | JSON object mapping original database name → preview database ID. |
| `preview_alias` | The alias used for preview versions, e.g. `pr-42`. |

---

## Naming Convention

### D1 Databases

Preview databases use the pattern `preview-pr-{number}-{database_name}`.

Example: PR #42 with a D1 binding for `mydb` → database named `preview-pr-42-mydb`.

If two workers share the same D1 `database_name`, only one preview database is created and both workers' configs are rewritten to point to it.

### Worker Preview Aliases

Preview versions use the alias `pr-{number}`, producing URLs of the form:

```
pr-{number}-{worker-name}.{subdomain}.workers.dev
```

Example: PR #42 for a worker named `api` → `pr-42-api.your-subdomain.workers.dev`.

The worker itself is not renamed or duplicated. The alias is attached to a *version* of the existing production worker. This is how Cloudflare's preview system is designed to work.

---

## Lifecycle

### On `opened` / `synchronize` / `reopened`

```
1. TEARDOWN DATABASES
   - List all D1 databases matching `preview-pr-{N}-*` via Cloudflare SDK
   - Delete each one

2. PROVISION DATABASES
   For each worker config:
     - Parse wrangler.jsonc (using jsonc-parser)
     - For each D1 binding:
       - Create database `preview-pr-{N}-{database_name}` via Cloudflare SDK
       - Record the new database_id
     - Rewrite wrangler.jsonc on the runner's filesystem:
       - Replace each `database_id` with the preview database ID
       - Replace each `database_name` with the preview database name

3. MIGRATE
   For each worker config:
     - For each D1 binding with a `migrations_dir`:
       - Run `wrangler d1 migrations apply {preview-db-name} --remote`
         from the worker's working_directory

4. UPLOAD PREVIEW VERSIONS
   For each worker config:
     - Run `wrangler versions upload --preview-alias pr-{N}`
       from the worker's working_directory
     - Capture the preview URL from wrangler's output

5. COMMENT
   - Post or update a PR comment with preview URLs and database info
```

### On `closed`

```
1. TEARDOWN DATABASES
   - List all D1 databases matching `preview-pr-{N}-*` via Cloudflare SDK
   - Delete each one
   (No worker cleanup needed — preview versions are inert once
    their databases are gone, and Cloudflare garbage-collects
    old versions automatically)

2. COMMENT
   - Update the PR comment to indicate the preview has been torn down
```

### Why teardown-and-recreate?

Every push to the PR triggers a full database teardown and recreate. This is intentional:

- **No state to manage.** The action doesn't need to track what was previously provisioned.
- **No migration drift.** If someone edits a migration file mid-PR, it just works.
- **Idempotent.** If a previous run failed halfway, the next run cleans up and starts fresh.
- **Simple.** The logic is always: delete everything with this PR's prefix, then create everything.

The cost is ~10-15 seconds per database per push for creation and migration. For preview environments this is a non-issue.

---

## PR Comment

The action posts a single comment on the PR and updates it on subsequent pushes. The comment uses a hidden HTML marker (`<!-- cf-preview-stack -->`) so it can find and update itself.

### Active preview

```
⚡ Preview Stack — PR #42

| Worker | Preview URL |
|--------|-------------|
| api | `pr-42-api.your-subdomain.workers.dev` |
| web | `pr-42-web.your-subdomain.workers.dev` |

| Database | Preview Instance | Migrations |
|----------|-----------------|------------|
| mydb | preview-pr-42-mydb | 3 applied |

Last updated: 2026-03-26 14:30 UTC
```

### After teardown

```
⚡ Preview Stack — PR #42 (torn down)

Preview databases have been deleted. Preview URLs are no longer functional.
```

---

## Technical Implementation

### Language & Runtime

TypeScript, compiled with `ncc` into a single `dist/index.js` for the GitHub Action runtime.

### Dependencies

| Package | Purpose |
|---------|---------|
| `@actions/core` | Action inputs/outputs, logging |
| `@actions/github` | PR comment management |
| `cloudflare` | Cloudflare TypeScript SDK — D1 database create/delete/list |
| `jsonc-parser` | Parse and surgically edit wrangler.jsonc without destroying comments/formatting |
| `yaml` | Parse the `workers` input |
| `wrangler` (CLI) | Installed at runtime. Used for `d1 migrations apply` and `versions upload`. |

### Why these choices

**Cloudflare TypeScript SDK for D1 lifecycle** (not Terraform, not Pulumi) — the action's strategy is teardown-and-recreate, so there's no need for state management or declarative diffing. The SDK provides typed `create`, `delete`, and `list` calls for D1 databases, which is all we need. No state files, no remote backends, no extra tooling for users to install.

**`wrangler versions upload` for Worker previews** (not `wrangler deploy`) — this uses Cloudflare's native versioning and preview alias system. It uploads a new version of the *existing* production Worker without affecting production traffic. The `--preview-alias` flag gives each PR a stable URL. This means we don't create or delete Worker scripts at all — we just upload versions. Cleaner, less invasive, and aligned with how Cloudflare intends the platform to be used.

**jsonc-parser for config rewriting** (not JSON.parse, not wrangler internals) — wrangler's config parser is internal and not exported as a public API. `jsonc-parser` is the same library VS Code uses, handles comments and trailing commas, and provides `modify()` + `applyEdits()` for surgical edits that preserve the user's formatting.

**wrangler CLI for migrations** (not the SDK) — `wrangler d1 migrations apply` tracks which migrations have run. This is not available through the REST API. The action installs wrangler at runtime.

### Config Parsing & Rewriting

The action uses `jsonc-parser` to:

1. **Parse** the wrangler.jsonc to extract `name`, `d1_databases[].database_name`, `d1_databases[].database_id`, and `d1_databases[].migrations_dir`.
2. **Modify** the config in place using `modify()` which returns a set of text edits, then `applyEdits()` to apply them. This preserves comments, whitespace, and formatting.

Fields modified:
- `d1_databases[i].database_id` → the newly created preview database ID
- `d1_databases[i].database_name` → `preview-pr-{N}-{original-db-name}`

The `name` field is **not** changed. The worker keeps its original name because `wrangler versions upload` creates a version of the existing worker, not a new worker.

The original config is **not** committed or pushed — it's modified on the runner's filesystem only.

### Config Format Support

**v1: `wrangler.jsonc` and `wrangler.json` only.**

`wrangler.toml` is not supported in v1. Cloudflare recommends JSONC as the default config format going forward, and supporting TOML would require a separate parser and serializer that can preserve comments — significantly more complexity for a format that's being phased out. This will be documented clearly, with a note that TOML support may come in v2 if there's demand.

### Teardown Strategy

Teardown only needs to handle D1 databases. Worker versions are managed by Cloudflare and don't need cleanup.

```typescript
// List all D1 databases, filter by prefix
const allDbs = await cf.d1.database.list({ account_id });
const previewDbs = allDbs.filter(db =>
  db.name.startsWith(`preview-pr-${prNumber}-`)
);
for (const db of previewDbs) {
  await cf.d1.database.delete(db.uuid, { account_id });
}
```

This approach is stateless — no manifest or artifact needed. If a previous run partially failed, the next run will clean up whatever was left behind.

### Error Handling

- **Partial failures are reported, not rolled back.** If 2 of 3 workers upload successfully and the third fails, the action reports the failure but leaves the successful uploads in place. The user can fix the failing worker and push again, which triggers a full database teardown-and-recreate.
- **Teardown errors are logged but don't fail the action.** If a database was already manually deleted, the `delete` call 404s and we log a warning. The action continues.
- **API rate limits.** D1 database creation is rate-limited. For repos with many D1 bindings across many workers, the action adds a small delay between API calls. If rate-limited, it retries with exponential backoff (max 3 retries).

### Prerequisites

`wrangler versions upload` requires the Worker to already exist — you must have done an initial `wrangler deploy` at least once. This is a Cloudflare requirement, not something the action can work around. The README will document this clearly: your production Workers must already be deployed before the action can create preview versions of them.

---

## Orphan Cleanup

If a PR close event is missed (e.g., GitHub Actions outage), preview databases will be left behind. The README will include an example scheduled workflow for orphan cleanup:

```yaml
name: Cleanup orphaned previews
on:
  schedule:
    - cron: '0 3 * * *'  # daily at 3am

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: your-org/cf-preview-stack@v1
        with:
          cloudflare_api_token: ${{ secrets.CF_API_TOKEN }}
          cloudflare_account_id: ${{ secrets.CF_ACCOUNT_ID }}
          cleanup: true
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

When `cleanup: true` is set, the action:

1. Lists all D1 databases matching `preview-pr-{N}-*`
2. For each unique PR number found, checks via the GitHub API whether that PR is still open
3. If the PR is closed/merged, deletes all associated preview databases
4. Logs a summary of what was cleaned up

---

## Cloudflare API Token Permissions

The action requires an API token with the following permissions:

| Permission | Scope | Used for |
|-----------|-------|----------|
| Workers Scripts: Edit | Account | Uploading preview versions via `wrangler versions upload` |
| D1: Edit | Account | Creating and deleting preview databases |
| Account Settings: Read | Account | Listing D1 databases |

---

## Limitations (v1)

- **Worker must already exist.** `wrangler versions upload` requires a prior `wrangler deploy`. The action cannot create preview versions of Workers that have never been deployed.
- **Preview URLs are not generated for Workers with Durable Objects.** This is a Cloudflare platform limitation. If your worker uses DOs, preview URLs will not be available.
- **JSONC/JSON config only.** `wrangler.toml` is not supported. Cloudflare recommends JSONC going forward.
- **D1 only.** KV namespaces and R2 buckets are not provisioned. If your worker uses KV/R2, the preview version will bind to whatever is in the existing config (typically production resources). Use wrangler environments or environment variables to point at shared dev instances.
- **No service binding rewriting.** If worker A has a service binding to worker B, the preview version of A will still bind to production B, not the preview version of B.
- **No seed data.** Preview databases start empty with only migrations applied. There is no production cloning or snapshot restore.
- **No custom domains.** Preview versions are accessible only via `*.workers.dev` URLs.
- **Single account.** All workers and databases must be in the same Cloudflare account.

---

## Future Work (v2+)

- **KV namespace provisioning** — create/destroy KV namespaces per PR, rewrite bindings.
- **R2 bucket provisioning** — create/destroy R2 buckets per PR, rewrite bindings.
- **Service binding rewriting** — detect when multiple workers in the `workers` list reference each other via service bindings, and update the preview versions to point at each other.
- **`wrangler.toml` support** — if there's demand.
- **Seed scripts** — optional `seed_command` input that runs after migrations.
- **`setup_only` mode** — provision databases and output IDs without uploading versions, for pipelines where the build step needs the database ID (e.g., build-time type generation).
- **Branch-based naming** — option to use branch name instead of PR number for non-PR workflows.
- **Durable Object workaround** — explore using `wrangler deploy --name` as a fallback for Workers with DOs, since preview URLs aren't available for them.

---

## Project Structure

```
cf-preview-stack/
├── action.yml              # Action definition
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # Entry point — reads inputs, dispatches to lifecycle
│   ├── config.ts           # Parse workers input, resolve paths
│   ├── wrangler.ts         # Parse and rewrite wrangler.jsonc files
│   ├── d1.ts               # D1 database create/delete/list via Cloudflare SDK
│   ├── preview.ts          # Shell out to wrangler for migrations + versions upload
│   ├── teardown.ts         # Orchestrate database deletion
│   ├── comment.ts          # PR comment creation and updates
│   ├── cleanup.ts          # Orphan cleanup logic
│   └── types.ts            # Shared types
├── dist/
│   └── index.js            # ncc-compiled bundle (committed)
├── README.md
└── LICENSE
```

---

## Open Questions

1. **D1 database list pagination.** The Cloudflare API paginates D1 database lists. If an account has thousands of databases, listing and filtering by prefix could be slow. Should we paginate through all results, or is there a more efficient lookup?

2. **Database name length limits.** D1 database names may have character limits. `preview-pr-{N}-{database_name}` could exceed it if the original name is long. Should we truncate with a hash suffix, or fail with a clear error?

3. **Workers without D1 bindings.** If a worker in the `workers` list has no D1 bindings, should the action still upload a preview version of it (just without any database changes)? Probably yes — it's useful to preview code changes even without database changes, and the user explicitly listed it.

4. **First-time setup experience.** The action requires Workers to already exist (initial `wrangler deploy`). Should the README include a "bootstrap" workflow example that does the first deploy, or is that out of scope?

5. **Preview alias conflicts.** The alias `pr-{N}` is scoped per worker, so `pr-42` on worker `api` and `pr-42` on worker `web` don't conflict. But if a user manually uses `pr-42` as a preview alias outside this action, there could be a collision. Is this worth detecting, or just documenting?

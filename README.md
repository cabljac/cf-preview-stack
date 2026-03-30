# cf-preview-stack

Vercel-style preview environments for Cloudflare Workers + D1 + KV, packaged as a GitHub Action.

For every pull request, `cf-preview-stack` deploys isolated preview Workers backed by their own D1 databases and KV namespaces. Migrations run automatically. Everything is cleaned up when the PR closes.

## Usage

### Minimal

```yaml
name: Preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  preview:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: cabljac/cf-preview-stack@v1
        with:
          cloudflare_api_token: ${{ secrets.CF_API_TOKEN }}
          cloudflare_account_id: ${{ secrets.CF_ACCOUNT_ID }}
          workers: |
            - ./wrangler.jsonc
```

### With a build step

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - run: npm ci && npm run build
    if: github.event.action != 'closed'
  - uses: cabljac/cf-preview-stack@v1
    with:
      cloudflare_api_token: ${{ secrets.CF_API_TOKEN }}
      cloudflare_account_id: ${{ secrets.CF_ACCOUNT_ID }}
      workers: |
        - ./wrangler.jsonc
```

### Monorepo with multiple workers

```yaml
workers: |
  - path: ./packages/api/wrangler.jsonc
    working_directory: ./packages/api
  - path: ./packages/web/wrangler.jsonc
    working_directory: ./packages/web
```

### With the Cloudflare Vite plugin

If your build outputs a deploy-ready wrangler config (e.g. via `@cloudflare/vite-plugin`), use `deploy_config` to point at the generated config:

```yaml
workers: |
  - path: ./wrangler.jsonc
    working_directory: .
    deploy_config: ./dist/out/wrangler.json
```

### Injecting preview-specific secrets

Use the `secrets` input to inject environment variables into preview Workers. Values are written as `vars` in the wrangler config and masked in CI logs:

```yaml
- uses: cabljac/cf-preview-stack@v1
  with:
    cloudflare_api_token: ${{ secrets.CF_API_TOKEN }}
    cloudflare_account_id: ${{ secrets.CF_ACCOUNT_ID }}
    workers: |
      - ./wrangler.jsonc
    secrets: |
      {
        "AUTH_SECRET": "${{ secrets.PREVIEW_AUTH_SECRET }}",
        "API_KEY": "${{ secrets.PREVIEW_API_KEY }}"
      }
```

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `cloudflare_api_token` | Yes | - | Cloudflare API token with Workers Scripts, D1, and KV Storage permissions |
| `cloudflare_account_id` | Yes | - | Cloudflare account ID |
| `workers` | Yes | - | YAML list of wrangler config paths (see examples above) |
| `github_token` | No | `${{ github.token }}` | GitHub token for PR comments |
| `comment` | No | `true` | Post/update a summary comment on the PR |
| `wrangler_version` | No | `latest` | Wrangler version to install |
| `cleanup` | No | `false` | Run orphan cleanup mode instead of normal preview lifecycle |
| `secrets` | No | `{}` | JSON object of env var names to values, injected as `vars` in each worker config |

## Outputs

| Name | Description |
|------|-------------|
| `preview_urls` | JSON object mapping worker name to preview `*.workers.dev` URL |
| `database_ids` | JSON object mapping original database name to preview database ID |
| `kv_namespace_ids` | JSON object mapping original KV namespace ID to preview namespace ID |
| `preview_alias` | The alias used for preview versions, e.g. `pr-42` |

## How it works

### On `opened` / `synchronize` / `reopened`

1. **Teardown** existing preview D1 databases and KV namespaces for this PR
2. **Provision** new preview D1 databases and KV namespaces (deduplicated across workers)
3. **Rewrite** wrangler configs with preview resource IDs, worker name, workflow names, and injected secrets — written to a temp file so the original config is never mutated
4. **Migrate** D1 databases using `wrangler d1 migrations apply`
5. **Deploy** isolated PR workers via `wrangler deploy` (each worker is renamed to `<name>-pr-<N>` with `workers_dev` enabled)
6. **Comment** on the PR with preview URLs and resource info

### On `closed`

1. **Teardown** all preview D1 databases, KV namespaces, and PR workers
2. **Comment** that the preview has been torn down

### Why teardown-and-recreate?

Every push triggers a full teardown and recreate of preview resources. This keeps the action stateless, avoids migration drift, and makes partial failures self-healing on the next push.

## Naming conventions

| Resource | Pattern | Example (PR #42) |
|----------|---------|------------------|
| D1 database | `preview-pr-{N}-{database_name}` | `preview-pr-42-mydb` |
| KV namespace | `preview-pr-{N}-{binding_name}` | `preview-pr-42-MY_KV` |
| Worker | `{name}-pr-{N}` | `api-pr-42` |
| Workflow | `preview-pr-{N}-{workflow_name}` | `preview-pr-42-my-workflow` |
| Preview URL | `{name}-pr-{N}.workers.dev` | `api-pr-42.workers.dev` |

If two workers share the same D1 database or KV namespace, only one preview resource is created and both workers point to it.

## Orphan cleanup

If a PR close event is missed, preview resources will be left behind. Run a scheduled cleanup:

```yaml
name: Cleanup orphaned previews
on:
  schedule:
    - cron: '0 3 * * *'

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: cabljac/cf-preview-stack@v1
        with:
          cloudflare_api_token: ${{ secrets.CF_API_TOKEN }}
          cloudflare_account_id: ${{ secrets.CF_ACCOUNT_ID }}
          workers: |
            - ./wrangler.jsonc
          cleanup: true
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

This lists all `preview-pr-*` databases, checks if the corresponding PR is still open via the GitHub API, and deletes resources for closed PRs.

## Cloudflare API token permissions

| Permission | Scope | Used for |
|-----------|-------|----------|
| Workers Scripts: Edit | Account | Deploying preview workers |
| D1: Edit | Account | Creating and deleting preview databases |
| Workers KV Storage: Edit | Account | Creating and deleting preview KV namespaces |
| Account Settings: Read | Account | Listing databases and namespaces |

## Limitations

- **JSONC/JSON config only.** `wrangler.toml` is not supported.
- **D1 and KV only.** R2 buckets are not provisioned.
- **KV namespaces start empty.** No seed data or cloning mechanism.
- **No service binding rewriting.** Preview worker A will still bind to production worker B.
- **No seed data.** Preview databases start empty with only migrations applied.
- **No custom domains.** Preview workers are accessible only via `*.workers.dev` URLs.
- **Single account.** All workers must be in the same Cloudflare account.

## License

MIT

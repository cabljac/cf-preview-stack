# cf-preview-stack

Vercel-style preview environments for Cloudflare Workers + D1, packaged as a GitHub Action.

## Development Approach: TDD

**This project is developed test-first. Write tests before implementation.**

The workflow for every module is:
1. Write the test file with failing tests
2. Run the tests — confirm they fail
3. Write the minimum implementation to make tests pass
4. Run the tests — confirm they pass
5. Refactor if needed, re-run tests

Do not write implementation code without a corresponding test. Do not skip running tests after writing them.

## Commands

- `pnpm test` — run all tests
- `pnpm test src/__tests__/foo.test.ts` — run a single test file
- `pnpm build` — compile with ncc to `dist/`
- `pnpm typecheck` — run tsc with no emit

## Project Layout

- `src/` — all source code
- `src/__tests__/` — all test files, named `*.test.ts`
- `src/types.ts` — shared interfaces, no logic
- `dist/index.js` — ncc-compiled bundle (committed to repo)
- `action.yml` — GitHub Action definition
- `spec.md` — full product spec
- `PLAN.md` — phased development plan

## Key Technical Decisions

- **jsonc-parser** for wrangler config parsing/rewriting (preserves comments and formatting)
- **Cloudflare TypeScript SDK** (`cloudflare` package) for D1 database lifecycle
- **wrangler CLI** (installed at runtime) for migrations and version uploads
- **yaml** package for parsing the `workers` input
- **vitest** for testing
- **pnpm** as package manager

## Testing Guidelines

- Mock external dependencies (Cloudflare SDK, GitHub API, child_process) at the module boundary
- Test files live in `src/__tests__/` alongside the source
- Use `vi.mock()` for module-level mocks
- Test both success and error paths
- For wrangler.ts tests, use inline JSONC strings rather than fixture files where possible
- Use `test()` not `it()` for test blocks

## Conventions

- TypeScript strict mode
- No `as any` casts
- JSDoc on exported functions
- Minimal comments otherwise — code should be self-explanatory

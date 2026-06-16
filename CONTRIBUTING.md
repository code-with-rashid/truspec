# Contributing to TruSpec

Thanks for your interest! TruSpec is in early development — issues, ideas, and PRs are welcome.

## Development

Requires Node ≥ 22 and pnpm.

```bash
pnpm install
pnpm test          # vitest
pnpm typecheck     # tsc --noEmit across packages
pnpm build         # tsup → dist
pnpm gen:schema    # regenerate packages/core/schema/*.json from the Zod source
```

## Layout

- `packages/core` — the engine (`@truspec/core`): `format`, `runner`, `workspace`, `spec`, `importers`. No platform deps in the pure modules.
- `packages/cli` — the `truspec` command.
- `packages/mcp-server` — the MCP server for AI agents.

## Principles (please read before large changes)

1. **Open-source first** — no feature paywalls, no mandatory account.
2. **Local-first** — everything works offline; collections are plain text and the source of truth.
3. **Agent-native** — every capability is reachable via plain files, a `--json` CLI, and the MCP server.
4. **Refuse bloat** — speed and focus are the product. The deferred list (dashboards, flow builders, mandatory cloud, exotic protocols) needs an explicit decision before anyone builds it.

## Guidelines

- Write tests alongside changes (we keep coverage high). Run `pnpm test:coverage` to check.
- Keep the Zod schema in `packages/core/src/format/schema.ts` the source of truth; regenerate JSON Schema after format changes.
- Conventional-commit style messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Any breaking format change must bump `SCHEMA_VERSION` and ship a migration.

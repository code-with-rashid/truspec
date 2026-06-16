# Releasing

Published packages (versioned in lockstep): `@truspec/core`, `truspec` (CLI), `@truspec/mcp-server`.

1. Clean tree on `main`, CI green.
2. `pnpm install && pnpm build`
3. Authenticate to npm **once**:
   - interactive: `npm login`, or
   - token: add `//registry.npmjs.org/:_authToken=<TOKEN>` to `~/.npmrc`.
4. Dry-run: `pnpm -r publish --dry-run`
5. Publish (dependency order; `workspace:*` is rewritten to the real version automatically):
   ```bash
   pnpm -r publish --access public
   ```
6. Tag: `git tag v<version> && git push origin v<version>`

To bump: edit `version` in each package's `package.json` (keep them in lockstep), commit, then publish.

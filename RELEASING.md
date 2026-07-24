# Releasing

Published packages (versioned in lockstep): `@truspec/core`, `truspec` (CLI), `@truspec/mcp-server`, `@truspec/web`.

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

## Desktop app installers

`@truspec/desktop` stays `"private": true` and is **not** part of the npm lockstep set above (same
treatment as `packages/vscode`, which publishes to the Marketplace separately). Its version field
should still be bumped alongside the others for traceability, but there's nothing to `npm publish`.

Installers are built per-OS by the `.github/workflows/desktop.yml` matrix (Windows/macOS/Linux) on
every push to `main` — download them from that workflow run's artifacts and attach them to the
GitHub Release manually alongside the version tag above. They're **unsigned** (no code-signing
cert or Apple notarization yet — a deliberate v1 scope decision, see issue #23): call this out in
the release notes so users aren't surprised by an OS warning on first launch:

- **Windows**: SmartScreen will show an "unknown publisher" warning — Run anyway.
- **macOS**: Gatekeeper quarantines unsigned downloaded apps. Users need to run
  `xattr -cr /Applications/TruSpec.app` once before the app will open.
- **Linux**: no equivalent warning.

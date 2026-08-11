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

Pushing the `v<version>` tag (step 6 above) also triggers `.github/workflows/desktop-release.yml`,
which builds installers for Windows/macOS/Linux and opens a **draft** GitHub Release with them
attached, pre-filled with auto-generated notes from the merged PRs since the last tag. Someone
still needs to:

1. Open the draft release and write the actual highlights (what's in this release, why it
   matters) — the auto-generated PR-title list is a starting point, not the release notes.
2. Confirm the unsigned-build warning below is in there.
3. Click **Publish release**.

This is separate from `.github/workflows/desktop.yml`, which builds the same matrix on every push
to `main`/PR for CI validation but only uploads ephemeral workflow artifacts — those aren't
attached to a release and aren't what users download.

They're **unsigned** (no code-signing cert or Apple notarization yet — a deliberate v1 scope
decision, see issue #23): call this out in the release notes so users aren't surprised by an OS
warning on first launch:

- **Windows**: SmartScreen will show an "unknown publisher" warning — Run anyway.
- **macOS**: Gatekeeper quarantines unsigned downloaded apps. Users need to run
  `xattr -cr /Applications/TruSpec.app` once before the app will open.
- **Linux**: no equivalent warning.

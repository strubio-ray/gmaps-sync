# Homebrew Distribution Design

## Goal

Distribute gmaps-sync via Homebrew through the existing `strubio-ray/homebrew-tap`, and fix the fragile schedule path issue.

## Changes

### 1. Make repo public + MIT license

- Set repo visibility to public via `gh repo edit --visibility public`
- Add `LICENSE` file (MIT, copyright Steven Rubio)
- Update `package.json` license field from `"UNLICENSED"` to `"MIT"`

### 2. Homebrew formula

A Node.js formula in `strubio-ray/homebrew-tap/Formula/gmaps-sync.rb`:

- Downloads source tarball from GitHub release tags
- `depends_on "node"` for build and runtime
- `depends_on cask: "google-chrome"` for system Chrome (used by Playwright via `useSystemChrome: true`)
- Uses `system "npm", "install", *std_npm_args` for installation
- Symlinks the `gmaps-sync` binary into Homebrew's bin

### 3. GitHub Actions workflow

`.github/workflows/bump-homebrew.yml` triggered on `v*` tag push. Uses `mislav/bump-homebrew-formula-action@v3` with:
- `formula-name: gmaps-sync`
- `homebrew-tap: strubio-ray/homebrew-tap`
- `push-to: strubio-ray/homebrew-tap`
- `create-pullrequest: false`
- `download-url` pointing to the tag's source tarball
- `COMMITTER_TOKEN` secret (same `HOMEBREW_TAP_TOKEN` as vm-ward)

### 4. Fix scheduling.ts path resolution

Replace `process.argv[1]` with:
- `which gmaps-sync` via `execFileSync("which", ["gmaps-sync"])` for the binary path. Falls back to `process.argv[1]` if `which` fails (e.g., running via `tsx` in development).
- `process.execPath` for the node binary (always correct — it's the currently running node process).

### 5. Files

| File | Action |
|------|--------|
| `LICENSE` | Create (MIT) |
| `package.json` | Update license field to `"MIT"` |
| `.github/workflows/bump-homebrew.yml` | Create |
| `src/scheduling.ts` | Fix path resolution on line 19 |
| Repo visibility | Set to public via `gh repo edit` |

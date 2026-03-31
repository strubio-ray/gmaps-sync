# Homebrew Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute gmaps-sync via Homebrew (`strubio-ray/homebrew-tap`), fix the fragile launchd schedule path, and open-source the repo under MIT.

**Architecture:** Add MIT license and make the repo public. Create a GitHub Actions workflow that auto-updates the Homebrew formula on version tag pushes. Fix `scheduling.ts` to resolve binary paths via `which` instead of `process.argv[1]`. Push the initial formula to the tap manually; future releases are automated.

**Tech Stack:** Homebrew (Ruby formula), GitHub Actions, TypeScript

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `LICENSE` | Create | MIT license text |
| `package.json` | Modify | Set `"license": "MIT"`, remove `"private": true` |
| `src/scheduling.ts` | Modify | Resolve binary path via `which gmaps-sync`, use `process.execPath` for node |
| `.github/workflows/bump-homebrew.yml` | Create | Auto-update formula on `v*` tag push |

External (not in this repo):
| Action | Details |
|--------|---------|
| `strubio-ray/homebrew-tap` | Push initial `Formula/gmaps-sync.rb` |
| `strubio-ray/gmaps-sync` settings | Make public, add `HOMEBREW_TAP_TOKEN` secret |

---

### Task 1: Add MIT License and Update package.json

**Files:**
- Create: `LICENSE`
- Modify: `package.json`

- [ ] **Step 1: Create the LICENSE file**

Create `LICENSE` with the MIT license text:

```
MIT License

Copyright (c) 2026 Steven Rubio

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Update package.json**

In `package.json`, change `"license": "UNLICENSED"` to `"license": "MIT"` and remove the `"private": true` line.

- [ ] **Step 3: Commit**

```bash
git add LICENSE package.json && git commit -m "chore: add MIT license, mark package as public"
```

---

### Task 2: Fix scheduling.ts Path Resolution

**Files:**
- Modify: `src/scheduling.ts:17-30`

- [ ] **Step 1: Add a helper function to resolve the gmaps-sync binary path**

In `src/scheduling.ts`, add this function after the `xmlEscape` function (after line 15):

```typescript
function resolveBinPath(): string {
  try {
    return execFileSync("which", ["gmaps-sync"], { encoding: "utf-8" }).trim();
  } catch {
    // Fallback for development (running via tsx/npx)
    return process.argv[1];
  }
}
```

- [ ] **Step 2: Update generatePlist to use the new helpers**

In `src/scheduling.ts`, replace lines 18-19:

```typescript
  const logDir = join(homedir(), ".gmaps-sync", "logs");
  const binPath = process.argv[1];
```

With:

```typescript
  const logDir = join(homedir(), ".gmaps-sync", "logs");
  const nodePath = process.execPath;
  const binPath = resolveBinPath();
```

Then in the plist template, replace:

```typescript
        <string>node</string>
        <string>${binPath}</string>
```

With:

```typescript
        <string>${nodePath}</string>
        <string>${binPath}</string>
```

- [ ] **Step 3: Run type check**

Run: `npm run lint 2>&1`

Expected: No errors.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run 2>&1 | tail -10`

Expected: All tests pass (scheduling.ts has no tests, but ensure nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add src/scheduling.ts && git commit -m "fix: resolve binary paths via which for stable launchd scheduling"
```

---

### Task 3: Create GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/bump-homebrew.yml`

- [ ] **Step 1: Create the workflow directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create the bump-homebrew workflow**

Create `.github/workflows/bump-homebrew.yml`:

```yaml
name: Bump Homebrew Formula

on:
  push:
    tags: ["v*"]

jobs:
  homebrew:
    runs-on: ubuntu-latest
    steps:
      - uses: mislav/bump-homebrew-formula-action@v3
        with:
          formula-name: gmaps-sync
          homebrew-tap: strubio-ray/homebrew-tap
          push-to: strubio-ray/homebrew-tap
          create-pullrequest: false
          download-url: https://github.com/${{ github.repository }}/archive/refs/tags/${{ github.ref_name }}.tar.gz
        env:
          COMMITTER_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/bump-homebrew.yml && git commit -m "ci: add bump-homebrew workflow for automated formula updates"
```

---

### Task 4: Make Repo Public and Add Secret

This task requires manual steps by the user since it involves repo settings and secrets.

- [ ] **Step 1: Make the repo public**

```bash
gh repo edit strubio-ray/gmaps-sync --visibility public
```

- [ ] **Step 2: Add the HOMEBREW_TAP_TOKEN secret**

The `HOMEBREW_TAP_TOKEN` secret is set per-repo (it's on `vm-ward` but not `gmaps-sync`). The user needs to set it:

```bash
gh secret set HOMEBREW_TAP_TOKEN --repo strubio-ray/gmaps-sync
```

This will prompt for the token value. Use the same personal access token that `vm-ward` uses (needs `repo` scope for pushing to `strubio-ray/homebrew-tap`).

---

### Task 5: Push Initial Formula to Tap

The bump-homebrew action updates an *existing* formula. The initial formula must be created manually.

- [ ] **Step 1: Push all changes and create a version tag**

```bash
git push
git tag v0.1.0
git push origin v0.1.0
```

- [ ] **Step 2: Get the tarball SHA256**

Wait a moment for GitHub to generate the tarball, then:

```bash
curl -sL https://github.com/strubio-ray/gmaps-sync/archive/refs/tags/v0.1.0.tar.gz | shasum -a 256
```

Copy the hash output (first field).

- [ ] **Step 3: Create the formula in the tap**

Clone the tap (or use gh) and create `Formula/gmaps-sync.rb`:

```ruby
class GmapsSync < Formula
  desc "One-way sync from Google Maps saved places to local JSON"
  homepage "https://github.com/strubio-ray/gmaps-sync"
  url "https://github.com/strubio-ray/gmaps-sync/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "<PASTE_SHA256_HERE>"
  license "MIT"

  depends_on "node"
  depends_on cask: "google-chrome"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/gmaps-sync"
  end

  test do
    assert_match "gmaps-sync", shell_output("#{bin}/gmaps-sync --help")
  end
end
```

Replace `<PASTE_SHA256_HERE>` with the hash from Step 2.

- [ ] **Step 4: Push the formula to the tap**

```bash
cd <path-to-homebrew-tap>
git add Formula/gmaps-sync.rb
git commit -m "gmaps-sync 0.1.0 (new formula)"
git push
```

- [ ] **Step 5: Verify installation**

```bash
brew tap strubio-ray/tap  # if not already tapped
brew install strubio-ray/tap/gmaps-sync
gmaps-sync --help
```

Expected: Shows the CLI help output with commands: `init`, `pull`, `status`, `prune`, `schema-check`, `schedule`.

- [ ] **Step 6: Verify the bump-homebrew workflow ran**

```bash
gh run list --repo strubio-ray/gmaps-sync --workflow bump-homebrew.yml
```

Expected: Shows a completed (or skipped) run for the `v0.1.0` tag. On this first tag the formula already exists manually, so the action may report no changes — that's fine. Future tags will auto-update the URL and SHA.

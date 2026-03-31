# Replace Custom Scheduling with Homebrew Service DSL

## Goal

Replace the custom `scheduling.ts` launchd plist management with Homebrew's built-in `service` DSL, so that `brew services start/stop gmaps-sync` manages the launchd lifecycle and `brew uninstall` automatically cleans up.

## Changes

### 1. Add service block to formula

Add a `service` block to `strubio-ray/homebrew-tap/Formula/gmaps-sync.rb`. Use `run_type :cron` with `cron` string syntax (supported in Homebrew 4.x+):

```ruby
service do
  run [opt_bin/"gmaps-sync", "pull"]
  run_type :cron
  cron "0 6 * * *"
  log_path var/"log/gmaps-sync/pull-stdout.log"
  error_log_path var/"log/gmaps-sync/pull-stderr.log"
end
```

### 2. Add post_install migration hook

The old custom plist uses label `com.gmaps-sync.pull` at `~/Library/LaunchAgents/com.gmaps-sync.pull.plist`. The new Homebrew service uses label `homebrew.mxcl.gmaps-sync`. These are different — without migration, upgrading users get two launchd jobs running `pull` concurrently.

Add a `post_install` hook to detect the old plist and warn:

```ruby
def post_install
  old_plist = Pathname.new(Dir.home)/"Library/LaunchAgents/com.gmaps-sync.pull.plist"
  if old_plist.exist?
    opoo "Found old gmaps-sync scheduling plist at #{old_plist}"
    opoo "Remove it with: launchctl unload #{old_plist} && rm #{old_plist}"
    opoo "Then use: brew services start gmaps-sync"
  end
end
```

### 3. Add caveats

Use raw `launchctl` commands (not `gmaps-sync schedule --remove`, since that command will no longer exist after upgrade):

```ruby
def caveats
  <<~EOS
    To start the daily sync:
      brew services start gmaps-sync

    If you previously used `gmaps-sync schedule`, remove the old plist first:
      launchctl unload ~/Library/LaunchAgents/com.gmaps-sync.pull.plist
      rm ~/Library/LaunchAgents/com.gmaps-sync.pull.plist
  EOS
end
```

### 4. Delete scheduling.ts

Remove `src/scheduling.ts` entirely. The module is no longer needed.

### 5. Remove schedule CLI command

Remove the `schedule` command from `src/cli.ts`, including the `installSchedule`/`uninstallSchedule` imports.

### 6. Remove orphaned config fields

Remove `intervalHours` and `jitterMinutes` from `SyncConfig` in `src/types.ts` and from `DEFAULT_CONFIG` in `src/config.ts`. These were only meaningful for the custom scheduling and are now dead config.

The jitter logic in `cli.ts` uses `config.sync.jitterMinutes` — update it to use a hardcoded default (60 minutes) since the value is no longer user-configurable through this field.

### 7. Version bump

This is a breaking change (removes CLI command, removes config fields). Per SemVer 0.x rules, bump minor: `0.1.0` -> `0.2.0`.

- Update `version` in `package.json` to `0.2.0`
- Tag release as `v0.2.0` after pushing

### 8. Update docs

- **CLAUDE.md**:
  - Line 9: Update "Uses launchd for scheduling" to reflect Homebrew services
  - Supporting Modules: Remove `scheduling.ts` bullet
  - CLI commands list: Remove `schedule`
- **README.md**:
  - "Schedule daily sync" section: Replace with `brew services start gmaps-sync`
  - Commands table: Remove `schedule` row
  - Data layout: Remove `logs/` from `~/.gmaps-sync/` tree (logs now at Homebrew's `var/log/gmaps-sync/`)
  - Configuration: Remove `intervalHours` from example config

## What does NOT change

- `pull.ts`, `store.ts` — untouched
- Jitter behavior in `cli.ts` — stays as-is (detects non-TTY, applies random delay), but uses hardcoded default instead of config field
- `sync-state.json` / consecutive failure guard — stays as-is

## Files

| File | Action |
|------|--------|
| `src/scheduling.ts` | Delete |
| `src/cli.ts` | Remove `schedule` command, scheduling imports, update jitter to use hardcoded default |
| `src/types.ts` | Remove `intervalHours` and `jitterMinutes` from `SyncConfig` |
| `src/config.ts` | Remove `intervalHours` and `jitterMinutes` from `DEFAULT_CONFIG` |
| `package.json` | Bump version to `0.2.0` |
| `CLAUDE.md` | Update scheduling references |
| `README.md` | Update scheduling section, data layout, config example |
| `homebrew-tap: Formula/gmaps-sync.rb` | Add `service` block, `post_install` hook, `caveats` |

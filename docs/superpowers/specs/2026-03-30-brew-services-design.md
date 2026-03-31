# Replace Custom Scheduling with Homebrew Service DSL

## Goal

Replace the custom `scheduling.ts` launchd plist management with Homebrew's built-in `service` DSL, so that `brew services start/stop gmaps-sync` manages the launchd lifecycle and `brew uninstall` automatically cleans up.

## Changes

### 1. Add service block to formula

Add a `service` block to `strubio-ray/homebrew-tap/Formula/gmaps-sync.rb`:

```ruby
service do
  run [opt_bin/"gmaps-sync", "pull"]
  run_type :cron
  cron "0 6 * * *"
  log_path var/"log/gmaps-sync/pull-stdout.log"
  error_log_path var/"log/gmaps-sync/pull-stderr.log"
end
```

Add a `caveats` block for users migrating from the manual plist:

```ruby
def caveats
  <<~EOS
    To start the daily sync:
      brew services start gmaps-sync

    If you previously used `gmaps-sync schedule`, remove the old plist first:
      gmaps-sync schedule --remove
  EOS
end
```

### 2. Delete scheduling.ts

Remove `src/scheduling.ts` entirely. The module is no longer needed.

### 3. Remove schedule CLI command

Remove the `schedule` command from `src/cli.ts`, including the `installSchedule`/`uninstallSchedule` imports from scheduling.

### 4. Update docs

- **CLAUDE.md**: Remove `scheduling.ts` from Supporting Modules, remove `schedule` from CLI commands list.
- **README.md**: Replace the "Schedule daily sync" section with `brew services start gmaps-sync` instructions. Remove `schedule` from the commands table.

## What does NOT change

- `pull.ts`, `config.ts`, `store.ts` — untouched
- Jitter logic in `cli.ts` — stays as-is (detects non-TTY, applies random delay)
- `sync-state.json` / consecutive failure guard — stays as-is

## Files

| File | Action |
|------|--------|
| `src/scheduling.ts` | Delete |
| `src/cli.ts` | Remove `schedule` command and scheduling imports |
| `CLAUDE.md` | Remove scheduling.ts references |
| `README.md` | Update scheduling section to use `brew services` |
| `homebrew-tap: Formula/gmaps-sync.rb` | Add `service` block + caveats |

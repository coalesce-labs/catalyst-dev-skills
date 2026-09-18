# Scheduling: three platforms, one installer

`scripts/install-schedule.sh` never activates anything without observing that the activation
succeeded, and never writes a schedule it could not stage first.

- `--render <systemd|launchd|cron>` — prints the unit/plist/crontab block(s) to stdout. Writes
  nothing, activates nothing. The one mode a container with no scheduler installed can exercise.
- `--schedule daily|weekly` and `--retention-days N` — the cadence and the retention window the
  rendered form carries. When neither flag is given they come from the answer `offer-schedule.sh`
  recorded in `housekeeping.json`, and only then from the `daily` / `CATALYST_WORKTREE_STALE_DAYS`
  defaults. **The accepted answer is what gets installed**: accepting a weekly cleanup with a 30-day
  window renders `OnCalendar=weekly` and passes `CATALYST_WORKTREE_STALE_DAYS=30` into the run, on
  all three platforms. A recorded answer nothing reads would be bookkeeping, not a schedule.
- `--install [--platform <p>] [--root <dir>]` — renders, then writes. With `--root <dir>`, files are
  staged under `<dir>` and nothing is activated — the safe default for testing an installer. Without
  `--root`, files go to their real location and are activated. `--platform` overrides the
  `uname -s`-based auto-detection (`Linux` → systemd, `Darwin` → launchd, anything else → cron).
- `--uninstall [--root <dir>]` — removes exactly the files this skill's install wrote (or would have
  written under `--root`), deactivating first when not staged.
- `--status [--root <dir>]` — reports installed / not-installed, read back from the real system
  (`systemctl --user is-enabled`, `launchctl print`, `crontab -l`) rather than assumed from having
  once run install.

**Platform fallback.** If the detected or requested platform's scheduler binary is not on `PATH`,
installation falls back to `cron`; if `crontab` is unavailable too, the installer prints a named
reason and exits non-zero rather than reporting a schedule it did not actually install. This shape
is forced by measurement: no scheduler of any kind (`systemctl`, `launchctl`, `crontab`) exists in a
Catalyst Cloud phase container, so the installer must be fully testable through `--render` and
`--install --root` alone.

**Jitter.** Every rendering embeds a deterministic per-host jitter value (`cksum(hostname) % 60`, no
`$RANDOM`, no `Math.random`) so a fleet of machines installing the same schedule does not all wake at
once. The same host renders byte-identical output on every run; two different hosts render different
values.

**systemd** — `Type=oneshot`, `Nice=19`, `IOSchedulingClass=idle` (a janitor should never compete with
foreground work for CPU or I/O), `OnCalendar=` the accepted cadence with `Persistent=true` (a missed
run — machine was off — still fires at next boot) and a jitter-derived `RandomizedDelaySec=`.
`Environment=CATALYST_WORKTREE_STALE_DAYS=` carries the accepted window. `ExecStart` invokes this
skill's own `prune-worktrees.sh --apply` from wherever it is actually installed.

**launchd** — `RunAtLoad` is explicitly `false`. A janitor that reaps worktrees at every login is
exactly the surprise this skill exists to avoid. `Nice 19` and `LowPriorityIO true` mirror systemd's
niceness. `StartCalendarInterval` carries the jitter-derived minute, plus `Weekday 0` when the accepted cadence
is weekly; `EnvironmentVariables` carries `CATALYST_WORKTREE_STALE_DAYS`.

**cron** — exactly one line, between `# BEGIN catalyst-prune-worktrees` / `# END catalyst-prune-worktrees`
markers so a re-install replaces only that block and leaves the rest of the crontab untouched. The
line creates its log directory (`mkdir -p … && …`) before the append redirect: the shell evaluates a
`>>` redirect *before* it execs the command, so a line that only redirects dies on a host where the
directory does not exist yet — every run, silently. The directory follows `CATALYST_LOGS_DIR` when it
is set, and `$HOME` is left for cron's own shell to expand rather than baked in at render time.

**Headless build machines.** A systemd `--user` timer does not survive logout unless the account has
lingering enabled: `loginctl enable-linger $USER`, run once as the account (or root on its behalf).
`--status` reports the real, current state rather than assuming a prior `--install` still holds —
`enable-linger` is a prerequisite this skill documents, not one it can silently set for you.

**Dependency**: the removal guard needs `lsof` to prove a tree has no live handles under it
(`fail-closed.md`'s `live-handles` gate). A box with no `lsof` still runs safely — every otherwise
`REMOVE`-eligible tree instead reads `liveness-unprovable` and is kept, and the log names it, so a
full disk on such a box is diagnosable from the log alone rather than a silent no-op.

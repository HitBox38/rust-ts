REQUEST CHANGES

# Second re-check: harness batch bun-144, re-check round fixes (F1-r)

Independent re-check, 2026-11-11. Branch `t3/validate-bun-144-gate`, reviewed as `git diff 354cd63a..3307d88a`: commits
`f5375852` (the clone, the re-exec, the builder check, tests) and `3307d88a` (handoff §10). The earlier rounds were
`docs/reviews/bun-144.md` (branch `t3/review-bun-144-gate`) and `docs/reviews/bun-144-recheck.md` (branch
`t3/review-bun-144-recheck`, `61616354`). I tested with the tree detached at `3307d88a` and wrote this file on
`t3/review-bun-144-recheck2`.

**Conditions.**
- AC power (`pmset -g batt`: "Now drawing from 'AC Power'"), 1-minute load about 4, no gate running.
- `.env.local` copied from `integ-w39`, plus `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0` and
  `RUST_TS_AGENT=review-bun-144-recheck2`. `bun install --frozen-lockfile` done.
- `~/.bun/bin/bun` is 1.4.4 (`38afee6c8`, sha1 `7c1f29cd4051…`). I never touched it. My clones and fake Buns were in my scratch
  directory. Every `gate.ts run` used a temp `RUST_TS_DATA`. None got as far as `accept`. I made no `GATE_RUNNING` file.
- I made no mutants and edited no code. `git status` was clean apart from this file.

**The verdict in brief.** The clone and re-exec work as designed. Every child the gate starts as `process.execPath` now runs the
private copy. The builder check is applied in the real gate path, and `accept` does what was asked. But "every child" is not
true: the gate's two unit-test steps start a bare `bun` from 67 test files and one helper. Those resolve through `PATH` to
`~/.bun/bin/bun`, not the copy. I reproduced it. So a swap that is undone before the next reading can still reach an accepted
run through children, which is F1-r's own wording. The fix is about three lines in the first process (F1-rr). The rest is nits.

## What I reproduced

| check | result |
|---|---|
| `bun test ./scripts/gate-bun.test.ts` | 22 pass, 0 fail, 163 `expect()` calls (11.9 s) |
| The swap-and-restore test (`gateCloned("clone-swap-restore")`, read in full) | passes. The window child runs as `process.execPath` and prints `${Bun.version}+${rev9}`, its `execPath` ends in `/gate-bun/<sha12>/bun`, gate.json has `pass: true`, `bunClone.how: "clonefile"`, and `bunExec` readings of the copy. The copy is gone afterwards. |
| Runner unit step, driven as the gate drives it (`unitStaticSteps(UNIT_STEPS["runner unit tests"])` + `runStaticStep`), **started from an APFS clone** so `process.execPath` is a copy, as in a gate | pass: **468 tests, 0 failures, 0 skips** (junit), 80 s. Skips: 0 allowlisted, 0 not allowed. |
| `bunx tsc --noEmit -p .` | exit 0, 7 s |
| **Real `gate.ts run`, binary mode, forged builder record** (temp `RUST_TS_DATA`; I wrote `subject-bin/<key>/meta.json` with `bun: 1.4.3` for both `BINARY_ENTRIES`, keys computed from the clone path `<data>/gate-bun/7c1f29cd4051/bun`; `--suites check-rg --skip-static`) | exit 1, with one line: `ERROR: subject binary src/rust_ts/main.ts (81a00b96f16e, built by Bun 1.4.3 (c6da4a4d3010)), src/miri/bin/miri.ts (716697674744, built by Bun 1.4.3 (c6da4a4d3010)) was not built by the gate's Bun 1.4.4 (38afee6c84fc): …`. The builder found my forged builds, so the second process ran from the copy: the key holds `bunPath`. `gate-bun/` was empty afterwards. |
| Real `gate.ts run`, `RUST_TS_SUBJECT=source`, temp data (`--suites mir-o0 --skip-static`) | passed every start check (Bun pin, copy, re-exec, battery, provenance, oracle pin, probes) and reached `difftest` for the first suite (`gate.ts:719`), which then failed on the empty temp data dir, as expected. The copy was removed. |
| Signals and exit codes (real `gateBunClone`, temp data, second process sleeping) | SIGTERM to the first process reaches the gate; the gate exited 7 from its handler, and the first process exited **7** and removed the copy. A forged-record refusal gave exit 1. Bun's `exited` gives 143 for a SIGTERM-killed child, so a killed gate exits non-zero. |
| `accept`, temp data, from the real `gate-20261111-034856-root-qgwe/gate.json` (no `bun`, `bunExec` or `bunClone`) | three `note:` lines, the last `records no private copy of its Bun (gate.json from before \`bunClone\`)`, then the next check: `ERROR: … tested 103b447a5a but HEAD is 3307d88a72`. So it does not block. |
| … the same with `bunClone: null` | `ERROR: gate run gate-null did not run from a private copy of its Bun (… null: it was not started by \`gate.ts run\`); nothing accepted` |
| … the same with a `bunClone` record | no clone note. It goes on to the HEAD check. The next real gate is acceptable: the CLI always passes `bunClone` (`scripts/gate.ts:914`), and both gate.json writes include it. |

## Findings

**F1-rr. Bare `bun` children in the unit-test steps run `PATH`'s Bun, not the copy (must fix).**

Where: `gateBunClone` changes `process.execPath` but not `PATH` (`scripts/gate.ts:844`). These spawns resolve `"bun"` through
`PATH`:
- `harness/miri-ui.test.ts:96`, `:217`, `:313`: `Bun.spawnSync(["bun", "-e", …])`, in the **runner unit tests** step.
- 66 `*.test.ts` files under `src/`, in the **unit tests** step. Examples: `src/rustc_hir_typeck/method/probe.test.ts:34`,
  `src/rustc_span/hygiene_verbose.test.ts:19`, `src/miri/contract.test.ts:126`. Find them all with
  `grep -rlE '(spawn|spawnSync|run)\(\s*\[\s*"bunx?"' --include='*.test.ts' src`.
- `src/rust_ts/typeck_oracle_fixtures.ts:112`: `run(["bun", SUBJECT, …])`, the helper behind the `*.oracle.test.ts` fixture
  tests.

Many of these run the subject, the port itself, on that Bun and compare its output with fixtures. So their verdict depends on
the JS engine.

Evidence. From a scratch script, with `RUST_TS_DATA` set to a temp dir and a fake `bun` (a shell script) first on `PATH`. The
first process was started as `~/.bun/bin/bun` and called the real `gateBunClone()`:

```
second process execPath: …/data2/gate-bun/7c1f29cd4051/bun
process.execPath --revision: 1.4.4+38afee6c8
bare bun --revision: 1.4.5+0123abcde (PATH bun, not the clone)
bare bun, env spread: 1.4.5+0123abcde (PATH bun, not the clone)
```

With no fake on `PATH`, the same bare spawn ran `/Users/tomernorman/.bun/bin/bun`. I checked that from a clone, both
directly and inside `bun test`.

Why it matters. The static steps are a long window. In the last real gate (`gate-20261111-034856-root-qgwe`), they ran from the
start, 03:48:56 UTC by the run id (05:48:56 local), to the birth of `runner-unit-tests.junit.xml` at 05:57:27 local: about
8½ minutes, longer than the subject-build window behind F1-r. A swap and restore in that window (a lane trying the next Bun,
the scenario round 1 described) means `staticOk` of an accepted run comes partly from another Bun. gate.json `bunExec` and
`bunClone` would still say the children ran the copy. I found no write to the oracle cache or the subject-binary cache on
these paths (`REGEN` is unset in a gate). So the effect is on the unit-test verdict only, not the protected set. But it is
F1-r's "reached an accepted run through children", and it contradicts the guarantee in `scripts/gate.ts:37-41` and the
`scripts/lib/bun-pin.ts` header.

Fix (about three lines, all in the first process):
1. Put the copy's directory first on `PATH` in the second process's environment, at the spawn on `:844`, next to
   `GATE_BUN_CLONE_VAR`: `PATH: \`${home}:${process.env.PATH ?? ""}\``. It must be set there, in the spawn's `env`.
   Assigning `process.env.PATH` inside the second process is not enough, because `Bun.spawn`/`spawnSync` without `env`
   passes the environment the process *started* with (see N1).
2. Make a `bunx` symlink to `bun` in `home`. Bun dispatches on argv[0], so it works.

I tried this on a clone: with `PATH=<clone dir>:$PATH`, a bare `bun` child and a `{ ...process.env }` child both run the
clone, and `bunx --version` prints 1.4.4. Tests that build their own environment from `process.env` (`CHILD_ENV` in
`harness/miri-ui.test.ts:10-11`, `ENV` in `probe.test.ts:16`) carry `PATH` along.

Test: in `gateCloned`'s `swap-a` stub, also start a bare `["bun", "--revision"]` in the window. Give the test's environment a
`PATH` that starts with `<data>/bin`, where the swap happens, and assert that the bare child printed the gate's build. Without
step 1, the child prints `1.4.5+0123abcde`.

## Nits

**N1. The hand-off variable still reaches children started without `env`.** `delete process.env[GATE_BUN_CLONE_VAR]`
(`scripts/gate.ts:814`) hides it from `process.env`, `{ ...process.env }` and `common.ts` `run()`. It does not hide it from
`Bun.spawn`/`spawnSync` called without `env`, which pass the startup environment. Measured on 1.4.4:
`spawnSync default true`, `env: process.env false`, `env spread false`, `spawn default true`, and `node execFileSync false`.
In the second process, `Bun.spawnSync(["/usr/bin/env"])` printed `RUST_TS_GATE_BUN_CLONE`. Such calls exist on gate paths, for
example `scripts/lib/upstream.ts:14`, `harness/compiletest.ts:305` and `readBunExe`'s `--revision` spawn. None of those
children runs `gate.ts run`, so this is harmless today. But the comment "no child inherits it" (`:809`) and the test, which
looks only at `Object.keys(process.env)` (`scripts/gate-bun.test.ts:455`), overstate it. Two options:
- fix the wording, and make the test spawn `/usr/bin/env`;
- better, put the first process's pid in the variable and require `process.ppid` to match it. Then an inherited variable is
  refused, which also covers N2.

**N2. The spoof check accepts any file under `gate-bun/`.** The variable plus a run from a stale copy, for example one left
by a SIGKILLed first process (N4), passes `:816-819`. `gateRun` still checks the build and the content
(`gateBunRefusal`/`execBunRefusal`), so the build is right. Only the "private to this run" property is lost. The `ppid`
check in N1 closes this.

**N3. One path per build means two gates on one `RUST_TS_DATA` remove each other's copy.** `rmSync(home)` at `:830`, and
again at `:852`, deletes another live gate's copy of the same build. That other gate might be a second `gate.ts run` or an
orphan after a SIGKILL of its first process. It fails safe: the other run's next reading gets `sha1: null` and stops with
`ERROR:`, or its next spawn gets ENOENT. But it can end a 10 h gate. The content-addressed path is a reasonable choice: it keeps
subject-binary keys stable across gates. To keep it, refuse instead of removing: an `O_EXCL` pid file in `home`, and refuse
while a live pid holds it. Copies of other builds are never removed either. Once `~/.bun/bin/bun` is upgraded, a stale copy
holds its own 88 MB, so prune other `gate-bun/*` dirs that no live pid holds at start (5.8 GiB free on this host today).

**N4. Signals: document how to stop a detached gate.** SIGTERM and SIGHUP to the first process are passed on, and the copy is
cleaned up (verified). SIGINT is ignored by the first process. That is right for a terminal ^C, which reaches both processes,
but `kill -INT <pid>` of a detached gate's first process now does nothing. SIGKILL of the first process leaves the gate
running as an orphan, with the copy behind. One line in the header ("stop a gate with SIGTERM to the `gate.ts run` pid")
would do.

**N5. The purge command does not quote the cache path** (`scripts/lib/bun-pin.ts:112`). The command is otherwise correct. On
this host, `/usr/bin/find <dir> -type f -newerBt '<YYYY-MM-DD HH:MM:SS> UTC'` listed exactly the file born after the time, in
UTC and with `TZ=Asia/Jerusalem`. With `-delete`, it removed only that file. Cutting the milliseconds moves the cutoff up to
1 s earlier, which is the safe direction. Cache entries are written to a tmp file and renamed (`scripts/difftest.ts:371-372`),
so a new entry has a new birth time. But the path is pasted in unquoted. With a space in `RUST_TS_DATA`, for example
`/Users/x/my data`, the command walks `/Users/x/my` and the relative `data/oracle-cache`, and `-delete` would remove every file
born since the cutoff there. Quote it, for example with `'${cacheDir.replaceAll("'", "'\\''")}'`. Today's path has no space,
and after the clone this `ERROR:` should never fire.

**N6. `bun x tsc` runs the same TypeScript, but not on the gate's Bun.** It resolves `node_modules/.bin/tsc` → TypeScript
**7.0.2**, the same as `bunx tsc`. It still works with `PATH=/usr/bin:/bin`, so it does not download. But
`typescript/bin/tsc` starts with `#!/usr/bin/env node`, and `bun x` honors that: a test bin with that shebang ran under
`/Users/tomernorman/.nvm/versions/node/v22.16.0/bin/node`. That was so before as well, and tsc's result does not depend on the
runtime, so this is harmless. Only the comment at `scripts/gate.ts:577` ("as the gate's own Bun") overstates it.

**N7. Subject-binary keys now hold the copy's path.** A gate no longer reuses a binary that a lane built from
`~/.bun/bin/bun` for the same tree: one extra build per entry, and its disk. This is fine and follows from the design. It is
worth a line in the handoff because of disk space on this host.

**N8. The in-gate builder check is still not mutation-tested** (the lane says so). I showed above that it is applied in a real
`gate.ts run`. The forged-record setup is cheap: computing both keys took 2.5 s, and no binary is built. It could become the
missing test: forge `meta.json` with another `bun`, run `gate.ts run --skip-static` in binary mode, and expect the one
`ERROR:` line.

## What holds

- **The re-exec:** the copy is checked by hash and `--revision` before use (`cloneRefusal`); a bad copy gives one `ERROR:` line
  and no copy is left (tested); the plain-copy fallback has its note (tested); the second process checks its `execPath` and the
  directory (tested). argv and `execArgv` are passed on, the exit code is passed through, and signals are passed on as
  designed.
- **The window race of F1-r for `process.execPath` children:** closed. A swap of the original between the start check and
  `cp -c` is caught by the copy's sha1 check.
- **The builder check:** applied after `prepareSubject`, which resolves every `BINARY_ENTRIES` up front (`subject-bin.ts:710`),
  so no build is resolved later without the check.
- **`accept`:** as asked (table above).
- **N1, N2, N5, N6 of the last round:** done, apart from N2's overstatement (N6 here) and N5's quoting (N5 here).

## What the lane should do

1. **F1-rr:** put the copy's directory first on `PATH` (and a `bunx` symlink) in the second process's spawn `env`, and add a
   bare-`bun` assertion to the swap-and-restore test.
2. Optionally: the N1/N2 `ppid` check, N3 (a lock instead of `rmSync`, and pruning), N5 quoting, and the wording in N1, N4
   and N6.

APPROVE WITH NITS

# Third re-check: harness batch bun-144, second re-check round fixes (F1-rr, N1-N8)

Independent re-check, 2026-11-11. Branch `t3/validate-bun-144-gate`, reviewed as `git diff 3307d88a..9bf84f4f`: commits
`e71d868d` (fixes and tests) and `9bf84f4f` (handoff §11). Earlier rounds: `docs/reviews/bun-144.md`, `bun-144-recheck.md`,
`bun-144-recheck2.md` (branches `t3/review-bun-144-gate`, `-recheck`, `-recheck2`). I tested with the tree detached at `9bf84f4f`
and wrote this file on `t3/review-bun-144-recheck3`. Line numbers below are at `9bf84f4f`.

**Conditions.**
- AC power (`pmset -g batt`: "Now drawing from 'AC Power'"). 1-minute load 2-5. No gate running.
- `.env.local` copied from `integ-w39`, plus `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0` and
  `RUST_TS_AGENT=review-bun-144-recheck3`. `bun install --frozen-lockfile` done.
- `~/.bun/bin/bun` is 1.4.4 (`38afee6c8`, sha1 `7c1f29cd4051…`). I never touched it. Every swapped or fake Bun was an APFS
  clone or a shell script in my scratch directory.
- Each `gate.ts run` used a temp `RUST_TS_DATA`. None reached `accept`. I made no `GATE_RUNNING` file.
- I made one mutant (below) and reverted it at once. `git status` was clean apart from this file. Scratch removed.

**The verdict in brief.** F1-rr is closed. Every route by which a gate child can start a bare `bun` or `bunx` now reaches
the gate's private copy. I checked bare spawns, `/usr/bin/env bun`, `sh -c`, nested Bun children, `{ ...process.env }`
children and `bun x`. A child whose environment has no `PATH` gets ENOENT, which fails safe. I found no absolute
`~/.bun/bin/bun`, no `bun`/`node` shebang, no `npx`, and no gate path that sets `PATH` to a directory holding a Bun.

The hand-off, the prune, the purge command and the content-keyed builds all do what the handoff says. I found no way for a
wrong Bun to reach an accepted run, and no deletion outside `gate-bun/`. The nits below are about fail-safe edges.

## What I reproduced

| check | result |
|---|---|
| `bun test ./scripts/gate-bun.test.ts` | 25 pass, 0 fail, 186 `expect()` calls (12.7 s) |
| Mutant: the `PATH` prepend removed (`scripts/gate.ts:869` → `env: { ...process.env }`), swap test alone | fails: `Expected: "1.4.4+38afee6c8"`, `Received: "1.4.5+0123abcde"`. Reverted. |
| **Escape probe.** A scratch script calls the real `gateBunClone({ dir })`. The first process is an APFS clone of `~/.bun/bin/bun`, started with `PATH=<fake>:$PATH`, where `<fake>/bun` and `<fake>/bunx` print `FAKE-…-1.4.5`. From the second process: | `execPath …/gb/run-20038-ltkJzM/bun`, argv ends in `--gate-bun-clone=…/run-20038-ltkJzM/clone.json`. Results: bare `bun --revision` → `1.4.4+38afee6c8`; bare `bunx --version` → `1.4.4`; `/usr/bin/env bun` → 1.4.4; `sh -c "bun --revision"` → 1.4.4; `sh -c "bunx --version"` → 1.4.4; `env: { ...process.env }` → 1.4.4; `Bun.which("bun")` → the copy; a nested `bun -e` child's own bare `bun` → the copy; `bun x --bun tsc --version` → `Version 7.0.2`; `env: { FOO: "1" }` (no `PATH`) → `Executable not found in $PATH: "bun"`. The fake was never reached. The copy dir was removed at exit. |
| Runner unit step, driven as the gate drives it (`unitStaticSteps(runner unit tests)` + `runStaticStep`). Started from an APFS clone with `PATH=<clone dir, with bunx link>:<logging fake bun/bunx>:$PATH` | pass. junit: **471 tests, 0 failures, 0 skips**. Skips: 0 allowlisted, 0 not allowed under `RUST_TS_REQUIRE_PROBES=1`. 81 s. |
| 9 of the 66 `src` test files that spawn a bare `bun` (every 8th of the grep list: `late_a`, `suggestions_c.oracle`, `demand_adjust`, `check_attr_stability.oracle`, `locator.oracle`, `collect`, `wfcheck_a`, `lib.oracle` (ast_lowering), `builtins`). Same `PATH`, `bun test` from the clone | 309 pass, 0 fail. The logging fake was invoked **0** times. Control: `late_a.test.ts` with the fake first and no clone dir gives 3 fail, and the fake logged 3 calls (`bun …/src/rust_ts/resdump.ts …`). So the probe is sensitive. |
| `bunx tsc --noEmit -p .` | exit 0, 7.3 s |
| **Real `gate.ts run`, source mode.** Temp `RUST_TS_DATA` with only a symlink to the upstream checkout (read by `git status`). Command: `--suites mir-o0 --skip-static` | passed every start check and ran the suite: `ok mir-o0: protected=87 match=87/146 lost=0 gained=0`, `gate PASS`, exit 0. gate.json: `bunClone` = `{ path: …/gd/gate-bun/run-33150-GUnoMj/bun, from: ~/.bun/bin/bun, sha1: 7c1f29cd…, how: clonefile, parent: 33150 }`. `bunExec.start.path` is the copy, and start and end sha1 match. `gate-bun/` was empty afterwards. The upstream checkout stayed clean (0 porcelain lines). |
| Signals, real `gateBunClone`, second process sleeping | SIGTERM to the first process: first exits 143 (the test second has no handler), and the copy is removed. ^C simulated as SIGINT to the process group: exit 130, and the copy is removed. |
| Hand-off refusals (in the suite's `the gate's second process takes its copy only from its own parent's record` test, read in full) | the right record is accepted. A child's `/usr/bin/env` shows nothing of the hand-off. Refused, each with one `ERROR:`: a record naming another parent, a run not from the copy, and a record naming the machine's Bun. |

## Adversarial points

**1. F1-rr.** Closed: see the table.

Greps over `scripts`, `harness`, `tools` and `src`:
- Absolute Bun paths (`.bun/bin`, `/opt/homebrew/bin/bun`, `/usr/local/bin/bun`): only a comment in `scripts/gate-bun.test.ts:415`.
- `bun`/`node` shebangs: none.
- `npx`: none.
- Bare `"bun"` spawns outside tests: `scripts/lane.ts:27` and `tools/codegen/{icu-data,vendor-tables}.ts`. None of them runs in a gate. If a test ever reached them, they would resolve to the copy anyway.
- `src/rust_ts/typeck_oracle_fixtures.ts:112`: resolves to the copy.

Children that set `PATH`:
- `scripts/miri.test.ts:188,210,225` set `/nonexistent` or a temp dir, and spawn `process.execPath`.
- `scripts/miri.ts:111` prepends to `PATH`.
- `scripts/lib/bun-pin.ts:90` passes `PATH` through.
- Oracle and subject cases pinned by `pinSessionEnv` get `PATH=$CARGO_HOME/bin`. That directory holds no `bun` (checked). The subject is spawned by an absolute path, and no non-test `src` file spawns a bare `bun`.

So each of these either resolves to the copy or fails with ENOENT.

The static steps keep `PATH`:
- `run()` merges `process.env` (`scripts/lib/common.ts:102`).
- No `UNIT_STEPS` env sets `PATH`.
- `bun test` itself is `process.execPath` (`scripts/gate.ts:427`).

`tsc` runs on node and starts no Bun.

**2. The hand-off.**

*Spoofing.* To pass the checks, a caller must:
- write a record with its own pid as `parent`;
- put a Bun under `gate-bun/` beside the record;
- start that Bun as `gate.ts run --gate-bun-clone=<record>`.

That is deliberate forgery, not an accident. Even then, `gateRun` still checks the build and the file's content. So it cannot get a wrong Bun accepted.

*Robustness.*
- If the first process dies before the second validates, the second sees `ppid` ≠ `parent` and stops. That fails safe.
- If the first process dies after validation, the second runs on, because the check is made only at start.

*The prune* (`scripts/lib/bun-pin.ts:220`).
- It never removes a directory whose first process is alive.
- `EPERM` counts as alive.
- A dead owner pid that an unrelated process has reused only keeps the directory longer. That is safe, confirmed.
- A symlink entry is removed as a link. I tested a link to an outside directory holding `owner.json` with a dead pid: the target and its files stayed.
- A plain file in `gate-bun/` is removed after 10 min, inside scope.
- One case removes a running gate's copy: an orphan (see N1). It cannot lead to an accepted run.

**3. N5.** The command is only printed. It appears in the `bunExeChange` error text (`scripts/lib/bun-pin.ts:131`), and the gate
never executes it. `shellQuote` single-quotes the path and writes each `'` as `'\''`, so spaces, `$`, backquotes and newlines
are literal. `cd … &&` confines `find .` to the cache, and a failed `cd` runs nothing. The cache path is absolute, so it cannot
be taken for a `cd` option. The suite's space-in-path test passes, and it also has a `'` case.

**4. N7.**
- `subjectBinKeyOf` (`scripts/lib/subject-bin.ts:442`, `v: 4`) keys the Bun as `{ version, revision, sha1 }`.
- `builderBun()` (`:418`) computes that sha1 with `hash` = sha1 hex of the file (`scripts/lib/common.ts:141`). That is the same function `readBunExe` uses (`bun-pin.ts:83`), so the gate's comparison `builtByRefusal(…, bunExecStart.sha1)` (`gate.ts:678`) compares like with like.
- The path is replaced by a placeholder in both `bunPath` and the banner. So a Bun with other content gives another key and a rebuild.
- A lane's build from `~/.bun/bin/bun` with the same content and tree is reused. The forged-record gate test proves this end to end: keys computed from the machine's path are found by the gate running from its copy. It passed here.
- The baked `process.argv[0]` is read nowhere in `src`. I grepped `process.argv[0]`, `argv0` and `current_exe`. `src/std/env.ts` takes the arguments from the raw argv count and does not use argv[0]'s content.
- `spec.bunPath` is still used by the build-time smoke check (`subject-bin.ts:525`). There it is the builder's own `process.execPath`.

## Nits (none blocking)

**N1. The prune can remove an orphaned gate's live copy, and that orphan's bare `bun` then falls through to the machine's Bun.**

`owner.json` holds only the first process's pid (`scripts/gate.ts:848`). If the first process is SIGKILLed, the gate runs on
as an orphan, and the next `gate.ts run` prunes its directory as "gone". I reproduced this with the real `gateBunClone`:

```
note: removed …/gb/run-24435-qB2T92, the Bun copy of a gate that is gone
orphan reading after prune: sha1 null cannot read it (ENOENT …/run-24435-qB2T92/bun) …
orphan bare bun: 0 FAKE-bun-1.4.5
```

With the copy gone, `PATH`'s next entry wins. On a real host that is `~/.bun/bin/bun`.

This does not block, because such a run cannot be accepted:
- Every later reading is `sha1: null`, so the run fails.
- The end reading is always taken (`gate.ts:777`).
- `accept` requires the end sha1 to equal the start sha1 (`acceptBunExeRefusal`, `bun-pin.ts:200`).
- No oracle or cache path spawns a bare `bun` (only tests and the typeck fixtures helper do).

But it does end a long orphan gate. The header (`gate.ts:44`, "its copy behind until a later gate prunes it") does not say
that the prune kills it.

Fix (cheap): after the spawn, record `child.pid` in `owner.json` as well, and keep a directory while either pid is alive. Or
say in the header that a gate started while an orphan runs will end that orphan.

**N2. `pruneGateBunDirs` throws on an entry it cannot `stat`.** At `bun-pin.ts:230`, `statSync(dir)` follows links. Two cases
throw:
- a dangling symlink in `gate-bun/`, reproduced: `THROW ENOENT … stat '…/root/dangling'`;
- an entry that another gate's first process removes between the `owner.json` read and the `stat`.

Either one ends `gate.ts run` with a stack trace instead of an `ERROR:` line. That fails safe. Fix: use `lstatSync` inside the
existing `try`, and skip the entry on ENOENT.

**N3. `builtByRefusal` accepts a `meta.json` that has no `sha1`** (`bun-pin.ts:181`, `b.bun.sha1 !== undefined &&`). Every
real `v: 4` build records its sha1, and its key holds the sha1. So the only way to reach this is a meta written by hand.
Requiring the sha1 whenever the gate knows its own would remove the special case. Related point: the forged-record gate test
covers a version mismatch only. A sha1-only mismatch is unit-tested (`gate-bun.test.ts`, `builtByRefusal` case), not tested
in a real gate.

**N4. A `:` in `$RUST_TS_DATA` would split the copy's `PATH` entry** (`gate.ts:869`). `realHome` would then become two bogus
`PATH` entries, and a bare `bun` would fall through to the machine's Bun. Nothing else would show it, because `bunClone`,
`bunExec` and `execPath` would all be right. No real path has a `:` today. A one-line refusal when `realHome` contains `:`
would close it.

**N5. Disk.** The `v: 3` builds under the real `subject-bin/` can no longer be reached once `v: 4` keys are in use. Each is a
full binary. Worth a line in the handoff or a prune when this lands, since this host is short of disk (recheck2 saw 5.8 GiB
free).

## What holds

- The copy and the re-exec. The copy's directory and `bunx` link come first on `PATH`. Every child, through every resolution route, runs the copy.
- The hand-off is an argument that no child inherits. It is tied to the parent pid and confined to `gate-bun/`.
- Per-run directories, and a prune that never touches a live first process's directory or anything outside `gate-bun/`.
- Signals are passed on, and the copy is cleaned up after SIGTERM and after ^C.
- The purge text is quoted and confined. It is printed, never run.
- Content-keyed subject builds: a rebuild on other content, reuse on the same content, and an in-gate builder check tested through a real `gate.ts run`.
- The lane's mutation table is credible. I re-ran the most important mutant (the `PATH` prepend), and the test caught it.

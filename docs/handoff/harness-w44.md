# Handoff: harness-w44 (two gate checks, a frozen-lists sample, queued harness findings)

Branch `t3/harness-gate-checks`, on `main` at `5c884ab9`. A reviewed batch of `scripts/` and `harness/` changes (AGENTS.md §2), plus
perf-heavy's `0d4092c4` cherry-picked, a comment in `src/rustc_middle/ty/list.ts`, and `src/rust_ts/info_sites_check.ts`.
Host: root Mac, AC power, load 14 to 40 from other lanes. `RUST_TS_REQUIRE_PROBES=1`, `RUST_TS_AGENT=harness-w44`, `RUSTUP_AUTO_INSTALL=0`.
No gate run and no full protected suite. Every fix below has a test that fails without it (the mutation is named).

## Summary

| item | what | new gate cost |
|---|---|---|
| 1 | INFO-site checker fails loudly (fixers-45 F4), then becomes the static step `info sites` | 0.45 s |
| 2 | static step `frozen lists` (48 protected cases, lists frozen); `0d4092c4` cherry-picked; perf-heavy F2-F4 | 20-30 s at load 14-36 |
| 3 | tests for the `RESULT_METHODS` anchors and the stale run-dir cleanup (root-w42-check N4) | unit: about +0.1 s |
| 4 | F6: the two load-sensitive tests made robust; F7: a failed static step stops the gate before the suites | unit: case-lock +7 s, ir-normal about −5 s |
| 5 | `mir-o2`'s sysroot paths: per-case key part for rustc cases with `RUSTC_LOG` (4 cache keys, 1 protected; no `oracleKey`) | — |
| 6 | report suite `host-rlib` (222 cases, 222 MATCH); `*_DEPLOYMENT_TARGET` scrubbed | not in the gate |

Oracle keys: **all 60 protected suites have the same `oracleKey()` and case list on `main` and head** (details below). Every
`*.test.ts` under `scripts/` and `harness/` passes (411), `bunx tsc --noEmit -p .` is clean, `coverage.ts --check --offline` gives
`markers ok (24882; vendor 5286; library 606)`, marker order is clean under `src/rustc_monomorphize/`, and `bun test ./src/rustc_middle/ty ./src/rust_ts`
passes (325).

## Commits

| commit | what |
|---|---|
| `62ce4ca0` | item 1: checker fails loudly; `check()` exported with a unit test; `--out` |
| `ebd9ae85` | items 1, 2, 4 (F7) and perf-heavy F3: gate steps `info sites` and `frozen lists`, `scripts/frozen-lists.ts`, difftest `RunOptions.ids`, early stop, `freezeEnvRefusal` |
| `8f2586ca` | perf-heavy `0d4092c4`, cherry-picked unchanged |
| `9a323212` | perf-heavy F2-F4 in `list.ts`'s comment |
| `e6bfc4fd` | items 3 and 4 (F6) |
| `c8ca9c27` | item 5, **on its own so root can drop it** |
| `a4ef962b` | item 6: the scrub |
| `2233a7ef` | item 6: the suite |
| `aedbb859` | `gate.ts` header lines moved clear of unit-parallel's edit |

## 1. INFO sites

**Fail loudly** (`src/rust_ts/info_sites_check.ts`). Each of these used to count as "not ported" and pass. Each is now an `ERROR:` line and exit 1:
- a site whose enclosing fn the scanner cannot find (`<file>:0`, e.g. a module-level `macro_rules!` body) and that `SKIP` does not list;
- a fn with no marker at the scanner's line while the port marks a fn of that name in that upstream file at another line (the
  scanner and the marker disagree, so the sites would go unchecked);
- a `SKIP` entry that names no site (stale after an upstream move).

The check is now a function (`check(sites, marks, skip)`) with `src/rust_ts/info_sites_check.test.ts` (6 tests). `main` runs only
under `import.meta.main`, and `--out <dir>` picks the report directory. Mutations: dropping each of the three checks fails exactly its test.
Today's tree: `upstream INFO sites 136 (skipped 3); in ported fns 83; fns not ported 18`, the same counts as before, and no error.

**Gate step** `info sites`, after `marker order`: `bun src/rust_ts/info_sites_check.ts --out <run dir>/info-sites`.
It takes 0.45 s and needs only the upstream checkout. It writes only into the run directory.

## 2. Frozen lists, then `0d4092c4`

**The step** `frozen lists` (`scripts/frozen-lists.ts`, last static step) works like this:
- It takes 16 protected cases each of `mir`, `mir-o2` and `check-ui` (48 in all). They come from difftest's `sample` with the fixed seed `frozen-lists`, so every host and agent gets the same cases until a baseline grows.
- It runs them with `RUST_TS_FREEZE_LISTS=1`. The script sets it itself, and the gate step's env sets it too.
- Every case must MATCH. Anything else prints one `ERROR:` line per case and exits 1.
- difftest gained `RunOptions.ids` (cases by id, not for split suites), so the sample is drawn from protected cases only.
- Oracles come from the cache. The run goes to `$RUST_TS_DATA/runs/<gate run>-frozen-lists/`, a directory of its own, so it never touches the gate's own `<suite>.jsonl`.

| run | result | wall |
|---|---|---|
| today's tree, before the cherry-pick (load 36) | 48/48 MATCH, exit 0 | 22 s |
| after the cherry-pick (load 33) | 48/48 MATCH, exit 0 | 30 s |
| final head (load 14-24) | 48/48 MATCH, exit 0 | **20 s** |
| a write planted as the review planted it (`(r as T[])[0] = r[0]!` after `intern_slice` in `TyCtxt.slice_intern`) | **3/48 MATCH, 45 CRASH** (`TypeError: Attempted to assign to readonly property.`), exit 1 | 22 s |
| the same planted write, `difftest --suite mir --sample 10`, unfrozen | 10/10 MATCH: the plain suites miss it | — |
| the same planted write, `interning.test.ts` | 5 of 18 fail | — |

The plant was reverted, and `git status` was clean afterwards.

**Risk to watch.** Frozen, a heavy next-solver case runs about 22% longer. A sampled case near its limit would TIMEOUT, and with F7
that now stops the gate. The three TAIT cases are unprotected, so they cannot be sampled. `mir`'s and `check-ui`'s limit is 60 s and
`mir-o2`'s is 240 s. If a grown baseline brings a slow case into the sample, change the seed or exclude it in `frozen-lists.ts`.

**`0d4092c4`** cherry-picked unchanged (`8f2586ca`). With it, lists are unfrozen outside `bun test`, the alias checker and
`RUST_TS_FREEZE_LISTS=1`.

**F2-F4:**
- **F3** (the harness passes `NODE_ENV` / `RUST_TS_FREEZE_LISTS` to every subject). `gate.ts run` refuses to start while either is set (`freezeEnvRefusal`): one `ERROR:` line, before anything runs. The `frozen lists` step sets the variable for its own processes only.
  - `scripts/gate-power.test.ts` and `scripts/gate-probes.test.ts` now drop `bun test`'s `NODE_ENV=test` from their `gateRun` child.
  - Test: `scripts/gate-static-stop.test.ts`, two cases. Without the refusal, both fail.
- **F2** (`bun test` leaves `NODE_ENV` alone when it is already set). Written into the `FREEZE_LISTS` comment, with the tripwire and the refusal above.
- **F4** (what an unfrozen list does not stop). The comment lists every route the review found: index, `length`, `delete`, `Object.assign`/`defineProperty`/`Reflect.set`, `Array.prototype.<m>.call`, new own properties, and `setPrototypeOf`.
  - No panics were added. I measured `Object.preventExtensions` and `Object.seal` in Bun: they cost what `freeze` does (the same sparse storage: reads about 10x slower, 3x the heap on 200k 8-element arrays). They would also still let index writes, `length` writes and `sort.call` through. So the comment says this, and points at the gate step and the unit tests as what catches these writes.

`coverage.ts --missing compiler/rustc_middle/src/ty/list.rs`: 22/22.

## 3. Tests root asked for (root-w42-check N4)

- `scripts/lib/marker-check.test.ts`, "rustc-call on a Result method":
  - upstream `nll.rs:177:60` `.unwrap()` accepts the port's `unwrap_result(..)` and upstream's own `.unwrap()`;
  - it rejects `expect_result`, `unwrap_resultx`, and the anchor `177:39` inside `Algorithm::from_str`.
  - Mutations: no relaxation fails the first test; accepting every `RESULT_METHODS` name fails the `expect_result` test.
- `harness/miri-sysroot.test.ts`, the last test: a real run with a stub compiler, among `subject.run-{dead pid, live pid, abc, 0, 1}`, `oracle.run-<dead>` and `subject`.
  - Only the dead pid's directory of this side goes.
  - Mutations: no removal fails it; ignoring liveness fails it (and the existing concurrent-run test).

## 4. harness-w43 F6 and F7

**F6:**
- (a) `scripts/lib/case-lock.test.ts`: the re-run alone now has `timeoutMs: 10000`, not 3000, to start Bun and print. The pool's subject still sleeps 30 s, so it still times out. The test costs 7 s more.
- (b) `scripts/ir-normal.test.ts`, the orphan test: no fixed windows now.
  - The orphan writes its `.ll` only once a `go` file exists.
  - The run's holder entry is awaited with `until` (30 s), not 500 ms.
  - The next run is spawned, seen still blocked after 1 s, and only then is `go` created.
  - A correct run cannot flake. A broken one fails (mutation: no `addLockHolder` fails at the holder wait). The test dropped its `sleep 3` and `sleep 4`.

**F7.** What the gate did before: a failed static step printed `ERROR:` and set `staticOk = false`, and the gate **went on to run every
suite**, failing only at the end. Now, once the static steps have all run, a failure stops the gate before the suites:
- `ERROR: a static check failed; the N suite(s) are not run ...`;
- `gate.json` gets `pass: false`, `staticOk: false`, `suites: []`, and every suite in `notRun` with reason `a static check failed`;
- the run ends with `gate FAIL`.

The static steps still all run, so one run reports every static failure. `--skip-static` is unchanged.
- Test: `scripts/gate-static-stop.test.ts`, with `GateHost.staticChecks`, a test hook. With the hook set, the unit tests' probes are not required.
- Mutation: removing the stop fails the test.

## 5. `mir-o2`'s sysroot paths (w40c-audit N4)

**The problem.** `def-path-hash-ice-157238.rs` (`RUSTC_LOG=trace`) prints 121 locator paths under
`<oracle sysroot>/lib/rustlib/x86_64-unknown-linux-gnu/lib`. The case's key covers the rustc_driver build, but not the sysroot's path or
its file list. Another home, or another `rust-std` file set, would leave a stale cached oracle: a false loss.

**The fix, made (`c8ca9c27`).** `oracleCacheKey` adds `{ sysrootFiles }` only for a case of a rustc suite whose `Case.env` sets
`RUSTC_LOG` (`logsSysrootPaths`). That part is the sysroot's path, plus every file under each `lib/rustlib/<target>/lib` with its size,
hashed once per process.
- **No suite's `oracleKey()` changes.** Exactly 4 per-case cache keys change: `log-backtrace.rs` and `def-path-hash-ice-157238.rs` in `mir-o2` and in `mono-ui`.
- Only `mir-o2`'s `def-path-hash-ice-157238.rs` is protected. It MATCHes under its new key (the oracle was re-run, `--filter`). `log-backtrace.rs` stays `UNPORTED` (`rustc_log::BacktraceFormatter`), as before.
- The next gate re-runs 4 oracles, each under a second.
- The Miri copies are keyed by `miriOracleKey`, which already covers their sysroot.
- Test: `scripts/sysroot-key.test.ts`. Every other kind of case keeps its old key formula, and the mutant without the part fails.

**If root wants no per-case key change, drop `c8ca9c27`.** The alternative, hashing the sysroot into all of `mir-o2` (its
`oracleKey`), would re-run about 3,479 oracles and is not done.

## 6. `host-rlib` (report only)

**What it compiles.** `--crate-type rlib --emit=dep-info,metadata,link -Zcodegen-backend=dummy --sysroot <oracle sysroot> --out-dir out`.
Both sides run `scripts/host-rlib-run.ts`:
- It empties `<case dir>/work`. `<case dir>` must be an absolute `.../host-rlib/<16 hex>`; anything else is refused before anything is removed.
- It copies the case's sources in by base name, and runs each step (`--then` separates them) with cwd `work`.
- It prints the compiler's output, then every file under `out`: dep-info as text with the work dir spelled `$DIR`, and any other file as size and sha256.
- It keeps `out` as `<case dir>/<side>.out` for `cmp`.

**One fixed directory.** `<case dir>` is `$RUST_TS_DATA/host-rlib/<hash(case id)>`, the same for both sides, because the rmeta embeds the cwd and the source path.
- The suite has a `caseLock`.
- difftest now runs the two sides of any `caseLock` suite one after the other, under the lock, as it already did for IR suites (`s.irTier || s.caseLock`). No other suite has a `caseLock`.
- Test: a stub suite in `case-lock.test.ts`. The mutant that runs the sides at once gives DIFF.

**Cases (222).** On the root host (aarch64-apple-darwin):
- `nocore`, `nocore@x86_64-apple-darwin`, and `nocore@MACOSX_DEPLOYMENT_TARGET=` for `13.2`, `15.1.3`, `10.9` (the warning) and `abc` (the error, now that root's `ParseIntError` fix has landed);
- `std`;
- `extern`: `dep.rs`, then `user.rs` with `--extern dep=out/libdep.rlib`, each side loading its own dep;
- `rlib+staticlib`: the dummy backend drops `staticlib` with a warning, on both sides;
- 213 `tests/ui` files from `harness/host-rlib/ui.txt`. These are `generics/`, `structs/` and `traits/` files with only run-pass, build-pass, check-pass or edition directives, that pull in no other file and read no `env!`. Of 213 candidates, all 213 build on the oracle; only those that build are listed.

Sources are in `harness/host-rlib/`.

**Key and gate.** The key adds the wrapper, the rustc_driver build, `harness/host-rlib/*`, the case-dir root and the sysroot path.
There is no baseline, so the suite is not in the gate's default set. `oracleRuns` knows the wrapper, so `undeclaredRuns` passes.

**Result:** `difftest --suite host-rlib`: **222/222 MATCH**, 74 s at load about 20, oracles included.

**Scrub.** `scripts/lib/env.ts` scrubs `MACOSX_`, `IPHONEOS_`, `WATCHOS_`, `TVOS_` and `XROS_DEPLOYMENT_TARGET`. `SDKROOT` is not
scrubbed: only linking reads it. Test in `env.test.ts`; without the scrub it fails. **Scrubbing them changes no protected key or result:**
- keys never include the process environment; the key comparison below is unchanged on all 60 suites;
- no case of any suite sets one in `Case.env` (scanned: 0), and this host's environment has none, so `caseEnv` gives every case the same overlay as before;
- with `MACOSX_DEPLOYMENT_TARGET=10.9 IPHONEOS_DEPLOYMENT_TARGET=1.0` exported: `run-pass-aux-miri` (darwin target, aux rlibs) sample 30: 30 MATCH; `check-ui` sample 30: 30 MATCH; `host-rlib` `nocore*`: 6/6 MATCH;
- the same `host-rlib` run with the scrub reverted gives 2 DIFFs: `nocore` and `nocore@x86_64-apple-darwin` print the 10.9 warning that the cached oracle lacks. That is the cache poisoning the review predicted.

## Oracle-key comparison (all 60 protected suites)

**Method.** My own dump script, run in a scratch worktree of `main` (`5c884ab9`) and at head. For every registered suite it records:
- `oracleKey()`;
- a hash of the case list (id, args, env, file, with the repo path masked);
- every case's `caseOracleCacheKey`.

| | result |
|---|---|
| protected suites (baseline files) | 60 on both sides; 370,160 cases (runs) |
| `oracleKey()` | identical in all 60 |
| case lists | identical in all 60 |
| per-case cache keys | identical except item 5's 4: `mir-o2` and `mono-ui`, `log-backtrace.rs` and `def-path-hash-ice-157238.rs` |
| other suites | unchanged; `host-rlib` is new |

No baseline, `UPSTREAM.json`, suite definition of a protected suite, or oracle output was changed.

## Other samples (head, lists unfrozen)

`mir` 60, `mir-o2` 60, `mono-ui` 60: 180/180 MATCH. Also the samples in items 2 and 6.

## For the merge with `unit-parallel`

`scripts/lib/unit-steps.ts` is untouched. My `scripts/gate.ts` hunks (at head):
- the header, a new paragraph just before `accept`'s usage line (clear of the step list that unit-parallel rewrites);
- imports: `basename`, `HOST_RLIB_RUN`, `parseHostRlibRunArgs`;
- `GateHost.staticChecks` (the test hook);
- `freezeEnvRefusal`, after `REAL_GATE_HOST`;
- `checkProbes(suites, !skipStatic && gateHost.staticChecks === undefined)`;
- `oracleRuns` (the `HOST_RLIB_RUN` line);
- the two steps appended after `marker order`;
- in `gateRun`: the refusal at the top, and the early stop right after the static checks.

A trial merge with `t3/parallel-unit-tests` at `b0ad7466` (`git merge-tree`) is **clean**. In a scratch worktree, the merged tree
type-checks, and `gate-static-stop`, `gate-power`, `gate-probes`, `unit-steps` and `host-rlib` tests pass (25).

## For root

- Record the decisions:
  - `0d4092c4` re-landed with the `frozen lists` step (the 2026-11-07 decision's condition);
  - whether item 5's per-case key part stays;
  - `host-rlib` as a report suite.
- Name the two new static steps and F7's behaviour in `docs/agent-brief.md` or PORTING if lanes should run them before handing off (F7 noted that `marker order` is in neither). For example: `bun src/rust_ts/info_sites_check.ts`, and `bun scripts/frozen-lists.ts --per-suite 4` when a lane touches interning.
- `gate.json` of a stopped run has `suites: []` and `notRun` reasons `a static check failed`. `gate accept` already refuses it (`pass: false`).
- Scratch output: run directories `w44-*` and `frozen-lists-w44-*` under `$RUST_TS_DATA/runs`, and the case directories under `$RUST_TS_DATA/host-rlib/`. The new oracle cache entries are those of the 4 item-5 keys and host-rlib's 222.

## `unported(...)` and `// PORT:`

- No `unported(...)` added or left.
- The `PORT(perf)` comment on `FREEZE_LISTS` (`list.ts`) gained the F2-F4 paragraphs. No other `// PORT:` decisions.

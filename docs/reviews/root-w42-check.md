**Verdict: APPROVE WITH NITS.** Root's six commits and eight merges on `integ-w42` hold up against upstream, the oracle and both lanes' final content. No merge drops a lane's change, nothing of `0d4092c4` is in the tree, and no protected suite's oracle key or case list moves. N1 is the only finding with a real-world path: `verifyOraclePin` still asks `rustc +nightly` with auto-install on, so harness-w43 F1 is closed for `oracleHost`/`oracleSysroot` only, not "anywhere" as the commit says. Everything else is a nit.

# Independent check of root's commits and merges on `integ-w42` (lane `root-w42-check`)

Head checked: `integ-w42` at `8dc36b95`, against `main` at `26e61959`. Line numbers are at `8dc36b95`. Mutations and regen runs were in detached scratch worktrees (`182bbc02^`, `182bbc02`, `main`, `8dc36b95`), each reverted and then removed. This file is my only change to the tree. Host: the root Mac on AC power, load 2-24. `RUSTUP_AUTO_INSTALL=0` and `RUST_TS_REQUIRE_PROBES=1` were set throughout.

## Findings

| # | Severity | Where | Scenario | Evidence |
|---|---|---|---|---|
| N1 | Low | `scripts/lib/oracle.ts:26` (`verifyOraclePin`) | 0d7e46d7 gives `oracleSysroot`/`oracleHost` `RUSTUP_AUTO_INSTALL=0`, but `verifyOraclePin`'s `rustc +nightly -vV` still inherits the caller's env. It is the first oracle call of `difftest`, `gate`, `phase-diff`, `miri-diff`, `ctfe-sample`, `ir-diff` and `ir-tiers`. Take harness-w43 F1's scenario: a shell whose `RUSTUP_HOME` is the isolated Miri home runs `bun scripts/difftest.ts`. That call then lets rustup install today's `nightly` into that home, and the run dies afterwards on the pin check. The commit message ("can never install it anywhere") and `docs/next.md:529` ("root fixed F1-F5") overstate it | **Reproduced**: a logging fake `rustc` alone on `PATH` records `+nightly -vV RUSTUP_AUTO_INSTALL=unset` for `verifyOraclePin`, and `=0` for the other two |
| N2 | Nit, docs | `harness/suites.ts:1728`, `:1945` | harness-w43 F4 cited these lines, the `M6B` and `M6B_MIRI_PASS` strings (each suite's `criterion.what`, printed in its run). 0d7e46d7 changed the comments above them (`:1727`, `:1944`), and both strings still say `bun scripts/criteria.ts --run <gate run>` without `--milestone M6b`, which exits 1 on any gate because of `ir-hello`. `criterion` is not in any oracle key, so the strings can change freely | Read |
| N3 | Nit | `scripts/criteria.ts:196` | The group line prints `<n> oracle timeouts excluded` for every percent group. `ir-hello` now has `allCases`, so with 1 MATCH and 1 ORACLE_TIMEOUT it prints `MATCH 1/2 = 50% ..., 1 oracle timeouts excluded: not met`, but the timeout was counted, not excluded | Read (the counts are those of the new `criteria.test.ts` case) |
| N4 | Nit, test gap | `scripts/lib/marker-check.ts:62-74`; `scripts/miri-sysroot-run.ts:91-97` | Neither the `RESULT_METHODS` relaxation nor the stale run-directory cleanup has a unit test. Both behave correctly by my mutations below. A future edit that breaks either fails only in `coverage.ts --check` on `nll.ts`, or not at all | Reproduced by hand (see a368d33a and 0d7e46d7) |
| N5 | Nit, queue | `docs/next.md:512` | The queued `--emit=metadata` item names only an invalid value (`abc`, `99999`: the oracle errors and exits 1, the port exits 0). A too-low value is missing there as well: with `MACOSX_DEPLOYMENT_TARGET=10.5` the oracle prints the "minimum supported by `rustc` is 10.12" warning and the port prints nothing. Add it to the same item | **Reproduced** at `8dc36b95` |
| N6 | Nit | `scripts/miri-sysroot-run.ts:93-97` | The cleanup judges liveness in this host's pid namespace. A live run in a Linux VM or container that mounts the same `$RUST_TS_DATA` would look dead, and its directory would be removed under it. No such setup exists today; AGENTS.md section 5 plans one. Also, a run that loses the `differs` rename race keeps its directory under its own name by design (`:143`), and the next run of that crate and side now removes it | Read |

## Root's commits

### `182bbc02`: `ParseIntError` and `--print deployment-target`

- **Against upstream.** `print_crate_info`'s `DeploymentTarget` arm (`rustc_driver_impl/src/lib.rs:844-854`) prints `{env_var}={fmt_pretty}` and is otherwise `fatal`; the port does the same. `diagnostics.rs:183`'s `Invalid { error: ParseIntError }` is the only `ParseIntError` in rustc_session. `OSVersion::from_str` returns `rustc_abi`'s kind, and `display_ParseIntError` has core's three texts. Only unsigned parses happen here, so `NegOverflow` and `Zero` cannot arise. The `as unknown as` cast is gone.
- **Against the oracle** (stdout+stderr byte-equal, same exit code), on both `--print deployment-target` and `-Zcodegen-backend=dummy --crate-type rlib`, for 22 `MACOSX_DEPLOYMENT_TARGET` values. Valid: unset, `11.0`, `10.5` (warning), `10.12`, `10.12.6`, `14.2.1`, `15`, `256`, `+11`. Invalid: `""`, `abc`, `1.x`, `65536`, `1.256`, `+`, `11.`, `.5`, `1.2.3.4`, `99999999999`, Arabic-Indic digits, ` 11`, `11.0.300`. **44/44 same.** Also same: `x86_64-apple-darwin` (unset, `17.0`, `x`) and `x86_64-unknown-linux-gnu` (the fatal), 6/6. `aarch64-apple-ios` stops `unported` (its target spec is not ported, exit 70), an honest stop.
- **Module evaluation order.** I loaded every `src/**/*.ts` through a Bun preload plugin that logs each module as its body runs, at `182bbc02^` and at `182bbc02`. On `src/rust_ts/main.ts` (an rlib compile and `--print deployment-target`) the order is **identical, 2,092 modules**. On `src/miri/bin/miri.ts` it is also identical, 2,274 modules. `apple/mod.ts` and `rustc_abi/lib.ts` are already evaluated through `rustc_session` before the new imports, so they change nothing.

### `0d7e46d7`: harness-w43 F1-F5

- **F1 (`NO_INSTALL`).** It is right, and partial (N1). It cannot break a working oracle. If `nightly` is not installed, an auto-install would fetch today's nightly, never the pin (`nightly-2026-10-11`), and `verifyOraclePin` rejects that anyway. Now `oracleSysroot` dies with `cannot run oracle rustc +nightly --print sysroot` instead. The pin is installed explicitly (`rustup toolchain install` in `verifyOraclePin`'s message, `scripts/miri.ts:87` for the Miri home), and nothing relies on the auto-install. rustup here is 1.29.1, which honours the variable. A small nit: that die line drops rustup's stderr and does not name the install command.
- **F2 (stale run directories).** Reproduced with a scratch `RUST_TS_DATA` holding `core/subject.run-{1, <live sleep>, <dead>, 999999, abc, 0x1}`, `core/oracle.run-999999` and `core/subject`, then running `miri-sysroot-run.ts --crate core --side subject`. The two dead pids were removed. Kept: the live pid, pid 1 (`EPERM`), `0x1` (it parses to pid 1, alive), `abc`, the other side and the kept `subject`. A **live run cannot lose its directory** in one pid namespace. Its pid is alive for as long as the directory exists under its name: it is removed or renamed before the process exits. A reused pid can only *keep* a dead run's directory, a leak, not a loss. Two worktrees on one host share the namespace, so they are safe. The one exception is a separate pid namespace (N6). A spawn failure (my stub's `cwd` was missing) leaves `<side>.run-<pid>`, which the next run removes.
- **F3.** `of += s.total` with `allCases`: 1 MATCH plus 1 ORACLE_TIMEOUT is not met, 2 MATCH is (the new test passes). The printed line is N3.
- **F4.** Half done (N2).
- **F5.** `--require-clean ./src/rustc_monomorphize/` and `src/nope/` exit 1 with `ERROR: no marked TS file under ...`. The gate's literal `src/rustc_monomorphize/` exits 0. A non-directory prefix such as `src/rustc_monomorph` still matches, which is fine.

### `c2c9feb9`: fixers-46 F1, F3, F5

- **F1 is pinned.** In a scratch worktree I reverted `intrinsicck.ts:129` to `sk._0.bytes() === Primitive.size(..).bytes()`, and `aarch64.oracle.test.ts` then **fails**: `big_err.rs` stops on `Size beyond 2^53`. At head it passes (2/2). The new case produces E0512, not E0591: the 2^53-byte target is not pointer-sized, so the special case's `Size_eq` returns false. That is the comparison the review wanted pinned.
- **F3 is safe.** `ice_message` (`aarch64_oracle/common.ts:32`) matches `\(\d+\)`, so `(0)` reads. Running `regen.ts` at `8dc36b95` with the real oracle **changes no fixture** (`git status` clean).
- **F5.** Comment only; it matches the code (`:104`).

### `a368d33a`: `RESULT_METHODS` in the marker check

- `coverage.ts --check`: `markers ok (24882; vendor 5286; library 606)`. `marker-check.test.ts`: 26 pass.
- **Loop structure.** The inner `return` leaves the `forEach` callback, so the first call of any accepted name on the next line accepts the anchor; otherwise control falls through to the error. That is right.
- **Tightness.** I mutated `nll.ts` and called `anchorErrors` each time:

  | Mutation | Result |
  |---|---|
  | head | `[]` |
  | `unwrap_result` → `expect_result` under the `unwrap` anchor | rejected |
  | → `unwrap_resultx` | rejected |
  | anchor `177:39` (`from_str`, a path call) | rejected |
  | anchor `172:67`, the other `.unwrap()` in `compute_regions` | **accepted** |

  The last is the module header's known wrong-sibling limit (review N3), which any name already has. The relaxation adds no new kind of false accept: the upstream side still has to be a call of that exact name at that exact position, and only the two TS names the runtime resolver maps are added. N4 covers the missing test.
- **Against the oracle.** I ran `-Zpolonius=legacy --emit=metadata` on a bin and on a lib, with the port given `--sysroot "$(rustc +nightly --print sysroot)"`. With `POLONIUS_ALGORITHM=bad` and with an empty value, both sides panic at `compiler/rustc_borrowck/src/nll.rs:177:60:` with `called \`Result::unwrap()\` on an \`Err\` value: "valid values: Naive, DatafrogOpt, LocationInsensitive, Compare, Hybrid"`, exit 101. Aside from backtrace frames, thread ids and the ICE file's pid, the only differing line is the port's `rust-ts prints the JS stack` note, as for every ICE. `Naive`, `Hybrid` and unset: all **same**.

### `2607c260` and `8dc36b95`: records

- `docs/state/current.json` changes only `updated`, and its protected counts equal the baselines. The two `history.jsonl` decisions match the reviews: `perf-heavy.md` "DROP as it stands"; the codegen typemap change and `rust-log.rs`. `rust-log.rs` MATCHes alone at head (`--filter rust-log`, 1/1).
- `docs/next.md`: the wave 40c table statuses are true, apart from "root fixed F1-F5" (N1, N2). The line-503 item now says the temp-dir path and `POLONIUS_ALGORITHM`'s location are done. Both are true (fixers-45's `with_err_path` is merged; the anchor is back and matches). The new queue lines match the reviews they cite. Line 512 is true but incomplete (N5). The perf-heavy line is accurate.

## Merge resolutions

For each of the 8 merges I recomputed `git merge-tree --write-tree <p1> <p2>` and diffed it against root's merge. **Every file git merges cleanly equals root's result.** The exceptions are the conflicted files below and `fs.test.ts` in `05b2df2c`.

- **`scripts/miri-sysroot-run.ts` (`1ec94304`).** `git diff fb984fe4 8dc36b95` (against fixers-46's head) shows exactly harness-w43's per-run directory plus F2. `git diff fb9ce9f4 8dc36b95` (against harness-w43's head) shows exactly fixers-46's `sources` loop (`writeFileSync`, `dirname`) plus F2. Nothing is dropped. `sources` are written into `inv.cwd` (the crate's manifest directory), not into the per-run directory, as fixers-46 intended.
- **`src/rustc_metadata/fs.ts` (`05b2df2c`).** It differs from fixers-45's `eff41b07` only by fixers-46's N5/N6 sentences in the doc comment. fixers-45's `tempdir_in`, `tmpname`, `with_err_path`, `NUM_RETRIES` and `NUM_RAND_CHARS` are unchanged, and fixers-46's `randomBytes` import and `TEMPFILE_*` consts are gone. This is exactly `docs/reviews/fixers-45.md` section 5. Root's change to fixers-46's `fs.test.ts` is the section 5 patch verbatim, and the test passes.
- **`src/rustc_data_structures/sharded.ts` (`c404dd5f`).** It has both fixers-45's `keys()` and perf-heavy's `share_elements`/`shared_elements`, unchanged. `context.ts` equals the clean merge.
- **`scripts/gate.ts`.** It is identical to harness-w43's head (`git diff fb9ce9f4 8dc36b95 -- scripts/gate.ts` is empty) and merged cleanly.
- **Review-branch merges** (`262f9e7e`, `4919bcf4`, `a0c1d5fa`). Each adds only its `docs/reviews/<lane>.md`. `docs/reviews/perf-heavy.md` equals the reviewer's `d365a151`, and `docs/handoff/perf-heavy.md` equals `c6031afb`.
- **Branches.** `t3/harness-w43-findings`, `t3/fixers-46-abi-miri-test-gaps`, `t3/fix-rustc-findings-logging`, `t3/review-object-write-macho`, `t3/port-macho-object-writer` and the `t3/review-*` branches have no commit outside `integ-w42`. `t3/perf-heavy` has only `c6031afb` (its handoff, copied as text) and `0d4092c4` outside it.
- **`0d4092c4` is absent.** `0d4092c4` is not an ancestor. `FREEZE_LISTS`, `LIST_MUTATORS` and "an interned list is immutable" occur nowhere in `src/`, `scripts/` or `harness/`. `src/rustc_middle/ty/list.ts` is unchanged from `main`, and `:48` is still the unconditional `return Object.freeze(list)`. Lists are frozen as before.

## Whole branch

- `git diff main..integ-w42 -- harness/baseline`: **empty**.
- **Oracle keys and case lists.** For all 70 suites in `SUITES`, at `main` and at `8dc36b95`, I hashed `oracleKey()`, `cases()`, `skipped()`, timeouts and the oracle argv of the first case (the whole batch for batch suites), with the worktree path normalized. **Only `ir-hello` and `miri-sysroot-core/-alloc/-std` differ, in `oracleKey` only. All 60 protected suites are identical.** Before normalization, 12 protected suites differed in argv; I confirmed that is only the checkout path in the wrapper command.
- `bunx tsc --noEmit -p .`: exit 0. `bun test ./scripts ./harness`: **394 pass, 0 fail** (36 files). Also passing: `aarch64.oracle.test.ts` 2/2, `fs.test.ts` 2/2, `marker-check.test.ts` 26/26.
- **Samples of 100** (`RUST_TS_AGENT=root-w42-check`):

  | Suite | Result |
  |---|---|
  | `mir` | 100/100 MATCH |
  | `check-ui` | 100/100 MATCH |
  | `mono-ui` | 100/100 MATCH |
  | `rmeta-ui` | 100/100 MATCH |
  | `run-pass-aux-miri` | 100/100 MATCH |

  No DIFF, CRASH, TIMEOUT or ORACLE_TIMEOUT.

## What I did not check

- The gate, any full suite, and the full `bun test ./src`.
- Windows and Linux.
- Any Apple target other than the two darwin ones.
- The lanes' own code beyond what these merges and root's commits touch; their reviews cover it. That includes object-write-macho's Mach-O writer, fixers-45's `RUSTC_LOG` work and perf-heavy's `90fad7d0` logic.
- The `miri-sysroot-*` suites' new oracle keys (report only).
- A SIGKILL-left directory with a real Miri sysroot build: I used a stub compiler.
- Whether the harness's ICE normalization covers the `rust-ts prints the JS stack` line: it did for earlier ICE cases.

## Side effects

- In the shared data root: my difftest run directories under `runs/` (`*-root-w42-check-*`), the oracle cache entries those runs wrote, `coverage-order.txt` (rewritten by `coverage.ts --order`, as every such run does), and `tmp/aarch64-abi-oracle/root-w42-check/` (from `regen.ts`).
- Everything else was under my scratchpad. The four scratch worktrees are removed.
- Every process I started has exited.

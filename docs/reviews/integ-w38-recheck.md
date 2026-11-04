# Independent re-check: root's own commits on `integ-w38`

Branch `integ-w38`, head `74672b67`. Read-only, last review before the M6b gate. Run with `RUST_TS_REQUIRE_PROBES=1`, no gate and no
full suite. Mutations ran in a scratch worktree, since removed.

## Verdict: APPROVE WITH NITS

Root's commits do what they say. Both reproducers from `miri-perf` now match the oracle byte for byte, and no packed key has the same
problem. No DIFF or CRASH on a protected case in any sample. Nothing here blocks the gate, but read P1 before starting it.

| id | severity | where | what |
|---|---|---|---|
| F1 | medium, not a regression | `src/rustc_middle/mir/pretty.ts:174`, `:2273` | A Miri pointer fragment in an allocation dump prints `a[object Object]`: one DIFF in `miri-fail`, report only |
| P1 | medium, process | `scripts/gate.ts:316`, `:466`; `harness/suites.ts:1909` | A bare `gate.ts run` omits 3 of the 5 M6b suites, so about 10 h ends with "not met" |
| N1 | nit | `scripts/lib/case-lock.ts:49` | `pid === self` drops exclusion inside one process; not reachable today |
| N2 | nit | `scripts/lib/case-lock.ts:48` | A forward clock step (or a touched file) can take over a live holder's lock; needs a manual change |
| N3 | nit | `scripts/criteria.ts:83` | A gate narrowed to the 5 M6b suites prints all met, exit 0, with the protected set not run |
| N4 | nit | `PORTING.md:34` | The recorded decision "PORTING gets the exception" was not applied; nor is the `PORT(perf)` memo rule there |
| N5 | nit | `docs/next.md:440` | `miri-tail-b` "merging after the dry run": merged at `cc091544` |
| N6 | nit | `PLAN.md:59` | The M6b summary leaves out `run-fail-miri`, its own group since A12 |
| N7 | nit | `docs/state/current.json` | `milestone: M5`, though M6a was accepted; no milestone record exists for it |
| N8 | nit | `src/rustc_monomorphize/partitioning_oracle/run.ts:36`, `:52`, `:62` | Pre-merge `load_optional` and a stale comment survive; `partitioning.provide` runs twice |
| N9 | nit | `tree_borrows/diagnostics.ts:28`, `shims/unix/socket.ts:27` | Imports left unused by these commits (`unported`, `Ok`); load order unaffected |

## F1: Miri pointer fragments print `[object Object]` (medium)

`debug_prov` handles only a bigint (`CtfeProvenance`) and a number (`AllocId`). Miri's `Provenance` is an object, so it reaches
`debug_AllocId` and prints `a[object Object]`. Upstream is `{prov:#?}` (`mir/pretty.rs:1871`). A whole pointer is right, because it goes through
`provenance_of` (`pointer.ts:398`); only the fragment line at `:2273` calls `debug_prov` on the provenance directly.

**Failing scenario.** `tests/fail/uninit/uninit_alloc_diagnostic_with_provenance.rs`, `miri-fail`, run `20261104-140951-review-integ-w38-recheck-k0ng`:

```
oracle:     ╾42[a70]<1> (ptr fragment 0)╼ 12 13 ╾43[a72]<1> (ptr fragment 1)╼ __ __ ...
port:       ╾42a[object Object] (ptr fragment 0)╼ 12 13 ╾43a[object Object] (ptr fragment 1)╼ __ __ ...
```

A wildcard fragment fails the same way, in a program I wrote: oracle `╾4f[wildcard] (ptr fragment 0)╼`, port `╾4fa[object Object] (ptr fragment 0)╼`.

**Not a blocker.**
- The case is in no baseline, and M6b does not read `miri-fail`.
- It is not from this integration: `pretty.ts` last changed at `1228a2c0`, which is on `main`, and `debug_prov` dates from `14230749`. The earlier
  `miri-fail` samples (100, 25, 25 and 200 cases) did not include this case, and I found no full run of the suite.
- Among Miri's tests, only this file and `native-lib/fail/tracing/partial_init.stderr` show a fragment, and native-lib is out of M6.

It deserves a fixer item, because it is silent wrong output rather than a stop. **Fix:** dispatch object provenance through its own `Debug`, as
`provenance_of` does for `fmt`, and add this program as a fixture.

## P1: the default gate cannot give the M6b figure (medium, process)

With no `--suites`, the gate runs `protectedSuites()`, the 49 files in `harness/baseline`. `run-pass-miri-heavy`, `miri-pass` and `miri-pass-heavy` have no
baseline, and `harness/suites.ts:1909` says none is in the defaults. After a bare run, `criteria.ts` will correctly print `not met (... not in this gate)` for two
of the three groups. I found the required command in none of `docs/next.md`, `docs/plan-m6.md`, `AGENTS.md` or the harness-m6c handoff.

**Run this instead:**

```sh
bun scripts/gate.ts run --suites "$(ls harness/baseline | sed 's/\.txt$//' | paste -sd, -),run-pass-miri-heavy,miri-pass,miri-pass-heavy"
```

Accept needs every protected suite in the run (`gate.ts:434`), and this list has them. I did not run this command. Also note `--skip-heavy`: it leaves out the heavy M6b suites too.

## Root's commits

### `487ed713`: `pack_def_id` and `args_env_key` (the most important)

**The new layout is injective and within 53 bits.** Fields: `id` at bits 0-23, `index` at 24-43, `krate` at 44-50, `env` at 51-52, each bounded by its guard. The fields don't
overlap, every partial sum is an exact integer, and the maximum is exactly `2^53 - 1` (tested). Over-range values return `-1`, and the callers then bypass the memo or take a string form.

**Nothing depends on the old layout.** The multipliers appear only in `typing_env_no.ts`. Nothing decodes a key or stores one on disk, and `hash_key` is used only as a map key
(`execution.ts:171`, `caches.ts:71`, `:77`). The callers are `eval_context.ts:463` and `keys.ts:618`, `:628`.

**Reproducers, against the oracle:**

| program | oracle | port at `74672b67` |
|---|---|---|
| `pack3.rs` (F1, 65,534 DefIndexes first) | prints `244650`, exit 0 | byte-identical |
| `reqc.rs` (F2, 400 envs) | `error[E0080]: evaluation panicked: too big`, exit 1, 22 lines | byte-identical stdout and stderr |

**The tests catch the old keys.** With the old `0x100_0000_0000` multiplier, the injectivity test fails. With `args_env_key` unguarded, its test fails.

**Every other memo key in the lane:**

| key | where | result |
|---|---|---|
| `id*2^23 + index*2^7 + kind*2^6 + env` | `ty/layout.ts:1095` | sound; guards `id < 2^30`, `index < 2^16`, `env < 64` give exactly 53 bits |
| `args.id*0x40 + env` | `eval_context.ts:426` | sound; `env < 0x40` guards both the read and the write |
| `ty.id*0x40 + env` | `step.ts:716`; `inhabitedness/mod.ts:271` | sound; `env < 0x40` guards both the read and the write |
| `env*2^32 + id` | `keys.ts:607` | sound; `env < 2^21`. `id < 2^32` is unguarded, but it would take over 4 billion interned objects; exit heaps hold about 60M objects of all kinds |
| string keys | `keys.ts` `instance_key`, `pci_*_key` | sound; the `Item` form holds only digits and colons, the other form is an `intern_key`, and env and promoted bound the string at both ends |
| `DefId_hash_key` or text | `keys.ts:179` | sound; a number and a string never meet in a `Map` |
| `(AdtDef, bits)` | `discriminant.ts:89` | sound; a `Map` compares bigints by value, and variant 0 is not mistaken for a miss (`!== undefined`) |

The facts these rest on hold. All interned ids come from one process-wide counter (`intern.ts:25`). `Ty`, `Region` and `Const` extend `Interned`, so a `GenericArg` key cannot mix them up, and `RawList` uses the same counter (`list.ts:46`). `typing_env_no`'s fast path reads
the only two fields a `TypingEnv` has. A search found no caller mutating `inputs()`'s cached array or casting it to a mutable type.

### `c77247ba`: Tree Borrows integration

**Load order is unchanged.** The commit adds or removes no import, only casts, comments and the stand-in, so C10 is not touched. `diagnostics.ts:15` already imported `perms` as a namespace, and line 16
already had value imports from the same module. `perms.display_Permission` (`perms.ts:540`) is read inside a function at call time.

The two pending test files now run: `bun test ./src/miri/borrow_tracker/tree_borrows` gives 101 pass, 0 fail, no skip. No `pending-tb`, `Pending<"Permission">` or `pending miri-tb` text remains in `src`. A TB error
program that prints permissions (`currently Reserved`) matches the oracle. `miri-pass-tb` sample: 130 of 132, and the other 2 are `sync.rs`, D5.

### `0099983d`: `run_miri_program` environment

The environment is right for what the helper does, and it is not the same as a suite case's, in ways that don't matter:

- **`RUST_BACKTRACE=0` is right.** With the variable unset, rustc's ICE hook selects full backtraces (`rustc_driver_impl/src/lib.rs:1466`), whose frames vary. `phase-diff` and the M2/M3 suites use `0` too.
  Measured on a panicking program under the oracle: `0` and unset are the same with and without isolation.
- **What differs from the suites.** `run-pass-miri` has `short` and `miri-pass` has `1`. Those change output only under `-Zmiri-disable-isolation`: 22 lines with a backtrace against 6. So a helper test with that flag doesn't
  exercise the interpreted backtrace path, but both sides still get the same environment, so it cannot give a false result.
- **Not present in the helper:** `MIRI_TEMP`, `MIRI_ENV_VAR_TEST` and `pinSessionEnv`. Only cases from Miri's own tests or those reading session variables need them; the helper takes its own programs.
- **M1's reproducer:** with `RUSTC_LOG=info RUSTC_CTFE_BACKTRACE=1 MallocStackLogging=1 RUST_BACKTRACE=full CLICOLOR_FORCE=1` exported, a UB program gives the same bytes on both sides, and no ICE file appears.

### `babf8030`, `f9ed615a`, `b34dde23`: `scripts/criteria.ts`

**`met` is printed correctly.** On the real gate `gate-20261102-174727-root-kxpt`:

```
plan-m6 M6b run-pass: MATCH 3408/3470 = 98.21% vs >= 90%, 0 oracle timeouts excluded: not met (run-pass-miri-heavy: not in this gate)
plan-m6 M6b run-fail: MATCH 292/294 = 99.32% vs >= 90%, 0 oracle timeouts excluded: met
plan-m6 M6b miri-pass: MATCH 0/0 = 0% vs >= 80%, 0 oracle timeouts excluded: not met (miri-pass: not in this gate; miri-pass-heavy: not in this gate)
```

The counts equal that `gate.json`'s entries, exit 1. On fixtures through the real script:

| fixture | result |
|---|---|
| exactly 90 / 90 / 80% on a clean passing gate | met three times, exit 0 |
| one MATCH below each threshold | not met |
| `pass: false`, dirty tree, `skipStatic: true` | not met, with the reason |
| `oracleTimeouts` taking `of` to 0 | not met, and the timeouts are counted |
| empty group (`0/0`), missing suite | not met |
| bad JSON, missing fields, missing `gate.json` | one `ERROR:` line, exit 1 |

`match` comes from a set of MATCH ids and `total` from the results (`gate.ts:355`, `:365`), so UNSTABLE and TIMEOUT stay in the denominator, as A9 says. `b34dde23`: `lib/deps.test.ts` passes in the same process as `criteria.test.ts`. `miri-pass-heavy`'s
unstable list is empty at this pin, so `f9ed615a`'s change does nothing yet, correctly. Exception: N3.

### `688895b6`: `isStaleLock`

**It cannot take over a live difftest's lock in normal operation, on this host.**

- **Same process, twice?** Not reachable. Only `miri-pass-heavy` (7 cases) passes a `MIRI_TEMP` through `heavy`, and `jobs` is 1 for heavy suites (`difftest.ts:947`). The temp path hashes the case id, the suite awaits one chunk at a time, and
  `gate.ts` awaits each suite. Heavy TIMEOUTs aren't re-run.
- **Age above uptime?** `os.uptime()` here is wall time since `kern.boottime`, including sleep (42,637 s, equal to the sysctl), so sleeping does not create a false "predates this boot". The file is new on each take (`O_EXCL`), and nothing preserves an mtime.
- **What remains:** N1 and N2, both demonstrated with real processes.

**N1.** Two concurrent `withCaseLock` calls in one process now both run (max inside = 2, measured). Before the commit the second waited. It only matters if heavy suites ever run with `jobs > 1`. Keeping a per-process set of held files would separate "my own stale file" from "I hold this", and the rule could stay.

**N2.** A live holder in another process, with the mtime set back 100 h, lost its lock to a waiter in 307 ms; with a fresh mtime the waiter waited. Reaching this needs a forward clock step larger than the time from boot to the lock (hours, for a heavy suite at the end of a gate) or a hand-touched file, and a second difftest
on the same case. The `maxHoldMs` rule already had this exposure. I'd leave it.

### `819e4f97`: mono integration

**What's tested didn't shrink.** With `HAVE_COLLECTOR` always true, the removed branch was the pre-merge stand-in test, which could no longer run. `bun test ./src/rustc_monomorphize ./src/rustc_middle/mono`: 127 pass, 0 fail, no skip, under `RUST_TS_REQUIRE_PROBES=1`. No `pending_mono` reference remains.

**`partitioning.provide` does call `collector.provide`** (`partitioning.ts:1435`, upstream `partitioning.rs:1395`). Calling the real `lib.provide` on an empty table, after loading the driver, sets `collect_and_partition_mono_items`, `is_codegened_item`, `codegen_unit`, `size_estimate`, `items_of_instance`, `check_mono_item` and the
`should_codegen_locally` hook. Loading `rustc_monomorphize/lib.ts` first fails at `pretty.ts:388`, which is load order only and not a path anything takes: nothing outside the crate imports it (the one `src/rustc_middle/mir/mod.gen.ts` hit is a comment).

### `7c83d5b2`: fixers-38 F1 and F2

**F2.** `send` and `recv` are the old helpers written out: the same reads in the same order, the same early returns and the same callback. That order matches `socket.rs:418` and `:497`.

**The stop text changed, harmlessly.** `send/recv with a length of 2^53 bytes or more` is now `send with ...` and `recv with ...`, exit 70 as before. Nothing reads the text. It stops at the same place, before the fd lookup; at `2^53 - 1` the oracle's path is kept.

**Socket programs against the oracle:**

| program | oracle | port |
|---|---|---|
| send/recv both ways, non-blocking, zero length, bad fd, non-socket fd, blocking across threads, EOF, EPIPE | exit 0 | byte-identical |
| send and recv with an out-of-bounds buffer; uninit flags | exit 1 | byte-identical |
| send and recv at `2^53 - 1` on a bad fd | `-1`, EBADF | identical |
| send and recv at `2^53` on a bad fd | `-1`, exit 0 | exit 70, new text, as designed |

**F1.** The fixture kills its mutation: with `tree_visitor.ts:100` iterating forward, `traversal_ancestor_children.rs` fails. The program also matches the oracle directly.

### `74672b67`: mono drivers

Same bytes through `write_stdout` and `write_stderr`. No `process.stdout.write` or `process.stderr.write` is left in non-test `src` except `src/std/io.ts`. `std/io.ts` imports only `std` and `node:`/`bun:` modules, so importing it first in the drivers doesn't touch load order. The 127 mono tests above ran at this commit.

### Merges

I replayed all 36 merges in `144a8fa3..74672b67` with `git merge-tree` and compared trees. 34 equal the automatic result.

- **`344646da`** is the only one with a conflict: one line, `harness/compiletest.ts`. The result is the exact union of both sides' imports (`MIRI_CASE_ENV, MIRI_SYSROOT, miriBinary, miriOracleKey, miriPin, miriTargetLibDir`), and each name is used.
- **`2bac277e`**, a lane merge, adds the x86 `wide` probe files inside the merge commit. The x86-a handoff covers them. It isn't root's resolve; I didn't review it further.
- **`7b854e64` auto-merged `memory.ts`** correctly. Against its first parent it adds only the 5-line `check_and_deref_ptr` fast path. Against its second it adds only followups-37's `write_bytes_ptr`, `repeat_n` and `SizedIterator`. The regions don't touch. I also read the fast path against `memory.rs:519`: `size > 0n` excludes the zero and negative cases, a `NaN` fails the test, and a rounded sum is above any exact `alloc_size`, so it takes the exact path.

`main` (`144a8fa3`) and `integ-w38` merge with no conflict.

## The merged whole

`bunx tsc --noEmit -p .` clean. `coverage.ts --check`: markers ok (24,832). `--sample 200`, `RUST_TS_AGENT=review-integ-w38-recheck`, one at a time, load about 5-36 from other work:

| suite | protected? | total | MATCH | DIFF | CRASH | TIMEOUT | UNPORTED | UNSTABLE | not MATCH |
|---|---|---|---|---|---|---|---|---|---|
| `run-pass-miri` | yes | 200 | 200 | 0 | 0 | 0 | 0 | 0 | |
| `run-fail-miri` | yes | 200 | 200 | 0 | 0 | 0 | 0 | 0 | |
| `miri-pass` | no | 200 | 190 | 0 | 0 | 0 | 9 | 1 | 9 D5 (`mio::Poll::new`); `mir-validation.rs` listed unstable |
| `miri-fail` | no | 200 | 196 | **1** | 0 | 0 | 3 | 0 | F1; `erroneous_const.rs` and `miri_start_wrong_sig.rs` (long text), `wrong_fixed_arg_count.rs` (D5) |
| `miri-pass-tb` | no | 132 | 130 | 0 | 0 | 0 | 2 | 0 | `sync.rs` twice, D5 |
| `mir` | yes | 200 | 198 | 0 | 0 | 0 | 0 | 2 | listed unstable, the oracle ICEs |
| `check-ui` | yes | 200 | 200 | 0 | 0 | 0 | 0 | 0 | |
| `pm-ui` | yes | 200 | 199 | 0 | 0 | 0 | 0 | 1 | `proc_macro_generated_packed.rs`, listed unstable |
| `mirdump-ui` | yes | 200 | 199 | 0 | 0 | 0 | 0 | 1 | `mir/lint/no-storage.rs`, listed unstable |
| `miri-hello` | yes | 1 | 1 | 0 | 0 | 0 | 0 | 0 | |

## Docs and the remaining nits

The record is on `main`; `integ-w38` has an older `docs/next.md` (it still shows `miri-perf` in review and the mono lanes and `fixers-38` running), which the clean merge fixes.

- **N3.** `scripts/criteria.ts`. Fixture: a passing clean `gate.json` with only the 5 M6b suites prints met three times and exits 0. `gate.ts run --suites <those 5>` gives that `gate.json`. It records nothing about other protected suites (`notRun` covers only `--skip-heavy`), so "no protected loss" isn't checked. Accept refuses such a run, so no baseline can follow from it; the risk is someone reading a figure from it. A note in the printed line would be enough.
- **N4.** The 2026-11-04 13:06 decision says "PORTING gets the exception" for `to_stable_hash_key` of `MonoItem` and `CodegenUnit` (`rustc_middle/mono.ts:441`, `:866`), but `PORTING.md:34` still lists `ToStableHashKey` as skipped, on `main` and `integ-w38`. The 13:56 decision allowing `PORT(perf)` memoizing isn't there either, while section 3 still says not to simplify. A lane following PORTING would skip or remove them.
- **N5.** `miri-tail-b` is merged (`cc091544`), and the socket programs above ran on it.
- **N6.** A12 made `run-fail-miri` its own group; `docs/plan-m6.md:197` has it right.
- **N7.** `bun scripts/state.ts summary` starts `milestone: M5`. The last milestone record is M5; M6a has none. `PLAN.md:59` is right.

`docs/plan-m6.md`: nothing false about the current state among the gate definitions and A9-A12. Its planning figures (for example 3,256 run-pass cases) are from when it was written; the amendments say they take precedence.

## Not checked

- The gate, full suites and the full unit step. Beyond the samples, whether any protected case changes is unproven here; root's full unit step wasn't mine to read.
- `run-pass-miri-heavy` and `miri-pass-heavy`: no sample ran, so the 8 and 7 cases that decide part of two groups have not been seen on this merge by me. In particular, `case-lock` was exercised only by its tests and my script, not on a real heavy case.
- The P1 command. I built it from the code and did not run it.
- `isStaleLock` on anything but this macOS host: Linux's `uptime` and a container's pid space differ.
- Clock behaviour itself: I reasoned about a clock step and simulated it with `utimes`; I didn't change the clock.
- Whether F1's fix has other callers to change: I read `pretty.ts`'s three `debug_prov` uses and tested whole pointers, fragments and wildcards under Stacked Borrows, and whole pointers under Tree Borrows and no borrow tracker.
- `2bac277e`'s added files, beyond noting them, and the commits between `144a8fa3` and `74672b67` you did not list (x86, TB and tail lanes, each with their own reviews). The `miri-perf` review's N1-N5 and O1 remain queued; I did not re-check them, as they weren't root's changes.
- `-Zmiri-many-seeds`, GenMC, native-lib: out of M6.

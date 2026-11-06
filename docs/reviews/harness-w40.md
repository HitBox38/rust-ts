verdict: APPROVE WITH NITS

Independent review of `harness-w40`: branch `t3/implement-harness-w40`, head `f11406fa`, base `5eda654d`. I am read-only: this file is my only change to the tree.

**The mask holds, and this batch can land.** Nothing protected changes status. Every plant that should show a difference did, on real output, under Miri and natively. All 25 new DIFFs are native backtrace frames and nothing else. I found no blocker. Two LOW findings and five nits follow. L1 answers item 4's question, and L2 is the one place the mask hides more than the handoff says, on no case today.

**A mistake of mine affected the shared machine: see "My incident" at the end.** While probing I nearly filled the disk for a few minutes. It is cleaned up, and the oracle toolchain was not touched.

## Findings

### L1 (LOW): `ir-diff.ts <file>` leaves `rustc-ice-*.txt` beside the file

- **Where:** `scripts/ir-diff.ts:60` sets `env: undefined`, and `:125-126` turn that into `caseEnv(undefined)`. That scrubs `RUSTC_ICE` and sets nothing, on both sides.
- **Scenario, reproduced on a scratch copy:** `bun scripts/ir-diff.ts <dir>/do_not_const_check.rs` wrote two reports into `<dir>`, one from the oracle and one from the port. The cwd is the file's own directory, so a file under `$RUST_TS_DATA/rust/tests/ui/...` dirties the upstream checkout, and the next gate refuses to run.
- **Scope:** not this lane's code. It is the answer to item 4. Its `--suite` form is fine, as those cases carry the env.
- **Fix:** `env: { RUSTC_ICE: "0" }` at `:60`, in the next harness batch.

### L2 (LOW): on a Miri ICE the mask also hides interpreted programs' ids, and a program can turn it on

- **Where:** `scripts/lib/unstable.ts:67` (`stderrMask`), `:30` (`ICE_MARKERS`, whose first entry is unanchored).
- **Scenario, run through `maskedTexts`:**
  - Miri oracle stderr with `thread 'main' (1000) panicked` plus an ICE note, against the same with `(1001)`: **equal**.
  - A program that prints `the compiler unexpectedly panicked` on its own, no ICE at all: **equal** too.
- **Today:** no such case. Of the Miri entries in the oracle cache, exactly 1 has an ICE marker (`tests/panic/mir-validation.rs`), and its only thread line is `thread 'rustc'`.
- **Fix:** optional. On a Miri suite, mask only `thread 'rustc'`. Either way, the handoff's "the digits of an id" should say this.

### Nits

- **N1.** The handoff undercounts 8b's moves (section 8b's "Moved"). It also moves `parse-ui-json`: 44 cached entries read an explanation, and **all 44 MATCH** on the head. The suite has no baseline and is not in the gate, so nothing is at stake.
- **N2.** `scripts/difftest.ts:20` says the mask never touches "the text of a diff file", and the handoff says the same. That holds for single mode only. Split suites write masked text (`:798-801`, `:854-857`). What is cached stays raw, so an audit can still see the id. Correct the comment.
- **N3.** `scripts/lib/marker-check.ts:19,43`: `//rustc-call: 129:99` and `//rustc-const: ...` (no space) pass `--check` with `markers ok`. The resolver's own pattern needs the space too, so such an anchor is simply not read. Harmless, but a typo goes unreported.
- **N4.** `scripts/lib/unstable.ts:53`: "which also takes the closing quote here" misdescribes compiletest. Its pattern has no quote and needs `$TEST_BUILD_DIR/` and a stem with no dot. Ours is narrower on the quote and wider on the directory. `harness/compiletest.ts:1275`: "the 7 written `-Z mir-opt-level=N`": 9 cases use that spelling, and 7 is the difference in the count.
- **N5.** Stale, and already listed by the lane: `src/rust_ts/track_caller_check.ts:10`, and docs quoting `mir` as 21,526.

## 1. The thread-id mask

**Plants on real output** (`compared` then `classify`), on `mir` `do_not_const_check.rs`, `pm-ui` `load-panic-backtrace.rs`, Miri ICE `mir-validation.rs` and Miri program panic `run-fail-miri` `try_as_dyn_builtin_impl.rs#next`:

| Plant | Host id (first three) | Miri program panic |
|---|---|---|
| Other digits, fewer digits | MATCH | **DIFF** |
| `rtid` added, thread name, `<unnamed>`, location line, column and file | DIFF | DIFF |
| Payload, extra panic, extra panic with another id, panic removed, stderr line dropped | DIFF | DIFF |
| Extra space, non-digit id, hex id, empty id, literal `<tid>`, no id at all | DIFF | DIFF |
| A stdout byte, a thread line in stdout, the exit code | DIFF | DIFF |

(`<unnamed>` is a no-op on `load-panic-backtrace.rs`, which already prints it.)

- **Applies where the handoff says:** stderr only, single mode, with split suites masked separately. `stderrRange` takes the last marker on each side, and I could not construct a stdout or stderr that moves digits into the masked range. A stderr that prints the marker only masks less.
- **Literal `<tid>` fix: sound.** Digits map to `<tid>`, and `<+tid>` gains one `<`, so the map is injective except on digits. The reviewed pattern did let a literal equal a masked id.
- **Natively:** `pm-ui` runs real proc macros, so `load-panic-backtrace.rs`'s `thread '<unnamed>' (33138688)` is a program's real id. Masking it is right. The handoff's warning for `run-pass-native` stands.
- **No other Miri suite is unmasked by mistake:** all 9 Miri suites come from `miriSuite()`, which sets `miri: true`. No non-Miri suite runs a program under Miri.
- **`panic1.rs`:** 12 runs give 12 masked outputs. The digits are its own (Miri `gettid` with isolation off), and it stays listed, UNSTABLE. Correct.
- **`mir-validation.rs` going to DIFF:** a host ICE, thread `rustc`, and frames are the only difference.

**Retired entries: the evidence is enough.**

| Case | Runs | Masked outputs |
|---|---|---|
| `tests/ui/resolve/proc_macro_generated_packed.rs` | 20 in the normal env, plus 3 | 1 |
| `tests/panic/mir-validation.rs` | 12 (6 with `USER` and `HOME` changed; its `RUSTUP_HOME` is explicit) plus 3 | 1 |
| All 44 freed cases, and the 6 long-type ones | 3 each | 1 each |

**UNSTABLE when an oracle differs in another way: not detected, and that is safe.** A single-mode case is UNSTABLE only from `Suite.unstable` or the ICE-file pattern. A new kind of oracle variation gets cached once, then shows as DIFF, or a loss if protected. It cannot show as MATCH unless a subject happens to equal the cached run. Retiring the pattern loses only the blanket "any ICE is unstable" rule, and that is what the 3-run evidence replaces.

## 2. Status changes

**Reproduced exactly**, running oracle and subject on the 51 of the last gate plus the 14 uncached `parse-ui-json` cases:

| Change | Cases |
|---|---|
| Mask to MATCH | 18 |
| Long-type digits to MATCH | 6 |
| DIFF | 25 |
| UNPORTED (`mir/lint/no-storage.rs`) | 1 |
| Stays UNSTABLE (`panic1.rs`) | 1 |

Your brief's "44 cases" sums to 50. It is 44 by the mask (18 + 25 + 1) and 6 by long-type digits. **24 new MATCHes, none in a baseline.** I checked every one against `harness/baseline/`. The 14 `parse-ui-json` cases MATCH and are unprotected.

**The 25 DIFFs conceal nothing.** With the `stack backtrace:` frames removed from both sides (`N: name`, `at ...`, `[... omitted ...]`, `note: Some details are omitted`, the port's JS-stack note), **all 25 are byte-identical**, line counts equal, query stacks and notes included. `no-storage.rs` stops at `Backtrace Display (captured frames)` after 49 identical lines.

**`RUST_BACKTRACE`: not changed.** Dumping every case's env on base and head, the only env change in 371,901 cases is `parse`'s `RUSTC_ICE`. The 26 keep `short` or `1`. `docs/reviews/plan-ice-report.md`'s rejection stands.

**"No other case can move": correct.** My own scan of all 371,901 keys, by suite and id:

| Cached entries | Result |
|---|---|
| Non-Miri, thread line in stderr | 43, exactly the freed non-Miri cases, all cached since the lane ran them |
| Non-Miri, long-type note | 6, the same way |
| Miri, thread line in stderr | 334: 333 with no ICE marker, so not masked, plus `mir-validation.rs` |
| Thread line in stdout | 7 `run-fail-miri`, 7 `tokens` (a batch suite, source text). Never masked. The handoff omits `tokens`; it does not matter |
| `parse`, under the base keys | 21,523 entries: no thread line, no long-type note, no ICE |
| Split suites' stderr | None |

The logic holds too. If an oracle has no line of that form, the mask cannot make a subject equal it: masked digits become `<tid>`, and a literal `<tid>` becomes `<<tid>`. So equality before and after are the same, and the status cannot change.

## 3. Long-type digits

Only the digits of `.long-type-<digits>.txt'` are masked. Stem digits, directory and note text still compare, shown by the lane's tests and by the six real cases.

- **Gives up:** whether two notes name one file, and a different type giving a different hash. The short type printed beside it still compares. Contents were never compared.
- **A file written elsewhere: no.** After my runs of all six on both sides, there is no `*.long-type-*` anywhere under the upstream checkout. The note names `build/.../on_unimplemented_long_types.long-type-<hash>.txt`, whose directory does not exist. The one file under `.data/tmp/upstream-strays/` dates from Oct 21.

## 4. `parse` with `RUSTC_ICE=0`

**I reran all 21,523 oracles with the new env against the entries under the base keys: 21,523 of 21,523 byte-identical.** 191 s at 6 jobs, 456.9 MB of old entries (the lane's 457 MB).

- **Protection is unaffected.** Baselines hold ids, not keys. All 21,523 protected ids are still cases, and the 200-case sample MATCHes.
- **Only `parse`'s keys change.** The 21,526 and nothing else, on base against head.
- **Other suites without it:** only `lex`, `escape`, `escape-synthetic`, `fluent-*`, `emit`, `tokens*` and `symbols`, whose entries have no hook, and `check-rg*`, whose script sets it (`rg-check.ts:94`). Every other case has it, checked case by case.
- **Other invocations:** `phase-diff.ts` and `ctfe-sample.ts` set it. **`ir-diff.ts` in file form does not: L1.** I listed the 110 files that name a port entry and read the scripts among them, not each oracle helper under `src/`.

## 5. `gate.json` and `mir-heavy`

- **Retry times: report only.** `classify` does not read them. Both attempts are recorded, and past the retry cap only `pool` is. `sUsage` is always set for a TIMEOUT, as a batch's timeout is never attributed to a case. Passes `retry-times.test.ts`; no real gate has exercised it.
- **`mir`** loses exactly `closures/supertrait-hint-cycle.rs`, which is not in `mir.txt`, and `mir-heavy` gains it, with the same argv and env. Case lists otherwise equal.
- **A heavy suite's oracle timeout does not make its case go away.** `lost = base - match` (`scripts/gate.ts`, and the comment at `:50`), so a protected ORACLE_TIMEOUT is a loss. While unprotected, the default gate does not run it, and the only record is `mir`'s skip reason. That is what root decided on 2026-11-06.

**`parse`'s 3 ORACLE_TIMEOUT: root's inclination is right. Take it, and it loses nothing.**

- 0 of the 3 are in `harness/baseline/parse.txt`, and each was ORACLE_TIMEOUT in all of the last 3 gates.
- **Keep the reason accurate.** `NOCORE_SKIPPED`'s text names `-Zunpretty=ast-tree,expanded`, and `parse` runs `-Zunpretty=ast-tree`. Give it its own wording, as `STD_SKIPPED` does.
- **Correct the cost.** 25 minutes is per process, 75 process-minutes for the three, but they run in the pool, so a gate's wall time gains less. `parse` took 2,829-3,023 s in those gates, and I did not measure what it takes without them. The `~13 GB` output `NOCORE_SKIPPED` records for `expr-stack-overflow.rs` is a reason of its own on a 24 GB host; I did not measure that either.
- It changes a suite definition, so it needs a small reviewed batch.

## 6. `coverage.ts`

**Planted on a real tree through `coverage.ts --check --offline`:**

| Plant | Result |
|---|---|
| `rustc-call`: wrong line, wrong column, malformed, callee renamed on the next line | exit 1, one `ERROR:` each |
| `rustc-const`: wrong line, wrong name, wrong file | exit 1, one `ERROR:` each |
| No space after `//` | exit 0 (N3) |

- **A gate that would have passed is not stopped:** `markers ok` on the head, and again on a trial merge with `integ-w40` (`8d865bff`), which merges cleanly. `tsc` and the changed test files pass there too.
- **Order report: 917 of 24,848, 348 descents, 189 file pairs, same output as the lane's.** The two I read are real inversions: `rustc_serialize/serialize.ts:80,86` has `emit_raw_bytes` (:87) before `emit_i8` (:59), and `ty/sty.ts` puts each trait-impl method next to its inherent one (`new_adt` :630 then :982). Report-only is right, as neither sampling nor the lane split allowed from not. `rustc_monomorphize` 0 and `mono.rs` 1 agree with the handoff.

## 7. Tools batch

**8a, mono:**

- **Fingerprints, on this tree:** I rebuilt `collector_oracle/probe` and ran `shims.rs` from the mono-wire review at `-Copt-level=0`, `-Copt-level=0 -Clink-dead-code` and `-Copt-level=1`: **636 fingerprints, identical values and order.**
- **Regeneration:** `rustc_monomorphize` and `rustc_middle_mono` change nothing.
- **By reading:** the generated `stable_hash_*` matches the deleted hand copies and `instance.rs` in discriminants and field order, `ReifyReason` included.
- **Load order, my own plugin, base against head:**

| Entry, run | Base | Head | Difference |
|---|---|---|---|
| rustc, `--version` | 2,059 | 2,060 | `mono_stable_hash.gen.ts` only |
| Miri, `--version` | 2,243 | 2,244 | The same |
| rustc, hello `--emit=metadata` | 2,059 | 2,060 | The same |
| rustc, `-Zprint-mono-items` under `--emit=metadata` | 2,059 | 2,060 | The same |
| rustc, E0308 `--error-format=json` | 2,059 (stops) | 2,061 | Also `error_codes_text.gen.ts`, last |

The new module holds only functions and consts, so C10's rules hold. A sync `onLoad` works with the `require`, unlike the lane's plugin. So the text module is proved to load once, last, and only when read.

**8b, as port code: correct.**

| Check | Result |
|---|---|
| `text()` against `codes.rs`: the `include_str!` for that code; `Err` for others, before any read | Faithful |
| `json.rs:326`'s `.ok()` | Faithful, at `json.ts:285` |
| **Generated text against the oracle binary:** upstream's `handle_explain` loop on each text, against `rustc --explain` | **518 of 518** |
| **`tests/ui/error-codes/*.rs` under `--error-format=json`, oracle and port** | **238 of 238 byte-identical**; 409 explanations, 215 codes, including non-ASCII E0604 |
| The hash test against the `.md` files; `error_codes.ts --check` | 518 of 518; up to date |
| Bundles: `--compile` and `--compile --bytecode --format=esm`, E0308 JSON | Identical to the oracle |
| `miri-fail`'s 7 named cases | 7 MATCH, each with one explanation |
| 3 rows of `json.oracle.test.ts` | Pass as plain comparisons |

**`--explain` itself is still `unported`** (`rustc_driver_impl/lib.ts:455`). That is honest, and now a small port, except for its pager and colours. Root's call.

**Hello's cost: none.** Instructions, 10 alternating runs at load 6-8, base against head at equal path length:

| Form | Base | Head |
|---|---|---|
| Unbundled | median 10.55 G (10.51-10.57) | median 10.55 G (10.42-10.57) |
| `--compile --bytecode` (4 runs, load about 25) | 2.199-2.205 G | 2.196-2.203 G |

RSS is unchanged. A `--compile` bundle grows 875 KB (0.7%).

## 8. `plan-m7.md` and H9

- **H9: 60 of 406 is right, recounted from the argv:** level 4 on 346, 3 on 2, 2 on 21, 1 on 8, 0 on 29.
- **Last flag wins across both spellings, on the oracle:** `-Zmir-opt-level=4 -Z mir-opt-level=0` prints level 0's MIR, and the reverse prints level 4's (hashes compared).
- **Corrections check out:** 3,479 for `mir-o2` and `mono-ui`, `check-rg`'s 36 (`harness/baseline/check-rg.txt`), and O6 closed (`docs/reviews/real-crates.md`, 34 of 34). Free disk is 15-17 GB today, against "16-19".

## 9. Case lists and runs

**Case lists, all suites, base against head:** 371,901 each. The only move is `mir` to `mir-heavy`. Keys change only in `parse`. Listed-unstable changes are exactly the 45 retired entries. Argv is unchanged everywhere.

| Check, `RUST_TS_REQUIRE_PROBES=1` | Result |
|---|---|
| `bun test ./scripts ./harness` | 329 pass, 0 fail |
| `bun test ./tools` | 72 pass, 0 fail |
| `bunx tsc --noEmit -p .` | Clean |
| `bun test src/rustc_monomorphize`, `stable_hash` | 135 pass |
| `json.oracle.test`, `tests.test`, `error_codes.test` | 112 pass |

**`--sample 200`, `RUST_TS_AGENT=review-harness-w40`:**

| Suite | MATCH | Other, none protected |
|---|---|---|
| `mir` | 200 | |
| `pm-ui` | 199 | UNPORTED `proc-macro/expand-expr.rs` (cross-thread proc-macro execution) |
| `pm-expanded` | 199 | The same |
| `mirdump-ui` | 199 | DIFF `storage-return.rs`, frames |
| `tydump-ui` | 198 | DIFF 2, in the table's list, frames |
| `thir-tree` | 198 | The same 2 |
| `parse` | 200 | |
| `parse-ui-json` (extra) | 200 | |
| `miri-pass` | 197 | DIFF `mir-validation.rs`, UNSTABLE `panic1.rs`, UNPORTED `shims/socket.rs` |
| `miri-fail` | 199 | UNPORTED `return_type_mismatch.rs` (`open_file_or_dir`) |

No TIMEOUT or CRASH. The upstream checkout is clean (`git status --short --ignored` shows only `build/`).

The test changes follow the design. I found no weakened expectation: the assertions removed from `miri.test.ts` and `unstable.test.ts` tested the retired lists and `unstableMiriOracleReason`, and `masked` assertions replace them.

## What I did not check

- The gate, and full suites other than `parse`'s oracle side.
- `mir-heavy` itself. I did not run its subject (up to 30 min at 16 GB) or time its oracle, and I took perf-near-limit's 59-68 s from the source.
- The 423 in-process hand-against-generated comparisons, which were not re-run. Variants `shims.rs` does not reach (`Virtual`, `Intrinsic`, `LlvmIntrinsic`, some `ShimKind`s) rest on reading the generated code and on regeneration being unchanged.
- `--order`: 2 of 189 file pairs read.
- A real ICE in a split suite: none exists. Only `split-run.test.ts`'s stubs exercise it.
- Retry times in a real gate.
- `bun build --target=bun --format=esm`, Linux and Windows.
- Oracle times for all cases: I relied on the lane's sampling for "other slow-oracle cases".

## My incident

To vary the environment I reran an oracle with `HOME=/tmp/h<n>` on 26 runs. `oracleRustcCmd` is `rustc +nightly` through rustup, so each of 20 new `HOME`s made rustup **download and auto-install a current nightly** (`249c1e4e3`, 2026-11-05) under `/tmp/h<n>/.rustup`, 1.3 GB each.

- **Effect:** free disk fell to **149 MiB at about 06:14**, for a few minutes, on a shared machine.
- **Cleanup:** I removed exactly those 20 directories, after checking each held only `.rustup`. Free disk is back to 17 GB.
- **Oracle toolchain: not touched.** `~/.rustup/toolchains/nightly-2026-10-11-*` is unchanged and `nightly` still links to it. `HOME` pointed rustup elsewhere, and I ran no `rustup` command that changes anything.
- **Knock-on:** when I checked right after, no difftest or gate was running, and the oracle cache had no file written in the previous 12 minutes, no temp files and no empty files. **If another session failed a write around 06:11-06:14, this is why.**
- **Those runs are discarded:** they produced `proc_macro_generated_packed.rs`'s 2 masked outputs, which were rustup's own messages and an oracle other than the pin. The 20 clean runs above replaced them.
- **For the next reviewer:** never change `HOME` on a non-Miri oracle. Miri's cases set `RUSTUP_HOME`, which is why `mir-validation.rs`'s runs were valid.

My scripts and outputs are in `/private/tmp/claude-501/-Users-tomernorman--t3-worktrees-rust-ts-t3-510f17d9/3364b0f6-6d34-47af-b198-07c4fe7686f3/scratchpad/` (`scan.ts`, `plants.ts`, `rerun.ts`, `strip.ts`, `parsecmp.ts`, `ejson.ts`, `explain.ts`, `fp/`, `lo/`, `out/`).

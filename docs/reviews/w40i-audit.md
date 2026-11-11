PASS WITH NOTES

**Wave 40i's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran, and every one of the
542,092 protected ids in `harness/baseline/*.txt` at `088bdb33` is still in the baselines at `3f2da8d9` and `MATCH` in this gate's jsonl.
I compared every row of the 60 suites with wave 40h's gate on every field. 542,643 rows now, against 542,143. **Every row that moved is
explained:**
- the 212 new protected cases (UNPORTED → MATCH);
- the 500 newly registered minicore rows (100 per suite: 41 MATCH, 59 UNPORTED on built-in target specs, none protected), which were
  skipped for `needs-llvm-components` before;
- the same 15 retried cases, in `attempts` only.

The baseline diff `088bdb33..3f2da8d9` adds exactly the 212 and removes nothing. The accept's per-suite counts equal the new baselines.
The oracle keys of all registered cases moved exactly as harness-w49's review says: 372,181 → 372,681 keys, +500 (100 in each minicore
suite), 0 changed, 0 gone, dump sha1s `6d1b393c…` and `d4ab0b61…`.

Every one of the 40 non-doc files changed between `46dff72a` and `b0708f98` equals one approved lane head, or root's checked fix
`ea15d152`. That covers `harness/` and `scripts/`, which are exactly harness-w49's two reviewed commits.

**The binary is the tested tree.** Both build keys recompute at `b0708f98` to `1712b4a9…` and `9df9f9f3…`. They equal `gate.json`, all 60
summaries, the frozen-lists summaries and the builds' `meta.json`: inputs, config, spec and Bun. pm-cross-thread's `.c` sources are not in
the key; the binaries compile them at run time from the gate checkout's working tree, by absolute path. I confirmed this from the bundle
text and with a direct test (break `thread.c` or `proc_macro_host.c` in a scratch tree, and that tree's binary ICEs naming the file).
The checkout's `.c` files equal `b0708f98`'s blobs and were last written before the build, so the gate tested what was committed.

15 new ids, including all 4 Miri cases, `dump_dataflow.rs` and `expand-expr.rs` in both pm suites, MATCH in source and in binary mode.
Each of the 100 newly registered minicore cases needs only LLVM components that the oracle's `libLLVM.dylib` defines. So compiletest at
the pin would register all of them, the 41 protected ones included. Margins are steady: the same 15 retried cases, each within ±0.8 s of
wave 40h alone, and no new retried case.

The notes are about provenance and timing, not results:
- the `.c` sources sit outside the build key (N1);
- the suites ran 4.8% longer for no reason I could find in the code (N2);
- bookkeeping (N3-N5).

Regression audit, 2026-11-11. Gate `gate-20261110-192312-root-ehou`, tested `b0708f98`, accepted `3f2da8d9`, `RUST_TS_SUBJECT=binary`.
The previous accept is wave 40h: gate `gate-20261110-113508-root-m7vn`, tested `46dff72a`, accepted `088bdb33`, binary mode. I ran no gate
and no full suite. What I ran:
- a comparison of every row of all 60 suites' jsonl, `.skipped.jsonl` and `.extra.jsonl`, this gate against wave 40h's, on every
  field. Every id of `harness/baseline/*.txt` at `088bdb33` and at `3f2da8d9` (`git show`) was checked against this gate's jsonl;
- `scripts/oracle-keys.ts` over every registered case, in `git archive` trees of `46dff72a` and of `b0708f98`;
- a per-file blob check of the 40 changed non-doc files against the four lanes' reviewed heads and `ea15d152`;
- the subject-bin keys, recomputed in the `b0708f98` archive tree with its own `buildSpec`, `subjectBinKey` and `subjectBinKeyOf`, with the
  spec rebased onto the gate's repo path. I compared them with `gate.json` and `meta.json`, and grepped both `rts` bundles for the `.c`
  paths;
- a scratch build of the `b0708f98` archive tree (`ensureSubjectBin` with `root` in my scratchpad). I ran it on `expand-expr.rs`'s pm-ui
  argv with the tree's `.c` intact, with `thread.c` broken, with `proc_macro_host.c` broken, and restored. I ran the gate's `1712b4a9…/rts`
  on the same argv;
- `difftest --suite S --filter <id>` for 15 new ids, with `RUST_TS_SUBJECT=source` and then `binary` (`RUST_TS_AGENT=w40i-audit`);
- a scan of the 100 newly registered minicore cases' `needs-llvm-components` lines against `nm -gU` of the oracle's `libLLVM.dylib`;
- `retryTimes`, `host` and per-suite times of both gates, and an A/B of a `tydump` case's source start-up in the `46dff72a` and
  `b0708f98` trees (8 alternating runs each);
- the junit reports and the frozen-lists run against wave 40h's, and the gate and accept logs;
- `bun scripts/coverage.ts` (summary) and `bun scripts/criteria.ts --run gate-20261110-192312-root-ehou`.

Everything ran on AC power (`pmset -g batt` before each phase and before each re-run), with `RUSTUP_AUTO_INSTALL=0`,
`RUST_TS_REQUIRE_PROBES=1` and `RUSTC_ICE=0`. No gate was running (`.data/tmp/GATE_RUNNING` absent). I read code but changed none.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **The C that pm-cross-thread compiles at run time is not in the build key, and the binary reads it from the build repo's working tree by absolute path.** In both bundles: `cc({ source: join3($rtsm_dir____4(), "thread.c") ... })` and `cc2({ source: join4($rtsm_dir____5(), "proc_macro_host.c") ... })`. `$rtsm_dir` returns `/Users/tomernorman/Documents/personal/rust-ts/src/std` or `.../src/rust_ts`, and no `.c` file is among the key's 2,099 / 2,287 inputs. **For this gate it is sound:** the checkout's `thread.c`, `proc_macro_host.c` and `mpsc_test_echo.c` equal `b0708f98`'s blobs, were written at 19:23:05Z (when `b0708f98` was committed), before the build (19:23:14Z) and never since, and `gateRun` checks HEAD and `git status` at start and end (`dirty: []`). The result is also correct behaviour for a tree whose only change is a `.c` edit: the binary compiles the new `.c`, as source mode would. **But `gate.json`'s hashes no longer identify everything the subject ran:** two runs with the same build hash can have compiled different C, and nothing records which. A later harness batch could hash every file that `cc({ source })` names into the key (or into `subject` in `gate.json`). | `rts` bundle text; scratch-tree test (§3); `git hash-object` against `git rev-parse b0708f98:<file>`; `stat` |
| N2 | low | **The suites took 23,252 s against wave 40h's 22,191 s (+4.8%), and I found no cause in the code.** Most of it is `tydump-nocore` (2,523 → 3,507 s, +39%) and `tydump-ui` (288 → 466 s, +62%). Their load was *lower* than wave 40h's (median 64 against 92, and 50 against 90). Those suites run `bun src/rust_ts/tydump.ts` from source even in binary mode, so the binaries are not involved. An A/B of `crt-static.rs`'s tydump argv in the two archive trees gave medians of 0.599 s (`46dff72a`) and 0.587 s (`b0708f98`), with identical output, at load 2-3. Single-process steps were a little slower too (`rmeta-core` 95 → 106 s at load 3, `check-core` 93 → 100 s). Swap was higher all through: 3.4-4.5 GB against 2.2-3.9 GB. The solo retries, which run the binaries, are within ±0.8 s (§5), so heavy cases did not slow. Nothing was lost or newly retried. Most likely host memory pressure; worth a look only if the next gate repeats it. | per-suite `startedAt`/`endedAt`, `host.samples`; `summary.json` `processes`; A/B (§5) |
| N3 | info | **The accept first recorded coverage 24,324, from a stale `coverage.json`.** Root corrected it in `README.md` and `docs/state/current.json` and recorded a decision. I confirm **24,330 / 27,053** at `3f2da8d9` (§6). The accept entry in `history.jsonl` holds per-suite counts only, which are right. | `history.jsonl` 2026-11-11T02:00:52Z; `coverage.ts` |
| N4 | info | **This gate's log is `.data/tmp/gate-w48.log` (and `accept-w48.log`), though the wave integrated as `integ-w49`.** Wave 40h's was `gate-w47.log`. Its contents are this gate's (subject `1712b4a9…`/`9df9f9f3…`, all steps `ok`). The name only makes it harder to find. | `ls $RUST_TS_DATA/tmp` |
| N5 | info | **Wave 40h's two builds (`00cd7c6b…`, `bd1951d2…`, about 370 MB) are still on disk**, with about 5.7 GiB free. No accepted run needs them any more. `pruneSubjectBins` removes them only after 3 days unused, so root can delete them now. | `ls $RUST_TS_DATA/subject-bin` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `46dff72a` = `088bdb33` = `b0708f98` | `git diff -- harness/baseline`: 0 lines, 60 files at each |
| Baselines `088bdb33` → `3f2da8d9` | **+212 lines, 0 removed**, in exactly 10 files: +41 in each of `mir-minicore`, `mir-o0`, `mirdump-minicore`, `thirdump-minicore` and `tydump-minicore`; +1 in each of `mir-opt-o4`, `pm-ui`, `pm-expanded` and `miri-pass`; +3 in `miri-pass-heavy`. No duplicate id in any baseline or jsonl |
| Protected ids (`088bdb33`) against this gate's jsonl | **542,092, every one `MATCH`**; none missing from the `3f2da8d9` baselines |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `b0708f98`, `dirty: []`, `unstableOk`, `upstreamOk`, `unitTestSkips` 1 allowed 1. Every suite has `lost: []`, `lostSkipped: []`, `oracleTimeouts: []`, `upstreamChanges: []`, and 0 batch-only failures or timeouts. `gained` totals 212, the same ids as the baseline diff. Baseline sum 542,092, match 542,304, total 542,643 |
| `history.jsonl` accept entry | 60 suites; each `protected` equals the line count of its baseline at `3f2da8d9` (sum 542,304) |
| `3f2da8d9` | changes only the 10 baselines, `README.md`, `docs/next.md`, `docs/state/current.json` and `history.jsonl` (the accept and one decision) |
| Unstable | `miri-pass` `tests/panic/panic1.rs`, as in wave 40h |

**Every row, this gate against wave 40h's.** The same 60 suites. The id sets are equal in 55 suites. In the five minicore suites each
gained 100 ids and lost none. Every changed row:

| Suite(s) | Rows | Change | Explanation |
|---|---|---|---|
| `mir-minicore`, `mir-o0`, `mirdump-minicore`, `thirdump-minicore`, `tydump-minicore` | 100 each, new | 41 `MATCH`, 59 `UNPORTED` | harness-w49 now evaluates `needs-llvm-components`. These 100 were each suite's `needs-llvm-components` skips in wave 40h (the new rows are exactly the skips that went away). The same 41 ids are `MATCH` and protected in all five suites. The 59 stop on built-in target specs not yet ported (`i686_unknown_linux_gnu` 11, `avr_none` 6, `nvptx64_nvidia_cuda` 4, ...; plan D3) |
| the same five, `.skipped.jsonl` | 420 kept rows, reason text | `needs-llvm-components …` → the next reason | the next skip directive now shows: `add-minicore` 368, `min-llvm-version` 13, `max-llvm-major-version` 7, aux crates 29, `needs-asm-support` 3. Same ids, same order. 589 → 489 skips per suite |
| `mir-opt-o4` | `tests/mir-opt/dump_dataflow.rs` | UNPORTED (`write_graphviz_results`) → MATCH | dataflow-graphviz |
| `pm-ui`, `pm-expanded` | `tests/ui/proc-macro/expand-expr.rs` | UNPORTED (`MaybeCrossThread::run_bridge_and_client`) → MATCH | pm-cross-thread |
| `miri-pass` | `tests/pass/open_a_file_in_proc.rs` | UNPORTED (`open_file_or_dir`) → MATCH | miri-host-fs |
| `miri-pass-heavy` | `issue-miri-3680.rs`, `shims/fs-permissions.rs`, `shims/fs.rs` | UNPORTED (`std::fs::remove_file` / `metadata`) → MATCH | miri-host-fs |
| `mir` (6), `run-pass-miri` (9) | 15 | `attempts` only | the same 15 retried cases as in wave 40h (§5) |

No other row changed in any field, and every other `.skipped.jsonl` and `.extra.jsonl` file is byte-identical to wave 40h's. The non-`MATCH` rows are
DIFF 28 (unchanged), UNPORTED 308 (wave 40h's 20, minus the 7 now `MATCH`, plus the 295 new minicore rows), TIMEOUT 2
(`run-pass-miri-heavy`, as before), UNSTABLE 1.

**Static steps** (`.data/tmp/gate-w48.log`, N4). The log opens with `note: subject binary (… 1712b4a9…, … 9df9f9f3…)`. Typecheck, unit
tests, alone, runner, markers, marker order, info sites and frozen lists are all `ok`, with 1 allowed skip. Frozen lists: 48/48 `MATCH`
(`check-ui`, `mir`, `mir-o2`, 16 each), the same ids as wave 40h, in binary mode with this gate's two hashes.

| Junit report | wave 40h | wave 40i | Gone | Added |
|---|---|---|---|---|
| `unit-tests.junit.xml` | 7,396 (1 skip) | 7,421 (1 skip, allowlisted `read_binary_file_handles_lying_stat`), 0 failures | 4. `json.oracle.test.ts`'s name carries a temp path, as before. Three were stub tests replaced in the same files by tests of the ported code: `dataflow_contract.test.ts` "reaches the graphviz stub" and "stubs stop as UNPORTED in their own module"; `miri/shims/unix/fs.test.ts` "std::fs stand-in: … host operations unported" | 29: `std/fs.test.ts` 11, `std/sync/mpsc.test.ts` 10, `framework/graphviz.test.ts` 4, `dataflow_contract.test.ts` 2, `unix/fs.test.ts` 1, `json.oracle.test.ts` 1 (renamed) |
| `unit-tests.alone.junit.xml` | 39 | 39 | 0 | 0 |
| `runner-unit-tests.junit.xml` | 434 | 436, 0 failures | 0 | 2, in `harness/compiletest.test.ts` (harness-w49) |

The three replaced tests belong to approved lanes (dataflow-graphviz, miri-host-fs). Each stub test is gone because the stub is gone.

## 2. Growth is genuine

**All 212 new ids are `MATCH` in this gate's jsonl, and in wave 40h's gate none of them was `MATCH`.** The 7 non-minicore ids were
registered at both commits (their keys are unchanged). The 205 minicore ids are among the 500 newly registered keys.

**Re-runs.** From this worktree at `3f2da8d9` (same `src/`, `harness/` and `scripts/` as `b0708f98`), with `RUST_TS_AGENT=w40i-audit`, I
ran `bun scripts/difftest.ts --suite S --filter <id>`, once with `RUST_TS_SUBJECT=source` and once with `binary`. The binary half built this
worktree's own builds (`a69fff9c…`, `bd2254ac…`). **Their `meta.json` `inputs`, `config` and `bun` equal the gate builds', and their `rts`
sizes are the same** (182,136,818 and 187,288,562 bytes). The bytes differ only where the repo path is embedded. I deleted both afterwards.

| # | Suite | Id | Source | Binary |
|---|---|---|---|---|
| 1 | `miri-pass` | `tests/pass/open_a_file_in_proc.rs` | MATCH | MATCH |
| 2 | `miri-pass-heavy` | `tests/pass/issues/issue-miri-3680.rs` | MATCH | MATCH |
| 3 | `miri-pass-heavy` | `tests/pass/shims/fs-permissions.rs` | MATCH | MATCH |
| 4 | `miri-pass-heavy` | `tests/pass/shims/fs.rs` | MATCH | MATCH |
| 5 | `mir-opt-o4` | `tests/mir-opt/dump_dataflow.rs` | MATCH | MATCH |
| 6 | `pm-ui` | `tests/ui/proc-macro/expand-expr.rs` | MATCH | MATCH |
| 7 | `pm-expanded` | `tests/ui/proc-macro/expand-expr.rs` | MATCH | MATCH |
| 8 | `mir-minicore` | `tests/ui/linkage-attr/unstable-flavor.rs#bpf` | MATCH | MATCH |
| 9 | `mir-minicore` | `…/function-return/thunk-extern-requires-non-large-code-model.rs#kernel` | MATCH | MATCH |
| 10 | `mir-o0` | `tests/ui/debuginfo/dwarf-versions.rs#five` | MATCH | MATCH |
| 11 | `mir-o0` | `…/invalid/regparm/requires-x86.rs#x86_64` | MATCH | MATCH |
| 12 | `mirdump-minicore` | `…/function-return/requires-x86-or-x86_64.rs#aarch64` | MATCH | MATCH |
| 13 | `thirdump-minicore` | `tests/ui/pointer_authentication/enable_pointer_authentication_validation.rs#mixed` | MATCH | MATCH |
| 14 | `tydump-minicore` | `tests/ui/sanitizer/crt-static.rs` | MATCH | MATCH |
| 15 | `tydump-minicore` | `tests/ui/target-feature/similar-feature-suggestion.rs` | MATCH | MATCH |

Each run's `summary.json` records the intended mode (`source` with no bins; `binary` with my two hashes). The picks cover all five minicore
suites and the components `bpf`, `x86` and `aarch64`.

**Compiletest would register the new minicore cases.** compiletest at the pin (`directives.rs:1252` `ignore_llvm`) ignores a test when
any component in its `needs-llvm-components` is missing from `config.llvm_components`. I scanned the 100 newly registered cases with my own
parser, which keeps `//@ needs-llvm-components:` lines and `//@ [rev]` / `//@[rev]` lines for the case's revision. They need `x86` 62,
`aarch64` 20, `avr` 6, `nvptx` 5, `amdgpu` 2, `riscv` 2, `arm` 1, `m68k` 1 and `bpf` 1. The 41 protected ones need `x86`, `aarch64`,
`nvptx` and `bpf`. Every one is defined in the oracle's `libLLVM.dylib` (`nm -gU`: `LLVMInitialize<T>TargetInfo` for 19 targets,
AArch64 to Xtensa). So **no case has a missing component, and none would be ignored by this rule.** Every case has at least one
applicable line. That is a different route from harness-w49's (which reads `rustc_driver`'s imports against `rustc_llvm`'s component
lists), and it agrees. The other directives that decide registration are handled by harness code this wave did not change. The 41 cases'
remaining skips moved to their next reason, as shown in §1.

## 3. Expectation tampering: none

`git diff 46dff72a b0708f98` outside `docs/` and `README.md`: 40 files. 4 are in `harness/` (`compiletest.ts`, its test, `suites.ts`)
and 9 in `scripts/`; the rest are in `src/`. **No file changed in `tools/`, `harness/baseline/`, `harness/corpus/`, oracle outputs,
`package.json`, `tsconfig.json`, `bunfig.toml`, `bun.lock` or `UPSTREAM.json`.**

**Reviewed batches.** All four lanes branch from `1b4bf086`, whose code (`harness scripts src tools`) equals `46dff72a`'s. For each of the
40 files, exactly one lane changed it, and its blob at `b0708f98` equals the blob at that lane's reviewed head. The exceptions are the 3
files of root's fix, which equal `ea15d152`'s blobs:
- dataflow-graphviz `5f595507` (docs/reviews/dataflow-graphviz.md, APPROVE WITH NITS);
- pm-cross-thread `c83b5052` (pm-cross-thread.md, APPROVE WITH NITS);
- miri-host-fs `eaf28904` (miri-host-fs.md, APPROVE WITH NITS);
- harness-w49 `920fb64c` (harness-w49.md, APPROVE WITH NITS, reviewed at `0bf9b004` + `920fb64c`);
- root's fix `ea15d152` (root-w49-check.md, APPROVE WITH NITS): `region_infer/graphviz.ts`, `obligation_forest/mod.ts` and
  `framework/graphviz.ts`.

`git diff 1b4bf086 920fb64c -- harness scripts` equals `git diff 46dff72a b0708f98 -- harness scripts`, index lines aside. **So the merge
brought exactly the reviewed harness and scripts changes**: Item A (`needs-llvm-components`, `0bf9b004`) and Item B (queued nits in
`gate.ts`, `unit-steps.ts`, `subject-bin.ts` and the subject-bin tools, `920fb64c`). No lane file is missing from the final diff.

### Oracle keys

`scripts/oracle-keys.ts` over every registered case, in `git archive` trees of each commit (each with this worktree's `.env.local` and
`node_modules`):

| | `46dff72a` | `b0708f98` |
|---|---|---|
| keys | 372,181 in 72 suites | **372,681** in 72 suites |
| sha1 | `6d1b393ca382…` (the w40h audit's and harness-w49 review's "before") | `d4ab0b6119be…` (harness-w49 review's "after") |
| suites not listed | 0 | 0 |

**Exactly 500 keys are new, 100 in each of `mir-minicore`, `mir-o0`, `mirdump-minicore`, `thirdump-minicore` and `tydump-minicore`, the
same 100 ids in each. 0 keys changed and 0 went away**, and the common ids keep their order. The new ids per suite are exactly the 100 new
jsonl rows. Nothing else moved: no protected case's oracle was re-run or rewritten. The three `ERROR` matches in the dumps are a
revision name (`overflow-check-ops.rs#ERROR`), not error lines.

## 4. The binary is the tested tree

| Check | Result |
|---|---|
| Key of `src/rust_ts/main.ts` at `b0708f98` | **`1712b4a9c41dfac06b4c17376fbb3f6bf329d462`**, 2,099 inputs |
| Key of `src/miri/bin/miri.ts` at `b0708f98` | **`9df9f9f372a3586835f6382a42008078e9d9023c`**, 2,287 inputs |
| `gate.json` `subject`, all 60 `<suite>.summary.json` and the 3 frozen-lists summaries | `mode: binary` with exactly these two hashes |
| `meta.json` of each build | `hash` equal; `inputs` (paths and sha1s), `config` (`tsconfig.json`, `package.json`, `bunfig.toml`, `bun.lock`) and `spec` **identical** to the recomputation; Bun 1.4.3 `c6da4a4d`; built 19:23:14Z and 19:23:19Z, after `b0708f98` (19:23:05Z) and before the suites. Only `meta.json` and `rts` are in each directory; my runs did not touch them |

How: in the `b0708f98` archive tree, with that tree as the cwd, `buildSpec` and `subjectBinKey` give the inputs and config. The spec is
rebuilt with `buildSpec(entry, "/Users/tomernorman/Documents/personal/rust-ts", "/Users/tomernorman/.bun/bin/bun")`, and
`subjectBinKeyOf` is applied with the sha1 of the tree's own `scripts/lib/subject-bin.ts` as the builder.

**The `.c` sources at run time** (N1). No `.c` file is a key input. In both bundles (UTF-16 module text), `src/std/thread.ts` calls
`cc({ source: join3($rtsm_dir____4(), "thread.c") })` and `proc_macro_host.ts` calls `cc2({ source: join4($rtsm_dir____5(),
"proc_macro_host.c") })`. The `$rtsm_dir` functions return `/Users/tomernorman/Documents/personal/rust-ts/src/std` and `…/src/rust_ts`.
`rts_client_thread_main`, which is defined only in the C, is absent from both binaries. So bun:ffi's TinyCC compiles the gate checkout's
files from disk in each process that needs them. Direct test, with `expand-expr.rs`'s pm-ui argv (from the difftest raw record, with
`--out-dir` in my scratchpad), cwd the upstream checkout, `RUST_TS_IMPL=port`:

| Binary | Tree's `.c` | Result |
|---|---|---|
| scratch build of the `b0708f98` archive tree (`d7394b60…`, its `$rtsm_dir` = that tree) | intact | exit 1, stderr 2,827 bytes `bf8a06a1f16e`, **byte-identical to the difftest record** |
| the same | `thread.c` + `#error audit-probe` | exit 101: `internal compiler error: Error: 1 errors while compiling <scratch tree>/src/std/thread.c` … `thread.c:217: error: #error audit-probe` |
| the same | `proc_macro_host.c` + `#error audit-probe` | exit 101, the same error, naming `<scratch tree>/src/rust_ts/proc_macro_host.c:230` |
| the same | restored (blobs equal `b0708f98`'s again) | exit 1, `bf8a06a1f16e`, identical |
| the gate's `1712b4a9…/rts` | the main checkout's | exit 1, `bf8a06a1f16e`, identical |

**The gate's `.c` was the committed `.c`.** In the main checkout, `src/std/thread.c`, `src/rust_ts/proc_macro_host.c` and
`src/std/sync/mpsc_test_echo.c` (and the 5 `rlib-native` corpus `.c`) hash to `b0708f98`'s blobs. The three `src/` files were last
written at 19:23:05Z, the moment of `b0708f98`, before the build, and never since. HEAD is `3f2da8d9` (same `src/`) and the tree is clean. `gateRun` compares
HEAD and `git status --porcelain` at start and end (`scripts/gate.ts:709-711`) and failed nothing, and `.c` files are tracked, so
an edit during the run would have shown unless it was undone within the run. The unchanged mtime rules that out too.

## 5. Margins

Solo times from `gate.json` `retryTimes` (wall / user s, max RSS MB). The same 15 cases were retried in both gates, and every one finished
alone and `MATCH`:

| Case | wave 40h | wave 40i | Δ wall | pool load at timeout (40h → 40i) |
|---|---|---|---|---|
| `dynamic-drop.rs` | 39.5 / 48.1, 2,134 | **39.6 / 48.5**, 2,132 | +0.1 | 166 → 137 |
| `issue-8827.rs` | 38.4 / 45.7, 1,947 | **39.2 / 46.7**, 1,948 | +0.8 | 198 → 153 |
| `error-tainting-issue-122904.rs` | 27.9 / 32.0, 3,890 | 28.2 / 32.5, 3,908 | +0.3 | 87 → 102 |
| `recursive-drop-elaboration-2.rs` | 27.9 / 32.4, 3,932 | 28.1 / 32.3, 3,898 | +0.2 | 92 → 119 |
| `recursive-drop-elaboration.rs` | 27.9 / 32.2, 3,913 | 27.9 / 32.5, 3,926 | 0.0 | 92 → 119 |
| `move-3-unique.rs` | 27.6 / 32.8 | 27.1 / 32.3 | −0.5 | 178 → 126 |
| `repeated-vector-syntax.rs` | 20.7 / 26.8 | 20.6 / 26.4 | −0.1 | 140 → 105 |
| `issue-52475.rs` | 20.4 / 21.2 | 19.8 / 20.6 | −0.6 | 153 → 158 |
| `recursion-etc.rs` | 16.8 / 18.8 | 16.8 / 18.9 | 0.0 | 194 → 129 |
| `unique-send-2.rs` | 16.2 / 23.0 | 16.1 / 22.9 | −0.1 | 132 → 126 |
| `macro-comma-support-rpass.rs#std` | 15.0 / 24.1 | 15.2 / 24.3 | +0.2 | 162 → 122 |
| `infinite_loop.rs` | 14.3 / 15.0 | 14.3 / 15.1 | 0.0 | 153 → 158 |
| `projection-cache-rematch-impl-141124.rs` | 14.1 / 18.4 | 14.2 / 18.4 | +0.1 | 124 → 131 |
| `let-else-drop-order.rs` | 13.7 / 20.9 | 13.6 / 20.6 | −0.1 | 159 → 113 |
| `macro-comma-support-rpass.rs#core` | 12.5 / 21.2 | 12.4 / 21.5 | −0.1 | 162 → 122 |

**Steady**: every solo time is within ±0.8 s of wave 40h's. The largest, `dynamic-drop.rs` at 39.6 s, leaves 20.4 s of the 60 s limit
and 5.4 s under the 45 s line of the 2026-11-10 decision. **No new retried case** (`retried`: `mir` 6, `run-pass-miri` 9, the same ids).

**Power and host.** `host.allowBattery` false, `powerLost` `[]`. 148 samples (19:23:12Z-01:59:37Z), all on AC, every one with a power
reading, largest gap 643 s. AC at both marks of all 60 suites. 1-minute load: median 50 (wave 40h 49), peak 180 (181), 18 samples above
100 (26). Swap 3.4-4.5 GB (2.2-3.9). Suites 23,252 s against 22,191 s (N2). Up 7 days, no reboot.

**Suite times** (N2). The A/B ran `tests/ui/sanitizer/crt-static.rs`'s tydump argv (`bun <tree>/src/rust_ts/tydump.ts …`, from the
raw record), alternating the `46dff72a` and `b0708f98` archive trees 8 times each, at load 2-3. Medians were 0.599 s and 0.587 s
(minimum 0.556 / 0.554 s), with one output hash for both. So the wave did not make a tydump process slower to start or run, and the slowdown
was not code.

## 6. Coverage and criteria

`bun scripts/coverage.ts` at `3f2da8d9`: **24,330 / 27,053 fns ported (89.93%) across 66 crates**, equal to the README and
`state.ts summary` (N3). Miri 1,506 / 1,535 (98.1%); `rustc_mir_dataflow` 378 / 378; `rustc_graphviz` 58 / 58; `rustc_session` 411 / 446;
vendor 5,307 / 17,360 (60 crates); library 690 / 2,260 in 62 marked files (`library/proc_macro` 364 / 364).

`scripts/criteria.ts --run gate-20261110-192312-root-ehou` (gate at `b0708f9875`, `pass=true`):

| Group | Result | Threshold |
|---|---|---|
| M6b run-pass | 3,474 / 3,478 = 99.88%, met | 90% |
| M6b run-fail | 294 / 294 = 100%, met | 90% |
| M6b miri-pass | **354 / 360 = 98.33%**, met (wave 40h 350 / 360) | 80% |
| M7a ir-hello | not met: "ir-hello: not in this gate" | 100% |
| M7a mir-o2 | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a mono-ui | 3,475 / 3,479 = 99.89%, met | 99% |
| M7a check-rg | 34 of 34 crates, met | 33 |

Only miri-pass moved (+4: `open_a_file_in_proc.rs` and the three heavy fs cases), matching the README's "354 of 360".

## What I did not check

- **Protected cases outside my 15** were not re-run. Their status comes from the gate's jsonl, compared row by row with wave 40h's.
- **The lanes' code beyond the paths above**, and their reviews' open nits (harness-w49 N1-N4, root-w49-check N1-N3, and the rest).
  Those belong to their reviews. I checked only that the merged files are the reviewed ones.
- **Typecheck and the unit steps** were not re-run. I relied on the gate's log and junit reports.
- **The cause of N2.** The gate records load and swap, not memory pressure per suite.
- **Linux or Windows behaviour of the run-time `.c` compile.** The root host only.

## Side effects outside my scratchpad

**No oracle cache entry was written:** no file under `oracle-cache` is newer than the start of this audit (02:01Z). The upstream checkout
is clean (`git status --porcelain`: 0 paths, after all runs), with no `rustc-ice-*` file.
- `.env.local` was copied into this worktree, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0` appended (gitignored).
  `bun install --frozen-lockfile` made this worktree's `node_modules` (gitignored).
- 30 run directories, about 8 KB each: `$RUST_TS_DATA/runs/w40i-audit-{source,binary}-{1..15}`. They are report files, and nothing
  compared reads them.
- Two subject builds keyed to this worktree's path (`$RUST_TS_DATA/subject-bin/a69fff9c…`, `bd2254ac…`, about 370 MB), made by the
  binary re-runs. **I deleted them.** The scratch build for §4 was under my scratchpad (`root` option) and is deleted too, as are the two
  archive trees. Nothing of mine touched the gate's builds (`meta.json` 19:31:57Z, `rts` 19:23Z, unchanged). Building ran `pruneSubjectBins`,
  which removed nothing (wave 40h's builds are still there, N5).
- The Miri re-runs wrote files to their per-case `MIRI_TEMP` directories, `$RUST_TS_DATA/tmp/miri-temp/{f421aeb33e507df5,b64563247cee3396,50ffb423cdb7de61}`.
  They hold 8 small files that upstream's `fs.rs` and `fs-permissions.rs` leave behind by design (`utils::prepare` cleans them at the next
  start), as the gate's own runs of these cases do.
- `expand-expr.rs` re-runs through difftest wrote its `--emit metadata` under the upstream checkout's `build/` (compiletest's output
  directory, which the cleanliness check excludes), as the gate does.
- The key dumps and difftests called suites' `cases()`, which touched the mtimes of 814 cached aux entries under `aux/`. Git refreshed the
  upstream checkout's index on the harness's cleanliness checks.
- `coverage.ts` rewrote `$RUST_TS_DATA/coverage.json` (from this worktree, at `3f2da8d9`, same figures as the README).
- `rustc +nightly --print sysroot` ran once with the default `RUSTUP_HOME` (never with `rustup-miri`).

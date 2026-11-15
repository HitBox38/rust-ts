# Review: lane pm-self (wave 40t), independent reviewer

**Verdict: APPROVE WITH NITS.**

Subject: branch `t3/port-proc-macro-self`, commits `81219b31` and `dc8dadd0`. Their parent is `6a74a1de`, root's Mangler.cpp
pin, which sits on main `9c662b55`. The lane's own diff, `git diff 6a74a1de dc8dadd0`, adds two files:
`src/rust_ts/proc_macro_host.self.test.ts` (new, 178 lines) and `docs/handoff/pm-self.md`. It changes no compiler code,
harness, scripts or baselines. `git diff 9c662b55 dc8dadd0` also shows `harness/llvm-manifest.json`, but that is root's commit
`6a74a1de`, not the lane's.

Reviewed on branch `t3/review-pm-self-proc-macro` at `dc8dadd0`. Host: on AC power, Bun 1.4.4. `.env.local` came from
integ-w39, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. No gate was running. Load average was 55–73 on 12 cores
throughout: other lanes were running.

## 1. Is the claim true? Yes, as far as I reproduced it.

### pm-ui and pm-expanded with port-built aux (reviewer's own scratch driver)

I wrote the driver independently of the lane's `pmself.ts`, which was not committed. Per case, it:
- takes `harness/suites.ts`'s pm-ui and pm-expanded case argv and env;
- takes `uiFileCases(.., {aux, procMacro, needs})`'s `auxSteps`;
- copies the oracle's aux directory to scratch;
- rebuilds every `host` step there, first with the oracle (dylibs set aside for a byte check), then with
  `src/rust_ts/main.ts`;
- runs the main compile with the port against the port-built aux, and with the oracle against the original oracle-built
  aux;
- compares raw stdout, stderr and exit (no difftest masking), with the scratch path mapped back.

| case | kind of macro | pm-ui | pm-expanded | port-built dylib vs oracle's |
|---|---|---|---|---|
| `tests/ui/proc-macro/derive-same-struct.rs` | derive | MATCH | MATCH | identical (1/1) |
| `tests/ui/proc-macro/attr-stmt-expr.rs` | attribute (PRINT-ATTR, 8.8 kB stdout, exit 1 with errors) | MATCH | MATCH | identical (2/2) |
| `tests/ui/proc-macro/nodelim-groups.rs` | function-like (6.3 kB stdout) | MATCH | MATCH | identical (1/1) |
| `tests/ui/proc-macro/dollar-crate.rs` | attribute + derive + bang | MATCH | MATCH | identical (1/1) |
| `tests/ui/proc-macro/quote/basic.rs` | function-like | MATCH | MATCH | **differs** (`libbasic`, F1) |
| `tests/ui/rfcs/rfc-3348-c-string-literals/edition-spans.rs` | function-like | MATCH | MATCH | **differs** (`libcount`, F1) |

The two dylibs that differ are on the handoff's list of 11 crates. The `libbasic` case is the strongest behaviour check
here. `run_tests!` runs 39 `assert_eq!`s on `quote!` output inside the macro, at expansion time. The port-built dylib with
F1's `__text` differences passes all 39 in the port's host. For this case pm-expanded's argv has `-o`, so the expanded source
goes to a file rather than stdout. I compared that file separately: identical.

### serde_derive 1.0.228 (reproduced)

Setup:
- a scratch cargo project with `serde = "=1.0.228"` (feature `derive`);
- an isolated `CARGO_HOME` with `registry/{index,cache}` copied from `$RUST_TS_DATA/ripgrep/cargo`, used `--offline`;
- the lock resolved to the handoff's versions (proc-macro2 1.0.106, quote 1.0.46, syn 2.0.119, unicode-ident 1.0.24,
  serde_core 1.0.228);
- a `RUSTC_WRAPPER` that sends `--crate-name serde_derive` to the port and everything else to the oracle;
- `CARGO_INCREMENTAL=0`, `-j 6`.

The port built it. I set its dylib aside, then ran `cargo clean -p serde_derive` and rebuilt with the oracle, which gave the
same path and the same `-C metadata`.
- **Dylib**: same size, 3,777,128 bytes. Differs in **212 bytes**, as the handoff says: 36 in `__text`, 16 in the LC_UUID
  and 160 in the code signature. `nm -gU` is identical (`___rustc_proc_macro_decls_bafbf40a8d77b899__`,
  `_rust_metadata_serde_derive_bafbf40a8d77b899`), and the `.rustc` section is byte-identical. The `__text` hunks are swapped
  stack-slot offsets (`str x8, [x10, #0x190]` against `#0x180`). They are in six functions: `alloc::str::replace::<char>`,
  `serde_derive::de::identifier::deserialize_custom` and four `syn::Attribute::parse_args_with` instances. That is exactly the
  handoff's list.
- **The port loads it.** The test crate has `#[derive(Serialize, Deserialize)]` with `rename`, `default`,
  `skip_serializing_if`, an internally tagged enum `#[serde(tag = "type")]`, and a borrowed tuple struct. I ran cargo's own
  argv for it twice: with the port and the port-built dylib, and with the oracle and the oracle-built dylib.
  - with `-Zunpretty=expanded` appended: **MATCH**, 771 lines of stdout, plus JSON stderr, exit 0;
  - with cargo's `--emit=dep-info,metadata,link` replaced by `--emit=metadata`: **MATCH**, and the rmeta is byte-identical
    (44,852 bytes).
  - With cargo's `--emit` left as it is, the port stops at `unported: llir: LLVMRustGetSymbols` while writing the rlib. That
    confirms F2 independently.

I did not repeat the full 282-case run or the all-port build of syn, quote and proc-macro2. The latter needs rg-fix-a's
uncommitted `LLVMRustGetSymbols` shim.

## 2. The new test: does what it says

`src/rust_ts/proc_macro_host.self.test.ts`:
- **What it checks.** It builds one proc-macro crate (a derive with a helper attribute, an attribute macro, a function-like
  macro, and a `compile_error!` macro) with the oracle and then with the port, into the same path. The install name is the
  output path, so the dylibs can be compared byte for byte. Then it checks:
  1. the dylib and rmeta are byte-identical, and the decls symbol is exported;
  2. `-Zunpretty=expanded` gives the same stdout, stderr and exit when the port loads the port-built dylib as when the oracle
     loads the oracle-built one. This is checked for a successful expansion and for an error raised by a macro.
- **Mutations (each applied, run, then reverted with `git checkout`):**
  - `src/rustc_codegen_ssa/back/symbol_export.ts:174`: the decls static no longer exported (`if (id !== undefined && false)`).
    **All 3 tests fail.** The port's link stops (`unported: …LinkingFailed::into_diag`), and `build_both`'s
    `expect(p.stderr).toBe("")` catches it.
  - `src/rust_ts/proc_macro_host.ts:219`: the host's loader skips the first `ProcMacro` (`let i = 1`). Test 1 passes, as it
    should: the bytes are unaffected. **Both expansion tests fail.** One times out at its 60 s limit, the other fails at once.
- **Time.** I measured 13.1–16.9 s wall over three runs, at load average 55–73. CPU was 6.7 s user and 1.65 s sys. I could not
  check the handoff's 3.6 s on this host at this load; see N1. Either figure is fine for the gate's unit step.
- **Gating.** Like `proc_macro_host.oracle.test.ts`, it skips visibly when the pinned rustc is missing, and fails under
  `RUST_TS_REQUIRE_PROBES=1`. On win32 it skips with a warning.
- **Environment.** By name it reads only `RUST_TS_REQUIRE_PROBES`. Its children get a copy of the environment minus the
  usual list (`MAKEFLAGS`, `RUSTC_LOG`, …), which is the pattern of 59 existing test files.
  `scripts/lib/unit-steps.test.ts` passes with the new file in place.
- **Scratch.** It uses `test_scratch_dir("pm-self")`, which is removed in `afterAll`. Nothing was left under
  `$RUST_TS_DATA/tmp` after my runs, including the failing mutation runs.

## 3. F1's attribution: confirmed

The decisive check is whether the pinned `opt` (in the oracle sysroot's `lib/rustlib/aarch64-apple-darwin/bin`), run on the
**oracle's own** textual pre-pass IR (`--emit=llvm-ir -Cno-prepopulate-passes`), gives the port's post-pass IR. Comparisons
below drop comment lines, trailing `;` comments and `source_filename`.

| crate | port pre-pass vs oracle pre-pass | port post-pass vs `opt -passes='default<O0>'` on oracle pre-pass text | port post-pass vs oracle post-pass |
|---|---|---|---|
| `pub fn f(s: &str) -> String { s.replace('a', "b") }` (lib) | 0 lines differ | 0 lines differ | 76 lines differ |
| `rfc-3348…/auxiliary/count.rs` (proc-macro, cgu=1) | 0 | 0 | 94 |

For the first crate, the oracle prints `%len.i25` and `%len.i20`. The port and the text round trip both print `%len.i6` and
`%len.i1`, and `opt -passes=always-inline` alone gives the same. So the port builds the same IR, and the difference comes
entirely from re-parsing the text: the in-process use-list order that LLVM's AlwaysInliner follows is lost. It is not proc-macro
code and not the port's IR construction. The handoff's proposed fix, `uselistorder` directives, is plausible but I did not check
it.

**Does it matter for M7d?** No. plan-m7 D2 says parity is pre-pass IR normal form and behaviour, and that "IR after passes,
object and binary bytes are not gates". The M7d criterion is one `pm-self` case, which compares behaviour, and every behaviour
comparison above MATCHes. It matters only to anyone who wants byte-identical objects (bootstrap or M9 reproducibility), so
it belongs in the model lane's queue, as the handoff proposes. One consequence for the new test: its byte-identity check
(test 1) is stricter than D2. It holds for its crate because no function in it has two always-inline call sites of one callee.
The test's header comment says so, and the expansion tests do not depend on test 1.

## 4. Regressions: none found

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (27349; 95 llvm-wrapper; vendor 5392; library 745; llvm 634).
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rust_ts/proc_macro_host*.ts ./scripts/lib/unit-steps.test.ts`: 24 pass, 0 fail.
- `bun scripts/difftest.ts --sample 200 --jobs 6`, `RUST_TS_AGENT=review-pm-self-k3`, both suites with oracle-built aux as
  protected:
  - pm-ui: 200/200 MATCH (skipped 2), run `20261115-092836-review-pm-self-k3-4bk1`;
  - pm-expanded: 200/200 MATCH (skipped 2), run `20261115-093019-review-pm-self-k3-fcmz`.

The lane changed no `src/` file outside the new test, so no protected suite can move.

## Findings

No F (must-fix) findings.

**N1.** `docs/handoff/pm-self.md:18`, `:106`. "3.6 s wall" could not be reproduced here: I measured 13–17 s wall at load
average 55–73, with 8.4 s CPU (user + sys). Give the CPU time next to the wall time, or the load it was measured at, so that
root can budget the unit step.

**N2.** `docs/handoff/pm-self.md:67`. "the dev profile (`-Cdebuginfo=2`)" is not true of serde_derive itself. Cargo builds a
proc macro as a build dependency (build-override), and its argv has no `-C debuginfo`. Only serde, serde_core and the test
crate get `-C debuginfo=2`. So the serde_derive evidence is for a debuginfo-free build. That doesn't weaken the claim, but say
so.

**N3.** `src/rust_ts/proc_macro_host.self.test.ts:164`. Test 1 asserts that the port-built dylib is byte-identical to the
oracle's. While it passes, the two expansion tests load the same bytes as the oracle-built dylib, which
`proc_macro_host.oracle.test.ts` already covers. The case that is new, the port's host running a port-built dylib that
*differs* (F1), is covered only by the scratch evidence: libbasic's 39 in-macro asserts above, and serde_derive. It's not
needed for this lane; harness-m7d's `pm-self` suite will cover it with real aux. If a unit test should pin it, use a crate
with two always-inline call sites of one callee, such as `count.rs`'s `number_of_tokens`.

**N4.** `src/rust_ts/proc_macro_host.self.test.ts:32`. Gating checks only the pinned rustc. The port's path also needs the
pinned llvm-tools (`opt`, `llc` in the oracle's sysroot) and the host's `cc` and `nm`. If they are missing and
`RUST_TS_REQUIRE_PROBES` is unset, the test fails instead of skipping. This is the same as the existing oracle tests, and the
llvm-tools are part of the pinned toolchain, so no change is required.

## For root

- F2 (`LLVMRustGetSymbols`) is reproduced: a cargo `--emit=…,link` of an ordinary lib stops there. It is already routed to
  llir-callbr-mangler.
- F3 (`-C incremental`) was not exercised, since I set `CARGO_INCREMENTAL=0`.
- The reviewer's driver differs from the lane's in one way: it compares raw outputs with no difftest masking. All 12
  comparisons were exact.

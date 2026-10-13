# Handoff: harness-w12 (M2b with-std suites; harness batch, needs an independent review)

Branch `lane/harness-w12`, based on main 31568d0. Only `harness/suites.ts` changes (plus this file). Baselines,
runner scripts, probes and the existing suites are untouched; the three new suites start unprotected. No ported
upstream code, so no coverage numbers, no `// rustc:` markers, no `unported(...)`, no `// PORT:`.

## Files touched
- `harness/suites.ts`: suites `expanded`, `unpretty-expanded`, `resdump` (appended after the nocore block;
  the nocore definitions are not edited, `NOCORE_ENV` and `NOCORE_SKIPPED` are reused).

## Setup
- Cases: every `.rs` under tests/ui (the `parse`/nocore corpus, 21,526 files; id = path) minus 3 skipped
  (below), so 21,523. Single mode (one process per file). Same case list for all three suites.
- argv, both sides: `--target x86_64-unknown-linux-gnu --sysroot <oracle sysroot> --edition=<directive, as parse>
  [-Zunpretty=ast-tree,expanded | -Zunpretty=expanded] <file>`, i.e. the nocore argv minus
  `-Zcrate-attr=feature(no_core) -Zcrate-attr=no_core`. Oracle `rustc +nightly` (resdump: the resdump probe,
  no `-Zunpretty`, as resdump-nocore); subject `src/rust_ts/main.ts` / `src/rust_ts/resdump.ts`.
- std is injected (`standard_library_imports.rs:22-28`: `extern crate std` + `std::prelude::rust_20xx::*`;
  `#![no_std]` files get `core`), so std/core/alloc/... metadata is loaded from the oracle sysroot's
  `lib/rustlib/x86_64-unknown-linux-gnu/lib` (present: libstd/libcore/liballoc rlib+rmeta). Checked on 14 sample
  files with `println!`: oracle output starts with `#![no_std] extern crate std; #[prelude_import] use
  ::std::prelude::rust_2015::*;` and has the `$crate::io::_print(..)` expansion; the subject's output is
  byte-identical.
- Env `NOCORE_ENV` (`RUSTC_ICE=0`, `RUST_BACKTRACE=0`; part of the cache key, as before). Timeouts as nocore:
  subject 60 s, oracle 300 s (+ 4x retry).
- The upstream checkout stayed clean (`git status --porcelain` empty: no `rustc-ice-*`).

## Skip decision (measured)
The 3 `NOCORE_SKIPPED` files still need skipping with std. Oracle with std, one process each, 3 in parallel,
load 8-15 on 12 cores, stdout counted and discarded (`$RUST_TS_DATA/tmp/harness-w12/time.ts`):
| file | ast-tree,expanded | expanded | resdump |
|---|---|---|---|
| associated-consts/issue-93775.rs | killed at 1560 s, 0 bytes out | 0.03 s | 0.02 s |
| expr/if/expr-stack-overflow.rs | killed at 1560 s, 0 bytes out | 0.04 s | 0.03 s |
| parser/survive-peano-lesson-queue.rs | killed at 1560 s, 0 bytes out | 0.10 s | 0.07 s |

1560 s exceeds the oracle's 300 s + 4 x 300 s, so they would be ORACLE_TIMEOUT on every run (never cached).
They are skipped in all three suites, as in nocore, to keep one case list (`STD_SKIPPED` = `NOCORE_SKIPPED` with
" (with std too)" added to the reason).

`try-trait/deep-try-chain-issue-153583.rs` (in the nocore suites) stays: ast-tree,expanded took 353 s with std and
350 s without, measured side by side. That is over the first 300 s attempt but well within the retry, and the
result is cached once per oracle build. Its expanded/resdump runs take 0.03 s.

Other heavy files: 215 candidates (top 15 by size, top 20 by bracket depth, top 15 by count of std macro
invocations (`println!`/`vec!`/`assert*!`/`format!`/`concat!`/...), top 15 by `recursion_limit`, and 168 whose
path mentions deep/stack-overflow/blowup/slow/hang/huge/exponential/quadratic/perf/many-/large), timed on the
oracle with std, 6 in parallel, load ~10 on 12 cores:
| mode | total wall | max | slowest |
|---|---|---|---|
| ast-tree,expanded | 46.5 s | 6.3 s | mir/issue-29227.rs (24.8 MB out), closures/many-closures.rs 4.4 s (38.9 MB) |
| expanded | 10.0 s | 0.12 s | mir/issue-29227.rs |
| resdump | 6.2 s | 0.11 s | closures/many-closures.rs |
No ICE among them; no ORACLE_TIMEOUT in the 2,200 sampled cases below. So nothing else needs skipping.
Scratch: `$RUST_TS_DATA/tmp/harness-w12/` (`time.ts`, `cands.ts`, `t-*.tsv`).

## Sample results (`--impl port`, `RUST_TS_AGENT=harness-w12`, 8 jobs)
| suite | sample | MATCH | DIFF | UNPORTED | other | run |
|---|---|---|---|---|---|---|
| expanded | 300 | 299 | 0 | 1 | 0 | `hw12-expanded` |
| unpretty-expanded | 200 | 199 | 0 | 1 | 0 | `hw12-unpretty` |
| resdump | 200 | 200 | 0 | 0 | 0 | `hw12-resdump` |
| expanded (`--seed hw12-wide`) | 1500 | 1484 (98.9%) | 0 | 16 | 0 | `hw12-expanded-1500` |

No DIFF anywhere, so there are no first-difference lines. UNPORTED stop histogram (`unported` field):
- 300/200 samples: `std::panic::Location::caller (DiagLocation Display)` (track-diagnostics/track8.rs, both
  expanded and unpretty-expanded; same seed).
- 1500 sample (16):
  - 6 `rustc_session::Session::resolve_path (session.rs:934)`: `include!`/`include_str!` paths
    (include-macros/shebang-in-item-ctxt, macros/macro-expanded-include/test, macros/issue-69838-..., asm/named-asm-labels,
    asm/normalize-offsets-for-crlf, abi/stack-probes-lto)
  - 6 `rustc_middle::middle::stability::report_unstable (middle/stability.rs)`: unstable std items used
    (feature-gates/feature-gate-{autodiff-use,contracts,custom_test_frameworks,mgca-type-const-syntax,type_alias_impl_trait},
    const-generics/mgca/unbraced_const_block_const_arg_gated)
  - 1 `rustc_middle::middle::stability::early_report_macro_deprecation` (lint/lint-qualification)
  - 1 `rustc_expand::expand::DeclaredIdents for Box<Item> (not exported by expand.ts yet)` (linkage-attr/link-section-placement)
  - 1 `std::panic::Location::caller (DiagLocation Display)` (attributes/nonterminal-expansion)
  - 1 `std::path::Path::file_name` (const-generics/mgca/adt_expr_erroneuous_inits)

So M2b porting left, by frequency: `Session::resolve_path` (include macros), middle/stability.rs
(`report_unstable`, `early_report_macro_deprecation`), `Location::caller` for `-Ztrack-diagnostics`,
`DeclaredIdents` export, `Path::file_name`.

## Cost
- Oracle cache: the 2,200 sampled cases wrote ~11.3 MB (~5 KB/entry gzipped); full corpus x 3 suites
  ~0.3 GB (expanded dominates; its raw outputs reach 39 MB). Disk had 3.1 GB free.
- 1500 expanded cases: 232 s wall at 8 jobs (oracle + subject), so ~55 min per full `expanded` run cold.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun test scripts harness`: no test files there. `bun scripts/coverage.ts --check`:
  markers ok.

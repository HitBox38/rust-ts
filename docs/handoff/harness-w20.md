# Handoff: harness-w20 (M3 ui suites `tydump-ui`, `thirdump-ui`; harness batch, needs an independent review)

Branch `lane/harness-w20`, based on `d5cecdfc` (integ-w19). No ported upstream code: no coverage numbers, no
`// rustc:` markers, no `unported(...)`, no `// PORT:`. No `src/` edits. Baselines, oracle outputs, probes and
the existing suites are unchanged: before committing, every existing suite's `cases()`, `skipped()` and the
oracle/subject argv of its first 50 cases were hashed with the old and the new harness (24 suites, all
identical). The two new suites start unprotected.

## Files touched
- `harness/compiletest.ts`
  - Aux crates (`uiFileCases(.., { aux: true })`): `aux-build`, `aux-crate` (with extern modifiers),
    `aux-bin`, nested aux crates. Ported from runtest.rs `compose_and_run_compiler` / `build_all_auxiliary` /
    `build_auxiliary` / `resolve_aux_path`, directives/auxiliary.rs `parse_and_update_aux` /
    `parse_aux_crate` / `parse_proc_macro`, `TestProps::from_aux_file`. Each aux crate is compiled with its own
    directives for the same revision and `make_compile_args` with `Emit::None`, `AllowUnused::No` and
    `LinkToAux::No`. Crate type is `dylib` (the target spec's `dynamic-linking`), `lib` for
    `no-prefer-dynamic`, `bin` for aux-bin, followed by `-L <aux dir>`. The main compile gets `-L <aux dir>`
    before the test's compile-flags (`has_aux_dir`) and `--extern`s after them.
  - Harness differences, written in the header:
    - every aux build also gets `--emit=metadata` (M2 D5, the shape tydump-minicore uses; there is no linker
      for x86_64-linux on this host, and a dylib needs one);
    - so `--extern` names `lib<name>.rmeta`;
    - the aux dir is `$RUST_TS_DATA/aux/ui/<key>`. The key hashes the oracle build, the case id and every aux
      command, env and source. The directory is built in a temp dir and renamed into place.
  - A failing aux build skips the case with the oracle's first error line. `proc-macro` aux crates, and aux
    crates whose crate type is proc-macro, are skipped (M6, plan-m2 D6).
  - `testProps(.., { auxFile, extra })`: the new directives (`aux-*`, `normalize-stderr[-32bit|-64bit]`,
    `stderr-per-bitwidth`, `dont-check-compiler-stderr`) are only read when `extra` is set, so the parse-ui
    and minicore case sets cannot change.
  - `compileArgs(.., kind)`: same output for the main compile. `-Zparse-crate-root-only` moved to the caller
    (still last).
  - `collectUiTests`: the old `collect`, now exported. `uiCases` is now `collectUiTests` + `uiFileCases`,
    memoized as before.
  - `uiBlessed(id, args)`: `expected_output_path` (`<stem>[.<rev>].stderr` or `.64bit.stderr`; no fallback
    from a revision file to the plain one, as upstream; a missing file means empty) and runtest.rs
    `normalize_output`. That covers `$DIR`, `$SRC_DIR`, `$COMPILER_DIR`, `*_REAL`, `$TEST_BUILD_DIR` (also
    for the harness aux dir), `SRC_DIR:LL:COL`, platform differences, long-type hash, thread id, tabs, `//~`
    removal, v0 hashes, alloc ids, and custom rules (Rust regex/replacement syntax translated; an
    untranslatable rule makes the case N/A).
    - Added: the dist oracle's `/rustc/<commit>/library` also becomes `$SRC_DIR`. The oracle's std is
      remapped at build time; compiletest's local std is remapped by `-Zsimulate-remapped-rust-src-base`.
    - Not reproduced: `$BUILD_DIR`.
- `harness/suites.ts`
  - New optional `Suite.subsets` and `Suite.blessed`.
  - New suites `tydump-ui` and `thirdump-ui` (block before `suite()`).
- `scripts/difftest.ts`
  - `--report blessed` (also `RunOptions.report`): report only, never a status. It writes
    `<suite>.blessed.jsonl` and summary `blessed`, and prints one line.
  - Per-subset counts (summary `subsets`, one line each) for suites with `subsets`.
  - Nothing changes for suites without these fields.
- `harness/compiletest.test.ts` (new): aux-build, nested aux-crate with `priv:` modifier, proc-macro skip,
  `uiBlessed` paths and normalization. compiletest.ts is loaded in a child process. deps.test.ts overrides
  `RUST_TS_DATA` before its first import of common.ts, and `bun test scripts harness` shares one module
  cache, so a static import here made deps.test.ts fail.
- `docs/state/{history.jsonl,current.json}`: one decision recorded (host, aux, dump subset, report).

## Suite definitions
- Cases:
  - `tydump-ui`: every UI test (and revision) as compiletest collects it under tests/ui/typeck and
    tests/ui/traits, plus every tests/ui test with a `#[rustc_dump_*]` attribute
    (`/#!?\[[^\]\n]*\brustc_dump_\w+/`, so `cfg_attr` too).
  - `thirdump-ui`: the same plus tests/ui/thir-print.
- Argv: compiletest.ts `human` format (as tydump-minicore). This includes `-Znext-solver=coherence`,
  revisions (`--cfg`, `--check-cfg`), edition, compile-flags, rustc-env, and aux crates as above. Only the
  harness's trailing `-Zparse-crate-root-only` is dropped.
  - Unlike the minicore corpus, which filters every occurrence, a test's own `-Zparse-crate-root-only` is
    kept. Four const-traits tests pass it, and `parse-const-unsafe-trait.rs` lost it in my first full run.
- env `{ ...NOCORE_ENV, ...compiletest env }` (as minicore). Timeouts: 60 s subject, 300 s oracle. One
  process per case. Probes `tydump` / `thirdump`.
- Host: compiletest runs as on `x86_64-unknown-linux-gnu` (plan-m2 D1, `COMPILETEST_TARGET`, like every ui
  suite), not as on `RUST_TS_HOST_TUPLE=aarch64-apple-darwin`. Otherwise the case set would depend on the
  machine. Recorded as a decision; root may override.
- Subsets:
  - `typeck+traits`: tests/ui/typeck/ + tests/ui/traits/.
  - `rustc_dump`: 119 cases. The plan says 127. At the pin, 111 files carry a `rustc_dump_*` attribute
    (119 cases with revisions), and only 60 of those files use the check_crate/typeck dumps.
  - `thir-print`: thirdump-ui only.
- Skipped: 15 cases per suite.
  - 6 `needs-llvm-components`;
  - 2 `needs-asm-support`, 2 `needs-unwind`, 1 `needs-threads`, 1 `needs-rustc-debug-assertions`
    (compiletest.ts evaluates no `needs-*` except `needs-subprocess`, as before);
  - 1 `only-aarch64`;
  - 1 `incremental`;
  - 1 proc-macro aux (`typeck/invalid-sugg-for-derive-macro-issue-136343.rs`).
- 57 cases use oracle-built aux crates (all built fine).

## Numbers (full runs, `--report blessed`; runs `hw20-full2-tydump` / `hw20-full2-thirdump`)
| suite | total | MATCH | DIFF | UNPORTED | CRASH | TIMEOUT | ORACLE_TIMEOUT | match% |
|---|---|---|---|---|---|---|---|---|
| tydump-ui | 1849 | 970 | 10 | 868 | 0 | 1 | 0 | 52.46 |
| ↳ typeck+traits | 1744 | 920 | 10 | 813 | 0 | 1 | 0 | 52.75 |
| ↳ rustc_dump | 119 | 51 | 0 | 68 | 0 | 0 | 0 | 42.86 |
| thirdump-ui | 1860 | 969 | 10 | 880 | 0 | 1 | 0 | 52.10 |
| ↳ typeck+traits | 1744 | 919 | 10 | 814 | 0 | 1 | 0 | 52.69 |
| ↳ rustc_dump | 119 | 51 | 0 | 68 | 0 | 0 | 0 | 42.86 |
| ↳ thir-print | 11 | 0 | 0 | 11 | 0 | 0 | 0 | 0 |

- Samples (`--sample 300`, seed harness-w20):
  - tydump-ui: 153 MATCH, 1 DIFF, 146 UNPORTED;
  - thirdump-ui: 152 MATCH, 1 DIFF, 147 UNPORTED.
- Wall time: ~10 min per full suite with a cold oracle cache; the subject alone takes about the same.
- Blessed report (tydump-ui): PASS 908, FAIL 795 (almost all are UNPORTED subjects), NOT_COVERED 134, N/A 12
  (`dont-check-compiler-stderr`).
  - 106 of the NOT_COVERED cases start with an empty oracle line: later-phase diagnostics (borrowck, const
    checking, layout, dead code, symbol names).
  - Others:
    - "aborting due to" count lines where later errors follow.
    - Environment differences, all report-only:
      - `rustc_dump_def_parents.rs`: the crate hash differs from the in-tree compiler's.
      - `attributes/args-checked.rs`: the future-incompat report only exists in JSON mode.
      - Two long-type tests: the out-dir does not exist, so rustc prints the full type. Creating it would
        make the output nondeterministic, because the long-type hash depends on pointers.
      - `next-solver/issue-118950-root-region.rs`: the probe misses a tracing WARN (see below).

## DIFF list (11 non-MATCH; each rerun twice per D6, identical every time: no flakes, no harness bugs left)
Port bugs, for root. All are trait solving (`tests/ui/traits/`):
1. `non_lifetime_binders/foreach-partial-eq-next-solver.rs` (`-Znext-solver=globally`): the wrong goal is
   reported (`PartialEq` instead of `PartialOrd`). Line 40 `no implementation for \`T < T\` and \`T > T\`` |
   `\`T == T\``.
2. `next-solver/fn-trait.rs`: line 131, `expected an \`Fn()\` closure, found \`extern "C" fn() -> i32 {g}\`` |
   `expected an \`FnOnce()\` closure, found \`unsafe fn() -> i32\``. The error choice or order differs.
3. `dyn-iterator-deref-in-for-loop.rs#next`: an extra `E0277 the size for values of type \`dyn Iterator<..>\`
   cannot be known` after the oracle's last error.
4. `next-solver/cycles/normalizes-to-is-not-productive.rs`: an extra `E0277 the trait bound \`Foo: Bound\` is
   not satisfied`.
5. `next-solver/implied_outlives_bounds_not_resolving_vars_ice.rs`: an extra `E0271 type mismatch resolving
   \`Foo<fn(&())>::Assoc == &()\``.
6. `next-solver/normalize/success-results-in-unconstrained-infer.rs#old`: the oracle hits `assert!(!ty.has_non_region_infer())`
   (traits/outlives_bounds.rs:49, via compare_impl_item `new_with_implied_bounds_compat`) and ICEs. The
   subject goes on and prints `aborting due to 3 previous errors`.
7. `next-solver/overflow/incorrect-old-solver-caching-ice-148095.rs#old`: the oracle hits
   `assert!(self.query_mode == TraitQueryMode::Canonical)` (select/mod.rs:235) and ICEs. The subject does not.
8. `projection-cache-rematch-impl-141124.rs#old`: the oracle hits `bug!` at select/mod.rs:2381 ("impl .. was
   matchable ..") and ICEs. The subject prints an error instead.
9. `projection-cache-rematch-impl-141124.rs#next`: subject TIMEOUT (> 60 s, both reruns). The next solver
   hangs or is too slow.

Can never MATCH as the harness stands (root decision):
10. `next-solver/cycles/use-impl-to-normalize-own-self-ty-ice.rs#old` and
    `projection-cache-rematch-impl-122529.rs#old`: both sides hit the same `bug!` (select/mod.rs:2381). But
    rustc's ICE report holds `/rustc-dev/<commit>/..:line:col`, a thread id and a `RUST_BACKTRACE=short`
    backtrace (compiletest's env), and the port prints `rust-ts: internal compiler error: ..`.
    - Cases 6-8 end up the same once fixed.
    - These are `known-bug` / `failure-status: 101` / `dont-check-compiler-stderr` revisions.
    - Statically skipping that directive set would also drop 2 such revisions that MATCH today, because
      their ICE is in MIR. So I kept them all.

## Top 15 UNPORTED stops (tydump-ui; thirdump-ui is the same plus 11 `rustc_interface::passes::analysis (M3+)`)
| n | stop |
|---|---|
| 135 | `rustc_type_ir::binder::EarlyBinder::iter_identity_copied / bind_iter` (lane tyir-binder) |
| 133 | `mir_borrowck provider (not ported)` |
| 116 | `rustc_metadata cstore_impl: Decodable for DenseBitSet<u32>` |
| 98 | `rustc_metadata cstore_impl: Decodable for CodegenFnAttrs` |
| 76 | `rustc_metadata cstore_impl: Decodable for ty::ConstConditions<'static>` |
| 73 | `LayoutOf::layout_of (Const::from_bits; layouts are M4)` |
| 42 | `rustc_trait_selection::traits::select::SelectionContext::select` |
| 42 | `TyCtxt::const_eval_resolve_for_typeck` (const eval: M4) |
| 28 | `QueryKey for (ty::Predicate, WellFormedLoc)` (cache) |
| 21 | `rustc_type_ir::elaborate::supertrait_def_ids` |
| 20 | `layout_of provider (not ported)` |
| 15 | `ty::Value: valtree().kind()` |
| 12 | `error_reporting::infer::TyCategory::from_ty` |
| 8 | `vtable_entries provider (not ported)` |
| 8 | `suggestions::NextTypeParamName::next_type_param_name` |

## Notes for root
- **Probe gap (tools/probes, not edited):** tydump/thirdump do not call rustc's `init_rustc_env_logger`. So
  the tracing `WARN` lines that the real rustc prints by default never appear. Example: the oracle `rustc`
  on `next-solver/issue-118950-root-region.rs` prints one; the probe prints none. This affects every
  probe-based suite. Fixing it changes their oracle outputs, so it needs its own batch.
- **tydump-minicore/thirdump-minicore** filter every `-Zparse-crate-root-only` out of a test's argv
  (suites.ts `minicoreCorpus`), including one the test passes itself. I left them unchanged (existing
  suites); the new suites drop only the harness's trailing one.
- thir-print cases pass `-Zunpretty=thir-tree/flat` in their compile-flags, so the thirdump probe runs
  rustc's own unpretty path (full `analysis`, M4) rather than its dump. It also creates the out-dir under
  `$RUST_TS_DATA/rust/build/` (rustc's `write_dep_info`; tydump/thirdump themselves stop before it).
- The gate (`bun scripts/gate.ts`) does not pass `--report`; run `difftest --suite tydump-ui --report
  blessed` separately for the report. Subset counts are always in the summary.
- Checks:
  - `bunx tsc --noEmit -p .` is clean.
  - `bun test scripts harness`: 16 pass, 0 fail (12 deps + 4 new compiletest tests), in either order.

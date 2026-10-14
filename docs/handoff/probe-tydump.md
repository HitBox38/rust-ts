# Handoff: probe-tydump (wave 13, M3; harness/probe batch, needs an independent review)

Branch `lane/probe-tydump`, based on main 2e11981. Baselines are not touched; the three new suites are
unprotected. No ported upstream code, so no coverage numbers and no `// rustc:` markers
(`bun scripts/coverage.ts --check`: markers ok). Two `unported(...)`, no `// PORT:`.

## Files touched
- `tools/probes/tydump/{Cargo.toml.in,main.rs,prefix.rs}` (new): rustc-dev probe; `prefix.rs` is the D1/D1a
  analysis prefix, shared with thirdump through `#[path]`.
- `tools/probes/thirdump/{Cargo.toml.in,main.rs}` (new): rustc-dev probe.
- `src/rust_ts/tydump.ts`, `src/rust_ts/thirdump.ts` (new): subjects, modelled on `resdump.ts`
  (`port` / `shim` / `stub`).
- `harness/suites.ts`: suites `tydump-nocore`, `tydump-minicore`, `thirdump-minicore` (milestone M3).

## 1. The D1/D1a prefix (`tools/probes/tydump/prefix.rs`)
- Both probes use `after_expansion` (right after `resolver_for_lowering`), run the prefix, print, and
  return `Stop`. Nothing is written to disk; the exit code is rustc's.
- The prefix is `run_required_analyses` (passes.rs:1100) up to and including `definitions.freeze()` (:1161),
  statement by statement, with `rustc_hir_analysis::check_crate` (lib.rs:145) inlined.
- Differences from upstream, all listed in the file header:
  - the debug-assertions-only `hir_id_validator::check_crate` is left out (the release oracle does not run
    it either);
  - **D1a**: check_crate's `DefKind::Static | DefKind::Const` arm (lib.rs:166-184:
    `eval_static_initializer`, `maybe_check_static_with_link_section`, `eval_to_const_value_raw`) is
    left out;
  - the `#[rustc_dump_*]` dumps are crate-private upstream, so collect/dump.rs, outlives/dump.rs and
    variance/dump.rs are copied verbatim, each fn with an `// upstream: <path>:<line> <name>` marker.
    The crate-private `diagnostics::TypeOf` is built the way its derive builds it:
    `Diag::new(dcx, Error, DiagMessage::Inline("{$ty}"))`, then `arg("ty")` and `span`.
    Known limit: with `-Ztrack-diagnostics`, or on a `span_delayed_bug` ICE, the "created at" or
    "delayed at" location names the probe file;
  - the prefix returns `num_definitions()` measured right after `hir_crate_items`. This is an
    observation only, and tydump uses it (see 2).
- Validation:
  - mini_core.rs: thirdump with `THIRDUMP_FORMAT=tree` is byte-identical to the real
    `rustc -Zunpretty=thir-tree` (12,028 lines).
  - mini_core_hello_world.rs: the outputs differ only in `alloc_id: allocN` numbering, which is the expected
    D1a effect (real analysis const-evaluates statics first). The port must reproduce the D1a numbering.
  - The other differences from real thir-tree in the minicore set are all later-phase effects that D1
    excludes: MIR ICE, THIR unsafety E0133, and output-file write errors.

## 2. tydump output (format, sections and sort keys are in the `main.rs` header)
- `== items (<n>)`: every local DefId `0..num_definitions()` in DefIndex order, after freeze.
  - Each DefId gets a header line `<LocalDefId:?> <DefKind:?>`, then the facts that apply to it:
    `generics_of`, `clauses_of` (the pin's name for `predicates_of`), `type_of`, `fn_sig`,
    `variances_of`, `explicit_item_bounds`, `impl_trait_header`, then `typeck` with the TypeckResults
    fields.
  - Whether a fact applies is decided by upstream's own predicates, copied verbatim from
    rustc_metadata `encoder.rs` (`should_encode_{generics,type,fn_sig,variances}`). The encoder's
    ConstArg-AnonConst skip is copied too.
  - TypeckResults: hir_owner, tainted_by_errors, type_dependent_defs (method resolutions), field_indices,
    node_types, node_args, user_provided_types/sigs, adjustments, pat_binding_modes,
    rust_2024_migration_desugared_pats, pat_adjustments, skipped_ref_pats, closure_kind_origins,
    liberated_fn_sigs, fru_field_types, coercion_casts, used_trait_imports, hidden_types,
    closure_min_captures, closure_fake_reads, coroutine_stalled_predicates, transmutes_to_check,
    offset_of_data.
  - ItemLocalMaps use `items_in_stable_order`.
  - `node_args` and `skipped_ref_pats` have no listing accessor, so they are probed for every
    ItemLocalId of the owner's HIR.
  - Hash-ordered maps are sorted by DefIndex. Index maps keep their insertion order.
  - Values are formatted under `with_no_trimmed_paths!`. The query calls are not wrapped, so diagnostics
    they emit are rendered as rustc renders them.
- **Fix found while measuring.** On erroneous crates, a DefId can exist without HIR, e.g. a closure
  inside an attribute expression (`tests/ui/attributes/issue-90873.rs`). Querying it ICEd in
  `lower_to_hir`. Facts are now dumped only for:
  - DefIds with HIR: an owner, or a key of the owner's `lower_to_hir(..).children`;
  - DefIds created after lowering (index ≥ the prefix's count).

  Every other DefId gets only its header line. After the fix the full nocore corpus has 0 ICEs, and
  mini_core's output did not change.

## 3. thirdump
The steps are the prefix, then `abort_if_errors` (pretty.rs:336), then
`"{did:?}:\n{thir_flat(tcx, did)}\n"` for every `hir_body_owners()`. That is `{:#?}` of `thir_body`,
as `-Zunpretty=thir-flat` prints it, which is what the lane brief asks for.
`THIRDUMP_FORMAT=tree` switches to `thir_tree`, which is the plan's pretty.rs:321 loop. Each function
steals the THIR, so one run can print only one format. The suites use flat.
**Decision for root to record:** thirdump prints flat by default; the tree format stays available via
the env var.

## 4. Suites (`harness/suites.ts`)
- `tydump-nocore`: resdump-nocore's cases, argv, env and the same 3 skips, run through tydump.
  21,523 cases.
- `tydump-minicore` / `thirdump-minicore` share one case list of 46 cases, with 589 skipped:
  - cg_clif `mini_core.rs` as a lib, and `mini_core_hello_world.rs` with
    `--extern mini_core=<rmeta>`. Both use cg_clif's `rustc_command` flags (build_system/tests.rs), plus
    the target and sysroot from M2 D1.
  - The aux rmeta is built by the oracle (M2 D5) with `--emit=metadata` into
    `$RUST_TS_DATA/aux/mini_core-<key>/`. The key hashes rustcDriverHash, the source and the flags, so
    the oracle cache key follows any change. It is built on first use, when the case list is made.
  - The tests/ui files that are natively `#![no_core]` or say `add-minicore` (275 files) run with
    compiletest's UI argv (`uiCases(.., "human")`). The `-Zparse-crate-root-only` that uiCases appends
    for parse-ui is filtered out.
  - The skips carry compiletest.ts's reasons: 524 `needs-llvm-components`, 36 other `needs-*`,
    16 `add-minicore`, 11 aux crates, 2 `only-*`.
- **Follow-ups for root / harness-w13 / harness-w20.** These are not done here: they change
  compiletest.ts, which the protected parse-ui suites share, or the sparse checkout.
  1. Evaluate `needs-llvm-components`. The oracle's LLVM has all components, and this is 524 of the 589
     skips.
  2. Support `add-minicore` (D11): `tests/auxiliary` in the sparse checkout, minicore built by the
     oracle with `-Cpanic=abort`, and `--extern minicore=`.
  3. Optionally give `uiCases` a flag to omit `-Zparse-crate-root-only`, instead of the filter.
- Cases whose compile-flags include `-Zunpretty=..` (tests/ui/hygiene/unpretty-debug*.rs) take rustc's
  pretty path, so the probe callbacks never run. This holds on both sides, as with resdump.

## 5. Oracle measurements (probe run directly, 8 jobs, this Mac)
| suite | cases | exit 0 / 1 / 101 | non-empty stdout | lang_item fatal | ORACLE_TIMEOUT | p50 / p90 / max |
|---|---|---|---|---|---|---|
| tydump-nocore (full) | 21,523 | 78 / 21,445 / 0 | 840 | 17,462 | 0 | 34 / 52 / 442 ms |
| tydump-minicore | 46 | 15 / 31 / 0 | 40 | 5 | 0 | 38 / 97 / 129 ms |
| thirdump-minicore | 46 | 15 / 31 / 0 | 12 | 5 | 0 | 31 / 432 / 533 ms |

- The full tydump-nocore oracle pass takes 1:46 wall time and produces 5 MB of stdout.
- mini_core's tydump output is 3,185 lines (282 KB), and hello_world's is 540 KB. thirdump's flat output
  for the two is about 480 KB each.

## 6. Sample difftests (`RUST_TS_AGENT=probe-tydump`)
| suite | impl | result |
|---|---|---|
| tydump-nocore | port, `--sample 200` | 12 MATCH, 188 UNPORTED, 0 DIFF |
| tydump-nocore | shim, `--sample 200` | 200/200 MATCH |
| tydump-minicore | port, full | 4 MATCH, 42 UNPORTED, 0 DIFF |
| tydump-minicore | shim, full | 46/46 MATCH |
| thirdump-minicore | port, full | 4 MATCH, 42 UNPORTED, 0 DIFF |
| thirdump-minicore | shim, full | 46/46 MATCH |

The MATCHes are cases that stop before typeck, at parse, expansion or resolve errors.

## 7. unported(...) left
- `src/rust_ts/tydump.ts`: `rust_ts::tydump::prefix::run_required_analyses_prefix (AST lowering,
  rustc_hir_analysis::check_crate and typeck are not ported)`, in `after_expansion`.
- `src/rust_ts/thirdump.ts`: `rust_ts::thirdump::prefix::run_required_analyses_prefix (... THIR building
  are not ported)`, in `after_expansion`.

## Checks
- `bunx tsc --noEmit -p .` clean.
- `bun scripts/coverage.ts --check` ok.
- `bun scripts/probes.ts build tydump thirdump` both build; each binary is a few hundred KB.
- Free disk at the end: about 840 MB, down from 1.3 GB, mostly other activity and the oracle cache.

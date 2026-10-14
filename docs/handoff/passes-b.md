# Handoff: passes-b (M3): rustc_passes `check_attr.rs` + `stability.rs`

Branch `lane/passes-b`, based on main 816b5c5. Not merged, not pushed. No baselines, suites, probes, oracle outputs or
runner scripts touched.

## Result
- `check_mod_attrs` (check_attr.rs) and `check_mod_unstable_api_usage`, `stability_implications`, `lookup_stability`,
  `lookup_const_stability`, `lookup_default_body_stability`, `lookup_deprecation_entry` (stability.rs) are real
  providers, registered in `rustc_passes::provide`. Also `lib_features` (see "lib_features" below).
- Oracle test against the tydump probe: 9 cases byte-identical (stderr + exit code), 4 PENDING on pieces outside this
  lane (lint levels on HIR, `effective_visibilities`).
- Measured on a scratch merge of this lane + `lane/tydump-subject` + `lane/passes-a` (not committed anywhere):
  tydump-nocore `--sample 200` goes from 19 to **32 MATCH, 0 DIFF**. 164 of the 168 UNPORTED now stop at
  `check_type_wf provider (not ported)` (wave 17), i.e. after misc_checking_1. So check_attr and stability no longer
  block the prefix.

## Files
- **New (assigned):**
  - `src/rustc_passes/check_attr.ts`: check_attr.rs, 49/49. `CheckAttrVisitor` is a class extending rustc_hir
    intravisit's `Visitor` (`NestedFilter = OnlyBodies`). `ProcMacroKind` and its manual `IntoDiagArg` are hand-written.
  - `src/rustc_passes/check_attr.gen.ts`: GENERATED, new codegen set `rustc_passes_check_attr`. It holds only the
    file-local `#[derive(Diagnostic)] DiagnosticOnConstOnlyForNonConstTraitImpls`; `CheckAttrVisitor` and
    `ProcMacroKind` are in the set's `skip` list, with notes.
  - `src/rustc_passes/stability.ts`: stability.rs, 46/46. `MissingStabilityAnnotations`, `Checker` and
    `CheckTraitImplStable` are `Visitor` classes.
  - `src/rustc_passes/lib.ts`: `check_attr::provide`, `stability::provide` and `lib_features::provide` registered.
    `pub mod stability` is exported; `mod check_attr` is private, as upstream.
- **New, outside the assignment:**
  - `src/rustc_passes/lib_features.ts` and `src/rustc_middle/middle/mod.ts` (`lib_features::{FeatureStability,
    LibFeatures}`): **copied byte for byte from `lane/passes-a`**, which ports them too. `check_unused_or_stable_features`
    always reads `tcx.lib_features(LOCAL_CRATE)`. The files are identical in both lanes, so the merge has no conflict
    there.
  - `tools/codegen/types.sets.json`: the set `rustc_passes_check_attr`. **Root: tools/ change, please review.**
    Regenerate with `bun tools/codegen/types.ts rustc_passes_check_attr`.
  - Tests:
    - `src/rustc_passes/check_attr_stability.oracle.test.ts`.
    - `src/rustc_passes/oracle/attr_stab_run.ts` (the subject runner, not a port).
- **Merge with passes-a:** `src/rustc_passes/lib.ts` conflicts, because both lanes add imports and `provide` lines.
  The resolution is the union: imports `check_attr`, `check_export`, `diagnostic_items`, `eii`, `entry`,
  `lib_features`, `stability`. tydump-subject's `delegation` export auto-merges. Checked on the scratch merge: tsc clean.

## Coverage (`bun scripts/coverage.ts --missing`)
- `compiler/rustc_passes/src/check_attr.rs`: **49/49**
- `compiler/rustc_passes/src/stability.rs`: **46/46**
- `compiler/rustc_passes/src/lib_features.rs`: 7/7 (passes-a's file)
- `compiler/rustc_middle/src/middle/mod.rs`: 1/1 (passes-a's file)
- `--check`: markers ok (13438; vendor 3888)

## Tests
`check_attr_stability.oracle.test.ts`. The oracle is the tydump probe: its prefix runs `check_mod_attrs` +
`check_mod_unstable_api_usage` per module in misc_checking_1. The subject runs AST lowering and then both queries per
module. Only stderr and the exit code are compared, on `#![no_core]` libraries with the `sized` lang items, where
nothing else in the probe's prefix emits a diagnostic.
- MATCH (9):
  - `repr_ok`
  - `repr_errors`: E0692 and E0566 (struct and enum)
  - `doc_alias`: bad location on an impl block and on a trait-impl assoc const; same as the item's name
  - `doc_keyword`: keyword / attribute not on an anon const, `fake_variadic` not on an impl, `search_unbox`
  - `must_implement_one_of`: no default, not a function, not found
  - `may_dangle`: type and lifetime params outside `Drop`
  - `linkage`: `const fn`
  - `unknown_feature`: E0635 ×2
  - `paths`: the stability `Checker` over `use` trees and paths
- PENDING (4), each asserted to reach the listed `unported`:
  - `lint_repeated_repr`, `lint_unused_empty_allow` and `optimize_inline` reach
    `rustc_lint::levels::shallow_lint_levels_on`. **Every lint emitted from these passes (`emit_node_span_lint`)
    stops there**, because the HIR side of rustc_lint levels.rs is not ported.
  - `staged_api` reaches `effective_visibilities provider (not ported)` (rustc_privacy). **Every `#![feature(staged_api)]`
    or `-Zforce-unstable-if-unmarked` crate stops there** (`MissingStabilityAnnotations`).
- Negative check: before the lang items were added, the probe's typeck errors made the runs differ, so the comparison
  is effective.

Difftest (`RUST_TS_AGENT=passes-b`, on this branch alone):

| suite | sample | MATCH | DIFF | UNPORTED | run |
|---|---|---|---|---|---|
| tydump-nocore | 200 | 19 | 0 | 181 | 20261014-165903-passes-b-4ruc |
| hir-tree-nocore | 100 | 100 | 0 | 0 | 20261014-165936-passes-b-u39t |

On this branch tydump's `after_expansion` is still the old `unported` stub. The prefix lives on `lane/tydump-subject`,
so the 181 stops are not this lane's.

Scratch merge of passes-b + tydump-subject + passes-a: tydump-nocore `--sample 200` gives 32 MATCH / 0 DIFF / 168
UNPORTED (run 20261014-170037-passes-b-skmt). The stops:
- 164 `check_type_wf provider (not ported)`
- 2 `shallow_lint_levels_on`
- 1 delegation `skip_binder`, which predates this lane
- 1 `rustc_middle::hir::map::TyCtxt::hir_get_parent_item (HIR, M3)` in `tests/ui/deprecation/unit_and_tuple_struct.rs`.
  This is the m2b-stability stand-in in `src/rustc_middle/middle/stability.ts:305` (`eval_stability_allow_unstable`),
  reached through `Checker::check_path`. `hir_get_parent_item` is ported now (hir/map.ts), so it is a one-line repoint
  for the owner of that file. After it comes `late_report_deprecation`'s own `unported` (def_path_str/def_descr/lint).

## unported(...) left
- `check_attr.ts`: `rustc_passes::check_attr::CheckAttrVisitor::check_proc_macro (ObligationCtxt, error reporting; wave 17)`.
  It is reached only for `#[proc_macro*]` fns when the `TokenStream` diagnostic item exists. The rest of the upstream
  body (check_attr.rs:1237-1323) is summarised in a comment there. It needs `ObligationCtxt` (still `Pending` in
  rustc_trait_selection/decls.ts), `note_type_err` and `report_fulfillment_errors`.
- `stability.ts`: none.
- Blockers in other files (see Tests): `shallow_lint_levels_on` (rustc_lint levels.rs, HIR side), the
  `effective_visibilities` provider (rustc_privacy), `middle/stability.ts`'s `hir_get_parent_item` stand-in and
  `late_report_deprecation`.

## PORT decisions
- `CheckAttrVisitor.abort: Cell<bool>` is a mutable boolean field.
- `match attr.path().as_slice()` (unparsed attributes) is an if-chain over `Attribute.path(attr)`, in the same arm
  order.
- `check_one_parsed_attribute`: the no-op arms are fallthrough `case`s in upstream order. A `never` default keeps the
  switch exhaustive over `AttributeKind`.
- `check_repr`:
  - `sort_unstable_by_key(|(attr, span)| (*attr, span.lo_hi()))` uses a local `cmp_ReprAttr`, the derived `Ord`: variant
    order, then `IntType` (`SignedInt` < `UnsignedInt`, then `IntTy`/`UintTy` discriminants), then `Align.pow2`. Equal
    keys are equal values, so the unstable sort is not observable.
  - `chunk_by(..).filter(len != 1).flatten()` is written out as a loop.
  - `hint_spans` (an iterator cloned at each use) is a closure that builds the array.
- `check_eii_impl`: the `externally_implementable_items` value (typed `unknown`) is read as a map whose values are
  `[EiiDecl, _]`.
- `check_proc_macro`: ported up to the `TokenStream` diagnostic item lookup, then `unported` (see above).
- `ProcMacroKind` is a string union plus `ProcMacroKind_into_diag_arg`.
  `tools/codegen/typemap.passes.json` still maps `rustc_passes::check_attr::ProcMacroKind` to `unknown`, so
  `ProcMacroBadSig.kind` is `unknown` in diagnostics.gen.ts. Root may point the typemap entry at
  `src/rustc_passes/check_attr.ts` (`ProcMacroKind`, `ProcMacroKind_into_diag_arg`) and regenerate the `rustc_passes`
  set. It was left alone because passes-a also edits that set.
- `stability.ts`:
  - `AnnotationKind` is a string union; its derived `PartialEq` is `===`.
  - `FORCE_UNSTABLE` is one shared `Stability`, never mutated.
  - `FxIndexMap<Span, UnstableReexport>` and `FxIndexMap<Symbol, Span>` are insertion-ordered `Map`s.
    `swap_remove` is `index_map_swap_remove` (rustc_errors/decorate_diag.ts), so the iteration order of the
    unknown-feature errors is kept.
  - `UnordMap`/`UnordSet` are `Map`/`Set`. `to_sorted_stable_ord` / `into_sorted_stable_ord` sort by
    `Symbol.stable_cmp`.
  - `find_attr_span!` is a local closure over the three attribute kinds it is used with.
  - The nested fns `recurse` (in `visit_use`) and `check_features` (in `check_unused_or_stable_features`) stay
    nested, each with its marker.
  - Query values typed `unknown` are cast at each use: `lookup_stability`, `lookup_const_stability`, `associated_item`,
    `adt_def`, `generics_of`, `hir_crate_items`, `lib_features`.
- The test runner `oracle/attr_stab_run.ts` runs the modules serially with `hir_for_each_module`, as
  `par_hir_for_each_module` does with `-Zthreads=1`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4743 pass, 1 skip, 1 fail. The fail was
  `hir_ty_lowering/mod_a.test.ts`: its `PENDING probe_assoc_item(C, Const, Tr): unported: lookup_deprecation_entry
  provider (not ported)` line now runs through and gives `probe_assoc_item(C, Const, Tr): Some(C)`. As the test header
  instructs ("update them as those land"), `mod_a_test/lower.expected.txt` has that one line updated; it is
  **outside the assignment**. Re-run after the fix: that test and `src/rustc_passes` give 26 pass, 0 fail.
  The full suite was not re-run (13 min).

## Diagnostics (root/passes-a note)
- Every rustc_passes `diagnostics.rs` diagnostic used here comes from the existing `diagnostics.gen.ts` on main, through
  `./diagnostics.ts`. No stand-ins were made, and nothing was generated for diagnostics.rs.
- The one generated type, `DiagnosticOnConstOnlyForNonConstTraitImpls`, is defined in **check_attr.rs itself**
  (check_attr.rs:55), not in diagnostics.rs. So it is not in diagnostics.gen.ts, and the `rustc_passes_check_attr` set
  generates only it.

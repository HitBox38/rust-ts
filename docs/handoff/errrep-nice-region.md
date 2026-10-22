# Handoff: errrep-nice-region (M3 wave 19, error reporting; row 12 of the errctxt-contract split table)

Branch `lane/errrep-nice-region` (from integ `52b5e37d`, no merges). Commits: `9f5263ee` (port of the five files, first
agent, cut off by a usage limit) → review fix + oracle test + this handoff (resumed agent).

## Files touched
- `src/rustc_trait_selection/error_reporting/infer/nice_region_error/placeholder_error.ts` (7/7):
  `Highlighted_into_diag_arg` (stub filled), `Highlighted_map`, `Highlighted_to_string` (`fmt::Display`),
  `try_report_placeholder_conflict`, `try_report_trait_placeholder_mismatch`, `report_trait_placeholder_mismatch`,
  `explain_actual_impl_that_was_found`.
- `placeholder_relation.ts` (1/1): `try_report_placeholder_relation`.
- `static_impl_trait.ts` (6/6): `try_report_static_impl_trait`, `suggest_new_region_bound`,
  `make_elided_region_spans_suggs`, `NiceRegionError::get_impl_ident_and_self_ty_from_trait`, `TraitObjectVisitor`
  (hand class, `TypeVisitor`), `HirTraitObjectVisitor` (hand class, intravisit `Visitor`). The `export type X = unknown`
  aliases are replaced by the classes.
- `trait_impl_difference.ts` (8/8): `try_report_impl_not_conforming_to_trait`, `emit_err`, fn-local `HighlightBuilder`
  (`build`, `visit_region`), `TypeParamSpanVisitor` (`maybe_tcx`, `visit_qpath` + nested `record_elided_lifetimes`,
  `visit_ty`).
- `mismatched_static_lifetime.ts` (1/1): `try_report_mismatched_static_lifetime`.
- New test `nice_region_error/nice_region.oracle.test.ts` + `nice_region_oracle/{run.ts,cases/*.rs}` (7 cases).
- No edits outside these files (decls.ts, .gen.ts, mod.ts untouched).

Review fix on top of `9f5263ee`: `report_trait_placeholder_mismatch` now calls `opt_item_ident` / `def_span` before
`def_kind(parent)`, in upstream order. Otherwise the port was re-read against upstream and kept as is.

## Coverage
`bun scripts/coverage.ts --missing <file>`: placeholder_error.rs 7/7, placeholder_relation.rs 1/1, static_impl_trait.rs 6/6,
trait_impl_difference.rs 8/8, mismatched_static_lifetime.rs 1/1. rustc_trait_selection 620/976 (was 597); TOTAL 15927/25518.
`bun scripts/coverage.ts --check`: markers ok (16446; vendor 3888).

## Tests
- `nice_region.oracle.test.ts` (9 tests, pass with `RUST_TS_REQUIRE_PROBES=1`):
  - **Oracle, `suggest_new_region_bound` / `make_elided_region_spans_suggs`**: 7 no_core cases (edition 2024) for which the
    pinned rustc reports one borrowck `lifetime may not live long enough` and all of its `help:` children come from
    `suggest_new_region_bound`: opaque with an explicit `'static` (anonymous and named `'a`), opaque without one (`+ '_`;
    new `<'a>` with an `S<'a, 'a>` brackets suggestion; existing named `'a`), trait object with an implicit and with an
    explicit `'static`. Borrowck is not ported, so `nice_region_oracle/run.ts` (scaffolding, not a port) does what
    `add_static_impl_trait_suggestion` (rustc_borrowck region_errors.rs:1001) does up to that call, and reproduces
    `find_param_with_region` for the parameter (util.rs, lane errrep-region). The test compares the `help:` children byte
    for byte, because the parent diagnostic is a scaffold.
  - The lane's 9 `NiceRegionError` methods and `get_impl_ident_and_self_ty_from_trait` are installed, not placeholders.
- No oracle case for the other entry points. `try_report_placeholder_conflict` / `_relation`,
  `try_report_impl_not_conforming_to_trait`, `try_report_static_impl_trait` and `try_report_mismatched_static_lifetime`
  are only reached through `NiceRegionError::try_report` / `try_report_from_nll` (mod.rs, lane errrep-region; its first
  call `try_report_named_anon_conflict` and `tcx()` are still placeholders) from `report_region_errors` (region.rs) or
  borrowck. I ran the pinned rustc with `-Zunpretty=thir-tree` (type checking only) on the 73 tests/ui files whose
  .stderr mentions these diagnostics. None of them emits one before borrowck. Even the trait-impl ones
  (`lifetime-mismatch-between-trait-and-impl.rs`, `param-without-lifetime-constraint.rs`) give E0803 from
  `report_sub_sup_conflict` at the pin, not the `.stderr`'s "`impl` item signature doesn't match". So the first agent's
  5 untracked compare-impl cases, which all give E0803 too, were replaced by the borrowck-help cases above.
- `bun test src/rustc_trait_selection` (`RUST_TS_REQUIRE_PROBES=1`): 75 pass, 0 fail (12 files; includes
  `errctxt_contract.test.ts`).
- `bunx tsc --noEmit -p .`: clean.

## Samples (lane vs base; base = integ worktree at `52b5e37d`, `RUST_TS_AGENT=errrep-nice-region-base`)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-082706-errrep-nice-region-kaqp` | 21 / 0 / 25 | `20261021-082706-errrep-nice-region-base-yq66` | 21 / 0 / 25 |
| thirdump-minicore (46) | `20261021-082725-errrep-nice-region-da2d` | 21 / 0 / 25 | `20261021-082725-errrep-nice-region-base-6ye0` | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-082743-errrep-nice-region-07at` | 289 / 0 / 11 | `20261021-082743-errrep-nice-region-base-hldj` | 289 / 0 / 11 |

Per-case statuses and stops are identical (0 differences). This was expected because nothing reaches these files until
errrep-region lands `try_report` / `report_region_errors`.

## `unported(...)` left
- `print_Highlighted_value` (placeholder_error.ts): `Highlighted<T>` for any `T` other than `Ty`, `Binder<FnSig>`,
  `TraitRefPrintOnlyTraitPath` → `unported("...placeholder_error::Highlighted<T> (Print for this T)")`. Upstream only
  instantiates those three.

## `// PORT:` decisions
1. `Highlighted_into_diag_arg(v, p)` has no printer parameter (generated diagnostics call it untyped), so
   `print_Highlighted_value` picks `T`'s `Print` from the value's shape: `instanceof Ty`, a `Binder` (`bound_vars` +
   `value`) → `Binder<FnSig>`, `{ _0: { def_id } }` → `TraitRefPrintOnlyTraitPath`. A `$print` template in
   `tools/codegen/diag_args.json` for generic `IntoDiagArg` impls would remove this. It is the same need as the
   errctxt-contract `$into0` follow-up.
2. `Highlighted` is `Copy`: `Highlighted_map` and every `Highlighted` built from a shared `RegionHighlightMode` clone
   the mode (`RegionHighlightMode` is a mutable class).
3. `fmt::Display for Highlighted` is `Highlighted_to_string(self, print_T)`. A `fmt::Error` panics with
   `ToString::to_string`'s message, and the second print uses `.expect("could not print type")`'s message.
4. `RegionResolutionError` matches on `error.clone()` read the fields in place, because nothing is mutated.
5. `ValuePairs` equality (`sub_trace.values == sup_trace.values`) is `intern_key` equality. The generated
   `ValuePairs::PolySigs` carries `ExpectedFound<unknown>` (its `PolyFnSig` is not mapped in the codegen typemap), so it
   is cast to `PolyFnSig`.
6. The fn-local `struct HighlightBuilder` (trait_impl_difference.rs:70) is a module-local class with markers on
   `build` / `visit_region`.
7. `Span::lo_hi()` tuple comparison (`sort_by_key` / `dedup_by_key` / `>`) is `cmp_lo_hi`: lexicographic `[lo, hi]`.
   JS sort is stable like `sort_by_key`.
8. `debug!` / `debug_assert_eq!` / `#[instrument]` are kept as comments.

## For root
1. **decls.ts (pending root)**: in the `namespace NiceRegionError` augmentation (decls.ts:1009), the explicit
   `export { new_ as new }` makes the ambient namespace export nothing implicitly. So
   `get_impl_ident_and_self_ty_from_trait` (decls.ts:1016) is not visible as a static. static_impl_trait.ts assigns
   it through a local cast, marked `// PORT(decls)`. Fix: `export function get_impl_ident_and_self_ty_from_trait` (and
   `new_from_span`) in decls.ts. The same pattern is at decls.ts:151/198.
2. Codegen follow-ups: map `PolyFnSig` for `ValuePairs::PolySigs` (`ExpectedFound<PolyFnSig>`), and add a typed `Print`
   argument for generic `IntoDiagArg` impls (`Highlighted<T>`), as described in PORT decision 1.
3. Once errrep-region lands `NiceRegionError::{tcx, try_report, try_report_from_nll}` and `report_region_errors`, the
   other entry points can be tested from borrowck-free paths. At the pin the type checker reaches them rarely or never
   (see Tests). `nice_region_oracle/run.ts` reproduces `find_param_with_region` and can switch to util.ts's real one then.
4. Decision to record: the first agent's untracked compare-impl cases (all E0803 at the pin) were dropped. The lane's
   oracle coverage is the borrowck `help:` children produced through the scaffold runner.

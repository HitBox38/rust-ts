# Handoff: bck-diag-e (M4 wave 25, borrowck diagnostics): diagnostics/{region_errors, region_name}

Branch `lane/bck-diag-e` (from `de448071` on integ-w19, no merges).

## Result
All 48 stubs of the row are filled, in upstream order, with `// rustc:` markers:
- `compiler/rustc_borrowck/src/diagnostics/region_errors.rs` **24/24**: `ConstraintCategory::description`,
  `RegionErrors::{new, push, is_empty, into_iter}` + its manual `Debug`, `RegionInferenceContext::{to_error_region,
  to_error_region_vid, name_regions, is_closure_fn_mut}`, and every `MirBorrowckCtxt` reporter: `report_region_errors`,
  `report_region_error`, `report_fnmut_error`, `report_escaping_data_error` ("borrowed data escapes"),
  `report_general_error` ("lifetime may not live long enough"), `report_erroneous_rvid_reaches_placeholder`,
  `explain_impl_static_obligation`, `suggest_static_lifetime_for_gat_from_hrtb`, `add_static_impl_trait_suggestion`,
  `maybe_suggest_constrain_dyn_trait_impl`, `suggest_constrain_dyn_trait_in_impl`, `suggest_adding_lifetime_params`,
  `suggest_deref_closure_return`, `suggest_move_on_borrowing_closure`.
- `compiler/rustc_borrowck/src/diagnostics/region_name.rs` **24/24**: `RegionName::{was_named, span,
  highlight_region_name}`, `Display` / `IntoDiagArg`, `mir_def_id`, `mir_hir_id`, `synthesize_region_name` (the `'N`
  counter: reads `next_region_name`, stores `+1`, interns `'{c}`), `give_region_a_name` (memoized in `region_names`,
  strategies tried in upstream order) and every `give_name_*` / highlight helper.

Diagnostic text comes from the generated session diagnostics (`LifetimeOutliveErr`, `LifetimeReturnCategoryErr`,
`FnMutError`, `VarHereDenote`, `GenericDoesNotLiveLongEnough`, `RequireStaticErr`) and `msg!` literals copied verbatim as
`{ $: "Inline", _0: ... }`; `format!` texts are copied verbatim. The counter order (`highlight_if_we_cannot_match_hir_ty`
reads the counter before `synthesize_region_name` reserves it; `..._arg_position_impl_trait` synthesizes before `arg_name?`)
is kept.

Contract test (`src/rustc_borrowck/contract.test.ts`): markers 458 → **506** (+48), stubs 443 → **395** (−48), the
`bck-diag-e` row removed from the split table (a comment marks it). Root: merge by deltas.

## Files touched
- `src/rustc_borrowck/diagnostics/region_errors.ts`, `region_name.ts` (bodies, imports, header notes; the stub doc comments
  that were attached to the wrong fns are replaced by upstream's)
- `src/rustc_borrowck/diagnostics/region_name.test.ts` (new: counter / memoization, `RegionName` accessors, Display /
  `IntoDiagArg` / Debug, `ConstraintCategory::description`; the runtime path does not reach region error reporting yet)
- `src/rustc_borrowck/contract.test.ts` (my row, totals, marker count only)

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/diagnostics/region_errors.rs`: 24/24 ported;
`.../region_name.rs`: 24/24 ported. `bun scripts/coverage.ts --check`: markers ok (21345; vendor 4330).

## Runtime path
Not reached: no sample case gets to `report_region_errors` (lib.ts calls it after region inference). The `mir_borrowck`
stops at this base are earlier, in type check / constraint collection (see Samples). No runtime stop was re-pinned.
When reached, these other-lane stubs are next on the reporting paths:
- bck-diag-d: `MirBorrowckCtxt::{buffer_error, local_names, add_placeholder_from_predicate_note,
  add_sized_or_copy_bound_info}` (diagnostics/mod.rs).
- bck-diag-c: `RegionInferenceContext::{get_var_name_and_span_for_region, get_upvar_index_for_region,
  get_upvar_name_and_span_for_region, get_user_arg_index_for_region, get_argument_name_and_span_for_region}` (var_name.rs).
- bck-diag-f: `MirBorrowckCtxt::dcx`, `borrowed_data_escapes_closure` (borrowck_errors.rs),
  `OutlivesSuggestionBuilder::{intermediate_suggestion, collect_constraint, add_suggestion}`,
  `UniverseInfo::report_erroneous_element` (bound_region_errors.rs).

## `unported(...)` left
None in these two files.

## `// PORT:` decisions
- region_errors.ts header: `push`'s `impl Into<RegionErrorKind>` is the identity; `into_iter` returns the array;
  `name_regions` takes `d_T`; `found_dids: &FxIndexSet<DefId>` is a `DefIdSet` (what `TraitObjectVisitor` fills and
  `get_impl_ident_and_self_ty_from_trait` takes; the stub signature said `Set<DefId>`, changed); `category:
  &ConstraintCategory` is the value. **`LIMITATION_NOTE`** (diagnostics/mod.rs:1650, a `const`) is declared locally with a
  `// ref:` comment because diagnostics/mod.ts (bck-diag-d) does not export it at the base: root may move it to mod.ts and
  import it (bck-diag-d's `add_placeholder_from_predicate_note` uses the same text).
- region_errors.ts helpers: `fold_GenericKind` descriptor (as region_context.ts), `find_last` (`rfind`),
  `dedup_span_string` (`Vec::dedup`), `display_Symbol_`; the `for_each` closure with an early `return` is an IIFE.
- region_name.ts header: Display / `IntoDiagArg` names (kept from the contract); `RegionName` (`Copy`, never mutated) is
  returned from the memo without a copy; `next_region_name` (`RefCell<usize>`) is the field.
- `is_re_early_param`: `r.kind() == ReEarlyParam(region)` compares `index` and `name` (derived `PartialEq`).
- `{:?}` texts used only in `span_bug` / `span_delayed_bug` / `bug` messages via the generated Debug fns.
- Init order: region_name.ts is imported at runtime by generated modules, so the hand modules it needs
  (universal_regions.ts, `DefiningTy` methods) are required lazily; region_errors.ts does the same for
  universal_regions.ts, borrowck_errors.ts and bound_region_errors.ts. The fresh-entry contract test passes.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun test src/rustc_borrowck`: 37 pass + region_name.test.ts 3 pass.
- Full unit suite: not run (coordinator: root runs it at integration).

## Samples (`RUST_TS_AGENT=root-f5de`, vs the given base runs, same samples)
| suite | lane run | M / D / U / C / T / UNSTABLE (as run) | after re-running each TIMEOUT alone | base run | M / D / U / C / T / UNSTABLE |
|---|---|---|---|---|---|
| tydump-minicore (46) | `20261027-232236-root-f5de-uhw0` | 40 / 0 / 0 / 0 / 6 / 0 | **46** / 0 / 0 / 0 / 0 / 0 | `20261022-210451-root-f5de-wos5` | 45 / 0 / 1 / 0 / 0 / 0 |
| mirdump-minicore (46) | `20261027-232652-root-f5de-e1l2` | 26 / 0 / 0 / 0 / 20 / 0 | 45 / 0 / 1 / 0 / 0 / 0 | `20261022-210534-root-f5de-p8q4` | 45 / 0 / 1 / 0 / 0 / 0 |
| tydump-ui `--sample 300` | `20261027-233136-root-f5de-ykrv` | 119 / 0 / 20 / 0 / 159 / 2 | **262** / 0 / 36 / 0 / 0 / 2 | `20261022-210624-root-f5de-zjq3` | 261 / 0 / 37 / 0 / 0 / 2 |
| mirdump-ui `--sample 300` | `20261027-235429-root-f5de-0czj` | 234 / 0 / 26 / 0 / 40 / 0 | **273** / 0 / 27 / 0 / 0 / 0 | `20261022-211125-root-f5de-mzgb` | 269 / 0 / 31 / 0 / 0 / 0 |
| borrowck-ui `--sample 300` | `20261028-000702-root-f5de-jjwb` | 0 / 0 / 296 / 0 / 4 / 0 | 0 / 0 / 300 / 0 / 0 / 0 | `20261022-211729-root-f5de-86qn` | 0 / 0 / 300 / 0 / 0 / 0 |

The runs were made under a load average of 200-430 (other lanes), hence the TIMEOUTs. Every TIMEOUT was re-run alone
(`--filter <id> --jobs 1`, log `.data/tmp/bck-diag-e-rerun.log`): all 204 base MATCHes among them are MATCH, the rest
UNPORTED (as in the base) or newly MATCH. **No MATCH lost, no DIFF / CRASH.** The new MATCHes and the moved stops come
from the base tree (de448071 vs the base runs' tree), not from this lane's code, which no case reaches: the
`mir_borrowck` stops now are `rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate` (bck-diag-f;
borrowck-ui 205, mirdump-ui 21, tydump-ui 12), `rustc_borrowck::constraints::OutlivesConstraintSet::push`
(bck-regions-b; borrowck-ui 74, tydump-ui 2), `polonius_engine::AllFacts::default` (wave 26; borrowck-ui 12), plus
non-borrowck stops (`Decodable for mir::Body<'static>` / `(ConstValue, Ty)` in rustc_metadata, `CleanupPostBorrowck`).

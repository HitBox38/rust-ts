# Handoff: typeck-suggest-a (M3 wave 19, error reporting)

Branch `lane/typeck-suggest-a` (from integ `52b5e37d`, no merges). Commits: `a3f1d941` port of method/suggest.rs:1..2432 (first
agent, cut off by a usage limit) → `ec13cbfa` tests (resumed agent) → this handoff. The first agent's uncommitted edit (a
`TEMP-LOCAL-TEST` body for `all_traits`, lane typeck-suggest-b's region) was discarded, not committed.

## Files touched
- `src/rustc_hir_typeck/method/suggest.ts`: region `// ==== lane typeck-suggest-a: method/suggest.rs:1..2432 ====` (all 30 fns
  of the region, in upstream order, incl. `TraitBoundDuplicateTracker` methods, the nested `predicate_bounds_generic_param`
  and `LetVisitor` (`is_sub_scope`, `check_and_add_sugg_binding`, `visit_stmt`, `visit_pat`)); lane a's names removed from the
  `unported_methods` list (that list is gone; lane b's list stays). The lane's imports are a separate block
  (`// ---- lane typeck-suggest-a imports ----`); lane b keeps its own block, so the merge drops names both import.
- `src/rustc_hir_typeck/method/suggest_a.test.ts` (new) + `suggest_a_test/*.rs` (13 `#![no_core]` cases).

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/method/suggest.rs`: 30/60; every missing fn is at :2434 or later
(lane typeck-suggest-b). rustc_hir_typeck 868/1041; TOTAL 15934/25518. `coverage.ts --check`: markers ok (16453).

## Review
A read-only fidelity pass over the four parts of the region (1..880, 881..1442, 1443..1704 + 2227..2432, 1705..2226) against
upstream found no discrepancies: order, markers, branches, message texts, Applicability values, sort/dedup semantics.

## Tests
- `suggest_a.test.ts` (15 tests, pass with `RUST_TS_REQUIRE_PROBES=1`): `TraitBoundDuplicateTracker`; each case through
  `src/rust_ts/tydump.ts` vs the tydump probe (stdout, stderr, exit equal) or a stop in `PENDING`. Today every E0599 case
  stops at `all_traits` (probe.rs `assemble_extension_candidates_for_all_traits`, lane b), before this region.
- **Scratch-merge check (not committed):** integ + this lane + typeck-suggest-b `054995cb` + errrep-sugg-a `efe1c550` +
  typeck-fnsugg-a `245b07f3` + typeck-fnsugg-b `e9cbe126` (conflicts in suggest.ts / fn_ctxt/suggestions.ts resolved by keeping
  both regions and dropping duplicate imports): **12 of 13 cases print exactly the oracle's stdout + stderr + exit** (E0599
  not-found / path / variant / similar-name / unsatisfied inherent + trait impl / static fn / shadowed binding /
  `rustc_confusables` / segment chain; E0624). ambiguity.rs (E0034) stops in probing at
  `SelectionContext::select`, before this region.
- `bun test src/rustc_hir_typeck` (probes required): 136 pass, 0 fail (14 files). `bunx tsc --noEmit -p .`: clean.

## Samples (lane vs base = integ `52b5e37d`, `RUST_TS_AGENT=typeck-suggest-a-base`)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-083054-typeck-suggest-a-hxrn` | 21 / 0 / 25 | `20261021-083203-typeck-suggest-a-base-5ijl` | 21 / 0 / 25 |
| thirdump-minicore (46) | `20261021-083059-typeck-suggest-a-qpa0` | 21 / 0 / 25 | `20261021-083220-typeck-suggest-a-base-1vrj` | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-083105-typeck-suggest-a-6ay4` | 289 / 0 / 11 | `20261021-083234-typeck-suggest-a-base-xz52` | 289 / 0 / 11 |

Per-case status and stop text identical in all three (no new DIFF). The region is unreachable in these samples until
`all_traits` (lane b) lands.

## `unported(...)` left
None in the region. Lane b's placeholders (`all_traits`, `print_disambiguation_help`, the 26 FnCtxt methods) untouched.

## `// PORT:` decisions
1. `PORT(decls): pending root`: decls.ts declares the `&mut bool` parameters of `set_not_found_span_label` /
   `handle_unsatisfied_predicates` as `boolean`, and `SortedMap<Span, Vec<String>>` of
   `suggest_unsatisfied_ty_or_trait` / `suggest_method_not_found_because_of_unsatisfied_bounds` / `handle_unsatisfied_predicates`
   as `Map<OrdSpan, string[]>`. The region uses a local interface `FnCtxt_suggest_a` with the upstream shapes (`MutRef<boolean>`,
   rustc_data_structures `SortedMap<OrdSpan, string[]>`) and calls/assigns these four private methods through it.
2. `report_no_match_method_error`: `let mut ty_file = None` passed as `&mut ty_file` to
   `report_failed_method_call_on_numerical_infer_var` (decls.ts: `long_ty_path` by value); the callee writes it only on its
   error path, which returns, so `ty_file` stays `None` for `create_missing_writer_err`.
3. `TraitBoundDuplicateTracker::has_ref_dupes(&self)` is a static (`TraitBoundDuplicateTracker.has_ref_dupes(t)`): the field
   has the method's name.
4. Header notes: `FxIndexMap`/`FxIndexSet` → insertion-ordered `Map`/`Set` (`DefIdMap`/`DefIdSet`, `KeyedMap`/`KeyedSet` for tuple
   keys); `Vec<String>` sort/dedup by `str_cmp`; `Iterator::eq_by` → length check + `every` (inside a probe).

## For root
1. decls.ts (rustc_hir_typeck): change the four signatures in PORT 1 to `MutRef<boolean>` / `SortedMap<OrdSpan, string[]>` and
   `long_ty_path` of `create_missing_writer_err` / `report_failed_method_call_on_numerical_infer_var` to
   `MutRef<PathBuf | undefined>` (errctxt-contract rule 5); then drop `FnCtxt_suggest_a` and the `ty_file` PORT.
2. After merging typeck-suggest-b, errrep-sugg-a, typeck-fnsugg-a/-b: add the 12 cases to `NOW_EXACT` in suggest_a.test.ts
   (all but ambiguity.rs) and prune `PENDING`.
3. Merge with lane b: suggest.ts conflicts in one hunk around the two `unported_methods` lists (drop both: lane b's list on this side, lane a's on lane b's side) and duplicate
   imports between the two blocks (keep value imports where lane b uses `Symbol` / `Region` as values).

# Handoff: merge-w18d (fixer: finish the merge of `integ-old` into `integ`)

Branch `integ`. Commits: d4cdfd3b (the merge commit, `git commit --no-edit`), 4d7087dd (test re-pins), this handoff.
Inputs: integ 71b10d46 (merge-w18 + lane typeck-gaps) and integ-old (old-* lanes + merge-w18c).

## Overlaps and how they were resolved (16 conflicted files)
| overlap | resolution |
|---|---|
| codegen set `rustc_middle_mir_query` defined twice in types.sets.json (git kept both keys: a JSON duplicate key) | kept **typeck-gaps'** entry (has `resolve_files: ty/mod.rs` and skips `CoroutineSavedLocal`, which nothing uses: sty.ts keeps its local alias until M4); merge-w18c's entry deleted. Output differs from merge-w18c's only by the `CoroutineSavedLocal` newtype. |
| `type_fold.json`: two `ConstraintCategory` entries (auto-merged) | one kept (typeck-gaps note). merge-w18c's `ty::RegionConstraint` / `ty::ArgOutlivesClause` entries kept (only they had them). |
| `infer.typemap.json` ConstraintCategory note | HEAD's note (same mapping on both sides). |
| `queries.config.json` keys | union: `CanonicalMethodAutoderefStepsGoal` (typeck-gaps) + Alias/Dropck/TypeOp* goals (merge-w18c). |
| `query/keys.ts` | union of imports and `KEY_*` values; header comment now lists who wired what; only `(CanonicalQueryInput<T>, usize)` stays `key_unported`. |
| `mir/query.ts` (hand module) | typeck-gaps' header, noting the folded set. |
| `traits/mod.ts` | merge-w18c's side: dropped the stale "PORT: returns ConstraintCategory (not ported)" doc comment. One port of `ObligationCause::to_constraint_category` (traits/mod.rs:137) and of `SubregionOrigin::to_constraint_category` (infer/mod.rs:483); identical on both sides. |
| generated `mir/query.gen.ts`, `infer/canonical.gen.ts`, `queries.gen.ts` | not hand-merged: regenerated with `bun tools/codegen/types.ts <set>` / `bun tools/codegen/queries.ts`. canonical.gen.ts now equals merge-w18c's (real `RegionConstraint` visit/fold via the new type_fold entry, instead of HEAD's `unported_type_fold`). |
Checks: all 47 type sets regenerate with **no diff** (the `rustc_lexer` demo set writes an untracked `src/rustc_lexer/lib.gen.ts`, as before the merge; deleted), `queries.ts --check` up to date, no JSON duplicate keys / duplicate `paths` in tools/codegen/*.json, no `// rustc:` marker duplicated beyond what either parent had.

## Test decisions
- **wfcheck_a.test.ts lint-mode gat.rs: removed (merge-w18c's version), typeck-gaps' `LINT_NOT_MADE` / `without_diagnostics` dropped.**
  Lint mode never calls `check_associated_item`, so it can never print the oracle's second error (`requires
  \`legacy_receiver\` lang_item`); typeck-gaps' version compared against a hand-edited oracle output (diagnostic removed,
  error count rewritten). The `wf`-mode gat.rs case runs the full path and is NOW_EXACT against the unmodified oracle
  stderr, so it covers the same code with a stronger assertion. Its PENDING entries (`RegionName::is_named`,
  `LateParamRegionKind::from_bound`) were stale (gat/marker/unused are NOW_EXACT) and are gone.
- compare_impl_item.oracle.test.ts: HEAD's stricter guard kept (`LINT_CASES` requires exit 0 + a `warning:` line only for
  refine_rpitit, instead of accepting any exit-0 case).
- infer_core.test.ts: merge-w18c's version (all four `to_constraint_category` arms asserted, a superset of HEAD's one).
- coercion.test.ts `mut_ref_to_ref_with_unsize`: `expect: "true"` on both; HEAD's extra `oracle: true` dropped (the field
  is only read for UNPORTED cases; the oracle test already checks `true`).
- wfcheck_b.test.ts / wfcheck_b_test/run.ts, variance_outlives, check_region_intrinsic: comment-only conflicts, merged texts.
- Re-pins after the merge (4d7087dd), each now oracle/probe-equal:
  - collect_test generics.rs / misc.rs: the 4 `type_of STOP UNPORTED: Target::parse_data_layout` facts now compute values
    (`S<T/#0, 3_usize>` ...); expected reports regenerated and the probe check vouches for them (min matched 69->72, 39->40).
  - lower_ty.test.ts: P4/P7 removed from PENDING (now equal the tydump probe's `type_of`; the probe test expects P0..P7);
    the stubs test additionally asserts no alias outside PENDING stops.
  - entry.test.ts (was failing after the merge: pinned `Decodable for ty::ImplTraitHeader`, which merge-w18c generated):
    generic/where/plain_main.rs are NOW_EXACT (oracle stderr), args_main.rs stops at `InferCtxt::err_ctxt` (E0580 report, wave 19).

## Verification
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check`: markers ok (16373; vendor 3888); TOTAL 15854/25518.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000` at the merge commit: 5276 pass / 1 fail (entry_test
  args_main, fixed in 4d7087dd; collect/lower_ty and entry tests re-run after the re-pins: all pass). The 3 failures integ
  had before the merge (collect generics/misc, lower_ty stubs) are fixed. **0 failing tests.**
- Samples (`RUST_TS_AGENT=merge-w18d`), MATCH / DIFF / UNPORTED, no CRASH/TIMEOUT, **no DIFF**:

| suite | result | integ before (typeck-gaps) | integ-old (merge-w18c) | run |
|---|---|---|---|---|
| tydump-minicore (46) | **21 / 0 / 25** | 15 / 0 / 31 | 14 / 0 / 32 | 20261015-111531-merge-w18d-vsog |
| thirdump-minicore (46) | **21 / 0 / 25** | 15 / 0 / 31 | 14 / 0 / 32 | 20261015-111536-merge-w18d-abi8 |
| tydump-nocore `--sample 300 --seed m17` | 287 / 0 / 13 | 287 / 0 / 13 | 276 / 0 / 24 | 20261015-111540-merge-w18d-4ufd |
| hir-tree-nocore `--sample 300 --seed m17` | 300 / 0 / 0 | | | 20261015-111607-merge-w18d-k0yi |
| expanded `--sample 200 --seed m18` | 199 / 0 / 1 | | | 20261015-111632-merge-w18d-66iz |
| unpretty-hir `--sample 200 --seed m18` | 199 / 0 / 1 | | | 20261015-111705-merge-w18d-sam9 |

## Top remaining stops (by case count)
tydump-minicore = thirdump-minicore (25):
1. 13x `rustc_trait_selection::error_reporting::InferCtxt::err_ctxt` (wave 19) (+1x `TypeErrCtxt (FnCtxt::err_ctxt)`)
2. 3x `FnCtxt::adjust_fulfillment_error_for_expr_obligation` (hir_typeck fn_ctxt/adjust_fulfillment_errors.rs)
3. 2x `method::suggest::FnCtxt::suggest_assoc_method_call`
4. 1x each: `TyCtxt::mk_pat`, `const_eval_poly` (M4), `QueryKey for PseudoCanonicalInput<Ty>`, `LayoutOf::layout_of`
   (M4), `method::suggest::all_traits`, `Relate for &List<PolyExistentialPredicate>`
tydump-nocore sample (13): 7x `const_eval_resolve_for_typeck` (M4), 4x `CrateMetadata::get_adt_def` (ReprOptions
decode), 1x `thir_abstract_const`, 1x `const_eval_poly`.
expanded / unpretty-hir: 1x `Decodable for rmeta::VariantData (ty::VariantDiscr)` each.

## unported(...) left / added
None added; none removed beyond the stale test pins. Noted, not touched (pre-existing on integ): rustc_lint context.ts:693
`LateContext::data_layout` still `unported("rustc_middle::ty::TyCtxt::data_layout ...")` though `GlobalCtxt::data_layout`
is now ported (rustc_lint lane).

## PORT decisions to record
1. `rustc_middle_mir_query` is a single codegen set (typeck-gaps' definition; `CoroutineSavedLocal` stays skipped until
   M4); merge-w18c's duplicate removed.
2. A test case that can never match the oracle in its harness mode is removed in favour of the full-mode case, not kept
   against a hand-edited oracle output (wfcheck_a lint gat.rs).

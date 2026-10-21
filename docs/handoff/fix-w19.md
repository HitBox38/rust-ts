# Handoff: fix-w19 (fixer on integ-w19, review-w19 findings)

Branch `integ-w19`, commits `f7776c77`..(this handoff), base `53f85d46`. `bunx tsc --noEmit -p .` clean,
`coverage.ts --check` ok (markers 16977; vendor 3888). Every touched upstream file stays complete (`--missing`):
need_type_info 39/39, infer/mod 53/53, traits/mod 15/15, fulfillment_errors 54/54, ambiguity 6/6, region 19/19,
traits/suggestions 80/80, demand 25/25, fn_ctxt/suggestions 51/51, fn_ctxt/checks 73/73, method/suggest 60/60.

## 1. Findings: fix + test

| finding | fix | test |
|---|---|---|
| **H1** need_type_info.ts `(ty::Adt(def, args), Path)` arm | binds `args_ = pk._1` (the ADT's args, need_type_info.rs:1284) and passes it to `resolved_path_inferred_arg_iter` (:1307) | `need_type_info_test/adt_default_param.rs` (review repro, E0282, full stderr = oracle). `let_binding.rs` (`let x = Vec::new()`) also ICEd before the fix |
| infer-a med 1: `filename_for_diagnostics(..).toString()` (infer/mod.ts, 2 sites) | `.to_string()` | not reachable from the tydump stop: an RPITIT vs. RPIT mismatch stops at `mir_borrowck provider` first (tried, `tmp/fix-w19/infa`) |
| infer-a med 2: `simplify_pin_macro_arg_ty_mismatch` writes the caller's `TypeTrace` | `report_and_explain_type_error` copies it (`clone_TypeTrace`), as upstream takes `mut trace` by value; the two `expect` panic texts now carry `: TryFromSliceError(())` | only `&mut PinMacroHelper` pairs reach it (no case) |
| traits-a med 1 / traits-b med 1: tie order of `into_sorted_stable_ord_by_key` | ported exactly, see §2 | `slice_sort.test.ts` new case: `slice_sort_unstable_by` = pinned std `sort_unstable_by` (n ≤ 20, total and non-transitive comparators) |
| infer-b med 1: generated `Binder<FnSig>` Display / IntoDiagArg stand-ins | `tools/codegen/diag_args.json` entry (`arg0: FnSig<'a>`) -> new `display_PolyFnSig` (pretty.ts: `IrPrint<Binder<FnSig>>`, ty/print/mod.rs:423) and `PolyFnSig_into_diag_arg` (ir_print.ts: :140 with T = FnSig); `diagnostics.gen.ts` regenerated (no `unported_display` / `unported_into_diag_arg` left; the regen of the set is otherwise byte-identical) | `infer_b_test/fn_ptr_cast.rs` and `suggest.rs` ("consider casting both fn items to fn pointers using `as fn(u32)`", "consider casting to a fn pointer") |
| merge-w19 med 1: duplicate `str_to_uppercase` (ec00a1a2) | `src/std/str.ts` restored to its pre-ec00a1a2 content; fn_ctxt/suggestions.ts imports `str_to_uppercase` from `src/std/unicode/str_case.ts` | unicode/oracle.test.ts (existing) |
| X1: seven lanes without oracle tests | new shared runner `src/rust_ts/typeck_oracle_fixtures.ts` (fixtures = tydump probe stderr + exit, `REGEN=1`; a test asserts fixtures = live probe; the port runs `src/rust_ts/tydump.ts`) and 9 fixture suites, see §3 | 43 cases, all MATCH |

### Port bugs found by the new tests (fixed)
1. **fulfillment_errors.ts `error_implies` / `trait_error_implies_projection_error`** compared `ParamEnv`s with `===`. `ParamEnv` is not
   unique per value in the port (`ParamEnv_eq` compares `caller_bounds`), so `error_implies` returned false for every pair whose goals came
   from different `ParamEnv` objects. Visible: E0283 printed an extra `= note: cannot satisfy `<_ as Assoc>::Out == _`` that rustc suppresses
   (rustc's `info!("skipping ...")` log confirmed the suppression). Now `goal_eq` / `ParamEnv_eq`. Test: `need_type_info_test/projection.rs`.
2. **ambiguity.ts `fold_TraitClausePrintModifiersAndPath_`** stopped at `unported` for every E0283 "the type must also implement" note. It is
   the newtype `#[derive(TypeFoldable, TypeVisitable)]` (pretty.rs:3056); written out as infer/mod.ts's `fold_TraitRefPrintSugared` (same
   precedent): forwards to `TraitClause`. Tests: `need_type_info_test/{multi_impl,fully_qualified,projection}.rs`.

### LOW findings
Fixed: infer-a 5 (`args[param.index]` panic), infer-b 3 (`trimStart` -> `White_Space` trim), traits-a 2 (unused `unported_methods`, stub
headers of mod.ts / fulfillment_errors.ts), traits-a 3 (contract.test.ts comment -> traits-b), region 1 (`Highlighted_to_string(hidden_ty,
print_Ty)`), region 2 (E0803 cases: `region_e0803_test`), sugg-c 1 (`associated_item_def_ids(..)[0]` panic), demand-adjust 1
(`unwrap(.., "an expression must have a non-block ancestor")` = `Option::expect`) and 2 (header), suggest-b 2 (`str::trim` / `trim_end` over
`White_Space`), fnsugg-a 1 (HIR tuple index panic) and 2 (header, import), fnsugg-b 1 (same header/import), checks-b 1 (range-start panic),
merge-w19 2/3/4 (slice_sort.test.ts: the always-true check now asserts that the arity comparator reorders differently from a JS stable sort;
pin check; `// std:` markers on `slice_sort_by` / `slice_sort_by_key`), merge-w19 6 (expr.ts comment).

Not a finding: infer-a 4. `PrintError` is `pub type PrintError = std::fmt::Error` (ty/print/mod.rs:16), whose Debug is `Error`, so
`unwrap_print`'s text is right; `display_Binder_with`'s print-error text is `ToString`'s, and `lift` cannot fail in the port.

Left (listed for root): infer-a 3 / traits-b 3 / need-type-info 3 / sugg-b 1 / X2 (marker placement of hoisted fn-local items: needs a
PORTING §8 rule), infer-b 4 (`DefIdSet` name for an `FxIndexSet`), infer-b 5 / suggest-a 3 / sugg-c 2 (duplicate helpers), traits-b 4
(`try_to_target_usize` as `number`), sugg-a 2 (documented `FxHashSet` order), sugg-a 3 (triple `Symbol` import), need-type-info 4
(`str_cmp` import; `intern_key` equality of `ObligationCauseCode`, decision text below), nice-region 1 (codegen `$print`), nice-region 2
(stale wording), checks-b 2-4, suggest-a 1 (recorded), suggest-a 2 (`SortedMap::get_mut_or_insert_default` belongs in
rustc_data_structures), merge-w19 4 (`ilog2` for len ≥ 2^31), merge-w19 5 / fnsugg-a 3 (decision texts below).

## 2. Tie order (`into_sorted_stable_ord_by_key` over `UnordSet`, D6)

Upstream (unord.rs:207 `collect_stable_ord_by_key`): `String: StableCompare` has `CAN_USE_UNSTABLE_SORT = true`, so the items (an
`UnordSet` = `FxHashSet`, iterated in hashbrown order) are sorted with `sort_unstable_by`. core's unstable `sort` (slice/sort/unstable/mod.rs:22)
is insertion sort for `len <= 20` (stable) and ipnsort above. So for every realistic input the result is: stable sort by path over
**hashbrown iteration order**. The tie (same path, different `DefId`) is observable: it needs three versions of one crate name, and the
order of the "this is the found trait" / "item with same name found" labels and helps follows it (labels in different files print in
first-seen file order).

Port: traits/mod.ts `check_same_definition_different_crate` and fulfillment_errors.ts `note_adt_version_mismatch` collect into
`rust_ts/hash_map.ts` `FxHashSet` with the tuple's derived `Hash` (`write_str` + `DefId`'s `u64` hash, def_id.rs:268, field order as
written) and element layout (32, 8), then sort with the new `std/slice_sort.ts` `slice_sort_unstable_by` (insertion path ported and
oracle-tested; `len > 20` stops at `unported("core::slice::sort::unstable::ipnsort ...")`). Residual: the insertion order into the set comes
from `found_dids` / the port's `visible_parent_map` iteration, which only changes hashbrown positions on probe collisions.

## 3. Oracle fixture suites (all MATCH, `RUST_TS_REQUIRE_PROBES=1`)

| lane | test file | cases |
|---|---|---|
| errrep-need-type-info | error_reporting/infer/need_type_info.oracle.test.ts | adt_default_param (H1), let_binding, closure_arg, method_turbofish, fully_qualified (E0790, E0283), multi_impl (E0283, E0284), projection |
| errrep-infer-a | error_reporting/infer/infer_a.oracle.test.ts | cmp_types, error_origin, fn_sigs (E0053) |
| errrep-infer-b | error_reporting/infer/infer_b.oracle.test.ts | note_and_explain, suggest, misc (review scratch nae/sug2/misc), fn_ptr_cast |
| errrep-traits-b | error_reporting/traits/fulfillment_errors_b.oracle.test.ts | similar_impls, closure_args (E0593) |
| errrep-sugg-a | error_reporting/traits/suggestions_a.oracle.test.ts | 11 review scratch crates (c2_self, a superseded draft, dropped) |
| typeck-suggest-b | rustc_hir_typeck/method/suggest_b.oracle.test.ts | review s2, s3, s5, s6 (s1/s4 stop at `SelectionContext::select`) |
| typeck-fnsugg-a | rustc_hir_typeck/fn_ctxt/suggestions_a.oracle.test.ts | return_and_call, prelude_collisions (edition 2018) |
| errrep-region | error_reporting/infer/region_e0803.oracle.test.ts | the two tests/ui E0803 files (one with `String` -> `u32`, see §5) |

Cases that stop at another area's `unported` were dropped from the fixtures (not DIFFs): arrays in E0308 / `sum()` / `From::from`
(`ty::Value` valtree, `layout_of`), `Box<dyn Fn>` mismatch (`supertrait_def_ids`), E0525 closure kind (`TypeVisitable for CapturedPlace`;
the oracle reports nothing at the tydump stop), opaque types (`mir_borrowck`).

## 4. Checks

- Full `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000` at `28d458a5`: **5400 pass, 0 fail** (5401 tests, 366 files).
- Samples (`RUST_TS_AGENT=fix-w19`), M / D / U, compared with merge-w19's handoff:

| suite | run | fix-w19 | merge-w19 |
|---|---|---|---|
| tydump-minicore (46) | 20261021-125611-fix-w19-dbbk | 41 / 0 / 5 | 41 / 0 / 5 |
| thirdump-minicore (46) | 20261021-125625-fix-w19-r37z | 41 / 0 / 5 | 41 / 0 / 5 |
| tydump-nocore `--sample 300 --seed m17` | 20261021-125650-fix-w19-xibs | 290 / 0 / 10 | 290 / 0 / 10 |
| tydump-ui `--sample 400` | 20261021-125814-fix-w19-axpw | 212 / 2 / 186 | (not run) |
| hir-tree `--sample 300` | 20261021-130103-fix-w19-thnr | 299 / 0 / 1 | 300 / 0 / 0 (other seed) |
| expanded `--sample 300` | 20261021-130331-fix-w19-s0ha | 299 / 0 / 1 | 300 / 0 / 0 (other seed) |

No CRASH / TIMEOUT. The 2 tydump-ui DIFFs are harness-w20's known items 6 and 10 (`success-results-in-unconstrained-infer.rs#old`:
the oracle ICEs at outlives_bounds.rs:49; `use-impl-to-normalize-own-self-ty-ice.rs#old`: both ICE, ICE report format). The hir-tree /
expanded UNPORTED is `format-captured-non-values.rs` (`TyCtxt::get_diagnostic_name` of extern crates), not in either baseline.

## 5. For root

Decision texts (not recorded by me):
1. (fix-w19) `into_sorted_stable_ord_by_key` over an `UnordSet` whose key has `CAN_USE_UNSTABLE_SORT` (`String`) is `sort_unstable_by`
   over hashbrown order: build an `FxHashSet` (rust_ts/hash_map.ts, the element's derived `Hash` and layout) and sort with std
   `slice_sort_unstable_by` (core's insertion-sort path, ipnsort above 20 elements stops at `unported`). Applied at traits/mod.ts:504 and
   fulfillment_errors.ts:2852.
2. (fix-w19) `ParamEnv` is not unique per value: compare with `ParamEnv_eq` (or `goal_eq`), never `===` (error_implies had it wrong).
3. (fix-w19) Newtype `#[derive(TypeFoldable, TypeVisitable)]` wrappers of pretty.rs (`TraitClausePrintModifiersAndPath`) may be written
   out as forwarding descriptors until codegen covers them (precedent: infer/mod.ts `fold_TraitRefPrintSugared`).
4. (fix-w19) Oracle fixture tests through typeck use `src/rust_ts/typeck_oracle_fixtures.ts` (tydump probe fixtures, `REGEN=1`).
5. (fix-w19) Supersedes typeck-fnsugg-a's "`str::to_uppercase` is `toUpperCase`" (merge-w19.md:158): std `unicode/str_case.ts`.
6. (fix-w19) merge-w19 §5's "`Highlighted` formatting now uses its `Display`" is now true for region.ts too.
7. (fix-w19) ambiguity.ts compares `ObligationCauseCode`s by `intern_key` (the derived `PartialEq` as the derived `Hash+Eq` key).

Other:
- Codegen: `tools/codegen/diag_args.json` gained one entry (§1); worth a look in the next reviewed tools batch.
- `src/rust_ts/typeck_oracle_fixtures.ts` and `src/std/slice_sort.ts` (`slice_sort_unstable_by`) are shared code added by this lane.
- Port stop seen (not fixed, not mine): a std crate with a `String` struct field stops at `rustc_metadata::rmeta::decoder::cstore_impl:
  Decodable for DenseBitSet<u32>` (param-without-lifetime-constraint.rs).
- No `unported(...)` added except the ipnsort one in `src/std/slice_sort.ts`. Removed: `fold_TraitClausePrintModifiersAndPath_` (3) and the
  generated `unported_display` / `unported_into_diag_arg` of diagnostics.gen.ts.

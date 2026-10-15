# Handoff: check-region-intrinsic (M3, wave 17): rustc_hir_analysis check/region.rs, check/intrinsic.rs, check/always_applicable.rs

Branch `lane/check-region-intrinsic` (from main `3e4773f`, no merges).

## Result
- **check/region.rs → `src/rustc_hir_analysis/check/region.ts`, 24/24.** It has `region_scope_tree`,
  `ScopeResolutionVisitor` and the temporary-scope rules. The provider is registered, so `tcx.region_scope_tree` now
  runs (see "Provider wiring"). Its output is byte-identical to the pinned rustc's `{:#?}` of the `ScopeTree`:
  - on 3 fixture crates (every scope kind, both hash maps; see "Tests");
  - on an ad-hoc probe sweep: 298/300 random tydump-nocore cases and 44/46 tydump-minicore cases match. The 4 others
    stop in other code before any tree is printed: `StableHash without a TS impl` (2, attribute hashing),
    `codegen_fn_attrs provider` (1, delegation), and a proc-macro `quote!` (1).
- **check/intrinsic.rs → `check/intrinsic.ts`, 3/3.** It has `check_intrinsic_type`, the full signature table (every
  arm in upstream order), `intrinsic_operation_unsafety` (the safe list) and `equate_intrinsic_type`.
- **check/always_applicable.rs → `check/always_applicable.ts`, 6/6.** It has `check_drop_impl` and
  `check_negative_auto_trait_impl` (both exported), E0366, E0367, `[const] Destruct`, and drop/pin_drop.
- `bun scripts/coverage.ts --missing` gives 0 for all three files. `--check` gives `markers ok (14398; vendor 3888)`.

## Files
- New:
  - `src/rustc_hir_analysis/check/{region,intrinsic,always_applicable}.ts`
  - `src/rustc_hir_analysis/check/check_region_intrinsic.test.ts` (11 tests)
  - fixtures and helpers in `check/region_test/`, `check/intrinsic_test/` and `check/drop_test/` (each has a `run.ts`)
  - `check/region_test/scopedump/{main.rs,Cargo.toml.in}`: the rustc-dev probe source (see "For root" 2)
- Edited: `src/rustc_hir_analysis/lib.ts`. It now imports `./check/region.ts` and sets
  `providers.region_scope_tree` in `provide`. Both lines are marked `PORT`.
- Edited (call-site re-pin): `src/rustc_hir_analysis/contract.test.ts`. "provide installs the collect providers"
  counted 45 providers; with `region_scope_tree` it is 46, and the test now also asserts that the provider is set.
  When `check::provide` merges, that test's count changes again.
- No `check/mod.ts`. Lane check-check owns it, and it is not in this lane's base.

## Provider wiring and merge with check-check (for root)
Upstream registers `region_scope_tree` in check/mod.rs:112 `check::provide`. That file is lane check-check's, so this
lane sets it in lib.ts `provide`, next to the commented `// check::provide(providers);`. When both lanes merge:
1. **check/mod.ts:**
   - add `import * as region from "./region.ts"`, plus the same for intrinsic and always_applicable;
   - uncomment `providers.region_scope_tree = region.region_scope_tree;` in `check::provide`;
   - delete check-check's stand-ins `always_applicable_check_drop_impl` (mod.ts) and `intrinsic_check_intrinsic_type`
     (check.ts), and call `always_applicable.check_drop_impl` / `intrinsic.check_intrinsic_type` instead. The
     signatures are the same; `check_intrinsic_type` takes the `Symbol` `i.name`.
2. **lib.ts:** delete the `check_region` import and the `providers.region_scope_tree` line.
3. **This lane's `pending` stand-ins:** repoint each to the real function and delete it.
   - `intrinsic.ts` `pending.check_function_signature` → check-check's `check_function_signature` (mod.rs:641 in that
     lane; the signatures are the same).
   - `always_applicable.ts` `pending.missing_items_must_implement_one_of_err` → check-check's function of that name.
     The 3rd argument is an `Iterable<Symbol>` there and `[..].values()` here, which is compatible.
   - `always_applicable.ts` `pending.ObligationCtxt_new_with_diagnostics` → trait-sel's
     `ObligationCtxt.new_with_diagnostics`. The local `ObligationCtxtView` / `FulfillmentErrorView` interfaces list
     what this file uses: `register_obligation`, `eq`, `normalize`, `evaluate_obligations_error_on_ambiguity`, `infcx`,
     and `root_obligation`.
4. **Lane coherence:** coherence/mod.rs:46 calls `always_applicable::check_negative_auto_trait_impl`. It is exported,
   with `polarity: ImplPolarity`.
5. **Tests after the merge:**
   - `drop_test/implied.rs` should turn from PENDING into an exact oracle match (E0367). Then empty `PENDING` in the test.
   - `intrinsic_test/run.ts` replaces `intrinsic.pending` to record signatures. Once `check_function_signature` is real,
     consider adding a test that compares `mismatch.rs` stderr with the oracle's E0308s directly.

## Tests
`check_region_intrinsic.test.ts` (11 tests, all green with `RUST_TS_REQUIRE_PROBES=1`):
1. **Region scope trees.** `region_test/{scopes.rs (2021), scopes_2024.rs (2024), tail_lint.rs (2021, with
   tail_expr_drop_order)}`:
   - The port's `{:#?}` of `tcx.region_scope_tree(did)` for every `hir_body_owners()` must equal
     `<crate>.expected.txt`, the scopedump probe's output for the same arguments.
   - The fixtures cover every `ScopeData` kind, let-else, `if let` guards, `&&`/`||` chains, compound assignment
     (right-hand side first), closures, inline consts, const/static initializers (the `None` extended scope), `E&` /
     `P&` / `ET` extension, `super let` (extended and not), and `backwards_incompatible_scope`.
   - A 4th test checks that coverage.
   - Negative control: swapping the `AssignOp` visit order fails the scopes.rs test.
2. **Intrinsics.** `intrinsic_test/`:
   - `errors.rs` (3×E0094, 2×E0093, 2 safety mismatches): stderr is byte-identical to the oracle's.
   - `ok.rs` (36 intrinsics) and `ok_lang.rs` (8, using lang items `TypeId`, `Ordering`, `Location`, `Option` and
     `DiscriminantKind`): the oracle accepts both crates. Every region-free computed signature equals the declared one
     (same interned inputs/output, safety, ABI, C-variadic). 2 have bound regions and are not compared.
   - `mismatch.rs`: the oracle reports 7×E0308, and all 7 computed signatures differ.
3. **Drop impls.** `drop_test/`:
   - `specialized.rs` (5×E0366: not-param type, lifetime, `&'a u8`, tuple, duplicate param) and `negative.rs`
     (negative Drop impl): stderr is byte-identical to the oracle's.
   - `implied.rs` (2×E0367): oracle-equal or PENDING. Today it stops at
     `rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics`.
   - `drop_test/run.ts` overrides `orphan_check_impl` and `coherent_trait` with `Ok(())` (test-only stand-ins; lane
     coherence). The header explains why that is the real value for these fixtures.
   - E0367 needs trait-sel.

Not tested: E0308 text (it needs check-check's `check_function_signature` and trait-sel). Also not tested: const-param
Drop specialization (`impl Drop for E<3>`). Lowering `3` stops at
`QueryKey for LitToConstInput (cache)` (rustc_middle, pre-existing) when `calculate_dtor` reads every Drop impl's
`type_of`.

Other checks:
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see the last section.
- `RUST_TS_AGENT=check-region-intrinsic bun scripts/difftest.ts --suite tydump-nocore --sample 150`: 18 MATCH / 0 DIFF /
  132 UNPORTED / 0 CRASH (run `20261014-234252-check-region-intrinsic-hu7y`). Of the UNPORTED, 129 stop at
  `check_type_wf provider` and 3 elsewhere. None is in this lane's files: `check_crate` (check-check) does not call
  them yet.
- `--suite hir-tree-nocore --sample 100`: 99 MATCH / 0 DIFF / 1 UNPORTED (run
  `20261014-234532-check-region-intrinsic-6o4x`). The UNPORTED case is a delegation case at `codegen_fn_attrs provider`,
  which was already UNPORTED before this lane.

## `unported(...)` left
- `rustc_hir_analysis::check::check_function_signature (lane check-check)` (intrinsic.ts `pending`).
- `rustc_hir_analysis::check::missing_items_must_implement_one_of_err (lane check-check)` (always_applicable.ts
  `pending`). It is reached only with `pin_ergonomics` and an impl that has neither `drop` nor `pin_drop`.
- `rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics` (always_applicable.ts `pending`). Every valid
  Drop impl reaches it: `ensure_impl_predicates_are_implied_by_item_defn`, and `ensure_all_fields_are_const_destruct`
  for const impls.
- Indirect: `InferCtxt::resolve_regions` is still trait-sel's contract placeholder (rustc_trait_selection regions.ts).
  It is called after the ObligationCtxt stop.

## PORT decisions (please record)
1. **`Context`** (`#[derive(Copy)]`, assigned field by field) is copied with `copy_Context` at every Rust copy
   (`let prev_cx = visitor.cx`, `visitor.cx = expr_cx`, `mem::swap`). `Scope`s are never mutated, so they are shared.
2. **`LetKind`** is a string union. `extended_super_lets` (`FxHashMap`, insert/remove only, never iterated) is a plain
   `Map`, and `has` tells `Some(None)` from absent. The `if let Some(scope) = ..remove(..)` guard removes even when it
   does not match, as upstream does.
3. **Nested fns** `is_binding_pat` and `record_rvalue_scope_if_borrow_expr` stay nested in `resolve_local`, each with
   its own marker. `PatKind::Slice`'s middle `Option<&Pat>` is iterated as an option.
4. **Intrinsic table.** The `match intrinsic_name` is a `switch` on `sym.*` with `case` labels in upstream arm order.
   Each arm assigns `r = [n_tps, n_cts, inputs, output]`; elements are evaluated left to right, as in Rust.
   `vec![e; n]` evaluates `e` once and repeats it (`type_id_ty()`, `param(0)`, `Ty::new_mut_ptr(..)`). The
   `intrinsic_operation_unsafety` list is a fall-through `switch`.
5. **Stand-ins through a `pending` object** in intrinsic.ts and always_applicable.ts. Root can repoint each in one
   place, and the intrinsic test can observe the computed signature.
6. **`ensure_all_fields_are_const_destruct`'s `.map(..).collect::<Result<(), _>>()`** is a loop that returns at the first
   error, because the collect short-circuits. So it reports at most one E0367 per impl, as upstream does.
7. **The `FxHashSet<Predicate>` `root_predicates`** is a `Set` of the hash-consed predicates. It is insert-only.
8. **`provide` wiring** is in lib.ts until check-check's `check::provide` merges (see above).

## For root
1. **`ScopeTree`'s hash maps (lane middle-traits-thir's file; not edited).** In rustc_middle's region.gen.ts,
   `extended_temp_scopes` (`ItemLocalMap`) and `backwards_incompatible_scope` (`UnordMap`) are plain `Map`s, and
   `debug_ScopeTree` prints them with `unported_debug`.
   - Upstream prints both as `UnordMap { inner: {..} }` in hashbrown order.
   - The test helper (`region_test/run.ts`) gets that order by replaying their insertion order into
     `rust_ts/hash_map.ts` `FxHashMap(u32_key, {size 8, align 4})`. This is exact because neither map is ever removed
     from.
   - Suggested repoint: make both `FxHashMap`s in `ScopeTree.default_()` and teach the typemap to print `UnordMap`'s
     wrapper. `debug_ScopeTree` then matches upstream with no helper. Today nothing prints a `ScopeTree` except this
     test.
2. **scopedump probe.** The source is at `src/rustc_hir_analysis/check/region_test/scopedump/` in the
   `tools/probes/<name>/` layout, because porting lanes do not edit tools/.
   - I built it by hand in `$RUST_TS_DATA/scratch/check-region-intrinsic/` with probes.ts's rustc-dev env.
   - The committed `*.expected.txt` files are its output.
   - Suggested: move it to `tools/probes/scopedump`, so the test can run the probe directly, as the tydump tests do,
     instead of reading the committed expected files.
3. **thirdump** output includes `temp_lifetime` / `region_scope` per expression. When THIR lands (wave 18), the
   thirdump suites exercise `region_scope_tree` end to end.

## Test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools` at 4448b56: 4970 pass, 1 skip (the pre-existing linux-only
test), 1 fail (4972 tests, 310 files, 1206 s).
- The failure was contract.test.ts's provider count (45 → 46), which this lane's provider changes.
- It is re-pinned in the final commit, and contract.test.ts passes 10/10 after the re-pin.
- The full suite was not rerun after the re-pin.

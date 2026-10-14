# Handoff: lower-lib-a (wave 14, M3a): rustc_ast_lowering lib.rs lines 1..1756

Branch `lane/lower-lib-a`, from main `935a15a`, no merges.

## Files touched
- `src/rustc_ast_lowering/lib.ts`: only the `lane lower-lib-a` import block and the `lib.rs:1..1756` region.
  Lane lower-lib-b's import block, region and `unported_methods` list are untouched.
- New test files, all lane-owned:
  - `src/rustc_ast_lowering/lib.test.ts`: 8 unit tests.
  - `src/rustc_ast_lowering/lib.oracle.test.ts`: 2 oracle tests.
  - `src/rustc_ast_lowering/lib_oracle/{run.ts, items.rs, items.hir-tree.stdout}`: the oracle test's driver, its
    case and its fixture.

## What is ported (upstream order, one marker per fn)
- **Free fns:** `provide`; `ResolverAstLoweringExt::legacy_const_generic_args` (as
  `ResolverAstLowering_legacy_const_generic_args`); `index_ast` with `Indexer`; `lower_to_hir` with its nested
  `with_lctx`.
- **`Indexer`:** `insert`, `make_dummy`, `replace_with_dummy`, and its `MutVisitor` overrides `visit_attribute`,
  `flat_map_item`, `visit_assoc_item` and `visit_foreign_item`.
- **`PerOwnerLoweringState`:** `new`, `owner_id`, `into_owner_info`.
- **`LoweringContext`:**
  - `new`, `dcx`, `allow_gen_future`;
  - all 35 methods from `create_def` (lib.rs:820) to `lower_ty` (lib.rs:1534). The `unported_methods` list of
    region a is gone.
- **Other types:**
  - `SpanLowerer` + `lower`;
  - `RelaxedBoundPolicy` + `reborrow` (on the companion);
  - `display_ImplTraitPosition` (`impl Display`, marker `fmt` lib.rs:535).
- **Data types, written in the shape the generator gives them:** `PerOwnerLoweringState`, `SpanLowerer`,
  `RelaxedBoundPolicy`, `RelaxedBoundForbiddenReason`, `ImplTraitContext`, `ImplTraitPosition`, `FnDeclKind`,
  `TryBlockScope`, `ParamMode`, `AllowReturnTypeNotation`, `GenericArgsMode`, `DiscardParams`. Their companions are
  included (`ImplTraitContext.Universal`, `TryBlockScope.Function`, ...). See PORT 1.
- **Unchanged from the contract:** `HirArena` / `HIR_ARENA`, the `ALLOW_*` statics, and the two `rustc-skip`s
  (lib.rs:124, :135).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_ast_lowering/src/lib.rs`: 56/118. Everything it lists is at
  line 1757 or later (lane lower-lib-b). Nothing in 1..1756 is missing.
- `bun scripts/coverage.ts --check`: `markers ok (8697; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean. With `--noUnusedLocals`, lib.ts reports only `_def_id` (lib.rs:1053 binds it for
  a `debug!`).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3995 pass, 1 skip (the pre-existing linux-only
  test), 0 fail.
- `RUST_TS_AGENT=lower-lib-a`, sample difftests:
  - `--suite parse --sample 100`: 100/100 MATCH (run `20261014-025414-lower-lib-a-7r8k`).
  - `--suite expanded --sample 100`: 100/100 MATCH (run `20261014-025423-lower-lib-a-xg9c`).
- **`--suite hir-tree-nocore --sample 100`**: 5 MATCH, 0 DIFF, 95 UNPORTED (run `20261014-025527-lower-lib-a-n2e1`).
  - I ran it on a throwaway branch with `lane/harness-w13` merged, then deleted the branch.
  - Stop histogram: all 95 UNPORTED are `rustc_driver_impl::pretty::print (HirTree: needs a TyCtxt)`. The driver stops
    before lowering is reached.
  - **Merge conflict for root:** `lane/harness-w13` conflicts with main in `harness/suites.ts`. Main's tydump/thirdump
    suites and harness-w13's hir-tree suites are both added at the same place.
- **lib.test.ts** (no `TyCtxt` needed) covers:
  - `Display for ImplTraitPosition`, all 21 strings;
  - `reborrow` and `SpanLowerer::lower`;
  - `next_node_id`, including the `from_u32` limit;
  - `lower_node_id` / `next_id`: id sequence, non-owner `children`, `trait_map` copy, and the exact `assert_ne!`
    panic texts;
  - `opt_local_def_id` overlay order, `local_def_id` / `owner_id` panics;
  - `get_partial_res` overrides, `expect_full_res`, `lower_res` (`Local` mapped, foreign local → `Err`);
  - `with_dyn_type_scope` / `with_new_scopes` state restore.
- **lib.oracle.test.ts**, against the pinned rustc's `-Zunpretty=hir-tree` (fixture with `REGEN=1`, re-checked when
  the toolchain is present):
  1. The ported `index_ast` runs on the real pipeline (driver → resolution) and indexes exactly the oracle's **27 HIR
     owners**, with matching node kinds. The case is a `#![no_core]` lib with:
     - modules, a tuple struct, an enum, a trait and an impl with assoc type/const/fn;
     - an `extern` block with fn and static;
     - `use`, `macro_rules!`;
     - items nested in a fn body, a nested impl, and an item inside a closure.
  2. `LoweringContext::new` plus `lower_ty` on `m::f`'s `()`, `!`, `((), ())` and on `ext`'s `*const ()`. The output
     prints `{:#?}`-identical to the oracle's `Ty` nodes: ids, spans and inner-before-outer numbering.
  - The ItemLocalId counter is started at the oracle's first id.
  - Negative control: starting `f` at 13 fails the test.
  - **Test scaffolding:** `run.ts` overrides `get_lang_items` and `debugger_visualizers` through
    `config.override_queries`. `index_ast` only `ensure_done`s them, and their rustc_passes providers are not ported.

## `unported(...)` left (all in lib.ts region a)
| what | where | who unblocks |
|---|---|---|
| `rustc_middle::hir::TyCtxt::hash_owner_nodes (hir/mod.rs:175)` | `into_owner_info` (every owner) | middle-hir |
| `rustc_middle::ty::TyCtxt::needs_owner_info_hash (context.rs:1175)` | `into_owner_info` | ty-ctxt / middle-hir (with `needs_hir_hash`, :1142) |
| `rustc_data_structures::unord::UnordMap: StableHash (OwnerInfo::opt_hash)` | `into_owner_info`, only when `needs_owner_info_hash` (incremental or `-Zmetadata-crate-hash=no`) | rustc_data_structures unord |
| `rustc_middle::middle::lang_items::TyCtxt::require_lang_item (lang_items.rs:20)` | `make_lang_item_path` | lang items lane |
| `rustc_middle::hir::map::TyCtxt::hir_def_key` | `create_def`'s assertion message (failure path only) | middle-hir |
| `rustc_ast_lowering::diagnostics::<X> (diagnostics.gen.ts, lane lower-index-diag)` via `diagnostic_pending`, for `BadReturnTypeNotation`, `MisplacedAssocTyBinding`, `AssocTyParentheses`, `NoPreciseCapturesOnApit`, `MisplacedImplTrait` | error paths of `lower_assoc_item_constraint`, `emit_bad_parenthesized_trait_in_assoc_ty`, `lower_ty` | lower-index-diag |
| `GenericArgsCtor` (:3296), `GenericArgsCtor::into_generic_args` (:3310), `UnrepresentableConstArgError::emit` (:3384) ("merge pending") | `lower_assoc_item_constraint` (constraints with generic args / RTN), `lower_generic_arg` (`gca` error path) | lower-lib-b + root at merge |

## `// PORT:` decisions (root: please record)
1. **Data types of lib.rs are hand-written in lib.ts**, in exactly the shape `tools/codegen/types.ts` produces.
   - I checked this against a scratch run of a `rustc_ast_lowering` set over lib.rs. The output went to
     `$RUST_TS_DATA/scratch`; `types.sets.json` was restored and is unchanged.
   - Codegen set `rustc_ast_lowering` is not in `types.sets.json` yet, and the other lowering lanes need real
     `ImplTraitContext` / `ParamMode` / ... values.
   - When root adds the set, move the declarations to `lib.gen.ts` and keep the methods and companions here.
   - **Deviation from the generator:** `RelaxedBoundPolicy::Allowed(&mut FxIndexMap<DefId, Span>)` is `DefIdMap<Span>`,
     which is insertion-ordered and keyed on `DefId` values. The generator says `Map<DefId, Span>`, which would key
     `DefId` objects by identity. The set's typemap needs this.
   - Derived `Debug` impls are left to the generator. Nothing prints them, because `debug!`, `trace!` and
     `#[instrument]` are not ported.
2. **`Indexer`** (a nested item of `index_ast`) is a module-level class right after `index_ast`, because the class must
   exist before `index_ast` runs. `mem::replace(item, *dummy)` is a fresh `Item` holding the old fields, plus
   `replace_in_place(item, dummy)`. The slot keeps its identity, so the walker's returned item is the dummy.
   `IndexVec::insert` pads with `undefined`, so the array is never sparse.
3. **Arenas are erased:** `tcx.arena` / `tcx.hir_arena` are `HIR_ARENA`. `index_ast`'s `Arc<ResolverAstLowering>` is the
   one resolver object, shared by every entry.
4. **`IndexSlice::get` in `lower_to_hir`:** the result `Option<&Option<Steal>>` is `{ _0 } | undefined`.
5. **Small local helpers:** `map_index` (std `HashMap` `Index`: "no entry found for key") and `assert_ne` (core's
   `left != right` text).
6. **Deliberate no-ops:**
   - `increment_by(1)` is `ItemLocalId.new(index + 1)`;
   - `#[cfg(debug_assertions)]` code (`relowering_checker`, the empty-attrs check) stays as comments;
   - `tcx.sess.time("drop_ast", || mem::drop(node))` keeps the timer with an empty body.
7. **`DelayedLint`** (rustc_hir lints.rs, not ported, `unknown`): `lower_attrs_vec` pushes an object literal with
   upstream's four fields. The callback does the `downcast_ref::<Session>()` as `instanceof Session`.
8. **`extra_hir_attributes.iter().cloned()`** shares the HIR attributes. Nothing mutates HIR attributes after lowering.
9. **`LoweringContext::new`** passes the fields in declaration order, not the struct literal's order. Only
   `PerOwnerLoweringState::new` (steals the disambiguator) and `AttributeParser::new` (runs `registered_attr_tools`)
   have effects, and their relative order is the same in both.
10. **`find_attr!(tcx, def_id, ..)`** in `legacy_const_generic_args`: `def_id` is non-local there, so it reads
    `tcx.attrs_for_def(def_id)`, as rustc_resolve diagnostics/impls.ts does.
11. **`hir::GenericArg::Type(&Ty<()>)` for `Pin<&T>`** (`TyKind::PinnedRef`) is a cast to `Ty<AmbigArg>`, as hir-types
    decision 1.
12. **Casts from typing gaps elsewhere:**
    - query values typed `unknown` in `queries.gen.ts`: `index_ast`, `lower_to_hir`, `registered_attr_tools`;
    - rustc_middle `PerOwnerResolverData.trait_map` (`unknown[]`);
    - rustc_middle `PerOwnerResolverData.extra_lifetime_params` (`MissingLifetimeKind` as `unknown`).

## For root
1. **Merging with lower-lib-b.**
   - Replace `GenericArgsCtor_new(a, c, p, s)` with lower-lib-b's constructor (`new GenericArgsCtor(a, c, p, s)`).
   - Replace `GenericArgsCtor_into_generic_args(g, this)` with `g.into_generic_args(this)`.
   - Replace `UnrepresentableConstArgError_emit(e, this)` with `e.emit(this)`.
   - Then delete the three helpers. They are in region a, just above `create_def`.
2. **After lower-index-diag:** replace each `diagnostic_pending("X", fields)` with the generated diagnostic constructor
   (`diagnostics.X_diagnostic(fields)` in the rustc_ast_passes style). For `MisplacedImplTrait`, `position` is passed
   as `display_ImplTraitPosition(position)` (= `DiagArgFromDisplay(&position)`).
3. **After middle-hir and ty-ctxt:** in `into_owner_info`, replace the `hash_owner_nodes` / `needs_owner_info_hash`
   stand-ins with the `TyCtxt` calls. Replace `require_lang_item` in `make_lang_item_path` and `hir_def_key` in
   `create_def` the same way.
4. Still open from the contract: wiring `provide` into `default_query_providers`.
   - Since this lane, `index_ast` / `lower_to_hir` are real, but they still sit behind the driver's
     `pretty::print (HirTree)` stop.
   - `index_ast` also needs providers for `get_lang_items` and `debugger_visualizers` (rustc_passes), which it
     `ensure_done`s.

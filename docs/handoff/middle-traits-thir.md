# Handoff: middle-traits-thir (M3, wave 15): rustc_middle traits/*, thir.rs, thir/visit.rs, middle/region.rs

Branch `lane/middle-traits-thir` (from `ab2cdfc`, no merges).

## Files
- **Codegen (tools/codegen, data only; the generator is unchanged):**
  - `types.sets.json`: new set `rustc_middle_traits_thir` over middle/region.rs, traits/{mod,cache,select,query,
    specialization_graph,solve}.rs and thir.rs (`auto_class`, `derive_clone`, `derive_type_fold`). `hand`:
    `CanonicalInput`, `ExternalConstraints` (D2 hash-consed classes), `WithDepNodeCache` (keyed map). `skip`: the 10
    `pub type X<'tcx> = ir::solve::X<TyCtxt<'tcx>>` aliases of solve.rs (same TS types as the glob re-export;
    hand-aliased in solve.ts, see skip_notes).
  - New set-local type map `middle_traits_thir.typemap.json` (`typemap_extra`, after `tyir.typemap.json`): the external
    types the set reaches. Types of unported lanes are `unknown` (`PORT: pending`: AdtKind, NotConstEvaluatable,
    UserType / CanonicalUserType / CanonicalUserTypeAnnotation, QueryResponse, ParamEnvAnd, mir FakeReadCause /
    AssignOp / BorrowKind / Const / AllocId). `ExprId`/`ArmId`/... point at thir.ts (macro-generated ids).
  - `type_fold.json`: `trivial` gains the rustc_middle `TrivialTypeTraversalImpls!` entries the set reaches
    (IsConstable, OverflowError, AdtKind, AssocKind, AssocItem, NotConstEvaluatable, BuiltinImplSource, Variance,
    mir BorrowKind / FakeReadCause, MatchSource, RangeEnd, InlineAsmOptions, InlineAsmTemplatePiece, UnrollAttr,
    InlineAsmRegOrRegClass); 12 new entries (Region, Const, Binder, PolyTraitClause, HostEffectClause, TraitRef,
    TypeError, AliasBoundKind, Unnormalized, AliasTy, AliasConstKind under their rustc_middle paths).
  - Regenerating every set (except `/` keys and `rustc_lexer`): only the 8 new `.gen.ts` files; all others unchanged.
- **Generated:** `src/rustc_middle/{middle/region,thir,traits/{mod,cache,select,query,specialization_graph,solve}}.gen.ts`.
- **Hand (new):** `src/rustc_middle/traits/{mod,cache,select,query,specialization_graph,structural_impls}.ts`,
  `src/rustc_middle/thir.ts`, `src/rustc_middle/thir/visit.ts`, `src/rustc_middle/middle/region.ts`,
  tests `src/rustc_middle/traits/traits.test.ts` (18 tests).
- **Hand (rewritten):** `src/rustc_middle/traits/solve.ts` (was merge-w13's contract stub).
- **Regenerated:** `src/rustc_middle/queries.gen.ts` (see "For root").
- **Edited outside the listed files (stubs that named this lane):**
  - `ty/context.ts`: `GlobalCaches` types `selection_cache` / `evaluation_cache` as `SelectionCache<TypingEnv>` /
    `EvaluationCache<TypingEnv>` and builds them with `WithDepNodeCache.default_()`; the `direct_interners!`
    `mk_external_constraints` / `intern_canonical_input` are real (interner sets typed with the classes).
  - `ty/context/impl_interner.ts`: `mk_tracked` / `get_tracked` (were `unported`, "lane middle-traits-thir").
  - `ty/decls.ts`: the `Pending` aliases `CanonicalInput`, `ExternalConstraints`, `ObligationCause`, `Tracked` are now
    type re-exports of the real types (type-only, no init-order effect).
  - `rustc_middle/lib.ts`: `export * as region / thir / traits`.

## Coverage (`bun scripts/coverage.ts --missing`)
traits/mod.rs 26/26, solve.rs 5/5, cache.rs 6/6, select.rs 6/6, query.rs 3/3, specialization_graph.rs 12/12,
structural_impls.rs 2/2, thir.rs 16/16, thir/visit.rs 12/12, middle/region.rs 11/11. `--check`: markers ok (11151).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4310 pass, 1 skip (the pre-existing linux-only one), 0 fail.
- Fresh-process loads: every new hand module, `rustc_middle/lib.ts`, `ty/context.ts`, `ty/decls.ts`, `ty/mod.ts`,
  `rustc_type_ir/solve/mod.ts` and `interner.ts` load as entry points (the `.gen.ts` files, like every existing
  `.gen.ts`, are not entry points: they import their hand module).
- `RUST_TS_AGENT=middle-traits-thir difftest --suite hir-tree-nocore --sample 150`: 149 MATCH / 0 DIFF / 1 UNPORTED
  (run `20261014-071931-middle-traits-thir-8w90`); the stop is the known `TyCtxt::is_method`
  (`delegation/method-call-priority.rs`, listed by merge-w15a).

## The `GlobalCaches::default` stop
The traits caches no longer stop. `GlobalCaches.default_()` now stops one field later, at
`canonical_param_env_cache` (`rustc_middle::infer::canonical::CanonicalParamEnvCache`, infer/canonical.rs, lane
infcx-contract; the stub names that lane). I did not port it: the file is that lane's. traits.test.ts pins the new
stop message. **Root:** either let infcx-contract land it, or assign infer/canonical.rs's `CanonicalParamEnvCache`
(type + `Default`, 8 lines of the 210) to someone now.

## `unported(...)` left
- traits/mod.ts: `hash_ObligationCause` (the `Span` part: no `Hash` of the interned Span); `to_constraint_category`
  (`mir::ConstraintCategory`, M4; returns `unknown`).
- thir.ts stand-ins (named after their upstream fn, "repoint when they land"): `IntegerExt::from_int_ty` /
  `from_uint_ty` (ty/layout.rs, M4), `Integer::size`, `Size::{truncate,unsigned_int_max,sign_extend}` (rustc_abi),
  `ValTree::{to_leaf,try_to_leaf}`, `Value.valtree`, `Display for ty::Value`, `ScalarInt::{to_bits,
  to_bits_unchecked,to_uint,to_int}` (lane ty-results), `rustc_apfloat` float compare. So `PatRange` /
  `PatRangeBoundary` numeric methods stop as UNPORTED (only exhaustiveness reaches them, M4).
- specialization_graph.ts stand-ins with upstream bodies (no unported): `HasAttrs for DefId::get_attrs` (as context.ts's),
  `AssocItem::defaultness`.
- Generated: `unported_debug` for the pending types above (and `hir::Lit`, `ParamTy`, `ParamConst`, `AliasTy`,
  `DefIdMap`, `ItemLocalMap`/`UnordMap`); `unported_type_fold` for `UserType`, `CanonicalUserTypeAnnotation`,
  `ValTree`, `PredefinedOpaques` (`&List<(OpaqueTypeKey, Ty)>`).
- context.ts: `canonical_param_env_cache` (above).

## PORT decisions (root: please record)
1. Codegen set `rustc_middle_traits_thir` + set-local `middle_traits_thir.typemap.json`; the external aliases with
   no impl of their own (`PolyTraitClause` = `Binder<TraitClause>`, `AliasTy` = `Alias<AliasTyKind>`) get
   `visit_with_*` / `try_fold_with_*` / `fold_with_*` helpers in traits/mod.ts that type_fold.json points at (a
   type_fold template cannot pass a fixed impl fn). Root may move them to ty/predicate.ts / ty/sty.ts later.
2. Method/field clashes with generated classes: `ObligationCause::code()` is `code_()`, `Graph::parent()` is
   `parent_()` (precedent rustc_hir hir.ts `args_`).
3. `thir_with_elements!`: the five ids are hand-written `newtype_index` brands with their `debug_format`s
   (`a{}`, `b{}`, `e{}`, `s{}`, `p{}`); `Thir` is a hand class with `IndexVec`s as arrays, `debug_Thir` / `clone_Thir`
   written like the derives; `impl Index<$id> for Thir` is one method per id type (`index_ExprId`, ...), panicking out
   of range like slice indexing. thir/visit.rs uses them.
4. `thir::visit::Visitor` is an abstract class (precedent rustc_ast visit.ts).
5. `WithDepNodeCache` is a `KeyedMap` on `intern_key` (tuple keys of interned values); `WithDepNode::get` returns the
   stored value (`clone()` of never-mutated cached values).
6. `CanonicalInput` / `ExternalConstraints` extend `Interned` with the data in `_0` (the generated Debug reads `_0`);
   `Deref` is a free fn `<T>_deref` (precedent ty_info.ts `WithCachedTypeInfo_deref`), since `Interned.deref` returns
   the object.
7. `impl From<OverflowError> for SelectionError` is `SelectionError_from_OverflowError` in select.ts, exposed as
   `SelectionError.from` on traits/mod.ts's companion.
8. `ScopeTree.parent_map` is a `KeyedMap` on `key_Scope`; `Scope_eq` / `ScopeData_eq` hand-written (derived
   `PartialEq`); `extended_temp_scopes: ItemLocalMap<Option<Scope>>` uses `has` to tell `Some(None)` from absent.
9. Manual `Debug` impls written with `write!(f, "..{:?}..")` format the inner values with `PLAIN` (a fresh `{:?}`
   spec), not `f`.
10. `DynCompatibilityViolationSolution` derives `Ord` (callers sort it); no comparator was added (none is ported).

## For root
- `src/rustc_middle/queries.gen.ts` is regenerated and committed (`tools/codegen/queries.test.ts` requires it up to
  date): it now types region_scope_tree (`ScopeTree`), specialization_graph_of (`Graph`), dyn_compatibility_violations,
  adt_dtorck_constraint, codegen_select_candidate's error, the `Canonical*Goal` keys, ..., and imports the new gen
  modules (fresh loads of rustc_middle/lib.ts, ty/context.ts and queries.ts checked). Conflicts with query-growth:
  regenerate (`bun tools/codegen/queries.ts`) at merge. The remaining `as` casts in specialization_graph.ts
  (`associated_item`, `type_of`, `defaultness`) go once those query values are typed.
- Lanes ty-adt-assoc / ty-results / ty-mod: repoint the stand-ins listed above when `AssocItem::defaultness`,
  `HasAttrs for DefId`, `ValTree`/`ScalarInt`/`Value` land; their type map entries in
  `middle_traits_thir.typemap.json` (`unknown`) should then point at the real types (regenerate the set).
- `lang_items` (plan-m3 lists it for this lane) was already ported by lane lang-items in wave 14; nothing to do.

# Handoff: tyir-binder (wave 14, M3): rustc_type_ir binder.rs, fold.rs, visit.rs, walk.rs, generic_visit.rs

Branch `lane/tyir-binder` (from main a62a248, no merges). Commits: binder/fold/visit; walk/generic_visit; stand-in
replacement in tyir-kind's files; tests; rustc_middle ty/fold.rs + delayed_map; this handoff.

## Files touched
- **Ported (every fn, upstream order, markers):**
  - `src/rustc_type_ir/binder.ts` (binder.rs): `Binder` / `EarlyBinder` companions, the `fold_Binder(d)` /
    `visit_Binder(d)` descriptors (+ the gen-shaped `visit_with_Binder` / `try_fold_with_Binder` / `fold_with_Binder`),
    `ValidateBoundVars`, `IterInstantiated` / `IterInstantiatedCopied` / `IterIdentityCopied` / `EarlyBinderIter`,
    `ArgFolder` (instantiate), the manual Debug impls (`debug_Placeholder`, `debug_BoundRegionKind`, `debug_BoundRegion`,
    `debug_BoundTy`), companions `BoundRegionKind`, `BoundVariableKind`, `BoundRegion`, `BoundTy`, `BoundConst`,
    `PlaceholderRegion` / `PlaceholderType` / `PlaceholderConst`.
  - `src/rustc_type_ir/fold.ts` (fold.rs): `TypeFolder_provided` / `FallibleTypeFolder_provided`, the container impls
    (tuples, `Option`, `Result`, `fold_arc`, `Arc`, `Box`, `Vec`, `ThinVec`, `Box<[T]>`, `IndexVec`), `Shifter`,
    `shift_region`, `shift_vars`, `fold_regions`, `RegionFolder`, `set_aliases_*` / `set_opaques_to_non_rigid`,
    `RigidnessFoldMode`, `RigidnessFolder`; descriptor adapters `fold_tuple2` / `fold_tuple3` / `fold_Option` /
    `fold_Vec` (no upstream counterpart).
  - `src/rustc_type_ir/visit.ts` (visit.rs): `TypeVisitor_provided`, the container impls, `TypeVisitableExt` (trait +
    blanket impl as one companion), `HasTypeFlagsVisitor` (+ its Debug), `HasEscapingVarsVisitor`, `HasErrorVisitor`.
  - **New** `src/rustc_type_ir/walk.ts` (walk.rs): `TypeWalker`, `push_inner`, `push_ty_pat`.
  - **New** `src/rustc_type_ir/generic_visit.ts` (generic_visit.rs; rust-analyzer only, nothing in rustc reaches it).
  - **New** `src/rustc_type_ir/data_structures/delayed_map.ts` (delayed_map.rs: `DelayedMap`, `DelayedSet`), needed by
    `BoundVarReplacer` and closure.rs's `FoldEscapingRegions`.
  - `src/rustc_middle/ty/fold.ts` (rustc_middle ty/fold.rs, was ty-contract's stub, header said lane ty-results): the
    brief lists `BoundVarReplacer`, which lives there, so I ported the whole file: `BottomUpFolder`,
    `BoundVarReplacerDelegate`, `FnMutDelegate`, `BoundVarReplacer`, `Anonymize`, and the 8 `TyCtxt` methods
    (`instantiate_bound_regions[_uncached|_with_erased]`, `replace_[escaping_]bound_vars_uncached`,
    `liberate_late_bound_regions`, `shift_bound_var_indices`, `anonymize_bound_vars`), signatures as declared in decls.ts.
- **Edited (tyir-kind's files, per the brief: replace its stand-ins):**
  - `ty_kind.ts`: `Binder_skip_binder` / `Binder_map_bound` stand-ins removed (callers use `Binder.skip_binder` /
    `Binder.map_bound`); `TyKind::unnormalized_fn_sig`'s `FnDef` arm (`EarlyBinder::instantiate` + `Binder::no_bound_vars`)
    and `Error` arm (`Binder::dummy`) filled; new descriptor `fold_FnSig` over the generated impls.
  - `ty_kind/closure.ts`: `Binder_super_*`, `Ty_has_vars_bound_at_or_above`, `Ty_super_fold_with`, `shift_region` and
    `DelayedMap` stand-ins replaced by the real code (`visit_Binder` / `fold_Binder`, `TypeVisitableExt`,
    `standin_fold_Ty`, `fold.ts` `shift_region`, `DelayedMap`).
  - `const_kind.ts`: `AliasConst::type_of` filled (`EarlyBinder::instantiate`); its `interner` param is now `TyCtxt`
    (tyir-kind decision 3: the body needs `TyCtxt`'s API through `instantiate`). No callers.
- **Tests:** new `src/rustc_type_ir/tyir_binder.test.ts` (26 tests).
- Not touched: `.gen.ts`, decls.ts, tools/, harness/, scripts/.

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| file | ported |
|---|---|
| rustc_type_ir binder.rs | 108/108 |
| rustc_type_ir fold.rs | 73/73 |
| rustc_type_ir visit.rs | 74/74 |
| rustc_type_ir walk.rs | 5/5 |
| rustc_type_ir generic_visit.rs | 21/21 |
| rustc_type_ir data_structures/delayed_map.rs | 12/12 |
| rustc_middle ty/fold.rs | 29/29 |

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (9748; vendor 3888)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools` (final tree): 4133 pass, 1 skip (pre-existing
  linux-only), 0 fail.
- `RUST_TS_AGENT=tyir-binder bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 100/100 MATCH, 0 DIFF,
  0 UNPORTED (run `20261014-052021-tyir-binder-92rv`).
- Fresh-process `import()`: binder, fold, visit, walk, generic_visit, delayed_map, ty_kind, ty_kind/closure,
  const_kind, rustc_middle ty/fold, rustc_middle/lib, rustc_type_ir/decls all load as entry points.

## How consumers call it (D4)
- Descriptors: `T`'s descriptor goes last. `fold_Binder(d_T)` / `visit_Binder(d_T)` for `Binder<T>`;
  `standin_fold_Ty` for `Ty` (see below), `fold_Const` (sty/consts.ts), `fold_Region` (sty/mod.ts), `fold_FnSig`
  (ty_kind.ts), `fold_Vec(d)` / `fold_Option(d)` / `fold_tuple2(a, b)` / `fold_tuple3(a, b, c)` (fold.ts).
- `TypeVisitableExt.has_escaping_bound_vars(v, d)`, `.has_param(v, d)`, `.has_type_flags(v, flags, d)`, ... ;
  `shift_vars(tcx, v, n, d)`, `fold_regions(tcx, v, f, d)`, `Binder.dummy(v, d)`, `Binder.no_bound_vars(b, d)`,
  `EarlyBinder.instantiate(eb, tcx, args, d)`, `EarlyBinder.bind(tcx, v, d)`; `Binder.map_bound(b, f)` /
  `bind_with_vars` / `rebind` / `try_map_bound` take no descriptor (their `TypeVisitable` bound only feeds
  `cfg!(debug_assertions)` validation).
- Folder / visitor classes implement `TypeFolder` / `FallibleTypeFolder<E>` / `TypeVisitor<R>` and forward the
  methods they don't override to `TypeFolder_provided.<m>(this, ..)` etc. (precedent: closure.ts, binder.ts).
- `TypeWalker.new(arg)` is an iterator (`next()`, `skip_current_subtree()`, `for .. of`).

## `unported(...)` left
- Stand-ins for other lanes' code (fold.ts end): `standin_fold_Ty` / `standin_fold_Clauses` — the one-line
  `TypeFoldable` / `TypeVisitable` impls of `Ty` / `Clauses` are real, their `TypeSuper*` impls (rustc_middle
  structural_impls.rs :331/:379/:420, :625/:631/:638) call `unported`. So every default `fold_ty` / `visit_ty` /
  `fold_clauses` / `visit_clauses` that recurses into a type stops UNPORTED until ty-results lands.
- binder.ts: the two `assert!`s whose message prints a generic `T` (`Binder::dummy` :47, `EarlyBinder::instantiate`
  :651) stop UNPORTED when they fail (D4 descriptors carry no `Debug`); `PlaceholderConst::find_const_ty_from_env`
  (`ParamEnv::caller_bounds` and `{env:#?}`: ParamEnv pending); `debug_ParamConst` stand-in (structural_impls.rs) used
  only in an ICE message; `partial_descriptor`'s missing parts (below).
- walk.ts: `Pattern::kind` (Pattern pending) and `ty::Value::ty` (Value pending).
- rustc_middle ty/fold.ts: `LateParamRegionKind::from_bound` (region.rs:92) in `liberate_late_bound_regions`.
- Reached through other lanes' stubs: `Region::flags` / `outer_exclusive_binder` / `new_bound`, `fold_Region`'s impls
  (sty/mod.ts), `fold_Const` (sty/consts.ts), `Ty::new_bound` / `new_alias`, `Const::new_bound` / `new_alias`,
  `Region::new_late_param`, `fold_GenericArgs` (FnDef in `push_inner` / `unnormalized_fn_sig`), mod.ts's
  `visit_with_Ty` / `fold_with_Ty` (generated code), `debug_Ty` / `debug_Region` / `debug_Const` / `debug_ParamTy` /
  `debug_EarlyParamRegion` (ICE messages only). The tests mock these with upstream's logic (module comment).

## PORT decisions (please record)
1. **Folder / visitor traits stay interfaces + `*_provided`** (PORTING §8), not abstract base classes as the brief
   suggested: binder.ts's folders/visitors and fold.ts / visit.ts import each other's values (the default
   `fold_binder` needs binder.rs's `TypeSuperFoldable for Binder`; `ArgFolder` needs fold.rs), and a class `extends`
   across that cycle reads the base class in its TDZ when the cycle is entered from fold.ts / visit.ts.
2. **`TypeVisitableExt`**: trait + blanket impl are one companion object, `d` last; the required methods carry two
   markers (declaration, blanket impl).
3. **Generic `T: Debug` in assert messages**: UNPORTED on failure (decision above), rather than adding `Debug` to D4.
4. **Gen-shaped Binder impls** (`visit_with_Binder(self, v, visit_with_T)` etc.) build a partial descriptor from the one
   impl fn generated code passes; the other two parts call `unported`. Defaults reach only the passed part, except
   folders whose `fold_binder` visits the binder (`RigidnessFolder`).
5. **Companions**: methods of generated structs/enums on same-named companions taking `self` first (tyir-kind
   decision 1); all `Binder` methods sit in one companion, so the :64-:97 trait-impl block follows it (§8 rule).
6. **Unit structs** `FoundFlags` / `FoundEscapingVars` are their name as a string literal.
7. **Sets/maps keyed by interned values** (`SsoHashSet` in `TypeWalker` / `ValidateBoundVars`, `DelayedMap`,
   `instantiate_bound_regions`' `FxIndexMap<BoundRegion, _>`): `Set` / `KeyedSet` / `KeyedMap` (key `${index}#${ty.id}`
   or `intern_key`); only probed or iterated in insertion order (D6). `anonymize_bound_vars`' `FxIndexMap<BoundVar, _>`
   is a `Map` (entry index = insertion position).
8. **Iterators**: an `IntoIterator` value is a `readonly T[]`; `SliceIntoIter` (binder.ts) is its double-ended
   `IntoIter`. `Binder::iter` / `EarlyBinder::iter_identity` are generators.
9. `#[instrument]` / `debug!` (tracing) dropped; `cfg!(debug_assertions)` / `debug_assert!` blocks kept as comments.
10. `fold_arc`: TS has no `Arc`, so it folds the value (no `make_mut`).
11. `DelayedMap::default` / `DelayedSet::default` take the key function (`K: Hash + Eq`).
12. rustc_middle ty/fold.rs: `BoundVarReplacerDelegate` is a TS interface in that file; decls.ts's `Pending` alias is
    cast to it at the two entry points (`PORT(decls)`).

## For root
- **decls.ts**: replace `TypeWalker = Pending<"TypeWalker">` (rustc_type_ir/decls.ts) with a re-export of walk.ts's
  `TypeWalker`; replace `BoundVarReplacerDelegate = Pending<..>` (rustc_middle/ty/decls.ts) with a re-export of
  rustc_middle/ty/fold.ts's interface, then drop the two casts there. `Ty.walk()` / `GenericArg.walk()` stubs can now
  return `TypeWalker.new(..)` (stubs in generic_args.ts and ty/decls.ts; ty lanes).
- **Stand-ins to repoint** when their lanes land: `standin_fold_Ty` / `standin_fold_Clauses` (fold.ts) -> the real
  `fold_Ty` / `fold_Clauses` of structural_impls.rs (ty-results); `DebruijnIndex_shifted_in/out` (ty_kind.ts, lib.rs);
  `Unnormalized_new` (now exported by fold.ts; ty_kind.ts still has its own) -> unnormalized.rs; walk.ts
  `Pattern_kind` / `Value_ty`; binder.ts `ParamEnv_caller_bounds` / `debug_ParamConst`; rustc_middle fold.ts
  `LateParamRegionKind_from_bound`.
- **tools/codegen** (lanes may not edit): generated code passes one impl fn to `visit_with_Binder` /
  `try_fold_with_Binder` / `fold_with_Binder` (decision 4). Passing D4 descriptors (or all three fns) would close the
  gap. Also `debug_Binder`'s `bound_vars` field prints through `unported_debug` (binder.gen.ts): map `I::BoundVarKinds`
  Debug to `debug_RawList(v, f, debug_BoundVariableKind)`.
- `queries.gen.ts` types the `fn_sig` / `type_of` values `unknown`; ty_kind.ts / const_kind.ts cast them to
  `Interner`'s declared types (`PORT` notes).
- The test file mocks `Region` flags/`new_bound`, `Ty::new_bound`, `fold_Region` and `Ty`'s super-traversals; drop the
  mocks as those land.

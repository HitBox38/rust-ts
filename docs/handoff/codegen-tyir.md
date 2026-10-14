# Handoff: codegen-tyir (wave 13, M3): rustc_type_ir + rustc_middle::ty type codegen, TypeVisitable/TypeFoldable generator

Branch `lane/codegen-tyir`, based on main 2e11981. No merges. Lane ty-contract had not committed anything when this lane ran,
so the contract names (`Ty`, `Region`, `Const`, `List`, `GenericArg`, ..., the folder/visitor traits) are **stand-ins** in one
module that root repoints at merge (section 5).

## 1. Files touched
- **Generator** `tools/codegen/types.ts` (new options, all opt-in per set; section 2).
- **New config** `tools/codegen/type_fold.json` (impls of non-generated types for TypeVisitable/TypeFoldable),
  `tools/codegen/tyir.typemap.json` (set-only type map: `I::Ty` etc.; deliberately *not* named `typemap.*.json`, see 2.4).
- `tools/codegen/types.sets.json`: new set **`rustc_ty`** appended (existing sets untouched) + one `//` line documenting the options.
- **Tests** `tools/codegen/type_fold.test.ts` (7 tests) + fixture `tools/codegen/fixtures/rustc_ty.typedefs.json` (probe JSON,
  compact, items of `resolve_files` dropped).
- **Generated** (35 files): `src/rustc_type_ir/{lib,binder,canonical,const_kind,error,flags,generic_arg,infer_ctxt,lang_items,
  opaque_ty,outlives,pattern,predicate,predicate_kind,region_constraint,region_kind,relate,term_kind,ty_info,ty_kind,unnormalized}.gen.ts`,
  `src/rustc_type_ir/{solve/mod,solve/inspect,sty/mod,sty/consts,ty/alias,ty_kind/closure}.gen.ts`,
  `src/rustc_middle/ty/{sty,region,predicate,consts,generic_args,adjustment,assoc,consts/kind}.gen.ts`.
- **Hand skeletons** (one per generated file, `export * from "./x.gen.ts"` + `unported` stubs of the manual impls the
  generated code imports or that upstream has): same paths without `.gen`. They are owned by the later tyir / ty lanes.
- **Glue** `src/rust_ts/tyir_contract.ts` (contract stand-ins, section 5), `src/rust_ts/fmt_non_exhaustive.ts`
  (`DebugStruct::finish_non_exhaustive`; belongs in `src/std/fmt.ts`, which lanes may not edit).

## 2. Generator changes (tools/codegen/types.ts)
1. **`#[derive_where(A, B; bounds)]`** (derive-where 1.6.1) derives like `#[derive(..)]` (always on; no existing set file uses it,
   so no output changed). Field `#[derive_where(skip(Debug))]` / `skip`: the field is left out of Debug and a struct (or struct
   variant) ends in `finish_non_exhaustive` (`Name { a: 1, .. }`), exactly derive-where's `src/trait_/debug.rs`.
2. **`erase_params: ["I"]`** (D3): erased params leave the TS generics, debug/fold param lists and every reference's type
   arguments *at their position* (`Binder<I, T>` -> `Binder<T>`, middle `ir::TraitRef<TyCtxt<'tcx>>` -> `TraitRef`);
   `<I as Interner>::X` is rewritten to `I::X`, which resolves through the type map.
3. **`resolve_files`**: probed for `use`/`mod` only (rustc_middle `ty/mod.rs`'s `pub use self::sty::*`, rustc_type_ir
   `ty/mod.rs`, `data_structures/mod.rs`, `search_graph/mod.rs`); nothing generated, their items do not resolve.
4. **`typemap_extra: ["tyir.typemap.json"]`**: merged after the global map *for this set only*. Needed because
   `typemap.lint.json` maps `rustc_middle::ty::Ty`/`Clause` to `unknown` for rustc_lint; a global entry would have changed
   `rustc_lint/diagnostics.gen.ts`. Type-map entries may now carry **`item: "<key>"`** (the path resolves to that item of
   the set, e.g. `I::ParamTy` -> `rustc_middle::ty::sty::ParamTy`, `I::Probe` -> `solve::inspect::Probe`).
5. **`bitflags_debug`**: `bitflags! { #[derive(Debug)] struct X: uN }` gets bitflags-2.10.0's internal Debug
   (`X(A | B)`, `X(0x0)` when empty, via the ported `parser::to_writer`). Opt-in: rustc_parse's `Restrictions` would change.
   Also: bitflags consts may reference flags declared later (`TypeFlags::HAS_FREE_LOCAL_NAMES` reads `HAS_TY_FRESH`):
   evaluated to a fixpoint, emitted in declaration order (previously an error; no existing output changed).
6. **`derive_type_fold`** (+ optional `type_fold_types`): derive(TypeVisitable_Generic / TypeVisitable) and
   derive(TypeFoldable_Generic / TypeFoldable) (rustc_type_ir_macros/src/lib.rs, rustc_macros/src/type_visitable.rs +
   type_foldable.rs, same semantics) emit, next to the type in the file's `.gen.ts`:
   ```ts
   export function visit_with_X<T, R>(self: X<T>, __visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R
   export function try_fold_with_X<T, E>(self: X<T>, __folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<X<T>, E>
   export function fold_with_X<T>(self: X<T>, __folder: TypeFolder, fold_with_T: FoldWith<T>): X<T>
   ```
   - Fields in declaration order; enums `switch (self.$)`. Visit: `if ((r = try_visit(__visitor.Result, ..)) !== undefined) return r;`
     then `__visitor.Result.output()` (rustc_ast_ir/visit.ts convention). `#[type_visitable(ignore)]` skipped in visit;
     `#[type_foldable(identity)]` kept as is in fold. try_fold: `const __i = ..; if (__i.$ === "Err") return __i;` (the `?`).
   - Field impls: generated item -> its fn; manual `impl TypeVisitable/TypeFoldable` in the set's files -> `visit_with_<T>` etc.
     from the hand module of the impl's file; `trivial` list of type_fold.json (`TrivialTypeTraversalImpls!` of macros.rs and
     structural_impls.rs) -> visit statement left out (its `branch` always continues), fold = the value; type_fold.json
     `types` (`Option`, `Vec`, tuples, `[T]`, `I::Ty`, `I::GenericArgs`, ...; `$k` = impls of type argument k, Box/Arc/& transparent).
   - Generic args are passed as impl fns; calls spell out type arguments (`visit_with_S<number, R>(.., visit_with_trivial)`)
     and closures are typed, since TS cannot infer `T` from a generic impl fn argument.
   - No impl anywhere -> `unported_type_fold(..)` + `missing_type_fold` in the report. In rustc_ty this happens only where
     upstream has no impl either (the derived impl's where-clause never holds): `ProbeKind` (`QueryResult`'s
     `Canonical`/`NoSolution`, `CandidateSource`) and `SmallCopySet`'s fold (`[T; N]`). The golden test pins this list.
   - **Lift / Lift_Generic**: nothing generated (PORTING §3 rustc-skip, D4). **GenericTypeVisitable**: nothing (rust-analyzer only).
   - Report: `files[].type_fold`, `missing_type_fold`; the CLI summary prints them when non-zero.
7. Regenerating every existing set reproduces the committed files byte-identically (checked: in-place regeneration of all 26
   sets, `git status` clean apart from rustc_ty). Pre-existing: set `rustc_lexer` writes an untracked
   `src/rustc_lexer/lib.gen.ts` (not committed upstream of this lane either; deleted after each run).

## 3. Set rustc_ty
- 35 files, 254 types, 127 Debug fns, 204 TypeVisitable/TypeFoldable fns; 0 errors, 0 unknown types.
- `hand` (contract types, stand-ins re-exported by the skeletons): `rustc_type_ir::sty::Region`, `sty::consts::Const`,
  `rustc_middle::ty::generic_args::GenericArg`, `predicate::{Predicate, Clause}`.
- `skip` (working structs ported by hand with their impls: folders, visitors, iterators, canonicalizer state): binder
  `ValidateBoundVars`/`IterInstantiated*`/`EarlyBinderIter`/`ArgFolder`, `FlagComputation`, `DeepVariableResolver`,
  `OutlivesCollector`, `PlaceholderReplacer`, `HigherRankedAliasMatcher`, closure `HasRegionsBoundAt`/`FoldEscapingRegions`,
  `CanonicalParamEnvCache`, `CanonicalizerState`; and `adjustment::CoerceUnsizedInfo` (see 6.3).
- Not in the set (left to their lanes): rustc_type_ir fold.rs/visit.rs/elaborate.rs/relate/*/search_graph/*/walk.rs/
  data_structures; rustc_middle ty/mod.rs (hand-written), closure.rs and context.rs (**the typedefs probe's syn cannot parse
  them**: `closure.rs 460:8`, `context.rs 1379:12`), adt/trait_def/typeck_results/list/consts/valtree/... .
- Manual Debug impls left as `unported` stubs in the skeletons (24 + `TraitRef`/`ExistentialTraitRef` via ir_print.rs,
  `ParamTy` via print/pretty.rs, `GenericArg`): `TyKind`, `RegionKind`, `ConstKind`, `InferTy`, `InferConst`, `FnSig`,
  `FnSigKind`, `UnsafeBinderInner`, `ClauseKind`, `PredicateKind`, `TraitClause`, `ProjectionClause`, `NormalizesTo`,
  `Placeholder`, `BoundRegionKind`, `BoundRegion`, `BoundTy`, `Variance`, `Assumptions`, `LeafRegionConstraint`, `Region`,
  `LateParamRegion`, `Const`, `EarlyParamRegion`. Manual traversal stubs: `Binder`, `Region`, `Const` (visit/try_fold/fold).

## 4. How a later lane opts in
- **Port a file of the set**: edit its hand module (`src/rustc_type_ir/<file>.ts`); replace the stubs by the port (keep the
  names `debug_<T>`, `visit_with_<T>`, `try_fold_with_<T>`, `fold_with_<T>`, signatures as in the stubs). Never edit `.gen.ts`.
- **Add a file / type**: append it to `rustc_ty.files` in types.sets.json, run `bun tools/codegen/types.ts rustc_ty`, create the
  hand module (`export * from "./x.gen.ts"` + the names the report's `manual_debug` / imports need), refresh the fixture
  (`--save-json tools/codegen/fixtures/rustc_ty.typedefs.json`, then drop `resolve_files` items, compact) and the counts in
  type_fold.test.ts. Working structs go to `skip` with a reason.
- **TypeVisitable/TypeFoldable in another set**: `"derive_type_fold": true` (per-file sets; `derive_only` is not supported).
  For a manual impl, export `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>` from the hand module of the impl's file;
  for an external type, add a type_fold.json entry (or a `trivial` key).
- **Generic code** (D4 descriptors): take the impl fns as parameters, e.g. `resolve_vars_if_possible<T>(v: T, fold_with_T: FoldWith<T>)`;
  a descriptor object can bundle the three fns. If ty-contract defines a `Foldable<T>` object type, a generator option can
  emit one const per non-generic type (not done: its shape was unknown here).

## 5. For root: reconcile with ty-contract (and later lanes) at merge
1. In `tools/codegen/tyir.typemap.json` / `type_fold.json`, repoint every entry importing `src/rust_ts/tyir_contract.ts` at the
   real module (ty-contract's `Ty`, `List`, `GenericArg`, `Term`, `Predicate`, `Clause`, `ParamEnv`, ...; tyir-binder's
   `TypeVisitor`/`TypeFolder`/`FallibleTypeFolder` + std impls in rustc_type_ir visit.ts/fold.ts; type_fold.json `module`/`names`),
   regenerate (`bun tools/codegen/types.ts rustc_ty`), and delete the names from `src/rust_ts/tyir_contract.ts`.
2. The skeletons `src/rustc_type_ir/sty/{mod,consts}.ts`, `src/rustc_middle/ty/{generic_args,predicate}.ts` re-export the
   stand-in `Region`/`Const`/`GenericArg`/`Predicate`/`Clause`: point them at ty-contract's classes. If ty-contract created the
   same hand files, keep theirs and add `export * from "./x.gen.ts"` (add/add conflict expected there and in
   `src/rustc_type_ir/lib.ts` if it was created).
3. If ty-contract's TS shapes differ (e.g. `fold_with_T` descriptors as objects, other names), adjust `type_fold.json` `names`
   and the generator's signature lines in `tfLines` (types.ts) and regenerate.
4. Move `debug_struct_non_exhaustive` into `src/std/fmt.ts` (repoint `helpers` in tyir.typemap.json, regenerate).
5. Other lanes editing tools/codegen/types.ts (hir-types, lowering-contract) may conflict textually; my changes are additive
   blocks (SetConfig fields, `deriveWhereTraits`, erasure helpers, the `derive(TypeVisitable)` block before `docLines`).
6. Record the decisions in section 7.

## 6. Notes
1. Coverage: no upstream fn is ported (codegen lane); `bun scripts/coverage.ts --check`: markers ok (7925; vendor 3664).
   rustc_type_ir stays at its previous count; the stubs carry no `// rustc:` markers (they are not ports).
2. `unported(...)` left: every stub in the skeletons (manual Debug/traversal impls listed in 3) and in tyir_contract.ts (all
   contract values except the `TrivialTypeTraversalImpls!` fns); generated `unported_type_fold` only at the
   no-impl-upstream fields listed in 2.6.
3. `CoerceUnsizedInfo` is skipped: once generated, tools/codegen/queries.ts types query `coerce_unsized_info` with it and
   `src/rustc_metadata/rmeta/decoder/cstore_impl.ts` (its provider decodes with `decode_unported`, typed `never`) stops
   type-checking. Lane rmeta-ty should un-skip it together with its TyDecodable decoder and regenerate queries.gen.ts.
   With the skip, `bun tools/codegen/queries.ts --check` is up to date.
4. The golden takes ~6 s (glob re-export resolution); the test has a 120 s timeout.

## 7. PORT decisions (please record)
1. D3 erasure is a generator option (`erase_params`); `I::X` names TyCtxt's associated type (impl_interner.rs) via the type
   map, `item:` entries when it is a type of the set.
2. Generated traversal API: `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>`, impls of type params passed as fns
   (`VisitWith<T>` / `TryFoldWith<T>` / `FoldWith<T>`), explicit type arguments on generic calls.
3. Trivially traversable fields skip the visit statement (`output()` always continues) and fold to themselves.
4. Interned contract types are `hand` items of the set (`Region`, `Const`, `GenericArg`, `Predicate`, `Clause`).
5. Lift and GenericTypeVisitable derives produce nothing.
6. derive_where's Debug with skipped fields uses `finish_non_exhaustive` (helper in src/rust_ts until moved to src/std).

## 8. Evidence
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see the final report of this lane (first full run: 3898 pass,
  1 skip, 2 fails that were then fixed: the rustc_ty golden counts and queries.gen.ts staleness from `CoerceUnsizedInfo`).
- `bun scripts/coverage.ts --check`: ok.
- `RUST_TS_AGENT=codegen-tyir bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run 20261014-012442-codegen-tyir-l3t6).
- Fresh-process `import()` of all 72 new modules: ok (no init-time cycle).
- Debug expectations in type_fold.test.ts were printed by `rustc +nightly` from mirror types (IntVarValue with rustc_ast_ir's
  manual IntTy Debug, EarlyBinder/BoundConst with `finish_non_exhaustive`, bitflags' tuple Debug, Certainty/MaybeInfo).

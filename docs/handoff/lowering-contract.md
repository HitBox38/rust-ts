# Handoff: lowering-contract (wave 13, M3): the rustc_ast_lowering contract

Branch `lane/lowering-contract` (from main 2e11981, no merges).

## Result
`src/rustc_ast_lowering/` now exists as a contract plus stubs. The wave-14 lowering lanes only fill bodies.
- **decls.ts** declares every one of the crate's 419 upstream fns at its `file:line`.
- **Each stub module** installs an `unported(..)` placeholder for every method of its file.
- **lib.ts** is the crate root. It fixes the load order and the lib.rs split.
- **Real code:** `provide` (lib.rs:102) is ported and wires the three queries to the stubs. Nothing calls it
  yet (see "For root" 2). So no suite output changes.

## Files
All new, all under `src/rustc_ast_lowering/`:
- **`decls.ts`, the contract. Root owns it from now on.** It holds:
  - `class LoweringContext`: all 18 fields of lib.rs:281 in declaration order, plus `declare static new`;
  - `interface LoweringContext`: 287 method declarations, grouped by upstream file in upstream order, each with
    `// <file>:<line>`. lib.rs is in two groups, `lines 1..1756 (lane lower-lib-a)` and `lines 1757..3401
    (lane lower-lib-b)`;
  - `class DelegationResolver` (resolution.rs:183, the tuple struct as `_0`), with `declare static new` and
    `create_slots_from_args`, and its interface (17 methods from resolution.rs and generics.rs);
  - `interface FreeFns`: the 16 free fns with their final signatures (see "Free fns" below);
  - comment-only declarations of the remaining 96 fns: helper-type methods, trait impls (`Visitor`,
    `MutVisitor`, `Display`, `IntoDiagArg`) and the nested fns `with_lctx` and `is_ordinary`.
- **`hir_shim.ts`**: a temporary stand-in for the HIR types (see "HIR types assumed").
- **`lib.ts`**: the crate root. Besides the two lib.rs regions it holds:
  - the side-effect imports of every extension module, in upstream `mod` order;
  - `export * as stability`;
  - `provide`, the only ported fn;
  - the `HirArena` stand-in and the `ALLOW_*` statics;
  - stubs for `ResolverAstLowering_legacy_const_generic_args`, `index_ast`, `lower_to_hir` and
    `LoweringContext.new`;
  - the `unknown` type aliases of lib.rs.
- **Stub modules:** `item.ts`, `expr.ts` (it imports `expr/closure.ts`), `expr/closure.ts`, `pat.ts`, `path.ts`,
  `block.ts`, `asm.ts`, `format.ts`, `contract.ts`, `delegation/{mod,generics,resolution,attributes}.ts`,
  `index.ts`, `stability.ts`, `diagnostics.ts`.
- **`contract.test.ts`**: 8 tests (see "Checks").

## Split points and lane → file map
| lane | upstream | TS | what is waiting |
|---|---|---|---|
| lower-lib-a | lib.rs:1..1756 | lib.ts region `// ==== lane lower-lib-a: lib.rs:1..1756 ====` and the `// ---- lane lower-lib-a imports ----` block | lib.rs types up to `DiscardParams`; `PerOwnerLoweringState` (`new`/`owner_id`/`into_owner_info`); `LoweringContext::new`, `dcx`, `allow_gen_future`; `SpanLowerer::lower`; `ResolverAstLoweringExt::legacy_const_generic_args`; `RelaxedBoundPolicy::reborrow`; `Display for ImplTraitPosition`; `index_ast` + `Indexer`; `lower_to_hir` + `with_lctx`; `create_def` .. `lower_ty` (35 methods in the placeholder list) |
| lower-lib-b | lib.rs:1757..3401 | lib.ts region `// ==== lane lower-lib-b: lib.rs:1757..3401 ====` and its import block | `emit_bad_gca_macro` .. `elided_dyn_bound` (58 methods); `GenericArgsCtor`, `DirectConstArgContext` (bitflags), `UnrepresentableConstArgError` |
| lower-item | item.rs | item.ts | 50 methods, `add_ty_alias_where_clause` |
| lower-expr | expr.rs, expr/closure.rs | expr.ts, expr/closure.ts | 75 + 7 methods, expr.rs helper types and visitors |
| lower-pat-path-block | pat.rs, path.rs, block.rs | pat.ts, path.ts, block.ts | 15 + 8 + 6 methods |
| lower-asm-format-contract | asm.rs, format.rs, contract.rs | asm.ts, format.ts, contract.ts | 1 + 5 + 9 methods, 5 format free fns |
| lower-delegation | delegation/*.rs | delegation/*.ts | 12 + 4 + 2 `LoweringContext` methods, 17 `DelegationResolver` methods + 2 statics, `resolve_type_relative_delegations`, the generics helper types |
| lower-index-diag | index.rs, stability.rs, diagnostics.rs | index.ts, stability.ts, diagnostics.ts | `index_hir` + `NodeCollector`, the 4 stability fns + `Display for UnstableAbi`, the generated diagnostics + `IntoDiagArg for ResolvingRestrictionKind` |
| middle-hir | rustc_middle hir/mod.rs:463 | (rustc_middle) | `hir_owner` / `hir_attr_map` over `tcx.lower_to_hir` |

- **Why line 1757.** The plan said "~1700". 1757 is the first method boundary after `lower_ty`
  (lib.rs:1534..1756). Region a is 1,756 lines, region b 1,645.
- **How it is enforced.** contract.test.ts checks that each lib.ts placeholder list holds only its own side's
  methods. It also checks that every stub module's lists name only that file's methods.

## How to fill a stub
1. **Read the contract.** Your methods are declared in `decls.ts`, in the `interface LoweringContext` /
   `DelegationResolver` group for your file. Do not change a signature. A wrong or missing declaration goes
   in your handoff (signature + reason). If you cannot type-check without the change, add a local
   `declare module "./decls.ts"` (or `"../decls.ts"`) in your own file, marked `// PORT(decls): pending root`.
2. **Methods.** In upstream order, write
   `LoweringContext.prototype.<name> = function (this: LoweringContext, ..): R { .. };`
   (or `DelegationResolver.prototype`). Put the marker `// rustc: compiler/rustc_ast_lowering/src/<file>:<line>
   <name>` directly above it. Then delete the name from the file's `unported_methods(..)` list, and delete the
   call when the list is empty. lib.ts has two lists: each lib lane edits only its own region.
3. **Statics and free fns.** These already have their final signatures in the stub: `LoweringContext.new`
   (lib.ts), `DelegationResolver.new` (resolution.ts), `DelegationResolver.create_slots_from_args`
   (generics.ts), and every `export function` listed in `FreeFns`. Fill the body in place, add the marker,
   and drop the `(stub ..)` comment. contract.test.ts type-checks them against `FreeFns`. Nested fns
   (`with_lctx`, `is_ordinary`) are ported inside their parent with their own marker.
4. **Types.** The stub modules alias every crate-local type to `unknown`. Examples: `ImplTraitContext`,
   `ParamMode`, `MoveExprState`, `GenericsGenerationResults`, `DelegationResolution`, `UnstableAbi`,
   `ResolvingRestrictionKind`. The real types come from tools/codegen (see "For root" 3). Once
   `<file>.gen.ts` exists, replace the aliases with `export * from "./<file>.gen.ts"`, plus the hand companions
   (enum methods, `display_*`). Do not hand-write data types the generator can produce.
5. **Imports.** Put new imports at the top of your file. In lib.ts, use your lane's import block.
6. **Init order.** Breaking these rules gives a TDZ `ReferenceError` at load:
   - `decls.ts` imports only types and must never import a crate module at runtime;
   - lib.ts imports decls.ts first, then the extension modules, then attaches lib.rs's methods;
   - an extension module's top-level code may touch only `decls.ts`, its own `.gen.ts` and other crates. It
     reads lib.ts exports (`ImplTraitContext` companions, `ALLOW_*`, `HIR_ARENA`, ...) inside function bodies
     only;
   - consumers outside the crate import `src/rustc_ast_lowering/lib.ts` only.

   Every module currently loads as a fresh-process entry point.
7. **Representation:**
   - Signature mapping: see the decls.ts header (PORTING §5 plus the res-lib conventions). Closures are
     `(this_: LoweringContext, _2: A) => R`, and `&mut Vec<T>` out-parameters are the array itself.
   - **Arenas are erased.** `self.arena.alloc(x)` is `x`, and `alloc_from_iter` / `alloc_slice` /
     `alloc_index_slice_from_iter` return a fresh array (`HirArena`, lib.ts). `LoweringContext::new` sets
     `arena: HIR_ARENA`, which stands for `tcx.hir_arena`. `arena_vec![this; a, b]` is `[a, b]`.
   - **Field rename.** The field `next_node_id` is `next_node_id_`, because `next_node_id()` is a method.
   - **`ALLOW_*` statics** (`allow!`, lib.rs:329) are ported in lib.ts as frozen `readonly Symbol[]`.
     `Arc::clone` shares them.
   - **`ResolverAstLoweringExt`** (an extension trait on rustc_middle's `ResolverAstLowering`) is the free fn
     `ResolverAstLowering_legacy_const_generic_args(self, expr, tcx)`.
   - **`Cow<'_, FormatArgs>`** is format.ts's `Cow<T>` (`Borrowed` | `Owned`). `to_mut` on `Borrowed` must
     `clone_FormatArgs`.
   - **`for_all_argument_indexes`** takes `(_1: MutRef<number>) => void`.
   - **`make_count`'s map** is keyed by `(usize, ArgumentType)`. Its declared type is
     `Map<[number, ArgumentType], ..>`, but it needs a `KeyedMap` (src/rust_ts/keyed.ts) with a tuple key fn.
     That is format lane work.
   - **`ty::FnSig`** (`create_sig_mapping`) is `TyFnSig = unknown` in decls.ts until wave 15.
     `ty::GenericParamDef` is rustc_middle/ty/generics.ts's.

## HIR types assumed (coordination with hir-types)
- **The import point.** decls.ts and the stubs write `hir.X` via `import type * as hir from "./hir_shim.ts"`.
- **The 104 names.** 103 are `rustc_hir::X` types defined in compiler/rustc_hir/src/hir.rs; the other is
  `DelayedLint` (rustc_hir/src/lints.rs). Their upstream names are:
  AmbigArg, AngleBrackets, AnonConst, Arm, AssocItemConstraint, Block, BlockCheckMode, Body, BodyId,
  ClosureBinder, ClosureKind, ConstArg<Unambig>, ConstArgExprField, ConstBlock, ConstItemRhs, Constness,
  CoroutineDesugaring, CoroutineKind, CoroutineSource, Defaultness, Destination, DotDotPos, Expr, ExprField,
  ExprKind, FieldDef, FnDecl, FnDeclFlags, FnHeader, FnRetTy, FnSig, ForeignItem, ForeignItemId, GenericArg,
  GenericArgs, GenericBound, GenericBounds, GenericParam, GenericParamKind, GenericParamSource, Generics,
  ImplItem, ImplItemId, ImplItemImplKind, ImplRestriction, InlineAsm, Item, ItemId, ItemKind, LetStmt,
  Lifetime, LifetimeSource, LifetimeSyntax, Lit, LocalSource, MatchSource, MaybeOwner, MissingLifetimeKind,
  Mod, MutRestriction, Node, OpaqueTy, OpaqueTyOrigin<D>, OwnerInfo, OwnerNode, Param, ParamName,
  ParentedNode, Pat, PatExpr, PatField, PatKind, Path<R>, PathSegment, PolyTraitRef, PreciseCapturingArg,
  PredicateOrigin, QPath, RangeEnd, RestrictionKind, Safety, Stmt, StmtKind, TestBinderBody,
  TestBinderBoundTypeConstraint, TestBinderConstraint, TestBinderExists, TestBinderForall, TraitBoundModifiers,
  TraitCandidate, TraitImplHeader, TraitItem, TraitItemId, TraitRef, Ty<Unambig>, TyKind, TyPat,
  UnsafeSource, UsePath, UseTree, Variant, VariantData, WherePredicate, DelayedLint.
- **Taken from elsewhere.**
  - The ast re-exports of hir.rs (`BindingMode`, `CaptureBy`, `Movability`, `UnOp`, `BinOp`, `AssignOp`)
    come from rustc_ast.
  - `HirId` / `OwnerId` / `ItemLocalId` come from rustc_hir_id.
  - `intravisit::InferKind` is lane hir-visit's (it appears only in a comment declaration).
- **Assumed generated shape.**
  - Non-lifetime generic parameters are kept, with their defaults: `Ty<Unambig = ()>`, `ConstArg<..>`,
    `Path<R = Res>`, `OpaqueTyOrigin<D>`.
  - Type aliases (`GenericBounds`, `UsePath`, `Lit`) are exported under their upstream names.
- **The swap on integration.** hir_shim.ts's header has the exact text. Replace its body with
  `export type * from "../rustc_hir/lib.ts"` (or the module hir-types exports hir.rs from), plus
  `DelayedLint` from lints. tsc then checks every contract signature against the generated types. A name
  that hir-types did not generate becomes a compile error, not a silent `unknown`.

## Checks
- `bunx tsc --noEmit -p .`: clean. Also clean with `--noUnusedLocals` for this crate.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Test run" at the end.
- `bun scripts/coverage.ts --check`: `markers ok (7926; vendor 3664)`.
- `bun scripts/coverage.ts --crate rustc_ast_lowering`: 1/419 (`provide`). Every other file is 0/n (asm 1,
  block 6, contract 9, delegation/attributes 2, generics 23, mod 14, resolution 18, diagnostics 1, expr 83,
  expr/closure 7, format 10, index 48, item 51, lib 117 left, pat 15, path 8, stability 5).
- **contract.test.ts**:
  1. Its impl scan matches coverage.ts's fn finder; there are 419 fns.
  2. Every fn is declared at its `file:line`.
  3. All 288 `impl LoweringContext` fns and 19 `DelegationResolver` fns are real declarations or statics.
  4. Every declared method exists on the prototype after loading lib.ts.
  5. `FreeFns` equals the stub exports. This is checked by tsc as well as at runtime, and every upstream free
     fn is a member.
  6. The placeholders stop with `Unported` and the upstream path.
  7. The stub lists name only their own file's methods.
  8. lib.ts's two lists split at 1757.

  Negative controls: dropping `lower_pat` from pat.ts's list fails tests 4 and 6. Putting `lower_expr` into
  pat.ts's list fails test 7.

## `unported(...)` left
- **Placeholders:** every method of `LoweringContext` (287) and `DelegationResolver` (17), as
  `rustc_ast_lowering::[<mod>::]<Type>::<name>`.
- **Statics:** `LoweringContext::new`, `DelegationResolver::{new, create_slots_from_args}`.
- **Free fns:**
  - lib.ts: `index_ast`, `lower_to_hir`, `ResolverAstLoweringExt::legacy_const_generic_args`;
  - item.ts: `add_ty_alias_where_clause`;
  - format.ts: `flatten_format_args`, `make_argument`, `make_count`, `expand_format_args`,
    `for_all_argument_indexes`;
  - resolution.ts: `resolve_type_relative_delegations`;
  - index.ts: `index_hir`;
  - stability.ts: `enabled_names`, `extern_abi_enabled`, `gate_unstable_abi`, `extern_abi_stability`.

## PORT decisions (please record)
1. **Contract-first layout**, following res-lib and parser-core:
   - decls.ts holds `LoweringContext` and `DelegationResolver`, with every method declared;
   - `FreeFns` gives the free fns their final signatures;
   - comment declarations cover the rest;
   - per-file stubs use `unported_methods`;
   - the init-order rule in "How to fill a stub" 6.
2. **lib.rs is split at 1757 into two lane regions** of the same lib.ts, each with its own import block, as
   rmeta-contract did for decoder.ts.
3. **HIR types go through `hir_shim.ts` until hir-types merges.** Crate-local types are `unknown` aliases until
   codegen set `rustc_ast_lowering` runs.
4. **Representation:**
   - arenas are erased (`HirArena` / `HIR_ARENA` stand in for `tcx.hir_arena`);
   - `next_node_id_` (field rename);
   - `ALLOW_*` are frozen arrays;
   - `ResolverAstLowering_legacy_const_generic_args` is a free fn;
   - `DelegationResolver` is a class with `_0`;
   - format.ts has `Cow<T>`;
   - `for_all_argument_indexes` takes a `MutRef` callback.
5. **`provide` is ported** (lib.rs:102); its three providers are stubs.

## For root
1. **Integrate after hir-types.** Swap hir_shim.ts as described above and fix any signature that no longer
   type-checks. Then decide whether to keep the one-line shim or point the imports at rustc_hir directly.
2. **Wire `provide`.** In `src/rustc_interface/passes.ts` `default_query_providers`, rustc_ast_lowering is still
   listed under "pending crates". Add `rustc_ast_lowering.provide(providers.queries)` (import lib.ts). Until
   then, `index_ast` / `lower_to_hir` / `resolve_type_relative_delegations` keep upstream's `default_query`
   ICE.
   - Nothing reaches them today, because the hir-tree path is unported.
   - With the wiring, they stop as UNPORTED instead.
   - `hir_owner` / `hir_attr_map` (rustc_middle hir/mod.rs:463) belong to middle-hir.
3. **Codegen set `rustc_ast_lowering`**, as the first step of wave 14 and after hir-types: add the set to
   `tools/codegen/types.sets.json` and run `bun tools/codegen/types.ts rustc_ast_lowering`.
   - **Files:** all 17 files of the crate.
   - **`hand`:** `rustc_ast_lowering::LoweringContext` and
     `rustc_ast_lowering::delegation::resolution::resolver::DelegationResolver`, both in decls.ts.
   - **Settings:** `auto_class: true`.
   - **Trial run** (scratch output, not committed): 10 files, 107 types, 23 Debug fns, 61 diagnostic derives.
     Its open items:
     - every `rustc_hir::*` type was unresolved; it needs hir-types' typemap entries;
     - `NodeMap` Debug is in hash order, for `ReloweringChecker`;
     - `DirectConstArgContext`'s `bitflags!` Debug is not generated yet;
     - two `IntoDiagArg` entries are missing: `DiagArgFromDisplay`, and `DiagSymbolList<char>` at
       diagnostics.rs:87 and :262.
   - The `unknown` aliases in the stubs then become `export * from "./<file>.gen.ts"`.
4. **`#[cfg(debug_assertions)]` code.** This covers `mod re_lowering` (`ReloweringChecker::assert_node_is_not_relowered`
   lib.rs:124, `allow_relowering` lib.rs:135) and the `relowering_checker` field.
   - Rustc ships without debug assertions.
   - Recommended: `// rustc-skip:` for the two fns, with root's recorded decision. Lane lower-lib-a then adds
     the markers. This is a new skip category (PORTING §3 lists the allowed ones).
5. **Record the PORT decisions above.** Then point the wave-14 lowering lanes at "How to fill a stub" and at
   their split rows.

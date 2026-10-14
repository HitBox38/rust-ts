# Handoff: merge-w13 (fixer; wave-13 M3-foundation integration)

Worktree `.data/integ`, branch `integ`, from main `fb3b552`. Merged with `git merge --no-ff`, in this order, one commit
per merge (plus one for scope.json):

| commit | merge |
|---|---|
| `ffe4d1c` + `c3e0513` | lane/vendor-ena; `harness/scope.json` `vendor` gains `"ena": "=0.14.4"` |
| `2da94be` | lane/hir-types (clean) |
| `0c123a6` | lane/hir-visit (conflicts: `rustc_hir/hir.ts` add/add, `rustc_hir/lib.ts`) |
| `ddca2cd` | lane/lowering-contract (clean; hir_shim swap, two rustc-skips) |
| `97b01a2` | lane/ty-contract (clean; `pat_util` switched to `DefIdSet`) |
| `f287f87` | lane/codegen-tyir (8 add/add conflicts; stand-ins replaced; see §4) |
| `b2a0ae1` | lane/probe-tydump (clean; ACCEPT-WITH-NOTES, `docs/reviews/probe-tydump.md`) |

`lane/harness-w13` was not merged (still in progress).

## 1. Results
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (8644; vendor 3888)`.
  - `--missing`: hir.rs 222/222, intravisit.rs 150/150, pat_util.rs 9/9.
- `bun scripts/probes.ts build tydump thirdump`: both built (`.data/target/probes/release/{tydump,thirdump}`).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3985 pass, 1 skip (the pre-existing linux-only test),
  0 fail. No PENDING entries were advanced by these merges, so none were touched.
- Sample difftests (`RUST_TS_AGENT=merge-w13`, `--sample 200`):
  - `parse`: 200/200 MATCH (run `mw13-final-parse`).
  - `expanded`: 199 MATCH, 1 DIFF, 0 UNPORTED (run `mw13-final-expanded`).
  - `resdump-nocore`: 199 MATCH, 1 DIFF, 0 UNPORTED (run `mw13-final-resdump-nocore`).
  - Both expanded and resdump-nocore are case-for-case identical to the same sample on clean main `fb3b552` (runs
    `mw13-base-expanded` / `mw13-base-resdump`): no status changes, no new UNPORTED.
- **The one DIFF is pre-existing and environmental, not a regression**:
  - The case is `tests/ui/simd/intrinsic/generic-elements-pass.rs`, which is protected in both suites.
  - Its cached oracle output is `error: couldn't find file tests/ui/simd/intrinsic/../../../auxiliary/minisimd.rs`
    (exit 1). The file exists now (mtime 2026-10-14 03:38), so the cache entry was apparently written while the
    upstream checkout was incomplete; the oracle cache key does not cover auxiliary files.
  - I did not touch the cache. **Root:** re-validate that oracle entry before the next gate run, or the gate will
    report this protected case as lost.
- Codegen: every set in `tools/codegen/types.sets.json` (except `/` keys and `rustc_lexer`) regenerates
  byte-identically, apart from set `rustc_ty`, whose regenerated output is committed. `bun tools/codegen/queries.ts`
  leaves `queries.gen.ts` unchanged.

## 2. vendor-ena
- `harness/scope.json`: added `"ena": "=0.14.4"` (handoff item 1).
- Handoff item 2 is left for when rustc_data_structures gets a `lib.ts`: it should
  `pub use ena::{snapshot_vec, undo_log, unify}` and declare `pub mod snapshot_map; pub mod sso`.

## 3. hir-types + hir-visit: `src/rustc_hir/hir.ts`
**Base.** I kept hir-types' file (oracle-tested, built on the real `hir.gen.ts`). hir-visit's
`hir_standin.ts` is deleted, and `pat_util.ts`'s `declare module` now targets `./hir.gen.ts`. `intravisit.ts`
already imported from `./hir.ts`. After the swap tsc was clean with no further changes:
- `TaggedRef.pointer()` exists in hir-types' `rustc_data_structures/tagged_ptr.ts`;
- both lanes used the same renamed methods (`args_`, `span_ext_`, `splatted_`, `safety_`).

**Per-fn review.** 173 of the 218 shared fns differ textually. Four read-only reviewers compared each one against
upstream, split by line range. The outcome, by group:
- **hir-types' text, unchanged** (equivalent, or hir-types is the faithful one): about 160 fns. They cover:
  - Lifetime/Path/PathSegment/ConstArg/InferArg;
  - GenericArgs/GenericParam/Generics, including the suggestion helpers;
  - WhereBoundPredicate/WhereRegionPredicate, AttributeMap, OwnerNodes/OwnerInfo/MaybeOwner;
  - Pat walk*/DotDotPos, Closure/Coroutine*, Expr*, QPath/Ty/PrimTy, InlineAsm, FnDecl/FnDeclFlags accessors;
  - TraitRef/VariantData/ItemId/Item*/Safety/HeaderSafety, ForeignItem, OwnerNode, Node.
  - The remaining differences are style only: if-chain vs switch, arrays vs generators, companion names.
  - The 42 textually identical fns are also hir-types'.
- **Changed to hir-visit's (upstream's) text:**
  - `unreachable!` messages: `LifetimeSyntax::from` (:88) and `Lifetime::suggestion` (:309) gain the
    `internal error: entered unreachable code: ` prefix that `unreachable!("..")` prints.
  - `OwnerNode::fn_decl` (:4847): hir-types delegated to `fn_sig`; it is now upstream's own 4-arm match.
  - Doc comments restored to upstream's text:
    - `paren_sugar_output` (:699) and `GenericArgs::span` (:748);
    - `FnDeclFlags::default` (:3805), `set_splatted` (:3856) and `set_no_splatted_args` (:3883);
    - `TraitRef::trait_def_id` (:4172), `Constness::default` (:4441) and `Node::path` (:5229).
  - Invented doc comments removed: `Block::innermost_block` (:1504) and `VariantData::ctor_kind` (:4253).
- **Neither lane was faithful: `Expr::equivalent_for_indexing` (:2491).** hir-types compared `Res::Local(HirId)` by
  object identity, and hir-visit left the literal arm `unported`. Now it is hir-types' `ast_LitKind_eq` with
  `Res_eq(.., HirId_eq)`.
- **hir-visit only:** `ConstItemRhs::span` (:430), `Ty::find_self_aliases` (:3261) with its `visit_ty` (:3265), and
  `Node::fn_kind` (:5204). hir.ts imports `FnKind`, `HirTyCtxt`, `Visitor` and `walk_ty` from `./intravisit.ts`;
  they are used only inside function bodies, and every rustc_hir module loads as a fresh entry point.
- **Names kept from hir-types**, since nothing outside hir.ts calls hir-visit's spellings:
  - `LifetimeSyntax.from` and `HeaderSafety.from`;
  - `display_CoroutineKind(self, alternate)`;
  - `FnDeclFlags.default_()`;
  - `as_unambig_ty` and `peel_refs` stay prototype methods (not hir-visit's `TyAmbig` companion); `peel_refs` is
    one method carrying both markers (:3227 and :3237).
- `rustc_hir/lib.ts`: the mods follow upstream lib.rs order (intravisit, lints (not ported), pat_util,
  stable_hash_impls).
- **`hir.oracle.test.ts`**: the `opt_hash` fixtures depended on where the checkout lives. rustc hashes a source file
  by its absolute embeddable path, so the test failed in every worktree except hir-types' own, even though the port
  matches the live oracle.
  - The test now passes `--remap-path-prefix=<case dir>=/hir_oracle` to both rustc and the subject.
  - The fixtures were regenerated with `REGEN=1`; only Fingerprint lines changed.
  - It passes in two different worktrees.
- `pat_util::necessary_variants` dedups with ty-contract's `DefIdSet`, as upstream does. This replaces the local
  `krate * 2^32 + index` set (hir-visit "For root" 4).

## 4. lowering-contract
- `hir_shim.ts` now holds `export type * from "../rustc_hir/lib.ts"`. tsc is clean against the generated HIR types, so
  every contract name exists.
  - The one exception is `DelayedLint` (rustc_hir lints.rs, not ported), which stays `unknown` with a PORT note.
- `ReloweringChecker::assert_node_is_not_relowered` (lib.rs:124) and `allow_relowering` (lib.rs:135) are now
  `rustc-skip`, with the note "#[cfg(debug_assertions)]-only: the oracle is a release build without
  debug_assertions".
- Not done (not part of this merge): wiring `rustc_ast_lowering.provide` into `default_query_providers`
  (handoff "For root" 2), and codegen set `rustc_ast_lowering` (item 3).

## 5. ty-contract + codegen-tyir
**Conflicts.** There were add/add conflicts in 8 files:
- rustc_middle `ty/{assoc,consts,generic_args,predicate,sty}.ts`;
- rustc_type_ir `flags.ts` and `sty/{mod,consts}.ts`.

Each keeps ty-contract's content (the contract, the classes, the `unported_methods` lists), plus
`export * from "./<file>.gen.ts"` and codegen-tyir's manual-impl stubs: `debug_ParamTy` and `debug_LateParamRegion`.
`types.ts` and `types.sets.json` merged textually with hir-types' changes. Byte-identical regeneration confirms the
merged generator.

**Stand-ins replaced; `src/rust_ts/tyir_contract.ts` deleted.**
- **`tyir.typemap.json`**:
  - The interned types point at their real modules:
    - `Ty`, `Term` and `FnInputTys` at ty/mod.ts;
    - `GenericArg`, `GenericArgs`, `GenericArgsSlice` and `Tys` at ty/generic_args.ts;
    - `Predicate` and `Clause` at ty/predicate.ts;
    - `List` at ty/list.ts (`debug_RawList($v, $f, $d0)`);
    - `Clauses` and `BoundVarKinds` at list.ts;
    - `InternedRegionKind` and `InternedConstKind` at `Region` / `Const`.
  - Types of later lanes point at the decls.ts `Pending` aliases with `"debug": null`, so the generator emits
    `unported_debug`. These are AdtDef, Pattern, Value, ValTree, ScalarInt, ParamEnv, ImplTraitInTraitData,
    ExternalConstraints, CastKind, BinOp, UnOp, FieldIdx, VariantIdx, RequiredDepth, SortedIndexMultiMap and
    TransitiveRelation.
  - The `&List<T>` aliases also use `"debug": null`: `Consts`, `PatList`, `LocalDefIds`, `CanonicalVarKinds`,
    `BoundExistentialPredicates`, `RegionAssumptions` and `PredefinedOpaques`.
  - New entry `rustc_hir::Safety`: hir-types removed the global stand-in entry, so set rustc_ty had an unknown type.
- **`type_fold.json`**:
  - `module` is `src/rustc_type_ir/fold.ts`.
  - Each interned type's entry has an `import` naming the module that holds its impls.
- **`rustc_type_ir/fold.ts`** is the codegen facade. It holds:
  - re-exports of `TypeVisitor`/`VisitWith` and of the visit container stubs from visit.ts;
  - `TryFoldWith`/`FoldWith`;
  - the fold container stubs;
  - the trivial fns from a new `rustc_type_ir/macros.ts`.

  The fn types are `TypeVisitable<T>["visit_with"]` and `TypeFoldable<T>["try_fold_with"/"fold_with"]`, so
  codegen's impl fns are exactly the methods of ty-contract's D4 descriptors.
- **Interned types:**
  - Where a D4 descriptor already exists (Region, Const, GenericArg, GenericArgs, `List<Ty>`, Term), the free
    `visit_with_<T>`/`try_fold_with_<T>`/`fold_with_<T>` wrap it.
  - The impls nobody has ported are `unported` stubs:
    - in the type's own module: Ty, ParamEnv, Predicate, Clause;
    - in new contract-stub files at their mirrored paths:
      - `rustc_middle/ty/structural_impls.ts`: AdtDef, Pattern, Clauses, ErrorGuaranteed and the list types;
      - `rustc_middle/ty/consts/valtree.ts`: Value;
      - `rustc_middle/traits/solve.ts`: ExternalConstraints.
  - Debug: `debug_GenericArgs`, `debug_Tys`, `debug_GenericArgsSlice` and `debug_FnInputTys` are composed from
    `debug_RawList`/`debug_list` plus the element's Debug. `debug_Ty`, `debug_Predicate` and `debug_Clause` are stubs.
- **Pending aliases replaced by the generated types:**
  - `rustc_type_ir/decls.ts`: every pending type that set rustc_ty generates, imported from its hand module. Only
    TypeWalker, CanonicalParamEnvCache, GlobalCache and RequiredDepth remain `Pending`.
  - `rustc_middle/ty/decls.ts`: ParamTy, ParamConst, EarlyParamRegion, LateParamRegionKind, Expr, AssocItem,
    InlineConstArgs and CanonicalPolyFnSig.
  - New aliases for the Interner list types and for CastKind, BinOp, UnOp, SortedIndexMultiMap and
    TransitiveRelation.
  - **Enum shapes agree.** tsc found no mismatch between the generated types and ty-contract's constructions:
    TyKind/RegionKind/ConstKind/InferTy/BoundVarIndexKind/Binder/BoundRegion/BoundTy match. Only test literals
    needed the branded `ConstVid`/`RegionVid`.
  - `INNERMOST` and `TypeFlags_empty` stay as ty-contract's constants. They are value-identical to the generated
    ones, but re-exporting them would add a runtime cycle between decls.ts and flags.ts.
- **Other changes:**
  - `debug_Term` takes `(v, f)` (the generated code passes `f`).
  - `debug_struct_non_exhaustive` moved into `src/std/fmt.ts`, and `src/rust_ts/fmt_non_exhaustive.ts` is deleted
    (codegen §5.4). `rustc_parse/parser/mod.ts` keeps its own local `debug_struct_finish_non_exhaustive`, which
    prints `name {\n    ..\n}` for zero fields in `{:#?}`, whereas core prints `name { .. }`. Nothing reaches
    that path today; it is the parser owner's to fix.
  - `type_fold.test.ts`:
    - imports the traits from fold.ts;
    - casts its minimal visitor/folder objects (the full trait interfaces have hooks the generated impls never call);
    - the `debug_struct_non_exhaustive` import check is a regex, because the generator now merges it into the
      std/fmt import.
- **Fresh-process loads:** every `.ts` under rustc_type_ir, rustc_middle/ty and rustc_middle/traits, plus
  `rustc_middle/lib.ts`, loads as a fresh entry point with no TDZ errors.

## 6. probe-tydump
Merged as reviewed, and both probes are built. The three new suites are unprotected and were not run.

## 7. PORT decisions (root: please record)
1. hir.ts reconciliation: hir-types' implementation everywhere, hir-visit's text where it is the faithful one
   (list in §3), and hir-visit's four intravisit-dependent fns. One marker per upstream fn.
2. `hir.oracle.test.ts` remaps the case directory (`--remap-path-prefix`) so `opt_hash` fixtures do not depend on the
   checkout path.
3. rustc_ast_lowering lib.rs:124/:135 are `rustc-skip` because they are `#[cfg(debug_assertions)]`-only. This is a
   new skip category in practice; earlier precedents are rustc_attr_parsing parser.rs:375 / interface.rs:531 and
   rustc_serialize opaque.rs:224.
4. **D4 bridge.** Generated code keeps codegen-tyir's free impl fns (`visit_with_<T>`, ...). Their types are the
   methods of ty-contract's descriptors, and for interned types they wrap the `fold_<T>` descriptors. A lane that
   ports an impl writes the descriptor and keeps the wrappers.
5. Stubs for impls nobody owns yet live in the type's module, or else in a contract stub at the mirrored path of the
   upstream file holding the impl (`ty/structural_impls.ts`, `ty/consts/valtree.ts`, `traits/solve.ts`).
6. `tyir.typemap.json`: types of later lanes are the decls.ts `Pending` aliases with Debug `unported_debug`. That
   includes the `&List<T>` aliases whose element Debug is generated in the same set; a type-map expression cannot
   import a generated name without colliding in that file.
7. `debug_struct_non_exhaustive` lives in `src/std/fmt.ts`.

## 8. For root
- Re-validate the stale oracle cache entry for `tests/ui/simd/intrinsic/generic-elements-pass.rs` (§1) before
  gating.
- Record the decisions in §7, and the lanes' own lists: vendor-ena §PORT, hir-types §PORT, hir-visit §PORT,
  lowering-contract §PORT, ty-contract §PORT (including its PORTING §5 D2 amendment text), codegen-tyir §7, and
  probe-tydump's thirdump flat-default decision.
- Follow-ups left open:
  - rustc_data_structures `lib.ts` re-exports of ena (§2);
  - wiring `rustc_ast_lowering.provide` and codegen set `rustc_ast_lowering` (§4);
  - `CommonTypes`/`CommonConsts`, which stay lazy (ty-contract decision 3);
  - unifying `DefId_hash_key` in `query/caches.ts` with `DefId_key` (ty-contract "For root").

## unported(...) added by this merge
All are stubs that replace codegen-tyir's stand-in stubs; no behaviour changed:
- the container impls in visit.ts / fold.ts;
- the `debug_Ty` / Ty, ParamEnv, Predicate, Clause traversal stubs;
- `debug_Predicate` / `debug_Clause`;
- the structural_impls.ts, valtree.ts and solve.ts stubs;
- `debug_ParamTy` and `debug_LateParamRegion`.

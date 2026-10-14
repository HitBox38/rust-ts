# Handoff: ty-contract (wave 13, M3): the contract-first skeleton for types (decisions D2–D5)

Branch `lane/ty-contract` (from main 2e11981, no merges). Commits: WIP skeleton; interning + stub files;
D5 maps + interning tests; contract test + marker fixes; this handoff.

## Files
- **New, ported (with markers):**
  - `src/rustc_data_structures/intern.ts`: intern.rs 7/7. The `Interned` base class of every hash-consed class
    (`INTERNED` brand, sequential `id`), `debug_Interned`, `hash_Interned`, `stable_hash_Interned`.
  - `src/rustc_data_structures/sharded.ts`: sharded.rs 8/23, the `ShardedHashMap` interning surface
    (`with_capacity`, `len`, `get`, `get_or_insert_with`, `insert_unique`, `intern_ref`, `intern`,
    `contains_pointer_to`); `InternedSet<K>` = `ShardedHashMap<K, null>`.
  - `src/rustc_middle/ty/list.ts`: list.rs 10/22. `RawList<H, T>` (a frozen `Array` subclass), `List<T>`,
    `ListWithCachedTypeInfo<T>`, `Clauses`, `TypeInfo`, `empty()` / `empty_with_type_info()`, `from_arena`,
    `len`/`as_slice`/`iter`/`flags`/`outer_exclusive_binder`, `debug_RawList`.
  - `src/rustc_type_ir/interner.ts`: interner.rs 111/116. The `Interner` interface (every trait item, with
    markers), `Interner_provided`, `CollectAndApply` + its two impls (`CollectAndApply_T`, `CollectAndApply_Result`).
    Missing: the 5 fns of `impl search_graph::Cx for I` (lane tyir-solve).
  - `src/rust_ts/intern_key.ts` (our own helper): the canonical intern key (see "Representation").
- **New contract files (root-owned after integration):**
  - `src/rustc_type_ir/decls.ts`: the pending rustc_type_ir types (part 1) and the `Region` / `Const` method
    declarations (part 2).
  - `src/rustc_middle/ty/decls.ts`: re-exports of the skeleton types, the pending rustc_middle types, and the
    method declarations of `Ty`, `RawList` (+ `GenericArgs`, `List<PolyExistentialPredicate>`), `Predicate`,
    `Clause`, rustc_middle's `Const` methods, and `TyCtxt` (every ty/ file but context.rs and mod.rs, plus
    `impl Interner for TyCtxt`).
- **New class files with stubs (partial ports):**
  - `src/rustc_type_ir/sty/mod.ts` (`Region`; 1/36), `src/rustc_type_ir/sty/consts.ts` (`Const`; 3/31).
  - `src/rustc_middle/ty/generic_args.ts` (14/60): `GenericArg` = `Ty | Region | Const` with its companion
    (`kind`, `pack`, the four `From`s, `as_*`, `expect_*` ported), `GenericArgs`, stub descriptors.
  - `src/rustc_middle/ty/predicate.ts` (8/61): `Predicate`, `Clause` (twins), `kind`/`flags`/`as_predicate`.
  - `src/rustc_type_ir/flags.ts` (4/25): `FlagComputation` (`new`, `for_clauses`, `add_flags`,
    `add_exclusive_binder` ported; `for_kind`/`for_predicate`/`for_const_kind` stubs).
  - `src/rustc_type_ir/fold.ts` (9/73), `src/rustc_type_ir/visit.ts` (4/74): the D4 descriptor and folder/visitor
    interfaces with markers on the trait declarations; `*_provided` stubs.
- **New stub files** (generated once from the declarations; header says how to fill): `src/rustc_middle/ty/`
  `sty.ts`, `util.ts`, `diagnostics.ts`, `error.ts`, `inhabitedness/mod.ts`, `consts.ts`, `abstract_const.ts`,
  `assoc.ts`, `closure.ts`, `erase_regions.ts`, `fold.ts`, `intrinsic.ts`, `normalize_erasing_regions.ts`,
  `print/pretty.ts`, `trait_def.ts`, `visit.ts`, `context/impl_interner.ts` (6/115: the pre-interned-region
  helpers `get_anon_re_bounds_lifetime`, `get_anon_re_canonical_bounds_lifetime`, `get_re_static_lifetime`,
  `intern_re_var`, `intern_bound_region`, `intern_canonical_bound` are ported).
- **Edited:**
  - `src/rustc_middle/ty/context.ts` (context.rs 41 → 69/202): `CtxtInterners` (`new`, `intern_ty`, `intern_const`,
    `intern_predicate`, `intern_clauses`), the preintern constants, `CommonTypes::new`, `CommonLifetimes::new`,
    `CommonConsts` (stub `new`), `GlobalCtxt.interners` + lazy `types`/`lifetimes`/`consts`, `TyCtxt` getters,
    the `direct_interners!` methods (`intern_region` real, the 7 others stubs naming their class owner), all 14
    `slice_interners!` methods, `mk_predicate`, `reuse_or_mk_predicate`, `mk_ct_from_kind`, `mk_ty_from_kind`,
    `mk_clauses`, `mk_local_def_ids`, all 13 `mk_*_from_iter`, `mk_args_trait`; `mk_poly_existential_predicates`
    is a stub (its `assert!` needs `stable_cmp`). The 45 not-yet-ported `TyCtxt` methods of ty/mod.rs are
    delegating methods in the class body (tyctxt-min decision 6).
  - `src/rustc_middle/ty/mod.ts` (mod.rs 30/150): the `Ty` class (`new` from sty.rs:368, `kind`, `flags`,
    `outer_exclusive_binder`), `Term` = `Ty | Const` with its companion, and the 45 `TyCtxt_<name>` stubs.
  - `src/rustc_middle/lib.ts`: imports the 17 extension stub files after `ty/context.ts`.
  - `src/rustc_span/def_id.ts`: `DefId_key`, `DefIdMap<T>`, `DefIdSet` (D5).
  - `src/rustc_hir_id/lib.ts`: `HirId_key`, `HirIdMap<T>`, `HirIdSet` (D5).
- **Tests:** `src/rustc_middle/ty/interning.test.ts` (16 tests) and `src/rustc_middle/ty/contract.test.ts` (6).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3914 pass, 1 skip (pre-existing), 0 fail.
- `RUST_TS_AGENT=ty-contract bun scripts/difftest.ts --suite parse --sample 100`: 100/100 MATCH (run
  `20261014-012338-ty-contract-axf5`). `--suite resdump-nocore --sample 50` (create_global_ctxt changed): 50/50
  MATCH (run `20261014-012355-ty-contract-3yzg`).
- `bun scripts/coverage.ts --check`: `markers ok (8153; vendor 3664)`.
- Fresh-process loads: `rustc_middle/lib.ts`, `ty/{mod,context,list,generic_args,predicate,decls}.ts`,
  `rustc_type_ir/{sty/mod,interner}.ts` all load as entry points.

## Representation (D2–D5) — the contract every ty lane follows
1. **Hash-consed classes** (`extends Interned`, rustc_data_structures/intern.ts): `Ty` (ty/mod.ts), `Region`
   (rustc_type_ir/sty/mod.ts), `Const` (rustc_type_ir/sty/consts.ts), `Predicate` / `Clause` (ty/predicate.ts).
   One frozen object per distinct value, made only by `CtxtInterners`; equality is `===`; the object is its own
   `Map`/`Set` key. The kind is the `internee` field (frozen with the object); `Ty`/`Const`/`Predicate` carry
   `WithCachedTypeInfo`'s cached info as `flags_` / `outer_exclusive_binder_` (renamed because `impl Flags`
   needs the method names `flags()` / `outer_exclusive_binder()`). `Region` computes its flags (`type_flags`).
2. **`Clause` is `Predicate`'s twin**: both wrap the same interned pointer upstream. Each `Predicate` owns one
   `Clause` made with it; `Clause.of(p)` is `Clause(p.0)`, `clause.as_predicate()` the way back.
3. **Lists**: `RawList<H, T>` extends `Array<T>` and is frozen, so `List<T>` *is* a `readonly T[]`. One shared empty
   list per header (`RawList.empty()` for `()` = `null`, `RawList.empty_with_type_info()` for `TypeInfo`), as the
   upstream statics. `map`/`filter`/`slice` return plain arrays. Lists come only from the slice interners.
4. **`GenericArg` = `Ty | Region | Const`, `Term` = `Ty | Const`** (D3): packing is the identity, `.kind` dispatches
   on the class (`GenericArg.kind(arg)`, `Term.kind(t)`). Their methods are companion functions. The derived
   `Ord` of both compares addresses upstream: nothing may rely on it (none ported does).
5. **Intern keys** (rust_ts/intern_key.ts): the derived `Hash`+`Eq` of a kind as a string. Interned children are
   `#<id>`; numbers, bigints, strings, booleans and `null` by value; arrays element-wise; objects by their own
   fields sorted by name, `undefined` fields skipped. So field order and `{ $: "Anon" }` vs a frozen singleton do not
   matter. `Map`/`Set`/functions inside a key panic. tools/codegen may emit per-type `key_<T>` later (D5); they must
   agree.
6. **Interning entry points**: `tcx.mk_ty_from_kind(kind)` / `Ty.new(tcx, kind)`, `tcx.intern_region(kind)` (plus the
   `intern_re_var`/`intern_bound_region`/`intern_canonical_bound` helpers that reuse the pre-interned regions),
   `tcx.mk_ct_from_kind(kind)`, `tcx.mk_predicate(binder)`, `tcx.mk_clauses(clauses)`, the slice interners
   (`mk_type_list`, `mk_args`, `mk_const_list`, `mk_bound_variable_kinds`, ...) and their `mk_*_from_iter`. The
   `mk_*_from_iter` methods are overload pairs: items `T`, or items `Result<T, E>` with `CollectAndApply_Result` as
   the last argument (`T: CollectAndApply` dispatches on the item type, which TS cannot see).
7. **Common types** (`tcx.types`, `tcx.lifetimes`, `tcx.consts`) are built on first read (see "unported").
8. **D4 descriptors** (rustc_type_ir/fold.ts header): `TypeFoldable<T>` / `TypeSuperFoldable<T>` /
   `TypeVisitable<T>` / `TypeSuperVisitable<T>` / `Flags<T>` / `PredicateProxy<P>` are interfaces of functions over
   `self: T`, one object per Rust impl, named `fold_<T>` (also the visitable descriptor) or `visit_<T>`; generic impls
   are functions from descriptors to descriptors. A generic fn over `T: TypeFoldable` takes `d_T: TypeFoldable<T>`
   last (`// PORT: D4 descriptor`). Folders/visitors stay traits: `TypeFolder`, `FallibleTypeFolder<E>`,
   `TypeVisitor<R>` (with `Result: VisitorResult<R, unknown>` like rustc_ast's `Visitor`); their methods generic
   over a foldable take its descriptor (`fold_binder(t, d)`, `fold_predicate(p, d)`); provided methods live in
   `TypeFolder_provided` / `FallibleTypeFolder_provided` / `TypeVisitor_provided`. Stub descriptors exist for
   `Region`, `Const`, `Term`, `GenericArg`, `GenericArgs`, `List<Ty>`.
9. **`Interner`** (rustc_type_ir/interner.ts header): `I` erased everywhere; the header table fixes every associated
   type. Methods whose name `TyCtxt` already uses for an *incompatible* inherent method or query are `ir_<name>`
   (`ir_is_direct_const`, `ir_const_of_item`, `ir_recursion_limit`, `ir_clauses_of`, `ir_const_conditions`,
   `ir_explicit_implied_const_bounds`, `ir_for_each_relevant_impl`, `ir_evaluate_root_goal_for_proof_tree_raw`);
   `inherent::Ty::new_param` likewise is `Ty.ir_new_param`. Compatible collisions are served by the
   inherent method / query (comment lines in decls.ts). `R: VisitorResult` parameters take the impl object.
10. **D5 maps**: `DefIdMap<T>` / `DefIdSet` (rustc_span/def_id.ts, key `krate * 2^32 + index`) and `HirIdMap<T>` /
    `HirIdSet` (rustc_hir_id/lib.ts, key `owner * 2^32 + local_id`) are `KeyedMap`/`KeyedSet` subclasses: they are
    `Map`s/`Set`s, compare by value, keep insertion order, and panic if a key is not an exact JS integer.
    `LocalDefIdMap` stays `Map<LocalDefId, _>`.

## How to fill a stub
1. **Find the declaration.** Every method of `Ty`, `RawList` (incl. `GenericArgs` / `List<PolyExistentialPredicate>`),
   `Predicate`, `Clause`, `Const`, `Region` and `TyCtxt` that an upstream ty file defines is declared in
   `src/rustc_middle/ty/decls.ts` or `src/rustc_type_ir/decls.ts` under `// <file>:<line>`, grouped by file in upstream
   order; statics are in the `namespace` blocks. These are root's: do not change a signature. If you must, add a local
   `declare module "<path>/decls.ts"` in your file marked `// PORT(decls): pending root` and note it in your handoff.
2. **Methods.** In the TS file mirroring the upstream file, write
   `Ty.prototype.is_bool = function (this: Ty): boolean { .. }` (statics: `Ty.new_bool = function (tcx: TyCtxt): Ty
   { .. }`) with the `// rustc:` marker above it, in upstream order, and delete the name from that file's
   `unported_methods(..)` list; delete the call when the list is empty. A static named `new` is a `static` in the
   class body (`Const.new` stub in sty/consts.ts): fill it in place.
3. **Free fns, types, other impls** of the upstream file are *not* stubbed: write them in the same file. Trait impls
   that are not methods go where the comment line in decls.ts says (D4 descriptor `fold_<T>`, `debug_<T>`,
   `decode_<T>`, `relate_<T>`, `<T>_into_diag_arg`, `upcast_*`).
4. **ty/mod.rs `TyCtxt` methods** follow tyctxt-min decision 6: the delegating method is already in the `TyCtxt`
   class (context.ts); fill the `TyCtxt_<name>` stub at the end of mod.ts in place (and move it into upstream order
   among the ported fns), marker above it.
5. **context.rs** is lane ty-ctxt's: it adds methods directly to the `TyCtxt` class body. Fourteen `Interner`
   methods are served by such inherent methods and are missing until then (contract.test.ts pins the list:
   `next_trait_solver_globally`, `check_alias_term_args_compatible`, `debug_assert_args_compatible`,
   `debug_assert_alias_term_args_compatible`, `assumptions_on_binders`, `renormalize_rigid_aliases`,
   `coroutine_movability`, `is_default_trait`, `is_sizedness_trait`, `is_impl_trait_in_trait`,
   `is_general_coroutine`, `coroutine_is_async`, `coroutine_is_gen`, `coroutine_is_async_gen`); update the pin as
   they land.
6. **Pending types.** Types not ported yet are `Pending<"Name">` (opaque) or `PendingEnum<"Name">` (any `{ $, .. }`)
   aliases in the decls files. Use them; don't redefine them. When a type lands, root replaces its alias with a
   re-export of the real type.
7. **Keep contract.test.ts green**: its counts change only when declarations change (root).

## Init order
- Defining modules: ty/mod.ts (`Ty`), ty/list.ts, ty/generic_args.ts, ty/predicate.ts, ty/context.ts, rustc_type_ir
  sty/{mod,consts}.ts, flags.ts, interner.ts. They must **never import an extension module**.
- Extension modules (the 17 stub files above and every file that assigns to a prototype of a class defined
  elsewhere) are loaded by `src/rustc_middle/lib.ts` after `./ty/context.ts`. Their top-level code may touch only
  the classes they import, never another extension module. A new extension file must be added to lib.ts.
- `unported_methods` on `TyCtxt.prototype` must never install a query or hook name (`define_query_api` /
  `define_hooks` panic on a clash): decls.ts lists those as comment lines.
- Consumers outside rustc_middle import `src/rustc_middle/lib.ts` (or the defining modules for types only).

## PORTING §5 amendment (D2) — text for root to apply
Replace the paragraph "### Interned handles" with:

> ### Interned handles
> `Symbol`, `NodeId`, `DefIndex`, `CrateNum`, `LocalDefId`, `ItemLocalId`, `newtype_index!` types and `Span` →
> branded numbers (`type Symbol = number & { readonly __brand: "Symbol" }`) indexing interners owned by the session
> globals. Equality is `===`, maps key on them directly. `newtype_index!` types get `from_u32`/`as_u32`/`as_usize`/
> `MAX`/`ZERO` helpers on a companion const; the generated Debug output must match upstream's (often a custom
> format, e.g. `NodeId(4294967040)`).
>
> **Hash-consed type-system values** (`Interned<'tcx, T>` and the lists): `Ty`, `Region`, `Const`, `Predicate`/
> `Clause`, `ValTree`, `Pattern`, `AdtDef`, ... and `&'tcx List<T>` are **frozen class instances, unique per
> value**, made only by the `CtxtInterners` of `TyCtxt` (rustc_middle ty/context.ts). Each extends
> `rustc_data_structures/intern.ts`'s `Interned` (lists: `RawList`, a frozen `Array` subclass, so a `List<T>` is a
> `readonly T[]`) and carries a sequential `id` used only inside intern keys. Equality is `===`, `Map`/`Set` key on
> the object, methods live on the prototype (`ty.kind()`); `Interned` has no `Ord`, so nothing orders on them.
> Interning looks the value up by its canonical key (rust_ts/intern_key.ts: the derived `Hash`+`Eq` as a string,
> interned children by `id`). Packed pointers (`GenericArg`, `Term`) are unions of the objects (`Ty | Region |
> Const`), dispatched with `instanceof`. Multi-field ids (`DefId`, `HirId`) stay small immutable classes; as map
> keys use `DefIdMap`/`DefIdSet` (rustc_span) and `HirIdMap`/`HirIdSet` (rustc_hir_id), keyed
> `krate * 2^32 + index` / `owner * 2^32 + local_id`; other composite keys use `KeyedMap`/`KeyedSet` with a key
> function (generated `key_<T>` or `intern_key`).

## `unported(...)` left (reachable from the skeleton)
- `FlagComputation::for_kind` / `for_const_kind` / `for_predicate` (flags.rs, lane tyir-kind): so **interning a
  `Ty`, `Const` or `Predicate` stops as UNPORTED** until tyir-kind lands, and so does `tcx.types` (`CommonTypes::new`
  interns types). `tcx.lifetimes`, regions and lists of regions / non-type values work today.
- `CommonConsts::new` (needs `ValTree` + `ScalarInt::TRUE/FALSE`, lane ty-results): `tcx.consts`.
- `direct_interners!` methods whose class is not ported: `intern_valtree`, `mk_pat`, `mk_const_alloc`,
  `mk_layout`, `mk_adt_def_from_data`, `mk_external_constraints`, `intern_canonical_input`.
- `mk_poly_existential_predicates` (and so `mk_poly_existential_predicates_from_iter`): `stable_cmp`.
- Every stub method listed in the decls files (≈400) and the `TyCtxt_<name>` stubs of mod.ts (45); the stub
  descriptors and `debug_*` of `Region`, `Const`, `Term`, `GenericArg`, `GenericArgs`, `List<Ty>`; the
  `*_provided` folder/visitor methods; `RawList.from_vars`.
- Nothing is wired into a driver path: `GlobalCtxt` builds the (empty) `CtxtInterners` eagerly and nothing else.

## PORT decisions (please record)
1. D2 representation as above (Interned base class with `id`; `RawList` as frozen `Array` subclass; `Clause` twin of
   `Predicate`; `flags_` / `outer_exclusive_binder_` field renames; kinds frozen with their object).
2. Intern keys are the generic structural `intern_key` (rust_ts/intern_key.ts), not generated `key_<T>`; codegen may
   replace it per type if it agrees.
3. `CommonTypes` / `CommonLifetimes` / `CommonConsts` are built on first read of `tcx.types` / `lifetimes` /
   `consts` instead of in `create_global_ctxt` (eager construction would make every run UNPORTED until
   `FlagComputation` lands; output-neutral). Root may switch to eager once tyir-kind and ty-results land.
4. Contract layout: `rustc_type_ir/decls.ts` + `rustc_middle/ty/decls.ts` (pending types + method declarations,
   generated once from upstream signatures and hand-corrected), one stub file per upstream file installing
   `unported_methods`, extension modules loaded by rustc_middle/lib.ts; statics via `namespace` augmentation,
   `new` as a class `static`.
5. `Interner` method name collisions: `ir_<name>` for incompatible ones (list above), the inherent method / query
   serves compatible ones; `inherent::Ty::new_param` is `Ty.ir_new_param`.
6. `CollectAndApply` is two descriptor objects and `mk_*_from_iter` are overload pairs (item type invisible to TS).
   The upstream stack specialisation for ≤8 items is dropped (same slice, same stop at the first `Err`).
7. `ShardedHashMap` is single-shard; its hash table is a `Map<string, [K, V]>` keyed by the caller-supplied canonical
   key; capacities are dropped. `Interned::hash` writes the `id` (no address in JS).
8. `TyCtxt` methods of ty/mod.rs not yet ported: delegating class methods + `TyCtxt_<name>` stubs (decision 6),
   because mod.ts is imported by context.ts and cannot assign to `TyCtxt.prototype` at load.
9. D5 key functions panic (ICE) instead of silently colliding if a `CrateNum` / owner index reaches 2^21.

## For root
- **Coordination with codegen-tyir** (same wave): the generated rustc_type_ir enums must keep the PORTING §5 shapes
  this skeleton already constructs: `TyKind` `{ $: "Infer", _0: InferTy }`, `{ $: "Bound", _0: BoundVarIndexKind,
  _1: BoundTy }`, `{ $: "Tuple", _0: List<Ty> }`, `{ $: "Int", _0: IntTy }`, `{ $: "Param", _0: ParamTy }`, unit
  variants `{ $: "Bool" }`; `InferTy` `{ $: "TyVar", _0 }`, `{ $: "FreshTy", _0 }`, ...; `RegionKind`
  `{ $: "ReVar", _0 }`, `{ $: "ReBound", _0, _1 }`, `{ $: "ReStatic" }`, `{ $: "ReErased" }`; `BoundVarIndexKind`
  `{ $: "Bound", _0 }` / `{ $: "Canonical" }`; `BoundRegion`/`BoundTy` `{ var, kind }`; `BoundRegionKind`/`BoundTyKind`
  `{ $: "Anon" }`; `Binder<T>` `{ value, bound_vars }`. Interned children must be typed with this lane's classes
  (`Ty` from rustc_middle/ty/mod.ts, `Region`/`Const` from rustc_type_ir/sty, `List` from rustc_middle/ty/list.ts,
  `GenericArg`/`GenericArgs` from rustc_middle/ty/generic_args.ts). Then replace the `Pending*` aliases in
  `rustc_type_ir/decls.ts` with re-exports, and drop the then-unneeded `TypeFlags_empty` / `INNERMOST` constants in
  favour of the generated ones (decls.ts can re-export them).
- If codegen-tyir also creates hand files `rustc_type_ir/{fold,visit,flags,interner}.ts` or `sty/*.ts`, merge into
  these (they hold the contract).
- `src/rustc_middle/query/caches.ts` `DefId_hash_key` duplicates `DefId_key` (rustc_span); unify when convenient.
- New helper `src/rust_ts/intern_key.ts` (outside the brief's listed paths, by necessity) — please review.
- Wave-15 lanes: point ty-ctxt, ty-mod-*, ty-sty, ty-args, ty-util, ty-adt-assoc, ty-print-*, ty-results at
  "How to fill a stub" and "Init order"; tyir-* lanes at the decls.ts headers and the D4 notes in fold.ts.

# Handoff: ty-util (M3, wave 15): rustc_middle ty/util.rs

Branch `lane/ty-util` (from `ab2cdfc`, no merges). Commits: the util.rs port + `typeck` repoint + contract probe; type
markers + `util.test.ts`; this handoff.

## Files touched
- `src/rustc_middle/ty/util.ts` (util.rs): rewritten from the contract stub as the full port, upstream order. Both
  `unported_methods(..)` stub lists are gone.
  - Types: `Discr` (class; `wrap_incr` / `checked_add` on the prototype, `display_Discr` (:64), `debug_Discr`),
    `CheckRegions` (string union + companion, `debug_CheckRegions`), `NotUniqueParam` (`{ $, _0 }`,
    `debug_NotUniqueParam`), `AlwaysRequiresDrop` (unit struct as its name, like `FoundFlags`), `IntTypeExt`
    companion (`to_ty`, `initial_discriminant`, `disr_incr`).
  - Every `impl TyCtxt` fn (:136..:954) on `TyCtxt.prototype`, every `impl Ty` fn (:1106..:1507) on `Ty.prototype`.
  - `OpaqueTypeExpander` / `FreeAliasTypeExpander` as `TypeFolder` classes (provided methods delegate to
    `TypeFolder_provided`).
  - Free fns: `needs_drop_components(_with_async)`, `fold_list`, `try_fold_list`, `reveal_opaque_types_in_bounds`,
    `is_doc_hidden`, `is_doc_notable_trait`, `intrinsic_raw`, `provide`.
- `src/rustc_middle/query/calls.ts`: `TyCtxtEnsureOk::typeck` and `TyCtxt_typeck` now run upstream's body
  `self.typeck_root(self.typeck_root_def_id(def_id.into_query_key().to_def_id()).expect_local())` instead of the
  `unported` stand-in (brief: "replace it with the real one").
- `src/rustc_middle/ty/contract.test.ts` (ty-contract's, sanctioned as in ty-ctxt): the "a stub stops as UNPORTED"
  probe used `typeck_root_def_id_local` (ported now); it uses `expand_abstract_consts` (ty/abstract_const.rs stub).
- New `src/rustc_middle/ty/util.test.ts` (15 tests).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_middle/src/ty/util.rs`: **78/78 ported**.
- `bun scripts/coverage.ts --check`: `markers ok (11130; vendor 3888)`.
- Type markers (`rustc-type` / `rustc-trait`) sit on the `struct` / `enum` / `#[extension]` lines.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_middle`: 75 pass before util.test.ts; util.test.ts 15 pass.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4307 pass, 1 skip, 0 fail.
- Fresh-process loads: `ty/util.ts` and `query/calls.ts` load as entry points; `rustc_middle/lib.ts` loads.
- `RUST_TS_AGENT=ty-util --sample 200`:
  - hir-tree-nocore: 198 MATCH / 0 DIFF / 2 UNPORTED (`20261014-065819-ty-util-oq9z`)
  - hir-tree: 198 / 0 / 2 (`20261014-065905-ty-util-cq3e`)
  - unpretty-hir: 198 / 0 / 2 (`20261014-065940-ty-util-alp0`)
  - expanded: 200 / 0 / 0 (`20261014-070016-ty-util-oyci`)
  - All UNPORTED are the known `TyCtxt::is_method` stop (delegation/generics/*), as in merge-w15a.

## Tests (`ty/util.test.ts`)
`is_trivially_{freeze,unpin,not_async_drop}`, `peel_refs`, `is_structural_eq_shallow`, `needs_drop_components`
(primitives, tuples, params, slices, `Error` sync vs async), `needs_drop` / `has_significant_drop` trivial paths,
`uses_unique_generic_params` (unique / duplicate / not-param / region modes), `is_typeck_child` +
`typeck_root_def_id(_local)` over closures and inline vs. non-inline anon consts, `res_generics_def_id`,
`def_kind_descr(_article)` (coroutine kinds, methods, DefKind fallback), `closure_env_ty`, `static_mutability`,
`fold_list` (identity keeps the list, a change interns a new one), UNPORTED (not TypeError) at layout, Debug.

## `unported(...)` left (all at a dependency; the util.rs logic itself is complete)
- **Layout / rustc_abi (M4)**: `IntegerExt::from_int_ty` / `from_uint_ty` / `to_ty`, `FloatExt::from_float_ty`
  (ty/layout.rs); `Integer::size`, `Float::size`, `Size::{sign_extend, truncate, signed_int_min, signed_int_max,
  unsigned_int_max}` (rustc_abi lib.rs, not in rustc_abi/lib.ts). So `primitive_size`, `int_size_and_signed`,
  `Discr::checked_add` / `wrap_incr` / `Display`, `IntTypeExt::to_ty` (Fixed) and the int arm of
  `numeric_min_and_max_as_bits` stop there.
- **rustc_apfloat**: the four float `INFINITY.to_bits()` arms of `numeric_min_and_max_as_bits`.
- **MIR (M4)**: `mir::Const::from_bits` (`numeric_max_val` / `numeric_min_val`).
- **StableHash of `ty::Ty`** under `while_hashing_spans`: `type_id_hash`.
- **middle/codegen_fn_attrs.rs**: `CodegenFnAttrFlags::THREAD_LOCAL` (`is_thread_local_static`).
- **ty-mod**: `TypingEnv::fully_monomorphized`.
- **ty-adt-assoc**: `AdtDef::{is_struct, non_enum_variant, did, destructor, all_fields}`, `VariantDef::tail_opt`,
  `FieldDef::ty`, `FieldDef.safety` (struct tails, dtors, `destructor_constraints`, `has_unsafe_fields`).
- **ty-args**: `Generics::{region_param, type_param, const_param}` (`destructor_constraints`).
- **middle-traits-thir**: `ObligationCause::dummy` (`struct_tail_for_codegen`).
- **Visit of `(Ty, Ty)`** (`fold_Ty_Ty.visit_with`, only reached by `assert_fully_normalized` in
  `struct_lockstep_tails_for_codegen` if that visits).

## Stand-ins (bottom of util.ts; root repoints them when the owner lands)
Upstream bodies (field reads / struct literals): `TypingEnv_as_query_input` (`PseudoCanonicalInput { typing_env,
value }`), `Asyncness` + `Asyncness_is_async`, `HasAttrs_DefId_get_attrs` / `HasAttrs_LocalDefId_get_attrs` (same as
context.ts's), `AssocItem_is_method` (same as context.ts's), `ObligationCause_span`. Views: `DestructorView`,
`AsyncDestructorView`, `IntrinsicDefView`, `IntegerType` (rustc_abi enum in PORTING §5 shape). Everything else in the
list above is `unported`.

## For root
1. **decls.ts aliases**: replace `Discr`, `CheckRegions`, `NotUniqueParam` (`Pending`) with re-exports from
   `./util.ts`. Then the `as unknown as TyCtxt["uses_unique_generic_params"]` cast in util.ts can go.
2. **`struct_tail_raw` declaration** drops upstream's 4th parameter `f: impl FnMut()`. util.ts adds a
   `// PORT(decls): pending root` overload with `f: () => void`, and the implementation defaults `f` to `() => {}` (the
   value every caller but const_eval valtrees.rs passes). Please add `f` to the declaration (optional or required).
3. **`has_unsafe_fields`**: util.ts assigns `Ty.prototype.has_unsafe_fields` (util.rs:1275, the inherent body). The
   `impl inherent::Ty` method (sty.rs:1122, `Ty::has_unsafe_fields(self)`) is the same TS method. ty/sty.ts's stub list
   still names it; util.ts loads after sty.ts, so the real body wins. If lane ty-sty also assigns it, keep util.ts's
   body and give sty.rs:1122 a marker + "served by" line.
4. **Wiring `provide`**: `rustc_interface/passes.ts` does not call `ty::util::provide` yet (it is part of
   `ty::provide`, ty/mod.rs:2377). Adding `ty_util.provide(providers.queries)` next to `ty_context_provide` /
   `ty_print_provide` installs `reveal_opaque_types_in_bounds`, `is_doc_hidden`, `is_doc_notable_trait` and
   `intrinsic_raw` (the last is needed by context.ts's `TyCtxt::intrinsic`). Not done here (passes.ts is not this
   lane's).
5. **`fold_list` / `try_fold_list` signature** for ty-args (generic_args.rs) and ty-results (structural_impls.rs):
   `fold_list(list, folder, intern, d_T, eq_T = ===)`. `eq_T` is `T: PartialEq`; pass a structural eq for
   `List<PolyExistentialPredicate>` (a `Binder`, not interned).
6. `opt_alias_variances` takes `AliasTermKind` as declared; `impl Into<AliasTermKind>` callers convert first.

## PORT decisions (please record)
1. `Discr` is a class whose methods are assigned to the prototype after `display_Discr` (keeps upstream order:
   Display :64 comes before `impl Discr` :80).
2. `GrowableBitSet<u32>` in `uses_unique_generic_params` is a `Set<number>`; `seen_late` a `KeyedSet` over
   `intern_key`; `expanded_cache` a `KeyedMap<[DefId, GenericArgs], Ty>` over `intern_key`; `seen_opaque_tys` a
   `DefIdSet`.
3. `Discr::checked_add` uses release (wrapping) `i128`/`u128` arithmetic (`BigInt.asIntN/asUintN(128, ..)`): rustc
   ships without overflow checks.
4. `fold_list` / `try_fold_list` take the D4 descriptor `d_T` and a `T: PartialEq` function `eq_T` (default `===`).
5. Pending `SizedTraitKind` (ty/decls.ts) is passed as rustc_type_ir's `"Sized"` with a cast in `Ty::is_sized`.
6. Query values typed `unknown` in queries.gen.ts (`type_of`, `anon_const_kind`, `coroutine_kind`, `extern_crate`,
   `variances_of`, `generics_of`, `associated_item`) are cast at the call.

## Results
- full `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4307 pass, 1 skip (pre-existing linux-only), 0 fail (4308 tests, 255 files). tsc clean after the `sym.Abi` fix in util.test.ts (commit `973227f`).

# Handoff: tyir-kind (wave 14, M3): rustc_type_ir ty_kind (+closure), flags, region_kind, const_kind, term_kind

Branch `lane/tyir-kind` (from main 935a15a, no merges). Commits: flags + ty_kind; region_kind/const_kind/term_kind/closure;
tests; this handoff.

## Files touched
- `src/rustc_type_ir/flags.ts`: `FlagComputation` complete (for_kind, for_predicate, for_const_kind, add_*). Interning a
  `Ty`, `Const`, `Predicate` now works, and so does `tcx.types` (`CommonTypes::new`).
- `src/rustc_type_ir/ty_kind.ts`: every fn and manual impl of ty_kind.rs, plus the PORT stand-ins listed below.
- `src/rustc_type_ir/ty_kind/closure.ts`: every fn of closure.rs, plus the two working structs `HasRegionsBoundAt` and
  `FoldEscapingRegions`.
- `src/rustc_type_ir/region_kind.ts`, `const_kind.ts`, `term_kind.ts`: every fn and manual impl.
- New test `src/rustc_type_ir/tyir_kind.test.ts` (13 tests, 227 expects).
- One edit outside my files: `src/rustc_middle/ty/interning.test.ts` (ty-contract's).
  - Its test "an unported FlagComputation makes interning UNPORTED" pinned the stub state that this lane removes.
  - It is now "the real FlagComputation computes the flags while interning" (`Never` has empty flags at `INNERMOST`).
- No `.gen.ts`, decls, contract or other ported files were edited.

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| file | ported |
|---|---|
| ty_kind.rs | 99/99 (1 rustc-skip: :858 StableHash for InferTy) |
| ty_kind/closure.rs | 39/39 |
| flags.rs | 25/25 |
| region_kind.rs | 2/2 (1 rustc-skip: :228 StableHash for RegionKind) |
| const_kind.rs | 11/11 (1 rustc-skip: :195 StableHash for InferConst) |
| term_kind.rs | 26/26 |

The skips use the precedent text "StableHash impl (incremental, M5)".

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3998 pass, 1 skip (the pre-existing linux-only one), 0 fail.
- `bun scripts/coverage.ts --check`: `markers ok (8842; vendor 3888)`.
- `RUST_TS_AGENT=tyir-kind bun scripts/difftest.ts --suite expanded --sample 100`: 100/100 MATCH, 0 UNPORTED (run
  `20261014-025529-tyir-kind-2bpi`).
- Fresh-process `import()`: every `.ts` under `rustc_type_ir/`, `rustc_middle/ty/` and `rustc_middle/traits/` loads as
  an entry point, with one exception. `ty_kind.gen.ts` fails as an entry point with a TDZ error. It imports
  `debug_FnSigKind` from `ty_kind.ts`, which spreads the generated companions (`...gen.TyKind`). `hir.gen.ts` behaves
  the same way today, so I treated it as precedent. Nothing imports a `.gen.ts` directly except its own hand module;
  `closure.ts` imports from `../ty_kind.ts`.

## Tests (`tyir_kind.test.ts`)
- **Interning.** Each of these simple `TyKind`s interns to a single object:
  - Bool, Char, Int, Uint, Float, Str, Never, Foreign;
  - Tuple (empty and mixed), Slice, Array (with an inference const), RawPtr;
  - Param, Infer (×4), Bound (canonical), Placeholder, Error;
  - Closure, Coroutine, FnDef;
  - Alias (rigid/opaque and non-rigid/projection), UnsafeBinder.

  Each kind's `TypeFlags` is checked.
- **Oracle values.** These match the oracle:
  - flags and `outer_exclusive_binder` for FnPtr under a binder (with and without bound vars, escaping and captured);
  - Const kinds;
  - one Predicate through `bound_computation`.
- **Unported path.** `Ref` stops as UNPORTED, because `Region::flags` is still stubbed.
- **`tcx.types`.** It constructs, and its flags and outer_exclusive_binder values match the oracle.
- **Debug/Display against the oracle.** Both `{:?}` and `{:#?}` are checked:
  - `TyKind` leaves (17 kinds);
  - `InferTy` Debug and Display;
  - `FnSigKind`: safe/unsafe, C-variadic, splatted, `C`/`C-unwind`/`RustCall`/`System`;
  - `FnSig`, including `unsafe extern "C { unwind: false }" fn(...)`;
  - `SplattedArgIndexError`;
  - `RegionKind` leaves, `ConstKind` leaves and `InferConst`.
- **Helpers:** int/float var unification and the `AliasTyKind`/`AliasTermKind` helpers.
- **Mocked dependency.** The test mocks `RawList.prototype.inputs` / `output` with upstream's one-liners
  (`split_last().unwrap()`). Their real port is `impl inherent::Tys for &List<Ty>` (rustc_middle ty/sty.rs:2180, lane
  ty-sty), which is still a stub. `debug_FnSig` needs them.

## `unported(...)` left
- **Inside my files: dependencies on types that are not ported yet.**
  - flags.rs:
    - `add_ty_pat` (Flags for rustc_middle `Pattern`);
    - the `ConstKind::Value` arm of `add_const_kind` (`ty::Value` / `ValTree`, lane ty-results).
  - ty_kind.rs:
    - `TyKind::unnormalized_fn_sig`: the `FnDef` arm (`EarlyBinder::instantiate`, `Binder::no_bound_vars`) and the
      `Error` arm (`Binder::dummy`), both lane tyir-binder;
    - `debug_TyKind`: the `Adt` arm (Debug for `AdtDef`) and the `Pat` arm (Debug for `Pattern`).
  - const_kind.rs:
    - `debug_ConstKind`: the `Param`, `Value` and `Expr` arms (rustc_middle Debug impls);
    - `AliasConst::type_of` (`EarlyBinder::instantiate`).
  - closure.rs stand-ins that call `unported`:
    - `TypeVisitableExt::has_vars_bound_at_or_above`;
    - `TypeSuperFoldable for Ty` (`super_fold_with`);
    - `fold::shift_region`;
    - `DelayedMap` get/insert.
- **Reached at runtime through other lanes' stubs (not mine):**
  - `Region::flags` (rustc_type_ir sty/mod.rs, a `unported_methods` stub). Interning `Ref`, `Dynamic`, or any
    `GenericArgs` / predicate containing a region stops as UNPORTED.
  - `RawList` `inputs`/`output`/`type_at`/`split_*_args` and `Ty` `tuple_fields`/`to_opt_closure_kind`/`new_*`
    (ty-sty, ty-args).
  - `Const::new_alias`.
  - `debug_Ty`, `debug_Region`, `debug_Const`, `debug_GenericArg`, `debug_BoundTy`, `debug_BoundRegion`,
    `debug_Placeholder`, `debug_ParamTy`, `debug_EarlyParamRegion`, `debug_LateParamRegion`, and the `bound_vars` field of
    the generated `debug_Binder`.
- **Not UNPORTED: a TypeError.** `tcx.debug_assert_alias_term_args_compatible` and `tcx.next_trait_solver_globally` are
  two of the 14 Interner methods that `TyCtxt` does not have yet (contract.test.ts pins them; lane ty-ctxt). Until they
  exist, these calls raise a TypeError instead of UNPORTED:
  - `ProjectionAliasTy.new_projection_from_args`, `InherentAliasTy.new_inherent_from_args`,
    `OpaqueAliasTy.new_opaque_from_args`, `FreeAliasTy.new_free_from_args`;
  - `IsRigid.yes_if_next_solver`.

  **Root:** either ty-ctxt lands them, or `unported_methods` is installed for those names.

## PORT decisions (please record)
1. **Where methods live.**
   - Methods of generated enums go on their companion const, which spreads the generated one (PORTING §8):
     `TyKind`, `IsRigid`, `IntVarValue`, `FloatVarValue`, `AliasTyKind`, `AliasConstKind`, `ValTreeKind`,
     `AliasTermKind`.
   - Methods of generated structs and `Alias<K>` instances go on a same-named companion const that takes `self` first:
     - `FnSigKind`, `FnSig`, `FnSigTys`, `FnHeader`, `UnsafeBinderInner`;
     - `AliasTy`, `ProjectionAliasTy`, `InherentAliasTy`, `OpaqueAliasTy`, `FreeAliasTy`, `AliasConst`, `AliasTerm`;
     - `ClosureArgs`, `CoroutineClosureArgs`, `CoroutineClosureSignature`, `CoroutineArgs`.
   - The value `AliasTy` lives in ty_kind.ts; its type stays in ty/alias.ts.
   - The impls on `Binder<FnSig>` and `Binder<FnSigTys>` are the companions `PolyFnSig` and `PolyFnSigTys`.
   - In `AliasTy`, the second `impl AliasTy` block (ty_kind.rs:586–623) sits in the same object after
     `ProjectionAliasTy`'s block. Markers keep the upstream lines (§8, the class-body rule applied to companions).
2. **Naming.**
   - `From` impls are named after the source type: `UnsafeBinderInner.from_Binder` / `into_Binder`,
     `AliasTermKind.from_AliasTyKind` / `from_AliasConstKind`, `AliasTerm.from_AliasTy` / `from_AliasConst`.
   - `impl Deref for UnsafeBinderInner` is the free fn `UnsafeBinderInner_deref`.
   - `impl Default for FnSigKind` is `FnSigKind.default_()`.
   - The ena impls are `UnifyValue_IntVarValue`, `UnifyKey_IntVid`, `UnifyValue_FloatVarValue` and `UnifyKey_FloatVid`
     (the vendor/ena dictionary shape).
3. **Interner parameter type (D3).** `interner: I` is typed `TyCtxt` where the body calls rustc_middle inherent API
   (`Ty.new_*`, `mk_args_from_iter`), and `Interner` where it only calls trait methods (`projection_parent`,
   `trait_ref_and_own_args_for_alias`, `def_span`, `ir_is_direct_const`, `next_trait_solver_globally`,
   `debug_assert_alias_term_args_compatible`).
4. **`I::Safety`.** `I::Safety::safe()` / `unsafe_mode()` are `hir::Safety` `"Safe"` / `"Unsafe"`, and `.is_safe()` /
   `.prefix_str()` are `Safety.is_safe` / `Safety.prefix_str`. This is the trivial
   `impl inherent::Safety for hir::Safety` (rustc_middle ty/context.rs:91, lane ty-ctxt).
5. **Debug and formatter options.** `write!(f, "{:?}", x)` inside a manual Debug formats `x` with fresh options, so those
   operands use `PLAIN`; `f.debug_tuple` and `f.write_str` keep `f`. The `{:#?}` oracle cases confirm this.
6. **`cfg!(debug_assertions)` blocks** in `AliasTy::new_from_args`, `AliasConst::new` and `AliasTerm::new_from_args` are
   commented out, because the oracle is a release build. `debug_assert_matches!` / `debug_assert!` stay as comments
   (PORTING §3). The unconditional `interner.debug_assert_alias_term_args_compatible(..)` calls in
   `new_{projection,inherent,opaque,free}_from_args` are kept.
7. **Stand-ins for fns of other files that are not ported yet.** They are not markers; each has a PORT comment.
   - **ty_kind.ts (exported):**
     - `DebruijnIndex_shifted_in` / `DebruijnIndex_shifted_out` (lib.rs:189 / :204);
     - `debug_bound_var` (lib.rs:240);
     - `Binder_skip_binder` / `Binder_map_bound` (binder.rs);
     - `Unnormalized_new` (module-local; unnormalized.rs `new_wip` / `dummy`).

     The `skip_normalization` / `bound_vars` / `skip_binder` reads in flags.ts and ty_kind.ts are field reads.
   - **closure.ts (module-local):**
     - `Binder_super_visit_with` / `Binder_super_fold_with` (binder.rs one-liners, upstream bodies);
     - `Ty_has_vars_bound_at_or_above`, `Ty_super_fold_with`, `shift_region` and `DelayedMap`, which call `unported`.

   **Root:** repoint these at the real ports when lib.rs, binder.rs, unnormalized.rs, fold.rs, visit.rs and
   data_structures land (tyir-binder / tyir-misc).
8. **Overload for `RawList.inputs` / `output` (PORT(decls)).** ty_kind.ts adds a local `declare module` overload
   `this: List<Ty>`. **Root:** fix the declaration in rustc_middle/ty/decls.ts (ty/sty.rs:2181 / :2185). It says
   `this: List<PolyExistentialPredicate>`, but the impl is on `&List<Ty>`; then drop my overload.
9. **Private methods are public.** The private `FlagComputation` methods are public, because the `bound_computation`
   closures must reach them. Nothing outside flags.ts calls them.
10. **Intern key fields.** `FnSigKind` keeps the generated fields (`flags`, `splatted`, `_marker: undefined`). The `set_*`
    methods return a modified copy (`mut self` by value).

## For root
- `tcx.types` can now be built. ty-contract decision 3 (lazy `CommonTypes`) can switch to eager, once `CommonConsts` /
  `ValTree` also land.
- The `FlagComputation` spies in `rustc_middle/ty/interning.test.ts` (ty-contract) are no longer needed. That file is not
  mine, so I left it as is.
- The decls.ts fix in decision 8, and the stand-ins in decision 7.
- The 14 missing `TyCtxt` Interner methods: see the TypeError note above.

## Oracle probe (for the expectations in tyir_kind.test.ts)
A throwaway rustc-dev program, not added to `tools/probes`. Lanes may not edit tools/; root may adopt it as a probe.

To build and run it:
```
rustc +nightly --edition 2024 -O main.rs -o probe -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
./probe
```
It needs an empty `/tmp/tyirk-probe/empty.rs`.

What it does:
- `rustc_driver::compiler_entrypoint` with an `after_expansion` callback.
- In the callback it builds the values with the real `TyCtxt` and `rustc_type_ir` types:
  - `ir::TyKind::<TyCtxt>::{Bool, Char, Int(..), .., Infer(..), Error(unchecked_error_guaranteed())}`;
  - `ir::FnSigKind::{dummy, default, new(..)}`;
  - `ir::FnSig { inputs_and_output: tcx.mk_type_list(&[tcx.types.unit]), .. }`;
  - `ir::RegionKind::{ReStatic, ReVar(5), ReErased, ReError}`;
  - `ir::ConstKind::{Infer(..), Error}`;
  - `Ty::new_fn_ptr(tcx, Binder::bind_with_vars(sig, vars))`, `Ty::new_tup` / `new_slice` / `new_ptr` /
    `new_error` / `new_coroutine`, and `Const::new_var`.
- It prints them with `{:?}`, `{:#?}` and `{}`, plus `flags()` / `outer_exclusive_binder()` through
  `rustc_type_ir::Flags`. The output lines are copied verbatim into the test.

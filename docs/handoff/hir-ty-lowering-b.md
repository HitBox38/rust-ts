# Handoff: hir-ty-lowering-b (wave 16, M3): rustc_hir_analysis hir_ty_lowering/mod.rs lines 2186..3915

Branch `lane/hir-ty-lowering-b` (from `5171055`, the hirtylowerer-contract tip; no merges).

## Files touched
- `src/rustc_hir_analysis/hir_ty_lowering/mod.ts`: only the `// ---- lane hir-ty-lowering-b imports ----` block and the
  region `// ==== lane hir-ty-lowering-b: mod.rs:2186..3915 ====` (now the end of the file). The region's
  `unported_methods(..)` call is gone: all 25 `impl dyn HirTyLowerer` methods of 2186..3915 are ported in upstream order
  with markers, as `HirTyLowerer.prototype.<name> = function (this: HirTyLowerer, ..)`.
- `src/rustc_hir_analysis/hir_ty_lowering/lower_ty.test.ts` (new, 4 tests, see "Tests").
- Nothing else. decls.ts, the stubs of other lanes, `.gen.ts` files, tools/, harness/, scripts/ are untouched.

Note on the brief: the names `lower_ty_maybe_return_type_notation`, `lower_path`, `lower_impl_trait` and `lower_qpath*` do not
exist at the pin. The 25 methods are the contract's list (`lower_resolved_ty_path` .. `lower_view`).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs`: 26/87 (was 1/87).
  Nothing is missing in 2186..3915; the 61 missing are all in lane -a's 1..2185.
- `bun scripts/coverage.ts --check`: `markers ok (12286; vendor 3888)`.

## Region-local helpers (no markers; not upstream fns)
- `index_slice` (core's index panic text), `assert_eq_msg` (`assert_eq!` with a message), `is_ctor_of`
  (`if let DefKind::Ctor(x, _)`), `map_index` (std `HashMap` `Index`: "no entry found for key"), `assert_no_self_ty`
  (`assert_eq!(opt_self_ty, None)`), `parse_usize` (`str::parse::<usize>`), `FieldIdx_from_usize` (`newtype_index!` range
  assert).
- `lower_ty_rtn_type_relative`: the body of `lower_ty`'s RTN type-relative arm (mod.rs:3290..3384). It is split out only so the
  two `if let` chains read in upstream order (PORT comment); `lower_ty` calls it in the same place.
- `debug_opt_resolved_arg`: stops UNPORTED (see below).
- `check_abi`: a local stand-in for `crate::check::check_abi` (check/check.rs, wave 17; no TS module exists), body
  `unported("rustc_hir_analysis::check::check::check_abi")`. **Root: repoint to the real fn when check/check.rs lands.**
- `const FIRST_VARIANT = 0 as VariantIdx` (as rustc_middle ty/adt.ts does; rustc_abi's layout module is not ported).

## `unported(...)` left
- In this region:
  - `rustc_hir_analysis::check::check::check_abi`: reached by `lower_fn_ty` when the HIR type is a `fn` pointer (wave 17).
  - `Debug for rustc_middle::middle::resolve_bound_vars::ResolvedArg`: only in the `bug!` texts of `lower_ty_param` /
    `lower_const_param` (an ICE path becomes UNPORTED until `ResolvedArg` gets its Debug).
- Reached through other lanes' stubs (pinned in lower_ty.test.ts, PENDING):
  - lane hir-ty-lowering-a: `prohibit_generic_args` (every resolved path), `lower_path_segment` (ADT / alias paths),
    `lower_lifetime` (references), plus `lower_generic_args_of_path_segment`, `lower_type_relative_*`,
    `lower_resolved_assoc_*`, `probe_generic_path_segments`, `check_param_uses_if_mcg`, `lower_resolved_lifetime`,
    `lower_impl_trait_ref` on their paths;
  - lane collect-a: lib.rs `check_c_variadic_abi` (every `fn` pointer type), `generics_of` (non-literal anon consts via
    `identity_for_item`), and `ItemCtxt`'s `HirTyLowerer` impl (so nothing in the driver reaches this code yet: `type_of`,
    `fn_sig`, ... are collect stubs);
  - lane collect-rbv: `named_variable_map provider (not ported)` (`tcx.named_bound_var`, i.e. every type / const param);
  - lane hir-ty-lowering-c: `lower_trait_object_ty`, `lower_bounds`, `add_implicit_sizedness_bounds`;
  - lane hir-ty-lowering-d: `cmse::validate_cmse_abi`, `errors::eq_ctxt_suggestion_span` (RTN-in-`let` errors);
  - rustc_middle: `` rustc_middle::query::keys: QueryKey for `LitToConstInput<'tcx>` (cache) `` (every literal const arg,
    `tcx.at(..).lit_to_const(..)`), `TyCtxt::mk_pat (Pattern class)` (pattern types).

## PORT decisions (please record)
1. **`rbv::ResolvedArg` shape.** It is `Pending` in decls.ts and `PendingEnum` in rustc_middle ty/context.ts. The region
   matches on a local `RbvResolvedArg` type with upstream's variants (`StaticLifetime`, `EarlyBound(_0)`,
   `LateBound(_0, _1, _2)`, `Free(_0, _1)`, `Error(_0)`), marked `PORT(decls): pending root`, and casts
   `named_bound_var`'s result to it (`opaque_captured_lifetimes`' entries keep decls.ts's `ResolvedArg`, which they are
   only passed on as, to `lower_resolved_lifetime`). **Root/collect-rbv: when the real type lands, replace the
   local type with it** (same field names `_0.._2`, so only the alias changes).
2. **`impl Iterator + Clone` arguments of `prohibit_generic_args` are arrays.** The three `path.segments.iter().enumerate()
   .filter_map(..)` arguments are `path.segments.filter(..)` (lane -a's body iterates `segments` more than once; decls.ts
   rule). The other segment iterators are slices of `path.segments`.
3. **`usize` arithmetic.** `lower_opaque_ty`'s `generics.count() - lifetimes.len()` keeps upstream's wrapping semantics (a
   negative TS `offset` makes every `checked_sub` `None`, as the wrapped usize does in a build without overflow checks).
   `lower_field_of`'s tuple index is parsed to a `bigint` (`usize::from_str`: optional `+`, digits, overflow check), so
   `sym::integer(index)` sees the exact value.
4. **Exhaustive `Res` arm of `lower_resolved_const_path`** is the final `else` (upstream's match is exhaustive; the PORT
   comment lists the arm's variants).
5. **`collect_*_late_bound_regions`** return `Set` in decls.ts but are `KeyedSet`s (ty/visit.ts); `lower_fn_ty` casts to
   `KeyedSet<BoundRegionKind>` for `validate_late_bound_regions` (decls.ts signature). `difference` iterates
   `referenced_regions` in order and skips members of `constrained_regions`, as `IndexSet::difference`.
6. **Parameter rename** `variant` -> `variant_` in `lower_field_of` (upstream shadows it with a local of the same name).

## For root
- decls.ts: nothing needed to change. The `RbvResolvedArg` local alias (decision 1) and the `check_abi` stand-in are the only
  stand-ins.
- `lower_ty.test.ts` mocks lane -a's `prohibit_generic_args` with its upstream body for segments without args/constraints
  (only around the oracle test's lowering calls). When lane -a merges, the third test ("without the mock ... stops at
  prohibit_generic_args") will fail by design: delete it, and the mock can go too.
- When collect-a merges, the test's `TestCtxt` vtable can be replaced by `ItemCtxt` (`HirTyLowerer_ItemCtxt`); the brief's
  "through the ItemCtxt vtable" was not possible yet (all 16 impl methods are stubs).

## Tests
- `lower_ty.test.ts` (4 tests; the oracle ones need the tydump probe, `RUST_TS_REQUIRE_PROBES=1` makes a missing probe a
  failure):
  1. **Oracle**: a `#![no_core]` crate with 7 type aliases (`!`, nested tuples / unit, slices, `*const` / `*mut`, every
     primitive int/uint/float, `bool`, `char`, `*const str`). The port runs the driver to `resolver_for_lowering`, lowers
     each alias's HIR type through `HirTyLowerer_provided.lowerer(TestCtxt, ..).lower_ty(..)` and prints
     `type_of {EarlyBinder:?}`; all 7 lines equal the tydump probe's `type_of` lines.
  2. **Oracle, errors**: `type E0 = Missing; type E1 = (!, *const Missing);` (`Res::Err` -> delayed bug ->
     `{type error}`): both lines equal the probe's.
  3. **PENDING pins**: 8 aliases stop with the exact texts listed above (`lower_path_segment`, `lower_lifetime`,
     `check_c_variadic_abi`, `named_variable_map provider (not ported)` x2, the `LitToConstInput` query key x2,
     `collect::generics_of::generics_of`).
  4. Without the `prohibit_generic_args` mock, resolved paths stop at lane -a's stub; `!`/tuple/slice/pointer aliases still
     lower.
- `bunx tsc --noEmit -p .`: clean.
- Fresh-process `import()` of `hir_ty_lowering/mod.ts`, `lib.ts`, `collect.ts`, `decls.ts`: all load (mod.ts now imports
  `../lib.ts` for `check_c_variadic_abi`; it is used only inside function bodies).
- `bun test src/rustc_hir_analysis`: contract.test.ts 10/10 + lower_ty.test.ts 4/4.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4502 pass, 1 skip (the pre-existing linux-only one),
  0 fail (4503 tests, 272 files, 1327 s).
- `RUST_TS_AGENT=hir-ty-lowering-b bun scripts/difftest.ts --suite hir-tree-nocore --sample 200`: 200 MATCH / 0 DIFF /
  0 UNPORTED / 0 CRASH (run `20261014-120756-hir-ty-lowering-b-ldcn`). No driver path reaches the new code yet.

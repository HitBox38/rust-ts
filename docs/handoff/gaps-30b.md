# Handoff: gaps-30b (query descs, IntoDiagArg, asm const, big Size)

Branch `lane/gaps-30b` from main `bbbe6dd3`. Agent for samples: `RUST_TS_AGENT=root-f5de`.

## Result per stop (cases from gate-20261029-001428-root-june)

| Stop | Cases | Now |
|---|---|---|
| 1. query `desc` (`layout_of`, `eval_to_const_value_raw`, `eval_to_allocation_raw`, `evaluate_obligation`, `analysis`) | mir 36, borrowck-ui-report 5, thir-tree 3, tydump-ui 1 | **45/45 MATCH** |
| 2. `IntoDiagArg without a TS impl` | mir 22, thir-tree 5, tydump-ui 5 | **32/32 MATCH** |
| 3. asm `const` operand (`mir::Const::Unevaluated`) | mir 13 | **13/13 MATCH** |
| 4. `rustc_abi::Size beyond 2^53` | mir 32 | not fixed: needs a representation change (design below) |

Each case was run on its own with `--filter` at the final head (stops 2 and 3: 45 cases, all MATCH; stop 1: 45 cases, all MATCH).
Item 2 hit no `Location::caller` case: all 32 were `Ty`/`Instance` in rustc_middle's own diagnostics (31) or
`io::Error` (1).

## Samples (`--sample 300`, RUST_TS_AGENT=root-f5de)

"Before" = the gate run's status for the same sample ids.

| suite | before (gate) | after | lost MATCH |
|---|---|---|---|
| mir | 290 MATCH, 8 UNPORTED, 2 UNSTABLE | 291 MATCH, 7 UNPORTED, 2 UNSTABLE | 0 |
| thir-tree | 294 MATCH, 4 UNPORTED, 2 UNSTABLE | 295 MATCH, 3 UNPORTED, 2 UNSTABLE | 0 |
| tydump-ui | 297 MATCH, 1 UNPORTED, 2 UNSTABLE | 298 MATCH, 0 UNPORTED, 2 UNSTABLE | 0 |

Runs: `20261029-100652-root-f5de-03dz` (mir), `20261029-100900-root-f5de-92s9` (thir-tree),
`20261029-101127-root-f5de-axbx` (tydump-ui). The remaining UNPORTED cases in the samples belong to other stops
(EarlyBinder, rustc_transmute, inherent assoc types, `Relate for ty::Expr`, a missing Debug).

Checks: `bunx tsc --noEmit -p .` is clean, `bun scripts/coverage.ts --check` is ok (markers 22798).
`bun test tools/codegen src/rustc_mir_build src/rustc_middle src/rustc_passes src/rustc_metadata src/rustc_codegen_ssa src/rustc_interface`:
674 pass, 0 fail. No contract or stub-count test pinned a number this lane moved.

## Files touched

- `tools/codegen/queries.ts`: the `desc` translator now handles:
  - field access through structs and type aliases (config `structs`, with type-parameter substitution);
  - methods on non-tcx receivers (config `rust_methods`: TS template, return type over the receiver's
    type parameters, imports);
  - path constants (config `consts`);
  - extra type-map entries for the query generator only (config `types`).
- `tools/codegen/queries.config.json`:
  - `structs` entries for `PseudoCanonicalInput`, `ParamEnvAnd`, `CanonicalQueryInput`, `Canonical`, the
    `Canonical*Goal` aliases, `Normalize`, `ImpliedOutlivesBounds`, `DropckOutlives` and `MethodAutoderefSteps`;
  - `rust_methods` for `GlobalId::display` and `Unnormalized::skip_normalization`;
  - `consts` for `LOCAL_CRATE`;
  - Displays for Predicate, Clause, GenericArg, PolyFnSig, TraitRef and AliasTerm;
  - `types` for GenericArg and TraitRef, copied from tyir/middle_traits_thir typemaps.
- `tools/codegen/queries.test.ts`: a new golden test covers struct fields, aliases, generic receiver methods,
  constants and the unsupported cases.
- `src/rustc_middle/queries.gen.ts`: regenerated. Unported descs went from 51 to 22. QueryTypes changed too:
  `TraitRef`/`GenericArg` keys are now typed instead of `unknown`, and `delegation_user_specified_args`
  gained `debug_value`/`stable_hash_value`.
- `tools/codegen/types.ts`: new set option `diag_args_lazy`. The listed Rust paths' `IntoDiagArg`/Display impls
  are reached through a memoised lazy `require` at call time, as hand modules already do
  (rustc_type_ir `sty/mod.ts` `region_kind()`). They are not imported statically.
- `tools/codegen/types.sets.json` (`rustc_middle_diagnostics`):
  - `diag_args_skip` (Ty) is replaced by `diag_args_lazy` (Ty, Instance). A static import still fails:
    removing the skip gives `ReferenceError: fold_Term` (rustc_type_ir relate.ts) through ty/mod.ts. I checked.
  - adds `typemap_extra: ["mir.typemap.json"]`, so `TypeLengthLimit.instance` is `Instance`, not `unknown`.
- `tools/codegen/diag_args.json`: new entries for `rustc_middle::ty::Instance` (`Instance_into_diag_arg`,
  ty/diagnostics.rs:31) and `std::io::Error` (`into_diag_arg_using_display(display_IoError)`,
  rustc_error_messages diagnostic_impls.rs:69).
- `tools/codegen/typemap.diag.json`: `std::io::Error` maps to `IoError` (src/std/io.ts).
- Regenerated: `src/rustc_middle/diagnostics.gen.ts`, `src/rustc_passes/diagnostics.gen.ts`,
  `src/rustc_metadata/diagnostics.gen.ts`, `src/rustc_codegen_ssa/diagnostics.gen.ts`,
  `src/rustc_interface/diagnostics.gen.ts`. Their `io::Error` fields went from `Error` (a JS global, by accident)
  to `IoError`, and all their `IntoDiagArg` stops are gone except `Box<dyn std::error::Error>` (codegen_ssa:623).
- `src/rustc_mir_build/thir/cx/expr.ts`: the asm `const` operand now builds
  `mir::Const::Unevaluated(UnevaluatedConst::new(did.to_def_id(), args), ty)` with `span: tcx.def_span(did)`,
  as upstream does. The `unported` import is removed. Coverage of `thir/cx/expr.rs` is 27/27.
- `src/rustc_passes/debugger_visualizer.ts` is outside this lane's files. The `as unknown as Error` cast and its
  PORT note are dropped: the generated field is now `IoError`, as upstream's `error` is. Coverage 5/5.

## unported(...) left / PORT decisions

- No new `unported`. Removed: the asm-const `unported` and 29 desc `unported`s; the generated
  `unported_into_diag_arg` uses are gone from 4 of the 5 sets.
- `// PORT (init order, diag_args_lazy)` is the comment generated above the lazy accessor in
  rustc_middle/diagnostics.gen.ts.
- Remaining desc `unported`s (22) are receiver methods such as `.to_def_id()`/`.def_id()`, closures, missing
  Debug of `AscribeUserType`/`ProvePredicate`/`FnSig`/`PolyFnSig`/`Clauses`/`GenericArgsRef`, `resolve_instance_raw`,
  `vtable_*`, and `check_validity_requirement`. None of them showed up in this lane's cases.

## Stop 4: `Size` beyond 2^53 needs a representation change (not done)

These cases need values above 2^53. Overflow checks alone would not fix them: `checked_add`/`checked_mul`/`mul`
already use `bigint` against `obj_size_bound`. In each case `Size` has to hold a valid value of 2^53 or more:

- **TypeId hash fragments as pointer offsets** (`write_type_id`, interpret/intrinsics.ts:175): 18 cases. A random
  u64 fragment is stored as `Pointer.offset`. Cases:
  - `any/builtin_bound`, `any/hrtb`, `any/hrtb2`, `any/non_static`, `any/try_as_dyn_assoc_ty_lifetime`,
    `any/try_as_dyn_elaborated_bounds`, `any/try_as_dyn_generic_impl`, `any/try_as_dyn_generic_trait`
  - `const-generics/issues/issue-90318`
  - `consts/const-typeid-of-rpass`, `consts/const_transmute_type_id{,3,4,5,7}`, `consts/issue-73976-monomorphic`
  - `reflection/trait_info_of_too_big`, `reflection/variant_index_out_of_bounds`
- **Wrapping pointer offsets / integer-to-pointer casts** (mir/interpret/pointer.ts:430 `without_provenance`,
  :473 `wrapping_offset`; const_eval/machine.ts:1509): 10 cases.
  - `cast/negative-integer-cast-to-pointer`
  - `consts/offset_ub`, `consts/offset`, `consts/offset_from_ub`, `consts/zst_no_llvm_alloc`
  - `consts/const_transmute_type_id2`, `consts/const-ptr-is-null`, `consts/ptr_comparisons`
  - `consts/const-eval/ptr_fragments_in_final`, `consts/const-eval/ptr_fragments_mixed`
- **Valid layouts between 2^53 and `obj_size_bound` (2^61)** (rustc_abi/layout.ts:277 `layout_of_array_like`,
  :1419 `univariant_biased`): 3 cases. `extern/extern-static-size-overflow` (`[u8; 2^61-1]` is a valid size),
  `limits/huge-enum` (`[u32; 2^59-1]`), `limits/huge-struct` (offsets of 31·2^57).
- **`size_of_val_raw` of an isize::MAX slice** (interpret/eval_context.ts:572): 1 case,
  `consts/const-size_of_val-align_of_val`.

Proposed design (smallest one I see): keep `Size.raw: number` for safe integers (the fast path, every existing
`.bytes()` caller: ~390 non-test uses in ~115 files), and add an exact representation for larger values:

1. `Size` gets an optional `big: bigint` holding the exact value when it is ≥ 2^53. `raw` is then `NaN` (or the
   class stays `raw: number` and a `BigSize` subclass is used). `from_bytes`/`from_bits` build it instead of calling
   `unported`.
2. Add `bytes_u64(): bigint`, which is always exact. `bytes()`/`bits()` keep calling `unported(SIZE_BEYOND_2_53)`
   on a big `Size`, so unconverted callers still stop safely and never round.
3. Convert only the paths in the case list to `bytes_u64()` and bigint arithmetic:
   - `Size` ops (`add`, `sub`, `checked_*`, `align_to`, `is_aligned`, `Ord`/`eq`);
   - `Pointer` offset ops (`wrapping_offset`, `wrapping_signed_offset`, `overflowing_offset`, `addr`, `into_parts`)
     and `Scalar::from_pointer`/`to_bits`;
   - `layout_of_array_like` and `univariant` offset accumulation;
   - `size_and_align_from_meta`.
   Debug/Display of `Size` must print the exact value.
4. `Size` equality must not rely on `raw ===` for big values (it would be NaN). An audit of `.raw ===` /
   `Size_eq` uses is part of the change.

This is a root-level decision. It touches rustc_abi, mir/interpret, const_eval and layout code across lanes, so I
did not start it.

## For root

- Record: `diag_args_lazy` (lazy `require` in a generated `.gen.ts`) replaces `diag_args_skip` for
  rustc_middle_diagnostics.
- Record: `std::io::Error` maps to `IoError` in typemap.diag.json. That changes 5 generated diagnostics files.
- Record: queries.config.json gained `structs`/`rust_methods`/`consts`/`types`.
- Decide on the stop-4 design above.
- I edited `src/rustc_passes/debugger_visualizer.ts` outside the lane (a cast removal the codegen change required).

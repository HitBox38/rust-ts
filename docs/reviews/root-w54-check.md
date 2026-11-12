# Independent check: root's integration commits on `integ-w54` (wave 40n)

Reviewer, read-only on code. Tree: `c72e7fbd`, merged into this worktree. I checked root's own first-parent commits
(`git log --first-parent 51dfe33c..c72e7fbd`): `dbec5951`, `0d3ca683`, `8225185d` (conflict resolution via
`--remerge-diff`), `52231061` and `c72e7fbd`. The lane merges themselves were already reviewed. Upstream was read from
`$RUST_TS_DATA/rust` at `6f5da406`.

## Verdict: CHANGES REQUESTED

One stub site that a handoff lists was not repointed (finding 1). It is a small fix. Everything else is faithful, and the
three re-derived `Option<&u32>` retag sequences match upstream line by line.

## Findings

1. **Missed repoint: `src/rustc_codegen_ssa/base.ts:1437-1455` still holds the meth.rs stubs `meth_load_vtable` and
   `meth_get_vtable`.** Their call sites are base.ts:282 and :289, in `unsized_info`. They stop with
   `"compiler/rustc_codegen_ssa/src/meth.rs load_vtable / get_vtable (plan-m7 MIR core group, no lane yet)"`. meth.rs
   has landed: ssa-mir-rest ported it 8/8, and `src/rustc_codegen_ssa/meth.ts:120` (`get_vtable`) and `:141`
   (`load_vtable`) export both. The ssa-mir-rest handoff §11 lists both functions under "parallel lanes' stubs for this
   lane's functions — repoint any that ssa-block, ssa-rvalue-intrinsic or ssa-base left". The ssa-base handoff also
   lists them under "Every `unported(...)` left" and says "Root: assign meth.rs". With these stubs in place, every unsize
   to `dyn` and every trait upcast still stops.
   - There is one wrinkle for the fix. base.ts:281 computes `vtable_byte_offset` as a `bigint` (`BigInt(entry_idx) *
     ptr_size.bytes_u64()`), but `meth.ts:146` `load_vtable` takes a `number`. Upstream it is a `u64` in both places.
     Root has to convert at the call or change meth.ts's parameter, and record which one as a `// PORT:` decision.
   - My grep for this finding was `unported("` with prefixes `ssa-`, `rustc_session`, `retag` or `compiler/rustc_codegen_ssa`,
     run over `src/rustc_codegen_ssa/` and `src/rustc_codegen_llvm/`. Apart from these two, every match left belongs to a
     lane that has not landed:
     - ssa-debuginfo: mod.ts:929/936/944, block.ts:2703/2707/2711, statement.ts:31/36/41;
     - ssa-write: base.ts:1474-1518, llvm_backend.ts:73/145/149/479/483;
     - the rustc_session `OutputFilenames` stops in lib.ts:458-473, which ssa-base left for "no M7 lane yet" and which
       ssa-mir-rest did not port;
     - place.ts:45, a Debug-format stop, not a lane stub.
2. **Nit: the header at `src/rustc_codegen_ssa/mono_item.ts:10-12` is stale.** It still says "Calls into lanes that have
   not landed are typed module-private stubs … Root repoints them at integration." Since `c72e7fbd`, those three
   functions forward to `base.codegen_global_asm`, `base.codegen_instance` and `naked_asm.codegen_naked_asm`.
3. **Nit: the check at `src/rustc_codegen_llvm/builder.test.ts:698` is weaker than the one it replaced.**
   - What it checks: `toThrow(/unstable_opts/)` plus the shim's `declare` line. That does show `from_fn_attrs` runs past
     `must_emit_unwind_tables`, because the marker session's `must_emit_unwind_tables` returns `false`. A `true` would
     read `unstable_opts.use_sync_unwind` at the same spot. The `TypeError` itself comes from the first `unstable_opts`
     read after that, in `frame_pointer`/`function_return_attr`.
   - What it misses: the test would still pass if the `must_emit_unwind_tables` call were deleted.
   - Suggested fix: wrap the borrowed method in a call counter and assert it ran once and returned `false`. The test stays
     meaningful as a smoke test, so this is not blocking.
4. **Nit, optional: the two `cx as never` casts at `src/rustc_codegen_ssa/mono_item.ts:31` and `:46` look unnecessary.**
   `CodegenMethods<B>` includes `AsmCodegenMethods`, `LayoutOf` and the `Has*` traits, as upstream's alias does. A scratch
   typecheck of the uncast calls `base.codegen_global_asm(cx, id)` and `naked_asm.codegen_naked_asm(cx, i, d)`, run
   outside the tree, gave no error on those lines. Dropping the casts would let tsc check the forwarding.

## Q1: Is every repointed site faithful?

Each former stub now resolves to the same upstream function, with the same receiver and arguments:

- **ssa-rvalue-intrinsic (`dbec5951`).** operand.ts `insert_field` calls `transmute_scalar(bx, src, from, to)`
  (operand.rs:829). `extract_field` calls `fx.codegen_transmute_operand(bx, this, field)` (operand.rs:405). mod.ts installs
  `install_FunctionCx_rvalue` and `install_FunctionCx_intrinsic`.
- **ssa-block (`0d3ca683`).** The `xlane.codegen_block` and `codegen_block_as_unreachable` entries forward to
  `fx.codegen_block(bb)` and `fx.codegen_block_as_unreachable(bb)` (mod.rs). `export { store_cast } from "./block.ts"`
  is `pub use self::block::store_cast`, and abi.ts imports it from there with the same arguments.
- **ssa-base (`52231061`).**
  - In rustc_codegen_llvm/base.ts, `maybe_create_entry_wrapper(Builder_static, cx, cx.codegen_unit)` and
    `ModuleCodegen.new_regular(name, module)` match upstream.
  - `llvm_backend.ts` calls `codegen_crate(new LlvmCodegenBackend(), tcx)`.
  - `wants_msvc_seh` is now imported from rustc_codegen_ssa/base.ts in context.ts and intrinsic.ts.
  - `block_xlane.wants_msvc_seh` forwards to `base.wants_msvc_seh(target)`, and
    `is_call_from_compiler_builtins_to_upstream_monomorphization` forwards to the base.rs:932 function with
    `(tcx, instance)`. `xlane.wants_new_eh_instructions` forwards to base.ts.
  - rvalue.ts calls the real `coerce_unsized_into`, `unsize_ptr` and `build_shift_expr_rhs`, with rvalue.rs's arguments
    (:166/:172, :563, :983/:987, `op == ShlUnchecked` / `ShrUnchecked`).
- **ssa-mir-rest and the intrinsic/meth entries (`c72e7fbd`).**
  - `block_xlane` forwards `codegen_statement`, `eval_mir_constant` and `codegen_intrinsic_call` (all six arguments, in
    order). `VirtualIndex_get_fn` / `_get_optional_fn` become `VirtualIndex.from_index(idx).get_fn` / `get_optional_fn`
    `(bx, llvtable, ty, fn_abi)`, as at block.rs:710 and :1338/:1349.
  - The `xlane` retag entries forward to `fx.codegen_retag_place` / `codegen_retag_operand`, at mod.rs:616/621/627,
    block.rs:2519/2526/2544 and rvalue.rs:637.
  - In statement.ts, `FunctionCx_codegen_rvalue` / `_operand` forward to the installed methods.
  - The three `mono_item_xlane` entries call `base.codegen_global_asm(cx, item_id)`, `base.codegen_instance(Bx_, cx,
    instance)` and `naked_asm.codegen_naked_asm(cx, instance, item_data)`, matching mono_item.rs:41-49.
  - operand.ts, rvalue.ts, intrinsic.ts and place.ts call `this.eval_mir_constant[_to_operand]`,
    `this.immediate_const_vector`, `this.get_caller_location`, `size_and_align_of_dst` and
    `VirtualIndex.from_index(idx).get_usize`.
  - The rustc_codegen_llvm session sites match upstream: attributes.rs:460/519/567/702, base.rs:146/170,
    context.rs:270/306/391, intrinsic.rs:1796 and mono_item.rs:298.
  - `MonoItemExt.predefine` / `define(.., Builder_static, ..)` replace the stops. Dropping the `Visibility` cast in
    rustc_codegen_llvm/mono_item.ts typechecks.

Root forwarded some table entries instead of deleting them, as ssa-mir-rest's handoff step 2 suggested. That is the
pattern the brief names, the bodies are exactly the upstream calls, and tests can still replace the entries.

`8225185d`'s conflict resolution is right. cg-abi-consts dropped its `get_param` check and cg-intrinsic-a dropped its
`abort_immediate` check. The SIMD `generic_simd_intrinsic` check, which cg-intrinsic-b owns, stays.

## Q2: Load order

In a fresh `bun` process per entry module, I imported the module first and then `mir/mod.ts`, and listed `FunctionCx`'s
prototype methods. The entry modules were:

- mir/{mod, block, rvalue, intrinsic, constant, statement, retag, operand, place};
- rustc_codegen_ssa/{base, mono_item};
- rustc_codegen_llvm/{lib, base, context, intrinsic, attributes} and back/llvm_backend.

All 17 orders give the same 59 methods (same name hash). No installer threw. Every `this.`/`fx.` FunctionCx call I found
in `src/rustc_codegen_ssa` resolves to an installed method. The only names not installed are the ssa-debuginfo methods,
which nothing calls yet, because the stubs go through tables. The rest of that grep's leftovers are methods of other
classes (OperandRef, VirtualIndex, TerminatorCodegenHelper).

## Q3: The session methods

context.test.ts, intrinsic.test.ts and abi_consts.test.ts no longer double `needs_plt`, `must_emit_unwind_tables`,
`branch_protection` or `direct_access_external_data`, and they pass on rustc_session's real methods. Those methods
(session.ts:813, :1073, :1108, plus the `PointerAuthConfig` companion's :181/:230) read as session.rs:863/1092/1125/1144
and :186/:301. This is the tightening review cg-context N6 asked for: the oracle IR is now checked against the real
logic, not against a copy of it.

## Q4: Test edits

- **`mir_rest.test.ts`: `rp_option`, `ro_option` and `ro_option_const`.** I re-derived each sequence from upstream.
  - Every line matches what upstream produces through the mock: `val_ty`/`type_kind` log, `immediate_backend_type`,
    `const_uint[_big]` and `const_to_opt_u128` don't, and `retag_mem`/`retag_reg` are recorded.
  - None of the three is a port bug or a wrong expectation.
  - The derivation follows.
  - **The plan (retag.rs:68-136).**
    - For `Option<&u32>`, `walk_value` gets no field plan: field 0 is the niche tag, a raw pointer, so `None`.
    - Its variant plans are `{Some: Recurse{fields{0: EmitRetag}}}`. `None`'s variant is smaller than a pointer, so it
      gets no plan.
  - **`codegen_get_discr` (operand.rs:459).** This applies to all three cases.
    - The tag is read with `extract_field(0)`. The field is the size of the whole value (8 = 8), so this is
      `codegen_transmute_operand` (operand.rs:405).
    - The layouts differ and the sizes match, so it takes the Scalar→Scalar arm and calls `transmute_scalar`
      (rvalue.rs:1089). That logs `val_ty` and `type_kind`.
    - The tag scalar is the niche scalar, which is also the enum's `backend_repr` scalar (`Pointer`, `0..=max`). So
      `from == to` and the value comes back unchanged.
    - The niche decode on a `Pointer` tag logs `type_from_integer(I64)` and `ptrtoint`.
    - `relative_max == 0` gives `icmp(IntEQ, tag, const_uint_big(i64, 0))` and then
      `select(is_niche, const_uint(isize, 0), const_uint(isize, 1))`.
  - **`rp_option` (retag.rs:557-562 → `retag_variants` :569).**
    - It starts with `load_operand(%o)`, then the discriminant read above.
    - `retag_variants` logs `llbb`, `append_sibling_block(retag_join)`, `append_sibling_block(retag_variant)` and
      `switch_to_block(variant)`.
    - `project_downcast` (place.rs:300) only swaps the layout. `project_field(0)` has offset 0, so `simple()` adds no
      GEP. Then `retag_mem(%o)` and `br(join)`.
    - Last come `switch_to_block(root)`, `switch(discr, join, [(1, variant)])` and `switch_to_block(join)`.
  - **`ro_option` (retag.rs:497-519).**
    - The discriminant is not a constant, so the operand is spilled. `PlaceRef::alloca` gives `alloca(8, 8)`, and
      `storage_live` gives `lifetime_start`.
    - `store_with_annotation` stores with no move annotation (operand.rs:318-337 → :1048): `from_immediate` and
      `store_with_flags(.., align8, 0)`.
    - Then `retag_variants` on the scratch slot runs as in `rp_option`.
    - Then `load_operand(scratch)` and `storage_dead` (`lifetime_end`). `update_imm(0, load(%6))` gives
      `Immediate(load(%6))`.
  - **`ro_option_const` (:487-494).**
    - `const_to_opt_u128` is overridden to 1, so this takes the `Some` plan on `variant_op` (layout `for_variant(Some)`).
    - `extract_field(0)` is again the same size, so it goes through `codegen_transmute_operand`. The `Some` variant's
      scalar and `&u32`'s are both `Pointer`, `1..=max`, so `transmute_scalar` logs only `val_ty` and `type_kind`.
    - Then `retag_reg(%o)` and `update_imm` give `Immediate(%8)`.
- **The `mono_item` define cases.** Recorders replace the three `mono_item_xlane` entries, and the log shows
  `codegen_static(S)`, `codegen_instance(g)`, `codegen_naked_asm(nk)` and `codegen_global_asm`, checked by instance
  identity. That is still a faithful check of mono_item.rs:29-55's dispatch: static, global asm, `NAKED` and non-naked
  fn, with the right arguments. The old version only proved that each arm reached a stop. The saved table is restored
  afterwards.
- **`rvalue_intrinsic.test.ts`.**
  - **Shift.** base.rs:334 calls `shift_mask_val(bx, lhs_llty, rhs_llty, false)` (common.rs:127). `Integer` gives
    `const_uint(rhs_llty = i32, 32 - 1)`. Not unchecked gives `and(rhs, mask)`. Equal `int_width`s give no cast. Then
    rvalue.rs:984 `shl`. The expected sequence `const_uint(i32, 31)`, `and(%b:i32, %2)`, `shl(%a:i32, %3)` is right.
  - **Unsize.** rvalue.rs:559-564 gives `pointer_parts` → `unsize_ptr`. The `Ref`/`Ref` arm (base.rs:237) asserts
    `type_is_sized([u8; 4]) == old_info.is_none()`, which is true. `unsized_info`'s `Array`/`Slice` arm is
    `const_usize(4)`. The result `Pair(%r:ptr, usize 4)`, typed `&[u8]`, with no instruction, is right.
  - **The mock.** The new `int_width` parses `iN`. `type_is_sized` delegates to the provided
    `DerivedTypeCodegenMethods_provided.type_is_sized` (traits/type_.rs:84). Both are sound.
  - **The removed check.** The `eval_mir_constant` check only asserted the old stub's stop. Removing it is correct;
    constant.rs is covered in mir_rest.test.ts.
- **`builder.test.ts`'s allocator test.** It is meaningful, but weaker (finding 3).
- **`skeleton.test.ts`.** The test counts `unported("<lane>:` literals in the crate's source and compares them with
  `EXPECTED`. It passes, so the counts match the source. The removed entries were `ssa-block` 1, `ssa-base` 4,
  `rustc_session` 9 and `ssa-mir-core` 2. Each corresponds to stubs removed in these commits.

## Q5: The regenerated `block_oracle/*.ll`

From inside `src/rustc_codegen_ssa/mir/block_oracle/`, I ran the README's two commands (`rustc +nightly-2026-10-11 …
block.rs`, host and `x86_64-pc-windows-msvc`) and wrote the output to scratch. Both files are byte-identical to the
committed `host.ll` and `msvc.ll`. Neither contains an absolute path.

## Q6: Commands

The worktree was on AC power, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`.

| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check --offline` | exit 0 (`markers ok (26581, …)`) |
| `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./src/rustc_session/ ./src/rustc_middle/ ./scripts/lib/unit-steps.test.ts` | 821 pass, 0 fail, 0 skip, 71,854 `expect()` calls, 84 files |

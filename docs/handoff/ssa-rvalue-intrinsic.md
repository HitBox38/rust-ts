# Handoff: ssa-rvalue-intrinsic (M7, plan-m7 wave 41, wave 40n): `mir/{rvalue,intrinsic,naked_asm}.rs`

Branch `t3/port-ssa-rvalue-intrinsics` (from `51dfe33c`; no merges).

## Summary
- `compiler/rustc_codegen_ssa/src/mir/rvalue.rs` (**14/14**), `mir/intrinsic.rs` (**5/5**) and `mir/naked_asm.rs`
  (**6/6**) are ported in full, in upstream order, with markers. They are in the new files
  `src/rustc_codegen_ssa/mir/{rvalue,intrinsic,naked_asm}.ts`: 2,689 TS lines for 2,369 upstream lines.
- What they cover:
  - rvalue.rs: `codegen_rvalue`, `codegen_rvalue_operand`, the casts (`cast_immediate`), the transmutes
    (`codegen_transmute`, `codegen_transmute_operand`, `transmute_scalar`), the aggregates and `Repeat`, the scalar,
    wide-pointer and checked binops, the unary ops, `assume_scalar_range`.
  - intrinsic.rs: `codegen_intrinsic_call`, with its `copy`/`memset` helpers and the int/float width helpers.
  - naked_asm.rs: `codegen_naked_asm`, `prefix_and_suffix` for every binary format, and the wasm `.functype` helpers.
- Nothing protected reaches this code yet. The LLVM backend is not registered, and no production module imports these
  files.

## Files touched
- New: `src/rustc_codegen_ssa/mir/rvalue.ts`, `mir/intrinsic.ts`, `mir/naked_asm.ts` (my files).
- New: `src/rustc_codegen_ssa/mir/rvalue_intrinsic.test.ts` (unit tests).
- New: `docs/handoff/ssa-rvalue-intrinsic.md` (this file).
- Edited outside my files: **none**. `mod.ts`, `place.ts` and `operand.ts` are unchanged. The merge steps below are
  root's.

## Merge steps for root
1. **mod.ts**: right after `class FunctionCx { ... }`, next to the existing two installers, add these two calls,
   importing them from `./rvalue.ts` and `./intrinsic.ts`:
   ```ts
   install_FunctionCx_rvalue(FunctionCx);
   install_FunctionCx_intrinsic(FunctionCx);
   ```
   - They hold rvalue.rs's and intrinsic.rs's `impl FunctionCx` blocks:
     - rvalue.rs: `try_codegen_const_aggregate_as_immediate`, `is_entirely_uninit_const`, `codegen_rvalue`,
       `codegen_transmute`, `codegen_transmute_operand`, `cast_immediate`, `codegen_rvalue_operand`,
       `codegen_place_to_pointer`, `codegen_scalar_binop`, `codegen_wide_ptr_binop`, `codegen_scalar_checked_binop`;
     - intrinsic.rs: `codegen_intrinsic_call`.
   - Each file has a `declare module "./mod.ts"` merge for its methods, as place.ts and operand.ts do.
   - Load order:
     - intrinsic.ts imports mod.ts for types only.
     - rvalue.ts imports mod.ts at run time, but only for `xlane` (retag), which it reads inside a method body.
     - Both installers are hoisted function declarations. So, as with operand.ts and place.ts, it works whichever
       module loads first.
     - Checked: each of the three files loads alone (`bun -e "await import(..)"`).
2. **operand.ts**: repoint ssa-operand-place's two stubs at this lane:
   - Module-private `transmute_scalar` → `import { transmute_scalar } from "./rvalue.ts"`. It is exported with the
     same signature, `(bx, imm, from_scalar, to_scalar)`.
   - `FunctionCx_codegen_transmute_operand(fx, bx, operand, cast)` → `fx.codegen_transmute_operand(bx, operand, cast)`
     (an installed method).
   - The resulting operand.ts ↔ rvalue.ts cycle is safe. Neither module reads the other's bindings at top level.
3. **Test after the repoint**: `rvalue_intrinsic.test.ts`'s tuple-aggregate case already accepts both states:
   - before the repoint: the stub's stop;
   - after it: `Pair(%c:i8, %u:i32)` with no builder call.

   After the repoint, the stop branch can be dropped.

## Stubs this lane leaves (every `unported(...)`), for root to repoint when the owners land
All are typed, module-private and unmarked. Each names its lane, file and fn.

| file | stub | stops with | owner |
|---|---|---|---|
| rvalue.ts | `base_coerce_unsized_into(bx, src, dst)` | `ssa-base: compiler/rustc_codegen_ssa/src/base.rs coerce_unsized_into` | ssa-base |
| rvalue.ts | `base_unsize_ptr(bx, src, src_ty, dst_ty, old_info)` → `[data, extra]` | `ssa-base: ... base.rs unsize_ptr` | ssa-base |
| rvalue.ts | `base_build_shift_expr_rhs(bx, lhs, rhs, is_unchecked)` | `ssa-base: ... base.rs build_shift_expr_rhs` | ssa-base |
| rvalue.ts | `FunctionCx_eval_mir_constant(fx, constant)` → `ConstValue` | `ssa-mir-rest: compiler/rustc_codegen_ssa/src/mir/constant.rs eval_mir_constant` | ssa-mir-rest |
| intrinsic.ts | `FunctionCx_get_caller_location(fx, bx, source_info)` | `ssa-block: compiler/rustc_codegen_ssa/src/mir/block.rs get_caller_location` | ssa-block |
| intrinsic.ts | `size_of_val_size_and_align_of_dst(bx, t, info, span)` | `ssa-mir-rest: compiler/rustc_codegen_ssa/src/size_of_val.rs size_and_align_of_dst` | ssa-mir-rest |
| intrinsic.ts | `meth_VirtualIndex_from_index_get_usize(idx, bx, llvtable, ty)` | `ssa-mir-rest: compiler/rustc_codegen_ssa/src/meth.rs VirtualIndex::from_index / get_usize` | ssa-mir-rest |

What each stub blocks:
- `eval_mir_constant` stops every `Operand::Constant` in an `Rvalue::Use`, `Repeat` or `Aggregate`, through
  `is_entirely_uninit_const`. Of the stubs above, it is the one hello-world-class code reaches first.
- `build_shift_expr_rhs` stops every shift.
- `unsize_ptr` and `coerce_unsized_into` stop unsizing.

Also used: mod.ts's existing `xlane.codegen_retag_operand`, for `Rvalue::Ref` under `-Zcodegen-emit-retag`
(retag.rs, ssa-mir-rest). Nothing new there.

Callers in other lanes:
- `codegen_naked_asm(cx, instance, item_data)` is exported. mono_item.rs's `define` calls it (ssa-mir-rest).
- `fx.codegen_rvalue(..)` / `fx.codegen_transmute_operand(..)` are for statement.rs (ssa-mir-rest).
- `fx.codegen_intrinsic_call(..)` is for block.rs (ssa-block).
- Before the mod.ts installers are added, any of those lanes that calls these methods needs them installed. The
  test calls both installers itself (idempotent).

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| compiler/rustc_codegen_ssa/src/mir/rvalue.rs | 14/14 |
| compiler/rustc_codegen_ssa/src/mir/intrinsic.rs | 5/5 |
| compiler/rustc_codegen_ssa/src/mir/naked_asm.rs | 6/6 |

`bun scripts/coverage.ts --check`: `markers ok (26384, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
library 744; llvm 390)`.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/std/result.test.ts ./src/rustc_codegen_ssa/mir/ ./src/rustc_codegen_ssa/common.test.ts`:
  **64 pass, 0 fail** (484 expects). That includes mod, analyze and operand_place, unchanged.
- **`bun test ./src/rustc_codegen_ssa/mir/rvalue_intrinsic.test.ts`: 3 pass, 0 fail** (107 expects, about 0.7 s,
  `RUST_TS_REQUIRE_PROBES=1`).
  - How it runs:
    - The port compiles a small `no_core` crate to `analysis`.
    - Each case runs on a `FunctionCx` over `f`'s real MIR. The argument locals are operands named `%x:llty`, so
      `val_ty` works.
    - Layouts are the port's real ones.
    - A logging mock backend implements the traits. A method the mock does not define logs `name(args)` and returns
      a fresh `%N`. `cast_float_to_int` is the real provided method, so the saturating choice shows.
  - **Where the expected values come from.** Every sequence is read off rvalue.rs / intrinsic.rs (and the operand.rs /
    place.rs / builder.rs fns they call) at the pin, cited per case.
  - **Oracle check.** The same operations were compiled with the pinned nightly
    (`-Copt-level=0 -Cno-prepopulate-passes --emit=llvm-ir`, x86_64-unknown-linux-gnu, a `#![no_std]` crate). Each
    case quotes the instruction(s) LLVM made of the trait calls (`ORACLE_*` comments), which pins the choice and
    order of calls. The table lists the quoted mappings; every other row is source-derived only.

    | operation | cg_ssa trait call(s) the test sees | oracle IR (`-Copt-level=0`) |
    |---|---|---|
    | checked add `i32` | `checked_binop(Add, i32, ..)` | `@llvm.sadd.with.overflow.i32` |
    | checked mul `u8` | `checked_binop(Mul, u8, ..)` | `@llvm.umul.with.overflow.i8` |
    | int → int | `intcast(.., is_signed)` | `trunc` / `sext` |
    | int → float | `sitofp` / `uitofp` | same |
    | float → int | `fptosi_sat` / `fptoui_sat`, saturating, via the provided `cast_float_to_int` | `@llvm.fptosi.sat.i32.f32` / `@llvm.fptoui.sat.i8.f64` |
    | float → float | `fpext` / `fptrunc` | same |
    | thin `PtrToPtr` | `pointercast` | no instruction (opaque pointers) |
    | wide → thin | data pointer, no call | `ret ptr %a.0` |
    | expose | `ptrtoint` | same |
    | from address | `intcast(.., false)`, `inttoptr` | `zext` + `inttoptr` |
    | wide-pointer `<` | `icmp ULT`, `icmp EQ`, `icmp ULT`, `and`, `or` | same five, in order |
    | `PtrMetadata` | the pair's second value, no call | `ret i64 %ptr.1` |
    | `!` / float `-` | `not` / `fneg` | `xor -1` / `fneg` |
    | transmute u32 → f32 | `bitcast` | same |
    | `copy::<u32>` | `unchecked_sumul(4, n)`, `memmove(dst, 4, src, 4, ..)` | `mul nuw nsw i64 4, %n`, then `@llvm.memmove(ptr align 4 %d, ptr align 4 %s, ..)` |
    | `ptr_offset_from::<u32>` | `ptrtoint` ×2, `sub`, `exactsdiv(.., 4)` | same |
    | `ctpop` | forwarded to the backend's `codegen_intrinsic_call` | `@llvm.ctpop.i32` (made by cg_llvm) |
  - **What it covers:**
    - **binops with overflow checks**: `AddWithOverflow`/`MulWithOverflow` → `Pair` typed `(T, bool)`, and the two
      `bug!`s (a non-checkable op; an overflowing op in `codegen_scalar_binop`);
    - **plain binops**: 12 (op, float, signed) cases: add/fadd, sdiv/udiv, frem, unchecked s/u, xor, icmp S/U, fcmp,
      `Cmp` → `three_way_compare`;
    - `Offset`: `inbounds_nuw_gep` vs `inbounds_gep` by the offset's signedness;
    - **wide-pointer** `Lt` and `Eq`;
    - **unary**: `Not`, `Neg` int/float, `PtrMetadata` on wide (usize) and thin (`()`) pointers;
    - **int↔float casts with saturation**: the full cast table above, plus same-width float (no call);
    - **pointer casts**: thin→thin, wide→thin, wide→wide, expose, from-address;
    - **-O**: `assume_scalar_range` assumes `char`'s range (0..=1114111) before a cast, and nothing for `u32`;
    - **transmutes**:
      - Scalar→Scalar (`bitcast`);
      - an identical layout (no call);
      - a size mismatch (`unreachable_nonterminator` + poison);
      - Scalar→ScalarPair through the temporary (`alloca`, `lifetime_start`, store, `load_operand`,
        `lifetime_end`);
      - at -O, `transmute_scalar` u32→char skips the input assume and assumes the output range;
    - **aggregates**:
      - place form for `S { a, b, c }`: the const fast path gives up; per field `project_field` (`inbounds_ptradd`
        only at a nonzero offset, `restrict_for_offset` alignments) and a store; no discriminant;
      - operand form for `(u8, u32)` → `Pair` (see merge step 3);
    - **Repeat**: a `u8` element → one `memset`; a `u32` element → `write_operand_repeatedly(elem, 4, dest)`;
    - **Use**: a store with empty flags;
    - **intrinsics**:
      - `copy`;
      - `copy_nonoverlapping`, `ctpop` and the nullary `unreachable`, forwarded to the backend with their args and
        result layout;
      - `size_of` → the nullary-intrinsic `span_bug!`;
      - `ptr_offset_from`;
      - `-Zforce-intrinsic-fallback` → `Fallback` for an intrinsic with a body, not for one without;
      - `typed_swap_nonoverlapping` at -O0 → `typed_place_swap`;
      - `exact_div::<f32>` → `InvalidMonomorphization` (E0511, text as rustc's) and `Err`.
  - **naked_asm.rs, byte for byte against the oracle.** `codegen_naked_asm` runs over the port's real `instance_mir` of
    `#[unsafe(naked)]` fns, with a mock `cx` that captures `codegen_global_asm`'s template. The joined template
    lines must equal the oracle's `module asm` lines (between `.intel_syntax`/`.att_syntax` on x86):
    - x86_64-unknown-linux-gnu (ELF, function sections): `nk`, and `nk_al` with `#[rustc_align(16)]` → `.balign 16`;
    - aarch64-apple-darwin (Mach-O, `_`-prefixed names): the same two fns.
  - **Mutation check:** each of these makes the test fail:
    - wide-pointer `Lt` using `IntULE` instead of `IntULT`;
    - inverting the `OptLevel::No` early return in `assume_scalar_range`.
  - **Not covered:**
    - the place-form `Cast(Unsize)` of a non-pair destination (stub);
    - `ThreadLocalRef`, `Discriminant`, `Ref`/`RawPtr` (need `codegen_place` on real places), `WrapUnsafeBinder`;
    - atomics (need const generic orderings);
    - `vtable_size`/`align`, `size_of_val` (stubs);
    - the COFF/wasm/XCOFF arms of `prefix_and_suffix`;
    - the `wasm_*` helpers.
  - No environment variable reads. The test writes its crates to `$RUST_TS_DATA/tmp/ssa-rvalue-intrinsic/*.rs` (via
    `scripts/lib/common.ts` `DATA`, as operand_place.test.ts does). It temporarily sets `sess.opts.optimize` and
    `unstable_opts.force_intrinsic_fallback` and restores them in `finally`.
- Sample difftests, `RUST_TS_AGENT=ssa-rvalue-intrinsic`, `--sample 200 --jobs 6`, on AC power:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-140004-ssa-rvalue-intrinsic-h01j`.
  - `mir-o2`: **200/200 MATCH**, run `20261112-140057-ssa-rvalue-intrinsic-pf7t`.
  - `mir`: **200/200 MATCH**, run `20261112-140239-ssa-rvalue-intrinsic-if1n`.

## `// PORT:` decisions (for root to record)
1. **`impl FunctionCx` blocks as installers** (`install_FunctionCx_rvalue`, `install_FunctionCx_intrinsic`), the
   place.ts/operand.ts pattern. Methods use `this: FunctionCx<BackendTypes>` and `bx: BuilderMethods<BackendTypes>`.
2. **`abi::Layout::eq`** (interned pointer equality) is `operand.layout.layout === cast.layout`.
3. **`Ord::max`** on `Align` (derived `Ord` on `pow2`) and on `Size` (returns the second argument when equal) are
   local helpers.
4. **`u128::to_le_bytes` and `Itertools::all_equal_value`** (itertools 0.15.0, `Cargo.lock`) are local helpers.
   `all_equal_value`'s `Err` (empty or unequal) is `undefined`.
5. **`assert_ne!` with a message** (`transmute_scalar`'s vector check) is written out with core's text. The same
   holds for `assert_eq!` with a message in `wasm_type`.
6. **`{other:?}` of `Env`** (`bug!("unexpected coff env ..")`): `target_spec_enum!`'s derived `Debug` (rustc_target
   lib.rs:135) is a local helper, `Name` or `Other("..")`. The TS `TargetSpecOther` has no `Debug`.
7. **`writeln!` into a `String`** is a `MutRef<string>` append. The infallible `.unwrap()` is dropped. `emit_fatal`
   (`span_fatal`, `-> !`) throws, so its arms do not fall through.
8. The nested **`fn vector_can_bitcast`** (rvalue.rs:368) is a module-level function with its marker.
9. **`codegen_naked_asm`'s `Cx: LayoutOf + FnAbiOf + AsmCodegenMethods`** is `CodegenMethods<B> & AsmCodegenMethods`.
10. **`codegen_rvalue_operand`'s cast match** ends in `unreachable()` after the last arm. The arms are exhaustive over
    `CastKind`; this is only for TS control flow.
11. **`debug!`, `#[instrument]` and `debug_assert!`** (intrinsic.rs's final variant check, rvalue.rs's `Use`/field
    checks) stay comments. rustc ships without debug assertions.
12. **`template_vec.extend(template.iter().cloned())`** pushes the same piece objects. They are plain data that is
    never written.

# Review: lane `ssa-rvalue-intrinsic` (M7 wave 41, wave 40n)

**Verdict: PASS WITH NOTES**

Reviewed branch `t3/port-ssa-rvalue-intrinsics`, commits `36b2d3cc` (port) and `b97ac2a8` (tests, handoff), against `main` at
`51dfe33c` (`git diff 51dfe33c..b97ac2a8`), merged (fast-forward) into review branch `t3/review-ssa-rvalue-intrinsic`.
Upstream at the pin: `compiler/rustc_codegen_ssa/src/mir/rvalue.rs` (1,202 lines), `mir/intrinsic.rs` (645) and
`mir/naked_asm.rs` (522).

There are no must-fix findings. The five nits below are for root to apply at integration or to pass to the lane.

## Evidence (review branch, AC power, no gate running, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`)
- `bun scripts/coverage.ts --missing`: rvalue.rs **14/14**, intrinsic.rs **5/5**, naked_asm.rs **6/6**.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26384, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 390)`, the same figure as the handoff.
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/rustc_codegen_ssa/ ./src/std/result.test.ts`: **106 pass, 0 fail, 804 expects**, 16 files.
- No samples, as the brief asked. The lane's own runs are in the handoff: mono-ui, mir-o2 and mir, 200/200 each.

## 1. Order and coverage
- Complete and in upstream order. I checked every marker line against the `fn` line at the pin, and all are correct:
  - rvalue.rs: 23, 96, 102, 306, 335, 449, 497, 863, 889, 1014, 1056, 368, 1089, 1164;
  - intrinsic.rs: 18, 39, 57, 626, 640;
  - naked_asm.rs: 18, 62, 144, 417, 456, 504.
- Placement: the nested `fn vector_can_bitcast` (rvalue.rs:368) is hoisted to module level, between the `impl` block and
  `transmute_scalar`. That is the usual treatment of a nested fn, and coverage accepts it. N1 covers its missing `// PORT:`.

## 2. Logic fidelity
I read every function against upstream, arm by arm. Points checked in detail:

### rvalue.rs
- **`codegen_rvalue`**:
  - **`Use`**: `is_entirely_uninit_const` comes first. `CAPTURES_READ_ONLY` needs all three conditions, in the let-chain's
    order: `Ref(_, pointee, Not)`, `with_retag.yes()`, then `is_freeze`.
  - **`Cast(Unsize)`**:
    - a ScalarPair destination takes the operand path;
    - `Pair`/`Immediate` store to a scratch `alloca` between `storage_live` and `storage_dead`, then call
      `coerce_unsized_into` (stub);
    - `Ref` `bug!`s on `llextra` and otherwise uses `val.with_type(operand.layout)`;
    - `ZeroSized` `bug!`s.
  - **`Transmute | Subtype`** goes to `codegen_transmute`.
  - **`Repeat`**:
    - ZST: returns.
    - All-uninit constant: one `memset` of `undef`.
    - `try_init_all_same`:
      - `const_to_opt_u128`, then `to_le_bytes()[..elem size]` with `all_equal_value`, then `memset` of `const_u8(byte)`;
      - otherwise, if `from_immediate`'s `val_ty` equals `type_i8()`, a `memset` of the value;
      - only for `Immediate`.
    - Otherwise `write_operand_repeatedly` with the monomorphized count.
  - **`Aggregate`**:
    - the `RawPtr` guard falls through to the final `_` arm, as upstream's guard does;
    - the const fast path is tried first;
    - `project_downcast` is used only for `Adt`;
    - `assert_eq!(operands.len(), 1)` runs under an active field, and `active_field_index.unwrap_or(i)` picks the field;
    - `Array` uses `project_index(const_usize(i))` and everything else `project_field`;
    - uninit-const and ZST fields are skipped;
    - `codegen_set_discr` comes last.
- **`try_codegen_const_aggregate_as_immediate`**:
  - The allowlist is `Tuple`, or `Adt` with `_4` (active field) `None`.
  - It needs `Arbitrary` fields and `Single { index == variant }`.
  - The size is 1/2/4/8/16 bytes, and each type call happens before the field loop.
  - ZST fields are skipped, and any non-`Constant` operand bails.
  - The endian shift is kept. A u128 shift cannot overflow there, since offset + size ≤ 16.
- **`codegen_transmute`**:
  - two `is_sized` asserts;
  - a size mismatch or an uninhabited side gives `unreachable_nonterminator`;
  - otherwise it stores to `dst.val.with_type(src.layout)`.
- **`codegen_transmute_operand`**:
  - the Memory-non-ZST `span_bug!` (`{cast:?}` through `debug_TyAndLayout_Ty`) comes first, then the `Layout` identity
    early return (PORT 2), then the UB check with `poison`;
  - the match keeps upstream's arm order:
    - `cast.is_zst()` first;
    - Ref + Memory: `assert_eq!(llextra, None)`, then `load_operand`;
    - Scalar→Scalar when the sizes are equal;
    - `SimdVector` and `SimdScalableVector` when both sides `vector_can_bitcast`;
    - Pair↔ScalarPair when both sizes and `b_offset` are equal;
    - otherwise a temporary: `Ord::max` of align and size, `PlaceValue::alloca`, `lifetime_start`, store, `load_operand`
      of the cast, `lifetime_end`.
  - `Size_max` and `Align_max` match `Ord::max` (the second argument when equal).
- **`cast_immediate`**:
  - The input `assume_scalar_range(.., None)` comes first.
  - It keeps the six arms. `Float→Int` uses the *destination's* `is_signed`. `Int→Pointer` does `intcast` to `isize`, then
    `inttoptr`.
  - Saturation comes from the provided `cast_float_to_int` (builder.rs). The test runs the real one.
- **`codegen_rvalue_operand`**, every `CastKind` arm in upstream order:
  - **`PointerExposeProvenance`**: `ptrtoint`.
  - **`ReifyFnPointer`**: `resolve_for_fn_ptr`, then `get_fn_addr(.., pointer_authentication_functions())`.
    `Binder.no_bound_vars(args)` is right: at this pin `TyKind::FnDef` carries `Binder<GenericArgs>` (ty_kind.rs:223).
  - **`ClosureFnPointer`**: `resolve_closure(.., FnOnce)`.
  - **`UnsafeFnPointer`**: a no-op.
  - **`Unsize`**: `assert_matches!(ScalarPair)`, `pointer_parts`, then `unsize_ptr` (stub).
  - **`MutToConstPointer`/`ArrayToPointer`**: `bug!`.
  - **`PtrToPtr` with a ScalarPair operand**: wide→wide keeps the pair and wide→thin keeps the data pointer; anything
    else `bug!`s.
  - **The scalar group** (`IntToInt`, `FloatToInt`, `FloatToFloat`, `IntToFloat`, `PtrToPtr`, `FnPtrToPtr`,
    `PointerWithExposedProvenance`):
    - the non-scalar `bug!`;
    - `is_scalar_or_simd` assert;
    - an uninhabited operand returns `const_poison` early;
    - the non-scalar-cast `bug!`;
    - `cast_immediate`, and `bug!` on `None`.
  - **`Transmute | BoxDerefTransmute | Subtype`**: `codegen_transmute_operand`.

  The other `Rvalue` arms:
  - **`Ref`**: retags through `xlane.codegen_retag_operand` under `-Zcodegen-emit-retag`.
  - **`Reborrow`**: `codegen_operand(Copy(place))`.
  - **`RawPtr`**: `codegen_place_to_pointer`.
  - **Checked `BinaryOp`**: `codegen_scalar_checked_binop`, typed `(op.ty, bool)`.
  - **Plain `BinaryOp`**: Pair/Pair goes to `codegen_wide_ptr_binop`, Imm/Imm to `codegen_scalar_binop`, and anything else
    `bug!()`s.
  - **`UnaryOp`**: `Not`; `Neg` as `fneg`/`neg`; `PtrMetadata` with both asserts, field 1 or `()`;
    `is_expected_variant_for_type` is a real `assert!` and is kept as one.
  - **`Discriminant`**.
  - **`ThreadLocalRef`**: the shim `Instance { Shim(ThreadLocal), empty }`, `fn_abi_of_instance`, `fn_decl_backend_type`,
    attrs only when `has_codegen_attrs`, `call(.., Direct, [], None, Some(instance))`; otherwise `get_static`.
  - **`Use`**.
  - **`Repeat`**: the ZST assert.
  - **`Aggregate`**: `OperandRefBuilder`, then `codegen_tag_value`; `Err` gives `abort_immediate` + `poison`, `Ok` an optional
    `insert_imm` + `build`.
  - **`WrapUnsafeBinder`**.
  - **`CopyForDeref`**: `bug!`.
- **`codegen_scalar_binop`** keeps all arms in order:
  - float, signed and unsigned splits;
  - `Offset` uses `inbounds_nuw_gep` for an unsigned rhs and `inbounds_gep` otherwise, and a ZST pointee is a no-op;
  - `Shl`/`Shr` go through `build_shift_expr_rhs(.., op == *Unchecked)` (stub), with `ashr`/`lshr` by the lhs's signedness;
  - comparisons go through `bin_op_to_{f,i}cmp_predicate`;
  - **`Cmp`** does `assert!(!is_float)` and then `three_way_compare(lhs_ty, ..)`;
  - the `*WithOverflow` `bug!` text is upstream's.
- **`codegen_wide_ptr_binop`**: the `(op, strict_op)` table is exact (Le→(ULE, ULT), Ge→(UGE, UGT)), and the call order is
  icmp strict, icmp EQ, icmp op, `and`, `or`.
- **`codegen_scalar_checked_binop`**: Add/Sub/Mul map to `OverflowOp`, then `checked_binop(oop, input_ty, ..)`, and other ops
  hit the `bug!` with the upstream text.
- **`transmute_scalar`**:
  - the size `assert_eq!`;
  - the `assert_ne!` vector check, with core's message shape (`assertion \`left != right\` failed: msg\n  left: ..\n right: ..`);
  - a `from == to` early return;
  - `from_immediate`;
  - an input assume with `Some(to)`;
  - the six primitive arms, with the `Float↔Pointer` arms going through `isize`;
  - an output assume with `Some(from)`;
  - `to_immediate_scalar`.
- **`assume_scalar_range`**:
  - it returns at once under `OptLevel::No`;
  - the `(scalar, known)` match keeps its arm order: `Union`, then `None` with `is_always_valid`, then `contains_range`;
  - `Int` gives `assume_integer_range`, `Pointer(ZERO)` without 0 in range gives `assume_nonnull`.
  - `AddressSpace` is a branded number, so `===` is right.

### intrinsic.rs
- **`copy_intrinsic` / `memset_intrinsic`**: `unchecked_sumul` vs `mul`, and the `VOLATILE` flags. For `copy`, dst is
  `args[1]` and src `args[0]`; the volatile copies take dst `args[0]`, as upstream does.
- **`codegen_intrinsic_call`**:
  - **`-Zforce-intrinsic-fallback`**: `intrinsic(def_id)` with `!must_be_overridden` gives `Fallback(new_raw)`.
  - **`typed_swap_nonoverlapping`**: `is_ssa_standalone || optimize == No || arch == SpirV`, then two `deref(align)` and
    `typed_place_swap`.
  - **The nullary allowlist**: all 16 names and the `span_bug!` text are exact.
  - The arms that follow, in order:
    - **`abort_immediate`**.
    - **`caller_location`** (stub).
    - **`size_of_val` / `align_of_val`** (stub).
    - **`vtable_size` / `align`** (stub):
      - `signed_max() as u128` (`BigInt.asUintN(128, ..)`);
      - `max_for_target(..).bytes().into()`.
    - **`arith_offset`**.
    - **`copy`, `write_bytes`, the volatile copies and `volatile_set_memory`**.
    - **`volatile_store` / `unaligned_volatile_store`**.
    - **`disjoint_bitor`**.
    - **`exact_div`**: the `BasicIntegerType` error.
    - **The `*_fast` and `*_algebraic` ops**: the `BasicFloatType` error.
    - **`float_to_int_unchecked`**: both `FloatToIntUnchecked` checks, then `fptosi`/`fptoui`.
    - **The atomics**: `const_at(n).to_value()`, `parse_atomic_ordering`, `try_to_bool().unwrap()`, and
      `OperandRefBuilder` for cmpxchg. The `ret_ptr` flags, and the `ty_op == ty_mem || (raw ptr && usize)` rule for
      RMW, are as upstream.
    - **The fences**.
    - **`nontemporal_store`**.
    - **`ptr_offset_from` / `_unsigned`**.
    - **`cold_path`**.
    - **The default arm**: it forwards to `bx.codegen_intrinsic_call(instance, args, result_layout, result_place, span)`
      and returns any non-`Operand` result as it is.
  - The final `debug_assert!` stays a comment.
- **`int_type_width_signed`** falls back to `pointer_width` for `isize`/`usize`. **`float_type_width`** is as upstream.

### naked_asm.rs
- **`codegen_naked_asm`**:
  - `assert!(!has_infer)`;
  - the `InlineAsm` terminator `bug!`;
  - operands mapped in order;
  - `mangled_name`, `fn_abi_of_instance(.., empty)`;
  - the template is begin + upstream pieces + end;
  - `asm_target_features` are passed as strings.
- **`inline_to_global_operand`**:
  - **`Const`**: `instantiate_mir_and_normalize_erasing_regions` + `eval(..).expect(..)`, then a `{:#?}` (PRETTY)
    `span_bug!` on a non-Scalar, then `asm_const_ptr_clean`.
  - **`SymFn`**: `expect_resolve`, then `reserve_and_set_fn_alloc(.., CTFE_ALLOC_SALT)` typed `new_fn_ptr(fn_sig)`.
  - **`SymStatic`**: thread-local or `reserve_and_set_static_alloc`.
  - The remaining operand kinds `bug!`.
- **`prefix_and_suffix`**:
  - Visibility becomes `Hidden` for compiler-builtins unless the linkage is `Internal`.
  - The alignment is the attribute's, or the default: 16 on COFF, 4 elsewhere.
  - The ARM `.thumb`/`.arm` prefix and suffix table is exact.
  - `write_linkage` keeps every linkage arm. `emit_fatal` is `span_fatal`, so nothing falls through.
  - Per format:
    - **ELF**:
      - the section: `.pushsection <link_section>`, `.pushsection .text.<name>` (function sections) or `.text`;
      - then `.balign N`, the linkage, `.protected`/`.hidden`, `.type name, @function` (`%function` on ARM), the arch
        prefix and the label;
      - the end: an empty line, `.Lfunc_end_`, `.size name, . - name`, `.popsection` (only with a link section or
        function sections), and the arch suffix.
    - **Mach-O**:
      - `.pushsection ..,regular,pure_instructions` or `.section __TEXT,__text,..`;
      - `.balign`;
      - `.private_extern` for Hidden only;
      - `.popsection` only for a link section.
    - **COFF**:
      - the `.def/.scl 2/.type 32/.endef` block;
      - the section choice by `function_sections`, then Env: Gnu `.text$name` (the TS template `` `.text$${asm_name}` ``
        is right), Msvc, or Unspecified with `Uefi` and its `bug!`s;
      - the linkage comes *before* `.balign` here, as upstream has it.
    - **Wasm**: `.section ..,"",@`; no alignment; `.functype`; `end_function`.
    - **XCOFF**: `.align N` and no section.
  - Upstream uses `.balign`, not `.p2align`, everywhere, and so does the port.
- **`wasm_functype` / `wasm_type` / `wasm_primitive`**:
  - the hidden-return pointer;
  - the comma rules;
  - the `Cast` asserts, with core's `assert_eq!`-with-message text;
  - the `..=4`/`..=8` bands;
  - the `F16B`/`PpcF128` `bug!`s and `"i64, i64"` for I128/F128;
  - the `unreachable!` messages carry the `internal error: entered unreachable code: ` prefix, as elsewhere in the
    port (`std/panic.ts` `unreachable` does not add it).

## 3. No guessed values
Every cross-lane call is a typed, module-private stub that stops with `unported("<lane>: <path> <fn>")`. Each named
function exists upstream where stated, and each owner matches `docs/next.md`'s lane table:

| stub | upstream (pin) | owner |
|---|---|---|
| `base_coerce_unsized_into` | base.rs:272 `coerce_unsized_into` | ssa-base |
| `base_unsize_ptr` | base.rs:225 `unsize_ptr` | ssa-base |
| `base_build_shift_expr_rhs` | base.rs:334 `build_shift_expr_rhs` | ssa-base |
| `FunctionCx_eval_mir_constant` | mir/constant.rs:25 `eval_mir_constant` (returns `mir::ConstValue`, as the stub types it) | ssa-mir-rest |
| `FunctionCx_get_caller_location` | mir/block.rs:2187 `get_caller_location` | ssa-block |
| `size_of_val_size_and_align_of_dst` | size_of_val.rs:14 `size_and_align_of_dst` | ssa-mir-rest |
| `meth_VirtualIndex_from_index_get_usize` | meth.rs:14 `from_index`, :56 `get_usize` | ssa-mir-rest |

None of these is already ported on `main` (`base.ts` has only the `bin_op_to_*` predicates). The lane returns no guessed
values.

## 4. Conventions
- **Installers**: `impl FunctionCx` is in `install_FunctionCx_rvalue` / `install_FunctionCx_intrinsic`, with
  `declare module "./mod.ts"` merges. There are no top-level prototype writes (`grep prototype` finds only
  `FunctionCx_.prototype` inside the installers).
- **Readonly values**: no field of an `OperandRef`, `PlaceRef` or `PlaceValue` is written anywhere in the three files.
  Upstream's copy-and-mutate sites build new objects (`new OperandRef(..)`, object-literal `OperandValue`s,
  `with_type(..)`).
- **Merge step 2 checked**: I applied the handoff's operand.ts repoint in the worktree, then reverted it:
  - the `transmute_scalar` import;
  - `fx.codegen_transmute_operand(..)`.

  With the repoint, `tsc` is clean and `rvalue_intrinsic.test.ts` and `operand_place.test.ts` pass (4/4). The
  operand.ts ↔ rvalue.ts cycle loads fine.

## 5. Tests
- **Sequences re-derived from upstream.** I derived nine sequences myself, and each matches the test exactly:
  1. checked `i32` add: rvalue.rs:665 → :1056 `checked_binop(Add, i32, ..)`, typed `(i32, bool)`;
  2. wide-pointer `Lt` (:1035): icmp ULT addr, icmp EQ addr, icmp ULT extra, `and`, `or`;
  3. from-address `u8 → *const u8`: `intcast(.., isize, false)`, then `inttoptr`;
  4. `-O` `char → u32`: the input `assume_integer_range(0..=1114111)`, then `intcast`. `u32` has no assume, being
     always valid;
  5. `u64 → (u32, u32)` transmute: the temporary path (:432-441), size 8 and align 8;
  6. `-O` `transmute_scalar` u32→char: no input assume (the full range contains char's), `bitcast`, the output assume;
  7. the `S` place aggregate: the fast path bails on a non-constant field. Then field a at offset 6 (`restrict_for_offset`
     gives align 2), b at 0 (no `ptradd`), c at offset 4 with align 4, and no discriminant;
  8. `Repeat`: `val_ty == i8` gives one `memset` for `u8`, and `u32` gives `write_operand_repeatedly(.., 4, ..)`;
  9. `copy::<u32>`: `unchecked_sumul(4, n)`, then `memmove(dst = args[1], 4, src = args[0], 4, ..)`.
- **Oracle facts.** I recompiled three of the quoted `ORACLE_*` facts with the pinned rustc (`rustc 1.101.0-nightly
  (6f5da406b 2026-10-10)`, `-Copt-level=0 -Cno-prepopulate-passes`, x86_64-unknown-linux-gnu). All three are exact:
  - `ORACLE_wide_lt`: `icmp ult ptr` / `icmp eq ptr` / `icmp ult i64` / `and i1` / `or i1`;
  - `ORACLE_cp`: `mul nuw nsw i64 4, %n` / `@llvm.memmove.p0.p0.i64(ptr align 4 %d, ptr align 4 %s, ..)`;
  - `ORACLE_f2u`: `@llvm.fptoui.sat.i8.f64`.
- **naked_asm against the pinned rustc.** The test's `NAKED_SRC` compiled with the pinned rustc
  (`--emit=llvm-ir -Copt-level=0`):
  - x86_64-unknown-linux-gnu: both functions' `module asm` lines between `.intel_syntax` and `.att_syntax` equal the
    test's ten expected lines **exactly**;
  - aarch64-apple-darwin: the six lines per function equal the test's, plus a trailing `""` (see N4).

  So the comparison is real: the joined template is the exact `module asm` text cg_llvm receives.
- **Mutation check.** Inverting the `OptLevel::No` early return in `assume_scalar_range` makes the test fail (2 pass,
  1 fail). That confirms the handoff's mutation claim. The file was restored.
- **The tuple aggregate that accepts either outcome** (rvalue_intrinsic.test.ts:502) is acceptable as a temporary state.
  Today it takes the stop branch, through operand.ts's stub. After merge step 2, I forced the test to require the
  non-stop branch, and it passes with `Pair(%c:i8, %u:i32)` and no builder call. So the post-repoint branch is real and
  correct. The removal is stated in the handoff (merge step 3) but not in the test itself (N2).

## 6. Scope
`git diff --stat 51dfe33c..b97ac2a8` shows only:
- the three new port files;
- the new `rvalue_intrinsic.test.ts`;
- `docs/handoff/ssa-rvalue-intrinsic.md`.

`mod.ts`, `operand.ts` and `place.ts` are untouched; their edits are root's merge steps 1-2.

## Findings

No **F** (must fix) findings.

**N1. Several handoff `// PORT:` decisions have no `// PORT:` comment in the code** (PORTING §3: judgment calls get a
`// PORT:` comment).
- Covered already: decisions 1, 7 and 9 by the file headers, and 2 and 10 by inline comments (rvalue.ts:467, :719).
- Covered by a plain doc or helper comment only:
  - 3, `Ord::max` (rvalue.ts:1299/1304 ↔ rvalue.rs:433-434);
  - 4, `to_le_bytes`/`all_equal_value` (rvalue.ts:1309/1317 ↔ rvalue.rs:223-224);
  - 5, the `assert_ne!` expansion (rvalue.ts:1190 ↔ rvalue.rs:1097) and `assert_eq!` with message
    (naked_asm.ts:635 ↔ naked_asm.rs:478/480);
  - 6, `debug_TargetSpecOther` (naked_asm.ts:641 ↔ naked_asm.rs:349);
  - 8, the hoisted `vector_can_bitcast` (rvalue.ts:1172 ↔ rvalue.rs:368);
  - 12, `template_vec.push(...template)` (naked_asm.ts:60 ↔ naked_asm.rs:54).

Prefix those comments with `// PORT:` so they are greppable. This is cosmetic, with no behaviour change.

**N2. The tuple-aggregate test (rvalue_intrinsic.test.ts:502) needs an explicit marker in the test to drop the stop
branch** ↔ rvalue.rs:811 / operand.rs `insert_field`.
- Only the handoff says to drop it.
- Root should remove the `msg !== undefined` branch in the same integration commit that repoints operand.ts (merge
  step 2). The post-repoint branch is verified (§5).
- Until then, add a comment such as `// remove the stop branch when operand.ts's transmute_scalar stub is repointed`.

**N3. The place-form aggregate test builds ill-typed MIR** (rvalue_intrinsic.test.ts:520 ↔ rvalue.rs:255-293). `S.c` is
`u16`, but its operand is `copy_(3)` (`_c: u8`).
- The trace is right in shape: offsets, alignments and store order are fixed by the destination's layout. But it stores a
  `u8` operand into a `u16` field.
- Fix: add a `u16` argument to `f` and use it, or note why the mismatch does not matter.

**N4. The naked-asm test's comments overstate the comparison for Mach-O** (rvalue_intrinsic.test.ts:12 and :698 ↔
naked_asm.rs:289-310).
- The final `""` in each expected list comes from splitting the template's trailing `\n`.
- On ELF that coincides with the oracle's empty line before `.att_syntax`. On aarch64-apple-darwin the oracle `module asm`
  has no such line, as cg_llvm adds no syntax wrapper there.
- The template still matches byte for byte. Only the wording "lines must equal the oracle's `module asm` lines" is loose.
  Say "the joined template equals the oracle's `module asm` text (newline-terminated)".

**N5. The `-Zforce-intrinsic-fallback` block restores `force_intrinsic_fallback` to a literal `false`, not the saved value**
(rvalue_intrinsic.test.ts:614).
- `optimize` is saved and restored properly in `with_opt`.
- Harmless today, as the default is `false`, but save and restore it the same way.

## For root
- Merge steps 1-2 in the handoff are correct. Step 2 was test-applied here: tsc clean, the tests pass, and the
  tuple-aggregate test takes the `Pair` branch.
- After step 2, apply N2.
- Nothing protected reaches this code yet: the backend is not registered, and no production module imports these files.

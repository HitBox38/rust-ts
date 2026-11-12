# Handoff: ssa-operand-place (M7, plan-m7 wave 41): `mir/operand.rs`, `mir/place.rs`, `ty/typetree.rs`

Branch `t3/port-ssa-operand-place` (from `620acf48`; no merges). Code commit `6e03e6da`.

## Summary
- `compiler/rustc_codegen_ssa/src/mir/operand.rs` (**31/31**) and `mir/place.rs` (**23/23**), in full and in upstream
  order with markers, replace ssa-contract's stub files `src/rustc_codegen_ssa/mir/{operand,place}.ts`. The four
  ssa-contract stubs (`PlaceValue::with_type`, `PlaceRef::alloca`, `OperandValue::store`, `store_with_flags`) are now
  ports.
- `compiler/rustc_middle/src/ty/typetree.rs` (**4/4**) goes in the new `src/rustc_middle/ty/typetree.ts`. The local
  `typetree_from_ty` stub in `traits/builder.ts` is gone; `typed_place_copy_with_flags` imports the port.
  Without `-Zautodiff=Enable`, `typetree_from_ty` returns `TypeTree::new()` before it looks at the type. That makes
  the memcpy path of every typed copy runnable (hello world's path).
- About 2,050 TS lines for 2,037 upstream lines.

## Files touched
- `src/rustc_codegen_ssa/mir/operand.ts`, `src/rustc_codegen_ssa/mir/place.ts`: rewritten; my files.
- `src/rustc_middle/ty/typetree.ts`: new; my file.
- `src/rustc_codegen_ssa/traits/builder.ts`: the `typetree_from_ty` stub is replaced by an import, as the brief
  asked. The unused `TyCtxt` and `unported` imports are dropped.
- `src/rustc_codegen_ssa/mir/mir_core_shim.ts`: new, **temporary**. See "Merge steps".
- `src/rustc_codegen_ssa/mir/operand_place.test.ts`: new unit tests.
- `docs/handoff/ssa-operand-place.md`: this file.

## Merge steps for root (with ssa-mir-core)
ssa-mir-core ports `FunctionCx`, `LocalRef` and `Locals` in parallel. We agreed the shapes over cross-session
messages: `FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends
BuilderMethods<B, Cx> = BuilderMethods<B, Cx>>`, `LocalRef<V>` as a `$` union with `_0` payloads, `Locals<V>.index(local)`,
and `monomorphize(value, d_T)`. Until that lands, my tree uses `mir_core_shim.ts`. At merge:
1. Delete `src/rustc_codegen_ssa/mir/mir_core_shim.ts`.
2. In `place.ts`, `operand.ts` and `operand_place.test.ts`:
   - point the `./mir_core_shim.ts` imports at `./mod.ts` (`FunctionCx`, `LocalRef`) and `./locals.ts` (`Locals`);
   - change both `declare module "./mir_core_shim.ts"` blocks to `declare module "./mod.ts"`.
3. In `mod.ts`, right after `class FunctionCx { ... }`, add:
   `install_FunctionCx_operand(FunctionCx); install_FunctionCx_place(FunctionCx);`
   imported from `./operand.ts` and `./place.ts`. The shim's last two lines do the same today.
4. Repoint ssa-mir-core's `xlane` stubs in `mod.ts` at the real functions: `PlaceRef.new_sized`, `PlaceRef.alloca_size`,
   `PlaceRef.alloca_unsized_indirect`, `PlaceRef#project_field`, `OperandRef.zero_sized`,
   `fx.monomorphized_place_ty(place_ref)`. Also available: `codegen_tag_value` (place.ts) and `OperandRefBuilder`
   (operand.ts).
5. The tests build `new FunctionCx(mir, cx, locals)` with the shim's three-field constructor. Against the real class,
   either construct it with all of mod.rs's fields, or make the test build a minimal object with
   `Object.create(FunctionCx.prototype)`.

**Why installers rather than PORTING §5's top-level `FunctionCx.prototype.x = ...`:** mod.ts imports place.ts and
operand.ts at run time (`PlaceRef.alloca`, `new OperandRef`, `OperandValue.store`). Suppose these files imported
mod.ts at run time and wrote the prototype at top level. Then any entry that loads mod.ts first would evaluate
place.ts before `class FunctionCx` exists, and hit its TDZ. With the installers, place.ts and operand.ts import
mod.ts for types only, and mod.ts installs the methods once its class exists. That works whichever module loads
first. ssa-mir-core flags the same cycle in its handoff.

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| compiler/rustc_codegen_ssa/src/mir/operand.rs | 31/31 |
| compiler/rustc_codegen_ssa/src/mir/place.rs | 23/23 |
| compiler/rustc_middle/src/ty/typetree.rs | 4/4 |

`bun scripts/coverage.ts --check`: `markers ok (25978, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
library 744; llvm 354)`.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/rustc_codegen_ssa/mir/operand_place.test.ts`: **1 pass, 97 expects**. It compiles a no_core crate
  and takes the port's real layouts for its types: `S { u8, u32, u16 }`, `SF { u8, f64 }`, `E { A, B(u32) }`,
  `N { A(bool), B, C }`, the self-referential `L { *const L, f32 }`, tuples, `[u16; 4]`, `&f32`, `&[f32]`, `&&&&&&&u8`.
  A logging mock backend implements the traits: a method the mock does not define logs `name(args)` and returns a
  fresh value. Each test compares the exact sequence of builder calls with what the upstream source does on that
  layout:
  - `project_field`: offsets 6/0/4 from the reordered layout, `inbounds_ptradd` only at a nonzero offset,
    `restrict_for_offset` alignments, `unaligned` (and that it copies);
  - `project_index`: constant vs dynamic index offsets and alignments, from align 2 and align 8; `len`;
  - `OperandValue::store_with_flags`:
    - Immediate;
    - **scalar pair**: the second store at `+b_offset`, and the flags losing `CAPTURES_READ_ONLY` (9 → 1);
    - **ZST**: no calls;
    - Ref: through the provided `typed_place_copy_with_flags` to `memcpy`;
    - `volatile_store`;
    - the unsized `bug!`;
  - `try_pointer_parts`, `pointer_parts`, `deref`, `address`, `is_expected_variant_for_type`, `poison` per repr;
  - `from_immediate_or_packed_pair`, `immediate_or_packed_pair` (the extract/insert sequence), `immediate`,
    `zero_sized`, and the Debug forms of `OperandRef` and `OperandValue`;
  - `extract_field` on a pair;
  - `codegen_tag_value`: Direct (`E::B` → 1); Niche (`N::A` → None; `N::C` → `(2-1)+2 = 3`); a struct (None);
  - `codegen_set_discr`;
  - `codegen_get_discr`:
    - Direct, on a pair;
    - **Niche, by reference**: project to the tag, `load_operand`, `sub`, `intcast`, `icmp UGE`, `add` (delta 1),
      `select`, following the no-unsigned-wraparound arm;
  - `OperandRefBuilder`: `insert_imm`, `update_imm`, `build`, `from_existing`, and its ICEs;
  - `FunctionCx::codegen_place` through the shim: Field, ConstantIndex `from_end`, Downcast, PendingOperand ICE.
- **`typetree_from_ty` validation.** No oracle prints type trees without `-Zautodiff`, and the pinned toolchain has
  no Enzyme, so I derived each expectation by hand from `typetree.rs` and checked it against the port. The test
  turns on `opts.unstable_opts.autodiff = [Enable]` and checks:
  - empty without `Enable`, and empty with `NoTT`;
  - scalars (u32, bool, char, f32, f64) at offset -1;
  - `()` → empty;
  - `&f32` → Pointer(-1, 8) with child Float at offset 0 (reference target);
  - `&[f32]` → RustSlice, with the child taken from the element because `[f32]` has size 0;
  - `[u16; 4]` → a single entry at -1;
  - `(u8, f64)` → offsets 0 and 1. This is upstream's running sum of element sizes, not the layout offsets;
  - `SF` → layout field offsets 8 and 0, in declaration order;
  - `L` → Pointer whose child is empty (cycle detection), and v at 8;
  - an enum → empty;
  - `&&&&&&&u8` → six Pointer levels, then empty (`MAX_TYPETREE_DEPTH`);
  - the `FncTree` that `typed_place_copy_with_flags` hands to `memcpy`: `[tt.add_indirection(), same]`.

  Without `Enable`, the result is `TypeTree::new()` in every case. That is the only path non-autodiff programs
  reach, and it is a direct read of `typetree.rs:44-46`.
- The test's deliberate `bug!` checks leave ICE errors in its session, so the compiler aborts after the closure
  returns. The helper accepts that abort only once every check has run. A failing `expect` is not an unwind, so it
  still propagates and fails the test.
- `bun test ./src/std/result.test.ts ./src/rustc_codegen_ssa/common.test.ts ./src/rustc_codegen_ssa/mir/mod.test.ts`:
  37 pass.
- Sample difftests, `RUST_TS_AGENT=ssa-operand-place`, `--sample 200 --jobs 6`, on AC power:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0), run `20261112-052848-ssa-operand-place-n7bk`;
  - `mir-o2`: **200/200 MATCH**, run `20261112-053014-ssa-operand-place-9yz8`;
  - `mir`: **200/200 MATCH**, run `20261112-053058-ssa-operand-place-88g4`.

  `traits/builder.ts` now imports `rustc_middle/ty/typetree.ts` at run time, and no load-order problem showed.

## Every `unported(...)` left
In `place.ts`:
- `size_and_align_of_dst`: `"compiler/rustc_codegen_ssa/src/size_of_val.rs size_and_align_of_dst (plan-m7 MIR core
  group, no lane yet)"`. Reached only by `project_field` on an unsized field at a nonzero offset.
- `debug_V_or_stop`: `"ssa-operand-place: `{:?}` of a backend value without the backend's Debug impl"`. Reached only
  from an assertion or `bug!` that has already failed, in a method called without a `debug_V` (PORT 3).

In `operand.ts`:
- `transmute_scalar`: `"ssa-rvalue-intrinsic: compiler/rustc_codegen_ssa/src/mir/rvalue.rs transmute_scalar"`. Used
  by `OperandRefBuilder::insert_field`.
- `FunctionCx_codegen_transmute_operand`: `"ssa-rvalue-intrinsic: compiler/rustc_codegen_ssa/src/mir/rvalue.rs
  codegen_transmute_operand"`. Used by `extract_field` when the field has the same size as the value.
- `FunctionCx_eval_mir_constant_to_operand`: `"compiler/rustc_codegen_ssa/src/mir/constant.rs
  eval_mir_constant_to_operand (plan-m7 MIR core group, no lane yet)"`. Used by `codegen_operand` for constants.
- `FunctionCx_immediate_const_vector`: `"compiler/rustc_codegen_ssa/src/mir/constant.rs immediate_const_vector (...)"`.
  Used for SIMD constants.

In `mir_core_shim.ts` (temporary): `monomorphize` → `"ssa-mir-core: ... mod.rs monomorphize"`.

Root should assign constant.rs and size_of_val.rs: plan-m7 lists them under the MIR core group, but this wave's
ssa-mir-core covers only mod/analyze/locals. When a lane ports one of these, it repoints the matching
module-private stub to an import.

## `// PORT:` decisions (for root to record)
1. **Copy semantics (review N5).** `PlaceValue`, `PlaceRef` and `OperandRef` fields, and `OperandValue`'s payloads,
   are `readonly`. Where upstream copies a `Copy` value into a `mut` local and writes a field, the port builds a new
   object with that field changed. This covers `project_downcast`, `project_type`, `unaligned`, `codegen_place`'s
   `Subslice` arm (`layout`, then `val.llextra`), and `OperandRef { layout, ..o }` / `{ move_annotation, ..o }`. So a
   write can never reach a shared original. Grepping cg_llvm and the traits found no writer of these fields.
   `OperandRefBuilder`'s `OperandValueBuilder` slots stay mutable: upstream mutates them in place through `&mut
   self.val`, and the builder is never shared.
2. **`impl FunctionCx` blocks as installers.** `install_FunctionCx_place` and `install_FunctionCx_operand` hold the
   prototype assignments, with markers and the `declare module` merge. mod.ts calls them after `class FunctionCx`,
   and the files import mod.ts for types only. Reason: the TDZ cycle in "Merge steps". This departs from PORTING §5's
   "crate root imports extension files" form.
3. **`{:?}` of a backend value without a `bx`/`cx`** (`PlaceValue::with_type`, `OperandValue::pointer_parts`/
   `deref`, `OperandRef::immediate`, `OperandRefBuilder::from_existing`/`insert_imm`/`update_imm`): each takes an
   optional trailing `debug_V: Debug<V>`, and the port's own callers pass `bx.debug_Value`/`cx.debug_Value`.
   Without one, a message that formats `V` stops with `unported` rather than print a guess. This happens only on an
   assertion or `bug!` path that has already failed. Two callers outside my files don't pass `debug_V`:
   `traits/builder.ts`'s provided `typed_place_copy_with_flags` and `typed_place_swap` (`src.with_type(layout)`).
   They could pass `self.debug_Value`.
4. `OperandValue`'s methods live on a companion const typed by `OperandValue_methods`. They are assigned in upstream
   order: the two `impl` blocks, :92 and :973, are 900 lines apart.
5. `itertools::Either` (either-1.15.0) is rustc_middle mir/mod.ts's `Either`. The Debug forms are `Left(..)`/
   `Right(..)`. `unwrap_right`'s panic text is taken from either-1.15.0 src/lib.rs:847.
6. `u32` subtractions on variant indices (`niche_variants.last - start`, `variant_index - start`) are `>>> 0`,
   because rustc builds without overflow checks. `u128::wrapping_*` is `BigInt.asUintN(128, ..)`.
   `u128::is_power_of_two` is `v != 0 && (v & (v - 1)) == 0`. `RangeInclusive::contains` is written inline.
7. `flags & !MemFlags::CAPTURES_READ_ONLY` is `flags & ~CAPTURES_READ_ONLY`. bitflags' `!` truncates to the known
   flags, and a `MemFlags` holds only known flags.
8. `debug_OperandRef` (operand.rs:163, `write!(f, "OperandRef({:?} @ {:?})")`): the inner `{:?}` are plain whatever
   the caller's `#` (Rust does not forward the flag through `write!`).
9. typetree.rs: `Vec<AutoDiff>::contains(&Enable | &NoTT)` compares tags, since both are unit variants.
   `visited.contains(&ty)` is `includes` (interned `Ty`). `trace!` and `debug_assert_eq!` are comments.

## Notes
- Debug impls written: `debug_PlaceValue`, `debug_PlaceRef` (derived), `debug_OperandValue` (derived),
  `debug_OperandRef` (manual, :163), plus private ones for the builder. ssa-contract's PORT 11 deferred
  `InlineAsmOperandRef`'s Debug until `OperandRef`'s and `PlaceRef`'s existed; they exist now.
- The test writes its crate to `$RUST_TS_DATA/tmp/ssa-operand-place/agent-*/operand_place.rs` (1 KB).

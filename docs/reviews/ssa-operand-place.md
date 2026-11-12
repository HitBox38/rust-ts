# Review: lane `ssa-operand-place` (M7 wave 41)

**Verdict: PASS WITH NOTES**

Reviewed branch `t3/port-ssa-operand-place`, commits `6e03e6da` (port and tests) and `52dfcc7d` (handoff), against `main`
at `620acf48` (`git diff 620acf48..52dfcc7d`), merged into review branch `t3/review-ssa-operand-place`. Upstream at the pin:
`compiler/rustc_codegen_ssa/src/mir/operand.rs` (1,267 lines), `mir/place.rs` (541), `compiler/rustc_middle/src/ty/typetree.rs`
(229). There are no must-fix findings. The six nits below are for root to record or to pass on to later lanes.

## Evidence (run on the review branch, AC power, no gate running)
- `bun scripts/coverage.ts --missing`: operand.rs **31/31**, place.rs **23/23**, typetree.rs **4/4**.
- `bun scripts/coverage.ts --check --offline`: `markers ok (25978, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 354)`. I spot-checked every marker line in all three files against the `fn` line at the pin. All are
  correct and in upstream order, except `debug_OperandRef` (N2).
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/rustc_codegen_ssa/ ./src/std/result.test.ts`: **80 pass, 0 fail, 498 expects** (14 files). The `error: aborting
  due to 2 previous errors` line in the output is the deliberate-ICE session the handoff describes, and it is expected.
- I ran no samples, as the brief asked. The lane's own sample runs (mono-ui, mir-o2 and mir: 200/200 each) are in the handoff.

## 1. Order and coverage
Complete and in order. The `OperandValue` methods sit on the companion const and are assigned in upstream order across
the two `impl` blocks (:92, :973). That is PORTING §8's enum-method form. The only placement deviation is N2.

## 2. Logic fidelity
I read every function against upstream. Points checked in detail:
- **`OperandValue::store_with_flags`** (operand.ts:1188 / operand.rs:1029). It keeps the arm order. ZST emits nothing.
  `Ref` asserts sized, `bug!`s on `llextra`, then calls `typed_place_copy_with_flags`. `Immediate` stores
  `from_immediate`. For `Pair`:
  - it `bug!`s with `{:#?}` (PRETTY) on a non-ScalarPair layout;
  - the first store uses `dest.val.align`;
  - the second goes through `inbounds_ptradd(llval, const_usize(b_offset))` with `restrict_for_offset(b_offset)` and
    `flags & ~CAPTURES_READ_ONLY`.

  bitflags' `!` truncates to the known bits. The JS `~` gives a negative mask, but `&` with a non-negative `flags` gives
  the same value, so PORT 7 holds.
- **`from_const` / `from_const_alloc`**:
  - the `Slice` provenance comes from `CtfeProvenance_from_AllocId`, the `.into()`;
  - `read_scalar` reads provenance only for `Pointer` primitives and falls back to `const_poison` on `Err`;
  - the `Initialized` guards on Scalar and both halves of ScalarPair are kept;
  - `assert!(alloc_b_offset.bytes() > 0)` is kept;
  - `is_zst` comes before the load-from-static fallback.
- **`from_immediate_or_packed_pair` / `immediate_or_packed_pair` / `extract_field`**: the
  standalone-to-memory `span_bug!` is kept. So are the ZST, same-size and Pair arms, including the transmute stub on the
  same-size arm. The three `assert_eq!`s are kept, and `in_scalar != out_scalar` goes through `from_immediate` then
  `to_immediate_scalar`. The ScalarPair, Memory and SimdScalableVector field reprs `bug!()`.
- **`OperandRefBuilder`**:
  - `new`, `from_existing`, `insert_field`, `insert_imm`, `update_imm` and `build` keep the guarded arm order, including
    the `Right`/`Left` slot guards combined with `is_zero_offset`;
  - the Primitive-fields shortcut keeps its three asserts;
  - `unwrap_right`'s panic text matches either-1.15.0 src/lib.rs:847, which I checked;
  - `build` handles uninit-valid scalars and the SIMD `element.is_uninit_valid()` arm.
- **`PlaceRef::project_field`** (place.ts / place.rs:175):
  - `simple()` keeps the zero-offset case with no `ptradd`;
  - `llextra` comes from `type_has_metadata`, evaluated after `llval` as upstream does;
  - the three guard arms (`is_sized`, then `Slice | Str`, then offset 0) are in order;
  - in the unsized tail, `const_usize(offset)` comes first, then `size_and_align_of_dst` (a stub), then the packed cap
    (`icmp ULT` plus `select`), then `round_up_const_value_to_alignment` (`sub`/`neg`/`and`/`add`, the same sequence),
    then `ptradd` with `effective_field_align`.

  `project_index` uses `const_to_opt_uint`, falls back from `checked_mul` to the element size, and calls
  `inbounds_nuw_gep`. `project_downcast` and `project_type` are faithful.
- **`codegen_get_discr`** (operand.ts:560 / operand.rs:459):
  - the order is `dl`, then `layout_of`, then the uninhabited early return;
  - on `Single` it falls back to `FIRST_VARIANT`;
  - the tag is read through `extract_field` or `with_type(..).project_field(..)` + `load_operand`.

  The **Direct** arm computes `signed` only for non-bool `Int`. At `-O` and above it emits the `ctpop` assume when all
  inhabited discriminants are powers of two, and it never calls `discriminant_for_variant` for uninhabited variants.

  The **Niche** arm does these steps in upstream order:
  - pointer tags go through `ptrtoint` with `ptr_sized_integer`;
  - `relative_max` is a wrapping u32 subtraction (`>>> 0`);
  - with `relative_max == 0` it emits the `IntEQ` compare and `delta = 0`;
  - otherwise, it emits the `impossible` assume only when `niche_variants.contains(untagged)` holds and the build is
    optimized. The value is `wrapping_add`, then `wrapping_sub`, computed in 128 bits;
  - `niche_end` is `tag_size.truncate(..)`;
  - `sub` comes before `intcast`;
  - it tries `no_unsigned_wraparound == Ok(true)`, then the signed check, then the general `ULE`. Each wraparound arm has
    its start-or-end assert;
  - `add` runs only when `delta != 0`, then `select`.
- **`codegen_tag_value` / `codegen_set_discr`**: `is_variant_uninhabited` is checked first. Direct uses
  `const_uint_big(tag_llty, discr)`. Niche computes `(variant - start) >>> 0`, then `+ niche_start` in 128 bits, then
  `& unsigned_int_max()`, then `scalar_to_backend(Scalar::from_uint)`. `Err` aborts with `abort_immediate`.
- **`codegen_place`**: the four `LocalRef` arms are kept, and the operand-local deref uses an empty projection with
  `base = 1`. All 11 projection arms are present.
  - `ConstantIndex { from_end }` computes `len - offset`.
  - `Subslice` evaluates `project_index(const_usize(from))`, then `projection_ty`, then the new layout. Then, only when
    the result is unsized, it computes `sub(llextra.unwrap(), const_usize(from + to))`. That is upstream's evaluation
    order.
- **`maybe_codegen_consume_direct` / `codegen_consume` / `codegen_operand` / `move_copy_annotation_instance`** are faithful,
  including `move_copy_annotation_instance` running before `codegen_consume` for Copy and Move. The
  `MOVE_ANNOTATION_DEFAULT_LIMIT` bigint is 65.
- **typetree.rs** is faithful line by line:
  - `MAX_TYPETREE_DEPTH = 6` is checked before the cycle check;
  - the cycle check is `visited.includes(ty)` on interned `Ty`, with push and pop around the match;
  - the guarded `Adt` arms fall through in upstream order;
  - `handle_indirection` takes the slice-tail child from the element when `layout(inner).size == 0`, and otherwise
    from `inner_ty` as a reference target;
  - tuples use the running size sum;
  - struct fields use `layout.fields.offset(i)` in `all_fields` order.

## 3. The copy-semantics decision (ssa-contract N5)
These are all the places upstream writes a field of a `PlaceRef`, `PlaceValue` or `OperandRef` copy in
`rustc_codegen_ssa` and `rustc_codegen_llvm`. I searched for `\.(layout|val|llextra|llval|align|move_annotation) = `,
`&mut PlaceRef/OperandRef` and `ref mut`.

| upstream site | handled |
|---|---|
| place.rs:306 `project_downcast` `downcast.layout = ..` | new `PlaceRef` (this lane) |
| place.rs:316 `project_type` `downcast.layout = ..` | new `PlaceRef` (this lane) |
| place.rs:406 Subslice `subslice.layout = ..` | new `PlaceRef` (this lane) |
| place.rs:410 Subslice `subslice.val.llextra = Some(..)` | new `PlaceValue` + `PlaceRef`, keeping `llval` and `align` (this lane) |
| place.rs:331 `unaligned` `PlaceValue { align, ..val }` | new objects (this lane), and the test checks the original is unchanged |
| operand.rs:1100 `OperandRef { layout, ..o }`, :1162 `{ move_annotation, .. }` | new `OperandRef` (this lane) |
| locals.rs:76 `op.layout.ty = local_ty` | new `TyAndLayout` + `OperandRef` on ssa-mir-core's branch (mod.ts `overwrite_local`) |
| block.rs:1389, :1399 `op.val = ..` (`op` is `let mut op = self.codegen_operand(..)`, :1314) | later lane: see N1 |
| retag.rs:487 `variant_op.layout = ..` (`let mut variant_op = curr_operand`) | later lane: see N1 |

Every write in this lane builds a new object. Because the fields are `readonly`, `tsc` rejects any in-place write in TS.
The clean `tsc` run therefore shows that no current TS code writes these fields.

**The builder exception holds.** Upstream builds `OperandRefBuilder` only as a fresh `let mut builder` (rvalue.rs:825,
intrinsic.rs:438, retag.rs:409). It passes the builder only as `&mut`, and `build(&self)` only reads it. No site copies
a builder. In the port:
- `new` and `from_existing` allocate fresh `Either` slots and never share the operand's `OperandValue`;
- `build` returns fresh `OperandValue`s holding only the `V` payloads;
- the fields are `private`, and `OperandRefBuilder.fields` exposes them only to the derived Debug.

## 4. No guessed values
Every stop is an `unported(...)`. These four use the cross-lane form (`<lane>: <path> <fn>`):
- `transmute_scalar` (ssa-rvalue-intrinsic);
- `codegen_transmute_operand` (ssa-rvalue-intrinsic);
- the shim's `monomorphize` (ssa-mir-core);
- `size_and_align_of_dst`, which plan-m7 puts in the MIR core group but no lane owns yet. Its message format is N4.

`mir_core_shim.ts` is a pure seam. It holds type stand-ins, `Locals.index`, a constructor that only stores fields, a
`monomorphize` that stops, and the two installer calls. None of that logic needs to survive the merge, and it invents no
behavior. `debug_V_or_stop` never prints a guessed rendering, and it is reached only after an assertion has already
failed. See N3.

## 5. The installer deviation (PORTING §5)
**The installers are needed.** mod.ts needs operand.ts and place.ts at run time: ssa-mir-core's mod.ts imports
`OperandRef`, `OperandValue` and `PlaceRef`. So a top-level `FunctionCx.prototype.x = ..` in operand.ts or place.ts would
run before `class FunctionCx` initializes whenever mod.ts loads first, and hit the TDZ. A crate-root import order cannot
fix that, because ES module imports are hoisted.

The installers are hoisted `function` declarations, so mod.ts can call them even while operand.ts is still mid-cycle.
That makes the pattern robust in every load order.

The deviation is documented in the `PORT (ssa-operand-place)` headers (place.ts:3-17, operand.ts:3-11) and as handoff
PORT 2. It has no `// PORT:` line at the installer functions themselves (N5).

**The merge steps are complete.** I checked them against `t3/port-ssa-mir-core` (`6f3512fa`):
- `FunctionCx<B, Cx, Bx>`, `public locals: Locals<B["Value"]>` with `index(local)`, `LocalRef` with `readonly _0`, and
  `monomorphize<T>(value, d_T)` all match the shim;
- the six `xlane` stubs named in step 4 exist at that branch's mod.ts:886-910;
- the class body declares none of the methods the `declare module` blocks add, so there is no name collision;
- step 5, the test's three-field constructor, is needed: the real constructor takes about 20 fields.

## 6. Tests
The expectations are derived from upstream source and checked against independent layout facts, not copied from the
port's output. Each expected call sequence comes with a comment tracing the upstream arm. I re-derived these by hand from
upstream code:
- **`&f32`**: `handle_indirection`, then a non-slice tail, then the child `impl_inner(f32, depth 1, is_reference_target)`,
  giving `Float` at offset 0. Result: `[Pointer(-1, 8, [Float(0, 4)])]`. ✓
- **`&[f32]`**: the tail is `Slice(f32)` and `layout([f32]).size == 0`, so the child is `impl_inner(f32, .., false)`.
  Result: `[RustSlice(-1, 8, [Float(-1, 4)])]`. ✓
- **`(u8, f64)`**: running offsets 0 then 1, and `Type::from_ty` keeps size, kind and child (rustc_ast typetree.rs:82).
  Result: `[Int(0, 1), Double(1, 8)]`. ✓
- **`SF { u8, f64 }`**: layout offsets 8 and 0, in `all_fields` order. Result: `[Int(8, 1), Double(0, 8)]`. ✓
- **`L { *const L, f32 }`**: the pointer's child revisits `L`, which is in `visited`, so the child is empty. `v` is at 8.
  ✓
- **`&&&&&&&u8`**: depths 0..=5 each produce a Pointer at offset -1, and depth 6 hits the limit, giving six levels. ✓
- **The memcpy `FncTree`**: `add_indirection` is `Pointer(0, size 1, child)` (rustc_ast typetree.rs:63-64), and
  traits/builder.rs:537-540 passes `[tt.clone(), tt]`. ✓
- **Niche `get_discr` on `N { A(bool), B, C }`**: the tag range is 0..=3, `relative_max` is 1, and
  `niche_end = 3 = range.end`, so the result is `icmp UGE tag, 2`, then `add` with delta 1, then `select`. ✓
- **Niche `codegen_tag_value(N::C)`**: `(2-1)+2 = 3`. ✓
- **Pair store flags**: `9 & ~8 = 1`. ✓
- **`project_field` offsets on `S`**: `[6, 0, 4]` with alignments 2 and 4. ✓

## 7. Scope
The diff touches only the lane's files: operand.ts, place.ts, the new typetree.ts, the new shim, the new test and the
handoff. The one other change is the `traits/builder.ts` stub-to-import swap, which also drops the now-unused `TyCtxt`
and `unported` imports.

## Findings

### Must fix (F)
None.

### Nits (N)
- **N1** (for root to pass on): upstream writes copied operands at block.rs:1389 and :1399 (`op.val = Ref(arg.val)` /
  `op.val = arg.val`) and retag.rs:487 (`variant_op.layout = ..`). Those lanes will need the same new-object form.
  The handoff's PORT 1 says "grepping cg_llvm and the traits found no writer", which is true for those files but leaves
  out these later-lane sites in rustc_codegen_ssa. Nothing is silently wrong, because `readonly` makes `tsc` reject the
  in-place write.
- **N2** operand.ts:837 `debug_OperandRef` (operand.rs:163) sits after the whole `OperandRef` class, after
  `codegen_get_discr` (:459), not between the struct and its first `impl`. It is a hoisted function declaration, so it
  could go directly above `class OperandRef` (operand.ts:260), next to the struct as upstream has it.
- **N3** `debug_V` is an optional trailing parameter (handoff PORT 3). A caller that forgets it turns a failed
  assertion's ICE (exit 101 with upstream's message) into an UNPORTED stop (exit 70). This can never change a passing
  output.
  - Current callers outside the lane: traits/builder.ts:835, :836, :869, :877 (`with_type(layout)` in
    `typed_place_copy_with_flags`/`typed_place_swap`). They should pass `self.debug_Value`.
  - Later callers that must pass it: intrinsic.rs:439-440 `insert_imm`, retag.rs:409 `from_existing`, retag.rs:440 and
    :507-510 `update_imm`.
- **N4** operand.ts:75-91 (constant.rs stubs) and place.ts:44 (`size_and_align_of_dst`) use the message form
  `"compiler/.../<file>.rs <fn> (plan-m7 MIR core group, no lane yet)"`, with no `<lane>:` prefix, because no lane owns
  constant.rs or size_of_val.rs yet (plan-m7 table: MIR core). No other stop message in the tree uses this form. Root
  should assign those files, and the lane that ports each one should repoint the stub as the handoff says.
- **N5** place.ts:367 `install_FunctionCx_place` and operand.ts:1250 `install_FunctionCx_operand` have doc comments but no
  `// PORT:` line naming the PORTING §5 deviation at the definition. The headers carry the note. A one-line
  `// PORT: installer instead of top-level prototype writes (TDZ cycle with mod.ts; header)` at each would make the
  deviation greppable where it is.
- **N6** operand.ts:979 `insert_field` drops upstream's first arm, `(OperandValue::ZeroSized, _) => unreachable!("Handled
  above")` (operand.rs:834). It cannot run after the early return, but keeping it as a comment would preserve arm order.

# Review: lane `ssa-mir-rest` (M7 wave 41, wave 40n)

Reviewer: independent, read-only on code. Branch `t3/port-ssa-mir-rest`, commits `4736b3d2` (code and tests), `e54a064e`
and `3bb68692` (handoff), against `main` at `51dfe33c` (`git diff 51dfe33c..3bb68692`). Upstream: `$RUST_TS_DATA/rust`
at the pin (`6f5da406b`).

## Verdict: **PASS WITH NOTES**

There are no must-fix findings. Every ported function follows upstream in order and logic, and the markers are right.
Both decisions are faithful to how the port treats the dep graph and to upstream's derived codec. The four oracle facts I
regenerated reproduce. The four test sequences I re-derived from upstream match. The notes below are about the accuracy of
the handoff and things root should know at integration.

## Commands (AC power, no gate running, `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`)

| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean (exit 0) |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26407, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 390)` |
| `bun test ./src/rustc_codegen_ssa/ ./src/rustc_session/ ./src/rustc_middle/ ./src/std/result.test.ts` | **598 pass, 0 fail** (64 files) |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass, 0 fail (no unlisted env reads) |

## 1. Order and coverage

`bun scripts/coverage.ts --missing`:

| upstream file | ported |
|---|---|
| `rustc_codegen_ssa/src/mir/constant.rs` | 4/4 |
| `rustc_codegen_ssa/src/mir/statement.rs` | 1/1 |
| `rustc_codegen_ssa/src/mir/coverageinfo.rs` | 1/1 |
| `rustc_codegen_ssa/src/mir/retag.rs` | 21/21 |
| `rustc_codegen_ssa/src/mono_item.rs` | 6/6 |
| `rustc_codegen_ssa/src/meth.rs` | 8/8 |
| `rustc_codegen_ssa/src/size_of_val.rs` | 1/1 |
| `rustc_session/src/session.rs` | 96/104 |

These match the handoff. The eight session.rs functions still missing are the ones the handoff lists (:125, :134, :170,
:231, :566, :572, :799, :825).

Markers I spot-checked against the `fn` line: constant.rs :15/:25/:39/:67, statement.rs :12, coverageinfo.rs :8, retag.rs
:26/:57/:69/:97/:140/:191/:268/:316/:356/:367/:371/:384/:388/:399/:417/:428/:519/:569/:605, meth.rs
:14/:18/:36/:46/:56/:75/:103/:126, size_of_val.rs :14, mono_item.rs :12/:18/:25/:29/:57/:89, and session.rs
:186/:301/:863/:1092/:1125/:1144. All correct and in upstream order.

In session.ts, `needs_plt` sits between `at_least_rust_2024` (:858) and `emit_lifetime_markers` (:883), and
`direct_access_external_data` sits after `contract_checks` (:1088). The `target_can_use_split_dwarf` (:808) marker after it
was already out of place before this lane. `branch_protection` and `must_emit_unwind_tables` sit after `stack_protector`
(:1112), ahead of `codegen_units` (:1183).

## 2. Logic fidelity

I read every function against upstream. None diverges.

**constant.rs**
- `eval_mir_constant_to_operand` and `eval_mir_constant` have the same `expect` text.
- In `eval_unevaluated_mir_constant_to_valtree`, the arms are `Unevaluated` → `shrink`, then `Ty`/`Value` → `Ok(Ok(valtree))`,
  then `span_bug!("{other:#?}")` twice. The second `monomorphize(uv)` and `const_eval_resolve_for_typeck` are kept.
- In `immediate_const_vector`:
  - the `ok().map(ok).flatten()` is correct;
  - the `assert_eq!` text is core's;
  - the two `bug!` texts use `{:?}` (PLAIN) and `{:#?}` (PRETTY) as upstream;
  - the error path is `ShuffleIndicesEvaluation` plus `const_undef`.

**statement.rs**
- Every `StatementKind` arm is there, in upstream order, and the no-op set is complete (`FakeRead`, `AscribeUserType`,
  `ConstEvalCounter`, `PlaceMention`, `BackwardIncompatibleDropHint`, `Nop`).
- `needs_retag` is `codegen_emit_retag.is_some() && rvalue_needs_retag`.
- In the ZST `Operand` arm, the retag result is discarded, as upstream does.
- The `UnsizedPlace` `span_bug` text keeps the continuation-line space ("`` `UnsizedPlace({ty})` into `{rvalue:?}` ``").
- `SetDiscriminant` uses `codegen_place(..).codegen_set_discr`.
- `StorageLive`/`StorageDead` call `storage_live`/`storage_dead` only for `Place`/`UnsizedPlace`. Lifetime markers at each
  opt level are decided downstream, unchanged and correct:
  - place.ts:333-340 calls `bx.lifetime_start`/`lifetime_end`;
  - rustc_codegen_llvm builder.ts:1982 checks `sess.emit_lifetime_markers()`.
- `Assume` is `assume(op.immediate())`.
- `CopyNonOverlapping` follows upstream:
  - operands are evaluated in the order dst, src, count;
  - a non-`RawPtr` `dst` is `bug!("expected pointer")`;
  - the pointee layout is `expect("expected pointee to have a layout")`;
  - the length is `unchecked_sumul(count, const_usize(size))`;
  - the copy is `memcpy` with the pointee's ABI alignment, `MemFlags::empty()` and `None`.

**coverageinfo.rs**: `inlined_instance(source_scopes)` is monomorphized if present, else `self.instance`; then
`add_coverage`.

**retag.rs**
- **Retag kinds.** `build`'s match order is `Ref`, `RawPtr`, `Adt` if `is_box`, `is_like_maybe_dangling`, then
  `walk_value`. `emit_retag`:
  - `is_mutable` is `Mut | None`;
  - `is_protected` is `is_fn_entry && (!is_mutable || is_unpin)`;
  - the `all_pinned` / `implicitly_pinned` early return comes next, then the `is_mutable && !is_unpin` return;
  - `all_im` gives a null `im_layout`;
  - the four flag sets are in upstream order;
  - `unwrap_or_default()` gives both flags `false`, which is `CodegenRetagOptions`' derived `Default`.
- **`visit_box`.**
  - The asserts on field counts 2/2/1 are kept; the first has core's `assert_eq!(.., "msg")` text.
  - `for_field(ZERO)` is applied twice.
  - The `Pat` check and the `builtin_deref(true) == Some(boxed_ty)` assert are kept.
  - The allocator field (`ONE`) always goes through `build`.
- **`alloc_ranges`.**
  - The pairs are `(offset, width)` `u64`s in native byte order. The test pins little-endian
    `4 0 0 0 0 0 0 0 4 0 0 0 0 0 0 0`, which is the host's order, as upstream's `to_ne_bytes`.
  - The alignment is `ptr_sized_integer().align().abi`.
  - Then come `mk_const_alloc`, `reserve_and_set_memory_alloc`, `unwrap_memory` and `static_addr_of(.., None)`.
- **`PerByteTracking`.**
  - `visit_layout`'s early returns are in upstream order: ZST, then `excludes`, then `imprecise`.
  - The `contains || union_or_primitive || has_multiple_variants` test is kept.
  - The field offset is `field_offset + offset`.
  - `excludes` uses `bx.cx().typing_env()` for `UnsafeCell` and `bx.typing_env()` for `UnsafePinned`, as upstream.
- **Enum/`Option` paths.**
  - `walk_value` builds variant plans over `variants.indices()` with `for_variant`.
  - In `retag_operand`, a constant discriminant (`const_to_opt_u128(.., false)`, `val as usize`) selects one plan.
  - Otherwise there is a scratch alloca: `storage_live`, then `store_with_annotation`, `retag_variants`, `load_operand`,
    `storage_dead`. Then `update_imm` runs at `offset` and at `offset + Size::from_bytes(1)` for a `Pair`, upstream's
    literal 1.
  - `retag_place` does `load_operand` and `codegen_get_discr`, then `retag_variants`.
  - In `retag_variants`, `append_sibling_block("retag_join")` comes before the loop. Each variant gets
    `discriminant_for_variant(..).expect("Invalid variant index.")` and a `retag_variant` block that ends in `br(join)`.
    After the loop, `switch(discr, join, blocks)` runs from the root block.
- **The copy at retag.rs:487** (`variant_op.layout = …`) builds a new object, as required: retag.ts:622 has
  `new OperandRefC(curr_operand.val, curr_operand.layout.for_variant(bx, ix), curr_operand.move_annotation)`, with the
  fields in OperandRef's constructor order (operand.ts:260-268). `curr_operand` is never written.
- **The two `retag_field` closures and `within_loop`.**
  - The SIMD skip (`is_ssa_standalone`) is kept.
  - The `Array` arm's `bug!` text uses `{:?}` of `FieldsShape`.
  - `0..count` runs over the `u64` count.
  - `within_loop`'s sequence matches :605-641 line for line.
- `RetagFlags_set` is a local helper, because lib.ts's companion has no `set` (PORT 4). Correct.

**mono_item.rs**
- `define` has three arms: `Static` → `codegen_static`; `GlobalAsm` → `codegen_global_asm`; `Fn` → the
  `codegen_instance_attrs(instance.def).flags.contains(NAKED)` test, then `codegen_naked_asm(cx, instance, item_data)`, or
  else `codegen_instance::<Bx>`.
- `predefine` computes `symbol_name(tcx).name` before the match, as upstream. `Static` → `predefine_static`; `Fn` → no
  predefinition for naked fns, else `predefine_fn`; `GlobalAsm` → nothing.
- The `debug!` lines are compiled out (release `max_level_info`), so `to_raw_string`'s `Fn` stop is unreachable from
  them.
- `to_raw_string`'s `Static`/`GlobalAsm` texts are `{id:?}`.

**meth.rs**
- `get_fn_inner` computes `self.0 * pointer_size.bytes()`. `get_optional_fn` / `get_fn` / `get_usize` pass `nonnull`
  false / true / false, and `get_usize` uses `type_isize`.
- `dyn_trait_in_self`: the `peel_refs().walk()` loop, then `principal().map(instantiate_bound_regions_with_erased)`, then
  the `bug!` text.
- `load_vtable`:
  - VFE requires `virtual_function_elimination && lto() == Fat`;
  - a principal leads to `type_checked_load(llvtable, offset, typeid.as_bytes())`; no principal plus `nonnull` is the
    `bug!`, and an optional fn falls through;
  - otherwise it runs `inbounds_ptradd`, `load(llty, gep, ptr_align)`, `set_invariant_load`, then `nonnull_metadata` if
    `nonnull`.
- `get_vtable`:
  - The cache key is `(ty, trait_ref)` in `cx.vtables()`, a `KeyedMap` (traits/misc.ts:15), so a hit works.
  - On a miss: `vtable_allocation`, `unwrap_memory`, `static_addr_of(.., Some("vtable"))`,
    `apply_vcall_visibility_metadata`, `create_vtable_debuginfo`, then the insert.
  - The test checks a cache hit that makes no calls.

**size_of_val.rs**
- A sized layout gives constant `size`/`align`.
- **`Dynamic`.** Slots `COMMON_VTABLE_ENTRIES_SIZE` and `..._ALIGN` go through `get_usize`. Then come
  `range_metadata(size, 0..=signed_max)` and `range_metadata(align, 1..=max_for_target)`, the latter `min(2^(bits-1), 2^29)`
  (rustc_abi lib.rs:1142-1145).
- **`Slice`/`Str`** use `unchecked_sumul(len, unit.size)` and `unit.align`.
- **`Foreign`** builds the message under `with_no_visible_paths` / `with_no_trimmed_paths`. It calls
  `build_langcall(PanicNounwind)` with `ReturnSlot::Direct`, then returns the constants.
- **`Adt`/`Tuple`.**
  - `assert!(!is_simd)`, the last field's offset and the sized align become `const_usize`s before the recursion, as
    upstream.
  - **Packed tails.** `pack == 1` → `const_usize(1)`. Otherwise `icmp ULT` + `select` computes `min(unsized_align, pack)`.
  - **The `unsized_align` max.** If both values are constants, it is `const_usize(max as u64)`. Otherwise it is `icmp UGT`
    + `select`.
  - Then `add`, `sub(full_align, 1)`, `add`, `neg`, `and`.

## 3. The rustc_session methods

I compared all six with session.rs line by line.
- `needs_plt` (:863): `relro_level.unwrap_or(target)`, then `RelroLevel::Full ==`, then `plt.unwrap_or(want_plt ||
  !full_relro)`. Upstream evaluates the `unwrap_or` argument eagerly and `??` evaluates lazily, but the argument has no side
  effect.
- `direct_access_external_data` (:1092): `option.or(target)`.
- `branch_protection` (:1125):
  - The `Os::Windows && Arch::AArch64` test and the `pac_ret.key == A → B` write are kept.
  - The write goes to a new `BranchProtection`/`PacRet` object (spread), never to the session's option, which matches
    Rust's copy of a `Copy` option. The test checks this.
- `must_emit_unwind_tables` (:1144): `requires_uwtable || force_unwind_tables.unwrap_or(panic_strategy().unwinds() ||
  default_uwtable)`, with the full comment.
- `calculate_pauth_abi_version` (:186):
  - same bit constants, same assert text;
  - `INIT_FINI_ADDR_DISC` matches `HardwareAddress(true) | Synthetic(_)`;
  - all shifts stay below bit 11.
- `fn_attrs` (:301): the five attributes in upstream order and conditions.

**`PointerAuthConfig` as an interface plus companion const.**
- It is marked `// PORT:` at session.ts:150-154, and the handoff records it as PORT 5.
- The justification holds. `session_pointer_auth.test.ts:14` builds `PointerAuthConfig` values as object literals, and
  `:27-28` puts one into a `Session` with `Object.assign`. A class would change those users.
- Root should record the decision.

**Oracle facts.** I regenerated four with the pinned rustc (`1.101.0-nightly (6f5da406b 2026-10-10)`), using the test's own
crate `A` with `--crate-type lib --emit=llvm-ir`:
- `needs_plt`, x86_64-unknown-linux-gnu: `!"RtLibUseGOT", i32 1`, plus `nonlazybind` on both fns. That gives `false`, as
  the test expects. With `-Zplt=yes`, neither appears, giving `true`, as expected.
- `must_emit_unwind_tables`, host with `-Cpanic=abort`: no `uwtable` anywhere, giving `false`, as expected. Host default
  has `uwtable`. x86_64 with `-Cpanic=abort` keeps `uwtable`, giving `true`, as expected.
- `branch_protection`, aarch64-pc-windows-msvc `-Zbranch-protection=pac-ret`: `"sign-return-address-key"="b_key"` and
  `!"sign-return-address-with-bkey", i32 1`. That gives key B, as the test expects for the stand-in.

**Stand-ins for the modified targets.** These are honest. Each case sets exactly one field that the method reads:
- `os = Windows` on the aarch64-linux session's target;
- `direct_access_external_data = false` on the x86_64 target, which is loongarch64's spec value.

So the test checks the branch logic and invents no target data, and the comments say so. `load_builtin` builds a fresh
`Target` per call (rustc_target spec/mod.ts:2154-2161), so the writes cannot leak into other sessions or tests.

The `PointerAuthConfig` expectations are correct arithmetic:
- the default is bits 0-7, 9 and 10, which is `0x6ff`;
- `HardwareAddress(false)` clears bit 7, giving `0x67f`;
- no init/fini clears bits 6 and 7, and `elf_got` sets bit 8, giving `0x73f`;
- no function-pointer schema clears bit 1, giving `0x6fd`.

## 4. The two decisions

**`CodegenUnit::codegen_dep_node` returns no node: faithful.**
- At the pin, `make_compile_codegen_unit` is `DepNode::construct`, which is `DepNode { kind, key_fingerprint:
  key.to_fingerprint(tcx).into() }` (dep_node.rs:128-133). It has no side effect.
- The port has three precedents for a disabled graph:
  1. `rustc_middle/dep_graph/graph.ts:96`: `with_task(dep_node: undefined, ..)`. The disabled branch never reads the node.
     The enabled branch stops (`DepGraphData::with_task (D3)`).
  2. `rustc_middle/query/calls.ts:248`: `const dep_node = undefined` for `with_feed_task`, with the same justification.
  3. `rustc_metadata/rmeta/encoder.ts:3151`/`:3175`: the node is built only under `is_fully_enabled()`, otherwise
     `undefined`, and passed as `dep_node as undefined` to `with_task`.
- **Callers.** In the port, the only caller is `rustc_codegen_llvm/base.ts:83`, which passes the value straight to
  `with_task`. Nothing distinguishes "no node" from a node. Upstream has one more caller, ssa-base's (N2).

**Removing `Visibility::Interposable`: correct.**
- Before the lane (`git grep 51dfe33c`), the only places naming `Interposable` with `mono::Visibility` were:
  - the declaration itself and its decoder/encoder arms (codegen_fn_attrs.ts:73-104);
  - a comment in rustc_codegen_llvm mono_item.ts:42.
- Every other `Interposable` is `SymbolVisibility`'s: rustc_target spec, config.ts, session.ts:773, partitioning.ts:988,
  mono.ts:502 (`From<SymbolVisibility>`) and llvm/conversions.ts:52, plus fold.ts's LLVM `isInterposable`.
- Nothing ever built it; codegen_attrs builds only `Default`.
- **Generated decoders.**
  - The `decode_Visibility`/`encode_Visibility` functions in `*.gen.ts` are rustc_ast's `Visibility` (ast.gen.ts) and
    `ty::Visibility<Id>` (rustc_middle decodable.gen.ts:47). They are different types.
  - In tools/codegen, the `rustc_middle_mono` set (types.sets.json:969-986) is `derive_only` with
    `stable_hash_types = [MonoItem, Instance, InstanceKind, ShimKind, ReifyReason]`, so it generates no `Visibility`
    codec. No queries.config.json entry names `mono::Visibility`.
- **Upstream codec.** mono.rs:384-385 is `#[derive(.., TyEncodable, TyDecodable)] pub enum Visibility { Default, Hidden,
  Protected }`. rustc_macros' derived decoder panics with `0..{variants.len()}`, so `expected 0..3` matches.
- **Tag 3 in rmeta.** None is possible. Every rmeta the port reads is written either by the pinned oracle, whose encoder
  has three variants, or by the port's own encoder, which could never emit 3.

## 5. `StableHash for Allocation` (left for root)

The stop is still in place: rustc_codegen_llvm common.ts:328 (`unported("rustc_middle: .. StableHash for Allocation
(alloc_to_backend's value name)")`). The stop in `stable_hash_AllocId` (ty/impls_ty.ts:71-75) is also still there.

The write-up is accurate on substance:
- the derives needed: `Allocation`, `ProvenanceMap`, `PointerFrag`, `InitMask`, `InitMaskBlocks`, `InitMaskMaterialized`
  and `GlobalAlloc`;
- that `rustc_middle_mir`'s `stable_hash_types` holds only `UnOp`/`BinOp` (types.sets.json:2294 set);
- that `stable_hash.json` has no entry for `Size`, `Box<[u8]>` or `()`;
- that `stable_hash_SortedMap` exists (rustc_data_structures/sorted_map.ts:363);
- that no `stable_hash_Size` exists.

N1 has the corrections.

## 6. Tests

The expectations are read off upstream, as claimed. I re-derived four sequences:
1. **meth.rs `get_fn` / `get_optional_fn` / `get_usize`** (slots 3, 4, 1).
   - Offsets: `3*8 = 24`, `32` and `8` (:31, :67).
   - Each runs `inbounds_ptradd`, `load(llty, .., align8)` and `set_invariant_load` (:148-151).
   - `nonnull_metadata` appears only for `get_fn` (:152).
   - `get_usize` loads `isize` (:65).
2. **size_of_val.rs `#[repr(packed(2))] PK { a: u8, s: [u32] }`.**
   - The tail's offset 2 and the sized align 2 are constants.
   - The recursion gives `unchecked_sumul(len, 4)` and the constant 4.
   - `pack = 2 ≠ 1` gives `icmp ULT(4, 2)` + `select`.
   - The `select` is not a constant, so the max is `icmp UGT(2, %2)` + `select` (:141-143).
   - Then `add(2, %0)`, `sub(%4, 1)`, `add`, `neg(%4)`, `and`: the test's ten calls, in its order.
   - `sv_dyn` is also right: slots 1 and 2 at offsets 8 and 16, then `0..=9223372036854775807` and `1..=536870912` (2^29).
3. **retag.rs `&(u32, Cell<u32>)`.**
   - `Not` gives not mutable; the type is `Unpin` and `UnsafeUnpin`, so `pin_ranges` is empty (excluded at once) and
     `pin_layout` is null.
   - For `UnsafeCell`, the tuple is not `Freeze` and not `UnsafeCell`, so `visit_layout` recurses. `u32` at 0 is excluded
     as `Freeze`. `Cell<u32>` at 4 recurses to `UnsafeCell<u32>`, which gives `add_range(4, 4)`.
   - That range is not `[(0, 8)]`, so it becomes a global array whose bytes are `4u64, 4u64` in LE, through
     `static_addr_of(.., None)`.
   - `flags = 0`, size 8. All match.
4. **retag.rs `[&u32; 3]` `within_loop`** (:605-641). The test's 16 entries match upstream:
   - setup: the usize alloca, `lifetime_start`, `store 0`, `append_sibling_block("retag_loop")`, `br`, `switch_to_block`;
   - body: `load_from_place(isize)`, `project_index`, `retag_mem` (flags 8: `Freeze`), `unchecked_uadd(1)`, `store`;
   - exit: `append_sibling_block("retag_loop_exit")`, `icmp IntEQ(next, 3)`, `cond_br(exit, body)`, `switch_to_block(exit)`,
     `lifetime_end`.

The flag values for `&u32` (8, and 9 at entry), `&mut u32` at entry (11) and `&mut u8` (10) also follow from lib.rs:197-203
and retag.rs:208.

The variant paths (`retag_variants`, the scratch slot) are unexercised. They stop at ssa-rvalue-intrinsic's
`codegen_transmute_operand` stub, and the test asserts that stop. The handoff says so.

## 7. Scope

`git diff --name-only 51dfe33c..3bb68692` lists only:
- the lane's seven new files and two tests;
- `rustc_session/session.ts`, `rustc_middle/mono.ts`, `rustc_middle/middle/codegen_fn_attrs.ts`;
- the handoff.

There are no edits to `mod.ts`, `operand.ts`, `place.ts`, `attributes.ts`, `context.ts` or `base.ts`.

## Findings

### F (must fix before merge)
None.

### N (nits)

**N1. Line numbers and set membership in the handoff's StableHash write-up.** In `docs/handoff/ssa-mir-rest.md`, "For
root: `StableHash for Allocation`":
- **`Allocation`'s derive is at allocation.rs:94** (the struct is :95), not :93. `GlobalAlloc`'s derive is at
  mir/interpret/mod.rs:254 (the enum is :255).
- **`Allocation` is already in the `hand` list.** `rustc_middle::mir::interpret::allocation::Allocation`, `ConstAllocation`,
  `AllocId` and `CtfeProvenance` are already in `rustc_middle_mir`'s `hand` list (types.sets.json, `"rustc_middle_mir"`
  at :2294). So "or the set needs a hand entry" is moot. The tools batch must either make the generator emit
  `stable_hash_*` for a `hand` type, or root must record a decision to hand-write these impls.
- **`ConstAllocation`'s derive needs naming.** Its own `#[derive(StableHash)]` (allocation.rs:284) is needed for
  `GlobalAlloc::Memory`'s arm. The write-up only says "through `Interned`'s impl"; it should name the derive alongside
  `GlobalAlloc`'s.

**N2. A second upstream caller of `codegen_dep_node`.** Upstream has a second caller that the handoff does not mention:
`rustc_codegen_ssa/src/base.rs:1276` `determine_cgu_reuse` (ssa-base's, not ported yet). It passes the node to
`assert_dep_node_not_yet_allocated_in_current_session` and `try_mark_green`. That code is reached only after
`is_fully_enabled()` and `previous_work_product(cgu.work_product_id())` (base.rs:1256-1267), and the port's
`work_product_id` stops (mono.ts:661-663). So it cannot receive `undefined` today.

When ssa-base ports it, the incremental path must keep stopping before line 1276, as encoder.ts:3151-3159 does. Root
should add this to the integration notes for ssa-base, next to stub site 5 (base.ts:83). It does not change this lane's
code.

**N3. `MonoItem::codegen_dep_node` still stops.** mono.ts:384-386 still calls `unported`, while `CodegenUnit`'s now
returns `undefined`. This is consistent with the brief, which names only `CodegenUnit`'s, and nothing calls the `MonoItem`
one. The mono.ts header (:11-13) names the exception correctly. Recorded only so root knows that the asymmetry is
deliberate.

## For root
- Record PORT decisions 5 (`PointerAuthConfig` as an interface plus companion const), 6 (`codegen_dep_node`) and 7
  (`Visibility`).
- Apply the stub repoints in the handoff (sites 1-11) at integration, adding N2's note for ssa-base.
- The `StableHash for Allocation` tools batch remains open (N1).

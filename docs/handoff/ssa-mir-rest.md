# Handoff: ssa-mir-rest (M7, plan-m7 wave 41, wave 40n)

Branch `t3/port-ssa-mir-rest`, from `51dfe33c`. No merges. Code commit `4736b3d2`.

## Summary
- **rustc_codegen_ssa**: seven files, ported in full, in upstream order, with markers. Each goes in a new TS file at the
  mirrored path.
  - `mir/constant.rs` 4/4
  - `mir/statement.rs` 1/1
  - `mir/coverageinfo.rs` 1/1
  - `mir/retag.rs` 21/21
  - `mono_item.rs` 6/6
  - `meth.rs` 8/8
  - `size_of_val.rs` 1/1

  That is about 1,340 upstream lines and about 1,740 TS lines.
- **rustc_session** `session.rs`: six methods, in session.rs order. Coverage goes from 90/104 to **96/104**.
  - `Session::needs_plt` (:863)
  - `Session::direct_access_external_data` (:1092)
  - `Session::branch_protection` (:1125)
  - `Session::must_emit_unwind_tables` (:1144)
  - `PointerAuthConfig::calculate_pauth_abi_version` (:186)
  - `PointerAuthConfig::fn_attrs` (:301)
- **rustc_middle** `mono.rs`: `CodegenUnit::codegen_dep_node` (:596) no longer stops. It returns no node, as the disabled
  dep graph does elsewhere (PORT 6).
- **rustc_middle** `middle/codegen_fn_attrs.ts`: the four-variant `Visibility` is gone. It now uses mono.ts's
  three-variant `Visibility` (PORT 7, review cg-types-attrs N4).
- **Not done**: `StableHash for Allocation`. It needs a tools/codegen change, which this lane may not make. The write-up
  for root is below.
- Nothing protected reaches the new code. The LLVM backend is not registered, and mod.ts does not call the installers
  yet.

## Files touched
New, all mine:
- `src/rustc_codegen_ssa/meth.ts`
- `src/rustc_codegen_ssa/size_of_val.ts`
- `src/rustc_codegen_ssa/mono_item.ts`
- `src/rustc_codegen_ssa/mir/constant.ts`
- `src/rustc_codegen_ssa/mir/coverageinfo.ts`
- `src/rustc_codegen_ssa/mir/statement.ts`
- `src/rustc_codegen_ssa/mir/retag.ts`
- tests: `src/rustc_codegen_ssa/mir/mir_rest.test.ts` and `src/rustc_session/session_codegen.test.ts`

Edited (the brief's owner files):
- `src/rustc_session/session.ts`: the six methods above.
  - The `BranchProtection` import is added.
  - `PointerAuthConfig` is still an interface. Its two ported methods sit on a new companion const of the same name
    (PORT 5).
- `src/rustc_middle/mono.ts`: `codegen_dep_node` and the header note.
- `src/rustc_middle/middle/codegen_fn_attrs.ts`:
  - `Visibility` and `debug_Visibility` now come from mono.ts. The type is re-exported, so the importer in
    symbol_export.ts is unchanged.
  - The decoder and encoder have three variants.

Not edited: `mir/mod.ts`, `mir/operand.ts`, `mir/place.ts`, and every rustc_codegen_llvm file. Their stub sites are in
the next section.

## Stub sites root must repoint
1. **mir/mod.ts**: right after `class FunctionCx`, next to the two installers already there, add:
   `install_FunctionCx_constant(FunctionCx); install_FunctionCx_statement(FunctionCx); install_FunctionCx_coverageinfo(FunctionCx); install_FunctionCx_retag(FunctionCx);`
   - Import them from `./constant.ts`, `./statement.ts`, `./coverageinfo.ts` and `./retag.ts`.
   - I checked load order. Each of the five files can be imported first, followed by the other four. In every order the
     installers attach the same 21 prototype members.
2. **mir/mod.ts `xlane`**:
   - Replace `xlane.codegen_retag_place(fx, bx, place_ref, true)` (mod.ts:759) with `fx.codegen_retag_place(bx, place_ref, true)`.
   - Replace `xlane.codegen_retag_operand(fx, bx, ..., true)` (mod.ts:765 and :772) with `fx.codegen_retag_operand(bx, ..., true)`.
   - Then delete the two `retag:` entries.
3. **mir/operand.ts** (ssa-operand-place review N4):
   - `FunctionCx_eval_mir_constant_to_operand(this, bx, constant)` (operand.ts:1390) becomes `this.eval_mir_constant_to_operand(bx, constant)`.
   - `FunctionCx_immediate_const_vector(this, bx, constant)` (operand.ts:1386) becomes `this.immediate_const_vector(bx, constant)`.
   - Then delete both stubs (operand.ts:74-90) and fix the header (:13-16).
4. **mir/place.ts**:
   - Delete the `size_and_align_of_dst` stub (place.ts:43-51).
   - Import it from `../size_of_val.ts`. It has the same signature, and its call site is place.ts:265.
   - Fix the header (:19).
5. **rustc_codegen_llvm/base.ts**:
   - `MonoItemExt_predefine(mono_item, cx, cgu, linkage, vis)` (:124) becomes `MonoItemExt.predefine(mono_item, cx, cgu, linkage, vis)`.
   - `MonoItemExt_define(mono_item, cx, cgu, item_data)` (:129) becomes `MonoItemExt.define(mono_item, Builder, cx, cgu, item_data)`.
     `Builder` is the builder class, as its static side `Bx_` (PORT 2).
   - Delete the two stubs (:215-225). Fix the header (:23-24) and the wrong line numbers (review cg-types-attrs N3).
   - `compile_codegen_unit` (:83) now gets `undefined` from `codegen_dep_node`, which the disabled `with_task` ignores.
6. **rustc_codegen_llvm/attributes.ts `SESSION_STOPS`**: replace each stop with the real method, then delete
   `SESSION_STOPS` and its header note.

   | call site | becomes |
   |---|---|
   | attributes.ts:534 | `sess.needs_plt()` |
   | attributes.ts:602 | `sess.must_emit_unwind_tables()` |
   | attributes.ts:644 | `sess.branch_protection()` |
   | attributes.ts:773 | `PointerAuthConfig.fn_attrs(cfg)` |
   | base.ts:168 | `PointerAuthConfig.calculate_pauth_abi_version(cfg, cx.sess().target)` |
   | mono_item.ts:322 | `this.tcx.sess.direct_access_external_data()` |

   `PointerAuthConfig` is now a value import from rustc_session/session.ts.
7. **rustc_codegen_llvm/context.ts**:
   - Replace `Session_needs_plt` (:496), `Session_must_emit_unwind_tables` (:517) and `Session_branch_protection` (:580)
     with the methods. Then delete the three stubs (:1485-1498).
   - context.test.ts spies on those three exports (`spyOn(context, "Session_needs_plt")` and the others, around :165-190).
     Remove those spies, as review cg-context N6 says. The oracle test then checks the real methods.
   - `wants_msvc_seh` is ssa-base's, not mine.
8. **rustc_codegen_llvm/skeleton.test.ts**: after steps 6 and 7, the `rustc_session` count goes from 9 to 0.
9. **rustc_codegen_llvm/mono_item.ts:41-45**: the cast in `foreign_item_symbol_aliases` is no longer needed. Both types
   are mono.ts's `Visibility`, so it can go.
10. **This lane's own cross-lane stubs.** Both tables are exported, so tests can replace entries. Repoint each entry when
    its owner lands, then delete the table.

    In `stmt_xlane` (statement.ts), each becomes `this.<method>(bx, ..)`:

    | entry | owner |
    |---|---|
    | `codegen_stmt_debuginfos` | ssa-debuginfo |
    | `set_debug_loc` | ssa-debuginfo |
    | `debug_introduce_local` | ssa-debuginfo |
    | `codegen_rvalue` | ssa-rvalue-intrinsic |
    | `codegen_rvalue_operand` | ssa-rvalue-intrinsic |

    In `mono_item_xlane` (mono_item.ts):

    | entry | owner |
    |---|---|
    | `codegen_global_asm` | ssa-base (base.rs) |
    | `codegen_instance(Bx_, cx, instance)` | ssa-base (base.rs) |
    | `codegen_naked_asm` | ssa-rvalue-intrinsic (mir/naked_asm.rs) |
11. **Parallel lanes' stubs for this lane's functions.** Repoint any that ssa-block, ssa-rvalue-intrinsic or ssa-base
    left:

    | function | where |
    |---|---|
    | `FunctionCx::codegen_statement` | statement.ts |
    | `meth::VirtualIndex` (`get_fn`, `get_optional_fn`, `get_usize`), `get_vtable`, `load_vtable` | meth.ts |
    | `size_of_val::size_and_align_of_dst` | size_of_val.ts |
    | `FunctionCx::codegen_retag_place` / `codegen_retag_operand` | retag.ts, for block.rs's call sites |
    | `FunctionCx::eval_mir_constant`, `immediate_const_vector` | constant.ts |
    | `MonoItemExt` | mono_item.ts |

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| compiler/rustc_codegen_ssa/src/mir/constant.rs | 4/4 |
| compiler/rustc_codegen_ssa/src/mir/statement.rs | 1/1 |
| compiler/rustc_codegen_ssa/src/mir/coverageinfo.rs | 1/1 |
| compiler/rustc_codegen_ssa/src/mir/retag.rs | 21/21 |
| compiler/rustc_codegen_ssa/src/mono_item.rs | 6/6 |
| compiler/rustc_codegen_ssa/src/meth.rs | 8/8 |
| compiler/rustc_codegen_ssa/src/size_of_val.rs | 1/1 |
| compiler/rustc_session/src/session.rs | 96/104 (was 90) |
| compiler/rustc_middle/src/mono.rs | 41/41 (unchanged; `codegen_dep_node` no longer stops) |
| compiler/rustc_middle/src/middle/codegen_fn_attrs.rs | 9/9 (unchanged) |

session.rs still lacks eight functions:
- `function_pointers_default` and `init_fini_default` (:125, :134), `PointerAuthConfig::default` (:170) and `from_raw`
  (:231). They are unreachable, because `build_session` stops for a `Pauthtest` target.
- `deref` and `deref_mut` (:566, :572).
- `is_wasi_reactor` (:799) and `get_tools_search_paths` (:825).

`bun scripts/coverage.ts --check --offline`: `markers ok (26407, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 390)`.

## Evidence
All runs were on AC power with `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0` and no gate running.
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/std/result.test.ts ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/rustc_session/`: **299
  pass, 0 fail** (35 files).
- `bun test ./src/rustc_metadata/rmeta/encoder_c.test.ts ./src/rustc_monomorphize/ ./src/rustc_middle/`: **505 pass, 0
  fail**. These cover the `Visibility` codec and mono.ts.
- Each new module loads alone with `bun -e "await import(..)"`, and so does `rustc_codegen_llvm/lib.ts`.

### `mir/mir_rest.test.ts`: 3 tests, 35 expects
How it runs:
- The fixture is a small std crate, compiled with the oracle's sysroot and `-Zcodegen-emit-retag` so that the retag
  paths run.
- The mock is operand_place.test.ts's logging mock backend. A method the mock does not define logs `name(args)` and
  returns `%N`.
- The layouts are the port's real ones.
- Each expectation was derived from the upstream source first (cited per case in the test), then checked against the run.

**statement.rs**, over `g`'s real mir_built statements:
- StorageLive/Dead of an operand local, FakeRead and PlaceMention emit nothing past the debuginfo calls.
- A PendingOperand assign runs the operand, retag, `overwrite_local` and `debug_introduce_local`, in that order.
- Assigning a `&u32` into a PendingOperand local gives `retag_reg` with flags `IS_FREEZE`, and the local becomes the
  retagged immediate.
- A projection place goes through `codegen_place` (deref of an operand local), then `codegen_rvalue`.
- A ZST operand local still has its operand codegenned. Its `const ()` goes through constant.ts
  `eval_mir_constant_to_operand`, then `from_const`.
- A Place local gets `codegen_rvalue`.
- Assigning a non-ZST operand twice is the `span_bug` text.

Statements built from the body's parts:
- StorageLive/Dead of Place and UnsizedPlace locals give `lifetime_start`/`lifetime_end`.
- `Assume` gives `assume(%x)`.
- `CopyNonOverlapping` gives `unchecked_sumul(count, 8)`, then `memcpy` with `u64`'s alignment. A non-pointer `dst`
  is a `bug!`.
- `Coverage` gives `add_coverage(fx.instance)`, by way of coverageinfo.rs.
- `Nop` and `ConstEvalCounter` emit nothing.
- The UnsizedPlace assign `span_bug` text.
- With the stubs left in place, the first stop names ssa-debuginfo.

**meth.rs**:
- `get_fn`, `get_optional_fn` and `get_usize`: slot × 8 byte offsets, the pointer-aligned load, `set_invariant_load`,
  and `nonnull_metadata` only for `get_fn`.
- The VFE path, through a stand-in session (`virtual_function_elimination` with fat LTO): `type_checked_load(%vt, 24,
  <typeid of Tr>)`.
  - `dyn Send` (no principal) with a nonnull load is the `bug!`; an optional fn falls through to the plain load.
  - A non-`dyn` receiver is `dyn_trait_in_self`'s `bug!`.
- `get_vtable`: `static_addr_of(alloc, "vtable")`, the vcall metadata, the debuginfo, then a cache hit with no calls. The
  allocation is 24 bytes, align 8.

**size_of_val.rs**:
- A sized type gives its constants.
- `[f32]` and `str`: `unchecked_sumul(len, unit)` and the unit's alignment.
- `dyn Tr`: two vtable loads (slots 1 and 2), then `range_metadata` `0..=isize::MAX` and `1..=2^29`.
- `W { u8, [u16] }`: the constant-align formula.
- `#[repr(packed(2))] PK { u8, [u32] }`: the dynamic `min` (`icmp ult` and `select`), then the dynamic `max` (`icmp ugt`
  and `select`).

**retag.rs**:
- Flags:
  - `&u32` gives 8, and 9 at fn entry.
  - `&mut u32` at fn entry gives 11.
  - `&Cell<u32>` covers its whole range, so no array.
  - `&(u32, Cell<u32>)` gives a global range array, `static_addr_of(.., None)`, whose bytes are
    `4 0 0 0 0 0 0 0 4 0 0 0 0 0 0 0` (native-endian `u64` pairs).
- `(&u32, &mut u8)`: fields in memory order, with `inbounds_ptradd` at 8.
- `[&u32; 3]`: the full `within_loop` sequence.
- `u8` builds no plan.
- Operands:
  - An immediate gives `retag_reg` and a rebuilt immediate.
  - A scalar pair gives two `retag_reg` calls and a rebuilt `Pair`.
  - A `Ref` operand takes the place path and is returned unchanged.
- `rvalue_needs_retag` is tested on every arm.
- **Not reachable yet:** the variant paths (`Option<&u32>`, place or operand, with a constant discriminant or not). Both
  go through `codegen_get_discr`, whose niche `extract_field` stops at ssa-rvalue-intrinsic's `codegen_transmute_operand`
  stub (an operand.ts stub). The test asserts that stop, so the variant code (`retag_variants`, the scratch slot) is
  unexercised until that lane lands.

**mono_item.rs**:
- `predefine` gives `predefine_fn` / `predefine_static` with the item's symbol name, and a naked fn is not predefined.
- `define`: a static gives `codegen_static`. A fn, a naked fn and global asm reach the ssa-base / ssa-rvalue-intrinsic
  stubs by name.
- `to_raw_string` of a static; of a fn, it stops.

### `rustc_session/session_codegen.test.ts`: 5 tests, 23 expects
The expected values are oracle facts. I read them off the pinned nightly's `--emit=llvm-ir` output for the same flags.
The test's header says how each method shows in the IR.

| method | flags | value | IR fact |
|---|---|---|---|
| `needs_plt` | host | `true` | no `RtLibUseGOT` / `nonlazybind` |
| `needs_plt` | host `-Zplt=no` | `false` | |
| `needs_plt` | x86_64-unknown-linux-gnu | `false` | `RtLibUseGOT`, `nonlazybind` |
| `needs_plt` | x86_64 `-Zplt=yes` | `true` | |
| `needs_plt` | x86_64 `-Crelro-level=partial` | `true` | |
| `must_emit_unwind_tables` | host | `true` | `uwtable` |
| `must_emit_unwind_tables` | host `-Cpanic=abort` | `false` | |
| `must_emit_unwind_tables` | host `-Cforce-unwind-tables=no` | `false` | |
| `must_emit_unwind_tables` | x86_64 | `true` | |
| `must_emit_unwind_tables` | x86_64 `-Cpanic=abort` | `true` | `default_uwtable` |
| `must_emit_unwind_tables` | x86_64 with `force-unwind-tables=no`, with or without `-Cpanic=abort` | `false` | |
| `branch_protection` | none | `None` | |
| `branch_protection` | aarch64-unknown-linux-gnu `bti,pac-ret` | BTI, key A | `branch-target-enforcement`, `a_key` |
| `branch_protection` | `pac-ret,b-key` | key B | |
| `branch_protection` | aarch64-pc-windows-msvc `pac-ret` | key B | `b_key`, `sign-return-address-with-bkey` 1 |
| `direct_access_external_data` | x86_64, PIC | `None` | no `dso_local` on an extern static in an executable |
| `direct_access_external_data` | x86_64 `=yes` | `Some(true)` | `dso_local` |
| `direct_access_external_data` | x86_64 static model | `None` | `dso_local` from the model |
| `direct_access_external_data` | x86_64 static model `=no` | `Some(false)` | none |
| `direct_access_external_data` | loongarch64-unknown-linux-gnu's spec `Some(false)` | `false`, or `true` with `=yes` | |

Two cases run on a stand-in target, because the port has no aarch64 Windows or loongarch64 target spec yet:
- The Windows-on-Arm case sets `os` on the aarch64-linux session's target.
- The loongarch case sets `direct_access_external_data` on the x86_64 session's target.

The test also checks that the method returns an adjusted copy, and that the session's option keeps key A.

`PointerAuthConfig` has no oracle fact, since `Pauthtest` stops in `build_session`. Its expectations come from
session.rs:186-320:
- the default config gives `0x6ff`;
- `HardwareAddress(false)` gives `0x67f`;
- `HardwareAddress(true)` gives `0x6ff`;
- no init/fini plus `elf_got` gives `0x73f`;
- no function pointers gives `0x6fd`;
- everything off gives 0;
- the `cfg_abi` assertion;
- `fn_attrs`' order and conditions.

### Sample difftests
`RUST_TS_AGENT=ssa-mir-rest`, `--sample 200 --jobs 6`:

| suite | result | run |
|---|---|---|
| `mono-ui` | **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0) | `20261112-141534-ssa-mir-rest-10d0` |
| `mir-o2` | **200/200 MATCH** | `20261112-141620-ssa-mir-rest-shr3` |
| `mir` | **200/200 MATCH** | `20261112-141708-ssa-mir-rest-3ugz` |

## Every `unported(...)` left
- mono_item.ts `to_raw_string`, `Fn` arm: `"rustc_codegen_ssa::mono_item::to_raw_string: the address of an interned
  `GenericArgs` list"`. Upstream prints `instance.args.as_ptr().addr()`, which has no equivalent here. Only the
  compiled-out `debug!` lines call it.
- statement.ts `stmt_xlane`:
  - `"ssa-debuginfo: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs codegen_stmt_debuginfos"`, `"... set_debug_loc"`,
    `"... debug_introduce_local"`;
  - `"ssa-rvalue-intrinsic: compiler/rustc_codegen_ssa/src/mir/rvalue.rs codegen_rvalue"`, `"... codegen_rvalue_operand"`.
- mono_item.ts `mono_item_xlane`:
  - `"ssa-base: compiler/rustc_codegen_ssa/src/base.rs codegen_global_asm"`, `"... codegen_instance"`;
  - `"ssa-rvalue-intrinsic: compiler/rustc_codegen_ssa/src/mir/naked_asm.rs codegen_naked_asm"`.
- `MonoItem::codegen_dep_node` (mono.ts:384) still stops. The brief names only `CodegenUnit`'s, and nothing calls the
  `MonoItem` one.

## For root: `StableHash for Allocation` (common.ts:328, review cg-context N3) needs a tools batch
The port generates `StableHash` with `tools/codegen` (PORTING §3: HashStable impls are generated, not hand-written), so I
did not hand-write it. These pieces are needed:
- **The set.** `rustc_middle_mir` in `tools/codegen/types.sets.json` (about :2300-2370) already lists
  `mir/interpret/allocation.rs`, `allocation/init_mask.rs` and `allocation/provenance_map.rs`. But its
  `stable_hash_types` holds only `UnOp`/`BinOp`. It needs these derives (`#[derive(StableHash)]` at the pin):
  - `Allocation` (allocation.rs:93). It is a hand class in interpret/allocation.ts, so the generator must emit for a
    hand class, or the set needs a hand entry. Its fields in order: `bytes`, `provenance`, `init_mask`, `align`,
    `mutability`, `extra`.
  - `ProvenanceMap` (provenance_map.rs:35) and `PointerFrag` (:20).
  - `InitMask`, `InitMaskBlocks` and `InitMaskMaterialized` (init_mask.rs:22, :28, :187).
- **`GlobalAlloc`'s derive** (mir/interpret/mod.rs:255): `stable_hash_AllocId` (ty/impls_ty.ts:66) stops on it today,
  with `"rustc_middle::mir::interpret::GlobalAlloc: StableHash (derive not generated)"`.
  - Every allocation that has provenance reaches it, through `CtfeProvenance` and then `AllocId`.
  - Its `Memory(ConstAllocation)` arm recurses into `Allocation`, through `Interned`'s impl.
- **External impls** for `tools/codegen/stable_hash.json`:
  - `SortedMap` (`stable_hash_SortedMap` exists in rustc_data_structures/sorted_map.ts);
  - `Box<[u8]>` / `Uint8Array` and `[u8; 8]`;
  - `Size` (I found no `stable_hash_Size`; `stable_hash_Align` and `stable_hash_Mutability` exist);
  - `()` for `extra`;
  - `u64` blocks.
- After that, common.ts's stop becomes `with_stable_hashing_context` plus `Hash128` (`alloc_{hash:032x}`). Every unnamed
  constant allocation under `--emit=llvm-ir` reaches it.

## `// PORT:` decisions (for root to record)
1. **`impl FunctionCx` blocks as installers.** `install_FunctionCx_{constant,statement,coverageinfo,retag}` follow the
   brief and ssa-operand-place PORT 2. Each file imports mod.ts for types only, and each installer carries a
   `// PORT:` line (ssa-operand-place review N5).
2. **`MonoItemExt`.**
   - The single-implementor trait's methods live on the companion const `MonoItemExt`. The trait's declarations are the
     `MonoItemExt_methods` interface, with markers at :12, :18 and :25.
   - `define::<Bx>` takes the builder's static side `Bx_` first, because `base::codegen_instance::<Bx>` builds `Bx`s
     (as `codegen_mir(Bx_, ..)` does).
   - `predefine::<Bx>` uses `Bx` only to type `cx`, so it takes no `Bx_`.
3. **Cross-lane stubs as exported tables** (`stmt_xlane`, `mono_item_xlane`). They are module-local, as operand.ts's
   are, but exported so tests can swap entries, as mod.ts's `xlane` is. They are not upstream.
4. **retag.rs.**
   - `RetagPlan` / `RetagFields` are `$` unions, with `impl RetagPlan` on the companion const. `FxIndexMap` is a `Map`.
   - Their derived `Debug` is not written, because nothing formats a plan. The `Debug` of `RetagInfo`/`RetagFlags` is
     ssa-base's (ssa-contract PORT 11).
   - `trait PerByteTracking`: the required fns are an interface, and the provided `visit_layout`/`collect` are
     `PerByteTracking_provided`, taking the implementor first. `UnsafeCellRanges` / `UnsafePinnedRanges` are objects
     implementing it, forwarding `collect`.
   - `RangeSet<Size>`'s bounds table is a local `SIZE_RANGE_SET_OPS`, a copy of rustc_abi layout/ty.ts's private one.
   - `u64::to_ne_bytes` is written through a `BigUint64Array`, which uses the native byte order of the machine running
     the compiler, as upstream does.
   - `variant_op.layout = ..` (:487) builds a new `OperandRef` (ssa-operand-place review N1).
   - `0..count` over the `u64` array count loops on `bigint`. `FieldIdx::from_usize` asserts far below 2^53.
   - `with_type`, `from_existing`, `pointer_parts` and `update_imm` are passed `bx.debug_Value` (review N3).
   - `RetagFlags::set` is a local helper over the number form.
   - `codegen_emit_retag.unwrap_or_default()` is both flags `false`, the derived `Default`.
5. **`PointerAuthConfig`** stays an interface, with `calculate_pauth_abi_version` / `fn_attrs` on a companion const.
   Object literals build it (session_pointer_auth.test.ts, a file I don't own), so a class would change its users.
   PORTING §5's "struct with methods → class" would otherwise apply.
6. **`CodegenUnit::codegen_dep_node` returns `undefined`.**
   - Upstream's `make_compile_codegen_unit` is `DepNode::construct`, which only fingerprints the name and has no side
     effect.
   - `DepNode` is not ported (D3, docs/plan-m2.md), and the disabled graph's `with_task` never reads its node.
   - This is the same form as query/calls.ts's feed (`dep_node = undefined` for `with_feed_task`) and encoder.ts's
     `dep_node as undefined`.
   - With a dep graph present, `with_task` still stops.
7. **`Visibility`.**
   - codegen_fn_attrs.ts declared its own `Visibility` with a fourth variant, `Interposable`, when mono.rs was not yet
     ported (commit `14506d79`). That variant is `SymbolVisibility`'s, not `mono::Visibility`'s, and nothing ever built
     it: codegen_attrs.ts builds only `"Default"`.
   - Now the type and its `Debug` are mono.ts's, and the type is re-exported. The `TyDecodable`/`TyEncodable` stay
     beside the `CodegenFnAttrs` codecs, with three tags.
   - The decode panic now says `expected 0..3`, which is rustc_macros serialize.rs's `0..{variants.len()}`.
   - codegen_fn_attrs.ts gains a runtime import of mono.ts (for `debug_Visibility`), which closes a cycle with mono.ts.
     The cycle is safe, because it is used only inside the Debug fn's body. Both modules load alone, and the
     rustc_middle and metadata tests pass.
8. **Small translations.**
   - `Session::branch_protection`'s `let mut bp = <Copy>` and its writes through `as_mut()` act on a new
     `BranchProtection`/`PacRet` object, never on the session's option. The test checks this.
   - `typeid.as_bytes()` is the UTF-8 encoding.
   - `std::cmp::max(a, b) as u64` of two `u128`s is `BigInt.asUintN(64, ..)`.
   - `VirtualIndex(u64)` holds a `number`.
   - `val as usize` of a `u128` discriminant is truncated to 64 bits.
   - `ty::Const::try_to_scalar`'s result is cast from ty/decls.ts's `Pending<"Scalar">` placeholder to mir::interpret's
     `Scalar`.
   - In mono_item.ts and statement.ts, `debug_ItemId` is imported from `rustc_hir/hir.ts` and `debug_Rvalue` from
     `rustc_middle/mir/mod.ts`, not the `.gen.ts` / `syntax.ts` leaves. Importing those leaves first fails on an existing
     load-order cycle (`LifetimeSyntax` / `StatementKind` TDZ).

## Notes
- The tests write their crates to `$RUST_TS_DATA/tmp/ssa-mir-rest/{mir_rest,sess}.rs` (about 1 KB in total). They read no
  new environment variable.
- `docs/claims/ssa-mir-rest.md` (root's claim) is left for root.

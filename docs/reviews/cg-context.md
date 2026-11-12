PASS WITH NOTES

# Review: lane `cg-context` (M7 wave 41): `context.rs` and `common.rs` of rustc_codegen_llvm

- **Reviewed:** `git diff 620acf48..4a76a7e2` on `t3/port-cg-context`: commits `0827133b` (port), `d3ccb2ff` (tests and fixtures),
  `50bdba9f` and `4a76a7e2` (handoff). Merged into the review worktree with `git merge --no-edit 4a76a7e2`.
- **Reviewer:** independent, read-only on code. Pin `6f5da406b56`. Upstream read from `$RUST_TS_DATA/rust`:
  `compiler/rustc_codegen_llvm/src/{context.rs, common.rs}`, plus the callees the test doubles copy.
- **Result:** no blocking defect. Every function of both files matches upstream in order and logic. Every flag name, merge
  behaviour and value comes from upstream. The oracle fixtures are genuine, and I regenerated both `.ll` files. The test doubles
  are faithful copies, confined to the test file. The six notes are labelling, follow-ups for root, and one weakened assertion.

## Evidence (AC power, `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, Bun 1.4.4)
- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun scripts/coverage.ts --check --offline`: `markers ok (26010, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 354)`.
- `bun scripts/coverage.ts --missing`: context.rs **54/54**, common.rs **43/43**.
- `--order` (report only): context.ts has 18 of 54 markers out of order, in 2 descents. The first is `get_type_of_global:870`
  after `global_set_metadata_node:1243`. This is the class layout PORTING §8 allows: `GenericCx`'s two impl blocks and
  `SimpleCx` must be declared before `CodegenCx` extends them. common.ts has no rows.
- `bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./src/std/result.test.ts`: **121 pass, 0 fail** (12932 expects, 11 files).
  context.test.ts alone gives 12 pass. The "oracle fixtures are current" pair ran and was not skipped (`-t current`: 2 pass).
- **Fixture regeneration (my own run):** the pinned toolchain ran `rustc --crate-type lib --target <t> --emit=llvm-ir
  -Cno-prepopulate-passes empty.rs`. For x86_64-unknown-linux-gnu and aarch64-apple-darwin, the output is **byte-identical** to
  `context_oracle/<t>.ll`. The `.script` fixtures are re-recorded by the test through `record.ts`, which passes.
- **Scope:** the diff touches only `context.ts`, `common.ts`, the new `context.test.ts` and `context_oracle/`, the handoff, and
  cg-context's lines in `skeleton.test.ts`. No removed line outside the stubs touches code that is not cg-context's.

## 1. Order and coverage
- Both files are complete. I spot-checked markers against upstream lines: `create_module` :184, `CodegenCx::new` :600,
  `create_used_variable_impl` :745, `get_intrinsic` :1087, `declare_intrinsic` :1101, `generate_global_symbol_name` :1166,
  `handle_fn_abi_err` :1297, `maybe_sign_fn_ptr` :29, `Funclet::new` :115, `alloc_to_backend` :178, `const_str` :355,
  `scalar_to_backend_with_pac` :403, `get_dllimport` :506. All are correct.
- common.ts follows upstream order exactly. context.ts deviates only as the `--order` row above shows.

## 2. Logic fidelity
### `create_module` (context.rs:184-597, context.ts:422-728)
- **Data layout.**
  - The s390x `-S64` strip runs under `llvm_version < (23,0,0)`. `replaceAll` is the right translation, since `str::replace` replaces every occurrence.
  - The block structure is upstream's: `create_informational_target_machine`, `LLVMRustSetDataLayoutFromTargetMachine`, then
    `LLVMGetDataLayoutStr`, the comparison, and `MismatchedDataLayout`.
  - `MismatchedDataLayout` takes `rustc_target: TargetTuple.display(..)`. This is tuple.rs:140 `Display`, i.e. `debug_tuple()`.
    `llvm_target` and both layouts are passed in upstream order.
  - The `expect` becomes an `assert` with upstream's message. That is PORT decision 6, and it is sound.
- **Triple, PIC/PIE, code model.**
  - The triple is `versioned_llvm_target(sess.early_sess)`.
  - The PIC level is set for `Pic | Pie`, and the PIE level when the model is `Pie` or every crate type is `Executable`.
  - The code model goes through `to_llvm_code_model(sess.code_model())`. `large_data_threshold` is set only when given.
- **Module flags.** Every flag matches upstream in name, merge behaviour, value and condition:
  - **Single flags:**
    - `RtLibUseGOT`: Warning, 1, set when `!needs_plt`;
    - `CFI Canonical Jump Tables`: Override, under canonical-jump-tables and cfi;
    - `cfi-normalize-integers`: Override;
    - `EnableSplitLTOUnit`: Override, under split-lto **or** cfi;
    - `uwtable`: Max, `Sync` for `Some(true)` and `Async` for `Some(false) | None`, read from `UWTableKind_discriminant`.
  - **kcfi:** `kcfi` is Override. Nested under it, `kcfi-offset` is set only when the prefix is above 0, and `kcfi-arity` only
    when the arity indicator is on.
  - **cfguard:** the condition is `is_like_msvc || (Windows && Gnu && CfgAbi::Llvm)`. `NoChecks` gives 1 and `Checks` gives 2,
    both Warning.
  - **NumRegisterParameters:** Error.
  - **Branch protection:** all six flags are Min, in upstream order:
    - `branch-target-enforcement`, `sign-return-address`, `branch-protection-pauth-lr`, `sign-return-address-all`,
      `sign-return-address-with-bkey`, `guarded-control-stack`;
    - the `unwrap_or_else` default key is `B` on Windows and `A` elsewhere;
    - a non-AArch64 target reaches `bug!` with upstream's joined message.
  - **cf-protection:** `cf-protection-branch` for `Branch | Full` and `cf-protection-return` for `Return | Full`, both Override.
  - **Other flags:**
    - `Virtual Function Elim`: Error;
    - `ehcontguard`: Warning;
    - `function_return_thunk_extern`: Override, only for `ThunkExtern`;
    - `frame-pointer`: Max, set when not `MayOmit`, with `All` / `NonLeaf` / `None` from `FramePointerKind_discriminant`;
    - `indirect_branch_cs_prefix`: Override;
    - the small-data threshold: Error, with the flag name from `LlvmModuleFlag(flag)`, and `threshold as u32` written `>>> 0`.
  - **llvm.ident:** `rustc version {CFG_VERSION}` goes through `create_metadata` and `module_add_named_metadata_node`. Its text
    matches the oracle's.
  - **ABI flags:**
    - `target-abi` is set only on LoongArch32/64 and RiscV32/64;
    - `float-abi` needs `>= (24,0,0)` and `Some`;
    - `thread-model=single` and `exception-model=wasm` sit under `>= (24,0,0)`;
    - all four are Error.
  - **`-Zllvm-module-flag`:** the tuple order `(key, u32 value, behaviour)` matches options.rs:2640, and all eight behaviour
    strings map as upstream does, with `unreachable!()` otherwise.
  - The brief's "`-Zsplit-dwarf` / `dwarf_version` gates" do not occur in context.rs at the pin (`grep dwarf` finds nothing).
    So there is nothing to check there.
- `version_lt` / `version_ge` compare tuples lexicographically, as Rust's tuple `Ord` does.
- **`tm.drop()` (context.ts:462):** upstream's `tm` is bound inside the bare `{ … }` block (context.rs:206-227). It drops at that
  block's closing brace, after the mismatch check, and the TS call sits exactly there.
  - The oracle recording agrees: `LLVMGetDataLayoutStr`, then `LLVMDisposeTargetMachine(%4)`, then `LLVMSetDataLayout`.
  - The call is marked `// PORT (cg-context)`. See N4.

### `CodegenCx::new` (context.rs:600-731, context.ts:795-919)
- **The fields:** `use_dll_storage_attrs = is_like_windows`, and `tls_model` goes through `to_llvm_tls_model`, where `Emulated`
  gives `GeneralDynamic`.
- **Coverage:** `coverage_cx` stops (D18) only when `instrument_coverage()` is on.
- **Debuginfo:** `dbg_cx` is created only when `debuginfo != None`, in order: `CodegenUnitDebugContext::new(llmod, sess)`, then
  `build_compile_unit_di_node(tcx, cgu.name().as_str(), &dctx)`.
- **Sanitizer ignorelist:** with a non-empty list, `load_file` runs for each path before the `SanitizerIgnoreList::new` stop.
- **Construction:** the `FullCx` fields are upstream's 30, in order. `scx` is a second `SimpleCx::new`, which is the oracle's
  second `LLVMIntTypeInContext(%1, 64)` line.
  - The caches start empty, the counters at 0, and the `Cell`s at `None`.
  - The `instances`, `intrinsic_instances`, `vtables` and `type_lowering` maps are `KeyedMap`s on `intern_key`.
  - `intrinsics` uses one `intrinsics_key_fn()` per cx: the name, plus type identity by per-cx number. This is PORT decision 4,
    and it keeps `(Cow<str>, SmallVec<[&Type;2]>)` equality.
- **`SimpleCx::new`:** `isize_ty` is `LLVMIntTypeInContext(llcx, pointer_size.bits())`.

### `get_intrinsic` / `declare_intrinsic` (context.rs:1087-1148)
- **The cache:** the key is the name plus a copy of `type_params`. A miss calls `declare_intrinsic`, inserts the result and
  returns it, as `entry().or_insert_with_key` does.
- **`memcmp`:** `fn(ptr, ptr, isize) -> int`, declared with `UnnamedAddr::No`.
- **`__rust_retag_reg` / `__rust_retag_mem`:** they take `type_params`, return `ptr` / `void`, and are given `NoUnwind` via
  `create_attr(llcx)` and `apply_to_llfn`.
- **The default arm:** `Intrinsic::lookup(bytes) ?? bug!("Unknown intrinsic: `{base_name}`")`, then `get_declaration(llmod,
  type_params)`, which returns `(get_type_of_global(f), f)`.

### The other context.rs functions
- **`create_used_variable_impl`:** `const_array(type_ptr, values)` and `add_global(llmod, val_ty(array), name)`, then the
  initializer, `AppendingLinkage` and section `llvm.metadata`. `val_ty` on a `CodegenCx` is the trait method, as upstream.
- **Objective-C:**
  - `objc_abi_version` asserts with upstream's message and returns 1 only on x86 macOS.
  - `add_objc_module_flags` uses the version, `Image Info Version 0`, and the section strings for 1 and 2 (`unreachable`
    otherwise).
  - `Is Simulated` is `1 << 5`, set only for `Env::Sim`. `Class Properties` is `1 << 6`. All are Error.
- **ptrauth:** `ptrauth-elf-got` and `ptrauth-sign-personality` are Error with value 1. The pauthabi platform is `0x10000002`,
  then the version. Both are Error.
- **`eh_personality`:**
  - the cached value is returned first;
  - otherwise the name is `__CxxFrameHandler3` (msvc seh), `__gxx_wasm_personality_v0` (wasm eh) or `None`;
  - the lang-item arm runs only when `name.is_none()`, and resolves with `RawList.empty()` and the session's ptrauth schema;
  - the fallback is `get_declared_value` or `declare_cfn(name, Global, variadic fn() -> i32)` plus `target-cpu`.
- **The other `MiscCodegenMethods`:**
  - `get_fn_addr` signs only with `Some(schema)`;
  - `set_frame_pointer_type`, `apply_target_cpu_attr` (cpu, then the optional tune) and `declare_c_main`, whose
    `Option::as_slice` becomes `[]` or `[attr]`;
  - `intrinsic_call_expects_place_always` (`black_box`).
  - `&SimpleCx` callees get `this.scx`. This is cg-contract decision 4, and the attributes.rs signatures (:229, :429, :434,
    :440) do take `&SimpleCx`.
- **Symbol names:** `generate_{local,global}_symbol_name` write `prefix.base62(idx)` and post-increment the counter.
- **Metadata helpers** (:889-929, :1182-1251): faithful. `get_functions` keeps upstream's loop around the two enzyme_ffi stops,
  following the existing `llir:` precedent in llvm/mod.ts:82.
- **The trait impls:** `HasDataLayout`, `HasTargetSpec`, `HasTyCtxt`, `HasTypingEnv`, `handle_layout_err` (`span_fatal` on
  `SizeOverflow | ReferencesError | InvalidSimd`, else `FailedToGetLayout`) and `handle_fn_abi_err`.

### common.rs (all of it)
- **`maybe_sign_fn_ptr`:** it returns `llfn` unless pointer auth is on. It also returns early unless the def kind is `Fn | AssocFn`
  and the ABI is `C | System`. LLVM intrinsics (`b"llvm."`) and the eh_personality lang item also return early.
  - `HardwareAddress(true)` gives `Some(llfn)` and `HardwareAddress(false)` gives `None`. `Synthetic(v)` gives
    `LLVMConstIntToPtr(const_u64(v), val_ty(llfn))`.
  - It ends with `const_ptr_auth(llfn, key as u32, disc as u64, ..)`.
- **`Funclet`:** `new` is `OperandBundleBox::new("funclet", [cleanuppad])`. `cleanuppad` and `bundle` are upstream's.
  `BackendTypes` is the `LlvmTypes` record.
- **The `GenericCx` inherent fns:**
  - `const_array` uses a `u64` length, i.e. a `bigint`.
  - `const_bytes` / `null_terminate_const_bytes` call `LLVMConstStringInContext2` with `DontNullTerminate` = TRUE / FALSE.
  - `const_get_elt` keeps the `c_uint::try_from` check, with Rust's `expect` text `…: TryFromIntError(())`, and then the
    `unwrap`.
  - `const_null_inherent` and `const_struct_inherent` are as upstream.
- **`alloc_to_backend`:**
  - `Function` gives `Ok(get_fn_addr(instance, schema))`.
  - `Static` checks both asserts, then returns `Ok(renamed_statics.get(def_id) ?? get_static(def_id))`.
  - `TypeId` gives `Err(0)`. A ZST `Memory` gives `Err(align.bytes())`.
  - `VTable` calls `vtable_allocation((ty, principal.map(instantiate_bound_regions_with_erased)))`, then `unwrap_memory`.
  - Then `const_alloc_to_llvm(.., IsStatic::No, IsInitOrFini::No)`.
  - With `need_symbol_name`, it calls `static_addr_of_mut` and sets the constant flag when the allocation is immutable, then
    gives a global symbol name and `InternalLinkage`.
  - Otherwise it calls `static_addr_of_mut` for `Mut` and `static_addr_of_impl` for the rest.
  - The `alloc_<hash>` naming stops only under `!fewer_names() && name empty` (see N3).
- **`ConstCodegenMethods`:**
  - `const_int` writes `i as u64` as `asUintN(64)` and passes sign-extend TRUE. `const_uint` passes FALSE.
  - `const_bool`, `const_i8`..`const_i64` and `const_u8`, `const_u32`, `const_u64` widen as upstream does.
  - `const_u128` calls `const_uint_big(type_i128)`.
  - `const_usize` asserts `i < 1 << bits` only below 64 bits.
  - `const_uint_big` passes the words `[u as u64, (u >> 64) as u64]`.
  - `const_real`, `const_vector` and `const_struct` (on `llcx`) are as upstream.
  - `const_to_opt_uint` / `const_to_opt_u128` go through `try_as_const_integral` and `then_some`. The ffi functions return
    `boolean`, so the truthiness test is right. The u128 is built from `hi` / `lo` in that order.
- **`const_str`:** a cache hit returns the cached global. A miss runs `const_bytes`, `generate_local_symbol_name("str")`, then
  `define_global` or `bug!("symbol `{}` is already defined")`. It then sets the initializer, constant, `UnnamedAddr::Global` and
  `InternalLinkage`, and applies `const_pointercast(g, ptr)` before caching. The length is `utf8_len(s)`, i.e. `s.len()` in
  bytes, through `const_usize`.
- **`scalar_to_backend_with_pac`:**
  - The bit size is 1 for bool, else the layout size.
  - **The `Int` arm:** `to_bits`, then `const_uint_big(type_ix(bits))`. A `Pointer` primitive gets `IntToPtr`; anything else
    gets `const_bitcast`.
  - **The `Ptr` arm:** `prov_and_relative_offset`, `global_alloc(prov.alloc_id())`, `address_space`, then
    `alloc_to_backend(.., false, schema)`.
    - On `Err(base)`, it computes the wrapping `u64` add and `truncate_to_target_usize`, then applies `IntToPtr` or bitcast.
    - On `Ok`, it emits a GEP on `i8` over `const_pointercast(base, type_ptr_ext(space))` with `const_usize(offset)`. That is
      followed by `PtrToInt` when the primitive is **not** a pointer, else bitcast. Upstream's negation is kept.
  - `scalar_to_backend` stays the ssa-provided forwarder (`with_pac(.., None)`, traits/consts.rs:42).
- **The rest:**
  - `const_ptr_byte_offset` is as upstream.
  - The free fns `val_ty`, `bytes_in_context`, `null_terminate_bytes_in_context`, `named_struct`, `struct_in_context`
    (`to_llvm_bool(packed)`), `hi_lo_to_u128`, `try_as_const_integral` and `get_dllimport` match upstream.
  - The brief's `const_data_from_alloc` does not exist at the pin.

## 3. No guessed values
- Every flag string, merge behaviour and constant (`0x10000002`, `1 << 5`, `1 << 6`, the UWTable and FramePointer discriminants,
  the section strings, the personality names) is upstream's text.
- **The lazy sibling loading** (context.ts:1418-1478) is a pure load-order mechanism.
  - Each accessor is a memoized `require` of the module the upstream `use` names.
  - lib.ts imports the three modules that attach methods to the classes (abi.ts, common.ts, debuginfo/mod.ts) anyway. The
    others (attributes.ts, callee.ts, back/write.ts, llvm_util.ts, debuginfo/metadata.ts, rustc_interface/util.ts) attach
    nothing: none has a `declare module` or a prototype assignment. So only the time of loading changes, not the behaviour.
  - It is documented in the file header under `PORT (cg-context)`, and in handoff decision 1.
- **The four foreign stubs** (context.ts:1485-1503) are typed with upstream's signatures (`wants_msvc_seh(&TargetSpec)`, and
  `TargetSpec` is base.ts's alias of `Target`). Each returns `unported("<owner>: <path> <fn>")`, never a value. See N1 and N2
  for the owner labels and where the stubs live.

## 4. Tests
- **The oracle is genuine.**
  - Both `.ll` files are the pinned rustc's `--emit=llvm-ir` output: I regenerated both, and they are byte-identical.
  - The `.script` files are record.ts's building thread from `LLVMContextCreate` on. The "fixtures are current" test re-records
    them and passes.
  - The 18 lines per target are what an empty no_core crate makes, with LLVM version 23.1.3.
- **The test doubles** (context.test.ts:109-205), checked against upstream:
  - `get_version` (llvm_util.rs:469), `to_llvm_code_model` (back/write.rs:160), `frame_pointer` (attributes.rs:217) and
    `needs_plt` (session.rs:863) are line-for-line copies. So are `branch_protection` (session.rs:1125, with the Windows-AArch64
    A→B key fix) and `must_emit_unwind_tables` (session.rs:1173-1178).
  - `OwnedTargetMachine::drop` is a copy of owned_target_machine.rs:86-92.
- **The stand-ins** do no more than the recording shows:
  - an opaque `fake_tm` carrying the oracle's data layout, since its creation is a hidden wrapper the recorder cannot see;
  - `LLVMRustSetDataLayoutFromTargetMachine` applying exactly the oracle's `?datalayout`;
  - `LLVMDisposeTargetMachine` recorded as the call itself.
- **Nothing ships in `src/` non-test code.** All doubles are `spyOn`s inside the test, restored in `finally`.
- **The comparison catches real defects:**
  - the port's own `LLVMSetDataLayout(target_data_layout)` is compared with the oracle's, so the target-spec layout is checked
    independently of the stand-in;
  - a wrong code model would add a `Code Model` flag;
  - the flag lines carry the merge behaviour. The handoff reports a mutation (`RtLibUseGOT` given `Override`) that failed the test.

## 5. Findings

### F (must fix before merge)
None.

### N (nits and follow-ups)
- **N1. The rustc_sanitizers stops use the owner label `rustc_sanitizers:` instead of `excluded (plan-m7 D18): …`.**
  - Where: context.ts:881 (upstream context.rs:687 `SanitizerIgnoreList::new`) and context.ts:1023 (context.rs:864
    `typename_for_ignore_list`).
  - Why it matters: plan-m7 D18 puts "sanitizers beyond what `opt` passes trivially" out of M7, as named stops.
    cg-contract decision (3) gives out-of-M7 stops the `excluded (plan-m7 D18): …` form.
  - The fix: relabel both stops, and move the 2 in `skeleton.test.ts` `EXPECTED` from `rustc_sanitizers` to
    `excluded (plan-m7 D18)` (11 → 13).
- **N2. For root: `Session::{needs_plt, must_emit_unwind_tables, branch_protection}` and `wants_msvc_seh` are stubs in the
  caller's file, not the owner's.**
  - Where: context.ts:1485-1503. They are called at context.rs:270, :306, :391 and :1001.
  - Why: cg-contract decision (3) puts stubs in the owner's file, but the lane could not edit session.ts or base.ts.
  - Impact: the first three stop **every** `create_module` once the backend is registered. `wants_msvc_seh` stops every
    `eh_personality`.
  - The fix, before registration:
    - port the three `Session` methods into rustc_session/session.ts, as root's exception like `fewer_names`; the test
      doubles are ready-made copies;
    - put `wants_msvc_seh` (`target.is_like_msvc`, base.rs:385) next to `wants_wasm_eh` in rustc_codegen_ssa/base.ts;
    - delete the four stubs and the matching spies, and update the `rustc_session` (3) and `ssa-base` (2) counts.
- **N3. For root: the `StableHash for Allocation` stop has no owner lane.**
  - Where: common.ts:328, upstream common.rs:253-258 (`alloc_<hash:032x>`).
  - Why it matters: M7 compares `--emit=llvm-ir` text, where `fewer_names()` is false, so every unnamed non-ZST constant
    allocation reaches this stop.
  - I confirmed that nothing in `src/` or `tools/` generates `stable_hash_Allocation`.
  - The fix: put it on the work queue. It needs tools/codegen's StableHash set extended to rustc_middle's
    `mir/interpret/allocation.rs`.
- **N4. For root: `tm.drop()` (context.ts:462) is an exception to cg-contract decision 12** ("nothing calls `drop()` at scope
  end"). It is correct here: it sits at the block end (context.rs:227), and the oracle records it there. Record it as a decision
  (handoff decision 3), worded as "an explicit `drop()` where Rust's drop glue makes an FFI call the oracle records".
- **N5. The weakened sketch assertions.**
  - Where: `skeleton.test.ts:244`, `:245` and `:247`.
  - The issue: three exact stop messages are now `expect.not.stringMatching(/^cg-context:/)`. That also accepts any unrelated
    failure, such as a `TypeError` from a real defect in `const_bytes`, `get_intrinsic` or `val_ty` on the marker `FullCx`.
  - The fix: assert the actual first failure, the same way the other rows name their stop.
- **N6. For cg-write, cg-types-attrs and root: the doubles are copies made at this pin.** When `get_version`,
  `to_llvm_code_model`, `create_*target_machine`, `frame_pointer` or the `Session` methods are ported, remove the matching
  `spyOn`. The oracle test then checks the real code instead of the copy. The handoff says the test passes either way.

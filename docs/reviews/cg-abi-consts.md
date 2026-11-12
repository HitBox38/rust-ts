# Review: lane cg-abi-consts (M7 wave 41, wave 40n)

**Verdict: PASS WITH NOTES**

Reviewed: branch `t3/port-cg-abi-consts`, commits `09a4555c` (port), `9d7496ce` and `b47819b4` (tests), `c3a3fe23` and
`f7a399c2` (handoff), as `git diff 51dfe33c..f7a399c2`, merged into the review worktree. Upstream at the pin
(`6f5da406b56c`): `compiler/rustc_codegen_llvm/src/abi.rs` (815 lines) and `consts.rs` (928 lines), read in full against
`src/rustc_codegen_llvm/abi.ts` and `consts.ts`.

There are no F findings. The port follows upstream function by function and nothing is guessed. The notes are about test
coverage, plus small nits.

## 1. Order and coverage

- `bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/abi.rs`: **26/26 ported**.
- `bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/consts.rs`: **21/21 ported**.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26406, …)`.
- I checked every marker against the upstream line.
  - abi.rs: 30/31, 60, 119, 124, 136, 140, 183, 225/231, 244, 298, 328, 336, 347–360 (the trait declarations), 364, 451,
    455, 459, 640, 766, 773.
  - consts.rs: 39, 62 (nested, as upstream), 158, 180, 190, 284, 288, 296, 324, 349, 367, 474, 681, 687, 694, 717, 745, 803,
    874, 914, 925.
  - All are correct and in upstream order. The local helpers (`version_ge`, `fn_ptr_parts`, `assert_eq_u32`, the
    sanitizer stubs, the lazy `base()`/`debuginfo()`) carry no marker, as they should.

## 2. Logic fidelity

### abi.rs

- **`get_attrs`** (abi.ts:95, abi.rs:60).
  - The three tables are in the same entry order (InReg; NoAlias, NonNull, ReadOnly, NoUndef, Writable, NoFree; the three
    `Captures*`).
  - Attributes are pushed in the same order: ABI-affecting, `align`, `zext`/`sext`, then only when optimizing:
    `dereferenceable` or `dereferenceable_or_null`, the optimization table, and the first matching captures entry (`break`).
  - The `deref != 0 && (llvm_version >= (23,0,0) || NoFree)` gate is exact. `version_ge` is the derived lexicographic
    tuple order. `regular -= NonNull` is `ArgAttribute.difference`.
  - The non-optimizing MSan `noundef` branch is present.
- **`apply_attrs_to_llfn` / `apply_attrs_to_callsite`** (abi.ts:161/167, abi.rs:119/124): exact.
- **`LlvmType for Reg`** (abi.ts:186, abi.rs:140).
  - All arms are present, including the vector element hint table (F16B, and the `bug!` for PpcF128) and the
    `is_multiple_of` assert before the division.
- **`LlvmType for CastTarget`** (abi.ts:271, abi.rs:183).
  - `rest_count`: 0 when `rest.total` is zero. Otherwise the `assert_ne!` (core's message format) and `assert_eq!` on
    `RegKind::Integer` when the total does not divide, then `div_ceil` on `u64` (bigint).
  - With no prefix: a bare `unit` when `rest_count == 1 && !is_consecutive`, otherwise `[N x unit]`.
  - Otherwise: a struct of the prefix regs plus `rest_count` copies of the unit, not packed.
- **`ArgAbiExt::store`** (abi.ts:336, abi.rs:244).
  - Indirect: `pointee_align.unwrap_or(layout.align.abi)`, then `OperandValue::Ref(PlaceValue::new_sized)`.
  - Cast: the spill goes through a temporary alloca, as upstream:
    `cast.size`/`cast.align` → `min(cast.unaligned_size, layout.size)` → `alloca` → `lifetime_start` → `store_cast` →
    `memcpy(dst, layout.align.abi, scratch, scratch_align, const_usize(copy_bytes), MemFlags::empty(), None)` →
    `lifetime_end`.
  - Pair and Direct use `from_immediate_or_packed_pair(..).val.store`.
- **`store_fn_arg`** (abi.ts:385, abi.rs:298).
  - The `PassMode::Pair` split takes `next()` twice, left to right, into `OperandValue::Pair`.
  - Direct, Indirect and Cast take one `next()` and then call `store`. IndirectUnsized hits the `bug!`.
- **`FnAbiLlvmExt::llvm_type`** (abi.ts:454, abi.rs:364).
  - The return comes first. Indirect pushes the `ptr`/`ptr_ext(addrspace)` argument before the others.
  - Ignore → `continue`.
  - Pair and IndirectUnsized push both scalar-pair element types (IndirectUnsized through `Ty::new_mut_ptr`).
  - Cast pushes `pad_i32_count` × `Reg::i32().llvm_type` first, evaluated once, as `repeat_n` does.
  - The variadic and non-variadic `type_func` both take the fixed-args slice.
- **`llvm_cconv`, `ptr_to_llvm_type`, `to_llvm_calling_convention`** (abi.ts:551, 546, 815): every arm and fallback matches
  abi.rs:773–815, including the `dcx().fatal` text and the `panic!` with `Arch`'s Display.
- **`apply_attrs_llfn`** (abi.ts:556, abi.rs:459).
  - Function attributes: noreturn, nounwind, then the RISC-V interrupt and cmse entry strings.
  - `apply` returns `i - 1`.
  - `apply_range_attr`'s four conditions are in upstream order.
  - The return-place `sret` logic:
    - the `assert!(mode == Pointer)`;
    - `sret([size x i8])` on `Argument(i)`;
    - then `writable` and `dead_on_unwind` only when optimizing.
  - The argument arms are in upstream order: Ignore, OnStack (`byval`), AmdgpuKernelArg (`byref`), Direct (+ range),
    Pointer (+ `dead_on_return` when optimizing), IndirectUnsized, Pair, Cast (padding `ArgAttributes::new()` × n, then the
    cast attrs).
  - The Pair's computed slice-length range: the `Int(_, false)` + `&[T]` + non-ZST element let-chain, then
    `isize_max = signed_max as u64` and `0..=isize_max / elem_size`. The `debug_assert!` is a comment, per PORTING.
  - `llfn_attrs_from_instance` gets `cx.scx`, `codegen_instance_attrs(instance.def)`, the instance and the ignorelist.
- **`apply_attrs_callsite`** (abi.ts:708, abi.rs:640).
  - Same structure, with `sret` but no writable or dead_on_unwind on the call. Direct and Pointer only `apply`.
  - `SetInstructionCallConv` only when the convention is not C. The cmse_nonsecure_call string attribute is there.
  - Element-type index: the slice-index panic text is kept, then `builtin_deref(true).expect("Must be pointer argument")`
    and `LLVMRustCreateElementTypeAttr(bx.llcx, layout.llvm_type)`.

### consts.rs

- **`const_alloc_to_llvm`** (consts.ts:77, consts.rs:39).
  - The `IsStatic::No` non-empty assert is there.
  - Relocation walk:
    - init/uninit chunks before each pointer (`offset > next_offset`);
    - the pointer's offset is `read_target_uint(..)` truncated `as u64` (`BigInt.asUintN(64, ..)`), with the `expect` text;
    - the address space comes from `global_alloc(prov.alloc_id())`;
    - the PAC schema choice (`init_fini` against `functions`) follows `IsInitOrFini`;
    - `scalar_to_backend_with_pac` gets `Scalar::Initialized { Pointer(addrspace), full(pointer_size) }`;
    - `next_offset = offset + pointer_size_bytes`.
  - The tail uses `alloc.len() >= next_offset`. A single value comes back bare; otherwise
    `const_struct_inherent(.., packed = true)`. That is the inherent fn, which is right (cg-contract F1).
  - `append_chunks_of_init_and_uninit_bytes`: the clone-take-count threshold against
    `uninit_const_chunk_threshold`, then per-chunk `const_bytes` / `const_undef([len x i8])`, or one `const_bytes` of the
    whole range.
  - The only dropped statement is the `assert_eq!(offset as usize as u64, offset)`. It is a no-op on the 64-bit host, and
    the comment says so.
- **`codegen_static_initializer`**: the `?` on `eval_static_initializer`, then the `.init_array`/`.fini_array` prefix test.
- **`set_global_alignment`**: `max(align, min_global_align)`.
- **`check_and_apply_linkage`** (consts.ts:235, consts.rs:190).
  - For `ExternalWeak`, `Option<fn ptr>` is declared as an `extern_weak` fn through `fn_abi_of_fn_ptr`. The `FnPtr` match
    is evaluated after the `Adt` and `Option` checks, in let-chain order. Anything else declares an i8 global.
  - The PAC `should_sign` test (`C`/`System` ABI) is there.
  - `set_linkage(linkage_to_llvm)`, then `assume_dso_local(g1, true)`.
  - The dummy global is `_rust_extern_with_linkage_{:016x}_{sym}`, with the `SymbolAlreadyDefined` fatal error. It gets
    internal linkage and `unnamed_addr`. Its initializer is either signed (`schema.key as u32`, `constant_discriminator`
    (u16) `as u64`) or `g1`.
  - The i686 `dllimport` branch calls `get_dllimport` only after the `X86 && is_using_dlltool` checks.
  - The oracle fixture checks the dummy global's hash: `0205f582a2516ec1`.
- **`static_addr_of_mut` / `static_addr_of_impl`**.
  - `Some(kind) if !fewer_names` against the anonymous `""`, each with its `bug!` text, then private linkage, initializer,
    alignment and `unnamed_addr`.
  - `static_addr_of_impl`'s cache hit raises the alignment (`as u32`). A cache miss creates the global, makes it constant
    and caches it.
- **`get_static` / `get_static_inner`** (consts.ts:402/426).
  - `DefKind::Static { nested }` → i8 or the layout type.
  - The cache, then the not-in-CGU assert (through `KeyedMap.has`, so the comparison is structural).
  - Local and not foreign: the conflicting-types `span_bug`, `declare_global`, and `Hidden` when not reachable.
  - Otherwise objc classref, then objc selref, then `check_and_apply_linkage`.
  - Thread-local mode. `dso_local = assume_dso_local(g, true)`.
  - For a foreign DefId:
    - `needs_dll_storage_attr` has all four conjuncts in order, with the EII exception;
    - the linker-plugin-LTO, Windows and `prefer_dynamic` assert is there;
    - `set_dllimport_storage_class` applies unless `is_codegened_item`.
  - Native-library `dllimport` comes last, then the cache insert.
- **`codegen_static_item`** (consts.ts:539).
  - The initializer-is-none assert, then the early return on `Err`.
  - Rename path: utf8 name with the `expect` text, the empty name, re-declare, copy linkage and visibility, insert into
    `renamed_statics`, push onto `statics_to_rauw`.
  - Then `set_global_alignment(alloc.align)`, the initializer, `assume_dso_local`, `constant` only when
    `mutability.is_not()`, and `build_global_var_di_node`.
  - Thread-local, then the WASM custom-section path: not `.init_array`, the provenance-empty assert, then `create_metadata`
    of the section name and the bytes into `wasm.custom_sections`.
  - `set_link_section`, `set_variable_sanitizer_attrs`, and the ignorelist block (behind the `rustc_sanitizers` stubs).
  - `USED_COMPILER` → `llvm.compiler.used` and `USED_LINKER` → `llvm.used`, each with its mutual-exclusion assert.
- **Objective-C helpers**: every symbol prefix, section string, linkage, alignment (i8 or pointer) and `abi_version` arm
  matches consts.rs:694–906. Class reference v2 builds the extern `OBJC_CLASS_$_` declaration before the local symbol, as
  upstream does. `const_null_inherent` is right.
  - `__llvm_profile` does not appear in consts.rs at the pin, so there was nothing to check.
- **`static_addr_of` / `codegen_static`** (consts.ts:955/967): exact.

## 3. No guessed values

- **`store_cast`** (abi.ts:51) is typed `(Builder, CastTarget, Value, Value, Align): void` and stops with
  `unported("ssa-block: compiler/rustc_codegen_ssa/src/mir/block.rs store_cast")`. That matches cg-contract's
  `<lane>: <upstream path> <fn>` format.
  - Upstream `store_cast` is `pub fn` at `compiler/rustc_codegen_ssa/src/mir/block.rs:2587`, re-exported by `mir/mod.rs:31`
    (`pub use self::block::store_cast;`). Confirmed.
- **`rustc_sanitizers`** (consts.ts:983–998): `Blame::NONE`, `Blame::max`, `in_section_blame` and `is_blame_ignored` all
  return through `sanitizers_stub` → `unported("rustc_sanitizers: … (rustc_sanitizers is out of scope, harness/scope.json)")`.
  All four stop. This is builder.ts's established form (builder.ts:2268).
- **The three test doubles** are confined to `abi_consts.test.ts`, installed with `spyOn` and restored in `afterEach`.
  - `get_version`: a line-by-line copy of llvm_util.rs:469–475.
  - `direct_access_external_data`: `opts.unstable_opts.direct_access_external_data.or(target.direct_access_external_data)`,
    session.rs:1092–1097, as `??`.
  - `build_global_var_di_node`: only metadata.rs:1478–1480 (`if cx.dbg_cx.is_none() { return; }`). Past that it stops with
    cg-di-a's stub message.
  - None of them appears in non-test code.

## 4. Tests

- **Oracle regeneration.** I regenerated with `rustc +nightly` (`1.101.0-nightly (6f5da406b 2026-10-10)`, the pin), using
  `--target x86_64-unknown-linux-gnu --emit=llvm-ir -Cno-prepopulate-passes -Ccodegen-units=1`:
  - `statics.rs` at `-Copt-level=0 -Zfewer-names=yes`: **24 global lines**, as the test asserts. A second run was
    byte-identical (`cmp`). The lines include the `_WEAK` dummy global, the `[3 x i8] undef` padding chunk, the three
    `anon.<hash>.N` strings, `thread_local`, `section ".custom"`, and `@llvm.used`.
  - `sigs.rs` at `-O0`: **26** `define` lines for `c_`/`r_`/`cc_`, matching the test's count.
  - `sigs.rs` at `-O1`: the `define` lines show exactly the three stops the test lists: `range(..)` on `r_char`/`r_slice`
    and `dead_on_return` on `r_big`.
  - The `call_all` lines carry the callsite attributes the test compares. The `spill_*` entry blocks match what the handoff
    describes.
  - The fixtures are generated at test time; no IR is stored. Scratch files were deleted.
- **Attribute comparison.** `canon_typed` sorts a parameter's or return's attributes as a **list**, not a set, so a
  duplicate or a missing attribute still fails. `align N` stays one token, and nested `()`/`[]`/`{}` keep `sret([24 x i8])`
  and `captures(address, read_provenance)` whole. For parameter and return attributes it hides only the order. The other
  things it drops: linkage and visibility words, value names, and everything after the `)`. N1 covers the last one.
  `CC_KEYWORDS` maps only the printer's spelling to a number.
- **`-Zfewer-names=yes` on both sides is fair.**
  - The only consts.rs path it changes is `static_addr_of_mut`'s `Some(kind) if !fewer_names` arm. Every caller in the
    fixture passes `kind = None` (`alloc_to_backend`), so nothing this lane owns goes untested.
  - The naming it avoids (`alloc_<hash>`) is cg-context's and rustc_middle's. The test's second case pins that stop.
  - It does mean the `generate_local_symbol_name` arm of `static_addr_of_mut` is untested. The handoff lists
    `static_addr_of` as untested.
- **Environment.** The test passes `{ ...process.env, … }` to its child rustc. That copies the environment and reads no
  variable. `bun test ./scripts/lib/unit-steps.test.ts`: **10 pass, 0 fail**.

## 5. The lane's decision request: `LLVMRustGetElementTypeArgIndex`

- **Yes, it is a three-case switch.** RustWrapper.cpp:1668–1677 switches on `CB->getIntrinsicID()`: `Intrinsic::arm_ldrex` →
  `0`, `Intrinsic::arm_strex` → `1`, anything else → `-1`.
- **For the implementer**, from the pinned LLVM (`$RUST_TS_DATA/llvm-src/aab11ee0…`):
  - `CallBase::getIntrinsicID` (Instructions.cpp:355–359) uses `dyn_cast_or_null<Function>(getCalledOperand())`. It is
    *not* `getCalledFunction()`, so there is no function-type check. An indirect call returns `not_intrinsic`.
  - `Function`'s ID comes from `Intrinsic::lookupIntrinsicID` (Intrinsics.cpp:758–776). An overloaded intrinsic matches
    exactly or by prefix; any other intrinsic must match exactly.
  - `llvm.arm.ldrex`/`strex` are overloaded on the pointer type (`llvm.arm.ldrex.p0`). `llvm.arm.ldrexd`/`strexd` are
    separate intrinsics. I took this from LLVM's IntrinsicsARM.td, which is not in the local llvm-src checkout.
  - So the model must accept the name `llvm.arm.ldrex` or `llvm.arm.ldrex.<suffix>`, and must **not** use a bare
    `startsWith("llvm.arm.ldrex")`, which would match `ldrexd`. The same holds for strex.
  - The model's `Function.isIntrinsic()` (src/rust_ts/llvm/ir.ts:1494) only checks the `llvm.` prefix, which is not enough.
- **Where it goes: `src/rust_ts/llvm/build.ts`.** That is the IR model's implementation module for the RustWrapper
  call-site functions, next to `LLVMRustAddCallSiteAttributes` (build.ts:617). After that, rerun `bun tools/llir/ffi_gen.ts`
  to regenerate `src/rust_ts/llvm/ffi.ts`, where it is the generated `stub` at ffi.ts:1387. The module list is in
  `impl_modules.ts`, and build.ts is already on it.
  - Root can queue it for the llir lane. It unblocks every `BuilderMethods::call`/`invoke` with a `FnAbi`.

## 6. Scope

`git diff --stat 51dfe33c..f7a399c2` touches these files:
- the lane's `abi.ts` and `consts.ts`;
- the new `abi_consts.test.ts` and `abi_consts_test/{sigs,statics}.rs`;
- its handoff;
- `skeleton.test.ts`. There the lane changed only its own lines: it removed the `codegen_static`/`get_param` stops and the
  `"cg-abi-consts": 20` row, added `"ssa-block": 1`, and set the auto-deref sketch's `llvm_type` row to a `TypeError`.

Nothing else changed.

## 7. Commands (review worktree, after `git merge f7a399c2`, AC power)

- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun scripts/coverage.ts --check --offline`: `markers ok (26406, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 390)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/ ./src/std/result.test.ts`: **84 pass, 0 fail** (10 files).
- `bun test ./scripts/lib/unit-steps.test.ts`: **10 pass, 0 fail**.

## Findings

No F findings.

- **N1: function-level attributes are not compared.**
  - Where: `abi_consts.test.ts:278`. `canon_sig`'s `\)[^)]*$` drops everything after the parameter list, including the
    `#N` attribute group on `define` lines and on `call` lines.
  - So the `noreturn`/`nounwind` that `apply_attrs_llfn` adds (abi.ts:557–572, abi.rs:465–484) and that
    `apply_attrs_callsite` adds (abi.ts:709–716, abi.rs:641–648) are never checked against the oracle. Likewise the
    `cmse` and `interrupt` strings, which are not reachable on x86_64 anyway.
  - The handoff's "`-> !`" coverage really checks only the `void` return.
  - The code matches upstream by reading, so this is a coverage gap, not a bug.
  - Suggestion: compare those two attributes through the group, or say in the header that function attributes are not
    compared.
- **N2: the spill test can pass on short or missing output.**
  - Where: `abi_consts.test.ts:416–418`. The `spill_*` check compares the port's lines with only the first `ours.length`
    lines of the oracle block.
  - An empty or truncated port block therefore passes, and a `spill_*` fn missing from the port text is never checked.
  - Suggestion: assert the per-fn line counts (Pair 3 after the alloca, Direct 1, bool 2), and that all three names
    appear.
- **N3: a duplicated comment line.** `abi_consts.test.ts:312–313` has the STOPS_O1 comment twice; line 312 is the
  leftover.
- **N4: the variadic slice does not panic.**
  - Where: abi.ts:457 (`this.args.slice(0, this.fixed_count)`), against abi.rs:368 (`&self.args[..self.fixed_count as usize]`).
  - Rust's slice panics when `fixed_count > len`; JS `slice` clamps.
  - It is unreachable by construction, so this is a nit. A one-line bounds panic would keep the upstream behaviour exactly.
- **N5: `store_cast` parameter names.** The local stub at abi.ts:51 names its parameters `_dst`/`_dst_align`, where
  upstream has `ptr`/`align` (block.rs:2587–2593). It is cosmetic, and the stub goes away when ssa-block lands.
- **N6 (for root): the count table does not see the sanitizer stubs.** The four `rustc_sanitizers` stubs use a template
  string, so skeleton.test.ts's literal-only count table does not see them. This is consistent with builder.ts and
  documented in the handoff. rustc_sanitizers is out of scope, so there is no lane to count them against.

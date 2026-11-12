# Review: cg-intrinsic-a (M7 wave 41, wave 40n): intrinsic.rs scalar half + IR-model intrinsics

**Verdict: PASS WITH NOTES**

Reviewer (independent, read-only on code). Reviewed: branch `t3/port-scalar-intrinsics`, commits `963e0d55` (IR model),
`06f056d9` (port), `9bea763e` (tests and oracle fixtures), `71bffaa6` (handoff), as `git diff 51dfe33c..71bffaa6`, merged into
the review worktree. Upstream: `compiler/rustc_codegen_llvm/src/intrinsic.rs:1-2046` at the pin. LLVM: `aab11ee0ea5e`
(`llvm/lib/IR/Intrinsics.cpp`, `llvm/lib/IR/Core.cpp`, `llvm/include/llvm/IR/Intrinsics.td`). Wrapper: `RustWrapper.cpp:1730`.
Machine on AC power; no gate was running.

I found no must-fix (F) findings. The port follows upstream arm for arm. The IR model follows Intrinsics.cpp. Its data is
checked against the oracle's own libLLVM, and the fixtures reproduce byte for byte with the pinned rustc.

## Commands (all run in the review worktree, `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`)
| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean (exit 0) |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26386, 44 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 404)` |
| `bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/intrinsic.rs` | **26/31**. Missing: `generic_simd_intrinsic` :2047, `vector_mask_to_bitmask` :2125, `simd_simple_float_intrinsic` :2496, `llvm_vector_ty` :2567, `llvm_alignment` :2671 |
| `bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./src/std/result.test.ts` | **196 pass, 0 fail**, 17 files |
| `bun test ./src/rust_ts/llvm/intrinsics.oracle.test.ts ./src/rustc_codegen_llvm/intrinsic.test.ts` | 35 pass, 0 fail, **0 skip**: the libLLVM tests and the fixture-currency tests ran |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass, 0 fail: no unlisted environment-variable reads |
| `bun tools/llir/ffi_gen.ts`, then `git status` and `--check` | no diff; `contract up to date: 381 fns, 33 enums, 4 bitflags` |

## 1. Order and coverage
- **26/31**, as claimed. Every top-level fn before :2047 has a marker, in upstream order. I checked all 26 markers against the
  `fn` lines (`grep -n` of the upstream file): `call_simple_intrinsic` :51, `black_box` :142, `codegen_intrinsic_call` :178, ...
  `get_args_from_tuple` :1994. All are exact.
- **The SIMD boundary at :2047 is right.** `get_args_from_tuple` ends at :2045, and `generic_simd_intrinsic` starts at :2047.
  The four other missing fns are nested in it. They stay one typed stub owned by `cg-intrinsic-b` (intrinsic.ts:2085).
- **Arm set.** The `sym::` arms of `codegen_intrinsic_call`'s match (upstream :192-890) and the port's `case sym.*` labels list the
  same names in the same order. `return_address` sits in `default` after the `simd_` guard, which is PORT decision 2. The
  `simd_` names and `return_address` are disjoint, so the order is the same.

## 2. Logic fidelity
I read every ported fn against upstream.
- **`call_simple_intrinsic`:** all 52 entries match, including `powi`'s `[fN, i32]`, `round_ties_even_* → llvm.rint`, and the
  `fixed_minmax` guards on `minimum`/`maximum` f64 and f128. When a guard fails, the result is `undefined`, the same as
  upstream's `_ => return None`.
- **`codegen_intrinsic_call`.** I checked every arm, including:
  - `minimum/maximum_number_nsz` with `LLVMRustSetNoSignedZeros`;
  - `ptr_mask` (`[val_ty(ptr), type_isize]`);
  - `offload` and `autodiff`, including their diagnostics;
  - `is_val_statically_known`;
  - `select_unpredictable`: all four operand shapes, the asserts and the `span_bug` text;
  - `va_arg`: the feature gate, and every `Primitive` arm with its bug text;
  - `volatile_load`/`unaligned_volatile_load`: `ptr_align`, the `< (23,0,0)` black box, and the temp `alloca` or result
    place;
  - `prefetch_*`: the (rw, cache) table and `const_at(1)` locality;
  - `carrying_mul_add`;
  - the bit-intrinsic group: ctlz/cttz with the `_nonzero` flag and `intcast`, bswap of width 8, `clmul`, min/max, the
    funnel shifts with the shift `intcast`, and the saturating names;
  - the float group: the `span_bug` text;
  - `raw_eq`: the `BackendRepr` match, `Size <= ptr*2`, and memcmp against `const_int(type_int, 0)`;
  - `compare_bytes` (`sext` to i32);
  - `black_box` (store, then the asm), `gpu_launch_sized_workgroup_mem` and `amdgpu_dispatch_ptr`;
  - the five `sve_tuple_*` arms;
  - the `simd_` unpacking and `llret_ty`;
  - `return_address` (wasm null; `type_params` changed at LLVM 23);
  - the fallback (`Instance::new_raw`), and the final `Memory` store versus `from_immediate_or_packed_pair`.
- **`codegen_llvm_intrinsic_call`:**
  - the `FnDef` signature with `no_bound_vars().unwrap()`, the c-variadic assert, and the zst-skipping `llargument_tys`;
  - the `intrinsic_instances` cache, then `get_declared_value`, then `intrinsic_fn`;
  - the `Ref` arm's load, bool `range_metadata` and `to_immediate_scalar`;
  - the `zip` autocast loop, and both assert messages (the first has no closing backtick, as upstream);
  - `LLVMBuildCallWithOperandBundles` with no bundles.
- **`intrinsic_fn`:**
  - the target-arch check, using `name[5..]`. It is safe in UTF-16 because the name starts with the ASCII `llvm.`, and
    `InstanceKind::LlvmIntrinsic` guarantees that prefix (block.rs:1154);
  - the non-overloaded signature check with the `{:?}` of both types;
  - `declare_raw_fn` (C, `UnnamedAddr::Global`, Default);
  - the upgrade path and the deprecation lint text.
- **`can_autocast`/`autocast`:** every arm, including the shuffle masks for vector lengths 1-3 and 4 or more, and `X86_AMX`.
- **Try shims:**
  - `codegen_msvc_try`: the slot `alloca`, `catchswitch`, the `??_7type_info@@6B@` global, `const_bytes("rust_panic\0")`,
    `__rust_panic_type_info` (`LinkOnceODR`, `SetUniqueComdat` under `supports_comdat`, the initializer), catchpad flags 8 and
    64 with their `funclet`s, and `catchret`;
  - `codegen_wasm_try`: `llvm.wasm.get.exception`/`ehselector` on `cleanuppad()`;
  - `codegen_gnu_try`: `landing_pad(struct{ptr,i32}, personality, 1)`, the null clause, `extract_value 0`, and both `ret`s.
  - All match upstream line for line.
- **`gen_fn`/`get_rust_try_fn`:**
  - `fn_abi_of_fn_ptr`, `declare_fn`, the frame-pointer and target-cpu attributes, and `InternalLinkage`;
  - the `"entry-block"` block;
  - the `Cell` cache;
  - the `unsafe fn(fn(*mut i8), *mut i8, fn(*mut i8, *mut i8)) -> bool` signature;
  - the pointer-auth attributes through `SESSION_STOPS.fn_attrs`.
- **Inherent before trait (PORT 1).** I checked it against upstream:
  - builder.rs:94-198 has inherent `append_block`, `trunc`, `bitcast`, `ret_void`, `ret`, `build`, `store` and `load` on
    `GenericBuilder`;
  - common.rs:149-172 has inherent `const_bytes`, `const_null` and `const_struct` on `GenericCx`.
  - Every such call in intrinsic.ts uses the `_inherent` variant. A grep finds no trait-name call left.
- **Other fns:**
  - `assume`/`expect` are gated on `OptLevel::No`, as upstream;
  - `type_checked_load`'s `| 0` equals `u64 as i32` for values below 2^53;
  - `va_start`, `ctpop`, `retag_*` and `codegen_retag_inner` match;
  - `codegen_autodiff`, `codegen_offload` and `get_args_from_tuple` match, including every `PassMode` arm;
  - `llvm_arch_for` has all 14 groups.
- At the pin, `va_end`, `volatile_store`, `three_way_compare` and `type_test` are not in intrinsic.rs. See N6.

## 3. The IR model (`src/rust_ts/llvm/intrinsics.ts`)
- **The 534-name table.** The porter extracted it from the oracle toolchain's own `libLLVM.dylib` with `LLVMIntrinsicGetName`
  and `LLVMIntrinsicIsOverloaded`. The table is reproducible and checked:
  - `intrinsics.oracle.test.ts` test 1 re-derives the table, its overload bits and the 19 target prefixes through `bun:ffi`,
    and compares them for equality. It passed with the probes required.
  - Test 2 compares `LLVMLookupIntrinsicID` between the model and libLLVM on over 4,000 names, and checks that four target names
    resolve above ID 534 in libLLVM and stop in the model.
  - The extraction script itself is not committed (N3).
- **Signatures.**
  - I checked all 62 `td:` citations by script. Each points at the `def int_<name>` line of the intrinsic it names. The one
    exception is `llvm.va_start`, whose def is `int_vastart` with an explicit `"llvm.va_start"` name at :864, which is correct.
  - I read 37 of the 62 entries' types against Intrinsics.td by hand. All match:
    - :864 va_start, :977 returnaddress, :1043 prefetch, :1060 assume;
    - :1208 fma, :1211 fmuladd, :1218 sqrt, :1219 powi `[anyfloat] ← [Match0, anyint]`, :1221 sin, :1223 pow, :1231 fabs,
      :1237 rint, :1240 round;
    - :1319 minimum, :1327 minimumnum;
    - :1599 expect, :1612 bswap, :1615 fshl, :1619 clmul, :1628 ctlz `[anyint] ← [Match0, i1]`, :1630 cttz;
    - :1739 and :1757 with.overflow with `LLVMScalarOrSameVectorWidth<0, i1>`;
    - :1768 sadd.sat, :1836 smax;
    - :1848 scmp and :1852 ucmp `[anyint] ← [anyint, Match1]`;
    - :1859 and :1862 lifetime;
    - :2050 trap, :2054 debugtrap;
    - :2117 and :2119 fpto*i.sat;
    - :2129 is.constant `[i1] ← [any]`, :2139 ptrmask `[any] ← [Match0, anyint]`, :2142 threadlocal.address;
    - :2801 type.checked.load `[ptr, i1] ← [ptr, i32, metadata]`.
  - Test 3 also declares every modelled signature with two sets of overload types, plus a vector `uadd.with.overflow`, and
    compares the name and function type with libLLVM's.
- **Lookup logic.**
  - `lookupLLVMIntrinsicByName` (Intrinsics.cpp:677) ports the successive `equal_range` over dotted components.
  - `strncmp` reading NUL past the end is equivalent to LLVM's. An entry still in range always reaches at least `CmpStart`, so
    LLVM never reads past that entry's NUL.
  - `findTargetSubtable` (:740) stops on a target prefix instead of answering "not an intrinsic", which would be wrong.
  - `lookupIntrinsicID` (:758) gives the exact-or-overloaded rule.
  - The name is a byte string (`bstrOfBytes`), so the comparisons are bytewise.
- **Declaration logic.**
  - `getOrInsertDeclaration` (:802), `getOrInsertIntrinsicDeclarationImpl` (:783) with the `.invalid` rename, and `getType`
    (:637): the return is void, the type, or a literal struct of several.
  - `DecodeFixedType` (:538) handles `SameVecWidth`, decoding the element before the overload type as LLVM does.
  - `getMangledTypeStr` (:86) covers p/a/s_/sl_/f_/v/nx/i/f16/bf16/f32/f64/f80/f128/ppcf128/x86amx/isVoid/Metadata. Target
    extension and byte types stop.
  - `getIntrinsicNameImpl` (:175) stops on an unnamed struct.
- **The C API.** `LLVMLookupIntrinsicID` (Core.cpp:2611), `LLVMIntrinsicIsOverloaded` (:2615) and
  `LLVMGetIntrinsicDeclaration` (:2566) are thin wrappers, as in Core.cpp. `LLVMRustIsTargetIntrinsic` (RustWrapper.cpp:1730)
  is `IID > TargetInfos[0].Count`.
- **Attributes.** `Intrinsic::getAttributes` is not applied. That is the existing IR-model decision (llir-core-a PORT 5),
  restated in the header. The tests strip ` #N`/`immarg`/`noundef` only on `declare` lines of intrinsics, consistent with it.
- **The `throw new Error` paths** (missing overload type, `cast<Function>` of a global) are LLVM UB or assertions. That is the
  IR model's existing convention (llir-core-b audit).
- **`ffi.ts` is exactly the generator's output.** Rerunning `bun tools/llir/ffi_gen.ts` left the tree unchanged, and `--check`
  passes. The four functions are bound to `impl2`, and `IMPLEMENTED` goes from 255 to 259. `impl_modules.ts` only appends
  `./intrinsics.ts`.

## 4. No guessed values
- **The cg-abi-consts doubles** (`FnAbi::{llvm_type, llvm_cconv, apply_attrs_llfn}`, intrinsic.test.ts:205-212) are `spyOn`s
  in the test, restored after each `run`. No non-test file contains them.
  - Their value, `i1 (ptr, ptr, ptr)` with C conv, is also what upstream computes for the `bool`-returning `rust_fn_sig`.
  - Some assertions are partly circular. See N2.
- **The msvc triple double** (`LLVMRustSetNormalizedTarget` for `x86_64-pc-windows-msvc`) is confined to the test, and the
  triple line is not compared. The other doubles are faithful copies, which I checked:
  - `wants_msvc_seh` matches base.rs:385 (`target.is_like_msvc`);
  - `get_version` matches llvm_util.rs:469;
  - the session helpers follow the bodies cited at their lines.
- **Stops:**
  - `generic_simd_intrinsic` → `cg-intrinsic-b`;
  - `OffloadMetadata::handle_abi` → `excluded (plan-m7 D18)`;
  - three local `rustc_codegen_llvm::intrinsic` stops, each where the text would otherwise be guessed: the `assert_matches!`
    Debug message, a negative index `as u64`, and the `from_utf8` panic text;
  - `llir:` stops for target tables, missing signatures, target extension types and unnamed overloads.
  - The cross-lane calls go to the owners' typed stubs: cg-asm, cg-intrinsic-b `emit_va_arg`, cg-write, ssa-base and
    cg-abi-consts.
  - The `skeleton.test.ts` counts were updated to match (excluded 11 → 12, `rustc_codegen_llvm` 5 → 7).

## 5. Tests
- **Oracle IR regenerated.** In scratch, I ran `rustc +nightly` (`1.101.0-nightly (6f5da406b 2026-10-10)`, the pin) as
  `--crate-type lib --emit=llvm-ir -Cno-prepopulate-passes` on `intr.rs`:
  - for `x86_64-unknown-linux-gnu`: `cmp` identical with the fixture;
  - for `x86_64-pc-windows-msvc`: identical as well.
  - Spot-checked bodies: `f_ctlz` (`call i64 @llvm.ctlz.i64(i64 %x, i1 false)` then `trunc ... to i32`), and `f_ptrmask`
    (`call ptr @llvm.ptrmask.p0.i64`) with its declaration.
  - The test suite's own "fixtures are current" check also re-runs the pinned rustc on all three fixtures. It ran and passed.
- **Without libLLVM.** With `rustc` removed from `PATH`:
  - without the variable, `intrinsics.oracle.test.ts` prints `SKIP: the oracle's libLLVM.dylib is unavailable;
    RUST_TS_REQUIRE_PROBES=1 makes this a failure` and skips 3 tests. It is not silent;
  - with `RUST_TS_REQUIRE_PROBES=1`, the same 3 tests **fail**. The message is poor (N4).
- **unit-steps:** passes.
- **The tests bite.** The porter flipped `ctlz`'s poison flag, renamed a shim block and changed the catchpad flag, and the
  tests failed each time. I did not repeat that, because the tree is read-only for reviewers. The comparisons are byte for byte
  on bodies, so I accept the claim.

## 6. Scope
`git diff --stat 51dfe33c..71bffaa6` touches only the files listed in the handoff:
- intrinsic.ts, intrinsic.test.ts and intrinsic_oracle/ (`intr.rs` and three `.ll`);
- intrinsics.ts and intrinsics.oracle.test.ts;
- impl_modules.ts and the regenerated ffi.ts;
- in skeleton.test.ts, only the cg-intrinsic-a stop line (now the `generic_simd_intrinsic` stop) and its count-table entries;
- the handoff.

Nothing in `tools/`, `scripts/`, `harness/`, the baselines or other lanes' files changed.

## Findings
No F findings.

- **N1** intrinsics.ts:15-16 and handoff:139 say the signatures cover "builder.rs's `call_intrinsic` uses that are not
  vector-only". Two such uses are missing:
  - builder.rs:2047 `llvm.type.test` (the CFI type test; the brief's `type_test`);
  - builder.rs:2225 `llvm.instrprof.increment`.

  Both stop with `llir: the signature of ... is not in the IR model`, so no wrong value comes out. Either add them (Intrinsics.td
  `int_type_test`, `int_instrprof_increment`) when cg-builder's CFI and instrumentation paths are in scope, or narrow the claim.
- **N2** intrinsic.test.ts:205-212. The cg-abi-consts `llvm_type` double fixes `__rust_try`'s type at `i1 (ptr, ptr, ptr)`, read
  off the oracle. So two comparisons are partly circular:
  - the function-type part of the `__rust_try` define-line comparison;
  - the `call i1 @__rust_try(...)` in both `f_try` bodies.

  The linkage, `unnamed_addr`, personality, shim bodies and globals are not circular. When cg-abi-consts lands, drop the three
  doubles and stop stripping ` zeroext` from the oracle's define line.
- **N3** The scratch script that extracted `GENERIC_INTRINSICS`/`TARGET_PREFIXES` (intrinsics.ts:27, :179) is not committed. It
  is reproducible in practice, because intrinsics.oracle.test.ts:74-89 re-derives and compares both. That test finds the
  generic/target boundary by where sort order breaks (`llvm.xray.*` → `llvm.aarch64.*`), not from `TargetInfos[0].Count`. The
  lookup test's `> GENERIC_INTRINSICS.length` checks cover it. Consider a header line saying the test is the regenerator.
- **N4** intrinsics.oracle.test.ts:60 (and intrinsic.test.ts's fixture test). Under `RUST_TS_REQUIRE_PROBES=1` with no
  libLLVM or toolchain, the failure is `TypeError: undefined is not an object (evaluating 'lib.LLVMIntrinsicGetName')`. It
  should be an `ERROR:` line naming the missing dylib or sysroot (AGENTS §4). It does fail, as required.
- **N5** intrinsic.ts:1539, :1679 and :1757 export `codegen_msvc_try`, `codegen_wasm_try` and `codegen_gnu_try`, "so tests can
  reach them" (PORT decision 9). No file imports them; the tests go through `codegen_intrinsic_call`. Drop the exports, or
  reword the decision.
- **N6** (information) Several names in the brief do not exist in intrinsic.rs at the pin:
  - `get_simple_intrinsic` and `codegen_emcc_try`, which the handoff already notes;
  - `va_end`;
  - `volatile_store`/`unaligned_volatile_store`, which rustc_codegen_ssa handles;
  - `three_way_compare` (builder.rs:1152, cg-builder);
  - `type_test` (builder.rs, see N1).

  The lane correctly did not invent them.
- **N7** intrinsic.ts:1035. `assert_scalable` builds its stop text with a template literal, so the skeleton.test.ts count regex
  does not see it. The handoff and the count comment disclose this. A fixed string literal, with the pattern kept in a
  separate PORT comment, would make the count exact.
- **N8** intrinsic.test.ts:84. `afterAll` removes `WORK` but leaves the empty parent `$RUST_TS_DATA/tmp/cg-intrinsic-test/`.
  This is trivial.

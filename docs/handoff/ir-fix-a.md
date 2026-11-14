# Handoff: ir-fix-a (M7b, wave 40r): first IR differences on the run-pass corpus

Branch `t3/fix-ir-run-pass-differences` (from `e80bc814`; no merges). Commits at the end.

## Summary
- **Sample:** 300 run-pass files at `-O` and 150 at `-Copt-level=0`, through `scripts/ir-diff.ts`'s file form (the sample list and rule
  are at the end).
- **N1 rate, before → after:**
  - `-O`: **279/300 (93.0%) → 288/300 (96.0%)**.
  - `-Copt-level=0`: **136/150 (90.7%) → 145/150 (96.7%)**.
  - Every case left except one is "both sides fail the same way": the file form compiles without the test's own flags (edition
    2024, `--test`, `-A` lints). That is the harness's form, not the port. The one left is an inline-asm stop (`asm/may_unwind.rs`, M7c).
- **No case went from MATCH to anything else.**
- **Five categories fixed, in order of count:**
  1. the x86 intrinsic table;
  2. `LLVMRustCreateMemoryEffectsAttr`;
  3. `generic_simd_intrinsic`;
  4. `emit_va_arg`;
  5. `DataLayout::getABITypeAlign` of a pointer.
- **Exploration:** a further 300 files at `-O` (sample positions 301-600) give 288 MATCH, 10 both-fail, 1 `simd_gather` stop and 1
  inline-asm stop.
- **One unit test outside this lane fails:** `skeleton.test.ts` "one stub per owning file". It expects the old SIMD stub. Root's
  one-line change is under [For root](#for-root).

## Before and after (N1, file form, x86_64-unknown-linux-gnu)

### `-O`, 300 files
| outcome | before | after | example |
|---|---|---|---|
| MATCH at N1 | 279 | **288** | `tests/ui/attributes/inner-attrs-impl-cfg.rs` |
| both fail the same way (oracle exit 1, port exit 1, same first stderr line; not the port's) | 11 | 11 | `tests/ui/explicit-tail-calls/ctfe-id-unlimited.rs` (`error[E0004]`: needs its own flags) |
| stop: `llir: the x86 intrinsic table ("llvm.x86.sse2.pause")` | 4 | 0 | `tests/ui/threads-sendsync/task-comm-14.rs` |
| stop: `cg-intrinsic-b: … generic_simd_intrinsic` | 3 | 0 | `tests/ui/backtrace/backtrace.rs` (`simd_splat`, then `simd_or`, `simd_reduce_all`, `simd_bitmask`), `tests/ui/simd/shuffle.rs` (`simd_shuffle`) |
| stop: `cg-intrinsic-b: … va_arg.rs emit_va_arg` | 2 | 0 | `tests/ui/c-variadic/copy.rs` |
| stop: `cg-asm: … asm.rs codegen_inline_asm` | 1 | 1 | `tests/ui/asm/may_unwind.rs` |
| first difference in the IR text | 0 | 0 | |

### `-Copt-level=0`, 150 files (the first 150 of the same list)
| outcome | before | after | example |
|---|---|---|---|
| MATCH at N1 | 136 | **145** | |
| both fail the same way | 5 | 5 | `tests/ui/test-attrs/custom_test_frameworks_simple.rs` (`E0601`: needs `--test`) |
| stop: `llir: LLVMRustCreateMemoryEffectsAttr` | 5 | 0 | `tests/ui/process/issue-13304.rs` |
| stop: `llir: DataLayout::getABITypeAlign of Pointer (not modelled)` | 1 | 0 | `tests/ui/consts/static-mut-refs.rs` (an `extern static` of pointer type) |
| stop: `cg-intrinsic-b: … emit_va_arg` | 1 | 0 | `tests/ui/consts/const-eval/c-variadic.rs` |
| stop: `cg-intrinsic-b: … generic_simd_intrinsic` | 1 | 0 | `tests/ui/alloc-error/alloc-error-backtrace.rs` |
| stop: the x86 intrinsic table | 1 | 0 | `tests/ui/async-await/async-drop/async-drop-open.rs` |

- **Every case that changed went from a stop to MATCH, with N1, N2 and N3 all the same.**
- **The MemoryEffects stop shows only at `-Copt-level=0`.**
- **No case anywhere stopped at a first difference in the IR text.** So no difference came from the text round trip or from the
  harness's normal form.

### Exploration, `-O`, sample positions 301-600 (after the fixes)
| outcome | count | example |
|---|---|---|
| MATCH at N1 | 288 | |
| both fail the same way | 10 | `tests/ui/coroutine/gen_block_panic.rs` |
| stop: `generic_simd_intrinsic simd_gather` | 1 | `tests/ui/simd/issue-89193.rs` |
| stop: `codegen_inline_asm` | 1 | `tests/ui/asm/x86_64/sym.rs` |

## The fixes
### 1. The x86 intrinsic table (IR model): `17f47e9e`
- **`src/rust_ts/llvm/intrinsics_x86.ts` (new):** the x86 part of LLVM's `IntrinsicNameTable`, 1,685 names with their `isOverloaded`
  bits, and `X86_INTRINSICS_OFFSET` = 14685, x86's `TargetInfos` offset.
  - The data comes from the oracle's libLLVM.dylib (`LLVMIntrinsicGetName` / `LLVMIntrinsicIsOverloaded` over every ID), as
    `GENERIC_INTRINSICS` already does.
  - `intrinsics.oracle.test.ts` re-reads the table and the offset, and fails on any difference.
- **`intrinsics.ts` follows Intrinsics.cpp:**
  - `lookupLLVMIntrinsicByName` now takes the target, as :677 does: it skips the `.target` component, :691.
  - `findTargetSubtable` (:740) returns the x86 subtable with its `Adjust` (:766). Other targets still stop, with their names.
  - `entry` maps x86 IDs.
- **Signature:** `llvm.x86.sse2.pause` from IntrinsicsX86.td:461, `Intrinsic<[], [], []>`. Any other x86 signature stops:
  `llir: the signature of llvm.x86.<name> (IntrinsicsX86.td) is not in the IR model`.
- **Tests (`intrinsics.oracle.test.ts`):**
  - lookup of every x86 name and its variants against libLLVM;
  - the x86 declaration;
  - other targets still stop.
- **Same commit:** Intrinsics.td's integer `llvm.vector.reduce.{add,mul,and,or,xor,smax,smin,umax,umin}` (:2917-2933). They need
  two new descriptor kinds:
  - `LLVMVectorElementType<n>`, decoded as `IIT_VEC_ELEMENT` (Intrinsics.cpp:617);
  - `llvm_any_vector_int_ty`.
  - The oracle test declares each of them for `<4 x i32>` and `<16 x i1>`.

### 2. `LLVMRustCreateMemoryEffectsAttr` (IR model): `cc84c57b`
- **`core.ts`:**
  - RustWrapper.cpp:578;
  - `Attribute::getWithMemoryEffects` (Attributes.cpp:281);
  - `getModRefStr` (:538);
  - `getAsString`'s memory arm (:644-703), as `memoryAsString`.
  - The encoding follows ModRef.h at the pin: 2 bits per `IRMemLocation`, six locations including ErrnoMem and TargetMem0/1.
- **ffi.ts regenerated** (`bun tools/llir/ffi_gen.ts`): `wrote ffi.ts (381 fns)`. This lane owns ffi.ts this wave.
- **Test (`folder.oracle.test.ts`):** all four effects, alone and in sorted sets with `nounwind` and a string attribute. The printed
  module must equal libLLVM's.

### 3. The head of `generic_simd_intrinsic` (intrinsic.rs:2047): `746445a0`
- **What run-pass programs reach through std:**
  - core's SIMD string search: `simd_splat`, `simd_eq`, `simd_or`, `simd_reduce_all`, `simd_bitmask`;
  - `simd_shuffle`.
- **Ported, in upstream order:**
  - the macros (as closures) and `vector_mask_to_bitmask` (:2125);
  - `simd_select_bitmask`, `simd_splat`, the scalable-vector preamble, the six comparisons, `simd_shuffle_const_generic`,
    `simd_shuffle`, `simd_insert[_dyn]` and `simd_extract[_dyn]` (:2047-2409);
  - `simd_bitmask` (:2443);
  - `minmax_red!` and `bitwise_red!` (:3011-3089);
  - `arith_binary!` and `arith_unary!` (:3308-3355);
  - the final `span_bug!`.
- **Every other arm stops by its intrinsic's name, in its place in the chain.** Upstream guards each of those arms by the name alone,
  so other names fall through exactly as upstream's chain does.
- **Tests (`simd_intrinsic.test.ts`, about 2 s):** two `#![no_core]` fixtures, compiled by the port's driver (`src/rust_ts/main.ts`)
  as a child process.
  - `simd_oracle/simd.rs`: 37 functions, one per arm and element kind. The IR must equal the pinned rustc's
    (`x86_64-unknown-linux-gnu.O.ll`), less comments, `; preds` tails and attribute-group numbers.
  - `simd_oracle/simd_err.rs`: 14 `InvalidMonomorphization` cases. The stderr must equal `simd_err.stderr` byte for byte.
  - With the pinned toolchain present, both fixtures are re-made and must be unchanged.
  - Passes with `CI` unset and with `CI=true`.

### 4. `va_arg.rs`: `emit_va_arg` and the x86_64 SysV path: `de860a59`
- **Ported, in upstream order:**
  - `round_up_to_alignment`, `round_pointer_up_to_alignment`, `emit_direct_ptr_va_arg`, `get_param_type_alignment`, the enums and
    `emit_ptr_va_arg` (:18-187);
  - `emit_x86_64_sysv64_va_arg`, `copy_to_temporary_if_more_aligned` and `x86_64_sysv64_va_arg_from_memory` (:528-830);
  - `emit_va_arg` (:1053), whose dispatch covers every arch. Every `emit_ptr_va_arg` target is ported, which includes
    aarch64-apple-darwin, the native host.
- **Not ported:** aapcs (aarch64 Linux), powerpc, s390x, hexagon (musl and bare metal) and xtensa. Each stops by name.
- **Test (`va_arg.test.ts`, about 1.3 s):** `va_arg_oracle/va.rs`, a std crate built with the pinned sysroot. It reads `c_int`,
  `c_uint`, `c_double`, `c_long`, `c_ulonglong`, a pointer and `usize`, so it covers both register classes and the memory path.
  - Same comparison as the SIMD test, plus "the fixture is current".
  - Skipped without the pinned sysroot unless `RUST_TS_REQUIRE_PROBES=1`.

### 5. The ABI alignment of a declared pointer global (IR model): `90c24ec6`
- **What changed:** `Value::getPointerAlignment` (fold.ts) took only integers and arrays of them for a declaration without an
  alignment. It now also takes pointers (and arrays of them), through `Module.pointerABIAlignment(AS)` in ir.ts. That ports
  `DataLayout::getPointerABIAlignment` (DataLayout.cpp:820): the address space's pointer spec, else address space 0's, default 8.
- **Where it shows:** the IR folds `and (ptrtoint @EXTERN_STATIC), C`.
- **Test (`folder.oracle.test.ts`):** declarations of `ptr`, `ptr addrspace(1)`, `ptr addrspace(270)` and `[3 x ptr]` under every
  test layout, plus a new layout `e-p:32:16-p1:16:32`, against libLLVM.

## For root
1. **`src/rustc_codegen_llvm/skeleton.test.ts`, not this lane's file, now fails one test.**
   - "stubs name their fill lane > one stub per owning file" calls `generic_simd_intrinsic` with undefined arguments and expects
     the stub's message `…/intrinsic.rs generic_simd_intrinsic$`.
   - The ported head reads `args[0].layout`, so that call throws a `TypeError`.
   - Proposed change: delete that `stops(...)` line, with a comment that ir-fix-a ported the head and `simd_intrinsic.test.ts`
     tests it.
   - The other skeleton test, "stub counts per lane", still passes. `cg-intrinsic-b` stays at 2: one `unported("cg-intrinsic-b: …"`
     helper in intrinsic.ts and one in va_arg.ts, each shared by that file's remaining stops.
2. **LLVM files to pin** in `harness/llvm-manifest.json` (`bun scripts/llvm-src.ts add <path>`). This lane may not edit `harness/`.
   - `llvm/include/llvm/IR/IntrinsicsX86.td`:
     - SHA-256 `c62fccf00f1c3c2fae7dce707794428c714e0107f57c4550793f2970f392beaa` (7,344 lines);
     - cited by the `llvm.x86.sse2.pause` signature (`td: 461, file: "IntrinsicsX86.td"`).
   - `llvm/include/llvm/Support/ModRef.h`:
     - SHA-256 `f44f0a5c4479c105541234081d8cb96e29b0b65d391feb573ca85a59aad5b74b`;
     - the `MemoryEffects` encoding that core.ts's memory attribute follows.
   - Both were fetched from `raw.githubusercontent.com/rust-lang/llvm-project/aab11ee0…` into the scratchpad.
   - Neither carries a `// llvm:` marker, since the markers this lane added are all in files already pinned: Attributes.cpp:281,
     :538 and DataLayout.cpp:820. `coverage.ts --check` passes without the two files. Pinning them makes the citations checkable.
3. **The x86 table is data from the oracle**, as the generic table is. A generator under `tools/` (not this lane's) could produce both.

## `unported(...)` left or added
- **intrinsic.ts, `cg-intrinsic-b: compiler/rustc_codegen_llvm/src/intrinsic.rs generic_simd_intrinsic <name>`:**
  - `simd_select`;
  - the 16 float intrinsics of `simd_simple_float_intrinsic`;
  - `simd_gather`, `simd_masked_load`, `simd_masked_store`, `simd_scatter`;
  - `simd_reduce_{add,mul}_{ordered,unordered}`;
  - `simd_cast_ptr`, `simd_expose_provenance`, `simd_with_exposed_provenance`, `simd_cast`, `simd_as`;
  - the unary integer arm (`simd_bswap`, `simd_bitreverse`, `simd_ctlz`, `simd_ctpop`, `simd_cttz`, `simd_carryless_mul`,
    `simd_funnel_shl`, `simd_funnel_shr`);
  - `simd_arith_offset`, `simd_saturating_add`, `simd_saturating_sub`.
  - Replaces the single stub for the whole function.
- **va_arg.ts, `cg-intrinsic-b: compiler/rustc_codegen_llvm/src/va_arg.rs <what>`:**
  - `emit_aapcs_va_arg`, `emit_s390x_va_arg`, `emit_powerpc_va_arg`, `emit_xtensa_va_arg`, `emit_hexagon_va_arg_musl`,
    `emit_hexagon_va_arg_bare_metal`;
  - the failing side of `assert_matches!(stability, CVariadicStatus::Unstable { .. })` (RiscV32 ilp32e, Sparc, Avr/M68k/Msp430,
    a custom target);
  - the MIPS `bug!` for an unexpected `LlvmAbi`, whose `Display` text is not ported.
- **intrinsics.ts:**
  - target tables other than x86's (`llir: the <target> intrinsic table`);
  - x86 signatures other than `llvm.x86.sse2.pause`.
- **fold.ts:** `DataLayout::getABITypeAlign` of other non-integer, non-pointer types (unchanged).
- **Reached and left:** `cg-asm: … codegen_inline_asm` (M7c, plan-m7 §2e).

## `// PORT:` decisions
1. **intrinsics_x86.ts:**
   - The x86 table is oracle data, verified by test, as `GENERIC_INTRINSICS` is.
   - Only x86's target table is in the model; other targets stop.
2. **intrinsics.ts:**
   - `Signature.file` marks a signature from IntrinsicsX86.td.
   - `TdType` gains `vecElement` and the `vecint` overload class.
3. **core.ts:**
   - `getAsString`'s memory arm is `memoryAsString`. It carries no `// llvm:` marker of its own, being part of `getAsString`
     (Attributes.cpp:552), and it cites :644-703.
   - The `MemoryEffects` encoding is written from ModRef.h.
4. **intrinsic.ts `generic_simd_intrinsic`:**
   - The head is ported ahead of cg-intrinsic-b; every other arm stops by name in its place.
   - The macros become closures.
   - `if cfg!(debug_assertions)` stays a comment.
   - `fn_args[2].expect_const()` is `GenericArg.expect_const(fn_args[2])`.
   - `.collect::<Option<Vec<_>>>()` maps every element, so each error is emitted, then tests for a `None`.
   - `i32::try_from(total_len).unwrap()` keeps its panic.
5. **va_arg.ts:**
   - Ported ahead of cg-intrinsic-b.
   - `assert_matches!` is ported where it holds; its failing side stops.
   - The `as i32` / `as u32` casts take small values (alignments, slot sizes, register counts).
   - `SlotSize` is its discriminant.
6. **ir.ts `pointerABIAlignment`:** reads only plain pointer specs `p[<n>]:<size>:<abi>[...]`, as `pointerSpecBitWidth` does. Any
   other spec stops.

## Coverage (`bun scripts/coverage.ts --missing`)
| file | before | after |
|---|---|---|
| `intrinsic.rs` | 26/31 | **28/31** (left: `simd_simple_float_intrinsic`, `llvm_vector_ty`, `llvm_alignment`) |
| `va_arg.rs` | 0/15 | **9/15** (left: `emit_aapcs_va_arg`, `emit_powerpc_va_arg`, `emit_s390x_va_arg`, `emit_hexagon_va_arg_musl`, `emit_hexagon_va_arg_bare_metal`, `emit_xtensa_va_arg`) |

- **Before `va_arg.rs`:** the skeleton's `emit_va_arg` stub carried no marker, hence 0/15.
- **`generic_simd_intrinsic` counts as ported** but is a partial port: the arms above stop.
- **`bun scripts/coverage.ts --check`:** `markers ok (27166, 75 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5323; library 745;
  llvm 527)`.

## Protected suites (step "Rules")
Run at `90c24ec6` with `RUST_TS_AGENT=ir-fix-a`, `--sample 200 --jobs 6`:

| suite | result | run id |
|---|---|---|
| `mir-o2` | 200/200 MATCH | `irfixa-prot-mir-o2` |
| `mono-ui` | 200/200 MATCH | `irfixa-prot-mono-ui` |
| `ir-hello` | 2/2 MATCH (the suite has 2) | `irfixa-prot-ir-hello` |
| `check-ui` | 200/200 MATCH | `irfixa-prot-check-ui` |
| `mir` | 200/200 MATCH | `irfixa-prot-mir` |

- **No DIFF, UNPORTED, CRASH or TIMEOUT in any of them.**
- **Every change is on the codegen path,** which none of these suites reach except `ir-hello`. `ir-hello` stays MATCH.

## Evidence (AC power; `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`)
- **`bunx tsc --noEmit -p .`:** clean at every commit.
- **`bun scripts/coverage.ts --check`:** `markers ok (27166, …; llvm 527)`.
- **`bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/rust_ts/ ./scripts/lib/unit-steps.test.ts`:** 613 tests across 69
  files, **612 pass, 1 fail**. The same result with `CI` empty and with `CI=true`, about 64 s each.
  - The one failure is `skeleton.test.ts` "one stub per owning file", not this lane's file (see [For root](#for-root)).
- **Added unit-test wall time,** about 3.5 s in all:
  - `simd_intrinsic.test.ts` about 1.9 s;
  - `va_arg.test.ts` about 1.3 s;
  - the added oracle checks in `intrinsics.oracle.test.ts` and `folder.oracle.test.ts` under 0.2 s together.
- **Environment variables the new tests read:** only `RUST_TS_REQUIRE_PROBES` and `RUST_TS_AGENT`, as `intrinsic.test.ts` does. They
  pass the environment through to the child compilers.
- **No `process.stdout` / `process.stderr` under `src/` outside tests. No lldb.**

## Files touched
- **IR model (`src/rust_ts/llvm/`):**
  - `intrinsics_x86.ts` (new), `intrinsics.ts`, `intrinsics.oracle.test.ts`;
  - `core.ts`, `ffi.ts` (regenerated), `folder.oracle.test.ts`;
  - `ir.ts`, `fold.ts`.
- **`src/rustc_codegen_llvm/`:**
  - `intrinsic.ts`, `simd_intrinsic.test.ts` (new), `simd_oracle/` (new: `simd.rs`, `simd_err.rs`, `x86_64-unknown-linux-gnu.O.ll`,
    `simd_err.stderr`);
  - `va_arg.ts`, `va_arg.test.ts` (new), `va_arg_oracle/` (new: `va.rs`, `x86_64-unknown-linux-gnu.O.ll`).
- **Docs:** `docs/handoff/ir-fix-a.md`.
- **Nothing outside the brief's list.** Not `skeleton.test.ts`, `llvm_util.ts`, fixers-58's files, `harness/` or `scripts/`.

## Commits
COMMITS

## The sample
- **Corpus:** the run-pass corpus is the files of `run-pass-miri` and `run-pass-miri-heavy` (`harness/suites.ts`: tests/ui run-pass
  tests without aux crates), with revisions merged into one file each: 3,333 files.
- **Order:** sorted by `sha256("ir-fix-a\0" + path)`.
- **Selection:**
  - the `-O` sample is the first 300;
  - the `-Copt-level=0` sample is the first 150 of the same list;
  - the exploration sample is positions 301-600.
- **How each file ran:** `bun scripts/ir-diff.ts <checkout>/<path> --opt O|0`, the file form (`irFileArgs`), 6 at a time. The run
  ids are `irfixa-{before,after}-{O,0}-<index>` under `$RUST_TS_DATA/runs/`, and `irfixa-explore-O-<index>` for the exploration.

<details><summary>The 300 files, in order (the first 150 are the <code>-Copt-level=0</code> sample)</summary>

```
tests/ui/attributes/inner-attrs-impl-cfg.rs
tests/ui/consts/static-mut-refs.rs
tests/ui/consts/const-eval/c-variadic.rs
tests/ui/enum-discriminant/actually_not_an_enum-discriminant.rs
tests/ui/associated-consts/associated-const-const-eval.rs
tests/ui/nll/rc-loop.rs
tests/ui/generics/generic-default-type-params.rs
tests/ui/derives/deriving-in-fn.rs
tests/ui/borrowck/borrowck-mut-uniq.rs
tests/ui/reachable/diverging-expressions-unreachable-code.rs
tests/ui/consts/const-extern-function.rs
tests/ui/const-generics/adt_const_params/const_param_ty_unchecked.rs
tests/ui/binop/infer-rhs-type.rs
tests/ui/traits/const-traits/std-impl-gate.rs
tests/ui/regions/regions-borrow-at.rs
tests/ui/impl-trait/lifetimes.rs
tests/ui/process/issue-13304.rs
tests/ui/borrowck/two-phase-control-flow-split-before-activation.rs
tests/ui/macros/macro-at-most-once-rep-2018-rpass.rs
tests/ui/impl-trait/region-escape-via-bound-contravariant-closure.rs
tests/ui/process/issue-20091.rs
tests/ui/consts/const-enum-struct.rs
tests/ui/explicit-tail-calls/default-trait-method.rs
tests/ui/impl-trait/closure-in-impl-trait.rs
tests/ui/codegen/box-deref-segfault-misopt.rs
tests/ui/numbers-arithmetic/float2.rs
tests/ui/pattern/move-ref-patterns/move-ref-patterns-dynamic-semantics.rs
tests/ui/numbers-arithmetic/f16-f128-lit.rs
tests/ui/generics/generic-ivec-leak.rs
tests/ui/consts/control-flow/short-circuit-let.rs
tests/ui/abi/extern/extern-call-scrub.rs
tests/ui/coroutine/nested_coroutine.rs
tests/ui/mir/enum/niche_option_tuple_ok.rs
tests/ui/codegen/StackColoring-not-blowup-stack-issue-40883.rs
tests/ui/consts/static-lifetime-inference-from-const-array.rs
tests/ui/fmt/format-enum-with-recursive-variant.rs
tests/ui/structs/newtype-struct-drop-run.rs
tests/ui/traits/inheritance/self-in-supertype.rs
tests/ui/consts/const_in_pattern/accept_structural.rs
tests/ui/pattern/struct-wildcard-pattern-14308.rs
tests/ui/higher-ranked/trait-bounds/hrtb-fn-like-trait-object.rs
tests/ui/traits/to-str.rs
tests/ui/impl-trait/issues/issue-49685.rs
tests/ui/lint/test-allow-dead-extern-static-no-warning.rs
tests/ui/mir/mir_raw_fat_ptr.rs
tests/ui/binop/binops-issue-22743.rs
tests/ui/explicit-tail-calls/ctfe-id-unlimited.rs
tests/ui/abi/extern/extern-pass-empty.rs
tests/ui/union/union-const-codegen.rs
tests/ui/lifetimes/tail-expr-lock-poisoning.rs
tests/ui/match/match-ref-mut-stability.rs
tests/ui/traits/object/iterator-methods-on-boxed-trait-object.rs
tests/ui/macros/concat-rpass.rs
tests/ui/attributes/optimize-smoke-test.rs
tests/ui/binding/multi-let.rs
tests/ui/pattern/issue-27320.rs
tests/ui/rfcs/rfc-1014-stdout-existential-crisis/rfc-1014-2.rs
tests/ui/binding/match-bot-2.rs
tests/ui/borrowck/borrowck-rvalues-mutable.rs
tests/ui/traits/trait-upcasting/multiple-supertraits-modulo-normalization.rs
tests/ui/panics/panic-recover-propagate.rs
tests/ui/for-loop-while/while-prelude-drop.rs
tests/ui/binding/exhaustive-bool-match-sanity.rs
tests/ui/panics/nested_panic_caught.rs
tests/ui/threads-sendsync/sendfn-is-a-block.rs
tests/ui/drop/issue-48962.rs
tests/ui/mir/enum/single_with_repr_ok.rs
tests/ui/mir/enum/plain_no_data_ok.rs
tests/ui/borrowck/borrowck-field-sensitivity-rpass.rs
tests/ui/traits/generic-cow-inference-regression.rs
tests/ui/alloc-error/alloc-error-backtrace.rs
tests/ui/macros/macro-nested_definition_issue-31946.rs
tests/ui/binding/match-borrowed_str.rs
tests/ui/splat/splat-method-tuple-simple.rs
tests/ui/where-clauses/issue-50825.rs
tests/ui/test-attrs/custom_test_frameworks_simple.rs
tests/ui/expr/if-panic-all.rs
tests/ui/mir/mir_codegen_array.rs
tests/ui/associated-types/nested-fnonce-output-projection.rs
tests/ui/extern/lgamma-linkage.rs
tests/ui/macros/macro-rules-derive.rs
tests/ui/enum-discriminant/issue-46519.rs
tests/ui/structs-enums/type-sizes.rs
tests/ui/panic-runtime/abort.rs
tests/ui/rfcs/rfc-2294-if-let-guard/scope.rs
tests/ui/codegen/no-segfault-with-multiple-codegen-units.rs
tests/ui/derives/no-spurious-unused-variable-warning-on-derive-hash.rs
tests/ui/associated-types/associated-types-impl-redirect.rs
tests/ui/higher-ranked/trait-bounds/hrtb-unboxed-closure-trait.rs
tests/ui/async-await/async-drop/async-drop-open.rs
tests/ui/reborrow/custom_mut_identity.rs
tests/ui/process/process-sigpipe.rs
tests/ui/closures/2229_closure_analysis/optimization/edge_case_run_pass.rs
tests/ui/regions/regions-static-closure.rs
tests/ui/for-loop-while/issue-69841.rs
tests/ui/coroutine/drop-track-addassign-yield.rs
tests/ui/std/add-spawn-hook-reentrancy-159923.rs
tests/ui/splat/splat-overload-at-home.rs
tests/ui/precondition-checks/cfg-ub-checks-yes.rs
tests/ui/array-slice-vec/estr-slice.rs
tests/ui/enum-discriminant/const-implicit-enum-discriminant.rs
tests/ui/structs-enums/small-enum-range-edge.rs
tests/ui/closures/2229_closure_analysis/preserve_field_drop_order2.rs
tests/ui/closures/closure-capture-after-clone.rs
tests/ui/type-inference/diverging-expr-unconstrained-type-param.rs
tests/ui/autoref-autoderef/auto-ref-sliceable.rs
tests/ui/structs-enums/enum-layout-optimization.rs
tests/ui/overloaded/overloaded_deref_with_ref_pattern.rs
tests/ui/coercion/box-dyn-to-ref-dyn.rs
tests/ui/coercion/basic-ptr-coercions.rs
tests/ui/associated-types/associated-types-duplicate-binding-in-env-hrtb.rs
tests/ui/array-slice-vec/subslice-patterns-const-eval-match.rs
tests/ui/deref/deref-newtype-slice-coercion.rs
tests/ui/closures/local-enums-in-closure-2074.rs
tests/ui/autoref-autoderef/autoderef-and-borrow-method-receiver.rs
tests/ui/cfg/cfg-macros-foo.rs
tests/ui/never_type/basic/never-type-rvalues.rs
tests/ui/intrinsics/always-gets-overridden.rs
tests/ui/traits/inheritance/static2.rs
tests/ui/codegen/dynamic-size-of-prefix-correctly-36278.rs
tests/ui/macros/assert-eq-macro-unsized.rs
tests/ui/mir/mir_codegen_switch.rs
tests/ui/generics/default-type-params-well-formedness.rs
tests/ui/binding/let-destruct-ref.rs
tests/ui/const-generics/broken-mir-2.rs
tests/ui/abi/extern/extern-pass-TwoU8s.rs
tests/ui/packed/dyn-trait.rs
tests/ui/abi/numbers-arithmetic/return-float.rs
tests/ui/higher-ranked/trait-bounds/hrtb-resolve-lifetime.rs
tests/ui/iterators/into-iterator-type-inference-shift.rs
tests/ui/const-generics/mgca/array-expr-with-assoc-const.rs
tests/ui/delegation/target-expr-pass.rs
tests/ui/derives/eq-ord/derive-partial-ord-discriminant.rs
tests/ui/lint/dead-code/associated-type.rs
tests/ui/coroutine/yield-in-initializer.rs
tests/ui/splat/splat-255-limit-pass.rs
tests/ui/async-await/async-closures/type-name.rs
tests/ui/methods/method-self-arg-trait.rs
tests/ui/binding/order-drop-with-match.rs
tests/ui/abi/extern/extern-return-TwoU64s.rs
tests/ui/overloaded/overloaded-index-assoc-list.rs
tests/ui/fmt/println-debug-different-types.rs
tests/ui/consts/const-eval/issue-64908.rs
tests/ui/match/issue-46920-byte-array-patterns.rs
tests/ui/statics/static-promotion.rs
tests/ui/runtime/running-with-no-runtime.rs
tests/ui/rfcs/rfc-3348-c-string-literals/basic.rs
tests/ui/abi/statics/static-mut-foreign.rs
tests/ui/expr/if-bot.rs
tests/ui/cast/negative-integer-cast-to-pointer.rs
tests/ui/inference/lambda-infer-unresolved.rs
tests/ui/overloaded/overloaded-calls-zero-args.rs
tests/ui/coercion/coerce-unsize-subtype.rs
tests/ui/impl-trait/universal_hrtb_anon.rs
tests/ui/asm/may_unwind.rs
tests/ui/unboxed-closures/unboxed-closures-infer-recursive-fn.rs
tests/ui/rfcs/rfc-1445-restrict-constants-in-patterns/phantom-data-is-structurally-matchable.rs
tests/ui/packed/issue-118537-field-offset-ice.rs
tests/ui/regions/regions-assoc-type-static-bound.rs
tests/ui/drop/issue-23611-enum-swap-in-drop.rs
tests/ui/fn/fn-ptr-trait-run.rs
tests/ui/const-generics/defaults/const-param-as-default-value.rs
tests/ui/sanitizer/cfi/async-closures.rs
tests/ui/structs-enums/enum-null-pointer-opt.rs
tests/ui/drop/issue-2734.rs
tests/ui/associated-types/associated-types-ref-in-struct-literal.rs
tests/ui/type/type-name-basic.rs
tests/ui/static/static-align.rs
tests/ui/self/self-in-mut-slot-immediate-value.rs
tests/ui/traits/impl-trait-chain-14229.rs
tests/ui/iterators/into-iter-on-boxed-slices-lint.rs
tests/ui/parser/issues/issue-65846-rollback-gating-failing-matcher.rs
tests/ui/rfcs/rfc-1445-restrict-constants-in-patterns/rfc1445/eq-allows-match-on-ty-in-macro.rs
tests/ui/higher-ranked/trait-bounds/infer-assoc-type-projection-type.rs
tests/ui/borrowck/incorrect-loan-error-on-local-update-5550.rs
tests/ui/lto/lto-still-runs-thread-dtors.rs
tests/ui/sanitizer/cfi/fn-ptr.rs
tests/ui/fn_traits/fn-trait-explicit-call.rs
tests/ui/enum/enum-nullable-simplifycfg-misopt.rs
tests/ui/drop/drop_order_if_let_rescope.rs
tests/ui/eii/static/default.rs
tests/ui/simd/shuffle.rs
tests/ui/parser/syntactic-trailing-commas.rs
tests/ui/functions-closures/closure-inference.rs
tests/ui/structs/destructuring-struct-type-inference-8783.rs
tests/ui/delegation/generics/mapping/inherent-impl-to-trait-pass.rs
tests/ui/never_type/regress/never-as-function-argument.rs
tests/ui/trivial-bounds/trivial-bounds-inconsistent-projection.rs
tests/ui/traits/issue-22655.rs
tests/ui/simd/target-feature-mixup.rs
tests/ui/traits/conditional-dispatch.rs
tests/ui/self/conflicting_inner.rs
tests/ui/mir/alignment/place_without_read.rs
tests/ui/derives/clone-copy/misbehaving-clone-impl.rs
tests/ui/inference/projection-cache-registers-obligations.rs
tests/ui/traits/trait-upcasting/diamond.rs
tests/ui/consts/issue-67641.rs
tests/ui/consts/const-size_of_val-align_of_val.rs
tests/ui/moves/moves-based-on-type-capture-clause.rs
tests/ui/regions/regions-expl-self.rs
tests/ui/union/union-generic-rpass.rs
tests/ui/macros/stringify.rs
tests/ui/sepcomp/sepcomp-statics.rs
tests/ui/try-trait/try-as-monad.rs
tests/ui/macros/macro-with-attrs1.rs
tests/ui/fmt/format-args-capture-macro-hygiene-pass.rs
tests/ui/array-slice-vec/subslice-patterns-const-eval.rs
tests/ui/supertrait-shadowing/assoc-type.rs
tests/ui/async-await/async-drop/async-drop-future-in-sync-context.rs
tests/ui/coroutine/static-coroutine.rs
tests/ui/unboxed-closures/unboxed-closures-prelude.rs
tests/ui/binding/irrefutable-slice-patterns.rs
tests/ui/consts/issue-90762.rs
tests/ui/associated-types/method-on-impl-with-assoc-type-projection.rs
tests/ui/impl-header-lifetime-elision/explicit-and-elided-same-header.rs
tests/ui/repr/align-with-extern-c-fn.rs
tests/ui/impl-header-lifetime-elision/bare_type.rs
tests/ui/borrowck/ref-mut-rebind-does-not-affect-outer.rs
tests/ui/supertrait-shadowing/common-ancestor.rs
tests/ui/associated-types/issue-25700-2.rs
tests/ui/mir/mir-inlining/ice-issue-77306-2.rs
tests/ui/compiletest-self-test/normalize-with-revision.rs
tests/ui/for-loop-while/loop-label-shadowing.rs
tests/ui/delegation/generics/impl-trait-to-trait-method-pass.rs
tests/ui/enum/enum-with-generic-parameter-5997.rs
tests/ui/macros/macro-of-higher-order.rs
tests/ui/trivial-bounds/trivial-bounds-inconsistent-sized.rs
tests/ui/coroutine/async_gen_fn_iter.rs
tests/ui/drop/generic-drop-trait-bound-15858.rs
tests/ui/consts/const-struct.rs
tests/ui/extern/extern-1.rs
tests/ui/structs/large-records.rs
tests/ui/traits/trait-implementation-restriction-5988.rs
tests/ui/simd/intrinsic/generic-cast-pointer-width.rs
tests/ui/c-variadic/copy.rs
tests/ui/associated-types/associated-types-binding-in-where-clause.rs
tests/ui/structs-enums/enum-non-c-like-repr-c.rs
tests/ui/consts/check_const-feature-gated.rs
tests/ui/traits/inheritance/num5.rs
tests/ui/borrowck/fsu-moves-and-copies.rs
tests/ui/array-slice-vec/box-of-array-of-drop-1.rs
tests/ui/fn/issue-1451.rs
tests/ui/threads-sendsync/task-comm-14.rs
tests/ui/associated-types/object-method-numbering.rs
tests/ui/binding/match-var-hygiene.rs
tests/ui/where-clauses/where-clauses-lifetimes.rs
tests/ui/associated-types/associated-item-long-paths.rs
tests/ui/inference/matcher-lifetime-inference-14919.rs
tests/ui/delegation/generics/mapping/free-to-free-pass.rs
tests/ui/closures/module-path-not-confused-with-upvar.rs
tests/ui/associated-types/issue-18655.rs
tests/ui/consts/const-fn-type-name-any.rs
tests/ui/autoref-autoderef/autoderef-method-twice-but-not-thrice.rs
tests/ui/regions/regions-issue-21422.rs
tests/ui/const-ptr/pointer-address-stability.rs
tests/ui/range/range_inclusive.rs
tests/ui/generics/issue-1112.rs
tests/ui/threads-sendsync/unwind-resource.rs
tests/ui/closures/destructure-newtype-closure.rs
tests/ui/splat/splat-generics-complex-types.rs
tests/ui/inline-const/const-expr-lifetime.rs
tests/ui/drop/drop-scope-exit.rs
tests/ui/regions/regions-early-bound-lifetime-in-assoc-fn.rs
tests/ui/pattern/issue-8351-1.rs
tests/ui/macros/typeck-macro-interaction-issue-8852.rs
tests/ui/traits/monad.rs
tests/ui/macros/macro-rules-def-in-block-expr.rs
tests/ui/typeck/typeck_type_placeholder_1.rs
tests/ui/borrowck/two-phase-bin-ops.rs
tests/ui/consts/const-enum-vec-ptr.rs
tests/ui/macros/metavar-expressions/count-and-length-are-distinct.rs
tests/ui/macros/macro-in-or-pattern.rs
tests/ui/loop-match/or-patterns.rs
tests/ui/regions/regions-fn-subtyping.rs
tests/ui/panics/panic-in-dtor-drops-fields.rs
tests/ui/drop/drop-on-ret.rs
tests/ui/rfcs/rfc-2497-if-let-chains/protect-precedences.rs
tests/ui/layout/null-pointer-optimization.rs
tests/ui/regions/regions-fn-subtyping-2.rs
tests/ui/simd/intrinsic/generic-reduction-pass.rs
tests/ui/delegation/explicit-paths-signature-pass.rs
tests/ui/splat/run-splat.rs
tests/ui/codegen/subtyping-impacts-selection-1.rs
tests/ui/binop/add-ref-operand-method-lookup.rs
tests/ui/float/f16b.rs
tests/ui/borrowck/region-checker-map-closure-13665.rs
tests/ui/for-loop-while/break.rs
tests/ui/rfcs/rfc-1717-dllimport/1717-dllimport/library-override.rs
tests/ui/structs-enums/align-struct.rs
tests/ui/const-generics/generic_const_exprs/dyn-compatibility-ok.rs
tests/ui/enum-discriminant/repr128-get-discriminant-issue-43398.rs
tests/ui/borrowck/borrowck-move-by-capture-ok.rs
tests/ui/unsafe/new-unsafe-pointers.rs
tests/ui/drop/issue-90752.rs
tests/ui/backtrace/backtrace.rs
tests/ui/match/match-usize-min-max-pattern.rs
tests/ui/command/command-exec.rs
tests/ui/traits/issue-9394-inherited-calls.rs
tests/ui/object-lifetime/object-lifetime-default-from-ref-struct.rs
tests/ui/mir/issue-77359-simplify-arm-identity.rs
```
</details>

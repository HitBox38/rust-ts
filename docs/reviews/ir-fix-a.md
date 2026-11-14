# Independent review: ir-fix-a (wave 40r)

Branch `t3/fix-ir-run-pass-differences`, head `e6ce457b`, lane commits `17f47e9e`, `cc84c57b`, `746445a0`, `de860a59`, `90c24ec6`, `17c33511`,
`e6ce457b` on top of main `e80bc814`. Reviewed and tested at `e6ce457b` on branch `t3/review-ir-fix-a-r`. Code read-only: the mutations
below were reverted at once (`git status` clean). All scratch was under the session scratchpad; the `rvirfixa-*` run dirs are removed. AC power,
`--jobs 6`, `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`. No gate, no full suite.

## Verdict: FAIL (F1 only; small fix)

Four of the five fixes are faithful line for line, and all their evidence held up. The fifth, `generic_simd_intrinsic`, is faithful except in one
arm: `simd_shuffle_const_generic` emits one error per out-of-bounds index, where rustc emits only the first. I confirmed that against the oracle
(F1). The committed fixtures don't exercise that arm, which is how it got through. The fix is a few lines plus two fixture entries.

| # | Severity | Where | Finding |
|---|---|---|---|
| F1 | **must fix** (output difference) | `src/rustc_codegen_llvm/intrinsic.ts:2293-2308` vs `intrinsic.rs:2283-2303` | `collect::<Option<Vec<_>>>()` stops at the first `None`; the port maps every index, so it emits an extra E0511 for each further out-of-bounds index |
| N1 | nit, test gap | `simd_oracle/simd.rs`, `simd_oracle/simd_err.rs` | Ported arms and diagnostics that no committed fixture covers. I checked them ad hoc and they match |
| N2 | nit, for root | `intrinsics.ts:410` (`td: 461, file: "IntrinsicsX86.td"`), `core.ts:1076-1086` | `IntrinsicsX86.td` and `ModRef.h` are not pinned. The values are checked against libLLVM, but the citations can't be checked |
| N3 | nit, for root | `intrinsics_x86.ts:1-6` | No regeneration script. The table is committed data, checked by a test. Same practice as `GENERIC_INTRINSICS` |
| N4 | nit, for root | `skeleton.test.ts:115` | Deleting the line is right, but then no test pins that a stopped SIMD arm names `cg-intrinsic-b`. Add one (below) |

## F1: `simd_shuffle_const_generic` reports every out-of-bounds index; rustc reports only the first

Upstream (`compiler/rustc_codegen_llvm/src/intrinsic.rs:2283-2303`):

```rust
let indices: Option<Vec<_>> = idx.iter().enumerate().map(|(arg_idx, val)| { ... emit_err(SimdIndexOutOfBounds ..); None ... }).collect();
let Some(indices) = indices else { return Ok(bx.const_null(llret_ty)); };
```

`FromIterator<Option<A>> for Option<V>` goes through `iter::try_process` / `GenericShunt`, which takes no more elements after the first `None`. So
the closure runs up to and including the first out-of-bounds index, and later indices are never visited and never reported.

The port (`intrinsic.ts:2293-2308`) runs `idx.map(...)` over every element, then tests `indices.some(v => v === undefined)`. Its `// PORT:`
comment at :2293 states this on purpose ("each out-of-bounds index emits its error"), and so does the handoff's PORT decision 4, bullet 5. That
reading of `collect` is wrong.

**Reproduced against the oracle** (std crate, `--sysroot <pinned> --crate-type lib --target x86_64-unknown-linux-gnu --emit=llvm-ir
-Cno-prepopulate-passes -O`, intrinsic declared as in `tests/ui/simd/intrinsic/generic-elements.rs:17`):

```rust
pub unsafe fn e_cg_oob(a: i32x4, b: i32x4) -> i32x4 { simd_shuffle_const_generic::<_, _, { &[9, 1, 10, 11] }>(a, b) }
```

- The oracle prints one `error[E0511]: ... SIMD index #0 is out of bounds (limit 8)`, then `aborting due to 1 previous error`.
- The port prints indices #0, #2 and #3, then `aborting due to 3 previous errors`.
- Exit codes are the same (1 and 1). Stderr differs.

**The valid path is right.** `f_cg` with `&[7, 1, 5, 0]` gives IR identical to the oracle's (same normal form as `simd_intrinsic.test.ts`).

**Fix:** loop over `idx` in order, emitting the error and stopping at the first out-of-bounds index (then `return Ok(const_null(llret_ty))`);
otherwise push `bx.const_i32(idx)`. Keep the `i32::try_from(total_len).unwrap()` panic in its place, before the comparison. Correct the `// PORT:`
comment and the handoff bullet. Add `e_cg_oob` (at least two out-of-bounds indices) to `simd_err.rs` and `f_cg` to `simd.rs`, then regenerate both
fixtures from the pinned rustc.

## 1. Fidelity

### `generic_simd_intrinsic` (intrinsic.rs:2047-3480 → intrinsic.ts:2087-2597)
- **Read line for line:**
  - the macros (`return_error!`, `require!`, `require_simd!`, `require_simd_or_scalable!`, `require_int_or_uint_ty!`), as closures;
  - `vector_mask_to_bitmask` (:2125);
  - `simd_select_bitmask`, `simd_splat`;
  - the `supports_scalable` preamble: `require_simd` for non-scalable names, then `require_simd_or_scalable`;
  - the six comparisons (`compare_simd_types`), `simd_shuffle_const_generic` (except F1), `simd_shuffle`, `simd_insert[_dyn]`,
    `simd_extract[_dyn]`;
  - `simd_bitmask` (:2443);
  - `minmax_red!` (:3011) and its two uses, `bitwise_red!` (:3038) and its five uses;
  - `arith_binary!` (:3308) with all 12 rows, `arith_unary!` (:3338) with `simd_neg`;
  - the final `span_bug!`.
  Order, predicates, diagnostic variants and fields, and the builder calls all match. The `arith` helper picks the first row whose kinds contain
  the element kind, which is what the macro's `match` arms do. Its `a0()` / `a1()` keep upstream's evaluation order.
- **Stops:** each unported arm stops on exactly the names upstream guards it by, at its place in the chain:
  - `simd_select` (:2411);
  - the 16 float names (:2545);
  - `simd_gather`, `simd_masked_load`, `simd_masked_store`, `simd_scatter`;
  - the four `arith_red!` uses (:2994-3009), which come *before* `minmax_red!` as upstream has them;
  - `simd_cast_ptr`, `simd_expose_provenance`, `simd_with_exposed_provenance`, `simd_cast | simd_as`, which come *after* `bitwise_red!`;
  - the unary integer names (:3357), `simd_arith_offset`, `simd_saturating_{add,sub}`.

  Every upstream arm is guarded by name alone (no arm tests the type before claiming a name), so no name can fall through to a wrong arm.
  Checked by hand on all 62 guards. Two runs showed it in practice. `tests/ui/simd/intrinsic/generic-bswap-byte.rs`, compiled with its own
  `--cfg minisimd_const`, stops at `... generic_simd_intrinsic simd_bswap`. A scratch crate calling `simd_cast` stops at `... simd_cast`, after
  the seven earlier error functions' diagnostics, which match the oracle's exactly.
- **Markers:** `// rustc: ...intrinsic.rs:2047 generic_simd_intrinsic` and `:2125 vector_mask_to_bitmask` are correct.
  `simd_simple_float_intrinsic`, `llvm_vector_ty` and `llvm_alignment` stay unmarked, which is right: they sit behind stopped arms.
- **Coverage counting:** consistent with the repo. PORTING §3 counts a function by its marker, and functions with named `unported(...)` stops for
  arms that aren't ported are already counted as ported elsewhere: the scalar half's excluded autodiff/offload arms, and `emit_va_arg`'s own
  dispatch in this lane. The handoff says plainly that `generic_simd_intrinsic` is a partial port.

### `va_arg.rs` (→ va_arg.ts)
- **Read in full:**
  - `round_up_to_alignment`, `round_pointer_up_to_alignment` (the mask `wrapping_neg() & (u64::MAX >> (64 - pointer_width))` done in
    `bigint`), `emit_direct_ptr_va_arg`, `get_param_type_alignment`, the four enums, `emit_ptr_va_arg`;
  - `emit_x86_64_sysv64_va_arg` (:528-772):
    - the peeling;
    - the register counts (`div_ceil(8)`, `div_ceil(16)`);
    - the `Memory` early return;
    - offsets 4 / `2*4 + ptr_size`;
    - the alignments 8 and 4 on `gp_offset` / `fp_offset`;
    - 48 − 8·gp and 176 − 16·fp;
    - all three `ScalarPair` cases, including the different store alignments (`align` vs `align_lo`/`align_hi`);
    - the step-5 updates;
    - the phi;
  - `copy_to_temporary_if_more_aligned`, `x86_64_sysv64_va_arg_from_memory` (overflow area at +8, the round-up when the alignment is over 8 bytes,
    `next_multiple_of(8)`);
  - `emit_va_arg` (:1053): every arm, in order and with the same arguments. `RiscV32 if Ilp32e` is ahead of `RiscV32 | LoongArch32`, as upstream
    has it.
- **Stops:** stops for aapcs, s390x, powerpc, xtensa and both hexagon arms, the failing side of `assert_matches!`, and the MIPS `bug!` that
  needs `LlvmAbi`'s `Display`. Each is named, in its arm.
- **Markers:** all 9 are correct.

### IR model
- **`intrinsics.ts`:** `lookupLLVMIntrinsicByName`'s `.target` skip matches Intrinsics.cpp:689-691. `findTargetSubtable` / `Adjust` match
  :740-776 (x86 subtable, `Adjust = Offset + 1`). `entry` maps x86 IDs.
- **`decodeFixedType`'s `vecElement`:** matches `IITDescriptor::VecElement` (Intrinsics.cpp:617-622), with the same `llvm_unreachable` text.
- **The `llvm.vector.reduce.*` signatures:** match Intrinsics.td:2917-2934 (`[LLVMVectorElementType<0>], [llvm_any_vector_int_ty]`).
- **`LLVMRustCreateMemoryEffectsAttr`:** matches RustWrapper.cpp:578-597, all four cases plus `report_fatal_error`. `getWithMemoryEffects`
  matches Attributes.cpp:281. `getModRefStr` matches :538.
- **`memoryAsString`:** matches `getAsString`'s Memory arm (Attributes.cpp:644-703) statement for statement, including `TargetPrintedForAll` and
  the `target_mem:` case.
- **Is the attribute text byte-identical for what rustc emits?** Yes, for the four combinations, which are all rustc can produce. The lane's
  `folder.oracle.test.ts` prints each one, alone and in sorted sets, against libLLVM's module text. A mutation of the encoding fails it (§4).
  The bit layout (2 bits per location, location order, `isTargetMemLocSameForAll`) comes from `ModRef.h`, which isn't pinned (N2). With the
  oracle comparison in place, it isn't a guess.
- **`Module.pointerABIAlignment`:** matches `DataLayout::getPointerABIAlignment` / `getPointerSpec` (DataLayout.cpp:746-755, 820). It falls back
  to AS 0, then to the default 8. A spec it can't parse stops. The change to `fold.ts` puts pointers through it, as `getAlignment`'s
  `PointerTyID` arm does.

## 2. The intrinsic table: data or a guess?

- **It is data, generated once and committed, with no run-time dependency on the oracle.**
  - `intrinsics_x86.ts` is a literal table (1,685 `[name, isOverloaded]` entries plus `X86_INTRINSICS_OFFSET = 14685`).
  - `intrinsics.ts` imports only that module.
  - `dlopen` / `bun:ffi` appear only in `intrinsics.oracle.test.ts`. That file walks every ID through `LLVMIntrinsicGetName` /
    `LLVMIntrinsicIsOverloaded` and requires the x86 run and its offset to equal the table.
  - It also checks `LLVMLookupIntrinsicID` on every x86 name, 7 variants of each and 9 near misses, against the model.
  - Mutating the offset fails 2 tests (§4).
- **This is how `GENERIC_INTRINSICS` is already sourced**, and how the Unicode tables are: oracle data plus an oracle test.
- **There is no regeneration script** for either table (N3). The handoff proposes one under `tools/`. Not blocking.
- **The `llvm.x86.sse2.pause` signature** (`Intrinsic<[], [], []>`, cited as IntrinsicsX86.td:461) is in `MODELLED_SIGNATURES`. So
  `intrinsics.oracle.test.ts` checks its declaration's name and function type against libLLVM's `LLVMGetIntrinsicDeclaration` (`void ()`). The
  value is verified. Only the line citation waits on pinning the file (N2).

## 3. Evidence

### Lane's tests
They ran inside the unit run below and all pass:
- `simd_intrinsic.test.ts` (4)
- `va_arg.test.ts`
- `intrinsics.oracle.test.ts`
- `folder.oracle.test.ts`

### `ir-diff`, 50 run-pass files of my own at `-O`
- **How I chose them:** I reproduced the lane's ordering, `sha256("ir-fix-a\0"+path)` over `run-pass-miri` ∪ `run-pass-miri-heavy`: 3,333
  files, with the same first file. I excluded the lane's positions 1-600 (its sample plus its exploration). From the rest, I took the first 50 by
  `sha256("ir-fix-a-review\0"+path)`.
- **N1 MATCH: 46/50.** N1, N2 and N3 were all the same in every MATCH.
- **Other: 4, all "both fail the same way" in the file form** (same exit, same stderr). The harness form lacks the test's flags:
  - `pattern/inc-range-pat.rs`: E0783, edition;
  - `test-attrs/issue-16597-empty.rs`: E0601, needs `--test`;
  - `imports/enum-variant-import-path-15774.rs`: E0432;
  - `simd/intrinsic/generic-bswap-byte.rs`: the auxiliary file / `--cfg`. With its own flag, the port stops at the named `simd_bswap` stop, as
    intended.
- **No difference in the IR text, and no CRASH.**

### Before-MATCH cases
8 of the lane's before-MATCH cases, at both `-O` and `-Copt-level=0`, all still MATCH at N1:
- `attributes/inner-attrs-impl-cfg.rs`
- `nll/rc-loop.rs`
- `derives/deriving-in-fn.rs`
- `numbers-arithmetic/float2.rs`
- `mir/mir_raw_fat_ptr.rs`
- `fmt/format-enum-with-recursive-variant.rs`
- `traits/to-str.rs`
- `structs-enums/type-sizes.rs`

### The lane's fixed cases
6 of them, re-run, all MATCH:
- `backtrace/backtrace.rs` (O)
- `simd/shuffle.rs` (O)
- `c-variadic/copy.rs` (O)
- `threads-sendsync/task-comm-14.rs` (O)
- `process/issue-13304.rs` (0)
- `consts/static-mut-refs.rs` (0)

### Ad hoc checks of uncovered arms (N1)
- IR identical to the oracle's for `simd_insert_dyn`, `simd_extract_dyn`, `simd_ne`/`simd_le` (int), `simd_gt` (float),
  `simd_maximum_number_nsz`, `simd_minimum_number_nsz`, `simd_rem` (u32 and i32), `simd_reduce_any` on u8x8, `simd_bitmask` u8x8 → u8,
  `simd_select_bitmask` u8 mask.
- Stderr identical for `InvalidBitmask`, `minmax_red` `ReturnType` and `UnsupportedSymbol`, `bitwise_red` boolean `UnsupportedSymbol`,
  `arith_binary` `UnsupportedOperation` (on `simd_shl` and on `*_nsz`), and the `simd_insert` index out of bounds.

## 4. Regressions
- **`bunx tsc --noEmit -p .`:** clean.
- **`bun scripts/coverage.ts --check`:** `markers ok (27166, 75 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5323; library 745; llvm 527)`.
- **`bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/rust_ts/ ./scripts/lib/unit-steps.test.ts`:** 613 tests across 69 files,
  **612 pass, 1 fail** (93 s). The one failure is `skeleton.test.ts` "stubs name their fill lane > one stub per owning file", as expected.
- **Protected samples** (`--sample 200 --jobs 6`, `RUST_TS_AGENT=rv-irfixa-r1`, so a different sample from the lane's):

  | suite | result |
  |---|---|
  | `mir-o2` | 199 MATCH, 1 UNPORTED |
  | `mono-ui` | 199 MATCH, 1 UNPORTED |
  | `ir-hello` | 2/2 MATCH |
  | `check-ui` | 200/200 MATCH |

  - Both UNPORTED are `tests/ui/attributes/log-backtrace.rs` (`rustc_log::BacktraceFormatter`, RUSTC_LOG_BACKTRACE). That stop has nothing to do
    with codegen, and the case is **not in** `harness/baseline/mir-o2.txt` or `mono-ui.txt`.
  - No protected case was lost. No DIFF, CRASH or TIMEOUT.
- **Mutations.** Each was applied alone, its test run, then reverted:

  | mutation | test | result |
  |---|---|---|
  | `simd_shr`'s `Uint` row `lshr` → `ashr` (`intrinsic.ts`) | `simd_intrinsic.test.ts` | 1 fail |
  | `InaccessibleMemOnly` encoded on `ArgMem` (`core.ts`) | `folder.oracle.test.ts` | 1 fail |
  | the va_arg gp limit `48` → `40` (`va_arg.ts`) | `va_arg.test.ts` | 1 fail |
  | `X86_INTRINSICS_OFFSET` 14685 → 14684 | `intrinsics.oracle.test.ts` | 2 fail |

## 5. The skeleton test (N4)

- **Deleting the `stops(() => generic_simd_intrinsic(...))` line at `skeleton.test.ts:115` is the right change.** The function's head is now real
  code that reads `args[0].layout`, so a call with `undefined` arguments can't reach a stop.
- **The line can't simply be kept with different arguments either.** Every remaining stop sits behind the `require_simd` preamble, so reaching
  one needs a real SIMD `Ty`.
- **What deleting loses** is the only assertion that a stopped SIMD arm names its fill lane. Recommended:
  1. Delete the line, with a comment pointing to `simd_intrinsic.test.ts`.
  2. Have the lane, or cg-intrinsic-b, add a small `#![no_core]` stop fixture there. One function calling, say, `simd_fsqrt`; assert exit 70 and
     stderr `rust-ts: unported: cg-intrinsic-b: compiler/rustc_codegen_llvm/src/intrinsic.rs generic_simd_intrinsic simd_fsqrt`.
- **"stub counts per lane" stays at `cg-intrinsic-b: 2`**: one shared helper in each of `intrinsic.ts` and `va_arg.ts`. Still passes.

## N1-N3 detail
- **N1:** the committed fixtures don't cover these. All match today by my checks above. Add them with F1's fix so that cg-intrinsic-b can't
  regress them:
  - `simd_shuffle_const_generic` (the cause of F1);
  - `simd_insert_dyn` / `simd_extract_dyn`;
  - `simd_ne` / `simd_le` / `simd_gt`;
  - `simd_{maximum,minimum}_number_nsz`;
  - integer `simd_rem`;
  - the `InvalidBitmask`, `minmax_red` and `UnsupportedOperation` diagnostics.
- **N2:** the lane asks root to pin both files with `bun scripts/llvm-src.ts add`. I agree:
  - `llvm/include/llvm/IR/IntrinsicsX86.td` (SHA-256 `c62fccf0…`), for the `td: 461` citation;
  - `llvm/include/llvm/Support/ModRef.h` (SHA-256 `f44f0a5c…`), for the encoding written in `core.ts`.

  I couldn't verify either line citation locally, because neither file is in `$RUST_TS_DATA/llvm-src`. Both values are verified against libLLVM.
- **N3:** a `tools/` generator that writes both `GENERIC_INTRINSICS` and `X86_INTRINSICS` from libLLVM would make regeneration repeatable. The
  test already makes any drift fail.

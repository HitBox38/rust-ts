# Independent re-check: ir-fix-a, review round 1 (wave 40r)

This re-checks the fixes for the first review (`docs/reviews/ir-fix-a.md`, `5153022c` on `t3/review-ir-fix-a-r`: FAIL on F1, with
N1-N4).

- **Subject:** lane commits `5691508a`, `38385bd8` and `e2f3cacd` on `t3/fix-ir-run-pass-differences`, on top of `e6ce457b`.
- **Where tested:** at `e2f3cacd`, on review branch `t3/review-ir-fix-a-recheck2`.
- **Read-only:** the code was not changed. Each mutation below was reverted at once, and `git status` was clean afterwards.
- **Conditions:** AC power, `--jobs 6`, `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`. No gate and no full suite.
- **Cleanup:** scratch went under the session scratchpad. The difftest run dir (`rv-irfixa-rc2`) has been removed.

## Verdict: PASS WITH NOTES

- **F1 is fixed**, line for line with upstream, and pinned by a test that fails on the old code.
- **N1, N3 and N4 are addressed** as the lane says.
- **The fixtures reproduce byte for byte** from the pinned rustc.
- **The new feature gates and lang items changed none of the earlier expectations.**
- **No other behaviour changed.**

The two notes below are nits; neither blocks.

| # | Severity | Where | Note |
|---|---|---|---|
| 1 | nit | `simd_intrinsic.test.ts` (the `simd_stop.rs` test) | It asserts the stop with `toContain`, not equality. The port's stderr today is exactly that line plus `\n`, so `toBe` would hold, and it would also catch output added before or after the stop |
| 2 | nit | `gen_intrinsics_x86.ts:85` | `--check` fails by throwing an `Error`, so Bun prints a source excerpt and a stack, not the single `ERROR:` line of AGENTS §4. The exit code (1) is correct |

## 1. F1: `simd_shuffle_const_generic` stops at the first out-of-bounds index

### What upstream returns

`intrinsic.rs:2283-2303` collects with `.collect::<Option<Vec<_>>>()`, then `let Some(indices) = indices else { return
Ok(bx.const_null(llret_ty)); };`.

- After the first `None`, upstream returns **`Ok`** with a null constant of the return type. That is not an `Err` the caller handles
  differently.
- The port returns `{ $: "Ok", _0: bx.const_null_inherent(llret_ty) }`, which is the same.
  - `const_null_inherent` is unchanged from the reviewed version. It is the inherent `CodegenCx::const_null` (`common.rs:168`).

### The new loop (`intrinsic.ts:2292-2313`)

- **Order:** it walks `idx` in order. For each index, it reads `to_leaf().to_i32()` first, then does the `i32::try_from(total_len).unwrap()`
  panic check, then the comparison. That is the closure's order.
- **On an out-of-bounds index:** it emits `SimdIndexOutOfBounds { span, name, arg_idx, total_len }`, then breaks. This is what
  `iter::try_process` / `GenericShunt` do: the closure runs up to and including the first `None`, and never again.
- **Otherwise:** it pushes `bx.const_i32(idx)`.
- **Comments:** the `// PORT:` comment is corrected, and so is the handoff's PORT decision 4.
- **Only other change in the file:** the now-unused `import type { Const }` is removed.

### IR and stderr against the oracle

- **`e_cg_oob` (`&[9, 1, 10, 11]`):** one `SIMD index #0 is out of bounds (limit 8)`, in both the oracle and the port. The fixture's total
  is 23 errors, and the test asserts that the oracle's stderr has exactly one such error.
- **`f_cg` (`&[7, 1, 5, 0]`):** `shufflevector ... <i32 7, i32 1, i32 5, i32 0>`, the same as the oracle's (part of the `simd.rs` IR test).
- **`f_cg_wide`:** the 4 → 8 case is also covered.
- **Ad hoc, beyond the fixture:**
  - I appended two cases to a scratch copy of `simd_err.rs`:
    - `&[1, 8, 2, 12]`: the first out-of-bounds index comes after an in-bounds one;
    - `&[0, 1, 2, 300]`.
  - The oracle reports `#1` and `#3`, one error each, and 25 errors in all.
  - The port's stderr is byte-identical, and both exit with 1.

### Old code put back

`git checkout e6ce457b -- src/rustc_codegen_llvm/intrinsic.ts`, then `simd_intrinsic.test.ts`:

- The `simd_err.rs` test fails. It gets the extra `SIMD index #2` and `#3` errors, and `aborting due to 25` where 23 is expected.
- The result was 5 pass, 1 fail.
- The file was restored afterwards.

## 2. N1: fixture coverage

### Regeneration

I compiled `simd.rs`, `simd_err.rs` and `simd_stop.rs` by hand in scratch with the pinned rustc (`rustc 1.101.0-nightly (6f5da406b
2026-10-10)`) and the test's flags (`--crate-type lib --target x86_64-unknown-linux-gnu --emit=llvm-ir -Cno-prepopulate-passes -O`).

| file | result |
|---|---|
| `simd.rs` | exit 0, IR `cmp`-identical to `x86_64-unknown-linux-gnu.O.ll` |
| `simd_err.rs` | exit 1, stderr `cmp`-identical to `simd_err.stderr` |
| `simd_stop.rs` | exit 0, empty stderr |

The test's own "oracle fixtures are current" block also ran (not skipped) and passed.

### Earlier expectations are unchanged

The lane added `adt_const_params`, `unsized_const_params`, `incomplete_features`, the `const_param_ty` lang item with its impls, and
the `unsize` / `coerce_unsized` lang items. None of this changed what the earlier cases test:

- **IR:** I split the old (`e6ce457b`) and new `.ll` into `define` blocks.
  - All 36 earlier functions are byte-identical once `!guid !N` is normalised. Only the numbering moves, because new functions sort
    in between.
  - The only lines outside functions that are new are three new `declare`s: `llvm.maximumnum.v4f32`, `llvm.minimumnum.v4f32` and
    `llvm.vector.reduce.or.v16i1`.
  - No line outside functions was lost.
  - 12 functions were added.
- **Stderr:** all 14 earlier error blocks are unchanged, apart from source line numbers and the gutter width. Nine blocks were added,
  and the total line changed from 14 to 23.

### Coverage against N1's list

Every item is covered:

- **Valid paths (IR):**
  - `simd_shuffle_const_generic`;
  - `simd_insert_dyn`, `simd_extract_dyn`;
  - `simd_ne`, `simd_le`, `simd_gt`;
  - `simd_{maximum,minimum}_number_nsz`;
  - integer `simd_rem` (i32 and u32).
- **Diagnostics (stderr):**
  - `InvalidBitmask` (`u16` mask);
  - `minmax_red`'s `ReturnType` and `UnsupportedSymbol` (f32);
  - `bitwise_red`'s boolean `UnsupportedSymbol` (`simd_reduce_all` on f32);
  - `UnsupportedOperation` on `simd_shl` and on `simd_maximum_number_nsz`;
  - `simd_insert` out of bounds;
  - the shuffle length mismatch.

## 3. N3: the x86 table generator

- **`--check` on this tree:** `bun src/rust_ts/llvm/gen_intrinsics_x86.ts --check` exits 0.
- **Write mode:** it rewrote `intrinsics_x86.ts` byte for byte (`git status` clean afterwards).
- **Mutations:** each was applied alone, then reverted.
  - Flipping `llvm.x86.sse2.pause`'s overload bit makes `--check` exit 1.
  - So does a one-character change to the header.
- **Hand-run only:**
  - Nothing imports it. `git grep gen_intrinsics_x86` finds only the handoff and the table's header comment.
  - It isn't a `*.test.ts`, and its body is under `import.meta.main`.
  - `bun test` never runs it. The table is still checked on every unit run by `intrinsics.oracle.test.ts`, as before.
- **No libLLVM at run time:** in `src/rust_ts/llvm/` and `src/rustc_codegen_llvm/`, the only non-test file using `dlopen` / `bun:ffi` is
  the generator. The lane's diff adds no other import. `intrinsics.ts` still imports only the committed data module.
- **The loop's end condition is safe** (`p === null || n <= 5 || n > 200`). In practice it stops at the first non-x86 name after the x86
  run, which is the next target's table, so it never asks for an ID past the last intrinsic.

## 4. N4: the stop fixture

- **The oracle compiles `simd_stop.rs` cleanly:** exit 0, empty stderr, one `define` (`@s_fsqrt`). The test asserts both.
- **The port** exits 70, and its stderr is exactly the following line, with nothing else (114 bytes):

  ```
  rust-ts: unported: cg-intrinsic-b: compiler/rustc_codegen_llvm/src/intrinsic.rs generic_simd_intrinsic simd_fsqrt
  ```

- **The test's check is looser** than that (note 1). It asserts `code === 70` and `stderr` *contains* the line. That is enough to pin the
  lane name and the arm, but it is not an exact equality.
- **The fixture's comment** cites `simd_simple_float_intrinsic` at `intrinsic.rs:2496`. That is correct at the pin.

## 5. No other behaviour change

- **`git diff e6ce457b e2f3cacd`** touches only:
  - `intrinsic.ts` (the F1 arm, plus one removed type import);
  - `intrinsics_x86.ts` (one header comment line);
  - the new generator;
  - the SIMD test and its fixtures;
  - the handoff.
- **It does not touch** `harness/`, `scripts/`, `tools/`, baselines, suites, `package.json` or `tsconfig.json`.

## 6. Commands

- **`bunx tsc --noEmit -p .`:** clean.
- **`bun scripts/coverage.ts --check`:** `markers ok (27166, 75 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5323; library 745;
  llvm 527)`, the same as round 1.
- **`bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/rust_ts/ ./scripts/lib/unit-steps.test.ts`:** 615 tests across 69
  files, **614 pass, 1 fail** (78 s).
  - The one failure is the known `skeleton.test.ts:115` ("stubs name their fill lane > one stub per owning file"), which root removes
    at integration.
  - There are 2 more tests than round 1's 613: the `simd_stop.rs` port and oracle tests.
  - `simd_intrinsic.test.ts` alone: 6 pass, 0 skip.
- **`RUST_TS_AGENT=rv-irfixa-rc2 bun scripts/difftest.ts --suite mir-o2 --sample 200 --jobs 6`:** **200/200 MATCH**. No DIFF,
  UNPORTED, CRASH or TIMEOUT. 44 s.

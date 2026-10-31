# followups-34: exact `UndefinedBehaviorInfo` pointer fields, size-bigint review nits

Lane `followups-34`, branch `t3/498e604e` (worktree `/Users/tomernorman/.t3/worktrees/rust-ts/t3-498e604e`), based on
main `db733043`. Follows `docs/handoff/size-bigint.md`, `docs/reviews/size-bigint.md` and the Size decision (cb7b9a60).

## ⚠ For root first: the oracle toolchain changed under the oracle cache

At 2026-10-31 23:49 (local), something installed the **`rust-src`** and **`miri-preview`** components into the oracle
toolchain `~/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin`. This lane did not install them. You can see
them in `lib/rustlib/components` and in the new `lib/rustlib/src/rust/library/...`.

- **Effect on rustc.** With `rust-src` present, `real_rust_source_base_dir` is set. Spans into std/core then render as
  local paths with source snippets, for example
  `--> ~/.rustup/.../lib/rustlib/src/rust/library/core/src/any.rs:746:9` plus the snippet. Before, they were
  `--> /rustc/6f5da406…/library/core/src/any.rs:743:0`. Those wider line numbers also widen the gutter of the whole
  diagnostic (`  -->` becomes `   -->`).
- **Effect on difftest.**
  - The port reads the toolchain now, so it follows the new behavior.
  - The cached oracle outputs date from before the install, so they don't.
  - Every case whose diagnostics point into std/core now DIFFs against the cache. **These include protected cases**: in
    my `--sample 300`, 7 of 7 such DIFFs are in `harness/baseline/mir.txt`.
  - Each one MATCHes a fresh oracle run (below).
  - Other suites with std spans (check-ui, borrowck-ui, tydump-ui, ...) are presumably affected the same way.
- **Before the next gate:** remove the component (`rustup component remove rust-src --toolchain nightly-2026-10-11`)
  or invalidate the oracle cache. Otherwise the gate will report protected-case losses that are not code regressions.
  I touched neither (harness/environment are root's).

## 1. The 3 mir cases: fixed

`consts/const_transmute_type_id2`, `consts/offset_from_ub` and `consts/offset_ub` no longer stop at
`UndefinedBehaviorInfo u64/i64 field beyond 2^53`.

| case | difftest (cached oracle) | fresh oracle, current env |
|---|---|---|
| `consts/offset_ub` | **MATCH** | **MATCH** |
| `consts/offset_from_ub` | DIFF: `rust-src` path/gutter only; the 19 error/warning/note headlines are identical | **MATCH** |
| `consts/const_transmute_type_id2` | DIFF: `rust-src` path/gutter only (`0xffffffffffffffff[noalloc]` message identical) | **MATCH** |

"Fresh oracle" means the suite's exact oracle and subject argv/env (`harness/suites.ts` `mir`), run from the upstream
checkout with stdout, stderr and exit compared byte for byte. The script is a scratch one in `/tmp/f34/scripts/cmp.sh`;
it is not in the repo.

### How

- **Codegen: per-field types.** `tools/codegen/types.ts` has a small new feature. A set-local type map (`typemap_extra`)
  may have `fields`, keyed by `<item key>::<field>` (struct; tuple fields by index) or
  `<item key>::<Variant>::<field>` (enum). Each key maps to a type-map path, and the probe's field type is rewritten to
  that path before generation. Every other field of the same Rust type keeps the global mapping. PORTING §5 says
  "`u64`/`i64`: number … else `bigint` per field", and the generator had no way to say "per field".
  - The alternative was a set-wide `u64`/`i64` → `bigint` override in `mir.typemap.json`. It would also have retyped
    `ProjectionElem::{ConstantIndex, Subslice}`, `ConstValue::Slice.meta`, `BoundsCheckFailed`, `FunctionCoverageInfo`
    …, which sit on hot paths and in other lanes' files.
  - New unit test: `tools/codegen/typemap_fields.test.ts`.
  - **This is a `tools/` change, so it needs its own review.** It is not recorded as a decision; record it if you
    accept it.
- **`tools/codegen/mir.typemap.json`:**
  - new type entry `rust_ts::u64_exact` / `rust_ts::i64_exact` → `bigint` (`debug_int`, `copy`);
  - `fields` for `UndefinedBehaviorInfo::PointerOutOfBounds::{ptr_offset, inbounds_size}` and
    `UndefinedBehaviorInfo::DanglingIntPointer::{addr, inbounds_size}`.
- **Regeneration.** I regenerated `rustc_middle_mir`, which changed 4 fields of `error.gen.ts` from `number` to
  `bigint`. Their Debug output is unchanged (`debug_int`). I also regenerated the 5 other sets that use
  `mir.typemap.json` (`rustc_middle_diagnostics`, `rustc_mir_build_builder`, `rustc_mir_transform`,
  `rustc_const_eval_interpret`, `rustc_borrowck`) and they came out byte-identical.
- **`error.ts` Display** (`display_UndefinedBehaviorInfo`):
  - `fmt_in_alloc_attempt` takes `inbounds_size: bigint`;
  - the `PointerOutOfBounds` / `DanglingIntPointer` arms compare and print bigints;
  - `ptr_offset.unsigned_abs()` is `-ptr_offset`;
  - `ptr_offset as u64` / `alloc_size.bytes()` became `bytes_u64()`;
  - `Pointer::without_provenance(addr)` takes the bigint directly.
- **`memory.ts`:** `check_and_deref_ptr` and `ptr_get_alloc_id` pass the exact `addr` / `size` / sign-extended offset.
  The `i64_number` guard is removed.
- **`validity.ts`:** `addr === 0n` and `without_provenance(i)`.
- **Tests:** the UB literals in `memory.test.ts`, `place_operand.test.ts` and `interpret_b.oracle.test.ts` are now
  `n` bigints.

I left `BoundsCheckFailed { len, index }` (`u64`) as `number`. Its producers are `const_eval/machine.ts` and
`interpret/projection.ts`, outside this lane, and no case here reaches it past 2^53. Retyping it is one more
`fields` line plus those two files.

## 2. Review nits (docs/reviews/size-bigint.md)

- **Finding 1, stale comments.** Fixed in:
  - `memory.ts` header, plus the old 552 and 739 sites;
  - `operator.ts` 531 (gone with the code change);
  - `intrinsics.ts` 568;
  - `validity.ts` 548;
  - `pointer.ts` 11-12;
  - `rustc_abi/layout.ts` 277-278;
  - the `typemap.hir.json` `rustc_abi::Size` note. The `mir.typemap.json` note was already accurate: it only points
    at the global entry.
- **Finding 2, the `i64::try_from(..).unwrap()` panics.** Restored:
  - in `memory.ts` through `i64_try_from_size(size)`, which is exact and panics with
    `called \`Result::unwrap()\` on an \`Err\` value: TryFromIntError(())` above `i64::MAX`. It is used at
    `get_ptr_access`, `check_ptr_access`, `get_ptr_alloc` and `get_ptr_alloc_mut`, and keeps upstream's local name
    `size_i64`;
  - in `intrinsics.ts` `arith_offset`, inline. The review called this `ptr_offset_from`; it is the
    `arith_offset` arm, upstream intrinsics.rs:394.
- **Finding 3, comparators.**
  - `provenance_map.ts` `cmp_Size` is now `Size_cmp`, kept as the exported name its callers use.
  - `rustc_abi/layout/ty.ts` `SIZE_RANGE_SET_OPS.cmp` is now `Size_cmp`.
  - In `validity.ts`, `SIZE_RANGE_SET_OPS.cmp` is now `Size_cmp`, and the local `size_eq` was removed in favour of
    `Size_eq`.
  - All three keep the number fast path.
- **Finding 4, upstream form.**
  - `compute_size_in_bytes` is `Size::from_bytes(total)` filtered by
    `Size_cmp(total, max_size_of_val()) <= 0`.
  - `insert_allocation`'s assert is `Size_cmp(alloc.size(), max_size_of_val()) <= 0` (the review's "allocate_bytes_ptr
    assert" is this one, memory.rs:284).
  - Both match upstream.
- **Also: `rustc_middle/ty/layout.ts` `SizeSkeleton::compute_inner` (array).** Its own
  `unported("Size beyond 2^53 …")` is gone. It is now `s.bytes_u64() * c`, `None` above `u64::MAX`, then
  `Size::from_bytes(size)`, as upstream.
- **Finding 5 (the `offset.bytes() !== 0` sites in memory.ts, and `rustc_lint/builtin.ts`).** Left as they were. No case
  here needs them, and they stop cleanly.
- **Stale comment outside my files:** `rustc_const_eval/interpret/eval_context.ts:27` ("`Size` / `usize` are numbers
  (recorded decisions)").

## Performance

No bigint is added on a hot path:
- `Size_cmp` / `Size_eq` compare numbers when both sides are small;
- the UB fields are built only on the error path;
- `i64_try_from_size` replaces the `bytes_u64()` call that was already there.

`insert_allocation` and `compute_size_in_bytes` now build `max_size_of_val()` (one big-form `Size`) where they used to
compute `target_isize_max()` (one bigint). The cost is about the same.

## Files touched

- **Code:**
  - `src/rustc_middle/mir/interpret/{error.ts, error.gen.ts (regenerated), pointer.ts, allocation/provenance_map.ts}`;
  - `src/rustc_const_eval/interpret/{memory.ts, operator.ts, intrinsics.ts, validity.ts}`;
  - `src/rustc_middle/ty/layout.ts`;
  - `src/rustc_abi/layout/ty.ts`;
  - `src/rustc_abi/layout.ts` (a comment only).
- **Tests:**
  - `src/rustc_const_eval/interpret/{memory.test.ts, place_operand.test.ts}`;
  - `src/rustc_middle/mir/interpret/interpret_b.oracle.test.ts`;
  - new `tools/codegen/typemap_fields.test.ts`.
- **Tools:** `tools/codegen/{types.ts, mir.typemap.json, typemap.hir.json}`.

## Checks

- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun scripts/coverage.ts --check --offline`: markers ok (23169; vendor 4680).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_abi src/rustc_const_eval src/rustc_middle src/rustc_ty_utils tools/codegen`:
  511 pass, 0 fail (72 files).
- `bun scripts/difftest.ts --suite mir --sample 300` (`RUST_TS_AGENT=f34`): MATCH 293, DIFF 7, run
  `20261031-215834-f34-waee`. All 7 DIFFs are the `rust-src` effect above, and each MATCHes the fresh oracle. They are:
  - `associated-type-bounds/do-not-look-at-parent-item-in-suggestion-for-type-param-of-current-assoc-item`;
  - `borrowck/closure-upvar-named-lifetime`;
  - `impl-trait/diagnostics/incorrect-skip-binder-for-item-bound`;
  - `suggestions/multi-suggestion`;
  - `traits/const-traits/partial/no-const-callers`;
  - `traits/suggest-dereferences/issue-39029`;
  - `wf/wf-impl-self-type`.
- The 3 cases: see the table in section 1. Runs `20261031-220116-f34-4f7w`, `20261031-220118-f34-fi8s`,
  `20261031-220120-f34-3pc6`.

## Coverage (`bun scripts/coverage.ts --missing`): all fully ported

- rustc_middle `mir/interpret/error.rs` 53/53, `pointer.rs` 39/39, `allocation/provenance_map.rs` 23/23,
  `ty/layout.rs` 61/61.
- rustc_const_eval `interpret/memory.rs` 73/73, `operator.rs` 10/10, `validity.rs` 41/41, `intrinsics.rs` 27/27.
- rustc_abi `layout/ty.rs` 47/47, `layout.rs` 16/16.

## `unported(...)` left / removed

- **Removed:**
  - `memory.ts` `i64_number`'s `UndefinedBehaviorInfo u64/i64 field beyond 2^53`;
  - `ty/layout.ts`'s `Size beyond 2^53 (… SizeSkeleton::compute_inner, array)`.
- **None added.**

## `// PORT:` decisions

- No new `// PORT:` comments in the code.
- The per-field typemap mechanism (above) is the one design decision. Its rationale is in the `TypeMap.fields` doc
  comment in `tools/codegen/types.ts` and in the `fields."//"` note in `mir.typemap.json`.

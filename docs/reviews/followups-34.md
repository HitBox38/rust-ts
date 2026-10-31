# Review: lane `followups-34` (exact `UndefinedBehaviorInfo` pointer fields, size-bigint review nits)

Reviewer: independent, read-only. Batch: `git diff db733043...HEAD` (lane head fa6ed7a6, branch `t3/498e604e`). Checked
against the pinned upstream:
- `compiler/rustc_middle/src/mir/interpret/error.rs`: the `UndefinedBehaviorInfo` fields and `Display`;
- `compiler/rustc_const_eval/src/interpret/{memory,validity,intrinsics,operator}.rs`;
- `compiler/rustc_middle/src/ty/layout.rs` (`SizeSkeleton::compute_inner`).

Also checked against `docs/reviews/size-bigint.md` and the Size decision (cb7b9a60).

Every comparison below is against the **normal oracle**. Root has removed `rust-src` and `miri` again: the toolchain's
`lib/rustlib/components` lists neither, and `lib/rustlib/src` is gone. All results use the cached oracle outputs.

## Verdict: APPROVE WITH NITS

No blocking findings.

## Checks

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean (exit 0) |
| `bun scripts/coverage.ts --check --offline` | markers ok (23169; vendor 4680) |
| `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_abi src/rustc_const_eval src/rustc_middle src/rustc_ty_utils tools/codegen` | 511 pass, 0 fail (72 files) |
| `difftest --suite mir --sample 300` (`RUST_TS_AGENT=f34`) | **MATCH 300/300**, DIFF 0. Run `rev-f34-mir300` |
| `difftest --suite mir --filter tests/ui/consts/offset_ub` | **MATCH** (run `rev-f34-consts_offset_ub`) |
| `difftest --suite mir --filter tests/ui/consts/offset_from_ub` | **MATCH** (run `rev-f34-consts_offset_from_ub`) |
| `difftest --suite mir --filter tests/ui/consts/const_transmute_type_id2` | **MATCH** (run `rev-f34-consts_const_transmute_type_id2`) |
| regenerate all 6 sets that use `mir.typemap.json` | `git status --short` clean |

About the sample:
- It is the same f34 sample as the handoff's. The 7 DIFFs the handoff blamed on `rust-src` now all MATCH, which
  confirms its explanation.
- Each `--filter` run selected exactly one case; I checked the case id in each run's `mir.jsonl`.

## What I verified

### 1. The 3 mir cases

All three MATCH the cached oracle (table above). The handoff's "fresh oracle" column for `offset_from_ub` and
`const_transmute_type_id2` was measured against the modified toolchain. That column is now moot: both MATCH the cache.

### 2. Codegen: per-field typemap `fields` (`tools/codegen/types.ts`)

**Correct.**
- `fields` is read only from `typemap_extra` files (types.ts:736), so it is set-local, as the `TypeMap.fields` doc
  comment says.
- Each matching probe field's `ty` is rewritten to the given path, after `items` is built and before generation.
  - Struct keys are `<item key>::<field name | index>`.
  - Enum keys are `<item key>::<Variant>::<field name | index>`.
  - The two forms cannot collide: a struct has no variants and an enum has no direct fields.
- `rust_ts::{u64,i64}_exact` → `bigint` with `debug_int`, which is `Debug<number | bigint>` (std/fmt.ts:178), so the
  Debug output is unchanged.

**Minimal.**
- Only the 4 listed fields change type. `BoundsCheckFailed`, `ProjectionElem`, `ConstValue::Slice` and the rest keep
  `number`.
- The 22 lines in `types.ts` are a small change.

**Documented.**
- The doc comment on `TypeMap.fields`, the `fields."//"` note and the type entry's `note` in `mir.typemap.json` explain
  the change.
- `typemap_fields.test.ts` covers struct, tuple and enum fields, checks that sibling fields and other variants keep
  `number`, and checks that an absent key causes no error.

**Reproducible.**
- I regenerated `rustc_middle_mir`, `rustc_middle_diagnostics`, `rustc_mir_build_builder`, `rustc_mir_transform`,
  `rustc_const_eval_interpret` and `rustc_borrowck`. `git status --short` stayed clean, so the committed `error.gen.ts`
  is exactly the generator's output.

**Effect on other sets: none.**
- No other file has `fields`.
- The `typemap.hir.json` edit only changes a `note`. A `note` reaches only the `missing_*` report text
  (types.ts:1524/1655/…), never generated code.

### 3. Fidelity of the bigint fields and their consumers

**`error.ts` `display_UndefinedBehaviorInfo`** follows error.rs:437–563 line for line:
- `fmt_in_alloc_attempt` takes `inbounds_size: i64` → `bigint`. It handles `== 1`, the `Dereferenceable` arm's `== 0`,
  and `{inbounds_size}` as decimal, so a negative value prints as `-3 bytes`, as Rust does.
- The `PointerOutOfBounds` arm:
  - `{:#x}` is `0x` + `toString(16)`;
  - `unsigned_abs()` is `-ptr_offset`, which is exact for `i64::MIN` as a bigint;
  - `ptr_offset as u64` vs `alloc_size.bytes()` uses `bytes_u64()`, so big allocations compare exactly.
- `DanglingIntPointer`: `addr: 0` is `addr === 0n`, and `Pointer::without_provenance(addr)` gets the exact `u64`.
- No rounding: there is no `Number(...)` / `BigInt(...)` conversion left in these arms.

**`memory.ts`:**
- `check_and_deref_ptr` and `ptr_get_alloc_id` pass `addr` and `size` straight through, as upstream does.
- The `PointerOutOfBounds` `ptr_offset` is `sign_extend_to_target_isize(offset)`.
- `get_ptr_vtable_ty`'s `InvalidVTablePointer` takes the exact `addr`.
- The `i64_number` guard and its `unported` are gone.

**`validity.ts`:** the arms at :489–498 match validity.rs:610–618:
- `addr === 0n` gives the null message;
- `without_provenance(i)` gives the dangling message;
- `PointerOutOfBounds` gives the bounds message.

`size.bytes()` → `bytes_u64()` in the "too close to the end of the address space" message prints the same decimal.

**Hot paths.**
- The new bigints are built only when an error is constructed.
- The access paths call `bytes_u64()` exactly as before, now inside `i64_try_from_size`.
- `Size_cmp` / `Size_eq` keep the number fast path (rustc_abi/lib.ts:1396–1407).

### 4. The nits

**`i64::try_from(size.bytes()).unwrap()`**
- `i64_try_from_size` (memory.ts:1982) is used at `get_ptr_access`, `check_ptr_access`, `get_ptr_alloc` and
  `get_ptr_alloc_mut`, matching memory.rs:465/489 and the two `get_ptr_alloc*` sites.
- `intrinsics.ts:570` is the `arith_offset` arm (intrinsics.rs:394), which ends in `wrapping_mul` → `asIntN(64, ..)`.
  The handoff is right that the earlier review's `ptr_offset_from` label was wrong.
- The panic text `` called `Result::unwrap()` on an `Err` value: TryFromIntError(()) `` is std's `unwrap_failed` with
  the `Debug` of `TryFromIntError(())`. It matches `place.ts`'s `offset_with_meta`.

**Comparators**
- `provenance_map.ts` `cmp_Size = Size_cmp`, so callers keep working under the old name.
- `layout/ty.ts` and `validity.ts` `SIZE_RANGE_SET_OPS.cmp` use `Size_cmp`.
- `size_eq` → `Size_eq` everywhere in validity.ts. All of these are exact for both forms.

**`compute_size_in_bytes` (operator.ts:529):** a `u64` `checked_mul` (`> U64_MAX` → `None`), then `Size::from_bytes`,
then `.filter(total <= max_size_of_val())`. This is upstream operator.rs:309–313.

**`insert_allocation` (memory.ts:552):** `assert!(alloc.size() <= self.max_size_of_val())`, as memory.rs:284, with the
same assertion text.

**`SizeSkeleton::compute_inner`, array arm (ty/layout.ts:715):** `s.bytes() .checked_mul(c)` is
`bytes_u64() * BigInt(c)`, with `> U64_MAX` → `SizeOverflow`, then `Size::from_bytes(size)`, as layout.rs:465–470. The
`unported` is gone. `unported` is still imported because it is used elsewhere in the file.

**Stale comments:** fixed at every site the size-bigint review listed. The remaining `2^53` mentions in the touched files
are accurate (AllocId, `ConstValue::Slice.meta`, `trailing_zeros`).

## Findings

All non-blocking.

1. **`tools/codegen/types.ts:769–781`: a `fields` key that matches nothing is ignored silently (non-blocking).**
   - A typo in a key, or an upstream rename of the field, quietly leaves the field `number`. The old guard is gone, so
     a value past 2^53 would then round instead of stopping.
   - The test even pins this behaviour (`fake::Absent::x`, no error).
   - Suggest pushing an entry to `report.errors` (or a dedicated report list) for each key that was never applied.
2. **`tools/codegen/types.ts:777`: `retype` mutates the caller's probe in place (`fl.ty = …`) (non-blocking).**
   - It is harmless today: the CLI calls `generate` once per process (types.ts:3988), and the test builds a fresh probe.
   - It would surprise a future caller that reuses one probe across sets. Note it in the doc comment, or rewrite a copy.
3. **No unit test for a value past 2^53 in `display_UndefinedBehaviorInfo` (non-blocking).**
   - The test literals were only retyped (`6` → `6n`, …).
   - The big-value path (`0xffffffffffffffff[noalloc]`, a big `ptr_offset`) is covered only by the 3 difftest cases.
   - A single `DanglingIntPointer { addr: 2n**64n-1n }` / `PointerOutOfBounds` with a big offset in
     `interpret_b.oracle.test.ts` would guard it cheaply.
4. **`compute_size_in_bytes` / `insert_allocation` now build a big-form `Size` from `max_size_of_val()` on every call
   (non-blocking, perf note).**
   - `compute_size_in_bytes` (operator.ts:531) does it on every slice/array size computation.
   - Then `Size_cmp` takes its bigint path. This replaces one bigint comparison with a `Size` allocation plus two
     `bytes_u64()` calls.
   - It is the upstream form, and the handoff calls the cost "about the same". The mir sample shows no timeouts.
   - If profiling ever flags it, caching `max_size_of_val()` per data layout is a cheap fix.
5. **Carried over, outside the lane:**
   - `rustc_const_eval/interpret/eval_context.ts:27` still says "`Size` / `usize` are numbers". The handoff flags it.
   - `BoundsCheckFailed { len, index }` is still `number`. That is fine, since no case reaches it; it is one `fields`
     line plus `const_eval/machine.ts` / `interpret/projection.ts` when needed.

## Handoff claims

- **tsc, markers, unit tests (511/0) and coverage:** reproduced.
- **Codegen regeneration byte-identical for all 6 sets:** reproduced.
- **The 3 cases:** MATCH against the cached oracle. Reproduced, and now true for all three, not only `offset_ub`.
- **mir `--sample 300` (f34):** 300/300 MATCH here. The 7 DIFFs the handoff reported came from the oracle-toolchain
  modification, which root has reverted. They are not caused by this lane.
- **Decision to record if accepted:** the per-field typemap mechanism (`fields` in a set-local typemap) is a
  `tools/codegen` design choice. This review approves it; root should record it as a decision when integrating.

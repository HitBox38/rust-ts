# Handoff: interp-memory (M4 wave 23c, CTFE fill lane): rustc_const_eval interpret/memory.rs

Branch `lane/interp-memory` (from `43e37d73`, no merges). Commits: the port (`973a8ea7`), the unit tests (`cdf1647a`),
the `unwrap_result` lint fix (`c2105df4`), then this handoff.

## Result
- **interpret/memory.rs 73/73** (was 2/73): all 71 stubs ported in upstream order, the trivial-path (T) functions included:
  `allocate_ptr`, `get_ptr_alloc(_mut)`, `get_alloc_raw(_mut)`, `global_root_pointer`, `AllocRef(Mut)::read/write_scalar`,
  `mem_copy(_repeatedly)`, `get_alloc_info`, `ptr_(try_)get_alloc_id`. The two nested fns (`is_offset_misaligned`,
  `write_allocation_track_relocs`) moved inside their parents.
- Contract stub declarations were kept, with one fix: `AllocInfo::new` is now assigned to `AllocInfo.new`. The stub
  assigned `.new_`, so a call to `AllocInfo.new` would have failed at runtime.
- `src/rustc_const_eval/interpret/contract.test.ts`: markers 176 → 247 and stubs 481 → 410; the `interp-memory` row of
  the per-lane table is removed (0 stubs left). Other CTFE lanes edit the same lines, so expect conflicts there. The
  runtime stop of `const C: u8 = 7;` stays at `const_eval::eval_queries::eval_in_interpreter` (ctfe-a), which comes
  before memory on the path.
- New `src/rustc_const_eval/interpret/memory.test.ts` runs a `DummyMachine` subclass on hand-built `Memory` states. The
  subclass gives the two ctfe-a stubs the tests reach their upstream-like values: `enforce_alignment` (switchable) and
  `before_access_global` (the provided no-op). Cases:
  - allocation and the alloc-info table;
  - scalar reads and writes with provenance;
  - uninit reads and ReadPointerAsInt;
  - `mem_copy` / `mem_copy_repeatedly` (init mask, provenance, memmove vs `copy_nonoverlapping` UB, memset path, repeated pointers);
  - out-of-bounds, signed access, dangling-int, null and alignment errors (with display texts);
  - `scalar_may_be_null`;
  - realloc and dealloc (use-after-free, wrong kind, wrong layout, immutable);
  - global memory: root pointer, borrowed read without copying, `GLOBAL_KIND = None` panic on write, static-memory dealloc;
  - fn pointers;
  - `visit_reachable_allocs` and `take_leaked_allocations`, including `FxIndexMap::swap_remove` order;
  - ghost mode;
  - `DumpAllocs` / `print_alloc_bytes_for_diagnostics` output.

## PORT decisions (all in interpret/memory.ts)
- `throw_ub!` / `throw_ub_format!` / `throw_unsup!` / `throw_unsup_format!` / `err_ub!` become
  `return Err(InterpErrorInfo_from_InterpErrorKind(err_ub(..)))` and similar. The macro text stays as a comment, and the
  local helpers `err_ub`, `err_ub_format`, `err_unsup_format` are the macros' expansions.
- `Cow<Allocation>`, as `get_global_alloc` and `M::adjust_global_allocation` return it, is the plain `Allocation`. The
  CTFE machines' `adjust_global_allocation` always borrows (machine.rs:810), so:
  - `get_alloc_raw` always takes the `Cow::Borrowed` arm, and the global allocation is never copied on read;
  - `into_owned()` in `get_alloc_raw_mut` is `clone_Allocation`.

  Miri (M6) would need the `Owned` arm.
- The `u64` / `i64` fields of `UndefinedBehaviorInfo` (`DanglingIntPointer.addr` / `inbounds_size`,
  `PointerOutOfBounds.ptr_offset` / `inbounds_size`) are `number`s in error.gen.ts. This file computes them as `bigint`s
  and converts with `i64_number`; a value beyond 2^53 calls `unported(..)` instead of rounding.
- `insert_allocation`'s `alloc.size() <= self.max_size_of_val()` compares bytes as `bigint`s against
  `target_isize_max()`. `max_size_of_val()` builds a `Size` of 2^63-1 on 64-bit targets, so it always hits
  `unported(SIZE_BEYOND_2_53)`.
- `check_and_deref_ptr` is an associated fn (`Self::f(this, ..)`), called on the receiver; `this.borrow()` is the receiver.
- `*was_made_global = true` (`make_const_heap_ptr_global`) replaces the entry's kind with a new value, because kinds are
  immutable values.
- Derived `PartialEq` of `MemoryKind<CtfeMemoryKind>` is a local `MemoryKind_eq`. `{kind}` uses `display_MemoryKind`
  with const_eval's `display_MemoryKind` (a ctfe-b stub) for `Machine` kinds.
- `write_bytes_ptr`: a JS iterator has no `size_hint`, so it is collected first. The precise-length asserts then hold
  trivially and are comments.
- Raw byte pointers are `subarray` views. `ptr::copy` / `ptr::copy_nonoverlapping` are `TypedArray.set`, which behaves
  like memmove when both views share a buffer. `write_bytes` is `fill`.
- `num_copies` is passed to `init_mask_apply_copy` / `provenance_apply_copy` as a `number`. Only non-zero sizes reach
  that point, so `size * num_copies` is a valid `Size`.
- `VecDeque` is an array; in `DumpAllocs`, `push_back` is `push` and `pop_front` is `shift`.
- Lazy `require`s, to keep init order: const_eval/machine.ts (`FxIndexMap_AllocMap`, `display_MemoryKind`,
  `MayLeak_MemoryKind`, `swap_remove`), const_eval/error.ts, rustc_middle mir/pretty.ts and ty/print/pretty.ts. The
  contract test's fresh-entry check passes.

## `unported(...)` left
- In this file: only `i64_number` beyond 2^53 (see above).
- Stubs of other lanes that memory calls:
  - ctfe-b: `CompileTimeMachine`'s `enforce_alignment`, `before_access_global`, `before_alloc_access`,
    `before_memory_write`, and const_eval `display_MemoryKind`.
  - ctfe-a: `DummyMachine`'s `enforce_alignment` and `before_access_global`; `ConstEvalErrKind_into_InterpErrorInfo`.
  - interp-ops: `check_vtable_for_type`.

## Samples (`RUST_TS_AGENT=root-f5de`, per case vs base)
| suite | this lane | M / D / U | base run | per-case moves |
|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-193548-root-f5de-qzsk` | 45 / 0 / 1 | `193507-…-2igb` (45/0/1) | none |
| tydump-minicore (46) | `20261022-193613-root-f5de-8qle` | 45 / 0 / 1 | `185109-…-qaih` (45/0/1) | none |
| mirdump-ui `--sample 300` | `20261022-193647-root-f5de-5sqy` | 266 / 0 / 34 | `185127-…-f9jh` (222/0/78) | 44 UNPORTED → MATCH |
| tydump-ui `--sample 300` | `20261022-194044-root-f5de-vh1e` | 258 / 0 / 40 (+2 UNSTABLE) | `185304-…-j6hf` | none |

**0 DIFF, 0 CRASH, no case lost.**
- The 44 mirdump-ui moves are the `validate::Validator` stops of the base run. They come from mt-validate, which was
  already merged into this lane's base `43e37d73`, not from this lane.
- **CTFE stops did not move:** `eval_queries::eval_in_interpreter` is 16 in mirdump-ui and 12 in tydump-ui, as before.
  That ctfe-a stub runs before any memory fn on the path. The other stops: `mir_borrowck` 16 / 25, `try_to_bits_for_ty`
  2 / 1, and in tydump-ui 2 cases at `hash_result` (StableHash of `type_of`). Memory is reached once ctfe-a
  (`eval_in_interpreter`, `setup_for_eval`) and interp-place-operand (`allocate`, `copy_op`) land.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (20449; vendor 4330).
- `bun scripts/coverage.ts --missing compiler/rustc_const_eval/src/interpret/memory.rs`: 73/73 ported.
- contract.test.ts: 4 pass. memory.test.ts: 1 pass (93 expects).
- Full `RUST_TS_AGENT=interp-memory RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (detached, at `cdf1647a`, on a
  host at load average 80-160 with the other lanes, 6122 s): **6101 pass, 1 skip (the existing one), 1 fail**. The
  failure was `std/result.test.ts` "non-test code never reaches the one-argument unwrap_result": two
  `unwrap_result(r)` calls in memory.ts. `c2105df4` fixes both by passing `debug_AlignFromBytesError` / the
  `fmt::Error` Debug. After the fix, `std/result.test.ts` + contract.test.ts + memory.test.ts: 6 pass, 0 fail. The
  full suite was not re-run (it took about 100 min on this host); the fix touches only those two expressions.
  Log: `$RUST_TS_DATA/scratch/interp-memory/logs/fulltest.log`.

## For root
- **eval_context.ts:539 / :564** (`size_and_align_from_meta`, interp-contract's hub) call
  `PointerArithmetic_provided.max_size_of_val(this).bytes()`. On every 64-bit target that is
  `unported(SIZE_BEYOND_2_53)`, because `Size::from_bytes(2^63-1)` is not representable. Use the `bigint` comparison
  against `target_isize_max()` that memory.ts uses.
- error.gen.ts types the `u64` / `i64` UB fields as `number`. Consider `bigint` if ui tests print dangling addresses near
  2^64 (e.g. `usize::MAX as *const _`); today those stop at `unported`.
- No harness/ or scripts/ edits. No shared files edited apart from contract.test.ts's count lines.

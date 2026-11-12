# Review: lane `ssa-block` (M7 wave 41, wave 40n)

**Verdict: PASS WITH NOTES**

Reviewed branch `t3/port-ssa-block-codegen`, commit `8044d4ef`, against `main` at `51dfe33c` (`git diff 51dfe33c..8044d4ef`),
merged into review branch `t3/review-ssa-block`. Upstream at the pin: `compiler/rustc_codegen_ssa/src/mir/block.rs` (2,605
lines). There are no must-fix findings. The three nits below concern the test fixture's provenance, one missing integration
step, and test hygiene. None of them touches the ported logic.

## Evidence (run on the review branch, AC power, no gate running)
- `bun scripts/coverage.ts --missing compiler/rustc_codegen_ssa/src/mir/block.rs`: **35/35 ported**. I checked all 35 marker
  lines against the `fn` lines at the pin. All are correct and in upstream order, including `get_caller_location` (:2187).
- `bun scripts/coverage.ts --check --offline`: `markers ok (26394, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 390)`.
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/rustc_codegen_ssa/ ./src/std/result.test.ts` (`RUST_TS_REQUIRE_PROBES=1`): **105 pass, 0 fail, 751 expects**
  (16 files).
- `bun test ./scripts/lib/unit-steps.test.ts`: **10 pass, 0 fail**. Neither block.ts nor block.test.ts reads `process.env` or
  `Bun.env`.
- Scope: the diff touches only the seven lane files (block.ts, block.test.ts, block_oracle/{README.md, block.rs, host.ll,
  msvc.ll}, docs/handoff/ssa-block.md).
- I ran no samples, as the brief asked.

## 1. Order and coverage
Complete and in upstream order. `TerminatorCodegenHelper` is a module-private class with its six methods in order.
The `impl FunctionCx` block is `install_FunctionCx_block`, with 29 prototype assignments in order (the place.ts/operand.ts
installer convention). It carries a `// PORT:` at its definition. `ReturnDest`, `load_cast` and `store_cast` follow it at
module level.

## 2. Logic fidelity
I read every function against upstream. Points checked in detail:
- **`TerminatorCodegenHelper`:**
  - `funclet` (block.ts:127 / block.rs:62): early `None` on no `cleanup_kinds` or no `funclet_bb`, the lazy
    `landing_pad_for`, and `expect` with upstream's text.
  - `llbb_characteristics` (:170 / :112): the four-way `(funclet_bb, target_funclet)` match, in arm order, with the
    `span_bug!` text. The non-funclet branch is `!is_cleanup(bb) && is_cleanup(target)`.
  - `llbb_with_cleanup` (:149 / :88) has the trampoline under MSVC: the `assert!` text, the name
    `{bb:?}_cleanup_trampoline_{target:?}`, `append_block`, then `build`, then `cleanup_ret(funclet().unwrap(),
    Some(lltarget))`. The evaluation order matches.
  - `funclet_br` (:199 / :137): merge only if `mergeable_succ && !needs_landing_pad && !is_cleanupret`. Otherwise
    `cleanup_ret` for a cross-funclet edge, and `br_with_attrs` for any other.
  - `do_call` (:232 / :170):
    - the compiler_builtins check (`emit_err` with a destination, the live `info!` plus `abort_immediate`/`unreachable`
      without one);
    - `caller_attrs` only when `has_codegen_attrs`;
    - `!can_unwind` → `Unreachable`;
    - the unwind match in arm order, including `Terminate` in cleanup (wasm nests via `terminate_block(reason,
      Some(bb))`, MSVC gets `None`);
    - `Tail` → `tail_call` before any invoke/call;
    - invoke: `ret_llbb` is `llbb_with_cleanup(target)` or `unreachable_block`. After the call it does
      `apply_attrs_to_cleanup_callsite` in cleanup, `switch_to_block(llbb(target))`, `set_debug_loc`, the
      `lifetime_end`s, then `store_return`, and re-caches `cached_llbbs[target]`;
    - call: `lifetime_end`s, `store_return`, then `funclet_br`. Without a destination, `unreachable`.
  - `do_inlineasm` (:379 / :336): the `Label` case asserts there is no unwind, then `Some(ret_llbb)` with no cleanup. The
    cleanup case passes `(cleanup, funclet)`. Otherwise it calls `funclet_br` or `unreachable`.
- **`codegen_switchint_terminator`** (:574 / :428):
  - A constant discriminant gives a direct `br`.
  - For one target, `lltarget` comes before `llotherwise`, and `expect` is `None` on equal coldness, else
    `Some(otherwise_cold)`. On bool, test value 0 swaps the arms with `expect.map(!)`, test value 1 does not, and any
    other value is `bug!()`. Otherwise `const_uint_big` + `icmp IntEQ` + `cond_br_with_expect`.
  - The two-target `trunc nuw` arm requires an empty-unreachable otherwise and values {0,1}. Its expectation is `None` at
    `-O0`, and otherwise follows the coldness table. The condition is `unchecked_utrunc` unless the discriminant is bool.
  - The `-O0` two-target `icmp`/`cond_br` arm.
  - In the `switch` / `switch_with_weights` choice, `cold_count` uses a fresh `targets.iter()`, and the
    `none_cold`/`all_cold` condition is copied exactly. Collecting the lazy `map` after `else_llbb` creates blocks in
    upstream's order (PORT 4). The oracle confirms this on `sw_int`, and my mutation check below confirms it too.
- **`codegen_return_terminator`** (:719 / :566):
  - c-variadic `lifetime_end` on the `VaList` place, then uninhabited → `abort_immediate` + `unreachable`.
  - `Ignore`/`Indirect` → `ret_void`.
  - `Direct`/`Pair`: a `Ref` gives `load_from_place(backend_type)`, otherwise `immediate_or_packed_pair`.
  - `Cast`: the local's `Place` becomes a new `OperandRef(Ref(place.val), layout, None)`. `Immediate`/`Pair` spill to a
    `PlaceRef::alloca` of the return layout. `Ref` runs the `assert_eq!` with its message (core's text). Then the CMSE
    entry padding clear, then `load_cast` at `ret.layout.align.abi`.
  - The `bug!` texts match.
- **`codegen_drop_terminator`** (:829 / :653):
  - `DropGlue(_, None)` → `funclet_br`.
  - For `Dynamic`: a `Virtual(drop_fn.def_id(), 0)` instance, `fn_abi_of_instance(virtual_drop, [])`, `vtable = args[1]`,
    `args` truncated to one, then `get_optional_fn(COMMON_VTABLE_ENTRIES_DROPINPLACE)` through `block_xlane`.
  - For everything else, `get_fn_addr` comes before `fn_abi_of_instance`, as upstream's tuple order has it.
  - On the null check: an `is_not_null` sibling block, `icmp(bin_op_to_icmp_predicate(Ne, false))`, then
    `cond_br(non_null, is_not_null, llbb_with_cleanup(target))` and `set_debug_loc`.
  - `do_call` gets `!maybe_null && mergeable_succ`.
  - `async_fut`: `codegen_terminator` asserts `drop.is_none()` with upstream's message (:1798 / :1706).
- **`codegen_assert_terminator`** (:927 / :753):
  - `const_cond` is `c == 1`. It is overridden to `Some(expected)` when the session has no overflow checks and the message
    is an optional overflow check. A known success goes to `funclet_br`.
  - `lltarget` comes before the `panic` sibling block, and the `cond_br` arms follow `expected`.
  - `get_caller_location(...).immediate()` comes before the message operands.
  - The `BoundsCheck` argument order is `[index, len, location]`. `MisalignedPointerDereference`, the null cases and
    `InvalidEnumConstruction` follow.
  - The fallback is `panic_function()`.
  - `build_langcall` then `do_call(None, unwind, false)`, and `assert_eq!(MergingSucc::False)`.
- **`codegen_terminate_terminator`** (:1028 / :860) and **`codegen_panic_intrinsic`** (:1048 / :892):
  - `from_intrinsic` gives `None` → `None`.
  - `check_validity_requirement(...).expect(..)` formats `msg: {err:?}`.
  - The three message texts are under `with_no_visible_paths!(with_no_trimmed_paths!(..))`.
  - `const_str`, then `PanicNounwind`, then `do_call` with `target.map(|bb| (Nothing, bb))`.
- **`codegen_call_terminator`** (:1116 / :960):
  - `source_info` is `{ span: fn_span, scope }`.
  - `FnDef` resolves with `expect_resolve`.
  - Empty drop glue → `funclet_br`.
  - Intrinsics:
    - `codegen_panic_intrinsic` first;
    - `result_place`/`store_in_local` per `LocalRef`, including the ZST `Operand` case (`new_sized(const_undef(type_ptr))`);
    - the unaligned-place `span_bug!`;
    - arguments are codegenned after the destination.
    - The `Operand` result is stored or becomes the local, plus `debug_introduce_local`. `Err` poisons the pending local
      and calls `abort_immediate`. `Fallback` `span_bug!`s on `must_be_overridden`, else becomes the instance.
  - The tail-call `#[track_caller]` lint, then `resolve_for_fn_ptr` and `get_fn_addr`, in guard order after the two
    specific arms.
  - `FnPtr` → `callee.immediate()`.
  - The `LlvmIntrinsic` path excludes `llvm.wasm.throw`, then runs the two asserts. Its return destination is `Nothing`
    for a ZST, else per `LocalRef`, else a `Store` to the place. Then the arguments, `set_debug_loc` and
    `codegen_llvm_intrinsic_call(.., is_cleanup)`, and `store_return` with a fresh `Direct(ArgAttributes::new())`
    `ArgAbi`.
  - `extra_args = args[sig.inputs().len()..]`, with the slice panic text, then `fn_abi_of_instance` or
    `fn_abi_of_fn_ptr`.
  - `make_return_dest` is still called with no target (`Normal`). A tail call with an indirect return requires `Nothing`.
  - **rust-call untupling** uses `split_last` only when `sig.abi() == RustCall` and there are arguments.
    `codegen_arguments_untupled` (:2225 / :2138): from `Ref`, it does `project_field` + `load_operand` per field, with
    `bug!` on `llextra`. From an immediate, it calls `extract_field`. Either way it returns `fields.count()`.
  - **Tail-call temporaries**: `IndirectUnsized` → `bug!`, and only `Indirect { mode: Pointer }` is copied
    (`alloca`, `lifetime_start`, `store_with_annotation`).
  - **Virtual calls** apply only to argument 0 with `InstanceKind::Virtual`:
    - `Pair` peels newtypes through `non_1zst_field().expect(..)` + `extract_field`, then calls
      `get_fn(idx, meta, op.layout.ty)` and pushes the pre-peel `data_ptr`, as upstream binds it before the loop;
    - a `Ref` with `llextra` is by-value dispatch;
    - anything else is `span_bug!` with `{:#?}`.
  - **`by_move`**: the tail-call `Indirect{Pointer}` case takes the temporary, copies it into the caller's argument slot,
    then rebuilds `op` with the new `val` (block.ts:1519 / :1389 and :1530 / :1399). It builds a new
    `OperandRef(val, op.layout, op.move_annotation)`, which is exactly upstream's single-field write on a local copy, so
    nothing else observes it. Otherwise `by_move` is `matches!(Move)`.
  - **`#[track_caller]`**: `mir_args` is `first_args.len() + num_untupled`, else `args.len()`. The `assert_eq!` message
    uses `debug_option(Instance)`, `debug_Span` and `debug_FnAbi` with `Ty` as `Display`, which is rustc_abi's
    `TyAndLayout` Debug. Then `get_caller_location`, and `codegen_argument(.., false, .., last_arg)`.
  - `fn_ptr` follows the `(instance, llfn)` match in order, then `set_debug_loc` and `do_call`.
- **`codegen_argument`** (:2027 / :1964):
  - In the first match, `Cast` pads with `pad_i32_count` undefs and falls through. `Pair` and `IndirectUnsized` push and
    return, or `bug!` with `{:?}`.
  - From `Immediate`/`Pair`:
    - `Indirect` makes a `PlaceValue::alloca` at `max(pointee_align, abi align)`, with `lifetime_start`,
      `store_with_annotation` and a `lifetime_ends_after_call` entry;
    - `Cast` makes a `PlaceRef::alloca` with no lifetimes;
    - `Direct` is `immediate()`.
  - From `Ref`:
    - `AmdgpuKernelArg` → `bug!`;
    - the copy happens when `align < required_align || (Pointer && !by_move)`. That is the "copy of a non-moved
      operand" the brief names; a moved one passes its own place;
    - `IndirectUnsized` → `unreachable!`;
    - anything else passes the place.
  - From `ZeroSized`: `AmdgpuKernelArg` and `OnStack` (`Indirect { on_stack }`) → `bug!`, else an alloca pointer.
  - By-ref and not indirect:
    - `Cast` spills into `alloca(cast.size, cast.align)`, with `lifetime_start` and a `memcpy` of
      `min(unaligned_size, layout.size)`, then clears CMSE call padding, then `load_cast` and `lifetime_end`;
    - otherwise `load(backend_type)`, plus `range_metadata(0..=1)` for a bool, then `to_immediate_scalar`.
  - The `unreachable!` texts carry core's `internal error: entered unreachable code: ` prefix. The widened `mode as
    PassMode` keeps the dead arms (PORT 6).
- **CMSE** (`clear_padding_cmse` :1869, `clear_variant_dependent_padding` :1879, `zero_byte_ranges` :2001):
  - array/arbitrary recursion, and the `Multiple` work list that skips uninhabited variants;
  - the block order is `cmse_pad_join`, then one `cmse_pad_variant` per variant. The dispatch goes back to the root
    block, builds `codegen_get_discr` on a new `OperandRef`, and switches into the join block;
  - `zero_byte_ranges` keeps upstream's quirk of comparing `range.start` (not `start`) with the clamped end.
- **Landing and terminate pads:**
  - `get_personality_slot` allocates `(*mut u8, i32)` once.
  - `landing_pad_for_uncached` (:2297 / :2226) calls `llbb(bb)` first.
    - MSVC: `funclet_{bb:?}`, `cleanup_pad(None, [])`, `br`, and the `funclets` entry.
    - Other targets: `cleanup` with `cleanup_landing_pad(eh_personality)`, then the slot's `storage_live` and the `Pair`
      store, then `br`.
  - `terminate_block` (:2334 / :2261):
    - The cache key is `START_BLOCK`, unless there is an outer catchpad (the wasm nesting). Then the key is the outer
      funclet's `funclet_bb`, and that funclet is created first.
    - A cache hit needs the same `reason`.
    - Under new EH: `cs_terminate`, then `cp_terminate`, then `catch_switch(outer_cleanuppad, None, [cp])`. The catchpad
      arguments are `[null, i32 0x40, null]` under MSVC SEH, else `[null]`.
    - Otherwise `terminate` with `filter_landing_pad`.
    - Then `set_debug_loc(outermost)` and `build_langcall(reason.lang_item())`. A compiler_builtins call becomes
      `abort_immediate`, anything else a `call` with the funclet and `apply_attrs_to_cleanup_callsite`. Then
      `unreachable`, and the cache entry.
  - The `double_unwind_guard` the brief names lives in the cg_llvm backend, not in block.rs. On the ssa side the guard is
    `Terminate(InCleanup)` → `terminate_block` (`panic_in_cleanup`) in `do_call`, as checked above.
- **`make_return_dest`** (:2512 / :2451):
  - `is_ignore` → `(Nothing, Direct)`.
  - A `PendingOperand` with an indirect return gives an `alloca` + `storage_live` and `(IndirectOperand,
    Indirect(llval))`; without one, `DirectOperand`.
  - The indirect (`sret`) case `span_bug!`s on an unaligned destination, then gives `(Nothing, Indirect(dest.llval))`.
    Otherwise `Store`.
- **`store_return`** (:2563 / :2505):
  - `retags_enabled` is `codegen_emit_retag.is_some()`, and the retag calls go through mod.ts's `xlane`.
  - `IndirectOperand` does `load_operand`, `storage_dead`, the retag, `overwrite_local` and `debug_introduce_local`.
  - `DirectOperand` with `Cast` does `alloca` + `storage_live` + `store_arg` + `load_operand` + `storage_dead`. Without
    one, it calls `from_immediate_or_packed_pair`.
- **`load_cast`/`store_cast`** (:2629, :2649 / :2564, :2587): both `assert_eq!`s run before use. The `rest_offset` split is
  a load/store of `prefix[0]` at `align`, then of `rest.unit` at `ptradd(offset)` with `align.restrict_for_offset`.
  `load_cast` builds the pair with `const_poison` + two `insert_value`s. `store_cast` is exported. Its signature `(bx,
  cast, value, ptr, align)` matches cg-abi-consts' local stub (see §5).
- **`codegen_block`/`codegen_terminator`** (:1684, :1743 / :1594, :1645):
  - `try_llbb` gives `None` → return. The merge loop runs statements, `after_last_stmt_debuginfos`, then the terminator;
    on a merge it asserts `CachedLlbb::None` and sets `Skip`.
  - `mergeable_succ` needs exactly one successor whose only predecessor is this block, and `assert_eq!(succ_pred, bb)`.
  - The terminator match keeps upstream's arm order. `TailCall` passes `Place::from(RETURN_PLACE)`, `None` and
    `Unreachable`.
  - `codegen_asm_terminator` (:1588 / :1491):
    - `Const` requires `ConstValue::Scalar`, with the `{:#?}` `span_bug!`;
    - `SymFn` uses `resolve_for_fn_ptr` + `reserve_and_set_fn_alloc(CTFE_ALLOC_SALT)` with a `new_fn_ptr` type;
    - `SymStatic` covers both the thread-local and the `static_ptr_ty` case;
    - `Label` uses `llbb(targets[i])`;
    - the destination is `None` when `asm_macro.diverges(options)`.

## 3. No guessed values
- `block_xlane` has exactly 10 entries, and each stops with `unported("<lane>: <path> <fn>")`. These are the only
  `unported` calls in block.ts. I checked every upstream fn and line cited against the pin:
  - debuginfo.rs:221 `set_debug_loc`, :310 `debug_introduce_local` and :722 `codegen_stmt_debuginfos`;
  - statement.rs:12 `codegen_statement`;
  - constant.rs:25 `eval_mir_constant`;
  - meth.rs:14 `from_index`, :36 `get_optional_fn` and :46 `get_fn`;
  - intrinsic.rs:57 `codegen_intrinsic_call`;
  - base.rs:385 `wants_msvc_seh` and :932 `is_call_from_compiler_builtins_to_upstream_monomorphization`.

  The owners match docs/next.md's wave 40n table: ssa-mir-rest owns statement.rs, constant.rs and meth.rs; ssa-base
  owns base.rs and names `wants_msvc_seh`; ssa-rvalue-intrinsic owns intrinsic.rs. ssa-debuginfo is the lane next.md
  holds for the next round.
- `wants_new_eh_instructions` and the two retag fns reuse mod.ts's `xlane` entries rather than duplicating them.
  `wants_wasm_eh` and `bin_op_to_icmp_predicate` are already ported in base.ts and are imported directly.
- `unreachable_block_()`: the interface declaration carries `// PORT: the field unreachable_block holds the name`, and the
  marker sits on the definition (block.ts:2322). That is the same shape as rustc_middle's `terminator_()`
  (mir/mod.ts:317). Consistent.
- The `:1389`/`:1399` copies build new objects without changing behaviour (§2, `by_move`).

## 4. Tests
- **The oracle files are the pinned rustc's output.** In the scratchpad I regenerated both with `rustc +nightly-2026-10-11`
  (`1.101.0-nightly (6f5da406b 2026-10-10)`) and the README's flags. After normalizing the source path and the
  `@alloc_<hash>` names derived from it, both are identical to the committed files, line for line. The raw files differ
  only in the embedded file path (N1).
- **Block order and terminators.** I spot-checked `drop_two`: on the host the order is `start, bb3, cleanup, bb1,
  terminate, bb4`, and on MSVC `start, bb3, funclet_bb3, bb1`, with the terminators the handoff names. The test compares
  every fn's [label, terminator] list with the oracle's, and it passes for all 12 fns on both targets.
- **Mutation checks** (each applied temporarily and reverted; the tree is clean):
  - `llotherwise` before `lltarget`: 2 fail;
  - inverting `!by_move` in the `Ref`/`Indirect` copy condition: 1 fail;
  - collecting the `switch` cases before `else_llbb`: 2 fail.
- **Stand-ins.** All are confined to the test. The `xlane`/`block_xlane` entries and the patched
  `FunctionCx.prototype.codegen_operand` are saved and restored in `finally`.
  - The base.rs stand-ins are upstream's bodies (`wants_wasm_eh || is_like_msvc`, and `is_like_msvc`), checked against
    base.rs:376-394.
  - The statement stand-in only defines pending SSA locals with placeholder value names. Their names appear only in the
    source-derived `EXPECT` sequences, never in the oracle comparison.
  - The constant stand-in handles only ZST constants (every callee). The caller-location constant goes through the real
    `OperandRef::from_const`.

  None of them changes block creation or terminators, so the oracle assertions do not depend on invented behaviour.
  The test leaves one write unrestored (N3).
- `unit-steps.test.ts` passes. The test reads no environment variable and runs no rustc.

## 5. Integration steps
I applied the handoff's steps in a trial and reverted them; nothing from the trial is committed. The steps were: install
in mod.ts after the two existing installers, repoint `xlane.codegen_block`/`codegen_block_as_unreachable` at
mod.ts:529/:539, and `export { store_cast } from "./block.ts"`. I also merged `t3/port-cg-abi-consts` with its local
`store_cast` stub (abi.ts:50-53 there) replaced by the import from block.ts. The results:
- `tsc` is clean, so the signatures match.
- block.ts loads before mod.ts, and `rustc_codegen_llvm/lib.ts` loads.
- `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/` gives **159 pass, 1 fail**. The failure is cg-abi-consts'
  `stub counts per lane` (skeleton.test.ts:143, `"ssa-block": 1`). That table must lose its ssa-block entry when the stub
  goes (N2).

Otherwise the steps are complete.

## Findings

### F (must fix before merge)
None.

### N (nits)
- **N1. The oracle `.ll` files were not made with the README's command, and they embed a local path.**
  `block_oracle/README.md:8-11` vs `host.ll:6-8` and `msvc.ll:6-8` (fixture location constants; upstream: n/a, test
  fixture). The committed files were compiled from an absolute path in the porter's worktree,
  `/Users/<user>/.t3/worktrees/rust-ts/t3-a29c7b43/src/rustc_codegen_ssa/mir/block_oracle/block.rs`. That path, a length
  of `0x64` and the alloc hashes derived from it are in the location constants. The README's relative `block.rs` command
  gives `c"block.rs"` and different hashes, so it does not reproduce the files byte for byte. Nothing else differs, and
  the test reads only labels and terminators, so the assertions are unaffected. Regenerate both files from inside
  `block_oracle/` with the README's commands, which also removes the local path, or say in the README how they were
  made.
- **N2. Integration with cg-abi-consts needs a step the handoff omits.**
  `docs/handoff/ssa-block.md:126` (step 3) does not cover it (upstream: block.rs:2587 `store_cast`, re-exported by
  mod.rs). When root replaces cg-abi-consts' local `store_cast` stub (`t3/port-cg-abi-consts`
  src/rustc_codegen_llvm/abi.ts:50-53) with block.ts's export, it must also remove `"ssa-block": 1` from
  `src/rustc_codegen_llvm/skeleton.test.ts:143` and from the matching table in docs/handoff/cg-contract.md. Otherwise
  `stub counts per lane` fails. I reproduced this in the trial above. The signatures match.
- **N3. block.test.ts leaves the installer applied to the shared `FunctionCx.prototype`.**
  `src/rustc_codegen_ssa/mir/block.test.ts:322` (upstream: n/a, test). `run()` calls `install_FunctionCx_block(FunctionCx)`
  and never removes the 29 methods, unlike the stand-ins the test saves and restores. This is harmless now: the
  restored `xlane.codegen_block` is still the `unported` stub, so nothing reaches those methods from other test files.
  After root's step 1 the call is a repeat of the same assignments. It can be dropped once mod.ts installs the block.
  Until then, a comment would say why it is not restored.

## For root to record
The lane's 12 `// PORT:` decisions (handoff list) are sound as written. Decisions 2 (readonly copies at :1389/:1399), 3
(`unreachable_block_`) and 4 (the `switch` case order) were checked above against upstream and, for 4, the oracle.

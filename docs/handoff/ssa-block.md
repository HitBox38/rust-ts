# Handoff: ssa-block (M7, plan-m7 wave 41, wave 40n): rustc_codegen_ssa `mir/block.rs`

Branch `t3/port-ssa-block-codegen` (from `51dfe33c`; no merges).

## Summary
- `compiler/rustc_codegen_ssa/src/mir/block.rs` is ported in full: **35/35 fns**, in upstream order, with markers, in the
  new `src/rustc_codegen_ssa/mir/block.ts` (2,753 lines). It covers:
  - `MergingSucc`, `CallKind`;
  - `TerminatorCodegenHelper`: `funclet`, `llbb_with_cleanup`, `llbb_characteristics`, `funclet_br`, `do_call`,
    `do_inlineasm`;
  - the `impl FunctionCx` block:
    - the terminator arms: `codegen_resume_terminator`, `codegen_switchint_terminator`, `codegen_return_terminator`,
      `codegen_drop_terminator`, `codegen_assert_terminator`, `codegen_terminate_terminator`, `codegen_panic_intrinsic`,
      `codegen_call_terminator` (including `TailCall`), `codegen_asm_terminator`;
    - `codegen_block`, `codegen_block_as_unreachable`, `codegen_terminator`;
    - CMSE: `clear_padding_cmse`, `clear_variant_dependent_padding`, `zero_byte_ranges`;
    - `codegen_argument`, `codegen_arguments_untupled`, `get_caller_location`, `get_personality_slot`;
    - `landing_pad_for`, `landing_pad_for_uncached`, `unreachable_block`, `terminate_block`, `llbb`, `try_llbb`;
    - `make_return_dest`, `store_return`;
  - `ReturnDest`, `load_cast`, `store_cast` (exported; mod.rs re-exports it).
- Nothing reaches this code from a protected suite yet. mod.ts does not install it (root's step below), and the LLVM
  backend is not registered.

## Files touched
- `src/rustc_codegen_ssa/mir/block.ts`: new, the port.
- `src/rustc_codegen_ssa/mir/block.test.ts`: new, 2 tests (below).
- `src/rustc_codegen_ssa/mir/block_oracle/`: new; `block.rs` (fixture), `host.ll` and `msvc.ll` (the pinned rustc's IR
  for it, unmodified), and `README.md` (the commands that made them).
- `docs/handoff/ssa-block.md`: this file.

No other file was edited. `.env.local` was copied for setup (gitignored).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_codegen_ssa/src/mir/block.rs`: **35/35 ported**.
- `bun scripts/coverage.ts --check`: `markers ok (26394, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 390)`.
- `--order`: no block.rs row (in order).

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/std/result.test.ts ./src/rustc_codegen_ssa/` (with `RUST_TS_REQUIRE_PROBES=1`): **105 pass, 0 fail**,
  16 files.
- **`block.test.ts`: 2 pass, 54 expects, about 1.6 s.** The tests read no environment variable and run no rustc.
  - **How it runs.** The port's real driver compiles the `no_core` fixture in-process to `after_analysis`. Then, for each
    of its 12 `#[no_mangle]` fns, the real `codegen_mir` (mod.ts) runs with this lane's `codegen_block` installed, over a
    logging mock backend. The mock records each builder call in the block it was made in, and the blocks in creation
    order.
  - **Stand-ins for lanes not landed** (none is under test; the test header lists them):
    - statement.rs: an `Assign` to a pending SSA local defines it as a fresh operand of its layout's shape;
    - constant.rs: a ZST constant operand (every callee) is `OperandRef::zero_sized`;
    - debuginfo.rs: no-ops, and `debug_introduce_local` is logged;
    - base.rs: `wants_new_eh_instructions` and `wants_msvc_seh` are upstream's bodies. The builtins check is `false`,
      since its `is_compiler_builtins(LOCAL_CRATE)` conjunct is false for this crate.
  - **Derivation 1, the oracle.** `block_oracle/host.ll` and `msvc.ll` are the pinned nightly's
    `-Copt-level=0 -Cno-prepopulate-passes -Coverflow-checks=on` IR for the fixture. LLVM keeps a function's blocks in
    creation order, because `append_block` and `append_sibling_block` both append. So for every fn the test checks that
    the mock's [block name, terminator shape] list equals the oracle's [label, terminator] list in print order. This
    holds for all 12 fns on the host and all 12 on x86_64-pc-windows-msvc. It checks every block `llbb`,
    `landing_pad_for`, `terminate_block` and `append_sibling_block("panic")` makes, their order, and each
    `br`/`cond_br`/`switch` (with case values and targets), `ret`/`ret void`, `invoke ... to X unwind Y`, `resume`,
    `cleanupret ... unwind to caller` and `unreachable`.
  - **Derivation 2, the source.** `EXPECT` spells out the full call sequence of the selected fns, step by step from
    block.rs, with the upstream line cited at each. Value names differ from the oracle's, because debuginfo names
    values and ssa-debuginfo is not ported. So these sequences are checked against the source, and only their shape
    against the oracle.
  - **What it covers:**
    - **SwitchInt on bool:** one target, test value 0, so `cond_br(discr, otherwise, target)`.
    - **SwitchInt on int:** one target, so `icmp eq` against `const_uint_big` plus `cond_br`. Three targets, so `switch`
      with `otherwise` made first and the cases in order.
    - **Return per PassMode:**
      - Direct: `ret` of the immediate;
      - Pair: `const_poison` plus two `insert_value`s;
      - Indirect: `ret_void`;
      - Cast: `_0` is an 8-byte `alloca_size`, and `load_cast` is one `load` of the cast type at align 2. The oracle has
        `load i48, ptr %_0, align 2`.
    - **Call with a direct and an indirect argument:**
      - `copy _2` of `Big`, `Indirect{Pointer}`, not by-move: a scratch `alloca(32, 8)`, `lifetime_start`, a typed copy,
        then `lifetime_end` after the call. The oracle has `%0 = alloca [32 x i8]` and a memcpy.
      - `move _3`: its own place, with no copy.
      - The return goes to a pending `_0` via `DirectOperand`, and the merged `bb1` returns it.
    - **Drop without unwind:** `call @drop_glue`, `bb1` merged, `ret_void`.
    - **Drop with unwind (host):**
      - an `invoke` to a `cleanup` landing pad, which stores the exception pair in the personality slot (16 bytes, the
        second half at offset 8, align 8, as the oracle has);
      - the cleanup block's drop invokes into `terminate`, which has `filter_landing_pad` and calls `panic_in_cleanup`;
      - `resume` reloads both fields and ends the slot's lifetime.
    - **Assert, overflow:** `cond_br(cond, panic, bb1)`, because `expected == false`. Then `call
      @panic_const_add_overflow(<caller location>)` and `unreachable`.
    - **Funclets (MSVC):**
      - `funclet_bb3` has `cleanuppad within none []` and a `br bb3`;
      - the cleanup drop is a `call` with the funclet bundle (MSVC drops `unwind terminate` in cleanup, block.rs:238);
      - the merged `resume` becomes `cleanupret ... unwind to caller`.
  - **Mutation check.** Each of these makes the test fail:
    - swapping the bool `cond_br` arms;
    - inverting the by-move copy condition;
    - making `llotherwise` before `lltarget`;
    - dropping the MSVC-in-cleanup `None` arm;
    - an extra instruction in the panic block;
    - dropping `storage_dead` in `resume`.
- **Integration dry run** (local, reverted; mod.ts is not in the commit). I added to mod.ts the import and
  `install_FunctionCx_block(FunctionCx)` after the class. Then:
  - `tsc` is clean;
  - `mir/` tests: 27 pass;
  - mod.ts and block.ts load in either order, and `rustc_codegen_llvm/lib.ts` loads.
- **Sample difftests** (`RUST_TS_AGENT=ssa-block`, `--sample 200 --jobs 6`, AC power):
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-140126-ssa-block-e9jj`;
  - `mir-o2`: **200/200 MATCH**, run `20261112-140413-ssa-block-jmrf`;
  - `mir`: **200/200 MATCH**, run `20261112-140625-ssa-block-yqlv`.

### Not covered by the tests
- InlineAsm (no `asm!` in a `no_core` fixture without the asm lang items; the asm backend is cg-asm's).
- TailCall.
- Virtual calls (needs meth.rs).
- Intrinsic calls (needs ssa-rvalue-intrinsic).
- `codegen_panic_intrinsic`, the CMSE padding clearing, untupled rust-call arguments and `#[track_caller]` callees.
- The `IndirectOperand` return, and the wasm `terminate_block` nesting.
- `codegen_block_as_unreachable`: no unreached block in the fixture.
- The `cleanup_trampoline` path.

## For root: integration steps
1. In `mir/mod.ts`, import `install_FunctionCx_block` from `./block.ts`. Add `install_FunctionCx_block(FunctionCx);` right
   after the two existing installers, below `class FunctionCx`.
2. Repoint the two ssa-block entries of mod.ts's `xlane`:
   - `codegen_block` → `(fx, bb) => fx.codegen_block(bb)` (or call `fx.codegen_block(bb)` at mod.ts:529);
   - `codegen_block_as_unreachable` → `fx.codegen_block_as_unreachable(bb)` (mod.ts:539).
3. mod.ts's comment `pub use self::block::store_cast;   (PORT: re-exported by ... once it exists)` can become
   `export { store_cast } from "./block.ts";`.
4. Repoint `block.ts`'s own `block_xlane` table (end of block.ts) as each owner lands. Each entry stops with
   `unported("<lane>: <upstream path> <fn>")`:

| entry | upstream | owner | repoint to |
|---|---|---|---|
| `set_debug_loc` | mir/debuginfo.rs:221 | ssa-debuginfo | `fx.set_debug_loc(bx, source_info)` |
| `debug_introduce_local` | mir/debuginfo.rs:310 | ssa-debuginfo | `fx.debug_introduce_local(bx, local)` |
| `codegen_stmt_debuginfos` | mir/debuginfo.rs:722 | ssa-debuginfo | `fx.codegen_stmt_debuginfos(bx, debuginfos)` |
| `codegen_statement` | mir/statement.rs:12 | ssa-mir-rest | `fx.codegen_statement(bx, statement)` |
| `eval_mir_constant` | mir/constant.rs:25 | ssa-mir-rest | `fx.eval_mir_constant(constant)` |
| `VirtualIndex_get_fn` | meth.rs:14 + :46 | ssa-mir-rest | `VirtualIndex.from_index(idx).get_fn(bx, llvtable, ty, fn_abi)` |
| `VirtualIndex_get_optional_fn` | meth.rs:14 + :36 | ssa-mir-rest | `...get_optional_fn(..)` |
| `codegen_intrinsic_call` | mir/intrinsic.rs:57 | ssa-rvalue-intrinsic | `fx.codegen_intrinsic_call(bx, instance, args, result_layout, result_place, source_info)` |
| `wants_msvc_seh` | base.rs:385 | ssa-base | `base.wants_msvc_seh` |
| `is_call_from_compiler_builtins_to_upstream_monomorphization` | base.rs:932 | ssa-base | `base.is_call_from_compiler_builtins_to_upstream_monomorphization` |

block.ts also calls three mod.ts `xlane` entries (`wants_new_eh_instructions` from ssa-base; `codegen_retag_place` and
`codegen_retag_operand` from retag.rs, ssa-mir-rest). They follow when root repoints those entries. `base::wants_wasm_eh`
is imported directly; it is already ported.

`block.test.ts` overrides `block_xlane` and `xlane` entries by assignment and restores them afterwards. Once entries are
repointed, its stand-ins still replace them during the test, so it keeps passing. When the real statement.rs and
debuginfo.rs land, root may drop the matching stand-ins.

## Every `unported(...)` left
Exactly the 10 `block_xlane` entries in the table above. There are no others in block.ts.

## `// PORT:` decisions (for root to record)
1. **Installer.** The `impl FunctionCx` block is `install_FunctionCx_block(FunctionCx)`, as in place.ts and operand.ts:
   mod.ts will import block.ts at run time, so a top-level prototype write would hit `FunctionCx`'s TDZ. block.ts imports
   mod.ts at run time only for `xlane` and `CachedLlbb`, and reads them only inside function bodies. The installer
   carries a `// PORT:` line at its definition (ssa-operand-place review N5).
2. **Readonly operand copies** (ssa-operand-place review N1). At block.rs:1389 (`op.val = Ref(arg.val)`) and :1399
   (`op.val = arg.val`) the port builds a new `OperandRef(val, op.layout, op.move_annotation)`. `let mut op` reassignments
   (`op = op.extract_field(..)`, `op = self.codegen_retag_operand(..)`) are plain local rebinds.
3. **`unreachable_block()` is `unreachable_block_()`.** The `FunctionCx` field `unreachable_block` holds the name, as in
   rustc_middle's `BasicBlockData::terminator()` → `terminator_()`.
4. **`switch`'s lazy `target_iter.map(..)`** is an array built after `else_llbb` (ssa-contract PORT 7). Upstream evaluates
   `helper.llbb_with_cleanup(self, targets.otherwise())` as an argument before the backend consumes the iterator inside
   `switch`, so the blocks are created in the same order (otherwise, then the cases). The oracle confirms this on
   `sw_int`.
5. **`ExactSizeIterator::len`** of `SwitchTargetsIter` is `size_hint()[0]`, its exact size.
6. **Unreachable arms kept.** In `codegen_argument`, the inner `match arg.mode` arms after the early returns stay. They are
   the `unreachable!("handled above")` / `IndirectUnsized` arms. `mode` is widened with `as PassMode` because TS has
   already narrowed it.
7. **`drop(cs_bx)` is a comment.** The backend's `Drop` is not part of `BuilderMethods` (ssa-mir-core PORT 5).
8. **Live logging.** `info!` in `do_call` (compiler_builtins replaced with abort) is a live `tracing.info`. `debug!`,
   `#[instrument(level = "trace")]` and `debug_assert*!` are comments.
9. **`assert_eq!` texts.** `assert_eq!` with and without a message uses core's text through two local helpers. The
   `#[track_caller]` argument-count `assert_eq!` is written out with its formatted message.
10. **Comparisons.** `Align` comparisons use `pow2`, its derived `Ord`. `cmp::min` on `u64` is a `bigint` min, and
    `cmp::min` on `Size` is `Ord_min_Size` (the first argument on a tie). `cmp::max` on `Align` is `Align_max`.
11. **Exports.** `MergingSucc` and `CallKind` are string unions (fieldless, `derive(PartialEq)`).
    `TerminatorCodegenHelper` is a module-private class. `ReturnDest` is exported because the `FunctionCx` interface
    merge names it.
12. **`expect` on an `Option`** is `unwrap(v, msg)`, which gives the same panic text. `.expect(msg)` on the
    `check_validity_requirement` `Result` formats `msg: {err:?}` with `debug_LayoutError`.

## Notes
- **Block order.** At `-O0` the oracle prints allocas in reverse order at the top of the entry block. That is cg_llvm's
  `alloca` positioning (cg-builder), not ssa: the mock logs each `alloca` in the block that asked for it. For example, the
  personality slot appears in `cleanup`, and in the oracle at the top of `start`.
- **Unwinding needs these on the backend** (cg-builder / cg-abi-consts), and the mock stands in for them:
  - `invoke` and `call` with funclet bundles;
  - `cleanup_landing_pad`, `filter_landing_pad`, `cleanup_pad`, `cleanup_ret`, `catch_switch`, `catch_pad`;
  - `apply_attrs_to_cleanup_callsite`;
  - `store_arg` and `load_operand`.
- **`Location` lang item.** `get_caller_location` reached the port's `span_as_caller_location` and `caller_location_ty` in
  the fixture (`#[lang = "panic_location"]`), and `OperandRef::from_const` made the pointer operand.

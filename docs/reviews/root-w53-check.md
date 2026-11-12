# Review: root's integration changes on `integ-w53` (wave 40m / M7 wave 41)

**Verdict: APPROVE WITH NITS**

Independent reviewer (AGENTS.md §1), read-only on code. Scope: root's own changes only. Those are commits `6f5e3e0b`,
`28cc7892` and `f84c9ac4`, plus the conflict resolutions in merges `18e26029` (cg-context) and `62a1a976`
(cg-types-attrs). The lanes' own code is covered by `docs/reviews/<lane>.md`. Reviewed at `f84c9ac4`, merged into this
branch. Upstream: `$RUST_TS_DATA/rust` at `6f5da406b56`.

## Commands (at f84c9ac4, `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`, AC power)

- `bunx tsc --noEmit -p .`: exit 0.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26359, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 390)`.
- `bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/rust_ts/llvm/ ./src/rustc_middle/ty/`: **504 pass,
  0 fail**, 66375 `expect()` calls, 51 files. No skips.
- `bun scripts/llvm-src.ts check`: `llvm-src ok: 68 files at aab11ee0ea5e (the checkout's gitlink)`.

## Q1: Are the swaps faithful?

Each swapped call now goes to the same upstream function, with the same receiver and the same arguments.

| TS call site | upstream | resolves to |
|---|---|---|
| builder.ts:1018 `OperandRef.zero_sized(place.layout)` | builder.rs:743 `OperandRef::zero_sized(place.layout)` | operand.ts:274 (operand.rs:169) |
| builder.ts:1845 `dest.project_index(body_bx, i)` | builder.rs:1678 `dest.project_index(&mut body_bx, i)` | place.ts:306 (place.rs:281) |
| builder.ts:1863-1864 `dest.project_index(this, zero/count)` | builder.rs:1696-1697 | same |
| builder.ts:1880 `PlaceRef.new_sized_aligned(current, cg_elem.layout, align)` | builder.rs:1715 | place.ts:149 (place.rs:100) |
| mod.ts:319 `OperandRef.zero_sized<V>(layout)` | mod.rs:193 | operand.rs:169 |
| mod.ts:482 `PlaceRef.new_sized(llretptr, layout)` | mod.rs:332 | place.ts:144 |
| mod.ts:488 `PlaceRef.alloca_size(start_bx, size, layout)` | mod.rs:337 | place.ts:168 |
| mod.ts:500 `PlaceRef.alloca_unsized_indirect(start_bx, layout)` | mod.rs:347 | place.ts:177 |
| mod.ts:650 `place.project_field(bx, i)` | mod.rs:501 | place.ts:212 |
| mod.ts:686 `OperandRef.zero_sized(arg.layout)` | mod.rs:537 | operand.rs:169 |
| mod.ts:731 `PlaceRef.new_sized(llarg, arg.layout)` | mod.rs:586 | place.ts:144 |
| mod.ts:744 `PlaceRef.alloca_unsized_indirect(bx, arg.layout)` | mod.rs:599 | place.ts:177 |
| analyze.ts:169 `this.fx.monomorphized_place_ty(PlaceRef_from_Local(..))` | analyze.rs:141 | place.ts:467 (place.rs:424) |

- **Installer placement** (mod.ts:260-263) is what both handoffs ask for: `install_FunctionCx_operand(FunctionCx);
  install_FunctionCx_place(FunctionCx);` right after `class FunctionCx`. See ssa-operand-place handoff merge step 3 and
  ssa-mir-core integration note 1.
- place.ts and operand.ts now import `FunctionCx` from mod.ts as a type only, and their `declare module "./mod.ts"`
  blocks match the methods the installers attach. Those are `maybe_codegen_consume_direct`, `codegen_consume`,
  `codegen_operand`, `move_copy_annotation_instance`, `codegen_place` and `monomorphized_place_ty`.
- `mir_core_shim.ts` is gone, and nothing in `src/` refers to it.
- No `unported("ssa-operand-place: ...")` stub is left anywhere in `src/`.
- **Load order.** I ran a fresh `bun -e` for each of mod.ts, place.ts, operand.ts, analyze.ts and locals.ts, importing
  that file first and mod.ts second. Every run shows the same 10 members on `FunctionCx.prototype`: `constructor
  monomorphize initialize_locals overwrite_local maybe_codegen_consume_direct codegen_consume codegen_operand
  move_copy_annotation_instance codegen_place monomorphized_place_ty`. No load order fails.

## Q2: Do the test edits weaken any check?

- **builder.test.ts ZST `load_operand` (6f5e3e0b):** stronger than before. It now checks `op.val === OperandValue.ZeroSized`
  and that the layout is passed through, where before it only checked that a stub stopped.
- **builder.test.ts `allocator::codegen` (62a1a976):** a real check.
  - It needs the shim's `declare` line in the printed module, and the exact `must_emit_unwind_tables` stop.
  - That stop comes from `llfn_attrs_from_instance` (allocator.rs:129).
  - A non-`Unported` throw is rethrown, and a run with no throw fails, because `stop` stays undefined.
- **skeleton.test.ts fill-lane sketch and forwarding test:** the comments are accurate. I replayed the sketch over the same
  marker objects. Every `expect.any(TypeError)` entry fails exactly where its comment says:
  - type_of: `this.layout.internee` (ty.ts:219);
  - get_intrinsic: `intrinsics.get is not a function` (context.ts:1224);
  - val_ty: `Val.type` (core.ts:436);
  - load: `B.createLoad is not a function` (build.ts:426);
  - call_intrinsic: `intrinsics.get` again;
  - build: `Block.insts` (build.ts:229);
  - `bx.data_layout()`: `this.tcx.data_layout is not a function` (context.ts:1309).

  Even so, the matchers accept *any* TypeError, and the `const_bytes` entry accepts anything at all. See findings 1 and 2.
- **analyze_oracle/mock.ts:** the call log is the same as before.
  - The four overrides push the same strings the removed `xlane` overrides pushed: `new_sized ${llval}`,
    `alloca_size ${bytes}`, `alloca_unsized_indirect` and `project_field ${i}`.
  - They return the same values, and all five are restored in `finally`.
  - analyze.test.ts asserts only the `alloca*`, `get_param`, `store_fn_arg`, `append_block`, `build`, `codegen_block*`
    and `set_personality_fn` entries. Their order and values are unchanged.
  - `OperandRef::zero_sized` and `monomorphized_place_ty` now run the real code. The removed mock of
    `monomorphized_place_ty` was upstream's body, so the result is the same.
- **operand_place.test.ts partial `FunctionCx`:** it hides no real dependency.
  - The only reads of `this.*` in place.ts and operand.ts are `cx`, `locals`, `mir` and `monomorphize`.
  - The three `monomorphize` call sites are place.ts:421 (OpaqueCast), place.ts:446 (Subslice) and operand.ts:1374
    (constant operand). The tests never reach them.
  - Under the shim those calls would have stopped at `unported`. Now they would fail on the unset `instance`. Either way,
    no test passes because a field was left unset.
  - The one loose check is noted in finding 6.

## Q3: The count table

I counted every `unported("<lane>:` in the non-test files of `src/rustc_codegen_llvm`, file by file. Every total in
`EXPECTED` matches, and so do the commented breakdowns:

| lane | count | where |
|---|---|---|
| cg-abi-consts | 20 | abi 11, consts 9 |
| cg-asm | 4 | |
| cg-di-a | 21 | debuginfo/metadata 3, debuginfo/mod 18 |
| cg-intrinsic-a | 10 | |
| cg-intrinsic-b | 2 | intrinsic 1, va_arg 1 |
| cg-lto-diag | 8 | |
| cg-write | 21 | archive 1, owned_target_machine 1, write 6, llvm_util 13 |
| excluded | 11 | builder/autodiff 2, builder/gpu_offload 5, coverageinfo/mod 2, typetree 1, context 1 |
| llir | 4 | llvm/mod 2, context 2 |
| rustc_codegen_llvm | 5 | llvm_backend 2, value 1, base 1, type_ 1 |
| rustc_middle | 1 | common |
| rustc_sanitizers | 5 | context 2, declare 3 |
| rustc_session | 9 | attributes 6, context 3; `needs_plt`, `must_emit_unwind_tables` and `branch_protection` appear in both files |
| ssa-base | 4 | llvm_backend 1, context 1, base 2 |
| ssa-mir-core | 2 | base |
| ssa-write | 5 | |

The base-plus-delta comments also check out against the lane tips:
- `rustc_codegen_llvm`: 3 at 620acf48, 5 at 2fcd3381.
- `llir`: 2 at the base.
- `ssa-base`: 1 at the base.

The one wrong comment is in finding 3.

## Q4: The manifest entries

`scripts/llvm-src.ts add` does three things:
1. It checks the paths and that the manifest commit equals the checkout's `src/llvm-project` gitlink.
2. It downloads every file from `raw.githubusercontent.com/<repo>/<commit>/<path>`.
3. It records the SHA-256 of each file and writes the manifest.

I hashed independent copies, fetched in memory from `rust-lang/llvm-project` at
`aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019`. That commit is the gitlink at the pin.

| path | SHA-256 | matches |
|---|---|---|
| `llvm/lib/Support/APFloat.cpp` | `199e7d48…e024f5b4` | manifest, llir-apfloat handoff :139, review :34 |
| `llvm/include/llvm/ADT/APFloat.h` | `14b0cf68…b7d660` | manifest, llir-apfloat handoff :140, review :35 |

The keys are still sorted, and `llvm-src.ts check` passes.

## Findings

1. **`expect.anything()` cannot fail for `const_bytes`** (src/rustc_codegen_llvm/skeleton.test.ts:250).
   - `step()` pushes a caught error object into `out`, and `expect.anything()` matches anything that is not
     null or undefined. So a `const_bytes` that throws still passes.
   - The real value today is a `ConstantDataSequential`.
   - Suggest pinning it: `expect.any(<ConstantDataSequential class>)`, or `expect(out[8]).not.toBeInstanceOf(Error)` next
     to the existing `out[7]` check.
2. **The `TypeError` matchers do not say which TypeError** (src/rustc_codegen_llvm/skeleton.test.ts:224, 251, 253-256).
   - Each comment names a specific failure, and each one is accurate today (see Q2).
   - But the matchers accept any TypeError, and `bx.data_layout()` accepts any throw. A regression that fails earlier, for
     a different reason, would still pass.
   - Suggest `expect.objectContaining({ message: expect.stringContaining("intrinsics.get") })` and similar, and
     `.toThrow(/data_layout/)` at :224.
3. **Wrong attribution in the count-table comment** (src/rustc_codegen_llvm/skeleton.test.ts:123).
   - The comment says "cg-builder's 10". But the 10 `excluded (plan-m7 D18)` stubs were already there at the wave base
     `620acf48` and in the cg-builder review tip `04bf3940`.
   - They are in builder/autodiff.ts, builder/gpu_offload.ts, coverageinfo/mod.ts and typetree.ts, and cg-builder did
     not add them.
   - The sum of 11 is right. Suggest "10 before this wave, plus cg-context's …", matching the "2, plus" and "3, plus"
     wording of the other lines.
4. **Stale comments and imports left by the `xlane` removal** (src/rustc_codegen_ssa/mir/analyze.ts:8-10, analyze.ts:37,
   mod.ts:17, mod.ts:37).
   - The analyze.ts header still says `monomorphized_place_ty` "goes through mod.ts's `xlane` stub table".
   - analyze.ts:37 still imports `xlane` as a value, but nothing uses it. This keeps a run-time import cycle between
     analyze.ts and mod.ts that is no longer needed. `import type { FunctionCx } from "./mod.ts"` is enough. The cycle is
     harmless: the load-order runs above pass.
   - The mod.ts:17 header still lists ssa-operand-place among the lanes that have not landed.
   - mod.ts:37's `type PlaceRef as mir_PlaceRef` import is now unused; it served only the removed stub.
   - tsc does not flag any of these, because `noUnused*` is off.
5. **The `cleanup_pad` check is circular** (src/rustc_codegen_llvm/builder.test.ts:672).
   - `funclet.bundle()` is defined as `this.operand.as_ref()` (common.ts:155-156), so the comparison checks only itself.
   - The test does not check that `funclet.cleanuppad()` is the pad LLVM built. The printed-IR check at :671 shows that a
     pad exists, not that the `Funclet` wraps it.
   - Suggest asserting that `funclet.cleanuppad()` is the block's last instruction, for example through `LLVMGetLastInstruction`.
6. **The partial `FunctionCx` makes a loose check looser** (src/rustc_codegen_ssa/mir/operand_place.test.ts:427).
   - `expect(() => fx.codegen_place(..PendingOperand..)).toThrow(); // bug!` accepts any throw.
   - Now that `fx_of` leaves most fields unset, a TypeError from an unset field would also pass.
   - The line is the lane's, but root's change made it matter. Suggest `.toThrow(/using still-pending operand local/)`.
7. **No test runs the new `write_operand_repeatedly_*` calls** (src/rustc_codegen_llvm/builder.ts:1845, 1863-1864, 1880).
   - No test reaches the swapped `project_index` and `new_sized_aligned` calls. They were also untested while they were
     stubs, so no coverage was lost.
   - They are now real code paths. A builder test that emits a small repeat loop and checks its IR (or the first stop
     past it) would cover them.

None of these blocks the integration. Findings 1 and 2 are the ones most worth fixing, because they are the checks most
likely to hide a future regression.

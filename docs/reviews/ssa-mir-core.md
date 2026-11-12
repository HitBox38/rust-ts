PASS WITH NOTES

# Review: ssa-mir-core (M7 wave 41): rustc_codegen_ssa `mir/{mod,analyze,locals}.rs`

Branch `t3/port-ssa-mir-core`: commits `3000ed80` (port and tests) and `6f3512fa` (handoff), on `main` at `620acf48`.
I compared `git diff 620acf48..6f3512fa` against the pinned upstream (`6f5da406`) `compiler/rustc_codegen_ssa/src/mir/
{mod,analyze,locals}.rs`, and checked the stub targets in `mir/{place,operand,retag,debuginfo,block}.rs` and `base.rs`, and the
cg_llvm `Drop for GenericBuilder`. I did not edit any code. The reviewer worktree is `t3/review-ssa-mir-core`, fast-forwarded to
`6f3512fa`.

## Evidence (re-run by the reviewer, AC power, no gate running)
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check --offline`: `markers ok (25942, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 354)`.
- `--missing` reports mod.rs 6/6, analyze.rs 11/11 and locals.rs 5/5, as the handoff says. I spot-checked all 22 marker lines
  against the pin, and each one is the line of its `fn`:
  - mod.rs: 133, 188, 203, 391, 451, 668;
  - analyze.rs: 18, 77, 97, 172, 189, 194, 270, 283, 295, 299, 335;
  - locals.rs: 22, 31, 35, 41, 62.
- `bun test ./src/rustc_codegen_ssa/ ./src/std/result.test.ts` (`RUST_TS_REQUIRE_PROBES=1`): **102 pass, 0 fail** (14 files).
  `analyze.test.ts` alone gives 23 pass and 199 expects, with no skips.
- `mod.ts`, `analyze.ts` and `locals.ts` each load alone as an entry.
- `src/rust_ts/info_sites_check.ts`: clean. locals.rs's only live site is a `warn!`, which the port keeps live
  (`tracing.warn`). The checker counts only INFO sites, so it says nothing about that one either way. Handoff note 4 is
  resolved.
- Scope: the diff touches only `src/rustc_codegen_ssa/mir/{mod,analyze,locals}.ts`, `mir/analyze.test.ts`,
  `mir/analyze_oracle/*` and `docs/handoff/ssa-mir-core.md`.

## 1. Fidelity

### `codegen_mir` (mod.rs:203)
Read line by line; it matches upstream.
- **Order of calls:**
  1. the `has_infer` assert, `get_fn`, `instance_mir`, `fn_abi_of_instance(.., List::empty())`, the nop-landing-pads hook;
  2. the `ergonomic_clones` branch: `instantiate_mir_and_normalize_erasing_regions` over `clone_Body`, then
     `optimize_use_clone`;
  3. `append_block(cx, llfn, "start")`, then `build`;
  4. the personality check: `any` over `mono_reachable`, stopping at the first block that is `is_cleanup && !nop` or has a
     `Terminate` unwind;
  5. `wants_new_eh_instructions(..).then(cleanup_kinds)`;
  6. `cached_llbbs` with `Some(start_llbb)` only at `START_BLOCK`.
- **The struct literal:** `find_cold_blocks` is its only effectful field, and it is evaluated in upstream's place. The
  constructor's field order matches the struct's (`Bx_` is a trailing extra).
- **After the struct:**
  1. `fill_function_debug_context`, then `compute_per_local_var_debug_info(..).unzip()`;
  2. the RPO, and the nop-pad reachability filter (a stack DFS that skips the `Cleanup(target)` edge only when `target` is a
     nop pad, then `retain`);
  3. `non_ssa_locals`, then `arg_local_refs`, which runs before `allocate_local(RETURN_PLACE)`, as in upstream's block;
  4. `vars_and_temps_iter`, then `initialize_locals`, then `debug_introduce_locals(.., unwrap_or_default)`;
  5. `codegen_block` in RPO, then `codegen_block_as_unreachable` over the filled-minus-visited set.
- **`allocate_local`:**
  - `Indirect` gives `get_param(0)` and `new_sized`.
  - `Cast` gives `alloca_size` of `cast.size(bx).max(layout.size)`. `Ord::max` returns the second argument when the two are
    equal (core `max_by`), and `Size_cmp` returns `1` for Greater, so `Ord_max_Size` is exact.
  - `IndirectUnsized` is a `bug!` with upstream's text.
  - Otherwise: memory gives `UnsizedPlace`/`Place`, and the rest get `new_operand`. The `has_erasable_regions` assert is kept.

### `arg_local_refs` (mod.rs:451)
- The `NAKED` early return comes after `llarg_idx` is initialized from `ret.is_indirect()`.
- **The spread argument:**
  - the `Tuple` `bug!` and the unsized `span_bug!`, both with upstream's text;
  - one alloca, then a loop that adds `pad_i32_count`, calls `project_field`, then `store_fn_arg`;
  - the `assert_eq!(None, num_untupled.replace(..), ..)` message has core's format, and `right` is the old value.
- **C-variadic:** `arg_index == fn_abi.args.len()`, then `lifetime_start`, then `va_start`.
- **Non-memory arguments:** `Ignore` gives `zero_sized`; `Direct` uses one param; `Pair` uses two.
- **`Indirect`:**
  - `needs_alloca` is `mode == AmdgpuKernelArg`, or `pointee_align < layout.align.abi`. `Align`'s derived `Ord` is on `pow2`.
  - The alloca path is followed by `store_fn_arg`; the other path is `get_param` plus `new_sized`.
- **`IndirectUnsized`:** two params, a `Pair`, `alloca_unsized_indirect`, then `store`.
- The default arm is an alloca plus `store_fn_arg`.
- **Retag:** all four arms, including the `Pair` assert, then `cached_llbbs[START_BLOCK] = Some(bx.llbb())`.
- **`#[track_caller]`:**
  - `mir_args` is computed with `num_untupled`;
  - the assert message has core's format with `{:?}` of the instance;
  - the `Direct` check is a `bug!` with `{:?}` of the mode;
  - the caller location comes from `get_param(llarg_idx)` without incrementing it, as upstream does.

### Other functions in mod.rs
- **`optimize_use_clone`** (mod.rs:391):
  - the let-else on `Call { call_source: Use }`, then the `assert_eq!(args.len(), 1)`;
  - a `Ref(_, inner, Not)` check, `type_is_copy_modulo_regions`, `place()`;
  - `target.unwrap()`;
  - it pushes `Assign((*destination, Use(Copy(arg_place.project_deeper([Deref])), WithRetag::Yes)))`, then sets a `goto`.
- **`find_cold_blocks`** (mod.rs:668): the guarded `Call | TailCall` arm is written as an if-chain. When the guard fails, the
  if-chain falls through to the `Unreachable` arm and then to the successor test, as upstream's match does (PORT 10).
  `first && all(rest)` matches.
- **`LocalRef::new_operand`** (mod.rs:188) is faithful.

### `non_ssa_locals` and `LocalAnalyzer` (analyze.rs)
- **The lattice:**
  - the initial value is ZST or Unused, from `spanned_layout_of` in local order;
  - `define`: Unused becomes `Memory` (for `BackendRepr::Memory`) or `SSA(loc)`; SSA becomes Memory; ZST and Memory stay.
- **`process_place`:**
  - `Index` locals are visited first with `COPY_CONTEXT`;
  - a local that is already Memory returns early;
  - `is_indirect_first_projection` records a copy of the base;
  - a mutating use becomes `MutatingUse(Projection)`;
  - otherwise it walks the layout. `Field` uses `layout.field`, and `Downcast` is allowed only under
    `Variants::Single { index } == vidx`. Anything else makes the local Memory and returns. The `debug_assert!` is kept as a
    comment.
- **`visit_local`:**
  - every context of the generated `MutatingUseContext` (9 variants) and `NonMutatingUseContext` (8 variants) lands in the same
    arm as upstream's exhaustive match;
  - the `Call` arm marks Memory when `intrinsic_call_expects_place_always`, then calls `define(CallReturn { call, target })`;
  - the `Drop` arm checks `type_needs_drop` of the monomorphized type;
  - `Yield` is a `bug!`.
- `visit_assign` defines a bare local, or else visits the place as `Store`, then visits the rvalue. `visit_place` delegates to
  `process_place` without calling `super_place`. `visit_statement_debuginfo` is a no-op.
- `is_backend_immediate` and `is_backend_scalar_pair` are not used in these three files at this pin (I grepped). `define`
  tests `BackendRepr::Memory` directly, and the port does the same.

### `cleanup_kinds` (analyze.rs:295)
- `discover_masters` covers all 15 `TerminatorKind` variants, in upstream's grouping.
- `propagate`:
  - `set_successor`, including the "2 parents" `span_bug!` text;
  - the RPO walk;
  - the `NotCleanup` and `Funclet` arms;
  - **the promotion arm:** `result[succ] = Funclet`, then `set_successor(succ_funclet, succ)`, then
    `set_successor(funclet, succ)`, in upstream's order.
- `CleanupKind::funclet_bb` is faithful.

### `Locals` and the `impl FunctionCx` block (locals.rs)
- `initialize_locals`: the assert text and the `warn!` text match upstream; the `\` continuation strips the indentation.
- `overwrite_local` builds a new `TyAndLayout` and a new `OperandRef` where upstream assigns `op.layout.ty`. This is
  equivalent, and it is consistent with ssa-operand-place's readonly fields.
- For the index guard, see N2.

### The lane against ssa-operand-place (`52dfcc7d`)
I ran a trial merge in my worktree and reverted it afterwards.
- `git merge-tree` is clean.
- The six `xlane` signatures equal that lane's methods:
  - `PlaceRef.new_sized(llval, layout)`, `alloca_size(bx, size, layout)`, `alloca_unsized_indirect(bx, layout)`;
  - `project_field(this, bx, ix)`;
  - `OperandRef.zero_sized(layout)`;
  - `monomorphized_place_ty(place_ref)`.
- The `OperandRef` constructor order is `(val, layout, move_annotation)` in both lanes.
- I applied both handoffs' integration steps: deleted the shim, repointed the imports, and added the two `install_*` calls
  after `class FunctionCx`. Then:
  - all production code typechecks;
  - all five mir modules load alone;
  - `analyze.test.ts` and `mod.test.ts` pass.
- The only errors are in the other lane's `operand_place.test.ts`: 11 tsc errors. It constructs the shim's three-argument
  `FunctionCx(mir, cx, locals)`, and the real constructor takes 19 arguments. Root must adapt that test at merge. This is not a
  finding against this lane.

## 2. No guessed values
- Every `unported(..)` in the diff is in the `xlane` table (`mod.ts:876-967`).
- Each target fn exists upstream at the path given:
  - base.rs:392 `wants_new_eh_instructions`;
  - place.rs:96 `new_sized`, :124 `alloca_size`, :136 `alloca_unsized_indirect`, :175 `project_field`, :424
    `monomorphized_place_ty`;
  - operand.rs:169 `zero_sized`;
  - retag.rs:399 `codegen_retag_operand`, :417 `codegen_retag_place`;
  - debuginfo.rs:531 `debug_introduce_locals`, :554 `compute_per_local_var_debug_info`, :736 `fill_function_debug_context`;
  - block.rs:1594 `codegen_block`, :1635 `codegen_block_as_unreachable`.
- `wants_new_eh_instructions` is not yet in `base.ts`, so the stub is needed.
- The owners match plan-m7 §8 (ssa-base, ssa-operand-place, ssa-debuginfo, ssa-block), except for retag (N1).
- Nothing returns a made-up value. The mock's two "upstream body" replacements are exact:
  - `wants_wasm_eh || is_like_msvc` is base.rs:385-394;
  - `place_ref.ty(..)` followed by `monomorphize` is place.rs:424.

## 3. Decisions
- **`drop(start_bx)`.** Upstream's drop is a real disposal: `impl Drop for GenericBuilder` (cg_llvm builder.rs:53) calls
  `LLVMDisposeBuilder`. All that does is delete the C++ `IRBuilder`; it never touches the IR. In the model it is a no-op
  (`src/rust_ts/llvm/build.ts:240`). cg-contract's recorded convention (`src/rustc_codegen_llvm/llvm/mod.ts:15`) already says
  that `Drop` impls are `drop()` methods that nothing calls at scope end. So keeping the drop as a comment skips no
  observable side effect, and no fix is needed. Calling `GenericBuilder.drop()` today would only reach cg-builder's stub. The
  handoff says this "needs a decision"; it does not (N4).
- **The `rustc_target/lib.ts` load-order import** (`mod.ts:25`) follows the recorded cg-contract decision 7. The same import
  is in eight other files: `remove_noop_landing_pads.ts`, `coroutine/mod.ts`, `rustc_codegen_llvm/abi.ts`, and others. It is
  correct.
- **PORT 3** puts `initialize_locals` and `overwrite_local` in the `FunctionCx` class body, with locals.rs markers. There is
  precedent for this: `obligation_forest/mod.ts` holds graphviz.rs, and `rmeta/mod.ts` holds decoder.rs, encoder.rs and
  table.rs. So it is acceptable. But it differs from the sister lane's installer pattern (N3).
- **PORT 1, 2, 4 and 6–10** are sound:
  - `Bx_` as a trailing field (block.rs needs `Bx::build`);
  - the D4 `d_T` table on `monomorphize`;
  - the new `OperandRef` in `overwrite_local`;
  - `xlane` as an object, which leaves the owners nothing to collide with;
  - opaque debuginfo placeholders;
  - the hook cast;
  - `Body_foldable` (identical to `shim.ts`'s);
  - `MutRef` for `llarg_idx`;
  - the if-chain for the guarded match.

## 4. Tests
- **The expected values are grounded.** Each local's memory set is checked twice:
  - against `oracle.json`, which comes from real pinned-nightly IR. I regenerated the IR for both fixtures myself
    (`-Copt-level=0 -Cno-prepopulate-passes --emit=mir,llvm-ir`), and the allocas, `funclet_bbN` and `personality` agree;
  - against the `HAND` table, which is derived from analyze.rs's rules.

  Neither source comes from the port's output.
- **My own derivations, from the pinned -O0 MIR:**
  - `borrowed`: `_3 = &_2` is a SharedBorrow, so x is memory. The read of `*_3` is indirect-first, a dominated copy of `_3`.
  - `mutated_field`: `(_2.1) = ..` is a Store with projections, so it becomes `MutatingUse(Projection)` and p is memory. `_5.1`
    is a Field of a ScalarPair, and SSA.
  - `opt`: `_0` is assigned in bb2 and bb3, so it is SSA and then Memory. `(_1 as Some).0` is a Downcast on
    `Variants::Multiple`, so o is memory.
  - `dropper`: `drop(_2)`, and `Noisy` needs drop, so n is memory. `_3: ()` is a ZST.
  - `loop_sum`: `_2` and `_3` are each defined twice, so they are memory.
  - `unit_borrow`: `&_1` on a ZST is still Memory, because the borrow arm sets it unconditionally.
  - `call_result`: `std::hint::black_box` is a plain fn, so `tcx.intrinsic` gives `None`. `CallReturn { bb0, Some(bb1) }`
    dominates bb1, so it stays SSA.
  - `big`: `_4: [u64; 8]` and `_3: Big` are `BackendRepr::Memory`.

  All eight agree with `HAND`.
- **`cleanup_kinds` of `two`:**
  - `discover_masters` marks bb4 (bb0's unwind) and bb5 (bb1's drop unwind) as Funclet.
  - The RPO is 0..6.
  - bb4 reaches bb5, a Funclet other than itself, so `set_successor(4, 5)`.
  - bb5 reaches bb6, which becomes `Internal(5)`.
  - The result is `[N, N, N, N, F, F, I(5)]`, which equals `HAND_CLEANUP` and the oracle's `funclet_bb4` and `funclet_bb5`.

  `branchy` gives `[.., F at 5, I(5), N, N]` by the same derivation.
- **The `branches` block order `0 2 3 1 4`** is correct for rustc's postorder, which takes successors with `next_back`: the
  postorder is `4 1 3 2 0`.
- **The driver and mock** are confined to `mir/analyze_oracle/`:
  - the `xlane` entries are swapped only inside `try`/`finally`;
  - `PlaceRef.alloca` is swapped at run time and restored;
  - nothing outside the lane's files is edited.
- **Gaps** (the handoff lists them): see N5.

## Findings (must fix)
None.

## Nits
- **N1** `src/rustc_codegen_ssa/mir/mod.ts:920` and `:929`: the two retag stubs stop with
  `"retag: compiler/rustc_codegen_ssa/src/mir/retag.rs .."`. "retag" names no lane.
  - plan-m7 §2d groups `mir/{operand,place,retag}.rs` as one 2,450-line group, and §8 gives `ssa-operand-place` exactly 2,450
    lines. So the planned owner is ssa-operand-place.
  - But docs/next.md assigned that lane only `{operand,place}.rs` plus `typetree.rs`, and `52dfcc7d` does not port retag.rs.
  - Root should assign retag.rs (upstream retag.rs:399 `codegen_retag_operand`, :417 `codegen_retag_place`) and rename the
    prefix to the owner, for example `ssa-operand-place:`, at merge.
  - The path is only reached under `-Zcodegen-emit-retag` (mod.rs:611).
- **N2** `src/rustc_codegen_ssa/mir/locals.ts:9-10, 15, 20` and `mod.ts:257`: the index guard of upstream locals.rs is weaker
  in the port.
  - Upstream's `values` field is private to the `locals` module (locals.rs:16). It is not `pub(super)`, as the header and the
    handoff (PORT 3) say. Together with `impl !IndexMut` (locals.rs:28), that privacy forces every write through
    `overwrite_local`'s subtyping fix-up. In the port, `values` is public, so a fill lane could write `fx.locals.values[i]`
    directly.
  - `index` (locals.ts:20, upstream locals.rs:23) returns `undefined` for an index out of bounds, where `IndexVec` panics
    "index out of bounds: the len is .. but the index is ..". `overwrite_local` (mod.ts:257, upstream locals.rs:81) grows the
    array instead of panicking.
  - Both fire only when an upstream invariant is broken.
  - Fix: correct the comment. At integration, grep that no fill lane writes `.locals.values` outside these two methods
    (ssa-operand-place reads only through `index`). Optionally, add the bounds panic to `index`.
- **N3** `src/rustc_codegen_ssa/mir/mod.ts:201-258` (PORT 3): locals.rs's `impl FunctionCx` block sits in mod.ts.
  - ssa-operand-place solves the same mod.ts load cycle with a hoisted installer (`install_FunctionCx_place(FunctionCx)`,
    called after the class).
  - An `install_FunctionCx_locals` in locals.ts would keep locals.rs's code in locals.ts (PORTING §2), make the two lanes
    consistent, and let N2's writes live in one file.
  - The current form has precedent and is not required to change.
- **N4** `src/rustc_codegen_ssa/mir/mod.ts:519-521` and handoff PORT 5:
  - the PORT comment should cite cg-contract's recorded `Drop` convention (`rustc_codegen_llvm/llvm/mod.ts:15`) and the
    model's no-op `LLVMDisposeBuilder` (`rust_ts/llvm/build.ts:240`), instead of "a backend that needs it releases the builder
    when it is no longer referenced";
  - the handoff should drop "needs a decision".
- **N5** `src/rustc_codegen_ssa/mir/analyze.test.ts`: these branches are checked only by reading:
  - `propagate`'s promotion arm (analyze.rs:383-395) and the "2 parents" `span_bug!`;
  - in `arg_local_refs`: the spread, C-variadic, `Indirect`, `IndirectUnsized`, retag and `#[track_caller]` arms;
  - in `allocate_local`: the `Cast`/`Indirect` return place;
  - `codegen_block_as_unreachable`.

  A hand-built body for `cleanup_kinds` would pin the promotion arm cheaply. Suggested for whichever lane first gives these
  paths an oracle case (ssa-block for unreachable blocks, cg-abi-consts for indirect arguments).

## Integration notes for root
1. When merging with ssa-operand-place, adapt `operand_place.test.ts`'s three-argument `new FunctionCx(..)` to the real
   19-argument constructor (11 tsc errors after the documented steps). Everything else in both handoffs' steps typechecks and
   loads.
2. N1: assign retag.rs and rename its two stub prefixes.

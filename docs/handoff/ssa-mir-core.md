# Handoff: ssa-mir-core (M7, plan-m7 wave 41): rustc_codegen_ssa `mir/{mod,analyze,locals}.rs`

Branch `t3/port-ssa-mir-core`, from `620acf48`. No merges.

## Summary
- All three files are ported in upstream order with markers. That is **22/22 fns**: mod.rs 6/6, analyze.rs 11/11, locals.rs 5/5.
  - mod.rs: `FunctionCx`, `LocalRef`, `IntrinsicResult` (kept from ssa-contract), `CachedLlbb`, `codegen_mir`, `optimize_use_clone`, `arg_local_refs`, `find_cold_blocks`.
  - analyze.rs: `non_ssa_locals`, `LocalAnalyzer` (a `Visitor` subclass), `LocalKind`, `CleanupKind`, `cleanup_kinds` with its nested `discover_masters` and `propagate`.
  - locals.rs: `Locals`, `initialize_locals`, `overwrite_local`.
- Nothing reaches this code from a protected suite yet. `codegen_mir` is called by `mono_item.rs`'s `define` (ssa-base, not yet ported), and the LLVM backend is not registered.
- Calls into fill lanes that have not landed go through one table, `xlane`, at the end of `mir/mod.ts`. Each entry is a typed stub that calls `unported("<lane>: <upstream path> <fn>")`. The list is below, and root repoints each entry when its owner lands.

## Files touched (all under `src/rustc_codegen_ssa/mir/`)
- `mod.ts`: replaces ssa-contract's stub file. It keeps `IntrinsicResult` and its companion unchanged, so `mod.test.ts` is unchanged and passes.
- `analyze.ts`, `locals.ts`: new.
- Tests, all new:
  - `analyze.test.ts`;
  - `analyze_oracle/driver.ts`, `analyze_oracle/mock.ts` (a test driver and mock backend; not a port);
  - fixtures `analyze_oracle/locals.rs` and `analyze_oracle/funclets.rs`;
  - `analyze_oracle/oracle.json` (facts read off the oracle's IR; `REGEN=1` rewrites it).

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| compiler/rustc_codegen_ssa/src/mir/mod.rs | 6/6 |
| compiler/rustc_codegen_ssa/src/mir/analyze.rs | 11/11 |
| compiler/rustc_codegen_ssa/src/mir/locals.rs | 5/5 |

`bun scripts/coverage.ts --check`: `markers ok (25942, ...)`.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/std/result.test.ts`: 3 pass.
- `mir/mod.test.ts`: 1 pass. `common.test.ts`: 33 pass. `rustc_codegen_llvm/skeleton.test.ts`: 15 pass.
- **`bun test ./src/rustc_codegen_ssa/mir/analyze.test.ts`: 23 pass, 0 fail** (199 expects, about 2 s, `RUST_TS_REQUIRE_PROBES=1`).
  - How it runs: `analyze_oracle/driver.ts` runs the real driver up to `analysis`. Then, for every `#[no_mangle]` fn of the fixture, it runs `codegen_mir` over a mock backend:
    - context methods are real queries in `TypingEnv::fully_monomorphized()`;
    - `intrinsic_call_expects_place_always` is cg_llvm's (`black_box`);
    - the `xlane` stubs are recorders;
    - `monomorphized_place_ty` and `wants_new_eh_instructions` use upstream's bodies.
    - It records the `LocalRef` each local gets, `non_ssa_locals`, `fx.cleanup_kinds`, and the backend calls in order.
  - Where the expected values come from:
    1. **The oracle (pinned nightly IR, `-Copt-level=0 -Cno-prepopulate-passes --emit=llvm-ir`).**
       - Names are kept, so `debug_introduce_local` names each local's value after its `VarDebugInfo`, or `_N`. A memory local is then exactly a `%<name> = alloca`; the fixtures pass no argument indirectly.
       - On `x86_64-pc-windows-msvc`, `landing_pad_for_uncached` appends `funclet_bbN` exactly for the `Funclet` blocks that an unwind edge reaches.
       - `personality` appears on a fn iff `set_personality_fn` was called.
    2. **The source.** The test has a `HAND` table that derives each fn's memory locals from analyze.rs's rules and the -O0 MIR, with one comment per fn naming the rule. `HAND_CLEANUP` does the same for `cleanup_kinds`, using `discover_masters` and `propagate` step by step.
  - What it covers:
    - **locals.rs (host)**, 12 fns: memory locals = the oracle's allocas = the hand derivation. The rules exercised:
      - SSA scalars;
      - pair temporaries read via `Field`;
      - `SharedBorrow`;
      - a store through a projection;
      - `BackendRepr::Memory`;
      - drop of a needs-drop type;
      - double definition;
      - loop redefinition;
      - `Downcast` of a multi-variant layout;
      - a borrowed ZST;
      - a call destination (`DefLocation::CallReturn`).
    - Memory locals get `Place` and the rest get `Operand`/`PendingOperand`. Allocas come in local order, with sizes, after the arguments' `get_param`/`store_fn_arg`.
    - Exactly one `append_block` ("start"), then `build`. `codegen_block` runs in reverse postorder: every block covered once, bb0 first, each later block after one of its predecessors; for `branches` the exact order is `0 2 3 1 4`.
    - `set_personality_fn` happens iff the oracle's fn has a personality.
    - No `cleanup_kinds` on a target without the new EH instructions.
    - **funclets.rs (msvc, `no_core`)**, 4 fns: the Funclet set = the oracle's `funclet_bbN`, the whole `cleanup_kinds` = the hand derivation, and the memory locals and personality match the oracle.
  - **Mutation check:** removing the `type_needs_drop` test in the `Drop` arm fails 2 tests. Accepting any `Downcast` also fails 2 tests.
- Sample difftests, `RUST_TS_AGENT=ssa-mir-core`, `--sample 200 --jobs 6`, AC power:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-053139-ssa-mir-core-g8ue`.
  - `mir-o2`: **200/200 MATCH**, run `20261112-053233-ssa-mir-core-f3xa`.
  - `mir`: **200/200 MATCH**, run `20261112-053329-ssa-mir-core-fdd8`.
- Every entry loads alone: `mod.ts`, `analyze.ts`, `locals.ts`, `rustc_codegen_llvm/lib.ts`.

### Not covered by the tests
- `propagate`'s promotion arm (an `Internal` block reached from two funclets) and its "2 parents" `span_bug`. MIR building gives no such shape in the fixtures. A hand-built body would test it.
- In `arg_local_refs`: `spread_arg` ("rust-call"), `c_variadic`, `IndirectUnsized`, `-Zcodegen-emit-retag`, `#[track_caller]` and the `Indirect` arguments.
- In `codegen_mir`: the `Cast`/`Indirect` return place, the nop-landing-pad edge filter (no nop pads in the fixtures), and `codegen_block_as_unreachable` (no unreached block in the fixtures).
- `optimize_use_clone`: it needs `#![feature(ergonomic_clones)]`.

## `xlane` stubs (every `unported(...)` left)
All are in `mir/mod.ts`'s `xlane` table:

| entry | stops with | owner |
|---|---|---|
| `wants_new_eh_instructions` | `ssa-base: compiler/rustc_codegen_ssa/src/base.rs wants_new_eh_instructions` | ssa-base (base.rs:392) |
| `PlaceRef_new_sized` | `ssa-operand-place: .../mir/place.rs new_sized` | ssa-operand-place |
| `PlaceRef_alloca_size` | `ssa-operand-place: .../mir/place.rs alloca_size` | ssa-operand-place |
| `PlaceRef_alloca_unsized_indirect` | `ssa-operand-place: .../mir/place.rs alloca_unsized_indirect` | ssa-operand-place |
| `PlaceRef_project_field` | `ssa-operand-place: .../mir/place.rs project_field` | ssa-operand-place |
| `OperandRef_zero_sized` | `ssa-operand-place: .../mir/operand.rs zero_sized` | ssa-operand-place |
| `monomorphized_place_ty` | `ssa-operand-place: .../mir/place.rs monomorphized_place_ty` | ssa-operand-place |
| `codegen_retag_place`, `codegen_retag_operand` | `retag: compiler/rustc_codegen_ssa/src/mir/retag.rs ...` | **no lane in docs/next.md**; plan-m7 §2d groups retag.rs with operand/place |
| `fill_function_debug_context`, `compute_per_local_var_debug_info`, `debug_introduce_locals` | `ssa-debuginfo: .../mir/debuginfo.rs ...` | ssa-debuginfo |
| `codegen_block`, `codegen_block_as_unreachable` | `ssa-block: .../mir/block.rs ...` | ssa-block |

`PlaceRef.alloca` and `OperandValue.store` are called directly. They are ssa-contract's stubs in place.ts and operand.ts.

## Integration notes for root
1. **ssa-operand-place**: agreed with that lane over cross-session messages.
   - Its place.ts and operand.ts import mod.ts type-only. They attach `FunctionCx` methods through hoisted installers, `install_FunctionCx_place(FunctionCx)` and `install_FunctionCx_operand(FunctionCx)`. At merge, root adds `install_FunctionCx_operand(FunctionCx); install_FunctionCx_place(FunctionCx);` right after `class FunctionCx` in mod.ts.
   - That lane carries a temporary `mir/mir_core_shim.ts` with the agreed shapes. Delete it and point its imports at mod.ts and locals.ts.
   - Then repoint the six ssa-operand-place `xlane` entries, or their call sites, to `PlaceRef.new_sized`, `PlaceRef.alloca_size`, `PlaceRef.alloca_unsized_indirect`, `place.project_field(bx, i)`, `OperandRef.zero_sized` and `fx.monomorphized_place_ty(..)`.
   - The agreed shapes:
     - `FunctionCx<B, Cx = CodegenMethods<B>, Bx = BuilderMethods<B, Cx>>`;
     - `LocalRef<V>` = `Place`/`UnsizedPlace`/`Operand` (`_0`) and `PendingOperand`, plus `LocalRef.PendingOperand` and `LocalRef.new_operand`;
     - `Locals<V>` with `index(local)`, `indices()` and `Locals.empty()`;
     - `fx.monomorphize(value, d_T)`;
     - `fx.overwrite_local(local, value)`.
2. **Load order.**
   - mod.ts imports `place.ts`, `operand.ts`, `analyze.ts` and `locals.ts` at run time.
   - `analyze.ts` imports mod.ts back, for `xlane`. That cycle is safe, because neither module touches the other's bindings at load time.
   - mod.ts imports `rustc_target/lib.ts` first, the known `Os` load-order fix. Without it, `mod.test.ts` fails as soon as mod.ts gains run-time imports.
3. `docs/claims/ssa-mir-core.md` (root's claim) is left for root to delete.
4. INFO sites: locals.rs's `warn!` in `initialize_locals` is live (`tracing.warn("rustc_codegen_ssa::mir::locals", ..)`). `info_sites_check.ts` does not list locals.rs, so I could not confirm that check covers it.

## `// PORT:` decisions
1. **`Bx_` field and parameter.** `codegen_mir(Bx_, cx, instance)` takes the builder's static side, `BuilderMethodsStatic` (ssa-contract PORT 4). `FunctionCx` keeps it as a trailing field `Bx_`, which is not upstream, because block.rs's `codegen_block` calls `Bx::build(self.cx, llbb)`.
2. **`monomorphize<T>(value, d_T)`** takes the `TypeFoldable` table, as `instantiate_mir_and_normalize_erasing_regions` does (plan-m4 D4).
3. **`initialize_locals` and `overwrite_local`** sit in the `FunctionCx` class body, with locals.rs markers (PORTING §8 clarification 1). The extension-file form would be a mod.ts <-> locals.ts load cycle, and lib.ts, the crate root that would load extension files, is ssa-base's. `Locals.values` stays public for them, as upstream's `pub(super)`.
4. **`overwrite_local`'s `op.layout.ty = local_ty`** builds a new `TyAndLayout` (its fields are readonly) and a new `OperandRef`, instead of writing the `Copy` value in place (ssa-contract review N5; ssa-operand-place makes these fields readonly).
5. **`drop(start_bx)` is a comment.** The backend's `Drop` (cg_llvm `LLVMDisposeBuilder`, `GenericBuilder.drop`) is not part of `BuilderMethods`, so generic code cannot call it. Recommendation: if cg-builder's `drop` must run, add an optional `drop?()` to the builder trait surface, or have cg_llvm dispose at its own boundary. This needs a decision.
6. **The `xlane` table** holds cross-lane stubs. They are not prototype methods or class statics, so nothing collides when the owners land, and tests can swap entries.
7. **Placeholders for ssa-debuginfo's types.** `FunctionDebugContext`, `PerLocalVarDebugInfo` and `ConstDebugInfo` are opaque branded types in mod.ts, which never constructs them. ssa-debuginfo replaces them with its own.
8. **Hook result type.** `tcx.find_noop_landing_pads_for_instance(..)` is cast to `DenseBitSet<BasicBlock>`, because hooks are typed `unknown` in rustc_middle/hooks.ts.
9. **Small translations.**
   - `Body_foldable` is a local copy of the 3-line D4 table, the same as rustc_mir_transform shim.ts's; rustc_codegen_ssa does not import mir_transform.
   - `Ord::max` on `Size` returns the second argument when equal.
   - `Align < Align` compares `pow2`, its derived `Ord`.
   - `llarg_idx` is a `MutRef<number>`, because it is passed as `&mut` to `store_fn_arg`.
   - `assert_eq!` with a message is written out with core's text.
10. **`find_cold_blocks`'s guarded match** is an if-chain. A `Call`/`TailCall` whose callee is not `#[cold]` falls through to the `Unreachable` and successor checks, as upstream's guard failing does.

# Review: lane `miri-contract` (✱ contract-first, plan-m6 wave 35)

Reviewer: independent, read-only. Branch `t3/miri-contract-skeleton`, head `c87ae8b4`. Reviewed the lane's own commit
(`git diff 962778c6 c87ae8b4`, i.e. after its merge of `integ-w35`: 168 files, src/miri/**, src/rust_ts/miri_stub.ts,
tools/codegen/{types.ts, types.sets.json, miri.typemap.json, typemap.miri.json}, the handoff). Upstream: the pinned
`src/tools/miri/src`. I also compared it against `t3/generalize-interpreter-machine` (`bcd5a940`, interp-generic) with a
trial merge of both heads in a scratch worktree, since removed.

## Verdict: **APPROVE WITH NITS**

The skeleton does what a contract-first lane should. The layout is one module per upstream file. Every stub names its
fill lane, and that matches plan §5 and the lane's own x86 / tree-borrows splits. The augmentation design follows
PORTING §5. The installer is strict and loads in a deterministic order. The 24 ported fns are faithful, and their
markers are checked. The codegen set regenerates reproducibly.

Nothing here blocks merging the lane. Merging it together with interp-generic does need a reconciliation step, though.
On the trial merge, tsc reports **89 errors, all at the interface between the two lanes**. There is also one **silent**
type mismatch (`Frame<FrameExtra>`) that tsc does not report. The list is under "interp-generic mismatches" below.
Root should do the reconciliation in the integration merge, after interp-generic and before any wave-36 Miri lane
starts.

## Results (lane worktree, one line each)

- `bunx tsc --noEmit -p .`: exit 0, 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23193; vendor 4680)`. This checks only `compiler/`
  markers; the 24 Miri markers are checked by `src/miri/contract.test.ts`.
- `bun test src/miri tools/codegen`: 63 pass, 0 fail (16 files).
- `bun scripts/difftest.ts --suite mir --sample 100` (agent `review-miri-contract`): MATCH=100 DIFF=0 UNPORTED=0
  CRASH=0. Run `20261031-231141-review-miri-contract-4kfr`.
- Codegen: `bun tools/codegen/types.ts miri` run twice, then `rustc_const_eval_interpret`, `rustc_middle_mir` and
  `rustc_borrowck`. Afterwards `git status --short` is empty. Set `miri`: 60 files, unknown types 0, unknown cfg 0,
  errors 0.
- Module coverage: every in-scope upstream `.rs` has a module, and no TS module lacks an upstream file. The files with
  no module are exactly the D2/A3/C6/C7/D12 exclusions plus `tree_borrows/tree/tests.rs`. There is no
  `intrinsics/atomic.rs` at the pin.

## Checks

1. **Layout and lanes.** The module → lane table agrees with plan §5 for every lane. `concurrency/weak_memory` is in
   miri-sb, `intrinsics/{mod,math,simd}` and `socket.rs` (A3) are in shims-d, and `genmc/dummy` is in miri-threads
   (C7). See N4 for `bin/log/*`.
2. **Augmentation design.** `declare module ".../eval_context.ts" { interface InterpCx<..> { f(this: MiriInterpCx, ..) } }`
   with bodies on `InterpCx.prototype` is PORTING §5's "methods defined in another file". There are 390 declared
   extension methods: none is declared twice, and none clashes with an `InterpCx` field (`tcx`, `machine`, `memory`,
   `typing_env`, `layout_cache`, `recursion_limit`). I checked that.
3. **Installer** (src/rust_ts/miri_stub.ts). It is sound:
   - Installation is deferred to the end of `lib.ts`, so `target()` closures run after every class has been defined.
   - Registering after install throws.
   - An own-property collision throws.
   - Each placeholder carries path + upstream file + lane.

   It is not a hidden init-order hazard for the crate itself. Two edges need attention (N1, N2).
4. **Ported fns** (machine.rs ×16, borrow_tracker/mod.rs ×7, provenance_gc.rs ×1). I compared each against upstream:
   - `FrameExtra` Debug: name `FrameData`, the field order, and `timing` is omitted.
   - `From`, `MayLeak`, `should_save_allocation_span`, `Display` for `MiriMemoryKind`: every arm matches.
   - `Provenance` Debug: `{alloc_id:#?}` vs `{alloc_id:?}` maps to PRETTY vs PLAIN. `{tag:?}` starts a fresh spec, so
     PLAIN is right.
   - `interpret::Provenance` impl: `OFFSET_IS_ADDR = true`, `WILDCARD = Some(Wildcard)`, `fmt` as `{:#x}` → `0x…`
     lowercase.
   - `ProvenanceExtra` Debug and `and_then`.
   - `AllocExtra` Clone panics.
   - `MiriInterpCxExt`, the `MachineCallback::call` declaration.
   - `BorTag` new/get/inner/succ/one/default/Debug `<n>`.
   - `sym.rs` `generate!`, expanded by hand; the test checks the interner indices.

   All markers resolve, per `contract.test.ts`.
5. **Codegen change.** The `types.ts` `fileModule` change (+3/−2) is minimal and correct. It only adds a fallback
   regex for `src/tools/(miri)/src/`, so `compiler/` paths are unaffected, and the four other sets regenerate
   byte-identically. Note that `typemap.miri.json` is merged **globally**; see N6.

## Decisions C1–C13

| # | decision | verdict | reason |
|---|---|---|---|
| C1 | layout; bin crate separate, not in codegen set | **agree** | mirrors D2; the bin crate really is a separate crate (`use miri::`) |
| C2 | `EvalContextExt` → `InterpCx` augmentations, `this_` | **agree** | PORTING §5 pattern; collision-checked |
| C3 | `MiriInterpCx = InterpCx<Machine & MiriMachine>` until interp-generic | **agree (temporary)** | the right interim; it must flip at the reconciliation (M1) |
| C4 | `BorTag` branded `number` | **agree** | tags are handed out sequentially from 1 (< 2^53), so they are fast map keys. Amend: `-Zmiri-track-pointer-tag=<u64>` (bin/miri.rs, miri-driver) parses a user u64. Parse it as bigint and reject/handle > 2^53−1 explicitly; never round |
| C5 | u64/i64 → `bigint` set-wide in `miri` | **amend** | Fidelity-safe and matches program-visible values (addresses, epoll data, eventfd, inode, `seed`). But it is the opposite of the global default (`number`) and of `Size`'s number fast path, and it lands on Miri hot paths: `MiriMachine.basic_block_count` (+1 per terminator), `clock` `Virtual.nanoseconds` (ticks per block), `DedupRangeMap` `range {start,end}` (every SB / data-race / weak-memory range lookup, keyed by `Size` offsets), SB `Item._0` (the packed tag/perm bits, scanned on every access). Keep bigint as the default, but give these four a `fields` override (or, for `Item`, a hand representation) **now**, before the fill lanes write code against them. Record each with a `PORT:` |
| C6 | generated without `native-lib` | **agree** | Every `cfg(feature="native-lib")` site is reached only with `-Zmiri-native-lib` (also bin/miri.rs:732, machine.rs:1073, alloc_addresses:166, all listed or equivalent), and D2 excludes it. `-Zmiri-native-lib` must stop `unported` |
| C7 | genmc dummy in scope | **agree** | `#[cfg_attr(not(feature="genmc"), path="genmc/dummy.rs")]`: dummy.rs *is* the compiled module, and its API (`GenmcCtx`, `run_genmc_mode`, …) is called unconditionally |
| C8 | `binary_ptr_op_` | **agree** | verified: rustc_const_eval operator.rs:316 is a private inherent `fn binary_ptr_op`; Miri's trait method (operator.rs:13) is the one machine.rs:1367 resolves to. Trailing-`_` is the repo's clash rule. Add a guard (N1) |
| C9 | path-called `emulate_foreign_item_inner` as module fns | **agree** | verified: math / unix / linux are only called by path (foreign_items.rs:909/919, unix/foreign_items.rs:1420); the shims/foreign_items.rs:76 one is a method call and stays a method |
| C10 | init order rules | **agree** | sound; the contract test loads every module as a fresh entry point |
| C11 | generated name clashes (`io_Error`, `interpret_MemoryKind`, `DataRace.ptr` field) | **agree** | minimal and documented |
| C12 | no `rustc_const_eval::interpret::*` glob re-export | **agree** | a TS glob would collide with Miri's `Pointer`/`Scalar`/`MemoryKind` |
| C13 | tools/codegen `fileModule` change | **agree** | minimal, other sets unchanged (verified) |

## Findings

All are non-blocking for this lane. M1–M8 below are merge-time conditions for root.

- **N1 (non-blocking) — src/rust_ts/miri_stub.ts:56.** The collision check guards only *stubbed* names, at install
  time. Once a fill lane ports a method and deletes it from its stub list, nothing stops it from silently overwriting a
  rustc_const_eval `InterpCx` method. Example: someone ports C8 as `binary_ptr_op` and forgets the `_`. Suggest a
  contract test: load `rustc_const_eval/lib.ts`, snapshot the identity of every own property of `InterpCx.prototype`,
  load `src/miri/lib.ts`, and assert none changed.
- **N2 (non-blocking) — src/rust_ts/miri_stub.ts:45 / src/miri/lib.ts.** Only modules loaded by `lib.ts` may call
  `stub_*`. A module loaded after `lib.ts` (e.g. the `bin/` crate, which `lib.ts` does not load) throws "registered
  after install". If a module is used without `lib.ts`, calls to its unported methods fail as `TypeError: not a
  function` instead of `unported`. Say this in the miri_stub.ts header and the handoff's "How to fill a stub" (the
  bin crate must not use `stub_*`).
- **N3 (non-blocking) — src/miri/helpers.ts:145.** `user_relevance(frame: Frame<Provenance>)`: upstream
  helpers.rs:1045 is `&Frame<'tcx, Provenance>` (Extra = `()`). On this branch `Frame`'s only parameter is `Extra`, so
  this declares Extra = `Provenance`. The mechanical translation kept `Prov` here but erased it everywhere else (M5).
  It happens to become right after interp-generic.
- **N4 (non-blocking) — src/miri/bin/log/{mod,setup}.ts.** Labelled `miri-driver`. Plan §5 says "bin/log/setup.rs
  with D10" in miri-driver, but A6 moves the D10 port into lane `miri-log`. Root should decide which lane owns
  `bin/log/*` and fix the two headers and the handoff table.
- **N5 (non-blocking) — src/miri/alloc/alloc_bytes.ts.** `MiriAllocBytes` is a plain interface `{ layout, ptr:
  number, params }`. interp-generic PORT 3 requires every `AllocBytes` value to *be* a `Uint8Array` (a subclass is
  fine): `deref` / `as_ptr` are the view itself. miri-alloc should make it `class MiriAllocBytes extends Uint8Array {
  layout; params }`. With native-lib off, `ptr` has no consumer that needs a host address.
- **N6 (nit) — tools/codegen/typemap.miri.json.** Its `cfg` lists are merged into the global type map, so they apply
  to every set. Today no set in compiler/ uses these feature names; only `rustc_llvm/build.rs` has `check_only`, and it
  is in no set. That is acceptable, because set-local typemaps have no `cfg` support. Note in the file that the names
  are global.
- **N7 (nit) — docs/handoff/miri-contract.md "Contract for interp-generic" §1.** This lists the associated types but
  not `AllocParams` (= `MiriAllocParams`, alloc_bytes.rs). interp-generic's `MachineTypes` has it, and Miri's
  `get_default_alloc_params` hook returns it.

## interp-generic mismatches (for root's reconciliation; trial merge of c87ae8b4 + bcd5a940)

The textual merge conflicts only in a header comment of rustc_const_eval interpret/memory.ts (integ-w35's
followups-34 bullet vs interp-generic's). That conflict is not this lane's. Keep the followups-34 text: the
`UndefinedBehaviorInfo` fields are exact bigints. Type errors on the merged tree: **89** (68 in src/miri, 21 at the
other `InterpCx` declarations they invalidate).

| # | miri-contract assumes | interp-generic delivers | effect at merge | fix (owner) |
|---|---|---|---|---|
| M1 | `MiriInterpCx = InterpCx<Machine & MiriMachine>`; associated types as separate parameters | `Machine<T extends MachineTypes>` (a type-level record), `InterpCx<M extends AnyMachine = Machine>`, `ProvOf<M>` / `MachineTypesOf<M>` | compiles, but `ProvOf<Machine & MiriMachine>` is `CtfeProvenance`: Miri's values would be typed with CTFE provenance | define `MiriMachineTypes` (`MemoryKind = MiriMemoryKind`, `Provenance`, `ProvenanceExtra`, `ExtraFnVal = DynSym`, `FrameExtra`, `AllocExtra`, `Bytes = MiriAllocBytes`, **`AllocParams = MiriAllocParams`**, `MemoryMap = MonoHashMap<…>`); `MiriMachine` implements `Machine<MiriMachineTypes>` (interface merge on the generated class); `MiriInterpCx = InterpCx<MiriMachine>` (root at reconcile, then miri-machine) |
| M2 | every Miri `declare module` header is `interface InterpCx<M extends Machine = Machine>` | the parameter must be `M extends AnyMachine = Machine` on **all** declarations | **81 × TS2428** (60 Miri modules + the 21 declarations in rustc_const_eval they invalidate) | mechanical: change the 60 headers (I verified that this alone removes all 81) (root at reconcile) |
| M3 | `Provenance_Provenance: interpret.Provenance<Provenance>` with `OFFSET_IS_ADDR`, `WILDCARD`, `get_alloc_id`, `fmt` | `Provenance<P>` also requires `eq` (the `PartialEq` supertrait) and `debug` (`Debug`); object provenances register an `ObjectProvenance<P>` with `owns(prov)` through `register_object_provenance` | **1 × TS2739** (machine.ts:186); unregistered, `provenance_of` panics on any Miri pointer | add `eq` (the derived `PartialEq`: same variant, and for `Concrete` the same `alloc_id` and `tag`), `debug: debug_Provenance`, `owns` (`$` is `Concrete`/`Wildcard`), and the `register_object_provenance(Provenance_Provenance)` call at machine.ts load (root or miri-machine) |
| M4 | value types erased: miri.typemap.json `ImmTy` / `OpTy` / `FnArg` / `PlaceTy` / `MPlaceTy` with `debug_X($v, $f)` / `clone_X($v)`; lib.ts aliases `ImmTy = interpret.ImmTy` | generic over `Prov`; `debug_X(v, f, debug_Prov)` / `clone_X(v, clone_Prov)` | **7 × TS2554** in eval.gen, global_ctor.gen, tls.gen, unix/poll.gen, unwind.gen; plus a silent `ImmTy<CtfeProvenance>` in every alias | the typemap entries become `ImmTy<Provenance>` with `debug_ImmTy($v, $f, debug_Provenance)`, etc.; lib.ts aliases `interpret.ImmTy<Provenance>`, …; regenerate set `miri` (root: tools/codegen) |
| M5 | `Frame` mapped as `Frame<$1>` (Extra only); hand declarations `Frame<FrameExtra>` | `Frame<Prov = CtfeProvenance, Extra = null>` | **silent, tsc does not report it**: `Frame<FrameExtra>` becomes Prov = `FrameExtra`, Extra = `null`. Sites: thread.gen.ts:179, thread.ts ×5, borrow_tracker/mod.ts:96, helpers.ts:141 | typemap `Frame<$0, $1>` with Prov bound to `Provenance`; hand sites `Frame<Provenance, FrameExtra>` (root at reconcile) |
| M6 | `MayLeak_MemoryKind` and `Display` of `M::MemoryKind` dispatched through the machine | `find_leaked_allocations` (memory.ts:1525) still reads `const_eval_machine().MayLeak_MemoryKind`, and `display_CtfeMemoryKind` is CTFE-only. `display_MemoryKind(kind, f, display_T)` is generic and fits `display_MiriMemoryKind` | Miri's leak check would use CTFE's `may_leak` → wrong leak reports | **follow-up (small interp lane, or miri-machine with root's OK):** a machine member `MayLeak_MemoryKind` (and the `Display` table) used by `find_leaked_allocations` and the leak/dump printers, next to `Provenance` / `Bytes` |
| M7 | `impl Machine for MiriMachine` on the generated class | the provided hook defaults live in `abstract class Machine_provided<T>`. Generated classes cannot `extends` it (no codegen support); the same holds for `MonoHashMap` vs `AllocMap_provided` | hooks Miri does not override would be missing at run time | **follow-up for miri-machine / miri-driver:** copy the provided defaults onto `MiriMachine.prototype` / `MonoHashMap.prototype` (a mixin helper), or add an `extends` option to the codegen (a tools/codegen batch). Record the choice |
| M8 | `MiriAllocBytes` hand interface; hook `stack` as `stack_`; `GLOBAL_KIND = "Global"`, `PANIC_ON_ALLOC_FAIL = false`; `MemoryMap` must implement `AllocMap` | `Bytes` values must be `Uint8Array`s (N5); `stack_` ✓; `GLOBAL_KIND` / `PANIC_ON_ALLOC_FAIL` / `Provenance` / `Bytes` / `MemoryMap_default()` are machine members ✓; `Memory.new(machine)`; `adjust_global_allocation` returns `Cow` | consistent apart from N5; I found no name clash between `Machine` members and `MiriMachine`'s 58 fields | miri-alloc (N5); miri-machine (`Cow::Owned` from `adjust_global_allocation`) |

After M2 alone, the merged tree has 8 errors (M3 + M4). M5 has to be fixed by inspection, because tsc does not
report it.

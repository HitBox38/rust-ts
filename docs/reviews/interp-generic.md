# Review: lane `interp-generic` (plan-m6 D3 + A1, contract-first)

Reviewer: independent, read-only. Batch: `git diff b0008692..bcd5a940` (branch `t3/generalize-interpreter-machine`).
Upstream: the pin under `$RUST_TS_DATA/rust`.

## Verdict: REQUEST CHANGES

The design is sound, and every `OFFSET_IS_ADDR` / `WILDCARD` site matches upstream. CTFE behaviour is unchanged
(suites below). Two places still hard-wire CTFE where upstream dispatches on the machine's associated type. Both are
on Miri's path, and the second runs on every Miri execution. Both fixes are small.

## Blocking

**B1. `get_alloc_bytes_unchecked_raw` / `get_alloc_raw_mut`'s caller bind the CTFE provenance silently.**
`src/rustc_const_eval/interpret/memory.ts:1040` (`alloc._0.get_bytes_unchecked_raw()`, upstream memory.rs:746) and
`memory.ts:1135` (`alloc.get_bytes_unchecked_raw_mut()`, upstream memory.rs:849) pass no `Provenance` descriptor.
Both callees are A1 rows (allocation.rs:653 / 661 `assert!(Prov::OFFSET_IS_ADDR)`), so the omitted descriptor
defaults to `Provenance_CtfeProvenance`. The interpreter bodies are typed with the CTFE defaults, so the
`this: Allocation<CtfeProvenance>` overload type-checks and tsc cannot see the problem. With Miri's provenance
(`OFFSET_IS_ADDR = true`), the assert fails where upstream passes. Miri reaches the first through
alloc_addresses/mod.rs:163 and the second through native_lib.
- Fix: pass `this.machine.Provenance` at both sites.
- The handoff says only the two pretty-printer callers use the default overload. That is not true.

**B2. `M::MemoryKind: MayLeak + Display` is still CTFE's.** Upstream dispatches statically on the associated type.
The port reads const_eval's impls in three places:
- `memory.ts:1526-1528` `find_leaked_allocations` (upstream memory.rs:1203 `kind.may_leak()`) uses
  `const_eval_machine().MayLeak_MemoryKind`, which switches on `self.$ === "Heap"`.
  - A Miri kind (`MiriMemoryKind`, a string) returns `undefined`, so `may_leak` is false for every machine kind.
  - Miri's `Global` / `Runtime` / `Machine` / `Tls` / `ExternStatic` allocations would therefore be reported as leaks.
    Miri runs its leak check at the end of every successful run (eval.rs), so this is on the M6a `miri-hello` path.
- `memory.ts:708` `deallocate_ptr` message (upstream memory.rs:420 `{alloc_kind}` / `{kind}`) and `memory.ts:1629`
  `DumpAllocs` (upstream memory.rs:1291 `({kind}, `) use `display_CtfeMemoryKind`.

The miri-contract handoff (contract item 3) lists exactly these needs: `MayLeak_MemoryKind` at memory.ts:1507 and
`Display` of `M::MemoryKind`. The lane's handoff also says every static dispatch on an associated type now goes through
the machine, and these three sites contradict that.
- Fix: add machine members, as was done for `Provenance` / `Bytes` / `MemoryMap_default`. For example,
  `readonly MayLeak_MemoryKind: MayLeak<T["MemoryKind"]>` and `display_MemoryKind(kind, f)`.
- `compile_time_machine` sets them to const_eval's impls. The three sites call them through `this.machine`.

## Non-blocking

- **N1 (hazard behind B1).** The CTFE-default overloads on `Allocation` (`get_bytes_strip_provenance`,
  `get_bytes_unchecked_raw(_mut)`, `read_scalar`) cannot be caught by tsc inside the CTFE-typed interpreter bodies.
  - Suggestion: drop the defaults and pass `Provenance_CtfeProvenance` explicitly at the tcx-allocation callers
    (`mir/pretty.ts:2406`, `ty/print/pretty.ts:4560`, `mir/consts.ts:239/242`). tsc would then flag every interpreter
    call site that leaves the descriptor out.
- **N2.** `Cow_into_owned_Allocation` (`memory.ts:1990`) clones the `Borrowed` arm with `Extra` by identity and
  `Bytes` with `Uint8Array.slice()`.
  - Upstream uses `Allocation: Clone`, that is `AllocExtra: Clone` and the `Bytes` clone.
  - This is right for CTFE (`()`, `Box<[u8]>`). For Miri it would alias the extra state and lose `MiriAllocBytes` state.
  - Miri's `adjust_global_allocation` always returns `Owned`, so the arm is unreachable there today. Add a `// PORT:`
    note, or take clone descriptors.
- **N3 (outside the lane's files, follow-up for root).** `src/rustc_middle/mir/pretty.ts:174` `debug_prov` still
  dispatches bigint → `CtfeProvenance` and everything else → `AllocId`.
  - Upstream `write_allocation_bytes<Prov: Provenance>` (pretty.rs:1871) prints `{prov:#?}`. Through `DumpAllocs`
    (Miri's `miri_print_alloc`), an object provenance would be printed as an `AllocId`.
  - Fix: use pointer.ts `debug_provenance`.
- **N4.** `provenance_map.ts:308` reads `provenance_of(frag.prov).WILDCARD`. Upstream line 215 reads `Prov::WILDCARD`,
  and the `Prov` descriptor is now a parameter of `read_ptr`. Using `Prov.WILDCARD` would be more faithful and cheaper.
  The two are equivalent as long as registration is right.
- **N5.** `place.ts:26` and `validity.ts:30` still import `Provenance_CtfeProvenance`, but nothing uses it any more.

## Check 1: A1 sites against upstream

I grepped upstream myself (`OFFSET_IS_ADDR|WILDCARD` in rustc_const_eval and mir/interpret). There are 15 uses outside
declarations and comments: memory.rs:612/1698, place.rs:498, validity.rs:688/944, intrinsics.rs:409,
pointer.rs:309, value.rs:295, allocation.rs:597/653/661/719 and provenance_map.rs:215/237/239/354. That is the
lane's list, and each row matches upstream line by line:
- **`ptr_offset_from` (intrinsics.ts:598-599):** the `OFFSET_IS_ADDR` arm `(a.addr().bytes(), b.addr().bytes(), true)`
  and the `else` match arms are in upstream order, with the same error text.
- **`is_ptr_misaligned` (memory.ts:889-890)** and **`ptr_try_get_alloc_id` (memory.ts:1945)** are faithful.
- **maybe-null messages:** place.ts:602 and validity.ts:580/848 are faithful.
- **`Pointer<Option<P>>::addr`:** asserts through the passed impl.
- **Allocation / ProvenanceMap arms:** faithful, including `.or_else(|| WILDCARD).unwrap()` and `write_wildcards`.
- **`get_alloc_raw`:** the `Cow::Owned` arm (`M::GLOBAL_KIND.expect(..)`, map insert through `get_or`) matches
  memory.rs:720-733.
- **`get_alloc_raw_mut`:** `into_owned` matches memory.rs:831.

Other associated consts (`GLOBAL_KIND`, `PANIC_ON_ALLOC_FAIL`, `ALL_CONSTS_ARE_PRECHECKED`) are read from
`this.machine`. `M::Bytes` (memory.ts:542/544/554) and `M::MemoryMap::default()` (memory.ts:251) dispatch correctly.

The remaining `CtfeProvenance` value operations are CTFE in upstream too: intern.ts, util.ts, memory.ts:477
`global_root_pointer` and operand.ts:1000/1016. The specialisations still left are B1, B2 and N3.

## Check 2: design

The type-level `MachineTypes` record is sound under PORTING §5 "Traits". Static dispatch is done through machine
members or descriptor parameters, value types are generic over `Prov` with the CTFE default, and object provenances
are registered.
- It covers miri-contract's contract items 1, 2 and 4.
- Item 3 is covered except `MayLeak` / `Display` (B2).

Changing provenance comparison from JS identity to `provenance_eq` cannot change a CTFE result:
- `CtfeProvenance` is a bigint and `AllocId` a number, so `===` already compares them by value.
- `provenance_eq` short-circuits on `===` and only calls the impl's `eq` for objects.

The price of this design is that the method bodies stay CTFE-typed, so tsc cannot find leftover CTFE wiring (B1, N1).

## Check 3: out-of-scope edits

The `tools/codegen` edits are mechanical. Only set `rustc_const_eval_interpret` uses
`const_eval_interpret.typemap.json`. Re-running `bun tools/codegen/types.ts rustc_const_eval_interpret` reports
0 unknown types and 0 missing debug/clone, and `git status --short` stays clean.

The other edits are type-only or pass a clone/debug descriptor:
- `eval_queries.ts` and `valtrees.ts` (`clone_MPlaceTy(x, clone_provenance)`, `debug_MPlaceTy(.., debug_provenance)`).
- `gvn.ts`.
- The `const_eval/{machine,type_info,dyn_trait}.ts` and `type_info/adt.ts` interface headers.

## Check 4: performance

Same `mir-core --sample 300` (agent `interp-generic-review`; the whole cost is the heavy `core` process):
- **Branch:** 188.2 s wall, 193.8 s user, 9190 MB RSS (run `20261031-231025-interp-generic-review-a0ys`).
- **main `110ffb12`** (no `src/` change from base `b0008692`): 270.9 s wall, 241.7 s user, 9888 MB RSS (run
  `20261031-231533-interp-generic-review-irrs`).

This is one noisy pair, but the branch shows no slowdown, which agrees with the lane's `ctfe200000.rs` measurement.

## Check 5: results

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23169; vendor 4680)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_const_eval src/rustc_middle src/rustc_mir_transform`: 482 pass, 0 fail
  (62 files).
- `difftest --suite mir --sample 300`: 299 MATCH, 0 DIFF, 1 UNSTABLE (oracle not reproducible, never MATCH by
  definition) (run `20261031-230937-interp-generic-review-hw6o`).
- `difftest --suite mir-core --sample 300`: 300/300 MATCH (run `20261031-231025-interp-generic-review-a0ys`).
- `difftest --suite mir-alloc --sample 200`: 200/200 MATCH (run `20261031-231336-interp-generic-review-v248`).

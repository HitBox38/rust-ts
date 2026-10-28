# Handoff: mt-opt2-a (wave 27, MIR passes at -Zmir-opt-level >= 2, part a)

Branch `lane/mt-opt2-a` (base `fbb8fa9a` on integ-w25, no merges). Commits, in order:
- `256d715d` `policy` of all four passes (first, as asked: unblocks every `optimized_mir` that stopped at the
  `UnreachablePropagation` / `DeadStoreElimination` / `GVN` / `SimplifyComparisonIntegral` stub's `policy`).
- `63f8c673` + `ad0ed400` unreachable_prop.rs (+ a marker line fix).
- `78e693e8` dead_store_elimination.rs.
- `4b6b1bfe` simplify_comparison_integral.rs.
- `ff8a6d8a` gvn.rs.
- then this handoff.

## Files touched
All in `src/rustc_mir_transform/`. Each replaces an mt-opt2 stub and keeps the stub's names and shapes.
- `unreachable_prop.ts`: `UnreachablePropagation`, `remove_successors_from_switch` (exported: mt-opt2's
  `match_branches.rs` imports it from here).
- `dead_store_elimination.ts`: `eliminate`, `DeadStoreElimination` (both variants).
- `simplify_comparison_integral.ts`: `SimplifyComparisonIntegral`, `OptimizationFinder`, `find_branch_value_info`,
  `OptimizationInfo`.
- `gvn.ts`: `GVN`, `VnIndex`, `VnOpaque`, `AddressKind`, `AddressBase`, `Value`, `ValueSet`, `VnState` (both impl
  blocks + its `MutVisitor` impl), `ty_may_have_ref_inner`, `is_deterministic`, `may_have_provenance`,
  `op_to_prop_const`, `StorageRemover`, `StorageChecker`.
- `pass_manager.test.ts`: stub-module count 16 -> 12.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_mir_transform/src/<f>.rs`)
gvn 62/62, unreachable_prop 3/3, dead_store_elimination 4/4, simplify_comparison_integral 4/4.
`bun scripts/coverage.ts --check`: markers ok (22420; vendor 4351). `bunx tsc --noEmit -p .`: clean.
Two `rustc-skip`s in gvn.ts: `VnOpaque`'s `PartialEq::eq` / `Hash::hash` impls (both `unreachable!()`; never reached,
see the GVN decisions).

## Tests
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform`: **77 pass, 0 fail**.
- Full `bun test src` (once, at the end, load average ~60): **6222 pass, 1 fail**: the known vendor/odht load timeout
  (`odht.oracle.test.ts`, the probe hit bun's 5 s default); it passes alone with `--timeout 120000` (5/5).
- No test pinned the four stubs' stops.

## Runtime stops left (`unported(...)`)
- `rustc_mir_transform::gvn::simplify_place_projection (ConstantIndex offset beyond 2^53)`: `ProjectionElem::
  ConstantIndex`'s `offset` / `min_length` are `number`s (rustc_middle syntax.gen.ts); an index constant that does
  not fit stops instead of losing precision.
No other `unported` in the four files.

## `// PORT:` decisions
- **gvn `ValueSet`**: the `HashTable<VnIndex>` hashed with `FxHasher` is a `Map` keyed by `intern_key([value, ty])`
  (the derived `Hash` + `PartialEq`, interned children by identity). `VnIndex` numbering only depends on insertion
  order, never on hash values. `hashes` is pushed as upstream but holds 0 (nothing reads it besides the table's
  rehash). Values made by `insert_unique` (opaque, argument, address, non-deterministic constants) are never keyed,
  so `VnOpaque`'s ICE-ing `eq` / `hash` are skipped (`rustc-skip`); `VnOpaque` is one frozen marker object.
- **gvn arena**: `DroplessArena` allocations are plain arrays / the value itself; `&'a OpTy` is the `OpTy`
  (never mutated after evaluation). `evaluated` holds `{ $: "Some", _0: OpTy | undefined } | undefined`.
- **gvn dominators**: `body.basic_blocks.dominators().clone()` shares the cached object (GVN only edits through
  `as_mut_preserves_cfg`, which keeps the CFG cache; the dominators are never mutated).
- **gvn `&mut`**: `*place = new_place` writes `local` / `projection`; `*operand = ..` / `*rvalue = ..` are
  `replace_in_place`; `*initial_kind = kind` writes the `Cast` rvalue's `_0` through `field_mut`. Every `Place` /
  `mir::Const` written into the MIR is a fresh object (`clone_Place`, `clone_Const`, new `ConstOperand`), so no MIR
  node is shared.
- **gvn `InterpResult<()>`**: `.discard_err()?` of a unit result (`copy_op`, `write_discriminant`,
  `alloc_mark_immutable`, `unsize_into`, `intern_const_alloc_for_constprop`) goes through `discard_err_unit`
  (`Option<()>` is `null` / `undefined`): the unit success value is itself `undefined`, so a bare
  `discard_err(..) === undefined` would read every success as a failure (it did, at first: enum aggregates were
  never evaluated).
- **gvn `compute_place_value`** returns `Result<VnIndex, PlaceRef>` as an `Either` (`Left` = `Ok`).
- **gvn `simplify_binary_inner`**: `Either<u128, VnIndex>` is `mir::Either<bigint, VnIndex>`; or-pattern arms with a
  guard (`x & ALL_ONES`, `x | ALL_ONES`) are split per alternative, in alternative order (Rust retries the guard per
  alternative).
- **unreachable_prop**: `FxHashSet<BasicBlock>` is a `Set` (only iterated to clear statements, order irrelevant);
  the `targets.iter().filter(..)` given to `SwitchTargets::new` is a generator, so the `Assume(Ne)` statements are
  added in upstream's order.
- **dead_store_elimination**: `*arg = Operand::Move(place)` stores a new operand into the call arg's `.node`.
- **simplify_comparison_integral**: `to_switch_on` (`Place: Copy`) is cloned at each use; the `find_map` closure is a
  loop where `None` (incl. `?`) moves to the previous statement, as upstream.

## Oracle verification (`-Zdump-mir`, scratch, not committed)
Driver: `$RUST_TS_DATA/scratch/mt-opt2-a/` (`cwrap.ts`, `cmp.sh`, `batch.sh`, `l2.sh`, `first.py`; inputs
`u1.rs u2.rs d1.rs s1.rs g2.rs g3.rs` new, `c2 c3 c5 c6 c7.rs` from fix-ubchecks-alias, `uimir.list`). It is
fix-ubchecks-alias's driver repointed at this worktree, with:
- the real ForceInline / Inline (mt-inline is merged; `CWRAP_NOOP_INLINE=1` brings the old stand-in back);
- **stand-ins for the other mt-opt2 lanes' passes**: their real upstream `policy` (ReferencePropagation, SROA,
  SsaRangePropagation, MatchBranchSimplification, JumpThreading, EarlyOtherwiseBranch, DestinationPropagation at
  level >= 2, DataflowConstProp >= 3, TailCopyToMove with `-Zmir-move-elimination`), and a `run_pass` that throws.
  Level-2 runs (`l2.sh`) pass `-Zmir-enable-passes=-<each of those 7>` to **both** rustc and rust-ts, so the
  comparison is exact (the oracle skips the same passes);
- `first.sh` is now a one-process Python (`first.py`) with the same output (the shell loop took ~15 min per input on
  the loaded machine).
- All runs `--target x86_64-unknown-linux-gnu`; "equal" = byte-identical after allocN normalisation.

Results (dumps compared / equal; "bodies" = `optimized_mir` / `mir_for_ctfe` / `instance_mir` finals that completed):

| input | `-Zmir-opt-level=2` (l2.sh) | default level |
|---|---|---|
| u1.rs (UnreachableProp + GVN + SCI mix) | 3229 / 3229, 36 bodies | 2919 / 2919 |
| u2.rs (real `Unreachable` terminators via `intrinsics::unreachable`, `match e {}`) | 1352 / 1352, 13 bodies | 1222 / 1222 |
| d1.rs (DSE: copy-to-move call args, packed, dead stores) | 2502 / 2502, 30 bodies | 2262 / 2262 |
| s1.rs (SCI: Eq/Ne on ints/chars, reversed operands, floats, fields) | 1872 / 1872, 18 bodies | 1692 / 1692 |
| g2.rs (GVN: consts, statics, transmutes, casts, unsize, raw ptrs, unions, ALL_ONES, ...) | 6529 / 6529, 76 bodies | 5919 / 5919 |
| g3.rs (GVN: generics, const generics, closures, a coroutine, drops, promoteds, UB checks) | 4727 / 4727, 52 bodies | 4297 / 4297 |
| c2.rs | 2433 / 2433, 27 bodies | 2203 / 2203 |
| c3.rs | 3065 / 3065, 32 bodies | 2775 / 2775 |
| c5.rs | 1250 / 1250, 14 bodies | 1130 / 1130 |
| c6.rs | 1051 / 1051, 11 bodies | 951 / 951 |
| c7.rs | 3710 / 3710, 49 bodies (+ `ast`: known `QueryKey for (ValidityRequirement, ..)` stop, as at the base) | 3360 / 3360 (same stop) |
| tests/ui/mir batch (`uimir.list`, 53 files) | 153009 / 153009 over 52 files, 1820 bodies; `issue-75419-validation-impl-trait` hits the known RPIT ICE before any pass | (not re-run: fix-ubchecks-alias's run covers it; at level 1 these passes only answer `policy`) |

- Each pass really changes bodies at level 2 (oracle before/after dumps differ beyond the header): GVN 49 of 61 bodies
  in g2.rs; UnreachablePropagation 12 bodies in u2.rs; DeadStoreElimination 10 runs (9 bodies) in d1.rs; SimplifyComparisonIntegral
  13 in s1.rs.
- At the default level none of the four runs (all are `>= 2`); the runs show no body stops at their `policy` any
  more.
- Isolation runs while porting: UnreachablePropagation alone (the other three disabled too), then + DSE, then + SCI,
  were all equal before GVN was enabled.

## Sample difftests (`RUST_TS_AGENT=root-f5de`, after the gate finished)
| suite | this branch | base run | lost MATCH |
|---|---|---|---|
| tydump-minicore | 46/46 MATCH | 45 | none |
| mirdump-minicore | 46/46 MATCH | 45 | none |
| tydump-ui `--sample 300` | 295 MATCH, 3 UNPORTED, 2 UNSTABLE | 261 | none |
| mirdump-ui `--sample 300` | 300 MATCH | 269 | none |
| borrowck-ui `--sample 300` | 286 MATCH, 14 UNPORTED | 0 (older tree) | none |
No DIFF / CRASH / TIMEOUT. The non-MATCH cases were all non-MATCH in the base runs too; the only stop that moved
because of this lane is `tests/ui/borrowck/async-reference-generality.rs`, which now stops at
`rustc_mir_transform::ref_prop::ReferencePropagation (pass not ported)` (mt-opt2-b's pass) instead of earlier.
Runs: `$RUST_TS_DATA/runs/mt-opt2-a-{tydump-minicore,mirdump-minicore,tydump-ui,mirdump-ui,borrowck-ui}`.

## For root / other lanes
1. **mt-opt2 (match_branches)**: `remove_successors_from_switch` is exported from `unreachable_prop.ts`.
2. **root**: once mt-opt2-b/c/d land, re-run `$RUST_TS_DATA/scratch/mt-opt2-a/l2.sh` with their passes enabled
   (drop the `-Zmir-enable-passes=-..` list and the stand-in block in `cwrap.ts`) for a full level-2 comparison.
3. The scratch driver's RPIT inputs still ICE at `find_opaque_ty_constraints_for_rpit`
   (`assert(!tcx.next_trait_solver_globally())`, before any pass), as at fix-ubchecks-alias; g3.rs avoids them.

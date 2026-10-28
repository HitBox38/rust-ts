# Handoff: mt-opt2-b (wave 27): value analysis, const propagation, SSA range propagation, deduced parameter attributes

Branch `lane/mt-opt2-b` (base `fbb8fa9a` on integ-w25, no merges). Commits: `589f37cd` the two pass policies (first, as
asked), `59ad08b9` value_analysis.rs, `72ba53fc` the three transform modules + the metadata decoder, then this handoff.

## Files touched
- `src/rustc_mir_dataflow/value_analysis.ts`: every stub filled (60 fns). Shapes kept from dataflow-contract's
  declarations, with two bound changes (header, PORT): `V: Clone` is `CloneV<V>` (`clone` only) and `V: JoinSemiLattice`
  is `ValueJoinSemiLattice<V>` (`join(self: MutRef<V>, other)`, the shape lattice.ts's `JoinSemiLattice_FlatSet` already
  has; the declared `JoinSemiLattice<V>` could not take `FlatSet`). The unused `_value_analysis_decls` export is gone;
  `TrackElem_eq` is new. `dataflow_contract.test.ts`: value_analysis.rs moved to `PORTED`, markers 288 -> 348, stubs
  90 -> 30. `lib.ts` header comment updated.
- `src/rustc_mir_transform/ssa_range_prop.ts`, `dataflow_const_prop.ts`, `deduce_param_attrs.ts`: full ports replacing
  the stubs (names kept). The `deduced_param_attrs` query was already wired in lib.ts.
- `src/rustc_mir_transform/pass_manager.test.ts`: stub-module count 16 -> 13.
- Metadata (`DeducedParamAttrs`), done the way meta-mir did it:
  - `tools/codegen/types.sets.json` (**please review**): the `rustc_middle` derive-only set gains
    `compiler/rustc_middle/src/middle/deduced_param_attrs.rs`, `decodable_types` `UsageSummary` /
    `DeducedParamAttrs`, `decodable_construct` `UsageSummary` = `$0 as UsageSummary`, and a hand note.
  - regenerated `src/rustc_middle/decodable.gen.ts` (+13 lines: `decode_UsageSummary`, `decode_DeducedParamAttrs`;
    nothing else changed; `stable_hash.gen.ts` regenerates identically).
  - `src/rustc_metadata/rmeta/decoder/cstore_impl.ts`: the `deduced_param_attrs` extern provider decodes with
    `decode_DeducedParamAttrs` (was `decode_unported("DeducedParamAttrs")`).
  - new `src/rustc_metadata/rmeta/deduced_param_attrs.oracle.test.ts`: the oracle builds an aux crate with `-O
    --emit=metadata,link`; the port decodes its table (`read` [4,0], `write` [4,4,0], `escape` [4], `direct` []: the
    values deduce_param_attrs.rs gives on the oracle's `-Zunpretty=mir -O` bodies, quoted in the test); and every entry
    of core (24855) and alloc (3018) decodes to valid flags with no trailing default.
- `src/rustc_ty_utils/abi.oracle.test.ts`: `debug_opt` re-pinned (below).

## Coverage
value_analysis.rs 60/60, dataflow_const_prop.rs 35/35, ssa_range_prop.rs 11/11, deduce_param_attrs.rs 6/6,
cstore_impl.rs 37/37. `bun scripts/coverage.ts --check`: markers ok (22460; vendor 4351). `bunx tsc --noEmit -p .`: clean.

## Policies (`is_enabled` / `is_required`)
`DataflowConstProp`: `optional(mir_opt_level >= 3)`. `SsaRangePropagation`: `optional(mir_opt_level >= 2)`.
`deduce_param_attrs` is a query, not a pass. Neither pass runs at the default level; at `-O` (level 2) SsaRangePropagation
runs, DataflowConstProp does not.

## Oracle verification (scratch `$RUST_TS_DATA/scratch/mt-opt2-b/`, not committed)
fix-ubchecks-alias's driver (`cwrap.ts`, `cmp.sh`, `batch.sh`) repointed here, real inliner (`CWRAP_NOOP_INLINE=0`), all
runs `--target x86_64-unknown-linux-gnu`; "equal" = byte-identical after the allocN normalisation (`ncmp.py`, a faster
`first.sh`). The other lanes' level-2 passes are stubs, so at level 2 they are **disabled on both sides** with
`-Zmir-enable-passes=-UnreachablePropagation,-ReferencePropagation,-ScalarReplacementOfAggregates,-DeadStoreElimination-initial,-DeadStoreElimination-final,-GVN,-MatchBranchSimplification,-JumpThreading,-EarlyOtherwiseBranch,-SimplifyComparisonIntegral,-DestinationPropagation,-TailCopyToMove`
(`oth.txt`; the driver gives those stubs their real `optional(level >= 2)` policy so the flag decides).

| input | flags | dumps compared | equal |
|---|---|---|---|
| r1.rs (new, SsaRangePropagation cases) | level 2 + OTH | 865 | 865 |
| c2 / c3 / c5 / c6 / c7.rs | level 2 + OTH | 2249 / 2833 / 1154 / 971 / 3430 | all (SsaRangePropagation runs on every body) |
| d1.rs (new, 22 DCP cases) | level 2 + OTH + `+DataflowConstProp` | 2208 | 2208 (DCP changed 17 of 22 bodies) |
| d2.rs (new, 21 DCP cases: deref of statics, `Index` patching, unsize len, `Indirect` pair consts, enums, unions) | same | 2115 | 2115 (10 bodies changed) |
| tests/ui/const_prop + dataflow_const_prop (23 single-file tests) | same | 3798 | 3798; 2 files compare nothing: `ice-type-mismatch-when-copying-112824` (an error test; the driver exits 101 after the errors) and `recursive-async` (the known RPIT driver ICE `!tcx.next_trait_solver_globally()`, mt-opt1's handoff) |
| tests/ui/mir batch (`uimir.list`, 53 files) | same | 148371 | 148371; 1820 bodies ran every pass; `issue-75419-validation-impl-trait` compares nothing (the known RPIT driver ICE) |
| tests/ui/abi/debug.rs `-O` (`dwrap.ts`: dead_run.ts with the same stand-ins) | `-O` + OTH | stderr | identical to the oracle's; and the oracle's `-O` + OTH stderr equals its plain `-O` stderr, so `debug_opt` will equal the oracle once the other mt-opt2 passes land. With `-O`, one `ArgAbi` of `test_unsized` changes (`CapturesReadOnly \| NoAlias \| NonNull \| ReadOnly \| NoUndef \| NoFree`, pointee 2 bytes): deduced attributes in action |

SsaRangePropagation changed bodies in r1 (`a3`, `a4`: switch targets get the constant); DCP produced `Val(Indirect)`
constants (`const (3_u16, false)`) through `intern_with_temp_alloc` / `try_write_constant`.

## Tests
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform src/rustc_mir_dataflow`: 114 pass, 0 fail (includes
  alias_check.test.ts, pass_manager.test.ts, dataflow_contract.test.ts).
- `bun test tools/codegen src/rustc_metadata`: 150 pass, 0 fail. `src/rustc_ty_utils/abi.oracle.test.ts`: 9/9.
- Full unit suite `RUST_TS_REQUIRE_PROBES=1 bun test src` (once, after the gate): 6224 pass, 1 skip, 1 fail of 6226. The
  failure is the known 5 s load timeout of `vendor/odht` ("build: insert results ..."); alone it passes (140/140).

## Samples (`RUST_TS_AGENT=root-f5de`, after root's gate finished; branch at `72ba53fc`)
| suite | run | M / D / U / UNSTABLE | vs brief base run | vs fix-ubchecks-alias run (base tree) |
|---|---|---|---|---|
| tydump-minicore | `20261028-131851-root-f5de-pt4j` | 46 / 0 / 0 / 0 | `wos5`: 1 UNPORTED->MATCH | `nvmf`: identical |
| mirdump-minicore | `20261028-131923-root-f5de-f341` | 46 / 0 / 0 / 0 | `p8q4`: 1 UNPORTED->MATCH | `d82j`: identical |
| mir-minicore | `20261028-131954-root-f5de-5n1y` | 40 / 0 / 6 / 0 | — | `200v`: identical |
| tydump-ui `--sample 300` | `20261028-132028-root-f5de-h6dp` | 295 / 0 / 3 / 2 | `zjq3`: 34 UNPORTED->MATCH | `0vhl`: identical |
| mirdump-ui `--sample 300` | `20261028-132340-root-f5de-fk0o` | 300 / 0 / 0 / 0 | `mzgb`: 31 UNPORTED->MATCH | `kd24`: identical |
| borrowck-ui `--sample 300` | `20261028-132707-root-f5de-q0f1` | 286 / 0 / 14 / 0 | `86qn`: 286 UNPORTED->MATCH | `sn2o`: identical |

No MATCH was lost, and there is no DIFF, CRASH or TIMEOUT. Every case that is not MATCH has the same status as in
fix-ubchecks-alias's runs, which were made on this lane's base tree, so no separate clean-base re-run was needed. Stops left:
mir-minicore `UnreachablePropagation` ×4 + `Ty: StableHash` ×2; borrowck-ui polonius ×12, `UnreachablePropagation` ×1,
`NonGenericOpaqueTypeParam` ×1; tydump-ui `hash_result` ×2, `IntoDiagArg` ×1.

## Pins moved
- `abi.oracle.test.ts` `debug_opt`: `rustc_mir_transform::deduce_param_attrs::deduced_param_attrs` ->
  `rustc_mir_transform::unreachable_prop::UnreachablePropagation (pass not ported)`. `deduced_param_attrs` now runs
  `optimized_mir` at level 2, which stops at the first level-2 stub of another mt-opt2 lane. Turn it into an oracle
  comparison (drop `pending`) once mt-opt2-a/c/d are merged (see the table: the output is expected to be equal).

## New runtime stops / `unported(...)` left
- `-O` builds that reach `fn_abi_of_instance` on a Rust-ABI fn with an indirect parameter now stop at the first
  level-2 stub pass (`UnreachablePropagation`, then the others), not at `deduced_param_attrs`.
- `dataflow_const_prop.ts`: `unported("rustc_mir_dataflow::value_analysis::State: derived Debug ...")` twice: the
  derived `Debug` of `State` (prints an `FxHashMap`, unstable order) is reached only by graphviz's `fmt` fallback and by
  the `assert_matches!` failure message in `initialize_start_block` (never fails: `bottom_value` is `Unreachable`).

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (mt-opt2-b) value_analysis.ts: `State` values `V` are `Copy` lattices held as immutable values: `V: Clone` is
   `CloneV<V>` (`clone` only) and `V: JoinSemiLattice` is `ValueJoinSemiLattice<V>` (`join(self: MutRef<V>, other)`,
   lattice.ts's `JoinSemiLattice_FlatSet` shape); `StateData::join`'s occupied entry is a `MutRef` view onto the map slot.
2. (mt-opt2-b) `FxHashMap<Place, ..>` keys (ssa_range_prop `ranges`, dataflow_const_prop `Patch::before_effect`) use
   the local plus the interned projection list (its identity / `id`); `FxIndexSet<(PlaceIndex, PlaceIndex)>` is an
   array plus a key set.
3. (mt-opt2-b) dataflow_const_prop.ts: `PlaceElem::ConstantIndex`'s `u64` fields are numbers; `to_target_usize`'s
   `bigint` and `checked_add(1)` (None at `u64::MAX`) are computed in `bigint`, then converted.
4. (mt-opt2-b) `DeducedParamAttrs` / `UsageSummary` decoders are generated by the tools/codegen `rustc_middle` set
   (`UsageSummary` built as `$0 as UsageSummary`).

## For root / other lanes
- **tools/codegen/types.sets.json** changed (review): see Files.
- **mt-opt2-a (jump_threading)**: value_analysis.ts is fully ported now (its header still described it as mt-opt2-a's
  stubs; the file is filled with the declared shapes, plus the `V` bound change above, which jump_threading does not use:
  it uses `Map` / `PlaceIndex` / `TrackElem` / `ValueIndex` only).
- After the mt-opt2 lanes merge: un-pin `debug_opt`; the scratch stand-ins (`cwrap.ts` / `dwrap.ts` / `oth.txt`) can then
  run level 2 without `-Zmir-enable-passes`.

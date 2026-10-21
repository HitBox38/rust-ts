# Handoff: dataflow-contract (M4 wave 21, contract-first): the rustc_mir_dataflow contract (plan-m4 D5)

Branch `lane/dataflow-contract` (from `970d2365`, no merges). Commits: framework + declarations + stand-ins + tests → this
handoff. All files are new and under `src/rustc_mir_dataflow/` (no file outside the crate was edited).

## Result
- **The framework is ported in full** (91 fns + framework/tests.rs 16): framework/mod.rs 26/26, cursor.rs 16/16,
  direction.rs 12/12, fmt.rs 16/16, lattice.rs 13/13, results.rs 1/1, visitor.rs 6/6, tests.rs 16/16, lib.rs 1/1.
- **The rest of the crate is declared**: every other upstream fn is a stub `// stub-df: <path>:<line> <name> (lane <lane>)`
  directly over a declaration with its final signature whose body is `return unported("rustc_mir_dataflow::<module>::..")`
  (the layout-contract form), and the types of each file are declared with their final shape (fields in declaration
  order, enums, `newtype_index!` companions, trait interfaces / impl tables). 269 stubs, 2 trait declarations ported as
  markers (`HasMoveData::move_data`, `RustcPeekAt::peek_at`). Coverage: rustc_mir_dataflow **109/378** (was 0); TOTAL
  16874/25518 (was 16765).
- `framework/graphviz.rs` (`-Zdump-mir-dataflow`) is **declared** (30 stubs, lane dataflow-graphviz, wave 26): it needs
  rustc_graphviz (not ported), `MirDumper` and `traversal::reachable_as_bitset`. `iterate_to_fixpoint` reaches
  `write_graphviz_results` only under `-Zdump-mir-dataflow` (checked by the contract test).
- `diagnostics.rs` has no fns (`#[derive(Diagnostic)]` structs of rustc_peek): codegen, with lane dataflow-impls.

## Representation decisions (please record)
1. **`Analysis` (D5)** is `interface Analysis<D, S = never>` (`D` = `Self::Domain`, `S` = `Self::SwitchIntData`). The
   associated types are readonly members holding descriptors (layout-contract precedent): `Domain: Domain<D>` and
   `Direction: Direction`; `const NAME` is `NAME`. `Domain<D>` = `Clone<D>` (`clone`, `clone_from` into `self`) +
   `JoinSemiLattice<D>` (`eq`, `join`) + `DebugWithContext<D, unknown>` (`eq`, `fmt`, `fmt_with`, `fmt_diff_with`): the
   `Clone + JoinSemiLattice` bound plus the `Eq` / `DebugWithContext<Self>` bounds `iterate_to_fixpoint` and graphviz use.
   Built with `Domain_of(clone, lattice, debug)` or `Domain_DenseBitSet(elem)`, `Domain_MixedBitSet(elem)`,
   `Domain_MaybeReachable(inner)` (framework/mod.ts, end).
2. **Provided methods** live in `Analysis_provided` (PORTING §8, markers there); `abstract class AnalysisBase<D, S>`
   forwards them and defaults `Direction` to `Forward` (`type Direction = Forward`). Analyses `extend AnalysisBase` and
   `override` what upstream overrides. Same for `ResultsVisitor` (`ResultsVisitor_provided`, `ResultsVisitorBase`),
   `GenKill` (`GenKill_provided`), `DebugWithContext` (`DebugWithContext_provided`, `DebugWithContext_impl(eq, fmt,
   overrides)`).
3. **`Direction`** is an interface; `Forward` / `Backward` are objects (`IS_FORWARD`, `IS_BACKWARD`, `first_index`,
   `next_index`, `apply_effects_in_block`, `visit_results_in_block`). `A::Direction::X` is `analysis.Direction.X`.
4. **Domain values are mutable objects changed in place** (`&mut Self::Domain` is the object): `state.clone_from(x)` is
   `analysis.Domain.clone_from(state, x)`, `state.join(x)` is `analysis.Domain.join(state, x)`. `*state = v` writes
   through: `MaybeReachable` is a `$`-union whose `Unreachable` is a **fresh** object (`MaybeReachable.Unreachable()`, not a
   frozen singleton) and `*state = v` is `MaybeReachable.assign(state, v)` (value_analysis's `State<V>`: `State.assign_`).
   `FlatSet<T>` is `Copy` and immutable (`FlatSet.Bottom` / `Top` frozen): its `join` takes a `MutRef<FlatSet<T>>` slot.
5. **Other traits are impl tables** (PORTING §5): `BitSetExt<S, T>`, `GenKill<S, T>` (`GenKill_DenseBitSet<T>()`,
   `GenKill_MixedBitSet<T>()`, `GenKill_MaybeReachable(S_)`), `JoinSemiLattice_*`, `Clone_*`, `DebugWithContext_*` (impls
   for generic types are functions of the element impl, e.g. `DebugWithContext_DenseBitSet(DebugWithContext_Local)`;
   `DebugWithContext_MovePathIndex` needs a `HasMoveData` context). Trait-bound params of generic fns go last (`T_`).
6. `ResultsCursor<D, A>`: field `body` is `body_` (method `body()` collides); `SimpleCow` kept (`SimpleCow.deref`);
   `#[cfg(debug_assertions)]` `reachable_blocks` is not compiled in. `Results<D, A>` is a class (`analysis`,
   `entry_states: D[]`). `BasicBlockRank` (`newtype_index!` inside `iterate_to_fixpoint`) is hoisted to module level.
7. `Effect` is `"Early" | "Primary"` with `Effect_discriminant` / `Effect_cmp` (derived `Ord`), `EffectIndex` an
   interface + `EffectIndex_eq`; `SwitchTargetIndex` a `$`-union.
8. Stub files (fork-written, same conventions): fields colliding with methods get `_` (`move_data_`, `next_` of
   `MovePathLinearIter`, `exclude_inactive_in_otherwise_`, ...); nested / fn-local items are module-level until their fill
   lane moves them (`on_all_children_bits_inner`, `KillableLocalsVisitor`, `excluded_locals_Collector`); composite hash keys
   are strings (`MoveSubPath_key`, `TrackElem_key`); `LocationMap::index_mut` returns a `MutRef<T>`; `SplitPointIndex`'s
   inherent `new(point, effect)` shadows `Idx::new` (kept as `new_`); pretty.rs's `Annotator` (one `ResultsVisitor` impl
   per analysis) is two classes; the MIR visitors are plain classes until mir-contract's `Visitor` (D4) exists. The
   upstream struct `Map` shadows JS `Map` in value_analysis.ts (`globalThis.Map` there).

## For root (merge)
1. **Delete `src/rustc_mir_dataflow/pending.ts` and repoint its importers** (every file of the crate). It holds:
   - *pending mir-contract*: `BasicBlock` (+ `start_location`, `START_BLOCK`), `Local` (`_{}`, `RETURN_PLACE`), `Location`
     (+ `debug_Location`, `Location_cmp` = derived `Ord`), `Body` (`basic_blocks`, `index(bb)` = `body[bb]`,
     `terminator_loc`), `BasicBlocks` (`len`, `predecessors`, `reverse_postorder`), `BasicBlockData` (`statements`,
     `terminator()`), `Terminator` (`edges()`), `TerminatorEdges`, `CallReturnPlaces`, `SwitchTargets` (`iter`,
     `otherwise`, `all_targets`), and opaque `Statement`, `StatementKind`, `Operand`, `Place`, `PlaceRef`, `PlaceElem`,
     `ProjectionKind`, `Rvalue`, `InlineAsmOperand`, `SourceInfo`, `LocalDecl`, `VarDebugInfo`, `BorrowKind`,
     `TerminatorKind`. Method-call style is the class style of D3; if mir-contract puts `terminator()` / `edges()` /
     `SwitchTargets` methods on companions, the call sites are framework/{mod, direction, cursor, visitor}.ts.
   - *pending index-ds*: `DenseBitSet` `clear`, `first_set_at_or_after`, `union`, `subtract`, `clone`, `clone_from`
     (module augmentation + shims over the public API, installed only when missing), `DenseBitSet_eq` (derived
     `PartialEq`), `debug_DenseBitSet`, `MixedBitSet` (upstream enum, methods on the companion, `Large` arm stops
     `unported("rustc_index::bit_set::ChunkedBitSet (pending index-ds)")`), `ChunkedBitSet` (all `unported`). The framework
     never touches words. If index-ds models `MixedBitSet` differently, the call sites are framework/{mod, lattice, fmt}.ts.
2. **Locally declared pending types** (repoint too): `PlaceContext` (debuginfo, impls/{liveness, precise_liveness,
   storage_liveness}, value_analysis; mir-contract visit.rs), `ProjectionElem<V, T>` (value_analysis; mir-contract),
   `GrowableBitSet<T>` (value_analysis) and `SparseIntervalMatrix<R, C>` (impls/precise_liveness; index-ds), `PassWhere` +
   the `io::Write` sink (pretty.ts; mir-pretty), `Range { start, end }` (value_analysis, local).
3. `rustc_mir_dataflow::provide` (lib.ts) is not wired: rustc_interface passes.ts `default_query_providers` (comment at
   :956) should call it when the MIR pretty-printer lands. Its hook assignment casts `pretty.mir_pretty_extra_data` because
   rustc_middle hooks.ts types the hook's `body` as `unknown`.
4. **Stub tag `// stub-df:`** (not layout-contract's `// stub:`): `src/rustc_ty_utils/layout_contract.test.ts` scans every
   `// stub:` comment under `src/` and asserts there are none outside its own files (`stubs only for the scope files`,
   `stubs.length === 0`), so the plain tag fails that test. Proposed one-line fix there (not my file): filter `stubs` to
   its `FILES` before the two assertions; then `sed 's|// stub-df: |// stub: |'` over src/rustc_mir_dataflow and the
   regex in `dataflow_contract.test.ts` can go back to the shared form.
5. Record decisions 1–8 and the stub form above.

## Split table (fill lanes; upstream lines)
| # | lane | upstream | lines | stubs | notes |
|---|---|---|---|---|---|
| 1 | dataflow-move-paths (wave 22) | move_paths/mod.rs, move_paths/builder.rs, drop_flag_effects.rs, un_derefer.rs, points.rs, debuginfo.rs | 1544 | 22 + 15 + 10 + 7 + 7 + 2 = 63 | `MoveData::gather_moves` / `MovePathLookup::find` / `on_all_children_bits` are what borrowck and the `Maybe*Places` analyses call first |
| 2 | dataflow-impls (wave 22) | impls/{borrowed_locals, initialized, liveness, precise_liveness, storage_liveness}.rs, rustc_peek.rs, pretty.rs, diagnostics.rs (codegen) | 2419 + 159 | 7 + 36 + 18 + 22 + 19 + 7 + 7 = 116 | `MaybeStorageLive` (check_consts, coroutines), `MaybeLiveLocals` (liveness, `mir_pretty_extra_data`), `Maybe(Un)InitializedPlaces` / `EverInitializedPlaces` (borrowck, drop elaboration) |
| 3 | dataflow-graphviz (wave 26) | framework/graphviz.rs | 716 | 30 | needs rustc_graphviz |
| 4 | mt-opt2-a (wave 26) | value_analysis.rs | 1109 | 60 | `dataflow_const_prop`, `jump_threading` only |
| — | (done here) | lib.rs, framework/{mod, cursor, direction, fmt, lattice, results, visitor, tests}.rs | | | |

## How to fill a stub
1. `grep -rn "// stub-df: compiler/rustc_mir_dataflow/src/<file>:<line> <name>" src` (also `bun scripts/coverage.ts --missing
   <path>`). Keep the signature; a wrong one goes in your handoff.
2. Replace the body with the upstream logic in place and turn the comment into `// rustc: <path>:<line> <name>` (drop
   `(lane ..)`). Nested items declared at module level move inside their parent. Then lower the stub count in
   `src/rustc_mir_dataflow/dataflow_contract.test.ts` (269) and raise the marker count (109); the fn total (378) only
   changes with the pin.
3. Each file's header lists its representation notes; analyses follow `framework/mod.ts`'s header (Domain descriptor,
   `AnalysisBase`, in-place domains, impl tables). `framework/toy.test.ts` shows complete small analyses.

## `unported(...)` left
- The 269 stubs above (each names its own module and lane).
- In pending.ts: `ChunkedBitSet` (all methods) and the `Large` arm of `MixedBitSet` (pending index-ds).
- In ported code: none. (`write_graphviz_results` is a stub; `iterate_to_fixpoint` reaches it only under
  `-Zdump-mir-dataflow`.)

## `// PORT:` decisions in ported code
- framework/mod.ts header (decisions 1, 2, 4, 5), `BasicBlockRank` hoisted, the D5 descriptor section.
- framework/lattice.ts header (decision 4: fresh `Unreachable`, `MaybeReachable.assign`, `FlatSet` slot).
- framework/fmt.ts header (`fmt::Result` is the written string); `DebugWithContext_MixedBitSet`'s `Large` arm uses
  pending `ChunkedBitSet` Debug / `PartialEq` (panic until index-ds).
- framework/direction.ts: `Backward::next_index`'s `statement_index - 1` (usize subtraction, debug-only overflow panic).
- framework/cursor.ts header (decision 6).
- framework/tests.test.ts: `mock_body` / `new_cfg_only` over the pending stand-ins.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (17393; vendor 3888).
- New tests (19, all pass): `framework/tests.test.ts` (the upstream `forward_cursor` / `backward_cursor`, every seek from
  every target; a mutation of the backward ordering in `seek_after` makes `backward_cursor` fail), `framework/toy.test.ts`
  (forward reaching definitions on a loop with cursor seeks, custom effect reset and `visit_results`; `SwitchInt` edge
  effects; `Call` edges with cleanup before the return effect; backward liveness with an unreachable predecessor, reverse
  seeks, the call-return edge effect and the backward `initialize_start_block` ICE; `MaybeReachable` domains; fmt.rs
  `fmt_with` / `fmt_diff_with` plain and alternate; `FlatSet` join), `dataflow_contract.test.ts` (scan = coverage: 378 fns
  = 109 markers + 269 stubs, no stub in the ported files, stubs stop in their module with a known lane; crate root loads;
  representative stubs stop UNPORTED; `-Zdump-mir-dataflow` reaches the graphviz stub; pending bit-set stand-ins).
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 5416 tests, 5415 pass, 1 skip, **0 fail** (after the
  `stub-df` rename; with the plain `// stub:` tag `layout_contract.test.ts` failed, see "For root" 4).
- Samples (lane vs base; base = this worktree at `970d2365` before any change, same `RUST_TS_AGENT`, so the same sample):

| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-192055-dataflow-contract-lnay` | 45 / 0 / 1 / 0 | `20261021-171510-dataflow-contract-r1t1` | 45 / 0 / 1 / 0 |
| hir-tree `--sample 300` | `20261021-192110-dataflow-contract-928c` | 299 / 0 / 1 / 0 | `20261021-171525-dataflow-contract-t2gk` | 299 / 0 / 1 / 0 |

  Same UNPORTED cases and stops (`mini_core_hello_world.rs`: `const_eval_poly`; `format-captured-standard-macros.rs`:
  `get_diagnostic_name`). The crate is not reached by the driver yet (`provide` unwired), as expected for a contract lane.

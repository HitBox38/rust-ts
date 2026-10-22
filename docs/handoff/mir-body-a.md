# Handoff: mir-body-a (M4 wave 21, MIR fill lane 1 of 6)

Branch `lane/mir-body-a` (from `aae2f3fc` = integ-w19 with mir-contract, index-ds and the late lints; no merges).
Commits: port of the 103 stubs → tests → this handoff (+ recorded decisions).

## Files touched
- `src/rustc_middle/mir/mod.ts`: every stub of mod.rs ported (78): `MirPhase::name/index`, `MirSource::item/from_shim/def_id`,
  `CoroutineInfo::initial`, `Body::new/new_cfg_only` and every `Body` method (`typing_env`, `local_kind`, the local iterators,
  `source_info`, `return_ty`, `stmt_at`, the coroutine accessors, `should_skip`, `try_const_mono_switchint`,
  `caller_location_span`, required consts / mentioned items, `Index` / `IndexMut`), `ClearCrossCrate::{as_ref, as_mut,
  unwrap_crate_local}` + its `Decodable`, `SourceInfo::outermost`, `Local::arg`, `Atom for Local`, every `LocalDecl` fn,
  `VarDebugInfoContents` Debug, `BasicBlock::start_location`, every `BasicBlockData` fn, `SourceScope::{lint_root,
  inlined_instance}`, `UserTypeProjections::projections`, `Location` / `DefLocation` fns, `find_self_call`. Imports
  reworked (value imports for the companions it calls; ty-level modules and rustc_metadata read lazily, init order R2).
- `src/rustc_middle/mir/traversal.ts`: all 19 (`Preorder`, `Postorder` (the `reverse_postorder` cache of basic_blocks.ts now
  works), `MonoReachable`, `preorder` / `postorder` / `reverse_postorder` / `reachable` / `reachable_as_bitset` /
  `mono_reachable*`).
- `src/rustc_middle/mir/query.ts`: `impl Debug for CoroutineLayout` (`CoroutineArgs::variant_name` read lazily from ty/sty.ts).
- `src/rustc_middle/mir/coverage.ts`: `CovTerm` / `CoverageKind` Debug, `is_removed_after_analysis`, `Op::is_add/is_subtract`.
- `src/rustc_middle/mir/contract.test.ts`: lane count `mir-body-a: 103` removed (0 left), and the three `stops(..)` lines
  that used this lane's stubs (`Body::new_cfg_only`, `LocalDecl::new`, `Local::arg`) removed (they are ported; they are
  exercised in body_a.test.ts). No other assertion changed.
- `src/rustc_middle/mir/body_a.test.ts` (new, 13 tests).

## Coverage
`bun scripts/coverage.ts --missing`: mod.rs 84/84, traversal.rs 19/19, query.rs 1/1, coverage.rs 5/5.
rustc_middle 2414/3369; TOTAL 17585/25518 (base aae2f3fc: rustc_middle 2311, TOTAL 17482; +103). `bun scripts/coverage.ts --check`: markers ok.

## Tests
- No upstream unit tests exist for these files. `body_a.test.ts` builds bodies by hand (`Body::new_cfg_only`) and checks
  preorder / postorder / reverse postorder / mono_reachable orders worked out from upstream's semantics (traversal.rs's
  `traverse_successor` doc example `[E, D, C, B, A]` verbatim; preorder pops the last successor first; postorder walks
  successors with `next_back`; `MonoReachable`'s bit-set worklist yields the lowest index), size hints, the
  `reverse_postorder` cache, `is_predecessor_of` (incl. a self loop), `Location` / `DefLocation::dominates` with the real
  `dominators()` of index-ds, `Body::new` with a real `TyCtxt` (local kinds, arg / var iterators, `drain_vars_and_temps`,
  `is_polymorphic` with a type param, the `arg_count` assertion message), the `LocalDecl` predicates, `SourceScope`
  lookups, `MirPhase` names / indices / derived order (`should_skip`), `ClearCrossCrate` and its decoding,
  `CoroutineLayout` Debug in plain and `{:#?}` (key padding checked against the oracle's `-Zdump-mir` coroutine layout,
  `Unresumed(0)` / `Returned (1)`), coverage Debug impls.
- PORT (test): `TerminatorKind::successors` is a mir-body-b stub at base, so the hand-built terminators carry their successor
  list as an own `successors()` property. After mir-body-b lands they can use real `Goto` / `SwitchInt` terminators.
- Not reachable yet (stubs of other lanes on the path): `retain_statements` / `strip_nops` / `drop_debuginfo`
  (`StmtDebugInfos::prepend/append/drop_debuginfo`, mir-body-b), the `SwitchInt` paths of `try_const_mono_switchint`
  (`StatementKind::as_assign`, `RuntimeChecks::value`, `mir::Const::try_eval_bits`, mir-body-b), `find_self_call`
  (`Place::as_local`, `mir::Const::ty`, mir-body-b), `VarDebugInfoContents` Debug (`display_ConstOperand` / `debug_Place`,
  mir-pretty / mir-body-b), `typing_env` (needs a body's `param_env`). No decoded MIR body is reachable from metadata yet
  (no `decode_Body`, no `optimized_mir` provider), so there is no oracle comparison of a decoded body.
- `bunx tsc --noEmit -p .`: clean. `bun test src/rustc_middle/mir`: contract.test.ts 6 pass, body_a.test.ts 13 pass.
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (run once, at the end): 5569 pass, 1 skip, 2 fail. Both failures
  are base fallout, not this lane's (they fail on `aae2f3fc` too): rustc_lint `types.oracle.test.ts` "PENDING TypeLimits: fn
  pointer `==` suggestion stops at utils::std_or_core" and "PENDING TypeLimits: ambiguous_wide_pointer_comparisons stops at
  utils::std_or_core". lint-late-b pinned these cases as stopping in `utils::std_or_core`; lint-late-e2 then ported utils.rs,
  so they now get the oracle's full output. The fix is to re-pin them as passing cases (root / lint owner); not touched here.

## Samples (lane vs base, both `RUST_TS_AGENT=mir-body-a`, same samples; base = detached worktree `lanes/mir-body-a-base` at `aae2f3fc`, removed after)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-194306-mir-body-a-eou6` | 45 / 0 / 1 / 0 | `20261021-194646-mir-body-a-s1iy` | 45 / 0 / 1 / 0 |
| tydump-ui `--sample 200` | `20261021-194328-mir-body-a-py1v` | typeck+traits 161 / 0 / 26 / 0 (+1 timeout, +1 unstable); rustc_dump 10 / 0 / 3 / 0 | `20261021-194701-mir-body-a-f1qa` | typeck+traits 161 / 0 / 26 / 0 (+1 timeout, +1 unstable); rustc_dump 10 / 0 / 3 / 0 |
| hir-tree `--sample 200` | `20261021-194529-mir-body-a-up4m` | 200 / 0 / 0 / 0 | `20261021-194849-mir-body-a-c0w8` | 200 / 0 / 0 / 0 |
| mirdump-minicore (46) | `20261021-194631-mir-body-a-4xz3` | 10 / 0 / 36 / 0 | `20261021-194951-mir-body-a-9p0o` | 10 / 0 / 36 / 0 |

No new DIFF; compared per case, every case has the same status **and the same stop** on lane and base. (mirdump-minicore
stops before MIR building: `mir_keys` / `check_unsafety` providers, `const_eval_poly`.)

## `unported(...)` left
- `CLEAR_CROSS_CRATE(d)` (mod.ts, `ClearCrossCrate` decoding) for a `TyDecoder` that is not rmeta's
  `MetadataDecodeContext`: `rustc_middle::query::on_disk_cache::CacheDecoder (TyDecoder::CLEAR_CROSS_CRATE)` (incremental, M5).
- None else in these files; their bodies stop in other lanes' stubs where noted above.

## `// PORT:` decisions
1. `ClearCrossCrate`'s `Decodable` reads `D::CLEAR_CROSS_CRATE` as `d instanceof MetadataDecodeContext ?
   MetadataDecodeContext_CLEAR_CROSS_CRATE : unported(..)` (ty/codec.ts's associated-const convention; rustc_metadata is
   required lazily, rustc_middle sits below it). Recorded as a decision.
2. `Location::dominates` / `strictly_dominates` / `DefLocation::dominates` take the real
   `rustc_data_structures::graph::dominators::Dominators` (mod.ts now imports that type instead of basic_blocks.ts's
   `Pending` placeholder). **Follow-up (root / basic_blocks.ts owner):** basic_blocks.ts's `Dominators` placeholder and its
   local `dominators()` stub should switch to index-ds's `dominators(graph)` so that `body.basic_blocks.dominators()` type-checks
   against these signatures. Recorded as a decision.
3. `#[derive(PartialOrd)]` of `MirPhase` (for `should_skip`'s `injection_phase > self.phase`) is a local helper
   `MirPhase_gt` (variant order, then the phase discriminant).
4. `Body::drain_vars_and_temps`: `splice` removes the range at the call (upstream's `Drain` removes it when dropped); the
   iterator walks the removed decls.
5. `BasicBlockData::retain_statements`: `Vec::retain_mut` filters `statements` in place (the array keeps its identity).
6. `try_const_mono_switchint`: `Place == Place` is `local === && projection ===` (interned projection list);
   `check.value(sess) as u128` is `1n` / `0n`.
7. `caller_location_span`: the by-value `mut source_info` is a `clone_SourceInfo` copy (PORTING §8).
8. `write!(fmt, ..)` inside Debug impls (`VarDebugInfoContents`, `CoverageKind`, `CoroutineLayout`'s variant keys / values)
   formats its arguments with fresh (non-alternate) flags: `PLAIN`. `CoverageKind::Point`'s missing `)` is upstream's, kept.
9. Traversal iterators: `postorder(body)` is `reverse_postorder(body)` reversed (array); `Postorder::new` takes
   `readonly BasicBlockData[]` (cast to the generated field type, only read).

## Signatures
All contract signatures kept, except the `Dominators` type of the three `dominates` fns (decision 2).

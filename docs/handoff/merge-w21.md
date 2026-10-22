# Handoff: merge-w21 (fixer on `integ-mir`, wave 21 MIR merge)

Branch `integ-mir` from `382156b7` (integ-w19 `aae2f3fc` + mir-body-a/b, mir-visit, mir-pretty, mir-interp-a/b,
dataflow-contract, vendor-apfloat-b). Commits `1dd41771..` (one per step below) + this handoff.

## Changes
1. **Tests promoted to the real sibling code; test-only stand-ins removed** (`1dd41771`):
   - `mir/pretty.test.ts`: the `fallback` / `mock.module` bridges, the `Test*` subclasses (`TestBody`, `TestAllocation`,
     `TestInitMask`, `TestProvenanceMap`, `TestMirSource`, `TestBlock`, `TestStmtDebugInfos`) and the `blocked` probe are
     gone; the bodies and allocations are real `Body` / `Allocation` / ... The fake gcx gains `data_layout` (the
     handoff's "extend `mk_tcx`").
   - `ty/print/pretty.ts`: three stand-ins now call the ported fns: `Allocation_get_bytes_strip_provenance` →
     `Allocation::get_bytes_strip_provenance` (`Ok` → bytes, `Err` → `undefined`), `AllocRange` → interpret's class (lazy
     require), `BinOp_to_hir_binop` → `mir::BinOp::to_hir_binop` (lazy require). The whole-crate pretty tests needed the
     first (byte-string constants, `&[u8; N]`).
   - `mir/debug.oracle.test.ts`: three `Const::Val` scalar lines of the oracle dump are cases now (`_9 = const 1_i32`,
     `_0 = const 0_i32`, `_12 = const 2_usize`). The `display_Const` test checks `1_i32`; `const ()` now stops at
     `rustc_const_eval::const_eval::try_destructure_mir_constant_for_user_output` (pretty.rs:1986, the aggregate arm:
     rustc_const_eval's hook, not ported), which is upstream's path.
   - `mir/visit.test.ts`: `shim_if_stub` removed; the `VisitPlacesWith` test has no "stub" branch any more.
   - `mir/interpret/allocation.test.ts`: the `interp_b_ported()` gate is removed.
   - `mir/body_a.test.ts`: the own `successors()` property is replaced by real terminators (`return` / `goto` /
     `falseEdge`: successors in the order real, imaginary).
2. **`BasicBlocks::dominators`** uses index-ds's `dominators(graph)` / `Dominators` (`f533fdc8`). `tools/codegen/mir.typemap.json`
   maps `Dominators` and `DenseBitSet` to the real types (Debug + Clone); `rustc_middle_mir` regenerated: only
   basic_blocks.gen.ts (`Cache` Debug) and traversal.gen.ts (`Preorder` Clone: `visited.clone()`) change; the types report
   drops to 3 missing Debug, 0 missing Clone. body_a.test.ts checks the cached dominators.
3. **Query key `PseudoCanonicalInput<GlobalId>`** (`3ec0c20d`): keys.rs:80 `QueryKey for Instance` and :86 `for GlobalId`
   ported (keys.rs 50/63), `KEY_PseudoCanonicalInput_GlobalId`; queries.config.json entry; queries.gen.ts regenerated (only
   the three `eval_to_*` keys change). The stops move one step on: `rustc_const_eval::const_eval::eval_to_const_value_raw_provider`.
   Re-pinned (same UNPORTED status): `rustc_ty_utils/layout.test.ts` `PENDING.layout_discriminants` and
   **`rustc_lint/late_passes_e1.oracle.test.ts`** `default_overrides_default_fields` (one `stop:` line + its comment; the same
   line mir-interp-b already changed on this branch, so no new conflict surface for merge-lints).
4. `aa1453e1`: **`MirPhase_cmp`** (derived `Ord`, syntax.rs:43) lives in syntax.ts next to the `MirPhase` companion; it
   replaces mod.ts's `MirPhase_gt` and pretty.ts's `MirPhase_le`. **mirdump.ts header** rewritten (the seams are wired).
5. `53df1c56`: **`// stub-df:` → `// stub:`** in src/rustc_mir_dataflow (and the regex of dataflow_contract.test.ts).
   `layout_contract.test.ts` needed no change: mir-contract's re-pin already keeps only its own scope files' stubs.
6. `2d1b5acd`: **`src/rustc_mir_dataflow/pending.ts` deleted**. Imports point at `rustc_middle/mir/mod.ts` and
   `rustc_index/bit_set.ts`; the local stand-ins `PlaceContext` (mir/visit.ts), `ProjectionElem` (mir), `GrowableBitSet`
   (bit_set.ts), `SparseIntervalMatrix` (interval.ts), `PassWhere` (mir/pretty.ts), `io::Write` (vendor/anstream `Write`)
   are the real types. Framework adaptations: `Location` values are `new Location(block, i)`, `terminator_()`,
   `basic_blocks.deref().length`, `MixedBitSet_eq`; fmt.rs's `ChunkedBitSet` impl takes `ChunkedBitSet_eq` /
   `debug_ChunkedBitSet` (the `Large` arm no longer panics), `DenseBitSet`'s Debug is `debug_DenseBitSet(v, f, T_.fmt)`.
   `rustc_middle/mir/mod.ts` gains `Location_cmp` (derived `Ord`, mod.rs:1586). Tests: framework/tests.rs's `mock_body`
   is upstream's now (`Statement::new(Nop)`, `BasicBlockData::new_stmts`, `Call { target: START_BLOCK, unwind: Continue,
   Misc }`, `Body::new_cfg_only`); toy.test.ts builds real bodies (payloads in a side table; the `visit_results` order
   follows the real reverse postorder [0, 1, 2, 3]); the contract test's "pending stand-ins" test became a check of a
   `MixedBitSet` domain past `CHUNK_BITS`. The visitor-like stub classes (storage_liveness / liveness / precise_liveness /
   debuginfo) stay plain classes: their fill lane (dataflow-impls) makes them extend `Visitor` (comments updated).
7. `ffa32ab8`: **`rustc_mir_dataflow::provide`** is called in `default_query_providers` (upstream order: after
   rustc_mir_build). `-Zunpretty=mir`'s `mir_pretty_extra_data` hook now stops UNPORTED in the dataflow stub instead of the
   unassigned-hook ICE.

`bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (18848; vendor 4196). Coverage: rustc_middle
2997/3369, rustc_mir_dataflow 109/378, TOTAL 18277/25518.

## Test promotions (old → new)
| test | before (at `382156b7`) | now |
|---|---|---|
| pretty.test.ts whole bodies (3: `write_mir_pretty` ×3 fixtures, `write_mir_fn`, `dump_mir`) | ran (probe found the stubs real), 1 fail (fake gcx had no `data_layout`, then `get_bytes_strip_provenance` stand-in) | pass, unconditional, no stand-ins |
| pretty.test.ts others (11) | pass through fallbacks / bridges / Test* subclasses | pass on real code |
| pretty.test.ts "stand-ins are only fallbacks" | pass | removed (nothing to restore) |
| debug.oracle.test.ts `display_Const` | fail (expected the mir-pretty stub) | pass: `1_i32`; `()` stops in rustc_const_eval |
| debug.oracle.test.ts cases | 52 | 55 (+3 `Const::Val` scalars, in the oracle dump) |
| visit.test.ts (14) | pass with `shim_if_stub` (no-op by then) and a stub branch | pass, shims removed |
| allocation.test.ts scalar describe (2) | gated by `interp_b_ported()` | ungated, pass |
| body_a.test.ts traversals | own `successors()` per terminator | real terminators, pass |
| dataflow tests (tests / toy / contract) | over pending.ts mocks | real MIR / bit sets, pass |
| layout.test.ts `layout_discriminants`, late_passes_e1 `default_overrides_default_fields` | stop at the `PseudoCanonicalInput<GlobalId>` key | stop at `eval_to_const_value_raw_provider` |

Runs: `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_middle src/rustc_mir_dataflow src/rust_ts src/vendor/rustc_apfloat
src/rustc_mir_build --timeout=120000`: before 492 pass / 2 fail; after 493 pass / 0 fail.
Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at `ffa32ab8`): **5763 pass, 1 skip (the existing one),
0 fail**, 395 files, 2164 s. The two `rustc_lint/types.oracle.test.ts` TypeLimits cases (vendor-apfloat-b's conversion of the
stale PENDING `std_or_core` stops) pass here. Log: `$RUST_TS_DATA/tmp/merge-w21/full.log`.

## Samples
Lane `integ-mir` at `ffa32ab8` vs base `aae2f3fc` (temporary detached worktree `lanes/merge-w21-base`, removed); both
`RUST_TS_AGENT=merge-w21`, so the same samples. Compared case by case (status and stop).

| suite | lane run | M / D / U / other | base run | M / D / U / other |
|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-091314-merge-w21-mmn3` | 10 / 0 / 36 | `20261022-091333-merge-w21-3w6i` | 10 / 0 / 36 |
| mirdump-ui `--sample 300` | `20261022-091435-merge-w21-7fxz` | 0 / 0 / 300 | `20261022-091616-merge-w21-2uu9` | 0 / 0 / 300 |
| tydump-minicore (46) | `20261022-091402-merge-w21-c9kb` | 45 / 0 / 1 | `20261022-091348-merge-w21-x8so` | 45 / 0 / 1 |
| tydump-ui `--sample 300` | `20261022-091746-merge-w21-8mrx` | 265 / 0 / 34 / 1 unstable | `20261022-091924-merge-w21-28en` | 265 / 0 / 34 / 1 unstable |
| hir-tree `--sample 300` | `20261022-092124-merge-w21-zzzd` | 300 / 0 / 0 | (not run: lane is 300/300 MATCH) | |
| resdump `--sample 300` | `20261022-092447-merge-w21-g3ft` | 300 / 0 / 0 | (not run: lane is 300/300 MATCH) | |

**No DIFF anywhere.** Every case has the base's status; the only changed stops are the const-eval ones moving one step
on (the new query key): mini_core_hello_world (mirdump/tydump-minicore) and 2 mirdump-ui / 1 tydump-ui cases
`const_eval_poly (M4)` → `rustc_const_eval::const_eval::eval_to_const_value_raw_provider`; 8 mirdump-ui / 9 tydump-ui cases
`const_eval_resolve_for_typeck (M4)` → `rustc_const_eval::const_eval::eval_to_valtree`.
First M4a numbers (mirdump-ui sample): 300 UNPORTED, 0 DIFF; the stops are still before MIR building, in the analysis
prefix: `check_unsafety provider` 276, `mir_borrowck provider` 14, `eval_to_valtree` 8, `eval_to_const_value_raw_provider` 2.
(The machine was at load ~46 on 12 cores and the disk ran full once during the samples (ENOSPC, others' data); the base
hir-tree / resdump runs were skipped for that reason.)

## `unported(...)` / follow-ups left (not done here)
- `mir/interpret/value.ts` still has `Pending` placeholders for `Half` / `Single` / `Double` / `Quad` and the
  `rustc_apfloat::Float::BITS / from_bits (Scalar::to_float ...)` stop: vendor-apfloat-b says they can import
  `vendor/rustc_apfloat/ieee.ts` now (owner: mir-interp follow-up).
- `rustc_mir_build/thir/pattern/const_to_pat.ts`: the `v.to_f32()` casts and the stale "stop as UNPORTED" comment
  (vendor-apfloat-b).
- `QueryKey` for `ShimKind` / `InstanceKind` (keys.rs:68 / :74) still `key_unported` (`instance_mir`, `mir_shims`).
- `ty/codec.ts` `Decodable for Allocation` stand-in and `TyCtxt::mk_const_alloc` (mir-interp-a's note: needs the derived
  decoders of `InitMask` / `SortedMap<Size, _>` from tools).
- hooks.ts types `mir_pretty_extra_data`'s `body` as `unknown` (rustc_mir_dataflow lib.ts casts at the assignment).
- The recorded (mir-visit) decision's last clause (visit.test.ts shims) is obsolete: the shims are gone.

## PORT decisions from the nine handoffs not yet in docs/state/history.jsonl
One per line, ready for `bun scripts/state.ts record decision "<text>"`:

1. (mir-contract) BasicBlocks: `cache: Arc<Cache>` is the `Cache` object shared by `clone_BasicBlocks`; `invalidate_cfg_cache` always installs a fresh `Cache`; the inherent `predecessors()` and `graph::Predecessors::predecessors(node)` share one prototype slot (dispatched on the argument).
2. (mir-contract) MIR trait-impl shapes: Debug `debug_X(v, f[, debug_P])`, Display `display_X(self)`, `From<A> for B` `B_from_A(a)`, Decodable `decode_X(d, decode_T..)`, Hash `hash_X(self, state)`, Index/Deref/Iterator methods `index`/`deref`/`next`; `HasLocalDecls` is the union `LocalDecl[] | Body` + `HasLocalDecls.local_decls(d)`; `Box<(Place, Rvalue)>` is the `[Place, Rvalue]` tuple; handed-out `&mut BasicBlock` / `&mut UnwindAction` are `MutRef`s; `&mut Formatter` written-only params make the fn return the text; `fmt::Write` / `io::Write` are vendor/anstream's `FmtWrite` / `Write`.
3. (wave-21 mir) `write!(f, "..")` inside a Debug / Display impl formats each `{x}` / `{x:?}` argument with fresh flags (`PLAIN`); only the impl's own `debug_tuple` / `debug_struct` (and `pretty_print_const`) see the caller's Formatter flags; `{x:#?}` is `format_debug(x, debug_X, PRETTY)`; `unimplemented!()` is `panic("not implemented")`; a printer `fmt::Error` panics with std's `to_string` / `format!` message.
4. (wave-21 mir) A Rust copy of a `Copy` MIR object (`Place`, `SourceInfo`, `Location`) handed to another owner is `clone_X` (PORTING §8): `Operand::place`, `to_copy`, `CallReturnPlaces::for_each`, `TerminatorKind::edges`, `StatementKind::as_debuginfo`, `VisitPlacesWith::visit_place`, `TyContext::LocalDecl`, `caller_location_span`, `write_basic_block`'s locations; `StmtDebugInfos::extend` clones.
5. (merge-w21) Derived `Ord` of MIR types are `X_cmp(a, b): -1 | 0 | 1` next to the type: `MirPhase_cmp` (syntax.ts; variant order, then the phase discriminant) and `Location_cmp` (mir/mod.ts; block, then statement_index); mod.ts's `MirPhase_gt` and pretty.ts's `MirPhase_le` are gone.
6. (mir-body-a) `Body::drain_vars_and_temps` splices the range out at the call (upstream's `Drain` on drop) and walks the removed decls; `BasicBlockData::retain_statements` filters `statements` in place (same array); `Place == Place` in `try_const_mono_switchint` is `local === && projection ===` (interned list); `postorder(body)` is `reverse_postorder(body)` reversed (array); `Postorder::new` takes `readonly BasicBlockData[]`.
7. (mir-body-b) `ConstValue::from_u64` / `from_target_usize` take `number` and pass `BigInt` to `Scalar`; `ConstValue::try_to_target_usize`, `Const::try_eval_target_usize` / `eval_target_usize` return `number` and ICE above 2^53 (precedent `ty::Const::try_to_target_usize`); `try_get_slice_bytes_for_diagnostics` returns a `number[]` copy.
8. (mir-body-b) `TerminatorKind::unwind` returns the `UnwindAction` itself (`Option<&UnwindAction>`), `unwind_mut` returns `field_mut(kind, "unwind")`; `ProjectionElem::kind` maps `()` to `null` (`ProjectionKind = ProjectionElem<null, null>`); values of `unknown`-typed hooks / `Pending` stand-ins (`const_caller_location`, `ty::Const::try_to_scalar`, `mir_pretty_extra_data`, `try_destructure_mir_constant_for_user_output`, `constness`, `coroutine_kind`) are cast at the use.
9. (mir-visit) `Cow<[PlaceElem]>` in `process_projection` is `owned | undefined` (`undefined` = still borrowed); exhaustive upstream matches over a subset end in `bug()` / `unreachable()` (`ShimKind` in `super_source_scope_data`, `ambient_variance`); `assert_eq!(local, RETURN_PLACE, ..)` panics with core's message.
10. (mir-pretty) `write!` / `writeln!` on an `io::Write` is one `w.write_fmt([text])`, on a `fmt::Write` one `write_str`; width / fill / alignment use local `pad` (counts chars), `center` (extra fill right), `hex_pad`; `str::trim` is `str_trim` (Unicode White_Space); upstream's literal `write_str(" {{ ")` keeps the doubled braces.
11. (mir-pretty) `io::BufWriter<fs::File>` is a local `DumpFile` (buffered; flush + close where the `BufWriter` drops, also on a JS exception); `PathBuf::push` / `Path::parent` are `/`-separated helpers; `fs::create_dir_all("")` is `Ok`; `io::Error::new(e.kind(), ..)` maps OS errors to `Other` (dump_mir ignores them); `MirDumper.disambiguator` is its rendered text and `MirDumper::new` builds eagerly (`bool::then_some`).
12. (mir-pretty) `write_allocations`'s nested fns and `CollectAllocIds` live inside it; `BTreeSet<AllocId>` is a `Set` sorted where iterated; `pretty_print_byte_str` takes `ArrayLike<number>`; `Debug` of a generic `Prov` is `debug_prov` by representation; `escape_ascii` / `String_from_utf8_lossy` are local copies of ty/print/pretty.ts's helpers (candidates for src/std); pretty.ts reads rustc_session/config.ts lazily through rustc_session/lib.ts (init order).
13. (mir-interp-a) Borrowing iterators (`get_range`, `provenances`, `ptr_fragments`) are generators over the slices borrowed at the call; `InitChunkIter` is a JS iterator; `'label: { .. break 'label v }` is a labelled block.
14. (mir-interp-b) `u64` / `i64` / `u128` interpreter values are bigints while `Size` stays a number, so `max_size_of_val` and `wrapping_offset` past 2^53 stop at `Size`'s `SIZE_BEYOND_2_53`; `AllocDecodingState.data_offsets` are numbers (metadata positions < 2^53); `try_from_unwrap` is `<u64/i64 as TryFrom<u128/i128>>::try_from(..).unwrap()`.
15. (dataflow-contract) `Analysis<D, S = never>` is an interface whose associated types are readonly descriptor members (`Domain: Domain<D>`, `Direction: Direction`) and `const NAME` a member; `Domain<D>` = Clone + JoinSemiLattice + DebugWithContext (+ Eq), built by `Domain_of` / `Domain_DenseBitSet` / `Domain_MixedBitSet` / `Domain_MaybeReachable`; `Direction` is an interface with the objects `Forward` / `Backward`.
16. (dataflow-contract) Provided trait methods live in `Analysis_provided` / `ResultsVisitor_provided` / `GenKill_provided` / `DebugWithContext_provided`; `abstract class AnalysisBase` / `ResultsVisitorBase` forward them (AnalysisBase defaults `Direction` to `Forward`) and analyses `extend` them; other traits are impl tables (`GenKill_DenseBitSet<T>()`, `JoinSemiLattice_*`, `Clone_*`, `DebugWithContext_X(elem)` for generic types), trait-bound params last.
17. (dataflow-contract) Domain values are mutable objects changed in place (`analysis.Domain.clone_from(state, x)`, `.join(state, x)`); `MaybeReachable.Unreachable()` is a fresh object and `*state = v` is `MaybeReachable.assign`; `FlatSet<T>` is immutable (frozen `Bottom` / `Top`) and its `join` takes a `MutRef` slot.
18. (dataflow-contract) `ResultsCursor.body` is the field `body_` (method `body()`); `SimpleCow` kept; `#[cfg(debug_assertions)] reachable_blocks` not compiled in; `Results` is a class; `BasicBlockRank` is hoisted to module level; `Effect` is a string union with `Effect_discriminant` / `Effect_cmp`, `EffectIndex` an interface + `EffectIndex_eq`, `SwitchTargetIndex` a `$`-union.
19. (dataflow-contract) Stub-file conventions for the dataflow fill lanes: a field colliding with a method gets `_` (`move_data_`, `next_`, ...); fn-local items stay module level until filled; composite hash keys are strings (`MoveSubPath_key`, `TrackElem_key`); `LocationMap::index_mut` returns a `MutRef`; `SplitPointIndex::new(point, effect)` is `new_`; pretty.rs's `Annotator` is one class per analysis; value_analysis's struct `Map` shadows JS `Map` (`globalThis.Map` there); the stubs use the shared `// stub:` tag (merge-w21).
20. (vendor-apfloat-b) `DoubleFloat<F>` is an immutable value class (`_0`, `_1`; `mut self` methods work on a clone) with hand-written derives; its static side is `DoubleFloatType<F>` (`double_float_type(F)`, cached), holding `FallbackS` / `Fallback` / `FallbackExtendedS` / `FallbackExtended`; the two `From` impls are `DoubleFloatType.from` / `.fallback_from`.
21. (vendor-apfloat-b) Fallback semantics are built by ieee.ts `semantics(..)` with `MAX_EXP` / `MIN_EXP` overrides (the never-evaluated `IEEE_MIN_EXP` / `IEEE_MAX_EXP` panic if read; `BITS = 0` makes `from_bits` / `to_bits` panic as upstream); `u128` shifts by `F::BITS` mask the amount with 127; `-*exp` in `frexp_r` is i32 wrapping negation.
22. (vendor-apfloat-b) `parse_float_into_scalar`'s host `str::parse::<f32/f64>()` is `core_parse_float` (dec2flt syntax, nearest-ties-even result computed exactly with bigints, not a port of Eisel-Lemire); it belongs in src/std eventually. `ScalarInt::to_float::<F>` takes the `FloatType` dictionary, `From<Half> for ScalarInt` is `ScalarInt.from_Half`, the reverse `ScalarInt.into_Half`; `float_is_infinite::<S>` takes the semantics value; tests/downstream.rs's host `as` casts are emulated.
23. (merge-w21) `tools/codegen/mir.typemap.json` maps `Dominators` (rustc_data_structures graph/dominators) and `DenseBitSet` (rustc_index) to the real types; `BasicBlocks::dominators` casts `this` to `ControlFlowGraph` for the overloaded `predecessors` slot.
24. (merge-w21) `QueryKey` impls whose types live in modules loaded after query/keys.ts (`Instance`, `GlobalId`) read them lazily (`require`) inside the fns; `debug` fields are arrow wrappers (no read at load).

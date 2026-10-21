# M4 plan — MIR build, borrowck, MIR transforms

Source: the plan-m4 planner (read-only; it ports no code). Status: **proposed**. Root accepts or amends
decisions D1–D14 and records them with `bun scripts/state.ts record decision`.
Pin `6f5da406b56c` (1.101.0-nightly). Line counts are from `wc -l` at the pin, without `tests.rs` and `tests/`. Fn
counts and "ported" numbers are `bun scripts/coverage.ts` on `lane/plan-m4` (base `b0a781c1`, 16,715 / 25,518 fns).
Paths are relative to `compiler/` unless they say otherwise. Oracle measurements were made with the pinned nightly
(`rustc 1.101.0-nightly (6f5da406b 2026-10-10)`); scripts are in `$RUST_TS_DATA/scratch/plan-m4/`.

## 1. What the M4 gate commands run at the pin

### 1a. `-Zunpretty=mir` is the whole `analysis` plus optimized MIR of every body

`PpMode::needs_analysis()` (rustc_session/src/config.rs:3334) is true for `Mir | MirCFG | StableMir | ThirTree |
ThirFlat | Hir(Typed)`. `pretty::print` (rustc_driver_impl/src/pretty.rs:232) therefore runs
`tcx.ensure_ok().analysis(())` first, then for `Mir` calls `write_mir_pretty` (rustc_middle/src/mir/pretty.rs:318):

- Three header comment lines, then one block per `tcx.mir_keys(())` (rustc_mir_transform/src/lib.rs `mir_keys`:
  `hir_body_owners` minus `GlobalAsm`, plus coroutine-closure by-move bodies, plus the `CtorKind::Fn` constructors of
  every struct/enum), separated by blank lines.
- Per key:
  - `const fn`: `optimized_mir` + its promoteds, then `// MIR FOR CTFE` + `mir_for_ctfe` (only `mir_for_ctfe` for
    `Constness::Const { always: true }`);
  - a trivial const (`tcx.trivial_const(def)`): one line `const <path>: <ty> = const <val>;`;
  - otherwise `instance_mir(InstanceKind::Item)` (ty/mod.rs:1831: `mir_for_ctfe` for consts, statics, ctors and anon
    consts, `optimized_mir` for fns) and `promoted_mir`.
- The `mir_pretty_extra_data` hook (rustc_mir_dataflow/src/pretty.rs) adds liveness annotations under `#[rustc_mir(..)]`.
- Allocations referenced by the bodies are printed at the end of each body (`alloc13 (size: 21, align: 1) { .. }`)
  with their **global `AllocId`s** (`alloc1` … `alloc77` in mini_core_hello_world.rs).

`analysis` (rustc_interface/src/passes.rs:1209) is `run_required_analyses` (:1100) and then, only if there are no
errors (`has_errors_excluding_lint_errors` → `raise_fatal`), misc_checking_3. With errors, nothing is printed on stdout.

`optimized_mir` at the default level: no `-O` → `mir_opt_level()` is 1 (session.rs:982; `-Z help`: "default: 1 in
non optimized builds and 2 in optimized builds"), and `ub_checks()` follows `-Cdebug-assertions`, which is on without
`-O`. So `run_optimization_passes` (lib.rs) runs, at level 1: CheckAlignment, CheckNull, CheckEnums (ub checks; they
insert panicking checks), LowerSliceLenCalls, InstSimplify ×2, ForceInline (`Required`), RemoveStorageMarkers (no
lifetime markers at opt-level 0), RemoveZsts, RemoveUnneededDrops, UnreachableEnumBranching,
SimplifyCfg ×2, SimplifyConstCondition ×3, SimplifyLocals ×3, SingleUseConsts, RemoveNoopLandingPads (unwinding
targets), CopyProp (+ ssa.rs), CriticalCallEdges, MentionedItems. Off at level 1: Inline, GVN, ReferencePropagation,
SROA, DeadStoreElimination, JumpThreading, MatchBranchSimplification, DataflowConstProp (≥3), DestinationPropagation,
EarlyOtherwiseBranch, SsaRangePropagation, SimplifyComparisonIntegral, UnreachablePropagation, TailCopyToMove,
MultipleReturnTerminators (≥4), StripDebugInfo, ReorderBasicBlocks/Locals (off by default).

Before that, every body goes through `mir_built` → `mir_promoted` → `mir_borrowck` → `mir_drops_elaborated_and_const_checked`
(`run_analysis_cleanup_passes`, `RemoveUninitDrops`/`CheckLiveDrops` for const contexts, `run_runtime_lowering_passes`:
CriticalCallEdges, PostAnalysisNormalize, Subtyper, ElaborateDrops, CheckDropRecursion, AbortUnwindingCalls,
AddMovesForPackedDrops, EraseDerefTemps, ElaborateBoxDerefs, StateTransform (coroutines), **KnownPanicsLint**;
`run_runtime_cleanup_passes`: LowerIntrinsics, RemovePlaceMention, SimplifyCfg::PreOptimizations).
KnownPanicsLint const-propagates through `rustc_const_eval::interpret::InterpCx<DummyMachine>`, so **any MIR output
needs the interpreter core**, not only consts.

Oracle measurements (`scratch/plan-m4/sample.sh`, every 68th tests/ui file, 301 files, `stdArgs` + `-Zunpretty=mir`):
- with std: **113 print MIR (37.5%)**, 188 exit 1 with diagnostics only (E0277 57, E0308 33, E0425 22, E0463 21, …);
  MIR output median 1.5 KB, max 59 KB; oracle ≤ 0.28 s per file.
- as `#![no_core]` (`nocoreArgs`): **0 / 301** print MIR (468 × `requires sized lang_item`, 327 × `meta_sized`). A
  `mir-nocore` suite would only repeat tydump-nocore through the real driver; not proposed.
- cg_clif `mini_core.rs` (lib, cg_clif flags): 1,441 lines of MIR. `mini_core_hello_world.rs`: 6,872 lines, 19
  promoteds, 77 AllocIds, statics (`NUM`, `NUM_REF`) evaluated by CTFE; with `-Zmir-opt-level=0` 8,176 lines.

### 1b. `mir_borrowck` and the rest of `run_required_analyses`

The MIR_borrow_checking loop (passes.rs:1163), per `hir_body_owner`:
1. `check_unsafety` (THIR; rustc_mir_build/src/check_unsafety.rs) unless a typeck child;
2. `is_trivial_const` → `trivial_const` (rustc_mir_transform/src/trivial_const.rs) → `mir_built`; trivial consts stop here;
3. `mir_borrowck` (rustc_borrowck/src/lib.rs): `mir_promoted` → `check_coroutine_obligations` → tainted? `Err` :
   `BorrowCheckRootCtxt::do_mir_borrowck` (nested closure bodies with their root), `check_transmutes`;
4. `has_ffi_unwind_calls`, `check_liveness` (rustc_mir_transform/src/liveness.rs: `unused_variables`,
   `unused_assignments`);
5. `mir_drops_elaborated_and_const_checked` if `should_codegen()` **or** a const context (so: for consts, statics and
   const fns always; for every body of a build/run test);
6. `layout_of` of coroutines; then `layout_test::test_layout`, `abi_test::test_abi`.

The queries `mir_built` pulls in: `thir_abstract_const`, `check_match` (rustc_mir_build thir/pattern/check_match.rs +
rustc_pattern_analysis), `check_tail_calls`, `thir_body`, `construct_fn` / `construct_const` / `construct_error`,
then LintAndRemoveUninhabited (inhabitedness), CheckForceInline, CheckCallRecursion, CheckPackedRef,
CheckConstItemMutation, CheckMutRestriction, FunctionItemReferences, SimplifyCfg::Initial, SanityCheck.
`mir_promoted`: `mir_const_qualif` for const fns/consts/statics (rustc_const_eval check_consts, which uses
rustc_mir_dataflow's `MaybeStorageLive`), `has_ffi_unwind_calls`, `coroutine_by_move_body_def_id`, `trivial_const`,
`RequiredConstsVisitor`, PromoteTemps, SimplifyCfg::PromoteConsts, InstrumentCoverage (off without
`-Cinstrument-coverage`), `lint_tail_expr_drop_order`.

`rustc_hir_analysis::check_crate` (lib.rs:166–184) also runs `eval_static_initializer` / `eval_to_const_value_raw` for
every static and const (the arm the M3 probes skip, plan-m3 D1a). So **CTFE runs in every analysis that has a
`const` or `static` item**: 11% of tests/ui files (2,290 / 20,463), 5% of ui/borrowck, 7% of ui/nll (regex count,
`scratch/plan-m4/ctfe.py`). Literal array lengths and repeat counts do not need CTFE.

misc_checking_3 (only without errors): `effective_visibilities`, `check_private_in_public`, `check_mod_deathness`
(rustc_passes/src/dead.rs), `rustc_lint::check_crate` (late lints), `clashing_extern_declarations`,
`check_mod_privacy`, `check_expectations`, `all_diagnostic_items`, `all_canonical_symbols`.

### 1c. Borrowck at the pin: NLL + Polonius **next** by default

- `Polonius::DEFAULT` (config.rs:3695) is `Next` when rustc was built with `CFG_DEFAULT_POLONIUS_NEXT`. The oracle was:
  `rustc -Z help` prints `polonius=val -- enable polonius-based borrow-checker (default: next)` (also recorded by
  session-options, 2026-10-12).
- With `Next`, `TypeChecker` builds a `PoloniusContext` (type_check/mod.rs:140), `compute_regions` runs
  `compute_loan_liveness` (nll.rs:151, the localized constraint graph of polonius/{constraints,liveness_constraints,
  liveness}.rs), and `Borrows::new` uses `PoloniusOutOfScopePrecomputer` instead of
  `calculate_borrows_out_of_scope_at_location` (dataflow.rs:388). Region inference, error reporting and everything
  else is NLL's.
- `-Zpolonius=off` (27 revisions in ui/borrowck + ui/nll) takes NLL's out-of-scope path. `-Zpolonius=legacy` and a bare
  `-Zpolonius` (≈29 revisions, all `[legacy]`-style) run the datalog engine: polonius/legacy/* (1,253 lines) + vendor
  `polonius-engine` 0.13.0 (2,163) + `datafrog` 2.0.1 (1,616).
- `-Zdump-mir=nll` prints region inference (`<crate>.<item>.nll.0.mir`, plus `regioncx.{all,scc}.dot` and, with
  next, `polonius.0.html`); verified on the oracle. Useful for phase-diff (D11).

### 1d. The M3 leftovers that M4 must close (docs/handoff/small-gaps-21.md §analysis)

- tydump-ui `rustc_dump` subset is 75/119 (gate ≥ 90% = 108). Stops: `mir_borrowck` 16, `const_eval_resolve_for_typeck`
  12, `vtable_entries` 10 + `COMMON_VTABLE_ENTRIES` 1, `const_eval_poly` 5. With vtables (lane `instance-vtable`, running)
  and borrowck it reaches ~102/119 (85.7%); ≥ 90% needs CTFE.
- 163 `mir_borrowck` stops in tydump-ui, all from `type_of` of opaque types (126 RPIT via wfcheck, 24 TAIT, 9 RPIT via
  privacy, …). 27 have typeck-tainted owners (the `construct_error` path, ≤ 27 cases); 123 need real borrowck.
- 56 `const_eval_resolve_for_typeck` stops (all via `try_evaluate_const`; ~24 "trivial"), 5 `const_eval_poly`
  (explicit enum discriminants; also `mini_core_hello_world.rs`, moved to "M4's first const-eval wave" by the recorded
  decision of 2026-10-21).
- Trivial consts still go through an `InterpCx` (`eval_to_allocation_raw` writes the value and reads it back as a valtree;
  eval_queries.rs:463), so "trivial const eval" = Instance + MIR build + trivial_const.rs + the interpreter's
  memory/place/operand core + valtrees.rs.

### 1e. Why the borrowck stderr gate cannot use the real `--emit=metadata` path

After `analysis`, `start_codegen` (passes.rs:1295) calls, at :1323, `rustc_metadata::fs::encode_and_write_metadata` before it
looks at `-Zno-codegen` or `should_codegen()`; with compiletest's `--emit metadata` (every check-pass/check-fail test)
that encodes metadata (encoder.rs, 0/95 fns, M5) and, for lib crates, `optimized_mir` of inlinable items. So the M4
stderr gate stops right after `analysis` through a probe (D2), as M3 stopped after typeck.

## 2. Inventory (upstream lines; ported fns at base; ★ = new crate for the port)

| crate / area | lines | ported | M4 subset |
|---|---|---|---|
| rustc_middle mir/* | 15,800 | 0 / ~600 | all: syntax 1774, mod 1747, statement 1153, terminator 816, consts 551, query 181, coverage 264, basic_blocks 169, traversal 376, visit 1493 (`make_mir_visitor!` ×2), pretty 2097, graphviz ~370; interpret/: allocation 826 + init_mask 725 + provenance_map 483, error 1103, mod 602, value 455, pointer 365, queries 250. Today only THIR's enums exist (mir/syntax.gen.ts, mir/query.gen.ts). |
| rustc_middle, rest | — | — | ty/instance.rs 1024 + ty/vtable.rs 156 (lane instance-vtable), ty/inhabitedness/* 706 (0/27; MIR build, check_match, LintAndRemoveUninhabited), ty/significant_drop_order.rs 160, middle/deduced_param_attrs 3 fns. Not M4: mono.rs, dep_graph, on_disk_cache, ptrauth. |
| ★rustc_mir_build builder/* | 13,505 | 0 / 249 | all: matches/mod 3010, scope 2186, mod 1184, expr/into 948, as_place 835, as_rvalue 756, matches/{test,match_pair 484 each, buckets 384, util 239, user_ty 148}, block 366, coverageinfo 349, custom/* 989, the rest small |
| rustc_mir_build, rest | 9,574 | 98 / 458 overall | check_match 1570 (0/34), check_unsafety 1118 (0/13), check_tail_calls 484 (0/20). THIR, its print and diagnostics are done (M3). |
| ★rustc_pattern_analysis | 5,210 | 0 / 223 | all: usefulness 1882, constructor 1226, rustc.rs 1091 (+print 151), pat 314, lib 145, diagnostics 152, lints 109, pat_column 90, checks 50 |
| ★rustc_mir_dataflow | 7,541 | 0 / 378 | framework/* 1594 (mod, direction, cursor, lattice, results, visitor, fmt), move_paths/* + drop_flag_effects + un_derefer + points 1544, impls/* + rustc_peek 2419, pretty 159; later: value_analysis 1109 (opt ≥ 2), framework/graphviz 716 (`-Zdump-mir-dataflow`) |
| ★rustc_borrowck | 36,671 | 0 / 901 | all but polonius/legacy (1253, D7). lib 2781; type_check/* 6355 (mod 2813, liveness/* 1283, relate_tys, free_region_relations, canonical, constraint_conversion, input_output); region_infer/* 4708 (region_context 1715, opaque_types/* 1115, values 489, mod, reverse_sccs, dump_mir, graphviz); universal_regions 1040, borrow_set 587, dataflow 571, places_conflict 540, nll 372, root_cx 324, handle_placeholders 384, constraints/* 348; polonius next 1387; **diagnostics ~16k** (conflict_errors 5014, mutability_errors 2041, mod 1651, region_errors 1392, move_errors 1277, region_name 1147, explain_borrow 947, …; session_diagnostics 678 generated) |
| ★rustc_mir_transform | 34,624 | 0 / 1101 | see the groups in §5. Needed for the default `-Zunpretty=mir`: skeleton 2493 (lib, pass_manager, simplify, trivial_const, required_consts, sanity_check, patch), mir_built lints 2240, promote_consts 1105, liveness 1576, cleanup/lowering 1994, elaborate_drop(s) 2200, ub checks + KnownPanicsLint 2046, level-1 passes 2121, inline (ForceInline) 2030, shim 1711 (ctor MIR), coroutine/* 2819. Later (D10): level ≥ 2 passes 8145, coverage/* 2237, validate + lint 1894. |
| ★rustc_const_eval | 22,614 | 4 / 764 | check_consts/* 2669 (for `mir_const_qualif` + post-drop checks), interpret/* 14,780 (memory 1736, validity 1721, intrinsics 1436 + simd 902 + atomic 134, place 1203, call 1183, operand 919, machine 874, stack 742, step 691, eval_context 676, cast 590, operator 543, projection 451, intern 405, discriminant 328, …), const_eval/* 3611 (machine 1234, eval_queries 557, valtrees 486, type_info 458, error 253, dummy_machine 213, dyn_trait 178, fn_queries 82 done), util/* 724, diagnostics 508 |
| rustc_ty_utils | 5,392 | 104 / 123 | instance.rs 442 (lane instance-vtable), abi.rs 741 (`fn_abi_of_instance`: interpreter calls, `#[rustc_dump_abi]`) |
| rustc_target | — | 234 / 930 | callconv/mod.rs 1022 + x86_64.rs 269 (`adjust_for_rust_abi` / foreign ABIs under `fn_abi_of_instance`) |
| rustc_trait_selection | — | 947 / 976 | traits/vtable.rs 447 (instance-vtable), traits/outlives_for_liveness.rs 578 (borrowck liveness) |
| rustc_lint (late) | 26,057 | 338 / 718 | ≈ 18.5k left: late.rs 477, builtin.rs (26/78 of 3175), types.rs 1182 + improper_ctypes 1347 + literal 463, unused/must_use 673, nonstandard_style rest, impl_trait_overcaptures 634, lifetime_syntax 612, if_let_rescope 499, internal.rs rest, foreign_modules rest (clashing_extern_declarations), ~35 small late lints (~6k) |
| rustc_passes | 8,867 | 164 / 338 | dead.rs 1579, canonical_symbols 91, layout_test 131, abi_test 192. Not M4: reachable 530, input_stats 803, hir_id_validator (debug builds only) |
| rustc_privacy | 1,881 | 87 / 87 | done (lane privacy-effvis) |
| rustc_index | 2,937 | 40 / 288 | bit_set.rs rest (ChunkedBitSet, MixedBitSet, GrowableBitSet, SparseBitMatrix, BitMatrix rest; 34/117), interval.rs 423 (`IntervalSet`, `SparseIntervalMatrix`: borrowck region values), idx/vec/slice helpers |
| rustc_data_structures | — | 469 / 960 | graph/dominators 471, graph/linked_graph 388 (if reached), union_find 96, work_queue, frozen, sorted_map rest |
| vendor | — | — | ★`rustc_apfloat` 0.2.3+llvm-462a31f5a5ab (4,551 lines; float literals in MIR build, CTFE float ops); later ★`polonius-engine` 0.13.0 + ★`datafrog` 2.0.1 (D7) |
| rustc_interface / rustc_driver_impl | — | 41/90, 48/77 | `analysis` / `run_required_analyses` for real (passes.ts:946 is `unported("…analysis (M3+)")`), `Mir`/`MirCFG` in pretty.ts, `emit_mir`; rustc_graphviz 669 for `mir-cfg` |

Total ≈ 172k upstream lines (≈ 85 lanes), 0.7× M3 (≈ 250k). Not M4: rustc_monomorphize (4,868), the metadata encoder
(M5), codegen (M7).

## 3. Hard blockers and design decisions

**D1. Close M3 on typeck+traits; move its MIR-dependent criteria into M4.**
- M3 criteria (plan-m3 §4) are met for typeck+traits (tydump-ui 87.1%, thirdump-ui 86.7%, gate ≥ 85%). The rustc_dump
  subset (75/119) cannot pass ≥ 90% without borrowck and CTFE (§1d).
- Recommended: accept gate M3 on typeck+traits; the rustc_dump ≥ 90% criterion moves to gate M4c, as
  `mini_core_hello_world.rs` already did (decision 2026-10-21). Alternative (keep M3 open until M4c) blocks nothing but
  leaves the milestone marker wrong for ~5 waves.

**D2. Three gate paths: a MIR-build probe (M4a), an analysis probe (M4b), the real `-Zunpretty=mir` (M4c).**
- `mirdump` probe (rustc-dev, the tydump pattern; `tools/probes/mirdump`): the tydump prefix (still without check_crate's
  const arm, plan-m3 D1a), then the MIR_borrow_checking loop of passes.rs:1163 verbatim except that `mir_borrowck`,
  `check_transmutes`, `mir_drops_elaborated_and_const_checked` and the coroutine `layout_of` are replaced by printing,
  with `MirWriter::write_mir_fn`, `mir_built(def).borrow()` (before it is stolen) and then `mir_promoted(def)` plus its
  promoted fragments, for every `mir_keys` item in order. Trivial consts print the `write_mir_pretty` one-liner.
  `check_unsafety`, `has_ffi_unwind_calls` and `check_liveness` run as upstream. Port side `src/rust_ts/mirdump.ts`.
- `ckdump` probe: `rustc_driver::run_compiler` with `Callbacks::after_analysis` returning `Compilation::Stop`. That is
  the real `analysis` (check_crate with CTFE, MIR_borrow_checking, layout/abi tests, the error abort, misc_checking_3),
  with no upstream code copied; stdout is empty, stderr is every analysis diagnostic. Port side `src/rust_ts/ckdump.ts`
  = main.ts with the same stop. Needed because the real `--emit=metadata` path reaches the metadata encoder (§1e).
- Real CLI `-Zunpretty=mir` for M4c (no probe).
- Rejected: `-Zunpretty=thir-flat` as the stderr gate (it stops after analysis on the real CLI, but couples the borrowck
  gate to THIR print parity); `-Zunpretty=mir` as the borrowck gate (it demands the whole optimisation pipeline and the
  interpreter for every passing case).

**D3. MIR data structures.**
- Types of mir/{syntax, mod, statement, terminator, consts, query, coverage, basic_blocks} and mir/interpret/* come from
  codegen (typedefs → TS types, derived Debug, `clone_<T>`, TypeFoldable/TypeVisitable). The hand-written Debug impls
  (`Place`, `Operand`, `Rvalue`, `Statement`, `TerminatorKind`, `ConstOperand`, in statement.rs/terminator.rs/pretty.rs)
  are ported by lanes. mir/syntax.ts's THIR subset is replaced, not duplicated.
- MIR nodes are **mutable** plain objects (passes edit them in place, as AST MutVisitors do; PORTING §8 clone rule for
  `Copy` structs). `Body` is a class; `IndexVec<BasicBlock, BasicBlockData>` / `local_decls` are arrays (PORTING §5);
  `BasicBlocks` is a class with the upstream lazy caches (predecessors, switch_sources, reverse_postorder, dominators),
  invalidated by `as_mut()`. `Place.projection` is an interned `List<PlaceElem>` (`mk_place_elems`, PORTING §5
  hash-consing); `Box<(Place, Rvalue)>` is a `[Place, Rvalue]` tuple. `Steal<Body>` reuses the query engine's `Steal`
  (double steal = the same ICE). `body.clone()` (mir_for_ctfe of const fns) is a deep `clone_Body`.

**D4. `make_mir_visitor!` (visit.rs:68, instantiated at :1276–1277) is hand-expanded twice.**
- `Visitor` and `MutVisitor` become two TS classes (`*_provided` helpers per PORTING §8), each fn with the marker of the
  macro's fn line. In `MutVisitor`, callbacks that receive `&mut` of a `Copy` leaf (`visit_local`, `visit_ty`,
  `visit_const_operand`, `visit_span`, `visit_basic_block_data` targets, …) take `MutRef<T>` (PORTING §8 out-parameter
  rule) and the `super_*` walkers write the value back.
- Rejected: one TS class for both (the `&mut` leaves need write-back, `&` ones must not allocate); a codegen of the
  macro (one macro, two instantiations; mechanical by hand).

**D5. Dataflow framework.** `Analysis` (framework/mod.rs) becomes a TS interface whose `Domain` is described by a
descriptor (`bottom_value`, `clone_from`, `join`, `DebugWithContext`); `Direction` is two objects (`Forward`,
`Backward`) with the upstream fns; `Results`, `ResultsCursor` and `visit_results` are ported as is. Generic users
(`Borrows`, `MaybeInitializedPlaces`, `MaybeStorageLive`, check_consts' `FlowSensitiveAnalysis`, liveness) implement
the interface. Contract-first (✱dataflow-contract), because borrowck, check_consts, coroutines and the level-2 passes
all build on it.

**D6. Bit sets use 32-bit `number` words.**
- rustc_index bit_set.ts today stores `Word = u64` as `bigint` (lane res-macros). Dataflow joins, gen/kill and
  borrowck's `SparseIntervalMatrix`/`SparseBitMatrix` are the hottest loops of M4; bigint ops are an order of magnitude
  slower than int32 ops in JS.
- Recommended: `Word` = `number` holding 32 bits (`Uint32Array` storage), `WORD_BITS = 32`, and `CHUNK_WORDS` doubled
  so that `CHUNK_BITS` (2048) and every bit-level threshold stay upstream's. No output depends on the word width (Debug
  prints elements). The index-ds lane migrates the ~30 existing users. `InitMask` (mir/interpret) uses the same words.
- Alternative: keep bigint and measure first; rejected because the switch is cheapest before dataflow lands.

**D7. Polonius: next in the main line, legacy deferred.**
- Next is the oracle's default (§1c), so polonius/{mod, constraints, liveness_constraints, liveness, dump} (1,387) are
  ported with NLL (wave 23). The `-Zpolonius=off` path is the same code.
- Legacy (`-Zpolonius=legacy`, bare `-Zpolonius`; ≈29 of ~961 borrowck-ui cases, 3%) needs vendor polonius-engine +
  datafrog (3.8k) + polonius/legacy/* (1.25k): wave 26 (M4d). Until then those revisions stop UNPORTED.

**D8. CTFE is ported in M4, whole, not just a trivial-const shortcut.**
- Every analysis with a const/static runs CTFE (§1b), statics' allocations appear in `-Zunpretty=mir`, and
  KnownPanicsLint runs `InterpCx<DummyMachine>` on every body (§1a).
- `Machine` is a TS interface implemented by `CompileTimeMachine` and `DummyMachine` (Miri's machine is M6); `InterpCx`
  is a class with extension files (✱interp-contract, like fnctxt-contract). `Provenance`/`Prov` generics are erased to
  `CtfeProvenance` with a `// PORT:` (M6 re-generalises). `ScalarInt.data` stays `bigint` (exists), `Size` stays a
  `number` (abi-lib decision), allocation bytes are a `Uint8Array`, `InterpResult` is the `Result` of src/std/result.ts.
- The first const-eval wave (23b) ports the path the trivial consts take (contract, memory, place/operand, eval_queries,
  valtrees, dummy machine), which unblocks `const_eval_poly` / `const_eval_resolve_for_typeck` stops and
  mini_core_hello_world.rs under tydump/thirdump. simd intrinsics (902) come last.

**D9. Floats go through vendored `rustc_apfloat` 0.2.3, never JS doubles.** Port the crate whole (4,551 lines, its
tests as unit tests, `// crate:` markers). MIR build's `parse_float_into_scalar` (today
`unported(… rustc_apfloat)`) and every interpreter float op use it; f16/f128 and NaN payloads must be bit-exact.

**D10. Optimisation scope: level ≤ 1 and the mandatory passes gate M4; the rest is M4d.**
- Gate suites run without `-O` (the `mir` suites use `stdArgs`/cg_clif flags). Level ≥ 2 passes (gvn 2210,
  jump_threading 1126, dataflow_const_prop 1010 + value_analysis 1109, dest_prop, match_branches, sroa, ref_prop,
  early_otherwise_branch, ssa_range_prop, dse, simplify_comparison_integral, unreachable_prop, tail_copy_to_move,
  deduce_param_attrs; ≈ 9.3k), `coverage/*` (2,237; only with `-Cinstrument-coverage`) and `validate.rs` (only with
  `-Zvalidate-mir`) are wave 26: needed by ui/mir tests with `-Zmir-opt-level`/`-O` and by M7, not by the M4 gates.
- tests/mir-opt (408 `.rs`, 398 expected `.mir`, 938 `.diff` at the pin; not in the sparse checkout) is the per-pass
  oracle: compiletest mir-opt mode (`-Zdump-mir=<passes> -Zmir-opt-level=4 -Copt-level=1 -Zvalidate-mir -Zlint-mir
  -Zdump-mir-exclude-pass-number -Zmir-include-spans=false`, unit tests with `-Zmir-opt-level=0
  -Zmir-enable-passes=+<Pass>`). 204 of the 408 are `//@ test-mir-pass:` unit tests (GVN 46, DataflowConstProp 23,
  CopyProp 21, DestinationPropagation 10, EarlyOtherwiseBranch 6, Derefer 5, DeadStoreElimination 5, …; `git grep` at
  the pin). Recommended as an M4d report suite; adding `tests/mir-opt` to `UPSTREAM.json` sparse is a scripts batch.

**D11. `-Zdump-mir` is ported early and drives phase-diff.** mir/pretty.rs `MirDumper`/`dump_mir` and the pass
manager's dumps land with the skeleton (waves 21–22). `scripts/phase-diff.ts` gains MIR stages: run both sides with
`-Zdump-mir=all -Zdump-mir-dir=<tmp> -Zdump-mir-exclude-pass-number` and report the first differing file in pass order
(`<crate>.<item>.built.after.mir`, `<Pass>.{before,after}.mir`, `renumber.0.mir`, `nll.0.mir`, …; verified on the
oracle). Harness/scripts batch, reviewed as such.

**D12. The rest of `analysis` lands first (plan-m3's M4-0).** Late lints (`rustc_lint::check_crate`, ~18.5k), dead.rs,
canonical_symbols, layout_test/abi_test, clashing_extern_declarations and the real `analysis` in passes.ts are wave 21–25
work: every passing case of the ckdump and `-Zunpretty=mir` suites runs misc_checking_3. rustc_privacy is already done.

**D13. AllocIds are compared as printed.** They are global, assigned in interning order (string literals via
`reserve_and_set_memory_dedup`, statics, vtables, promoted evaluation, CTFE), and appear in the MIR text. No harness
normalisation (it would hide real divergences in query order). The port interns in exactly upstream's order; phase-diff
reports the first `allocN` that differs.

**D14. Harness argv for the M4 ui suites.** Keep compiletest's argv (`-Znext-solver=coherence`, revisions, aux crates
by the oracle) as in M3. For real-CLI `-Zunpretty=*` suites built from compiletest argv, drop the harness's own
`-o <path>` (run-* tests): with `-o`, `write_or_print` (pretty.rs:202) writes the dump to that file instead of stdout.
The probes ignore `-o` (they stop before output).

## 4. Suites and gates

| suite | cases | oracle / subject | milestone |
|---|---|---|---|
| `mirdump-minicore` | the tydump-minicore corpus (mini_core.rs, mini_core_hello_world.rs, native no_core / add-minicore tests) | probe mirdump / mirdump.ts | M4a |
| `mirdump-ui` | ui/borrowck, ui/nll, ui/mir, ui/mir-dataflow, ui/liveness, ui/unsafe, ui/pattern/usefulness (~1,350 cases), compiletest argv | probe mirdump / mirdump.ts | M4a |
| `borrowck-ui` | ui/borrowck (522 cases with revisions) + ui/nll (439), compiletest argv; report subsets ui/lifetimes, ui/closures, ui/moves, ui/coroutine, ui/async-await | probe ckdump / ckdump.ts | M4b |
| `tydump-ui`, `thirdump-ui` | unchanged (M3); the rustc_dump subset is an M4c criterion (D1) | probes | M4c |
| `mir-minicore` | tydump-minicore corpus + `-Zunpretty=mir` (D14) | rustc / main.ts | M4c |
| `mir` | all tests/ui with `stdArgs` + `-Zunpretty=mir` (21.5k; skips as hir-tree, re-measured) | rustc / main.ts | M4c |
| `mir-o0` | `mir-minicore` with `-Zmir-opt-level=0` (no level-1 passes; ub checks still on) | rustc / main.ts | M4c-1 (report) |
| `thir-tree` | tests/ui/thir-print + the thirdump-ui cases through the real `-Zunpretty=thir-tree` | rustc / main.ts | M4c (report) |
| `mir-opt` | tests/mir-opt (D10) | compiletest mir-opt mode | M4d (report) |

Plausible shares:
- mirdump-minicore 85–95%: MIR build is deterministic and the corpus is small; tydump-minicore is 45/46.
- mirdump-ui 80–90%: thirdump-ui is 86.7% on harder directories; MIR build over a matching THIR is mechanical; the
  risky parts are check_match/exhaustiveness diagnostics and `construct_error` on tainted bodies.
- borrowck-ui 75–90%: ~80% of cases have a `.stderr` (413/496, 299/375), mostly borrowck diagnostics (~16k lines of
  reporting: region naming `'1`/`'2`, suggestions, explain_borrow); 3% legacy polonius (UNPORTED until wave 26); 5–7%
  need CTFE; ~9% are run-pass/build-pass/run-fail, which demand `mir_drops_elaborated_and_const_checked` for every body
  (`should_codegen()`), i.e. the runtime-lowering passes.
- mir 70–85%: 62.5% of sampled cases end in errors and match when the analysis matches (typeck is ported; the
  construct_error/borrowck early exits are cheap); 37.5% print MIR and need the whole level-1 pipeline, CTFE of statics
  and identical AllocIds.

Gates:
- **M4a**: mirdump-minicore ≥ 90% with mini_core.rs MATCH; mirdump-ui ≥ 85%; tydump-ui gains the ≤ 27 tainted-owner
  cases (no MATCH lost).
- **M4b**: borrowck-ui ≥ 85% on ui/borrowck + ui/nll; tydump-ui `mir_borrowck` stops ≤ 10.
- **M4c (= M4)**: mir-minicore ≥ 90% with mini_core.rs and mini_core_hello_world.rs MATCH (also on tydump/thirdump-minicore);
  mir ≥ 80%; borrowck-ui stays ≥ 85%; tydump-ui rustc_dump subset ≥ 90% (D1).
- Report only: the blessed `.stderr` comparison (`difftest --report blessed`) for borrowck-ui cases where the oracle's
  ckdump stderr equals compiletest's; `mir-o0`, `thir-tree`; M4d `mir-opt`.
- Protected-set growth: each suite is protected by the first accepted run that passes its gate share, as before; the
  `mir` suite (21.5k cases at ~2–3 s of port time each) makes the full gate several CPU-hours: dev loops use
  `--sample`, and bundling the port (queued follow-up from wave 13) becomes worth doing before M4c.

## 5. Waves (lanes ≤ ~3k upstream lines; ✱ = contract-first lane that merges before its dependants)

**Wave 21: M4-0, contracts and foundations (parallel)**
- `instance-vtable` (running): ty/instance.rs, ty_utils instance.rs, traits/vtable.rs, ty/vtable.rs (~2.1k) → rustc_dump
  vtable cases (~86/119).
- ✱`mir-contract`: D3/D4 skeleton: codegen set(s) for rustc_middle mir/* and mir/interpret/* types + Debug + fold +
  clone; `Body`/`BasicBlocks`/`LocalDecl` classes, `Visitor`/`MutVisitor` declarations, `mk_place_elems`; replaces the
  THIR-only mir/syntax.gen.ts.
- mir-body-a: mir/mod.rs fns, basic_blocks.rs, traversal.rs (2.3k).
- mir-body-b: statement.rs, terminator.rs, consts.rs, query.rs fns + their Debug impls (2.7k).
- mir-visit: visit.rs both expansions (1.5k source, ~3k TS).
- mir-pretty: pretty.rs (`write_mir_pretty`, `write_mir_fn`, allocation printing, `MirDumper`/`dump_mir`; D11) (2.1k).
- mir-interp-a: interpret/allocation + init_mask + provenance_map (2.0k).
- mir-interp-b: interpret/{mod, value, pointer, error, queries} (2.8k).
- ✱`dataflow-contract`: rustc_mir_dataflow framework/* + lib.rs (1.6k; D5).
- index-ds: rustc_index bit_set rest (D6 word switch + migration), interval.rs, idx/vec/slice fns; rustc_data_structures
  dominators, union_find, work_queue, frozen, sorted_map rest (~3k).
- vendor-apfloat-a / -b: rustc_apfloat ieee.rs and the rest, with its tests (4.5k; D9).
- lint-late-a: late.rs + builtin.rs rest (~2.6k). lint-late-b: types.rs, types/literal.rs, types/improper_ctypes.rs
  (~3.0k). lint-late-c: unused/must_use, nonstandard_style rest, impl_trait_overcaptures, lifetime_syntax, if_let_rescope
  (~2.9k). lint-late-d: internal.rs rest, foreign_modules rest (clashing_extern_declarations), transmute, non_fmt_panic,
  dangling, non_local_def, reference_casting, drop_forget_useless (~3.1k). lint-late-e1/-e2: the ~28 small late lint
  files (~4.1k).
- passes-dead: dead.rs, canonical_symbols.rs, layout_test.rs (~1.8k).
- harness-w21: `mirdump` probe + `src/rust_ts/mirdump.ts` driver shell + suites mirdump-minicore / mirdump-ui
  (unprotected); phase-diff MIR stages (D11).

**Wave 22: MIR build (→ gate M4a)**
- ✱`builder-contract`: `Builder` and its methods across builder/* (as fnctxt-contract did).
- mb-mod (builder/mod.rs, cfg, misc, block, coverageinfo; 2.1k); mb-scope (2.2k); mb-expr-a (as_place, as_operand,
  as_temp, category, as_constant, stmt; 1.8k); mb-expr-b (into, as_rvalue; 1.7k); mb-matches-a / -b (matches/mod.rs split
  at ~1500); mb-matches-c (test, match_pair, buckets, user_ty, util; 1.7k); mb-custom-tail (custom/*, check_tail_calls;
  1.5k).
- mb-unsafety (check_unsafety.rs, 1.1k); mb-check-match (check_match.rs + rustc_middle ty/inhabitedness/*; 2.3k).
- pat-a (usefulness, pat_column, lints, checks; 2.1k); pat-b (constructor, pat, lib, diagnostics; 1.8k); pat-c (rustc.rs +
  rustc/print.rs; 1.2k).
- mt-skeleton (rustc_mir_transform lib.rs, pass_manager, simplify, trivial_const, required_consts, sanity_check, patch;
  2.5k): the "M4-0 MIR skeleton" of small-gaps-21 (`construct_error` lives in mb-mod).
- mt-built-lints (lint_and_remove_uninhabited, check_inline, check_call_recursion, check_packed_ref,
  check_const_item_mutation, check_mut_restriction, function_item_references, ffi_unwind_calls, lint_tail_expr_drop_order
  + rustc_middle significant_drop_order, diagnostics generated; 2.4k).
- mt-promote (promote_consts + check_consts/{mod, qualifs, resolver, post_drop_elaboration}; 2.1k); const-check
  (check_consts/{check, ops}; 1.7k).
- dataflow-move-paths (move_paths/*, drop_flag_effects, un_derefer, points, debuginfo; 1.5k); dataflow-impls (impls/*,
  rustc_peek, pretty.rs hook; 2.6k).
- mt-liveness (liveness.rs, 1.6k).

**Wave 23: borrowck (→ gate M4b) + the first const-eval wave (23b, parallel)**
- ✱`borrowck-contract`: `MirBorrowckCtxt` (lib.rs + used_muts, prefixes, borrowck_errors, diagnostics/*),
  `RegionInferenceContext` (region_infer/*, diagnostics/region_errors, var_name), `TypeChecker` (type_check/*),
  `BorrowCheckRootCtxt`.
- bck-lib-a / -b (lib.rs split at ~1400); bck-core (borrow_set, dataflow, places_conflict, path_utils, prefixes,
  place_ext, def_use, used_muts; 2.2k); bck-nll (nll, root_cx, renumber, consumers, universal_regions; 2.0k).
- bck-tc-a (type_check/mod.rs, 2.8k); bck-tc-b (relate_tys, free_region_relations, canonical, constraint_conversion,
  input_output, implied_bounds; 2.3k); bck-tc-live (type_check/liveness/* + trait_selection outlives_for_liveness; 1.9k).
- bck-regions-a (region_context, values, region_infer/mod; 2.5k); bck-regions-b (opaque_types/*, handle_placeholders,
  constraints/*, reverse_sccs, dump_mir, graphviz; 2.2k); bck-polonius (polonius next; 1.4k; D7).
- bck-diag-a / -b (conflict_errors split at ~2500); bck-diag-c (mutability_errors, var_name, find_use,
  find_all_local_uses; 2.4k); bck-diag-d (diagnostics/mod, move_errors; 2.9k); bck-diag-e (region_errors, region_name;
  2.5k); bck-diag-f (explain_borrow, bound_region_errors, opaque_types, outlives_suggestion, borrowck_errors; session
  diagnostics generated; 2.5k).
- mt-coroutine-b (coroutine/layout.rs with `mir_coroutine_witnesses`, coroutine/drop.rs; 1.1k): async/coroutine
  borrowck.
- harness-w23: `ckdump` probe + `src/rust_ts/ckdump.ts` + borrowck-ui suite.
- **23b (first const-eval wave)**: ✱`interp-contract` (interpret/machine, eval_context, mod; 1.6k); interp-memory (1.8k);
  interp-place-operand (2.1k); ctfe-a (eval_queries, error, mod, valtrees, dummy_machine, lib; 1.7k); fn-abi (ty_utils
  abi.rs + rustc_target callconv mod/x86_64 + passes abi_test; 2.2k). Target: the trivial-const stops (~24 +
  `const_eval_poly`) and mini_core_hello_world.rs under tydump/thirdump.

**Wave 24: rest of CTFE + runtime lowering (→ M4c-1)**
- interp-step-call (step, call, stack; 2.6k); interp-ops (operator, cast, discriminant, projection, traits, util,
  visitor; 2.4k); interp-intrinsics (intrinsics, atomic; 1.6k); interp-validity-intern (2.1k); ctfe-b (const_eval
  machine, dyn_trait, type_info; 1.9k); ctfe-util (util/*, diagnostics; 1.2k); interp-simd (0.9k, last).
- mt-cleanup (impossible_clauses, cleanup_post_borrowck, remove_noop_landing_pads, deref_separator, remove_uninit_drops,
  add_call_guards, post_analysis_normalize, add_subtyping_projections, abort_unwinding_calls, add_moves_for_packed_drops,
  erase_deref_temps, elaborate_box_derefs, lower_intrinsics, remove_place_mention, ctfe_limit, mentioned_items; 2.0k);
  mt-drops (elaborate_drops + elaborate_drop; 2.2k); mt-shim (shim.rs + async_destructor_ctor; 1.7k); mt-coroutine-a
  (coroutine/mod.rs StateTransform + by_move_body; 1.7k); mt-kpl-ubchecks (known_panics_lint, check_alignment,
  check_null, check_pointers, check_enums; 2.0k).

**Wave 25: optimized MIR at level 1 + driver (→ gate M4c = M4)**
- mt-opt1 (remove_storage_markers, remove_zsts, remove_unneeded_drops, multiple_return_terminators, simplify_branches,
  lower_slice_len, strip_debuginfo, prettify, instsimplify, unreachable_enum_branching, single_use_consts, copy_prop,
  ssa; 2.1k); mt-inline (inline + cycle + cost_checker + cross_crate_inline; 2.0k).
- driver-m4 (passes.rs `analysis` / `run_required_analyses` for real, pretty.rs Mir/MirCFG, `emit_mir`; rustc_graphviz +
  mir/graphviz for `mir-cfg`).
- harness-w25: mir-minicore, mir, mir-o0, thir-tree suites (D14).
- fixer lanes per failing file, as in wave 20.

**Wave 26: M4d (after gate M4, or alongside 25 when lanes are free; not gating)**
- mt-opt2-a/-b/-c/-d (level ≥ 2 passes + value_analysis, ≈ 9.3k); mt-validate (validate.rs + lint.rs); mt-coverage
  (coverage/*); vendor-datafrog + vendor-polonius-engine + bck-polonius-legacy (D7); dataflow graphviz; harness-mirop
  (tests/mir-opt sparse + suite, D10).

About 6 waves and ~85 lanes. M4a can gate after wave 22, M4b after wave 23, M4 after wave 25. Waves 23b and 24 only need
the wave-21 contracts and can overlap with 23.

## 6. Risks and probes

- **Probes**: `mirdump` (D2; M4a), `ckdump` (D2; M4b). Both rustc-dev, built like tydump; each header documents exactly
  which upstream steps it replaces. No new printing format: mirdump uses upstream's `write_mir_fn`.
- **Size**: ≈ 172k lines; borrowck diagnostics alone are ~16k and decide most of borrowck-ui (as error reporting did in
  M3).
- **Performance** (60 s per case): dataflow fixpoints over bit sets (D6), polonius-next's location-sensitive constraint
  graph and per-point liveness (`SparseIntervalMatrix` over every point × region), check_consts and coroutine
  witnesses (more dataflow), the interpreter's per-step allocations (`InterpResult` objects, bigint scalar math). The
  port already takes ~3.2 s for thirdump of mini_core.rs (oracle: well under 1 s). Measure early on the largest bodies
  (the files the hir-tree suites list as heavy, e.g. tests/ui/mir/issue-29227.rs) and keep bit ops on numbers.
- **Polonius next as the default**: the localized graph is new code in rustc (fewer users than NLL) and runs on every
  body; `-Zpolonius=off` and next revisions exercise both paths.
- **Region-inference determinism**: SCCs (graph/scc, ported), universal-region numbering, `'1`/`'2` naming order,
  buffered errors sorted by span before emission (`buffer_error`/`emit_errors`). Upstream iterates hash maps only at
  14 `potential_query_instability` sites in the M4 crates (borrowck 3, mir_transform 4, mir_dataflow 2, mir_build 4,
  pattern_analysis 1), each documented as order-insensitive; other `FxHashMap`/`FxHashSet` iteration keeps the
  hashbrown-order emulation (plan-m3 D6).
- **AllocId numbering** (D13): one extra, missing or reordered interning anywhere in the compilation shifts every later
  `allocN` in the output.
- **CTFE breadth**: error messages (const_eval/error.rs, interpret diagnostics) are byte-exact UI output; ui/consts (778
  files) and const-generics (805) exercise UB checks, `-Zunleash-the-miri-inside-of-you`, limits.
- **Floats**: bit-exactness depends on the apfloat port (D9).
- **In-place mutation**: MIR passes mutate bodies; a missed `clone_<T>` aliases nodes between `mir_for_ctfe` and
  `optimized_mir` of const fns or between promoteds. Codegen'd clones + review focus.
- **Coroutines**: StateTransform and witnesses gate ui/async-await (459) and ui/coroutine (155).
- **Two solvers stay live**: borrowck's type ops (`type_op_*`, `dropck_outlives`, canonical queries) go through both
  the old solver (compiletest's `-Znext-solver=coherence`) and the next solver (plain invocations).
- **Harness**: `-o` in compiletest argv redirects `-Zunpretty` output (D14); the `mir` suite is ~21.5k cases and needs
  the bundled port for a tolerable gate time.

Critical files: rustc_interface/src/passes.rs (1100–1290), rustc_driver_impl/src/pretty.rs, rustc_middle/src/mir/{mod,
syntax,visit,pretty}.rs, rustc_mir_transform/src/{lib,pass_manager}.rs, rustc_mir_build/src/builder/mod.rs,
rustc_borrowck/src/{lib,nll}.rs, rustc_borrowck/src/region_infer/region_context.rs, rustc_mir_dataflow/src/framework/mod.rs,
rustc_const_eval/src/interpret/{machine,eval_context}.rs, rustc_const_eval/src/const_eval/eval_queries.rs,
harness/suites.ts, harness/compiletest.ts.

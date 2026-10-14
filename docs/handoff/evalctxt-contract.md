# Handoff: evalctxt-contract (wave 16, M3, contract-first): rustc_next_trait_solver

Branch `lane/evalctxt-contract` (from main 00ce463, no merges). Commits: WIP decls + delegate.rs + solve/* stubs;
canonical/coherence/normalize/placeholder stubs + lib.ts; contract test; this handoff.

## Files (all new, under `src/rustc_next_trait_solver/`)
- **Contract:** `decls.ts`. It holds:
  - `class EvalCtxt` with every field of `struct EvalCtxt` (eval_ctxt/mod.rs:103), constructor in declaration order;
  - `declare static enter_root` / `enter_canonical`;
  - `interface EvalCtxt` with all 114 methods, grouped by file in module order, each under `// <file>:<line>`.
  - Comment lines for the fns of structs local to `EvalCtxt` methods: `ContainsTermOrNotNameable`, `RawAssumptions`
    and `ReplaceOpaque`.
- **Ported:**
  - `lib.ts`: the crate root. lib.rs has no fns; the file holds the module tree and the load order.
  - `delegate.ts`: delegate.rs 16/16. `SolverDelegate` interface (the 13 required items carry their markers),
    `SolverDelegate_static`, and `SolverDelegate_provided` (`cx`, `obtain_canonicalizer_state`,
    `release_canonicalizer_state`).
  - `solve/inspect/mod.ts`: the module structure only (the file has no fns).
  - **Trait declarations** whose required items carry markers in the interface (infer_ctxt.ts precedent):
    - `GoalKind` (31 required, assembly/mod.ts);
    - `SolverDelegateEvalExt` (5, eval_ctxt/mod.ts);
    - `ResponseT` (1, canonical/mod.ts).
  - **All types of the crate,** with their derived `Debug` where upstream derives it:
    - solve/mod.ts: `HasChanged`, `MergeCandidateInfo`, `GoalEvaluation`, `FIXPOINT_STEP_LIMIT`;
    - eval_ctxt/mod.ts: `CurrentGoalKind`, `GenerateProofTree`, `RerunDecision`;
    - fast_path.ts: `RerunStalled`;
    - assembly/mod.ts: `Candidate`, `AssembleCandidatesFrom`, `FailedCandidateInfo`, `AllowInferenceConstraints`;
    - structural_traits.ts: `AsyncCallableRelevantTypes`, `AmbiguousOrRerunNonErased`;
    - trait_goals.ts: `TraitGoalProvenVia`;
    - inspect/build.ts: `WipEvaluationStep`, `WipProbe`, `WipProbeStep`;
    - canonicalizer.ts: `NEEDS_CANONICAL`, `CanonicalizeInputKind`, `CanonicalizeMode`;
    - coherence.ts: `InCrate`, `OrphanCheckMode`, `Conflict`, `IsFirstInputType` (+ trivial traversal),
      `OrphanCheckErr`, `UncoveredTyParams`, `OrphanCheckEarlyExit`;
    - normalize.ts: `HasEscapingBoundVars`, `NormalizationWasAmbiguous`;
    - search_graph.ts: `SearchGraph`, `SearchGraphDelegateTypes`, and the delegate consts.
- **Stub modules,** one per upstream file:
  - `solve/{mod,search_graph,trait_goals,effect_goals,normalizes_to}.ts`;
  - `solve/eval_ctxt/{mod,fast_path,probe,solver_region_constraints}.ts`;
  - `solve/assembly/{mod,structural_traits}.ts`;
  - `solve/inspect/build.ts`;
  - `solve/project_goals/{mod,anon_const,free_alias,inherent,opaque_types}.ts`;
  - `canonical/{mod,canonicalizer}.ts`, `coherence.ts`, `normalize.ts`, `placeholder.ts`.
- **Test:** `contract.test.ts` (6 tests, 239 expects).

Nothing outside `src/rustc_next_trait_solver/` and this handoff was touched. No infcx-contract file was touched.

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `bun scripts/coverage.ts --check` gives `markers ok (12311; vendor 3888)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4494 pass, 1 skip (pre-existing), 0 fail.
- Every module of the crate loads as a fresh-process entry point (`bun -e "await import(..)"`, all 27).
- No difftest suite reaches the solver yet: nothing outside the crate imports it. A sample difftest would only re-run
  untouched code, so none was run.
- **Contract test.** It checks:
  1. the impl-block scan agrees with coverage.ts's fn finder (425 fns);
  2. all 116 `impl EvalCtxt` fns are declared in decls.ts at their `file:line`;
  3. each of the other 309 fns has one of: a marker, a decls comment line, a stub in its mirrored module, or a
     `// <file>:<line> <Type>::<name>` comment (fns of structs local to a free fn);
  4. after loading lib.ts, the 114 methods and 2 statics exist, and a stub throws `Unported` with its path;
  5. each `GoalKind` table has every trait item, and every upstream impl fn is an entry of its table;
  6. the delegate.rs provided methods behave as upstream.
- **Negative controls.** Removing one decls line fails tests 2 and 4; removing a name from a stub list fails test 4.

## Coverage (`bun scripts/coverage.ts --crate rustc_next_trait_solver`): 53/425
| file | ported | what |
|---|---|---|
| delegate.rs | 16/16 | trait + provided methods |
| solve/assembly/mod.rs | 31/55 | `GoalKind` required items (trait declaration) |
| solve/eval_ctxt/mod.rs | 5/76 | `SolverDelegateEvalExt` trait declaration |
| canonical/mod.rs | 1/22 | `ResponseT::var_values` (trait declaration) |
| lib.rs, solve/inspect/mod.rs | 0/0 | module structure ported |
| every other file | 0 | stubs |

## Lane split (the plan's nts-* lanes; ≤ ~3k upstream lines each)
| lane | upstream files (compiler/rustc_next_trait_solver/src/) | lines | fns left |
|---|---|---|---|
| nts-eval | solve/eval_ctxt/mod.rs, solve/eval_ctxt/fast_path.rs, solve/eval_ctxt/probe.rs, solve/eval_ctxt/solver_region_constraints.rs, solve/search_graph.rs | 2782 | 71 + 4 + 8 + 8 + 9 |
| nts-assembly | solve/assembly/mod.rs, solve/assembly/structural_traits.rs | 2586 | 24 + 16 |
| nts-trait-goals | solve/trait_goals.rs | 1787 | 48 |
| nts-normalizes | solve/normalizes_to.rs, solve/project_goals/{mod,anon_const,free_alias,inherent,opaque_types}.rs, solve/effect_goals.rs, solve/mod.rs | 2615 | 37 + 7 + 32 + 18 |
| nts-canonical | canonical/mod.rs, canonical/canonicalizer.rs, placeholder.rs, coherence.rs, normalize.rs, solve/inspect/build.rs | 2564 | 21 + 14 + 14 + 11 + 7 + 23 |
| (done here) | lib.rs, delegate.rs, solve/inspect/mod.rs | 155 | 0 |

**Notes on the split:**
- The plan put solve/mod.rs, search_graph.rs, inspect/build.rs and normalize.rs in no lane. They are assigned above.
  - solve/mod.rs goes with nts-normalizes because of its `structurally_normalize_*` and `compute_*_goal` fns.
  - inspect/build.rs and normalize.rs go with nts-canonical, because they are canonical-state and folder code.
- delegate.rs was in nts-canonical; it is done here.
- **Dependencies:**
  - Everything goes through nts-eval: `enter_root`, `probe`, `evaluate_added_goals_and_make_canonical_response`,
    `add_goal`, and so on. The other lanes can port against the stubs, but runs stop UNPORTED until nts-eval lands.
  - nts-eval also needs nts-canonical's `canonicalize_goal` / `instantiate_and_apply_query_response` and the
    inspect builders.
  - The solver is only reachable from rustc_trait_selection's `SolverDelegate` impl and its `FulfillmentCtxt`
    (wave 17, trait-sel-solve). Until then nothing can drive it, and the lanes test with unit tests or rustc-dev
    probes (tyir-solve's `oracle/main.rs` pattern).

## Contract rules for the nts-* lanes
1. **Where the declarations live.**
   - `decls.ts` holds `EvalCtxt` (class + methods). It is root's from now on; do not edit it. Write a missing or wrong
     declaration in your handoff.
   - If you cannot type-check without the change, add a local `declare module "../decls.ts"` in your file, marked
     `// PORT(decls): pending root`.
   - Every other item is declared in its own mirrored module with its final signature.
2. **How to fill a stub.**
   - **`EvalCtxt` methods.** Write `EvalCtxt.prototype.<name> = function (this: EvalCtxt, ..): R { .. };` with the
     `// rustc: compiler/rustc_next_trait_solver/src/<file>:<line> <name>` marker above it, in upstream order. Then
     delete the name from the file's `unported_methods(EvalCtxt.prototype, ..)` list, and delete the call when the
     list is empty.
     - The statics are `EvalCtxt.enter_root = function ..` / `EvalCtxt.enter_canonical = function ..`. Delete them
       from the `unported_methods(EvalCtxt, ..)` call in eval_ctxt/mod.ts.
     - The extension file needs `import { EvalCtxt } from "<rel>/decls.ts"` (already there).
   - **Free fns, companion entries, class methods and statics, `GoalKind` table entries.** These are stubs with
     their final signature: replace the `unported(..)` body in place, rename the `_param`s back, and add the marker.
     Keep each fn where upstream has it. A class's methods may stay in the class body (PORTING §8).
   - **Local structs** (`ContainsTermOrNotNameable`, `NonTrivialVars`, `RawAssumptions`, `ReplaceOpaque`, and the
     nested fn `trait_def_id_matches`) are ported inside their enclosing fn, with markers on their fns. Delete the
     decls/module comment line for them only if root agrees; the contract test accepts either.
   - **Provided trait methods that an impl does not override** (`GoalKind_provided` forwarders in the tables,
     `TypeFolder_provided` / `FallibleTypeFolder_provided` / `TypeVisitor_provided` / `TypeRelation_provided`
     forwarders in folder classes) are plumbing, not upstream fns. Leave them.
   - **Keep contract.test.ts green.** Its counts change only when declarations change (root).
3. **Init order.** Breaking these rules gives a TDZ `ReferenceError` at load.
   - lib.ts is the crate root. It imports decls.ts first, then every module.
   - A module's **top-level code** may touch only decls.ts (`EvalCtxt`) and other crates. Read every other
     rustc_next_trait_solver export inside function bodies only. The `GoalKind` tables' forwarders read
     `GoalKind_provided` lazily for this reason.
   - Import rustc_type_ir values from the hand modules (`solve/mod.ts`, `predicate.ts`, `lib.ts`, `term_kind.ts`),
     never from `*.gen.ts`. Entering a `.gen.ts` first hits a TDZ (`SmallCopySet`); every module here loads as an
     entry point only because of this.
   - Consumers outside the crate import `src/rustc_next_trait_solver/lib.ts` only (`solve.EvalCtxt`,
     `solve.SolverDelegateEvalExt_for_D`, `delegate.SolverDelegate`, ...).
4. **Representation** (PORTING §5, plan D3/D4).
   - **`I` is erased.**
     - `I::Ty` = `Ty`, every `I::*Id` = `DefId`, `Region<I>` / `Const<I>` = rustc_type_ir's `Region` / `Const`.
     - **`cx: I` is `TyCtxt`** in this crate: `EvalCtxt::cx()`, `TypeFolder::cx`, free fns. This matches
       `InferCtxtLike.cx(): TyCtxt`.
     - Interner methods whose names clash are `ir_*` on `TyCtxt` (interner.ts header).
   - **`D: SolverDelegate` is the `SolverDelegate` interface** (delegate.ts).
     - The `Deref<Target = Infcx>` supertrait is `deref()`: `self.delegate.shallow_resolve(ty)` is
       `this.delegate.deref().shallow_resolve(ty)`. `self.delegate.cx()` is the delegate's own `cx()`.
     - Associated fns without `self` are on `SolverDelegate_static`. Code with no `D` value takes the table first
       (`EvalCtxt.enter_canonical(D, ..)`, `evaluate_root_goal_for_proof_tree_raw_provider(D, ..)`). Code holding a
       delegate reaches it as `delegate.Self`. `SearchGraph::<D>::new(depth)` is
       `SearchGraph.new(SearchGraphDelegate(delegate.Self), depth)`.
     - `Default::default()` of `D::Infcx::OpaqueTypeStorageEntries` is `D.OpaqueTypeStorageEntries_default()`.
   - **`G: GoalKind<D>`.**
     - The impl table interface is `GoalKind<G>`, which extends `TypeFoldable<G>` plus `eq` and `display`. The impls
       are `GoalKind_TraitClause`, `GoalKind_HostEffectClause` and `GoalKind_NormalizesTo`.
     - Generic code takes the table as a value parameter named `G`, last: `G::probe_and_match_goal_against_assumption(
       ecx, ..)` is `G.probe_and_match_goal_against_assumption(ecx, ..)`.
     - The provided bodies go in `GoalKind_provided.<name>(G, ..)`. The tables already forward to them, and
       `GoalKind_NormalizesTo` overrides `probe_and_consider_object_bound_candidate`.
   - **D4.** `T: TypeFoldable` / `TypeVisitable` / `Relate` / `ResponseT` take the descriptor `d_T` last.
   - **Closures.** `impl FnOnce(&mut EvalCtxt<'_, D>) -> R` is `(ecx: EvalCtxt) => R`.
   - **`&mut` arguments.** `&mut Vec` and `&mut` structs are mutated in place. `&mut Result` / `&mut (..)` out-params
     are `MutRef` (`maybe_evaluate_root_goal_*`).
   - **Struct literals.** `EvalCtxt { .. }` (in `enter_root`, `enter_canonical`, `ProbeCtxt::enter_inner`) is
     `new EvalCtxt(..)` with all 12 fields in declaration order.
   - **`ProofTreeBuilder::state`** (`Option<Box<Option<Probe>>>`) is `MutRef<Probe | undefined> | undefined`.
     `EvaluationStepBuilder::state` is `WipEvaluationStep | undefined`.
   - **Struct-keyed maps.**
     - placeholder.rs's `IndexMap<Placeholder*, Bound*>` maps must be built as `KeyedMap(intern_key)`.
     - `ReplaceProjectionWith::mapping` is a `DefIdMap`.
     - canonicalizer.rs's two `HashMap`s at :164 / :184 are D6 sites: insertion order is acceptable.
   - **Derived `PartialEq` of plain values** (e.g. `GoalKind.eq`) is `intern_key(a) === intern_key(b)`.

## For infcx-contract / wave 17 (the `SolverDelegate` implementor)
- rustc_trait_selection `solve/delegate.rs` `struct SolverDelegate<'tcx>(InferCtxt<'tcx>)` should be a class with:
  - `_0: InferCtxt` and `deref() { return this._0; }`;
  - every required method of delegate.ts's interface;
  - forwarders to `SolverDelegate_provided` for `cx` / `obtain_canonicalizer_state` /
    `release_canonicalizer_state` unless it overrides them (upstream overrides the canonicalizer-state pair);
  - a `Self` member pointing at its static table (`build_with_canonical`, `OpaqueTypeStorageEntries_default`).
- `InferCtxt` must satisfy rustc_type_ir's `InferCtxtLike` (tyir-misc's interface). The solver only sees it through
  `deref()`.

## `unported(...)` left
- Every stub listed above: `EvalCtxt` method placeholders and the bodies of free fns, class methods, companion
  entries and `GoalKind` table entries.
- Two stand-ins that are not stubs of this crate's fns:
  - `debug_CandidateHeadUsages` (assembly/mod.ts). The derived `Debug` of rustc_type_ir's `CandidateHeadUsages` was
    not ported by tyir-solve; only `debug_Candidate` / `debug_FailedCandidateInfo` reach it.
  - `fold_AsyncCallableRelevantTypes` (structural_traits.ts). That type's derived `TypeVisitable_Generic` /
    `TypeFoldable_Generic` belong to codegen (PORTING §5); see "For root".

## PORT decisions (please record)
1. **Layout.** Contract-first, following res-lib, lowering-contract and ty-contract:
   - decls.ts holds the split class `EvalCtxt`;
   - every other item lives in its mirrored module with its final signature;
   - `unported_methods` placeholders for `EvalCtxt` (statics included);
   - the init-order rule above.
2. **`SolverDelegate` representation** as above: interface, `deref()` for the `Deref` supertrait,
   `SolverDelegate_static` with `build_with_canonical` and the `OpaqueTypeStorageEntries` default, the `Self` member,
   and `SolverDelegate_provided`.
3. **`cx` is `TyCtxt`** in the solver. The search graph's `Delegate` table types `cx` as `Interner` (`InternerCx`), so
   `SearchGraphDelegate.compute_goal` has to convert. `TyCtxt` is not assignable to `Interner` yet: tsc says
   `generics_of(...)` returns `unknown`.
4. **`impl search_graph::Delegate for SearchGraphDelegate<D>`** is a fn table built per `D` by
   `SearchGraphDelegate(D)`, memoized so `SearchGraph._marker` is stable. `compute_goal` is the only fn that needs
   `D`.
5. **`GoalKind`** is an impl table interface with `G` passed last (above). Provided methods take the table first.
6. **`SolverDelegateEvalExt`** (blanket impl) is the `SolverDelegateEvalExt_for_D` object with `self` first
   (`RelateExt_for_Infcx` precedent).
7. **`ResponseT`** is a descriptor (`ResponseT_Response`, `ResponseT_State`).
8. **Generic over `Infcx`.** coherence.ts, normalize.ts and placeholder.ts take the `InferCtxtLike` interface. The
   `E: Debug` bounds are erased because only tracing formats `E`.
9. **`From` impls** are companion entries: `AmbiguousOrRerunNonErased.from_RerunNonErased`, `IsFirstInputType.from`.
10. **Debug for fieldless enums** is the variant name. Derived struct and enum Debug impls are hand-written with
    std/fmt builders (PORTING "Traits"). Derived `PartialEq` of `WipEvaluationStep` / `WipProbe` / `WipProbeStep`
    is not ported, because nothing compares them.

## For root
1. **Record the decisions** and point the wave-16 nts-* lanes at "Contract rules" and the split table.
2. **Brief vs. pin.** At the pin there is no `resolve.rs`, no `alias_relate.rs` and no `SolverMode` in this crate.
   - `GoalSource` is rustc_type_ir's and is already generated.
   - normalize.rs exists and is assigned to nts-canonical.
3. **tools/codegen:** add `AsyncCallableRelevantTypes` (structural_traits.rs:420, `derive(TypeVisitable_Generic,
   TypeFoldable_Generic)`) to a codegen set, then replace the stand-in `fold_AsyncCallableRelevantTypes`.
   - Optionally generate the crate's other types too. The hand-written ones here keep the PORTING §5 shapes a
     generator would emit.
4. **rustc_type_ir:** port `Debug` for `CandidateHeadUsages`, then drop the stand-in in assembly/mod.ts.
5. **TyCtxt ⊄ Interner:** once `generics_of` is typed, `SearchGraphDelegate.compute_goal` can pass `cx` without a
   cast.
6. Delete `docs/claims/evalctxt-contract.md` on integration, if one exists.

## Full test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4494 pass, 1 skip (the pre-existing linux-only one),
0 fail (4495 tests, 271 files).

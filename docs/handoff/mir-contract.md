# Handoff: mir-contract (M4 wave 21, contract-first): the MIR data-structure contract (plan-m4 D3 / D4)

Branch `lane/mir-contract` (from `970d2365`, no merges). Commits: codegen set + hand modules with stubs → init order, importer
repointing, TyCtxt installers, typed query values, `mk_place_elem` → contract test → this handoff.

## Result
- **Codegen set `rustc_middle_mir`** (types.sets.json; replaces the THIR-only sets `rustc_middle_mir_syntax` /
  `rustc_middle_mir_query`, which are removed): every type of mir/{mod, syntax, statement, terminator, consts, query,
  coverage, basic_blocks, traversal, visit, pretty}.rs and mir/interpret/{mod, allocation, allocation/init_mask,
  allocation/provenance_map, value, pointer, error, queries}.rs → 17 `*.gen.ts`, 168 types with derived Debug / Clone /
  TypeVisitable / TypeFoldable (`auto_class`: structs with inherent impls are classes: `Body`, `BasicBlocks`, `LocalDecl`,
  `BasicBlockData`, `SourceScopeData` (forced), `Place`, `Statement`, `Terminator`, `SwitchTargets`, `ConstOperand`,
  `Location`, `Pointer`, `InitMask`, ...). Report: 0 unknown types, 0 missing Clone but `DenseBitSet` (Preorder's derived
  Clone: index-ds reworks bit sets), 4 missing Debug (`Backtrace`, `Utf8Error`, `dyn MachineStopType`, `Dominators`
  placeholder), 22 manual Debug impls (all declared, see below).
  - Hand types (`hand` in the set): `AllocId` (branded number), `AllocMap`, `Allocation` (D8: `Bytes = Uint8Array`),
    `ConstAllocation` (frozen `Interned`), `CtfeProvenance` (branded bigint), `SwitchTargetsIter`, `helper::Successors`
    (double-ended iterator class), `MirDumper`, `MirWriter`, `ExtraComments` / `VisitPlacesWith` (extend `Visitor`).
    `InterpResult` is `skip` + hand alias (D8: `Result<T, InterpErrorInfo>`).
  - Set-local `tools/codegen/mir.typemap.json` (IndexSlice, Size, Instance/InstanceKind, CoroutineKind, user type
    annotations, BitMatrix/DenseBitSet, Dominators placeholder, OnceLock/SortedMap/Either/Spanned with working
    Debug/Clone templates, LayoutError via a lazy Debug, `ty::Const` imported as `ty_Const`) with a set-local
    `type_fold` section.
- **Every fn of the scope files is declared** (715 upstream fns; `src/rustc_middle/mir/contract.test.ts`, scan = coverage):
  ported (`// rustc:` / `// rustc-skip:` for the 8 `Encodable` impls) or `// stub: <path>:<line> <name> (lane <lane>)`
  directly over its final signature with body `unported("rustc_middle::mir::<module>::<Type>::<name>")`. Stubs per lane:
  mir-body-a 103, mir-body-b 181, mir-visit 125, mir-pretty 43, mir-interp-a 91, mir-interp-b 184.
- **Ported here (contract glue)**: basic_blocks.rs 15/15 (`BasicBlocks::new`, the lazy caches `predecessors` /
  `reverse_postorder` / `dominators`, `as_mut` / `as_mut_preserves_cfg` / `invalidate_cfg_cache`, `Deref`, the graph trait
  impls, `Cache`'s Decodable / StableHash), syntax.rs 4/4, mod.rs `HasLocalDecls` (4) + `Location` Debug + `Location::START`,
  interpret/mod.rs `AllocId` Display/Debug, `ConstAllocation::inner`, the trait declarations of `AllocBytes` / `Provenance`.
- **D4**: visit.rs's `make_mir_visitor!` hand-expanded twice into the classes `Visitor` / `MutVisitor` (every method a
  stub for mir-visit, carrying the macro fn's line, so each macro fn has two declarations); `visit_place_fns!(mut)` /
  `extra_body_methods!(mut)` only in `MutVisitor` (`tcx()` abstract), `visit_place_fns!()` only in `Visitor`.
  `MutVisitor` callbacks of `&mut` Copy leaves (`Local`, `Ty`, `ty::Const`, `Region`, `Span`, `SourceScope`, `Variance`,
  `GenericArgsRef`) take `MutRef<T>`.
- **Queries typed** (queries.gen.ts regenerated; queries.config.json aliases for mir re-exports): `mir_built`,
  `mir_drops_elaborated_and_const_checked`: `Steal<Body>` (rustc_data_structures `Steal`: a double steal is the same ICE);
  `mir_promoted`: `[Steal<Body>, Steal<Body[]>]`; `optimized_mir`, `mir_for_ctfe`, `mir_shims`: `Body`; `promoted_mir`:
  `Body[]`; `mir_const_qualif`: `ConstQualifs`; `mir_coroutine_witnesses`: `CoroutineLayout | undefined`; `eval_to_*`:
  `PseudoCanonicalInput<GlobalId>` → `EvalTo…Result`; `trivial_const`: `[ConstValue, Ty] | undefined`;
  `vtable_allocation`: `AllocId`; `coverage_codegen_info`. Still `unknown`: `mir_borrowck`'s
  `DefinitionSiteHiddenType` (ty/mod.rs, not generated) and `thir_body`'s `Thir`.
- `tcx.mk_place_elems` (existing interner) now interns real `PlaceElem`s; `mk_place_elem` (+ `mk_place_field/deref/
  downcast/index`) builds a `mir::Place`; structural_impls.ts's `PlaceElem` fold stand-in is the generated
  `ProjectionElem` fold over `Local` (trivial) and `Ty`; `visit/try_fold/fold_with_Spanned` and `_PlaceElems` wrappers
  added; ty/decls.ts's `Pending` mir types (`Body`, `PlaceElem`, `ProjectionKind`, `Allocation`, `ConstAllocation`,
  `CoroutineLayout`) are type re-exports of the real ones; ty/sty.ts's two `CoroutineLayout` field stand-ins read the fields.

## For the harness-w21 seams (src/rust_ts/mirdump.ts on lane/harness-w21)
- `write_mir_fn(tcx, body)`: `new MirWriter(tcx, ..)` / `MirWriter.new(tcx)` + `.write_mir_fn(body, w)` in
  `rustc_middle/mir/pretty.ts` (`w`: vendor/anstream `Write`, returns `IoResult<void>`; a `Vec<u8>` writer is the lane's
  glue); `write_mir_pretty(tcx, w)` is there too (stubs, lane mir-pretty).
- `clone_body` / `clone_promoted`: `clone_Body(body)` and `promoted.map(clone_Body)` (generated, mir/mod.ts) — real now.
- `display_const_val(val, ty)`: `display_Const({ $: "Val", _0: val, _1: ty })` (consts.ts, stub lane mir-body-b) or
  `pretty_print_const_value(val, ty, fmt)` (pretty.ts, stub lane mir-pretty).
- Import mir through `rustc_middle/lib.ts` (`mir` namespace), `mir/mod.ts` or `mir/pretty.ts` (see "Init order").

## Representation decisions (please record)
1. **Classes / companions.** Generated classes get methods by prototype assignment in the hand module of the file that
   defines the fn (`declare module "./syntax.gen.ts" { interface Place { .. } }` in statement.ts); statics via `namespace`
   augmentation + `(X as unknown as {..}).f = ..` (`new` → `new_`, `null` → `null_`). Enum / newtype-index / branded
   types get companion methods (PORTING §8): the companion is the generated object (or `{}` when the enum has no unit
   variant) typed with an augmentable `X_methods` interface, defined in the type's hand module (syntax.ts for all
   syntax.rs enums) and filled by the modules that define the fns.
2. **Method/field name clash → the method gets `_`** (precedent `tcx_()`): `Body::local_decls()` (the `HasLocalDecls`
   impl) / `required_consts()` / `mentioned_items()`, `LocalDecl::local_info()`, `BasicBlockData::terminator()`,
   `Allocation::init_mask()` / `provenance()`, `ProvenanceMap::ptrs()` → `local_decls_()`, ..., `ptrs_()`.
3. **Trait impls**: `Debug` → `debug_X: Debug<X>` (generic: `debug_X(v, f, debug_P)`); `Display` → `display_X(self)`;
   `From<A> for B` → `B_from_A(a)`; `Decodable` → `decode_X(d: TyDecoder, decode_T..)`; `Encodable` → `rustc-skip`; `Hash` →
   `hash_X(self, state)`; `Index`/`Deref`/`Iterator` → methods `index`/`deref`/`next`; trait objects / generic traits
   → descriptors (`Provenance_CtfeProvenance`, `AllocBytes_Box`, `PointerArithmetic_provided`, `MachineStopType_provided`);
   `HasLocalDecls` → the union `LocalDecl[] | Body` + `HasLocalDecls.local_decls(d)`; `impl Atom for Local` →
   `Atom_index_Local`. The manual `Debug` impls that live in pretty.rs (`Place`, `Operand`, `Rvalue`, `ConstOperand`,
   `StatementKind`, `Statement`, `StmtDebugInfo`, `TerminatorKind`, `Terminator`, `PlaceRef`, `VarDebugInfo`) are stubs in
   pretty.ts; the types' own hand modules export `debug_X` forwarders to them (lazy `require`).
4. **Shapes**: `Box<(Place, Rvalue)>` is the `[Place, Rvalue]` tuple object (`as_assign_mut` hands it out); `IndexVec` /
   `IndexSlice` / `SmallVec` are arrays; `D: HasLocalDecls` params are `HasLocalDecls`; `&mut BasicBlock` /
   `&mut UnwindAction` handed out are `MutRef`s (`successors_mut`, `unwind_mut`); `impl Iterator` returns are
   `IterableIterator<T>` (arrays when `ExactSizeIterator + DoubleEndedIterator`); the `Iterator` impls are JS iterators
   (`next(): IteratorResult<T>`, precedent `DepthFirstSearch`); `Successors` is a double-ended iterator class (`next`,
   `next_back`, `len`, `rev`); `&mut Formatter` written-only params → the fn returns the text; `W: fmt::Write` /
   `&mut dyn fmt::Write` → vendor/anstream `FmtWrite` / `FmtResult`; `&mut dyn io::Write` → its `Write` / `IoResult`.
5. **interpret (D8)**: `Prov` stays a type parameter with upstream's default (`Pointer<Prov = CtfeProvenance>`,
   `Scalar<Prov = ..>`, `Allocation<Prov = CtfeProvenance, Extra = null, Bytes = Uint8Array>`); generic code finds the
   `Provenance` impl with `provenance_of(prov)` (bigint → `CtfeProvenance`, number → `AllocId`); `u64`/`i64`/`u128`/`i128`
   values that may exceed 2^53 are `bigint` (target usize bounds, addresses, `Scalar::from_u64` / `to_u64` ...); `Size` stays a
   number; apfloat types (`Half`, `Single`, `Double`, `Quad`) are `Pending` placeholders (vendor-apfloat lanes, D9);
   `InterpResult` methods / `Try` impls are `InterpResult.*` companion fns.
6. **`BasicBlocks`**: `cache: Arc<Cache>` is shared by `clone_BasicBlocks`; `invalidate_cfg_cache` always installs a fresh
   cache; the inherent `predecessors()` and `graph::Predecessors::predecessors(node)` share the prototype slot (overload);
   `dominators` calls a local `unported(.. lane index-ds)` until `graph/dominators` lands (`Dominators<N>` placeholder type in
   basic_blocks.ts).
7. **Init order** (TDZ-free; checked by contract.test.ts):
   - R1: mir/ is entered through `mir/mod.ts`, whose first import is `./syntax.ts`; every other mir hand module starts with
     `import "./mod.ts"` (`"../mod.ts"`, ...). `syntax.ts` is never a fresh entry (it is extended by statement.ts /
     terminator.ts / mod.ts / pretty.ts); outside mir/ import `mir/mod.ts` (or the other modules listed in the test).
   - R2: mir/ is in ty/context.ts's import closure (infer/canonical.gen.ts → mir/query.ts), so no mir module touches
     `TyCtxt` at load: the `impl TyCtxt` methods of consts.rs / interpret/mod.rs / interpret/queries.rs are assigned inside
     each module's `install_TyCtxt_methods()`, called by rustc_middle/lib.ts after its imports.
   - R3: `pretty.ts` (extends `Visitor` at load) is not re-exported by mod.ts (mod.rs's `pub use self::pretty::{..}`): import
     `rustc_middle/mir/pretty.ts`.
   - R4: consts.ts, coverage.ts and interpret/* are evaluated while syntax.gen.ts is: they read statement.ts /
     terminator.ts / pretty.ts / traversal.ts / basic_blocks.ts / visit.ts lazily (`require`), never at load.
8. **Tools**: `tools/codegen/types.ts` learned `"Name as Alias"` in type-map `types` / `values` and type-fold fn names, and a
   set-local `type_fold` section in `typemap_extra` files (needed for mir's `Const` vs `ty::Const`; also what errctxt-contract's
   follow-up (c) asked for). Regenerating every set: the only diff is thir.gen.ts's import path (`./mir/mod.ts`).

## Split table (fill lanes, wave 21; upstream lines)
| lane | upstream (compiler/rustc_middle/src/mir/) | lines | stubs | notes |
|---|---|---|---|---|
| mir-body-a | mod.rs (all but the ported glue), traversal.rs, query.rs, coverage.rs | ~2570 | 103 | `Body::new` / `LocalDecl::new` / `BasicBlockData::new*` / `SourceInfo::outermost` first (MIR build, wave 22); `traversal::Postorder` (reverse_postorder cache); Decodable of `ClearCrossCrate` |
| mir-body-b | statement.rs, terminator.rs, consts.rs, pretty.rs:874..1437 (Debug / Display of statements, terminators, rvalues, operands, places, `fmt_head`, `fmt_successor_labels`, `pre/post_fmt_projection`) | ~3080 | 181 | `TerminatorKind::successors` / `mk_successors` (BasicBlocks caches and graph impls need it), `Place`/`Operand` helpers, `mir::Const` (`display_Const` = harness seam), `span_as_caller_location` inside `install_TyCtxt_methods` |
| mir-visit | visit.rs | 1493 (~3k TS) | 125 | both expansions; `super_*` walkers write `MutRef` leaves back (`field_mut`); `PlaceContext`, `VisitPlacesWith` |
| mir-pretty | pretty.rs:1..873 + :1438..2097 | ~1530 | 43 | `MirWriter::write_mir_fn` / `write_mir_pretty` (harness seams), `MirDumper` / `dump_mir` (D11), allocation printing (`write_allocations`, `RenderAllocation`), `pretty_print_const_value` |
| mir-interp-a | interpret/allocation.rs, allocation/init_mask.rs, allocation/provenance_map.rs | 2034 | 91 | `Allocation` (Uint8Array bytes), `InitMask` (D6 32-bit words), `ProvenanceMap`; Decodable impls (metadata `ConstAllocation`) |
| mir-interp-b | interpret/{mod, value, pointer, error, queries}.rs | 2775 | 184 | `AllocMap` + **the missing `GlobalCtxt.alloc_map` field** (context.rs:784/:986, add in ty/context.ts with `AllocMap.new()`), `reserve_*` (D13 order), `Scalar`, `CtfeProvenance` bits, `InterpErrorInfo` / `InterpResult`, `const_eval_*` (queries.rs) |
| — | (done here) basic_blocks.rs, syntax.rs, HasLocalDecls, Location Debug, AllocId Display/Debug, ConstAllocation::inner | | | |

## How to fill a stub
1. `grep -rn "// stub: compiler/rustc_middle/src/mir/<file>:<line> <name>" src` (or `bun scripts/coverage.ts --missing
   <path>`). Keep the signature; a wrong one goes in your handoff (or fix it and say so: declarations are root-owned after
   integration).
2. Replace the body in place (prototype assignment / companion assignment / class body / free fn / descriptor member) and
   turn the comment into `// rustc: <path>:<line> <name>`. Module-level stubs of nested fns move inside their parent.
   `impl TyCtxt` methods stay inside `install_TyCtxt_methods()`.
3. Conventions: "Representation decisions" above; module headers repeat the local ones.
4. Init order: R1-R4 above; keep the first-import line of each mir module; new cross-module reads at load are not allowed.
5. `src/rustc_middle/mir/contract.test.ts`: lower your lane's stub count as you port; the fresh-entry list must keep loading.

## `unported(...)` left
- 727 stub bodies (715 fns, visit.rs's macro fns twice) in the lanes above; `dominators` (rustc_data_structures, lane
  index-ds) in basic_blocks.ts.
- Generated: `unported_debug` for `Backtrace`, `Utf8Error`, `dyn MachineStopType`, `Dominators`; `unported_clone` for
  `DenseBitSet` (Preorder / MonoReachable Clone).

## Stand-ins outside mir/ left for their owners (root / the interp lanes)
ty/adt.ts (`const_eval_poly`, `ErrorHandled`, `ReportedErrorInfo` → `tcx.const_eval_poly`, `ErrorGuaranteed_from_ReportedErrorInfo`),
ty/codec.ts (`AllocId`, `CtfeProvenance::from_parts`, `Decodable for Allocation`), ty/print/pretty.ts (`Pointer`,
`CtfeProvenance`, `AllocId`, `try_get_global_alloc`, `ConstAllocation::inner`, `get_bytes_strip_provenance`), ty/context.ts
(`allocate_bytes_dedup`, `GlobalCtxt.alloc_map`), ty/vtable.ts (`Allocation::new`), ty/consts/valtree.ts (`ConstToValTreeResult`'s
`unknown` error → `ErrorHandled`), rustc_metadata decoder.ts / cstore_impl.ts (`AllocDecodingState`, `ConstAllocation`),
rustc_hir_analysis check/mod.ts / lib.ts / wfcheck.ts (`ConstAllocation`, `GlobalId`, `ErrorHandled`), rustc_mir_build
thir/print.ts (`AllocId` Debug), thir/cx/expr.ts (`reserve_and_set_static_alloc`), thir/pattern/const_to_pat.ts
(`const_eval_resolve_for_typeck`), rustc_trait_selection traits/mod.ts (`ErrorHandled`). middle_traits_thir.typemap.json
still maps `mir::Const` / `mir::interpret::AllocId` to `unknown` for the THIR set (left so THIR printing is unchanged).

## Shared files edited (review)
rustc_middle `lib.ts` (mir imports, `install_TyCtxt_methods` calls, `mir` namespace), `ty/context.ts` (`Place` / `Local` /
`AllocId` types, `mk_place_elem`, lazy `mir()`), `ty/decls.ts`, `ty/structural_impls.ts`, `ty/sty.ts`, `ty/typeck_results.ts`,
`ty/cast.ts`, `queries.gen.ts` + `thir.gen.ts` (regenerated); `rust_ts/tydump_dump.ts`; rustc_mir_build `thir/print.ts`,
`thir/cx/expr.ts`; rustc_ty_utils `consts.ts`. Tools: `types.sets.json`, `types.ts`, `type_fold.json`, `mir.typemap.json`
(new), `middle_traits_thir.typemap.json`, `infer.typemap.json`, `queries.config.json`.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- Coverage: rustc_middle 2311/3369 (base 2271); TOTAL 16805/25518. mir: basic_blocks 15/15, syntax 4/4, mod 6/84, visit
  1/74 (`tcx`), interpret/mod 3/29, allocation 7/51 (6 trait decls + `inner`; Encodable skips count), init_mask 1/26,
  provenance_map 1/23, pointer 2/39; the rest 0 (stubs).
- `src/rustc_middle/mir/contract.test.ts`: 6 tests pass.
- Every mir module that may be imported from outside loads as a fresh entry point (contract test); `rustc_middle/lib.ts`,
  `ty/context.ts`, `rustc_interface/passes.ts` load.
- Regenerating every codegen set: only thir.gen.ts changes (its import path, `./mir/mod.ts`); queries.gen.ts regenerated
  (MIR query types above). (The `rustc_lexer` set writes an untracked `src/rustc_lexer/lib.gen.ts`, as at base: deleted.)
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (run before contract.test.ts existed): 5395 pass, 1 skip, 1 fail:
  rustc_ty_utils `layout_contract.test.ts` "every fn of the layout files ..." collected every `// stub:` of src/ and
  required them to be layout stubs (and 0): re-pinned below; then `layout_contract.test.ts` + `src/rustc_middle/mir`: 12 pass.

## Re-pinned tests (no assertion weakened)
- `src/rustc_ty_utils/layout_contract.test.ts`: its stub scan now keeps only stubs of its own scope files (the mir contract's
  `// stub:` lines are not layout stubs); "0 layout stubs left" is checked as before.

## Samples (lane vs base; base = the detached worktree `lanes/index-ds-base` at `970d2365`; both `RUST_TS_AGENT=mir-contract`, same samples)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-184611-mir-contract-e5gy` | 45 / 0 / 1 / 0 | `20261021-183356-mir-contract-35wa` | 45 / 0 / 1 / 0 |
| thirdump-minicore (46) | `20261021-184639-mir-contract-08tu` | 45 / 0 / 1 / 0 | `20261021-183417-mir-contract-goig` | 45 / 0 / 1 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-184714-mir-contract-vknz` | 292 / 0 / 8 / 0 | `20261021-183441-mir-contract-52wj` | 292 / 0 / 8 / 0 |
| tydump-ui `--sample 300` | `20261021-184933-mir-contract-j0yh` | 263 / 0 / 36 / 0 (+1 unstable) | `20261021-183637-mir-contract-6qq8` | 263 / 0 / 36 / 0 (+1 unstable) |
| hir-tree `--sample 300` | `20261021-185206-mir-contract-hltb` | 299 / 0 / 1 / 0 | `20261021-183907-mir-contract-448x` | 299 / 0 / 1 / 0 |
| resdump `--sample 300` | `20261021-185416-mir-contract-blgn` | 299 / 0 / 1 / 0 | `20261021-184107-mir-contract-rsn9` | 299 / 0 / 1 / 0 |

No new DIFF; every case has the same status **and the same stop** as on base (compared per case). THIR printing is
unchanged (thirdump-minicore identical). No current suite reaches a mir stub yet (MIR building is wave 22).

# Handoff: misc-blockers (wave 27, cross-cutting stops found in wave 25)

Branch `lane/misc-blockers`, base `fbb8fa9a` (integ-w25), no merges. One commit per item, then this handoff.

## 1. `Ty: StableHash`
The type-system closure of `Ty` hashes as rustc does. `type_id_hash` and the legacy symbol hash
(`get_symbol_hash`) no longer stop.

- **How.** The derived impls are generated, not hand-written (PORTING §5):
  - set `rustc_ty`:
    - `derive_stable_hash` with a `stable_hash_types` list (39 impls: `TyKind`, `ConstKind`, `Binder`, `FnSig`,
      `FnSigTys`, `FnHeader`, `GenericArgKind`, `TermKind`, `PatternKind`, `ValTreeKind`, the existential
      predicates, the bound / placeholder / param types, `Region`, `Const`, `Expr`, ...);
    - output goes to `rustc_type_ir/ty_stable_hash.gen.ts` and `rustc_middle/ty_stable_hash.gen.ts`;
    - `ty/impls_ty.rs` is in the set's files, so its manual `GenericArg` impl is found;
    - `stable_hash_access` maps `Region.0` to `.internee` and `Const.0` to the object itself.
  - set `rustc_middle`: `Ty`, `AdtDef`, `Pattern`, `ValTree`, `Value`, `VariantDef`, `FieldDef`, `VariantDiscr`,
    `VariantFlags`, `AdtFlags`, `RestrictionKind` (`ty/pattern.rs` was added to the files). `stable_hash_access`:
    `Ty.0` is the object; `AdtDef.0`, `Pattern.0` and `ValTree.0` are `.internee`.
  - set `rustc_abi`: `ReprOptions`, `IntegerType`, `Integer`, `ScalableElt`, `ReprFlags`, `Align` (new
    `rustc_abi/stable_hash.gen.ts`).
  - `tools/codegen/stable_hash.json`:
    - the `I::*` associated types of TyCtxt's `Interner` (impl_interner.rs): every `*Id` is `DefId`; the lists are
      `RawList` of their element impl; `InternedRegionKind` / `InternedConstKind` go through `Interned` (and
      `WithCachedTypeInfo`);
    - `Interned`, `WithCachedTypeInfo`, `TyKind` / `PatternKind` / `ValTreeKind`, `CtorKind`, `ModId`,
      `rustc_errors::ErrorGuaranteed`.
  - `tools/codegen/types.ts`:
    - new set option `stable_hash_module`: rustc_ty writes `ty_stable_hash.gen.ts`, because sets `rustc_type_ir` and
      `rustc_middle` already own `stable_hash.gen.ts` in those crates;
    - a template import naming the generated module itself (`src:<gen>`) is dropped like `gen:<gen>`.
- **Manual impls ported** (their `rustc-skip` markers are now `rustc:` markers):
  - `ty_info.rs:87` `WithCachedTypeInfo`;
  - `region_kind.rs:228` `RegionKind` (panics on `ReVar`);
  - `ty_kind.rs:858` `InferTy`;
  - `const_kind.rs:195` `InferConst`;
  - new file `rustc_middle/ty/impls_ty.ts`, the whole of impls_ty.rs: the `RawList` fingerprint cache, `GenericArg`,
    `AllocId`, `CtfeProvenance`;
  - `ty/mod.rs:600` `Term`;
  - `consts/int.rs:157` `ScalarInt`;
  - `adt.rs:160` `AdtDefData`, with its fingerprint cache.
  - PORT: each thread-local cache keyed `(ptr, StableHashControls)` is a `Map` keyed by the interned object, then by
    `hash_spans`.
- **Init order.** The generated module reaches most of rustc_middle at load. A static import of it from an
  early-loaded module made `tools/codegen/type_fold.test.ts` throw a TDZ `ReferenceError` (`fold_Term` in relate.ts).
  mod.ts, region_kind.ts, adt.ts and util.ts therefore require it lazily, as ty/mod.ts's `tyir_*` accessors do.
- **queries.gen.ts regenerated.** `tools/codegen/queries.ts` reads stable_hash.json, so 23 query values now have a
  `stable_hash_value` instead of `undefined`. Their `hash_value_fn` (query_vtables.ts) no longer stops.
- **Results.**
  - `symbol_names.oracle.test.ts`: the 7 `STOP_TY_HASH` pins (`basic`, `const-generics-demangling`, `impl1`,
    `issue-60925`, `issue-75326`, `types` `#legacy`, `types#verbose-legacy`) are now full oracle comparisons. All
    equal the oracle, hashes included. `STOPS` is empty.
  - `rustc_lint/types.oracle.test.ts`: the PENDING extern-"C" case is now a normal case and equals the oracle. I added
    one case with FFI-unsafe types and a repeated signature (a cache hit); it equals the oracle too.
  - `tools/codegen/type_fold.test.ts` (golden): the file count goes 35 → 37 (the two new modules). It now pins the
    StableHash impl count (39) and `missing_stable_hash`: only `ty::Expr`'s `mir::BinOp`, `mir::UnOp` and
    `abstract_const::CastKind`, which stay `unported_stable_hash`. The fixture `fixtures/rustc_ty.typedefs.json` gets
    the `ty/impls_ty.rs` entry.
  - mir-minicore (cg_clif mini_core.rs / mini_core_hello_world.rs): see "Sample runs".

## 2. Big array lengths in rustc_pattern_analysis
- `Slice.array_len` and `ConstructorSet::Slice.array_len` are `bigint | undefined` (upstream `Option<usize>`),
  straight from `Const::try_to_target_usize`. The two `u64_to_number` calls in rustc.ts are gone.
- PORT: the `SliceKind` lengths stay `number`s. They are pattern lengths, or an array length that `Slice::new` /
  `split` turn into `FixedLen` only when it is at most a pattern length.
- `contract.test.ts` and `rustc_test_driver.ts` pass `bigint` lengths.
- Results: see "Sample runs" (`--suite mir --filter tests/ui/limits/`).

## 3. Metadata decoders: `PreciseCapturingArgKind`, `hir::OpaqueTyOrigin`
- Set `rustc_hir` `decodable_types` adds `PreciseCapturingArgKind`, `OpaqueTyOrigin` and `RpitContext` (generated in
  hir.gen.ts).
- cstore_impl.ts's `rendered_precise_capturing_args` and `opaque_ty_origin` providers use them.
- Cases: no recorded run reaches either decoder (earlier stops hide them). I added
  `src/rustc_metadata/rmeta/rmeta_opaque.oracle.test.ts`:
  - the pinned rustc builds an aux crate with RPITs (free fn, trait, trait impl), an `async fn` and `use<..>` lists;
  - the port decodes both tables;
  - the expected lines follow from the source.
  - It passes. On the base it stops at `Decodable for hir::OpaqueTyOrigin<DefId>`.
- `cstore_impl.test.ts` "unported element types stop at unported(..)" is re-pinned to the last `decode_unported`
  left, `deduced_param_attrs` / `Decodable for DeducedParamAttrs`. **mt-opt2-b**: when you port `DeducedParamAttrs`,
  that pin fails; drop it or turn it into a positive check.

## 4. `NonGenericOpaqueTypeParam`
- The derive was already generated: it is in rustc_trait_selection diagnostics.gen.ts, set
  `rustc_trait_selection_error_reporting`. The stop's comment was stale.
- `NonDefiningUseReason::report` (`NotAParam`) now emits it as upstream does. diagnostics.ts is required lazily.
- Case: `tests/ui/borrowck/overwrite-anon-late-param-regions.rs`. See "Sample runs".

## Files touched
- **tools/codegen**: types.ts, types.sets.json, stable_hash.json, type_fold.test.ts, fixtures/rustc_ty.typedefs.json.
- **Generated**:
  - new: rustc_type_ir/ty_stable_hash.gen.ts, rustc_middle/ty_stable_hash.gen.ts, rustc_abi/stable_hash.gen.ts;
  - regenerated: rustc_middle/stable_hash.gen.ts, rustc_middle/queries.gen.ts, rustc_hir/hir.gen.ts.
- **rustc_type_ir**: ty_info.ts, region_kind.ts, ty_kind.ts, const_kind.ts.
- **rustc_middle**:
  - new: ty/impls_ty.ts;
  - changed: ty/mod.ts, ty/adt.ts, ty/consts/int.ts, ty/util.ts.
- **rustc_symbol_mangling**: legacy.ts, symbol_names.oracle.test.ts.
- **rustc_lint**: types.oracle.test.ts.
- **rustc_pattern_analysis**: constructor.ts, rustc.ts, contract.test.ts, rustc_test_driver.ts.
- **rustc_metadata**:
  - new: rmeta/rmeta_opaque.oracle.test.ts;
  - changed: rmeta/decoder/cstore_impl.ts, rmeta/decoder/cstore_impl.test.ts.
- **rustc_trait_selection**: opaque_types.ts.

## Coverage
Every touched upstream file is fully covered:

| file | fns |
|---|---|
| impls_ty.rs | 4/4 |
| ty_info.rs | 6/6 |
| region_kind.rs | 2/2 |
| ty_kind.rs | 99/99 |
| const_kind.rs | 11/11 |
| consts/int.rs | 60/60 |
| adt.rs | 60/60 |
| ty/mod.rs | 150/150 |
| ty/util.rs | 78/78 |
| legacy.rs | 20/20 |
| constructor.rs | 34/34 |
| pattern_analysis rustc.rs | 38/38 |
| cstore_impl.rs | 37/37 |
| opaque_types.rs | 9/9 |

`coverage.ts --check`: markers ok.

## Tests
- Typecheck is clean.
- Full unit suite (`bun test src tools`, once at the end): 6275 pass, 1 skip, 0 fail.
- Green: `bun test` of tools/codegen (50), rustc_type_ir (150), rustc_middle (349), rustc_symbol_mangling (28),
  rustc_lint (153), rustc_const_eval (39), rustc_abi (27), rustc_query_impl (12), rustc_pattern_analysis (21),
  rustc_metadata (99), rustc_hir (454), rustc_trait_selection (139).

## Sample runs
All runs used `RUST_TS_AGENT=root-f5de`, after the gate flag cleared.

| run | result | run dir |
|---|---|---|
| `--suite mir --filter tests/ui/limits/` | 4 MATCH / 12 UNPORTED / 0 CRASH | `20261028-131813-root-f5de-lxnu` |
| `--suite borrowck-ui --filter overwrite-anon-late-param-regions` | **MATCH** (was UNPORTED at `NonGenericOpaqueTypeParam`) | `20261028-131824-root-f5de-na4j` |
| `--suite mir-minicore` (all 46) | 40 MATCH, 6 UNPORTED, 0 DIFF / CRASH | `20261028-131828-root-f5de-r2vg` |
| `--suite tydump-minicore` | 46/46 MATCH (base run 45) | `20261028-131846-root-f5de-2lam` |
| `--suite mirdump-minicore` | 46/46 MATCH (base run 45) | `20261028-131917-root-f5de-9muk` |
| `--suite tydump-ui --sample 300` | 295 MATCH, 3 UNPORTED, 2 UNSTABLE (base run 261) | `20261028-131949-root-f5de-w9oe` |
| `--suite mirdump-ui --sample 300` | 300/300 MATCH (base run 269) | `20261028-132255-root-f5de-bxdb` |
| `--suite borrowck-ui --sample 300` | 287 MATCH, 13 UNPORTED (base run: 0 MATCH, older tree) | `20261028-132620-root-f5de-dsth` |

- **limits cases.** `limits/huge-array-simple-64.rs` and `limits/issue-15919-64.rs` are no longer CRASH (they were the
  `u64_to_number (ConstructorSet::Slice)` ICE). They get through pattern analysis and stop at
  `rustc_mir_transform::unreachable_prop::UnreachablePropagation (pass not ported)` (mt-opt lanes). huge-static.rs is
  still MATCH.
- **mir-minicore.** It has the same 40 MATCH as the earlier `kv-mir-minicore` run. Both cg_clif files
  (mini_core.rs, mini_core_hello_world.rs) moved from `Ty: StableHash (..while_hashing_spans)` to
  `UnreachablePropagation (pass not ported)`. They now get past the improper_ctypes `type_id_hash`. The other 4 also
  stop at `UnreachablePropagation` (kv run: `LowerSliceLenCalls`, which mt-opt1 ported; not this lane).
- **Base comparison.** I compared every sample case against the base runs listed in w27-common.txt: no MATCH turned
  into anything else, and there is no DIFF, CRASH or TIMEOUT.
- **Non-MATCH cases.** Each has the same stop as in the base run, or a later one:
  - tydump-ui:
    - `traits/alias/self-in-const-generics.rs` and `next-solver/no-param-env-const-fold.rs`: `hash_result` of
      `type_of`. Same as the base. The queries generator has no typemap entry for `ty::EarlyBinder`, so the query value
      is `unknown` and gets no `stable_hash_value`. That needs a queries typemap change (not this lane).
    - `different-bound-vars.rs#current`: `IntoDiagArg`, same as the base.
    - two UNSTABLE: same as the base.
  - borrowck-ui:
    - 12 `polonius_engine::AllFacts::default` (wave 26 polonius);
    - `async-reference-generality.rs`: `UnreachablePropagation` (base run: `replace_regions_in_mir`).
- **No clean-base run.** I made no separate clean-base run of the non-MATCH cases: they stop in code this lane does
  not touch, at the same stops the base runs show.

## `unported(...)` left / `// PORT:` decisions
- New `unported`:
  - `stable_hash_AllocId`: `GlobalAlloc: StableHash` (the derive is not generated), and its `tcx` `expect`;
  - `unported_stable_hash` of `mir::BinOp` / `UnOp` / `abstract_const::CastKind` in the generated `stable_hash_ExprKind`.
- Removed `unported`:
  - util.ts `type_id_hash`;
  - legacy.ts (the 3 `stable_hash_unported` calls and the helper);
  - pattern_analysis `u64_to_number` ×2;
  - cstore_impl `decode_unported` ×2;
  - opaque_types.ts `NonGenericOpaqueTypeParam`.
- `// PORT:` comments:
  - the cache keys (impls_ty.ts, adt.ts);
  - the `mem::discriminant` tables of the manual enum impls (region_kind.ts, ty_kind.ts);
  - the `FixedLen(len)` conversions and the `bigint` `array_len` (constructor.ts);
  - the lazy requires (mod.ts, region_kind.ts, adt.ts, util.ts);
  - impls_ty.ts (header, `GlobalAlloc`).

## For root
- **Codegen changes.** This lane edits tools/codegen (types.ts option + set configs). Regenerating sets `rustc_ty`,
  `rustc_middle`, `rustc_abi`, `rustc_hir` and `queries.ts` reproduces the committed files.
- **Merge risk.** Another lane may touch `types.sets.json` (`rustc_hir` decodable_types, `rustc_middle`) or
  `stable_hash.json` this wave. Those merges are by hand.

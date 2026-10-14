# Handoff: ty-mod-a (M3, wave 15): rustc_middle `ty/mod.rs` lines 1–1112

Branch `lane/ty-mod-a` (from `ab2cdfc`, no merges).

## Files
- `src/rustc_middle/ty/mod.ts` (edited, my region only, plus the import block and the `ParamEnv` derive stubs, see
  "Merge notes"):
  - **New, in upstream order:**
    - lazy `require` helpers, the `(Ty, Ty)` visit descriptor and the `ReverseMapper_new` stand-in;
    - `ImplTraitHeader` (class, with `is_fully_generic_for_reflection` and its local `ParamFinder` visitor);
    - `Asyncness`;
    - `RestrictionKind` (`is_allowed_in`, `expect_span`, `restriction_path`, `stricter_of`);
    - `ClosureSizeProfileData`, `CrateVariancesMap`, `CReaderCacheKey`, `CrateClausesMap`;
    - the `Term` impls: `Debug`, the `fold_Term` D4 descriptor (`try_fold_with` / `fold_with` / `visit_with`),
      `decode_Term`, `to_alias_term`, `is_non_rigid_alias`, `is_infer`, `is_trivially_wf`, `walk`;
    - `InstantiatedClauses` (class), `ProvisionalHiddenType` (class: `new_error`, `build_mismatch_error`,
      `remap_generic_params_to_declaration_params`), `DefiningScopeKind`, `DefinitionSiteHiddenType` (class:
      `new_error`, `build_mismatch_error`);
    - `flags_Clauses` (`impl Flags for Clauses`);
    - `ParamEnv` (class: `empty`, `caller_bounds`, `is_empty`, `new`, `and`, `with_normalized`) with `ParamEnv_eq`;
    - `ParamEnvAnd`;
    - the `TypingEnv` struct (class, fields only).
  - Each type with `#[derive(Debug)]` has a hand-written `debug_<T>`.
  - Ported earlier and untouched: `Visibility`, the `TyCtxt` def-id tree fns (`opt_parent` .. `is_descendant_of`),
    `Ty`, and `Term`'s `From` / `kind` / `as_*` / `expect_*` / `into_arg` / `pack`.
- `src/rustc_middle/ty/ty_mod_a.test.ts` (new): 17 tests on interned values and a real `TyCtxt` (interners only).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_middle/src/ty/mod.rs` lists nothing below line 1113. mod.rs is
  69/150 overall; the rest is lane ty-mod-b's.
- `bun scripts/coverage.ts --check`: `markers ok (11091; vendor 3888)`.
- `rustc-skip` markers:
  - mod.rs:600 `stable_hash` (StableHash, incremental, M5);
  - mod.rs:634 `encode` (Encodable, M5).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Results" at the end.
- Fresh-process loads of `rustc_middle/ty/mod.ts`, `rustc_middle/lib.ts`, `ty/context.ts`, `rustc_type_ir/walk.ts` and
  `rustc_type_ir/term_kind.ts` as entry points: all ok.
- `RUST_TS_AGENT=ty-mod-a` difftest samples:
  - `--suite hir-tree-nocore --sample 100`: 100 MATCH / 0 DIFF / 0 UNPORTED (`20261014-065346-ty-mod-a-uo6e`).
  - `--suite expanded --sample 100`: 100 MATCH / 0 DIFF / 0 UNPORTED (`20261014-065404-ty-mod-a-rus4`).

## `unported(...)` left, and where this region stops today
- **New stand-in:** `ReverseMapper_new` stands in for `opaque_types::ReverseMapper::new` (ty/opaque_types.rs, which
  no lane owns yet). Because of it, `ProvisionalHiddenType::remap_generic_params_to_declaration_params` stops as
  UNPORTED after it builds the map.
- **Kept stubs:** the `#[derive(TypeVisitable, TypeFoldable)]` stubs of `ParamEnv` (`visit_with_ParamEnv`,
  `try_fold_with_ParamEnv`, `fold_with_ParamEnv`). They are derive impls, so they are not hand-written (PORTING §5).
- **Stops in other lanes' code:**
  - `is_fully_generic_for_reflection`: at `TypeVisitable for GenericArgs` (lane ty-args), and after that at
    `standin_fold_Ty.super_visit_with` (structural_impls).
  - `Term::is_infer` / `is_trivially_wf` on a type: at the `Ty.is_ty_var` / `Ty.is_trivially_wf` stubs (lane ty-sty).
  - `*::new_error`: at `Ty.new_error` (ty-sty).
  - `debug_Term` of a type, `debug_ClosureSizeProfileData`, `debug_ProvisionalHiddenType`,
    `debug_DefinitionSiteHiddenType`: at the `debug_Ty` stub.
  - `debug_ParamEnv` with clauses, `debug_CrateClausesMap`, `debug_InstantiatedClauses`: at the `debug_Clause` stub.
  - `fold_Term` on a type with a folder that super-folds: at `standin_fold_Ty`.
  - `debug_CrateVariancesMap` / `debug_CrateClausesMap` with more than one entry: at `debug_HashMap`. A `DefIdMap` is
    not an `FxHashMap`, so its iteration order is not rustc's (rust_ts/hash_map.ts).

## PORT decisions (please record)
1. **Lazy requires in mod.ts.** mod.ts is a defining module. The modules it needs at call time either import it back
   or reach extension modules at load: rustc_type_ir binder / fold / visit / predicate / unnormalized / term_kind /
   walk, and ty/generic_args, ty/predicate, ty/print/pretty. So they are required lazily, through one helper fn each,
   as rustc_type_ir sty/mod.ts already does. Static imports are kept to init-safe modules: rustc_hir, rustc_errors,
   diagnostics.gen, rustc_ast_ir/visit, infer_ctxt.gen, rustc_type_ir/lib, list.ts and sty/mod.ts.
2. **Field renames.** `ParamEnv`'s private `caller_bounds` field is `caller_bounds_`, because the method
   `caller_bounds()` needs the name (the precedent is `Ty.flags_`). For the same reason `TypingEnv.typing_mode` is
   `typing_mode_` (method mod.rs:1117). The derived Debug prints the upstream field names.
3. **Classes and data structs.** Structs with methods are classes: `ImplTraitHeader`, `InstantiatedClauses`,
   `ProvisionalHiddenType`, `DefinitionSiteHiddenType`, `ParamEnv`, and `TypingEnv`, whose methods are ty-mod-b's.
   Data-only structs are interfaces: `ClosureSizeProfileData`, `CrateVariancesMap`, `CReaderCacheKey`,
   `CrateClausesMap`, `ParamEnvAnd`. The enums follow PORTING §5: `Asyncness` and `DefiningScopeKind` are string
   unions, `RestrictionKind` is `$`-tagged; their methods are on the companions.
4. **One method for two `caller_bounds`.** `impl inherent::ParamEnv for ParamEnv` (:1033) only delegates to the
   inherent `caller_bounds` (:1051), so a single method carries both markers (the precedent is `Ty.kind`).
5. **`InstantiatedClauses` iterators.** The by-value `IntoIterator` (:817) is `into_iter()`. The `&InstantiatedClauses`
   impl (:831) is `into_iter_ref()`. `[Symbol.iterator]` and `iter()` use the by-reference one.
6. **`decode_Term` is ported.** Upstream hand-writes this impl. The derived `TermKind` decoder is passed in as a fn,
   as in rustc_type_ir/serialize.ts.
7. **Descriptors.** `flags_Clauses` is the D4 `Flags<Clauses>` descriptor. The `Ty` side of `fold_Term` and the
   `(Ty, Ty)` visit descriptor go through `standin_fold_Ty` (merge-w15a decision 3).
8. **`debug_Term` formats plainly.** `write!(f, "Term::Ty({ty:?})")` formats the inner value with a fresh spec, so
   it uses `PLAIN` even under `{:#?}`.
9. **`ParamFinder`** (`#[derive(Default)]`, local to the fn upstream) is a local class in
   `is_fully_generic_for_reflection`. Its `FxHashSet<u32>` is only probed, so it is a `Set`.
10. **Dropped code.** `#[instrument]` / `debug!` (tracing), `cfg!(debug_assertions)` asserts and
    `static_assert_size!` are dropped, with comments.
11. **`with_normalized`.** The value of `reveal_opaque_types_in_bounds` is cast to `Clauses`, because its query
    value type is still `unknown` in queries.gen.ts.

## For root
- **decls.ts.** Replace `export type ParamEnv = Pending<"ParamEnv">` and `TypingEnv` with re-exports of the classes
  in mod.ts. Then:
  - retype the three `ParamEnv` derive stubs in mod.ts (now on `ParamEnvPending`) and drop that import;
  - update `tools/codegen/tyir.typemap.json` (`I::ParamEnv` imports `src/rustc_middle/ty/decls.ts`);
  - repoint the `ParamEnv_caller_bounds` stand-ins in `rustc_type_ir/binder.ts` and `infer_ctxt.ts` to
    `param_env.caller_bounds()`.
- **Derives for codegen.** These derives of the types in this range are still owed:
  - TypeFoldable / TypeVisitable: `ParamEnv`, `ParamEnvAnd`, `TypingEnv`, `ClosureSizeProfileData`,
    `ProvisionalHiddenType`, `Asyncness`;
  - TyDecodable: `ImplTraitHeader`, `Asyncness`, `DefinitionSiteHiddenType`, `ClosureSizeProfileData`,
    `ProvisionalHiddenType`;
  - Decodable: `RestrictionKind`.

  ty/mod.rs is in the `rustc_middle` set as `derive_only`, so the set needs the type list. When the derives are
  generated, they must use the shapes above: classes take every field in declaration order; the renamed fields are
  `caller_bounds_` and `typing_mode_`.
- **Stand-ins to repoint:**
  - `rustc_metadata/rmeta/table.ts` has its own `Asyncness` (`"Yes" | "No"`, the same shape); re-export mod.ts's.
  - `rmeta/decoder.ts` decodes `RestrictionKind` with `decode_unported`.
- **Query value types** to fill when queries.gen.ts is regenerated: `CrateVariancesMap`, `CrateClausesMap`,
  `ImplTraitHeader`, `DefinitionSiteHiddenType`, `Asyncness`.
- **Merge notes (ty-mod-b shares mod.ts):**
  - I removed `ParamEnv` from the shared `import type { AssocItem, .. } from "./decls.ts"` line, because the class now
    owns the name. My other imports are in the `// ty-mod-a imports` block.
  - The `TypingEnv` class (mod.rs:1105, my range) holds only the fields; ty-mod-b's methods (`new`, `typing_mode()`,
    ...) go on it. If ty-mod-b also defined `TypingEnv`, keep one class: fields named `typing_mode_` / `param_env`,
    with ty-mod-b's methods.
  - The bottom section (`TyCtxt_*` stubs from mod.rs:1578 on) is untouched.
- **New stand-in** to repoint when ty/opaque_types.rs is ported: `ReverseMapper_new`.

## Results
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools` at 4d0191f: 4309 pass, 1 skip (the pre-existing
  linux-only one), 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (11091; vendor 3888).
- Difftest samples: hir-tree-nocore 100/100 MATCH, expanded 100/100 MATCH (run ids above).

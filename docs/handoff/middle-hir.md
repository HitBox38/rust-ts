# Handoff: middle-hir (wave 14, M3a): rustc_middle hir/map.rs + hir/mod.rs, the hir-tree driver path

Branch `lane/middle-hir`, from main 935a15a. No merges committed. To run the hir-tree suite I merged `lane/harness-w13`
locally with `--no-commit` and aborted the merge afterwards (see "harness-w13 merge" below).

## Result
- **rustc_middle `hir/map.rs` 110/110 and `hir/mod.rs` 30/30**, plus `hir/nested_filter.rs`, which has no fns. They
  cover the `tcx.hir_*` accessors, `ParentHirIterator`, `ParentOwnerIterator`, `ModuleItems`, `ItemCollector`,
  `hir_crate_items` / `hir_module_items`, `crate_hash`, `hash_owner_nodes`, `Projected{OwnerInfo,MaybeOwner}` and
  `provide`.
- **Providers wired** in `passes.ts` `default_query_providers`, in upstream order:
  - `rustc_ast_lowering.provide` (before `limits`);
  - `rustc_middle::hir::provide` (after `limits`);
  - `proc_macro_decls_static`, which is now upstream's closure.
- **`pretty::print` HirTree arm ported** (pretty.rs:298). The `Hir` arm stays `unported` (rustc_hir_pretty is a later
  lane).
- **`-Zunpretty=hir-tree` now runs end to end** up to the lowering stubs. All 96 UNPORTED cases of the sample stop at
  `rustc_ast_lowering::lower_to_hir`, and their output up to the stop is a prefix of the oracle's.

## Files
- **Mine (new or rewritten):**
  - `src/rustc_middle/hir/mod.ts`: rewritten. It held only `parent_module_from_def_id` before.
  - `src/rustc_middle/hir/map.ts`: new.
  - `src/rustc_middle/hir/nested_filter.ts`: new.
  - Tests: `src/rustc_middle/hir/map.oracle.test.ts` and
    `hir_tree_oracle/{run.ts, mods.rs, mods.bin.hir-tree.stdout, mods.lib.hir-tree.stdout, mods.bin.accessors.txt}`.
- **Call-site edits (as briefed):**
  - `src/rustc_interface/passes.ts`: the providers, plus imports of `rustc_ast_lowering/lib.ts` and `{ hir }` from
    rustc_middle/lib.ts.
  - `src/rustc_driver_impl/pretty.ts`: the HirTree arm and the header comment.
- **Outside my files (needed; please review):**
  - `src/rustc_middle/ty/context.ts`:
    - (a) Removed `import * as hir_mod from "../hir/mod.ts"` and the delegating `parent_module_from_def_id` method.
      The method now lives on the prototype from hir/mod.ts (see PORT decision 1). It has no other call-site change:
      `create_def`, `ty/mod.ts` and `engine.test.ts` still call `tcx.parent_module_from_def_id`.
    - (b) Added `needs_hir_hash` (context.rs:1142), which `hash_owner_nodes` needs. `cfg!(debug_assertions)` is
      `false`.
  - `src/rustc_middle/lib.ts`: `import "./hir/mod.ts"` after the ty extension modules, and `export * as hir`.

## Coverage
- `bun scripts/coverage.ts --check`: `markers ok (8784; vendor 3888)`.
- `--missing`:
  - map.rs 110/110;
  - mod.rs 30/30;
  - context.rs 70/202 (+1, `needs_hir_hash`);
  - pretty.rs 8/15. Unchanged: HirTree is inside `print`. The 7 left are the HIR annotators' `nested`/`pre`/`post`
    and `emit_mir`.
- **No fn was left out for needing typeck.** Some are fully ported but reach unported queries or helpers at run time.
  None of them is on the hir-tree path:
  - `hir_body_owner_kind`: the `anon_const_kind` query has no provider.
  - `hir_body_const_context`: `is_constructor` (ty/util stub), `is_const_fn` (ty/mod stub) and the `constness` query.
  - `hir_id_to_string`: `def_path_str` (ty::print).
  - `hir_body_owned_by` (on failure), `hir_get_foreign_abi`, `hir_expect_*` and `hir_name` reach it through
    `hir_id_to_string`.
  - `qpath_lang_item`: `LanguageItems::from_def_id` is unported in rustc_attr_ir.
  - `crate_hash` / `legacy_crate_hash`: Svh, `dep_tracking_hash`, `local_crate_hash`.
  - `par_*`: sync/parallel.rs.

## Tests and evidence
- `bunx tsc --noEmit -p .`: clean. My files are also clean under `--noUnusedLocals`.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3990 pass, 1 skip (the pre-existing linux-only one),
  0 fail.
- **`map.oracle.test.ts`** uses `hir_tree_oracle/run.ts`. That helper runs the real driver with `override_queries`
  replacing only `lower_to_hir`, with a stand-in that builds the HIR of a modules-only crate from the expanded AST.
  The test file is `mods.rs`: `mod m { mod n {} } mod k {}`, `#![no_core]`. The checks:
  - **bin case**: `-Zunpretty=hir-tree` stdout is byte-identical to the pinned rustc. This checks the ItemCollector
    owner order (root, m, n, k), the providers, `hir_owner_nodes` and the pretty arm.
  - **lib case**: the same, with the stand-in computing `opt_hash` through `tcx.hash_owner_nodes`, as lowering's
    `make_owner_info` does. **All 4 `Some(Fingerprint(..))` match the oracle.**
  - **accessors** (bin): 23 `tcx.hir_*` results are checked against `mods.bin.accessors.txt`:
    - parent ids and the two ancestor iterators;
    - `hir_get_parent_item` and `hir_get_enclosing_scope` / `hir_get_defining_scope`;
    - `parent_module`, `hir_span` / `hir_span_with_body`, `def_ident_span` (provider), `hir_get_module`;
    - `hir_module_items`, `local_def_id_to_hir_id`, and others.

    I derived the expected values by reading upstream; hir-tree does not print them.
  - The fixture test re-checks both fixtures against the oracle on every run, and `REGEN=1` rewrites them.
- **Sample difftests** (`RUST_TS_AGENT=middle-hir`):
  - `hir-tree-nocore --sample 100`, with harness-w13 merged locally: 4 MATCH, 96 UNPORTED, 0 DIFF, 0 CRASH (run
    `20261014-024708-middle-hir-1y9e`).
    - **Stop histogram: 96 × `rustc_ast_lowering::lower_to_hir`.** That is the lib.ts stub, reached first through
      `hir_crate_items` → `hir_owner`.
    - Prefix check (scratch `$RUST_TS_DATA/tmp/middle-hir/prefix.ts`): 96/96. Subject stdout and stderr up to the stop
      are a prefix of the oracle's.
  - `expanded --sample 100`: 100/100 MATCH (run `20261014-025851-middle-hir-l5xr`).
  - `resdump-nocore --sample 100` and `expanded-nocore --sample 100`: 100/100 MATCH each.
- Fresh-process loads with no TDZ errors: `rustc_middle/lib.ts`, `hir/mod.ts`, `hir/map.ts`, `ty/context.ts`,
  `rustc_interface/passes.ts`, `rustc_driver_impl/lib.ts`.

## `unported(...)` left
- **Pending-lane shims** (local fns that call `unported`):
  - map.ts and mod.ts: `par_for_each_in` / `try_par_for_each_in` (rustc_data_structures sync/parallel.rs);
  - map.ts: `Svh_new` and `stable_hash_Svh` (svh.rs);
  - map.ts: `DebuggerVisualizerFile_path_erased` and `stable_hash_DebuggerVisualizerFile` (middle/debugger_visualizer.rs);
  - map.ts: `stable_hash_read_metavar_spans` (`StableHash for FxHashMap<Span, Span>`).
- **`crate_hash`**: the `needs_metadata` arm (`Untracked::local_crate_hash`, metadata encoding, M5).
- **`opt_ast_lowering_delayed_lints`**: `assert_eval_always` with a dep graph (never reached, D3).
- **`hash_owner_nodes`**: `StableHash for rustc_attr_ir::Attribute`. It is reached for every lib crate whose owner has
  an attribute (see "For root" 1).
- **pretty.ts**: the `Hir` arm (`rustc_hir_pretty`, pending).

## PORT decisions (please record)
1. **The `impl TyCtxt` blocks of hir/mod.rs and hir/map.rs are prototype methods** (PORTING §5 "Methods defined in
   another file"), loaded by rustc_middle/lib.ts after ty/context.ts. The pattern is the same as ty-contract,
   middle/stability.ts and middle/lint.ts.
   - ty/context.ts must not import hir/*: an import would run hir/mod.ts before `TyCtxt` exists.
   - This replaces tyctxt-min decision 6 (declare in the class and delegate) for hir/mod.rs.
2. **rustc_middle types are hand-written**, following set `rustc_middle`'s note:
   - `ModuleItems` is a class. The fields that clash with methods get a `_` suffix (`free_items_`, ...), and
     `debug_ModuleItems` prints the upstream names.
   - `Hashes` is an interface.
   - `ProjectedOwnerInfo` is a class with `new`.
   - `ProjectedMaybeOwner` is a union with a companion (`new`/`as_owner`/`unwrap`).
   - Derived StableHash/Encodable/Decodable are not ported (no dep graph; metadata is M5).
   - The derived Debug of `ProjectedOwnerInfo` is not ported, because its maps print in FxHash order (as for
     `OwnerInfo`).
3. **`impl Iterator` results are arrays**, except the ancestor walks, which stay lazy:
   - `ParentHirIterator` and `ParentOwnerIterator` are classes with `next()` plus `[Symbol.iterator]`;
   - `hir_parent_iter` is a generator;
   - `hir_get_fn_id_for_return_block`'s `chain(..).peekable()` is a local `Peekable`.
4. **`impl intravisit::HirTyCtxt for TyCtxt`** is `TyCtxt_as_HirTyCtxt(tcx)`, the `&tcx as &dyn HirTyCtxt` view, with
   the six markers. `ItemCollector::maybe_tcx` returns it.
5. **Inlined one-liners from files that are not ported:**
   - `find_attr!(tcx, hir_id, ..)` → `find_attr(tcx.hir_attrs(hir_id), ..)` (`HasAttrs for HirId`, ty/mod.rs:2371);
   - `tcx.lang_items()` → `tcx.get_lang_items(null)` (middle/lang_items.rs);
   - `dep_graph.assert_eval_always()` → nothing without a dep graph.
6. **Query values typed `unknown` in queries.gen.ts are cast at the use sites:**
   - `hir_crate_items`, `hir_module_items`, `hir_owner`, `hir_attr_map`, `lower_to_hir`, `constness`,
     `anon_const_kind`;
   - `hir_owner_parent_q`, whose type is rustc_lint_defs' `HirId` stand-in.
   - `all_local_trait_impls` returns the resolver's `DefId_hash_key`-keyed map, cast to the generated
     `Map<DefId, ..>` type.
7. **`needs_hir_hash`'s `cfg!(debug_assertions)` is `false`.** The release-oracle precedent is root decision
   2026-10-14 for lowering lib.rs:124/:135.

## For root
1. **Lib crates with attributes need `StableHash for rustc_attr_ir::Attribute`.** The derive should come from codegen
   set `rustc_attr_ir`; attr.ts has `stable_hash` (attr.rs:87) as `rustc-skip`.
   - Lowering calls `hash_owner_nodes` for every owner of a lib crate. With any attribute on an owner (in the nocore
     suite, the crate root always carries `#![no_core]`), the attrs hash reaches `unported` once lowering is filled.
   - About 1,041 tests/ui files are lib crates (plan-m3 §1a). Bin crates skip hashing.
2. **`needs_owner_info_hash`** (context.rs:1175) is needed by lower-lib-a (`make_owner_info`, lib.rs:256) and is not
   ported. I added only `needs_hir_hash` next to `needs_metadata`. If lower-lib-a adds `needs_hir_hash` as well, keep
   one copy.
3. **Stand-ins elsewhere that the accessors now replace** (owners' call):
   - `rustc_interface/limits.ts` `hir_krate_attrs` → `tcx.hir_krate_attrs()`;
   - `rustc_middle/lint.ts` `hir_parent_id_iter` → `tcx.hir_parent_id_iter`;
   - `rustc_resolve/lib.ts:204` (`HasAttrs for DefId` local arm) → `tcx.hir_attrs(tcx.local_def_id_to_hir_id(did))`;
   - `rustc_lint/levels.ts:169-181` and `rustc_lint/expect.ts:14` (`hir_crate_items` / `hir_attr_map`).
   - `TyCtxtFeed::feed_hir` (context.rs:652) can now be ported (`ProjectedMaybeOwner`, `AttributeMap::EMPTY`).
4. **Typemap and codegen:**
   - Add typemap.middle.json entries for `rustc_middle::hir::{ModuleItems, ProjectedMaybeOwner}`,
     `rustc_hir::{AttributeMap, MaybeOwner, Constness}` and `ty::AnonConstKind`, then regenerate queries.gen.ts so the
     casts can go.
   - Point the query `HirId` at rustc_hir_id instead of rustc_lint_defs' stand-in.
   - The `FxIndexMap<DefId, _>` query values (`all_local_trait_impls`) need the keyed representation the resolver uses.
5. **harness-w13 merge:** it conflicts with main in `harness/suites.ts`, because both append to `SUITES`. Keeping both
   blocks resolves it: main's tydump/thirdump `SUITES.push`, then `);`, then harness-w13's block. tsc is clean with
   that resolution.
6. **hir-pretty lanes:** pretty.ts's `Hir` arm is still `unported`. `HirIdentifiedAnn` / `HirTypedAnn` are not ported.
   `TyCtxt_as_HirTyCtxt` (hir/map.ts) is the `&tcx as &dyn HirTyCtxt` they need.

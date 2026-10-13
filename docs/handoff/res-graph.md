# Handoff: res-graph (wave 10, M2: rustc_resolve def_collector + build_reduced_graph)

Branch `lane/res-graph`, based on bb96986 (no merges). Commits: port; oracle test (7 cases); pending/partial
cases; decls comment fix; this handoff.

## Files touched
- `src/rustc_resolve/def_collector.ts`: all of def_collector.rs. It replaces the stub: `collect_definitions`, the
  `DefCollector` methods and the `impl Visitor` overrides, all on `DefCollector.prototype`.
- `src/rustc_resolve/build_reduced_graph.ts`: all of build_reduced_graph.rs, on `Resolver.prototype` and
  `DefCollector.prototype`. No `unported_methods` calls are left in either file.
- `src/rustc_resolve/decls.ts` (root's file, one minimal fix): `compile_macro`'s `attrs` is now
  `readonly AttrIrAttribute[]` (`rustc_attr_ir::Attribute`, as upstream macros.rs:1210). It was the AST
  `Attribute`, which does not type-check against `AttributeParser::parse_attribute_list`'s result. I added a type
  import `Attribute as AttrIrAttribute` from `../rustc_attr_ir/lib.ts`. res-macros implements `compile_macro`
  against this signature.
- Tests:
  - `src/rustc_resolve/build_reduced_graph.test.ts` (new).
  - `src/rustc_resolve/graph_oracle/{gen.ts,args.ts,cases/*.rs,*.resdump.txt,*.stderr}` (new): the fixtures and
    their generator (`bun src/rustc_resolve/graph_oracle/gen.ts`).

## Coverage
- def_collector.rs: 29/29.
- build_reduced_graph.rs: 42/42.
- `coverage --check`: markers ok (6210; vendor 2403).

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3034 pass, 1 skip, 15 fail.
  - One failure was mine: decls' contract test, because my comment line split `// macros.rs:1210` from its
    declaration. It is fixed, and contract.test.ts now passes 4/4.
  - The other 14 are not from this lane. They are in `src/rustc_driver_impl/driver.oracle.test.ts` and
    `src/rustc_session/output.oracle.test.ts`. Their PENDING text still says
    `rustc_resolve::Resolver::arenas (pending res-lib)`, but since root wired the real Resolver (4398b7f) the
    driver stops at `rustc_lint::late::unerased_lint_store (pending lint-early-a)`. Root should update those
    PENDING strings. They fail the same way at the base commit.
- `difftest --suite parse --sample 200`: 200/200 MATCH (run `20261013-124437-res-graph-qeyt`).
- `difftest --suite resdump-nocore --sample 50`: 1 MATCH, 49 UNPORTED (run `20261013-124445-res-graph-qdi5`).
  The driver still stops at the lint store, before expansion, so this lane's code is not reached there yet.

## Oracle test (build_reduced_graph.test.ts)
- **How it runs.** It uses resolver_new.test.ts's `with_tcx` (crate name = file stem). Then `Resolver::new`, an
  `ExtCtxt`, and `MacroExpander::expand_crate`. That assigns the real NodeIds through the InvocationCollector and
  calls `visit_ast_fragment_with_placeholders` → `collect_definitions`.
- **What it compares** with the resdump probe:
  - `definitions` (DefKind, DefKey, DefPathHash, in DefIndex order);
  - `visibilities_for_hashing`;
  - `owners` (ids plus `node_id_to_def_id`);
  - `module_children`. The test builds this from the module resolution tables the way `finalize_resolutions_in`
    does for modules without imports.
- **Passing cases (9):** items, impls, blocks, fields, nested, exprs, foreign, proc_macro_stub, and use_trees
  (PARTIAL: no module_children until res-imports lands).
- **Negative controls:** I changed one ModChild ident and swapped two definitions lines in the fixtures; both made
  the test fail.
- **Fixture freshness:** with the probe built, a test re-runs it and checks that the fixtures are current.
- **Test-only stand-ins.** Each is installed only while the real method is still the stub placeholder, and each is
  the upstream body restricted to what the cases reach (anything else calls `unported("test stand-in: ..")`):
  - `resolve_dollar_crates`, `visit_ast_fragment_with_placeholders`, `check_reserved_macro_name` (res-macros);
  - `resolve_imports`, `try_plant_decl_into_local_module` + `update_local_resolution`, `NameResolution::new`
    (res-imports);
  - the visibility re-feed check (below).
- **PENDING** (the test asserts that each case stops at exactly this unported):

  | case | stops at |
  |---|---|
  | p_duplicate | `diagnostics::impls::Resolver::report_conflict` |
  | p_extern_crate_self | `imports::Resolver::new_import_decl` |
  | p_impl_trait | `macros::Resolver::insert_impl_trait_name` |
  | p_macro_escape | `diagnostics::impls::Resolver::dcx` |
  | p_macro_rules | `macros::Resolver::compile_macro` |
  | p_vis_restricted | `ident::Resolver::resolve_path` |

## Blocker outside this lane (root, please route)
- **The visibility re-feed.** Every struct and union feeds its `visibility` twice, as upstream does:
  `build_reduced_graph_for_item` at build_reduced_graph.rs:823, then `build_reduced_graph_for_struct_variant` at
  :799.
- **What breaks.** `rustc_middle/query/calls.ts` `query_feed` leaves the re-feed check `unported` ("stable hashing
  of query values"). So in the real driver any crate with a struct or union stops there.
- **What upstream does.** It compares the stable hashes of the old and new value and does nothing when they are
  equal. That needs StableHash for `Visibility<ModId>`.
- **In the test.** A stand-in does the same check by value equality.

## `unported(...)` left
- `insert_unused_macro`: `DenseBitSet::new_filled(nrules)`. lib.ts's `DenseBitSet` is a type-only stand-in and
  rustc_index's bit_set is not ported. Every unused `macro_rules!` whose name does not start with `_` reaches it.
- Reached through other lanes' stubs:
  - imports: `try_plant_decl_into_local_module`, `new_import_decl`, `NameResolution::new`;
  - macros: `compile_macro`, `check_reserved_macro_name`, `invocation_parent`;
  - ident: `resolve_path`, `maybe_resolve_path`, `maybe_resolve_ident_in_module`, `path_root_is_crate_root`;
  - diagnostics: `dcx`, `report_conflict`;
  - `CStore` (`cstore()` / `cstore_mut()`, wave 11): extern crates and external modules/macros.

## PORT decisions (please record)
1. `InvocationParent` and `ParentScope` are `Copy`. Wherever upstream copies one into storage or a new struct
   (invocation_parents, invocation_parent_scopes, builtin_attrs, ImportData, DelayedVisResolutionError,
   collect_definitions), the port copies it with `clone_InvocationParent` / `clone_ParentScope`, because the
   visitor edits its own copy in place.
2. `DefCollector::res(impl Into<DefId>)` takes a `DefId`. Callers convert with `LocalDefId.to_def_id`.
3. `LoadedMacro` is a local type stand-in (rustc_metadata, wave 11). `load_macro_untracked`'s result is cast to it.
4. `arenas.dropless.alloc_slice(reexport_chain)` → a slice copy. The `extern_module_map` / `extern_macro_map`
   `RwLock` guards are the maps themselves.
5. The `process_extern_crate` call follows lib.ts's `CStore` stand-in, which has no `tcx` parameter (upstream
   creader has one). Fix the stand-in when rustc_metadata lands.
6. `HashMap::insert(..).is_none()` asserts → a `has()` check before `set()` (the stored value may legitimately be
   `0`).

## For root
- Review and keep the decls.ts `compile_macro` change.
- Update the 14 stale driver/output PENDING strings.
- Route the `query_feed` re-feed (visibility StableHash) to the rustc_middle owner.
- When res-imports, res-macros and res-ident land:
  - delete the PENDING / PARTIAL entries that start matching;
  - the test's stand-ins switch off by themselves.
- Delete `docs/claims/wave10-res-graph.md` on integration.

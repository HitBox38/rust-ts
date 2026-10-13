# Handoff: res-lib (wave 10, M2: rustc_resolve core + the shared contract)

Branch `lane/res-lib` (from main d2db7fd, no merges). Commits: codegen set + generator fixes; contract,
generated types, lib.rs port, stubs and the Resolver::new oracle test; contract test; this handoff.

## Files
- **Contract:** `src/rustc_resolve/decls.ts`. It holds the `Resolver`, `DefCollector` and
  `LateResolutionVisitor` classes (fields only) and 520 declarations, `// <file>:<line>` each. These cover:
  - every method of every `impl Resolver` / `impl ResolverExpand for Resolver` block in all 13 files (194 fns);
  - the methods of `DefCollector`, `LateResolutionVisitor`, `ModuleData` (with the `Module` / `LocalModule` /
    `ExternModule` impls), `DeclData`, `IdentKey`, `ExternPreludeEntry`, `ImportData`, `NameResolution`,
    `UnusedImport`, and the visitor structs.
- **Generated** by `bun tools/codegen/types.ts rustc_resolve` (12 files, 278 types, 152 diagnostic derives):
  `{lib,ident,imports,def_collector,macros,check_unused,effective_visibilities,rustdoc,late}.gen.ts`,
  `diagnostics/{mod,impls}.gen.ts`, `late/diagnostics.gen.ts`. build_reduced_graph.rs has no types.
- **Ported:**
  - `src/rustc_resolve/lib.ts`: all of lib.rs.
  - `macros.ts`: `PREDEFINED_TOOLS`, `registered_attr_tools`, `registered_lint_tools`,
    `registered_lint_tools_ast`. `Resolver::new` and `provide` need them.
  - `diagnostics/impls.ts`: `OnUnknownData::from_attrs`, which `Resolver::new` needs.
- **Stubs** (the owning lanes take them over): `ident.ts`, `imports.ts`, `build_reduced_graph.ts`, `def_collector.ts`,
  `macros.ts`, `check_unused.ts`, `effective_visibilities.ts`, `rustdoc.ts`, `diagnostics/mod.ts`,
  `diagnostics/impls.ts`, `late.ts`, `late/diagnostics.ts`.
- **New helpers in `src/rust_ts/`** (outside the brief's paths, so root please review):
  - `keyed.ts`: `KeyedMap`/`KeyedSet`.
  - `stubs.ts`: `unported_methods`, restored from parser-core's version, which fix-parser deleted.
- **Tests:**
  - `src/rustc_resolve/resolver_new.test.ts` with fixtures `resolve_oracle/{empty.rs,empty.resdump.txt}`.
  - `src/rustc_resolve/contract.test.ts`.
- **tools/codegen** (for root review; every other set regenerates byte-identically, checked twice):
  - `types.sets.json`: new set `rustc_resolve` (hand list with notes, `skip` DelayedVisResolutionError, discriminant `Used`).
  - New `typemap.resolve.json`. The `rustc_middle::ty::Visibility` entry gains `default_args` (LocalModId). It
    adds entries for Interned/RwLock/Lock/WorkerLocal, MacroKind, SyntaxContext, ErrCode, Diag,
    ElidedLifetimeInPathSubdiag (subdiagnostic), several ast types, middle/resolve types, TyCtxt, the rustc_expand
    types and Either.
  - `diag_args.json`: one entry, `IntoDiagArg for rustc_hir::def::Res` (`Res_into_diag_arg`).
  - `types.ts` has five fixes, all output-neutral for the existing sets:
    1. **Glob cycle guard.** `absolutize`/`lookup` now skip a (path, module) pair that is already being
       resolved. Without it, a module with three glob imports (`use rustc_ast::*` + `rustc_errors::codes::*` +
       `Namespace::*`) branched exponentially and ran for minutes.
    2. **Multi-segment paths through a glob.** An unresolved multi-segment path tries the glob prefixes, as
       single names already did. Example: `ast::Visibility` under `use rustc_ast::*`.
    3. **`default_args` in Debug.** Debug templates honour `default_args`. Before, a missing argument crashed
       the generator.
    4. **IntoDiagArg through local aliases.** IntoDiagArg follows a local type alias to its target.
    5. **`hand` types inside inline modules.** Example: `mod ref_mut`. These are imported by their flat name
       and nothing is emitted for them (a namespace cannot re-export). A type import of the same name from
       another crate is also dropped when the file means the crate's own item (`Res`).

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools` gives 2631 pass, 1 skip (pre-existing), 0 fail.
- `bun scripts/coverage.ts --check` gives `markers ok (5955; vendor 2403)`.
- `--missing`:

  | file | ported |
  |---|---|
  | lib.rs | 170/170 |
  | macros.rs | 3/40 |
  | diagnostics/impls.rs | 1/61 |
  | every other rustc_resolve file | 0 |

- `RUST_TS_AGENT=res-lib bun scripts/difftest.ts --suite parse --sample 200` gives 200/200 MATCH
  (run `20261013-103324-res-lib-jjpb`).
- Every rustc_resolve hand module loads as a fresh-process entry point. As in other crates, `.gen.ts`
  modules must not be entered first.

## Tests
- **resolver_new.test.ts** builds the `GlobalCtxt` the way `create_and_enter_global_ctxt` does. It takes the real
  `Session` from the driver's `Config`, then:
  - parses and runs `pre_configure_attrs` / `features`;
  - uses `StableCrateId::new` and `Definitions::new`;
  - uses the default providers plus `rustc_resolve::provide`, and feeds `crate_name`, `features_query` and
    `crate_for_resolver`.

  It then runs `resolver_for_lowering_raw`'s prefix (`registered_*_tools`, steal, `Resolver::new`) and
  `into_outputs()`.
  - **What matches the probe:** 24 of the probe's 26 sections, byte for byte. They come from
    `tools/probes/resdump` on an empty crate with the `resdump-nocore` arguments. They are:
    - visibilities_for_hashing, expn_that_defined, macro_reachable_adts, extern_crate_map, maybe_unused_trait_imports;
    - module_children, ambig_module_children, glob_map, main_def, trait_impls, proc_macros;
    - paths_matching_assoc_types, confused_type_with_std_module, doc_link_*, all_macro_rules, stripped_cfg_items;
    - delegation_*, partial_res_map, owners, lint_buffer, disambiguators;
    - definitions, including the root `DefKey` and `DefPathHash`.
  - **Not compared:** `effective_visibilities` and `next_node_id`, which are set later by
    `resolve_crate` and expansion.
  - **Direct asserts:** `next_node_id` 0, no extern prelude under `no_core`, 19 builtin types, 5 predefined
    tools, and the two root modules (`no_implicit_prelude` false and true).
  - **Fixture freshness.** With the probe built, a second test re-runs it and requires the fixture
    to be current.
  - **Negative control:** a changed disambiguator in the fixture fails both tests.
  - **Test-only shortcuts:**
    - The crate name is the file stem, because `validate_crate_name` is unported.
    - The DefId `{:?}` (`DefId(0:0 ~ empty[f992])`) is built in the test from `crate_name` and
      `StableCrateId`, because `def_path_debug_str` is not installed outside the driver.
- **contract.test.ts**
  - **The finder.** Upstream fns come from coverage.ts's `upstreamFns`, plus an impl-block scan over the
    same lexer tokens. The test asserts the two agree.
  - **What it asserts:**
    1. All 194 `impl Resolver` fns (the count is pinned) and every fn of the other contract types' impls
       are declared in decls.ts at their `file:line`. `Debug`/`Deref` impls are excluded; they are
       `debug_<T>` / companion fns.
    2. After loading lib.ts, the more than 400 declared methods exist on their prototypes.
    3. `Resolver` is assignable to rustc_expand's `ResolverExpand` (checked by tsc).

## Contract rules for the follow-on resolve lanes
1. **Where the declarations live.** `src/rustc_resolve/decls.ts`, grouped by upstream file in upstream
   order. The `Resolver`, `DefCollector` and `LateResolutionVisitor` *classes* live there too: their impls
   are split over several files. Other types' methods are `declare module "./x.gen.ts"` / `"./x.ts"`
   augmentations in the same file.
   - decls.ts is root's from now on; do not edit it. For a missing or wrong declaration, write it in
     your handoff.
   - If you cannot type-check without the change, add a local `declare module "./decls.ts"` in your file,
     marked `// PORT(decls): pending root`.
   - Statics and trait-impl methods (`Visitor`) are listed as comment lines.
2. **How to fill a stub.**
   - **Methods.** Write `Resolver.prototype.<name> = function (this: Resolver, ..) { .. }` (or the
     `DefCollector` / `LateResolutionVisitor` / gen-class prototype). Put the `// rustc:` marker above it,
     keep upstream order, and delete the name from the file's `unported_methods(..)` list. Delete the
     call when the list is empty.
   - **Free fns, companions and statics.** These are already in the stub with their final signatures:
     fill them in place and add the marker. The forms are:
     - `export function x(..)`;
     - enum companions `export const RibKind = { ..., is_label_barrier(self: RibKind) }`;
     - gen-class statics `Rib.new = function ..`;
     - the hand visitor classes, with `static` methods in the class body.
   - **Visitor methods.** The visitor structs and the two split classes `extends visit.Visitor`. Override
     on the prototype. The stub's placeholders shadow the base defaults until you do.
   - **Delegating `ResolverExpand` methods.** `next_node_id` (macros.rs:173) and `resolve_imports`
     (macros.rs:255) only call the inherent method of the same name. Put their markers on a comment and
     never assign them, or the call recurses forever.
3. **Init order.** Breaking these rules gives a TDZ `ReferenceError` at load.
   - lib.ts is the crate root. It imports decls.ts first, then lib.gen.ts, then every extension file, and
     only then attaches lib.rs's methods.
   - An extension file's **top-level code** may touch only `./decls.ts` (the classes), its own `.gen.ts`
     and other crates. Read every other rustc_resolve export (including lib.ts's) inside function bodies only.
   - late.ts must not need late/diagnostics.ts at top level, or the reverse.
   - Consumers outside the crate import `src/rustc_resolve/lib.ts` only.
4. **Representation** (PORTING §5 handle rules; lib.ts header).
   - **Interned values are the object itself.** `Module` / `LocalModule` / `ExternModule` are aliases of
     the `ModuleData` object; `Decl` = `DeclData`; `Import` = `ImportData`; `NameResolutionRef` =
     `CmRefCell<NameResolution>`. Equality is `===`. `x.to_module()` is the identity, and so is the
     `Deref` (`Module.deref`).
   - **Arenas** (`ResolverArenas`) keep nothing. `alloc_*` returns its argument, `alloc_ast_paths`
     clones, and `alloc_macro_rules_scope` makes the `MacroRulesScopeRef` box.
   - **`CmResolver` is the `Resolver`.** `cm()` / `cm_mut()` return `this`, and `cm_mut` keeps its
     speculative assert. `self: CmResolver` methods are ordinary methods. Write
     `this.get_mut()` / `reborrow()` as `RefOrMut.get_mut(this)` / `RefOrMut.reborrow(this)`, which are
     identities.
   - **`CmRefCell<T>`** is a class with `value`.
     - `borrow(r)` and `borrow_checked(r)` return the value.
     - `borrow_mut(r)` / `borrow_mut_checked(r)` return the cell as a `MutRef<T>`:
       `*guard = v` is `guard.value = v`.
     - `take(r, T_default)` gains the default as a parameter.
   - **`CmCell<T>`** has `get()`, `set(v, r)`, `set_checked(v, r)` and `update(r, f)`.
   - **`Macros20NormalizedSyntaxContext`** is the branded `SyntaxContext` number.
     `update_unchecked(MutRef, f)` passes the box on as `MutRef<SyntaxContext>`.
   - **`MacroRulesScopeRef`** = `MutRef<MacroRulesScope>`. `.read()` is `.value`, `.write()` is the box,
     and its Debug is `debug_RwLock`.
   - **Struct-keyed maps and sets.** Keys of type `DefId`, `Ident`, `IdentKey`, `BindingKey` or tuple need
     `KeyedMap`/`KeyedSet` (src/rust_ts/keyed.ts), built with lib.ts's `DefId_key`, `Ident_key`,
     `IdentKey_key`, `BindingKey_key` and `OrdSpan_pair_key`.
     - They *are* `Map`s / `Set`s, so their declared type stays `Map<..>`.
     - The resolver's own fields are already built that way. So are `ResolutionTable` (use
       `new_ResolutionTable()`) and `RegisteredTools`.
     - Locally built ones must be too: `Rib.bindings`, `PatternBindings`, `seen_trait_items`, ...
     - Equality helpers: `IdentKey_eq`, `BindingKey_eq`.
   - **Field renames.** A field whose name is also a method gets `_`: `tcx_`, `next_node_id_`,
     `lint_buffer_`, `field_defaults_`, `item_generics_num_lifetimes_`, `registered_attr_tools_`,
     `registered_lint_tools_`, `on_unknown_data_`.
   - **Enums and statics.** Unit variants are the gen singletons (`PendingDecl.Pending`); data variants are
     object literals. Gen-class statics follow the `X = gen.X as typeof gen.X & {..}` pattern (lib.ts:
     `ParentScope.module`, `Segment.*`, `IdentKey.*`, `BindingKey.*`, `ModuleData.new`, `LocalModule.new`,
     `ExternModule.new`, `Finalize.*`, `ExternPreludeEntry.flag/open_flag`).
   - **`Used` order.** `PartialOrd` on `Used` is `Used_discriminant`.
5. **Stand-ins in lib.ts** for crates that are not ported. Replace each when its owner lands:
   - `CStore` (+ `CStore.from_tcx/_mut`, unported until wave 11);
   - `DenseBitSet`;
   - `TraitCandidate` (hir.rs, M3);
   - `Set1` (resolve_bound_vars);
   - `Range<T>`;
   - `PrimTy_ALL` / `PrimTy_name` (hir.rs:3331/3368);
   - `DefId_get_attrs` (ty/mod.rs:2349 `impl HasAttrs for DefId`).

   decls.ts has `MissingLifetimeKind` = `unknown`, as in typemap.middle.

## Wiring for driver-m2: constructing the `Resolver`
Import `src/rustc_resolve/lib.ts`.
1. Call `rustc_resolve.provide(providers.queries)` in `default_query_providers` (passes.ts). It sets
   `registered_attr_tools` / `registered_lint_tools`.
2. `resolver_for_lowering_raw(tcx, null)` (passes.rs:791) is then:
   ```ts
   const arenas = Resolver.arenas();
   tcx.registered_attr_tools(null); tcx.registered_lint_tools(null); // uses `crate_for_resolver`
   const [krate, pre_configured_attrs] = tcx.crate_for_resolver(null).steal();
   const resolver = Resolver.new(tcx, pre_configured_attrs, krate.spans.inner_span, krate.spans.inject_use_span, arenas);
   // configure_and_expand(krate, pre_configured_attrs, resolver): ExtCtxt.new(sess, ecfg, resolver /* : ResolverExpand */, ..)
   tcx.untracked().freeze_cstore();
   const { global_ctxt, ast_lowering } = resolver.into_outputs();
   ```
3. `resolver.resolve_crate(krate)` is in lib.ts. It reaches the other lanes' stubs (`finalize_imports`, ...) and then
   `CStore.from_tcx_mut` (wave 11). Inside `configure_and_expand`, `resolver.lint_buffer()` is the
   `LintBuffer`.

The test's `with_tcx` (resolver_new.test.ts) is a working template for everything up to `Resolver::new`.

## `unported(...)` left in ported code
- `CStore.from_tcx` / `from_tcx_mut`: rustc_metadata, wave 11. Reached by `cstore()`, `cstore_mut()`,
  `def_span` (extern), `extern_prelude_get_flag` and `resolve_crate`'s postprocess.
- `DefId_get_attrs` for a local DefId: `hir_attrs`, M3. Only extern ids reach it from
  `legacy_const_generic_args`.
- `item_generics_num_lifetimes` and `item_required_generic_args_suggestion` for extern DefIds:
  `tcx.generics_of`, M3.
- The `{:#?}` of `node_id_to_def_id` in `local_def_id`'s panic message: UnordMap Debug order.
- Everything else reachable goes through the stubs' `unported_methods` placeholders and the stub free fns.

## PORT decisions (please record)
1. Contract-first layout, following parser-core:
   - decls.ts holds the three split classes plus every method declaration;
   - per-file stubs use `unported_methods` (src/rust_ts/stubs.ts, restored);
   - the init-order rule is the one under "Init order" above.
2. The representation in rule 4: interned object identity, erased arenas, `CmResolver` = `Resolver`,
   `CmRefCell` as a `MutRef` view, the `MacroRulesScopeRef` box, `Macros20NormalizedSyntaxContext`
   branded, and `KeyedMap`/`KeyedSet` for struct keys.
3. The field renames for clashes with methods.
4. `LocalModule::to_module` / `ExternModule::to_module` are one method carrying both markers (lib.rs:957, 979).
5. The `ResolverExpand` delegations `next_node_id` / `resolve_imports` are not separate methods.
6. `DelayedVisResolutionError` is hand-written in lib.ts (codegen `skip`). Its `ast::Visibility` clashes with
   `ty::Visibility` in lib.gen.ts imports.
7. `CmRefCell::take` takes `T_default`. `PathResult::failed` builds the `Failed` struct literal.
   `Resolver::into_outputs` converts `trait_impls` to rustc_middle's `DefId_hash_key`-keyed shape. The
   `Steal` type names are `rustc_hir_id::definitions::PerParentDisambiguatorState` and
   `rustc_errors::decorate_diag::LintBuffer`.
8. Stand-ins (rule 5) carry no markers. The two stub ports in macros.ts and diagnostics/impls.ts do carry
   markers, and their owning lanes keep them.

## For root
1. Review the tools changes above. Then record the decisions and point the wave-10 resolve lanes
   (res-graph, res-ident, res-imports, res-macros, res-late-*, res-diag, res-late-diag-*) at
   "Contract rules".
2. **driver-m2.** See "Wiring". driver-m2 adds `rustc_resolve.provide` to `DEFAULT_QUERY_PROVIDERS`.
   Once its `resolver_for_lowering_raw` exists, resolver_new.test.ts could drive the real path
   instead of its own `with_tcx`.
3. **std candidates:**
   - `KeyedMap`/`KeyedSet`, which could replace rustc_hir_id's `DefPathDataMap` and the
     `DefId_hash_key` maps;
   - `Range<T>`;
   - the `index_map` helper (HashMap `Index`).
4. **Debug through the RwLock typemap.** `rustc_data_structures::sync::Lock` is still a transparent type
   map entry. Its Debug (`Lock { data: .. }`) is printed as the inner value; only ExternPreludeEntry's
   derived Debug reaches it.
5. Delete `docs/claims/res-lib.md` on integration.

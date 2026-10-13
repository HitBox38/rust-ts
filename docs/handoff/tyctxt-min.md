# Handoff: tyctxt-min (wave 8, M2)

Branch `lane/tyctxt-min` (main merged twice: stable-hash, then target-cfg + hir-def). Commits by part:
queries codegen + engine core, engine + rustc_query_impl + TyCtxt, engine tests, passes.ts, generator tests, this handoff.

## Files
- **Codegen (part 1)**
  - `tools/codegen/queries.ts` (new): the `rustc_queries!` generator.
    - It parses queries.rs with our rustc_lexer port, following rustc_macros/src/query.rs (`QueryEntry::parse`, `parse_query_modifiers`, `returns_error_guaranteed`).
    - It fingerprints query.rs's `QueryModifiers` and query_api.rs's `define_query_api!` matcher, and stops with `ERROR` if upstream changes them.
    - It writes `src/rustc_middle/queries.gen.ts`.
    - Run it with `bun tools/codegen/queries.ts [--check]`. The report goes to `$RUST_TS_DATA/codegen/queries.report.json`.
  - `tools/codegen/queries.config.json` (new): path aliases, key-type → `KEY_*` impls, `IntoQueryKey` conversions, Display table, the non-query `TyCtxt` methods and free fns a `desc` may call, and the tagged enums.
  - `tools/codegen/typemap.middle.json` (new): type-map entries for re-export paths (`rustc_hir::def_id::*`, `rustc_ast::NodeId`, `rustc_errors::ErrorGuaranteed`), Res/Namespace/PerNS/DefKind, UnordMap/UnordSet/NodeMap/FxIndexSet, Steal, Visibility, the resolve types and Limits.
  - `tools/codegen/types.sets.json`: new set `rustc_query_impl`, which produced `src/rustc_query_impl/diagnostics.gen.ts`.
  - `tools/codegen/diag_args.json`: one entry, `rustc_structures::Limit` → `Limit_into_diag_arg` (QueryOverflow). This file belongs to root/codegen-diag; please review.
- **rustc_middle (parts 2 and 3)**, under `src/rustc_middle/`:
  - `lib.ts`: load order, then `define_query_api()` and `define_hooks()`.
  - `queries.ts` (`describe_as_module`) and `queries.gen.ts`.
  - `query/{mod,caches,calls,job,keys,system,erase,arena_cached,into_query_key,query_api}.ts`.
  - `ty/context.ts`, `ty/context/tls.ts`, `ty/mod.ts` (Visibility plus the def-tree helpers), `hir/mod.ts` (`parent_module_from_def_id`).
  - `hooks.ts` and `util/mod.ts` (the `Providers` bundle).
  - `middle/resolve.ts` and `middle/privacy.ts`.
  - `dep_graph/graph.ts`: the disabled DepGraph only.
  - `ich.ts`, taken over from stable-hash. Its `UntrackedForHashing` is now a `Pick` of the real `Untracked`.
- **rustc_query_impl**, under `src/rustc_query_impl/`: `{lib,execution,job,handle_cycle_error,query_vtables,diagnostics,self_profile,incremental}.ts`.
- **rustc_data_structures**: `src/rustc_data_structures/steal.ts` (new; `Steal`, `debug_Steal`, `stable_hash_Steal`).
- **rustc_interface (part 4)**: `src/rustc_interface/passes.ts`, the `create_and_enter_global_ctxt` path only.
- **Tests**: `src/rustc_middle/query/engine.test.ts` and `tools/codegen/queries.test.ts`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=60000 src tools`: 2221 pass, 1 skip (already there), 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (4573; vendor 2403).
- `RUST_TS_AGENT=tyctxt-min bun scripts/difftest.ts --suite parse --sample 300`: 300/300 MATCH (run `20261013-075844-tyctxt-min-hkjq`).
- `bun tools/codegen/queries.ts --check`: up to date.
  - 329 queries and 8 non-queries.
  - 195 unknown (unported) types, 62 descriptions unported, 44 key types without a `QueryKey` impl, 161 value types without Debug.

## Coverage (`--missing`)

| | ported |
|---|---|
| **rustc_middle `query/`** | |
| query_api.rs | 12/12 |
| calls.rs | 12/12 |
| caches.rs | 26/26 |
| job.rs | 3/3 |
| system.rs | 2/2 |
| erase.rs | 2/2 |
| arena_cached.rs | 5/5 |
| into_query_key.rs | 8/8 |
| keys.rs | 23/63 (only the impls for ported key types) |
| **rustc_middle, other files** | |
| queries.rs | 1/1 |
| hooks.rs | 3/3 |
| ty/context/tls.rs | 8/8 |
| ty/context.rs | 40/202 |
| ty/mod.rs | 17/150 |
| hir/mod.rs | 1/30 |
| middle/resolve.rs | 12/12 |
| middle/privacy.rs | 21/21 |
| dep_graph/graph.rs | 9/62 (disabled graph only) |
| ich.rs | 10/10 |
| **rustc_query_impl** | |
| lib.rs | 2/2 |
| execution.rs | 15/22 |
| job.rs | 10/16 |
| query_vtables.rs | 7/7 |
| handle_cycle_error.rs | 2/11 |
| self_profile.rs | 1/14 |
| incremental.rs | 1/8 |
| **Others** | |
| rustc_data_structures steal.rs | 6/6 |
| rustc_interface passes.rs | 6/29 |

**Not done, listed for a follow-up lane:**
- `middle/stability.rs`.
- `lint.rs` (`LintLevelSource`, `lint_level`). Lane lint-early-a lists `rustc_middle/lint.rs`, so this fits there.
- `ty/print` (`def_path_str`).

## Engine design (D3)
- **Declarations are generated.** `QueryTypes`, the typed method and provider tables, `TaggedQueryKey` and `QUERY_DECLS` (QMODLIST, `desc`, key impl, value Debug) come from queries.rs.
- **The runtime is hand-ported and generic**, once for all queries:
  - `define_query_api()` (query_api.ts) puts `tcx.$q(key)`, `tcx.at(span).$q`, `ensure_ok()/ensure_result()/ensure_done().$q` and `TyCtxtFeed.$q(value)` on the prototypes.
  - `make_query_vtable` (rustc_query_impl/query_vtables.ts) builds one `QueryVTable` per query.
- **Execution and caching.**
  - Execution is upstream's non-incremental path: `try_execute_query` → `execute_job_non_incr` → `start_query`, with the `ImplicitCtxt` in tls.
  - Values are cached in `SingleCache`, `VecCache`, `DefIdCache` or `DefaultCache`, chosen by the key's `QueryKey` impl. `hash_key` is the JS map key.
  - The DepNodeIndex values are virtual ones from the disabled `DepGraph` (`next_virtual_depnode_index`).
- **Cycles.** A key that has already started is a cycle (single-threaded): `find_cycle_in_stack` → `create_cycle_error` → the generated `Cycle` diagnostic, or `NestedCycle`, and then `default` (emit + `raise_fatal`).
  - The `type A = B; type B = A;` test reproduces the oracle's stderr byte for byte. The full text is quoted in engine.test.ts. It covers:
    - the spans
    - "...which requires"
    - "completing the cycle"
    - the alias note and helps
    - "cycle used when"
    - the error count
- **Panics.** A panic or fatal error during a query poisons its key, through the `ActiveJobGuard` drop done as catch + rethrow. `print_query_stack` gives the "query stack during panic" lines, which are tested.
- **Feeding** goes through `query_feed` and the disabled graph's `with_feed_task`.
  - A second feed of a `no_hash` query is upstream's `bug!`, and this is tested.
  - A second feed of a hashed query is unported, because query values have no StableHash.

## TyCtxt contract for the resolve / expand lanes
Bring the engine up with `import "src/rustc_middle/lib.ts"` (or `rustc_query_impl/lib.ts`). The real entry point is `passes.create_and_enter_global_ctxt(compiler, krate, tcx => ..)`.
- **Methods ported in context.ts:**
  - `tcx.sess`
  - `tcx.dcx()`
  - `tcx.untracked()`: `{ cstore, source_span: Span[], definitions, stable_crate_ids }`
  - `definitions_untracked()`
  - `cstore_untracked()`
  - `features()`: the `features_query` feed
  - `crate_types()`
  - `stable_crate_id(cnum)` and `stable_crate_id_to_crate_num`
  - `def_key`, `def_path`, `def_path_hash`
  - `create_crate_num(scid)` returns a `Result` holding a `TyCtxtFeed<CrateNum>`
  - `create_local_crate_def_id(span)`
  - `tcx.at(span).create_def(parent, name|undefined, def_kind, override|undefined, disambiguator)` and `tcx.create_def(..)` return a `TyCtxtFeed<LocalDefId>`. They feed `def_kind`, then `def_span` (`at` variant only), then `visibility` (closures and opaques).
  - `feed_unit_query()`
  - `feed_visibility_for_trait_impl_item`
  - `local_visibility`
  - `module_children_local`, `extern_mod_stmt_cnum`, `resolver_for_lowering()`
  - `recursion_limit()` and the other limits (via the `limits` query)
  - `local_crate_exports_generics()`
  - `with_stable_hashing_context(f)`
  - `finish()`
- **Methods ported from ty/mod.rs and hir/mod.rs:** `opt_parent`, `parent`, `opt_local_parent`, `local_parent`, `def_id_partial_cmp`, `is_descendant_of`, `opt_item_name`, `item_name`, `parent_module_from_def_id`.
- **Queries:** `tcx.<query>(key)`, for all 329. Keys that take a `DefId` also accept `LocalDefId`, `OwnerId`, `ModId` or `LocalModId` (`IntoQueryKey`). The unit key is `null`.
- **Providers:** the lanes set them in `DEFAULT_QUERY_PROVIDERS()` (passes.ts), with upstream's provider signatures.
  - Local providers of `separate_provide_extern` queries get the local key: `LocalDefId`, `"LocalCrate"`, `LocalModId`.
  - Extern providers get the full key.
  - The lanes add their crate's `provide` call where the PORT comment lists it.
- **Feeding:** `feed.def_kind(..)`, `feed.visibility(Visibility<ModId>)`, `feed.crate_name(sym)`, and every feedable query.
- **Types:**
  - `ty.Visibility` (`{ $: "Public" } | { $: "Restricted", _0 }`, with `Visibility.*` fns)
  - `resolve.{PartialRes, LifetimeRes, ModChild, Reexport, ResolverGlobalCtxt, ResolverAstLowering, PerOwnerResolverData, MainDefinition, DocLinkResMap(+_key), AstOwner}`
  - `privacy.{Level, EffectiveVisibility, EffectiveVisibilities}`
  - `Steal` (`Steal.new(v, rust_type_name)`)

## unported(...) left (reachable)
- **create_and_enter_global_ctxt stand-ins** (passes.ts):
  - `pre_configure_attrs` and `features` (rustc_expand, wave 9). `pre_configure_attrs` is a no-op for an empty attribute list.
  - `parse_crate_name` and `#![crate_type]`, when there are attributes (attr-parse).
  - `validate_crate_name` and `invalid_output_for_target` (rustc_session output.rs).
  - `build_output_filenames` (util.rs).
  - `CodegenBackend::supported_crate_types`, which is not on the backend stand-in.
  - `CStore::new` (wave 11). A stand-in `CrateStore` whose methods are unported.
  - `Path::file_stem`.
  - `CrateNameDoesNotMatch` and the `UnsupportedCrateType*` diagnostics.
  - `override_queries`.
- **DEFAULT_QUERY_PROVIDERS:** `analysis`, `resolver_for_lowering_raw` and `early_lint_checks` (driver-m2), `env_var_os`, `proc_macro_decls_static`. Every other crate's `provide` is still to come (listed in passes.ts).
- **Query values.** No StableHash yet for re-feeding a hashed query (`query_feed`) or for `check_feedable_consistency`. The value Debug is missing for 161 value types (`format_value`).
- **Descriptions and keys.** 62 descriptions (`ty::print`, `.value` fields, Display of `Ty`, ...) are unported, and `tcx.def_path_str` itself is unported (ty::print). 44 key types have no `QueryKey` impl (`key_unported`).
- **Incremental and parallel:**
  - the incremental paths (`execute_job_incr`, `execute_query_incr_inner`, on-disk cache, `-C incremental`, `-Z incremental-verify-ich`)
  - `-Z self-profile` strings
  - `signal_complete` with waiters (parallel)
  - the custom cycle handlers of `fn_sig`, `check_representability(_adt_ty)`, `variances_of` and `layout_of`
- **TyCtxt methods:** `feed_hir`, `typeck` (`typeck_root_def_id`), `GlobalCtxt.data_layout` (computed lazily), and `definitions()` (needs the `analysis` provider).
- **Debug and hashing:**
  - Debug of `ResolverGlobalCtxt`, `ResolverAstLowering`, `PerOwnerResolverData` and `DocLinkResMap` (their UnordMap/NodeMap fields print in FxHash order).
  - `LifetimeRes::Fresh` (`MissingLifetimeKind`, M3).
  - StableHash of `EffectiveVisibilities`.
  - provide's `is_panic_runtime`, `is_compiler_builtins`, `has_panic_handler`.

## PORT decisions (please record)
1. **Declarations generated, engine generic** (D3). Query methods are installed at load time by `define_query_api()`. Clashes with hand-written methods panic.
2. **Erasure and arenas are identities.** `Erased<T>` = `T`, and `ProvidedValue` = `Value`.
3. **The `QueryKey` trait** becomes `KEY_*` dictionaries:
   - `make_cache` replaces `type Cache<V>`.
   - `hash_key` stands for `Eq + Hash`.
   - `debug_local` gives the local key's Debug for `default_query`.
   - `QueryVTable.key_impl` carries the dictionary.
4. **No dep graph (D3).**
   - `DepGraph` is the ported *disabled* graph, and every `Some(data)` path is unported.
   - `DepNode::construct` is skipped in `query_feed` (the disabled graph ignores the node).
   - `hash_value_fn` is kept only as present/absent.
5. **Single-threaded.**
   - One shard.
   - `is_dyn_thread_safe()` = false.
   - The waiter-based cycle search (`find_cycle`, `process_cycle`, `break_query_cycle`, ...) and `latch_wait_on`/`wait_for_query` are not ported (unreachable).
   - The `ActiveJobGuard` drop is catch + rethrow.
6. **Load-order rule for `TyCtxt` methods from other upstream files** (calls.rs, ty/mod.rs, hir/mod.rs, ty/print). The methods are declared in the `TyCtxt` class and delegate to `TyCtxt_<name>(tcx, ..)` free functions in the mirrored files, which carry the markers (PORTING §8).
   - Reason: an ESM cycle with prototype-extension modules imported by context.ts would hit the class TDZ.
   - Exception: query and hook methods are installed by lib.ts.
7. **middle/resolve.rs and privacy.rs are hand-written**, not generated.
   - Their `Visibility` and `Res` fields use default type arguments, which type-map templates cannot express.
   - privacy.rs's `const impl` breaks the typedefs probe.
8. **`Steal.new(value, type_name)`.** It stands in for `std::any::type_name::<T>()` in the panic messages. The `Steal` Debug follows lock_api 0.4.14 `RwLock` (`Steal { value: RwLock(RwLock { data: Some(..) }) }`).
9. **`GlobalCtxt.data_layout` is lazy**, pending rustc_abi. Interners, common types and caches are not ported (no `Ty`).
10. **Desc translation.** `desc` closures are translated only when every part is understood (queries.config.json); otherwise the description is unported. `format_args!` evaluates its arguments in written order.

## For root
- **`rustc_interface/stand_ins.ts` `CurrentGcx`** (target-cfg's interface.ts/util.ts): replace it with `rustc_middle/ty/context.ts`'s `CurrentGcx`.
  - Then passes.ts can pass `compiler.current_gcx`; today it creates a fresh one, with a PORT note.
  - Type `Compiler.override_queries` as `(sess, providers: rustc_middle Providers) => void`.
- **`rustc_driver_impl/lib.ts`** still calls `unported(..create_and_enter_global_ctxt..)` directly. Wire it to `passes.create_and_enter_global_ctxt` when driver-m2 lands; driver.oracle.test.ts expects those messages today.
  - The ICE hook should call `rustc_query_impl.print_query_stack(tcx, icx.query, num_frames, file)` (upstream `interface::try_print_query_stack`).
- **Review the codegen config edits:** `diag_args.json` (Limit), `typemap.middle.json`, and the `rustc_query_impl` set.
- **`docs/claims/tyctxt-min.md`** can be removed on integration.

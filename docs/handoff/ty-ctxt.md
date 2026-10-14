# Handoff: ty-ctxt (M3, wave 15): rustc_middle ty/context.rs + ty/context/impl_interner.rs

Branch `lane/ty-ctxt` (from main `a62a248`, no merges). Commits: context.rs port; impl_interner.rs port + contract pin;
unit tests; this handoff.

## Files touched
- `src/rustc_middle/ty/context.ts` (context.rs): every remaining fn, in upstream order inside the `TyCtxt` class body
  (PORTING §8) or as module items:
  - `impl inherent::{DefId, Safety, Features, Span}` as companion objects `inherent_DefId` / `inherent_Safety` /
    `inherent_Features` / `inherent_Span` (self first).
  - `CommonConsts::new` (real body; stops at the `ValTree` interning, see below), `FreeRegionInfo` + `debug_FreeRegionInfo`,
    `GlobalCaches` (fields; `Default` stops UNPORTED; `GlobalCtxt.caches` / `tcx.caches` built on first read like
    `types`), `_assert_tcx_fields`, the `Deref` marker on the getters.
  - All `TyCtxt` methods of context.rs: `has_typeck_results` .. `lift`, `ty_ordering_enum` .. `coroutine_is_async_gen`,
    `def_path_hash_to_def_id`, `is_target_feature_call_safe`, `adjust_target_feature_sig`, `env_var`, `is_method`,
    `iter_local_def_id`, `def_path_hash_to_def_index_map`, `is_suitable_region`, `return_type_impl_or_dyn_traits(_with_type_alias)`,
    `has_strict_asm_symbol_naming`, `caller_location_ty`, `article_and_description`, `all_traits_including_private`,
    `visible_traits`, `local_opaque_ty_origin`, `report_unused_features`, `debug_stats` (+ `sty_debug_print!`'s `go`),
    `safe_to_unsafe_fn_ty` .. `signature_unclosure`, `check_args_compatible(_inner)`, `check_alias_term_args_compatible`,
    `debug_assert_*`, `emit_bug_args_compatible`, `check_and_mk_args`, `mk_param_from_def`, `mk_place_*`,
    `mk_poly_existential_predicates` (real now), `mk_fn_sig` + the three `mk_fn_sig_*_rust_abi`,
    `emit_node_span_lint`, `crate_level_attribute_injection_span`, `disabled_nightly_features`, `emit_node_lint`,
    `in_scope_traits`, `named_bound_var`, `is_late_bound`, `late_bound_vars`, `map_opaque_lifetime_to_parent_lifetime`,
    `is_stable_const_fn`, `is_const_trait_impl`, `intrinsic`, the solver flags (`next_trait_solver_globally`,
    `disable_*`, `renormalize_rigid_aliases`, `use_typing_mode_post_typeck_until_borrowck`, `assumptions_on_binders`),
    `is_impl_trait_in_trait`, `get_impl_future_output_ty`, `metadata_dep_node`, `needs_coroutine_by_move_body_def_id`,
    `do_not_recommend_impl`, `is_trivial_const`, `is_entrypoint`.
  - `InternedInSet` impls (`clone`, `into_pointer`, the four `Borrow`/`PartialEq`/`Hash` groups) as functions over the
    canonical intern key.
  - Lift: `TyCtxt::lift` is the identity (decision 2); the `nop_lift!` / `nop_list_lift!` / `Interned` `Lift` impls
    and the three compile-time helpers inside `nop_lift!` are `rustc-skip` (PORTING §3: rustc's `Lift`).
  - `provide`: `is_panic_runtime` / `is_compiler_builtins` (`find_attr!(tcx, crate, ..)` over `hir_krate_attrs`) and
    `has_panic_handler` (`lang_items().panic_impl()`) are real now.
  - Removed: the merge-w14 `unported_methods(TyCtxt.prototype, "rustc_middle::ty::context::TyCtxt", [14 names])`
    placeholder call (all 14 are real class methods now).
- `src/rustc_middle/ty/context/impl_interner.ts` (impl_interner.rs): rewritten as the full port; the stub list
  (`unported_methods(.., "rustc_middle::ty::context::impl_interner::TyCtxt", [50 names])`) is gone. Methods that only
  forward to a same-named inherent method / query carry their marker plus a `served by ..` line (decision 3).
  `Interned_get` (the `rustc_type_ir::intern::Interned` impl) and the three `bidirectional_lang_item_map!` expansions.
- `src/rustc_middle/ty/contract.test.ts` (ty-contract's; sanctioned by its handoff "update the pin as they land"):
  `INHERENT_CONTEXT_RS = []`; the "a stub stops as UNPORTED" probe uses `typeck_root_def_id_local` (util.rs stub)
  instead of `trait_is_marker`, which is ported now.
- New `src/rustc_middle/ty/context.test.ts` (17 tests).

## Coverage
| file | ported |
|---|---|
| ty/context.rs | 202/202 (7 rustc-skip: the `Lift` impls and `nop_lift!` helpers, lines 1672/1677/1682/1683/1709/1739/1752) |
| ty/context/impl_interner.rs | 115/115 |

`bun scripts/coverage.ts --check`: `markers ok (9674; vendor 3888)`.

Note on impl_interner.rs:774/791/802: each `bidirectional_lang_item_map!` invocation line holds two `fn`s.
`scripts/coverage.ts` keys markers by `path:line` (one name per line, the last), so only the
`solver_*_to_lang_item` fn gets a `// rustc:` marker; the `lang_item_to_solver_*` fn on the same line has a plain
comment (`// impl_interner.rs:774 lang_item_to_solver_lang_item (PORT: same macro line ..)`). `--missing` counts both
as covered. **Root:** if `--check` should validate both names on such lines, `scripts/coverage.ts` needs a change.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4124 pass, 1 skip (pre-existing linux-only), 0 fail (on commit `98500f4`+tests; `src/rustc_middle` re-run green after the final `iter_local_def_id` fix).
- `RUST_TS_AGENT=ty-ctxt --sample 100`: hir-tree-nocore 100/100 MATCH (`20261014-051154-ty-ctxt-gv93`), expanded 100/100
  (`20261014-051212-ty-ctxt-wlik`), hir-tree 100/100 (`20261014-051244-ty-ctxt-0nys`). No DIFF, no UNPORTED.

## Tests (`ty/context.test.ts`)
- `mk_fn_sig` interns `inputs ++ [output]` through `mk_type_list`; the `_rust_abi` variants' `FnSigKind`; the
  `CollectAndApply` `Result` path stops at the first `Err` (inputs and output); `check_and_mk_args` / `mk_args_trait`
  identities; `mk_poly_existential_predicates` (empty asserts, one predicate interns without `stable_cmp`);
  `InternedInSet` Borrow/Eq/Hash agree with interning; `lift` identity; `CommonConsts::new` stops UNPORTED.
- Accessors: the solver flags against session options and `features().generic_const_exprs()`, `default_traits`,
  the `inherent_*` impls, `debug_FreeRegionInfo` `{:?}`/`{:#?}`.
- **Interner method table against upstream:** every fn inside `impl<'tcx> Interner for TyCtxt<'tcx>` (108) has its
  exact marker in impl_interner.ts and a callable `TyCtxt` method under its `Interner` interface name (`ir_` prefix
  where renamed), none of them a context.ts / impl_interner.ts placeholder; every `served by` line names a method or
  query of the same name that exists; the three lang-item lists equal upstream's macro input and the generated
  `Solver*LangItem` enums.

## `unported(...)` left (subsystem-bound)
- context.ts:
  - `CommonConsts::new`: the `ValTree` interning + `ScalarInt::TRUE/FALSE` (lane ty-results). `tcx.consts` still stops.
  - `GlobalCaches::default` (traits `SelectionCache`/`EvaluationCache`, search_graph `GlobalCache`,
    `CanonicalParamEnvCache`): `tcx.caches`, hence `with_global_cache` / `with_canonical_param_env_cache`.
  - `body_codegen_attrs` for consts (`CodegenFnAttrs::EMPTY`), `mk_adt_def` (`AdtDefData::new`),
    `allocate_bytes_dedup` (MIR interpret, M4), `mk_place_downcast` (`AdtDef::variant`).
  - `return_type_impl_or_dyn_traits(_with_type_alias)`: `TraitObjectVisitor` (ty/diagnostics.rs).
  - `trait_may_define_assoc_item`: `elaborate::supertrait_def_ids`, `AssocItems::filter_by_name_unhygienic`.
  - binder.rs (lane tyir-binder): `ty_ordering_enum` (`no_bound_vars`), `caller_location_ty` (`instantiate`),
    `ty_is_opaque_future` (`skip_binder`), `get_impl_future_output_ty` (`iter_instantiated_copied`),
    `needs_coroutine_by_move_body_def_id` (`instantiate_identity`, only for closure-desugared coroutines).
  - `mk_poly_existential_predicates` with ≥ 2 predicates: `stable_cmp` (ty/predicate.rs, lane ty-args).
  - `emit_bug_args_compatible`: `Generics::own_args` (only reachable with debug assertions).
  - `report_unused_features`: the `UnusedFeature` `#[derive(Diagnostic)]` (codegen), only when a feature is unused.
  - `debug_stats`: iterating an interner (`Sharded::lock_shards`).
  - `metadata_dep_node` (`make_metadata`, dep graph D3); pre-existing: `direct_interners!` stubs (`intern_valtree`,
    `mk_pat`, `mk_const_alloc`, `mk_layout`, `mk_adt_def_from_data`, `mk_external_constraints`,
    `intern_canonical_input`), `feed_hir`, `def_path_str`, `data_layout`, `FailedWritingFile`.
- impl_interner.ts: `with_cached_task` (`DepGraph::with_anon_task` is not in dep_graph/graph.ts), `mk_tracked` /
  `get_tracked` (`WithDepNode`, traits/cache.rs), `trait_ref_and_own_args_for_alias` (`TraitRef::from_assoc`),
  `ir_clauses_of` / `own_clauses_of` / `ir_const_conditions` / `ir_explicit_implied_const_bounds` (generics.rs /
  binder.rs), `supertrait_def_ids` (elaborate.rs), `associated_type_def_ids` (`AssocItems::in_definition_order`).
- Reached through other lanes' stubs (not mine): `typeck_root_def_id_local`, `def_kind_descr(_article)`,
  `is_user_visible_dep`, `opt_alias_variances`, `expand_abstract_consts`, `anonymize_bound_vars`,
  `for_each_relevant_impl` (util/abstract_const/fold/trait_def stubs); `opt_associated_item` (ty/mod.rs stub; so
  `is_method` still stops, now one call deeper); `Ty::new_*`, `Region::new_*`, `Const::new_param`, `type_at`.

## PORT decisions (please record)
1. `rustc_type_ir::inherent::*` impls on foreign types (`DefId`, hir `Safety`, `Features`, `Span`) are companion
   objects `inherent_<Trait>` in context.ts, taking `self` first; generic code keeps calling the same-named inherent
   methods directly.
2. `TyCtxt::lift` is the identity: every rustc_middle `Lift<TyCtxt>` impl returns its input after asserting it is
   interned in this `TyCtxt`, and the port has one `TyCtxt` whose interners made every value. The `Lift` impls are
   `rustc-skip` per PORTING §3.
3. `impl Interner for TyCtxt` methods whose body is `self.<same name>(..)` (an inherent method or a query, incl. the
   `map_bound(IntoIterator::into_iter)` / `.copied()` adaptors that are identities on lists) keep their marker in
   impl_interner.ts followed by `// served by the inherent|query `<name>``, no code (matches the decls.ts comment lines).
4. `GlobalCaches` / `GlobalCtxt.caches` are built on first read (like `types`/`consts`, ty-contract decision 3);
   `Default` stops UNPORTED until the trait/solver cache types land.
5. `emit_node_span_lint` / `emit_node_lint` reach `rustc_middle/lint.ts` (an extension module of `TyCtxt`) through a
   runtime `require("../lint.ts")` (`middle_lint()`), since a static import from the defining module would hit the
   class TDZ (ty-contract "Init order"). Precedent for `require`: rustc_resolve/graph_oracle/args.ts.
6. `cfg!(debug_assertions)` bodies (`debug_assert_args_compatible`, `debug_assert_alias_term_args_compatible`,
   `debug_assert_existential_args_compatible`) are kept as comments; the fns are no-ops like the release oracle.
7. Stand-ins (module-local, PORT comments, not markers) for fns of files not ported yet: `HasAttrs_DefId_get_attrs`
   (ty/mod.rs:2349, upstream body), `AssocItem_is_method` (assoc.rs:156, upstream body),
   `GenericParamDef_to_early_bound_region_data` (generics.rs, upstream body), `Generics_own_args`,
   `ExistentialPredicate_stable_cmp`, `elaborate_supertrait_def_ids`, `EarlyBinder_no_bound_vars`,
   `EarlyBinder_instantiate_skip_norm_wip` (all `unported`). Binder stand-ins `Binder_map_bound` / `Binder_skip_binder`
   are tyir-kind's (ty_kind.ts). **Root:** repoint when ty-mod, ty-adt-assoc, ty-args, tyir-binder land.
8. Local pending types in context.ts: `Thir`, `AdtKind`, `AllocId`, `IntrinsicDef`, `DepNode`, `Local`, `ResolvedArg`
   (`Pending`/`PendingEnum`), and partial shapes `CodegenFnAttrs { target_features }`, `TargetFeature { name }`,
   `Place { local, projection }`, `VarError`. impl_interner.ts reads `TraitDef` fields through a local
   `TraitDefFields` and `TraitImpls.blanket_impls` as the field (`blanket_impls()` is `&self.blanket_impls`).
9. `env_var`: `&OsStr` is a JS string (rustc_interface `env_var_os`), so `to_str()` never fails (`NotUnicode` unreachable).
10. The lazy iterators of `all_traits_including_private` / `visible_traits` / `opaque_types_and_coroutines_defined_by`
    are generators: `crates(())` / `nested_bodies_within` / `opaque_types_defined_by` run when the chain is built,
    `is_user_visible_dep` / `is_coroutine` / `traits(cnum)` as it is consumed (upstream query order).

## For root
- `rustc_metadata/rmeta/decoder.ts:1690` builds `DiagnosticItems.id_to_name` as a plain `Map<DefId, Symbol>`; it must
  be a `DefIdMap` (D5) for `get_diagnostic_name` (`id_to_name.get(id)`) to find extern items.
- `DepGraph::with_anon_task` (disabled graph: `(op(), self.next_virtual_depnode_index())`) is missing from
  dep_graph/graph.ts; the next solver's `with_cached_task` needs it.
- rustc_lint/context.ts's `emit_node_span_lint` / `emit_node_lint` stand-ins (lines ~572) can call the real
  `tcx.emit_node_span_lint` / `tcx.emit_node_lint` now.
- scripts/coverage.ts: two fns on one line (macro invocations) — see Coverage.
- `TyCtxt.def_path_str` in the class body is still the tyctxt-min unported stub (ty-print lanes).

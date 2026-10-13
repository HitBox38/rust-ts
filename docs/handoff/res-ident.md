# Handoff: res-ident (wave 10, M2: rustc_resolve ident.rs)

Branch `lane/res-ident` (from main bb96986, no merges). Commits: the port; the unit tests; a test fix plus one
more PENDING case; this handoff.

## Files
- `src/rustc_resolve/ident.ts`: all of ident.rs. The stub's `unported_methods(..)` call is gone.
  - 21 `Resolver` methods are on `Resolver.prototype`, in upstream order.
  - `impl From<UsePrelude> for bool` is `UsePrelude.bool_from`.
  - The nested fn `record_segment_res` is an inner function of `resolve_path_with_ribs`, with its own marker.
- `src/rustc_resolve/ident.test.ts` (new): 29 tests, 9 of them PENDING (see "Tests").
- I touched no other file. decls.ts needs one change; see "decls.ts".

## Checks
- `bun scripts/coverage.ts --missing compiler/rustc_resolve/src/ident.rs`: **23/23 ported**.
- `bun scripts/coverage.ts --check`: `markers ok (6162; vendor 2403)`.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3048 pass, 1 skip, **14 fail. These failures were there
  before this lane.** The lane base bb96986 has the same 14 when run alone:
  - 12 in `src/rustc_session/output.oracle.test.ts`;
  - 2 in `src/rustc_driver_impl/driver.oracle.test.ts`.

  All 14 are PENDING entries that expect a stop at `rustc_resolve::Resolver::arenas (pending res-lib)`. They have been
  stale since root wired in the real `Resolver`. See "For root".
- `ident.test.ts`: 29 pass.
- `RUST_TS_AGENT=res-ident bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run
  `20261013-110238-res-ident-vbf7`). The parse suite does not reach ident.rs; this run only shows there is no regression.

## Hygiene operations used (all ported; checked against the markers)
- **rustc_span hygiene.rs:**
  - `SyntaxContext`: `adjust` (:790), `remove_mark` (:753), `glob_adjust` (:829), `normalize_to_macros_2_0` (:886),
    `normalize_to_macro_rules` (:895), `root` (:701).
  - `ExpnId`: `root` (:268), `expect_local` (:289), `expn_data` (:294), `is_descendant_of` (:299),
    `outer_expn_is_descendant_of` (:313).
  - `LocalExpnId::expn_data` (:227).
- **rustc_span lib.rs (`Span`):** `with_ctxt` (:757), `shrink_to_hi` (:821), `edition` (:984), `is_rust_2015` (:990),
  `at_least_rust_2018` (:996), `allows_unstable` (:1031), `remove_mark` (:1292), `normalize_to_macros_2_0` (:1322),
  `normalize_to_macro_rules` (:1327).
- **lib.ts `mod hygiene`:** `Macros20NormalizedSyntaxContext::{new, new_adjusted, update_unchecked}`.
- **lib.ts `IdentKey`:** `IdentKey::{new, new_adjusted, with_root_ctxt, orig}`.

## Tests (`ident.test.ts`)
**Setup.** A real `Resolver` comes from `Resolver::new`, built with the `with_tcx` template from resolver_new.test.ts:
the empty `#![no_core]` crate, edition 2015. The tests then plant declarations, `NameResolution`s, modules,
macro_rules scopes and helper attrs into it by hand. Expected values follow the upstream code paths; there is no oracle
run, because a real crate's resdump `partial_res_map` needs expansion, imports and late resolution first.

**What is covered:**
- **`visit_scopes` order** for every `ScopeSet`:
  - each namespace, `Macro(Derive)` vs `Macro(Bang)`, `Module`, `ModuleAndExternPrelude` and `ExternPrelude`;
  - `#[no_implicit_prelude]`, through the empty module;
  - leaving a block module through `hygienic_lexical_parent`;
  - an early `Break`;
  - macro_rules path compression (`Invocation` → `Empty` rewritten in place) and the `Def` → `Invocation` →
    invocation-parent walk.
- **`resolve_ident_in_scope`**, scope by scope:
  - module non-globs: hit, determinate miss, and `Undetermined` when there are unexpanded invocations;
  - the finalize path through `finalize_module_binding`, for both non-globs and globs;
  - the `PROC_MACRO_DERIVE_RESOLUTION_FALLBACK` lint buffering;
  - builtin types and attrs, the tool prelude, the `macro_use` prelude, the extern prelude (items and flags), the std
    prelude, macro_rules (Def, Invocation, Empty), derive helpers (`rfind`) and derive-helper compat.
- **`resolve_ident_in_module`:** `self`, `crate`, `$crate`, `{{root}}` (`path_root_is_crate_root`), `OpenModule`
  (`self` / flag miss / other namespace) and `ExternPrelude`. Path-segment keywords give a determinate error.
- **`resolve_path`:**
  - `crate`, `{{root}}` and the empty path;
  - every keyword-in-wrong-position message (global-path, `self`-middle, `super`, `crate`);
  - the unfinalized placeholder message;
  - a trailing `self` in MacroNS.
- **`validate_res_from_ribs`**, without finalize: locals, type params, const params, `SelfTyAlias` and the
  forward-ban `assert_eq!` panic text.
- **`maybe_push_ambiguity`:** the BuiltinAttr, DeriveHelper, MoreExpandedVsOuter and GlobVsExpanded kinds, the no-ambiguity
  cases, and the issue-145575 and issue-149681 hacks. Also `maybe_push_glob_vs_glob_vis_ambiguity` without an import.
- **`finalize_module_binding`:** a missing binding, a public binding, and a private one in both modes: reported
  (`report_private`) and blocking. The private case uses a real `create_def`'d module for the restriction.
- **`single_import_can_define_name`** with no single imports.

**PENDING.** Each entry keeps its full expectations. Today the test asserts that the case throws exactly the listed
`Unported`. Delete an entry when its lane lands:

| case | stops at today | also needs |
|---|---|---|
| `All(TypeNS)` finds a planted item | `macros::sub_namespace_match` (res-macros) | |
| ExternPrelude finds an extern crate item | `macros::sub_namespace_match` | |
| `crate::m::mac` through a child module | `macros::sub_namespace_match` | `build_reduced_graph::expect_module` (res-graph), `late::PathSource::is_expected` (late) |
| `All(TypeNS)` falls through to builtin `u8` | `imports::cycle_detection::enter_cycle_detector` (res-imports) | `sub_namespace_match` |
| ModuleGlobs without finalize | `enter_cycle_detector` | |
| `[self]` at the crate root | `build_reduced_graph::Resolver::expect_module` | |
| `[super]` at the crate root (too many supers) | `expect_module` | |
| `[crate]` with finalize records the root res | `diagnostics::impls::Resolver::lint_if_path_starts_with_module` | |
| lexical scope finds a rib binding | `late::RibKind::contains_params` | |

**Validation of the PENDING expectations.**
- I filled the stubs listed above in the working tree with their upstream logic and emptied PENDING. All 29 tests
  passed. The stubs were `sub_namespace_match`, cycle detection, `expect_module` (local map),
  `RibKind::contains_params`, `PathSource::is_expected` for `Type`, and a no-op `lint_if_path_starts_with_module`
  (the 2015 / non-`{{root}}` early return).
- I then reverted that change with `git checkout`; nothing was committed. The patch script is
  `$RUST_TS_DATA/tmp/res-ident/validate_patch.py`.

## `unported(...)` left
- **In ident.ts:** none.
- **Reached through other lanes' stubs:**
  - **res-macros:** `macros::sub_namespace_match`, `resolve_derive_macro_path`.
  - **res-imports:** `imports::cycle_detection::{enter_cycle_detector, ActiveResolutionGuard_drop}`,
    `PendingDecl::decl`, `import_decl_vis`, `import_decl_vis_ext`.
  - **res-graph (build_reduced_graph):** `expect_module`, `expn_def_scope`, `get_macro_by_def_id`.
  - **late:** `RibKind::contains_params`, `PathSource::is_expected`, `ConstantItemKind::as_str`.
  - **diagnostics/impls:** `report_error`, `report_path_resolution_error`, `lint_if_path_starts_with_module`,
    `dcx`.
  - `ToolModuleImported` and `ProcMacroDeriveResolutionFallback` are generated and need nothing more.

## decls.ts (root)
- **`is_accessible_from`** (lib.rs:2442) takes `vis: Visibility<impl Into<ModId>>`, but decls.ts declares only
  `Visibility<ModId>`.
  - ident.rs passes the `Visibility<LocalModId>` of imports (`glob_import.vis`, `single_import.vis`).
  - lib.ts's implementation already accepts both.
  - ident.ts adds a local overload, marked `// PORT(decls): pending root`.
  - **Fix:** declare `is_accessible_from(vis: Visibility<LocalModId | ModId>, module: Module): boolean`, then delete the
    `declare module "./decls.ts"` block at the top of ident.ts.

## PORT decisions (please record)
1. **`impl From<UsePrelude> for bool`** becomes `UsePrelude.bool_from(up)`. It lives on a `UsePrelude` companion in
   ident.ts (`...gen.UsePrelude` plus the method), which shadows the generated export. Upstream has no caller outside
   ident.rs.
2. **Struct update on the `Copy` structs `Finalize` and `ParentScope`** (`Finalize { used, ..f }`,
   `ParentScope { module, ..*parent_scope }`) uses local helpers, `finalize_with` and `parent_scope_with`. They clone,
   then patch. A plain `*parent_scope` copy is `clone_ParentScope`.
3. **The `ActiveResolutionGuard` RAII drop** becomes `try { .. } finally { ActiveResolutionGuard_drop(guard) }`,
   ending where the Rust scope ends:
   - for local non-globs, the `if let Some(resolution)` block;
   - for globs, the rest of the function.
4. **`rib.bindings.get_key_value(&ident)`** becomes `(bindings as KeyedMap).stored_key(ident)` + `get`. **The late
   lanes must build `Rib.bindings` as `KeyedMap(Ident_key)`** (res-lib contract rule 4).
5. **By-value mutable parameters** get explicit copies or boxes:
   - `mut ident: Ident` in `resolve_ident_in_lexical_scope` is a fresh `Ident`, and `ident.span.remove_mark()` goes
     through `field_mut(ident, "span")`;
   - `mut ctxt` in `visit_scopes` is a `MutRef` box, shared with `hygienic_lexical_parent`;
   - the glob loop's `adjusted_ident` is a `clone_IdentKey`, updated through `field_mut(.., "ctxt")`.
6. **`ControlFlow<Determinacy, Determinacy>`** values are built by typed helpers `cf_continue` and `cf_break`.
   `into_value` is a local helper.
7. **Small mappings:**
   - `Edition <= Edition2024` compares `Edition_discriminant`.
   - `assert_eq!(res, Res::Err)` is `assert_eq` with `Res_eq` and `debug_Res(.., debug_NodeId)`.
   - `macro_rules_scope.write()` / `.read()` are the `MutRef` box and its `.value` (res-lib rule 4).
   - `invocation_parent_scopes[&id]` is a `get` that panics with "key not found" when the key is absent.

## For root
1. Fix `is_accessible_from` in decls.ts as described in "decls.ts".
2. **Stale PENDING entries (14).** `rustc_session/output.oracle.test.ts` and `rustc_driver_impl/driver.oracle.test.ts`
   still expect `rustc_resolve::Resolver::arenas (pending res-lib)`. They fail on main as well, since the res-lib
   integration. Point them at the new first `unported`.
3. Delete the PENDING entries in `ident.test.ts` as res-macros, res-imports, res-graph, late and diagnostics land.
4. Delete `docs/claims/wave10-res-ident.md` on integration.

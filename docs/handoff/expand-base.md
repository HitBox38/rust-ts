# Handoff: expand-base (wave 9, M2: expansion)

Branch `lane/expand-base`. Commits: API surface (published first, for the other wave-9 lanes to merge), config +
placeholders, module/config oracle tests, build.rs oracle probe, clone helpers, this handoff.

## Pin facts that differ from the brief
- `expr_to_string`, `get_single_str_from_tts`, `get_exprs_from_tts`, `check_zero_tts` are not in base.rs at the pin:
  they live in `rustc_builtin_macros/src/util.rs` (lane bm-a). `parse_macro_name_and_helper_attrs` is not in
  rustc_expand either. base.rs at the pin is 136 fns, all ported.
- The diagnostics file is `compiler/rustc_expand/src/diagnostics.rs` (no `errors.rs`).
- `lib.rs` declares `mod stats;` (`-Zmacro-stats`, 185 lines): no wave-9 lane owns it (see stubs).

## Files
- **Ported (markers, upstream order)**, `src/rustc_expand/`:
  `base.ts` 136/136, `build.ts` 87/87, `module.ts` 6/6, `config.ts` 15/15, `placeholders.ts` 23/23,
  `diagnostics.ts` 1/1 (+ generated `diagnostics.gen.ts`: 59 types/derives), `lib.ts` (0 fns).
  `coverage --missing` = 0 for all of them; `coverage --check`: markers ok (5176; vendor 2403).
- **Stubs for other lanes** (types/signatures only, `unported` bodies, no markers; replace freely):
  - `expand.ts` (expand-core): `AstFragment` union + companion (`make_*`, `make_opt_expr`,
    `make_method_receiver_expr`, `mut_visit_with`), `AstFragmentKind`, `Invocation`/`InvocationKind`,
    `MacroExpander` (`new`), `ExpansionConfig` (class, all fields; `default` unported).
  - `mbe/macro_rules.ts` (mbe-b): `MacroRulesMacroExpander` (`kinds()`, `as_TTMacroExpander()`,
    `as_AttrProcMacro()`), `ParserAnyMacro` (`static from_tts(..)`, abstract `MacResult` methods).
  - `stats.ts` (no owner yet): `MacroStat` only.
- **Tests**: `module.test.ts` + `expand_oracle/{walk.ts,gen.ts,expected.json,cases/*}`; `build.test.ts` +
  `build_oracle/{gen.rs,out.json}`.
- **tools/** (brief: "a new rustc_expand set"; root please review):
  - `tools/codegen/types.sets.json`: set `rustc_expand` (`derive_default: true` for `MveExtraTokens`).
  - `tools/codegen/types.ts`: one resolver fix: a bare name under a glob `use super::*;` in an inline module
    (`mod metavar_exprs`) now also tries the absolutized glob path followed through the parent's `use`s.
    Regenerating every existing set in place is byte-identical (only the known stray `src/rustc_lexer/lib.gen.ts`
    appears, deleted again).
  - New `tools/codegen/typemap.expand.json` (`rustc_span::MacroRulesNormalizedIdent`) and one `diag_args.json` entry
    (`MacroRulesNormalizedIdent` -> `into_diag_arg_using_display(display_MacroRulesNormalizedIdent)`,
    rustc_error_messages/src/diagnostic_impls.rs:75).

## ExtCtxt / SyntaxExtension contract (for expand-core, mbe-a/b, bm-*, resolve)
Import through `src/rustc_expand/lib.ts` (it loads base.ts, then build.ts which attaches the builders).
- **`ExtCtxt`** (class, base.ts): fields as upstream (`sess`, `ecfg`, `num_standard_library_imports`,
  `reduced_recursion_limit: [Limit, ErrorGuaranteed] | undefined`, `root_path: string`, `resolver: ResolverExpand`,
  `current_expansion: ExpansionData`, `force_mode`, `expansions: Map<Span, string[]>`, `lint_store`,
  `buffered_early_lint`, `expanded_inert_attrs: MarkedAttrs`, `macro_stats: Map<string, MacroStat>` keyed by
  `macro_stats_key(name, kind)`, `nb_macro_errors`). `ExtCtxt.new(sess, ecfg, resolver, lint_store)`; methods `dcx()`,
  `expander()`, `monotonic_expander()` (call `MacroExpander.new`, expand-core), `new_parser_from_tts`, `source_map()`,
  `psess()`, `call_site()`, `expansion_descr()`, `with_{def,call,mixed}_site_ctxt`, `expansion_cause`,
  `macro_error_and_trace_macros_diag`, `trace_macros_diag`, `trace_macros`, `set_trace_macros`, `check_unused_macros`.
  All build.rs builders are methods (`cx.expr_usize(sp, n)`, `cx.path_global(sp, idents)`, ...): `Box<T>` -> `T`,
  `ThinVec`/`Vec`/`SmallVec` -> arrays, `Option` -> `| undefined`, `Vec<u8>` (`expr_byte_str`) -> `Uint8Array`,
  reserved param names get `_` (`typaram(ident, bounds, default_)`).
- **`ExpansionData`** (class) + `clone_ExpansionData(v)` (module shared, `DirOwnership` copied); **`ModuleData`**
  (class, ctor defaults = `Default`) + `with_dir_path`, `debug_ModuleData`.
- **`Annotatable`**: `{ $: "Item", _0 } | { $: "AssocItem", _0, _1: AssocCtxt } | ...`; companion `Annotatable.span/
  visit_attrs/visit_with/to_tokens/expect_*`; `debug_Annotatable`, `clone_Annotatable` (deep, as derive(Clone)).
- **`ExpandResult<T, U>`** = `{ $: "Ready", _0 } | { $: "Retry", _0 }`, `ExpandResult.map`; `()` payloads are
  `undefined`. `MacroExpanderResult = ExpandResult<MacResult, undefined>`, `MacroExpanderResult.from_tts(..)`.
- **Traits** are interfaces; closures become impls through `<Trait>_from_fn(f)`: `MultiItemModifier_from_fn`,
  `BangProcMacro_from_fn`, `AttrProcMacro_from_fn`, `TTMacroExpander_from_fn` (`MacroExpanderFn`).
  `AttrProcMacro_provided(impl)` supplies `expand_with_safety`. `GlobDelegationExpander`, `ResolverExpand`
  (implemented by rustc_resolve, wave 10; methods as upstream, `Result<.., Indeterminate>`), `LintStoreExpand`.
- **`MacResult`**: interface; `MacResult_provided` is an abstract base class with the provided defaults (markers
  there) — implementors `extends MacResult_provided` and override (MacEager, DummyResult). A type that overrides
  every method (ParserAnyMacro) may `implements MacResult` (needed for load order: macro_rules.ts must not read a
  base.ts value at top level).
- **`SyntaxExtensionKind`**: union, `_0` holds the impl object (`MacroRules` holds `MacroRulesMacroExpander`);
  `SyntaxExtensionKind.NonMacroAttr`, `.as_legacy_bang(k)`, `.as_attr(k)` (MacroRules returns
  `exp.as_TTMacroExpander()` / `exp.as_AttrProcMacro()`: a class cannot implement both `expand`s), `clone_SyntaxExtensionKind`.
- **`SyntaxExtension`** (class): `new SyntaxExtension(..all fields)`, `SyntaxExtension.new(sess, kind, span,
  helper_attrs, edition, name, attrs, is_local)`, `.default(kind, edition)`, `.dummy_bang`, `.dummy_derive`,
  `.non_macro_attr`, `.glob_delegation`, `ext.macro_kinds()`, `ext.expn_data(..)`.
- `Indeterminate` is a frozen unit value; `DeriveResolution` an interface.
- **config.ts**: `StripUnconfigured` (`configure(node, T_HasTokens, T_HasAttrs)` edits in place and returns
  `node | undefined`; `process_cfg_attrs(node, T_HasAttrs)`, `process_cfg_attr`, `expand_cfg_attr(attr, recursive)`,
  `in_cfg`, `cfg_true(attr, ShouldEmit)`, `maybe_emit_expr_attr_err`, `configure_expr(expr, method_receiver)`);
  `features(sess, krate_attrs, crate_name)`, `pre_configure_attrs(sess, attrs)`. The `configure!` macro has no fn:
  `const n = cfg.configure(..); if (n === undefined) return <default>;`.
- **module.ts**: `DirOwnership` (+ `clone_DirOwnership`), `ModulePathSuccess`, `ParsedExternalMod`, `ModError`
  (+ `ModError.report`), `parse_external_mod(sess, ident, span, module, dir_ownership, attrs)` (pushes inner attrs
  onto `attrs` in place), `mod_dir_path`, `mod_file_path_from_attr`, `default_submod_path`.
- **placeholders.ts**: `placeholder(kind, id, vis)`, `PlaceholderExpander` (`with_capacity`, `add`; MutVisitor
  overrides replace nodes in place with `Object.assign`).

## Tests and evidence
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=120000 src tools`: 2295 pass, 1 skip (pre-existing linux-only), 0 fail.
- `RUST_TS_AGENT=expand-base bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH
  (run `20261013-091724-expand-base-hh0f`).
- **module.test.ts** (18 oracle cases): `expand_oracle/gen.ts` runs the pinned rustc
  (`-Zunpretty=expanded -Zcrate-attr=feature(no_core) -Zcrate-attr=no_core -Zui-testing`) per `cases/<name>/`;
  `walk.ts` (test driver: real `Session` from the driver's `Config`, `passes::parse`, `pre_configure_attrs`,
  `features`, then expand.rs's item cfg/cfg_attr loop + module loading, printed like `-Zunpretty=normal`) must give
  the same stdout, stderr and exit code. Cases: foo.rs / foo/mod.rs / both (E0761) / neither (E0583), `#[path]`
  (incl. missing file, path-file children), nested non-mod-rs (3 levels), inline nested + inside non-mod-rs,
  inline `#[path]` dirs, `mod x;` in blocks (with/without file, with `#[path]`), circular modules, malformed
  `#[path]` (fatal), parse errors (fatal and recovered), cfg'd-out / cfg_attr-pathed / `#![cfg(false)]` module
  files and inner attrs re-collect, cfg/cfg_attr on items (nested, multiple, false), crate_type/crate_name in
  cfg_attr, removed features (E0557 with/without pull note), `-Zallow-features` (E0725), malformed cfg/cfg_attr.
  **16 match; 2 PENDING** (`allow_features`, `cfg_items`: `features()` -> `parse_limited_sym` reaches
  `rustc_attr_parsing::attributes::codegen_attrs::ForceTargetFeatureParser::PATH`, attr-parse-c's stub). With
  `lane/attr-parse-c` merged (scratch worktree) all 18 match; root deletes both PENDING entries after merging it.
  Negative control: changing the circular-modules separator fails `circular`.
- **build.test.ts**: rustc-dev probe `build_oracle/gen.rs` (header has build/run commands) builds an `ExtCtxt`
  with an all-`unimplemented!()` resolver and `current_expansion.id = LocalExpnId::fresh_empty()`, calls 81
  builders / MacEager / DummyResult results and prints `{:?}`; the TS test makes the same calls: 81/81 equal.
  Negative control: a wrong `expr_u32` suffix fails it.
- Not oracle-checked here (need other lanes): `placeholder`/`PlaceholderExpander` (no Debug of `AstFragment`;
  exercised once expand-core lands, via the `expanded-nocore` suites), `configure_tokens` (derive input),
  `configure_expr`/`maybe_emit_expr_attr_err` (expression walking is expand-core's), `SyntaxExtension::new`
  (needs parsed `hir::Attribute`s of macro definitions: mbe-b/resolve), `with_call_site_ctxt`/`with_mixed_site_ctxt`/
  `call_site` (need real `ExpnData`).

## `unported(...)` left
- None in ported files. Reached through stubs only: `rustc_expand::expand::*` (expand-core),
  `rustc_expand::mbe::macro_rules::*` (mbe-b) — `ExtCtxt.expander()/monotonic_expander()`,
  `MacroExpanderResult.from_tts`, `SyntaxExtensionKind.as_legacy_bang/as_attr` for MacroRules,
  `SyntaxExtension.macro_kinds` for MacroRules, `PlaceholderExpander.add` (`AstFragment.mut_visit_with`) and every
  `AstFragment.make_*` in placeholders.ts.

## PORT decisions (please record)
1. Trait objects: interfaces + `<Trait>_from_fn` for the closure blanket impls; `<Trait>_provided` for provided
   methods; `MacResult_provided` is an abstract base class (implementors are classes with state).
2. `MacroRulesMacroExpander`'s two `expand` impls are trait views (`as_TTMacroExpander()`, `as_AttrProcMacro()`).
3. `ExtCtxt::macro_stats` tuple key -> `Map<string, MacroStat>` keyed by `macro_stats_key(name, kind)`.
4. `PathBuf` -> string (std/path.ts rules); `#[cfg(windows)]` and `path::MAIN_SEPARATOR` follow the host
   (`process.platform`), like std/path.ts.
5. `*node = new_node` in `PlaceholderExpander` -> `Object.assign(node, new_node)` (mut_visit.ts rule).
6. `pre_configure_attrs`'s lazy `flat_map(..).take_while(..)` is an explicit loop that stops at the first false
   `#[cfg]` (later attributes are not processed, so no diagnostics from them, as upstream).
7. `flat_map_in_place` is a local copy in config.ts (same as mut_visit.ts's); move both to
   `src/rustc_data_structures/flat_map_in_place.ts` when that file is ported.
8. `Indeterminate` unit struct -> a frozen `{ $: "Indeterminate" }` value; `Copy` objects (`DirOwnership`,
   `BindingMode` in `pat_ident_binding_mode`) are copied where Rust copies them (PORTING §8).
9. `ExpansionData`/`DirOwnership` clones are `clone_ExpansionData`/`clone_DirOwnership` (hand-written: not in a
   codegen set).

## For root
1. Review the tools changes above (`types.ts` glob-import fix, sets entry, typemap/diag_args entries).
2. After merging `lane/attr-parse-c`, delete the 2 `PENDING` entries in `src/rustc_expand/module.test.ts`.
3. Wire `rustc_interface/passes.ts`'s stand-ins for `rustc_expand::config::{pre_configure_attrs, features}` to
   `src/rustc_expand/config.ts` (passes.ts belongs to tyctxt-min/driver-m2).
4. `stats.rs` (`-Zmacro-stats`) has no owner; `stats.ts` is a one-type stub.
5. Disk space on the host dropped to a few hundred MB at one point during this lane (not from this lane: its
   scratch is < 1 MB); a gate run may hit ENOSPC.
6. Delete `docs/claims/wave9-expand-base.md` on integration.

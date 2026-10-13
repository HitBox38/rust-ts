# M2 plan — expansion + name resolution

Accepted by root 2026-10-13; decisions 1-7 taken as recommended (recorded in `docs/state/history.jsonl`).
Source: plan-m2 agent report (read-only planner), transcribed by root.

## 1. What `-Zunpretty=ast-tree,expanded` runs at the pin

`rustc_driver_impl/src/lib.rs:281` → `pp_mode.needs_ast_map()` → `create_and_enter_global_ctxt` →
`tcx.ensure_ok().early_lint_checks(())` → `pretty::print` → for AstTreeExpanded:
`format!("{:#?}", tcx.resolver_for_lowering().1)` (pretty.rs:267).

- `create_and_enter_global_ctxt` (passes.rs:932): `pre_configure_attrs`, `get_crate_name`, `collect_crate_types`,
  `StableCrateId::new` (StableHasher), CStore + `Definitions`, `TyCtxt` with the query system; feeds `crate_name`,
  `features_query`, `crate_for_resolver`.
- `resolver_for_lowering_raw` (passes.rs:791): `Resolver::new(tcx, …)` then `configure_and_expand` (passes.rs:136):
  `pre_expansion_lint` (KeywordIdents) → `register_builtin_macros` → `standard_library_imports::inject`
  (`extern crate std` + prelude) → `expand_crate` → `check_unused_macros` → `test_harness::inject` →
  `ast_validation::check_crate` → `proc_macro_harness::inject` → `resolve_crate` (late resolution, unused checks,
  `CrateLoader::postprocess` loads panic_unwind/compiler_builtins…) → `report_session_incompatibilities`.
- `early_lint_checks` (passes.rs:411): `feature_gate::check_crate`, bad-unicode-ident errors,
  `rustc_lint::check_ast_node` (early lint passes + lints buffered by resolve).
- The expanded output shows no name resolutions; resolution is visible only through diagnostics, hence the
  `resdump` probe below.

### Upstream lines on the path (wc at the pin, excluding tests)

| crate | lines | main files |
|---|---|---|
| rustc_expand | 13,715 | expand 2658, mbe/macro_rules 1870, base 1330, mbe/transcribe 1081, proc_macro_server 881, mbe/macro_parser 746, build 744, mbe/macro_check 649, diagnostics 623, mbe/diagnostics 554, quoted 488, config 445, placeholders 421, metavar_expr 363, module 306, proc_macro 205 |
| rustc_builtin_macros | 14,190 | deriving/* ≈3.9k, format 1185, format_foreign ≈800, asm 652, test 573, assert(+context) 593, test_harness 407, proc_macro_harness 378, source_util 375, cfg_eval 237, standard_library_imports 77, cmdline_attrs 37, ~20 small macros |
| rustc_resolve | 29,509 | late 5873, late/diagnostics 4872, diagnostics/impls 4414, lib 3134, ident 2223, imports 1961, diagnostics/mod 1751, build_reduced_graph 1572, macros 1284, rustdoc 755 (pulldown-cmark 0.11.3), check_unused 641, def_collector 610, effective_visibilities 419 |
| rustc_attr_parsing | 16,315 | needed ≈5–6k: interface 593, context 1222, parser 795, validate_attr 237, template, safety, attributes/{mod,cfg 449,cfg_select 249,crate_level 421,macro_attrs 239,proc_macro_attrs,util}, diagnostics 2134 (generated) |
| rustc_attr_ir | 4,713 | mostly types (data_structures 1504) → codegen |
| rustc_hir | 8,236 | only def.rs (903): DefKind, Res, Namespace, PerNS, MacroKinds; hir.rs is M3 except `hir::Attribute` |
| rustc_hir_id | 806 | definitions.rs 572 (DefPathTable, create_def, DefPathHash via StableHasher) |
| rustc_ast_passes | 4,341 | ast_validation 2250, feature_gate 750, diagnostics 1327 (generated) |
| rustc_lint (early) | ≈7–8k of 26,057 | lib (registration) 799, early 381, context 967, levels 1049, passes 247, early passes in builtin.rs/unused.rs/nonstandard_style/non_ascii_idents/redundant_semicolon/precedence/macro_expr_fragment; rustc_middle/lint.rs 587. All `declare_lint!` must be registered (`#[allow(x)]` checks the full list) |
| rustc_metadata | 11,989 | decode side: decoder 2175, cstore_impl 797, creader 1446, locator 1287, rmeta/mod 634, table 539, parameterized 178, fs 143, diagnostics 685 (generated); encoder (2909) is M5 |
| rustc_serialize | 1,623 | all |
| rustc_codegen_ssa back/metadata.rs | 721 | read half: `DefaultMetadataLoader`; vendor `object` 0.39.1 (archive + ELF read) |
| rustc_middle | 66,059 | needed ≈4–5k: ty/context.rs part (TyCtxt, create_def, feed, create_crate_num), queries.rs 2904 (generated decls), query engine, middle/resolve.rs 342, metadata.rs (ModChild), Visibility, middle/privacy 291, middle/stability 595, lint.rs |
| rustc_query_impl | 2,689 | no rustc_query_system crate at the pin; engine in rustc_middle/src/query + rustc_query_impl |
| rustc_data_structures | — | stable_hash.rs 622 + vendor rustc-stable-hash 0.1.2 (SipHasher128) |
| rustc_target | 30,878 | needed ≈3.5k: spec/mod.rs subset, x86_64-unknown-linux-gnu + linux/unix base, part of target_features.rs |
| rustc_session | — | config/cfg.rs 500 (`build_configuration` currently unported), filesearch 346, search_paths 83 |
| small | — | rustc_structures 467, rustc_crate_store 240, rustc_parse_format 1042, rustc_expand_queries 95, rustc_arena (erase) |
| proc_macro | 5,069 | `library/proc_macro`: types only in M2; bridge is M6 |

## 2. Hard blockers

A. **Every non-`#![no_core]` crate loads std metadata** (`extern crate std`, prelude glob → `module_children`,
`println!` body decoding, imported source files + line tables, exact SyntaxContext numbering from lazy hygiene
decoding, symbol decoding, rmeta + rlib (`lib.rmeta` member in an object wrapper → `object` crate)).
METADATA_VERSION 11, decoded from the oracle's own sysroot; libcore.rmeta is 68 MB → `Bun.mmap` + lazy decoding.

B. **PORTING §3 conflict**: M2 needs Decodable (CrateRoot, tables, ModChild, hir::Attribute/AttributeKind,
DelimArgs/TokenStream, SpanData) and HashStable (`ExpnData::hash_expn`, hygiene decode). → codegen
(`derive(Decodable)`/`derive(HashStable)`), probe-checked. (Decision D2.)

C. **The `no_core` subset of the ui dirs is small** (macros: 0 no_core / 5 no_std / 50 aux; resolve 0/3/43;
hygiene 4/1/22; proc-macro 0/41/201; all tests/ui 278 no_core, 166 no_std, 1,087 aux-build; 268 proc-macro aux,
181 add-minicore). `no_std` still injects `extern crate core`.

D. **Intermediate gate**: all tests/ui with `-Zcrate-attr=feature(no_core) -Zcrate-attr=no_core
-Zunpretty=ast-tree,expanded`. Verified on the oracle: std not in the extern prelude → no metadata; unresolved
names give resolve errors (E0425/E0433) and the AST still prints (exit 0). Exercises cfg stripping, macro_rules,
builtin macros + derives, local resolution + diagnostics, ast_validation, feature gates, early lints. Cases that hit
`extern crate std` report UNPORTED. Needs `cmdline_attrs::inject` (37 lines; unported in passes.ts:48).

E. **Builtin derives** are plain Rust in rustc_builtin_macros (no bridge). User proc macros need M6 → exclude
proc-macro-aux tests until M6 (D6). The proc-macro harness inject is plain AST building.

F. **Hygiene gaps**: decode fns + `HygieneDecodeContext`, `hash_expn` (SipHasher128 + HashStable ExpnData/Span),
verbose `debug_hygiene_data` (for `expanded,hygiene`).

G. **TyCtxt is unavoidable**: Resolver uses tcx (`create_def`, `feed_local_def_id`, `untracked()`, `def_kind`,
`visibility`, `parent`, `item_name` (extern via `provide_extern`), `crate_types`, `features`,
`registered_*_tools`, `lookup_stability`). Minimal surface: GlobalCtxt (sess, crate_types, stable_crate_id,
Untracked{cstore, definitions, source_span}, hooks), memoizing query engine with local/extern providers, feed,
Steal, `ensure_ok`, cycle detection; no dep graph / incremental / on-disk cache; arenas erased (D3).

H. Other: `cfg(target_feature)` + reliable f16 come from the LLVM backend's `target_config` (→ generated table,
D4); `resolve_doc_links` defaults to ExportedMetadata → lib crates with doc links need pulldown-cmark (32 lib-crate
tests in macros/resolve); `FxHashMap` iteration order where upstream iterates (hash_map.ts is unported for >1
entries; may need hashbrown + FxHasher).

## 3. Waves (lanes ≤ ~3k upstream lines; generated diagnostics via codegen-diag)

**Wave 8 — foundations (parallel)**
| lane | scope | deps |
|---|---|---|
| target-cfg | rustc_target spec subset (Target, TargetOptions, linux_gnu/unix base, x86_64-unknown-linux-gnu), session cfg.rs, filesearch, search_paths, `build_configuration`; target_config table from oracle `--print cfg` | — |
| attr-ir-gen | rustc_attr_ir types + Debug via codegen | — |
| attr-parse-a | interface, context, parser, template, safety, validate_attr | attr-ir-gen |
| attr-parse-b | attributes/{mod,util,cfg,cfg_select,crate_level,macro_attrs,proc_macro_attrs}, diagnostics (generated) | attr-parse-a |
| hir-def | hir def.rs, rustc_hir_id, rustc_structures, rustc_crate_store, rustc_parse_format | — |
| stable-hash | vendor rustc-stable-hash 0.1.2, stable_hash.rs, StableCrateId::new, HashStable codegen, hash_expn | — |
| tyctxt-min | query decls (codegen from queries.rs), engine, TyCtxt/feed/create_def subset, middle/resolve.rs, Visibility, ModChild | hir-def |
| harness-w8 | suites `expanded-nocore` (+ `unpretty-expanded-nocore` with `-Zunpretty=expanded`), `resdump` probe (rustc-dev; prints ResolverGlobalCtxt + partial_res_map/import_res of ResolverAstLowering, sorted) | — |

**Wave 9 — expansion + builtins (after 8; ~10 parallel)**: expand-base (base, build, placeholders, module, config);
expand-core (expand.rs, lib, diagnostics); mbe-a (mbe, quoted, macro_parser, macro_check, metavar_expr); mbe-b
(macro_rules, transcribe, mbe/diagnostics); expand-pm-types (proc_macro + proc_macro_server types, bodies
unported); bm-a (lib, util, standard_library_imports, cmdline_attrs, cfg*, source_util, concat*, env, assert,
small macros); bm-format (format, format_foreign); bm-derive-a (deriving/generic, mod, derive.rs); bm-derive-b
(individual derives); bm-rest (test, test_harness, proc_macro_harness, asm, global_allocator, eii, contracts).

**Wave 10 — resolution, passes, lints, driver**: res-lib; res-graph (def_collector, build_reduced_graph);
res-ident; res-imports (+check_unused); res-macros (+effective_visibilities); res-late-a/-b; res-diag
(diagnostics/mod + impls generated); res-late-diag-a/-b; ast-passes (ast_validation, feature_gate); lint-early-a
(registration, early, context, levels, passes, middle lint.rs, all declare_lint! via codegen); lint-early-b (17
early passes); driver-m2 (passes.rs configure_and_expand / early_lint_checks / resolver_for_lowering_raw / global
ctxt, pretty.rs expanded modes).
**Gate M2a**: `expanded-nocore` + `resdump-nocore` protected, ≥95%.

**Wave 11 — metadata (may start alongside 9; needs tyctxt-min + stable-hash)**: serialize (rustc_serialize,
derive(Decodable) codegen, round-trip probe); object-read (vendor object 0.39.1 archive + ELF; DefaultMetadataLoader);
rmeta-types (rmeta/mod, table, parameterized); rmeta-decoder; cstore (cstore_impl subset); creader; locator (+fs,
diagnostics); hygiene-decode (decode_*, imported source files, verbose debug_hygiene_data). harness-w11: `rmetadump`
probe (rustc-dev: every sysroot crate's header/root + per-DefIndex def_key/def_kind/visibility/def_span/
expn_that_defined/attrs/module_children/macro bodies) → `rmeta` suite chunked by crate × index range; suites
`expanded` (all tests/ui with std) and `expanded-hygiene`.
**Gate M2b**: `expanded` ≥95%.

**Wave 12 — ui dirs**: harness `ui-expanded` (compiletest flags; only/ignore for the target; aux rlibs built by the
oracle and passed to both sides via `--extern`/`-L`) over macros, resolve, hygiene, imports, derives;
pulldown-cmark + rustdoc.rs lane; hashbrown/FxHasher iteration order if needed.
**Gate M2**: `ui-expanded` ≥95% on macros + resolve (proc-macro-aux excluded until M6).

## Decisions (all taken as recommended)
1. M2+ suites use `--target x86_64-unknown-linux-gnu --sysroot <oracle sysroot>` on both sides (rust-std installed);
   ELF reader only; host-independent.
2. PORTING §3 amended: Decodable + HashStable via codegen for metadata/hygiene types; encoders until M5.
3. Hand-written minimal query engine (no dep graph) + generated declarations.
4. `target_config` = generated table from oracle `--print cfg --target T`.
5. Aux crates built by the oracle until M5.
6. Proc-macro-aux tests deferred to M6.
7. Gates M2a / M2b / M2 as above.

Critical files: rustc_interface/src/passes.rs, rustc_resolve/src/lib.rs, rustc_expand/src/expand.rs,
rustc_metadata/src/rmeta/decoder.rs, src/rustc_driver_impl/pretty.ts (+ harness/suites.ts).

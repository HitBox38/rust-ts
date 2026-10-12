# Work queue

Top = next. Root keeps this current. Claim items via `docs/claims/<id>.md` (see AGENTS.md).

## M1 — lexer, parser, AST, diagnostics  (gate: `parse` suite = `-Zunpretty=ast-tree` parity on tests/ui)

Infrastructure first (root):
1. **probe-typedefs** — `tools/probes/typedefs`: a Rust probe using `syn` that dumps every
   struct/enum definition of a given upstream crate (fields, variants, derives, generics) as JSON.
2. **codegen-types** — `tools/codegen/types.ts`: from typedefs JSON, emit TS type declarations,
   enum companions and `debug_<Type>` impls following PORTING.md §5. Validate on rustc_lexer
   (generated output must be equivalent to the hand port) before using it on rustc_ast.
3. **codegen-symbols** — `symbols!` (rustc_span/src/symbol.rs) → generated interner prefill.
4. **suite-errors** — add a suite that runs the `ui/parser`, `ui/lexer` tests with their
   compiletest flags (`-Zui-testing` etc.) and compares diagnostics.

Porting lanes (in dependency order; each wave starts after the previous one integrates):
- Wave A: `rustc_data_structures` (subset used by span/ast), `rustc_index`, `rustc_hashes`,
  vendor `rustc_literal_escaper`.
- Wave B: `rustc_span` (BytePos, Span, SourceMap, SourceFile, hygiene stubs, Symbol interner,
  Span Debug = `file:1:1: 1:33 (#0)`), `rustc_ast_ir`, `rustc_ast` (types via codegen),
  `rustc_feature` (tables), `rustc_error_messages`.
- Wave C: `rustc_errors` (DiagCtxt, human emitter, annotate-snippets renderer),
  `rustc_session` (only option parsing + ParseSess needed by the parser).
- Wave D: `rustc_parse::lexer` (StringReader, tokentrees, unicode_chars, diagnostics),
  `rustc_ast_pretty` (needed by parser diagnostics).
- Wave E: `rustc_parse::parser` (mod, item, expr, pat, ty, stmt, path, generics, attr, diagnostics, ...).
- Wave F: driver: `rustc_driver_impl`/`rustc_interface` subset: CLI → parse → `-Zunpretty=ast-tree`.

## Later milestones
See `PLAN.md` §5.

## In flight (wave 1, started 2026-10-11)
| lane | scope | status |
|---|---|---|
| typedefs | syn probe + tools/codegen/types.ts | **merged** |
| escaper | vendor rustc-literal-escaper 0.0.8 + `escape` suite (25,780/25,780) | **merged, protected** |
| span-core | rustc_span lib.rs, span_encoding, analyze_source_file, edition, fatal_error | **merged** |
| span-symbol | symbol.rs (+ symbols! codegen, 2434 symbols oracle-checked), edit_distance | **merged** |
| span-hygiene | hygiene.rs, def_id.rs | **merged** |

Next after integration: wave 2 = span-map (source_map.rs, caching_source_map_view.rs), rustc_ast types via codegen, rustc_errors start; plus reviewer + regression auditor over wave 1.

## Wave 2 (started 2026-10-12)
| lane | scope | status |
|---|---|---|
| span-wire | rustc_span stand-ins → real exports; session globals; float Debug; std char helpers; review-w1 fixes | **merged** (gate-20261012-104747-root-9uvz) |
| ast-types | rustc_ast + rustc_ast_ir types/Debug via codegen (20 .gen.ts, 252 types); newtype_index/bitflags; unknown cfg → ERROR | **merged** (gate-20261012-105724-root-lfad) |
| review-w1 | independent review of wave 1 | **merged** |
| harness-w2 | symdump probe + `symbols` suite; synthetic escape corpus + `escape-synthetic` suite | done, under independent review |

## Wave 3 (2026-10-12) — done
| lane | scope | status |
|---|---|---|
| span-map | source_map.rs, caching_source_map_view.rs, vendor unicode-width 0.2.2 (oracle tables) | **merged** (gate-20261012-154702-root-tr7a) |
| ast-token | rustc_ast token.rs, tokenstream.rs, util/* | **merged** (gate-20261012-185308-root-a805) |
| errors-core | rustc_error_messages (100%), rustc_errors core: DiagCtxt, Diag, codes (518 error codes generated) | **merged** |
| harness-w2 | `symbols` (10) + `escape-synthetic` (11) suites | **merged, protected** (gate-20261012-105941-root-hf6n) |
| audit-1 / gate-provenance | regression audit (CLEAN-WITH-NOTES) → gate records HEAD/dirty, accept refuses partial/dirty/moved runs; oracle cache keyed on rustc_driver build | **merged, reviewed** |

rustc_span is 658/658. Total 1,196 / 25,517 fns.

## Wave 4 (2026-10-12) — done (root host now macOS)
| lane | scope | status |
|---|---|---|
| fluent-syntax | vendor fluent-syntax 0.12.0 | **merged** |
| langid-plural | vendor tinystr, unic-langid(-impl), intl_pluralrules (+ `plurals` probe) | **merged** |
| fluent-bundle | vendor fluent-bundle 0.16, intl-memoizer, type-map, fluent-langneg; rustc_errors formatting wired | **merged** |
| icu-list | vendor icu_list/icu_locale_core/icu_provider/fallback/zerotrie/regex-automata(sparse DFA)/writeable subsets; rustc_baked_icu_data as data (+ `listfmt` probe) | **merged** |
| annotate-a / annotate-b | vendor annotate-snippets 0.12.16 + anstyle 1.0.13 (+ `annotate` probe, 1754/1754 renders) | **merged** |
| ast-core | rustc_ast ast.rs fns, node_id, entry, format, attr/{data_structures,version}, expand/* | **merged** |
| ast-visit | ast_traits.rs, visit.rs, mut_visit.rs | **merged** |
| codegen-derive | generated Walkable/MutWalkable (147x2), clone_<T> (231), Pu128 Debug, Ord discriminants | **merged** |
| harness-fluent | `fluentdump` probe, `fluent-parse`/`fluent-format` suites | **merged, protected** (4210 + 4210), reviewed x2 |
| harness-w4b | difftest batch bisection on failure, vendor markers in coverage.ts, fluentdump line-range guard | **merged**, reviewed |
| review-w23a/b + fix-w23a/b | independent review of waves 2–3 and fixes (Path hash stable ids, desugared_tts u8 wrap, Diag drop bomb, exact assert texts, std path/io/slice) | **merged** |

Compiler fns 1527/25517; vendor 1773/6132 (26 crates). Final gate: gate-20261012-211129-root-ws8a.

## Wave 5 (started 2026-10-13) — lanes: emitter, codegen-diag, lint-defs, feature, ast-attr, harness-w5
1. **emitter**: rustc_errors annotate_snippet_emitter_writer.rs + emitter.rs (replaces the `Emitter` stand-in in rustc_errors/lib.ts),
   timings.rs; json.rs later. Uses annotate-b's contract.
2. **codegen-diag**: `#[derive(Diagnostic/Subdiagnostic/LintDiagnostic)]` via tools/codegen, porting rustc_macros/src/diagnostics.
3. **lint-defs**: rustc_lint_defs lib.rs + `declare_lint!` codegen for builtin.rs, replacing errors-core stand-ins.
   `LintExpectationId` must compare by value (interned handle or canonical key), incl. `Level_eq` and `fulfilled_expectations`
   (review w23b errors-core F2). rustc_feature tables.
4. **ast-attr**: rustc_ast attr/mod.rs.
5. **harness follow-up**: harness-w4b review LOW F2–F4; gate runs unit tests with `RUST_TS_REQUIRE_PROBES=1`; std `Result::unwrap`
   panic text (harness-fluent INFO); w23b F10 marker order in rustc_error_messages/lib.ts.

## Queued (after wave 5, in order)
1. rustc_session subset (parse.rs ParseSess + options the parser reads); the driver must call `dcx.inner.drop()`
   where upstream drops the DiagCtxt (emits stashed diags, flushes delayed bugs).
2. rustc_parse lexer (StringReader, tokentrees, unicode_chars, unescape_error_reporting), then the parser.
3. Follow-ups: move shared helpers into src/std (str helpers from ast-token/span-map/errors-core, path, io, Backtrace);
   `LoneSlash` escape coverage (raw-input mode, harness batch); hash std libs into the oracle key once suites compile against std.

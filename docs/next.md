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

## Wave 5 (2026-10-13) — done
| lane | scope | status |
|---|---|---|
| emitter | emitter.rs, annotate_snippet_emitter_writer.rs, timings.rs; vendor anstream/anstyle-parse/utf8parse/colorchoice/anstyle-query/termize | **merged** |
| codegen-diag | `#[derive(Diagnostic/Subdiagnostic)]` codegen (token-checked vs real expansion, 394 impls); rustc_parse diagnostics generated | **merged** |
| lint-defs | rustc_lint_defs lib + generated builtin lints (oracle `-W help`); LintExpectationId interned | **merged** |
| feature | rustc_feature tables generated, oracle-checked | **merged** |
| ast-attr | attr/mod.rs, rustc_ast_ir fns, single LitKind companion | **merged** |
| harness-w5 | `emit` suite (1466 cases, emitdump probe linking upstream rustc_errors), difftest split fixes, gate requires probes, Result::unwrap text | **merged, protected**, reviewed x2 |

## Wave 6a (2026-10-13) — done
| lane | scope | status |
|---|---|---|
| lexer | rustc_parse lexer/mod.rs, diagnostics.rs, tokentrees.rs (oracle token streams via rustc-dev) | **merged** |
| lexer-aux | vendor unicode-normalization 0.1.25 (nfc probe), unicode_chars.rs, unescape_error_reporting.rs | **merged** |
| session-parse | rustc_session parse.rs (ParseSess), diagnostics.rs (generated), utils.rs; Session stand-in | **merged** |
| session-options | `options!` codegen (`-Z/-C help` byte-exact), options.rs parse fns, config.rs subset | **merged** |
| pp / pprust-state / pprust-ei | rustc_ast_pretty complete (pp engine 715/715, State, expr/item; oracle fixtures via rustc-dev) | **merged** |

Compiler fns 2284/25518; vendor 2172/6531. Final gate: gate-20261012-222820-root-ezdj (emit protected 1466).

## Wave 6b (2026-10-13) — done
| lane | scope | status |
|---|---|---|
| parser-core | Parser contract (decls.ts, 560 methods), mod.rs, token_type.rs, attr.rs, attr_wrapper.rs, nonterminal.rs, rustc_parse lib.rs | **merged** |
| driver-session | vendor getopts 0.2.24; config/session subset; rustc_driver_impl + rustc_interface driver path; CLI oracle | **merged** |
| harness-w6 | `tokens` (crate-root lexing, rustc-dev probe) + `tokens-str` suites; gate/cache/probe hardening | **merged, protected**, reviewed x2 |
| review-w456a/b + fix-w456 | independent review of waves 4–6a + fixes (termize fd leak, Visitor Result footgun, AstNodeWrapper write-through, tuple clones) | **merged** |

Compiler fns 2650/25518; vendor 2277/6637. Final gate: gate-20261013-001906-root-2lda (tokens 25780 + tokens-str 39 protected).

## Wave 6c (2026-10-13) — done: the parser
| lane | scope | status |
|---|---|---|
| parser-ptg / pat-stmt / expr / item / fn-asm / diag | all of rustc_parse/parser (path, ty, generics, pat, stmt, expr(+diagnostics), item, function, asm, cfg_select, diagnostics) | **merged** |
| parser-tests | all 54 parser/tests.rs tests (emitter rendering + parser) | **merged** |
| unicode-width-str | string widths (width_in_str); getopts usage; driver --help/--explain | **merged** |

**`parse` suite: 21,522 / 21,526 tests/ui files byte-identical** (`-Zunpretty=ast-tree` + parser diagnostics), protected
(gate-20261013-012502-root-ad5h). Not matching: 3 subject TIMEOUTs (deep nesting; `{:#?}` builders re-pad every level,
O(depth×size)) and 1 oracle timeout (deep try chain). Compiler fns 3213/25518 (rustc_parse 779/791).

## Wave 7 (started 2026-10-13) — finish M1, scope M2
| lane | scope |
|---|---|
| review-parser-a / review-parser-b | independent review of wave 6b/6c porting lanes (parser files, driver-session, unicode-width-str) |
| fmt-perf | std/fmt Debug builders without per-level re-padding (output byte-identical); clears the 3 parse TIMEOUTs |
| harness-w7 | `parse-ui` suite: tests/ui/{parser,lexer} with compiletest flags (`//@ compile-flags`, edition, -Zui-testing) stopping after parsing; per-suite timeouts for deep-nesting cases; harness-w6-2 J1 |
| plan-m2 | M2 (expansion + name resolution) crate map, order, lane split, oracle suites |

## Wave 8 (started 2026-10-13) — M2 foundations (see docs/plan-m2.md)
target-cfg, attr-ir-gen, hir-def, stable-hash in parallel; then attr-parse-a/-b (after attr-ir-gen), tyctxt-min (after hir-def),
harness-w8 (expanded-nocore / unpretty-expanded-nocore suites + resdump probe; after harness-w7 merges).

## Queued (later)
1. Follow-ups: move shared helpers into src/std (str helpers from ast-token/span-map/errors-core, path, io, Backtrace);
   `LoneSlash` escape coverage (raw-input mode, harness batch); hash std libs into the oracle key once suites compile against std.

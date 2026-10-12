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

## In flight (wave 2, started 2026-10-12)
| lane | scope | status |
|---|---|---|
| span-wire | replace cross-lane stand-ins in rustc_span; session globals end-to-end; Debug exports for codegen; std char/float helpers | running |
| ast-types | rustc_ast + rustc_ast_ir types and Debug via codegen; manual Debug impls; newtype_index/bitflags | running |
| review-w1 | independent review of wave 1 (read-only) | running |

Queued: span-map (source_map.rs, caching_source_map_view.rs, vendor unicode-width 0.2.2) after span-wire; then rustc_errors + rustc_session subset; regression auditor at next protected-set change.

Review follow-ups (review-w1, all medium/low): symdump probe + gate check for symbol table (harness batch);
synthetic literal corpus to cover the 6 escape-error variants the real corpus misses (harness batch);
typemap Cell/RefCell Debug (span-wire); unknown-cfg → ERROR (ast-types); ExpnData copy-before-mutate (span-wire).

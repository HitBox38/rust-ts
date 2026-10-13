# Handoff: mbe-b (wave 9, M2: macro_rules engine, part B)

Branch `lane/mbe-b`. Merged: `lane/mbe-a` (up to de8229d) and `lane/expand-base` (up to 947a891).
`lane/expand-core` is NOT merged (the brief allows only mbe-a / expand-base); see "Integration" below.

## Pin facts that differ from the brief
- `MacroRulesBinding` / `MacroRulesScope`, the unused-macro-rules lint and `trace_macros!` handling are
  not in `mbe/macro_rules.rs` at the pin (they live in rustc_resolve / rustc_builtin_macros / base.rs).
  macro_rules.rs provides `get_unused_rule` / `has_compile_error_macro` (used by resolve's
  `check_unused_macros`) and the trace notes (`trace_macros_note`); both are ported and oracle-tested.
- `annotate_err_with_kind` is in `mbe/diagnostics.rs` (ported there).
- There are no upstream unit tests for these three files.

## Files
- `src/rustc_expand/mbe/macro_rules.ts` — all of macro_rules.rs (67/67).
- `src/rustc_expand/mbe/transcribe.ts` — all of transcribe.rs (23/23).
- `src/rustc_expand/mbe/diagnostics.ts` — all of mbe/diagnostics.rs (15/15), hand part.
- `src/rustc_expand/mbe/diagnostics.gen.ts` — GENERATED (`ExplainDocComment` + its `derive(Subdiagnostic)`).
- `tools/codegen/types.sets.json` — set `rustc_expand` gains `compiler/rustc_expand/src/mbe/diagnostics.rs`;
  its four hand-written types are `skip` (+ `skip_notes`). Regenerating the set leaves
  `src/rustc_expand/diagnostics.gen.ts` byte-identical. **For root review** (tools change).
- Tests/oracle: `src/rustc_expand/mbe/mbe_b_oracle.test.ts`, `mbe_b_oracle/{cases/*.rs (19), out.json, gen.ts,
  probe/{main.rs,Cargo.toml.in}}` (rustc-dev probe `mbeprobe`, tools/probes template format; built by hand in
  `$RUST_TS_DATA/tmp/mbe-b/probe`, build line in Cargo.toml.in; `bun src/rustc_expand/mbe/mbe_b_oracle/gen.ts`
  regenerates out.json). Note: mbe-a's oracle dir is `mbe/mbe_oracle/`; mine was renamed to `mbe/mbe_b_oracle/`
  on merge (both lanes had picked the same name).

## Coverage
`bun scripts/coverage.ts --missing`: macro_rules.rs 67/67, transcribe.rs 23/23, mbe/diagnostics.rs 15/15.
`--check`: markers ok (5341; vendor 2403).

## The oracle (probe `mbeprobe`)
Runs the real rustc driver on an empty `#![no_core]` crate; in `after_expansion` it parses the case as
`FileName::Custom("case.rs")`, computes features (`rustc_expand::config::features`), builds an `ExtCtxt`
(`trace_mac = true`, a stub `ResolverExpand` recording `record_macro_rule_usage`), and walks the items:
`compile_declarative_macro` for every definition (`ext_*` names get `DUMMY_NODE_ID` = "other crate"),
bang invocations in item / const / type-alias / fn-body (stmt, let-init, let-pattern, expr) positions via
`TTMacroExpander::expand` + `make_*`, `#[m]` via `expand_with_safety`, `#[mbe_derive(m)]` via `expand_derive`
(stand-in attribute: the parser keeps no tokens for `#[derive]` items). Each invocation gets
`fresh_empty` + `expn_data` + `set_expn_data` (real `ExpnHash`). Events: definitions (`kinds`, `nrules`,
`get_unused_rule(i)`), expansion ids + hashes, rule usage, pretty-printed results and their `{:#?}` ASTs
(hygiene contexts visible), trace notes (`tts_to_string` of every transcription), the token streams of
attr/derive results, `debug_hygiene_data(false)`, buffered lints, gated spans, non-root symbol-gallery
entries; plus the full human stderr.

Cases: arms (multiple arms; items/expr/stmts/ty/pat), follow (every FOLLOW set, is/may-be, notes),
follow2018/2021 (or-pattern lint vs. pat_param suggestion, `ext_` suppression), def_errors (every
definition error, redundant `$(vis)?` suggestion, doc-comment note, `unsafe` on bang rules), attr_rules /
attr_unstable / derive_rules / derive_unstable (macro_attr / macro_derive: bad delimiters, unsafe
mismatches, `derive =>`, non-local feature error, invocations), nested (nested repetitions, all
transcription errors: no-syntax-vars with typo suggestions, still repeating, contradiction, must repeat
once, separators), metavar_expr (`count`/`index`/`len`/`ignore` + out-of-bounds errors), concat
(`${concat}` ident creation incl. raw idents, literals, tt, invalid ident, floats/suffixes/char, still
repeating), hygiene (local variable hygiene, `$crate`, macro-defining macros, `SEMICOLON_IN_EXPRESSIONS_*`
local/non-local lints, tt metavar-span collisions, every fragment kind through `transcribe_pnr`),
macro2 (`macro` 2.0, comma separators, Opaque transparency), nomatch (failed_to_match_macro: no rules
expected, unexpected end, missing comma suggestion, outer/inner doc-comment labels, local ambiguity,
ambiguity at eof), fragerr (emit_frag_parse_err: incomplete expression, trailing tokens, unbound `$x` with
each suggestion kind, stmt-but-not-expr suggestions, type/pattern labels), misc (compile_error! detection,
lifetimes, raw idents, `]` spacing hack, empty rhs, `$` passed as tt), guard / guard_feat
(`macro_guard_matcher` gate and guard FOLLOW sets).

## Results
- In an integration scratch (`lane/mbe-b` + `lane/expand-core`'s expand.rs, plus a one-line
  `clone_ExpansionData` export in base.ts that expand-core's file needs; see below):
  - **all 19 cases match the oracle byte for byte** once mbe-a's `crate::diagnostics` stand-ins
    (quoted.ts / macro_check.ts / metavar_expr.ts) are replaced by imports from `../diagnostics.ts`;
  - with mbe-a's files as committed, 16 match and 3 are PENDING (below);
  - `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=120000 src tools`: 2413 pass, 1 skip (pre-existing), 0 fail;
  - `bunx tsc --noEmit -p .`: only the two expand-core/expand-base integration errors listed below.
- On `lane/mbe-b` alone: `RUST_TS_AGENT=mbe-b bun scripts/difftest.ts --suite parse --sample 200` → 200/200 MATCH
  (run `20261013-091444-mbe-b-bl5p`). `tsc` reports only missing exports of the expand.rs **stub**
  (`parse_ast_fragment`, `ensure_complete_parse`, `ParserAnyMacro_MacResult`, `AstFragmentKind` as a value),
  which expand-core's expand.ts provides; the mbe-b oracle test cannot load on this branch for the same reason.

## Integration (for root)
1. Merge `lane/expand-core` after this lane: keep expand-core's `src/rustc_expand/expand.ts` over the stub
   (add/add conflict). Two integration errors then remain, both outside this lane:
   - expand.ts imports `clone_ExpansionData` from base.ts, which expand-base does not export
     (`ExpansionData` has a `clone()` method);
   - expand.ts:2044 `Result<undefined, ErrorGuaranteed>` vs `Result<null, ...>`.
2. mbe-a: replace the `crate::diagnostics` stand-in blocks in quoted.ts / macro_check.ts / metavar_expr.ts by
   imports from `../diagnostics.ts` (generated by expand-base); then drop the 3 entries of `PENDING` in
   `mbe_b_oracle.test.ts` (the test fails until you do).
3. Delete `docs/claims/wave9-mbe-b.md`.

## PENDING (mbe_b_oracle.test.ts)
- `concat` → `rustc_expand::diagnostics::MetaVarStillRepeatingLint`, `fragerr` / `nested` →
  `rustc_expand::diagnostics::UnknownMacroVariable` (mbe-a stand-ins, see 2.).
- Not covered by the probe (needs the full expander, i.e. expand-core + resolver + driver-m2): recursion
  limit errors, `cx.reduced_recursion_limit`, eager expansion, macro-expanded `macro_rules!` being used,
  real `#[derive]` invocations of `macro_rules` derives. Cover them through the `expanded-nocore` suite.

## `unported(...)` left (own files)
- `transcribe.ts transcribe_sequence`: `std::collections::HashMap iteration order (hashbrown + FxHasher)` when
  the no-syntax-vars error path sees more than one repeatable or more than one non-repeatable metavariable
  (the order of `interp.iter()` decides the `listify` text and `find_best_match_for_name` ties; with ≤1 each the
  result is order-independent and exact). Needs a hashbrown/FxHasher port (plan-m2 wave 12).

## PORT decisions (please record)
1. `MacroRulesMacroExpander`'s two trait impls are view objects `as_TTMacroExpander()` / `as_AttrProcMacro()`
   (the contract expand-base published); markers on the view methods. Its `kinds` field is `kinds_`
   (clashes with the `kinds()` method).
2. `ParserAnyMacro implements MacResult` with `make_*` methods that call expand.ts's `ParserAnyMacro_MacResult`
   table at call time (expand-core's contract); no markers on them (the markers are on expand.ts's table).
   Nothing in macro_rules.ts reads base.ts / expand.ts / diagnostics.ts at module load (import cycle).
3. `Tracker`: the associated fns `description()` / `recovery()` are methods of the tracker object
   (`T::recovery()` → `track.recovery()`), since the generic is erased. mbe-a's `Tracker` (macro_parser.ts) is
   the matcher-facing subset; mine is assignable to it.
4. `mem::take` / `mem::swap` of `psess.gated_spans.spans` → reassigning the `Map` (`take_gated_spans`).
5. `FirstSets.first: Map<Span, TokenSet | undefined>`: an entry holding `undefined` is `Some(None)`
   (`has()` tells it from a missing one). `FirstSets::first` (method) is `first_of` (field name clash).
6. `TtHandle` eq needs derived `PartialEq` of `mbe::TokenTree` (+ `MetaVarExpr`, `NonterminalKind`), which no
   module provides: local `mbe_TokenTree_eq` / `NonterminalKind_eq` in macro_rules.ts (candidates for mbe.ts /
   rustc_ast token.ts).
7. `TokenStream::clone()` → `new TokenStream(ts._0)` (local `clone_TokenStream`); `DelimSpan`/`DelimSpacing`
   copies (`Copy` in Rust, mutable classes here) are made before mutating; `Token`s are rebuilt, never mutated.
8. `find_attr!(attrs, OnUnmatchedArgs { directive, .. } => directive.clone()).flatten()`: the closure returns a
   wrapper so the first `OnUnmatchedArgs` decides even when its directive is `None` (TS `find_attr` treats
   `undefined` as "no match").
9. `FormatArgs { this, .. }` default field values written out; `CollectTrackerAndEmitter.matches`
   (`FxHashSet`) is a `Map` keyed `input_pos:loc_index` (its reader filters + sorts, order never shows).
10. The oracle test's `Session` is the attr_oracle/mbe_oracle stand-in; `Features` are built from the case's
    `#![feature]` list (the probe's `config::features` result is one of the compared events).

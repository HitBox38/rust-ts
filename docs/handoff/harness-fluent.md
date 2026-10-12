# Handoff: harness-fluent (fluent-parse + fluent-format suites)

## Files touched (all new except the `SUITES.push` addition to `harness/suites.ts`)
- `harness/corpus/gen-fluent.ts`: corpus generator (deterministic; re-running it gives an empty `git diff`).
- `harness/corpus/fluent/**`: 4210 generated `.msgs` files + `.gitattributes` (`* -text`; the records are
  length-framed and some synthetic messages contain CR/CRLF/NUL, so git must never normalize them).
- `tools/probes/fluentdump/{Cargo.toml.in,build.rs,main.rs}`: oracle probe.
- `src/rust_ts/fluentdump.ts`: subject driver.
- `harness/suites.ts`: appended `repoCorpusDeep`, `fluentCases` and the suites `fluent-parse` and `fluent-format`
  (M1, batch, `cwd: REPO`). The existing entries are untouched.
- No changes to `scripts/` or `harness/baseline/`.

## Corpus
**Extraction.** The generator tokenizes every `.rs` file under upstream `compiler/` (2220 files in the sparse checkout)
with the ported `rustc_lexer`, which the `lex` suite protects. So text in comments, doc comments and other string literals
never matches. Over the significant tokens it looks for:
- `# [ <name> ( <literal>` with name in diag, label, note, note_once, help, help_once, warning, suggestion,
  multipart_suggestion. This is the set accepted by `DiagnosticDeriveVariantBuilder` (`diag`) and
  `SubdiagnosticVariant::from_attr` (rustc_macros/src/diagnostics/{diagnostic_builder,utils}.rs). Only the first
  argument is a message.
- `msg ! (|[|{ <literal>`: the `msg` proc macro, `parse_macro_input!(input as LitStr)`.

`#[suggestion_part(code = ..)]` and `code = "..."` are Rust format strings, not Fluent, so they are not extracted.
`inline_fluent!` does not exist at this pin, and nothing else builds `DiagMessage::Inline`.

**Decoding.** This reproduces `LitStr::value()`. Cooked `"..."` literals go through the ported
`rustc_literal_escaper::unescape_str`, which the `escape` suite protects at 25780/25780, `compiler/` included.
Non-fatal results (skipped whitespace after `\`+newline) add nothing to the value. Raw `r#".."#` literals are taken
verbatim.

**Forms found** (4660 occurrences): `#[diag]` 1927, `#[label]` 827, `#[note]` 631, `#[suggestion]` 424, `msg!` 388,
`#[help]` 304, `#[multipart_suggestion]` 151, `#[warning]` 6, `#[help_once]` 1, `#[note_once]` 1.
- **Unextractable: none.** No attribute or `msg!` of these forms has a non-literal first token: no `macro_rules`
  `$msg`, no `concat!`, no bare `#[note]` in code. No literal is a byte/C string or has a suffix.
- Cross-check: a line-anchored grep finds 4270 attribute occurrences, the same as the extracted attribute count minus
  the two `_once` forms (which the grep pattern does not match). The non-anchored grep hits that the lexer skips are
  all in comments or strings in rustc_macros/rustc_hir_typeck.

**Layout.** One case per unique message, 4123 in total after deduplication. The path is
`harness/corpus/fluent/<crate>/<path-without-.rs>/L<line>.msgs`, using the first occurrence (files in sorted path
order, then source order). A `-2`, `-3` suffix is added when several new messages start on the same line. Every
occurrence is kept as a provenance line. 79 upstream files contribute messages.

**Synthetic.** Upstream messages always parse, because rustc_macros rejects invalid Fluent at build time, and they use
only a small part of the syntax. `harness/corpus/fluent/synthetic/S001..S087.msgs` adds 87 hand-written messages
(list and descriptions in the generator). They cover:
- parse errors: 18 `ParserErrorKind`s reached
- entries after the message: attributes, a second message, a duplicate id, comments, terms
- message and term references, including undefined ones and a cycle
- string escapes, number literals, functions (STREQ, unknown, named args)
- every select-expression error, nested selects
- 101 placeables (TooManyPlaceables)
- CRLF, bare CR, NUL, tabs, non-ASCII

**File format.** One record per file; the readers accept several. Format: `//` header line, then
`@ <path>:<line> <form>` lines (or `@ synthetic:<n> <description>`), then `= <byte length>`, then the message bytes,
then `\n`.

## Probe `fluentdump` (`bun scripts/probes.ts build fluentdump`, about 7 s, +46 MB in `target/probes`)
- **Dependencies.** `fluent-bundle =0.16.0`, `fluent-syntax =0.12.0`, `intl-memoizer =0.5.3`, `icu_list =2.3.0`,
  `icu_locale_core =2.3.0` and `unic-langid =0.9.6` use rustc_error_messages' features. The ICU data is the real
  `compiler/rustc_baked_icu_data`, as a path dependency.
- **Lockfile.** Every transitive registry crate is also pinned with `=`. The probe's resolved `Cargo.lock` (48 packages)
  is a subset of upstream's `Cargo.lock`, versions included. I checked this by script after the build. Without the pins
  cargo picked newer icu_provider, zerovec, smallvec, self_cell, memchr, regex-automata and others.
- **Copied code (design choice).** I did not link `rustc_error_messages`/`rustc_errors`. They pull in rustc_macros and
  rustc_span, which need `RUSTC_BOOTSTRAP=1` and `CFG_RELEASE` at build time, and `scripts/probes.ts` `PROBE_ENV` only
  sets those for `symdump`. I may not change `scripts/`. Disk was not the constraint.
  - Instead, `main.rs` contains byte-for-byte copies of these upstream functions:
    - `register_functions`, `icu_locale_from_unic_langid`, `fluent_value_from_str_list_sep_by_and`
    - the `DiagArg`/`DiagArgName`/`DiagArgValue` definitions and `From<DiagArgValue> for FluentValue`
      (rustc_error_messages/src/lib.rs)
    - `to_fluent_args` and `format_fluent_str` (rustc_errors/src/formatting.rs)
  - Each copy sits between `// BEGIN verbatim <path>:<line>` and `// END verbatim`. **`build.rs` fails the build unless
    every block is identical to the pinned upstream file at that line.**
  - Two lines are not verbatim, and each carries a `// PORT:` comment:
    - the `DiagArgValue` derive drops Encodable/Decodable/Hash/Eq/PartialEq.
    - `DiagArgMap` is a plain `IndexMap`. Upstream uses `FxIndexMap`, but insertion order does not depend on the hasher.
  - `trace!`/`debug!` are no-op macros.
  - If root adds `fluentdump: { RUSTC_BOOTSTRAP: "1", CFG_RELEASE: PIN.release }` to `PROBE_ENV`, the probe could
    path-depend on `rustc_error_messages` and drop most of the copies. `format_fluent_str` is private, so that one would
    stay copied.
- **`parse` mode:** prints `{:#?}` of `fluent_syntax::parser::parse(format!("generated_msg = {msg}\n").as_str())`.
- **`format` mode:** calls the copied `format_fluent_str` once per argument row, inside `catch_unwind`. It prints
  `=> Ok(<formatted:?>)`, or `=> panic <payload:?>` for exactly what rustc would ICE with:
  - `try_new(..).unwrap()` and `add_resource(..).unwrap()` failures
  - `value().unwrap()` on a message without a value
  - `Fluent errors while formatting message: [..]`

  The panic hook is silenced.

### Argument matrix (documented in the probe header; the subject mirrors it)
- `vars`: the names after `$` (an ASCII letter, then `[A-Za-z0-9_-]`), deduplicated, in order of first appearance.
- `keys`: every `[ k ]`, where `k` is a run of `[A-Za-z0-9_.-]` with optional spaces or tabs around it.

Both lists come from a **text scan of the message**, independent of the parser under test, so the subject can print
them today.
- Row 0 has no arguments.
- If there are any vars, rows 1..=N follow. Var `i` gets `V[(row-1+i) % N]`, where
  `V = [Str(<var name>), Number(0), Number(1), Number(2), Number(5), Number(-1), Str("1.5"), StrListSepByAnd(["a","b"]), StrListSepByAnd(["a","b","c"]), Str(<key>)...]`.
- So every var sees every value, plural selectors see the categories zero/one/other plus a negative number, and string
  selectors (`[true]`, `[struct]`, ...) get a matching key.
- Floats have no `DiagArgValue` variant (rustc passes them as `Str` through Display), hence `Str("1.5")`.

## Oracle counts (whole corpus, 4210 cases)
| | messages | parse Ok | parse Err | format rows | `=> Ok` | `=> panic` |
|---|---|---|---|---|---|---|
| upstream | 4123 | 4123 | 0 | 18736 | 17170 | 1566 |
| synthetic | 87 | 54 | 33 | 321 | 168 | 153 |

- **Upstream.** 2557 messages reference no variable. All 1566 upstream panics are row 0 (unbound variable,
  `ResolverError(Reference(..))`), and every row with arguments formats Ok.
- **Synthetic panic breakdown:**
  - 115 `called Result::unwrap() on an Err value` (try_new/add_resource)
  - 1 `Option::unwrap()` (attribute-only message)
  - 37 Fluent errors: Reference, Cyclic, TooManyPlaceables
- Output size: parse 5.6 MB, format 2.9 MB.

## Subject `src/rust_ts/fluentdump.ts`
It reproduces the corpus reading, the scans, the matrix and the output framing. **Framing parity was checked on the
full corpus.** With the parse/format step replaced by a constant (scratch copy, not committed), the subject's output
equals the probe's on every `file`/`msg`/`text`/`vars`/`keys`/`args` line of all 4210 cases. That includes `{:?}` of
messages with NUL, CR and emoji.
- **`parse`:** `unported("fluent_syntax::parser::parse")`. The comment at the top of the file gives the wiring:
  `parse` + `debug_Resource` / `ParserError` Debug from `src/vendor/fluent_syntax/{parser/mod,ast/mod}.ts`, as
  `debug_result(.., PRETTY, ..)` of the `Result<Resource, (Resource, Vec<ParserError>)>`.
- **`format` (deviation from the brief, on purpose):** instead of a local `unported(format_pattern)` stub, it calls the
  already-ported `rustc_errors::formatting::format_diag_message({ $: "Inline", _0: msg }, args)`, i.e. the real
  `format_fluent_str`.
  - Today that reaches `unported("fluent_bundle::FluentArgs (rustc_errors::formatting::to_fluent_args)")`.
  - Once fluent-bundle is vendored and wired into `src/rustc_errors/formatting.ts` and `src/rustc_error_messages/lib.ts`
    (`register_functions`, `fluent_value_from_str_list_sep_by_and`, `From<DiagArgValue> for FluentValue`), this suite
    tests the real rustc path with no driver change.
  - A `Panic` thrown by it is printed as `=> panic <msg:?>`, like the probe. Unported and other errors are not caught.
- Exit codes match `symdump.ts` (70 for unported, 101 for an ICE). Partial output is flushed before exiting.

## Results
- `difftest --suite fluent-parse --sample 50` (RUST_TS_AGENT=harness-fluent): UNPORTED=50, no MISMATCH or CRASH.
  `fluent-format --sample 50` gives the same. Full runs: 4210/4210 UNPORTED for both suites, and the oracle side ran
  cleanly over the whole corpus.
- `bunx tsc --noEmit -p .` is clean. `bun test src tools` passes 137/137. `coverage.ts --check` reports markers ok.
- Case-list hashes (`JSON.stringify(cases())`, sha256/16) are identical in root `main` and in the lane:
  - lex 25780 `a8a356bd10b8a7b6`
  - parse 21526 `b244fb01ad2573be`
  - escape 25780 `a8a356bd10b8a7b6`
  - symbols 10 `7b46e1e12e1f8d93`
  - escape-synthetic 11 `6618a744d214bf09`
  - new: fluent-parse/fluent-format 4210 `d2ad8262f1e25426`
- `unported(...)` left: `fluent_syntax::parser::parse` (fluentdump.ts). The format path reaches the existing
  `to_fluent_args` unported in rustc_errors.
- `// PORT:` decisions: the two non-verbatim lines in the probe (above). There are none in the TS.

## What a reviewer should check
1. `build.rs` really checks every verbatim block. Edit a byte inside one block and the build must fail (I verified this
   by changing `set_use_isolating(false)` to `true`: the build failed). Check that the
   non-verbatim lines are only the derive line, `DiagArgMap`, the no-op tracing macros and the imports.
2. The probe's `$RUST_TS_DATA/probes/fluentdump/Cargo.lock` is a subset of upstream `Cargo.lock`, versions included.
3. Extraction completeness: compare against an independent grep, and confirm `suggestion_part`/`code =` are rightly
   excluded. Check that the decoding equals `LitStr::value()` (e.g. via the `escapes` probe on the same literals).
4. The generator is deterministic: run it in a temp copy, then `git status` must be empty. `.gitattributes`
   `* -text` applies (`git check-attr text`).
5. The subject and probe scans (`scan_vars`/`scan_keys`), `read_records` and the row construction are equivalent.
6. Only additions in `harness/suites.ts`, and the case-list hashes above.

## Notes for root
- Build the probe once: `bun scripts/probes.ts build fluentdump`. It needs no extra env.
- The new suites have no baseline. The gate only runs suites that have `harness/baseline/<suite>.txt`, so nothing changes
  until they are accepted. Every case is UNPORTED now.
- When fluent-syntax merges, wire `parse_and_dump` in `src/rust_ts/fluentdump.ts` (see its header comment).

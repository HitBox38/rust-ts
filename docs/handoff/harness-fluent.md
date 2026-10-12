# Handoff: harness-fluent (fluent-parse + fluent-format suites)

Revision 2. This revision fixes the findings of `docs/reviews/harness-fluent.md` (ACCEPT-WITH-FIXES), merges main and
wires `parse` to the vendored fluent-syntax. "Review fixes" at the end maps each finding to its fix.

## Files touched
All files are new except `harness/suites.ts`, where I only appended.
- `harness/corpus/gen-fluent.ts`: the corpus generator. It is deterministic: re-running it gives an empty `git diff`.
- `harness/corpus/fluent/**`: 4210 generated `.msgs` files plus a `.gitattributes` with `* -text`. Records are
  length-framed, and some synthetic messages contain CR, CRLF or NUL, so git must never normalize these files.
- `tools/probes/fluentdump/{Cargo.toml.in,build.rs,main.rs}`: the oracle probe.
- `src/rust_ts/fluentdump.ts`: the subject driver.
- `harness/suites.ts`: appended `repoCorpusDeep`, `fluentCases` and the suites `fluent-parse` and `fluent-format`
  (milestone M1, batch mode, `cwd: REPO`).
- Nothing changed in `scripts/` or `harness/baseline/`.

## Corpus
**Extraction.**
- The generator tokenizes every `.rs` file under upstream `compiler/` (2220 files) with the ported `rustc_lexer`. The
  `lex` suite protects that lexer.
- Among the significant tokens, it extracts:
  - `# [ <name> ( <literal>`, where name is diag, label, note, note_once, help, help_once, warning, suggestion or
    multipart_suggestion. This is the set accepted by rustc_macros `diag` and `SubdiagnosticVariant::from_attr`; only the
    first argument is a message.
  - `msg ! (|[|{ <literal>`.
- It does not extract `#[suggestion_part(code = ..)]` or `code = "..."`. Those are Rust format strings, not Fluent.

**Decoding.**
- `LitStr::value()` is reproduced as follows:
  - cooked literals go through the ported `rustc_literal_escaper::unescape_str`, which the `escape` suite protects;
  - raw literals are taken verbatim.
- The review independently re-extracted everything with syn 2.0.117 `LitStr::value()`: 4658 of 4658 values were
  byte-identical, with nothing missing. The other 2 occurrences are ones syn cannot see:
  - `msg!` inside `gate_multi!(..)`;
  - a file that syn 2 cannot parse.

**Forms found** (4660 occurrences):

| form | count |
|---|---|
| `#[diag]` | 1927 |
| `#[label]` | 827 |
| `#[note]` | 631 |
| `#[suggestion]` | 424 |
| `msg!` | 388 |
| `#[help]` | 304 |
| `#[multipart_suggestion]` | 151 |
| `#[warning]` | 6 |
| `#[help_once]` | 1 |
| `#[note_once]` | 1 |

Nothing was unextractable.

**Layout: content-addressed case ids (review finding 5).**
- One case per unique message: 4123 upstream plus 87 synthetic.
- The path is `harness/corpus/fluent/<crate>/<sha256(message)[:12]>.msgs`. `<crate>` is the crate of the first
  occurrence.
- Every occurrence is kept as a `@ path:line form` provenance line.
- Line moves and file renames at a repin therefore keep a case's id. The file's bytes still change, through provenance
  and the pin in the header, so its oracle cache entry is refreshed.
- An id changes only when:
  - the message text changes, which is a real change; or
  - its first occurrence moves to another crate, which is rare.
- The generator aborts on a 12-hex-digit id collision. There are none.

**Synthetic.** `synthetic/<id>.msgs` holds 87 hand-written messages. The list and their descriptions are in the
generator. They cover the parse error paths (18 `ParserErrorKind`s) and entries after the message. They also cover
references and cycles, string escapes, numbers, functions, every select error, 101 placeables, and CR, CRLF, NUL, tabs and
non-ASCII text.

**File format.**
1. A `//` header line.
2. One or more `@ <provenance>` lines.
3. `= <byte length>`.
4. The message bytes, then `\n`.

## Probe `fluentdump`
Build it with `bun scripts/probes.ts build fluentdump`. It takes about 7 s and adds 46 MB to `target/probes`.

**Dependencies (review finding 1).**
- Every registry package of the resolved graph is pinned with `=` in `Cargo.toml.in`, to upstream's `Cargo.lock` version:
  - the direct dependencies of rustc_error_messages, with the same features;
  - the 41 transitive ones, including the 15 the review listed.
- Transitive pins use `default-features = false`, so a pin never turns on features that the real dependents do not
  request.
- **`build.rs` now also checks the resolved lock.** Every `[[package]]` with a `source` in the probe's `Cargo.lock` must
  appear in upstream's `Cargo.lock` with the same name, version, source and checksum, or the build fails.
  - I verified this by compiling `build.rs` standalone and changing `tinystr` to 0.8.5 in a copy of the lock: it failed
    with `tinystr 0.8.5 (...) is not in upstream's Cargo.lock with that version and checksum`.
- The ICU data is the real `compiler/rustc_baked_icu_data`, as a path dependency.

**Upstream code is copied, not linked.**
- Why: linking `rustc_error_messages`/`rustc_errors` pulls in rustc_macros and rustc_span. Those need `RUSTC_BOOTSTRAP=1`
  and `CFG_RELEASE` at build time, and `scripts/probes.ts` `PROBE_ENV` sets them only for symdump.
- What: `main.rs` has byte-for-byte copies of 7 upstream blocks:
  - `register_functions`, `icu_locale_from_unic_langid` and `fluent_value_from_str_list_sep_by_and`;
  - `DiagArg`, `DiagArgName` and `DiagArgValue`;
  - `From<DiagArgValue> for FluentValue`;
  - `to_fluent_args` and `format_fluent_str`.
- Each block sits between `// BEGIN verbatim <path>:<line>` and `// END verbatim`.
- **Guard (review finding 2).** `build.rs` requires the exact list of 7 specs in `BLOCKS`. It rejects a stray
  `// END verbatim`, nested blocks, and any block that differs from upstream at that line. I verified three failures:
  - deleting a BEGIN marker: the stray END is rejected;
  - duplicating a block: "not exactly the expected";
  - `set_use_isolating(true)`: "differs from upstream".
- Lines outside the blocks, each carrying a `// PORT:` comment:
  - the `DiagArgValue` derive, without Encodable/Decodable/Hash/Eq;
  - `DiagArgMap = IndexMap`;
  - no-op `trace!`/`debug!`.

**`parse` mode (review finding 3).** For each message the probe prints:
```
parse_runtime:
<{:#?} of fluent_syntax::parser::parse_runtime(source)>
parse:
<{:#?} of fluent_syntax::parser::parse(source)>
```
- `source` is `"generated_msg = {msg}\n"`.
- `parse_runtime` is what rustc's `FluentResource::try_new` runs. `parse` adds the full AST, comments included. On this
  corpus the two dumps differ only for the 3 comment-after-message synthetic cases.

**`format` mode.**
- Each argument row calls the copied `format_fluent_str` inside `catch_unwind`.
- The output is `=> Ok(<formatted:?>)` or `=> panic <payload:?>`.
- **Review finding 4.** The silent panic hook is installed only around that one call and restored afterwards. Any other
  panic now prints its message on stderr and exits 101. I checked this with a bad corpus line: the message
  `bad corpus line "{bad"` is printed.

### Argument matrix
The same matrix is described in the probe header and mirrored by the subject.
- `vars`: the names after `$`.
- `keys`: every `[ k ]` in the message.
- Both lists come from a text scan of the message, not from the parser.
- Row 0 has no arguments.
- Rows 1..=N assign var `i` the value `V[(row-1+i) % N]`, where
  `V = [Str(<var>), Number(0), Number(1), Number(2), Number(5), Number(-1), Str("1.5"), StrListSepByAnd(["a","b"]), StrListSepByAnd(["a","b","c"]), Str(<key>)...]`.

## Oracle counts (whole corpus, 4210 cases)

| | messages | parse_runtime Ok/Err | parse Ok/Err | format rows | `=> Ok` | `=> panic` |
|---|---|---|---|---|---|---|
| upstream | 4123 | 4123/0 | 4123/0 | 18736 | 17170 | 1566 |
| synthetic | 87 | 54/33 | 54/33 | 321 | 168 | 153 |

**Review finding 6.**
- 2557 upstream messages have no `$` reference. Their `fluent-format` case is a single row and formats to the message's
  own text. The `fluent-format` suite description now says so.
- The signal is in the other 1566 upstream messages (about 16.2k rows) and in the synthetic set.
- All 1566 upstream panics are row 0, an unbound variable.

## Subject `src/rust_ts/fluentdump.ts`
**`parse`: wired.**
- It prints `debug_Result(parse_runtime(Str.from(source)), PRETTY)` and then `debug_Result(parse(..), PRETTY)`, using the
  vendored `src/vendor/fluent_syntax/parser/mod.ts`.
- **`RUST_TS_AGENT=harness-fluent bun scripts/difftest.ts --suite fluent-parse` (full): 4210 total, MATCH=4210, DIFF=0,
  UNPORTED=0, CRASH=0** (run `hf-parse-wired`).

**`format`: unchanged.**
- It calls the ported `rustc_errors::formatting::format_diag_message` with `DiagMessage::Inline`, which is the real
  `format_fluent_str`.
- Today that reaches `unported("fluent_bundle::FluentArgs (rustc_errors::formatting::to_fluent_args)")`.
- Once fluent-bundle is wired into `src/rustc_errors/formatting.ts` and `src/rustc_error_messages/lib.ts`, it needs no
  driver change.
- `fluent-format --sample 50` gives UNPORTED=50, DIFF=0, CRASH=0.

**For root: `Result::unwrap` panic text (review finding 8).**
- 115 synthetic format rows expect rustc's payload, for example:

  ```
  called `Result::unwrap()` on an `Err` value: (FluentResource(InnerFluentResource { owner: "...", dependent: Resource { .. } }), [ParserError { .. }])
  ```

  `debug_Resource` and `debug_ParserError` already exist.
- `src/std/result.ts` `unwrap_result` throws the text without `: {e:?}`, so the port needs two things:
  - an `unwrap` that takes the error's Debug and appends `: ${debug(e)}`;
  - a self_cell-shaped Debug for `FluentResource`: `FluentResource(InnerFluentResource { owner: <String:?>, dependent: <Resource:?> })`.
- One more row is `called \`Option::unwrap()\` on a \`None\` value` (a message with no value). The existing `unwrap` in
  `src/std/panic.ts` already produces exactly this text.
- The add_resource case expects `called \`Result::unwrap()\` on an \`Err\` value: [Overriding { kind: Message, id: "generated_msg" }]`,
  which needs the Debug of `Vec<FluentError>`.

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `bun test src tools`: 279 pass, 0 fail.
- `coverage.ts --check`: markers ok.
- Case-list hashes (`sha256(JSON.stringify(cases()))[:16]`) are identical in root main (6b14732) and in the lane:

  | suite | cases | hash |
  |---|---|---|
  | lex | 25780 | `a8a356bd10b8a7b6` |
  | parse | 21526 | `b244fb01ad2573be` |
  | escape | 25780 | `a8a356bd10b8a7b6` |
  | symbols | 10 | `7b46e1e12e1f8d93` |
  | escape-synthetic | 11 | `6618a744d214bf09` |
  | fluent-parse / fluent-format (new ids) | 4210 | `696bc26b11376778` |

- `unported(...)` left in this batch: none. The format path reaches the existing `to_fluent_args` unported in
  rustc_errors.

## Review fixes
1. MEDIUM, unpinned transitive crates: every registry package is pinned, and `build.rs` checks the resolved lock against
   upstream's.
2. LOW, guard bypass: `build.rs` requires the exact set of verbatim blocks and rejects a stray END marker.
3. LOW-MEDIUM, `parse` vs `parse_runtime`: the probe dumps both, labeled; the subject does the same; suite description
   updated.
4. LOW, global panic hook: the silent hook is scoped to the `catch_unwind` call.
5. LOW, line-number ids: case ids are content hashes.
6. INFO, identity cases: stated in the suite description and above.
7. INFO, oracle argv missing from the cache key: no change here; it is a `scripts/` batch for root. Modes are still
   fixed per suite name. The probe binary changed in this revision, so the cache key changed and the old cached outputs
   are not reused.
8. INFO, unwrap payload text: see "For root" above.
9. INFO, one unported record hiding its batch: no change, existing harness behaviour.

## Notes for root
- Rebuild the probe (`bun scripts/probes.ts build fluentdump`) before running the suites.
- No baselines exist for these suites yet. `fluent-parse` is ready to accept: it is 4210/4210 MATCH.

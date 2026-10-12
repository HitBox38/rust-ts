# Handoff: fluent-syntax (vendor `fluent-syntax` =0.12.0, wave 4a)

## Files (all new, under `src/vendor/fluent_syntax/`)
| upstream (`fluent-syntax-0.12.0/`) | TS | fns |
|---|---|---|
| `src/lib.rs` | `lib.ts` (namespace re-exports + `crate-skip` markers for bin/benches) | 0/0 |
| `src/ast/mod.rs` | `ast/mod.ts` (types + derived Debug; all upstream doc comments kept) | 0/0 |
| `src/ast/helper.rs` | `ast/helper.ts` (`CommentDef`, `Comment_from_CommentDef`) | 1/1 |
| `src/parser/mod.rs` | `parser/mod.ts` (`parse`, `parse_runtime`, `Result`, `debug_Result`) | 2/2 |
| `src/parser/core.rs` | `parser/core.ts` (class `Parser`) | 13/13 |
| `src/parser/helper.rs` | `parser/helper.ts` | 17/17 |
| `src/parser/comment.rs` | `parser/comment.ts` | 4/4 |
| `src/parser/expression.rs` | `parser/expression.ts` | 3/3 |
| `src/parser/pattern.rs` | `parser/pattern.ts` | 2/2 |
| `src/parser/runtime.rs` | `parser/runtime.ts` | 2/2 |
| `src/parser/slice.rs` | `parser/slice.ts` | 7/7 |
| `src/parser/errors.rs` | `parser/errors.ts` (`ParserError`, `ErrorKind`, Debug + Display, `error!`) | 0/0 |
| `src/parser/macros.rs` | `parser/macros.ts` (`get_byte`/`get_current_byte`/`get_remaining_bytes`) | 0/0 |
| `src/serializer.rs` | `serializer.ts` | 30/30 |
| `src/serializer.rs` `mod test` | `serializer.test.ts` (12 tests, 6 helper accessors) | 18/18 |
| `src/unicode.rs` | `unicode.ts` | 4/4 |
| `src/bin/*.rs`, `benches/*.rs` | `crate-skip` markers in `lib.ts` (dev binaries / benchmarks) | 10/10 skipped |
| doc examples (rustdoc tests) | `doc_examples.test.ts` | n/a |

## Coverage
`scripts/coverage.ts` does **not** count vendor markers (only `compiler/` paths; `--missing` takes an
upstream compiler path). Counted with a scratch script using the same lexer-based fn finder over the
crate source and `// crate(-skip)?: fluent-syntax-0.12.0/<path>:<line> <name>` markers:
**113/113** (103 ported, 10 `crate-skip`: `src/bin/parser.rs` 2, `src/bin/update_fixtures.rs` 3,
`benches/parser.rs` 4, `benches/parser_iai.rs` 1). `bun scripts/coverage.ts --check`: markers ok (1196).
The `crate-skip:` marker form is new (mirrors `rustc-skip:`); no earlier vendor port needed one.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/vendor/fluent_syntax`: 48 pass (12 serializer unit tests, 32 doc-example oracle snapshots,
  3 hand-ported doc examples (parse_runtime errors, serialize, unicode), 1 `{:#?}` oracle snapshot). `bun test src`: 176 pass, 0 fail.
- **Oracle self-check** (scratch, not committed): a Rust program on `fluent-syntax = "=0.12.0"`
  (`cargo +nightly`, release, `CARGO_TARGET_DIR=$RUST_TS_DATA/target/scratch-fluent`) printing per input:
  `{:?}` and `{:#?}` of `parser::parse`, `Display` of each `ParserError`, `serializer::serialize` and
  `serialize_with_options(with_junk: true)`, `{:#?}` of `parse_runtime`, and `{:?}` of
  `unescape_unicode_to_string(input)`, each under `catch_unwind` (prints `PANIC`). The TS runner prints
  the same. **Byte-identical on 40,091 inputs**: 55 hand-written tricky cases (select expressions,
  terms/attributes, junk + every error path, string escapes `\" \\ \{ \uXXXX \UXXXXXX`, invalid escapes,
  multiline/dedent, CRLF, lone CR, `{"{"}`, nested placeables, comments of all levels, empty input),
  20,000 byte-level random inputs (1,165 panicking ones, e.g. the upstream char-boundary panic in
  `skip_unicode_escape_sequence`), 20,000 grammar-directed random inputs (all 21 `ErrorKind`s occur),
  the 32 doc-example inputs, and 4 inputs with combining/invisible/non-printable chars (Debug escaping).

## Exported API (contract for the fluent-bundle lane)
- `parser/mod.ts`: `parse(input: Str): Result`, `parse_runtime(input: Str): Result` where
  `Result = Result<Resource, [Resource, ParserError[]]>` (std `Result`, `$: "Ok" | "Err"`, `_0`);
  `debug_Result` (`{:?}`/`{:#?}` of the whole `parser::Result<&str>`, i.e. `Ok(Resource {..})` /
  `Err((Resource {..}, [ParserError {..}]))`); re-exports `ErrorKind`, `ParserError`,
  `debug_ParserError`, `debug_ErrorKind`, `display_ParserError`, `display_ErrorKind`,
  `matches_fluent_ws`, `Slice`, `Slice_str`, `Slice_String`. Importing `parser/mod.ts` loads every
  `Parser` method (extension files are imported there).
- `parser/errors.ts`: `ParserError { pos: Range; slice: Range | undefined; kind: ErrorKind }`,
  `Range { start, end }`, `debug_Range`, `debug_ParserError`, `display_ParserError` (= `{}`),
  `ErrorKind` union + companion singletons, `debug_ErrorKind`, `display_ErrorKind`, `error(kind, start, end?)`.
- `ast/mod.ts`: `Resource`, `Entry`, `Message`, `Term`, `Pattern`, `PatternElement`, `Attribute`,
  `Identifier`, `Variant`, `VariantKey`, `Comment`, `CallArguments`, `NamedArgument`,
  `InlineExpression`, `Expression`, each with `debug_<Type>`; `debug_S` (Debug of a slice).
  Shapes (PORTING §5): structs are interfaces with the Rust field names; enums are `$`-tagged unions —
  tuple variants use `_0` (`Entry` `Message/Term/Comment/GroupComment/ResourceComment`, `Expression.Inline`),
  struct variants keep field names (`Entry.Junk.content`, `PatternElement.TextElement.value`,
  `PatternElement.Placeable.expression`, `InlineExpression.*`, `Expression.Select{selector,variants}`,
  `VariantKey.Identifier.name` / `.NumberLiteral.value`). `Option` = `| undefined`; `Box` erased.
- `serializer.ts`: `serialize(resource): string`, `serialize_with_options(resource, Options)`,
  `Options { with_junk }`, `Options_default()`.
- `unicode.ts`: `unescape_unicode(w: Write, input: Str): Result<null, FmtError>`,
  `unescape_unicode_to_string(input: Str): string`, `Write` (`write_str`/`write_char` returning
  `Result<null, "Error">`), `StringWriter` (`String as fmt::Write`).
- `lib.ts`: `ast`, `parser`, `serializer`, `unicode` namespaces.

## PORT decisions
- `S` (the AST/parser `Slice<'s>` type parameter) is fixed to `Str` (`&str`, byte-indexed view of the
  source; rust-ts only instantiates `Resource<&str>`). Debug of `S` = `<str as Debug>` via `debug_S`.
  Callers pass `Str.from(text)`. AST types are not generic.
- Trait `Slice` → interface of `slice`/`trim` + impl tables `Slice_str`, `Slice_String` (both over `Str`;
  `String`'s copies bytes). The parser calls `Slice_str`. `trim(&mut self)` returns the new value.
  `PartialEq` on `S` (only `argument_names.contains`) → `slice_eq` (byte equality).
- `macro_rules!` `get_byte!`/`get_current_byte!`/`get_remaining_bytes!` → functions in `macros.ts`,
  bounds-checked like `<[u8]>::get` (out of range incl. `ptr > len` → `undefined`); the remaining bytes
  are a `Uint8Array` subarray. `error!` → `error(kind, start, end?)` in `errors.ts` (the two arms).
- `memchr::memchr3` → plain byte loop (`pattern.ts`). Slice-pattern `match` in `get_text_slice` →
  if-chain in arm order (`}`, `\r\n`, `\n`, `{`, `None`, `unreachable!`).
- `thiserror` → `display_ErrorKind` / `display_ParserError` with the exact `#[error]` strings.
- `UnknownEscapeSequence(b.unwrap_or(&b' ').to_string())` formats the **byte** in decimal (`"120"` for
  `\x`), as upstream; confirmed by the oracle.
- `std::ops::Range<usize>` → local `Range {start,end}` in `errors.ts` (no std Range yet).
- `comment::Level` matched by string literal in `core.ts` (avoids a runtime import cycle with comment.ts);
  `level as usize` → `Level_discriminant`.
- Associated fns `Parser::is_byte_pattern_continuation` / `is_callee` are statics added via
  `declare module` namespace merging in `helper.ts`.
- `impl Pattern { starts_on_new_line, is_multiline, has_leading_text_dot }` (private, serializer.rs) →
  free functions `Pattern_<name>(self)`. Derived `Default` for `Options`/`State`/`TextWriter` →
  `<Type>_default()` (needed at runtime). `Serializer`/`TextWriter` exported for the unit tests.
- `fmt::Write` → local `Write` interface + `StringWriter`; `Cow<str>` → `string` (Borrowed =
  `input.toString()`). `u32::from_str_radix(s, 16)` → local `u32_from_str_radix` (leading `+` allowed,
  lone sign invalid), `str::get(range)` → local `str_get` (undefined off char boundaries).
- `String::pop` in `write_char_into_indent` removes a whole code point (surrogate pair aware).
- serde: `#[cfg_attr(feature = "serde", ...)]` derives and `#[cfg(feature = "serde")]` imports not
  ported (feature off; no fns behind them). Derived Debug of private parser enums ported anyway.

## unported(...)
None.

## For root
- `harness/scope.json` → `vendor`: add `"fluent-syntax": "=0.12.0"`.
- `scripts/coverage.ts` ignores vendor markers (`// crate:` / `// crate-skip:`). If vendor coverage
  should be tracked, it needs a crate-source mode (the scratch counter: map
  `fluent-syntax-0.12.0/<path>` to `bun scripts/crate-src.ts <crate>` + path, same fn finder).
- Candidates for `src/std` (kept local here, each with a `// PORT:` note): `std::ops::Range` + Debug
  (`errors.ts`), `fmt::Write`/`String` writer (`unicode.ts`), `u32::from_str_radix`, `str::get`,
  `u8::is_ascii_uppercase`, `Str` byte equality.
- The claim `docs/claims/wave4-fluent-syntax.md` is root's to delete.

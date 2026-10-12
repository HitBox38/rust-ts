# Handoff: lexer-aux (wave 6 porter)

Vendored `unicode-normalization` =0.1.25 (the version locked in upstream Cargo.lock, used by rustc_parse),
ported `rustc_parse/src/lexer/{unicode_chars,unescape_error_reporting}.rs`, and replaced the lexer lane's
`// PORT: pending lexer-aux` shims in `lexer/mod.ts` with the real modules. Branch `lane/lexer-aux`
(main merged in twice, at 11995a6 and at 683ece9+).

## Files
- `src/vendor/unicode_normalization/`: `lib.ts`, `decompose.ts`, `recompose.ts`, `replace.ts`, `stream_safe.ts`,
  `quick_check.ts`, `normalize.ts`, `lookups.ts`, `perfect_hash.ts`, `__test_api.ts`, `tables.ts` (GENERATED).
  Tests: `test.test.ts` (src/test.rs), `normalize.test.ts`, `quick_check.test.ts`, `stream_safe.test.ts`
  (the inline `#[cfg(test)] mod tests`), `oracle.test.ts`.
- `tools/gen-unicode-normalization.ts` (new): reads the crate's own `src/tables.rs` (via `scripts/crate-src.ts`)
  and emits `tables.ts`: every item in order, slices -> typed arrays / tuple arrays, `match` lookups -> one
  `if` per arm, `// crate:` markers at the upstream `fn` lines. Strict parser (unexpected shape = error).
  `--check` exits 1 if the file is stale (currently: up to date, 25 items).
- `tools/probes/nfc/` (new probe, registry dep `unicode-normalization = "=0.1.25"`): runs over all scalars of
  ccc / is_combining_mark / is_public_assigned / is_{nfc,nfkc,nfd,nfkd}_quick, one-char nfd/nfkd/nfc/nfkc/
  cjk_compat_variants, `char::compose` over 12556 x 1573 composition-relevant pairs, and nfc/nfd/nfkc/nfkd/
  stream_safe/is_* over 30000 deterministic pseudo-random strings (pools: decomposition chars, compat chars,
  combining marks incl. long runs for stream-safe, Hangul syllables + jamo, ASCII, arbitrary scalars).
- `src/rustc_parse/lexer/unicode_chars.ts`, `src/rustc_parse/lexer/unescape_error_reporting.ts`.
- `src/rustc_parse/lexer/unescape_error_reporting.test.ts` + fixture `unescape_oracle.json` (53 tests).
- Edited (as instructed by root): `src/rustc_parse/lexer/mod.ts` (shims removed; imports `unicode_chars`,
  `emit_unescape_error`/`escaped_char`, unicode-normalization for `nfc_normalize`; unused `unported` import
  dropped), `src/rustc_parse/lexer/lexer.test.ts` (PENDING now empty, comment updated).

## Results
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 655 pass, 0 fail (probe built: `bun scripts/probes.ts build nfc`).
- Oracle test detects a one-token mutation in `Recompositions::next` (checked, reverted).
- lexer.test.ts PENDING: all 8 cases now match the oracle (5 lexer-aux, 3 pprust-state after merging 683ece9);
  PENDING is empty. None left failing.
- Scenario tests: 52 cases, each = stderr of `rustc +nightly -Zui-testing -Zparse-crate-root-only --edition 2024 t.rs`
  (rustc 1.101.0-nightly (6f5da406b 2026-10-10)); command in the fixture's `_how`. Cover: unknown escapes
  (str/char/byte-str, `{`/`}` help, `\?`, octal, `\a`/`\e` hex suggestions, escaped CR), too-short/invalid/out-of-range
  hex (incl. the `b'..'`/`'\u{..}'` helps), non-ASCII in byte/byte-str/raw-byte-str (incl. zero-width), `\u` in byte,
  empty/leading-underscore/overlong/unclosed/no-brace(±digits)/surrogate/out-of-range/invalid-char unicode escapes,
  bare CR (str, raw str, char), escape-only char/byte (tab), zero chars, MoreThanOneChar (Quotes, QuotesFull with `"`,
  byte, NFC-normalizable combining, non-NFC combining, non-printing, raw-lifetime path), NUL in C string, unskipped
  whitespace and multiple-skipped-lines warnings, confusables (fullwidth semicolon, Greek question mark, directed
  quotes, repeated minus, em space) and a non-NFC identifier. All match.
- Sample difftests (`RUST_TS_AGENT=lexer-aux`): lex 200/200 MATCH, escape 200/200 MATCH.

## Coverage
- `--missing compiler/rustc_parse/src/lexer/unicode_chars.rs`: 2/2; `unescape_error_reporting.rs`: 3/3; `mod.rs`: 26/26.
- `bun scripts/coverage.ts --check`: 125 errors, all "names no harness/scope.json vendor crate" for
  `unicode-normalization-0.1.25` markers (expected). With the scope entry added (tried locally, reverted):
  `markers ok`, and `--crate unicode-normalization`: 125/125 (22 bench fns are `crate-skip`, same wording as fluent-syntax).

## For root
- Add `"unicode-normalization": "=0.1.25"` to `harness/scope.json` `vendor` (then `--check` is clean).
- Optionally add `bun tools/gen-unicode-normalization.ts --check` to whatever checks generators.
- `char::escape_default`, `str::escape_default`, `u8::from_str_radix` are local helpers in
  unescape_error_reporting.ts (rustc_ast/util/literal.ts has a private copy of `char_escape_default` too); candidates
  for `src/std/char.ts` / `src/std/str.ts`.
- Decision to record: "unicode-normalization tables are generated from the crate's tables.rs
  (tools/gen-unicode-normalization.ts, --check), verified against the `nfc` probe."
- `emit_unescape_error`'s `range` is `{ start, end }` (exported `Range` from unescape_error_reporting.ts), the shape
  lane `lexer` already used; mod.ts call sites unchanged.
- `nfc_normalize` keeps the lexer lane's `string` parameter and iterates `Str.from(string).chars()` (PORT note there).

## unported(...) left
- `Iterator::size_hint of this char iterator` in `Fuse.size_hint` / `Replacements.size_hint` when the inner iterator
  has no `size_hint` (std `Chars` doesn't). Not reached by rustc.

## PORT decisions
- perfect_hash `my_hash`: u32 wrapping via `Math.imul`/`>>> 0`; the u64 product `y * n >> 32` is exact in doubles (n < 2^16).
- `I: Iterator<Item = char>` -> `CharIterator { next(); size_hint?() }`; `+ Clone` -> `CloneCharIterator` (Display impls
  clone and drain, as upstream). `core::iter::Fuse` and `option::IntoIter<char>` are small local classes.
- `trait UnicodeNormalization` impls -> const objects `UnicodeNormalization_str` (self: `Str`), `_char`, `_iter`;
  `pub mod char` -> `char` namespace object. `Display` -> `display_Decompositions/Recompositions/Replacements`.
- `TinyVec`/`ArrayVec` -> arrays (ArrayVec push past capacity asserts); `sort_by_key` -> stable `Array.sort` on the tail;
  `Range<usize>` field -> `{ start, end }`.
- Modules import `canonical_combining_class`/`compose`/`decompose_*` from lookups.ts/normalize.ts instead of
  `super::char` (lib.ts), and quick_check.ts calls `Recompositions::new_canonical(..)` etc. directly (what the blanket
  iterator impl does), keeping lib.ts out of runtime import cycles.
- `is_nfc(s: &str)` etc. take `Str`; `Iterator::eq` is a local `iter_eq`.
- tables.ts: `&[(u32, char)]` / `&[(u32, (u16, u16))]` -> arrays of tuples; `&[char]` -> `Uint32Array`; IsNormalized
  values as the string-literal union.
- unicode_chars.ts: UNICODE_ARRAY ported literally with chars as code points (several are invisible); `Lexer` is
  `import type` from mod.ts; `span_bug` is `return`ed so TS narrows.

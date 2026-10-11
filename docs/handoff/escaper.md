# Handoff: escaper (vendor `rustc-literal-escaper` =0.0.8)

## Files touched
- `src/vendor/rustc_literal_escaper/lib.ts`: port of `src/lib.rs` (all 30 fns, upstream order, `// crate:` markers)
- `src/vendor/rustc_literal_escaper/tests.test.ts`: port of `tests/test.rs` (all 9 tests + their nested `check` fns)
- `tools/probes/escapes/{Cargo.toml.in,main.rs}`: oracle probe (crate =0.0.8 + upstream `rustc_lexer` path dep; same dep pins as lexdump)
- `src/rust_ts/escapedump.ts`: subject side, same output format
- `harness/suites.ts`: **added** suite `escape` (batch, tests/ui + library + compiler). Existing suites untouched.
- `harness/scope.json`: unchanged (`"rustc-literal-escaper": "=0.0.8"` was already right).

## Coverage
lib.rs: 30/30 fns ported (incl. trait-impl methods). `benches/benches.rs` not ported (benchmarks, not tests).

## Tests
- `bun test src`: 26 pass, 0 fail (9 in this crate). `bunx tsc --noEmit -p .`: clean.
- `escape --sample 2000`: 2000/2000 MATCH (run 20261011-195212-escaper-1x75).
- `escape` full: **25780/25780 MATCH** (run 20261011-195231-escaper-89rq). The corpus exercises 17 of the 23
  EscapeError variants (tests/ui/parser + tests/ui/lexer alone); unit tests cover the rest.

## Probe format (per terminated quoted literal; content sliced like `cook_quoted`)
`L <start> <Mode:?> <prefix_noraw:?> <in_double_quotes>` / `U` + unescape_char|unescape_byte result, or
` <lo>..<hi> <res:?>` per callback of unescape_{str,byte_str,c_str} / check_raw_{str,byte_str,c_str} /
`E <lo>..<hi> <err:?> <is_fatal>` per `check_for_errors` callback. Unterminated literals are skipped
(fatal in rustc). Batch suite needs `bun scripts/probes.ts build escapes` on the root machine.

## unported(...)
None.

## PORT decisions
- `Range<usize>` callback args → `(start, end, res)`; `NonZero<char>`/`NonZero<u8>` → number (their Debug forwards to the inner value).
- Private traits `CheckRaw`/`Unescape` → interfaces of required items + impl tables (`CheckRaw_str`, `CheckRaw_u8_slice`,
  `CheckRaw_CStr`, `Unescape_str`, `Unescape_u8_slice`, `Unescape_CStr`); provided methods (`check_raw`, `unescape_single`,
  `unescape_1`, `unescape`) are functions taking the table as `Self`.
- Methods on fieldless enums → `EscapeError_is_fatal`, `Mode_in_double_quotes`, `Mode_prefix_noraw`.
  `From`/`TryFrom` impls → `MixedUnit_from_nonzero_char`, `MixedUnit_from_nonzero_u8`, `MixedUnit_try_from_char`, `MixedUnit_try_from_u8`.
- `unescape_1`'s `.or_else(|c| ...)` with `?` inside the closure: errors from `hex_escape`/`unicode_escape` return directly
  (bypass `hex2unit`/`unicode2unit`), as upstream.
- `skip_ascii_whitespace`: `*chars = rest.chars()` → reposition `chars.pos` in place (same end).
- Tests: Bun mangles non-ASCII inside `String.raw` (emits `\u{..}`), and `r"\"` can't be a template; those cases use ordinary strings.

## Requests for root (src/std is not mine)
`lib.ts` has two private core helpers that belong in `src/std/char.ts`; move them when convenient:
- `to_digit(c, radix)`: port of core `char::to_digit` at the pin (library/core/src/char/methods.rs:409).
- `char_is_whitespace(c)`: core `char::is_whitespace` (Unicode White_Space); the code point list was checked
  against the pinned nightly (all 25 code points).

## Risks
- Per-unit `Ok(..)` allocations as upstream; fine for now, a hot spot candidate when the parser lands.

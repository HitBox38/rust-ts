# Handoff: unicode-width-str (string widths for vendored unicode-width 0.2.2)

## Evidence
- Coverage (`bun scripts/coverage.ts --missing`): `unicode-width-0.2.2/src/lib.rs` 8/8, `src/tables.rs` 29/29,
  `tests/tests.rs` 38/38. `coverage.ts --check`: markers ok (3079; vendor 2323).
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 1041 pass, 1 skip, 0 fail. The skip is the existing
  linux-only `read_binary_file_handles_lying_stat` (it is in ALLOWED_SKIPS).
- `RUST_TS_AGENT=unicode-width-str difftest`:
  - `--suite emit --sample 300`: 300/300 MATCH (run `20261013-003622-unicode-width-str-7wqr`).
  - `--suite tokens --sample 200`: 200/200 MATCH (run `20261013-003623-unicode-width-str-dx79`).
- `bun tools/gen-unicode-width.ts --check`: up to date (27 items from unicode-width-0.2.2).
- Mutation check: I broke one non-CJK arm and one CJK arm of the state machine on purpose. The oracle test failed on both, and I
  reverted the change.

## Files
- `src/vendor/unicode_width/tables.ts`:
  - Ported `width_in_str`, `str_width`, `width_in_str_cjk`, `str_width_cjk`, `is_transparent_zero_width`,
    `is_solidus_transparent`, `starts_emoji_presentation_seq`, `starts_non_ideographic_text_presentation_seq`
    and `is_emoji_modifier_base`.
  - `lookup_width`/`lookup_width_cjk` now read upstream's real tables, so the code-3 markers reach the match.
  - `width_in_str`/`width_in_str_cjk`/`WidthInfo` are exported for the test module.
- `src/vendor/unicode_width/tables.gen.ts`: regenerated. It now holds every data item of upstream's tables.rs.
- `src/vendor/unicode_width/lib.ts`:
  - The trait declarations (lib.rs:202/212/236/245) are now `interface UnicodeWidthChar<Self>` / `UnicodeWidthStr<Self>`, with markers.
  - The `char`/`str` impls are the existing same-named consts, now typed by those interfaces.
- `src/vendor/unicode_width/tests/tests.test.ts`: full port of tests/tests.rs (all 34 tests and the `Foo` impls).
- `src/vendor/unicode_width/tables.test.ts`, new: tables.rs `mod tests` (`str_width_test`, `str_width_test_cjk`, `test_normalization`).
- `src/vendor/unicode_width/oracle.test.ts`: see "Oracle checks" below.
- `tools/gen-unicode-width.ts`: rewritten (see below). `--check` added.
- `tools/probes/uwidth/main.rs`: new modes `patterns` and `strs`. The default no-argument mode is unchanged.
  The probe is rebuilt in the shared `$RUST_TS_DATA`.
- Pending wrappers removed (allowed edits):
  - `src/vendor/getopts/tests/mod.test.ts`: `str_width_test` is gone. All 9 tests are plain `test`s and pass:
    `test_split_within`, `test_usage`, `test_usage_description_wrapping`, `..._multibyte_handling`, `..._newline_handling`,
    `test_usage_multiwidth`, `test_usage_short_only`, `test_usage_long_only`, `test_long_only_usage`.
  - `src/rustc_driver_impl/driver.oracle.test.ts`: `--help`, no args, `-o` and `--explain` moved from PENDING to MATCH.
    All four match rustc byte for byte (stdout, stderr and exit code).

## Table source: the crate's tables.rs, not the probe
- `tools/gen-unicode-width.ts` parses `unicode-width-0.2.2/src/tables.rs`, which it locates with `crateSrc`; `--offline` is supported.
  It follows the `gen-unicode-normalization.ts` precedent.
- It translates every data item after `struct Align128` and before `#[cfg(test)]`:
  - WIDTH_ROOT(_CJK), WIDTH_MIDDLE(_LEN), WIDTH_LEAVES(_LEN);
  - NON_TRANSPARENT_ZERO_WIDTHS, SOLIDUS_TRANSPARENT;
  - EMOJI_PRESENTATION_LEAVES, TEXT_PRESENTATION_LEAF_0..9, EMOJI_MODIFIER_LEAF_0..7;
  - UNICODE_VERSION.
- Parsing is strict: unknown line shapes, attributes or length mismatches are errors.
- `#[cfg(feature = "cjk")]` items and sub-tables are kept. `cfg(not(cjk))` consts are dropped.
- Why the source and not the probe: the code-3 markers and the string-only tables cannot be observed from per-char widths.
  The old generator derived the trie from the probe and lost them. Upstream has 20 middle and 186 leaf tables; the old trie had 21 and 180.
- The probe is now only the validator, through `oracle.test.ts`.

## Oracle checks (oracle.test.ts, width and width_cjk)
- `UnicodeWidthChar` for every scalar (unchanged).
- `UnicodeWidthStr` for every scalar substituted into 46 patterns:
  - alone;
  - followed by FE0E, FE0F, FE00, FE01, FE02;
  - with 0338, 20E3, LF and CR;
  - emoji modifiers, ZWJ before and after, regional indicators, tag sequences;
  - lam-alef, Hebrew alef-ZWJ-lamed, Khmer coeng, Buginese, Tifinagh, Lisu, Old Turkic, Kirat Rai;
  - Hangul L/V/T.
- Explicit sequences:
  - ZWJ sequences, including VS16, keycap and modifier joins;
  - all RI pairs and triples, RI with ZWJ, and RI runs of 1 to 9;
  - modifiers after base ranges;
  - flag tag sequences;
  - all Hangul L×V, plus L×V×T;
  - Arabic lam-alef with 13 kinds of middle sequence.
- 300,000 deterministic random mixed strings (mulberry32 with a fixed seed). They are biased toward the chars the state machine handles.
- Runtime is about 10 s.

## PORT decisions
- `str_width`/`str_width_cjk`:
  - `rfold` becomes a backwards UTF-16 loop that decodes surrogate pairs.
  - `wrapping_add_signed` becomes plain addition. Each `-1` arm needs a state that a later char produced along with a positive width,
    so the running sum never goes below 0.
- `match (next_info, c)` becomes an if-chain in the same arm order. `Ordering` becomes -1/0/1 through `std/slice.ts binary_search_by`.
- The `AlignN` wrappers are dropped, so `TABLE.0[i]` becomes `TABLE[i]`.
- The traits are interfaces over `Self`. The `Sealed` trait is erased, because with `cjk` it is implemented for every `T`.
- Tests:
  - `assert_width!` dispatches on number (char) or string (str).
  - `Foo` is a unique-symbol type.
  - The CJK `test_normalization` message keeps upstream's `{init:?}` (decimal) for the third assertion.

## Decisions for root to record
- Test data is not copied into the repo. `emoji_test_file` reads `tests/emoji-test.txt` (670 KB) and `test_normalization` reads
  `NORMALIZATION_TEST` (20,034 tuples, about 1.4 MB) from the crate in the cargo registry. The crate is there whenever the `uwidth`
  probe has been built.
- Both tests skip visibly when the crate source is missing, and fail under `RUST_TS_REQUIRE_PROBES=1`. So the gate never skips them.
- The gate host must rebuild `uwidth` (`bun scripts/probes.ts build uwidth`), because the oracle test now uses its new modes.

## Remaining `unported(...)`
- None in `src/vendor/unicode_width`.

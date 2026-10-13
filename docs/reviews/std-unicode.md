ACCEPT

# Review: std-unicode (`lane/std-unicode` e12ac8d, b38eeeb; base main 9281966)

Independent reviewer, lane `review-std-unicode`, read-only on code. Pin 6f5da406b56c, oracle
`rustc 1.101.0-nightly (6f5da406b 2026-10-10)`. Scratch was `$RUST_TS_DATA/tmp/review-std-unicode` (deleted).

## 1. Probe change (`tools/probes/lexdump/main.rs`)
- I built the main probe and the lane probe separately in scratch with the pinned toolchain, using the same
  manifest and lockfile as `scripts/probes.ts`.
- **lex output is byte-identical:**
  - Every protected `lex` case (all 25780 files, 571 of them with non-ASCII text) gives the same output from
    both probes: one 767 MB stream, sha1 f657bc1e…
  - 280 synthetic files with the same output from both (sha1 ddd32083…, 1.38 GB):
    - every non-ASCII scalar in ident, raw-ident, string, char, byte, comment, number-suffix and `#` positions;
    - a non-UTF-8 file;
    - a file with a BOM and a shebang.
- **`--unicode`:**
  - The 5 existing keys are value-identical.
  - The old output is an exact text prefix of the new one.
  - The new keys are appended after them.
  - The scratch-built new probe and the shared `$RUST_TS_DATA/target/probes` binary give identical output.
- **New keys:**
  - Each is computed by a real core method (`char::is_*`, `to_lowercase().collect()`, `to_uppercase().collect()`)
    over `0..=0x10FFFF` filtered through `char::from_u32`.
  - `core_unicode_version` is `char::UNICODE_VERSION` = (18, 0, 0).
- **Feature gates:** at the pin, `is_cased` and `is_titlecase` are `#[unstable(feature = "titlecase")]`
  (methods.rs:827/937), and `is_case_ignorable` is `#[unstable(feature = "case_ignorable")]` (methods.rs:1299).
  `#![feature(titlecase, case_ignorable)]` enables exactly these. The gates apply only to the bin crate, so they
  do not touch the `rustc_lexer` dependency. The probe builds without warnings.
- **`--str-case` is test-only:** its only caller is `src/std/unicode/oracle.test.ts`. Neither `harness/` nor
  `scripts/` references it.

## 2. `src/std/char.ts`
Compared line by line with `library/core/src/char/methods.rs` at the pin. These match, including every fast-path
bound:
- `is_alphabetic` (798: a-z|A-Z, ≤A9), `is_cased` (829), `is_lowercase` (904: ≤A9), `is_titlecase` (939: ≤01C4),
  `is_uppercase` (980: ≤BF), `is_numeric` (1024: ≤B1), `is_alphanumeric` (1054), `is_whitespace` (1088: ≤84),
  `is_control` (1121), `is_case_ignorable` (1300: ASCII `' . : ^ \``), `to_lowercase` (1425), `to_uppercase` (1714).
- `CaseMappingIter::new` (char/mod.rs:542).
- `conversions::{lookup, to_lower, to_upper}` (unicode_data.rs:1014/1061/1081): the Latin-1 fast paths match
  exactly. Replacing the LUT with flat quads is a documented `// PORT:` that keeps `lookup`'s contract.

The tables come from the methods, not the private lookups. In each fast-path gap where a method combines tables
(`is_cased`: AA..BF for Uppercase and ≤01C4 for Lt; `is_alphanumeric`: AA..B1 for N), the real property has no
members, so TS equals core. The exhaustive test proves this.

Tests:
- The lane's `oracle.test.ts` iterates every scalar for all 10 predicates and both mappings, and asserts
  `checked = 0x110000 - 0x800`. It passes: 13/13 with `RUST_TS_REQUIRE_PROBES=1`.
- My own exhaustive re-check against the scratch-built probe's JSON also found 0 mismatches.

## 3. Call sites
Each matches its upstream line and uses the right method:

| TS site | upstream | method |
|---|---|---|
| rustc_target `infer_linker_hints` | spec/mod.rs:292 | `is_numeric` |
| rustc_abi `starts_with_alphabetic` | lib.rs:528/573 | `is_alphabetic` (first code point, now not a UTF-16 unit) |
| rustc_session `validate_crate_name` | output.rs:68 and :77 | `is_alphanumeric` |
| rustc_parse `trim_end` | function.rs:612 | `is_whitespace` |
| rustc_parse `recover_after_dot` | expr.rs:2017 | `is_numeric` |
| rustc_parse `eat_keyword_case` | mod.rs:595-596 | `is_uppercase` / `is_lowercase` |
| rustc_parse `recover_missing_dot` | stmt.rs:909 | `is_uppercase` |

No `\p{}`/`\P{}` remains in `src/` outside `src/vendor/anstream/proptest.ts` (test-only).

## 4. `str_case.ts`
- **Logic:** matches alloc str.rs:223 `map_uppercase_sigma`, :457 `to_lowercase` and :672 `to_uppercase`.
  - `skip_while(is_case_ignorable).next()` is ported as `find(!is_case_ignorable)`.
  - The 1/2/3-char mapping push matches upstream.
  - `i + 'Σ'.len_utf8()` becomes `i + 1` UTF-16 units. This is correct because Σ is in the BMP and slices only
    fall on char boundaries.
- **Tests:**
  - The lane test passes on more than 10k strings.
  - I also ran 20000 random strings (several Σ per string, ß, İ, ŉ, ǰ, ΐ, ﬀ, U+0345, combining marks,
    astral cased chars, ZWJ) against `--str-case`: 0 mismatches.

## 5. Nothing else changed
- The lane changes no files in `harness/`, `scripts/` or `docs/state`, and no baseline files.
- The case lists are identical on main and on the lane for all 15 suites (sha1 of ids and args; e.g.
  lex 25780 8286558d1d03, parse 21526 45f2dd4b1196).
- `bun tools/gen-unicode.ts --check`: all 3 files ok. The vendor tables are byte-unchanged.
- `bunx tsc --noEmit -p .`: clean. `coverage.ts --check`: markers ok (5914; vendor 2403).
- `git merge-tree main lane/std-unicode`: no conflicts.

## Spot runs (lane worktree, `RUST_TS_AGENT=review-su`)
- `--suite lex --sample 1000`: 1000/1000 MATCH (run 20261013-101738-review-su-7i9s)
- `--suite parse --sample 300`: 300/300 MATCH (run 20261013-101739-review-su-tw0n)

## Notes for root (non-blocking)
1. After merging, rebuild the shared probe from the integrated tree: `bun scripts/probes.ts build lexdump`.
   The shared binary is currently the lane build. A rebuild from an older tree drops the new keys.
2. The handoff's list of remaining JS case-mapping sites leaves out `src/rustc_errors/lib.ts:1592`
   (`first_alpha_char.toLowerCase()` for `char::to_lowercase().to_string()`, rustc_errors lib.rs:1728). The output
   only differs if a non-ASCII char lowercases to an ASCII vowel under different Unicode data, so the practical
   impact is nil. Queue it with the other `toLowerCase` sites.
3. `map_uppercase_sigma` materialises and reverses the whole prefix on every Σ, which is quadratic in the number of
   Σ. Upstream iterates lazily. The results are correct; only performance is affected.

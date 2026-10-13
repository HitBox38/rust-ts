# Handoff: std-unicode (wave 9, small std lane)

Branch `lane/std-unicode`, based on main 9281966. No merges.

## Result
Every JS `\p{..}` regex in the ported compiler code is gone. The code now calls core `char` methods ported into
`src/std/char.ts`, backed by tables that `tools/gen-unicode.ts` generates from the oracle's core library.
**The oracle's core is Unicode 18.0.0**, while unicode-ident is 17.0.0. Bun's JS engine is older than both.
Over all scalar values, the JS properties disagreed with the oracle's core in these counts:

| property | chars that differ |
|---|---|
| Alphabetic | 12833 |
| N | 323 |
| Lowercase | 145 |
| Uppercase | 20 |
| White_Space | 0 |

## Probe change (oracle infrastructure, needs review)
`tools/probes/lexdump/main.rs`. Only additive changes; the lex (file) mode is untouched.
- Adds the crate attribute `#![feature(titlecase, case_ignorable)]`. It is needed for `char::is_titlecase`, `is_cased` and `is_case_ignorable`, which are unstable. The probe already builds with the pinned nightly.
- `--unicode`: the 5 existing keys are unchanged and keep their order. New keys are appended after them:
  - `core_unicode_version`: `char::UNICODE_VERSION`, giving `"(18, 0, 0)"`.
  - Range lists in the existing `ranges()` format, one per `char` method, evaluated over every scalar value:
    - `alphabetic`, `numeric`, `alphanumeric`
    - `lowercase`, `uppercase`, `titlecase`
    - `cased`, `case_ignorable`
    - `white_space`, `control`
  - `to_lower` and `to_upper`: `[[cp, m0, m1, m2], ...]` for every scalar whose `to_lowercase()`/`to_uppercase()` is not the char itself. Missing chars are padded with 0. Produced by the new fn `mappings()`.
- New mode `--str-case`. It reads stdin with one string per line, as hex UTF-8 bytes. For each line it prints `<hex of str::to_lowercase> <hex of str::to_uppercase>`. Only the oracle test uses it.
- **Verified unchanged:**
  - I built the pre-change probe (main 9281966) into `$RUST_TS_DATA/tmp/std-unicode/oldtarget`.
  - On all 25780 `lex` corpus files, the lex output of the old and new probes is byte-identical (same sha1).
  - The first 5 `--unicode` keys are identical.
- Note: `bun scripts/probes.ts build lexdump` writes the shared `$RUST_TS_DATA/target/probes` binary. Rebuilding it from a tree without this change drops the new keys, and then `gen-unicode`/the oracle test print an ERROR.

## Files
- `tools/gen-unicode.ts`:
  - Generates the new tables.
  - Table names are explicit (`[key, CONST, kind]`).
  - The std file header reports `core_unicode_version`. It used to say (17,0,0), which is unicode-ident's version; DEBUG_ESCAPE_UNICODE comes from core.
  - New **`--check`** mode: rebuilds every table in memory and compares it with the file on disk. A mismatch prints an `ERROR:` line and exits with status 1. `bun tools/gen-unicode.ts --check` reports all three files ok. The vendor tables are byte-unchanged.
- `src/std/unicode/tables.ts` (GENERATED):
  - The existing `DEBUG_ESCAPE_UNICODE`.
  - New range tables: `ALPHABETIC`, `CASE_IGNORABLE`, `LOWERCASE`, `LT`, `N`, `UPPERCASE`, `WHITE_SPACE`. They are named after the core::unicode lookups they stand for.
  - New mapping tables: `TO_LOWER`, `TO_UPPER`.
- `src/std/unicode/mod.ts`: adds `mapping_index` (binary search over the `[c, m0, m1, m2]` quads).
- `src/std/unicode/conversions.ts` (new): core::unicode::conversions `lookup`, `to_lower`, `to_upper` (Latin-1 fast paths ported).
- `src/std/char.ts`:
  - Ports these methods, with their ASCII/Latin-1 fast paths, from library/core/src/char/methods.rs:
    - predicates: `is_alphabetic`, `is_cased`, `is_lowercase`, `is_titlecase`, `is_uppercase`, `is_numeric`, `is_alphanumeric`, `is_whitespace`, `is_control`, `is_case_ignorable`
    - case mappings: `to_lowercase`, `to_uppercase`
  - Also ports `CaseMappingIter::new` from char/mod.rs.
  - Each port has a `// std: <path>:<line> <name>` marker.
  - `is_whitespace` used to be a hand-written list; it is now the upstream body plus `WHITE_SPACE`.
- `src/std/unicode/str_case.ts` (new): alloc `str::to_lowercase` / `str::to_uppercase` on `string`, including the final-sigma rule (`map_uppercase_sigma`).
- `src/std/unicode/oracle.test.ts` (new, 13 tests):
  - Each of the 10 predicates and both char case mappings, checked against the probe for every scalar value.
  - `str_to_lowercase`/`str_to_uppercase` checked against `--str-case` on more than 10k strings. These cover every cased, case-ignorable or mapped char, plus a 1/251 sample of the rest, placed in sigma contexts.
- Call sites, each checked against its upstream line:
  - `src/rustc_target/spec/mod.ts` `infer_linker_hints`: `rhs.chars().all(char::is_numeric)` → `is_numeric`.
  - `src/rustc_abi/lib.ts` `starts_with_alphabetic`: `p.starts_with(char::is_alphabetic)` → `is_alphabetic` of the first code point. It previously used `charCodeAt`, which is a UTF-16 unit.
  - `src/rustc_session/output.ts`: removed the local `char_is_alphanumeric`; `validate_crate_name` now uses `is_alphanumeric`.
  - `src/rustc_parse/parser/function.ts` `trim_end` (`vs.trim_end()`, function.rs:612): now a code-point loop using `is_whitespace`.
  - `src/rustc_parse/parser/expr.ts` `recover_after_dot` (expr.rs:2017): `IS_NUMERIC` → `is_numeric`.
  - `src/rustc_parse/parser/mod.ts` (mod.rs:595-596): removed the local `char_is_uppercase`/`char_is_lowercase`; uses `is_uppercase`/`is_lowercase`.
  - `src/rustc_parse/parser/stmt.ts` `recover_missing_dot` (stmt.rs:909): removed the local helper; uses `is_uppercase`.

## PORT decisions
- **Table derivation:** the tables are computed from the oracle's `char` *methods*, not from the raw `core::unicode` lookups, which are private. Each TS method checks its fast path first, as upstream does, and reads the table only outside it. So TS equals the oracle for every scalar no matter what the table holds inside the fast-path range. The exhaustive test proves this.
- **Mapping tables:** `conversions::lookup` uses flat sorted `[c, m0, m1, m2]` quads in place of upstream's generated 2-level LUT. Its contract is kept: `Some([char; 3])` padded with '\0', or `None`.
- **Iterators:** `char::to_lowercase`/`to_uppercase` return the yielded chars as `number[]` instead of the `ToLowercase`/`ToUppercase` iterator.
- **`str_case.ts` placement:** it should live in `src/std/str.ts` next to the other `str_*` helpers, which this lane does not own. Root can move it.
- **`str_case.ts` behaviour:**
  - The `convert_while_ascii` fast path is folded into the main loop, which gives the same result for ASCII.
  - Offsets are UTF-16 units rather than UTF-8 bytes. `Σ` is 1 unit, and slicing happens only at char boundaries.
- **Naming:** I followed the existing `src/std/char.ts` convention (`is_whitespace`, `is_ascii_digit`, ...), so the new functions are `is_alphabetic`, ... rather than the brief's `char_is_alphabetic`.
- **`parser/function.ts` `trim_end`:** stays a local `string` helper, because `src/std/str.ts` `str_trim_end` takes a `Str`.

## unported(...)
None added.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (5914; vendor 2403).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 2911 pass, 1 skip, 0 fail (157 files). The skip is not in this lane's files.
- `RUST_TS_AGENT=std-unicode`:
  - `--suite lex --sample 500`: 500/500 MATCH (run 20261013-101042-std-unicode-oufk)
  - `--suite parse --sample 300`: 300/300 MATCH (run 20261013-101047-std-unicode-4ea2)
  - `--suite parse-ui --sample 200`: 200/200 MATCH, 8 skipped (run 20261013-101111-std-unicode-o33f)

## Left for others (not owned)
JS Unicode behaviour remains outside this lane's files:
- `\p{..}` in `tools/codegen/diag-expand.ts` (XID_Start/XID_Continue) and `tools/codegen/diagnostics.ts` (White_Space, Uppercase). These are codegen tools that run on upstream sources, so a version skew there changes generated code, not runtime output.
- `\P{C}` in `src/vendor/anstream/proptest.ts`, which is test-only.
- `String.prototype.toLowerCase/toUpperCase` standing in for `str::to_lowercase/to_uppercase` in:
  - `src/rustc_span/symbol.ts:444`
  - `src/rustc_span/edit_distance.ts:228,234`
  - `src/rustc_session/options.ts:1857`
  - `src/rustc_parse/parser/pat.ts:661`
  - `src/rustc_parse/parser/function.ts:354`

  These sites can switch to `str_to_lowercase`/`str_to_uppercase` (`src/std/unicode/str_case.ts`). JS case mapping, including its Final_Sigma check, uses the engine's (older) Unicode data.

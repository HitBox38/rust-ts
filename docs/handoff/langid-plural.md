# Handoff: langid-plural (vendor tinystr subset, unic-langid-impl, unic-langid, intl_pluralrules)

## Evidence
- Versions are the ones in upstream's Cargo.lock: tinystr 0.8.4, unic-langid-impl 0.9.6, unic-langid 0.9.6,
  intl_pluralrules 7.0.2.
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (1196, unchanged; vendor markers are
  `// crate:` and are not tracked by coverage.ts).
- `bun test src/vendor/tinystr src/vendor/unic_langid src/vendor/intl_pluralrules` (also matches unic_langid_impl):
  43 pass, 0 fail, across 9 files. The oracle test runs. It is not skipped.
- **Oracle** (`tools/probes/plurals`, built with `bun scripts/probes.ts build plurals`): the probe prints 2,526 lines,
  and `src/vendor/intl_pluralrules/oracle.test.ts` rebuilds every line from the TS port. All lines are identical:
  - Plural operands (`{:?}` of `Result<PluralOperands, &str>`) for 814 inputs:
    - 14 u64 and 409 i64 values (-200..=200 plus extremes, including `i64::MIN`, which gives "Number too big").
    - 231 f64 values (0..=200, fractions, -0.0, NaN, ±inf, MAX, MIN_POSITIVE, 5e-324, ...).
    - 160 strings (trailing zeros like "1.0"/"1.50", signs, exponents, inf/nan spellings, 20-digit values,
      malformed input, non-ASCII digits, and n.f combinations).
  - The plural category of every input for each of the 212 PRS_CARDINAL locales and 97 PRS_ORDINAL locales. This
    goes through `PluralRules::get_locales`, `create` and `select`.
  - 182 language tags (bytes, including invalid UTF-8 and NUL). For each tag the test compares parse Ok/Err,
    Display, `{:?}`, `canonicalize`, `maximize`/`minimize` (result and bool), `character_direction` (with
    likelysubtags on), and `PluralRules::create` cardinal/ordinal Ok/Err. It also checks `matches` for 16×16 pairs × 4
    flag combos, and the order of `sort()` over the 150 parsed tags.
  - Mutation check: changing one literal in the generated rules.ts makes the test fail. The first-difference line
    names the locale.
- **f64 operands**: `TryFrom<f64>` is `try_from(&x.to_string())`. `<f64 as Display>` lives in src/std, and src/std does
  not export it, so the test feeds the probe's own `to_string` (see "For root" 1). I applied the 2-line `display_f64`
  patch locally (not committed) and checked it: all 231 f64 `to_string`s matched the probe, then I reverted the patch.
  Once `display_f64` exists the test checks it automatically.
- Generator: `bun tools/codegen/vendor-tables.ts --check` prints `ok: 3 vendor tables up to date`.

## Per-file fn counts (own count; coverage.ts does not track vendor crates)
I counted with the same lexer-based fn finder as coverage.ts (`upstreamFns`), run over the crate sources, and matched
the results against `// crate:` / `// crate-skip:` markers. 0 fns are unmarked and no marker points at a missing fn.
| crate | src fns | ported | skipped | tests/*.rs fns |
|---|---|---|---|---|
| tinystr 0.8.4 | 132 | 75 | 57 | — |
| unic-langid-impl 0.9.6 | 81 | 67 | 14 | 24 (21 ported, 3 skipped) |
| unic-langid 0.9.6 | 0 | — | — | 5 (5 ported) |
| intl_pluralrules 7.0.2 | 12 | 12 | 0 | — |

The ported counts include the inline `#[cfg(test)]` fns. Skips are listed below. Generated data files
(likelysubtags/tables.rs, layout_table.rs, rules.rs) have no fns.

## Files (all new)
- `src/vendor/tinystr/{lib,ascii,asciibyte,error,int_ops,macros}.ts`, tests `ascii.test.ts`, `macros.test.ts`.
- `src/vendor/unic_langid_impl/{lib,errors}.ts`, `parser/{mod,errors}.ts`, `subtags/{mod,language,region,script,variant}.ts`,
  `likelysubtags/mod.ts`. Generated: `likelysubtags/tables.ts` (8,241 lines) and `layout_table.ts`. Tests: `lib.test.ts`
  and `tests/{canonicalize_test,language_identifier_test,likelysubtags}.test.ts`.
- `src/vendor/unic_langid/lib.ts`, `tests/langid.test.ts`.
- `src/vendor/intl_pluralrules/{lib,operands}.ts`, generated `rules.ts` (2,773 lines), `lib.test.ts`, `oracle.test.ts`.
- `tools/codegen/vendor-tables.ts`: the generator. It is a small Rust tokenizer and expression parser plus emitters. It
  locates the sources via `scripts/crate-src.ts`, and its `--check` mode reports stale outputs.
- `tools/probes/plurals/{Cargo.toml.in,main.rs}`: the oracle probe. Deps are pinned with `=`, and `likelysubtags` is on.

## For root
1. **src/std/fmt.ts** (needed by the fluent-bundle lane: rustc's fluent args are `FluentNumber { value: f64 }`, and
   plural selection goes through `TryFrom<f64>` → `to_string`). Add:
   ```ts
   /** `<f64 as Display>::fmt` without precision (`float_to_decimal_display` → `float_to_decimal_common_shortest(.., 0)`). */
   export const display_f64 = (v: number): string => to_shortest_str(F64_SPEC, v, 0);
   ```
   I verified it against the probe as described above. A `display_f32` would follow the same pattern with `F32_SPEC`.
2. **harness/scope.json** `vendor`: add `"tinystr": "=0.8.4"`, `"unic-langid-impl": "=0.9.6"`, `"unic-langid": "=0.9.6"`,
   `"intl_pluralrules": "=7.0.2"`.
3. Build the probe on the gate host (`bun scripts/probes.ts build plurals`; it builds in seconds). Without it the oracle
   test logs SKIP.
4. These std helpers are private copies in my files and should move to src/std later. All are marked PORT:
   - `binary_search_by`, a port of core `slice::binary_search_by` at the pin. It is in likelysubtags/mod.ts and
     intl_pluralrules/lib.ts, and rustc_span/lib.ts has its own copy.
   - `u8` `to_ascii_{upper,lower}case` / `is_ascii_{upper,lower}case` in tinystr/asciibyte.ts.
   - `u64/u32` `{from,to}_le_bytes` in tinystr/int_ops.ts.
   - `Peekable` plus `<[u8]>::split` in unic_langid_impl/parser/mod.ts.
   - `<u64 as FromStr>`, `<f64 as FromStr>` (the dec2flt grammar), `isize::checked_abs`, `f64 as u64` and
     `trim_end_matches('0')` in intl_pluralrules/operands.ts.
5. coverage.ts does not track `// crate:` markers. If root wants vendor coverage in the gate, my count method is
   above: `upstreamFns(relative(UPSTREAM, <registry file>))` against the `// crate(-skip)?: <crate>-<ver>/<path>:<line> <name>` markers.
6. The claim file `docs/claims/wave4-langid-plural.md` can be deleted on integration.

## API contract for the fluent-bundle lane
```ts
import { langid, LanguageIdentifier, display_LanguageIdentifier, debug_LanguageIdentifier } from "src/vendor/unic_langid/lib.ts";
import { PluralRules, PluralRuleType, PluralCategory } from "src/vendor/intl_pluralrules/lib.ts";
import { PluralOperands } from "src/vendor/intl_pluralrules/operands.ts";

const en = langid("en-US");                        // `langid!("en-US")`; panics like the macro on bad input
const r = LanguageIdentifier.from_str("en");       // `"en".parse()` → Result<LanguageIdentifier, LanguageIdentifierError>
display_LanguageIdentifier(en) === "en-US";        // Display / to_string; debug_LanguageIdentifier(en, PLAIN) for {:?}
en.eq(other); en.cmp(other); en.clone(); en.matches(other, self_as_range, other_as_range);

PluralRules.get_locales(PluralRuleType.CARDINAL);  // LanguageIdentifier[] (clones), table order
const pr = PluralRules.create(langid("en"), PluralRuleType.CARDINAL);   // Result<PluralRules, "unknown locale">
// `select<N: TryInto<PluralOperands>>(n)`: pass the TryInto conversion explicitly:
pr._0.select(x, (x: number) => PluralOperands.try_from_convert(x, display_f64));      // f64 (FluentNumber.value)
pr._0.select(s, PluralOperands.try_from_str);                                         // &str
pr._0.select(n, PluralOperands.try_from_signed);                                      // i8..i64/isize (number | bigint)
pr._0.select(n, (n) => Ok(PluralOperands.from_unsigned(n)));                           // u8..u64/usize
pr._0.select(ops, (o: PluralOperands) => Ok(o));                                      // `impl From<&FluentNumber> for PluralOperands` result
// → Result<PluralCategory ("ZERO"|"ONE"|"TWO"|"FEW"|"MANY"|"OTHER"), "Argument can not be parsed to operands.">
```
`PluralOperands` is `{ n: number, i: bigint, v: number, w: number, f: bigint, t: bigint }`. Use bigint arithmetic for
`f *= 10^k` in fluent's `From<&FluentNumber>`. The `unic_langid` module re-exports all of unic_langid_impl,
including `subtags`, `likelysubtags`, `parser`, `canonicalize`, `CharacterDirection` and `FEATURES`.

## PORT decisions
- **Cargo features.** rustc builds unic-langid with only `macros`, so `likelysubtags` is off (no crate in Cargo.lock
  enables it). The likelysubtags module, `maximize` and `minimize` are ported anyway. The only feature-dependent
  behaviour of always-present code is the `#[cfg]` block in `character_direction`, and it reads
  `FEATURES.likelysubtags`, which defaults to `false` as in rustc. Tests and the oracle test switch it on and restore
  it afterwards. `serde`, `zerovec`, `databake` and `binary` are off and not ported.
- **TinyAsciiStr<N>** is a class over a `Uint8Array` of length N. Associated fns that need N take it first, e.g.
  `TinyAsciiStr.try_from_utf8(8, bytes)`. The type is `Copy`, so `to_ascii_*` returns a new value.
  - `AsciiByte` (`#[repr(u8)]`, discriminant = byte) is the byte value.
  - The target is little-endian: the oracle hosts aarch64 and x86_64 are, so the `cfg(target_endian = "little")`
    branches are used.
  - `Aligned4` works on a u32 `number` with `>>> 0`. `Aligned8` works on a u64 `bigint`, because all 64 bits are used.
  - The `check_is!` / `to!` macro arms became private helper functions, one per arm.
- **u64 → bigint**:
  - `Language`/`Variant` raw values, because an 8-letter subtag packs above 2^53.
  - The likelysubtags/layout table keys of type u64.
  - The `PluralOperands` fields `i`/`f`/`t`, because string input can carry 20 digits.
- **Derives** on subtags and LanguageIdentifier:
  - `PartialEq`/`Ord` are `eq`/`cmp` methods with Rust's derive semantics: `None` sorts first, slices compare
    lexicographically.
  - `Debug` is a `debug_<Type>` function.
  - `Display` is `display_<Type>`.
  - `PartialEq<&str>` is `eq_str`.
- **Language mutability.** `Language` is `Copy` but mutable through `clear()`, so `Language.clone()` exists and
  `LanguageIdentifier.clone()`/`get_locales` copy it.
- **Field renames.** The private field `LanguageIdentifier.variants` is `variants_`, because a JS class cannot have a
  field and a method (`variants()`) with the same name. Debug still prints `variants`. The method returns the slice
  (`ExactSizeIterator` → readonly array).
- **Trait impls as named fns.** `From`/`TryFrom` impls are named methods:
  - `into_u64` / `ref_into_u64`: `From<Language>` / `From<&Language>` for `Option<u64>`.
  - `into_u32` / `into_str`: Script/Region.
  - `Language.try_from(Uint8Array | string | undefined)`.
  - `LanguageIdentifierError.from`.
- **`select<N: TryInto<PluralOperands>>`** takes the conversion as a second parameter (trait dispatch → function
  parameter).
  - The `impl_*_type!` macro impls are `from_unsigned`, `try_from_signed` and `try_from_convert(input, to_string)`.
  - `PluralRules.create` takes a `LanguageIdentifier`; only the identity `Into` is used.
  - The Rust field `function` keeps its name. The constructor param is `function_`.
- **f64 parsing.** `<f64 as FromStr>`: the dec2flt grammar is ported exactly. The value of an accepted decimal string
  comes from JS `Number()`; both round correctly to the nearest f64. The oracle checks 160 strings.
- **`langid!`** (a proc macro): runtime `langid(s)` parses and panics with the `expect` message
  `Malformed Language Identifier: <Debug>`. Its output equals the parse result, as in the macro, which rebuilds the
  value from raw parts. `langids!`/`langid_slice!` became variadic functions. `lang!`/`script!`/`region!`/`variant!`
  are not ported because rustc's dependencies do not use them.
- **Tables are generated.** The generator emits `range_inclusive_contains(lo, hi, x)` for `(lo..=hi).contains(&x)`.
  Integer literals take the type of the operand (`po.i % 10 == 2` → `po.i % 10n === 2n`). The `langid!` macro in
  rules.rs is checked token-for-token and emitted as a helper function. Table order is kept, and lookups use the
  ported core `binary_search_by`.
- **tinystr tests.** `gen_strings` uses `rand::SmallRng(2022)`; it was replaced by a fixed xorshift with the same
  lengths, byte range and count. The `STRINGS` list is upstream's. The inner `fn check<const N>` of each test became a
  loop over N ∈ {2, 3, 4, 5, 8, 16}.

## Not ported (with reason; each has a `crate-skip` marker unless noted)
- tinystr:
  - Unused by unic-langid-impl: `EMPTY` (a const; a comment), `from_utf8_lossy`, `from_utf16_lossy`, `try_from_raw`,
    `new_unsigned_decimal`, `resize`, `concat`, `Borrow<str>`, `PartialEq<String>` ×2,
    `AsciiByte::from_decimal_digit`, and the whole of `unvalidated.rs`.
  - Features off: serde.rs, ule.rs, databake.rs.
  - Tests: `test_size` (Option niche), and the 4 lossy-constructor tests (they test unported fns).
- unic-langid-impl:
  - serde.rs (feature off).
  - src/bin/generate_{layout,likelysubtags}.rs (data generators; vendor-tables.ts translates their output instead).
  - tests/fixtures.rs (reads tests/fixtures/parsing.json, which the published crate does not ship).
- unic-langid-macros: `lang!`/`script!`/`region!`/`variant!` (no marker; proc-macro crate, outside scope).
- No `unported(...)` calls were left.

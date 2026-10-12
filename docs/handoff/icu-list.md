# Handoff: icu-list (vendor icu_list, icu_locale_core, icu_provider, icu_locale_fallback, zerotrie, regex-automata, writeable, litemap/zerovec subsets; rustc_baked_icu_data)

## Evidence
- Versions are the ones in upstream's Cargo.lock: icu_list 2.3.0, icu_locale_core 2.3.0, icu_provider 2.3.0,
  icu_locale_fallback 2.3.0, icu_locale_fallback_data 2.3.0, zerotrie 0.2.5, writeable 0.6.4, litemap 0.8.1,
  zerovec 0.11.7, regex-automata 0.4.13, tinystr 0.8.4 (additions only).
- `bunx tsc --noEmit -p .`: clean. `bun test src tools`: 302 pass, 0 fail (40 files). The oracle test runs (not skipped).
- `bun scripts/coverage.ts --check`: `markers ok (1397)` (+1: `rustc_baked_icu_data/src/lib.rs:35 baked_data_provider`).
  `bun scripts/coverage.ts --missing compiler/rustc_baked_icu_data/src/lib.rs`: `1/1 ported`.
- Generators: `bun tools/codegen/icu-data.ts --check` → `ok: 2 icu data files up to date`;
  `bun tools/codegen/vendor-tables.ts --check` still ok.
- **Oracle** (`tools/probes/listfmt`, `bun scripts/probes.ts build listfmt`; builds on stable, no RUSTC_BOOTSTRAP: it
  path-depends on the pinned upstream `compiler/rustc_baked_icu_data` and pins icu_list/icu_locale_core/icu_provider/
  icu_locale_fallback/unic-langid/writeable/zerovec/zerotrie/potential_utf/tinystr/regex-automata plus the transitive
  litemap/zerofrom/yoke/displaydoc to upstream's Cargo.lock). The probe prints 45,887 lines; `src/vendor/icu_list/oracle.test.ts`
  rebuilds every line with the TS port, all identical:
  - 118 tags through `unic_langid::LanguageIdentifier` parse + Display (rustc's `lang.to_string()`), giving 122 icu inputs
    (the raw tags plus every unic Display not already present).
  - Per input: `Locale::try_from_str` (Display, or `{:?}` of the ParseError: 28 error inputs incl. empty, `-`, `en-`,
    `en--US`, `en_US`, 5–8 letter languages that unic accepts but icu rejects, duplicate variants, `en-u`, `en-x`,
    `en-Latn-US-x`, non-ASCII), the `DataLocale` the and-list constructor requests (`ListAndV1::INFO.make_locale`),
    and the locale the baked provider fell back to (or the `DataError` `{:?}`).
  - Per input × Wide/Short/Narrow: `format_to_string` on rustc's construct path (parse error → `supported_locales::EN`)
    for 161 lists (0..5 items; empty strings, unicode, `a, b`, the Spanish `y`→`e` triggers such as `Ibiza`/`Hidalgo`/
    `hielo`/`Hierva`/`Í…`, `8 más`, newline, RTL override) → 45,402 F lines; and 84 E lines where the constructor fails
    (`IdentifierNotFound`, e.g. `de`, `und`, `ja-Latn`, `nb`; rustc's `expect` ICEs there).
  - Mutation checks: changing `", and "` in the generated data, one trie byte, the DFA result, or disabling the
    parent-locale lookup each makes the test fail with the first-difference line.
- Other tests: icu_locale_fallback's `test_fallback` (upstream's 28-case table, all three priorities, with and without
  data); icu_locale_core's inline tests (subtag construction/writeable per `impl_tinystr_subtag!` invocation, langid/locale/
  extensions writeable, all extension `fromstr` tests, `test_data_locale_conversion`, data.rs tests) and its integration
  tests `tests/langid.rs` / `tests/locale.rs` with the upstream JSON fixtures (copied verbatim to
  `src/vendor/icu_locale_core/tests/fixtures/`); icu_provider marker/request tests; writeable ops/impls tests;
  icu_list and-list cases from `test_spanish` against the baked data.

## Reachability (en / en-US data never reaches the regex DFA — and the DFA is ported anyway)
Decoded trie (`<locale>\x1E<N|S|W>` → VALUES index; only index 1 has a `special_case`):
`en` N:0 S:5 W:10 (`", and "`) · `es` N/S/W:1 (`" y "` + DFA) · `fr` W:6 · `it` W:2 · `ja` W:3 · `pt` W:2 · `ru` W:7 ·
`tr` W:8 · `zh`/`zh-Hans` W:9 · `zh-Hant` W:9. rustc's fluent bundle locale is `en-US` (fallback → `en`, W:10), so
rustc never reaches the DFA; `es*` (via `-Z translate-lang` with a Spanish bundle) would. The regex-automata sparse-DFA
reader is ported (deserialization + `next_state`/`next_eoi_state`/`start_state`/predicates), so `es` is exact too
(checked by the oracle for every Spanish input — `es`, `es-AR`, `es-419`, `es-MX`, `es-ES`, `es-US`, `es-Latn`, `Es-Ar` — × 161 lists × 3 lengths).

## Per-crate fn counts (own count; coverage.ts does not track vendor crates)
Method: `upstreamFns(relative(UPSTREAM, <registry file>))` over every `.rs` file of the crate, matched against
`// crate(-skip)?: <crate>-<ver>/<path>:<line> <name>` markers (scratch checker, not committed). 0 markers point at a
missing fn.

| crate | fns | ported | skipped | unmarked | notes |
|---|---|---|---|---|---|
| icu_list 2.3.0 | 55 | 19 | 36 | 0 | skips: datagen/serde/databake/tests needing datagen |
| icu_locale_core 2.3.0 | 427 | 316 | 78 | 33 | unmarked = untouched files only: `serde.rs`, `databake.rs`, `preferences/.../macros/enum_keyword.rs`, `keywords/{calendar,currency}.rs` (other preference keywords) |
| icu_locale_fallback 2.3.0 | 20 | 20 | 0 | 0 | |
| icu_provider 2.3.0 | 275 | 63 | 38 | 174 | subset: baked, baked/zerotrie, data_provider (`DataProvider`), error, fallback, marker, request; `response.rs` 6/42 (DataPayload/DataResponse basics); untouched: buf, constructors, dynutil, export, hello_world, serde utils, varule_traits |
| zerotrie 0.2.5 | 307 | 30 | 23 | 254 | subset: reader (lookup/step/probe/take_value), cursor (SimpleAscii), options, helpers, varint readers, `ZeroTrieSimpleAscii` basics; builders/PHF/serde/iterators not ported |
| writeable 0.6.4 | 146 | 45 | 29 | 72 | lib, ops, impls, cmp, parts_write_adapter; untouched: concat, replace, to_string_or_borrow, try_writeable, testing, either |
| litemap 0.8.1 | 226 | 14 | 1 | 211 | `LiteMap` lookups/inserts used by Keywords/Fields |
| zerovec 0.11.7 | 860 | 9 | 0 | 851 | `ZeroMap` read-only lookups over generator-decoded data |
| regex-automata 0.4.13 | 2348 | 105 | 1 | 2242 | sparse-DFA deserialization + walking (sparse, special, start, dense `Flags`, automaton `StartError`, util/{wire,alphabet,start,primitives,search}) |
| tinystr 0.8.4 | 132 | 81 | 51 | 0 | additions: `resize`, `concat`, `unvalidated.rs` subset (was 75/57) |

potential_utf: not needed (the `PotentialUtf8` map keys are decoded by the generator).

## Files
- New vendor ports: `src/vendor/icu_list/**`, `src/vendor/icu_locale_core/**` (+ `tests/` with fixtures),
  `src/vendor/icu_provider/**`, `src/vendor/icu_locale_fallback/**`, `src/vendor/zerotrie/**`,
  `src/vendor/regex_automata/**`, `src/vendor/writeable/**`, `src/vendor/litemap/map.ts`, `src/vendor/zerovec/map/map.ts`.
- Generated: `src/rustc_baked_icu_data/data/list_and_v1.ts`, `src/vendor/icu_locale_fallback_data/data.ts`
  (by `tools/codegen/icu-data.ts`, new).
- `src/rustc_baked_icu_data/lib.ts` (`BakedDataProvider`, `baked_data_provider`, `supported_locales`) and
  `src/rustc_baked_icu_data/data/mod.ts` (the databake macros: `make_provider!`, `impl_data_provider!`, and the
  `DataProvider<ListAndV1>::load` with locale fallback; `.rs.data` code has no `// rustc:` markers, cited as `from:`).
- tinystr additions (additions only): `ascii.ts` `resize`/`concat` (replacing their crate-skips), new `unvalidated.ts`,
  `lib.ts` exports/skips updated.
- Probe: `tools/probes/listfmt/{Cargo.toml.in,main.rs}`.

## API contract (for root, to wire into `src/rustc_error_messages/lib.ts`)
```ts
import { Locale } from "src/vendor/icu_locale_core/locale.ts";
import { ListFormatter, ListFormatterPreferences } from "src/vendor/icu_list/list_formatter.ts";
import { ListFormatterOptions } from "src/vendor/icu_list/options.ts";
import { BakedDataProvider, supported_locales } from "src/rustc_baked_icu_data/lib.ts";
import { debug_DataError } from "src/vendor/icu_provider/error.ts";

// fn icu_locale_from_unic_langid(lang) -> Option<Locale>
const r = Locale.try_from_str(display_LanguageIdentifier(lang));       // Result<Locale, ParseError>
const locale = r.$ === "Ok" ? r._0 : supported_locales.EN;              // .ok().unwrap_or_else(|| EN)
const lf = ListFormatter.try_new_and_unstable(
  new BakedDataProvider(),                                              // &rustc_baked_icu_data::BakedDataProvider
  ListFormatterPreferences.from_locale(locale),                         // locale.into()
  ListFormatterOptions.default().with_length("Wide"),
);                                                                       // Result<ListFormatter, DataError>
// .expect("Failed to create list formatter") → panic(`Failed to create list formatter: ${debug_DataError(lf._0)}`)
lf._0.format_to_string(items);                                           // items: Iterable<string | Writeable> → string
```
Also exported: `ListFormatter.try_new_or_unstable` / `try_new_unit_unstable` (no data for them in the baked provider:
calling `load` with another marker panics, as it would not compile in Rust), `baked_data_provider()`,
`supported_locales.{EN,ES,FR,IT,JA,PT,RU,TR,ZH_HANS,ZH_HANT}`, `Locale.to_string()`, `LanguageIdentifier`,
`DataLocale`, `display_ParseError`/`debug_ParseError`.

## PORT decisions (all marked `// PORT:` in the code; 71 notes)
- **Data representation.** The databake data is decoded at generation time (`tools/codegen/icu-data.ts`):
  `VarZeroCow<str>` → string; `ZeroTrieSimpleAscii { store }` → the bytes, read at runtime by the ported zerotrie
  reader; `SerdeDFA` bytes → the little-endian serialization (hex), read by the ported sparse DFA; `ZeroMap` → keys as
  ULE bytes (sorted, byte-lexicographic = their `Ord`) and decoded values (subtags via `from_raw_unchecked`,
  `Option<T>` ULE = tag + payload, `VarZeroVec16` split by its u16 index table). Every non-data token of each `.rs.data`
  macro is compared to a recorded token text, so an upstream logic change is an ERROR in `--check`.
- **Little-endian target** (DFA bytes, `from_ne_bytes`): the oracle hosts are little-endian.
- **Logging**: icu_provider's `log` is a no-op without the `logging` feature/debug assertions (rustc's build).
- **`DataMarkerId` Debug** has no `debug` field (it exists only with `export`/debug assertions) → `DataMarkerId { hash: [..] }`.
- **Traits**: `Writeable` is an interface; provided methods are `Writeable_*` functions. `str`/`String` → `StrWriteable`
  (`writeable_str`). `core::fmt::Write`/`fmt::Result` are defined in `writeable/lib.ts` (`FmtWrite`, `fmt_Result`,
  `StringSink`) — candidates for src/std. `DataProvider<M>` is one interface whose `load(marker, req)` dispatches on the
  marker value. Operator traits on `LengthHint` → `add`/`mul`/`bitor`/... functions.
- **Macros**: `impl_tinystr_subtag!` → classes extending `TinystrSubtag` with a `SPEC` (macro args) and shared
  associated fns in helpers.ts (one marker each); `impl_writeable_for_each_subtag_str_no_test!` → `EachSubtagWriteable`;
  `define_preferences!` for a key-less struct → `EmptyPreferences` (icu_list's `ListFormatterPreferences`);
  `struct_keyword!` → shared fns in `struct_keyword.ts`; `data_marker!` → `data_marker(name, fields)`;
  `langid!`/`locale!`/`data_locale!`/`language!`… → runtime functions (panic messages kept). `icu_list`'s `constructor!`
  → `constructor_unstable` + three `try_new_*_unstable` (no markers: `fn $name_unstable` is a macro variable).
- **`ShortBoxSlice<T>` → `T[]`** (all shortvec fns crate-skipped); `LiteMap` → sorted `[K, V][]` with a `cmp` fn.
- **Lazy statics**: `Language::UNKNOWN`, `SubdivisionSuffix::UNKNOWN`, `supported_locales`, the baked singletons and
  `TRUE_VALUE` are lazily created getters (module/class initialization order).
- **`usize` arithmetic** in `LengthHint` saturates/checks at 2^64 as a double (unreachable for list formatting); the
  two upstream test assertions at `usize::MAX - 10` are noted, not run.
- `Extensions.private` is a quoted field (`"private"`; constructor param `private_`). `ConditionalListJoinerPattern.default`
  keeps its name (param `default_`).
- `ListJoinerPattern` slices with UTF-8 byte offsets (`index_1 = 3` for `、`), panicking off char boundaries like Rust.

## Not ported (each has a `crate-skip` marker unless noted)
- Feature-off code: serde, databake, datagen (`ListFormatterPatterns::try_new`, `ListJoinerPattern::try_from_str`,
  `SerdeDFA::new`, DFA building), `compiled_data` (icu_list's own `Baked`, `try_new_and` etc.), buffer providers.
- Unused on rustc's path: `normalize*` (need `writeable::to_string_or_borrow`), `Locale/Extensions/Unicode/Transform::total_cmp`
  + `as_tuple`, `Keywords/Fields::retain_by_key`, `try_from_raw` (needs tinystr's `try_from_raw`), `DataIdentifierCow`,
  iterable providers, `DataRef`/`DataForVarULEs`, `with_type_context`/`for_type`/`with_path_context`, the
  `ZeroAsciiIgnoreCaseTrie` cursor, trie iterators/builders, `LossyWrap`/`WithPart`/integer `Writeable`s,
  other preference keywords (calendar, currency, …, `enum_keyword!`).
- Tests: tests needing datagen/compiled data (icu_list `test_*`, patterns/lazy_automaton/serde_dfa tests),
  `test_sizes`, `test_id_debug`, `test_logging`, `test_locale_total_cmp`, writeable cmp tests (they read
  `tests/data/data.rs`), shortvec tests.
- `unported(...)` left: one — `zerotrie::byte_phf::PerfectByteHashMap::get` in `get_parameterized`, reachable only for
  PHF tries (`ZeroTriePerfectHash`/`ExtendedCapacity`); `ZeroTrieSimpleAscii` (the only trie on rustc's path) is
  `BinaryOnly`, so that branch is dead there.

## For root
1. **harness/scope.json** `vendor`: add `"icu_list": "=2.3.0"`, `"icu_locale_core": "=2.3.0"`, `"icu_provider": "=2.3.0"`,
   `"icu_locale_fallback": "=2.3.0"`, `"icu_locale_fallback_data": "=2.3.0"`, `"zerotrie": "=0.2.5"`,
   `"writeable": "=0.6.4"`, `"litemap": "=0.8.1"`, `"zerovec": "=0.11.7"`, `"regex-automata": "=0.4.13"`; and move
   `rustc_baked_icu_data` out of `excluded` (its only `.rs` fn, `baked_data_provider`, is marked; the data files are
   `.rs.data`, which coverage.ts does not count).
2. Build the probe on the gate host: `bun scripts/probes.ts build listfmt` (≈1 min; otherwise the oracle test logs SKIP).
3. Wire `StrListSepByAnd` in `src/rustc_error_messages/lib.ts` per the API contract above.
4. src/std candidates (private copies now, all `// PORT:`): `core::fmt::Write`/`fmt::Result` (writeable/lib.ts),
   `<[T]>::binary_search_by` (litemap/map.ts; a third copy besides intl_pluralrules and likelysubtags), `<[u8]>::cmp`
   (`cmp_bytes`, writeable/cmp.ts), `str::eq_ignore_ascii_case` (icu_locale_core/helpers.ts).
5. Record the decisions: DFA ported (not left unported); extension parsing ported fully (Locale parser is complete);
   `ShortBoxSlice` → `T[]`; data decoded at generation time.
6. The claim file `docs/claims/` entry for icu-list can be deleted on integration.

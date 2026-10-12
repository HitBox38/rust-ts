# Handoff: fluent-bundle (wave 4b; vendor fluent-bundle, intl-memoizer, type-map, fluent-langneg; rustc fluent wiring)

## Evidence
- Versions from upstream's Cargo.lock: fluent-bundle 0.16.0, intl-memoizer 0.5.3, type-map 0.5.1,
  fluent-langneg 0.13.1 (used: `types/plural.rs` calls `negotiate_languages`), plus the already vendored
  fluent-syntax 0.12.0, intl_pluralrules 7.0.2, unic-langid 0.9.6.
- `bunx tsc --noEmit -p .` clean. `bun test src tools`: 269 pass, 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (1396). `--missing compiler/rustc_errors/src/formatting.rs`: 8/8;
  `--missing compiler/rustc_error_messages/src/lib.rs`: 35/35.
- `RUST_TS_AGENT=fluent-bundle bun scripts/difftest.ts --suite lex --sample 100`: MATCH=100.
- **fluent-format corpus (end to end, real `format_fluent_str`)**: the merged harness-fluent corpus (main's
  `harness/corpus/fluent`, 4210 files) through the prebuilt `fluentdump` probe vs. a scratch copy of main's
  `src/rust_ts/fluentdump.ts` importing this lane, changed only to catch `Unported` per argument row:
  - per row: 13,730 `=> Ok` identical, 1,717 `=> panic` identical (unwrap/`Fluent errors while formatting
    message: [..]` payloads byte-identical), 3,610 UNPORTED (`icu_locale_core::Locale::try_from_str`: rows
    where a `StrListSepByAnd` value is stringified), **0 mismatches**.
  - per file (what the suite will report, a file aborts at its first unported row): MATCH 2,739,
    UNPORTED 1,471, DIFF 0.
- **Crate-level oracle** (scratch, not committed): a Rust program on the pinned crates (all deps `=`-pinned
  to upstream's Cargo.lock, release, `CARGO_TARGET_DIR=$RUST_TS_DATA/target/scratch-fluent-bundle`) and a TS
  runner printing the same thing, over 25,812 generated cases: byte-identical.
  - 12,000 random resources (messages, attributes, terms with args, select expressions, NUMBER with
    options, STREQ, unknown functions, string escapes, duplicates, junk) × 26 locale lists × random args
    (strings, i64/u64 incl. extremes, f64 incl. NaN/inf/-0/1e21/5e-324, `try_number` strings, None, Error),
    isolating on/off, builtins on/off, concurrent memoizer; 76 hand cases (cycles incl. structurally equal
    patterns, 101 placeables, missing values).
  - 10,188 plural cases: 40 locales × 36 numbers × cardinal/ordinal × minimumFractionDigits.
  - FluentNumber `as_string` + `PluralOperands::from(&FluentNumber)` (21 values × 14 mfd incl. u32-wrapping
    ones), `try_number` (41 strings), `negotiate_languages` (3,000), `parse_accepted_languages` (Unicode
    whitespace), `{:?}` of `FluentResource::try_new` and `FluentArgs`.
  - A 736-case sample with the oracle output is committed as `src/vendor/fluent_bundle/testdata/snapshot.*`
    and checked by `oracle.test.ts`.

## Vendor fn counts (coverage.ts does not track vendor crates; counted with `upstreamFns` over the crate sources vs. `// crate(-skip)?:` markers, as in the langid-plural handoff)
| crate | fns | ported | skipped | missing | stale |
|---|---|---|---|---|---|
| fluent-bundle 0.16.0 | 123 | 112 | 11 (benches) | 0 | 0 |
| intl-memoizer 0.5.3 | 10 | 10 | 0 | 0 | 0 |
| type-map 0.5.1 | 39 | 39 | 0 | 0 | 0 |
| fluent-langneg 0.13.1 | 9 | 7 | 2 (benches) | 0 | 0 |

Ported counts include the inline `#[cfg(test)]` fns. The published fluent-bundle package ships no `tests/`
directory (no fixtures), so there are no `tests/*.rs` to port; doc examples are ported as tests instead
(`fluent_bundle/doc_examples.test.ts`, `fluent_langneg/doc_examples.test.ts`, intl-memoizer's in `lib.test.ts`).

## Files
- New: `src/vendor/type_map/{lib,concurrent}.ts`, `lib.test.ts`.
- New: `src/vendor/intl_memoizer/{lib,concurrent}.ts`, `lib.test.ts`.
- New: `src/vendor/fluent_langneg/{lib,accepted_languages}.ts`, `negotiate/{mod,likely_subtags}.ts`, `doc_examples.test.ts`.
- New: `src/vendor/fluent_bundle/{lib,args,builtins,bundle,concurrent,entry,errors,memoizer,message,resource}.ts`,
  `resolver/{mod,errors,expression,inline_expression,pattern,scope}.ts`, `types/{mod,number,plural}.ts`;
  tests `args.test.ts`, `types/number.test.ts`, `doc_examples.test.ts`, `oracle.test.ts` + `testdata/`.
- Changed: `src/rustc_errors/formatting.ts` (`to_fluent_args`, `format_fluent_str`, `pub use FluentArgs`),
  `src/rustc_error_messages/lib.ts` (re-exports `fluent_bundle`, `FluentArgs`, `FluentError`, `FluentValue`,
  `FluentType`, `LanguageIdentifier`, `langid`; `register_functions`; `fluent_value_from_str_list_sep_by_and`
  with `FluentStrListSepByAnd` / `MemoizableListFormatter`; `From<DiagArgValue> for FluentValue`).

## unported(...) left
- `icu_locale_core::Locale::try_from_str` (`icu_locale_from_unic_langid`).
- `rustc_baked_icu_data::supported_locales::EN` (the `unwrap_or_else` fallback in `MemoizableListFormatter::construct`).
- `icu_list::ListFormatter::try_new_and_unstable` (same fn). `ListFormatter` is a local stand-in interface
  (`format_to_string(values)`); `as_string`/`as_string_threadsafe` call `list_formatter.deref().format_to_string(self.0)`.
  Root: replace the stand-in `ListFormatter`/`IcuLocale` types and the three unported calls with icu-list's API.
- `fluent_bundle: usize option value >= 2^53` (`FluentNumber.into_usize`; only from an f64 >= 2^53 option).
- `alloc: String::repeat beyond 2^30 bytes` (`as_string` padding; Rust would abort on allocation).

## API contract
```ts
import { FluentBundle, FluentResource, FluentArgs, FluentValue, debug_FluentError } from "src/vendor/fluent_bundle/lib.ts";
// Always import through lib.ts (it loads entry.ts/concurrent.ts, which extend FluentBundle).
const r = FluentResource.try_new(src);                  // Result<FluentResource, [FluentResource, ParserError[]]>
const b = FluentBundle.new([langid("en-US")]);          // FluentBundle<IntlLangMemoizer>; FluentBundle.new_concurrent(..)
b.set_use_isolating(false); b.add_resource(res);        // Result<null, FluentError[]>
b.add_function("F", (positional, named) => FluentValue.Error); b.add_builtins();
const m = b.get_message("id"); m?.value(); m?.get_attribute("a")?.value();
const args = FluentArgs.new(); args.set("n", FluentValue_from_num(5)); args.set("s", FluentValue.from_str("x"));
const errs: FluentError[] = []; b.format_pattern(pattern, args, errs);   // string
```
- `FluentValue` is `$`-tagged (`String`/`Number`/`Custom`/`None`/`Error`); methods on the companion
  (`FluentValue.try_number`, `.matches`, `.write`, `.as_string`, `.into_string`, `.clone`, `.from_*`).
  Numeric `From` impls: `FluentValue_from_num(n: number | bigint)` (types/number.ts).
- Custom values implement `FluentType` (`fmt(f)` for Debug, `duplicate`, `as_string(IntlLangMemoizer)`,
  `as_string_threadsafe(concurrent IntlLangMemoizer)`, `equals`/`as_any` via `AnyEq_blanket`).
- `Memoizable<I, Args, E>` (intl_memoizer): `{ construct(lang, args), args_key(args), memoizer_cache: TypeId }`,
  passed as a value: `intls.with_try_get(Impl, args, cb)`.

## PORT decisions
- type-map: `TypeId<T>` is a unique token object per Rust type (`TypeId.new<T>(name)`), passed where Rust
  writes `::<T>`; `Map<TypeId, unknown>` keyed by identity; `&mut T` returns the value (objects are mutated
  in place). Debug derives not ported (TypeId Debug is a compiler hash). `pub mod concurrent` → `concurrent.ts`.
- intl-memoizer: `Memoizable` implemented by an impl table (static side); `HashMap<I::Args, I>` → `Map`
  keyed by `args_key`; `RefCell` borrow flag kept (`Cannot use memoizer reentrantly: BorrowMutError` panic);
  `IntlMemoizer`'s `HashMap<LanguageIdentifier, Weak<..>>` → keyed by Display (injective over the derived
  `Eq`), `Weak` → `WeakRef` (only affects how often a formatter is rebuilt). Concurrent `Mutex` = the map.
- fluent-langneg: `req.maximize()` resolves to `MockLikelySubtags::maximize` (unic-langid's inherent
  `maximize` exists only with `likelysubtags`, off in rustc; the TS class always has it, so the trait fn is
  called explicitly). `macro_rules! test_strategy` → closure returning `"continue"`/`"break"` for the outer
  loop. `retain` → in-order filter. `str::trim` → local `str_trim` on Unicode `White_Space` (JS `trim` differs
  on U+FEFF/U+0085). Generic `R`/`A: AsRef<LanguageIdentifier>` → `LanguageIdentifier`; results are the
  very `available`/`default` objects.
- fluent-bundle:
  - `self_cell` `InnerFluentResource` → class holding owner (`Str`, the AST slices point into it) and
    dependent; its `impl {Debug}` ported (`InnerFluentResource { owner: .., dependent: .. }`).
  - `FluentBundle<R, M>`: `R` erased (resources stored as `FluentResource`); `M extends MemoizerKind` on the
    class. `GetEntry` impl (entry.ts) and `new_concurrent` (concurrent.ts) are extension files. The
    `MemoizerKind` impls for both `IntlLangMemoizer`s are prototype augmentations; `MemoizerKind::new` is
    `MemoizerKind_for_IntlLangMemoizer.new` (it collides with the inherent `new`).
  - `ResolveValue`/`WriteValue` impls for the fluent_syntax AST → impl tables
    (`WriteValue_for_Pattern.write(p, w, scope)`); `fmt::Write` = fluent_syntax's `Write`/`StringWriter`.
  - `Scope.traveled.contains(&pattern)` compares patterns **by value** (`PartialEq` for `&T` derefs to the
    derived `PartialEq`), so `scope.ts` carries a derived-`PartialEq` port of the AST (`Pattern_eq` & co.);
    a structurally equal pattern on the stack is reported as `Cyclic`, as upstream (oracle-checked).
  - `Cow<str>` → `string`; `K: Into<Cow<str>>`/`V: Into<FluentValue>` → callers convert. `FluentArgs`
    keeps the sorted `Vec` and uses a ported `binary_search_by` and `str_cmp` (UTF-8/code point order).
  - `FluentNumberOptions.r#type` → `type`. `usize` options are `number`s (see unported above).
    `from_num!` impls → `from_num`/`from_num_ref`/`into_num`/`ref_into_num` (+ `FluentValue_from_num(_ref)`),
    saturating `f64 as $num` via bigint. `From<&FluentNumber> for PluralOperands`: `10_u64.pow(..)`,
    `*=` and `mfd as u32 - v as u32` wrap (dist rustc has overflow checks off; oracle-checked with mfd 2^32±k).
  - `<f64 as FromStr>` (with `ParseFloatError` kinds) is a private copy in types/number.ts (intl_pluralrules
    keeps its copy private).
  - Doc comments: prose kept; code examples moved to the doc-example tests.
- rustc wiring: `to_fluent_args` takes the materialized `DiagArg[]` (`size_hint().1` = its length).
  `format_fluent_str` builds the panic payloads with Debug exactly (`called \`Result::unwrap()\` on an \`Err\`
  value: (FluentResource(..), [..])`, `[Overriding { .. }]`, `Option::unwrap()`). `FluentStrListSepByAnd` /
  `MemoizableListFormatter` (fn-local items upstream) are module-level classes after the fn (one class per
  Rust type, so `AnyEq`'s downcast holds across calls).

## For root
1. `harness/scope.json` → `vendor`: add `"fluent-bundle": "=0.16.0"`, `"intl-memoizer": "=0.5.3"`,
   `"type-map": "=0.5.1"`, `"fluent-langneg": "=0.13.1"`.
2. Merge: main moved since 45fff30 (harness-fluent, annotate-b, anstyle); no overlap with this lane's files.
   After merging, `fluent-format` should report MATCH 2,739 / UNPORTED 1,471 / DIFF 0 (the probe binary is
   already built); it can be accepted as a baseline then, and grows when icu-list is wired.
3. icu-list wiring (rustc_error_messages/lib.ts): replace `IcuLocale`, `ListFormatter` stand-ins and the
   three `unported(...)` calls listed above.
4. `src/rustc_errors/tests.test.ts` "flushing delayed bugs needs Fluent (unported)" still passes, but it now
   gets past Fluent and stops at `unported: std::panic::Location::caller (DiagLocation Display)`; its title and
   comment are stale (not my file).
5. src/std candidates (private copies here, each marked `PORT:`): `<f64 as FromStr>` + `ParseFloatError`
   (fluent_bundle/types/number.ts; second copy after intl_pluralrules), `binary_search_by` (fluent_bundle/args.ts;
   fourth copy), `<str as Ord>::cmp` (`str_cmp`, args.ts), `str::trim` (fluent_langneg/accepted_languages.ts),
   `str::repeat`, saturating `f64 as int`, wrapping `u64::pow`. Also the derived `PartialEq` of the
   fluent_syntax AST (`Pattern_eq` & co. in fluent_bundle/resolver/scope.ts) belongs with fluent_syntax/ast.
6. The scratch oracle (Rust program, generator, TS runner) is in `$RUST_TS_DATA/tmp/fluent-bundle/`
   (`probe/`, `gen.ts`, `fbrun.ts`, `cmp.py`); a `tools/probes` version could replace the committed snapshot.
7. Claim `docs/claims/` entry for this lane is root's to delete.

# Handoff: clippy-contract-b1 (M8 wave 41, step 4; the first of the chained lanes of `clippy-contract-b`)

**Review** (`docs/reviews/clippy-contract-b1.md` on `t3/review-clippy-contract-b1`): PASS WITH NOTES. Fixed on this branch
in a second commit:
- **N1:** the toml surface's parsers take `Str`, and conf.ts passes the `SourceFile`'s `Str` unchanged;
  `DeTable.parse` was added and table iteration noted (PORT 2);
- **N2:** the four fns are back in upstream order, or carry a `PORT:` note;
- **N5:** a test now pins the `<= 8` one-line threshold;
- **N7:** `capture.ts` removes its scratch directory;
- **N4:** the two overstated claims are corrected below.

N3, N4a's required switch and N6 are for root's briefs; see "For root".

Plan: `docs/plan-m8.md` §2c, D4, D5, D6, D13, D14. Root's decisions "codegen-clippy-macros (D5)" and "codegen-fmt-serde
PORT #2". Base: main at `6dad6108`.

`clippy_config` is ported line by line from `src/tools/clippy/clippy_config/src/**`, except the macro parts
(`define_Conf!`). `src/clippy_config/lib.ts` now exists with its real exports (`Conf`, `sanitize_explanation`,
`ConfMetadata`, `types`), so `src/clippy_lints/lib.gen.ts` waits on one module fewer: `bun tools/codegen/clippy.ts --check`
now reports 359 hand modules missing, down from 360.

## Files touched

All files are new and under `src/clippy_config/`. No other file was edited.

| File | What |
|---|---|
| `lib.ts` | lib.rs: re-exports, then `import "./conf.gen.ts"` after conf.ts (see "For codegen-clippy-conf") |
| `de.ts` | de.rs: `DiagCtxt`, `find_closest_match`, `create_value_list_msg`, the three traits and all their impls, `deserialize_array`, `deserialize_table!`. It also holds the toml surface; see "unported" |
| `types.ts` | types.rs: `conf_enum!` and its 7 enums, `Rename`, `DisallowedPath`, `create_disallowed_map`, `BraceKind`/`MacroMatcher`, the source-ordering types |
| `metadata.ts` | metadata.rs: `ConfMetadata`, its `Display` and the two markdown displays |
| `conf.ts` | conf.rs's hand part: the `DEFAULT_*` statics (exported for the generated code), `Conf` (interface plus companion), `sanitize_explanation`, `load_conf_file`, `Conf::{load, load_inner}` |
| `de.test.ts`, `conf.test.ts` | unit tests, 15 tests (185 expects) in about 0.7 s (D13: ≤ 10 s) |
| `oracle/capture.ts`, `oracle/de.oracle.json` | the oracle fixture and the script that writes it (run by hand, about 3 s; it removes its scratch directory under `$RUST_TS_DATA/tmp`, also on an error) |

## Coverage (`bun scripts/coverage.ts --missing <file>`)

| File | Ported | Left |
|---|---|---|
| `clippy_config/src/lib.rs` | 0/0 | none |
| `clippy_config/src/de.rs` | 43/43 | none |
| `clippy_config/src/types.rs` | 47/47 | none |
| `clippy_config/src/metadata.rs` | 5/5 | none |
| `clippy_config/src/conf.rs` | 10/13 | `:122 default`, `:130 get_metadata`, `:146 deserialize`. These are define_Conf!, for codegen-clippy-conf |

`bun scripts/coverage.ts --check`: markers ok. `bunx tsc --noEmit -p .`: clean. `bun tools/codegen/clippy.ts --check`: up to
date. `tools/codegen/clippy.test.ts`: passes.

`conf.rs:988 configs_are_tested` is `rustc-skip:`. It is `#[cfg(test)]` and parses every `tests/**/clippy.toml` through toml
and walkdir, so it waits for vendor-toml. Port it with that lane.

## Proof

- **Upstream's own `tests/config-metadata.rs`.** Both `book` and `changelog` are reproduced exactly.
  - The book is `book/src/lint_configuration.md`: 97 paragraphs, every `default` a `FromDefault::display_default` output.
  - The changelog is `CHANGELOG.md`'s block of configuration links.
  - `Conf::get_metadata` is still a macro fn, so `conf.test.ts`'s `metadata()` builds the same list. It uses
    `parseConf` and picks, per field, the impl the macro resolves to by matching the type string in the test. This tests
    the impls' outputs and the names table below. It does not test the dispatch codegen-clippy-conf will emit: that is
    tested only once `metadata()` calls the generated `Conf.get_metadata` (review N4a; see "For root").
- **The oracle `cargo-clippy --explain <lint>`, 26 lints.** These were chosen for `no_run`, `rust,no_run`, `toml` and
  `text` fences, hidden `# ` lines, and lints with 1 to 6 configs. Each output equals `sanitize_explanation` of the generated
  `explanation`, then each config's `ConfMetadata` `Display`.
- **The oracle `clippy-driver`, with a scratch `clippy.toml`.**
  - 39 "possible values" notes equal `create_value_list_msg`. They cover clippy.toml's 101 field names, the 17
    module item kinds and the 3 lint scopes, at 12 diagnostic widths, both pretty (`pretty-json`) and not (`json`).
  - 22 "did you mean" results equal `find_closest_match`, for unknown fields and bad enum values.
- **Mutation checks**, each made alone, run, then restored. Each of the following fails a test:
  - `try_fold`'s `+ 3` changed to `+ 2`;
  - the right-edge padding kept;
  - `strip_prefix(" ")` dropped;
  - `min_by_key` keeping the last of equal minima instead of the first;
  - `DisplayStr` as `JSON.stringify`;
  - `_`→`-` dropped;
  - `values.len() <= 8` changed to `< 8` (after the review, N5).
  The last four were caught only after I added targeted cases.
- **What is not tested yet (review N3):** no `Deserialize` logic runs in a test (about 30 fns: de.rs 288–537 and
  types.rs's `deserialize` impls, `deserialize_table`, `deserialize_array`), because every `DeValue` accessor stops.
  Their error texts, their order and the fallbacks are unverified until vendor-toml lands.
- **TOML-free unit checks:**
  - the `conf_enum!` tables (`NAMES`, `COUNT`, `name`, `from_str`);
  - every `FromDefault` impl;
  - the default values of the source-ordering types, including that the hand-written `lut`/`back_lut` equal
    `build_lut`/`build_back_lut`;
  - their `Debug` forms;
  - that the `DEFAULT_*` tables equal conf.rs;
  - that every `Deserialize` impl reaches toml only through the surface that stops.
- **Sample difftest:** none run. No suite reaches clippy_config yet, because the clippy driver is clippy-contract-a's,
  and no rustc file imports it.

## Every `unported(...)` left

| Where | Message | Unblocked by |
|---|---|---|
| `de.ts` `DeValue.{as_integer, as_float, as_bool, as_str, as_array, as_table}`, `DeTable.{parse, parse_recoverable}` | `vendor-toml: toml::de::…` | vendor-toml (wave 42) |
| `de.ts` `Deserialize_for_{i8,i16,i32,i64,i128,u128}`; any radix other than 10 for `u8`/`u16`/`u32`/`u64` | `std: <ty>::from_str_radix…` | `src/std/num.ts` gaining `from_str_radix` (root: only `u8..u64` radix 10 exist). No `define_Conf!` field needs these: the fields are `u32`, `u64` and `Option<u64>`. A hex or octal TOML integer such as `0x10` would stop |
| `de.ts` `Deserialize_for_{f32,f64}`; `FromDefault_for_{f32,f64}.display_default` | `std: <f64 as FromStr>…`, `clippy_config: <f64 as Display>…` | float `FromStr`/`Display` in src/std. No field is a float |
| `types.ts` local `lookup_path`, `find_crates` | `clippy_utils::paths::… (clippy-utils-a)` | clippy-utils-a: then replace the local block with `import { PathNS, find_crates, lookup_path } from "../clippy_utils/paths.ts"` |
| `conf.ts` `Conf.default`, `Conf.get_metadata`, `Conf.deserialize` | `codegen-clippy-conf: …` | codegen-clippy-conf assigns them (below) |
| `conf.ts` `load_conf_file` | `clippy_config: a <VAR> that is not UTF-8` | a `PathBuf` that is not a string (not planned) |

## `// PORT:` decisions

1. **Trait impls are tables named `<Trait>_for_<Type>`**, as `MultiSpan_for_Span` is. A generic impl is a function that
   takes its bounds' tables.
   - When one type has several impls of a trait, differing only in the trait's parameter, the parameter goes before
     `for`: `unit` (`()`), `str` (`&'static str`), `slice` (`&'static [U]`).
   - `DisallowedPath<false>`/`<true>` become `_false`/`_true`.
   - The full list is in the next section.
2. **The toml surface (de.ts).** vendor-toml does not exist and this lane may not create it. de.ts therefore types the
   toml 1.1.0 / serde_spanned 1.1.0 items that clippy_config reaches, by PORTING's rules:
   - structs are objects with methods: `TomlSpanned.{span, get_ref, as_ref}`, `DeInteger.{as_str, radix}`,
     `DeFloat.as_str`, `DeTable.{iter, get_key_value(&str)}`, `TomlDeError.{span, message}`;
   - `DeArray`'s `Deref` target is its `items` field;
   - `DeValue` is a `$`-union whose methods are on its companion, and they stop;
   - `DeTable.parse(input: Str): Result<TomlSpanned<DeTable>, TomlDeError>` and
     `DeTable.parse_recoverable(input: Str): [TomlSpanned<DeTable>, TomlDeError[]]` take the project's `Str` (review N1).
     Every `span()` is a UTF-8 byte range into that input, which `DiagCtxt.make_sp` adds to the `SourceFile`'s
     `start_pos`, so the input is byte-offset-indexed source text (PORTING §5). `load_inner` passes `SourceFile.src` (a
     `Str`) unchanged; it panics as `unwrap()` does if `src` is `None`. Keys and string values stay `string`;
   - iterating `&DeTable` (`IntoIterator for &Map`, as `configs_are_tested` does with `for (key, _) in toml.as_ref()`) is
     `DeTable.iter()`. With `parse` added, the surface covers everything `configs_are_tested` needs from toml.

   These are the `toml` crate's own types (`toml::de`, from its `de::parser` module), not `toml_parser`'s, which is the
   lexer and parser beneath.

   **vendor-toml must match these shapes, or root changes de.ts's block to its real API in one place.** Nothing in
   clippy_config parses TOML.
3. `impl Display` returns are `string`. `()` is `null`. `u64`/`i64`/`u128`/`i128` are `bigint`. A clippy.toml value can be
   any `u64`, so `Conf`'s `u64` fields are `bigint`.
4. **`conf_enum!` is one `conf_enum(rows)` factory**, as `stable_hash.ts` does for its macro. The markers sit on the macro's
   fn lines. Each enum is a string union whose companion carries `NAMES`, `COUNT`, `name`, `from_str` and, where upstream
   has it, `all_variants`. `concat_expr!` and `name_or_lit!` are folded in. `deserialize_table!` is one
   `deserialize_table(dcx, table, { field: [name_str, impl] })`.
5. **Fields that collide or are reserved:**
   - `DisallowedPath`'s field `path` is `path_`, because the class has a method `path()` (as `SourceFile.lines_`);
   - `ConfMetadata` keeps its field `default`, with constructor parameter `default_`.
6. **`Conf` is an interface plus a companion const.** It is a data struct whose associated fns are all `self`-less. The
   fields come from the macro; see the next section.
7. **`Deserialize for [T; N]` keeps the literal `{N}`**: upstream passes a plain `&str`, not `format!`, to `span_err`.
8. **`create_value_list_msg` takes `{ width, render_pretty }`**, the only `DiagCtxt` fields it reads, so that tests need no
   `Session`. A `DiagCtxt` satisfies it.
9. **Fn order (review N2).** Three `Debug`/`Display` impls sit between a struct and its inherent impl upstream. The struct
   and the impl are one TS class, so the impl comes just before the class, with a `PORT:` note:
   - `Debug for SourceItemOrderingModuleItemGroupings` (types.rs:503);
   - `Debug for SourceItemOrderingTraitAssocItemKinds` (types.rs:738);
   - `Display for ConfMetadata` (metadata.rs:12).

   `Conf::{load, load_inner}` (conf.rs:934) are assigned to the companion after `load_conf_file`, in upstream order. The
   companion is typed by a local `ConfFns` interface and is complete once conf.ts has run.

## For codegen-clippy-conf: the TS names for each field type

Imports:
- impls from `./de.ts` and `./types.ts`;
- `DEFAULT_*`, `Conf` and `ConfMetadata` from `./conf.ts` / `./metadata.ts`;
- `ConfField` is already in conf.gen.ts.

**How to emit the struct.** Augment the interface. Assign the three fns. Put each marker on its assignment:

```ts
declare module "./conf.ts" {
  interface Conf { absolute_paths_allowed_crates: Set<Symbol>; absolute_paths_max_segments: bigint; /* … all 98, msrv too */ }
}
// rustc: src/tools/clippy/clippy_config/src/conf.rs:122 default
Conf.default = function (): Conf { return { absolute_paths_allowed_crates: FromDefault_unit_for_HashSet.from_default(null), … }; };
// rustc: …conf.rs:130 get_metadata   → new ConfMetadata(name_str, default, lints, doc, renamed_to)
// rustc: …conf.rs:146 deserialize    → (dcx: DiagCtxt, table: DeTable): Conf
```

- `msrv: RustcVersion | undefined` is already declared in conf.ts. Re-declaring it with the identical type is legal: I
  checked that an augmentation of this shape plus a `Conf.default =` assignment type-checks.
- lib.ts already imports conf.gen.ts after conf.ts, so the assignments run before any use.
- `ConfMetadata`'s arguments are:
  - `default`: `default_text`, else `display_default(..)`, else `""`;
  - `lints`: `string[]`;
  - `doc`: each doc line plus `"\n"`;
  - `renamed_to`: `ConfField.name("<new>")` or `undefined`.
- `deserialize` uses:
  - `table.iter()` and `ConfField.parse(key.get_ref())`;
  - `diag.note_once(create_value_list_msg(dcx, ConfField.SUGG_NAMES))`;
  - `table.get_key_value(key.get_ref())` and `table.get_key_value(ConfField.name(conf_key))`, keyed by `&str`, as
    upstream's `Borrow<str>` lookup is;
  - `struct_span_warn(..).with_span_suggestion(..)` and `struct_span_err(..).with_span_note(..)`, which are rustc_errors'
    `Diag` names.

  `value.into()` is just `value`.

The rows below cover every type and default form among the 98 typed entries. conf.test.ts's `display_default` uses the
middle column for all of them and reproduces the book.

| `define_Conf!` entry | `from_default(..)` (Default, and deserialize's fallback) / `display_default(..)` | `deserialize_or_default(dcx, value, ..)` |
|---|---|---|
| `bool = b` | `FromDefault_for_bool` with `b` | `DeserializeOrDefault_for_T(Deserialize_for_bool, FromDefault_for_bool)` with `b` |
| `u32 = n` | `FromDefault_for_u32` with `n` (number) | `DeserializeOrDefault_for_T(Deserialize_for_u32, FromDefault_for_u32)` |
| `u64 = e` | `FromDefault_for_u64` with `e` as bigint (`16n * 1024n`, `1_000_000n`) | `DeserializeOrDefault_for_T(Deserialize_for_u64, FromDefault_for_u64)` |
| `Option<u64>` | `FromDefault_unit_for_Option` with `null` (its display is `#[default_text]`'s) | `DeserializeOrDefault_unit_for_Option(Deserialize_for_u64)` with `null` |
| `Option<RustcVersion>` | `FromDefault_unit_for_Option` with `null` | `DeserializeOrDefault_unit_for_Option(Deserialize_for_RustcVersion)` |
| `Vec<T>` (no default) | `FromDefault_unit_for_Vec` with `null` | `DeserializeOrDefault_unit_for_T(Deserialize_for_Vec(<T>), () => [])` with `null` (`<T>` below) |
| `FxHashSet<T>` (no default) | `FromDefault_unit_for_HashSet` with `null` | `DeserializeOrDefault_unit_for_T(Deserialize_for_HashSet(<T>), () => new Set())` |
| `Vec<String> = DEFAULT_X` | `FromDefault_slice_for_Vec(FromDefault_str_for_String)` with `DEFAULT_X` | `DeserializeOrDefault_slice_for_Vec(Deserialize_for_String, FromDefault_str_for_String)` with `DEFAULT_X` |
| `FxHashSet<String> = DEFAULT_X` | `FromDefault_slice_for_HashSet(FromDefault_str_for_String)` | `DeserializeOrDefault_slice_for_HashSet(Deserialize_for_String, FromDefault_str_for_String)` |
| `E = E::V`, a `conf_enum!` type (`InherentImplLintScope`, `MatchLintBehaviour`, `PubUnderscoreFieldsBehaviour`) | `FromDefault_for_E` with `"V"` | `DeserializeOrDefault_for_T(Deserialize_for_E, FromDefault_for_E)` with `"V"` |
| `SourceItemOrdering`, `SourceItemOrderingModuleItemGroupings`, `SourceItemOrderingTraitAssocItemKinds`, `SourceItemOrderingWithinModuleItemGroupings`, `TraitImplItemOrder` (no default) | `FromDefault_unit_for_<T>` with `null` | `DeserializeOrDefault_unit_for_<T>` with `null` |

Element impls `<T>`:

| Rust type | TS impl |
|---|---|
| `String` | `Deserialize_for_String` |
| `Symbol` | `Deserialize_for_Symbol` |
| `[String; 2]` | `Deserialize_for_array(Deserialize_for_String, 2)` |
| `DisallowedPath` | `Deserialize_for_DisallowedPath_true` |
| `DisallowedPathWithoutReplacement` | `Deserialize_for_DisallowedPath_false` |
| `MacroMatcher` | `Deserialize_for_MacroMatcher` |
| `Rename` | `Deserialize_for_Rename` |

TS field types:

| Rust type | TS type |
|---|---|
| `bool` | `boolean` |
| `u32` | `number` |
| `u64` | `bigint` |
| `Option<X>` | `X \| undefined` |
| `Vec<X>` | `X[]` |
| `FxHashSet<X>` | `Set<X>` |
| `[String; 2]` | `string[]` |
| `RustcVersion` | rustc_ast's |
| the types.rs types | `types.ts`'s |

The other impls, for completeness:
- `FromDefault_for_{u8,i8,u16,i16,i32,i64,f32,f64}`;
- `Deserialize_for_{i8,u8,i16,u16,i32,i64,i128,u128,f32,f64}`;
- `Deserialize_for_HashMap(<T>)` (`HashMap<T, Span>`);
- `Deserialize_for_Spanned(<T>)`;
- `deserialize_array(dcx, value, default, de, fd, Collect_Vec() | Collect_HashSet())`;
- the `conf_enum!` types' `Deserialize_for_<E>` / `FromDefault_for_<E>` for `SourceItemOrderingCategory`,
  `SourceItemOrderingModuleItemKind`, `SourceItemOrderingTraitAssocItemKind`, `TraitImplItemOrder`;
- `FromDefault_unit_for_TraitImplItemOrder`.

**Required (review N4a):** once `Conf.get_metadata` is generated, conf.test.ts's `metadata()` must call it instead of
rebuilding the list. Only then do the book and `--explain` checks test the generated dispatch itself.

## For clippy-contract-b2 (`clippy_utils/src/{diagnostics.rs, sym.rs, msrvs.rs}`)

None of the three files imports `clippy_config` at the pin, so b2 needs nothing from me. clippy_lints' `Msrv` users read
`conf.msrv`, which is `RustcVersion | undefined` (rustc_ast's `RustcVersion`, the type `msrvs.gen.ts` uses).

## For root

- **src/std** (not this lane's): `<int>::from_str_radix` for every integer type and radix 2/8/10/16, float `FromStr`, and
  float `Display`. These unblock the rows above, though `define_Conf!` needs none of them except hex and octal `u64`s.
- **vendor-toml's brief:**
  - match de.ts's toml surface (PORT 2), including `Str` input with UTF-8 byte spans, `DeTable.parse` and
    `DeTable.iter()`, then replace de.ts's block with imports;
  - port `conf.rs:988 configs_are_tested` (needs walkdir over `tests/`);
  - add oracle tests of clippy.toml diagnostics through `Conf::load_inner` (review N3): bad types, unknown keys in inline
    tables, a duplicate `..`, missing `path`/`rename`/`name`/`brace`, and the source-ordering errors. Upstream's
    `tests/ui-toml/**` has ready cases. codegen-clippy-conf's brief could take this instead.
- **codegen-clippy-conf's brief:** switch conf.test.ts's `metadata()` to `Conf.get_metadata` (review N4a, required).
- **clippy-utils-a's brief:** `types.ts` has a local `PathNS` union and two stopping fns to swap for
  `clippy_utils/paths.ts`'s. Check that no consumer imports `PathNS` from `clippy_config/types.ts` before the swap
  (review N6).
- The tests read upstream (`book/`, `CHANGELOG.md`, conf.rs) from `$RUST_TS_DATA/rust`, and import
  `tools/codegen/clippy.ts`'s `parseConf` and `scripts/lib/common.ts`. Both have precedent: src tests import `scripts/`
  (e.g. `rustc_resolve/contract.test.ts`), and four already import `tools/` (e.g. `rustc_driver_impl/print.oracle.test.ts`;
  review N4b corrected my earlier "none").
- **Environment:** the worktree had no `.env.local` or `node_modules`. I copied the first and symlinked the second from
  the main checkout; both are gitignored. `bun scripts/crate-src.ts` fetched `toml-1.1.0+spec-1.1.0` and
  `serde_spanned-1.1.0` into the cargo registry, read only. `capture.ts` now deletes its own scratch directory; a re-run
  after the fixes gave a byte-identical `de.oracle.json` and left nothing under `$RUST_TS_DATA/tmp`.

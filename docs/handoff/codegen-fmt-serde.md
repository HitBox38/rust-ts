# Handoff: codegen-fmt-serde (M8 wave 41, step 2; tools batch under `tools/codegen`)

Plan: `docs/plan-m8.md` §3, D4, D5 (second bullet), D6, D7, D18, §8 wave 41. Nothing of clippy, rustfmt or cargo was built; the oracle
runs are `-Zunpretty=expanded` in the check profile on the `tools-deps` workspace (about 9 s from an empty target dir, ~100 MiB scratch,
removed afterwards). `upstream.ts fetch` was not run. No `harness/`, `scripts/` or `scope.json` edits.

## Headline

- **clippy_config derives no serde trait at the pin.** Its `Cargo.toml` has no serde dependency (only `toml` with `parse`), and the
  oracle's `-Zunpretty=expanded` of `clippy_config` contains **0** serde_derive impls (recorded in the fixture header and asserted by the
  test). Its `Deserialize` is clippy's own trait in `de.rs` (hand-ported per D6) and the `impl Deserialize for $name` in `types.rs:73` is
  a `macro_rules!` of clippy_config, not serde. So nothing is generated under `src/clippy_config/` (that tree is not created).
- rustfmt: **14 serde_derive impls** (12 on its types + `PartialConfig`'s two), **23 `#[config_type]` enums**, **`create_config!`** with
  its **90 options** and the 90 `StyleEditionDefault` impls of `config_option_with_style_edition_default!`. All are generated, and every
  one of them, rendered back as Rust, equals the oracle's expansion **token for token** (details below).

## Files

Generator (all new except `types.ts`):

| File | What |
|---|---|
| `tools/codegen/rustfmt.ts` | entry: `bun tools/codegen/rustfmt.ts [--check] [--json f] [--save-json f]`; runs the typedefs probe on the set, drives `types.ts` with hooks, writes `create_config`, the contract files |
| `tools/codegen/rustfmt.json`, `tools/codegen/rustfmt.typemap.json` | the `types.ts` set (5 files, skips with notes) and its `typemap_extra` (`default` rules for `PathBuf`, `HashSet`) |
| `tools/codegen/serde.ts` | serde_derive 1.0.228 port for the shapes used: plans, `renderRust` (oracle form), `renderTs`, the serde surface declarations |
| `tools/codegen/config_type.ts` | config_proc_macro port (`item_enum.rs`, `attrs.rs`): plans, `renderRust`, `renderTs`, `companionMembers` (FromStr) |
| `tools/codegen/create_config.ts` | `create_config!` / `config_option_with_style_edition_default!` / `style_edition_default!`: parser (ported rustc_lexer), Rust renderings of the parse-dependent parts, TS expansion |
| `tools/codegen/rust_tokens.ts` | layout-free token comparison (ported rustc_lexer) |
| `tools/codegen/rustfmt_oracle.ts` | **the checked script**: `write` / `check` run the oracle's expansion of rustfmt and clippy_config and extract the blocks; removes its whole scratch dir afterwards (unless `--keep`) |
| `tools/codegen/rustfmt.test.ts` | golden, oracle, the contract guard, refusals, behaviour of the emitted TS (6 tests, ~1 s: the guard scans src/) |
| `tools/codegen/fixtures/rustfmt.typedefs.json`, `tools/codegen/fixtures/rustfmt.expanded.rs` | probe fixture; the oracle's blocks (714 KiB, 129 blocks) |
| `tools/codegen/types.ts` (**shared file**) | (1) `fileModule` maps `src/tools/rustfmt/src/<path>.rs` to crate `rustfmt` (one regex alternative next to Miri's); (2) `GenOptions.hooks` (`ItemHooks`: `itemLines`, `companionMembers`, `fileTrailer`) and `ItemHookCtx`, called after `serLines(r)` for structs / fieldless / data enums, inside the companion consts, and at the file's end. Without hooks nothing changes: all `tools/codegen` goldens pass unchanged (71 pass). **codegen-clippy-macros may touch the same `fileModule` line** (clippy paths): merge both alternatives. |

Generated (all `// GENERATED`, regenerate with `bun tools/codegen/rustfmt.ts`, `--check` is clean):

| File | Content |
|---|---|
| `src/rustfmt/config/options.gen.ts` | 20 `#[config_type]` enums, `WidthHeuristics` (+ serde), `IgnoreList` (+ `default_IgnoreList`), Debug/Clone |
| `src/rustfmt/config/lists.gen.ts` | `DefinitiveListTactic`; 3 `#[config_type]` enums incl. `ListTactic` (a tuple variant: `$`-tagged, `ListTactic_eq`) |
| `src/rustfmt/config/file_lines.gen.ts` | `FileName`, `Range` (Deserialize), `JsonSpan` (both) |
| `src/rustfmt/config/macro_names.gen.ts` | `MacroName` (both), `MacroSelector` (Serialize), `MacroSelectors` (both, `default_MacroSelectors`) |
| `src/rustfmt/emitter/json.gen.ts` | `JsonEmitter`, `MismatchedBlock`, `MismatchedFile` (Serialize) |
| `src/rustfmt/config/create_config.gen.ts` | the 90 `StyleEditionDefault` tables; `Config` (+ `clone_Config`, `default_Config`), `PartialConfig` (+ clone, both serde impls), `ConfigSetter`, `CliConfigSetter`, `ConfigWasSet`, `CliConfigWasSet` |
| `src/rustfmt/contract.gen.d.ts` | ambient `declare module "../../<path under src/>*"` blocks for every module the generated code imports that does not exist yet (serde surface, rustfmt hand modules): exactly the names used, typed. Named by the exact specifier the generated files use (see "Review fixes", N2) |
| `src/rustfmt/contract_augment.gen.d.ts` | module augmentation of `./config/options.gen.ts` with what `config/options.ts` will add (`WidthHeuristics.{null,set,scaled,from_str}`, `IgnoreList.from_str`, `IgnoreList#add_prefix`) |

Layout follows `types.ts` (`<path>.gen.ts` next to the future hand module `<path>.ts`, `// rustc-type:` / `// rustc-derive:` lines).
`create_config.gen.ts` imports generated items from their `.gen.ts` and hand impls from the hand modules (header says so).

## The oracle comparison (D6)

`bun tools/codegen/rustfmt_oracle.ts check` (re-runs the oracle, compares with the fixture): **ok**. `rustfmt.test.ts` "oracle" renders
every plan as Rust and compares it with the fixture's block, token for token (whitespace and comments ignored), and requires the two
key sets to be equal:

| What | Count | Result |
|---|---|---|
| serde_derive impls (`const _: () = { extern crate serde as _serde; .. }`) | 14 (`Deserialize`/`Serialize` of `WidthHeuristics`, `JsonSpan`, `MacroName`, `MacroSelectors`, `PartialConfig`; `Deserialize Range`; `Serialize` of `MacroSelector`, `MismatchedBlock`, `MismatchedFile`) | 14/14 equal |
| `#[config_type]` expansions (`mod __define_config_type_on_enum_X { .. } pub use ..;`, rustc's own derive output stripped) | 23 | 23/23 equal |
| `StyleEditionDefault` impls (`pub struct X; impl StyleEditionDefault for X { .. }`) | 90 | 90/90 equal |
| `Config::print_docs`, `Config::override_value` (all per-option data: names, types, `$stb`, descriptions, `stringify!` texts) | 2 | 2/2 equal |
| clippy_config serde_derive impls | 0 | asserted 0 |

The comparison caught two real differences while building: the pretty-printer drops the trailing comma of `ALLOWED`'s array, and
`stringify!(<$ty as StyleEditionDefault>::ConfigType)` is `"< MaxWidth as StyleEditionDefault > :: ConfigType"` (spaced; the TS
`override_value` panic message now uses that text).

Not covered by the oracle comparison (hand-translated templates in `create_config.ts`, for review): the fixed bodies of
`adjust_max_width`, `set_width_heuristics`, `set_heuristics`, `set_merge_imports`, `set_fn_args_layout`, `set_hide_parse_errors`,
`set_version`, `fill_from_parsed_config`, `is_default`, `is_hidden_option` (their `eprintln!` texts were checked by hand against
`config_type.rs`).

## The serde surface the generated code needs (scope for `vendor-serde-de`)

Paths per PORTING §5b (serde 1.0.228 / serde_core 1.0.228); exact TS signatures in `tools/codegen/serde.ts` `SERDE_SURFACE_DECLS` and,
as used, in `src/rustfmt/contract.gen.d.ts`.

- `src/vendor/serde_core/de/mod.ts`: types `Deserialize<T>` (`<E>(d: Deserializer<E>) => Result<T, E>`), `Deserializer<E>`
  (`Error`, `deserialize_string`, `deserialize_newtype_struct`, `deserialize_struct`, `deserialize_identifier`), `Visitor<V>`
  (`expecting(): string`; optional `visit_u64(bigint)`, `visit_str`, `visit_bytes(Uint8Array)`, `visit_newtype_struct`, `visit_seq`,
  `visit_map`, each taking the `Error` table where serde's default needs it), `SeqAccess<E>` (`Error`, `next_element<T>`),
  `MapAccess<E>` (`Error`, `next_key<K>`, `next_value<V>`), `Error<E>` (the `de::Error` table: `custom`, `invalid_length`,
  `unknown_variant`, `duplicate_field`; plus `missing_field` etc. for `private::de`), `Expected` (`fmt(): string`), `Expected_str`
  (`impl Expected for &str`).
- `src/vendor/serde_core/de/impls.ts`: `deserialize_bool`, `deserialize_usize`, `deserialize_String`, `deserialize_Option<T>`,
  `deserialize_Vec<T>`, `deserialize_tuple2<T0, T1>` (declared too: `deserialize_u32`, `deserialize_isize`).
- `src/vendor/serde_core/de/ignored_any.ts`: `deserialize_IgnoredAny`, `IgnoredAny`.
- `src/vendor/serde/private/de.ts`: `missing_field<V, E>(deserialize_V, field, Error)` (the `MissingFieldDeserializer`: `None` for an
  `Option`, else `Error::missing_field`).
- `src/vendor/serde_core/ser/mod.ts`: `Serialize<T>`, `Serializer<O, E>` (`Error`, `serialize_str`, `serialize_unit_variant`,
  `serialize_newtype_struct`, `serialize_newtype_variant`, `serialize_struct`), `SerializeStruct<O, E>` (`serialize_field`, `end`),
  `Error<E>` (`custom`).
- `src/vendor/serde_core/ser/impls.ts`: `serialize_bool`, `serialize_usize`, `serialize_u32`, `serialize_String`, `serialize_Option<T>`,
  `serialize_Vec<T>`, `serialize_tuple2<T0, T1>` (declared too: `serialize_isize`).

Conventions (stated in `serde.ts`): a trait's associated `Error` impl is the object's `Error` field
(`<__A::Error as de::Error>::duplicate_field(..)` → `__map.Error.duplicate_field(..)`); impls are functions passed where Rust names
the type (`next_element::<T>()` → `next_element<T>(deserialize_T)`), generic ones take their parameters' impls; `Option` results of
generic fns are `{ $: "Some", _0 } | undefined`; `u64` visitor arguments are `bigint`; `Formatter`-writing fns return their text. If
the vendor lane wants another shape, change `serde.ts` (`renderTs`, `SERDE_SURFACE_DECLS`) and regenerate.

Not reached by the derives (vendor lane's own scope): `Unexpected`, `invalid_type`/`invalid_value`, `value`, `untagged`/`flatten`
(`private::de` content types): no rustfmt derive at the pin uses `#[serde(..)]` attributes at all.

## What the rustfmt hand modules must provide (scope for the `rustfmt-contract` lanes)

`src/rustfmt/contract.gen.d.ts` / `contract_augment.gen.d.ts` (tables `HAND_DECLS`, `AUGMENT_DECLS` in `rustfmt.ts`):
- `config/config_type.ts`: `ConfigType<T>` (`doc_hint()`, `stable_variant(self)`), `config_type_{bool,usize,String,FileLines,
  MacroSelectors,WidthHeuristics,IgnoreList}` (config_type.rs:20-65), `is_stable_option_and_value(name, stable, value,
  config_type_T, debug_T)`.
- `config/style_edition.ts`: `StyleEditionDefault<ConfigType>`.
- `config/options.ts`: `display_{WidthHeuristics,IgnoreList}`, `{WidthHeuristics,IgnoreList}_eq`, `serialize_IgnoreList`,
  `deserialize_IgnoreList`; augmenting `options.gen.ts`: `WidthHeuristics.{null,set,scaled,from_str}`, `IgnoreList.from_str`,
  `IgnoreList#add_prefix`.
- `config/macro_names.ts`: companion `MacroSelectors.from_str`, `display_MacroSelectors`, `MacroSelectors_eq`,
  `debug_MacroSelectorsError`, `deserialize_MacroSelector` (manual impl, macro_names.rs:39).
- `config/file_lines.ts`: the whole `FileLines` (skipped by the set: object-keyed `HashMap`, a representation decision) with
  `FileLines.all()`, `FileLines.from_str`, `display_/clone_/debug_FileLines`, `FileLines_eq`, `debug_FileLinesError`,
  `serialize_/deserialize_FileLines`, and `serialize_/deserialize_FileName` (manual impls, file_lines.rs:55, :69).

When a hand module lands, rerun `bun tools/codegen/rustfmt.ts`: its block disappears and the real module is type-checked against the
same uses (an augmentation left in place next to the real one would be a duplicate-declaration error, so `--check` flags it as stale).

## Coverage (`bun scripts/coverage.ts --missing`)

`config/config_type.rs` 26/37 (the 26 fixed fns of `create_config!`; left: the hand `ConfigType` impls and
`is_stable_option_and_value`), `config/style_edition.rs` 2/5 (the two macro arms' `style_edition_default`; left: the trait method and
two tests). The other generated files hold types and derives only (no `// rustc:` markers): `options.rs` 0/30, `lists.rs` 0/5,
`file_lines.rs` 0/36, `macro_names.rs` 0/10, `mod.rs` 0/103, `emitter/json.rs` 0/8. `clippy_config/src/de.rs` 0/43 (a porting lane's).
`bun scripts/coverage.ts --check`: markers ok.

## Checks

- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: ok. `bun tools/codegen/rustfmt.ts --check`: clean.
- `bun test tools/codegen`: 71 pass, 0 fail (7.3 s wall for the whole directory; `rustfmt.test.ts` alone ~0.1 s, D13).
- `bun tools/codegen/rustfmt_oracle.ts check`: ok (fresh oracle run).
- No difftest: nothing under `src/` outside `src/rustfmt/` changed, and no suite runs rustfmt yet.

## `unported(...)` and errors left

- `create_config.gen.ts` `usize_saturating_add_signed`: `unported` if `adjust_max_width` would produce a width past 2^53 (only
  `increase_max_width(huge)` can); otherwise exact.
- No `unported_*` placeholders are emitted: every unsupported shape, attribute, default expression or missing impl is an `ERROR:` of
  the generator (tested), never a guess.

## `// PORT:` decisions (for root to record)

1. **`Config`'s option tuples are fields named `<option>_`** (`max_width_: [boolean, boolean, number, boolean, boolean]`): the getter
   `max_width()` takes the option's name, and a TS class cannot have both (as anstyle_parse's `len_`). Upstream code that reads
   `config.max_width.2` reads `config.max_width_[2]`.
2. **The setters' identical `match stringify!($i) { .. }`** (and `override_value`'s second `match key`) is one module-local function
   `__set_dependent_options(config, key)`, not a copy per option and setter (it is the same match in every expansion; 3,400 lines saved).
3. **`StyleEditionDefault` unit structs are their impl's table** (`export const MaxWidth: StyleEditionDefault<number> = { .. }`), and
   `ConfigType` impls are tables `config_type_X` (PORTING §5 "Traits": generic code takes the table).
4. **`#[config_type]`'s FromStr is a companion member** (`NewlineStyle.from_str`, PORTING §8); Display/ConfigType/serde are free
   `display_X` / `config_type_X` / `serialize_X` / `deserialize_X`; the macro's `#[derive(PartialEq)]` on `ListTactic` (tuple variant)
   is `ListTactic_eq`.
5. **The contract files** (`*.gen.d.ts`): ambient blocks for not-yet-existing modules (TypeScript uses them only while the import does
   not resolve) and an augmentation for hand statics on generated classes, so the generated code type-checks before the vendor and
   contract lanes land. The alternative was to hold the outputs back until then.
6. **`print_docs(out: Write)`**: the port has no `std::io::Write`; `Write` is a one-method interface (`write_fmt(text)`) in
   `create_config.gen.ts`. `bool::from_str`, `ParseBoolError`/`ParseIntError` Debug and `str::eq_ignore_ascii_case` are module-local
   helpers (src/std has none yet); candidates for `src/std`.
7. `FileLines` is skipped by the set (not `hand`): types.ts's derived Debug would fix its field shape (`_0`), a representation choice
   the contract lane should make (object keys in a `HashMap`).

## For the next lanes

- `rustfmt-contract` (config lane): write the hand modules listed above, re-export the `.gen.ts`, rerun the generator; `mod.rs`'s
  `#[cfg(test)]` mock `create_config!` and `PartiallyUnstableOption` are not generated (cfg(test) inside `mod test`).
- `vendor-serde-de`: implement the surface above; then `deserialize_*` of these types can be exercised by `toml`'s deserializer.
- A rustfmt test that imports the generated modules at runtime has to wait for the hand modules (`import { type X }` keeps the import
  under `verbatimModuleSyntax`).

## Review fixes (review `codegen-fmt-serde`, PASS WITH NOTES; root's decision "codegen-fmt-serde PORT #2")

Root's decision covers N3 (serde surface gaps → `vendor-serde-de`'s brief), N4 (`format-diff/main.rs:78` → the bins lane's brief),
N5 (PORT #2 stands as a deduplication of generated output) and N6 (root runs `rustfmt_oracle.ts check` at integration). Fixed here:

- **N2 (contract blocks applied project-wide).** Every generated import of a module that does not exist is now written as the
  canonical specifier `../../<path under src/>` (`canonicalizeImports` in rustfmt.ts; the generated files sit two directories below
  src/, so it resolves to the same file), and its block is named by that exact text plus `*`
  (`declare module "../../rustfmt/config/config_type.ts*"`). TypeScript never matches an ambient name that looks relative, so the
  `*` is required; the name is then a pattern whose prefix is the whole specifier and whose wildcard matches the empty rest. The old
  `*/config_type.ts`-style suffix patterns are gone. References between blocks are written `import("@/<path>")` in the tables and
  resolved to the real module when it exists, else to its block's specifier.
  - The reviewer's example (a file in `src/rustc_span/` importing `config_type_bool, is_stable_option_and_value` from
    `"./config_type.ts"` and `MacroSelectors` from `"./macro_names.ts"`) now fails `tsc`:
    `TS2307: Cannot find module './config_type.ts'` and `TS2307: Cannot find module './macro_names.ts'` (probe file removed afterwards).
  - New test "contract: blocks name only missing modules, by specifiers no file outside src/rustfmt/ uses": every block name is
    `CANON + path + "*"`, the path does not exist under src/, and no `.ts` file outside src/rustfmt/ contains a declared specifier.
    Checked by mutation: a file in `src/rustc_span/` importing `"../../rustfmt/config/config_type.ts"` fails it.
- **N1 (data-enum Serialize only golden-checked).** The behaviour test now serializes a `MacroSelector`-shaped enum (newtype variant
  `Name(String)`, unit variant `All`) through a serializer that records the variant index: `{"Name"#0:"m"}` and `"All"#1`. The
  reviewer's mutation (`serialize_unit_variant` index `v.index + 1`) now fails it (`"All"#2`). The `create_config!` templates the review
  lists as golden-only (N1 table) still are: the config lane's oracle check (`rustfmt --help=config`, deprecation stderr) is in its brief.
- **N7 (empty scratch dir left behind).** `rustfmt_oracle.ts` removes `$RUST_TS_DATA/tmp/codegen-fmt-serde/` entirely unless `--keep`;
  after `check` the directory no longer exists.

Checks after the fixes: `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check` markers ok; `bun tools/codegen/rustfmt.ts
--check` clean; `bun test tools/codegen` 72 pass, 0 fail; `bun tools/codegen/rustfmt_oracle.ts check` ok. Generated output changed
only in the import specifiers of missing modules (`./config_type.ts` → `../../rustfmt/config/config_type.ts`) and the contract file.

# Review: clippy-contract-b1 (porting lane, M8 wave 41 step 4, first chained lane of `clippy-contract-b`)

Reviewer: independent, read-only. Subject: branch `t3/port-clippy-config-contract` at `4ea919ec` (`git diff main...4ea919ec`: 10
new files under `src/clippy_config/`, 3,529 lines), handoff `docs/handoff/clippy-contract-b1.md`, against `docs/plan-m8.md` §2c,
D4, D5, D6, D13, D14, PORTING §3–§5, §8, and root's decisions "codegen-clippy-macros (D5)" and "codegen-fmt-serde PORT #2"
(`docs/state/history.jsonl`).

Method: my worktree detached at `4ea919ec` (`.env.local` copied, `node_modules` linked; both gitignored). Upstream read from
`$RUST_TS_DATA/rust/src/tools/clippy/clippy_config/src`, toml from the cargo registry (`toml-1.1.0+spec-1.1.0`,
`serde_spanned-1.1.0`, the versions in upstream's `Cargo.lock`). Scratch under `$RUST_TS_DATA/tmp/review-clippy-contract-b1/`,
deleted at the end. Mutations were made one at a time in the worktree and reverted with `git checkout` (tree clean afterwards).
Short oracle runs only (about 2 s each). `RUSTUP_AUTO_INSTALL=0` throughout. Nothing was built.

## Verdict: PASS WITH NOTES

The port is faithful. I read `de.rs` and `types.rs` fully beside `de.ts` and `types.ts`, and `metadata.rs`, `lib.rs` and
`conf.rs`'s hand part (lines 1–60 and 834–1014) fully too. I found no logic difference, no guessed value and no wrong marker.
The oracle fixtures are genuine:
- `capture.ts` re-run gives a byte-identical `de.oracle.json`;
- independent driver runs at a width the fixture does not use agree with the port.

Mutations that change behaviour are caught. `tsc`, `coverage --check`, `clippy.ts --check` and the unit-step layout test pass.
The tests take about 0.5 s.

No finding blocks integration. Two notes need action in other lanes' briefs before those lanes start:
- **N1** (the toml contract's input type) goes to vendor-toml;
- **N3** (no `Deserialize` logic is tested yet) goes to vendor-toml or codegen-clippy-conf.

## Checks that pass (evidence)

**P1. Fidelity, `de.rs` → `de.ts` (read in full).**
- Every fn is present, in upstream order, with the correct line marker: `new` 27 … `deserialize_or_default` 534. Coverage is 43/43.
- `find_closest_match` keeps upstream's first-minimum `min_by_key` and replaces `_` before lowercasing. Case folding is
  ASCII-only, as `make_ascii_lowercase` is.
- `create_value_list_msg` measures values in UTF-8 bytes (`utf8_len`) where upstream uses `len()`, and pads by chars, as
  `{:width$}` does. Its `try_fold`, `'outer` loop, `chunks().zip()` and `step_by().zip()` are transcribed exactly, including the
  `col_widths.len() <= 1` exit and the right-edge zero width.
- The integer `MIN`/`MAX` strings are correct for all ten types.
- `u64_from_str` behaves as `from_str_radix(_, 10)`. I checked `+5`, `-0`, `u64::MAX`, `u64::MAX + 1`, `""` and `+` against
  Rust's rules.
- `[T; N]` keeps the literal `` `{N}` `` text. Its `ArrayVec` `into_inner().ok()` becomes "full or `None`".
- `HashSet`/`HashMap` use `as_ref()` where upstream does, and `Vec` uses `get_ref()` where upstream does.
- `deserialize_array` interleaves the `..` warning with element diagnostics, as the lazy `filter`/`filter_map` chain does.
- `deserialize_table` overwrites a slot even with `None`, as the macro does.
- Nothing guesses:
  - float `FromStr` and `Display` stop;
  - the signed and 128-bit integers stop;
  - any radix other than 10 stops;
  - all are listed in the handoff.

**P2. Fidelity, `types.rs` → `types.ts` (read in full).**
- `conf_enum!` gives each of the seven enums the right `NAMES` (variant or literal), `COUNT`, `name`, `from_str`,
  `FromDefault` and `Deserialize`.
- The `concat_expr!` message is reproduced: `"expected one of: " + names joined by ", "`. The macro's `$(...)", "*` separator
  is `", "`.
- `Rename`, both `DisallowedPath` impls, `BraceKind` and `MacroMatcher` match, including field order in each `deserialize_table`.
  The rename `path` → `path_` has a `PORT:` reason.
- `create_disallowed_map` matches `lookup_path`, `retain`, the `PrimTy` branch, the warning condition and the message texts.
- The source-ordering types match:
  - the defaults, the 17-entry `lut` and `back_lut`, and the `display_default` texts are verbatim;
  - the error texts are the joined string continuations;
  - `{all_items:?}` uses the variant names through `debug_list`;
  - the inner shadowing of `value` in `SourceItemOrderingModuleItemGroupings::deserialize` is kept;
  - `TraitImplItemOrder` has both its `FromDefault<Self>` and `FromDefault<()>` impls.
- Coverage is 47/47.

**P3. `metadata.rs`, `lib.rs`, `conf.rs`'s hand part.**
- `ConfMetadata`'s `Display` and both markdown displays match. `lib.ts` re-exports what `lib.rs` does.
- `sanitize_explanation` matches.
- `load_conf_file` matches: the variable order, the canonicalize error text, the `.clippy.toml`-then-`clippy.toml` loop, the
  ignored-file warning, the `NotFound | IsADirectory | NotADirectory` filter and the parent walk.
- `load_inner` matches the MSRV merge.
- The `DEFAULT_*` statics are checked against conf.rs by a test.
- Coverage is 10/13, the 3 left being `define_Conf!` fns for codegen-clippy-conf. `coverage --check` passes.

**P4. `configs_are_tested` as `rustc-skip:` is right.**
- It is a `#[test]` inside `#[cfg(test)] mod tests` (conf.rs:980–1014). PORTING §3 skips `#[cfg(test)]`-only code with
  `rustc-skip:`.
- `unported(...)` is for runtime paths. In a test it would either fail the gate or be a skip that the gate's allowlist rejects.
- It has precedent in the same crate: `conf.gen.ts:551–552` skips the macro's `check_conf_order`/`check_conf_names` the same way.
- The marker's reason names vendor-toml, and the handoff asks that lane to port it. See N1 for the toml items it will need.

**P5. The oracle fixtures are genuine.**
- `bun src/clippy_config/oracle/capture.ts` against the pinned `clippy-preview` (`git-commit-hash` = `6f5da406…`, the pin)
  rewrote `de.oracle.json`, and `git diff` was empty (39 value lists, 22 suggestions, 26 explanations, about 2 s).
- Independently of `capture.ts`, I ran `clippy-driver` by hand with my own `clippy.toml`:
  - an unknown field `allow-dbg-in-test` and a bad module-item kind, with `--error-format=pretty-json
    --diagnostic-width=73` (73 is not one of the fixture's widths);
  - the "possible values" notes equal `create_value_list_msg` for both the 17 module-item kinds (7 lines, multi-column) and
    the 99 field names;
  - the human output's suggestion is `allow-dbg-in-tests`.
- A hand `cargo-clippy clippy --explain too_many_lines` equals the fixture's text.

**P6. Reproducing upstream's `tests/config-metadata.rs` is a real check, with one limit (N4a).**
- It mirrors upstream's test exactly:
  - the same `renamed_to.is_none()` and `!lints.is_empty()` filters;
  - the `"\n"` join;
  - `trim()` and the header for the book;
  - the marker block for the changelog.
- It compares against files upstream itself checks at the pin. So it checks every `display_default` output that reaches the
  book: `DisplayStr`'s `Debug` quoting, `DisplaySlice`, the enum and source-ordering texts, the `u64` products and the bools.
  It also checks both markdown renderers.

**P7. Mutations.** My own, each alone, then reverted:

| Mutation | Result |
|---|---|
| `NOTE_LEN` → `NOTE_WITH_MSG_LEN` in the initial `total_width` | caught (value-list oracle) |
| `edit_distance` limit `4` → `3` in `find_closest_match` | caught (suggestion oracle) |
| `!in_code &&` dropped from `sanitize_explanation`'s fence test | caught (`--explain` oracle and unit test) |
| `Break((row_count, col_count - 1))` → `col_count` | not caught. It is **equivalent** on every reachable list (17 kinds, 99 fields, 3 scopes) at every width 0–400, which I checked by diffing both versions, so it is not a gap |
| `values.len() <= 8` → `< 8` | not caught (N5) |
| `"missing required field \`path\`"` text changed in both `DisallowedPath` impls | not caught (N3) |

**P8. Cross-tree import (`conf.test.ts` → `tools/codegen/clippy.ts`, `scripts/lib/common.ts`) is acceptable.**
- `tools/` and `src/` are roots of the same gate step, "unit tests" (`scripts/lib/unit-steps.ts`, 4 workers).
- The `COMMON_LOADERS` rule binds only the runner step (`scripts/`, `harness/`).
- `clippy.ts` runs `main` only under `import.meta.main`.
- Precedent exists:
  - four src tests already import `tools/` (`rustc_passes/input_stats_sizes.oracle.test.ts`,
    `rustc_driver_impl/print.oracle.test.ts`, `vendor/annotate_snippets/oracle.test.ts`, `rust_ts/llvm/ffi.test.ts`);
  - 248 src test files at `4ea919ec` import `scripts/lib/common.ts`.
- `bun test scripts/lib/unit-steps.test.ts`: 10 pass. That includes "every test file in exactly one step", "no runner test
  file loads common.ts" and the environment-read scan.
- No production module imports `tools/`.

**P9. The names table for codegen-clippy-conf is complete.**
- I enumerated `parseConf` over conf.rs: 100 entries, 98 typed, 3 renamed, 2 `#[default_text]`.
- Every (type, default) pair falls in a table row:

  | Type and default | Fields |
  |---|---|
  | `bool = true` / `= false` | 13 / 25 |
  | `u32 = n` | 1 |
  | `u64 = n` | 26 |
  | `Option<u64>`, `Option<RustcVersion>` | 1 each |
  | `Vec<String>` (no default / `DEFAULT_*`) | 5 / 5 |
  | `Vec<DisallowedPath>` | 4 |
  | `Vec<DisallowedPathWithoutReplacement>`, `Vec<MacroMatcher>`, `Vec<Rename>`, `Vec<[String; 2]>` | 1 each |
  | `FxHashSet<String>` (no default / `DEFAULT_*`) | 2 / 2 |
  | `FxHashSet<Symbol>` | 1 |
  | the three `conf_enum!` types with a `Type::Variant` default | 1 each |
  | the four source-ordering types and `TraitImplItemOrder` with `()` | 1 each |

- The dispatch agrees with Rust's impl selection:
  - `Vec`/`FxHashSet` with `()` go to `impl<T: Deserialize + Default> DeserializeOrDefault<()> for T`;
  - `Option<T>` goes to its own impl, since `Option` has no clippy `Deserialize`;
  - `TraitImplItemOrder` with `()` goes to its explicit `DeserializeOrDefault<()>`.
- `lint_inconsistent_struct_field_initializers` is renamed but typed (`bool = false`). It is a struct field with its own match
  arm, so it never reaches the deprecated `_` arm. It is in the 98 typed entries, so the table covers it. codegen-clippy-conf
  should keep that arm order.
- `u64` as `bigint` is justified under PORTING §5. A clippy.toml value can be `u64::MAX`, and thresholds are printed in lint
  messages. The dispatch and fill lanes must compare these 26 fields as `bigint`.
- **The augmentation shape compiles.** I added a scratch module to the tree and ran `tsc` (clean), then removed it. The module
  had:
  - `declare module "./conf.ts" { interface Conf { msrv: RustcVersion | undefined; absolute_paths_max_segments: bigint;
    allowed_prefixes: string[] } }`;
  - `Conf.default = function (): Conf { … }`, built from `FromDefault_for_u64.from_default(16n * 1024n)` and
    `FromDefault_slice_for_Vec(FromDefault_str_for_String)`;
  - a `DeserializeOrDefault_for_T(Deserialize_for_u64, FromDefault_for_u64)` call over `DeTable.iter()`.
- The handoff's `get_key_value(key.get_ref())` for upstream's `get_key_value(key)` is sound: `serde_spanned`'s `Spanned`
  `PartialEq`/`Hash` compare only the value.

**P10. Basics.**
- `bunx tsc --noEmit -p .` is clean (8 s).
- `bun scripts/coverage.ts --check` passes: markers ok.
- `bun tools/codegen/clippy.ts --check` is up to date, with 359 hand modules pending.
- `bun test src/clippy_config` runs 15 tests in 0.45–0.65 s over three runs (D13 allows 10 s).
- Neither test file reads an environment variable. `RUST_TS_DATA` is used only through `requireUpstream()`.
- The toml stand-in matches toml 1.1.0 where it is typed:
  - `DeValue`'s seven variants and its `as_*` signatures;
  - `DeInteger::{as_str, radix}` and `DeFloat::as_str`;
  - `DeArray`'s `items` (its private field and `Deref` target);
  - `Map::{iter, get_key_value}`;
  - `DeTable::parse_recoverable` returning `(Spanned<Self>, Vec<Error>)`;
  - `Error::{message, span}`.
- The note that `preserve_order` gives file order is right: clippy_config's `Cargo.toml` enables `features = ["parse",
  "preserve_order"]`.

## Findings

**N1. Contract: `DeTable.parse_recoverable` takes a JS `string`, but TOML spans are UTF-8 byte offsets (`de.ts:114`,
`conf.ts:106`).**
- `load_inner` passes `src_.src!.toString()`, a decoded `string`, where `SourceFile.src` is already a `Str`.
- `dcx.make_sp` adds each `span()` to `start_pos`, which counts bytes.
- PORTING §5 maps source text that is "byte-offset-indexed" to `Str`. The vendored parsers follow that: `pulldown_cmark` takes
  `Str`.
- So a vendor-toml written by the rules will take `Str`, and conf.ts must then change. That contradicts the handoff's "fill it
  without changing callers". If vendor-toml instead keeps `string`, it must compute UTF-8 byte spans internally. Otherwise any
  non-ASCII byte before an error in a clippy.toml (a comment `# café`) shifts every later span.
- **Fix, either way:** before or with vendor-toml, make it `parse_recoverable(input: Str)` and pass `src` unchanged. Or record,
  in de.ts and vendor-toml's brief, that `string` is kept and `span()` is UTF-8 byte offsets.
- Also for vendor-toml's brief: `configs_are_tested` needs `DeTable::parse` and iteration over `&DeTable`, which the surface
  does not declare yet. A small point: the handoff calls these `toml_parser`'s types, but `DeTable`/`DeValue` are the `toml`
  crate's (`toml::de::parser`); `toml_parser` 1.1.0 is the lexer and parser beneath.

**N2. Four fn-order deviations without a `PORT:` note.** None affects behaviour.
- `types.ts:647`: `Debug for SourceItemOrderingModuleItemGroupings` (types.rs:504) comes after the inherent methods 510–546.
- `types.ts:858`: `Debug for SourceItemOrderingTraitAssocItemKinds` (739) comes after `index_of` (745).
- `metadata.ts:46`: `Display for ConfMetadata` (13) comes after the methods at 23/45.
- `conf.ts:91–98`: `Conf::{load, load_inner}` (935/940) sit in the companion literal, before `sanitize_explanation` (836) and
  `load_conf_file` (866).

The `Debug`/`Display` consts reference their classes only inside function bodies, so they can move above the classes. `Conf`
is a companion const, not a class, so PORTING §8's class-body clarification does not cover it. `Conf.load = …` assignments after
`load_conf_file` would keep the order, as conf.gen.ts will do for the macro fns. Fix the order or add `PORT:` notes at the next
touch of these files.

**N3. No `Deserialize` logic is exercised by any test yet.**
- That covers about 30 marked fns:
  - de.rs 288–537;
  - types.rs's `conf_enum!` `deserialize`, `Rename`, both `DisallowedPath` impls, `BraceKind`, `MacroMatcher` and the four
    source-ordering impls;
  - the `deserialize_table` and `deserialize_array` paths.
- The only test checks that they stop, because every `DeValue` accessor is `unported`.
- My mutation of the "missing required field" text survived (P7).
- This follows from the lane not owning vendor-toml, and the handoff is open about it. But it means the error texts, their order
  and the fallbacks are unverified until then.
- **Action for vendor-toml's brief (or codegen-clippy-conf's):** add oracle tests of clippy.toml diagnostics through
  `Conf::load_inner`. That means bad types, unknown keys in inline tables, duplicate `..`, missing `path`/`rename`/`name`/`brace`,
  and the source-ordering errors. Upstream's `tests/ui-toml/**` gives ready cases.

**N4. Two handoff statements are stronger than the evidence (documentation only).**
- (a) "That dispatch is the one codegen-clippy-conf must emit, so it is tested already" is not quite right. `conf.test.ts`'s
  `display_default` chooses each impl by matching type strings in the test. It tests the impls' outputs, not the dispatch the
  generator will emit. The generated dispatch is tested only once `metadata()` calls `Conf.get_metadata`. The handoff
  recommends that switch, and codegen-clippy-conf should be required to make it.
- (b) "none imported `tools/` before" is wrong. Four src tests did (P8). This does not change the conclusion.

**N5. The one-line threshold `values.len() <= 8` is untested at 8.**
- The `< 8` mutant survives.
- No list reachable today has exactly 8 names: the lists have 2–5, 17 or 99. So nothing observable is wrong.
- A one-line edge case with 8 short values in `de.test.ts` would pin it.

**N6. The local `PathNS` stand-in (`types.ts:39`) is a bare type with no companion const (PORTING §5), and types.ts exports
it.**
- Its variants match `clippy_utils/src/paths.rs:25`.
- `lookup_path` → `DefId[]` and `find_crates` → `readonly DefId[]` match `Vec<DefId>` and `&'static [DefId]`.
- Both stop with `unported`, as they should.
- clippy-utils-a's brief should check that no consumer imports `PathNS` from `clippy_config/types.ts` before it is swapped for
  `clippy_utils/paths.ts`'s.

**N7. `oracle/capture.ts` leaves its `mkdtemp` scratch (`$RUST_TS_DATA/tmp/clippy-config-oracle-*`) behind.** It prints the
path, and the lane deleted its copy by hand. An `rmSync(work, { recursive: true })` at the end would remove the chore.
(I deleted the one my re-run made.)

## For root

- Integrate as is. N2, N5 and N7 can ride on a later touch of these files.
- Put N1 and the `DeTable::parse`/iteration need into vendor-toml's brief.
- Put N3's oracle tests into vendor-toml's brief (or codegen-clippy-conf's).
- Put N4a's "switch `metadata()` to `Conf.get_metadata`" into codegen-clippy-conf's brief as required, not optional.
- Put N6 into clippy-utils-a's brief.

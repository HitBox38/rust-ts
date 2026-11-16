# Review: codegen-fmt-serde (tools batch, M8 wave 41 step 2)

Reviewer: independent, read-only. Subject: branch `t3/codegen-rustfmt-serde` at `b7291521` (`git diff main...b7291521`: 21 files: the
generators `tools/codegen/rustfmt.ts`, `serde.ts`, `config_type.ts`, `create_config.ts`, `rust_tokens.ts`, `rustfmt_oracle.ts`, the
shared `types.ts` edit, `rustfmt.test.ts`, the two fixtures, and the generated `src/rustfmt/**/*.gen.ts` / `*.gen.d.ts`). Handoff:
`docs/handoff/codegen-fmt-serde.md`. Scope: `docs/plan-m8.md` D4, D5 (second bullet), D6, D7, §3, PORTING §5 and §8.

Method: two detached scratch worktrees of `b7291521` under `$RUST_TS_DATA/tmp/review-codegen-fmt-serde/` (`.env.local` copied,
`node_modules` linked). One ran the checks and the `types.ts` comparison. The other took the mutations, each reverted after its run.
Both were removed afterwards. Nothing of rustfmt, clippy or cargo was built. `upstream.ts fetch` was not run. The only oracle run was
`rustfmt_oracle.ts check` (9.2 s). The host was on AC power, load about 7.

## Verdict: PASS WITH NOTES

The generated derives and macro expansions are faithful. The oracle check is genuine for what it compares, which is the Rust renderings:
- it reproduces against a fresh oracle run;
- a change to the plan is caught;
- the TS I compared by hand matches the expansion.

The shared `types.ts` edit leaves every other set byte-identical (66 of 66 sets). `tsc`, `coverage --check` and the tests pass, and the
tests take 0.12 s.

None of the notes blocks the `rustfmt-contract` config lane. Three of them should reach the next briefs:
- **N1:** the emitted TS is checked only by the golden file and a small behaviour test, not by the oracle. For the `create_config!`
  templates, the golden file is the only check. A semantic check belongs in the config lane.
- **N2:** the wildcard `declare module` blocks apply to the whole program. They hide a missing module anywhere in `src/` whose import
  path ends in one of their 5 short names (I demonstrated this). Keep the files, but add a guard.
- **N3:** the serde surface is right in shape for serde_core 1.0.228, but it does not cover everything the vendor lane must provide.

## Checks that pass (evidence)

**P1. The oracle check reproduces.** `bun tools/codegen/rustfmt_oracle.ts check` printed `ok: … rustfmt.expanded.rs matches the oracle's
expansion` (9.2 s wall). `bun test tools/codegen/rustfmt.test.ts` gave 5 pass and 0 fail. The oracle test compares 14 + 23 + 90 + 2 = 129
blocks and requires its key set to equal the oracle's. Because the key sets must be equal, a serde derive missing from the set would
fail the test.

**P2. A change to the plan or to the Rust rendering is caught.** Each mutation below went into the generator. I then ran
`rustfmt.test.ts` and recorded which tests failed:

| Mutation | golden | oracle | behaviour / plan tests |
|---|---|---|---|
| plan: `" (unstable)"` → `" (nightly)"` in `doc_hint` (config_type.ts) | fail | **fail** | fail |
| Rust rendering: `Failed to parse override for` changed (`renderRustOverrideValue`) | pass | **fail** | pass |
| emitted file edited (`options.gen.ts`, `Cannot serialize` → `Cannot serialise`) | **fail** | pass | pass |

**P3. Hand comparison of the emitted TS with the expansion.** I read three blocks line by line against the fixture:
- `deserialize_JsonSpan` / `serialize_JsonSpan` (file_lines.gen.ts) against `Deserialize JsonSpan`: the field visitor's `visit_u64`,
  `visit_str` and `visit_bytes` arms; `visit_seq`'s `invalid_length(i, "struct JsonSpan with 2 elements")`; `visit_map`'s
  `duplicate_field` / `IgnoredAny` / `missing_field` in field order; `FIELDS`; `deserialize_struct`; and `Number(false) + 1 + 1`. All match.
- The `NewlineStyle` and `ListTactic` `#[config_type]` blocks against item_enum.rs. Display (`unimplemented!` → `panic("not
  implemented")`), `doc_hint`, `stable_variant`, FromStr with its error text built from the variants' idents, Serialize (with the
  unreachable `Cannot serialize {:?}` arm), Deserialize (`StringOnly`, then `unknown_variant(s, ALLOWED)` over the values) and
  `ListTactic_eq` all match.
- `create_config.gen.ts`'s StyleEditionDefault tables against style_edition.rs:17 and :26, and the defaults against options.rs:630–720.
  I checked `WidthHeuristics::scaled(100)`, `MacroSelectors::default()`, `ImportGranularity::Preserve`, the `Edition2024` arms of
  `StyleEditionConfig` and `VersionConfig`, and `env!("CARGO_PKG_VERSION")` → `"1.11.0"` (the oracle's own expansion).

**P4. The hand-written templates match config_type.rs line by line (brief item 2).** I checked each fixed body against the pinned macro
(config_type.rs:68–672) for logic, statement order and exact text:
- `adjust_max_width` (:466): the 8 width fields in upstream order, then `max_width`, then `set_heuristics()`. Saturation happens in
  `usize_saturating_add_signed`. That helper calls `unported` past 2^53 instead of guessing, which is correct.
- `reduce_max_width` / `increase_max_width` (:437, :452): `delta.min(isize::MAX as usize)`, negated for reduce.
- `set_width_heuristics` (:485): `max_width` is read first. The `get_width_value` closure is unchanged. The 8 calls follow upstream's
  order (fn_call, attr_fn_like, struct_lit, struct_variant, array, chain, single_line_if_else, single_line_let_else). The `eprintln!`
  text ``` `{0}` cannot have a value that exceeds `max_width`. `{0}` will be set to the same value as `max_width` ``` is correct, with
  the `\` continuation folded to one space.
- `set_heuristics` (:572): Default → `scaled`, Max → `set`, Off → `null`.
- `set_ignore` (:582): matches upstream.
- `set_merge_imports` (:586): the text matches, including `imports_granularity="Crate"`. It reads through the getter
  `self.merge_imports()`, which marks the option accessed, as upstream does, and picks Crate or Preserve.
- `set_fn_args_layout` (:602): the text matches, including upstream's ``Use `fn_params_layout`. instead``.
- `set_hide_parse_errors` (:614): the text matches. It keeps upstream's `show_parse_errors = hide_parse_errors()`.
- `set_version` (:626): the early return comes first. The first `eprintln!` (One → 2015, Two → 2024) reads `self.version.2` directly,
  not through the getter, as upstream does. The second text matches exactly, under the condition `was_set().style_edition() ||
  was_set_cli().style_edition()`.
- `fill_from_parsed_config` (:247): the per-option `is_stable_option_and_value(stringify!($i), stable, &value)` (the ConfigType and Debug
  tables are passed), then set_heuristics, set_ignore, set_merge_imports, set_fn_args_layout, set_hide_parse_errors and set_version, in
  that order. Upstream consumes `mut self`; the port mutates `this` and returns it, with a `// PORT:` comment.
- `is_default` (:652): each option's default is computed before its key test, in option order, as upstream does. The comparison is
  `self.$i.1 && self.$i.2 == default_value`, with `===` for primitives and string unions and `_eq` for the rest.
- `is_hidden_option` (:372): the 7 names, in order.
- `override_value` (:322): the arms set `.1` and `.2`. The panic text is ``Unknown config key in override: {key}``. The second match
  is the shared `__set_dependent_options` (see N5). `.expect` goes through `expect_result`, which prints `{msg}: {err:?}` as core does.
  The `stringify!` text is the spaced form, which the oracle confirmed.
- `print_docs` (:386): matches upstream.

`eprintln!` → `write_stderr(text + "\n")`, the project's synchronous stderr writer (std/io.ts:413).

**P5. clippy_config needs nothing from this batch (brief item 3).** I confirmed this from the pinned sources:
- `src/tools/clippy/clippy_config/Cargo.toml` has no `serde` dependency. Its `toml` is `default-features = false, features = ["parse",
  "preserve_order"]`.
- `grep -rn serde clippy_config/src` finds nothing.
- `de.rs:283` declares clippy's own `pub trait Deserialize`. The `impl Deserialize for $name` at `types.rs:73` sits inside a
  `macro_rules!` of `types.rs` and uses that trait.
- The fixture header records `clippy_config lib: 0 serde_derive impls`, and the test asserts 0.

**P6. The shared `types.ts` edit changes no other set's output (brief item 5).** `types.ts` has no `--check`, so I compared outputs
directly:
- For every set in `types.sets.json` (66), I saved one probe JSON. I generated from it once with the merge-base `types.ts` (`b75df78c`)
  and once with the branch's, into separate scratch dirs.
- Result: 66 of 66 sets identical (`diff -r`), 466 `.ts` files on each side, and no ERROR line in any log.
- The code agrees. Every hook is behind `opts.hooks?.`. The companion line takes the old one-line form when there are no members.
  `fileTrailer` is guarded. The `fileModule` change only adds a regex alternative for paths that used to throw.
- `bun test tools/codegen` gives 71 pass and 0 fail (7.8 s for the directory).
- No merge conflict is expected. `git merge-tree --write-tree b7291521 7178b735` (`t3/generate-clippy-macros`) and `git merge-tree
  b7291521 main` are both clean, because the clippy branch does not touch `types.ts` (it edits `lints.ts`). The handoff's warning
  about the `fileModule` line is moot.

**P7. Basics (brief item 8).**
- `bunx tsc --noEmit -p .` is clean (11 s).
- `bun scripts/coverage.ts --check` prints `markers ok`. `--missing config_type.rs` gives 26/37 (left: the hand `ConfigType` impls'
  `doc_hint`s and `is_stable_option_and_value`). `--missing style_edition.rs` gives 2/5. Both as the handoff says.
- `bun tools/codegen/rustfmt.ts --check --json tools/codegen/fixtures/rustfmt.typedefs.json` is clean.
- `rustfmt.test.ts` reads only `RUST_TS_REQUIRE_PROBES`. Through `scripts/lib/common.ts` it also reads `RUST_TS_DATA`, `RUST_TS_LANES`
  and `RUST_TS_AGENT`, all already allowed. `bun test scripts/lib/unit-steps.test.ts` gives 10 pass.
- The test file takes 0.12 s, far under the 10 s budget.

## Notes

**N1. Only the golden file and a small behaviour test check the emitted TS, not the oracle (brief item 1).**
- `renderRust` and `renderTs` are two separate templates over the same plan, and the oracle test compares only `renderRust`. The oracle
  therefore checks the plan and the parse (names, values, doc hints, stability, defaults, descriptions), not the TS templates.
- I mutated each TS template, regenerated, and recorded which tests failed. "golden only" means the error would have passed if it had
  been there when the goldens were written:

| TS-template mutation | caught by |
|---|---|
| serde: drop the `duplicate_field` check in `visit_map` | behaviour test (and golden) |
| config_type: invert `stable_variant` | behaviour test (and golden) |
| serde: `serialize_unit_variant` index `v.index + 1` (enum Serialize) | **golden only** |
| create_config: `set_merge_imports` Crate/Preserve swapped | **golden only** |
| create_config: `override_value` TS message text changed | **golden only** |
| create_config: `print_docs` `Default:` → `default:` | **golden only** |
| create_config: name padding `max - 1` → `max` in `print_docs` | **golden only** |
| create_config: `set_version` before `set_hide_parse_errors` in `fill_from_parsed_config` | **golden only** |

- I read the templates by hand (P3, P4) and found them right, so this is a gap in coverage, not a defect.
- The behaviour test cannot run `create_config.gen.ts` yet: it imports hand modules that do not exist.

Recommendations:
- (a) Add a data-enum `Serialize` case (`MacroSelector`'s shape) to the behaviour test now.
- (b) Brief the `rustfmt-contract` config lane to compare against the oracle once its hand modules land:
  - `Config::print_docs` against the pinned toolchain's `rustfmt --help=config`. That covers every default, Display and doc hint.
  - The deprecation `eprintln!` texts and the `override_value` panic against `rustfmt --config <deprecated option>=…` stderr.

**N2. The ambient contract blocks apply to the whole program (brief item 4).**
- What they get right:
  - TypeScript consults a pattern ambient module (`declare module "*/x.ts"`) only after normal resolution of a relative import has
    failed. Once a real module lands, the generated code is checked against it, not against the block.
  - A real `style_edition.ts` with a different shape gives 453 errors (first: `Type '(_: StyleEdition) => number' is not assignable to
    type '() => string'`).
  - A real `options.ts` that declares its own `namespace WidthHeuristics { export let scaled }` while the generator has not been re-run
    fails with `TS2451: Cannot redeclare block-scoped variable 'scaled'`.
  - A stale block is flagged. With a real `src/rustfmt/config/style_edition.ts` in place, `rustfmt.ts --check` prints `ERROR:
    src/rustfmt/contract.gen.d.ts is stale`, and the golden test fails. The guard the brief asks about therefore exists: `--check`
    plus the golden test in the gate's unit step.
- The masking risk: the patterns match the **specifier text** anywhere in the program. Five of them are short, non-unique names:
  `*/config_type.ts`, `*/options.ts`, `*/style_edition.ts`, `*/file_lines.ts`, `*/macro_names.ts`.
- Demonstration: I added `src/rustc_span/zz_review_probe.ts`, which imports `is_stable_option_and_value, config_type_bool` from
  `"./config_type.ts"` and a name from `"./macro_names.ts"`. Neither file exists in `rustc_span`. `bunx tsc` exited 0. Only at runtime
  did it fail (`Cannot find module './config_type.ts'`).
- So until the rustfmt hand modules land, a typo or a premature import of any module with those basenames (rustc_session has an
  `options.ts`) is no longer a type error.
- Recommendation: keep the contract files. Holding the outputs back would leave the config lane without the derives, and the stale,
  shape and duplicate cases are already loud. Add one guard:
  - either a test that fails when a file outside `src/rustfmt/` has an unresolved import matching a contract pattern;
  - or longer import specifiers in the generated code (`../config/options.ts`), so that the patterns can be `*/config/options.ts` …,
    or better `*/rustfmt/config/options.ts`.

**N3. The serde surface: correct in shape, incomplete as the vendor lane's scope (brief item 7).** I checked against the vendored
`serde_core-1.0.228` / `serde-1.0.228` in `tools-deps`.
- Correct:
  - Every module path exists: `de/mod.rs`, `de/impls.rs`, `de/ignored_any.rs`, `ser/mod.rs`, `ser/impls.rs`, and `serde/src/private/de.rs`
    (`missing_field`, at :24).
  - `impl Expected for &str` is at de/mod.rs:499.
  - The `de::Error` methods used (`invalid_length(usize, &dyn Expected)`, `unknown_variant(&str, &'static [&'static str])`,
    `duplicate_field(&'static str)`) match their pinned signatures.
  - The `Deserializer`, `Visitor`, `SeqAccess`, `MapAccess`, `Serializer` and `SerializeStruct` methods listed match the pinned
    signatures.
- Not complete for the vendor lane. The handoff's list is what the *generated code* calls; the vendor lane also needs:
  - `de::Error::missing_field`. The declared `private_de.missing_field(…, err: Error<E>)` needs it, but the declared `Error<E>`
    interface lacks it.
  - `invalid_type`, `Unexpected`, and the `Visitor` provided methods (`visit_string`/`visit_borrowed_str` → `visit_str`, and the
    `invalid_type` defaults for every other `visit_*`). The derived visitors reach these at runtime whenever a value has the wrong type,
    e.g. `width_heuristics = 5` gives "invalid type: integer `5`, expected struct WidthHeuristics". The handoff's "not reached by the
    derives" is accurate only for the derive's own code.
  - The `Expected`-from-`Visitor` adapter, since `expecting()` supplies the "expected …" text.
  - The `Deserializer`/`Serializer` methods the std impls themselves call (`deserialize_option`/`seq`/`tuple`/`bool`/`u64`,
    `serialize_some`/`none`/`seq`/`tuple`, …).
- Recommendation: put these in `vendor-serde-de`'s brief, and add `missing_field` (with `unknown_field`, `invalid_type`,
  `invalid_value`) to `SERDE_SURFACE_DECLS.de.Error` when the vendor lane lands.

**N4. A rustfmt serde derive outside this batch.**
- `src/tools/rustfmt/src/format-diff/main.rs:78` has `#[derive(Debug, Eq, PartialEq, Serialize, Deserialize)] struct Range { file:
  String, range: [u32; 2] }`, in the `rustfmt-format-diff` bin. It is serialized to JSON for `--file-lines`.
- The oracle script expands `--lib` only, so the fixture does not contain it, and the handoff's "14 serde_derive impls" counts the
  library's only.
- The generator would refuse `[u32; 2]` (no array impl in `SERDE_STD_IMPLS`). That refusal is an ERROR, not a guess.
- D5's bullet ("serde derives on config and JSON types") arguably covers it. Record it for the bins lane, or as a follow-up that adds
  the bin's expansion (`--bin rustfmt-format-diff`) and `[T; N]` impls.

**N5. The 7 `// PORT:` decisions (brief item 6).** None returns a guessed value.
- #1 (`max_width_` tuple fields, next to the getter `max_width()`) follows the `len_` precedent in `src/vendor/anstyle_parse/params.ts:5`.
- #3 (unit structs as `StyleEditionDefault` tables), #4 (FromStr as a companion member; `display_/config_type_/serialize_/deserialize_X`
  free functions; `ListTactic_eq`) and #7 (`FileLines` skipped) follow PORTING §5 "Traits" and §8.
- #6 is reasonable: `src/std` has no `io::Write`, and lanes may not edit `src/std`. Its helpers are exact: `bool::from_str` accepts only
  `true`/`false`; `ParseBoolError` Debug is a unit struct; `ParseIntError { kind: .. }`; `eq_ignore_ascii_case` is byte-wise.
  `ISIZE_MAX = 2 ** 63 - 1` evaluates to 2^63 as a double. That is harmless, since it is only `min`'d with widths below 2^53.
- #2 (one shared `__set_dependent_options` for every setter's `match stringify!($i)` and `override_value`'s second match) is a
  deduplication, which PORTING §3 forbids for ported code. It behaves identically, because `stringify!($i)` is a compile-time constant
  passed as `key`, and it is generated code. It is acceptable, but root should record it as a decision, not leave it as a lane comment.
- #5 is N2.

**N6. The fixture is linked to the oracle only by a manual run.** `rustfmt_oracle.ts check` is not a gate step: it needs `tools-deps`
and takes about 9 s, more than the unit-test budget. The unit test compares against the committed fixture. I re-ran `check` for this
review and it passed. Root should run it at integration and after any pin bump.

**N7 (minor).** `rustfmt_oracle.ts` removes only `target/` from its scratch, so `$RUST_TS_DATA/tmp/codegen-fmt-serde/` is left behind
empty. I left that directory alone, since it is the script's own default location.

## For root to record

- PORT #1–#7 as decisions, with #2 named as a deliberate deduplication of generated code (N5).
- N1(b) and N2's guard in the `rustfmt-contract` config lane's brief. N3's list in `vendor-serde-de`'s brief. N4 in the bins lane's
  brief or as a follow-up tools batch.

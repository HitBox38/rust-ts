# Handoff: feature (wave 5 porter, compiler/rustc_feature)

## Files touched
- `tools/codegen/features.ts` (new): tokenizes upstream with our `rustc_lexer` port, decodes string
  literals with the `rustc-literal-escaper` port, and expands each file's own `macro_rules!
  declare_features` (accepted / removed incl. `opt_nonzero_u32!` / unstable incl. the `impl Features`
  part) plus the `BUILTIN_ATTRIBUTES` list. Anything outside the macro patterns is an `ERROR:`.
  `--check` reports stale outputs; refuses to run unless the checkout is at the pin.
- GENERATED: `src/rustc_feature/{accepted,removed,unstable,builtin_attrs}.gen.ts`
  (214 accepted, 109 removed, 261 unstable, 199 builtin attributes; upstream order, docs and
  comments kept; names via `sym.*`).
- Hand-ported: `src/rustc_feature/lib.ts`, `accepted.ts`, `removed.ts`, `unstable.ts`, `builtin_attrs.ts`.
- Tests: `src/rustc_feature/tests.test.ts` (upstream tests.rs), `lib.test.ts` (rust-ts unit tests),
  `oracle.test.ts` (rustc oracle), `tools/codegen/features.test.ts` (generated files up to date).

## Coverage
`--missing` 0 for every file: lib.rs 6/6, unstable.rs 12/12 (`incomplete`/`internal` markers are
emitted by the generator at their macro_rules lines 155/172), builtin_attrs.rs 2/2, tests.rs 1/1,
accepted.rs/removed.rs 0/0 (macro-only). `coverage.ts --check`: markers ok (1972).
`bunx tsc --noEmit -p .` clean. `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 414 pass, 1 skip
(pre-existing linux-only `read_binary_file_handles_lying_stat`), 0 fail.
`RUST_TS_AGENT=feature difftest --suite lex --sample 100`: 100/100 MATCH.

## Oracle test (`src/rustc_feature/oracle.test.ts`, ~0.2 s)
Needs `rustc +nightly -vV` at the pinned commit; skips visibly otherwise, fails under
`RUST_TS_REQUIRE_PROBES=1`. One scratch crate enables all 584 declared features + a bogus one
(`--error-format=json`, `--emit=metadata`, `RUSTC_BOOTSTRAP` unset), and checks: only the bogus
name gets E0635; `incomplete_features` warnings exactly for the 38 `incomplete` features (and their
"see issue #N" note = table issue); `internal_features` exactly for the 34 `internal` ones (both
via the generated `Features::incomplete/internal`); a `stable_features` warning with the exact
"has been stable since <since>" text for each accepted feature (`CURRENT_RUSTC_VERSION` prints as
`1.101.0-nightly`); E0557 for each removed feature with the exact "removed in <since>[; see <pull>]"
and reason notes. A second crate puts `#[<name>]` on a fn for each BUILTIN_ATTRIBUTES entry + a
bogus one: only the bogus one gets "cannot find attribute". All pass.

## Scope differences vs the brief
At the pin, rustc_feature no longer has `AttributeGate`, `AttributeTemplate`/`template!`,
`ungated!`/`gated!`/`rustc_attr!`, `encode_cross_crate`, `is_valid_for_get_attr`,
`deprecated_attributes`, or `Stability`/`Deprecation` types. `BUILTIN_ATTRIBUTES` is a plain
`&[Symbol]` list and `AttributeStability` is the only attribute enum. `encode_cross_crate` lives in
`compiler/rustc_attr_ir/src/encode_cross_crate.rs` (not in this lane). Everything that exists in
the crate is ported.

## unported(...) left
- `debug_Features` (derive(Debug)): `enabled_features` is an `FxHashSet`; with more than one
  element the hashbrown iteration order is unported (same convention as `src/rust_ts/hash_map.ts`).

## // PORT: decisions
- `UnstableFeatures::from_environment_value`: `option_env!("CFG_DISABLE_UNSTABLE_FEATURES")` is
  unset (pinned release `1.101.0-nightly`, channel nightly; bootstrap sets it only for beta/stable).
  `std::env::var` -> `process.env`; `VarError` is `"NotPresent"` only (no `NotUnicode` in JS).
- `Option<NonZero<u32>>` -> `number | undefined`. `to_nonzero` is a hoisted function declaration so
  the generated tables (which import it from lib.ts) can call it during the import cycle.
- `Features` private fields are `enabled_lang_features_` / `enabled_lib_features_` /
  `enabled_features_`: the same-named public methods occupy those properties (Debug prints the
  Rust field names).
- Per-feature methods, `incomplete`, `internal` are installed on `Features.prototype` by
  unstable.gen.ts (`declare module` augmentation); lib.ts imports it for side effects. Import
  `Features` via `rustc_feature/lib.ts`, not `unstable.ts` alone.
- `incomplete`/`internal`: the macro's per-feature match guards are a `switch` on the symbol with
  the `status_to_enum!($status) == FeatureStatus::X` comparison folded by the generator.
- `GATED_CFGS` gate fns `Features::cfg_*` -> arrows `(f) => f.cfg_*()` (prototype methods may not
  exist yet when builtin_attrs.ts evaluates).
- `BUILTIN_ATTRIBUTE_SET` (`LazyLock<FxHashSet>`) -> accessor `BUILTIN_ATTRIBUTE_SET()`; keeps the
  duplicate-attribute panic.
- `enabled_features_iter_stable_order`: iterator -> array.
- `dump_feature_usage_metrics`: `File::create` -> `openSync(.., "w")` first (as upstream);
  `serde_json::to_writer` -> hand-built compact JSON in field declaration order (JSON.stringify
  escapes strings the way serde_json does); returns `Result<undefined, IoError>`. Timestamps are
  `Date.now()` ms * 1e6 (the nanosecond clock is not available at epoch scale).
- `Clone` derives (Features, Feature, ...) not hand-written (PORTING: codegen-only).

## For root
- Consider recording the decisions above (`state.ts record decision`).
- `tools/codegen/features.test.ts` makes the generated tables part of `bun test tools`.

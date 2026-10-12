# Handoff: session-options (wave 6, porter + codegen)

Branch `lane/session-options` (main merged up to dbd9bb9; includes session-parse 6c380fb).

## Files

| file | what |
|---|---|
| `tools/codegen/options.ts` | generator (`--check` mode); token-wise parse of options.rs macros (rustc_lexer port) |
| `tools/codegen/options.test.ts` | committed outputs == generator output |
| `src/rustc_session/options.gen.ts` | GENERATED: `top_level_options!` (`Options`, `OptionsTargetModifiers`), `mod desc`, `POLONIUS_HELP`, both `options!` (`CodegenOptions`/`CG_OPTIONS`/`cgopts`, `UnstableOptions`/`Z_OPTIONS`/`dbopts`, `*TargetModifiers`) |
| `src/rustc_session/options/mitigation_coverage.gen.ts` | GENERATED: `denied_partial_mitigations!` |
| `src/rustc_session/options.ts` | hand port of options.rs (all `parse_*`, `build_options`, `TargetModifier`, `OptionDesc`, ...) |
| `src/rustc_session/options/mitigation_coverage.ts` | hand port of mitigation_coverage.rs |
| `src/rustc_session/config.ts` | partial config.rs: only the types the option tables / `Options` name (+ their fns, Debug, Default) |
| `src/rustc_session/stand_ins.ts` | not an upstream mirror: stand-ins for unported crates/modules (see below) |
| `src/rustc_session/options.oracle.test.ts` | oracle: `-Z help`/`-C help` listings byte-exact; 142 flag/value cases (71 errors) accept/reject + exact error/help text; `desc.parse_linker_flavor`; build-time defaults |
| `src/rustc_session/options.test.ts` | target-modifier accumulation, mitigation resets, reparse |

Not touched: `lib.ts` (session-parse). Its `Session` stand-in (`opts.unstable_opts.ui_testing: boolean`)
is structurally satisfied by the generated `Options` (`unstable_opts: UnstableOptions`, `ui_testing: boolean`).
Follow-up for lib.ts' owner: replace `// mod options;` / `// #[macro_use] pub mod config;` comments with
the real exports (`export * from "./options.ts"`; config.ts) and import `./options/mitigation_coverage.ts`
for its side effects (it attaches `Options.prototype.{all_denied_partial_mitigations, allowed_partial_mitigations}`).

## Coverage

- `compiler/rustc_session/src/options.rs`: **100/100** (`--missing` reports 0)
- `compiler/rustc_session/src/options/mitigation_coverage.rs`: **13/13**
- `compiler/rustc_session/src/config.rs`: 31/136 (only the option-value types)
- `bun scripts/coverage.ts --check`: markers ok. `bunx tsc --noEmit -p .`: clean.
  `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: all pass after merging main dbd9bb9 (3 skips pre-existing), 0 fail.
- No difftest suite exercises option parsing yet (the driver lane wires it in).

## Generator notes

- Expands per the file's own `macro_rules!`; checked shapes: `setter_for!` (special arms
  `allow_partial_mitigations`/`deny_partial_mitigations` must call
  `collected.mitigations.handle_allowdeny_mitigation_option(v, index, <bool>)`; generic arm must be
  `super::parse::$parse(&mut redirect_field!(cg.$opt), v)`), `redirect_field!` (`link_arg -> link_args`,
  `pre_link_arg -> pre_link_args`), `KINDS` concat shape, `LinkerFlavorCli::one_of()` concat shape.
  Anything else is an ERROR.
- Default expressions are all translated mechanically (no hand-written helpers, no `unported`):
  literals, `None`/`Some`, `String::new()`, `"..".to_string()`, `String::from`, `Vec::new()`, `vec![]`,
  `A::B`, `A::B(..)` (variant), `A::f(..)` (associated fn). Unknown Rust types -> ERROR (type table `NAMED`).
- `desc.parse_linker_flavor` is computed from `linker_flavor_cli_impls!` in rustc_target/src/spec/mod.rs
  (oracle-checked); `desc.parse_{allow,deny}_partial_mitigations` = `DeniedPartialMitigationKind.KINDS`.
- `dep_tracking_hash` (Options, CodegenOptions, UnstableOptions): marker + `unported` (incremental out of scope).

## `unported(...)` left

- options.rs `target_modifier_consistency_check::{sanitizer, sanitizer_cfi_normalize_integers,
  sanitizer_cfi_minimal_runtime, target_cpu}` (need `Session::target`, `sanitizers()`).
- `{Options,CodegenOptions,UnstableOptions}::dep_tracking_hash`.
- mitigation_coverage `Session::gather_enabled_denied_partial_mitigations` (Session exprs).
- config.rs `LinkSelfContained::check_unstable_variants`, `LinkerFeaturesCli::check_unstable_variants`
  (TargetTuple), Debug of `LinkSelfContained`/`LinkerFeaturesCli`/`SanitizerSet` (external_bitflags_debug!).
- stand-ins: `from_str` of every rustc_target `target_spec_enum!` type (CodeModel, FramePointer,
  MergeFunctions, PanicStrategy, RelocModel, RelroLevel, SplitDebuginfo, StackProtector,
  SymbolVisibility, TlsModel), `LinkerFlavorCli::from_str`, `LinkSelfContainedComponents::from_str`,
  `FramePointer::ratchet`, `Align::from_bytes`.
  => these flags reach `unported` when given a value: `-C code-model/relocation-model/relro-level/
  split-debuginfo/tls-model/linker-flavor/force-frame-pointers`, `-C link-self-contained=+x/-x`,
  `-Z stack-protector/merge-functions/default-visibility/min-function-alignment`, and `reparse` of
  `-Z sanitizer` (Debug). All other options parse fully.

## `// PORT:` decisions (root: please record)

1. `option_env!` build-time defaults, oracle-confirmed: `CFG_DEFAULT_POLONIUS_NEXT` set (`-Z help`
   says "(default: next)"), `CFG_DEFAULT_NEXT_SOLVER_GLOBALLY` set (default type-checks
   tests/ui/type-alias-impl-trait/type_of_a_let.rs exactly like `-Znext-solver=globally`). Both are
   asserted by options.oracle.test.ts.
2. Module evaluation order: options.gen.ts imports parse fns from options.ts; options.ts imports and
   re-exports the gen file and attaches `CodegenOptions.prototype.instrument_coverage_`. Consumers must
   import **options.ts**, never options.gen.ts. config.ts does **not** mirror `pub use crate::options::*`
   (the gen file reads `Polonius.DEFAULT` from config.ts at load time).
3. `OptionDesc` is a data interface + companion (`OptionDesc.name(d)`, `OptionDesc.desc(d)`) instead
   of a class, so the generated tables are object literals evaluated before options.ts finishes loading.
4. In the generated module, the setter module (`cgopts`/`dbopts`) is emitted before its table
   (upstream: after) because the table refers to the setters at load time.
5. `mod parse` flattened into options.ts exports; `&mut` slots are `MutRef<T>`; the generated setters
   copy the field into a `{ value }` slot and back. `parse_number`/`parse_opt_number` take the `FromStr`
   of `T` explicitly (`usize_from_str`, `u32_from_str`, `u64_from_str`, `u8_from_str`).
6. Integers: `u64` option values are `bigint` (exact); `usize` values are `number` (all u64 strings are
   accepted like upstream, values > 2^53 round). Rust `uN::from_str` reimplemented (`IntErrorKind`
   incl. `Zero` for `NonZero<usize>`).
7. `OptionsTargetModifiers` values are interned (frozen singleton per value): used as `Map` keys for the
   `BTreeMap<OptionsTargetModifiers, String>`; ordered readers sort with `OptionsTargetModifiers_cmp`.
8. Name clashes with fields: `CodegenOptions::instrument_coverage()` -> `instrument_coverage_()`,
   `PatchableFunctionEntry` private fields `prefix_/entry_/section_` (accessors keep their names).
9. `Option<()>` returns (`handle_cli_component`, `handle_cli_feature`) -> `null` (Some) / `undefined` (None).
10. `str::to_lowercase` -> `toLowerCase` (parse_llvm_module_flag); `sort_unstable` of strings uses a
    code-point comparator (`str_cmp`).
11. mitigation_coverage: the `impl Options` / `impl Session` fns of the macro are free fns in the gen
    file (markers there); mitigation_coverage.ts attaches `Options.prototype.all_denied_partial_mitigations`.

## Stand-ins (`src/rustc_session/stand_ins.ts`) and what the driver lane needs next

- rustc_target: the enums above (variants copied), `LinkSelfContainedComponents`/`LinkerFeatures`
  (bitflag values copied), `TargetTuple` (opaque). rustc_structures: `SanitizerSet` (values copied),
  `CollapseMacroDebuginfo`, `CrateType` (opaque). rustc_abi `Align` (opaque).
  rustc_data_structures `TimePassesFormat`.
- `EarlyDiagCtxt` (session.rs) and `getopts::Matches` are structural interfaces with just what
  `build_options` uses (`early_warn`, `early_fatal`, `early_struct_fatal`; `opt_strs_pos`).
- `Options` field types still opaque: `OutputTypes`, `SearchPath`, `Sysroot`, `PrintRequest`, `Externs`,
  `PpMode`, `Jobs`, `CrateType`, `TargetTuple`.
- Next for the driver lane (config.rs, not ported here): `impl Default for Options` (config.rs:1482),
  `rustc_optgroups`/getopts, `build_session_options`, `parse_error_format` + `ErrorOutputType`
  handling (`--error-format`, `--json`), `parse_crate_edition` (`--edition`), `parse_color`,
  `PpMode`/`parse_pretty` (`-Zunpretty=ast-tree`), `nightly_options`, `Jobs`/`-Zthreads` parsing,
  `OutFileName`/`OutputTypes`, `check_*` CLI validations (e.g. "`-Cpanic=immediate-abort` requires
  `-Zunstable-options`"), plus session.rs `EarlyDiagCtxt` and a vendored `getopts`.

## Overlaps

- `src/rustc_session/config.ts` was created here (mirrors config.rs; ownership said `config/*`).
  `config/cfg.rs` untouched.
- No edits to `tools/codegen/types.sets.json` (config.rs cannot go through the typedefs probe: syn fails
  on default field values at config.rs:863, so the config types are hand-written with their Debug).

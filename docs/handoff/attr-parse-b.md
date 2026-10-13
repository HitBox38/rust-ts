# Handoff: attr-parse-b (wave 8, M2)

Branch `lane/attr-parse-b`, branched from `lane/attr-parse-a` (not merged into main). Lanes attr-parse-c/d can
`git merge lane/attr-parse-b` to get the diagnostics and the trait helpers.

## Files touched
- **Ported (all fns in upstream order, with markers):** `src/rustc_attr_parsing/`
  - `diagnostics.ts` (hand fns) + **`diagnostics.gen.ts`** (generated: 171 types, 167 derives)
  - `attributes/mod.ts`, `attributes/util.ts`, `attributes/cfg.ts`, `attributes/cfg_select.ts`,
    `attributes/crate_level.ts`, `attributes/macro_attrs.ts`, `attributes/proc_macro_attrs.ts`
  - `check_cfg.ts` (new), `target_checking.ts`
- **Outside the assignment (needed; please review):**
  - `lib.ts`, `stability.ts` (attr-parse-a): the extension-module install pattern below.
  - `attr_oracle.test.ts`, `attr_oracle/list_gen.rs`, `list_cases.txt`, `list_out.json` (attr-parse-a's
    tests): PENDING lists; the list harness now gets its `Session` from `run_compiler`, like the
    probe; a new `full:M` op; 4 new cases. The 11 old cases' oracle output is byte-identical after the
    regeneration.
- **New tests:** `cfg_oracle.test.ts` with `attr_oracle/{cfg_gen.rs, cfg_cases.txt, cfg_out.json}`.
- **tools/codegen:**
  - `types.sets.json`: new set `rustc_attr_parsing`
  - `typemap.attr_parsing.json` (new): DiagArgValue, `DiagSymbolList<S>`, AttributeTemplate, Suggestion,
    MirDialect, MirPhase
  - `diag_args.json`: DiagArgValue, `DiagSymbolList` (`$display0`), and Display for `bool`
  - `types.ts`:
    - `default_args` for typemap and diag_args entries
    - `$display0`: the Display fn of the first type argument
    - **inline modules become `export namespace <mod> { .. }`**, with references qualified.
      Before, they were flattened, and `unexpected_cfg_name::CodeSuggestion` and
      `unexpected_cfg_value::CodeSuggestion` collided.
  - `diag-expand.ts`: impls with the same name are matched in source order.
  - `diagnostics.test.ts`: covers the new set and its byte-for-byte regeneration.
  - `fixtures/rustc_attr_parsing.typedefs.json` (new), `fixtures/diag-expansion.json` (regenerated: 3 files)
  - Regenerating all 13 sets changes no other generated file (checked).

## Coverage (`bun scripts/coverage.ts --missing`)
| file | fns ported |
|---|---|
| attributes/mod.rs | 17/17 |
| attributes/util.rs | 4/4 |
| attributes/cfg.rs | 12/12 |
| attributes/cfg_select.rs | 5/5 |
| attributes/crate_level.rs | 10/10 |
| attributes/macro_attrs.rs | 6/6 |
| attributes/proc_macro_attrs.rs | 3/3 |
| check_cfg.rs | 9/9 |
| target_checking.rs | 12/12 |
| diagnostics.rs | 12/12 hand fns; derives generated |

`--check`: markers ok (4540).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=120000 src tools`: 2283 pass, 0 fail, 1 skip.
  - The skip is the pre-existing `read_binary_file_handles_lying_stat`, which runs only on Linux. It is not in this lane.
- `RUST_TS_AGENT=attr-parse-b bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run `20261013-083726-attr-parse-b-xo8r`).
- **Diagnostic derives:** `bun tools/codegen/diag-expand.ts rustc_attr_parsing` finds all 167 impls identical to the real `rustc_macros` expansion.
- **`cfg_oracle.test.ts`: 13/13 cases match byte for byte** against the rustc-dev probe `cfg_gen.rs`. Each case uses a real `Session` with its own `--cfg` / `--check-cfg`.
  - Covered: `parse_cfg` and `eval_config_entry` (all/any/not/bool/name-value), target cfgs, malformed input, gated cfgs (`version`, `target(..)`, `target_has_atomic`, `sanitize`), `parse_cfg_attr` (well-formed and malformed), and `parse_cfg_select` with `pop_first_match`, including the unreachable-predicate lints.
  - All `unexpected_cfgs` name and value lints are rendered: similar name, similar value, boolean literal, `version`, change name, remove value or condition, specify value, `values(any())`, escapes and raw idents.
  - **Negative control:** perturbing 3 expectations fails 3 cases.
- **attr_oracle:** the 15 diagnostics-dependent PENDING cases now match.
  - Still PENDING: `check_builtin` and all 14 list cases (10 old, 4 new). They wait on the `ATTRIBUTE_PARSERS` registry, whose first unported entry is `Combine(AllowInternalUnstableParser)` (attr-parse-d): `PARSERS_PENDING = ...allow_unstable::AllowInternalUnstableParser::PATH`.
  - **My 4 list cases** (`crate_level`, `macro_attrs` with `full:emit`, `proc_macro_attrs`, `cfg_attrs`) match the oracle: events, buffered lints and stderr. I checked this locally with the c/d stub tables made inert; that change was not committed.

## `unported(...)` left
- `check_cfg.ts`: `core::str::escape_debug (non-ASCII escaped continuation char)`.
  - `str::escape_debug` does not escape grapheme-extended chars after the first one, and no grapheme-extend table is ported. It is reached only when a cfg value has such a char after its first char.
- `attributes/mod.ts`: `unported_impl` stays, because the c/d stub modules still use it. Delete it once they land.

## PORT decisions (please record)
1. **Extension modules that parser modules import must install from lib.ts.**
   - The cycle: context.ts imports every `attributes/*` module, so they run while context.ts is still evaluating (interface.ts → parser.ts → context.ts → attributes/* → here). An extension module whose top level assigns `AttributeParser.prototype.x` / `AcceptContext.prototype.x` therefore throws a TDZ `ReferenceError` once a parser module imports it.
   - So `target_checking.ts`, `attributes/util.ts` and `stability.ts` (the last needed for `unstable`) define their impl fns as module functions and export `install()`. `lib.ts` calls the three installs at the end of its body.
   - **c/d:** any extension module of yours that parser modules import needs the same treatment.
2. **Parser trait tables** come from `AttributeParser_provided` / `SingleAttributeParser_provided` / `NoArgsAttributeParser_provided` / `CombineAttributeParser_provided` in `attributes/mod.ts`.
   - Each helper holds the provided consts and fns, with markers; `...impl` overrides them.
   - `Single(T)` / `Combine(T)` / `WithoutArgs(T)` return tables. The state objects are `Single { _1 }` and `Combine<Item> { items, first_span }`.
   - `WithoutArgs<T>` carries no data; `WithoutArgs_default()` holds its `Default` marker.
   - `OnDuplicate.exec(self, P, cx, used, unused)` takes the `P: SingleAttributeParser` table.
3. **`Policy::{Allow, Error, Warn}`** (prelude) are constructors on the companion `Policy` (`Policy.Allow(Target.Fn)`). They are not module-level `Allow`/`Error` functions, which would shadow the JS `Error`. Parsers write `const { Allow, Error: Error_ } = Policy;`.
   - `AllowedTargets` values are object literals, e.g. `{ $: "AllowList", _0: [Allow(Target.Crate)] }`.
4. **`Target_eq` / `Policy_eq` are local to target_checking.ts.** rustc_attr_ir generates no `PartialEq` for `Target`. Root: move `Target_eq` next to `Target` in rustc_attr_ir.
5. **`FxIndexSet<Ident>` (RegisterToolParser)** is a `Map` keyed by `name,ctxt`, following `Ident`'s Hash/Eq. `IndexSet::replace` keeps the insertion position.
6. **`#[allow(rustc::potential_query_instability)]` iterations** over `check_config.expecteds` and `well_known_names` follow JS insertion order (check_cfg.ts).
   - Upstream sorts every list it displays. The order matters only for ties in `find_best_match_for_name`, and no case hit a tie.
   - `names_possibilities.sort()` compares Symbol indices (`Ord for Symbol`).
7. **String helpers.**
   - `str::parse::<u16>` (parse_version) is `u32_from_str` with a range check. `usize` uses `usize_from_str`. Both come from rustc_session/options.ts, as does `str_cmp`.
   - `str::trim_end` / `str::find(pred)` are local helpers over `Str` that use `char::is_whitespace`.
8. **Defaults and `IntErrorKind`.**
   - `AttributeTemplate::default()` (cfg_select) is constructed inline: `new AttributeTemplate(false, undefined, [], undefined, undefined)`. template.ts has no `default`.
   - `IntErrorKind` is the string union from rustc_session/options.ts.
9. **`MACRO_USE_TEMPLATE` / `MACRO_USE_ALLOWED_TARGETS` move to the top of macro_attrs.ts.** `MacroEscapeParser` reads them at module init (TDZ).
10. **Generated inline modules are TS namespaces:** `diagnostics.unexpected_cfg_name.CodeSuggestion`, `...unexpected_cfg_value.CargoHelp.DefineFeatures`.
11. **`DiagSymbolList<S>`'s IntoDiagArg** is `DiagSymbolList_into_diag_arg_with(display_S)` (diagnostics.ts), bound by diag_args `$display0`.

## For root
- Record decisions 1–11.
- **Integration order:** once c and d land, every `PARSERS_PENDING` entry (`check_builtin` + 14 list cases) must match. Drop them from PENDING and LIST_PENDING, and delete `unported_impl` from `attributes/mod.ts`.
- `docs/claims/` has no file for this lane.

# Handoff: bm-format (wave 9, M2: format_args!)

Branch `lane/bm-format` (from main d2db7fd). No merges, no files outside the lane's scope touched.

## Files
- **Ported** (`src/rustc_builtin_macros/`), every fn in upstream order with markers:
  - `format.ts`: replaces bm-a's stub. It keeps the export names lib.ts uses (`expand_format_args`, `expand_format_args_nl`).
  - `format_foreign.ts`: `StrCursor` and `str_eq_literal`. It re-exports `printf` / `shell` as namespaces (`mod printf; mod shell;`).
  - `format_foreign/printf/mod.ts`, `format_foreign/shell/mod.ts`.
  - `format_foreign/printf/tests.test.ts`, `format_foreign/shell/tests.test.ts`: upstream `tests.rs`, all 8 tests.
- **Oracle test:** `format.test.ts` + `format_oracle/{gen.rs,run.ts,cases.txt,out.stdout,out.stderr}`.
- Nothing outside `src/rustc_builtin_macros/` changed (lib.ts unchanged).

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_builtin_macros/src/<f>`)
| file | fns |
|---|---|
| format.rs | 9/9 |
| format_foreign.rs | 11/11 |
| format_foreign/printf/mod.rs | 13/13 |
| format_foreign/shell/mod.rs | 11/11 |
| format_foreign/printf/tests.rs | 4/4 |
| format_foreign/shell/tests.rs | 4/4 |

`bun scripts/coverage.ts --check`: markers ok (5833; vendor 2403).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 2735 pass, 1 skip (the pre-existing linux-only one), 0 fail.
- `RUST_TS_AGENT=bm-format bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (`20261013-095118-bm-format-f0zv`).
- `RUST_TS_AGENT=bm-format bun scripts/difftest.ts --suite expanded-nocore --sample 200`: 6 MATCH, 194 UNPORTED, 0 DIFF
  (`20261013-095138-bm-format-2lb8`). All 194 stop at `rustc_session::output::validate_crate_name`, before expansion,
  so format_args! is not reached through the driver yet.

## Oracle test: `format.test.ts`
- **Probe.** `format_oracle/gen.rs` is a rustc-dev probe built on bm-a's builtins probe design. Its header has the
  regeneration commands.
  - It runs `register_builtin_macros`, then for each case it calls the registered `LegacyBang` expander
    (`format_args!` / `format_args_nl!`) on a real `Session`, with a fresh `ExpnData::default(Macro(Bang, name))` expansion.
  - It prints `{:#?}` of `make_expr()`, i.e. the full `ExprKind::FormatArgs` AST: template, placeholders, spans,
    `FormatArguments` incl. captured args, `uncooked_fmt_str`, `is_source_literal`.
  - Then it prints every buffered early lint (span, node id, lint name) and emits the lint's `DecorateDiagCompat`
    closure as a warning at the lint span. This exercises the NAMED_ARGUMENTS_USED_POSITIONALLY closure, including
    its `Session` downcast and snippet logic.
  - Diagnostics go to stderr.
- **Mock resolver** (same on both sides):
  - `resolve_dollar_crates` is a no-op, `macro_accessible` returns `Ok(true)`, `take_derive_resolutions` returns `None`.
  - `resolve_macro_invocation` returns the registered builtin of the last path segment as `SyntaxExtension::default`,
    after `set_expn_data(ext.expn_data(..))`. This lets `format_args!(concat!(..))` run the real non-monotonic
    `fully_expand_fragment` (expand-core).
  - Everything else is `unimplemented!()`.
- **Cases (102)** cover:
  - Args: positional, numbered, named, named-by-index, implicit captures (2015 and 2021), trailing comma.
  - Width and precision: literal, `name$`, captured `name$`, `N$`, `.*`.
  - Fill and alignment (incl. a unicode fill), every format trait incl. `{:#?}`/`{:x?}`/`{:X?}`, `{{`/`}}`.
  - `format_args_nl!`, raw strings, escapes and multibyte text, a multiline template.
  - Unused arguments: one, many, named, no specifiers (cooked / raw / nl).
  - Invalid references: implicit mismatch, `{}` with none, numbered, `.*` (incl. the precision-star label),
    whitespace-only `{\n}` note, width `1$`, dedup `{7:7$}`, the formatting-flags note.
  - Every `parse::Suggestion` kind of an invalid format string: positional, raw ident, reorder, missing colon,
    `dbg!` with and without index; plus python grouping, width overflow, raw-string errors, secondary labels.
  - Unknown trait (cooked and raw).
  - printf detection: translations, `%%`, every untranslatable error note, dedup of explained subs, raw,
    "few unused" (no foreign check).
  - Shell detection.
  - Redundant arguments: one, two, middle, with named args (no suggestion).
  - Parse errors: duplicate named arg, positional after named, empty, non-literal format strings (all three
    suggestions: quote `{x}`, missing string literal, enclose `{}`), byte string, int literal, missing comma,
    `.`/`;` typo commas, operator after the literal, `x = ` without expr.
  - Eager expansion through `concat!`: not a source literal, captures rejected with FormatNoArgNamed, error spans
    on the whole argument, unused.
  - NAMED_ARGUMENTS_USED_POSITIONALLY: placeholder, width, precision, `.*`, `{0:}` (shrink-to-lo suggestion), 2018.
- **Result: 96 cases match byte for byte** (stdout 8,944 lines, stderr 922).
- **6 cases are PENDING** (listed in `format.test.ts`): `named`, `captured`, `width_named`, `width_captured`,
  `redundant_two`, `redundant_named`.
  - Expansion and stderr match for all of them.
  - The AST dump does not, because `FormatArguments::names` is an `FxHashMap`. With two or more names its Debug
    follows hashbrown bucket order, and `src/rust_ts/hash_map.ts` `debug_HashMap` is `unported` for that. The
    oracle prints `{"y": 1, "x": 0}` for `x, y`.
  - The test requires exactly that `UNPORTED` line on stdout plus the oracle's stderr.
  - Single-name variants (`named_one`, `captured_one`, `width_named_one`, `width_captured_one`, `redundant_dup`)
    cover the same paths and match.
- **Negative control:** changing the cooked-string foreign `padding` from 1 to 2 fails exactly the 7 cooked
  printf/shell cases.
- `format_foreign` upstream unit tests (printf 4, shell 4) pass. `assert_eq!` compares the derived Debug.

## `unported(...)` left
- None in the ported files.
- Reached from outside the lane: `std::collections::HashMap Debug iteration order` (`src/rust_ts/hash_map.ts`) when
  printing a `FormatArgs` with two or more argument names, e.g. `-Zunpretty=ast-tree,expanded` on
  `format!("{a}{b}")`.
  - Root: this needs hashbrown + FxHasher iteration order (`FxHashMap<Symbol, usize>`, hash of the `Symbol`
    index). Note that hashbrown's group width depends on the target (SSE2 16 vs generic/NEON 8), so the oracle host
    matters.
  - Then drop the 6 PENDING entries.

## `// PORT:` decisions
1. **Str and string.** The format string (`fmt_str`) and snippets are `Str` (byte offsets for rustc_parse_format and
   the foreign detectors). The `&str` slices stored by format_foreign (`Format.span/flags/length/type_`,
   `shell::Substitution::Name`) are converted to `string` where produced, as in rustc_parse_format. The tail
   returned by `parse_next_substitution` stays a `Str`.
2. **`StrCursor` is `Copy`.** `by-value self` methods work on `clone()`. `str_eq_literal`'s pointer equality is
   "same backing buffer, same start, same length".
3. **printf `move_to!` and `fallback`.** `macro_rules! move_to` is a closure returning `false` where the macro's `?`
   returns `None`. The `move ||` `fallback` closure captures clones of `start`/`at`/`next` at its definition, as
   upstream.
4. **`Num::translate(&mut String) -> fmt::Result`** takes a `MutRef<string>` and returns
   `Result<undefined, undefined>`. `String::with_capacity` is dropped (it has no observable effect).
5. **`<u16 as FromStr>`** is a local `parse_u16` helper: optional `+`, digits, overflow is an error.
6. **`Substitutions` iterators** get `[Symbol.iterator]` for the `for sub in iter_subs(..)` loops.
7. **Enum methods** live on the companion consts (`Substitution.translate(s)`, `Num.from_str`). The derived Debug
   impls are hand-written `debug_Substitution` / `debug_Format` / `debug_Num`.
8. **`macro_rules! check_foreign`** (format.rs) is a generic closure taking the module's `iter_subs` and
   `Substitution` table plus the `stringify!`'d name.
9. **`*f != FormatOptions::default()`** is a local `format_options_is_default` (derived `PartialEq` + `Default`:
   every field `None`/`false`).
10. **Fn-local types.** `PositionUsedAs` and the fn-local `ArgRef` are local tagged unions.
11. **`sess.downcast_ref::<Session>().expect(..)`** is `sess instanceof Session ? sess : panic(..)`.
12. **`fmt_str.strip_suffix('\n').unwrap_or(fmt_str)`** is written out on the `Str`. `indexes.sort(); dedup()` is a
    numeric sort plus an adjacent-duplicate filter. `sugg_fmt.trim_end()` is `trimEnd()` (ASCII-only content).
13. **if-let chains** with an `else` (the `{x}` quote suggestion) are nested `if`s plus a flag, so the `else` branch
    runs exactly when the chain fails.

## For root
1. Delete `docs/claims/wave9-bm-format.md` on integration.
2. Record the decision on the format oracle test design: bm-a's builtin-probe design, with a mock
   `resolve_macro_invocation` that serves the registered builtins so that eager expansion runs. bm-a's
   PENDING cases that only needed `fully_expand_fragment` (concat!, env!, option_env!, compile_error!) could use the
   same mock now.
3. hashbrown iteration order for `debug_HashMap` (above) is needed for any `FormatArgs` with two or more names in
   `-Zunpretty=ast-tree,expanded`.

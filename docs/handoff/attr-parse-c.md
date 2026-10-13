# Handoff: attr-parse-c (wave 8, M2)

Branch `lane/attr-parse-c`. It branched from `lane/attr-parse-a` and merged `lane/attr-parse-b` twice: once at `e719990..706d7b5`, once at `fce4e2c`, which added the extension installs.

## Files touched
- **Ported, with markers**, all in `src/rustc_attr_parsing/attributes/`. These replace the stubs and keep their export names:
  - `codegen_attrs.ts`
  - `link_attrs.ts`
  - `doc.ts`
  - `repr.ts`
  - `inline.ts`
  - `instruction_set.ts`
  - `deprecation.ts`
  - `stability.ts`
- **Tests:**
  - `src/rustc_attr_parsing/attr_oracle_c.test.ts` (new)
  - `attr_oracle/c_list_cases.txt` and `attr_oracle/c_list_out.json` (new; 48 cases)
- **`attr_oracle/list_gen.rs`:** taken verbatim from `lane/attr-parse-d`. It is byte-identical to d's copy, so it merges cleanly. It adds feature lists (`limited:M+f1,f2`) and the `lints` op. The existing `list_out.json` is unchanged.

## Coverage (`bun scripts/coverage.ts --missing`)
All files are fully covered:

| file | fns |
|---|---|
| codegen_attrs.rs | 15/15 |
| link_attrs.rs | 14/14 |
| doc.rs | 19/19 |
| repr.rs | 8/8 |
| inline.rs | 4/4 |
| instruction_set.rs | 1/1 |
| deprecation.rs | 3/3 |
| stability.rs | 9/9 |

`coverage --check`: markers ok (4613).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=120000 src tools`: 2315 pass, 1 skip, 0 fail.
- `RUST_TS_AGENT=attr-parse-c bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run `20261013-083502-attr-parse-c-99fo`).

## Oracle tests (`attr_oracle_c.test.ts`)
- **Coverage.** 48 `parse_limited_all` scenarios cover:
  - inline, force_inline (with its conflict check), cold, optimize, coverage
  - export_name, no_mangle, link_section, track_caller
  - target_feature and force_target_feature, used, sanitize, instrument_fn, patchable_function_entry, the no-arg attributes, objc
  - `#[link]` in every form (modifiers, kinds, wasm, import_name_type, cfg, `= "dl"`), link_name, link_ordinal, linkage, ffi
  - instruction_set, repr in every form plus align/packed, rustc_align
  - deprecated in every form, with and without `staged_api`
  - stable/unstable, rustc_const_*, rustc_promotable, default_body_unstable, allowed_through_unstable_modules, unstable_removed
  - doc: alias, hidden, inline, include, spotlight, passes, test, crate-level forms, gated forms, `auto_cfg`, cfg
  - finalize checks against lang items, naked, and `unstable_feature_bound`
  - every buffered lint, rendered with `lints`
- **Real session.** The runner gets a real `Session` from the ported `rustc_interface::run_compiler`, using the probe's `Config`. These parsers read `sess.target` and `sess.opts`. The cases avoid output that depends on the host target.
- **On this branch** every case is PENDING on attr-parse-d's first stub, `AllowInternalUnstableParser::PATH`, because this lane may not merge d.
- **On a local c + b + d merge** (scratch worktree, since deleted), 45/48 match byte for byte. The 3 cases in `AFTER_D` stay pending:
  - `c_repr_align` and `c_rustc_align` reach the Align stand-in (below).
  - `c_doc_auto_cfg_multi` reaches the hashbrown-order `unported` (below).
- **Negative control:** perturbing 3 expectations fails 3 cases.
- **Root, on integrating d:**
  - In `attr_oracle_c.test.ts`, set `PENDING = AFTER_D`.
  - In `attr_oracle.test.ts`, every `PENDING` / `LIST_PENDING` entry matched on c + b + d with the lists emptied, except `parsed_basic`. Keep `parsed_basic` as `rustc_abi::Align Debug (stand-in, rustc_abi not ported)` and delete the rest.

## `unported(...)` left
1. **`rustc_abi::ExternAbi::from_str (LinkParser::finalize_check)`.** `extern_abi.rs` is not ported.
   - An extern block without an ABI string uses `ExternAbi::FALLBACK = C { unwind: false }`, which is not `Rust`, so no lint. This path is ported.
   - Any `extern "..." {}` carrying `#[link]` reaches `unported`.
   - With `parse_limited_all` both rustc and rust-ts panic first, because there is no `target_item` (case `c_link_foreign_mod`, fatal on both sides).
2. **`std::collections::HashSet iteration order (hashbrown + FxHasher): doc(auto_cfg(hide/show(..)))`** in `doc.ts` `parse_auto_cfg`. It is reached only with more than one cfg name. This follows the `rust_ts/hash_map.ts` precedent.
3. **Not mine, but my parsers reach it:** `rustc_attr_ir` still types `Align` as the opaque stand-in in `rustc_attr_ir/standins.ts`, whose Debug is `unported`. `rustc_abi::Align` is ported now.
   - **Root:** repoint `tools/codegen/typemap.attr_ir.json` at `rustc_abi` and regenerate. Then drop `ir_align` in `repr.ts` and the Align PENDING entries.

## PORT decisions (please record)
1. **Parser tables.** They follow b's `<Trait>_provided(impl)` convention.
   - `#[derive(Default)]` states are interfaces with the same name as their table.
   - Inherent `impl X { .. }` blocks become a `X_inherent` object (methods take the state first) spread into the table. This matches d's `on_unimplemented.ts` pattern. It applies to `DocParser`, `StabilityParser`, `ConstStabilityParser`, `RustcAlignParser` and `RustcAlignStaticParser`.
   - `LinkParser`'s associated fns (no `self`) are table members after the `CombineAttributeParser` items, in upstream order, and are typed by `LinkParserInherent`.
2. **Imports.** Prelude items are imported from their defining modules; `prelude.ts` belongs to lane d, which is not merged here. `Policy::{Allow, Warn, Error, AllowSilent}` are written as variant literals.
   - **Root:** this can switch to `./prelude.ts` after the merge if wanted.
3. **`&mut Option<_>` places** chosen at run time are `MutRef` / `field_mut` views:
   - `UsedParser`'s `target`
   - `attrib_to_write`
   - `NativeLibKind` modifier fields
   - `insert_value_into_option_or_error`
   - `simplify_cfg(&mut CfgEntry)`
4. **`Size::signed_int_max`** is not ported in `rustc_abi`. `repr.ts` computes `i128::MAX >> (128 - bits)` locally (`signed_int_max`).
   - **Root:** move it to `rustc_abi` `Size`.
5. **`SanitizerSet::iter().next()`** is `bitflags_iter_first`: `IterNames`, then the remaining bits. bitflags `Iter` is not ported.
6. **Macros.**
   - `doc.rs`'s `no_args!` / `string_arg_and_crate_level!` / `gated!` are local closures; every use is the tail of a match arm.
   - `report_unstable_modifier!` is expanded at its single use.
   - Match guards (`include if let ..`) are if-chains.
7. **Number conversions.**
   - `u128 -> u8 / u16` `try_into` is a `bigint` range check.
   - `NonZero<u32>::from_str` is `u32_from_str` from `rustc_session/options.ts`, plus `Zero` for 0.
8. **Panics.** `unreachable!("…")` messages keep rustc's `internal error: entered unreachable code: ` prefix.

## For root
1. Integrate after b and d. Then apply the PENDING changes above, and the Align typemap regeneration.
2. Record decisions 1, 4 and 5.

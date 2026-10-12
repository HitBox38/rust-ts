# Handoff: pprust-state (wave 6): rustc_ast_pretty `pprust/state.rs` + `pprust/state/fixup.rs`

Branch `lane/pprust-state`. Merged `main` at 6c380fb (includes lane pp, bd33a72), no conflicts.

## Evidence
- **Coverage** (`bun scripts/coverage.ts --missing`): `pprust/state.rs` 131/131, `pprust/state/fixup.rs` 10/10.
- **`coverage.ts --check`**: `markers ok (2472; vendor 2048)`.
- **Typecheck**: `bunx tsc --noEmit -p .` clean.
- **Unit tests**: `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 528 pass, 3 skip, 0 fail.
- **Difftest sample**: `RUST_TS_AGENT=pprust-state bun scripts/difftest.ts --suite lex --sample 200`: 200/200 MATCH (run `20261012-220147-pprust-state-cmii`).
- **Entry modules**: `state.ts`, `state/fixup.ts` and `rustc_ast_pretty/lib.ts` each load cleanly as entry.
- **`src/rustc_ast_pretty/pprust/state.test.ts`** (9 tests), all against real rustc output:
  - Fixture `state.oracle.json`, produced by `state.oracle.rs.txt` (a scratch rustc-dev program; the build/run
    commands are in the test header): `rustc_parse` lexes/parses each input, the program dumps the token
    trees / AST structurally plus `pprust::{tts_to_string, tt_to_string, token_to_string, ty_to_string,
    attribute_to_string, print_crate}` output (edition 2021). The TS test rebuilds the same values by hand
    (`DUMMY_SP` spans) and prints them through the ported `State`.
  - 25 token streams (spacing rules, `space_between`/`idents_would_merge`, all punctuation incl. a line
    wrap at the margin, every literal kind incl. raw/byte/C strings and suffixes, raw idents, `k#` forced
    keywords, raw lifetimes, doc comments, brace/paren/bracket delimiters), plus `tt_to_string` of every
    top-level tree and `token_to_string` of every token (>100).
  - 15 types (paths with generic args, `{{root}}`, refs/ptrs/slices/tuples/never/infer, `dyn`/`impl`
    bounds incl. `?Sized`, `'a`, parenthesised trait objects).
  - 13 attributes (`#!`/`#`, delimited args in all three delimiters, `unsafe(..)`, all four doc-comment forms).
  - 5 comment-only crates through `print_crate` (shebang, line/block/blank-line comments, `Mixed`).
  - `print_string` escaping checked against `str::escape_debug` output from rustc; `FixupContext` Debug.
- **`pprust/tests.test.ts`** (lane pp): `test_field_view` un-skipped and passing. `test_fun_to_string` and
  `test_variant_to_string` stay skipped: they need `print_fn`/`print_variant` from `state/item.rs`.

## Files touched
- New: `src/rustc_ast_pretty/pprust/state.ts`, `src/rustc_ast_pretty/pprust/state/fixup.ts`,
  `src/rustc_ast_pretty/pprust/state.test.ts`, `state.oracle.json`, `state.oracle.rs.txt`.
- `src/rustc_ast_pretty/pprust/mod.ts`: the `State` shim replaced by the real imports, as root allowed:
  `export * as state from "./state.ts"`, `import { State }`, and the upstream `pub use state::{AnnNode,
  Comments, PpAnn, PrintState, State, print_crate, print_crate_as_interface}`. Unused shim imports removed.
- `src/rustc_ast_pretty/pprust/tests.test.ts`: un-skip `test_field_view`; `s.end(..)` -> `s.s.end(..)`
  (Deref contract below); skip reason updated.

## PrintState contract (for `state/expr.rs`, `state/item.rs` and `rustc_hir_pretty`)
- `trait PrintState<'a>: Deref<Target = pp::Printer> + DerefMut` is the **abstract class `PrintState`**.
  Provided methods are its methods; required ones (`comments`, `comments_mut`, `ann_post`,
  `print_generic_args`) are `abstract`. Implementors **`extend PrintState`**.
- **Deref = the field `s: pp.Printer`** (declared `abstract s` on `PrintState`; both upstream implementors
  deref to their `s` field). Upstream auto-deref calls `self.word(..)` are written **`this.s.word(..)`**;
  there are no forwarding methods (this also avoids the `Printer::print_string` / `PrintState::print_string` clash).
- Trait-provided associated fn `Self::to_string(f)` is the static `PrintState.to_string(f)` (inherited as
  `State.to_string`); it always builds an AST `State`, like upstream (HIR does not override it).
- `State` fields: `s`, `comments_` (renamed: clashes with the `comments()` method), `ann`, `is_sdylib_interface`.
- `PpAnn` (all methods provided) is a class; implementors extend it. `AnnNode`/`MacHeader` are `$`-tagged unions.
- `BoxMarker`s are passed around as values (`const [cb, ib] = this.head("")`), `Option<BoxMarker>` = `| undefined`.
- Closures `FnMut(&mut Self, &T)` are `(s: this, elt: T) => void`; `&[T]` params are `readonly T[]`.
- `INDENT_UNIT`, `doc_comment_to_string`, `Comments`, `print_crate`, `print_crate_as_interface` are exported.

## Methods for the expr/item lane (placeholders without markers, at the end of state.ts)
`State` interface declarations + `State.prototype.X = () => unported(..)` placeholders. The expr/item
files must assign `State.prototype.X` (and `rustc_ast_pretty/lib.ts` must import them after `pprust/mod.ts`);
then root can delete the placeholders (the interface declarations can stay or move into a
`declare module "../state.ts"` block in the new files):
- `unported("rustc_ast_pretty::pprust::state::expr::print_expr_cond_paren")`
- `unported("rustc_ast_pretty::pprust::state::expr::print_expr_anon_const")`
- `unported("rustc_ast_pretty::pprust::state::expr::print_expr")`
- `unported("rustc_ast_pretty::pprust::state::expr::print_expr_outer_attr_style")`
- `unported("rustc_ast_pretty::pprust::state::item::print_foreign_item")`
- `unported("rustc_ast_pretty::pprust::state::item::print_item")`
- `unported("rustc_ast_pretty::pprust::state::item::print_visibility")`
- `unported("rustc_ast_pretty::pprust::state::item::print_impl_restriction")`
- `unported("rustc_ast_pretty::pprust::state::item::print_mut_restriction")`
- `unported("rustc_ast_pretty::pprust::state::item::print_assoc_item")`
- `unported("rustc_ast_pretty::pprust::state::item::print_fn")`
- `unported("rustc_ast_pretty::pprust::state::item::print_where_bound_predicate")`
- `unported("rustc_ast_pretty::pprust::state::item::print_variant")` (not called by state.rs; used by `pprust/tests.rs`)

No other `unported(...)` in my files.

## PORT decisions
- PrintState/Deref/`to_string`: see the contract above.
- `FixupContext` (`Copy` struct): immutable class; struct-update `..self` via a private `update` helper;
  `#[derive(Default)]` is `FixupContext.default()`; `#[derive(Debug)]` hand-written `debug_FixupContext`.
- `str::escape_debug`: at the pin it is `chars().flat_map(char::escape_debug)` (library/core/src/str/mod.rs:3149),
  ported as a local helper over `DEBUG_ESCAPE_UNICODE` (src/std); verified against rustc.
- `gather_comments`: source text is `Str` (byte-indexed); the parameter `sm` is reassigned (upstream shadows it).
  `FilePathMapping` (derived `Clone`) is rebuilt with `FilePathMapping.new(mapping.slice(), scopes)`.
- `ast::Generics::default()` in `print_ty_fn` is built inline (`WhereClause(false, [], DUMMY_SP)`, `DUMMY_SP`);
  `FnHeader { safety, ext, ..default() }` copies `FnHeader.default()`'s other fields.
- `&NoAnn` is one shared `NoAnn` instance.
- Nested fns (`is_ident_like`, `is_punct`, `is_explicit_reg`) are nested JS functions with markers.
- `print_inline_asm`'s local `enum AsmArg` is a local `$`-tagged type.

## For root
- Record the PrintState contract as a decision (`bun scripts/state.ts record decision ...`); I did not
  touch `docs/state`.
- `docs/claims/wave6-pprust-state.md` can be deleted.

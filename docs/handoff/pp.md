# Handoff: pp (wave 6): rustc_ast_pretty lib.rs, pp.rs, pp/ring.rs, pprust/mod.rs, pprust/tests.rs

Branch `lane/pp`. The first API commit is `25a982f`; pprust-state can merge from it or from any later commit.

## Evidence
- **Coverage** (`bun scripts/coverage.ts --missing`):
  - pp.rs 44/44
  - pp/ring.rs 12/12
  - pprust/mod.rs 22/22
  - pprust/tests.rs 6/6
  - lib.rs 0/0
- **`coverage.ts --check`**: `markers ok (2294; vendor 2048)`.
- **Typecheck**: `bunx tsc --noEmit -p .` is clean.
- **Unit tests**: `RUST_TS_REQUIRE_PROBES=1 bun test src tools` gives 507 pass, 4 skip, 0 fail. Three of the skips are this lane's `pprust/tests.test.ts`.
- **Difftest sample**: `RUST_TS_AGENT=pp bun scripts/difftest.ts --suite lex --sample 200` gives 200/200 MATCH (run `20261012-215402-pp-0g6p`). Nothing in the driver uses `rustc_ast_pretty` yet, so this only shows that nothing regressed.
- **Engine oracle** (`src/rustc_ast_pretty/pp.test.ts`): 715 of 715 cases match the real `rustc_ast_pretty::pp::Printer` byte for byte, including the panic message for each case that panics.
  - The cases come from `src/rustc_ast_pretty/pp_oracle/gen.rs`. It is a scratch program built against the pinned toolchain's rustc-dev component (`extern crate rustc_ast_pretty; extern crate rustc_driver;`). Its header gives the build and run commands, plus the op encoding.
  - It writes `pp_oracle/cases.json` (2.4 MB): 15 hand-written edge cases and 700 seeded random op sequences. Of these, 656 produce output and 59 panic.
  - The sequences cover:
    - nested ibox, cbox, rbox and visual_align boxes, including negative indents
    - words of 0 to 120 bytes, punctuation and multi-byte UTF-8
    - every kind of break
    - `*_if_not_bol` and `synth_comment`
    - `is_beginning_of_line` results
    - list and block shapes like the ones pprust builds
  - Mutation checks confirm the test catches real bugs: switching to `.length` widths, `MIN_SPACE` 59, or `<` instead of `<=` in `print_break` each make it fail.

## Contract for pprust-state (`src/rustc_ast_pretty/pp.ts`)
- **`Printer`** is a class. Create one with `Printer.new()`. Its methods keep upstream names:
  - boxes: `rbox(indent, breaks)`, `ibox(indent)`, `cbox(indent)`, `visual_align()`, each returning `BoxMarker`; close with `end(b)`
  - breaks: `break_offset(n, off)`, `zerobreak()`, `space()`, `hardbreak()`, `hardbreak_if_not_bol()`, `space_if_not_bol()`, `trailing_comma()`, `trailing_comma_or_space()`
  - words: `word(s)`, `word_space(s)`, `word_nbsp(s)`, `nbsp()`, `popen()`, `pclose()`, `synth_comment(s)`
  - state: `eof(): string`, `is_beginning_of_line()`, `last_token()`, `last_token_still_buffered()`, `replace_last_token_still_buffered(tok)`, `offset(n)`
  - static: `Printer.hardbreak_tok_offset(off): Token`
- **Strings**: `Cow<'static, str>` and `Into<Cow<..>>` parameters are JS `string`. Widths use `utf8_len`.
- **`Token`** is a `$`-tagged union:
  - `{ $: "String", _0: string }`
  - `{ $: "Break", _0: BreakToken }`
  - `{ $: "Begin", _0: BeginToken }`
  - `Token.End`
  - `Token.is_hardbreak_tok(t)` lives on the companion const, and `Token_eq` is the derived `PartialEq`.
  - `BreakToken` has `offset`, `blank_space` and `pre_break: number | undefined`; `pre_break` is a char code.
  - Exports: `BreakToken_default()`, `BreakToken_eq`, `BeginToken_eq` and `IndentStyle_eq`. The engine also exports `Breaks` (a string union plus const), `SIZE_INFINITY`, `MARGIN` and `MIN_SPACE`.
- **Renamed field**: the private field `space` is called `space_`, because a JS class cannot have both a field and a method named `space`. The public method `space()` keeps its name.
- **`BoxMarker`** is a branded class. It has `drop()`, but nothing calls it automatically (see PORT decisions).
- **`pprust/mod.ts`** exports a shim, both an interface and a const, named `State`. It lists the State methods that mod.rs and tests.rs call, with upstream names and argument types, for example `token_to_string(token: Token): string` and `head(w): [BoxMarker, BoxMarker]`.

## Pending pprust-state (integration step for root)
- `pprust/mod.ts` has a local `State` shim, marked `// PORT: pending pprust-state`. Both `State.new()` and `State.to_string(f)` call `unported("rustc_ast_pretty::pprust::state::State::{new,to_string} (pending pprust-state)")`.
- When `pprust/state.ts` lands:
  1. Delete the shim (the interface and the const).
  2. Add `export * as state from "./state.ts"; import { State } from "./state.ts";`.
  3. Add `export { AnnNode, Comments, PpAnn, PrintState, State, print_crate, print_crate_as_interface } from "./state.ts";`, which is upstream's `pub use state::{..}`.
- In `pprust/tests.test.ts`, change the three `test.skip` calls to `test`.
- If State attaches `print_fn`, `print_variant` and the other methods from `state/item.rs` and `state/expr.rs` by side effect, `rustc_ast_pretty/lib.ts` must import those extension files, following the rustc_ast pattern.

## unported(...) left
- `rustc_ast_pretty::pprust::state::State::new (pending pprust-state)`, in the `pprust/mod.ts` shim.
- `rustc_ast_pretty::pprust::state::State::to_string (pending pprust-state)`, in the `pprust/mod.ts` shim.

## PORT decisions
- **isize arithmetic**: every quantity is bounded by the printed length plus small multiples of `SIZE_INFINITY`, so JS numbers are exact and rustc's isize never overflows.
  - Upstream `isize as usize` values that can wrap, such as `(MARGIN - space) as usize` in the Visual indent, are kept signed (recorded decision, annotate-b). Later uses convert them back with `as isize`, which is then the identity.
  - The one place a wrapped value would be visible is `pending_indentation as usize` in `print_string`. When it is negative, the port panics with `"capacity overflow"`, which is what `String::reserve` does. The oracle confirms this (3 cases).
  - `usize::try_from(..).unwrap()` panics with `TryFromIntError(NegOverflow)`, confirmed by the oracle (55 cases).
- **`VecDeque`** (RingBuffer `data`, `scan_stack`) is a JS array, with `pop_front` implemented as `shift()`. `RingBuffer` indexing mirrors the `checked_sub(..).unwrap()` panic and VecDeque's `"Out of bounds access"` panic.
- **`offset()`** mutates the buffered `BreakToken` in place. `BreakToken` is `Copy`, but every buffered Break owns a fresh object.
- **`BoxMarker`**: JS has no destructors, so a marker that is never ended is not detected. `drop()` is ported but never called automatically.
- **`Token`** keeps a JS string where upstream has `Cow<'static, str>`.
- **pprust/tests.rs**: `ast::Generics::default()` is written out as `generics_default()` in the test file. The local `var` is renamed `var_`.

## Files touched
- New: `src/rustc_ast_pretty/{lib,pp,pp/ring,pprust/mod}.ts`, `src/rustc_ast_pretty/pp.test.ts`, `src/rustc_ast_pretty/pprust/tests.test.ts`, `src/rustc_ast_pretty/pp_oracle/{gen.rs,cases.json}`.
- `harness/scope.json` did not need any change: `coverage --check` passes as is.

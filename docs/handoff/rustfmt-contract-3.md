# Handoff: rustfmt-contract-3 (M8 wave 41; third of three chained `rustfmt-contract` lanes)

Plan: `docs/plan-m8.md` §3, D4, D11, D13, D14; `docs/handoff/rustfmt-contract-1.md`; root's "rustfmt-contract-1 PORT decisions".
Branch `t3/rustfmt-contract-3`, from main `e1fca355`. First commit merges `t3/rustfmt-contract-port` (`4ec25456`,
rustfmt-contract-1) with a real merge. No `upstream.ts fetch`, no heavy build. Only `src/rustfmt/` was edited.

## Files

| Upstream (`src/tools/rustfmt/src/`) | TS | Coverage |
|---|---|---|
| `formatting.rs` (653 lines) | `formatting.ts` | 28/28 |
| `formatting/generated.rs` (10) | `formatting/generated.ts`, `formatting/generated.test.ts` | 1/1 |
| `formatting/newline_style.rs` (250) | `formatting/newline_style.ts`, `formatting/newline_style.test.ts` | 23/23 (6 fns + all 17 test fns) |
| `skip.rs` (127) | `skip.ts`, `skip.test.ts` | 9/9 |

Also edited:
- `lib.ts`: imports `./formatting.ts` (by its real path now, not `../rustfmt/formatting.ts`), drops its own declaration of
  `format_input_inner`, and attaches `format_input_inner` and `handle_formatted_file` to `Session.prototype` after the class
  (see PORT 1).
- `config/file_lines.ts`: `key_FileName` is now exported (one word). `FormatErrorMap` needs the same key.
- `contract_lib.d.ts`: the `formatting.ts` block is deleted. Other blocks were extended or added (below).

`bun scripts/coverage.ts`: crate `rustfmt` 280/1595, up from 219.

## Checks

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok.
- `bun scripts/coverage.ts --missing <file>`: 28/28, 1/1, 23/23, 9/9.
- `bun tools/codegen/rustfmt.ts --check`: clean (nothing generated changed).
- `bun tools/codegen/rustfmt_oracle.ts check`: ok.
- `bun test src/rustfmt`: 52 pass, 0 fail, about 0.5 s wall. That is well within D13's 10 s, and includes rustfmt-contract-1's tests.
- `bun test tools/codegen/rustfmt.test.ts src/std/{result,panic,fmt}.test.ts`: 17 pass. These include the contract guard and
  the src-wide scanners.
- No difftest: no suite runs rustfmt yet (D12).

**Upstream tests.** All 16 `#[test]`s of `newline_style.rs` and its helper are ported 1:1 with markers, and they pass. `skip.rs`
and `generated.rs` have **no** `#[cfg(test)]` tests upstream. `skip.test.ts` and `generated.test.ts` are extra checks without
markers: `SkipNameContext` (default/extend/update/skip/skip_all, and in-place replacement), `SkipContext::update` with clone
independence, `is_skip_attr` on built path segments, and `is_generated_file`'s line limit. `get_skip_names` is not
unit-tested because it needs parsed attributes.

`formatting.ts` cannot load at runtime yet. It value-imports `comment`, `modules`, `parse/*`, `utils`, `visitor` and
`source_file`, which do not exist. So it has no unit test. lib.ts was already in that state.

## Contract blocks in `contract_lib.d.ts`

| Block | Change | Declares | Owner |
|---|---|---|---|
| `formatting.ts` | **deleted** (module landed) | | |
| `comment.ts` | extended | `FullCodeCharKind` as the full 10-variant string union, plus a companion with `is_comment` and `is_string`; `CharClasses<T>` (`static new(base: Iterable<T>)`, iterable of `[FullCodeCharKind, T]`) | comment lane |
| `emitter.ts` | extended | `EmitterResult { has_diff }` | emitter lane |
| `modules.ts` | extended | `Module` (`span`, `attrs()`), `FileModMap = Iterable<[FileName, Module]>` (BTreeMap: must iterate in `FileName` order), `ModResolver.new(psess, dir_ownership, recursive).visit_crate(krate)` | modules lane |
| `parse/parser.ts` | extended | `DirectoryOwnership` value companion (`= rustc_expand`'s `DirOwnership`), `ParserError` string union, `Parser.parse_crate(input, psess)` | parse lane |
| `parse/session.ts` | **new** | `ParseSess.new(config)`, `ignore_file`, `set_silent_emitter`, `span_to_file_contents`, `span_to_first_line_string`, `line_of_byte_pos`, `snippet_provider` | parse lane |
| `visitor.ts` | **new** | `SnippetProvider` (`entire_snippet`, `start_pos`, `end_pos`); `FmtVisitor` (fields `buffer`, `last_pos`, `line_number`, `skipped_range` (the shared `Rc<RefCell<Vec>>` array), `macro_rewrite_failure`, `skip_context`, `is_macro_def`; `from_psess`, `skip_empty_lines`, `format_separate_mod`, `drop()` for `impl Drop`) | visitor lane |
| `source_file.ts` | **new** | `append_newline(s: MutRef<string>)`, `write_file(psess?, filename, text, out, emitter, newline_style): IoResult<EmitterResult>` | emitter/source_file lane |
| `utils.ts` | extended | `contains_skip(attrs)`, `count_newlines(input)` | **rustfmt-contract-2** |

**Merge note for root.** rustfmt-contract-2 (`t3/port-rustfmt-contract-modules`) edits the same file. It deletes the `utils.ts`
and `rewrite.ts` blocks. I added two lines to the `utils.ts` block, so expect a small textual conflict. The resolution is to
take contract-2's deletion. Then `bunx tsc` checks `formatting.ts`'s calls of `contains_skip` and `count_newlines` against the
real `utils.ts`. Upstream names them `contains_skip(attrs: &[Attribute]) -> bool` and `count_newlines(input: &str) -> usize`.
If contract-2 takes `count_newlines` as a `Str`, formatting.ts's call needs a one-line change.

## `unported(...)` left

None in this lane's files. Everything not ported yet is reached through the contract blocks above. Those modules do not exist,
so `formatting.ts` cannot load until they land. That stops the run at import time; it does not produce guessed behaviour.

## `// PORT:` decisions (for root to record)

1. **Load order of the `Session` methods.** `impl Session` (formatting.rs:30, `format_input_inner`) and
   `impl FormatHandler for Session` (:283, `handle_formatted_file`) are **exported function declarations** in `formatting.ts`,
   with `this: Session<T>`. They are declared on `Session` by a `declare module "./lib.ts"` augmentation there.
   **`lib.ts` assigns them to `Session.prototype` right after the class.** rustfmt-contract-1's handoff suggested that
   formatting.ts assign them itself. That cannot work: lib.ts is the crate root, and it value-imports
   `default_ReportedErrors` and `new_FormatErrorMap` from formatting.ts. So formatting.ts's body runs before lib.ts's
   whenever lib.ts loads first, and `Session` would still be in its TDZ. Function declarations are initialised when the
   module is instantiated, so the assignment in lib.ts works in either load order. formatting.ts's top level touches no
   binding of lib.ts. Keep it that way.
2. **`FormatHandler`** is a TS interface. `format_project<T extends FormatHandler>` takes the `Session` itself, which carries
   the method through the augmentation.
3. **`&mut String` is `MutRef<string>`** (PORTING §8). `format_file` passes `field_mut(visitor, "buffer")` to
   `append_newline`, `format_lines` and `apply_newline_style`. `FormatLines::iterate` takes `&mut String` but only reads it,
   so it takes a `string`.
4. **Byte offsets on JS strings.** `overflow_start`, the highlight ranges and `text.len()` use `utf8_len`, so they are bytes,
   as upstream. `format_lines`' `text.truncate(len - newline_count + 1)` cuts inside the trailing run of `\n`/`\r`, which is
   all ASCII, so it is the same count of UTF-16 units from the end. Chars are code points (`string_chars`, a local
   generator). `trim_end` is `string_trim_end` (src/std, `char::is_whitespace`).
5. **`FormatErrorMap`** is `KeyedMap<FileName, FormattingError[]>` keyed by `key_FileName` (now exported), as `FileLines`'
   map is. It iterates in insertion order, which is one of the orders std's `RandomState` map can give (as contract-1's
   PORT 2).
6. **`ReportedErrors`** is a class (it has `add`), with `default_ReportedErrors`, `debug_ReportedErrors` and
   `ReportedErrors_eq` for its derives. lib.ts already used `default_ReportedErrors()`. **`FormattingError`** is a class.
   `highlight: Option<Range<usize>>` is `{ start, end } | undefined`, as in rustc_parse_format.
7. **`Timer`** is a tagged union with companion methods. Its derived `Debug` is not written: nothing prints it, and src/std
   has no `Debug` for `Instant`. `cfg!(target_arch = "wasm32")` is `false`. `duration_to_f32` rounds to f32 at each step.
   The verbose `{:.3}` of an `f32` is a local `f32_fixed3`: exact BigInt rounding, ties to even, the same method as src/std's
   `f64_fixed1`. **That is a candidate for src/std.**
8. **`impl Drop for FmtVisitor`**: `format_file` calls `visitor.drop()` in a `finally`, so it runs on return and on unwind, as
   lib.ts does for `Session`. The visitor lane must provide `drop()`. It is a no-op when `parent_context` is `None`, which
   `from_psess` sets.
9. **`cfg!(windows)` in `native_newline_style`** is the host (`process.platform === "win32"`), as in rustc_errors/emitter.ts.
   The oracle runs on the same host.
10. **`SkipNameContext`** is a tagged union with companion methods (PORTING §8). `skip_all` and `update` replace the value in
    place with `replace_in_place` (std/mut_ref.ts), because callers mutate a field (`skip_context.macros.skip_all()`,
    visitor.rs:838). So `All` is never a frozen singleton: each one is a fresh object. `HashSet<String>` is a `Set`; it is
    only queried, never iterated. `clone_SkipContext`, `clone_SkipNameContext` and `default_SkipContext` are hand-written,
    as lib.ts's `clone_FormatReport` is: no codegen covers rustfmt derives outside `config/`. The manual `Default` and
    `Extend` impls carry markers (`skip.rs:44 default`, `:50 extend`).
11. **`echo_back_stdin`** writes with `stdout_write_all`, the raw `io::stdout().write_all`. Unlike `println!`, that write is not
    captured. The verbose `println!`/`eprintln!` go through `write_stdout` and `write_stderr`.
12. **`SourceFile.src`** (`Str`) becomes a string through `toString()` for `is_generated_file`. If `src` is `None`, the code
    panics `"SourceFile without src"`, as upstream's `expect`.

## For root / later lanes

- Record PORT 1–12.
- When `comment`, `modules`, `parse`, `utils`, `visitor` and `source_file` land, each lane deletes its block and checks
  `bunx tsc`. A load-order test, like `src/proc_macro/bridge/load_order.test.ts`, that imports `lib.ts` first and then
  `formatting.ts` first becomes possible then. It should check that both `Session.prototype` methods are set.
- The 5 `lib.rs` unit tests stay with whichever lane first gets `format_snippet` running, as contract-1 said.
- `f32_fixed3` and lib.ts's `Write`/`VecU8` are candidates for src/std.

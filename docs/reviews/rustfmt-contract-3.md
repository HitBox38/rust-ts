# Review: rustfmt-contract-3 (independent, read-only)

- Lane branch `t3/rustfmt-contract-3` at `d554e217`. Reviewed only the lane's own work: `git diff 7a69f860 d554e217`, which is 11
  files and +1458/−36 lines.
- Upstream: `$RUST_TS_DATA/rust/src/tools/rustfmt/src/{formatting.rs, formatting/generated.rs, formatting/newline_style.rs,
  skip.rs}` at the pin. I read all four completely beside the port.
- Handoff: `docs/handoff/rustfmt-contract-3.md` (12 PORT decisions). Root's decisions: "rustfmt-contract-1 PORT decisions"
  (history.jsonl, 2026-11-16T02:30).

## Verdict: PASS WITH NOTES

The port is faithful. All four files are complete and in upstream order. Logic, names and panic texts match, and every marker
is correct. I found no guessed values and no `unported` gaps. All 12 PORT decisions are sound. Two are the lane's own choices,
both justified:

- PORT 1, the `Session.prototype` attachment in `lib.ts`. I confirmed empirically that it works in either load order.
- PORT 7, `f32_fixed3`. It matches the oracle's `{:.3}` on 212 values, including ties.

The handoff predicts a single-line conflict with rustfmt-contract-2. The real conflict is bigger. A naive resolution would
leave two contract blocks that silently shadow each other. tsc catches that, and a recipe that fixes it is in N1. The other notes
are about the contract's string representation, test coverage, and small follow-ups.

## Checks run

These ran in a scratch detached worktree at `d554e217`. It is now deleted.

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check` | markers ok |
| `coverage.ts --missing` for formatting.rs / generated.rs / newline_style.rs / skip.rs | 28/28, 1/1, 23/23, 9/9 |
| `bun tools/codegen/rustfmt.ts --check` | exit 0 |
| `bun tools/codegen/rustfmt_oracle.ts check` | ok (matches the oracle's expansion) |
| `bun test src/rustfmt` | 52 pass, 0 fail, 0 skip, 0.7 s (D13: well under 10 s) |
| `bun test src/std/result.test.ts` | 3 pass |
| `bun test scripts/lib/unit-steps.test.ts` | 10 pass |
| Env reads / skips in the new tests and modules | none (the only host read is `process.platform`, not an env var); no `.skip`/`skipIf`/`todo` |

## Fidelity (check 1)

**formatting.rs → formatting.ts, 28 fns.**

- **`format_input_inner`** (:31). The order is: the version check → `create_session_if_not_set_then(edition.into())` →
  `disable_all_formatting` (`Text` echoes back, otherwise an empty report) → `clone_Config` → `format_project` → on `Ok`,
  `self.errors.add(&report.internal.1)`. This matches. `clone_FormatReport` shares `internal`, which is the Rc behaviour that
  makes the visitor's errors reach the session.
- **`format_project`** (:103). It follows upstream step by step:
  - `Timer::start`, `main_file`, `input_is_stdin`, `ParseSess::new` with `?`, and the `skip_children && ignore_file` early
    return.
  - The parse error arm: `forbid_verbose = stdin || e != ParsePanicError`; `eprintln!` becomes `write_stderr("…\n")`; then
    `add_parsing_error` and `Ok(report)`.
  - `ModResolver::new(.., directory_ownership.unwrap_or(UnownedViaBlock), !stdin && !skip_children).visit_crate(..)?`. The `?`
    goes through `ErrorKind.from_ModuleResolutionError`, which is lib.rs's `#[from]`. The filter calls `should_skip_module` with
    the same arguments, and upstream's lazy filter + collect becomes an eager filter with the same result.
  - `done_parsing`, `set_silent_emitter`, and the per-file loop: stdin + `contains_skip` echoes the entire snippet, then
    verbose `Formatting {}`, then `format_file` with early return on `Err`.
  - `done_formatting`, the verbose timing line, and `Ok(context.report)`.
- **`should_skip_module`** (:61). It checks the four conditions in upstream order. `FileName_eq` stands for `!=`.
  `expect("SourceFile without src")` is ported verbatim.
- **`format_file`** (:206). The order is `from_psess(.., report.clone())` → `update_with_attrs(krate.attrs)` →
  `is_macro_def` → `last_pos` → `skip_empty_lines` → `format_separate_mod`. The `debug_assert_eq!` is kept as a comment. Then
  `count_newlines` → `contains_line(path, n + 1)` → `append_newline` → `format_lines` → `apply_newline_style` →
  `macro_rewrite_failure` → `add_non_formatted_ranges(clone)` → `handle_formatted_file`.
  - `visitor.drop()` sits in a `finally`, so it runs after `handle_formatted_file` returns. Upstream drops the visitor at the
    end of scope, which is the same point.
- **`handle_formatted_file`** (:285). The match arms are preserved:
  - `Ok(has_diff)` → `add_diff`.
  - `Err` → `format!("{path}: {e}")` wrapped in `io::Error::new(e.kind(), ..)` (a `Custom` error) → `ErrorKind::IoError`.
  - The fall-through arm, then the push onto `source_file`.
- **Error and report building.** These all match upstream:
  - `FormattingError::from_span`, `is_internal` (same five kinds) and `msg_suffix`. The `\`-continued literal joins to "...
    suppress the warning ...", as Rust does.
  - `ReportedErrors::add`, with the same seven fields in order.
  - The `Default`/`Debug`/`PartialEq` derives (field order checked).
- **`FormatErrorMap`.** It is a `KeyedMap` keyed by `key_FileName`, iterated in insertion order. That is consistent with
  root's decision 2 for rustfmt-contract-1 (`HashMap`'s `RandomState` order is unspecified upstream).
- **Timer.**
  - The state machine and the panic and `unreachable` arms match, including the match arm order in `get_parse_time` and
    `get_format_time`.
  - `duration_to_f32` rounds each operation to f32. That is correct, because f64 is wide enough that rounding an f64 `/` or `+`
    of f32 operands gives the correctly rounded f32 result, and 1e9 is exact in f32.
  - I checked `f32_fixed3` against the pinned nightly (`nightly-2026-10-11`, a one-file rustc build). I printed
    `d.as_secs() as f32 + d.subsec_nanos() as f32 / 1e9f32` with `{:.3}` for 200 durations, plus the ties 0.0625, 0.1875 and
    0.3125, plus 0, 1e-9 and 3.9995. TypeScript and rustc gave identical output; for example, the ties gave `0.062 0.188 0.312`,
    which is ties-to-even.
- **`format_lines` / `FormatLines`.**
  - The byte semantics are right. `overflow_start`, the trailing-whitespace highlight and the overflow highlight all use
    `utf8_len`, which counts bytes as upstream does.
  - `string_trim_end` scans UTF-16 units, which is safe because every `White_Space` code point is in the BMP.
  - The truncate is exact. It drops `newline_count − 1` bytes, and those lie in the trailing run of `\n`/`\r` that `char()`
    resets, so they are ASCII and the same count of UTF-16 units.
  - `should_report_error` and `is_skipped_line` match upstream, including the `allow_error_report` condition order.
  - `should_emit_verbose` matches.

**generated.rs.** `lines().take(limit).any(contains "@generated")` is ported faithfully, with `str_lines` following Rust's
`lines()` (`\r\n` handling, and no empty final line). See N5 for a performance note.

**newline_style.rs.**

- `auto_detect_newline_style` uses positions in code points (`chars().position`/`nth`) and `saturating_sub(1)`, as upstream
  does.
- `convert_to_windows_newlines` peeks one UTF-16 unit. That is valid because `\n`/`\r` are never part of a surrogate pair.
- `convert_to_unix_newlines` is `replaceAll`.

**skip.rs.**

- `SkipContext` (`update_with_attrs`, `update`), `Default`/`Extend` for `SkipNameContext`, `update` (same three arms, in order),
  `skip` and `skip_all` all match.
- `is_skip_attr` matches. It uses `display_Ident`, which gives `Ident::to_string`, including `r#`.
- `get_skip_names` matches, including the non-`continue` path for doc comments (`meta_item_list()` is `None` for those).
- `RUSTFMT`/`SKIP` are ported as constants.

The markers are all on the `fn` line. `coverage --check` passes, and I spot-checked `:185 new`, `:274`/`:285
handle_formatted_file`, `skip.rs:44 default` and `:50 extend`.

## PORT decisions (check 2)

1. **Attaching the methods in lib.ts.** This is faithful: upstream adds two `impl` blocks on `Session`, and the prototype
   methods are those.
   - I tested load order empirically. I stubbed the 9 missing modules in scratch and imported `lib.ts` first, then
     `formatting.ts` first, under `bun test` with `install_serde_stubs()`.
   - Both orders set `Session.prototype.format_input_inner` and `.handle_formatted_file` to the exported functions.
     `default_ReportedErrors()` works in both.
   - This holds because function declarations are bound when the module is instantiated, and lib.ts's top level evaluates
     nothing else from formatting.ts.
   - The invariant "formatting.ts's top level touches no binding of lib.ts" is documented in both files. The load-order test
     the handoff proposes should land with the first lane that makes `formatting.ts` loadable.
2. **`FormatHandler` as an interface.** Fine.
3. **`MutRef<string>`, and `iterate` taking `string`.** Fine: `iterate` only reads its argument, and this follows PORTING §8.
4. **Byte offsets.** Verified above.
5. **`FormatErrorMap`.** Consistent with root's decision 2.
6. **`ReportedErrors`/`FormattingError` as classes.** Fine.
7. **Timer.** Fine. Omitting the derived `Debug` is acceptable: `Timer` is private and nothing formats it.
8. **`drop()` in a `finally`.** This keeps upstream's drop point. The visitor lane must provide `drop()`, and the contract
   says so.
9. **`cfg!(windows)` as `process.platform`.** This follows the `rustc_errors/emitter.ts` precedent.
10. **`SkipNameContext` with `replace_in_place`.** This is correct for in-place `&mut self` replacement. A mutation test is
    below.
11. **`echo_back_stdin` with `stdout_write_all`.** This is the same fd-1 sink as `write_stdout`, so the order of
    `println!`/`write_all` is kept.
12. **`src.toString()`.** Fine.

None of the decisions is a redesign or a guess.

**Exporting `key_FileName`.** This is fine. It is a one-word visibility change in contract-1's file, and it reuses the canonical
key rather than duplicating it. It is outside the lane's assigned files, but it is disclosed. Root should accept it, together
with the lib.ts edits (see N4).

## Contract blocks (check 3)

- Each block is named by its exact canonical specifier plus `*`, contract-1's convention: one block per module, and no broader
  patterns.
- Every new or extended block names a module that does not exist yet.
- I checked each declared shape against upstream at the pin. All of these match:
  - `FullCodeCharKind`: 10 variants in order (comment.rs:1275), with `is_comment`/`is_string`.
  - `CharClasses`.
  - `EmitterResult { has_diff }` (emitter.rs:27).
  - `Module.span` and `attrs()` (modules.rs:27/54); `FileModMap` as a BTreeMap iterated in `FileName` order (:23).
  - `ModResolver::new(psess, directory_ownership, recursive)` and `visit_crate -> Result<FileModMap, ModuleResolutionError>`
    (:104/121).
  - `DirectoryOwnership` with its value companion; `ParserError`'s 5 variants in order (parser.rs:82); `Parser::parse_crate(input,
    psess) -> Result<Crate, ParserError>` (:140).
  - `ParseSess::new(config) -> Result<_, ErrorKind>`, `ignore_file`, `set_silent_emitter`, `span_to_file_contents`,
    `span_to_first_line_string`, `line_of_byte_pos -> usize` and `snippet_provider` (session.rs:120–236).
  - `SnippetProvider.entire_snippet/start_pos/end_pos` (visitor.rs:61–69).
  - `FmtVisitor`: fields `buffer`, `last_pos`, `line_number`, `skipped_range`, `macro_rewrite_failure`, `skip_context` and
    `is_macro_def`; `from_psess(psess, config, snippet_provider, report)` (:827), `skip_empty_lines` (:1042),
    `format_separate_mod(m, end_pos)` (:1031).
  - `append_newline(&mut String)` (source_file.rs:19) and `write_file(Option<&ParseSess>, &FileName, &str, &mut T, &mut dyn
    Emitter, NewlineStyle) -> io::Result<EmitterResult>` (:50).
  - `contains_skip` (utils.rs:327) and `count_newlines(&str)` (:404). contract-2's real `utils.ts` has
    `count_newlines(input: string)`, so formatting.ts's call needs no change.
- See N1 for the merge with contract-2, and N2 for the string representation.

## Tests (check 4)

- **newline_style.** All 16 `#[test]`s and the `test_newlines_are_applied_correctly` helper are ported 1:1 (17 fns, with
  markers). Inputs, expected strings, assertion messages and the `cfg!(windows)` branches all match upstream.
- **skip and generated.** The unmarked tests are meaningful. They cover in-place `All` replacement, `All` absorbing
  `extend`/`update`, the clone being independent of later updates, the 2/3/4-segment cases of `is_skip_attr`, and both sides of
  the line-limit boundary in `is_generated_file`.
- **Mutations.** I injected three. Each was caught, and each was reverted afterwards:
  - (a) `auto_detect_newline_style` using a UTF-16 `indexOf("\n")` in place of the code-point position:
    `auto_detects_windows_newlines_with_multibyte_char_on_first_line` fails (15 pass, 1 fail).
  - (b) `is_generated_file` using `limit + 1`: the generated test fails.
  - (c) `SkipNameContext.update` no longer replacing with `All`: 2 of 5 skip tests fail.

## Notes (findings)

**N1 (merge, act at integration). The conflict with rustfmt-contract-2 is larger than the handoff says.** I did a trial merge
of `t3/port-rustfmt-contract-modules` (`874d0dbc`) into `d554e217` in scratch. It produced **4 conflict hunks** in
`contract_lib.d.ts`:

- the header comment;
- a comment line in the `comment.ts` block;
- the `comment.ts` block's `FullCodeCharKind` companion and `CharClasses`, which **both lanes declared**. Contract-3 has
  `{is_comment, is_string}` and a generic `CharClasses<T>` over `Iterable<T>`. Contract-2 has `{is_string,
  is_commented_string}` and a `CharClasses` over `Iterator<number>`;
- the `utils.ts` block.

Worse, git **auto-merges two duplicate blocks** with no conflict, because both lanes added `declare module
"../rustfmt/parse/session.ts*"` and `"../rustfmt/visitor.ts*"`. TypeScript does not merge two identical pattern ambient modules.
One of them wins silently. After a naive resolution, tsc reports 13 errors: `span_to_snippet`, `span_after`… missing on
`SnippetProvider` in rewrite.ts and source_map.ts, and `lookup_line_range` missing on `ParseSess` in utils.ts. Contract-2's
`skip.ts*` block also auto-merges in, although `skip.ts` now exists, so it is dead.

I verified this resolution: tsc is clean, and `bun test src/rustfmt tools/codegen/rustfmt.test.ts` gives 71 pass and 0 fail.

- Header: contract-2's, plus a mention of formatting.ts.
- `comment.ts`: one companion `{is_comment, is_string, is_commented_string}` and one `CharClasses` (contract-2's
  `Iterator<number>` shape works for both callers, because `string_chars` returns a Generator).
- `utils.ts`: take contract-2's deletion.
- `parse/session.ts`: a single block, contract-3's members plus `lookup_line_range(span): LineRange`.
- `visitor.ts`: a single block. `SnippetProvider` gets contract-3's `entire_snippet/start_pos/end_pos` plus contract-2's
  `span_to_snippet` and the six `SpanUtils` methods. Keep contract-3's `FmtVisitor`.
- Delete contract-2's `skip.ts*` block.

After resolving, `grep '^declare module' src/rustfmt/contract_lib.d.ts | sort | uniq -d` must print nothing.

**N2 (contract representation, for root to record before the visitor lane).** `SnippetProvider`'s text
(`entire_snippet(): string`) and `FmtVisitor.buffer` are declared as JS `string`. Upstream's `big_snippet` is byte-indexed
(visitor.rs:48 `&self.big_snippet[start_index..end_index]`, missed_spans.rs:208 `&big_snippet[..(offset + big_diff)]`).
PORTING §5 maps text indexed by byte offsets to `Str`. This is consistent with contract-2, which declares
`span_to_snippet(): string | undefined`, and with contract-1's `string` throughout. So it is a crate-wide choice, not a defect
of this lane. Root should still record it, for example as "rustfmt keeps source text as `string`, and byte offsets go through
`utf8_len`/byte-slice helpers". If the visitor lane switches to `Str` instead, formatting.ts:182 and :249 need `.toString()`.
That would violate "fill lanes land without changing callers".

**N3 (test coverage).** `formatting.ts` (711 lines) has no unit test. Its riskiest pure logic is the byte-offset highlights and
truncation in `FormatLines`/`format_lines`, plus the Timer state machine. It is only exercised once `format_snippet` runs. The
handoff says the module cannot load yet. That is true without stubs, but both sibling lanes already stub missing modules for
tests with `mock.module`: `config/serde_stubs.test_support.ts`, and contract-2's `contract_stubs.test_support.ts`. My load-order
check above used the same technique. This is not blocking: `format_lines`/`FormatLines` are private, as upstream. The
load-order test should be required of the first lane that makes formatting.ts loadable, and the 5 lib.rs tests cover
`format_lines` end to end.

**N4 (ownership).** Two edits fall outside the four assigned files: `lib.ts` (imports, removing the stale `format_input_inner`
declaration, the two prototype assignments) and `config/file_lines.ts` (`export` on `key_FileName`). Both are minimal, both are
required for the port to be wired in, and the handoff discloses both. Root should accept them explicitly.

**N5 (minor, performance).** `is_generated_file` runs `str_lines` over the whole file, then `.slice(0, limit)`. Upstream's
iterator stops after `limit` lines. The output is identical. The cost is O(file) per module whenever `format_generated_files` is
false, which is the default. A lazy line iterator would mirror upstream. This is optional.

**N6 (follow-ups, nothing to fix in the lane).**

- formatting.ts and contract-2's utils.ts each define an identical local `string_chars`. With `f32_fixed3` and lib.ts's
  `Write`/`VecU8`, these are candidates for src/std.
- The contract guard in `tools/codegen/rustfmt.test.ts` checks only `contract.gen.d.ts`, not the hand-written
  `contract_lib.d.ts`. So a stale block (contract-2's `skip.ts*` after the merge) or a duplicate block (N1) is not caught by a
  test. Extending the guard belongs in a reviewed tools batch.

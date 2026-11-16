# Review: root-w67-check (independent check of `integ-w67`, rustfmt contracts)

- Branch `integ-w67` at `b66692bc`, base main `50e3248e`. I checked it in my own worktree, reset to `b66692bc`, and replayed
  the merges in a scratch detached worktree at the same commits. Nothing was edited or committed in
  `$RUST_TS_DATA/integ-w67`.
- Root's hand work under review: the resolution of `d33ffd4c` (merge of `t3/codegen-fmt-serde-n1`), the resolution of
  `62c0de79` (merge of `t3/rustfmt-contract-3`, `contract_lib.d.ts` by review rustfmt-contract-3 N1), and commit `b66692bc`.

## Verdict: PASS WITH NOTES

The merges contain only the listed branches. Every merge without a conflict reproduces bit for bit. Both conflict
resolutions are what root says they are. The generated files equal the generator's output. `contract_lib.d.ts` follows
review rustfmt-contract-3 N1's recipe exactly: it has no duplicate or stale blocks, and every declared member has an
importer. `b66692bc` loosens nothing. The new `test_adjust_max_width` is upstream's test line for line. tsc, the coverage
check and the required test run are clean, with 0 fail and 0 skip. The notes are a guard gap that predates this branch
and two comment nits.

## Checks run

| Check | Result |
|---|---|
| `bun tools/codegen/rustfmt.ts --check` (at `b66692bc`, and at `d33ffd4c`) | exit 0 both |
| `bun tools/codegen/rustfmt_oracle.ts check` | exit 0 (`fixtures/rustfmt.expanded.rs matches the oracle's expansion`) |
| `bunx tsc` | exit 0 |
| `bun scripts/coverage.ts --check` | `markers ok (27992, …)`, exit 0 |
| `RUST_TS_REQUIRE_PROBES=1 bun test src/rustfmt tools/codegen src/std/result.test.ts scripts/lib/unit-steps.test.ts` | 167 pass, 0 fail, 0 skip, 0 todo, 34 files, 2249 expects, exit 0 |

## Merges

`git diff main...integ-w67 --stat`: 51 files, all under `docs/handoff/`, `docs/reviews/`, `src/rustfmt/` and
`tools/codegen/`. Each branch head equals the commit merged: `d8dfcac8`, `db54103e`, `1714bdfe`, `874d0dbc`, `39fe5038`,
`d554e217`, `b9de3895`. The only commits each branch brings beyond main are its own, plus rustfmt-contract-1's commits,
which contract-2 and contract-3 took as their base at `4ec25456`.

I replayed each merge in scratch (`git merge --no-ff --no-commit <p2>` on `<p1>`) and compared the result with the recorded
merge tree:

| Merge | Replay | Recorded tree vs replay |
|---|---|---|
| `f3080d54` rustfmt-contract-port | clean | identical |
| `bdd9bd85` review-rustfmt-contract | clean | identical |
| `d33ffd4c` codegen-fmt-serde-n1 | conflict: `config/create_config.gen.ts`, `contract.gen.d.ts` | only those 2 files differ (the resolution) |
| `0f56c3ba` port-rustfmt-contract-modules | clean | identical |
| `37be60d5` review-rustfmt-contract-2 | clean | identical |
| `62c0de79` rustfmt-contract-3 | conflict: `contract_lib.d.ts` | only that file differs (the resolution) |
| `e21b4a19` review-rustfmt-contract-3 | clean | identical |

- **`d33ffd4c`.** `rustfmt.ts --check` passes at `d33ffd4c` itself, so both resolved files are the generator's output.
  Against the first parent, only `create_config.gen.ts` changes. That change is n1's `USIZE_MAX` import and the saturating
  `usize_saturating_add_signed`. `contract.gen.d.ts` keeps the first parent's text, because contract-1 had already moved
  `options.ts`'s declarations out of the generated contract.
- **`b66692bc`** touches only `src/rustfmt/config/mod.test.ts` and `src/rustfmt/contracts.test.ts`.

## `contract_lib.d.ts`

- **Duplicates.** `grep '^declare module' … | sort | uniq -d` prints nothing.
- **Stale blocks.** None of the 13 blocks names a module that exists: 11 under `../rustfmt/`, plus
  `../vendor/unicode_width_0_1/lib.ts` and `../vendor/bytecount/lib.ts`. The `utils.ts*`, `skip.ts*`, `rewrite.ts*` and
  `formatting.ts*` blocks are gone, and all four of those modules now exist.
- **Nothing still needed was dropped.**
  - I diffed the resolution against both parents:
    - Against contract-2's side (`37be60d5`), it adds contract-3's members and removes the blocks that are now stale.
    - Against contract-3's side (`d554e217`), it adds `is_commented_string`, `filter_normal_code`, `FindUncommented_str`,
      `lookup_line_range`, `span_to_snippet`, the six `SpanUtils` methods, and the `macros`/`items`/vendor blocks. It
      removes only the stale `utils.ts*`/`rewrite.ts*` blocks.
  - Contract-3's `utils.ts*` block declared `contains_skip`, `count_newlines` and `indent_next_line`, and its `rewrite.ts*`
    block declared `ExceedsMaxWidthError`. formatting.ts and shape.ts now resolve these against the real modules, and tsc is
    clean.
- **Every member has an importer.** I grepped every declared member against the non-test files of `src/rustfmt/`. Each has
  at least one importer:
  - lib.ts: the emitter constructors and `emit_header`/`emit_footer`, the `ModuleResolutionError` debug/display,
    `FormatReportFormatterBuilder`, and `ModifiedChunk`/`ModifiedLines`.
  - formatting.ts: `ModResolver`, `Module`, `Parser.parse_crate`, `ParserError`, the `ParseSess` methods, `FmtVisitor`'s
    fields and methods, `EmitterResult.has_diff`, and `source_file`.
  - rewrite/utils/source_map/spanned: `SnippetProvider.span_to_snippet` and `SpanUtils`, `lookup_line_range`, `MacroArg`,
    the `items` functions, `UnicodeWidthStr`, `count`, `LineClasses`, `filter_normal_code`, and `FindUncommented_str`.
- **`CharClasses`.** Contract-3 N1 chose the non-generic `CharClasses` with `new(base: Iterator<number>)`, iterating
  `[FullCodeCharKind, number]`. That choice is right for both callers:
  - Upstream: utils.rs:606 and formatting.rs:523 both call `CharClasses::new(text.chars())`, and comment.rs:1391's
    `type Item = (FullCodeCharKind, T::Item)` makes the item `(kind, char)` for both.
  - Port: utils.ts:696 and formatting.ts:602 both pass `string_chars(text)`, a `Generator<number>` of code points. Both
    destructure `[kind, c]`.
  - Upstream's generality over `RichChar` (`(usize, char)`) is used only inside comment.rs, which the comment lane owns.
    Contract-2 N2's generic `CharClasses<T>` would also have type-checked. Neither caller needs it.
- **Member shapes.** I confirmed these against upstream:
  - `FullCodeCharKind`: comment.rs:1275 / :1298.
  - `CharClasses`: :1211.
  - `LineClasses`: :1556.
  - `FindUncommented`: :1143 / :1148.
  - `filter_normal_code`: :1779.

## `b66692bc`

- **`test_adjust_max_width` matches upstream exactly.** Upstream's test is at `config/mod.rs:702`:
  - `reduce_max_width(usize::MAX)` → `max_width() == 0`.
  - `set().max_width(usize::MAX - 1)`, then `increase_max_width(2)` → `max_width() == usize::MAX`.

  The test has the same two steps, the same comments and the same marker. Under the recorded `usize::MAX =
  Number.MAX_SAFE_INTEGER` decision, `MAX_SAFE_INTEGER - 1 + 2 = 2^53` is exact and is clamped to `USIZE_MAX` by n1's
  `r >= USIZE_MAX` arm. `increase_max_width`/`reduce_max_width` in `create_config.gen.ts` follow config_type.rs:437/:452
  (`delta.min(isize::MAX as usize)`). `Unported` is still imported, and three other tests use it.
- **The guard still rejects what it should.** I appended each probe block to `contract_lib.d.ts` in scratch, ran
  `bun test src/rustfmt/contracts.test.ts`, and reverted. Baseline: 5 pass.

  | Probe block | Result |
  |---|---|
  | `../rustc_span/zz_probe.ts*` (not rustfmt, not vendor) | **fails** N3 (the spec regex) |
  | `../rustfmt/utils.ts*` (stale, module exists) | **fails** N3 (`exists: true`) |
  | `../vendor/unicode_ident/lib.ts*` (stale vendor, module exists) | **fails** N3 (`exists: true`) |
  | `../../vendor/zz/lib.ts*` (wrong depth) | **fails** N3 (the spec regex) |

  The regex change adds only the `vendor\/\w+` alternative. The `rustfmt` branch and the existence check are unchanged. The
  new wrong-depth probe imports `../rustfmt/visitor.ts` from `config/` and still yields exactly the one violation.

## Findings

1. **(note, follow-up; predates this branch) The guard does not detect duplicate blocks.** A second
   `declare module "../rustfmt/parse/session.ts*"` block passes `contracts.test.ts` (5 pass). That duplicate is exactly the
   hazard behind contract-3 N1: TypeScript lets one block win silently. A duplicate `visitor.ts*` block fails, but only by
   accident, because the wrong-depth probe's expected list then gets a second line. tsc catches a duplicate only when the
   losing block's members are used. Today's file has no duplicates (`uniq -d` is empty), and `b66692bc` did not weaken this
   (contract-3 N6 already noted the gap). Suggestion: add a uniqueness assertion over `contract_blocks()` names to
   `contracts.test.ts` in the next batch that touches it.
2. **(nit) The `CharClasses` comment in `contract_lib.d.ts` names one caller.** It says "the comment lane picks the final
   shape and adjusts utils.ts's call". formatting.ts:602 is a second caller with the same `string_chars(text)` argument. The
   comment lane's brief should name both.
3. **(nit) `contracts.test.ts:154` has escaped quotes in a line comment** (`root decision \"rustfmt crate-wide rules\" (4)`).
   This is cosmetic only.
4. **(info) Contract-2 and contract-3 were built on rustfmt-contract-1 at `4ec25456`, before its review fixes
   (`d8dfcac8`).** Their merges are clean and tree-identical, and tsc is clean against `d8dfcac8`'s shapes. Nothing to do.

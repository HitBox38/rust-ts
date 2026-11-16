# Review: rustfmt-contract-2 (rewrite.rs, utils.rs, spanned.rs, source_map.rs)

Reviewer: independent, read-only (AGENTS.md §1). Reviewed: `git diff 298d6319 874d0dbc` on `t3/port-rustfmt-contract-modules`,
handoff `docs/handoff/rustfmt-contract-2.md`, root's "rustfmt-contract-1 PORT decisions" (history 2026-11-16T02:30). Upstream read
in full: `$RUST_TS_DATA/rust/src/tools/rustfmt/src/{rewrite,utils,spanned,source_map}.rs`, plus `comment.rs:1143-1350,1556,1779`,
`visitor.rs:35-48`, `macros.rs:59`, `items.rs:2451,2471`, `parse/session.rs:284` for the contract blocks. All checks ran in a
scratch worktree at `874d0dbc` under `$RUST_TS_DATA/tmp/review-rustfmt-contract-2/` (deleted afterwards).

## Verdict: PASS WITH NOTES

The port is faithful. Function order and logic match upstream, apart from one ordering slip (N5). Every offset that leaves a
function is a UTF-8 byte offset, as upstream, and the non-ASCII cases I wrote myself come out right. All checks pass. Nothing
blocks merging. Two things must happen at integration:
- `d8dfcac8`'s guard fails on this lane's vendor blocks (N1). The fix is one line in the guard plus a probe fix, tested.
- `contract_lib.d.ts` conflicts with rustfmt-contract-3 (N2). The union of the two is tested and type-checks.

PORT 1 and PORT 5 are workable, but PORT 5 needs a root decision because it departs from PORTING §5 (N3). The fill-lane briefs
need two rules from PORT 1 (N4).

## Basics (item 6)

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check` | markers ok |
| `coverage.ts --missing` rewrite / utils / spanned / source_map | 21/21, 59/59, 17/17, 13/13 |
| `bun tools/codegen/rustfmt.ts --check` | clean (8 files, 35 types, …) |
| `bun tools/codegen/rustfmt_oracle.ts check` | ok, matches the oracle's expansion |
| `bun test src/rustfmt` | 43 pass, 0 fail, 0.9 s (D13: ≤ 10 s) |
| `bun test src/std/result.test.ts` | 3 pass |
| environment reads in the lane's tests and helper | none (`process.env`/`Bun.env`/`var_os`: no hits) |
| skips / todo | none: the "Unported until X lands" tests return early after an assertion, so they are not skips |

## Findings

**N1. The `d8dfcac8` guard rejects the vendor blocks. The fix belongs to root at integration.** I merged `d8dfcac8` into the scratch
copy. The merge was clean, with no textual conflict. `bun test src/rustfmt/contracts.test.ts` then gave 3 pass and **2 fail**:
- `N3: contract_lib.d.ts blocks name missing modules as ../rustfmt/<path>` fails on `../vendor/unicode_width_0_1/lib.ts`, and would
  fail on `../vendor/bytecount/lib.ts` next. The regex `/^\.\.\/rustfmt\/[\w/]+\.ts$/` allows only rustfmt blocks.
- `N3: every import a contract block matches resolves to the block's module`. The real-tree assertion (line 162) **passes**. The
  self-check probe (lines 164-165) fails: it hard-codes `../rustfmt/utils.ts`, and this lane deleted that block correctly because
  utils.ts now exists. With no block to match, the probe finds nothing.

The N8 test passes: only test files import `*.test_support.ts`. The N2 tests pass too.

Recommended resolution, tested on the merged tree (`bun test src/rustfmt` 51 pass, `tsc` clean):
- Widen the name check to `/^\.\.\/(rustfmt|vendor\/\w+)\/[\w/]+\.ts$/`. `contract_violations` already resolves a vendor block from
  `src/rustfmt/` to the right file (`src/vendor/<crate>/lib.ts`), so a wrong-depth import is still caught. The existence check still
  forces the block's deletion once vendor-fmt-small lands.
- Point the probe at a block that still exists (`../rustfmt/comment.ts`). Better still, take it from `blocks[0]`, so the next lane
  that deletes a block does not break the probe again.
- Do not move the vendor blocks to a third `.d.ts`: the guard reads only `contract_lib.d.ts` and `contract.gen.d.ts`, so such blocks
  would go unchecked.

`contracts.test.ts` belongs to lane 1. The change goes in root's integration commit, or in the integration of whichever lands second.

**N2. Integration with rustfmt-contract-3 (`d554e217`): the shapes fit, and only the contract file conflicts.** A trial merge of
`d554e217` on top of the above conflicts only in `src/rustfmt/contract_lib.d.ts`. The two lanes declare different members of the same
blocks:

| Block | Lane 2 | Contract-3 |
|---|---|---|
| `comment.ts` | `is_commented_string`, `filter_normal_code`, `FindUncommented_str` | `is_comment` |
| `parse/session.ts` | `lookup_line_range` | `new`, `ignore_file`, and the rest |
| `visitor.ts` | `span_to_snippet` and the six `SpanUtils` methods | `entire_snippet`, `start_pos`, `end_pos`, `FmtVisitor` |

`CharClasses` also differs:
- contract-3 declares the generic `CharClasses<T>` with `new<T>(base: Iterable<T>)`;
- lane 2 declares `new(base: Iterator<number>)`.

I resolved the conflict as follows:
- took contract-3's file;
- deleted its now-stale `utils.ts` and `rewrite.ts` blocks;
- added lane 2's members to the comment, session and visitor blocks;
- appended lane 2's macros, items and vendor blocks;
- kept the generic `CharClasses<T>`.

Result: `tsc` clean, `bun test src/rustfmt` **73 pass**. That confirms three things:
- contract-3's real `SkipContext` (a class, `skip.ts:18`) fits `RewriteContext.skip_context`;
- contract-3's `utils.ts` block (`contains_skip`, `count_newlines`, `indent_next_line`) matches the real `utils.ts` signatures;
- `string_chars` satisfies the generic `CharClasses`.

Recommendation: keep the generic `CharClasses<T>`. It is closer to upstream's `CharClasses<T: Iterator>`, and `find_uncommented`
needs `char_indices()` items too.

The other declared shapes match upstream:
- `FullCodeCharKind`'s 10 variants, in order (comment.rs:1275);
- `is_string` :1322, `is_commented_string` :1327, `CharClasses` :1211/:1346, `LineClasses` :1556, `filter_normal_code` :1779;
- `FindUncommented for str` :1148, which returns `i - pat.len()` from `char_indices`, so a byte offset as the block says;
- `MacroArg` (macros.rs:59, 5 variants, `Box<T>` as `T`);
- `span_lo_for_param` and `is_named_param` (items.rs:2451, :2471);
- `SnippetProvider::span_to_snippet` (visitor.rs:45, returns `Option<&str>`);
- `LineRangeUtils for ParseSess` (session.rs:284).

**N3. PORT 5 (rustfmt text as a JS `string`) needs a recorded root decision.** It departs from PORTING §5's table: text that is
"byte-offset-indexed" should be `Str`. Lane 1 started this in `lib.ts`, and its review accepted the individual call sites
(`docs/reviews/rustfmt-contract-1.md:76`). But no recorded decision makes it the crate-wide rule, and this lane's handoff now asks
every fill lane to follow it.

It is workable, and this lane's own handling is right (N6). The cost is that each fill lane reasons call site by call site about
whether a cut "lands next to ASCII". comment.rs, string.rs and lists.rs slice by byte offsets constantly.

Recommendations:
- Record the decision.
- Move the byte helpers into one shared, tested place, so fill lanes do not reinvent them. That covers `str_from_byte` (now private
  to source_map.ts) and byte-offset `find`/slice helpers. If the place is `src/std`, it needs its own batch (PORTING §1).
- Perf only, not correctness: `str_from_byte` re-encodes the whole snippet on every call, so the `span_after_last` and
  `span_before_last` loops are O(n²) in the snippet length.

**N4. PORT 1 (impl tables over `Self`) is consistent with `src/` and is not a redesign. It has one sharp edge that the fill-lane
briefs must spell out.**

It follows the established pattern:
- `src/` has 183 `export const <Trait>_<Type>: <Trait><…>` tables (`UnifyKey_TyVidEqKey`, `UnifyValue_*`, …);
- rustc_attr_ir's `PrintAttribute<T>` (pretty_printing.ts:3) does the same, including generic impls as factories;
- `<Trait>_provided` is PORTING §8's rule.

The edge: because `P<T>`/`Box<T>` is `T`, the TS type no longer shows that upstream's receiver was a `P<Expr>`. For such a receiver,
upstream's `x.rewrite_result(..)` picks `impl Rewrite for Box<T>`, whose `rewrite_result` is the **provided** one. That yields
`RewriteError::Unknown` rather than `Expr`'s own detailed error. The lane ports this faithfully (`Rewrite_for_Box`, with a test).
The fill lanes need two rules:
- When upstream's receiver is `P<T>`/`Box<T>`, including through `&P<T>`, call through `Rewrite_for_Box(Rewrite_T)`. Module-level
  constants such as `Rewrite_P_Expr` would avoid building a table per call.
- `Rewrite_provided.rewrite_result` uses `this`, so it must be called as a method of the table, never passed around detached.

PORT 2-4 and 6-11 are faithful and fit PORTING:
- PORT 6: `0u32 - 1` wraps to `lo - 1`. I checked it with no match (expected `lo - 1`).
- PORT 7: the macro bodies are equal to upstream's.
- PORT 8: `format_visibility` and `format_restriction` still map the first segment of a global path before discarding it, as the
  lazy iterator does.

**N5. One function-order slip in rewrite.ts.** Upstream defines `InsideMacroGuard::is_nested` (rs:136) and `Drop::drop` (rs:142)
before `impl RewriteContext` (rs:148-183). The port puts `class InsideMacroGuard` after `RewriteContext`. Fix: move the class above
`RewriteContext`. `enter_macro` refers to it only at run time, so the move is safe.

The rest of the order and logic matches upstream in all four files. I compared:
- every `match` arm: all of `is_block_expr`'s arms and field positions (`Binary._2`, `Index._1`, `Unary._1`, `Yield(Prefix(Some))`),
  `left_most_sub_expr`'s field positions, `semicolon_for_stmt`;
- `trim_left_preserve_layout`'s veto and minimum logic, including the order in which `style_edition()` is read;
- `Spanned for GenericParam`'s `lo`/`hi`/`ty_hi` and `max`, which returns the second argument on a tie, as `std::cmp::max` does;
- `MetaItemInner`, which uses the inherent `span()`, as Rust method resolution does.

All 110 markers point at the right `fn` lines, and no value is guessed.

**N6. UTF-8 handling is correct. I checked it with my own non-ASCII test.** The byte figures that leave a function are:
- `extra_offset` (`utf8_len` of text and prefix);
- `get_prefix_space_width_and_end` (its end case returns `utf8_len`; its early return is past ASCII `' '`/`'\t'` only, so the
  UTF-16 index equals the byte index);
- `find_uncommented`, which the contract defines as bytes;
- every `span_*` helper, which adds `utf8_len(needle)` and slices by bytes.

The UTF-16 uses give the same results:
- `last_line_width`'s slice after `'\n'`, and its `prefix_end` slice;
- `trimmed_last_line_width`;
- `count_lf_crlf`: each byte and each code unit of a non-ASCII char takes the `_` arm;
- `last_line_extendable`: surrogates are neither listed nor whitespace;
- `is_empty_line`: every `White_Space` char is in the BMP.

My test was a reviewer scratch file, since deleted. It mocked `unicode_width_0_1` with `src/vendor/unicode_width`, gave `comment.ts`
a naive stand-in whose `find_uncommented` returns `utf8_len` of the prefix, and gave `visitor.ts` a `SnippetProvider` stand-in. With
`é` and `漢`, every result equalled the value computed by hand from upstream:
- `last_line_width("ab\n  é漢x", 4)` = 6
- `last_line_width("ab\n\t漢", 4)` = 6
- `first_line_width`, `trimmed_last_line_width`, `last_line_used_width`, `filtered_str_fits`, `count_newlines("é\n漢\n")` = 2
- on snippet `"é,漢,x"` at lo 10: `opt_span_before` = 12, `span_after` = 13, `span_after_last` = 17, `span_before_last` = 16, and
  `span_before_last` with no match = `lo - 1` = 9.

All 3 tests passed.

**N7. Leaving `str_from_byte` `unported` at a non-boundary offset is acceptable.** The branch is unreachable while `find_uncommented`
is faithful. The offset is always a match start plus `needle.len()`, or upstream's suffix case `self.len() - pat.len()`, so it always
falls on a char boundary.

The only faithful alternative is std's slice-panic text ("byte index N is not a char boundary; it is inside …"). No helper produces
it: `src/std/str.ts:83` throws a different message. Calling `unported` instead of guessing that text follows the rule.

Caveat: if the comment lane's `find_uncommented` returned UTF-16 offsets by mistake, the error would surface here as UNPORTED, not
as a mismatch. The comment lane's brief should require a non-ASCII test of `find_uncommented`'s byte offsets.

**N8. The tests are sound, but they leave a gap until the vendor and comment modules land.** The two upstream `utils.rs` tests assert
`Unported` while `comment.ts` is missing, then run upstream's assertion unchanged. That is sound:
- it is not a skip;
- it switches per module;
- if `comment.ts` lands incomplete, the test fails rather than passing silently.

Mutations I injected into `utils.ts`, one at a time, each reverted afterwards:

| Mutation | Lane suite (43) | Reviewer test |
|---|---|---|
| M2 `extra_offset` drops the `+ 1` | **caught** | — |
| M3 `mk_sp_lo_plus_one` adds 2 | **caught** | — |
| M1 `last_line_width` keeps the `'\n'` in the last line | survives | **caught** |
| M4 `trim_left_preserve_layout` ignores `min_prefix_space_width` | survives | **caught** |

M1 and M4 survive the lane's suite because the width and comment functions are stubbed. M4 will also be caught by upstream's
`test_trim_left_preserve_layout` once `comment.ts` exists. `spanned.ts` has no executed test.

Recommendation: vendor-fmt-small's brief should add tests of `first_line_width`, `last_line_width`, `trimmed_last_line_width` and
`filtered_str_fits` on non-ASCII text when it lands. Do not use 0.2's widths as a stand-in now: unicode-width 0.1.14 and 0.2 differ
on some code points.

**N9. The test helper `contract_stubs.test_support.ts` is test-only and retires itself.**
- Only `utils.test.ts` imports it.
- `d8dfcac8`'s N8 check passes on the merged tree.
- Each stub is installed only while `existsSync(<module>)` is false, with the specifiers resolved exactly as utils.ts spells them,
  so each stub turns off when its own module lands.
- `mock.module` is process-wide, but it stubs only modules that do not exist, so it cannot shadow a real one. The 73-test merged run
  with contract-3, whose `formatting.ts` also imports `utils.ts`, passed.

## For root

1. At integration with `d8dfcac8`: apply N1's guard fix: the regex widening, plus a probe that does not depend on one block.
2. At integration with rustfmt-contract-3: resolve `contract_lib.d.ts` as the union in N2, keeping the generic `CharClasses<T>`, and
   delete the `skip.ts`, `utils.ts` and `rewrite.ts` blocks.
3. Record PORT 1 and PORT 5 as decisions (N3, N4), including the two `Rewrite_for_Box` and detached-`this` rules for fill-lane
   briefs. Queue shared byte-offset helpers for a reviewed batch.
4. Optional: the lane, or root, moves `InsideMacroGuard` above `RewriteContext` (N5).
5. Briefs:
   - comment lane: a non-ASCII byte-offset test of `find_uncommented` (N7);
   - vendor-fmt-small: width-helper tests on non-ASCII text (N8).

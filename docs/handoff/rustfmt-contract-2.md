# Handoff: rustfmt-contract-2 (M8 wave 41; second of three chained `rustfmt-contract` lanes)

Plan: `docs/plan-m8.md` §3, D4, D13, D14; `docs/handoff/rustfmt-contract-1.md`; root's "rustfmt-contract-1 PORT decisions".
Branch `t3/port-rustfmt-contract-modules`, from main `e1fca355`, with `t3/rustfmt-contract-port` (`4ec25456`, rustfmt-contract-1)
merged as the first commit (`298d6319`, a real merge). No `upstream.ts fetch`, no heavy build. Nothing outside `src/rustfmt/` was
edited, apart from this file.

## What this lane took

| Upstream (`src/tools/rustfmt/src/`) | TS | Coverage (`coverage.ts --missing`) |
|---|---|---|
| `rewrite.rs` (184 lines) | `rewrite.ts`, `rewrite.test.ts` | 21/21 |
| `utils.rs` (798 lines) | `utils.ts`, `utils.test.ts` | 59/59 (both upstream tests included) |
| `spanned.rs` (206 lines) | `spanned.ts` | 17/17 |
| `source_map.rs` (82 lines) | `source_map.ts` | 13/13 |

Also:
- `contract_lib.d.ts`: the `utils.ts` and `rewrite.ts` blocks are deleted; blocks changed and added are listed below.
- `contract_stubs.test_support.ts`: a test helper, not ported code (see "Tests").

`bun scripts/coverage.ts`: crate `rustfmt` 329/1595, up from 219.

## Checks

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok.
- `bun tools/codegen/rustfmt.ts --check`: clean. No generated code imports these four modules, so nothing was regenerated.
- `bun tools/codegen/rustfmt_oracle.ts check`: ok.
- `bun test src/rustfmt`: 43 pass, 0 fail, about 0.9 s wall (30 before this lane, so 13 new). That is within D13's 10 s.
- `bun test src/std/result.test.ts src/std/panic.test.ts src/std/fmt.test.ts tools/codegen/rustfmt.test.ts`: 17 pass. These include
  the src-wide scanners.
- No difftest: no suite runs rustfmt yet (D12).

As in lane 1, the worktree has a copy of `.env.local` and a `node_modules` symlink to the main checkout. Both are gitignored.

## Tests

`utils.rs`'s two `#[cfg(test)]` tests (`:783 test_remove_trailing_white_spaces`, `:789 test_trim_left_preserve_layout`) are in
`utils.test.ts` with markers. Both go through comment.rs (`CharClasses`, `LineClasses`). While that module is missing they assert that
the port stops `Unported` there. Once it lands they run upstream's assertion unchanged, with no edit needed. `rewrite.rs` has no
upstream tests.

The other tests are marked "not upstream":
- `utils.ts`: `extra_offset`'s byte arithmetic on non-ASCII text, `count_lf_crlf`, the line predicates, the keyword formatters,
  `colon_spaces` over the four `space_*_colon` settings, `mk_sp` and `mk_sp_lo_plus_one`.
- `count_newlines` and `unicode_str_width`: they assert `Unported` while their vendor crates are missing, and check values once the
  crates exist.
- `rewrite.ts`: Display and Debug of `MacroErrorKind` and `RewriteError` (span Debug through rustc_span's no-source-map fallback),
  `RewriteErrorExt_Option`, the provided `rewrite_result` and the Box impl's dispatch, and `RewriteContext`'s `budget`,
  `use_block_indent`, `enter_macro`/`InsideMacroGuard`/`leave_macro`, `snippet`.

`utils.ts` value-imports modules that do not exist yet. `install_contract_stubs()` uses `mock.module` to register a stand-in for each
missing module, and each stand-in stops with `unported("<lane>: …")`. The modules are `../rustfmt/comment.ts`,
`../vendor/unicode_width_0_1/lib.ts` and `../vendor/bytecount/lib.ts`. It uses the same pattern as lane 1's serde helper, and like it
installs a stub only while its file is missing. Delete the helper once those three modules exist.

`spanned.ts` and `source_map.ts` have no tests. They load only once `items.ts` and `visitor.ts` exist, and upstream has none.

## Contract blocks (`contract_lib.d.ts`)

| Block | Change | Owner (deletes it) |
|---|---|---|
| `../rustfmt/utils.ts*`, `../rustfmt/rewrite.ts*` | **deleted** (the modules exist) | — |
| `../rustfmt/comment.ts*` | **changed**: `FullCodeCharKind` is now the real 10-variant string union, with a companion holding `is_string` and `is_commented_string`. Added `CharClasses.new(chars)` (an iterable of `[kind, char]`), `filter_normal_code`, and `FindUncommented_str.find_uncommented(s, pat)`, which returns a **UTF-8 byte offset** | comment lane |
| `../rustfmt/parse/session.ts*` | **added**: `ParseSess` with `lookup_line_range(span): LineRange` (`impl LineRangeUtils for ParseSess`, session.rs:284) | parse lane |
| `../rustfmt/skip.ts*` | **added**: `SkipContext` (opaque class, a field of `RewriteContext`) | **rustfmt-contract-3** |
| `../rustfmt/visitor.ts*` | **added**: `SnippetProvider` with `span_to_snippet(span): string \| undefined`, plus the six `SpanUtils` methods source_map.ts attaches | visitor lane |
| `../rustfmt/macros.ts*` | **added**: `MacroArg` (tagged union; `Box<T>` is `T`) | macros lane |
| `../rustfmt/items.ts*` | **added**: `span_lo_for_param`, `is_named_param` | items lane |
| `../vendor/unicode_width_0_1/lib.ts*` | **added**: `UnicodeWidthStr.width(s)` (unicode-width **0.1.14**, plan-m8 D7, the same shape as `src/vendor/unicode_width`) | vendor-fmt-small |
| `../vendor/bytecount/lib.ts*` | **added**: `count(haystack: Uint8Array, needle: number): number` (bytecount 0.6.9) | vendor-fmt-small |

Blocks left from lane 1, unchanged: `emitter.ts`, `formatting.ts` (rustfmt-contract-3), `modules.ts`, `parse/parser.ts`,
`format_report_formatter.ts`, `rustfmt_diff.ts`.

**Merging with rustfmt-contract-3.** That lane creates `skip.ts`, after which the `skip.ts` block is inert. Root deletes the block at
integration and checks that its `SkipContext` type fits `RewriteContext.skip_context`. If contract-3 imports utils or rewrite names
through blocks of its own, those blocks become inert too.

The specifiers `../rustfmt/utils.ts` in `lib.ts` and `../rustfmt/rewrite.ts` in `shape.ts` now resolve to the real files. I did not
rewrite them to `./`, so as not to conflict with contract-3's edits to `lib.ts`. Root may do that at integration.

## Load order

- `source_map.ts` is an extension module (PORTING §5). It sets `SnippetProvider.prototype.span_after` and the other five `SpanUtils`
  methods, and declares them through `declare module "../rustfmt/visitor.ts"`. That augmentation has no effect while `visitor.ts` is
  missing (checked), and it applies once that file exists.
- When `visitor.ts` lands, the crate root (`lib.ts`) must `import "./source_map.ts"` after it, and `visitor.ts` must not import
  `source_map.ts`.
- `spanned.ts` loads once `items.ts` exists. Nothing imports it yet.

## `unported(...)` left

| Where | What |
|---|---|
| `source_map.ts` `str_from_byte` | `rustfmt source_map.rs: str slice panic off a char boundary or past the end`. Upstream panics with std's slice message; the offsets come from `find_uncommented` plus `needle.len()`, so they sit on boundaries. |
| `contract_stubs.test_support.ts` | `comment lane: …`, `vendor-fmt-small: …` (stubs, tests only) |

No other `unported` calls. The functions whose bodies reach a contract-only module (`unicode_str_width`, `count_newlines`,
`filtered_str_fits`, `remove_trailing_white_spaces`, `trim_left_preserve_layout`, `indent_next_line` through comment.rs, all of
`spanned.ts`/`source_map.ts`) are ported in full. They run once those modules exist.

## `// PORT:` decisions (for root to record)

1. **Traits implemented on AST types are impl tables over `Self`**, as rustc_attr_ir's `PrintAttribute<T>` is.
   - `Rewrite<T>` has `rewrite(self, context, shape)` and `rewrite_result(self, context, shape)`, and `Spanned<T>` has `span(self)`.
     `x.rewrite(ctx, shape)` becomes `Rewrite_X.rewrite(x, ctx, shape)`, and `x.span()` becomes `Spanned_X.span(x)`, with impls named
     `Rewrite_<Type>` and `Spanned_<Type>`.
   - The provided `rewrite_result` lives in `Rewrite_provided` (PORTING §8): an impl that does not override it assigns
     `rewrite_result: Rewrite_provided.rewrite_result`.
   - The `Box<T>` impls are factories (`Rewrite_for_Box(inner)`, `Spanned_for_Box(inner)`). As upstream, Box's `rewrite_result` is the
     provided one over the box's `rewrite`, not `T`'s own override. A test covers this.
   - The fill lanes must follow this convention.
2. **`RewriteErrorExt`'s one impl is `Option<T>`**. It is `RewriteErrorExt_Option.max_width_error(opt, w, span)` and so on, with the
   interface written for that `Self`. `From<ExceedsMaxWidthError>` is `RewriteError.from(e)`. `ExceedsMaxWidthError` stays a
   data-only interface, because shape.ts builds it as an object literal. `RewriteError`'s Display is thiserror's text, written out.
3. **`RewriteContext`**:
   - `Cell<bool>` fields are plain mutable fields.
   - `inside_macro: Rc<Cell<bool>>` is a shared `MutRef<boolean>`, since the guard and every clone share it. `skipped_range:
     Rc<RefCell<Vec<…>>>` is a shared array.
   - The derived `Clone` is not written: nothing in rustfmt clones a `RewriteContext`, and derives belong to tools/codegen.
   - `InsideMacroGuard`'s `Drop` is `drop()`, which callers invoke where the guard leaves scope, as lib.ts's `Session` does.
4. **Field/method clashes** follow lane 1's PORT 5: the method gets the `_`. They are `inside_macro_()`, `is_if_else_block_()` and
   `is_loop_block_()`; the fields keep their names.
5. **Text and byte offsets.**
   - rustfmt text stays a JS `string` (lib.ts's choice). Wherever upstream's `usize` offset into a `&str` leaves a function, it is the
     UTF-8 byte offset:
     - `extra_offset` uses `utf8_len`.
     - `find_uncommented` returns bytes.
     - `span_after*` and `span_before*` add bytes to `BytePos`, and slice by byte offset (`str_from_byte`).
     - `get_prefix_space_width_and_end` returns `s.len()` in bytes.
   - A UTF-16 index is used only where the cut lands next to ASCII, so the slice is the same. This applies to `last_line_width`'s
     prefix, `rfind('\n')` in `trimmed_last_line_width`, and the `splitn`/`rsplitn` calls.
   - `count_lf_crlf`, `last_line_extendable` and `is_empty_line` walk UTF-16 code units. The comments give the reason the result is
     the same.
   - `SnippetProvider::span_to_snippet` is declared as returning `string`. **The visitor and comment lanes must keep these
     conventions**, or change the call sites here.
6. **u32 wrapping in `span_before_last`.** rustfmt ships without overflow checks (lane 1's PORT 8), so `offset as u32 - 1` with no
   match (`offset == 0`) gives `lo - 1`. The port computes this explicitly (`>>> 0`). The other `BytePos` sums use `BytePos.add`, as
   rustc_span does.
7. **Local `macro_rules!` written as functions.**
   - `source!` is `source(this, sp)`, and `out_of_file_lines_range!` is `out_of_file_lines_range(self, span)` over `{ config, psess }`.
   - `span_with_attrs_lo_hi!` and `span_with_attrs!` are module-local functions. `implement_spanned!` is a generic factory: one call
     per invocation, with its marker at `:46`.
   - `skip_out_of_file_lines_range_err!` and `skip_out_of_file_lines_range_visitor!` `return` from their caller, so each use site
     writes them out. utils.ts has a comment giving the two-line expansions.
8. **`itertools::join`** is inline (plan-m8 D7). The lazy `segments.iter().map(rewrite_ident)` in `format_visibility` and
   `format_restriction` keeps its evaluation: `next()` on a global path still maps the first segment (`context.snippet`) before
   skipping it, and an empty global path panics with upstream's `expect`/`panic!` text.
9. **`NodeIdExt`**: a static trait fn with one impl, so `NodeId::root()` is `NodeIdExt_NodeId.root()`.
10. **`filter_attributes`'s `.cloned()`** is the generated `clone_Attribute`. **`ptr_vec_to_ref_vec`** is a shallow copy.
11. **`CharClasses::new(text.chars())`** takes an iterator of chars (code points), from a local `string_chars` generator. The comment
    lane owns `CharClasses`'s final generic shape (`RichChar`), and adjusts this one call if it differs.

## For root

- Record PORT 1–11, especially 1 and 5, which every fill lane uses.
- At integration with rustfmt-contract-3:
  - delete the `skip.ts` block;
  - optionally rewrite lib.ts's and shape.ts's `../rustfmt/{utils,rewrite}.ts` specifiers to `./`.
- The visitor lane's brief needs three things:
  - `lib.ts` imports `./source_map.ts` after `./visitor.ts`;
  - `span_to_snippet` returns a `string`;
  - `SnippetProvider` must not import `source_map.ts`.
- The comment lane's brief needs `find_uncommented` to return a byte offset, plus the `CharClasses`/`LineClasses`/
  `FullCodeCharKind` shapes in its block. It deletes the block when it lands.
- vendor-fmt-small's brief needs the paths and shapes in the last two blocks: `src/vendor/unicode_width_0_1/lib.ts`
  `UnicodeWidthStr.width`, and `src/vendor/bytecount/lib.ts` `count`.
- Delete `contract_stubs.test_support.ts` once comment.ts, unicode_width_0_1 and bytecount exist.

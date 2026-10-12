# Handoff: annotate-b (vendor annotate-snippets 0.12.16 `src/renderer/render.rs` + oracle probe)

## Evidence
- **Oracle (committed test).** `src/vendor/annotate_snippets/oracle.test.ts` runs the new `annotate` probe. Build it with
  `bun scripts/probes.ts build annotate`. The probe uses annotate-snippets =0.12.16 with features `simd` and `std`
  (rustc's), anstyle =1.0.13, memchr =2.8.0, unicode-width =0.2.2, serde_json =1.0.145, and is built `--release`.
  - It reads a deterministic corpus from `tools/probes/annotate/corpus.ts` on stdin and renders every case with
    `Renderer::plain()` and with `Renderer::styled()`, each configured with the case's `term_width`,
    `anonymized_line_numbers`, `decor_style` and `short_message`. Those are exactly the options rustc's
    `AnnotateSnippetEmitter::renderer` sets.
  - **877 cases / 1754 renders: 1754 match byte-for-byte, 0 mismatches.** 12 renders (6 cases) panic on both sides as
    expected: no group, no title, span out of range, and similar.
  - Corpus breakdown:
    - 77 hand-written cases in rustc's shapes: titles with id/url, ICE `with_name`, `no_name` failure notes,
      `secondary_title` with ANSI, unannotated origins with padding and notes, multi-suggestion groups with "and N
      other candidates".
    - 600 seeded random cases.
    - 200 cases with overlapping or unsorted patches.
  - The corpus covers:
    - single-line, multi-line, nested and overlapping annotations; primary, context and visible; labels missing,
      empty, wide or multi-line; `highlight_source`
    - multiple snippets and groups; origins with and without line/col; padding
    - fold on and off; patches that insert, delete, replace, add a line, remove whole lines, are multi-line, are
      whitespace-only, or are in another file or have no path
    - CJK/emoji/tab/ZWJ/ZWSP/control/bidi characters, CRLF and BOM in the source; empty source; annotations at EOF
    - long lines and long spans at term widths 0, 5, 20, 40, 60, 80, 140 and 200; leading-whitespace trimming
    - `line_start` from 1 to 123456789, anonymized line numbers
    - all five levels with custom and no names; Ascii and Unicode decor; short messages
  - Mutation check: changing one comparison in `render_snippet_annotations` (`> 2` to `> 3`) makes 84 renders fail.
  - Line coverage of render.ts under the oracle test is 98.5% (`bun test --coverage`). The only uncovered lines are
    the `debug_LineAnnotationType`/`debug_LineAnnotation`/`debug_UnderlineParts` bodies.
- **Renderer internals.** I re-ran annotate-a's internals mirror (`docs/handoff/annotate-a/internals_*`) with the
  `mock.module` block removed, so it runs against the real render.ts, and compared it with annotate-a's release
  `asprobe2` build. This exercises the render.ts `char_width`, `num_overlap`, `LineAnnotation` and `ElementStyle`
  Debug.
  - Result: 4591/4591 lines identical.
  - annotate-a's 19 known `SubstitutionHighlight` differences are fixed (see the first fix below).
  - The run is scratch-only, in `$RUST_TS_DATA/tmp/annotate-b/internals.test.ts`, because it needs annotate-a's
    patched crate copy.
- **Fn coverage** (own count, method as in `docs/handoff/langid-plural.md`: the `upstreamFns` lexer over the crate
  files against the `// crate:` markers).
  - render.rs: **51/51**, 0 unmarked, 0 bad markers. This includes the 4 `MessageOrTitle` trait declarations, both
    impls (8 fns), and the 3 `#[cfg(test)]` fns in `render.test.ts`.
  - Whole crate: 167/167 (lib, level, snippet, renderer/*).
- Checks:
  - `bunx tsc --noEmit -p .` is clean.
  - `bun test src tools`: 282 pass, 0 fail, and the oracle test actually runs: "annotate oracle: 1754/1754 renders
    match".
  - `bun scripts/coverage.ts --check`: markers ok (1950).
  - `unported(` in render.ts: 0.

## Files
- `src/vendor/annotate_snippets/renderer/render.ts`: the full port, replacing the placeholder. All the exports the
  contract required are kept, plus `newline_count`, `DisplaySuggestion` and `OUTPUT_REPLACEMENTS_for_test`.
- `src/vendor/annotate_snippets/renderer/render.test.ts` (new): the render.rs inline tests
  `ensure_output_replacements_is_sorted`, `ensure_newline_count_correct` and `format_replacements`.
- `src/vendor/annotate_snippets/oracle.test.ts` (new).
- `tools/probes/annotate/{Cargo.toml.in,main.rs,corpus.ts}` (new). `corpus.ts` documents the JSON schema;
  `bun tools/probes/annotate/corpus.ts` prints the corpus.
- Fixes to annotate-a's files:
  - `std_ext.ts`:
    - `isize_as_usize` now returns the exact signed view, and `usize_lt`/`usize_display` were added (see the first
      fix below).
    - New `Lines`, a Rust-exact `str::lines` with `clone`/`count`.
    - New `string_trim`, which is `str::trim` with `char::is_whitespace` on a JS string.
  - `renderer/source_map.ts`: `debug_SubstitutionHighlight` prints with `usize_display`, plus a PORT note on
    `SubstitutionHighlight`.

## Fixes to annotate-a code
1. **Wrapped `isize as usize` in `splice_lines`** (`SubstitutionHighlight.start/end` with overlapping patches).
   - The old code used `x + 2**64`, which is imprecise. The renderer then adds `max_line_num_len + 3` to these
     values, and in Rust that addition wraps back to small columns. With the old code, 20 of 600 styled renders of
     overlapping patches were wrong, and Debug was off in 19 cases.
   - Now the value is kept as the exact signed `isize`, which stands for the usize `x mod 2^64`:
     - Additions are plain `+` and match Rust's wrapping exactly.
     - Debug prints `2^64+x` through BigInt.
     - `style_substitution_highlights` skips a range whose start is ≥ 2^63, and clamps a range whose end is ≥ 2^63
       to the line length. Rust spins through about 2^64 no-op columns there and would hang.
   - Result: 0 diffs on both the render oracle and the internals mirror.
2. `Str.lines()` in src/std strips a final `\r` without `\n`; Rust's `str::lines` does not. render.ts uses its own
   `Lines` (see For root).

## PORT decisions (render.ts)
- **Text.** Byte-indexed text stays `Str`: source lines, `complete`, `Patch.replacement`, `line_to_add`. Every
  `String` that render.rs builds is a JS string iterated by code point: normalized lines, titles, labels,
  `maybe_anonymized`. `label.len()`, `as_str().len()` and `id.len()` use `utf8_len`, which counts bytes as Rust does.
  `str_width` accepts either a `Str` or a `string`.
- **`&mut usize` `row_num`** is a `{ value }` cell.
- **`MessageOrTitle`.** `&dyn MessageOrTitle` becomes the value plus an impl table: `MessageOrTitle<T>`, implemented
  by `MessageOrTitle_for_Title` and `MessageOrTitle_for_Message`, each method marked.
- **Iterator semantics are mirrored where they are observable:**
  - `lines.by_ref().zip(highlights)` pulls a line before it checks `highlights`. When `highlights` runs out, one extra
    line is consumed, which affects the later `lines.next().is_some()` ellipsis.
  - `min_by_key` returns the first minimum.
  - `sort_by_key` is stable (`Array.prototype.sort`).
  - `BTreeMap` `to_add` is drained in key order.
  - `swap_remove`.
  - `unhighlighted_lines.drain(..).next()` empties the vec.
- **`draw_line`.** `code: String` is kept as an array of chars. `&code[bytes_taken..]` skips whole chars whose
  `len_utf8` adds up to `bytes_taken`, which is always a char boundary. The fused `skip_while`/`take_while` loop calls
  the closures in the same order.
- **Integers.**
  - The `usize::MAX` sentinels for the margins are `Infinity`.
  - `num_decimal_digits` uses the 64-bit `MAX_DIGITS = 20`. Its `wrapping_mul` is never reached for values below 2^53.
  - `take(file_lines.len() - 1)` uses `usize_wrapping_sub`.
  - `extra_width_from_tabs` treats a signed-view `n` ≥ 2^63 as "take all".
  - No other subtraction in render.ts can wrap before upstream would panic anyway. I checked each one: `row_num - 1`,
    `width_offset - 2`, `end.display - pad`, `right - left`, and `*row_num -= 2`, which only happens in `Diff` mode,
    where `row_num` ≥ 2 and there is at most one line.
- **`newline_count`.** `simd` is on, so this is the memchr arm (`str_count_byte`). The `not(simd)` arm is a comment;
  it has the same fn line, so no skip marker is needed.
- **Unchanged pieces.** `OUTPUT_REPLACEMENTS` is kept as an ordered table searched with std's binary search, and
  `char_width` keeps upstream's match list. `render_short_message` returns a `Result` that never errors; `render`
  unwraps it.
- **Panics.** Panic messages follow upstream: "Expected at least one group", "Expected a Title", and the `assert!`
  text. Panics from `Str.slice` use src/std's message, which differs from Rust's. The oracle compares only whether a
  render panicked.

## Unported
None in render.ts. There are no `crate-skip` markers in render.rs.

## API contract for the emitter lane (`annotate_snippet_emitter_writer.rs`)
```ts
import { Level } from "src/vendor/annotate_snippets/level.ts";               // Level.ERROR/WARNING/NOTE/HELP/INFO
import { Renderer, DecorStyle, DEFAULT_TERM_WIDTH } from "src/vendor/annotate_snippets/renderer/mod.ts";
import { Annotation, AnnotationKind, Element, Group, Origin, Padding, Patch, Snippet, Title } from "src/vendor/annotate_snippets/snippet.ts";
import { normalize_untrusted_str } from "src/vendor/annotate_snippets/lib.ts";
import { Str } from "src/std/str.ts";

// Levels: Level.ERROR.with_name("error: internal compiler error"), Level.NOTE.no_name()
const title = Title.id_url(Title.id(Level.ERROR.primary_title(msg), "E0308"), url); // or lvl.secondary_title(styled)
let group = Group.with_title(title);                                 // or Group.with_level(level)
const sn = Snippet.annotations(
  Snippet.path(Snippet.line_start(Snippet.source<Annotation>(Str.from(source)), offset_line), filename),
  anns.map((a) => (a.label !== undefined ? Annotation.label(AnnotationKind.span(a.kind, { start: lo, end: hi }), a.label) : AnnotationKind.span(a.kind, { start: lo, end: hi }))),
);
group = Group.element(group, Element.from_Snippet_Annotation(sn));
group = Group.element(group, Element.from_Message(Level.NOTE.message(text)));
group = Group.element(group, Element.from_Origin(Origin.char_column(Origin.line(Origin.path(f), line), col)));
group = Group.element(group, Element.from_Padding(new Padding()));
const sugg = Snippet.patches(Snippet.fold(Snippet.path(Snippet.line_start(Snippet.source<Patch>(Str.from(src)), line), f), fold),
  parts.map(([lo, hi, rep]) => Patch.new({ start: lo, end: hi }, Str.from(rep))));
group = Group.element(group, Element.from_Snippet_Patch(sugg));
Group.is_empty(group);
// Renderer: builders mutate and return the same object
let r = color ? Renderer.styled() : Renderer.plain();
r = Renderer.short_message(Renderer.decor_style(Renderer.anonymized_line_numbers(Renderer.term_width(r, width), ui_testing), decor), short);
const out: string = Renderer.render(r, report /* readonly Group[] */);   // no trailing newline, as upstream
```
- `Snippet` is generic: call `Snippet.source<Annotation>` for causes and `Snippet.source<Patch>` for suggestions.
- Spans are UTF-8 byte ranges into the `Str` source.
- Labels, titles and paths are JS strings.
- `Annotation` is a plain object `{ span, label, kind, highlight_source }`. You can also build it with
  `AnnotationKind.span(kind, range)`.
- `Level` values are shared and immutable; the builders return new objects.
- `Renderer.render` panics (throws `Panic`) exactly where upstream does.

## For root
- **std bug.** `Str.lines()` in `src/std/str.ts` strips a trailing `\r` at EOF when there is no `\n`. Rust's
  `str::lines` only strips `\r` before `\n`: `"a\r".lines()` yields `["a\r"]`. render.ts uses `std_ext.ts`'s `Lines`.
  Fix std, or promote `Lines`.
- **Decision to record.** A `usize` produced by `isize as usize` that can be negative is stored in its exact
  *signed view*: the JS number is the isize, and it means the value mod 2^64. Consumers compare such values with
  `usize_lt` and print them with `usize_display` (BigInt). This replaces `x + 2**64`, which is imprecise. It
  refines the release-wrapping decision.
- **scope.json.** No new vendor crates. serde_json is only a probe dependency.
- **Probe.** `bun scripts/probes.ts build annotate` (release). If it is not built, the oracle test logs
  `SKIP`. The gate machine should build it.
- **Internals probe.** annotate-a's internals probe (patched crate copy, `pub(crate)`→`pub`) could become
  `tools/probes/annotate_internals`. It now has 0 diffs against the real render.ts, so it would make a ready oracle
  test for source_map/styled_buffer/margin.
- **coverage.ts** still ignores `// crate:` markers. The counts above use the scratch counter at
  `$RUST_TS_DATA/tmp/annotate-b/fns.ts`.
- The claim file `docs/claims/wave4-annotate-b.md` can be deleted on integration.

# Handoff: annotate-a (vendor annotate-snippets 0.12.16 except render.rs, anstyle 1.0.13)

## Evidence
- Versions match upstream `Cargo.lock`: annotate-snippets 0.12.16 (deps anstyle, memchr, unicode-width 0.2.2), anstyle
  1.0.13. Features: `compiler/rustc_errors/Cargo.toml` enables `simd` on top of the default `std`. `testing-colors` is off.
  anstyle uses its default `std`.
- Function coverage. `coverage.ts` ignores `// crate:` markers, so I counted with a scratch script that runs the same
  `upstreamFns` lexer over the crate files. Every marker matches an upstream fn (line and name).

  | file | fns |
  |---|---|
  | annotate-snippets `src/lib.rs` | 1/1 |
  | `src/level.rs` | 8/8 |
  | `src/snippet.rs` | 38/38 |
  | `src/renderer/mod.rs` | 26/26 |
  | `src/renderer/margin.rs` | 5/5 |
  | `src/renderer/styled_buffer.rs` | 12/12 |
  | `src/renderer/source_map.rs` | 24/24 |
  | `src/renderer/stylesheet.rs` | 2/2 |
  | `src/renderer/render.rs` | 0/51 (annotate-b) |
  | anstyle `src/color.rs` | 57/57 |
  | `src/effect.rs` | 22/22 |
  | `src/reset.rs` | 5/5 (incl. tests) |
  | `src/style.rs` | 32/32 (incl. tests) |
  | `src/lib.rs`, `src/macros.rs` | 0/0 |

  Total 232/283. Everything except render.rs is 100%.
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (1196). `bun test src/vendor/annotate_snippets
  src/vendor/anstyle`: 16 pass, 0 fail. `bun test src`: 144 pass, 0 fail.
- Oracle evidence. I ran the real crates and diffed their output against the port. Scratch dir: `$RUST_TS_DATA/tmp/annotate-a/`.
  Sources are copied next to this file in `docs/handoff/annotate-a/`.
  1. Public API (`public_probe.rs` vs `public_mirror.ts.txt`). This covers anstyle render, `{:#}` and Debug for every
     `DEFAULT_*_STYLE`, plus 8 composite styles, Ansi/Ansi256/Rgb colors, Effects iteration and Debug, `write_to` and
     `write_reset_to`, Level/Group/Title/Snippet/Origin/Patch Debug (plain and `{:#?}`), and Renderer builders.
     Result: 137 lines, **0 differences**.
  2. Internals (`internals_probe.rs` + `internals_cases.ts` vs `internals_mirror.test.ts.txt`). The probe is a **release**
     build, because rustc ships without overflow checks. It runs against a scratch copy of the crate with `pub(crate)`
     changed to `pub`. It checks 504 fuzzed and hand-written snippets:
     - SourceMap::new and Debug, `span_to_locations`, `span_to_snippet` and `span_to_lines`
     - `annotated_lines`, including the panic message for out-of-range spans
     - `splice_lines` (fold on and off), `is_addition`, `is_deletion`, `is_replacement`, `is_destructive_replacement`,
       `trim_trivial_replacements`
     - `as_substr`: 8 cases
     - Margin: 300 cases
     - StyledBuffer: 60 op scripts, including `render` with styled and plain stylesheets and `replace` panics.

     The TS side needs render.rs, so the mirror swapped in scratch-only straight ports of `char_width`, `num_overlap`,
     `color_spec` and the render.rs Debug impls via `mock.module`. These are not committed. Result: 4591 lines.
     The only differences are about 19 `SubstitutionHighlight` values where a negative `isize` is cast to `usize`. This
     only happens with overlapping patches. Rust prints 2^64−k exactly; a JS number cannot hold that value (see the PORT
     notes below). No other differences.
  The committed unit tests use expected values taken from these runs.

## Files
New, all under my ownership:
- `src/vendor/anstyle/{lib,color,effect,reset,style}.ts`, `src/vendor/anstyle/anstyle.test.ts`
- `src/vendor/annotate_snippets/{lib,level,snippet,std_ext}.ts`, `src/vendor/annotate_snippets/annotate_snippets.test.ts`
- `src/vendor/annotate_snippets/renderer/{mod,margin,styled_buffer,source_map,stylesheet}.ts`
- `src/vendor/annotate_snippets/renderer/render.ts`: a **placeholder** with no markers, which annotate-b replaces
- `docs/handoff/annotate-a.md` (this file) and `docs/handoff/annotate-a/*` (probe sources)

## Unported
- All of `renderer/render.ts`. These are placeholders that call `unported("annotate_snippets::renderer::render::<item>")`:
  - `render`, `char_width`, `num_overlap`, `normalize_whitespace`
  - `ElementStyle.color_spec`
  - `LineAnnotation.{is_primary,is_line,len,has_label,takes_space}`
  - `debug_{ElementStyle,LineAnnotation,LineAnnotationType,UnderlineParts}`

  As a result these paths throw Unported until annotate-b lands:
  - `normalize_untrusted_str`, `Renderer.render`
  - `SourceMap.span_to_locations`, `annotated_lines`, `splice_lines`
  - `StyledBuffer.render`, and Debug of `StyledChar` and `AnnotatedLineInfo`
- There are no other `unported(...)` calls.
- anstyle files not ported: none. `macros.rs` only contains `escape!`. Its expansions are written out as literals with
  the macro call in a comment.
- Skipped fns: the four anstyle `print_size_of` tests only `dbg!` Rust type sizes. They are marked
  `// crate-skip: anstyle-1.0.13/src/<file>:<line> print_size_of`, a new marker form (see For root).

## PORT decisions
- **Struct shapes.**
  - Rust allows a method to share a field's name; a TS class does not. Structs with such clashes become a
    readonly/mutable interface plus a same-named companion const whose methods take `self` first:
    - annotate-snippets: `Group`, `Title`, `Snippet`, `Annotation`, `Origin`, `Renderer`
    - anstyle: `Style`, and `Stylesheet` (for consistency)
  - Builders that take `mut self` (moved, not `Copy`) update `self` in place and return it.
  - Structs without clashes stay classes: `Level`, `SourceMap`, `MultilineAnnotation`, `TrimmedPatch`, `CursorLines`,
    `Margin`, `StyledBuffer`, `Ansi256Color`, `RgbColor`, `DisplayBuffer`, `NullFormatter`, `EffectIter`,
    `EffectIndexIter`, `Reset`, `Padding`.
- **`Copy` value types are readonly objects and never mutated in place**: `Style`, `Stylesheet`, `Loc`, `StyledChar`,
  `Range`, `SubstitutionHighlight`. Where upstream writes a field, the port builds a fresh object:
  - `hi.display += 1` and `prev_hi.char = 0`
  - `self.stylesheet.error = s`
  - `*s = style` in `set_style`

  A `Loc` may therefore be shared; for example, `span_to_locations` returns `[start, start]` for an empty span.
- **`Effects(u16)`** is a branded number, with consts and methods on `Effects`. Operator impls become named functions:
  `bitor`, `sub`, and `bitor_assign`/`sub_assign`, which take a `{ value }` cell.
- **Text.**
  - `Str` is used for byte-indexed text: `Snippet.source`, `Patch.replacement`/`TrimmedPatch.replacement`,
    `LineInfo.line`/`AnnotatedLineInfo.line`, and `SplicedLines[0]`.
  - Every other `Cow<str>` is a `string`: titles, labels, paths, ids, message text, and `Level` names.
  - `StyledBuffer` string parameters are JS strings iterated by code point.
  - `impl Into<Cow<str>>` parameters take the target type. `impl Into<OptionCow>` parameters take `string | undefined`.
    `impl Into<Element>`/`impl Into<Color>` parameters take an `Element`/`Color`, built with `Element.from_*`/`Color.from_*`.
- **Display.**
  - `impl Display for T` becomes `fmt(f: Fmt): string`. On companion consts this is `Style.fmt(s, f)`. `{x}` passes
    `PLAIN` and `{x:#}` passes `PRETTY` (from src/std/fmt.ts).
  - `render*()` returning `impl Display + Copy` returns the rendered string. Those values ignore all formatter flags;
    upstream's `no_align` tests check exactly this.
  - `&mut dyn io::Write` becomes the `Write` interface in anstyle/lib.ts (`write_all` only; the error type is opaque).
- **Other conversions.**
  - `str: &mut String` becomes a `{ value: string }` cell. `Result<(), fmt::Error>` becomes `Result<undefined, never>`.
  - `Level.name: Option<Option<Cow>>` becomes `{ $: "Some", _0: string | undefined } | undefined`.
  - `Level::ERROR` etc. are static class fields, and the module consts `ERROR`..`HELP` alias them. Both are placed
    after the class, because the class must exist before its instances.
- **Integer arithmetic matches a release build.** `usize_wrapping_sub` is used where upstream's `a - b` can underflow:
  - Margin: `label_right - span_left` and `span_right - span_left` (tested against the oracle)
  - `span_to_locations`: `span.start - start_byte`
  - `splice_lines`: the `replaced_highlights` index

  `isize as usize` uses `isize_as_usize`. Wrapped values are at least 2^53 and lose precision, but they stay larger
  than every column. This is the only known output difference (Debug of such a `SubstitutionHighlight`).
- **Platform and features.**
  - `cfg!(windows)` in `USE_WINDOWS_COLORS` is read from `process.platform`, because rust-ts runs on the oracle's host.
    `testing-colors` is off.
  - `simd`/memchr is used only by render.rs `newline_count` (see the contract below).
- **Container semantics.**
  - Vecs passed by value are never modified: `splice_lines` sorts its own copy.
  - The `multiline_annotations.clone()` snapshot is a deep copy.
  - `unwrap_or(self.lines.last().unwrap())` evaluates `last` eagerly, as Rust does.
- **Init order.** `StyledChar.SPACE` is a lazy getter, because render.ts ↔ styled_buffer.ts is an import cycle (see
  the contract).
- **std gaps.** `std_ext.ts` (not an upstream file) holds `Range`, `debug_Range`, `debug_Str`, `debug_string`,
  `saturating_sub`, `usize_wrapping_sub`, `isize_as_usize`, and `index` (bounds-check panic). It also has these `str`
  helpers: `str_is_char_boundary`, `str_get`, `str_trim{,_start,_end}`, `str_eq`, `str_strip_{prefix,suffix}`,
  `str_ends_with_byte`, `str_char_count`, `str_nth_char_index`, `str_split_byte`, `str_count_byte`.

## Contract for annotate-b (render.rs)
Replace `src/vendor/annotate_snippets/renderer/render.ts` wholesale. Keep these exports and shapes, which the other
files import:
- `render(renderer: Renderer, groups: Report): string`
- `char_width(ch: number): number`
- `num_overlap(a_start, a_end, b_start, b_end: number, inclusive: boolean): boolean`
- `normalize_whitespace(s: string): string` (JS strings)
- `type LineAnnotationType = { $: "Singleline" } | { $: "MultilineStart" | "MultilineEnd" | "MultilineLine"; _0: number }`.
  The companion const has the frozen singleton `LineAnnotationType.Singleline`; source_map.ts builds the others as
  object literals.
- `class LineAnnotation`:
  - constructor `(start: Loc, end: Loc, kind: AnnotationKind, label: string | undefined, annotation_type, highlight_source: boolean)`
  - mutable public fields (source_map.ts assigns `annotation_type`)
  - methods `is_primary()`, `is_line()`, `len()`, `has_label()`, `takes_space()`
- `type ElementStyle` is `{ $: "<Variant>" }` for the unit variants plus `{ $: "Level"; _0: LevelInner }`. The companion
  const has a frozen singleton per unit variant (mod.ts uses `ElementStyle.UnderlinePrimary`/`UnderlineSecondary`;
  styled_buffer.ts uses `ElementStyle.NoStyle`/`LineNumber`) and `color_spec(self, level: Level, stylesheet: Stylesheet): Style`.
  `StyledBuffer.set_style` compares `style.$` against `"NoStyle"`/`"Quotation"`.
- `interface UnderlineParts`: readonly; `style: ElementStyle`; every other field is a `char` as a number.
- `debug_ElementStyle`, `debug_LineAnnotation`, `debug_LineAnnotationType`, `debug_UnderlineParts`: `Debug<T>`
  (Rust derive output; verified shapes are in `internals_mirror.test.ts.txt`).
- **Import cycle.** render.ts will import mod.ts, source_map.ts and styled_buffer.ts, and they import render.ts. So
  render.ts must not *evaluate* anything imported from them at module top level (inside functions is fine), and the
  same holds for top-level consts that those files read from render.ts. `OUTPUT_REPLACEMENTS` and similar
  self-contained tables are fine.

What render.rs consumes from my files:
- **Renderer** (interface): `anonymized_line_numbers`, `term_width`, `decor_style: DecorStyle`, `stylesheet: Stylesheet`,
  `short_message`.
- **DecorStyle**: the string union `"Ascii" | "Unicode"`. Methods on the `DecorStyle` const:
  - `col_separator(s)` and `diff(s)` return a char as a number
  - `note_separator(s, is_cont)`, `multi_suggestion_separator(s)`, `file_start(s, is_first, alone)`,
    `secondary_file_start(s)` and `margin(s)` return strings
  - `underline(s, is_primary)` returns an `UnderlineParts`
- **Level** (class):
  - `.level: LevelInner` (string union) and `.name`
  - `.as_str()` and `.style(stylesheet)`
  - `LevelInner.style(l, ss)`
- **Snippet types** (snippet.ts):
  - `Group { primary_level, title?, elements }`
  - `Element`, a `$`-tagged union: `Message | Cause | Suggestion | Origin | Padding`, each with `_0`
  - `Title { level, id?: Id, text, allows_styling }`, `Id { id?, url? }`, `Message { level, text }`
  - `Snippet<T> { path?: string, line_start, source: Str, markers: T[], fold }`
  - `Annotation { span: Range, label?, kind, highlight_source }`, `Patch { span, replacement: Str }`
  - `Origin { path, line?, char_column? }`, `Padding` (class)
  - `AnnotationKind.is_primary(k)`
  - `MessageOrTitle` is yours to model.
- **SourceMap** (class):
  - `SourceMap.new(source: Str, line_start)`, with fields `.lines: LineInfo[]` and `.source: Str`
  - `get_line(i): Str | undefined`
  - `span_to_locations(r: Range): [Loc, Loc]`, `span_to_snippet(r): Str | undefined`, `span_to_lines(r): LineInfo[]`
  - `annotated_lines(anns, fold): [max_depth, AnnotatedLineInfo[]]`. It does not modify `anns`, so pass
    `cause.markers` directly.
  - `splice_lines(patches, fold): SplicedLines | undefined`
- **Source-map data types:**
  - `SplicedLines = [complete: Str, TrimmedPatch[], SubstitutionHighlight[][], SubstitutionHighlight[][]]`
  - `TrimmedPatch` (class): `original_span`, `span`, `replacement: Str`, and
    `is_addition`/`is_deletion`/`is_replacement`/`is_destructive_replacement(sm)`
  - `Loc`: readonly `{ line, char, display, byte }`. **Never mutate one in place**; copy with spread. Helpers:
    `Loc_eq`, `Loc_default`.
  - `LineInfo`: readonly `{ line: Str, line_index, start_byte, end_byte, end_line_size }`
  - `AnnotatedLineInfo`: `{ line: Str, line_index, annotations: LineAnnotation[], keep }`
- **Margin** (class): `Margin.new(whitespace_left, span_left, span_right, label_right, term_width, max_line_len)`,
  `.term_width`, `was_cut_left()`, `left(n)`, `right(n)`.
- **StyledBuffer** (class): all string arguments are JS strings, and characters are code-point numbers.
  - `StyledBuffer.new()`
  - `render(level, stylesheet, out: { value: string }): Result<undefined, never>`
  - `putc(line, col, ch: number, style)`, `puts(line, col, s, style)`
  - `append(line, s, style)`, `prepend(line, s, style)`, `replace(line, start, end, s)`
  - `num_lines()`, `set_style_range(line, a, b, style, overwrite)`, `set_style(line, col, style, overwrite)`
- **Styles:** `Style.fmt(style, PLAIN|PRETTY)` and `Style_eq` come from `../../anstyle/style.ts` (also re-exported by
  mod.ts).
- **Helpers:** `std_ext.ts` (above). For `isize`/`usize` casts, use `isize_as_usize` and `usize_wrapping_sub`.
- **`newline_count`.** `simd` is enabled, so port the `#[cfg(feature = "simd")]` arm: `memchr_iter(b'\n', ..).count()`
  is `str_count_byte(body, 0x0a)`. Skip-mark the `#[cfg(not(feature = "simd"))]` arm; it would be `lines().count() - 1`.
- **Tests left for annotate-b:**
  - render.rs inline tests `ensure_output_replacements_is_sorted` and `ensure_newline_count_correct`
  - Once render.ts is real, drop the `mock.module` block from `internals_mirror.test.ts.txt`. It then runs against
    the real code and makes a ready oracle test for source_map/styled_buffer.
  - The crate's `tests/` integration suite (formatter, rustc_tests, color/*.svg) is **not in the crates.io package**.
    It is in the upstream git repo `rust-lang/annotate-snippets-rs` at tag `0.12.16`, so it has to be fetched from
    there if wanted.

## For root
- **scope.json** `vendor`: add `"annotate-snippets": "=0.12.16"` and `"anstyle": "=1.0.13"`. memchr is not vendored:
  its only use (render.rs `newline_count`) is a byte count.
- **coverage.ts** does not count `// crate:` markers, and has no vendor skip form. I used `// crate-skip: <crate>-<ver>/<path>:<line> <name> <reason>`.
  Consider teaching `coverage.ts` both forms. My per-file counts are above.
- **std bug: `Str.toString()` drops a leading U+FEFF.** `src/std/str.ts` builds its decoder with
  `new TextDecoder("utf-8", { fatal: false })`, and `ignoreBOM` defaults to false, so the decoder strips a BOM at
  offset 0 of every decoded slice. Fix: add `ignoreBOM: true`. This affects any Str slice that starts with U+FEFF,
  for example a source line or snippet passed through `splice_lines` or Debug. The test in annotate_snippets.test.ts
  works around it by comparing lengths.
- **std helpers to promote.** `std_ext.ts` and the span-map str helpers (rustc_span/source_map.ts) overlap; both
  should become `src/std/str.ts` / `src/std/ops.ts`. `MutRef` lives in rustc_span/hygiene.ts; a std home would let
  vendor code use it.
- **Probes.** The probe sources in `docs/handoff/annotate-a/` could become `tools/probes/annotate_public` and
  `tools/probes/annotate_internals`. The internals one needs a copy of the crate with `pub(crate)`→`pub`, `mod margin`
  / `mod styled_buffer` / `mod snippet` made `pub`, and `SourceMap.lines`/`Renderer.stylesheet` made `pub`. It must be
  built `--release`. This would give annotate-b a byte-exact oracle for the renderer internals.
- Decisions to record (I did not write to docs/state): the struct-shape rule (clashing names → interface plus
  companion), eager Display rendering, release-mode wrapping arithmetic, and `cfg!(windows)` →
  `process.platform === "win32"`.

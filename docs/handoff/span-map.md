# Handoff: span-map (source_map.rs, caching_source_map_view.rs, vendor unicode-width)

## Evidence
- Coverage: `source_map.rs` 84/84, `source_map/tests.rs` 29/29, `caching_source_map_view.rs` 7/7.
  `coverage.ts --check`: markers ok (738).
- `bunx tsc --noEmit -p .`: clean. `bun test src tools`: 98 pass, 0 fail.
  `bun test src/rustc_span src/vendor/unicode_width`: 65 pass. All upstream source_map tests are
  ported and pass, except one `#[cfg(target_os = "linux")]` test, which is rustc-skipped (see below).
- `RUST_TS_AGENT=span-map difftest --suite lex --sample 300`: 300/300 MATCH (run `20261012-154542-span-map-wosw`).
  `--suite escape --sample 300`: 300/300 MATCH (run `20261012-154543-span-map-3leg`).
- unicode-width oracle test: `width`/`width_cjk` match the `uwidth` probe for all 1,112,064 scalars.
- Init order: I imported source_map/caching_source_map_view/lib/hygiene first, each in a fresh
  process. Then I created a session with a SourceMap and printed `debug_Span`. Every run gave
  `file.rs:1:1: 1:25 (#0)`. Scratch files: `D:/rust-ts-data/tmp/span-map/`.

## Files
New: `src/rustc_span/source_map.ts`, `src/rustc_span/source_map/tests.test.ts`,
`src/rustc_span/caching_source_map_view.ts`, `src/vendor/unicode_width/{lib,tables,tables.gen,oracle.test}.ts`,
`src/vendor/unicode_width/tests/tests.test.ts`, `tools/gen-unicode-width.ts`, `tools/probes/uwidth/{Cargo.toml.in,main.rs}`.
Edited: `src/rustc_span/lib.ts`, wire-up only:
- `SourceMap.with_inputs`, `is_span_accessible`, `is_imported` and `span_to_diagnostic_string` (Debug for Span) now call the real code.
- `char_width` now calls `UnicodeWidthChar.width`.
- Added `export { UNICODE_VERSION }`, `import { SourceMap, SourceMapInputs }` and `export { CachingSourceMapView }`.
- Removed the placeholder interfaces.

## For root
- **scope.json**: add `"unicode-width": "=0.2.2"` to `vendor`. Probe `uwidth` must be built (`bun scripts/probes.ts build uwidth`)
  before `bun tools/gen-unicode-width.ts`; the oracle test skips if it is not built.
- lib.ts keeps `export type { SourceMap, SourceMapInputs }` (marked PORT, transitional) because hygiene.ts imports
  `SourceMap` from lib.ts. Repoint hygiene.ts to `./source_map.ts` and replace its `sm_is_imported` stub
  (hygiene.ts:51, still `unported`) with `sm.is_imported(sp)`. That file is outside my lane.
- Shims in source_map.ts to move later (all marked PORT):
  - Move `FileName_eq`/`RealFileName_eq` (derive PartialEq, path equality by components) and
    `stable_source_file_id_key` to lib.ts.
  - Move the `std::path` subset to `src/std/path.ts`: Prefix parsing per windows_prefix.rs, Components, strip_prefix, join/_push, is_absolute, eq.
  - Move the `str` helpers (get, ceil/floor_char_boundary, trim, split, ...) to `src/std/str.ts`.
  - Move `IoError` to `src/std/io.ts`.
  - The `index`/`partition_point` helpers can move too.
- Tests: rust-ts interns every non-dummy span, so the span tests run inside `create_default_session_globals_then`.

## PORT decisions
- `std::path` follows the host platform (`process.platform`), like the host rustc oracle. Paths are strings indexed by UTF-16 unit, and separators are ASCII.
  `Components::eq` compares the forward sequences instead of `rev()` (the result is the same).
- `stable_id_to_source_file` is keyed by a string made of the same inputs upstream hashes. That covers
  `impl Hash for RealFileName` (it skips `local` when the name is fully remapped) and component-wise Path hashing. 128-bit hash collisions are not modelled.
- SourceMap fields `files`/`path_mapping`/`working_dir` are renamed `files_`/`path_mapping_`/`working_dir_`, because they clash with the methods of the same name.
- Source text (`read_file`, snippets, prev/next source, `indentation_before`) is `Str`. `read_file` validates UTF-8 the way `read_to_string` does.
  `read_binary_file` uses `readFileSync`, which reads to EOF, so the lying-stat fallback is not needed. For the same reason the
  linux-only test `read_binary_file_handles_lying_stat` is rustc-skipped.
- `find_width_of_character_at_span`: `source_len - 1` wraps to usize::MAX for an empty file, as in release rustc.
- unicode-width: `tables.gen.ts` holds the same 3-level trie layout (21 middle and 180 leaf tables), built from per-char widths.
  Only U+17D8 (width 3) uses code 3, so `lookup_width` returns `WidthInfo::DEFAULT` for every other char.
  Upstream's code-3 ligature and emoji markers are not derivable from char widths.
- unicode-width tests: only the char-width tests and assertions are ported, because the str-width ones need the unported functions.

## Remaining `unported(...)`
- unicode-width string widths: `width_in_str`, `width_in_str_cjk`, `is_transparent_zero_width`, `is_solidus_transparent`,
  `starts_emoji_presentation_seq`, `starts_non_ideographic_text_presentation_seq`, `is_emoji_modifier_base`.
  Through them, `UnicodeWidthStr::width`/`width_cjk` are unported too. rustc only uses char widths.
- `display_IoError` / `debug_IoError` for OS errors: the OS message text (`... (os error N)`) is unported.
- `debug_SourceMap`'s `file_loader` field (a `{:p}` heap address).
- Unchanged and outside this lane: `std::path::Path::file_name` (lib.ts `FileName::short`), StableHasher, blake3, hygiene `sm_is_imported`.

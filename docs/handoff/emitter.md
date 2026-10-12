# Handoff: emitter (wave 5): rustc_errors emitter.rs, annotate_snippet_emitter_writer.rs, timings.rs (+ anstream vendor stack)

Branch `lane/emitter`. main was merged in twice (lint-defs 446d3a6, codegen-diag f68dc9c), with no conflicts.

## Evidence
- **Coverage** (`bun scripts/coverage.ts --missing`):
  - emitter.rs 33/33
  - annotate_snippet_emitter_writer.rs 16/16
  - timings.rs 10/10
  - lib.rs 98/98, diagnostic_impls.rs 5/5 (unchanged)
- **`coverage.ts --check`**: `markers ok (2210; vendor 2048)`, but only with the six vendor entries below added to `harness/scope.json`. I tested that with a temporary copy that is not committed. Without the entries it reports 274 "names no harness/scope.json vendor crate" errors and nothing else.
- **Typecheck**: `bunx tsc --noEmit -p .` is clean.
- **Unit tests**: `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 500 pass, 0 fail.
- **Difftest samples** (`RUST_TS_AGENT=emitter`, on the final merged tree):
  - `--suite fluent-format --sample 200`: 200/200 MATCH
  - `--suite lex --sample 200`: 200/200 MATCH (run `20261012-214006-emitter-5qk2`)
- **Entry points**: `emitter.ts`, `annotate_snippet_emitter_writer.ts`, `timings.ts` and `lib.ts` each load cleanly as the entry module.
- **`src/rustc_errors/emitter.test.ts`**: 14 tests, all passing.
  - 9 scenario tests compare against real rustc output, byte for byte. Each cites its program and the `rustc +nightly ...` command. Each diagnostic is rebuilt by hand with the spans, labels, children and suggestions rustc builds, emitted through `AnnotateSnippetEmitter` into a `VecU8` buffer, then `print_error_count`. The scenarios cover:
    - single-span E0308 with a `[E0308]` header and a secondary label, under `-Zui-testing` and without it (real line numbers)
    - `--error-format=short`
    - a warning with an inline suggestion label plus a `= note` child, and the "1 warning emitted" summary
    - a multi-line span label (`match` arms)
    - two files, with a span note in the second file plus a verbose insertion suggestion (`++++`), under `-Zui-testing` and without it
    - a highlighted `note_expected_found`: its Highlight ANSI is stripped by the `Never` AutoStream, as in rustc
    - a replacement suggestion (`-`/`+` lines)
    - the full styled output on an `AlwaysAnsi` stream, against `--color=always`
  - Every scenario also checks the "aborting due to N previous error(s)" and `--explain` summary lines.
  - The remaining 5 are unit checks: `OUTPUT_REPLACEMENTS` sorting (the const assert) and `normalize_whitespace`, `detect_confusion_type`/`ConfusionType`, `ColorConfig::to_color_choice`, and `TimingSectionHandler`/guard.
- The upstream files have no inline `#[cfg(test)]` tests.
- **Vendor stack**, ported by a sub-agent of this lane. All files are new under `src/vendor/`.
  - Crates: `anstream` 0.6.21, `anstyle_parse` 0.2.7, `utf8parse` 0.2.2, `colorchoice` 1.0.4, `anstyle_query` 1.1.5, `termize` 0.2.1.
  - The strip oracle covers 442 cases and all of them match: a scratch Rust program against the real crates, offline release build. The results are committed as `anstream/strip_oracle.json` with `strip_oracle.test.ts`. It covers `strip_bytes`/`strip_str`, `StripStream` (whole input, byte-wise, every 2-chunk split, short writes), `WinconBytes` and the full `Parser` event log.
  - The regenerated anstyle-parse table is byte-identical to the crate's `table.rs`.
  - termize matches the real crate in 5 of 5 pty/redirect setups.
  - Fn counts, ported/skipped:
    - anstream: adapter/strip 40/0, adapter/wincon 15/0, auto 20/0, strip 19/0, fmt 3/0, lib 2/0, stream 12/17 (the `&T`/`&mut T`/`Box` forwarding impls are erased; `File`, `Buffer`); wincon.rs 0/19, buffer.rs 0/7, `_macros.rs` 0/1
    - anstyle-parse: lib 21/0, params 12/0, state/definitions 6/0, state/mod 2/0, codegen 2/0 (as a test)
    - utf8parse: lib 5/4 (nightly benches), types 1/0
    - colorchoice: 10/0
    - anstyle-query: lib 11/0, windows 2/4
    - termize: unix 8/3, windows 0/5, unsupported 0/4
    - Examples are skipped.

## Files touched
- **New:** `src/rustc_errors/{emitter,annotate_snippet_emitter_writer,timings}.ts`, `src/rustc_errors/emitter.test.ts`, and `src/vendor/{anstream,anstyle_parse,utf8parse,colorchoice,anstyle_query,termize}/**`.
- **`src/rustc_errors/lib.ts`** (stand-in replacement and wiring):
  - The `Emitter`/`TimingRecord`/`TimingEvent` stand-ins are removed. `Emitter`, `DynEmitter`, `SilentEmitter`, `TimingEvent` and `Style_anstyle` are now imported from `emitter.ts`, and `TimingRecord` from `timings.ts`.
  - `pub use anstream::{AutoStream, ColorChoice}`, `pub use anstyle::{.., Style as Anstyle}` and `pub use emitter::ColorConfig` are added.
  - `export * as emitter` and `export * as timings` are added.
  - `make_silent` is now real.
  - `Style` gets a companion const with `anstyle`.
  - `str_trim` is now exported.
- **`src/rustc_errors/diagnostic_impls.ts`**: deleted the 3 shadowing `unported` Subdiagnostic stubs, as root asked (codegen-diag). The generated impls are used now.
- **`src/std/io.ts`**: `ErrorKind` gains `"WriteZero" | "Interrupted"`, as root allowed.
- **Test emitters**: `src/rustc_errors/tests.test.ts`, `src/rustc_lint_defs/lib.test.ts` and `src/rustc_parse/diagnostics.test.ts` changed their test emitters from `implements Emitter` to `extends Emitter`. This was forced: `Emitter` is now a class with provided methods.
- **`src/vendor/annotate_snippets/**`**: no changes; no bugs found.

## PORT decisions
- **Emitter trait:** `trait Emitter` with provided methods is now the abstract class `Emitter`. Implementors extend it and override methods. `DynEmitter` is an alias for it.
- **Destination:** `Destination = AutoStream<Box<dyn Write + Send>>` is the vendored `AutoStream` over `dyn_write(w)`, and it writes **bytes**. `stderr_destination` writes to fd 2 through `Buffy`; on Windows it writes directly. Tests inject `VecU8`. The `std::io::Write` shim (`Write`, `Write_default`, `Stderr`, `Stdout`, `VecU8`, `dyn_write`, `FmtArguments`) lives in `src/vendor/anstream/stream.ts`.
- **`writeln!`:** `write_fmt(pieces)`. `FmtArguments` is the sequence of `write_str` calls that `core::fmt::write` makes.
- **Drop is manual:** `Buffy::drop` and `TimingSectionGuard::drop` are ported as `drop()` methods, and callers must invoke them.
- **Colour:** decided as upstream. Under the harness, stderr is not a TTY, so the destination is `ColorChoice::Never`, i.e. a `StripStream` with `Renderer::plain()`. The styled path (`AlwaysAnsi`/`Always`) is ported and tested.
- **Terminal width:** as upstream. The order is `diagnostic_width`, then `ui_testing` (which uses `DEFAULT_TERM_WIDTH`), then `termize::dimensions()`, which tries stdout, then stdin, then stderr, then `/dev/tty`. termize uses Node `tty`.
  - Note for the harness: if any of those streams is a TTY, rustc uses its width too.
- **Setters:** `#[derive(Setters)]` becomes static builders, e.g. `AnnotateSnippetEmitter.sm(self, v)`, so the field names can stay the same.
- **Name clashes:** methods clashing with fields get a trailing underscore: `HumanReadableErrorType.short_()`, `TimingRecord.section_()`/`timestamp_()`.
- **Types are hand-written**, not generated: `HumanReadableErrorType`, `TimingEvent`, `ColorConfig`, `OutputTheme`, `ConfusionType`, `TimingSection`, `TimingRecord` and the private `Annotation`, each with a hand-written Debug. Root may move them to codegen by adding the 3 files to the `rustc_errors` set in `types.sets.json`.
- **Small std mappings:**
  - `FxIndexSet<(Span, String)>` becomes an insertion-ordered `Map` keyed by value.
  - `Instant` becomes `process.hrtime.bigint()`.
  - `cfg!(windows)` becomes `process.platform === "win32"`.
- **Owned data is copied before mutation:** `diag.suggestions.unwrap_tag()` and each substitution's parts.
- **Iterator chains** run eagerly in upstream order; their closures have no observable side effects.
- **`file_ann.binary_search_by(f.name.cmp(..))`** needs derived `Ord` for `FileName`/`RealFileName`/`InnerRealFileName` and `Ord for Path` (component-wise). These are local helpers in the writer and belong in rustc_span (see "For root").
- **Module cycle:** `lib.ts` does **not** re-export `annotate_snippet_emitter_writer`. Its class extends `Emitter`, and when emitter.ts is the entry module that would hit the ESM cycle before emitter.ts has finished evaluating. Import it directly.
- **Vendor decisions:**
  - Non-Windows host semantics: `cfg!(windows)` is false.
  - `adapter/wincon.rs` is ported, since it is pure.
  - Stdout is unbuffered.
  - EAGAIN is retried.
  - Fields that collide with methods are renamed: `len_`/`params_`/`intermediates_`.
  - Proptests became seeded loops.

## Remaining `unported(...)`
- `debug_AnnotateSnippetEmitter`: the `dst` field prints `{:p}`, a memory address that cannot be reproduced.
- `component_cmp` on `Prefix`: Windows path-prefix ordering.
- None in the vendor stack.

## For root
- Add these to the `harness/scope.json` vendor list: `anstream =0.6.21`, `anstyle-parse =0.2.7`, `utf8parse =0.2.2`, `colorchoice =1.0.4`, `anstyle-query =1.1.5`, `termize =0.2.1`.
- `tools/codegen/typemap.errors.json` still has the note "Emitter interface declared in lib.ts until the emitter lane ports emitter.rs". `lib.ts` re-exports the type, so `lib.gen.ts` works unchanged; update or remove the note.
- Move these to shared places:
  - The `std::io::Write` shim from `anstream/stream.ts` to `src/std/io.ts`.
  - `str_trim` (now exported from lib.ts) to `src/std/str.ts`.
  - `FileName_cmp`/`path_cmp` from the writer to rustc_span/std.
- **Driver:** use `stderr_destination(color)` + `AnnotateSnippetEmitter.new(..)` with the setters to build the human emitter (`rustc_session` does this upstream). Nothing calls `Buffy.drop()`; it is harmless because every emit flushes.

## API contract (for harness-w5 and the session/driver)
```ts
import { AnnotateSnippetEmitter } from "src/rustc_errors/annotate_snippet_emitter_writer.ts";
import { stderr_destination, type Destination, ColorConfig, OutputTheme, Emitter, SilentEmitter, EmitterWithNote } from "src/rustc_errors/emitter.ts";
import { AutoStream, ColorChoice } from "src/vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "src/vendor/anstream/stream.ts";

// destination: stderr (as rustc) or a byte buffer
const dst: Destination = stderr_destination(ColorConfig.Auto);            // fd 2, colour per ColorConfig
const buf = new VecU8(); const dst2 = AutoStream.new(dyn_write(buf), ColorChoice.Never); // buf.bytes()
// emitter: upstream constructor + derive(Setters) builders (static, mutate and return the emitter)
let em = AnnotateSnippetEmitter.new(dst2);
em = AnnotateSnippetEmitter.sm(em, source_map);             // SourceMap | undefined
em = AnnotateSnippetEmitter.ui_testing(em, true);           // anonymized line numbers, width 140
em = AnnotateSnippetEmitter.short_message(em, false);
em = AnnotateSnippetEmitter.diagnostic_width(em, undefined);
em = AnnotateSnippetEmitter.macro_backtrace(em, false);
em = AnnotateSnippetEmitter.track_diagnostics(em, false);
em = AnnotateSnippetEmitter.terminal_url(em, "No");          // TerminalUrl
em = AnnotateSnippetEmitter.theme(em, OutputTheme.Ascii);
em = AnnotateSnippetEmitter.ignored_directories_in_source_blocks(em, []);
const dcx = DiagCtxt.new(em);                                // then emit, dcx.handle().print_error_count(), ...
```
- The constructor takes `dst` only, exactly as upstream; there is no fallback bundle at the pin.
- A custom emitter `extends Emitter` and implements `emit_diagnostic` and `source_map`. The other methods have upstream defaults.

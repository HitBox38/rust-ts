# Handoff: errors-core (rustc_error_messages + rustc_errors core)

## Evidence
- Coverage (`bun scripts/coverage.ts --missing`): rustc_error_messages `lib.rs` 35/35, `diagnostic_impls.rs` 18/18;
  rustc_errors `codes.rs` 2/2, `diagnostic.rs` 94/94, `diagnostic_impls.rs` 5/5, `formatting.rs` 8/8,
  `decorate_diag.rs` 7/7, `dedup_hash.rs` 1/1, `lock.rs` 4/4 (3 rustc-skip), `lib.rs` 98/98. `--check`: markers ok (1023).
- `bunx tsc --noEmit -p .`: clean. `bun test src tools`: 131 pass, 0 fail. `bun test src/rustc_errors src/rustc_error_messages`: 18 pass.
- `RUST_TS_AGENT=errors-core difftest --suite lex --sample 300`: 300/300 MATCH (run `20261012-190631-errors-core-2li9`);
  `--suite escape --sample 300`: 300/300 MATCH (run `20261012-190632-errors-core-c9ot`).
- No upstream `#[cfg(test)]` tests exist in the assigned files (only json/markdown, out of scope). `src/rustc_errors/tests.test.ts`
  is a scenario test through a recording emitter: counts, `has_errors`, summary/`--explain` lines, dedup on/off, once-notes,
  disabled warnings, stash/steal (error and warning), stashed-warning skipping, delayed bugs, fatal/bug/treat-err-as-bug,
  drop bomb, taint, suggestions, MultiSpan labels, helpers. Each assertion cites its upstream line.
- Import order: every hand module works as the entry point (`rustc_errors/{lib,diagnostic,decorate_diag,codes,formatting,dedup_hash}.ts`,
  `rustc_error_messages/lib.ts`). Entering a `.gen.ts` directly fails (TDZ), per the ast-types convention that `.gen.ts` is only entered via its hand module.

## Files
Generated (`bun tools/codegen/types.ts rustc_errors`, 9 files, 47 types, 26 Debug fns, 0 unknown types):
`src/rustc_error_messages/{lib,diagnostic_impls}.gen.ts`, `src/rustc_errors/{codes,diagnostic,diagnostic_impls,formatting,decorate_diag,dedup_hash,lib}.gen.ts`.
`src/rustc_errors/error_codes.gen.ts` (518 `E<nnnn>` constants + `ERROR_CODES`) from the new `tools/codegen/error_codes.ts`.
Named `error_codes.gen.ts` (not `codes.gen.ts` as the brief said) because the types generator owns `codes.gen.ts` (ErrCode).
Hand ports: `src/rustc_error_messages/{lib,diagnostic_impls}.ts`, `src/rustc_errors/{lib,codes,diagnostic,diagnostic_impls,formatting,decorate_diag,dedup_hash,lock}.ts`, `src/rustc_errors/tests.test.ts`.
Tools: `tools/codegen/types.sets.json` (+ set `rustc_errors`, `auto_class`, hand: Diag, DiagCtxtHandle, DecorateDiagCompat,
DiagArgFromDisplay, DedupHashEncoder, DelayedBugPanic), new `tools/codegen/typemap.errors.json`, new `tools/codegen/error_codes.ts`.

## For root
- **Fluent is the blocker for rendering.** Formatting any `DiagMessage::Inline` (every `msg!`/`#[diag("..")]` message) calls
  `unported` in `formatting.ts`. A vendor lane needs fluent-syntax 0.12 + fluent-bundle 0.16 (+ intl_pluralrules for
  `{$n -> [1] .. *[other] ..}`, icu_list for `StrListSepByAnd`), several thousand lines. `DiagMessage::Str` formats exactly.
- `DiagCtxtInner::drop` is not automatic: the session/driver must call `dcx.inner.drop()` where upstream drops the DiagCtxt
  (it emits stashed diagnostics and flushes delayed bugs). Same for `Diag.drop()` (the drop bomb only runs when called).
- Stand-ins in `rustc_errors/lib.ts` to replace once ported: `Applicability`, `Lint`, `LintId`, `LintExpectationId`,
  `LintLevel` (+`LintLevel_is_error`), `RECURSION_DEPTH_EXCEEDING_LIMIT` name (rustc_lint_defs); `Emitter`, `TimingRecord`,
  `TimingEvent` (emitter.rs/timings.rs); `ThreadId` (always 1). typemap.errors.json points the lint types at lib.ts.
- Helpers that belong in shared places: `Backtrace` shim (rustc_error_messages/diagnostic_impls.ts) -> src/std;
  `str_trim` (rustc_errors/lib.ts) -> src/std/str.ts; `index_map_swap_remove` (decorate_diag.ts) -> src/rust_ts.
- `src/rustc_index/newtype_index.ts` asserts with the message `value <= 0xFFFF_FF00` even when `max` differs (ErrCode max 9999). Not my file.

## Contract (public TS API for the emitter lane, parser and session)
Import everything from `src/rustc_errors/lib.ts` (re-exports rustc_error_messages, codes, diagnostic, decorate_diag).
- Messages: `DiagMessage` = `{$:"Str",_0}` | `{$:"Inline",_0}`; `msg("..")` = `msg!`. `IntoDiagMessage = DiagMessage | string`
  (string = `From<String>`), `into_DiagMessage`. `DiagMessage.as_str(m)`, `DiagMessage_eq`.
- Spans: `MultiSpan` class (fields `primary_spans`, `span_labels`, `span_context`); `MultiSpan.new()/from_span/from_spans/
  from_Span/from_Option/from_Vec`; getters are `primary_spans_()`, `span_labels_()`, `span_context_()` (name clash with fields);
  `primary_span()`, `has_primary_spans()`, `is_dummy()`, `replace`, `span_labels_raw`, `has_span_labels`, `clone_ignoring_labels`,
  `clone`. `IntoMultiSpan = MultiSpan | Span | Span[] | undefined`, `into_MultiSpan`. `SpanLabel {span, is_primary, label}`.
- Args: `IntoDiagArg` trait object `{ into_diag_arg(path: MutRef<PathBuf|undefined>): DiagArgValue }`; build with
  `IntoDiagArg.String(s)`, `IntoDiagArg.DiagArgValue(v)`, or `IntoDiagArg.of(value, <T>_into_diag_arg)` using
  `number_/bool_/char_/Vec_char_/Symbol_/str_/String_/Cow_/Path_/PathBuf_/Backtrace_into_diag_arg`, `into_diag_arg_using_display(display)`
  (e.g. `ErrCode_into_diag_arg`), `Level.into_diag_arg`, `DiagLocation_into_diag_arg`, `DiagSymbolList_into_diag_arg(self, path, display)`.
- `DiagCtxt.new(emitter: Emitter)`, `.with_flags(flags)` (`DiagCtxtFlags_default()`), `.disable_warnings()`, `.with_ice_file`,
  `.with_msrv`, `.handle()`; `dcx.inner` is the `DiagCtxtInner` (fields as upstream).
- `DiagCtxtHandle` (class, `dcx`, `tainted_with_errors: MutRef<ErrorGuaranteed|undefined>|undefined`): every upstream method
  with upstream names: `struct_*`/`create_*`/emit fns (`struct_span_err(span, msg)`, `span_err`, `err`, `struct_warn`, `warn`,
  `struct_note`, `fatal`, `span_fatal`, `bug`, `span_bug`, `delayed_bug`, `span_delayed_bug`, `emit_err(d: Diagnostic)`, ...),
  `emit_diagnostic`, `stash_diagnostic`, `steal_non_err`, `try_steal_modify_and_emit_err`, `try_steal_replace_and_emit_err`,
  `has_stashed_diagnostic`, `emit_stashed_diagnostics`, `err_count`, `has_errors*`, `print_error_count`, `abort_if_errors`,
  `must_teach`, `flush_delayed`, `into_taintable`, `set_emitter`, `can_emit_warnings`. `make_silent` is unported (SilentEmitter).
  `bug`-style messages take `string` (upstream `Into<Cow<str>>`).
- `Diag` (class): `dcx`, `diag: DiagInner | undefined`; `Diag.new(dcx, level, msg)`, `Diag.new_diagnostic`; `deref()` /
  `deref_mut()` give the `DiagInner` (Deref is explicit); all builder methods with upstream names returning `this`
  (`span_label`, `note`, `help`, `span_note`, `span_suggestion(sp, msg, snippet: string, applicability)`, `multipart_suggestion`,
  `code`, `arg(name, IntoDiagArg)`, `span`, `primary_message`, `subdiagnostic(sub: Subdiagnostic)`, ...) plus the `with_fn!`
  variants (`with_span`, `with_code`, `with_note`, `with_help`, `with_span_label`, `with_span_suggestion*`, `with_arg`, ...);
  consumers `emit`, `emit_err`, `emit_fatal`, `emit_bug`, `delay_as_bug`, `emit_err_unless_delay`, `cancel`,
  `cancel_into_message`, `stash(span, key)`, `drop`. `PResult<T> = Result<T, Diag>`. `struct_span_code_err(dcx, span, code, msg)`.
- `Diagnostic` = `{ into_diag(dcx, level): Diag }`; `Subdiagnostic` = `{ add_to_diag(diag): void }`; `DiagDecorator(f)`; `Spanned_into_diag`.
- `DiagInner` (class, upstream fields; `level` is a field, getter is `level_()`): `DiagInner.new(level, msg)`, `new_with_messages`,
  `is_error`, `has_future_breakage`, `rust_version`, `sub`, `arg`, `remove_arg`, `emitted_at_sub_diag`, `dedup_hash`, `clone`.
  `Subdiag {level, messages, span}`.
- `Level` union (`{$:"Error"}`, `{$:"Warning", _0: EmissionOverride|undefined}`, ...) with singletons `Level.Error` etc. and
  `Level.to_str`, `Level.is_failure_note`, `display_Level`, `Level_eq`. `Sublevel` string union + `Sublevel.to_str`. `Style`,
  `SuggestionStyle` (+`hide_inline`), `Suggestions` (+`unwrap_tag`, `len`, `default`), `CodeSuggestion`, `Substitution`,
  `SubstitutionPart`, `TrimmedSubstitutionPart` (+`is_addition`, ... take a `SourceMap`), `StashKey` string union.
- Emitter side (for the emitter lane): implement `Emitter` (lib.ts; methods listed there incl. upstream defaults), render with
  `format_diag_message(msg, args)` / `format_diag_messages` (formatting.ts), `Level.to_str`, `Sublevel.to_str`, `display_ErrCode`,
  `DiagStyledString`, `StringPart`. `TRACK_DIAGNOSTIC` is an `AtomicRef`.
- Codes: `ErrCode` branded number (`ErrCode.from_u32`), `E0001`..`E0799` constants, `display_ErrCode` (`E{:04}`),
  `try_find_description(code)` -> `Result<ErrCodeDescription, InvalidErrorCode>` (`.text()` is unported).
- Lints: `LintBuffer` (+`LintBuffer_default()`, `add_early_lint`, `take`, `buffer_lint`, `dyn_buffer_lint*`), `BufferedEarlyLint`, `DecorateDiagCompat`.
- Also: `a_or_an`, `as_substr`, `elided_lifetime_in_path_suggestion` (returns the struct; its `#[derive(Subdiagnostic)]` is unported).

## PORT decisions
- Types via codegen; `Diag` hand-written (Deref + drop bomb), `DiagCtxtHandle` hand-written (shared `Cell` -> `MutRef`).
- Dedup hash: no StableHasher/derive(Encodable). `DedupHashEncoder` records the same field traversal as tokens and
  `DedupHasher.finish()` interns the sequence to a `Hash128` (equal iff the encodings are equal; no 128-bit collisions).
  Spans hash as `Span.with_parent(sp, undefined)`; rust-ts interns spans by full `SpanData`, so the handle identifies the data.
- `#[track_caller]`: `DiagLocation.caller_()` (renamed: `Function.caller` is reserved) returns a sentinel; displaying it is unported.
- `impl Into<..>` params: `IntoDiagMessage`, `IntoMultiSpan`, `impl ToString` -> `string`; `Symbol` in `note_trait_signature` as its string.
- `IntoDiagArg` impls are free functions paired with values by `IntoDiagArg.of` (TS cannot dispatch on numbers/chars/symbols).
- Field/method name clashes: `MultiSpan.primary_spans_()/span_labels_()/span_context_()`, `DiagInner.level_()`.
- IndexMap `swap_remove` semantics kept (`index_map_swap_remove`); IndexMap insert-existing keeps position (JS Map does too).
- `multipart_suggestions` uses a stable sort where upstream uses `sort_unstable_by_key` (only equal `(lo, hi)` parts could differ).
- `Backtrace::capture` shim: Disabled unless `RUST_LIB_BACKTRACE`/`RUST_BACKTRACE` enable it (then unported). `panicking()` is false.
- `lock.rs`: the three `cfg(windows)` fns are rustc-skip (named mutex for 32-bit MSVC linking); the non-windows no-op is ported.
- `codes.rs` DIAGNOSTICS: the 1.3 MB of `.md` text is not embedded; presence is exact, text is unported.
- `flush_delayed` writes the ICE file with `appendFileSync` per bug (errors ignored, as upstream ignores them).

## Remaining `unported(...)`
Fluent/ICU: `register_functions`, `fluent_value_from_str_list_sep_by_and` (+ nested `duplicate`, `as_string`, `as_string_threadsafe`,
`deref`, `construct`, `icu_locale_from_unic_langid`), `DiagArgValue.into_FluentValue`, `to_fluent_args`, `format_fluent_str`
(so `format_diag_message` of `Inline`, `EagerDiagMessageBuilder.format`, delayed-bug decoration).
Other: `CString`/`SmallCStr` IntoDiagArg, Backtrace capture/Display when enabled, `DiagLocation` Display (track_caller),
`ErrCodeDescription.text`, `make_silent` (SilentEmitter), `#[derive(Subdiagnostic)]` for ExpectedLifetimeParameter,
IndicateAnonymousLifetime, ElidedLifetimeInPathSubdiag. Generated Debug of `LintId`/`LintExpectationId` fields (`unknown_debug`).

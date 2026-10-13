# Handoff: expand-pm-types (wave 9, M2: proc-macro server types)

Branch `lane/expand-pm-types`. No merges. Commits: the port (proc_macro.rs, proc_macro_server.rs, the
`proc_macro` library subset), the oracle test, a `-Zspan-debug` case, a visibility fix, this handoff.

## Files
- **Ported (markers, upstream order)**:
  - `src/rustc_expand/proc_macro_server.ts`: `compiler/rustc_expand/src/proc_macro_server.rs`, **50/50**.
  - `src/rustc_expand/proc_macro.ts`: `compiler/rustc_expand/src/proc_macro.rs`, **6/6**.
- **`proc_macro` library subset** (new dir `src/proc_macro/`, mirrors `library/proc_macro/src/`; `// std:` /
  `// std-type:` markers with `library/proc_macro/src/<file>:<line> <name>`; coverage.ts does not count them):
  - `lib.ts`: `Delimiter` (+ Debug), re-exports `Level`, `bridge`; imports the bridge modules for side effects.
  - `diagnostic.ts`: `Level` (+ Debug).
  - `bridge/mod.ts`: `LitKind` (+ Debug, `LitKind_eq`), `DelimSpan` (+ `from_single`), `Group`, `Punct`, `Ident`,
    `IdentKind` (+ `prefix`), `Literal`, `TokenTree`, `Diagnostic` (+ Debug), `ExpnGlobals`; generic over
    `<TokenStream, Span, Symbol>` as upstream.
  - `bridge/server.ts`: `Server` interface (the `with_api!` method list, in order) + `ServerStatics`
    (`intern_symbol`, `with_symbol_string`), `ExecutionStrategy`, `MaybeCrossThread`, `SAME_THREAD`,
    `CROSS_THREAD`, `Range`/`Bound` (std::ops), `Client::run1` / `run2` (attached to client.ts's class; bodies
    `unported`).
  - `bridge/client.ts`: `Client` (opaque `run`). `bridge/panic_message.ts`: `PanicMessage` (+ `as_str`, `into_string`).
- **Tests**: `src/rustc_expand/proc_macro_server.test.ts` + `src/rustc_expand/proc_macro_oracle/{pm_probe.rs, gen.ts,
  expected.json, cases/*/t.rs (+ARGS)}`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3024 pass, 1 skip (pre-existing linux-only), 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (6021; vendor 2403).
- `--missing`: proc_macro_server.rs 50/50, proc_macro.rs 6/6.
- `RUST_TS_AGENT=expand-pm-types bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH
  (run `20261013-104009-expand-pm-types-f4l6`).
- Every new module loads as a fresh-process entry point (proc_macro.ts, proc_macro_server.ts, src/proc_macro/*).

## Oracle test (`proc_macro_server.test.ts`): 11/11 MATCH
- `rustc_expand::proc_macro_server` is private at the pin (`mod proc_macro_server;`, `pub(crate) struct Rustc`),
  so the oracle is a **proc-macro crate** (`pm_probe.rs`, built by `gen.ts` into `$RUST_TS_DATA/tmp/expand-pm-types/`)
  whose macros run inside the real `Rustc` server and print what they see through the bridge as `@@` lines on
  stderr. `gen.ts` compiles each `cases/<name>/t.rs` with `rustc +nightly --edition 2021 --crate-type lib
  -Zui-testing -Zunpretty=expanded [ARGS] --extern pm_probe=..` and stores stderr / exit / ICE message.
- The TS side parses t.rs, gives each `pm_probe::<m>!(..)` item a fresh expansion with the `ExpnData` rustc_resolve
  sets for a proc macro (`Macro(Bang, "pm_probe::<m>")`, call site `mac.span()`), builds `Rustc::new(cx)` and runs
  a mirror of the macro's client-side code (the `proc_macro` API calls and their Debug/Display impls) into the
  same buffer as the -Zui-testing emitter, then `print_error_count()`. Spans built from `Span::call_site()` are
  masked (`CALL_SITE`, `#CS `) on both sides (their ctxt number depends on prior expansions).
- Cases: `ops` (every operator token, jointness, multi-char splitting, empty input), `idents_lits` (raw idents,
  lifetimes, all literal kinds/suffixes, chars/escapes), `groups_docs` (nested groups, outer/inner line and block doc
  comments with quotes, backslash, tab, newline, non-ASCII and a combining char -> `escape_debug`), `spans`
  (line/column/byte_range/start/end/source_text/file/local_file/parent/source/join/subspan/resolved_at on every
  tree, multi-line + non-ASCII), `lits` (44 `literal_from_str` inputs incl. every error string, negative numbers
  re-split by `ts_from_token_tree`, lexer errors -> `ErrWithGuar` + emitted diagnostics, unclosed/unexpected
  delimiters through `cancel_diags_into_string`, fatal unterminated string -> "failed to parse to literal"),
  `streams` (`ts_from_str`, incl. error paths and the fatal-error diagnostic at the call site),
  `ice_mismatched_delims` (`"( ]"`: the oracle ICEs with "no diagnostic has a message"; the TS panics identically),
  `construct` (client-built Punct/Ident/Literal/Group trees: gluing in `ts_concat_trees`, `ts_concat_streams`
  via FromIterator and Extend, raw/NFC-normalized idents through `symbol_normalize_and_validate_ident`, negative
  integer/float literals, all four delimiters, empty group), `expand` (`ts_expand_expr`: literals, bool, negated
  numbers, byte/C strings, non-literal exprs -> Err), `diag` (`emit_diagnostic`: all four levels, children with
  0/1/2 spans), `span_debug` (`-Zspan-debug` branch of `span_debug`).
- Negative control: perturbing `span_column` (+1 dropped), one `literal_from_str` error string and the delimiter
  spacing of `to_internal` fails exactly `spans`, `lits`, `construct` and `groups_docs`.
- Test-only stand-ins (`PORT(test)` in the file): the mock resolver implements only `resolve_dollar_crates` (no-op;
  reached from `expand_expr`'s `collect_invocations`; no case has `$crate`); `macro_def_id` is an arbitrary
  external `DefId` (only `.krate` is read, by `span_recover_proc_macro_span`).
- **PENDING (not covered by the oracle test):**
  - `BangProcMacro` / `AttrProcMacro` / `DeriveProcMacro::expand`, `expand_derive_macro`: need `Client::run1/run2`
    (running a proc-macro dylib) -> **M6**.
  - `span_save_span` / `span_recover_proc_macro_span`: need proc-macro crate metadata (M5/M6).
  - Proc-macro input built by `macro_rules!` (invisible `MetaVar` groups and their collapsing loop, `NtIdent`,
    `NtLifetime`): needs mbe transcription in the harness (spans carry transcription ctxts); add once the
    `expanded-nocore` suites can run user proc macros (M6) or as a harness extension.
  - `track_env_var` / `track_path`: observable only in `--emit dep-info`.

## `unported(...)` left
- `proc_macro::bridge::server::run_server (Client::run1: running a proc-macro dylib, M6)` and the `run2` twin
  (src/proc_macro/bridge/server.ts). Reached from every `expand` in proc_macro.ts.
- None in proc_macro.rs / proc_macro_server.rs themselves.

## PORT decisions (please record)
1. **D-proc_macro location (brief asked to record the choice):** the `proc_macro` library is ported as a
   std-like library in `src/proc_macro/` (mirroring `library/proc_macro/src/`; the compiler crate
   `rustc_proc_macro` is only a Cargo wrapper whose `lib` path is `library/proc_macro/src/lib.rs`), with
   `// std:` / `// std-type:` markers. M2 ports only the server-facing types; the client API, RPC
   (`rpc`/`buffer`/`handle`/`closure`/`arena`/`symbol`/`selfless_reify`/`fxhash`) and the dispatcher are M6.
2. `trait FromInternal` / `ToInternal`: TS interfaces (`FromInternal<T, Self>`, `ToInternal<Self, T>`) carrying the
   trait-method markers (:27, :31); each impl is a private table named after its type pair
   (`Delimiter_FromInternal`, `TokenTree_ToInternal`, `Level_ToInternal_Sublevel`, ...).
3. `impl ToInternal<SmallVec<..>> for (TokenTree, &mut Rustc)` takes the tuple `[tree, rustc]`; `SmallVec` -> array.
4. `impl server::Server for Rustc` methods live in the `Rustc` class body after `sess`/`psess`; the two
   associated fns without `self` are statics. `Rustc` implements `server.Server<TokenStream, Span, Symbol>`.
5. `SelfProfilerRef::generic_activity_with_arg_recorder` is missing from the rustc_session stand-in; with no
   self-profiler its recorder closure never runs, so `record_expand_proc_macro` / `expand_derive_macro` call
   `generic_activity(name)` and keep the closures as comments (proc_macro.ts header).
6. `Session.env_depinfo` (`Set<string>`): `track_env_var` stores the JSON text of the `[var, value|null]` strings,
   the encoding passes.ts (`env_var_os`, `write_out_deps`) writes and reads.
7. `StableSourceFileId` equality in `span_join` compares `stable_source_file_id_key(..)` (source_map.ts), the
   canonical key of the hashed fields.
8. `span_subspan`'s `usize` bounds are numbers: `checked_add(1)` cannot be reproduced at `usize::MAX`, but any such
   bound fails the following `> u32::MAX` check either way (same result).
9. `cancel_diags_into_string`'s lazy `flat_map` is an explicit loop (cancels up to the first message, then the
   rest), keeping the "no diagnostic has a message" panic (oracle-checked ICE).
10. `AttrProcMacro` (class) gets the provided `expand_with_safety` by delegating to `AttrProcMacro_provided(this)`.
11. `EXPAND_DERIVE_MACRO_CACHED` is an `AtomicRef` holding the upstream panicking default.

## For root
1. `src/rustc_expand/lib.ts` (expand-base's file) still says `// pub mod proc_macro; (PORT(pending
   expand-pm-types) ...)`: replace with `export * as proc_macro from "./proc_macro.ts";` (and drop the
   `// mod proc_macro_server;` note's pending state if any). Not edited here (not my file).
2. `rustc_session/stand_ins.ts`: add `SelfProfilerRef.generic_activity_with_arg_recorder(label, f)` (returns the
   none guard without calling `f`) when convenient; then proc_macro.ts can call it directly (decision 5).
3. `rustc_builtin_macros/env.ts` stores `Symbol` *numbers* in `env_depinfo` (`JSON.stringify([var_, value])` with
   `Symbol`s) while passes.ts parses the entries as strings (`Symbol.intern(k)`); `env!` dep-info would print the
   numbers. track_env_var here uses strings (passes.ts's encoding). Worth a fixer look at env.ts.
4. Upstream oddity worth knowing: `TokenStream::from_str("( ]")` ICEs at the pin ("no diagnostic has a message",
   mismatched-delimiter diagnostics carry no plain-string message); reproduced, covered by `ice_mismatched_delims`.
5. Delete `docs/claims/wave9-expand-pm-types.md` on integration.

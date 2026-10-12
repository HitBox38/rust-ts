ACCEPT-WITH-FIXES

# Review: harness batch `harness-fluent` (commit 8c218f3)

Reviewer: review-hf (independent, read-only). Reviewed `lane/harness-fluent` at 8c218f3 (base deab72c). The lane merges cleanly into current `main` (d830902), and the merged tree passes `bunx tsc --noEmit -p .`.

The batch is sound. It weakens nothing. The probe computes what rustc's `format_fluent_str` computes, with the exact upstream crate versions and the real baked ICU data, and a working build-time guard against drift in the copied functions. The corpus is complete and deterministic. I checked the extraction independently against `syn`'s own `LitStr::value()` and found zero differences. The subject's framing is byte-identical to the probe's over the whole corpus.

Two findings should be fixed **before the first `fluent-*` baseline is accepted**:
- 1: unpinned transitive dependencies.
- 3: `parse` vs `parse_runtime`.

Both change oracle output or its reproducibility, so fixing them after cases are protected would show up as losses. The others are small.

## What I checked

1. **No weakening.**
   - `git diff --name-only main...8c218f3` lists only: the handoff, `harness/corpus/gen-fluent.ts`, `harness/corpus/fluent/**`, `harness/suites.ts` (append-only: `repoCorpusDeep`, `fluentCases`, two `SUITES.push` entries), `src/rust_ts/fluentdump.ts` and `tools/probes/fluentdump/*`. Nothing under `scripts/` or `harness/baseline/`, so MATCH semantics (`classify` in `scripts/difftest.ts`) are untouched.
   - Case-list hashes (`sha256(JSON.stringify(cases()))`, first 16 hex digits) are identical in `main` and the lane: lex `a8a356bd10b8a7b6`, parse `b244fb01ad2573be`, escape `a8a356bd10b8a7b6`, symbols `7b46e1e12e1f8d93`, escape-synthetic `6618a744d214bf09`.
   - The oracle argv and all other suite fields are identical. Subject argv is identical once the absolute worktree root is normalized; it embeds `REPO`, which is the only difference.
2. **Probe dependencies.**
   - A script compared all 50 packages in `$RUST_TS_DATA/probes/fluentdump/Cargo.lock` against upstream `Cargo.lock` on name, version, source and checksum. The 48 registry packages all match exactly, including fluent-bundle 0.16.0, fluent-syntax 0.12.0, intl-memoizer 0.5.3, intl_pluralrules 7.0.2, icu_list/icu_locale_core/icu_provider 2.3.0, unic-langid 0.9.6, zerovec 0.11.7 and tinystr 0.8.4. The other two are local: `fluentdump` and `rustc_baked_icu_data`, a path dependency on the pinned checkout.
   - Features match `compiler/rustc_error_messages/Cargo.toml`.
3. **Verbatim copies.**
   - I read all 7 `// BEGIN verbatim` blocks of `main.rs` against `rustc_error_messages/src/lib.rs:13,231,300,311,344` and `rustc_errors/src/formatting.rs:10,39`.
   - The only lines outside the blocks are: the `DiagArgValue` derive (drops Encodable/Decodable/Hash/Eq/PartialEq; Debug is kept, and its output is printed), the `DiagArgMap = IndexMap` alias (iteration order equals insertion order, and `FluentArgs::set` sorts by key anyway), no-op `trace!`/`debug!`, imports, and the corpus/IO code. `fluent_bundle::FluentBundle` resolves to the same non-concurrent alias rustc uses through its `pub use fluent_bundle::{self, ..}`.
   - `langid!("en-US")`, `set_use_isolating(false)` and `GENERATED_MSG_ID` framing are all inside a checked block.
4. **build.rs guard.**
   - I compiled `tools/probes/fluentdump/build.rs` standalone and ran it against a scratch copy of `main.rs`. The unmodified copy passes.
   - Each of these mutations failed with `verbatim block <path>:<line> differs from upstream`: `set_use_isolating(true)`, `en-GB`, `From::from(n + 0)`, `ListLength::Short`, `"STREQ2"`, `FluentArgs::new()` instead of `with_capacity`.
   - One bypass exists (finding 2).
5. **Corpus determinism.**
   - Ran `bun harness/corpus/gen-fluent.ts` on a `git archive` copy of the lane: `git status` was empty afterwards (4210 files, 4660 occurrences, 4123 unique, no `not a literal`/`ERROR:` lines).
   - `git check-attr text` on the corpus gives `unset`.
6. **Corpus completeness and decoding (independent of the ported lexer and escaper).**
   - I wrote a scratch extractor on syn 2.0.117, the version rustc_macros uses, with `span-locations`. It visits every attribute whose last path segment is one of the 9 accepted kinds (the list in `SubdiagnosticVariant::from_attr` plus `diag`) and every `msg!` macro, and calls `LitStr::value()`.
   - Result: 4658/4658 occurrences have the same file:line and **byte-identical values**, with 0 seen only by syn. Those literals include 42 raw strings, 22 `\`+newline continuations, 154 `\"`, 2 `\n` and 223 multi-line literals.
   - The 2 occurrences syn could not see are correct:
     - `rustc_ast_passes/src/feature_gate.rs:116` is `msg!` inside a `gate_multi!(..)` invocation.
     - `rustc_middle/src/ty/context.rs:1630` is in a file syn 2 cannot parse.
   - A per-file grep count matches the corpus exactly, except for doc-comment examples in `rustc_macros` and one commented-out `#[suggestion(` at `rustc_hir_typeck/src/diagnostics.rs:542`.
   - No other `DiagMessage::Inline` producers exist: the only constructors are `Message::diag_message` (rustc_macros) and `EagerDiagMessageBuilder`, which takes an existing Inline. There are no `inline_fluent!` or `fluent_generated` leftovers.
   - Forms like `#[lint(..)]`, `#[subdiagnostic]` and `#[primary_span]` carry no message at this pin. Bare `#[note]` and similar forms would be counted as not-a-literal, and the count is 0.
7. **Argument matrix.**
   - It is derived only from the message text (`scan_vars`/`scan_keys`), so it is deterministic and independent of the code under test.
   - Full oracle run over 4210 cases: 17338 `=> Ok`, 1719 `=> panic`, which matches the handoff.
   - Plural selection is exercised: e.g. `rustc_ast_passes/src/diagnostics/L00650` picks `[one]` for `Number(1)` and `Number(-1)`, and `[other]` for 0, 2, 5, `Str("1.5")` and lists.
   - StrListSepByAnd is formatted through ICU: 2125 outputs contain `a, b, and c` and 130 contain `a and b`.
   - Triviality: see finding 6.
8. **Subject framing.**
   - In a scratch copy I replaced `parse_and_dump` and the `format_diag_message` call with constants. Over the full corpus, all `file`/`msg`/`text`/`vars`/`keys`/`args` lines are byte-identical: 12630 lines in parse mode, 40107 in format mode. The position and count of the result lines are identical too.
   - `RUST_TS_AGENT=review-hf bun scripts/difftest.ts --suite fluent-parse --sample 50` (run from the lane) gives UNPORTED=50, DIFF=0, CRASH=0. `--suite fluent-format --sample 50` gives the same.
9. **Cache key** (`scripts/difftest.ts:81`): `[PIN.commit, hash(probe binary), suite name, case id, args, hash(case file)]`.
   - The probe output depends on the binary (main.rs, all crates, the baked ICU data compiled in), the mode (implied by the suite name), the file path (= case id) and the file bytes (message + provenance). The argument matrix is computed inside the probe from those bytes.
   - So the key is complete for this batch. See finding 7 for a generic gap.

## Findings

### 1. MEDIUM: 15 transitive crates are not pinned, so the oracle can drift on a fresh build (tools/probes/fluentdump/Cargo.toml.in:32-57; handoff line 63)
The handoff says "Every transitive registry crate is also pinned with `=`". It is not true. These resolved crates have no `=` pin:
- `intl_pluralrules 7.0.2`: decides plural categories, so it directly drives `[one]`/`[other]` selection.
- `tinystr 0.8.4`, `writeable 0.6.4`, `yoke 0.8.3`, `zerotrie 0.2.5`
- `icu_locale_fallback 2.3.0`, `icu_locale_fallback_data 2.3.0`
- `unic-langid-impl`, `unic-langid-macros`, `unic-langid-macros-impl 0.9.6`
- `fluent-langneg 0.13.1`, `type-map 0.5.1`, `hashbrown 0.17.1`, `equivalent 1.0.2`, `stable_deref_trait 1.2.1`, `proc-macro-hack`

The probe's `Cargo.lock` lives only in `$RUST_TS_DATA` and is not committed.

Scenario: after e.g. `tinystr 0.8.5` or `intl_pluralrules 7.0.3` is published, a fresh `bun scripts/probes.ts build fluentdump` resolves the newer version. That can happen on a new machine, after `$RUST_TS_DATA` is wiped, or after a cargo update. The oracle then no longer equals rustc's dependency set. Nothing fails: the binary hash changes, so the cache silently refills with the drifted oracle. Newer versions of several of these crates already sit in the local registry (tinystr 0.8.3/0.8.4, writeable 0.6.3/0.6.4, yoke, zerotrie), so this is not hypothetical.

Fix (in this batch, no `scripts/` change needed), either or both:
- (a) Add `=` pins for every remaining registry package in the resolved lock.
- (b) Better: have `build.rs` also read `$CARGO_MANIFEST_DIR/Cargo.lock` and assert that every `[[package]]` with a `source` exists in `@UPSTREAM@/Cargo.lock` with the same version and checksum. That makes the lock check mechanical, as the verbatim check already is.

Correct the handoff sentence.

### 2. LOW: the verbatim guard only checks blocks that are still marked (tools/probes/fluentdump/build.rs:20-42)
I deleted the `// BEGIN verbatim compiler/rustc_errors/src/formatting.rs:39` line and changed `set_use_isolating(false)` to `true` in the same edit. The build script passed: there was no BEGIN marker, so the leftover `// END verbatim` was ignored, and `blocks > 0` still held.
Scenario: a later edit "fixes" a compile error in a copied function by un-marking it, and the oracle silently diverges from rustc.
Fix: assert the exact set of `<path>:<line>` specs, i.e. the 7 current ones, as a constant in build.rs. At minimum assert `blocks == 7`, and reject a stray `// END verbatim` outside a block.

### 3. LOW-MEDIUM: `fluent-parse` dumps `parser::parse`, but rustc calls `parser::parse_runtime` (tools/probes/fluentdump/main.rs:386-387; harness/suites.ts:165)
`FluentResource::try_new` in fluent-bundle 0.16.0 (`src/resource.rs:85`) uses `parse_runtime`, which drops comments. `parse`, the full-AST mode, is never called by rustc.
I compared the two dumps on the whole corpus with a scratch program on fluent-syntax 0.12.0: they differ on exactly 3 cases (`synthetic/S025`–`S027`, the comment-after-message cases) and agree on 4207.
The impact today is small: the suite description is accurate, and the runtime path is exercised indirectly through `fluent-format`, including the runtime AST Debug inside `try_new(..).unwrap()` panic payloads. But the brief asks for "what rustc computes". Changing the mode after `fluent-parse` cases are protected would turn the 3 changed cases into losses.
Fix: before the first accept, make `parse` mode dump `{:#?}` of `parse_runtime` (what rustc runs), or dump both in sequence. Update the suite description and the wiring comment in `src/rust_ts/fluentdump.ts:5-12` (`parse_runtime` exists in the vendored `src/vendor/fluent_syntax/parser/mod.ts` on main).

### 4. LOW: the silent panic hook is global, so oracle failures carry no message (tools/probes/fluentdump/main.rs:374)
`set_hook(|_| {})` is installed before any file is read. Any panic outside `catch_unwind` exits 101 with empty stderr, and `difftest` then reports `oracle failed on X (exit 101): ` with nothing to diagnose. Such panics include `fs::read(..).unwrap()`, `read_records` asserts on a bad corpus file, and a panic inside `fluent_syntax::parser::parse` in parse mode.
Fix: install the silent hook only around the `catch_unwind` in `format_record` (`take_hook`/`set_hook`). Alternatively, keep a hook that prints the payload to stderr when a flag (set while not inside format) is clear.

### 5. LOW (future repins): case ids are keyed by upstream line number (harness/corpus/gen-fluent.ts:230)
The ids look like `.../L01234.msgs`. After a repin, any message whose first occurrence moved to another line gets a new id, even if the text is unchanged. `gate.ts` then counts the old id as lost (`scripts/gate.ts:77`), so ordinary line churn in rustc produces mass false "losses" in a protected `fluent-*` suite.
Fix (preferred before the first accept): name cases by content, e.g. `<crate>/<sha256(message)[:12]>.msgs` (the provenance lines still record file:line). Otherwise, document the repin migration step for this suite.

### 6. INFO: about 60% of `fluent-format` cases are identity
2522 of 4210 cases have no `$` reference and format to exactly their input text. A protected-set count for this suite therefore overstates coverage of the formatter. This is not a weakening: the subject runs the real `format_diag_message` → `format_fluent_str` path, and the variable, plural, list, function and error cases (the other 1688 cases, about 16.5k rows) carry the signal. Consider saying so in the suite description, or reporting the two groups separately in the handoff.

### 7. INFO (scripts, separate batch): the oracle argv is not in the cache key (scripts/difftest.ts:82)
If a suite's oracle argv changes but the probe binary does not, stale cached outputs are served. Example: a new probe mode string that is selected only in `suites.ts`. This does not affect this batch as written: modes are fixed per suite name. It would matter if fix 3 were done as `suites.ts`-only argv changes on an existing binary. Suggest adding `JSON.stringify(s.oracle([c]))` to the key in a future harness batch.

### 8. INFO (for the porter wiring fluent-bundle, outside this batch): panic payloads need the Rust `unwrap` text
Of the 153 synthetic panic rows, 115 are `called \`Result::unwrap()\` on an \`Err\` value: (FluentResource(InnerFluentResource { owner: .., dependent: Resource { .. } }), [ParserError { .. }])` or `Fluent errors while formatting message: [..]`.
`src/std/result.ts:22` throws `called \`Result::unwrap()\` on an \`Err\` value` **without** `: {e:?}`. A TS `format_fluent_str` that uses it can therefore never match those rows. The port needs an unwrap that appends the Debug of the error, plus self_cell-shaped Debug for `FluentResource`.
The framing itself is meaningful: rustc ICEs with exactly this payload, the probe records just the payload, and the subject prints `Panic.message` the same way (`src/rust_ts/fluentdump.ts:139-146`). `Unported` is not a `Panic`, so it is not swallowed.

### 9. INFO: one unported record hides the rest of its batch
`runSubject` (`scripts/difftest.ts:143-147`) only retries timeouts in halves. Once the subject exits 70 or 101 on one record, every later case in that batch reports UNPORTED or CRASH, even if it would match. This is existing harness behaviour, and it is conservative: it never inflates matches. It only matters once parse/format are wired and a few constructs remain unported. If so, root may want per-file isolation for these two suites later.

## Not checked
- The full `difftest` of both suites; I ran only the sample-50 runs (full runs are root's job). The oracle side did run cleanly on all 4210 files in my scratch run, in both modes.
- Behaviour on Windows; the host is macOS.

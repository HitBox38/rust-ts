# Handoff: m2b-misc (M2b): the scattered stops of the with-std suites

Branch `lane/m2b-misc`, based on main 31568d0, with `lane/harness-w12` merged in (a real merge, only so the with-std
suites can run here; root decides how to land it). Not merged into main, not pushed.

## Result

| stop | before | after |
|---|---|---|
| `rustc_session::Session::resolve_path (session.rs:934)` (include!/include_str!/include_bytes!) | 6 in the w12 1500 sample | **gone** (`Session::resolve_path` was already ported; source_util.ts now calls it) |
| `std::path::Path::file_name` | 1 (w12 1500), 5 in the last nocore gate | **gone** (all 6 MATCH) |
| `rustc_expand::expand::DeclaredIdents for Box<Item>` | 1 | **gone** |
| `std::panic::Location::caller (DiagLocation Display)` | 1 (w12 1500) + 15 in the last nocore gate | still UNPORTED (same text) under default Bun; **exact** with `BUN_JSC_useTailCalls=0`, see below |
| `BangProcMacro::expand (quote!; proc-macro bridge, M6)` | 3 | unchanged. Confirmed: `quote!` is `Client::expand1(rustc_proc_macro::quote)` behind the proc-macro bridge (M6) |

| suite | run | result |
|---|---|---|
| expanded `--sample 1500 --seed hw12-wide` (harness-w12's sample) | 20261013-213022-m2b-misc-dco9 | **1492** MATCH, 8 UNPORTED, 0 DIFF (w12: 1484 / 16) |
| expanded `--sample 1500` (`RUST_TS_AGENT=m2b-misc-2`) | 20261013-220624-m2b-misc-2-jw1h | 1489 MATCH, 11 UNPORTED, 0 DIFF: 4 `quote!`, 4 stability, 1 `Location::caller`, plus 2 new stops outside this lane (below) |
| expanded `--sample 300` | 20261013-220431-m2b-misc-w44z | 296 MATCH, 4 UNPORTED, 0 DIFF |
| unpretty-expanded `--sample 300` | 20261013-220507-m2b-misc-d4t3 | 296 MATCH, 4 UNPORTED, 0 DIFF |
| resdump `--sample 300` | 20261013-220545-m2b-misc-v6m9 | 297 MATCH, 3 UNPORTED, 0 DIFF |
| parse `--sample 200` | 20261013-220413-m2b-misc-zu8b | 200/200 MATCH |
| expanded-nocore, every non-quote!/non-stability UNPORTED case of gate-20261013-203604-root-k75z (20) | per-file runs | 5 `Path::file_name` cases MATCH; 15 `Location::caller` cases still UNPORTED (delayed-bug ICEs, see below) |

Stop histogram after (hw12-wide 1500): 7 `middle::stability` (lane m2b-stability) + 1 `Location::caller`
(attributes/nonterminal-expansion, an oracle delayed-bug ICE). In the 300 samples: 2 `quote!`, 1 stability,
1 `Location::caller` (attributes/malformed-reprs, also an oracle ICE).

New stops found by the second-seed sample, outside this lane's files (for the queue):
- `Decodable for rustc_metadata::rmeta::VariantData (ty::VariantDiscr, M3)`, 1 case;
- `rustc_middle::ty::AssocItems::find_by_ident_and_kind (tcx.associated_items of an extern trait)`, 1 case.

## include!, include_str!, include_bytes!
`Session::resolve_path` was already ported in session.ts (session.rs:934). `source_util.ts` was still calling a
local `unported` placeholder; it now calls `cx.sess.resolve_path` in `expand_include` and `load_binary_file`. The
rest of the path was already in place: `SourceMap::load_binary_file`, `new_parser_from_file`, the non-UTF-8
`utf8_error` note, and `find_path_suggestion`. Every include case in the three suites matches (`--filter include`:
28/28 in each).

I also compared the full stderr and stdout against rustc with std (scratch `$RUST_TS_DATA/tmp/m2b-misc/cmp.sh`,
both `-Zunpretty=ast-tree,expanded` and `=expanded`; cases under `tmp/m2b-misc/inc/`). All of these match:
- relative paths from a cwd-relative and from an absolute crate root;
- nested `include!` of a file that itself has `include!` and `mod bar;` (the dir_path handling);
- `include!` as expression and as items;
- `include_str!` of a BOM+CRLF file, and of a non-UTF-8 file (the "wasn't a utf-8 file" error and its note);
- `include_bytes!` of a non-UTF-8 file;
- missing files (`couldn't read ...: No such file or directory (os error 2)`), with the "there is a file with the
  same name in a different directory" suggestion and without it;
- an absolute missing path built with `concat!`;
- a relative path from stdin input (`ResolveRelativePath`: "cannot resolve relative path in non-file source `<anon>`").

## Path::file_name
`std::path::Path::file_name` was already in `src/std/path.ts` (`path_file_name`, matching std path.rs:2703:
`components().next_back()` if it is `Normal`). Changes:
- `RealFileName::to_string_lossy`'s `Short` arm (rustc_span lib.rs:491) now uses it, `""` when there is none.
- Two `// std:` markers in `src/std/path.ts`: `path.rs:2703 file_name` and `path.rs:2636 parent`. These are
  comment-only changes in std; they replace the old doc-comment line references.

## DeclaredIdents for Box<Item>
expand.ts already had the impl (expand.rs:1459) as a module-private `Item_declared_idents`. It is now exported,
because upstream's trait is `pub`. cfg_select.ts imports it instead of its `unported` placeholder.

## Location::caller (`-Ztrack-diagnostics`, `delayed at`): src/rust_ts/track_caller.ts (new glue)
What rustc prints is the oracle binary's `#[track_caller]` location. It is the `fn_span` of the call, taken in the
innermost non-`#[track_caller]` function, that entered the chain ending in `DiagLocation::caller()`:
- method calls start at the method name; other calls start at the start of the call expression;
- the span is mapped to its outermost macro call site (`expansion_cause`);
- it prints as `/rustc-dev/<commit>/<path>:<line>:<col_display+1>` (`caller_location_span`, `location_triple_for_span`).

The port is line by line, so that call has a mirror in our sources. The mechanism:
- `DiagLocation.caller_()` stores a captured JS stack under a placeholder `file`.
- Only when the location is displayed, `track_caller.resolve` walks that stack:
  1. Each frame is attributed to its enclosing marked declaration: `// rustc:`, `// rustc-derive: .. Diagnostic`,
     or `// rustc-macro: <path>:<line> <name>!`.
  2. It skips frames that are `#[track_caller]` upstream: the attribute on the fn itself, or on the trait method
     the fn implements (for example `Diagnostic::into_diag`).
  3. It also skips derive(Diagnostic) glue and `macro_rules!` ports. Those are transparent, because the
     location is the macro invocation.
  4. Closures inside a `#[track_caller]` fn are not skipped.
  5. Every caller frame's call position must name the function of the frame below it (the `Type_method` family
     is allowed, e.g. `X_into_diag`).
  6. The first remaining frame is the caller `G`. Its TS call is the k-th call of that name in its ported body.
     G's upstream body must have the same number of calls, and the k-th one gives line and col.
- Anything that doesn't check out is still `unported` with the same text as before. Examples: a broken link, an
  unmarked frame, a count mismatch, a call inside a `macro_rules!` body, non-ASCII before the column.
- With `RUST_TS_TRACK_CALLER_DEBUG` set, the unported text also gives the reason.
- It reads the upstream sources from `$RUST_TS_DATA/rust`, falling back to `.env.local` as in scripts/lib/common.ts.

**The JSC tail-call problem (needs a root decision).** JSC does proper tail calls in strict code. Each
`return f(..)` therefore drops the caller's frame, for example `DiagInner.new` → `new_with_messages` at the base
of every chain. With Bun's default every display refuses. The resolver can't guess past the missing frame.
- Validation with `BUN_JSC_useTailCalls=0`: I took the 1492 MATCH files of the hw12-wide sample and added
  `-Ztrack-diagnostics` to unpretty-expanded's argv (scratch `tmp/m2b-misc/trackdiag.ts`).
  - Tail calls off: **1492/1492 identical to rustc, with 753 `created at` notes, every one exact.**
  - Default (tail calls on): 1062 MATCH, 430 UNPORTED, 0 DIFF. No wrong location is ever printed.
- The 15 nocore delayed-bug cases, with tail calls off: 13 print exactly rustc's `delayed at` lines. The other two,
  macro-use-bad-args-1/-2, refuse: the call sits in a closure in the `ATTRIBUTES` associated const, which has no
  fn marker to anchor it.
- Turning tail calls off globally in `src/rust_ts/stack.ts`'s re-exec is **not** free. I measured it at rustc's
  own nesting limits (fix-parser.md), `-Zparse-crate-root-only`. Parens (7421) and unary minus (17282) then
  overflow (SIGBUS). Mod, closures, blocks and `[T]` still pass. On macOS the stack is already capped at LC_MAIN,
  so there is no room to compensate. I did not touch stack.ts.
- Options for root:
  - (a) Leave it. Locations stay unported, as before this lane.
  - (b) Have `ensure_stack` set `BUN_JSC_useTailCalls=0` only when the argv asks for `-Ztrack-diagnostics`.
    That covers compiletest's track-diagnostics tests, at the cost of nesting depth for those runs.
  - (c) Recalibrate the stack and go global on Linux only.
- Even with tail calls off, the delayed-bug cases are not MATCH yet. After the `delayed at` notes, rustc's panic
  hook prints `report_ice`: the "we would appreciate a bug report" note, the nightly note, the version and host
  note, the compiler flags, `query stack during panic:` and `end of query stack`. That hook is unported
  (rustc_driver_impl `install_ice_hook`, by design; main.ts prints a JS ICE dump instead). Those cases would then
  turn from UNPORTED into DIFF. Next step for them: port `report_ice` and `try_print_query_stack` for
  `DelayedBugPanic` (no Rust panic location is printed for it).

## Files touched
- `src/rustc_builtin_macros/source_util.ts`: uses `Session::resolve_path`; the placeholder is removed.
- `src/rustc_span/lib.ts`: `RealFileName::to_string_lossy` Short.
- `src/std/path.ts`: the two `// std:` markers (comment-only).
- `src/rustc_expand/expand.ts`: `export` on `Item_declared_idents`.
- `src/rustc_builtin_macros/cfg_select.ts`: uses it.
- `src/rustc_errors/diagnostic.ts`:
  - `DiagLocation.caller_` captures the stack;
  - `display_DiagLocation` resolves it;
  - a `// rustc-macro: ... struct_span_code_err!` marker.
- `src/rust_ts/track_caller.ts` and `src/rust_ts/track_caller.test.ts`: new.
- Comment-only `// rustc-macro:` markers on macro_rules ports, so the resolver can see through them:
  - `src/rustc_ast_passes/feature_gate.ts`: `gate!`, `gate_alt!`, `gate_multi!`, `gate_all!`;
  - `src/rustc_attr_parsing/attributes/repr.ts`: `repr_int!`.
- Not touched: `middle/stability.rs` and the resolver's stability call sites (lane m2b-stability).

## Coverage (`bun scripts/coverage.ts --missing`)
- source_util.rs 12/12, cfg_select.rs 3/3;
- diagnostic.rs 94/94, rustc_span lib.rs 242/242, expand.rs 262/262;
- session.rs 78/104 (unchanged; resolve_path was already ported);
- `--check`: markers ok.

## Checks
- `bunx tsc --noEmit -p .` clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3891 pass, 1 skip, and 1 fail at first. The fail
  was json.oracle.test.ts's `-Ztrack-diagnostics` case, which pins the stop text. I kept that text canonical (the
  reason is only shown under `RUST_TS_TRACK_CALLER_DEBUG`), and that test and track_caller.test.ts now pass
  (88/88).
- `coverage.ts --check` ok.
- parse `--sample 200` 200/200.

## unported(...) left / changed
- `std::panic::Location::caller (DiagLocation Display)`: same text. It is now reached only when the stack can't
  be resolved exactly, which is always the case under Bun's default tail calls.
- `std::path::PathBuf::from_iter (Session::resolve_path, Windows verbatim path)`: pre-existing, in session.ts;
  not reachable on macOS/Linux.
- `rustc_expand::proc_macro::BangProcMacro::expand (quote!; proc-macro bridge, M6)`: unchanged (M6).

## PORT: decisions
- track_caller.ts: Location::caller is resolved lazily, from the captured JS stack plus our markers plus the
  pinned upstream sources (rustc has it compiled in). It refuses rather than guesses. The `/rustc-dev/<commit>`
  prefix is the oracle build's remap, the same constant as rmeta decoder.ts.
- diagnostic.ts: `RUST_TS_TRACK_CALLER_DEBUG` appends the refusal reason to the unported text.
- `rustc-macro:` markers of the form `<path>:<line> <name>!` (bare) mark `macro_rules!` ports. The resolver
  checks that `macro_rules! <name>` is on that upstream line.

# Review: rustfmt-contract-1 (porting lane, M8 wave 41 step 4)

Reviewer: independent, read-only. Subject: branch `t3/rustfmt-contract-port` at `4ec25456` (commits `573c7ab7`, `4cc21e68`, `4ec25456`;
`git diff main...4ec25456`: 27 files, all under `src/rustfmt/` plus the handoff). Handoff: `docs/handoff/rustfmt-contract-1.md` (PORT 1–9).
Scope: `docs/plan-m8.md` §3, D4–D6, D11, D13, D14. Root's decisions: history.jsonl "rustfmt-contract-1 PORT decisions" (2026-11-16T02:30)
and "codegen-fmt-serde PORT #2".

Method: one detached scratch worktree of `4ec25456` under `$RUST_TS_DATA/tmp/review-rustfmt-contract-1/` (`.env.local` copied,
`bun install --frozen-lockfile`). Scratch probe tests lived beside it, outside the repo, and imported the worktree by absolute path.
Each mutation was reverted with `git checkout` after its run. The worktree and probes were removed afterwards. Nothing was built,
`upstream.ts fetch` was not run, and the only oracle runs were `rustfmt_oracle.ts check` and the `print_docs` oracle test. The host was
on AC power, with a load of about 4–13.

## Verdict: PASS WITH NOTES

The hand ports are faithful where I read them in full: `config_type.rs` (hand parts), `options.rs` (hand parts), `file_lines.rs` and
`shape.rs`. The samples of `mod.rs`, `lists.rs`, `macro_names.rs`, `style_edition.rs`, `release_channel.rs` and `lib.rs` are faithful too.
Every check passes. `print_docs` is byte-identical to the pinned `rustfmt --help=config`, with and without `--unstable-features`. The
mutations I injected into the range merge and into defaults were caught.

None of the notes blocks the merge. Three should be acted on before rustfmt suites run:
- **N1:** the `usize::MAX` choice causes more than the `--print-config` printing that root recorded. It also stops a formatting path
  (reproduced below).
- **N2:** nothing guards the load-order rule.
- **N3:** nothing guards `contract_lib.d.ts`.

## Checks that pass (evidence)

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean (8.8 s) |
| `bun scripts/coverage.ts --check` | `markers ok (27670, …)` |
| `bun tools/codegen/rustfmt.ts --check` | clean (`8 files, 35 types, 14 serde derives, 23 #[config_type] enums, create_config! 90 options`) |
| `bun tools/codegen/rustfmt_oracle.ts check` | `ok: … rustfmt.expanded.rs matches the oracle's expansion` |
| `bun test src/rustfmt` | 30 pass, 0 fail, 138 expects, 0.50 s wall (D13: ≤ 10 s) |
| `RUST_TS_REQUIRE_PROBES=1 bun test src/rustfmt/config/print_docs.oracle.test.ts` | 2 pass: both `--help=config` and `--unstable-features --help=config` are byte-identical, so neither is a skip |
| `bun test src/std/result.test.ts src/std/panic.test.ts src/std/fmt.test.ts tools/codegen/rustfmt.test.ts` | 17 pass (includes the one-argument `unwrap_result` rule) |
| `bun test scripts/lib/unit-steps.test.ts` | 10 pass. The lane's tests read only `RUST_TS_REQUIRE_PROBES`, which is listed in `UNIT_ENV_HARMLESS`, plus a `process.env` spread into the oracle child. |
| Coverage | `config/mod.rs` 21/103 (the 82 left are tests), `lib.rs` 33/38 (the 5 `unit_tests`), the others complete, as the handoff says |

**Mutations** (each run alone, then reverted):

| Mutation | Caught by |
|---|---|
| `adjacent_to`: drop `\|\| other.hi + 1 === this.lo` | `test_range_adjacent_to` |
| `merge`: `Math.max(this.hi, other.hi)` → `this.hi` | `test_range_merge` and the not-upstream `normalize_ranges` test |
| `WidthHeuristics::scaled`: `w(60.0)` → `w(61.0)` | the not-upstream `scaled` test |
| `create_config.gen.ts` `MaxWidth` default `100` → `101` | both `print_docs` oracle tests, and `rustfmt.ts --check` (`ERROR: … create_config.gen.ts is stale`) |
| `Edition::default` `"Edition2015"` → `"Edition2018"` | **not caught** (N9) |

**Fidelity confirmed:**
- **`file_lines.rs`, in full.** These match upstream: `Range::{is_empty, contains, intersects, adjacent_to, merge}`, and `normalize_ranges`
  (a stable sort by the derived `Ord`, then a peek-merge loop equal to the `peekable` one). Setting an existing `KeyedMap` key during
  iteration keeps its position. Also matching: `file_range_matches` (canonicalize, then `get`, then `any`), `from_str`, `into_tuple`,
  the two `Display`s, and the `panic!`/`unreachable!` texts. The `\`-continued string joins to "please specify". The `unreachable(msg)`
  helper does not prefix, so the full message passed is right. The JSON parse stops `unported("vendor-serde_json …")`, which is
  correct.
- **`shape.rs`, in full.** Every function and every arithmetic step matches. `checked_sub` becomes `>=` plus subtract, and
  `saturating_sub` becomes a guarded subtract. The `INDENT_BUFFER[offset..=num_chars]` slice becomes `slice(offset, num_chars + 1)`,
  and it is still correct for `offset = 1, num_chars = 0`. `block_unindent` is guarded upstream and in the port.
- **The wrapping `usize` subtraction.** `Indent - Indent` and `Indent - usize` are the only unguarded subtractions. The port stops there
  with `unported` instead of wrapping. That is the "never guess" rule: a wrapped `usize` is past 2^53. A stop is an UNPORTED result,
  not a mismatch, so it is acceptable. I did not verify independently that the oracle's rustfmt is built without overflow checks. If
  it were built with them, upstream would panic there instead, which is also not what the port does. Either way the port does not
  produce a wrong value.
- **`config_type.rs` hand parts and `is_stable_option_and_value`.** These match, including the two `eprintln!` texts with their `\`
  continuations.
- **`options.rs` hand parts.** These match: `to_heuristics`, `to_list_tactic` (`<=` becomes `le`), `use_colored_tty`, `null`, `set`,
  and `scaled`. In `scaled`, f32 division and multiplication by double then `fround` are correctly rounded, and `f32_round` rounds half
  away from zero. Also matching: the `FromStr`s, `IgnoreList`'s Display, serde and accessors, the three `From`s, and the two
  `partial_cmp`s, including the `Edition2027` arms.
- **Samples.** `mod.rs` (`to_toml`, `to_parsed_config`, `check_semver_version`, `default_for_possible_style_edition`,
  `version_meets_requirement`, `load_config`, `get_toml_path`, `config_path`), `lists.rs` (all 5), `lib.rs` (`format_snippet`,
  `format_code_block`, `Session::new`, `create_emitter`, `drop`) and `release_channel.rs`.
  - `CARGO_PKG_VERSION = "1.11.0"` matches `src/tools/rustfmt/Cargo.toml`.
  - In `format_code_block`, the slices count UTF-16 units: `rfind('}')`, `FN_MAIN_PREFIX.len()`, and an offset into an ASCII indent
    the line starts with. Each gives the same text as upstream's byte slice. The width tests use `utf8_len`.
  - Markers out of upstream order (`lib.rs:539` before `:520`, `macro_names.rs:61` before `:40`, `file_lines.rs:86` and `:311`) are
    methods of later impls placed in the class body, which PORTING §8 allows.

## Findings

**N1. The `usize::MAX` representation stops a formatting path, not only `--print-config`.** (medium; reproduced)

- **What I found.** Representing `usize::MAX` as `Number.MAX_SAFE_INTEGER` follows the project's convention:
  `rustc_span/source_map.ts:1446` `USIZE_MAX`, `rustc_span/edit_distance.ts:17` `usize_MAX`, `promote_consts.ts`,
  `fulfillment_errors.ts:2563` and `coverage/expansion.ts:89`. For comparisons it is exact. Every upstream use of the heuristic widths
  is a `min(…)`, a `<=`/`>` against a real width, or a `LimitedHorizontalVertical` limit that is `min`'d (`chains.rs:750`,
  `lists.rs:245`/`:888`, `overflow.rs:775`, `expr.rs:1076`/`:1080`, `items.rs:166`).

  The problem is the generated `Config::adjust_max_width`. Its helper `usize_saturating_add_signed` (`create_config.gen.ts:9593`) stops
  `unported` when the result is past 2^53, so a `MAX_SAFE_INTEGER` width plus any positive delta stops. Upstream saturates at
  `usize::MAX`, and `set_heuristics` then resets the width anyway.
- **Reproduction.** With `use_small_heuristics = "Off"`, I ran `reduce_max_width(8)` then `increase_max_width(tab_spaces)`, which is
  the `macros.rs:1364`/`:1370` sequence for a `macro_rules!` body that does not format as items. The result:

  ```
  fn_call_width 9007199254740991
  after reduce 9007199254740991 92
  STOP: Unported unported: usize::saturating_add_signed past 2^53 (Config::adjust_max_width)
  ```

  It is a stop, not a wrong output. Any input with `use_small_heuristics = "Off"` and a `macro_rules!` arm body that does not format as
  items reaches it. Neither of rustfmt's two `tests/source` files with `use_small_heuristics: Off` (`chains.rs`,
  `configs/use_small_heuristics/off.rs`) has a `macro_rules!`, so the committed targets may not show it. A CLI suite over user configs
  could.
- **Fix (a tools batch, since the helper is generated).** `usize_saturating_add_signed` should treat `USIZE_MAX` as the saturation
  bound: return `USIZE_MAX` when `value + delta >= USIZE_MAX`. That is exact under the representation, because nothing past it is
  representable anyway. Root should widen decision (1) to say so. Minor: `ISIZE_MAX = 2 ** 63 - 1` in the same file is really 2^63 as a
  double. That is harmless where it is used, but its comment should say so.

**N2. Load order: no guard, and the failure set is not what the handoff says.** (medium)

- **What I found.** I imported each module first, before `config/mod.ts`, in a scratch `bun test` with the serde stubs installed:

  | Imported first | Result |
  |---|---|
  | `options.gen.ts`, `lists.gen.ts` | **OK** |
  | `macro_names.gen.ts` | `ReferenceError: Cannot access 'MacroName' before initialization` |
  | `file_lines.gen.ts` | `ReferenceError: Cannot access 'Range' before initialization` |
  | `create_config.gen.ts` | `ReferenceError: Cannot access 'MacroName' before initialization` |
  | any hand module (`options`, `lists`, `macro_names`, `file_lines`, `config_type`, `style_edition`) | OK |

  So root's rule (decision 2: "only through `config/mod.ts` or `lib.ts`, never a `.gen.ts`") is right and needed. But no test, lint or
  scan enforces it. `tools/codegen/rustfmt.test.ts` checks only the `contract.gen.d.ts` specifiers. `shape.ts` imports `config/mod.ts`
  type-only, which is fine.
- **Fix.** Add a scan, in `src/rustfmt/` or the codegen test, that fails when any file outside `src/rustfmt/config/` imports a
  `config/*.gen.ts`. Inside `config/`, it should allow only the hand modules and `mod.ts` to import them. The handoff's prose ("If a
  `.gen.ts` is evaluated first …") should name the three that fail.

**N3. `contract_lib.d.ts` has exact-path blocks but no guard.** (medium; demonstrated)

- **What I found.** All 9 blocks are named `../rustfmt/<path>.ts*`, none of the modules exists, and the only importers are `lib.ts`
  (8) and `shape.ts` (`rewrite.ts`). That part is good. But unlike `contract.gen.d.ts`, no test checks this file:
  - Nothing fails when a block's module lands and the block stays. The real module wins, so a stale block is silent.
  - Nothing checks who uses the specifiers. Because `*` matches any unresolved import with that text, a wrong-depth import also
    type-checks. I added `src/rustfmt/config/zz_probe.ts` with `import { indent_next_line } from "../rustfmt/utils.ts"`. That import
    resolves to `src/rustfmt/rustfmt/utils.ts`, which will never exist, and `bunx tsc` still exited 0. The same hole exists for
    `contract.gen.d.ts` inside `src/rustfmt/`: its guard checks users only outside `src/rustfmt/`.
- **Fix.** Extend the `contract.gen.d.ts` guard in `tools/codegen/rustfmt.test.ts` to `contract_lib.d.ts`, or add a twin test in
  `src/rustfmt/`, with three checks:
  - each block name has the form `../rustfmt/<path>*`;
  - `src/rustfmt/<path>` does not exist;
  - every file using a block's specifier resolves it to `src/rustfmt/<path>`, which means only files directly in `src/rustfmt/`.

  Apply the same resolution check to the generated contract's users inside `src/rustfmt/`.

**N4. `shape.rs`: division by `tab_spaces = 0` does not panic.** (low)

- **What I found.** `Indent::from_width` (`width / tab_spaces`, `width % tab_spaces`) and `to_string_inner` (`block_indent / tab_spaces`)
  run under `hard_tabs`. With `tab_spaces = 0`, upstream panics with "attempt to divide by zero". That check is on even without
  overflow checks. The port computes `Infinity`/`NaN` instead, and then `"\t".repeat(Infinity)` throws a `RangeError`. A `RangeError`
  is not a `Panic`, so `format_snippet`'s `catch_unwind` would not discard it the way upstream discards the panic.
- **Fix.** Panic with the upstream text when the divisor is 0. `src/vendor/odht/lib.ts:591` is the precedent.

**N5. `config_from_user_dirs` evaluates `config_dir` before `home_dir`.** (low)

- **What I found.** Upstream builds `[dirs::home_dir(), dirs::config_dir().map(…)]`, so `home_dir` runs first. `config/mod.ts` calls
  `dirs_config_dir()` before the loop. Today both are `unported`, so the stop names `dirs::config_dir` where the faithful order would
  name `dirs::home_dir`. That matters because root decision (6) routes both to vendor-fmt-small.
- **Fix.** Evaluate them in the upstream order.

**N6. `get_toml_path`'s error drops the anyhow cause.** (low; inferred from std/anyhow, not run)

- **What I found.** The port flattens `Error::new(Other, anyhow::Error::new(e).context(ctx))` to the context string. Its PORT comment
  says the Display is "the context alone". That is true for `{}`. But rustfmt's `main` prints `{e:#}` (`bin/main.rs:41`). There, anyhow
  walks the chain: the io error's `source()` is the anyhow error's source, the underlying metadata error. So upstream prints
  `Failed to get metadata for config file "…": <os error>`.
- **When it matters.** Only for a metadata error other than `NotFound`/`NotADirectory`, such as `EACCES`.
- **Fix.** Keep the cause in the error value, or `unported` the arm. Re-check this when `bin/main.rs` is ported.

**N7. Unit variants built as fresh objects.** (low)

- **What I found.** `Density::to_list_tactic` (`options.ts:52–63`) returns `{ $: "Mixed" }` and the like, and `Input::file_name`
  (`lib.ts:611`) returns `{ $: "Stdin" }`. PORTING §5 asks for the shared frozen singletons `ListTactic.Mixed` and `FileName.Stdin`.
  Both exist, and `file_lines.ts` uses `FileName.Stdin`. Any later `=== ListTactic.X` comparison would be false for these values.
- **Fix.** Return the singletons.

**N8. `serde_stubs.test_support.ts` is test-only, with no guard.** (note)

- **What I found.** Only the 6 test files import it. It imports `bun:test`, and nothing outside tests reaches it. Each stub is
  installed only while its module file is missing, so it switches itself off module by module as vendor-serde-de lands, as the
  handoff and root decision (3) say. No scan keeps non-test code from importing a `*.test_support.ts`.
- **Fix.** Optional: fold such a scan into N2's check.

**N9. Test gaps and a stale comment.** (low)

- `Edition::default` (options.rs:495) is not checked: mutating it to `"Edition2018"` left all 30 tests passing.
- `release_channel.ts` says the channel is "Checked against the oracle in config/config_type.test.ts". That file does not exist. The
  only evidence of the nightly channel is indirect: the oracle accepts `--unstable-features`, so the second `print_docs` test passes.
- **Fix.** Add a one-line `Edition::default` test. Then either add the channel check or correct the comment to point at the
  `print_docs` oracle test.

**N10. Function order in `file_lines.ts`.** (note)

- **What I found.** `display_FileLines` (`file_lines.rs:168`) and `normalize_ranges` (`:184`) come after the `FileLines` class
  (`:207`–`:311`), but upstream has them before the impl. `shape.ts` also places the `INDENT_BUFFER*` consts after `Indent`. These are
  free functions and constants, not later impls, so PORTING §8's class-body allowance does not cover them. No behaviour depends on
  the order.
- **Fix.** Move them on the next touch.

## For root

- Record N1's widening of decision (1). Queue the `usize_saturating_add_signed` saturation fix as a tools item, ahead of any rustfmt suite
  that can combine `use_small_heuristics = "Off"` with `macro_rules!` bodies.
- N2 and N3 are guard tests, small enough for a harness or tools batch, or for rustfmt-contract-2's brief if root allows that lane to touch
  `tools/codegen/rustfmt.test.ts`.
- Give N4, N5 and N7 to rustfmt-contract-2, which owns the nearby files' next touch: they are one-line fixes in `shape.ts`,
  `config/mod.ts`, `options.ts` and `lib.ts`. Give N6 to the bin/main.rs lane.

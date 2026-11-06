# Handoff: ice-report-impl (port side only)

Implements `docs/plan-ice-report.md` as amended by `docs/reviews/plan-ice-report.md`: no replay, no `RUST_BACKTRACE`
change, D4 and D11 amended, target 92 of 118 including all 14 `mir`. Base `1adcee8e`. Nothing under `harness/` or
`scripts/` changed; section 5 specifies what those need from root.

## 1. Result

**92 of 118 match byte for byte with thread ids masked, including all 14 `mir`.** Oracle output was captured fresh for
this run's argv and compared on stdout, masked stderr and exit code.

| Suite | Cases | Match | Of those, needs the mask | DIFF | UNPORTED |
|---|---|---|---|---|---|
| `mir` | 14 | **14** | 14 | 0 | 0 |
| `expanded` | 16 | 16 | 0 | 0 | 0 |
| `expanded-nocore` | 15 | 15 | 0 | 0 | 0 |
| `unpretty-expanded` | 16 | 16 | 0 | 0 | 0 |
| `unpretty-expanded-nocore` | 15 | 15 | 0 | 0 | 0 |
| `resdump` | 6 | 6 | 0 | 0 | 0 |
| `resdump-nocore` | 6 | 6 | 0 | 0 | 0 |
| `pm-ui` | 2 | 2 | 2 | 0 | 0 |
| `pm-expanded` | 1 | 1 | 1 | 0 | 0 |
| `mirdump-ui` | 4 | 1 | 1 | 2 | 1 |
| `thir-tree` | 9 | 0 | 0 | 7 | 2 |
| `thirdump-ui` | 7 | 0 | 0 | 6 | 1 |
| `tydump-ui` | 7 | 0 | 0 | 6 | 1 |
| **Total** | **118** | **92** | **18** | **21** | **5** |

The port started at 2 of 118 (`pm-ui` 1, `pm-expanded` 1), with the same mask applied.

- 74 of the 92 have no `thread` line, so they MATCH with no harness change. 18 need the mask of section 5.
- The 26 that do not match are the `RUST_BACKTRACE=short` cases the review put out of scope (D8 rejected).
  - The 21 DIFF cases are **identical to the oracle outside the backtrace frames**, including the untruncated query stack.
  - The 5 UNPORTED stop at `std::backtrace::Backtrace Display (captured frames)`: the delayed-bug note under `short`.
- `mirdump-ui`'s one MATCH is `mir/lint/storage-live.rs`, which runs with `RUST_BACKTRACE=0`.

Reproduce with `$RUST_TS_DATA/tmp/ice-report/cmp-impl.ts <tag>`; the result of the final run is `res-impl.json` beside it.

## 2. Wrong locations

**None printed on anything compared:**

| Check | Result |
|---|---|
| Every location the port prints across the 118 cases, in order, against the oracle's | 357 compared, **0 differ** |
| `-Ztrack-diagnostics` over 600 `tests/ui` files, tail calls off (`track_caller_check.ts --oracle 600`) | 1,531 locations in 504 comparable files, **0 wrong**, 91 refused, 5 not comparable; rule of three: under 0.2% |
| The three one-line inputs of review F3 | All equal the oracle, pinned in `track_caller.test.ts` |
| The validator's fixtures (`validate.oracle.test.ts`) | A resolved panic location now must equal the oracle's |

**Found and fixed:**

1. **The 8 proven swaps of the review.** The checker finds exactly these (8 sites, 3 fns); it now reports 0.
   - `rustc_parse/lexer/mod.ts`: the `Unknown` arm moves after the punctuation, as upstream.
   - `rustc_mir_build/thir/cx/expr.ts`: the `_ =>` arm is last again, instead of an early return.
   - `rustc_trait_selection/traits/select/mod.ts`: `ConstArgHasType`, upstream's last arm, moves below the `switch`. The
     `switch` still groups the other `Clause` arms, as before; only the `bug!` order is restored.
2. **New: an impl header split over lines made a `#[track_caller]` method look untracked.** `impl .. Diagnostic<'a>\n for X\n{`
   stopped `enclosing_impl_trait` at the `{`, so `into_diag` at `rustc_lint/nonstandard_style.rs:490` counted as the
   caller. Fixed, with a test.
3. **New: the link check compares names, so a dropped frame can hide behind its callee's name.** If a non-`#[track_caller]`
   `N` tail-calls another `N`, its frame goes and its caller's `x.N(..)` still links, which picks the wrong fn. The real
   sites are fixed with `keep_frame` or a bare statement:
   `PatCx::bug`, `PatCx::delayed_bug`, `impl_interner.ts span_delayed_bug`, `trait_impl_difference.ts emit_err`,
   `inspect/build.ts unwrap`. This cannot be detected at run time, so the checker reports the population (30 left, read by
   hand: their inner callee is a same-named but untracked fn, for example `TraitRef.self_ty`, `Expr.dummy`,
   `RegionTracker.new`, the register `emit`s in `rustc_target/asm`).
4. **Stricter than the review asked, because of 3:** keys that exist and differ now refuse even for a single call on both
   sides, and `unwrap(x, "msg")` is never the upstream `.unwrap()`. Keys also map an enum tag `{ $: "X" }` to variant `X`,
   which removes the `"Move"`-style noise the review flagged.

**What I could not rule out:**

- A **two-level** name collision (`N` tail-calls `M`, which tail-calls another `N`): the checker covers one level only.
- A **single call on both sides with no key** in a TS fn that lost its own call and inlined a helper's. This is the review's
  "no check needed" case; the key comparison above only helps where a literal or struct exists. 1,474 sites map this way.
- **148 mapped locations are absent from the oracle binary.** None has another column witnessed on its line, so they do not
  look like column errors, but absence proves nothing either way.
- **A `#[track_caller]` closure heuristic:** `in_closure` finds Rust closures by the token before a `|`. A false positive only
  refuses, but a closure it misses could be walked through. I found none in the reached paths.
- **`#[track_caller]` through a vtable or fn pointer:** the four traits with tracked methods (`Diagnostic`, `LintContext`,
  `ExpectNameValue`, `ExpectStringLiteral`) have no `dyn` use upstream, and a fn passed by path shows a native or unmarked
  frame, which refuses. This was a grep, not a proof.
- **Linux and Windows:** not run.

## 3. What changed

| Area | Files | What |
|---|---|---|
| Hook and panic | `src/std/panicking.ts` (new), `src/std/panic.ts` | `panic_with_hook`, `update_hook`, `default_hook`, backtrace style, `keep_frame`; the hook runs in `Panic`'s constructor with `panicking()` true, and a panic in the hook aborts (F5) |
| Resolver | `src/rust_ts/track_caller.ts` | Panic entry, D4 keys, `// rustc-call:` anchors, `// rustc-const:` markers, closure and `macro_rules!` refusals |
| Checker | `src/rust_ts/track_caller_check.ts` (new) | D11. Report-only, not a gate step; about 2.5 s without `--oracle` |
| Driver | `src/rustc_driver_impl/lib.ts`, `diagnostics.gen.ts` (new), `src/rustc_interface/{callbacks,interface,util}.ts`, `src/rustc_span/macros.ts`, `src/rustc_errors/lib.ts` | `report_ice`, `install_ice_hook`, `emit_bug_diagnostic`, `try_print_query_stack`, thread name, `bug_impl` location |
| Entry points | `src/rust_ts/{main,mirdump,resdump,thirdump,tydump,ckdump}.ts`, `src/miri/bin/miri.ts` | `report_uncaught`; the four dumps now call `install_ice_hook`, as their probes do |
| No hook on resume | `src/proc_macro/bridge/panic_message.ts` | `new Panic(msg, false)` |
| Port order | `lexer/mod.ts`, `thir/cx/expr.ts`, `select/mod.ts` | The swaps above |
| Non-tail edits (55) | See below | 47 `keep_frame`, 8 bare statements |
| Anchors (19) and markers (2) | `rustc_attr_parsing/attributes/{crate_level,proc_macro_attrs,repr}.ts`, `parser.ts`, `validate.ts`, `const_evaluatable.ts`, `sty.ts`, `select/mod.ts`; `macro_attrs.ts` `rustc-const:`, `type_check/mod.ts` `rustc-macro:` on `span_mirbug` | |
| Tests | `src/rust_ts/track_caller.test.ts`, `validate.oracle.test.ts` | Below |
| **Tools, needs your review** | `tools/codegen/types.sets.json` | One new set, `rustc_driver_impl`, which generates `diagnostics.gen.ts`, as plan §4 says. PORTING §1 reserves `tools/`, so please confirm |

**Non-tail edits by file:** `context.ts` 25, `repr.ts` 12, `parser.ts` 3, `rustc_errors` 2, `rustc_hir_typeck/lib.ts` 1, and one each for
the name-collision sites; the 8 bare statements are `bug`/`span_bug` sites (7 reached by a case, plus `PatCx::bug`). This is more than the review's upper bound of
47 for two reasons: the 5 sites of finding 3 above, and `context.ts`, where I changed every `expected_*` link rather than only the
reached ones because they are one uniform chain. None is on a hot path.

**Reaching the 49 corpus locations:** the D4 rules first refused 19 of 49, as the review warned they might (15 of them
`rustc_attr_parsing` sites with no key). All 19 are anchored, each read against upstream, and the oracle's output confirms them.
The checker now reports 49 of 49.

## 4. Numbers

**Coverage** (`bun scripts/coverage.ts --check --offline`: `markers ok`): `rustc_driver_impl/lib.rs` 30/43 (was 29), `rustc_interface/
interface.rs` 4/4, `callbacks.rs` 4/6 (left: `track_span_parent`, `track_diagnostic`). Total 24,245/27,053.

**`--sample 200`, `RUST_TS_AGENT=ice-report-impl`, on the final code:**

| Suite | MATCH | Other |
|---|---|---|
| `mir` | 200 | |
| `mir-o2` | 199 | 1 UNSTABLE (thread id, listed) |
| `tydump-ui` | 199 | 1 UNSTABLE (listed) |
| `borrowck-ui` | 200 | |
| `pm-ui` | 198 | 1 UNSTABLE (listed), 1 UNPORTED: `expand-expr.rs`, cross-thread execution, **not protected** |
| `run-pass-miri` | 200 | |

No timeouts occurred. Only the wave gate settles regressions; these are samples.

**Checker, full static pass:** 4,481 sites; mapped 1,152 by key, 1,474 single, 4 anchored; refused 1,079 count mismatch, 237 no key, 231 key not
unique, 45 key differs, 247 no upstream body, 11 `macro_rules!`, 1 other; **0 proven swaps**; 2,468 of 2,616 locations witnessed in the oracle binary.
The 45 "key differs" are mostly text the normalizer does not equate (`0x{}`, a TS struct where upstream names a variant). They refuse, so they are safe, and
they may hide further swaps the checker cannot prove, which is the reason to read them when a case reaches one.

**Performance:** hello, alternating runs against `1adcee8e`, instructions retired: base 9.60G, 10.23G, 9.87G; this branch 9.60G, 9.21G, 9.60G. No
measurable change. Normal compiles add one `undefined` check in `Panic`'s constructor, and that runs only at a panic.

**Unit time:** `track_caller.test.ts` went from 3.6 s CPU to 8.5 s, so **4.9 s added against the 5 s budget**, measured at load 13. There is no room left in
that file. `bun test` on `src/std`, `rustc_errors`, `rustc_driver_impl`, `rustc_interface`, `rustc_parse`, `rustc_attr_parsing`, `proc_macro`, `rustc_span`, the
validator and `tools/codegen/{diagnostics,derive}`: 1,688 pass, 0 fail (with the `validate` location assertion).

**Left as `unported`:** nothing new. `Backtrace Display (captured frames)` and `DiagLocation Display` remain.

**`// PORT:` decisions:** the hook point, and `run_hook = false` for `resume_unwind`; `tid` is the pid (D7); the thread name is set around the ported spawn point (D7); the JS stack stands in for a
backtrace, labelled, in stderr and in the ICE file (D9); `report_ice`'s fresh `DiagCtxt` is not dropped, since it holds nothing to flush; lazy `require` in `try_print_query_stack`, which only a hook runs;
`bug_impl` resolves only when a callback is set; a refused location stays `undefined` so `emit_bug_diagnostic` prints nothing; the `ConstArgHasType` and `InvalidIdent` arm moves.

## 5. For root

### 5.1 Status semantics and protected results

`classify` (`scripts/difftest.ts:582`) needs no change, and the exit codes hold:

- **A refused panic location: exit 101, reason on stderr**, printed at the panic so a caught panic cannot lose it:
  `rust-ts: internal compiler error: <msg>`, then `rust-ts: the ICE report stopped: location refused: <why>`, then the JS stack. A CRASH stays a CRASH.
- **An `Unported` raised while the hook prints:** the same banner, exit 101, deliberately not 70: otherwise a port crash could turn into UNPORTED.
- **A refused `DiagLocation` display:** still `unported`, exit 70, as today.
- **A false MATCH cannot come from any of this:** a location is in the compared bytes. An UNPORTED that now reaches printing can become DIFF, which is the honest status.

The exposure to watch in the gate is **hook output on a panic the port catches where upstream does not panic**: it adds stderr to a case that matched. I read the catch sites
outside tests (nearly all are file I/O) and found none that swallows a `Panic`, and the six samples show none. The gate settles it.

In-process tests that call `main()` install the hook for the rest of that test file's process, as `update_hook` does upstream. Later panics there print to stderr; the 1,688 tests above are unaffected.

### 5.2 Harness batch: the thread-id mask (reviewed, stderr only)

**Pattern**, the review's narrower form of compiletest's `runtest.rs:2626`, anchored and keeping the name and `rtid`:

```ts
// scripts/lib/unstable.ts
export const maskThreadId = (stderr: string): string =>
  stderr.replace(/^(thread '[^'\n]*' \((?:rtid )?)\d+(\) panicked)/gm, "$1<tid>$2");
```

**Where:**

1. **At comparison, on stderr only, both sides, never on stdout** (`render` at `scripts/difftest.ts:217` joins them, so mask `r.stderr` before joining, or split with `stderrOf`). A dump can legally print that text on stdout.
2. **Not in what is cached:** the cached oracle output keeps its raw id, so an audit can see it. Mask when comparing.
3. **Miri keeps its comparison:** `thread 'main' (1000)` in an interpreted program is deterministic and must be compared. For a `Suite.miri` case, mask only when `isIceStderr(oracle stderr)`, on both sides, the condition `unstableMiriOracleReason` already uses.
4. **Retire the reason:** remove `THREAD_ID_PATTERN` from `UNSTABLE_ORACLE_PATTERNS`, and its ICE entries from `MIR_UNSTABLE`, `M3_UI_UNSTABLE`, `M4A_UI_UNSTABLE`, `THIR_TREE_UNSTABLE`, `PM_UI_UNSTABLE`. **Keep** the long-type and ICE-file patterns, which stay irreproducible, and `proc_macro_generated_packed.rs`'s entry unless its oracle proves stable.
5. **Update** `scripts/unstable.test.ts`, `scripts/miri.test.ts:88` and `scripts/lib/ctfe-sample.ts:67`. The last one's `thread 'rustc' panicked` has no `(tid)` and no longer matches anything, so it falls through to the `error: internal compiler error` alternative; the banner alternative at `:66` now only catches refused locations and JS errors.

**The plan's five negative tests, plus the review's stderr rule.** Each pair must still compare as **different** after masking:

| # | Oracle | Subject | Catches |
|---|---|---|---|
| 1 | `thread 'rustc' (1) panicked at a.rs:1:1:` | `thread 'main' (1) panicked at a.rs:1:1:` | A different thread name |
| 2 | `thread 'rustc' (1) panicked at a.rs:1:1:` | `thread 'rustc' (2) panicked at a.rs:1:2:` | A different location |
| 3 | `thread 'rustc' (1) panicked at a.rs:1:1:\nBox<dyn Any>` | `thread 'rustc' (2) panicked at a.rs:1:1:\nboom` | A different payload |
| 4 | `thread 'rustc' (1) panicked at a.rs:1:1:` | `thread 'rustc' (abc) panicked at a.rs:1:1:` | A non-digit id |
| 5 | Miri, non-ICE: `thread 'main' (1000) panicked at ...` | `thread 'main' (1001) panicked at ...` | An interpreted program's id, on a `Suite.miri` case |
| 6 | stdout `thread 'a' (1) panicked` | stdout `thread 'a' (2) panicked` | stderr-only masking |

Also test the positive cases: differing digits compare equal, `(rtid 5)` included, in the middle of a multi-line stderr (`m` flag), and more than one occurrence (`g` flag: `borrowck-describe-field-generic-param-owned-box` and `do_not_const_check` panic twice).

**Effect on the ratchet: nothing protected can be lost**, since UNSTABLE is never protected. After the batch, the 40 cases now UNSTABLE become MATCH, DIFF or UNPORTED. The 74 that need no mask MATCH as soon as this branch lands, and a gate before the batch would protect them; the 18 follow the batch.

### 5.3 `coverage.ts --check` (harness batch)

It does not know the two new comments. Until it does, `track_caller_check.ts` validates them (it reports `anchors and const markers: 20, 0 bad`).

- `// rustc-const: compiler/<path>:<line> <NAME>`: line `<line>` must hold `const <NAME>`. It does not count as a ported fn. 21 upstream consts remain unmarked; add them on demand.
- `// rustc-call: <line>:<col>`: on the line directly above a TS call, inside a marked fn. The position must hold the callee in that fn's upstream body. `map_call` already refuses a wrong one at run time, so a stale anchor refuses rather than misleads.

### 5.4 Decisions for you to record

- **Reversal:** the 2026-10-13 decision that `Location::caller` stays unported is reversed, on the review's basis: per-site edits avoid the nesting cost it named, tail calls stay on, and no second process runs.
- **`-Ztrack-diagnostics` outside the corpus mostly refuses** with tail calls on, as the review priced in. `BUN_JSC_useTailCalls=0` is the developer's way to see the location. Remove it from the plan's benefits.
- **D4 exception dropped.** The plan's count-mismatch exception ("upstream has exactly one site and the message matches") is not implemented. A site that needs it gets an anchor, as `sty.ts` does for the two TS arms of `sty.rs:1816:86`.
- **`keep_frame` shape** is pinned by a unit test that asserts the folded and tail shapes lose the frame, so a Bun upgrade that changes this fails loudly.
- **D10 still holds for any bundling lane:** frames must stay mappable to `src/` (`--sourcemap`), or these 92 are lost and the ratchet blocks it.
- **`docs/next.md`** still lists `ice-report` as running.
- **Gate:** the 118 live across 13 suites, and hook behavior applies to every suite, so this needs a full wave gate. Nothing here needs a dedicated one.

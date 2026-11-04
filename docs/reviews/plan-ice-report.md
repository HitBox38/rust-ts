verdict: ACCEPT WITH AMENDMENTS

Design: plan-ice-report (`docs/plan-ice-report.md`, `docs/handoff/ice-report.md`, branch `t3/plan-ice-report`, head bd9f67d3).
Reviewed against AGENTS.md, PORTING.md and the pinned upstream. I am read-only: I wrote only this file. I did not run the gate
or a full suite, and I changed nothing under `$RUST_TS_DATA/tmp/ice-report/`. My scripts and outputs are in the session scratchpad
(`/private/tmp/claude-501/-Users-tomernorman--t3-worktrees-rust-ts-t3-71eff097/57df5dcf-bac2-4ad4-a11d-72fbe51e738c/scratchpad/`:
`run-t2.ts`, `untail.ts`, `t2-edits.txt`, `swap.ts`, `swap2.ts`, `trackcheck.ts`, `d8.ts`, `demo/`). The load average was 30–220.

The scope is right and the numbers mostly reproduce: keep the stack resolver, the ICE path port and the thread-id mask. Three
decisions must not stand as written:

- **D3 (replay) is rejected.** It prints a confident wrong location on a reproduced input, and the corpus does not need it: 47
  small non-tail edits reach the same MATCH count with no second process. The price is that `-Ztrack-diagnostics` outside the
  corpus mostly refuses until more sites are edited (F2).
- **D4 (message check) is not enough.** A one-line input prints a wrong location that neither the message check nor the
  oracle-binary check can see.
- **D8 (`RUST_BACKTRACE=0`) is rejected.** Its stated justification is false: it also hides portable query-stack output.

The result is 92 of 118 cases, including all 14 `mir` cases. The 26 compiletest-env cases stay DIFF or UNPORTED, which is honest.

## What I checked

| Claim | How | Result |
|---|---|---|
| 118 cases, 46 files, 40 UNSTABLE + 78 UNPORTED, 14 `mir` | Recount from `gate-nonmatch.json` (gate `gate-20261102-174727-root-kxpt`) with the plan's filter | **OK.** Exact |
| 533,608 protected | `wc -l harness/baseline/*.txt` | **OK.** 118 is 0.022% |
| 253 `#[track_caller]` attributes | `git grep` at the pin, line-start attributes | **OK.** 253. The 9 `cfg_attr(debug_assertions, track_caller)` lines are rightly excluded: the oracle has no debug assertions. No attribute on a closure |
| 27 reach a bug site | Read the group list, did not re-derive | **Plausible, spot-checked only.** Name-based, as the plan says |
| ~20k name-based call sites | My own regex over the proto's TS, summing the group's names | **Not reproduced, and inflated.** 14,586 raw. Without `new` and `into_diag`: 9,646. Without generic names (`new`, `push`, `note`, `err`, `warn`, ...): 3,868. The plan's §3.3 drops such names as edges, then §3.4 counts them. The conclusion survives: thousands of sites plus a parameter through 117 fns (N1) |
| 77% of `bug` sites are tail calls | Same regex; a Bun script for which shapes keep the frame | **955 reproduced, but it is a floor.** `return c ? f() : 0` and `return a ?? f()` also drop the frame (51 more lines by regex). It is also not the number that decides anything: only about 9 reached bug sites matter (F2) |
| JSC drops the frame | `bun` 1.4.3, small script | **OK.** See F2 for a trap in the fix |
| Hook only, tail calls on: 13 of 118 | `res-noreplay.json` reread, plus my own run on one case per id (12 of 46) | **OK** |
| 428 pairs, 157 fns, 381 agree, 33 no literal, 14 disagree | Re-ran the plan's logic | **OK.** Exact. Also 136 of the sites share a 24-character prefix with a sibling (F3) |
| 49 of 49 printed locations in the oracle binary | Not re-run. `dylib-locs.txt` has the stated 19,263 entries; looked up 3 lexer locations | **Consistent, but see F3:** the wrong values are present too |
| `report_ice`, compiletest env, `$TID` | Read upstream at the pin | `lib.rs:1611-1615`, `directives.rs:286`, `runtest.rs:2626` (F4, D8) |
| Replay gives the plan's answer on a clean input | `-Ztrack-diagnostics` on a type error | **OK.** Same location as the oracle |

## Decisions

| | Verdict | Reason |
|---|---|---|
| D1 | **amend** | Scope is the 118-case ICE path, but the target is 92: D8 is dropped. Say so, and update `docs/next.md` |
| D2 | **agree** | A and B cannot avoid the stack for the diagnostic chain. Correct the 20k figure (N1) |
| D3 | **reject T3; replace with on-demand non-tail edits** | F1, F2. Reversing the 2026-10-13 decision is still right, on a better basis: that decision assumed exact locations need tail calls off globally, and they do not |
| D4 | **amend — blocking** | F3 |
| D5 | **agree** | Exit 101 with a visible reason keeps CRASH meaningful. `classify` (`scripts/difftest.ts:582`) works from exit codes, as the plan says |
| D6 | **amend** | F5. The hook point is right: of the non-test `new Panic` sites, only `panic_message.ts:43,45` do not throw immediately |
| D7 | **agree** | The id is masked and never compared |
| D8 | **reject** | F4 |
| D9 | **agree** | Nothing compares these bytes |
| D10 | **amend** | F6: state the constraint this puts on bundling |
| D11 | **amend** | F3: the checker is no longer optional and comes first. Absence stays report-only, as the plan argues |
| D12 | **agree** | D3's replacement now follows the same on-demand policy |

**§5 thread-id mask: agree.** It is compiletest's own normalization: `runtest.rs:2626` rewrites `thread '<name>' ((rtid )?<digits>)
panicked` to `$TID`, and the existing comment in `scripts/lib/unstable.ts` already says the harness skips this. The plan's form is
narrower than upstream's: it is anchored at line start, and it keeps `rtid` and the thread name. It is not an expectation change
made to pass a case; it fixes a known gap in the harness. It cannot hide a location, payload or thread-name difference, and the
plan's five negative tests pin that. What it does lose is whether two panics share a thread id, which is immaterial. Miri's
ICE-only condition is right. One amendment: mask stderr only, never stdout, where a dump can legally print that text.

## Findings

### F1 (blocking, D3): the replay prints a confident wrong location, and nothing catches it

Reproduced with a stateful proc macro, the kind `sqlx`-, `ts-rs`- or `const-random`-style macros are. Its output depends on a
file it also updates (`demo/flip.rs`, `demo/use_flip.rs`, `-Ztrack-diagnostics`, prototype unchanged):

```
oracle: error[E0308]: mismatched types
          = note: -Ztrack-diagnostics: created at compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2242:35
port:   error[E0308]: mismatched types
          = note: -Ztrack-diagnostics: created at compiler/rustc_resolve/src/late/diagnostics.rs:684:36
```

The parent's first run reports E0308. The replay child sees the macro's second output and fails in name resolution instead, and
the parent prints E0308's message with the child's location. The macro's counter ends at 2 where the oracle's ends at 1, so **proc
macros run twice**. That is a behavior change rustc does not have, on top of the wrong bytes.

The plan's guard does not help. "The parent verifies entries it already resolved itself" checks nothing when the refused request
is the first one. On the diagnostic chain that is always the case today, because every capture refuses at the same link; in the
plan's own no-replay logs, the first event is a refusal for 17 of the 36 panic cases logged. No suite has a stateful macro, so no
gate would see it either. A location from another execution, accepted without a check on that execution, is a guess by another
name (PORTING §3).

Other failures, all reproduced on the prototype:

- **Hang.** With a FIFO as the input, the child blocks forever opening it and `spawnSync` has no timeout. It was still running
  after 40 s. The plan's "refuse on stdin" does not cover this.
- **Orphan.** The harness's timeout is `proc.kill()` on the direct child (`scripts/lib/common.ts:110`). Killing the parent during a
  replay leaves the child reparented to pid 1. It kept running and wrote the output file 5 s after the parent died. Under load
  (the plan measured replays up to 62 s against a 60 s subject timeout) these pile up and write into a directory the harness has
  moved on from.

From reading the prototype, not run:

- Every refused panic replays, including refusals a replay cannot fix (count mismatch, unmarked frame). The plan counts about
  4,400 non-`bug!` panic sites, so most port crashes during development would compile twice before reporting.
- The child uses `process.argv`, where `ensure_stack` deliberately uses raw argv bytes.
- Under D9 the child would write a second `rustc-ice-*.txt`.
- Under Miri with isolation off, the interpreted program runs twice with its side effects.

The plan lists some of these risks in §3.6 and §8 and keeps the design, because it never measured F2's alternative.

### F2 (blocking, D3): replay is unnecessary. 47 edits reach the same 92, with tail calls on

The plan rejects T2 at population size ("955+ sites", "not measured"). The cases do not need the population. **All 97 refusals come
from 8 places in the first pass, and 80 of them from one line** (`DiagInner.new` → `new_with_messages`). I removed only the tail
calls that a refusal named, on a private copy of the prototype, with replay off and tail calls on, and re-ran each time:

| Edits | Result |
|---|---|
| 0 | 13 of 118; 10 of 14 `mir` |
| **9** (the reached `bug` sites, `fatally_break_rust`, `DiagInner.new`; one is spare) | **14 of 14 `mir`**; 17 of 46 ids |
| **47, in 13 files** | **92 of 118. The MATCH set contains all 80 of the plan's replay MATCHes** (only-replay: 0). The other 12 are `macro-use-bad-args`, from the anchor already in the prototype. This equals the plan's result through lane 4 |

Where the 47 are: `rustc_attr_parsing/context.ts` 21, `attributes/repr.ts` 12, `parser.ts` 3, `interface.ts` 1, `rustc_errors` 2,
`rustc_middle/ty/sty.ts` 2, and one each in `select/mod.ts`, `normalize_erasing_regions.ts`, `elaborate_box_derefs.ts`,
`const_eval/machine.ts`, `hir_typeck/lib.ts` and `fn_ctxt/_impl.ts`. A few were speculative, so 47 is an upper bound. Wall time per
case: median 3.5 s, maximum 13 s, at load 30–70. The plan's replay reached 62 s at load ~100, so this comparison is rough.

The remaining 26 are D8's 25 plus the `span_mirbug` case, the same as the plan.

**The cost is real and I measured it: ordinary `-Ztrack-diagnostics` does not work after these 47 edits.** New sites refuse until
someone edits them. On 80 of the same `tests/ui` files with tail calls on, **51 refused** (only 1 of those also refuses with tail
calls off), against 5 of 200 with tail calls off. The refusals are concentrated: 8 tail-call sites, of which `rustc_errors/lib.ts:936`
accounts for 30 and `rustc_middle/lint.ts:569` for 12. Each case stops at its first refusal, so more sites may lie behind those, and I
did not measure how many edits it would take to clear them. The 26 cases that completed gave 50 locations, 0 wrong. So the plan's
benefit "`-Ztrack-diagnostics` starts working" is lost under this amendment, and that is the one thing T3 delivers that this does
not. It is a fair trade: no suite depends on it outside the 118, and the flag is a compiler developer's tool, for whom a refusal that
names a line is a usable answer. A refusal is visible, never a wrong output, and the plan already takes this exact policy for every
other unmapped site (§6, D12). The refusal names the line. A developer can learn the location with `BUN_JSC_useTailCalls=0` by hand, so the replay stays a debugging technique rather
than product behavior. If root later wants `bug!` locations to work everywhere, a one-commit codemod of `return bug(` to `bug(` at
a quiet moment remains possible.

**A trap the lane must know.** On Bun 1.4.3 the transpiler folds these back into a tail call, and the frame is lost:
`const r = f(); return r;`, and even `const r = f(); void 0; return r;`. My first attempt used this shape and changed nothing.
Shapes that keep the frame, tested:

- a bare `f();` statement, which suits `never`-returning `bug`/`span_bug`;
- `return keep_frame(f());` with a one-line identity helper;
- `try { return f(); } finally {}`.

Pin the chosen shape in a unit test, because a Bun upgrade can change this. These sites are all on cold paths, and none is recursive.

### F3 (blocking, D4/D11): a wrong location that neither proposed check can see

Comparing message text only works where there is a message. `emit_err` takes a struct. `rustc_parse/src/lexer/mod.rs:161` has its
4 `emit_err` calls in a different order in TS (3 of them rotated), found by comparing struct names (`swap2.ts`). One-line inputs,
oracle against prototype:

| Input | Oracle | Port |
|---|---|---|
| `\` in `main` | `lexer/mod.rs:495:32` | **`lexer/mod.rs:341:40`** |
| `let _ = 'r#_;` in `main` | `lexer/mod.rs:399:40` | **`lexer/mod.rs:495:32`** |
| `let _x = "a"_;` in `main` | `lexer/mod.rs:341:40` | **`lexer/mod.rs:399:40`** |

All three wrong values are present in the oracle binary, so the oracle-binary check passes them. Together with the plan's 5, that
is **8 proven swapped sites in 3 fns**. These also break PORTING §3 ("same order") regardless of this plan, so fix them in the port.

How far the check falls short, on the plan's own 428 `bug` pairs: **136 sites share a 24-character prefix with a sibling**, so a
swap between them cannot be detected, and 33 have no literal. That is up to 169 pairs (39%) the check cannot speak for. Its literal
picker also returns noise such as `"Move"` and `"Ref"`, so as written it would refuse sound sites. For struct-carrying chains, only
940 of 1,216 pairs were comparable by name. For `parent`, `expect_local` and `type_at` there is nothing to compare by message at all.

**Rate, so this is not overstated.** Over 200 deterministic `tests/ui` files with a `.stderr`, every `created at` location on both
sides (177 comparable cases, **568 locations**): **0 wrong, 5 cases refused**. So the mapping is good on what a random sample
reaches, with an upper bound near 0.5% (rule of three). The swaps exist but are rare.

That comparison is also the answer to "how would it be checked": **the oracle prints these locations itself under
`-Ztrack-diagnostics`**, so a sample over the error corpus tests the real mechanism against real output. It found no swap in 200
files, so it complements the static check rather than replacing it. The sibling check found the lexer swap; the oracle confirmed it.

### F4 (blocking, D8): D8 hides portable output, and its justification is false

The plan says "the only output removed is native frames". Upstream, `rustc_driver_impl/src/lib.rs:1611-1615` limits the query stack
to 2 frames unless `RUST_BACKTRACE` is set and not `0`. Oracle on all 26, both settings:

- **14 of 26 lose query-stack frames, 36 in total**, replaced by `... and N other queries...`. `print_query_stack` is ported and
  would compare. With D8, no suite would ever compare the untruncated path.
- 22 of 26 gain the `run with RUST_BACKTRACE=1` note.
- All 26 have native frames, and exit code and stdout do not change, so that part of the claim holds.

Is it a legitimate correction of the test setup? No. The setup is not wrong: `harness/compiletest.ts:705-706` faithfully mirrors
compiletest's `directives.rs:286`. compiletest's own `0` applies only to `crashes` mode (`directives.rs:395`). Across the 13 distinct
file-and-revision pairs behind the 26, 12 use `dont-check-compiler-stderr`, so upstream compares neither value's bytes. The 13th
(`layout/gce-rigid-const-in-array-len.rs`) has a `.stderr` with no ICE in it, so its ICE belongs to the dump suites' argv. There is no
upstream contract to correct towards. Where upstream does care, it sets the value per test: `const-eval/const-eval-query-stack.rs` has
`rustc-env:RUST_BACKTRACE=1` **in order to** check the full query stack, with the frames normalized away. D8 is what AGENTS.md §2
forbids: a suite edit whose stated purpose is that 25 cases then match. The plan's own fallback is the right call: "those 26 stay
DIFF, which is honest and costs nothing".

If root ever wants these, the defensible form is the opposite one, in its own reviewed batch: keep `short`, and strip only the
numbered frames of a `stack backtrace:` block on both sides, so the query stack stays compared. It is not worth doing now.

### F5 (medium, D6): the hook differs from upstream in two ways the prototype does not model

Upstream increments the panic count **before** the hook (`library/std/src/panicking.rs:779`, hook at `:802`), so `panicking()` is
true inside it. In the port's scheme it is false until `while_unwinding`, and `rustc_errors/diagnostic.ts:1318` and `lib.ts:367`
read it. Failing scenario: the real `report_ice` emits through a `DiagCtxt` (the prototype writes text), so any path that consults
`panicking()` during the hook can take the wrong arm. I did not reach such a path; the lane must check, not assume.

A panic inside the hook aborts upstream ("thread panicked while processing panic. aborting.", `panicking.rs`). The prototype's
`running` flag lets it continue silently, so a query `description` that panics during `try_print_query_stack` would give different
output. Also, subclass constructors set `this.name` after `super()`, so the hook must use `instanceof`, as the prototype does, and
never read `p.name`.

### F6 (medium, D10, not in the plan): bundling collides with this

Bundling the port has been queued since wave 13 and "startup dominates most cases" (`docs/plan-m6.md:367`, `docs/next.md:190`); it
is the obvious `plan-m6` D11 move. Measured on a small script: a bundle without a source map reports frames in `out.js`, which makes
`classify` refuse every frame ("frame outside src"). **Once these 92 are protected, a plain bundle loses all of them and the ratchet
blocks it.** With `--sourcemap=linked` or `inline`, Bun maps frames back to the `.ts` position. So bundling stays possible, but it
needs source maps, which should be stated before that lane starts. I did not measure it on the real tree or measure its startup cost.

Other interactions. Performance refactors change TS call counts in a fn, and the resolver then refuses: safe, and the ratchet shows
it. There is no hot-path cost: `new Error` runs only at diagnostic creation and at panic, as today, and these edits are on cold paths.
M7: under T3, a replay re-running the linker and cleaning temp files beside the parent's would have been a new hazard; dropping T3
removes it. M7's compiled programs print their own thread ids, which is why the mask must stay stderr-only and needs a fresh look then.

### N1 (low, D2): correct the figures

Say "thousands by name; 3.9k–14.6k depending on generic names" instead of 20k. `parent 441` and `fail 196` also differ from my count
(192 and 208); `expect_local 254` and `type_at 158` match. Counts by name are sizing only, as the plan says.

### N2 (low, §3.6): the T1 rationale is overstated

The plan says `stack.ts` "states that rust-ts reaches at least rustc's nesting". The same comment says it is capped on macOS and
"stops earlier than rustc only for nestings close to rustc's own limit". T1 is still not the choice, but it should not be rejected on
that sentence. I did not re-measure the nesting numbers.

## Amendments

**D1.** Target 92 of 118, including all 14 `mir` cases. The 26 compiletest-env cases are out of scope and stay DIFF or UNPORTED.

**D3.** Replace with: tail calls stay on; no replay in the product. A site whose location is refused for a broken link is made
non-tail when a case or a user reaches it, using the shape pinned by a unit test (bare statement for `never`, `keep_frame` for
values). `useTailCalls=0` stays a developer tool. `track-caller-2` (lane 3 in the table below) starts with the 9 edits; the chain follows. T1 stays rejected as a default.
This supersedes the 2026-10-13 decision on the ground that per-site edits avoid the nesting cost it named. Remove "`-Ztrack-diagnostics`
starts working" from the plan's benefits: it holds only with tail calls off, and at the sites already edited.

**If root keeps T3 regardless,** these become mandatory, and the plan must re-run F1's reproductions:

- replay only on a broken-link refusal;
- the child records message and full frames, and the parent requires its message to be equal and its surviving frames to be a
  subsequence, which is what catches the F1 scenario;
- a timeout;
- the child dies with the parent;
- refuse when proc macros were loaded, under Miri, and for any non-regular input;
- raw argv;
- no second ICE file.

**D4.** For a fn with one call on both sides, no check is needed. For two or more calls, require a discriminating key that is
**unique among the siblings**: the full normalized literal for `bug`/`span_bug`/`fail`, and the diagnostic struct name for
`emit_err`/`create_err` and similar. Refuse if the key is missing, not unique or different. A per-site `// rustc-call: <line>:<col>`
anchor, validated by `coverage.ts --check`, is the escape hatch for sites a case reaches that have no key. `track-caller-check` must report how many
of the 49 corpus locations this refuses, since that could lower 92.

**D6.** The hook runs with the panic count raised (`panicking()` true), and a panic inside it aborts as upstream does. Add both to
the `ice-hook` brief.

**D8.** Rejected. Remove §5 item 4 and lane 5. Lane 6's marker stays as a correctness fix, but it recovers no MATCH.

**D10.** Add: any bundling lane must keep frames mappable to `src/` (`--sourcemap`), and must show that the protected ICE cases
still match.

**D11.** The plan's lane 7 is not optional and runs **before the hook lands** (lane 2 in the table below). It covers the callee families in D4, and it reports proven swaps as port
bugs to fix (the 8 sites above, by a fixer lane, restoring upstream order). Add a report-only `-Ztrack-diagnostics` comparison over a
sample of the error corpus, run with `BUN_JSC_useTailCalls=0` so that refusals do not hide locations (`trackcheck.ts` is a starting
point). Absence from the oracle binary stays report-only. Not a gate step.

**§5.** Mask stderr only.

**§6 lanes** (these numbers replace the plan's, and the rest of this review uses them):

| # | Lane | Recovers |
|---|---|---|
| 1 | `ice-harness` (reviewed; §5 items 1–3, 5, 6; stderr only) | 2 |
| 2 | `track-caller-check`: static check, swap fixes, D4 key logic | 0, prevents wrong locations |
| 3 | `track-caller-2`: panic entry, frame shape + test, the 9 edits | 0 alone |
| 4 | `ice-hook` (§4, with D6) | 14 of 14 `mir`; **about 17 distinct ids before the chain edits** |
| 5 | `ice-tail-chain`: the remaining ~38 edits | **80** |
| 6 | `ice-anchors` (`rustc-const:` marker + coverage support; `span_mirbug` marker) | **92** |

## The questions asked

**1. Do the numbers justify rejecting the codemod and the table?** Yes, though less cleanly than stated. 118, 253, the 77% regex and
the swap counts reproduce; 20k does not (N1). The rejection holds because A still needs a stack for the diagnostic chain, and B only
precomputes C's last step. But the same reasoning was applied too broadly to T2: population counts rejected it when the reached
population is 47 (F2).

**2. Can the replay differ, what does a wrong answer look like, is it acceptable?** Yes (F1). A wrong answer looks exactly like a right
one. Cross-check guards nothing on the first request. Not acceptable as a default, and also not needed.

**3. Is the message-text check enough? How would it be checked?** No (F3). Compare against what the oracle itself prints, using
`-Ztrack-diagnostics` over the error corpus, plus a sibling key check. The binary set cannot detect swaps, as the plan itself says.

**4. Is D8 legitimate? What does compiletest do? Can the mask hide something?** Not legitimate (F4). compiletest uses `short` by default
and `0` only in `crashes` mode. The mask is compiletest's own normalization, and it is sound (§5 above).

**5. Does `Location::caller` change other protected results? Can UNPORTED become a wrong DIFF, or a wrong location a false MATCH?**
Reaching the resolver cannot lose a protected case, because anything that reached `Location::caller` was exit 70, which is never
protected. An UNPORTED can become a DIFF if the location is wrong (`lexer/mod.rs` above, if a case hits it), which is the honest status.
A false MATCH cannot arise from a wrong location, because the location is in the compared bytes. The real exposure is the opposite:
output outside the suites is wrong with nothing comparing it (F3), and hook output on a caught panic, which the gate would catch. The
regression sample of 150 is not a gate; the wave gate after `ice-hook` settles this.

**6. Cost, priority, smaller version, interactions?** The smaller version is better: stop at 92, without replay and without D8. If root
wants the minimum: lanes 1, 2, 3 and 4 give 14 of 14 `mir` with 9 tail edits. Keep the priority the plan gives: low, after wave 38's
first batch, never blocking M6 or M7. It is 0.022% of protected cases and tests error text. It is not on the Miri gate path. Interactions
are in F6.

**7. Which unchecked items must be settled before any lane starts?**

- **Before lane 2:** the D4 key rules, and how many corpus locations they refuse.
- **Before lane 4:** the `panicking()` and nested-panic semantics (F5).
- **Before lane 6:** the `rustc-const:` anchor: end-of-init detection is crude and it was tried on 1 of 22 consts.
- **Before any bundling lane:** F6.
- **Moot with T3 gone:** replay with `-o`, stdin, Miri or Linux; T1 on large compiles; `mod a {` nesting.
- **Can wait:** the 77 absent sites (lane 2 reports them), `thread 'main'`, an unset `RUST_BACKTRACE`, a real Miri host ICE. The
  prototype-versus-real-emitter difference is what lane 4's acceptance (80, then 92) settles.

## What I did not check

- **Regression of my 47 edits.** I ran only the 118 and the tail-on sample below. They were not type-checked, and I used the
  `try/finally` shape because it needs no TS change; the bare statement and `keep_frame` were tested only in a small script.
- **`trackcheck`'s 17 non-comparable cases.** 5 are the refusals. In the others the message lists differ under my ad-hoc flags
  (no edition or compile-flag directives). I did not investigate, and they are outside any suite's argv.
- **Replay after a file changes mid-compile.** My attempts to time this externally failed, so I do not claim it. The proc-macro
  reproduction shows the same mechanism.
- **Output files under replay.** I confirmed the child writes the output (the orphan run), but did not compare the two processes' bytes
  on a non-empty output. A bin crate's `--emit=metadata` output is empty on both sides, so those runs prove nothing.
- **Swap counts are lower bounds.** `swap2.ts` proves a swap only when the same struct name appears at another index. I did not read
  the 99 mismatched fns or all 14 disagreements.
- **`#[track_caller]` through a fn pointer or vtable.** As I understand Rust, the location is then not the call site, and the resolver
  has no such case. I did not test whether a chain of that shape exists in a reached path.
- **T1's nesting and CPU numbers, the 89-case set, and the 150-case regression sample:** not re-run.
- **Linux and Windows.** Bundling was tested on a small script only.

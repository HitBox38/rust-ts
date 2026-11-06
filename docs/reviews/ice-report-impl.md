verdict: REQUEST CHANGES

Lane: `ice-report-impl`, branch `t3/implement-ice-report`, head `26bedc00`, base `1adcee8e`. I am read-only: this file is the only change.

Two small fixes are needed (F1, F2). The rest holds: every reproduced number is exact, no protected case was lost, and I found nothing else wrong in the 1,920 extra oracle comparisons.

- **F1 is the risk this review was asked to find:** the resolver prints a confident wrong location at `ref_prop.ts:313`. It is one site out of about 16,000 mapped calls, but the hole is general and the checker cannot see it.
- **F2 is wrong bytes in the ported `report_ice`.**
- **The re-check can be narrow:** F1, F2 and the 92.

## Findings

### F1 (HIGH, blocks): a call of a nested upstream item maps onto an unrelated TS call and prints a wrong location

- **Where:** `src/rust_ts/track_caller.ts:298` (`map_call`), `:743` (`calls_in`).
- **Cause:** `calls_in(body, callee)` counts calls inside `fn` and `impl` items nested in the upstream body. A TS port that hoists a nested item to its own marked fn then has fewer calls in the outer owner, and the counts can agree by coincidence. A single call on both sides needs no key.
- **The case:** `src/rustc_mir_transform/ref_prop.ts:313` is `assert(place.local !== local, ...)`, the port of `assert_ne!` at `ref_prop.rs:275:17`. Upstream `compute_replacement`'s body has one `assert!`, at `ref_prop.rs:339:25`. That one belongs to the nested `impl`, and its TS port is `ref_prop.ts:381`, a separate owner. So 1 TS call meets 1 upstream call, with no upstream key.
- **Reproduced end to end, tail calls on.** In a private worktree I flipped that one condition so the assert fires, then compiled `rp.rs` with `-Zmir-opt-level=2 -Zmir-enable-passes=+ReferencePropagation`:

  ```
  thread 'rustc' (14079) panicked at /rustc-dev/6f5da406.../compiler/rustc_mir_transform/src/ref_prop.rs:339:25:
  ```

  The right location is `ref_prop.rs:275:17`. No refusal, and the printed line looks real. `resolve_panic_stack` on a hand-built stack gives the same answer.
- **Extent:**
  - 293 owners have nested fn items.
  - 88 calls in them map into a nested item.
  - I read the 88 by text overlap. `ref_prop` is the only mismatch: the others are ports that kept the nested fn inside the owner.
- **Why nothing caught it:** `track_caller_check.ts:29` covers the 15 D4 families. `assert`, `unwrap`, `panic`, `unreachable`, `assert_eq` and most `#[track_caller]` names are outside them. The resolver accepts all of them. The population through `map_call`, for all 174 tracked names:

  | Mapped by | Sites |
  |---|---|
  | single, no key | 5,110 |
  | single, key | 2,170 |
  | key | 1,814 |
  | anchor | 16 |

  The handoff's 1,474 is the D4 part only.
- **Fix:**
  1. In `map_call`, refuse when the upstream call lies in a nested `fn` or `impl` of the body and the TS call is not in a nested function of the owner.
  2. Have the checker run every tracked name and the panic entries through `map_call`, and report calls mapped into nested items.
  3. Add a test that pins `ref_prop.ts:313` as refused.

### F2 (MEDIUM, blocks): `IcePathError` prints Node's message instead of the `io::Error` text

- **Where:** `src/rustc_driver_impl/lib.ts:1266`.
- **Reproduced:** `RUSTC_ICE=/nonexistent/x/y`, any ICE:

  ```
  oracle: warning: the ICE couldn't be written to `.../rustc-ice-X.txt`: No such file or directory (os error 2)
  port:   warning: the ICE couldn't be written to `.../rustc-ice-X.txt`: ENOENT: no such file or directory, open '...'
  ```

  No suite covers it, because they use `RUSTC_ICE=0`.
- **Second defect at the same site:** the `try` at `:1249-1260` also wraps `emit_note(IcePath)` and the `rustc version` write. Upstream's `Err` arm is only the `open`, and `let _ = write!` ignores write failures. So an `Unported` from `emit_note`, or a failed version write, is reported as "couldn't be written" and the file is dropped.
- **Fix:**
  - Use `display_IoError(io_error_from_node(err))`.
  - Wrap only the open.
  - Ignore the version write's errors.

### F3 (LOW, root, harness batch): the `parse` suite has no `RUSTC_ICE=0`

- **Where:** `harness/suites.ts:190`. All 21,526 cases lack it, and it is the only suite that runs a hook-installing entry point without it.
- **Failing scenario:** any `Panic` in a `parse` subject now writes `rustc-ice-*.txt` into the upstream checkout (confirmed for an unset `RUSTC_ICE` in a scratch cwd). The gate counts ignored files there as a change, fails, and refuses later runs on an unclean checkout until someone deletes the file. A panicking regression would already fail that gate through its lost case, so the new cost is the cleanup.
- **Today:** none of the 21,523 protected cases can reach this, as they match an oracle with no panic. The 3 unprotected ones write nothing: `expr-stack-overflow.rs` ends in a JS `RangeError`, not a `Panic`.
- **Cost of the fix:** adding the env changes the suite's cache keys, so 21.5k oracle re-runs. Root may prefer to skip it and just know about it.

### F4 (LOW, root, harness batch): mask specification gap for split suites

- **Where:** handoff 5.2 item 4 retires `THREAD_ID_PATTERN` and names only `render`.
- **Failing scenario:** an ICE in a split suite stops being UNSTABLE. `runCaseText` then compares the raw thread id, and the oracle re-run reports "not reproduced" with an `ERROR:` line, because the id changes between runs.
- **Fix:** keep the pattern for split suites, or mask in `runCaseText` too.

The pattern itself is sound. All six negatives stay different and the positives compare equal, and four extra negatives I tried also stayed different. It can only hide the digits of an id.

### Nits

| # | Where | What | Effect |
|---|---|---|---|
| N1 | `track_caller.ts:446` | `pos > body_start` misses an arrow body whose first token is the call, such as `(_) => panic(..)` | The closure counts as the tracked owner. I hand-built the `expect_non_local` stack: it refuses at the next link. No wrong output found |
| N2 | `track_caller.ts:407` `body_end` | A one-line marked declaration not ending in `}` runs on to a later `}`: 1,147 owners, 308 of them taking in unmarked code. Worst: `rustc_abi/lib.ts:1091-1417` | 19 tracked calls fall in those tails, 0 map. Safe today by luck of the counts |
| N3 | `track_caller_check.ts:123` | The anchor check only asks that an identifier sits at the position, so an anchor on the wrong call passes. `map_call` catches only a position that holds no call of that name, so an anchor on a sibling call of the same name passes both. Handoff 5.3 has `coverage.ts` check the callee's name, which also cannot tell siblings apart | I read all 19 anchors and the const marker against upstream: all correct |
| N4 | `rustc_index/slice.ts:155,158,174,177` | Four more proven swaps of `panic!` order, outside the D4 families | They refuse, so no wrong output, but they break PORTING section 3. Not this lane's code |
| N5 | `proc_macro/bridge/client.ts:510` | The comment "TS has no panic hooks" is now false. Upstream's expansion hook hides a server panic (`client.rs:236`); the port now prints the ICE report | From reading only. I found no input that makes an upstream server method panic |
| N6 | Handoff D10 line | "`--sourcemap`" is not enough: `SRC_ROOT` comes from `import.meta.dir`. A source-mapped bundle outside `src/` refuses everything: "frame outside src: .../src/rust_ts/track_caller.ts" | Safe. Correct the note before a bundling lane starts |

## Reproduced

| Claim | Result |
|---|---|
| 92 of 118, group by group | **Exact**, with a fresh oracle in a private directory: agrees with `res-impl.json` on 118 of 118. MATCH 92, DIFF 21, UNPORTED 5 |
| 18 need the mask | **Exact**: `mir` 14, `pm-ui` 2, `pm-expanded` 1, `mirdump-ui` 1 |
| 357 printed locations, 0 wrong | **Exact**, by my own extractor |
| The runner can report a difference | **Yes.** Five plants on one `mir` case were each reported as no match: a location, a stderr byte, stdout, the exit code, the thread name. Unplanted, it matches |
| The 26 are exactly `RUST_BACKTRACE=short` | **Yes.** All 26 non-matches are `short`, and no match is |
| The 21 DIFFs differ only in backtrace frames | **Yes.** All 21 are identical with the frame block and its note stripped, and stdout is equal |
| The checker's static numbers | **Exact**: 4,481 sites, 0 swaps, 148 absent |

## Could a wrong location print? What I tried

**Oracle comparison.** Files were `tests/ui` files with a `.stderr`, none from the lane's 600.

| Input | Runs | Locations compared | Wrong |
|---|---|---|---|
| 480 files × `-Ztrack-diagnostics` on/off tail calls, with and without `-Ztreat-err-as-bug=1` | 1,920 | 3,138 in fully identical runs, plus every paired location in the others | **0** |
| 195 ICE-prone files (`failure-status: 101`, `known-bug`, ...), plain, tail calls on/off | 390 | 47 | **0** |
| 6 files of my own (lints, attributes, syntax, lexer, borrowck, types), 3 modes | 18 | about 150 | **0** |

- The location counts are not distinct locations.
- With tail calls on, most runs refuse: 348 of 480 under `td`. That is the expected cost, and every refusal was `unported`, exit 70.

**Static, against each open item in the handoff:**

- **Two-level collision:** 13 name chains found, all spurious on reading.
- **Reversed collision** (`foo_N` tail-calling `N`, which the link regex accepts and the lane's check does not look for): 7 sites. They would need upstream `G` to call a bare `N` as well. None does, as they refuse on count.
- **Single call, no key:**
  - All 5,110 scored by context on both sides.
  - The lowest 57 read, plus every site with no text overlap on the line.
  - `unwrap` and `assert` also compared by receiver and condition.
  - Only F1 is wrong.
- **Closure check:** every `|` in all 27 tracked fns that hold one was read, and every real closure is detected. The 5 `#[track_caller]` closures are handled:
  - `type_at`, `region_at`, `const_at` and `with_opt` pass through tracked helpers, so walking to the caller is right. I checked `Option::unwrap_or_else` and `with_context_opt` at the pin.
  - `expect_non_local` goes through the untracked `map_id`, so the true location is inside `map_id`. A small program on the oracle confirms the semantics, and the port refuses.
- **`dyn`:** an independent multi-line scan. 225 tracked attributes and 75 trait-method impls are all classified correctly. There is no `dyn` use and no supertrait of the 4 tracked traits, and no same-named other trait. A tracked fn used by path gives a count mismatch, which refuses.
- **The 148 absent locations:** 40 are in tracked owners (never printed), and 73 are `TypeChecker::fail`, which ignores its location. The other 35 are mostly non-tracked callees or code the binary does not contain. None looks wrong.
- **Dropped frames:** read all 18 same-name sites and the lane's 30. Their inner callees are untracked, as the lane says, so a dropped frame refuses at the next link.
- **Bundling and `--compile`:** plain bundle, `--compile --sourcemap` and linked source map all refuse, with exit 70 for a diagnostic and exit 101 with the reason for a panic. No location is computed at build time.
- **Stack depth:** 1,500 nested parens and 400 nested blocks give the same locations. A frame past the 64-frame limit refuses.

## Conformance

- **Amended plan:** no second process (`track_caller.ts` and `panicking.ts` import only `node:fs`, `node:path` and the panic modules), no `RUST_BACKTRACE` change, nothing under `harness/` or `scripts/`.
- **Checker first:** it landed in the same commit as the hook, not before it. The swaps are fixed, so the substance holds.
- **Stricter key rule, D4 exception dropped: OK.** Both can only add refusals, and the 92 are still reached.
- **Non-tail edits:**
  - `keep_frame` is an identity function whose argument evaluates first, so order is unchanged. The bare statements are all on `never` calls. I read every edit.
  - Not on a hot path: `keep_frame` ran 1 time on hello, 18 on a next-solver test, and 229 on `numeric-cast.rs`, which has many diagnostics.
- **Arm moves (`lexer/mod.ts`, `thir/cx/expr.ts`, `select/mod.ts`):** I read the `thir` and `select` diffs and the start of the lexer's. Behaviour is preserved in what I read, and all three suites' samples match.

## ICE path against upstream

`emit_bug_diagnostic`, `report_ice`, the hook body, `try_print_query_stack`, `bug_impl` and `default_hook` match upstream in order, logic and markers, apart from F2. The std markers are at the right lines.

Compared with the oracle, stderr and exit code, stripping backtrace frames and masking the ids:

| Variant | Result |
|---|---|
| ICE file directory, including the file's content | same |
| Internal features note | same |
| `-C` flags, cargo-style flags | same |
| `RUST_BACKTRACE` unset, `1`, `full` | same |
| `-Zui-testing` | same |
| `--color=always` | same |
| `-Ztreat-err-as-bug=2` | same |
| Missing ICE directory | **F2** |
| `-Zthreads=2` | unported, exit 70, as before this lane |
| `--error-format=json` | unported, exit 70, as before this lane |

**Refusals:**

- A refused panic gives exit 101 with the reason.
- A refused diagnostic gives exit 70.
- An `Unported` inside the hook gives exit 101.
- A panic inside the hook aborts.

`main.ts`'s banner stays for unreported panics and JS errors.

## Protected cases

- **Scan:** I read the cached oracle output of every protected case outside split suites, 369,641 cases. 422 have exit 101 or 134, or ICE text. **No suite outside Miri has exit 101**: those 206 are interpreted programs panicking. The rest are mostly ICE words inside program or source text.
- **All 422 run against the port: 420 MATCH, 2 TIMEOUT.** The timeouts are not this lane's:

  | Case | Base | This branch |
  |---|---|---|
  | `run-pass-miri tests/ui/drop/dynamic-drop.rs` | 71 s CPU, 494.6G instructions | 80 s CPU, 498.6G instructions |
  | `run-fail-miri tests/ui/test-attrs/terse.rs` | 62 s CPU, 418.9G instructions | 61 s CPU, 421.8G instructions |

  The limit is 60 s of wall time, and both exceed it with this machine at load 15-40. Both also timed out when rerun without my other jobs, but other lanes were still loading the machine. The gate has its own retries and passed them at base. They sit near the limit whichever commit runs, which is worth knowing. The 0.7-0.8% difference is within what I saw for hello, so I do not read it as a change.
- **UNSTABLE:** `classify` returns UNSTABLE before comparing, and those cases are never protected, so a case that now matches causes no trouble. The 74 that match without the mask become MATCH at the next gate. The 18 wait for the harness batch.
- **Catch sites:** of the production catches, I read 21 in context. They are file I/O, or they rethrow or filter `Panic`. I saw the remaining ones only by file and line (fs, config, source map), so the gate settles the "caught panic adds stderr" exposure.

## Tools and markers

- **`types.sets.json` entry: correct.** It has the same shape as `rustc_interface`. Regenerating gives `diagnostics.gen.ts` identical apart from import paths, which follow `--out`. Its one unknown type is `dyn Error` at `diagnostics.rs:113`, and no rlink path reaches it. Root can approve it.
- **`rustc-call`, `rustc-const`:** `coverage.ts --check` ignores both and says `markers ok`. They are checked only by the report-only tool, and weakly (N3). Handoff 5.3 is the right batch.
- **Checker out of production:** nothing imports `track_caller_check.ts`.

## Cost

- **Hello, instructions, 5 alternating runs each:** base 10.53, 10.63, 10.04, 10.61, 10.51 G; this branch 10.01, 10.03, 10.25, 10.25, 10.23 G. No increase.
- **`track_caller.test.ts`, user + sys:** 4.3 s to 8.9 s, so **+4.6 s** against the 5 s budget, with no room left. Measured once at load about 15.
- **`--sample 200`, `RUST_TS_AGENT=review-ice-impl`:**

  | Suite | Result |
  |---|---|
  | `mir` | 200 MATCH |
  | `mir-o2` | 200 MATCH |
  | `tydump-ui` | 199 MATCH, 1 UNSTABLE |
  | `thirdump-ui` | 199 MATCH, 1 UNSTABLE |
  | `mirdump-ui` | 199 MATCH, 1 UNSTABLE |
  | `borrowck-ui` | 200 MATCH |
  | `pm-ui` | 199 MATCH, 1 UNSTABLE |
  | `run-pass-miri` | 200 MATCH |

  The 4 UNSTABLE cases are listed or thread-id cases, not protected.
- **`bun test` on everything touched,** with `RUST_TS_REQUIRE_PROBES=1`:
  - 1,693 pass, 0 fail, 1 skip that I did not identify.
  - Also passing: the `src/miri/intrinsics/x86/x86.test.ts` panic tests, which expect the old banner text. They pass only because Miri's locations always refuse, so resolving one later will fail them loudly.
- **Other checks:** `tsc` clean, `coverage.ts --check --offline` `markers ok`. No `rustc-ice-*` left in this worktree or the upstream checkout.

## What I did not check

- The gate or any full suite, and the 9 split suites in the protected scan.
- The other roughly 10,700 `tests/ui` files with a `.stderr`, and all of `tests/crashes`, which this checkout does not have.
- Whether distinct locations are as many as the totals suggest. The rule-of-three figure is therefore weaker than it looks.
- **Upstream's real location for F1's site:** I read it from the source. The oracle cannot be made to fire that assert.
- A source file changing under a running process, and a source-mapped bundle placed inside `src/`.
- Linux and Windows.
- The lane's test suite as a mutation target. I ran it but did not mutate it, and did not recheck the Bun tail-call shape test beyond its passing.

My scripts and outputs are in the session scratchpad, under `r/`:
`/private/tmp/claude-501/-Users-tomernorman--t3-worktrees-rust-ts-t3-94e029ef/149da6ac-d4a0-41c7-b523-b759019fd361/scratchpad/r/`

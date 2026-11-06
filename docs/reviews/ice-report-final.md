verdict: REQUEST CHANGES

Re-check of root's commit `92f0230f`, the head of `fix/ice-report`, answering `docs/reviews/ice-report-fix.md` R1 to R4. I am read-only: this file is the only change, on branch `review/ice-report-final`.

**What holds:**

- **R2** is right. F1's wrong line is gone through every wrapper I tried, and nothing the resolver reaches changed.
- **R3** is right. The port stamps UTC under all 9 `TZ` values, as the oracle does, and nothing else in `src/` reads local time.
- **R4** tests what it says: it fails when the local-time stamp comes back, and it leaves no files.
- `self_named_tail_calls`'s list is unchanged.
- Step 5 came out as expected, including 92 MATCH, 21 DIFF, 5 STOP.

**Two small changes are needed (V1, V2).** Neither touches compiler output, so neither needs the 118 or a gate-sized re-run:

- **V1 blocks:** the checker's new count is 0 by construction, for any source tree. It can't find anything, and it was offered as evidence for R2.
- **V2:** the new test never skips. Without `rustc` on PATH it is the only failure among the 214 tests of step 5.

## Findings

### V1 (MEDIUM, blocks): the check cannot print anything but 0

**Where:** `src/rust_ts/track_caller_check.ts:168`, against `src/rust_ts/track_caller.ts:338-341`.

**Why it is 0 by construction:**

- `map_call` returns `ok: false` when `anchor === undefined && up.in_nested_item(body, call.pos)` (`:338`).
- It sets `anchored: anchor !== undefined` (`:341`).
- So the checker's `m.ok && !m.anchored && m.up.in_nested_item(m.body, m.call.pos)` is the negation of a condition `map_call` has already returned on, with the same arguments.

`into-nested.txt` is one newline. The comment at `:157`, "anything listed here is a mapping to read", can never apply. R1's own fix proposed "the expected output is then 0, so any line is a real finding", which stopped being true once R2 removed the exemption. That is the two fixes meeting, not a slip in either.

**Failing scenario:** the hazard left after R2 is `in_nested_item` missing an item shape (N1: a nested `static` or `const`). The checker calls the same predicate, so it stays at 0 while F1's wrong location comes back through that shape. A new hoisted item that starts refusing also changes nothing on this line, so a reader can't see the resolver losing a site.

**The macro pass examines the wrong names:**

- `tracked_names()` (`:194-203`) takes `kind === "fn"` owners only. So none of the 7 real macro names is in it: `struct_span_code_err`, `gate`, `gate_alt`, `gate_multi`, `gate_all`, `span_mirbug`, `repr_int`. Those 210 mapped calls are never examined, and they are the only ones where the resolver passes `macro = true` (`track_caller.ts:231`).
- The pass runs fn names with `macro = true`, which only revisits calls the first pass saw. In my scan (156 names, a superset), 9,127 of 18,327 mapped rows are those revisits, over 9,451 distinct positions.
- So "41,807 calls" is not a count of calls, and "with macro mode" does not cover what it says.

**Fix, tried on a private worktree:**

```ts
if (!m.ok && m.why.includes("nested item")) refused.add(`${rel}:${line} ${callee}`);
if (m.ok && m.anchored && m.up.in_nested_item(m.body, m.call.pos)) anchored.add(`${rel}:${line} ${callee}`);
```

- With it, the line lists exactly two sites, the same two `ice-report-fix.md` named: `rustc_errors/json.ts:308 write` and `rustc_mir_transform/ref_prop.ts:313 assert`. Anchored into a nested item: 0. So the output is a short list to read, and a change in it means something.
- Run the macro names as a separate list with `macro = true`, and drop fn names from that pass.
- Don't add macro names to `tracked_names()`: `self_named_tail_calls` matches its names against fn owners, and that list should stay as it is.
- Reword the comment at `:155-157` and the file header.

An `in_nested_item` miss still needs a detector that doesn't share the predicate, like the one the prior review used. That belongs with N1, not here.

### V2 (LOW): `ice_path.oracle.test.ts` fails where its siblings skip, and has its own toolchain and env

**Where:** `src/rustc_driver_impl/ice_path.oracle.test.ts:9`, `:13`, `:24`.

Its three siblings with an oracle (`driver`, `inputs`, `print`) use `PIN.toolchain`, check the commit, and use `test.skipIf(SKIP)` with a printed reason, failing only under `RUST_TS_REQUIRE_PROBES=1`. This one does none of that.

| Scenario | Result |
|---|---|
| `PATH=/usr/bin:/bin`, whole of `src/rustc_driver_impl` and `track_caller.test.ts` | 192 skip, 21 pass, **1 fail**, this test: `Executable not found in $PATH: "rustc"` |
| Toolchain absent, empty private `RUSTUP_HOME` | Fails: `Expected to contain: "No such file or directory (os error 2)"`, `Received: ""`, which says nothing about the cause |
| `RUSTC_BOOTSTRAP=-1` inherited | Fails, the oracle refuses `-Z` |
| `RUSTC_LOG=debug` inherited | Fails: the port prints no warning line |

- **Toolchain:** `+nightly-2026-10-11` is the same commit as `+nightly` here (`6f5da406b` on both). But `PIN.toolchain` is `nightly`, and that is the toolchain `scripts/lib/oracle.ts` verifies for commit and components. The test checks neither, and it gets its sysroot from an unverified toolchain.
- **Env:** removing `RUSTC_ICE` and `TZ` at `:13` is dead code, because `env` sets both on every call. A parent with `TZ=UTC RUSTC_ICE=0` passes for that reason. What is missing is what the siblings strip: `RUSTC_LOG`, `RUSTC_BOOTSTRAP`, `MAKEFLAGS`, `CARGO_MAKEFLAGS`, `MFLAGS`.

**Fix:** copy `driver.oracle.test.ts:16-31` and its env filter at `:39`. The gate behaves the same either way, since `REQUIRE` still fails there, so this is about the lane loop.

**Not a finding:** without `.env.local` it fails, but so do 14 tests of `track_caller.test.ts` and many in `json.oracle.test.ts`. The brief says to copy the file.

### Nits

| # | Where | What | Effect |
|---|---|---|---|
| N5 | `track_caller.ts:336` | "so this refuses nothing real" reads as if the `if` never fires. It refuses 2 real sites, one of them F1. It means no port that kept a nested item is refused | Reading only |
| N6 | `ice_path.oracle.test.ts:32-34` | Only the hour is pinned. With `getUTCDate` swapped back to `getDate` alone, the test passes. It would be caught only by comparing the date too, and then with the same one-unit allowance | A mutation nobody is likely to write |
| N7 | `docs/reviews/plan-m7.md` F5 | The lane's "+4.8 s" is user + sys, while F5's arithmetic is about the step's wall time against `timeoutMs` (`scripts/gate.ts`). See the cost below | Whichever is meant should be written down |
| N1, N2, N3 | `track_caller.ts:717`, `:707-709`, `:339` | Still open from `ice-report-fix.md`. N3 now reads "the only upstream call is in a nested item", and is still `refused: other` in `classify_refusal`. N4 is gone, its line was replaced | As before |

## The five questions

### 1. R2: the exemption

**The reproducer, `rp.rs`, `-Zmir-opt-level=2 -Zmir-enable-passes=+ReferencePropagation`, with the condition at `ref_prop.ts:313` flipped:**

| Form at `:313` | Head `92f0230f` | Control: `7ab8f740` |
|---|---|---|
| Plain | Refuses | Refuses |
| IIFE, arrow with a block | Refuses | Prints `ref_prop.rs:339:25` |
| IIFE, `function` expression | Refuses | Prints `ref_prop.rs:339:25` |
| Named arrow, called | Refuses | Prints `ref_prop.rs:339:25` |
| Arrow with an expression body | Refuses | Refuses |

All are exit 101, with tail calls on and off, except that the expression-body arrow under tail calls refuses at the link check, on both commits. The head's text is ``location refused: `assert` at compiler/rustc_mir_transform/src/ref_prop.rs:149: the only upstream call is in a nested item``. So the test still detects the bug, and the fix removes it.

**Is root's comment true?** Yes, at the pin. "A port keeping a nested item inside its owner marks it": of 492 upstream `fn`s nested in a marked owner's body, 491 have a marker. The other has no same-named local in its TS owner, so it isn't kept. `locate` does use the innermost owner (`track_caller.ts:268`).

**Root's reasons, though, don't show it.** The 92 only reach the sites the 118 reach, and "the check reports 0" is V1. What does show it:

- **Exact static comparison, head against `7ab8f740`.** Every tracked name, the panic entries, the 7 macro names, on the innermost owner: 42,339 examined, 18,327 mapped. Once the line shift in `lib.ts` is ignored, the two scans have **0 differences**.
- **The same 3 rows refuse by this reason on both commits, at 2 sites**, `ref_prop.ts:313` (in both modes) and `json.ts:308`. None is in a TS closure. So the exemption was protecting nothing.
- The 1,302 mapped calls in a TS closure are untouched, because they aren't in a nested item upstream.

**Locations the corpus or a real run printed before and refuses now: none found.**

| Population | Result |
|---|---|
| ICE corpus (`out2`) | 49 of 49 mapped on both commits, `corpus.txt` identical |
| `--oracle 300`, head and `7ab8f740` | Both 251 comparable, 646 locations, 0 wrong, 46 refused. `oracle.txt` identical |
| `-Ztrack-diagnostics`, head, first 1,000 of the same 11,768 files, tail calls off | 839 comparable, 2,746 locations, **0 wrong**, 152 refused |
| Those 152, re-run with `RUST_TS_TRACK_CALLER_DEBUG=1`, since the reason is hidden otherwise | **0 by this reason**. 103 `no key`, 13 unmarked frame, the rest key differs, not unique or count |

`sites.txt` does move: 7 sites go from mapped to `refused: other`, for example `rustc_hir_typeck/fn_ctxt/checks.ts:582`. Those rows are the outer owner, a path the resolver doesn't take, and the location set is the same (2,468 of 2,616 witnessed on both).

### 2. R1: `tracked_names()`

- **All tracked names:** the fn names yes, 151 as root says. The macro names no (V1).
- **Innermost owner, deduped:** yes.
- **Vacuous?** Yes (V1), and 0 is by construction, as you suspected.
- **Does the step need a different form?** Yes: list the refusals by this reason (fix above).
- **`self_named_tail_calls`:** the list is byte-identical to `7ab8f740`, 30 lines. Adding `FAMILIES` and `into_diag` changed nothing.

### 3. R3: UTC

Real ICE, `RUSTC_ICE` set to a private directory. Oracle and port, each file name checked against the UTC clock read around that run:

| `TZ` | Oracle | Port |
|---|---|---|
| unset (host is Asia/Jerusalem) | `2026-11-06T01_56_59` | `2026-11-06T01_56_59` |
| `Asia/Tokyo` | `2026-11-06T01_57_00` | `2026-11-06T01_57_00` |
| `UTC` | `2026-11-06T01_57_00` | `2026-11-06T01_57_01` |
| `America/Los_Angeles`, `""`, `:/etc/localtime`, `Bogus/Zone`, `EST5EDT`, `Pacific/Kiritimati` | All in the UTC window | All in the UTC window |

The one-second differences are run order. All exit 101.

**Anything else in the ICE path on local time?** No. `getHours`, `getDate`, `toLocale*`, `getTimezone*`, `Intl.DateTimeFormat` and the like have no hits anywhere in `src/`, including `vendor`. Upstream has `jiff` at one call, `rustc_driver_impl/src/lib.rs:1439`, and `Cargo.toml:9` is as the comment says.

### 4. R4: the test

- **Helper for the oracle:** it should use one (V2).
- **Skips without one:** no (V2).
- **Hour boundary:** safe. `utc` is read after both runs, and each stamp must be `utc` or `utc - 1` mod 24. That covers a run crossing an hour, and 23 to 0. A local stamp in Tokyo is 9 hours away, so it can never fall in that pair: the local-time mutation fails with `Expected to contain: 10`, `Received: [ 1, 0 ]`.
- **Date boundary:** can't fail, as only the hour is read (N6).
- **Hermetic:** partly (V2).
- **Leftovers:** none. `/nonexistent` isn't created, there is no `rust-ts-ice-path-*` in `$TMPDIR`, and no `rustc-ice-*` in cwd or the worktree.
- **Unit cost:** about 1.0 s wall and 1.4 s user + sys, 3 runs at load 15 to 19.

**Budget against F5's 5 s:**

| Measure | `track_caller.test.ts` | This test | Lane |
|---|---|---|---|
| User + sys (the prior review's measure) | +4.8 s | 1.4 s | **6.2 s, over** |
| Wall | +2.5 s | 1.0 s | 3.5 s, within |

F5 reasons from the step's wall time against a wall-clock limit, so I read this as fitting. But the number quoted so far is the other one (N7). Not blocking.

### 5. The runs

| Check | Result |
|---|---|
| `RUST_TS_REQUIRE_PROBES=1 bun test src/rust_ts/track_caller.test.ts src/rustc_driver_impl` | 214 pass, 0 fail |
| `bunx tsc --noEmit -p .` | Clean, with `node_modules` linked for that run and removed |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24848; vendor 5086; library 595)` |
| The 118, `cmp-fix.ts` imports pointed at this worktree, private oracle cache | **92 MATCH, 21 DIFF, 5 STOP**; 0 status and 0 first-difference changes from root's `res-fix.json`; no `nested item` in any `.err` |
| `track_caller_check.ts --oracle 300` | 4,481 sites, 0 swaps, 20 anchors with 0 bad, 30 self-named, 2,468 of 2,616 witnessed, ICE corpus 49 of 49 |

**`--sample 100`, `RUST_TS_AGENT=review-ice-final`:**

| Suite | Result | Not MATCH (none protected) |
|---|---|---|
| `mir` | 100 MATCH | |
| `tydump-ui` | 100 MATCH | |
| `pm-ui` | 98 MATCH, 1 UNPORTED, 1 UNSTABLE | `proc-macro/expand-expr.rs` (cross-thread execution); `proc-macro/load-panic-backtrace.rs` (thread id) |

The upstream checkout is clean apart from its usual ignored `build/`.

## What I did not check

- The gate, or any full suite. `-Ztrack-diagnostics` covers 1,000 of 11,768 files, with tail calls off only.
- N1's shapes again, or anything else in `in_nested_item` and `in_closure`, whose code this commit doesn't change.
- `in_nested_fn`'s over-generosity noted in `ice-report-fix.md` R2. `classify` still uses it at `track_caller.ts:130`, unchanged here.
- jiff's own source: the UTC behaviour is from the oracle's output on 9 `TZ` values and the `Cargo.toml` features.
- An hour or date boundary with a faked clock: those answers are from reading the code.
- Any host other than `aarch64-apple-darwin`.
- V1's fix beyond one run of the prototype, and V2's fix at all.

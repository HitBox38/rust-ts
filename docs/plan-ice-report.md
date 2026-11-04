# ICE report plan: making the port's internal-compiler-error output match rustc's

Source: lane `ice-report` (design only; it ports no code). Status: **proposal, not reviewed**. Decisions are D1–D12
in section 7; root records them. Pin `6f5da406b56c` (1.101.0-nightly). Base: `c9d3c553`.

## 0. Recommendation

**Do it, but not the way the queue item expects.** No change across the whole compiler is needed.

- Reuse the runtime location resolver the repo already has (`src/rust_ts/track_caller.ts`, lane m2b-misc). Reject the
  per-call-site codemod and the location table.
- Solve JSC's tail calls with a **replay**: only when a location cannot be resolved, re-run the same compile silently
  with tail calls off and read the location from that run. Normal compiles do not change at all.
- Port the small ICE path (about 400 upstream lines).
- Mask thread ids in difftest (a reviewed harness batch).

A throwaway prototype of exactly this (about 170 lines over a copy of `src`) reproduced **all 14 `mir` cases byte for
byte, thread id masked**. It also reproduced 103 of the other 104 cases that share the blocker; 25 of those 103 need
the `RUST_BACKTRACE=0` override of D8, and the 104th should need one marker (section 6).

Corrections to the queue item, all measured below:

| The item says | Measured |
|---|---|
| 14 cases | **118 suite cases (46 test files)**: 40 UNSTABLE ICE cases plus 78 `UNPORTED: Location::caller` |
| 4 SIMD cases report `validate.rs:81:25` | 7 |
| All 14 ICE differently from the port | 11 exit 101 on both sides; 3 (`noncleanup-*`) exit 70 on the port, because of a missing `Level::Bug` diagnostic |
| 343 `#[track_caller]` fns | 338 raw grep lines at the pin; **253 real attributes** on 252 fn entries (the rest are comments and strings); 207 distinct in-scope non-test fns, of which **27 reach a bug site** |
| ~1,290 bug sites need a location | 1,239 free-function plus 57 method sites in TS; none needs editing with this plan |

## 1. How this was measured

macOS arm64, oracle `rustc +nightly-2026-10-11`. Port at `c9d3c553`, run with the suites' own argv, env and cwd
(taken from `harness/suites.ts`). Load average was about 100–170 from other lanes, so wall times are poor; CPU numbers
are rusage user time.

Scripts and outputs are in `$RUST_TS_DATA/tmp/ice-report/`:

| File | What it is |
|---|---|
| `gate-list.ts`, `gate-nonmatch.json` | every non-MATCH case of accepted gate `gate-20261102-174727-root-kxpt` |
| `run-all.ts`, `out2/`, `cat-all.ts`, `cat-all.json` | oracle twice and port once on the 118 |
| `dylib-loc.ts`, `dylib-locs.txt` | every `Location` constant in the oracle binary |
| `survey.ts`, `tc2.ts`, `tc-review.txt`, `tc-groups.json` | the `#[track_caller]` survey |
| `sites.ts`, `sites2.ts`, `sites3.ts` | call-site mapping checks |
| `patch.ts`, `patch2.ts`, `patch3.ts`, `proto/` | the prototype |
| `run-proto.ts`, `run-sub.ts`, `res-*.json` | prototype results |
| `regress.ts`, `t1.ts`, `nest2.ts`, `bench.ts` | regression sample and cost measurements |

## 2. What the oracle prints

### 2.1 The 14 `mir` cases

Exit 101, empty stdout, on all 14. Between two oracle runs only the thread id differs: raw outputs differ on all 14,
and they are byte-identical once the id is masked. `RUSTC_ICE=0` means no ICE file and no path note on any case.

| Cases | `panicked at` (under `compiler/`) | Query stack | Notes after the panic line |
|---|---|---|---|
| 7 SIMD (`shuffle`, `generic-shuffle`, `generic-gather-scatter`, `generic-arithmetic-saturating-2`, `generic-select`, `inlining-issue67557-ice`, `masked-load-store-build-fail`) | `rustc_mir_transform/src/validate.rs:81:25` | `optimized_mir` | internal-features, version, flags |
| `noncleanup-cleanup`, `-resume`, `-terminate` | `validate.rs:155:27`, `:519:26`, `:528:26` | `optimized_mir` | same |
| `borrowck-describe-field-generic-param-owned-box` | `elaborate_box_derefs.rs:97:13`, **twice** | `mir_drops_elaborated_and_const_checked` > `analysis` | same |
| `do_not_const_check` | `const_eval/machine.rs:460:21`, **twice** | 2 frames, then `... and 2 other queries...` | same |
| `move-expr/name-resolution` | `rustc_hir_typeck/src/fn_ctxt/_impl.rs:164:13` | `typeck_root` > `analysis` | bug report, update nightly, version, flags |
| `track-diagnostics/track` | `rustc_hir_typeck/src/lib.rs:715:10` (message has no location prefix) | `typeck_root` > `analysis` | same as above |

Every panic has payload `Box<dyn Any>` and names thread `rustc`. The ICE block has this shape:

```
error: internal compiler error: /rustc-dev/<commit>/compiler/<path>:L:C: <message>
 --> <span and snippet>


thread 'rustc' (<tid>) panicked at /rustc-dev/<commit>/compiler/<path>:L:C:
Box<dyn Any>
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace     <- first panic only

note: <internal features | bug report + update nightly>

note: rustc 1.101.0-nightly (6f5da406b 2026-10-10) running on aarch64-apple-darwin

note: compiler flags: ...

query stack during panic:
#0 [query] description
...
end of query stack                  <- or `... and N other queries...`, not both
```

With two ICEs the whole block repeats without the `run with` note, then the compile continues (ParallelGuard) to
`error: aborting due to 2 previous errors`. The port's control flow already matches this (fixers-36). It only lacks
the printing at panic time.

### 2.2 All 118 cases with the same blocker

| Shape | Suite cases | Notes |
|---|---|---|
| Delayed bugs: `note: delayed at <loc> - disabled backtrace` + `report_ice`, no `thread` line | 78 | No thread id, so the oracle is reproducible; these show as UNPORTED today, not UNSTABLE |
| `bug!`-class panic, payload `Box<dyn Any>` | 29 (14 are `mir`) | |
| Non-`bug!` panic with a string payload, `error: the compiler unexpectedly panicked` | 9 | `assert!`, and `aborting due to -Z treat-err-as-bug=1` |
| Proc-macro panic (`thread '<unnamed>'`, `panic-derive`) | 2 | Already identical once the id is masked |

All 118 are byte-stable after masking across two oracle runs. 26 of them run with `RUST_BACKTRACE=short` (compiletest's
env: `tydump-ui` 7, `thir-tree` 9, `thirdump-ui` 7, `mirdump-ui` 3), so the oracle prints real Rust frames. The other
92 run with `RUST_BACKTRACE=0`.

## 3. Getting the Rust location to the output

### 3.1 What the location is

`caller_location_span` picks the call in the innermost non-`#[track_caller]` function that entered the chain. The span
is the call's `fn_span`, mapped to the outermost macro call site (`expansion_cause`). It prints as
`<remapped file>:<line>:<col_display + 1>` (`location_triple_for_span`). So:

| Call form | Column points at | Example |
|---|---|---|
| Method call | the method name | `diag.emit_bug()` → `lib.rs:715:10` |
| Macro | the outermost macro invocation | `span_bug!` at `machine.rs:460:21` |
| Path call | the start of the path | |

### 3.2 An independent check for columns: the oracle binary

Every `Location` is a constant in `librustc_driver` (`{ptr, len, line: u32, col: u32}`). Scanning `__DATA_CONST` and
`__DATA` for that shape yields 19,263 unique locations, **15,833 of them under `compiler/`**. This uses the oracle
itself, not a reimplementation of the rule.

| Check | Result |
|---|---|
| Locations the oracle printed across the 118 cases | **49 of 49** present |
| Upstream `bug!`/`span_bug!` sites (in scope, not in a `#[track_caller]` body or `macro_rules!`), line and column from the rule above | **1,329 of 1,406** present |
| Those 77 absent sites: another column present on the same line | **0**, so no sign of a column error. Inferred to be compiled out, not proven |
| TS sites mapped by the resolver's k-th-call rule | 958 of 994 present |

The check has two limits. Absence is not an error, so a site can only be reported as "not witnessed". Presence does
not prove the mapping either: two sites swapped within a function both exist in the binary. See section 3.5.

### 3.3 Where `#[track_caller]` fns go

Of 253 attributes: 22 fn entries are in out-of-scope crates, 18 are test-only and 5 are duplicates from macro-generated
impls, leaving 207 distinct fns. Classification is by name from each body (generic names such as `new` removed as
edges) and I read the list, so treat counts as ±a few (`tc-groups.json`).

| Group | Fns | Examples |
|---|---|---|
| Diagnostic creation and emission only: the location ends in `DiagLocation::caller` | 117 | `struct_err`, `emit_err`, `into_diag`, all of `rustc_attr_parsing/context.rs`, `emit_lint_base`, `mirbug` |
| Standard-library panic only | 45 | `Lock`, `Steal`, `expect_failed`, `required_consts` |
| Reach `bug!`/`span_bug!`/`ExplicitBug` | 27 | `validate.rs fail`, `type_at`, `region_at`, `const_at`, `parent`, `expect_local`, `global_alloc`, `unwrap_memory`, `dcx().bug`, `span_bug`, `Diag::emit_bug` |
| Nothing reachable by name | 17 | `get_only`, `with_opt`, `hir_fn_decl_by_hir_id` |

A 28th fn, `Ident::new`, has a `span_bug!` behind `cfg!(debug_assertions)`, which is dead in the oracle.

**The 117 are what decides the design.** 29 of the 45 distinct locations in the 118 cases are `delayed at` locations
that enter through this chain, for example `repr.rs:240:16` through `expected_list` → `emit_parse_error` → `emit_err` → … → `DiagInner::new`.

### 3.4 The three options

| | A: argument per call site (codemod) | B: table keyed by markers | C: JS stack (exists) |
|---|---|---|---|
| Mechanism | `bug(msg, L(file, line, col))` | generated (marker, callee, k) → location | capture a stack; frames → marker → k-th call → upstream source. Bun already reports TS positions, so no source map is needed |
| Direct `bug!` sites | Touches 1,296 sites in about 340 files | Needs a key at runtime, which means a stack or A's site id | No edit |
| `#[track_caller]` chain | A new parameter through 27 fns; 1,000+ name-based call sites (`parent` 441, `expect_local` 254, `fail` 196, `type_at` 158) | As C | Walks frames, skipping upstream `#[track_caller]` owners |
| Diagnostic chain (78 cases) | **Not feasible**: 20k name-based sites (`new` 5,076, `err` 2,636, generated `into_diag` 1,738) | As C | Already works |
| Macros | The tool writes the outermost call site | Same | `rustc-macro:` markers are transparent frames |
| Tail calls | Immune | Same problem as C | **Broken by default** (section 3.6) |
| Hot path | Extra constant argument: not distinguishable from noise in a microbenchmark (3–15 ns/call under load) | None | None. `new Error` at 64 frames (1.5–10 µs) runs only at diagnostic creation, as today, and at panic |
| Checking | Literal versus upstream | Generated | Static checker plus oracle binary; refuses rather than guesses |
| Cost | A codemod colliding with every running lane | A generator, then C anyway | About 100 lines added to an existing module |

**A cannot replace C:** it stays stack-based for the 78 delayed-bug cases, and needs a second mechanism for the rest.
B only precomputes C's last step. Its one real benefit is not reading `$RUST_TS_DATA/rust` at runtime, which is not
needed while the harness is the only user (D10).

### 3.5 Limits of the k-th-call mapping

Over the 1,239 TS `bug`/`span_bug` sites:

| Outcome | Sites |
|---|---|
| Mapped k-th to k-th | 994 (80%) |
| Count mismatch (99 fns; e.g. one Rust arm expanded into several TS arms, or TS `bug` where upstream has none) | 183 |
| Outside any marker (closures in consts, helpers) | 44 |
| Inside a `#[track_caller]` body | 17 |
| No upstream body at the marker | 1 |

Mismatches and unmarked frames refuse, which is safe. **Swaps are the real risk**, because the k-th rule can return a
wrong location. Comparing message text on 428 k-th pairs in 157 fns: 381 agree, 33 have no literal to compare, 14
disagree. At least 5 of those 14 are real swaps (`traits/select/mod.rs:524` rotates 3 sites, `thir/cx/expr.rs:392`
swaps 2). The others look like detection noise such as `$: "Move"`, but I did not read them all. So the resolver must
compare message text and refuse on disagreement (D4).

Other panics map less well, and refuse the same way:

| TS name | Sites | Mapped |
|---|---|---|
| `panic` | 1,307 | 372 (older ports turned `bug!` into `panic`, per PORTING §3) |
| `unwrap` | 1,211 | 787 |
| `assert` | 926 | 689 |
| `unreachable` | 660 | 473 |
| `assert_eq` | 295 | 239 |

### 3.6 Tail calls

JSC does proper tail calls in strict code, and every ES module is strict. **955 of 1,239 TS bug sites (77%) are
`return bug(...)` or `=> bug(...)`**, which removes the very frame the location needs. `DiagInner.new` → `new_with_messages`
at the base of every diagnostic chain has the same problem. Without a fix the prototype matched only 13 of
118 (10 of the 14 `mir` cases); the rest refused, none printed a wrong location.

| | T1: tail calls off globally | T2: make the sites non-tail | **T3: replay on refusal (recommended)** |
|---|---|---|---|
| What changes | One line in `ensure_stack` | `return bug(..)` → `bug(..)` at 955+ sites, plus chain sites, plus a lint | About 30 lines in `track_caller.ts` |
| Normal compiles | All change | Unchanged | **Unchanged: nothing runs until a location is refused** |
| Location coverage on the 118 | 80 | Not measured | **80: same verdict as T1 on 118 of 118** |
| Nesting | **Loses rustc's limit on macOS**: parens at rustc's 7,421 and unary minus at 17,282 exit 138 (SIGBUS) with tail calls off, 0 with them on. Both pass at half those depths, and blocks, `[T]` and closures pass at rustc's limit either way. `mod a {` at 6,933 hit my 150 s kill in both modes, so it is unmeasured | Unchanged | Unchanged. A replay that overflows just refuses |
| CPU and memory | No cost on the measured set: 89 cases (39 deepest or largest in `tests/ui`, 50 random) gave identical output; 262 s vs 254 s user; 398 vs 402 MB RSS. A `check-core` run with tail calls off was stopped at my 50-minute limit under load, so core-sized compiles are unmeasured | Not measured | Costs one extra compile, only on a refused location |
| Risks | Reopens root's 2026-10-13 decision; every protected case runs in a new mode | Merge conflicts everywhere; must be kept up forever | Assumes determinism; stdin input; output files written twice |

**Why T3 over T1:** T1 is simpler and cheap on the corpus, but it gives up a compile rustc performs (`stack.ts` states
that rust-ts reaches at least rustc's nesting) in exchange for ICE text. T3 keeps both. T1 is the fallback if the
reviewer rejects T3 (D3).

How T3 works:

1. Every location request (panic or `DiagLocation` display) takes the next index in a counter.
2. On the first refusal, spawn the same argv with `BUN_JSC_useTailCalls=0`, `RUST_TS_LOC_REPLAY=<tmp>` and stdio ignored.
3. The child appends every request's result to the file and otherwise runs normally.
4. The parent reads entry `i`, and verifies entries it already resolved itself. A mismatch or a missing entry refuses.

Measured in the prototype: 97 replays over the 118 cases at a mean of 11 s wall under load ~100, maximum 62 s. A case
that slow would hit the 60 s subject timeout on a loaded machine; that loses nothing protected but can delay a
recovery. Refuse without replaying when the input is stdin.

## 4. What to port

| Item | Upstream | State | Work |
|---|---|---|---|
| `emit_bug_diagnostic` | `rustc_interface/callbacks.rs:90` | missing | Port; swap into `EMIT_BUG_DIAGNOSTIC` in `setup_callbacks` |
| `bug_impl` location | `rustc_span/macros.rs:51` | `location` is `undefined` | Resolve from the stack inside `bug_impl`, with a `// PORT:` |
| `report_ice` | `rustc_driver_impl/lib.rs:1538` | missing | Port; uses a fresh `DiagCtxt` and the real emitter |
| `install_ice_hook` | `lib.rs:1459` | stub | Port the hook body, including the ICE file (D9) |
| `Ice*` diagnostics | `rustc_driver_impl/diagnostics.rs` (115 lines) | no TS file | Add the file; derive per existing codegen |
| `try_print_query_stack` | `rustc_interface/interface.rs:542` | missing | Port. **`print_query_stack` and `description` are already ported** and worked unchanged |
| `default_hook` | `library/std/src/panicking.rs:237` | missing | Port to `src/std`: the message, `FIRST_PANIC`, the backtrace style |
| `emit_bug` / `dcx().bug` | `rustc_errors` | ported | No change. `track.rs` already throws `ExplicitBug` from `Diag.emit`, and the hook takes its location |
| Hook point | n/a | | `Panic`'s constructor. Rust runs the hook at the panic, before unwinding, and the query context is still live there. Delayed bugs go through `DelayedBugPanic`, which skips `default_hook` as upstream does |
| Resume without hook | `resume_unwind` runs no hook | | `proc_macro/bridge/panic_message.ts:43,45` rebuilds a `Panic`: add a path that skips the hook. Audit the 32 direct `new Panic` sites |
| Banner | `src/rust_ts/main.ts:53` plus 12 other entry points | | Remove for a `Panic` the hook reported. Keep it for other JS exceptions and for a refused location (D5) |
| Dump entry points | `mirdump`, `resdump`, `thirdump`, `tydump` | call nothing | Call `install_ice_hook`, as their oracle probes do |

Without `emit_bug_diagnostic`, the `Level::Bug` diagnostic is never emitted. That is why `noncleanup-*` currently reach
`flush_delayed` and exit 70.

**Status semantics stay as they are.** `classify` calls a port panic where the oracle has none CRASH by exit code alone
(`sub.code === 101 && o.code !== 101`), so dropping the banner cannot hide one. The port's JS stack is still needed to
debug those, so it stays available behind `RUST_TS_JS_BACKTRACE=1`.

Some upstream behavior has no JS equivalent and stays out of reach:

- JS array indexing does not panic where Rust's does, so an upstream `index out of bounds` ICE shows as a later `TypeError`.
- Native backtrace frames.
- Expect these to stay DIFF if a future case hits them.

## 5. Harness batch (separately reviewed, AGENTS.md section 2)

1. **Mask only the digits.** Before comparing, both sides get `^thread '<name>' \((?:rtid )?(\d+)\) panicked` → the
   digits replaced by `<tid>`. This is the pattern `proc_macro_host.oracle.test.ts` already applies. The thread name,
   location and payload stay compared.
2. **Miri keeps its comparison.** `thread 'main' (1000)` in an interpreted program is deterministic and must be
   compared: mask a Miri case only when `isIceStderr(oracle)`, the same condition `unstableMiriOracleReason` uses.
3. **Retire the thread-id reason.** Remove `THREAD_ID_PATTERN` from `UNSTABLE_ORACLE_PATTERNS` and the ICE entries from
   `MIR_UNSTABLE`, `M3_UI_UNSTABLE`, `M4A_UI_UNSTABLE`, `THIR_TREE_UNSTABLE`, `PM_UI_UNSTABLE`. Keep the long-type and
   ICE-file patterns: those remain truly irreproducible. Cached oracle output keeps its raw id, so an audit can see it.
4. **`RUST_BACKTRACE=0` for the 26 (D8, a separate review question).** An explicit list in `suites.ts`, on both sides.
5. **Tests that fail on a mask that hides too much:** a different thread name, a different location, a different
   payload, a non-digit id, and a Miri non-ICE id must all still compare as different.
6. Update `scripts/unstable.test.ts` and `scripts/lib/ctfe-sample.ts` (which greps the banner).

**Effect on the ratchet: nothing protected can be lost.** These cases are not in any baseline, because UNSTABLE is
never protected. After the batch, the 38 ICE cases that do not yet match report as DIFF or UNPORTED rather than
UNSTABLE, which is the honest status once the oracle is reproducible.

## 6. Lanes, order, and what each recovers

| # | Lane | Size | Files | Recovers (suite cases, cumulative of 118) | `mir` (of 14) |
|---|---|---|---|---|---|
| 1 | `ice-harness` (reviewed batch) | Section 5, items 1–3, 5, 6 | `scripts/`, `harness/` | **2** (`load-panic-backtrace` in `pm-ui`, `pm-expanded`) | 0 |
| 2 | `track-caller-2` | About 150 lines of glue plus tests | `src/rust_ts/track_caller.ts`, `src/rustc_errors/diagnostic.ts` | No change alone | 0 |
| 3 | `ice-hook` | About 400 upstream lines | Section 4 | **80** | **14** |
| 4 | `ice-anchors` | `rustc-const:` marker in 1 file, plus coverage support | `attributes/macro_attrs.ts`, `scripts/coverage.ts` (harness batch) | **92**: `macro-use-bad-args-1/-2` in 6 suites | 14 |
| 5 | `ice-harness-2` (reviewed; D8) | Section 5, item 4 | `harness/suites.ts` | **117** | 14 |
| 6 | `ice-anchors` (same lane) | 1 `rustc-macro:` marker on `span_mirbug` | `rustc_borrowck/type_check/mod.ts` | **118** (this last one predicted, not measured) | 14 |
| 7 | `track-caller-check` (optional) | A static checker over all sites, with the oracle-binary check | `scripts/` (harness batch) | 0; prevents wrong locations | 0 |

**Order:** 1, then 2 and 3 together (3 needs 2's API; each stays within its files), then 4 and 6, then 5, then 7. The
regular wave gate covers them; no dedicated gate is needed.

Every recovery number comes from the prototype, except the last case and except that the prototype's hook differs from
a real port in details such as emitting notes as text. What lane 2 must add beyond the prototype: the message-text
check (section 3.5), the parent/child cross-check, and refusing on stdin.

**Not recovered by this plan:** nothing in the 118. Left for later, on demand:

- Panics at sites that refuse today: the 183 mismatched and 44 unmarked `bug` sites, and the `panic`/`unwrap` family.
  Fix each when a case reaches it. A refusal is visible, never a wrong output.
- `RUST_BACKTRACE` other than `0`: real frames do not exist.
- Windows, which is unchecked.

### Cost and benefit

**Benefit.** 118 of 533,608 protected is 0.02%, and these cases test error text, not compilation. What they buy beyond
the count:

- `mir`'s only remaining non-matches are 4 TIMEOUTs, which `miri-perf`-style speed work would address, not this.
- 78 of the 141 UNPORTED cases in the last gate go away, leaving 63.
- `-Ztrack-diagnostics` starts working, which is 753 notes in m2b-misc's earlier sample.
- Later ICEs become testable against the oracle instead of being UNSTABLE.

**Cost.** 3 small lanes plus 2 small harness batches. About 400 upstream lines and 150 lines of glue, with no
compiler-wide edit. In a regression sample of 150 non-ICE cases (`mir` 60, `pm-ui` 40, `tydump-ui` 30, `borrowck-ui`
20), prototype output was byte-identical to the port's. The new code runs only on a panic.

**Verdict.** The full version (A or B, across 340 files, for 14 cases) would not be worth it. This version is cheap
enough to do at low priority: after wave 38's first batch, never blocking M7. If root wants the minimum, stop after
lane 3: it recovers all 14 `mir` cases and 80 of 118 for most of the value.

## 7. Decisions

- **D1 Scope: the 118-case ICE path, not only the 14.** They share one cause. **Recommended.** Alternative: `mir` only,
  which needs the same code anyway.
- **D2 Location mechanism: the runtime stack (`track_caller.ts`).** **Recommended.** Reject A (cannot reach the
  diagnostic chain) and B (does not remove the stack).
- **D3 Tail calls: replay on refusal (T3).** **Recommended.** Supersedes the 2026-10-13 decision "Location::caller
  stays unported". Fallback: T1 for all runs, accepting the macOS nesting loss at rustc's limits. Reject T2.
- **D4 Mapping safety: k-th call plus message-text agreement; refuse on disagreement.** **Recommended.** A wrong
  location is the one failure the current resolver allows (section 3.5). Refuse also on count mismatch, except when
  upstream has exactly one site and the message matches; that exception must itself be reviewed.
- **D5 When a panic's location is refused: the existing banner with the reason, exit 101.** **Recommended.** That keeps
  CRASH meaningful. A `DiagLocation` display that refuses stays `unported`, exit 70, as today.
- **D6 Hook point: `Panic`'s constructor,** with a no-hook path for `resume_unwind`. **Recommended.** It is the one
  place every panic passes, including the 32 direct `new Panic` sites.
- **D7 Thread id and name: print `process.pid` as the id, with a `// PORT:`** (it is masked, and an OS id is unobtainable
  without FFI for no benefit). Name: `rustc` once the ported thread-spawn point has run, otherwise `main`. **Recommended.**
  No measured case panics on `main`.
- **D8 `RUST_BACKTRACE=0` for the 26 compiletest-env ICE cases.** **Recommended, last, as its own review question.**
  AGENTS.md forbids editing suite definitions to make a result pass, so a reviewer must weigh this directly. For it:
  both sides change equally, the only output removed is native frames that have no JS form, and `suites.ts` already pins
  `0` for most suites for this reason. Measured: 25 of 26 then match (the last needs lane 6). If rejected, those 26 stay
  DIFF, which is honest and costs nothing.
- **D9 Unset `RUSTC_ICE` and non-`0` `RUST_BACKTRACE` (no suite runs these): write the ICE file and print
  `stack backtrace:` with the JS stack, labelled as such.** **Recommended.** A compiler user should get a report rather
  than exit 70. These bytes cannot match the oracle and nothing compares them.
- **D10 Keep reading upstream sources at runtime; no generated table for now.** **Recommended.** Revisit if rust-ts must
  run without the checkout.
- **D11 Checker (lane 7): report-only at first, not a gate step,** using the oracle-binary set. Its baseline is the
  counts in sections 3.2 and 3.5. **Recommended.** Absence cannot be an error, and the binary exists only on the root
  host.
- **D12 Leave non-`bug!` panic sites on demand.** **Recommended.** About 4,400 TS sites and only 9 of the 118 cases;
  refusing is safe.

## 8. What I could not check

- **The prototype is not the port:** its notes are written as text, not through `DiagCtxt` and the emitter. A real lane
  may meet details the prototype skips.
- **Regression evidence is a sample of 150,** not a gate. Only the wave gate settles that.
- **Replay:** not tested with `-o`/`--emit` outputs on a successful compile, with stdin input, under Miri, or on Linux.
  Determinism is assumed from the harness's byte-identity record; the parent/child cross-check is the guard, and it is
  not in the prototype.
- **The `rustc-const:` anchor** was tried on one const (`macro_attrs.rs`); upstream has 22. Its end-of-init detection is
  crude in the prototype.
- **`span_mirbug` marker** (the 118th case) was not run.
- **Counts by name** (`#[track_caller]` groups, call sites, tail positions) come from regex scans over masked source,
  not an AST: TS 7's native compiler has no JS API here. They are good for sizing, not exact.
- **The 77 sites absent from the oracle binary** are inferred compiled out, not proven. I read none of the 99 mismatched
  fns individually, and not all 14 message disagreements.
- **`thread 'main'` panics, RUST_BACKTRACE unset, and a real Miri host ICE** were not measured: no case in the corpus.
- **Tail calls off on large compiles:** the `check-core` run did not finish in 50 minutes under load, so T1's cost and
  stack use there are unknown. `mod a {` at rustc's limit is also unmeasured (killed at 150 s in both modes).
- **Wall times** were taken at load ~100–170. CPU figures are rusage.

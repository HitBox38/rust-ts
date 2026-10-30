# perf-core-a — profile and speed up the core check (plan-m5 D10; constant factors only)

Branch `lane/perf-core-a`, based on main `c58a6fc4`. No logic changes. Each fix carries a `// PORT: (perf)` note
(40 of them). No `unported(...)` was added or removed. Coverage is unchanged: TOTAL 22413/25518 fns, and
`coverage.ts --check` reports markers ok (22992; vendor 4680). No new functions mirror upstream ones; the new helpers
are local perf helpers without markers.

## Results (before = `c58a6fc4`, after = branch head)

All runs used core with plan-m5 D1's argv from `.data/rust`, as the suites do, each run alone. The host was shared
with other lanes, and user time moved by ±10% with load. So every pair was run **interleaved**, base then head, and
I also report `instructions retired` from `/usr/bin/time -l`. That counter barely moves with load.

| run | instructions (before → after) | user s (before → after) | wall s | max RSS GB |
|---|---|---|---|---|
| `-Zunpretty=expanded` | 328G / 327G → 279G / 284G (**−14%**) | 34.1 / 33.9 → 27.6 / 28.0 (**−18%**) | 19.4 → 14.6 | 5.2–5.5 → 5.5–5.6 |
| `check-core-bin` | 1455G / 1433G → 1362G / 1341G (**−6%**) | 161.2 / 155.5 → 152.1 / 150.6 (−5%) | 109 → 103 | 9.0–9.1 → 9.0–9.4 |
| `mir-core` (`-Zunpretty=mir`) | 1658G / 1650G → 1551G / 1562G (**−6%**) | 185.0 / 179.1 → 170.7 / 171.3 (−6%) | 135 → 113 | 8.6–9.5 → 9.7–10.0 |

- The outputs are byte-identical to base for all three: the expanded text, the 46.8 MB MIR text, and the
  check-core-bin stdout plus its stderr line `unported: rustc_metadata::fs::encode_and_write_metadata`.
- RSS swings ±0.8 GB from run to run with GC timing (the two base `mir` runs were 8.6 and 9.5 GB). No change here
  should grow the heap measurably. The span table now stores a hash next to each index, which costs a few hundred MB
  at most.
- Script and raw logs: `$RUST_TS_DATA/tmp/perf-core-a/bench.sh` (`bench.<mode>.<base|cur>.out.err`), with a base
  worktree of `c58a6fc4` at `$RUST_TS_DATA/tmp/perf-core-a/base`. Profiles and aggregators are in the same
  directory: `*.cpuprofile`, `prof2.py` (self time and per file), `callers.py`, `under.py`, `phases.py`.

## Verification
- Sample difftests with `RUST_TS_AGENT=root-f5de`, run on the final code commit `41cf1661` (runs `20261030-092146`, `-092252`, `-092333`, `-092425`). Each
  matches gate-20261029-224808-root-f2r5 on the same ids, and no protected case was lost:
  - `mir --sample 300`: 297 MATCH, 1 UNPORTED (transmute-fail, Size beyond 2^53), 2 UNSTABLE, as in the gate.
  - `expanded --sample 300`: 300/300 MATCH.
  - `tydump-ui --sample 300`: 298 MATCH, 2 UNSTABLE, as in the gate.
  - `mir-minicore`: 46/46 MATCH.
  - The same four were also run at the first commit `f283307e`, with the same results.
- `mir-core`: **47,734/47,734 MATCH** on the final head (run `20261030-092435-root-f5de-qofo`; that run's 184 s / 9.1
  GB was taken at load ~50 and is not a benchmark).
- `bun test` on the touched crates (rustc_ast, rustc_ast_ir, rustc_borrowck, rustc_lint, rustc_middle,
  rustc_mir_transform, rustc_next_trait_solver, rustc_span, rustc_trait_selection, std, vendor/anstream): 1380 pass,
  0 fail. `src/rust_ts/intern_key.test.ts` passes (6/6, including its corpus equivalence of `intern_key_eq` vs
  `intern_key`).
- `bunx tsc --noEmit -p .` is clean.

## What the profiles showed
- `-Zunpretty=expanded`: parsing about 3 s, macro expansion 2.3 s, resolution plus effective visibilities about 8 s,
  printing 0.9 s (main thread 15.8 s after the fixes). There is no remaining outlier. The top items were spans (the
  interner, view objects, closures), `try_visit`'s megamorphic `branch`, `field_mut` closures, a `Str.find` that
  scanned the whole source buffer, the combined early-lint methods' rest/spread, and a generator in
  `RustcVersion::parse_str`.
- `check-core-bin` (main thread 99 s, user ≈ 1.5× main thread, so about a third goes to GC threads):
  `check_crate` (typeck and wfcheck) 41 s, borrowck 21 s, `mir_built` 11 s, expansion and resolution 11.5 s.
  **Interning is the largest single theme:** `intern_key`, the string-keyed `ShardedHashMap` lookups and
  `intern_key_eq` take about 14% of the main thread, and **about 35% inside the trait solver**
  (`evaluate_root_goal`, 41 s).
- `mir-core`: the MIR validator, `MutVisitor.super_source_info` and the printer's UTF-8 encoding were the outliers,
  mostly GC time charged to allocation sites in tight loops. Each is fixed below.

## Fixes (all `// PORT: (perf)`)
| file | change |
|---|---|
| `std/mut_ref.ts` | `field_mut` returns a `FieldMut` class instance (prototype accessors) instead of an object literal with two closures |
| `rustc_ast_ir/visit.ts` | `try_visit`: inline fast path for `VisitorResult` `()` (same check and panic as its `branch`) |
| `std/str.ts` | `Str.find` / `Str.lines`: bounded byte scans (`Uint8Array.indexOf` searched to the end of the backing source buffer, e.g. for every doc comment in `cook_doc_comment`) |
| `rustc_lint/passes.ts` | combined early/late lint pass `check_*` methods: specialized by arity over a `field_list` array (no rest/spread, no string-keyed field lookups per call) |
| `rustc_span/lib.ts` | `session_globals_get()`: `SESSION_GLOBALS.with(\|g\| g)` without a closure |
| `rustc_span/span_encoding.ts` | the `Span` accessors read `interned_data(index)` directly (no `Interned` view, no `with_span_interner` closure, no `inline_ctxt` `Err` box). `Span::new` uses `SpanInterner.intern_parts`, which allocates the `SpanData` only on a miss. The open-addressing table stores each entry's hash, so probes and `grow` do not read the `SpanData` objects |
| `rustc_middle/query/query_api.ts` | `tcx.$query(key)` calls `query_get_at(tcx, DUMMY_SP, ..)` directly (the `TyCtxtAt` method's body) instead of allocating `tcx.at(DUMMY_SP)` and looking the method up by name. The vtable of the last `query_system` is memoized per query |
| `rustc_middle/query/calls.ts` | `query_get_at` / `query_ensure_ok` inline `try_get_cached` (no `{ _0 }` box) |
| `rustc_middle/query/caches.ts` | `DefaultCache` stores `[value, index, key]` and returns it as the `CacheEntry` (no copy per hit). `VecCache.complete` fills the slot array densely: a store past the end left holes, which made the engine use a sparse representation for every `lookup` |
| `rustc_next_trait_solver/solve/assembly/mod.ts` | `filter_specialized_impls`: `intern_key_eq` instead of building two `Canonical<Response>` keys per inner iteration |
| `rust_ts/intern_key.ts` | `intern_key_eq`: interned objects compare ids with `===` (was `"" + id` on both sides, which is injective on integers, so the answer is the same). Objects with the same field names in the same order are compared pairwise without `includes` scans, visiting the same nodes, and `FALLBACK` is the only possible throw |
| `rustc_middle/ty/generic_args.ts` | `visit_List(d)` memoized per element descriptor (stateless). The `GenericArgs` / `List<Ty>` descriptors are hoisted |
| `rustc_ast/attr/version.ts` | `splitn`: an eager array iterated through the array iterator instead of a generator (same `next()` protocol) |
| `rustc_ast/mut_visit.ts` | the `NodeId` / `Span` visitables and `visit_ident` skip building their `&mut` views when `visit_id` / `visit_span` is the default no-op |
| `rustc_middle/mir/visit.ts` | `MutVisitor.super_source_info`: the same for the default `visit_span` / `visit_source_scope` (plus empty `super_*`). This was the top allocation site in `mir-core` |
| `rustc_mir_transform/validate.ts` | `visit_place`: the downcast check uses an index instead of an `Array` iterator, where `next()` consumes the following element |
| `vendor/anstream/stream.ts` | `VecU8.write_fmt`: each piece is UTF-8-encoded straight into the buffer, ASCII by hand and the rest with `encodeInto` (the default shim made a closure object plus a `TextEncoder.encode` array per piece). A unit test for ASCII, multi-byte and surrogate pairs was added in `stream.test.ts` |
| `rustc_middle/mir/syntax.ts` | `MirPhase_cmp`: no closures or destructured arrays per call (`phase_eq` runs per pass per body) |
| `std/panic.ts` | `assert_eq`'s default `eq` is one shared function (a default-parameter arrow was a new closure per call, e.g. in `bit_set` `update_words`) |
| `rustc_middle/mir/pretty.ts`, `rustc_mir_transform/pass_manager.ts`, `rustc_trait_selection/traits/query/evaluate_obligation.ts`, `.../implied_outlives_bounds.ts`, `rustc_borrowck/type_check/mod.ts` | lazy-require memos (`var x__m ??= require(..)`, the perf-intern precedent) at the hot sites: `session_config()` per MIR body, `PASS_NAMES()`, the solver modules per `evaluate_obligation`, `wf.ts`, the polonius config |

Files touched outside the usual lane ownership: `src/std/{mut_ref,panic,str}.ts` and `src/vendor/anstream/stream.ts`,
because they were the hotspots. No `harness/`, `scripts/`, baselines, suites or generated files were touched, and no
contract or stub-count test numbers moved.

## For root: representation changes proposed (not done; each needs a recorded decision)
1. **Hash-consing without string keys.** This is the biggest remaining lever (≈14% of check-core-bin's main thread,
   ≈35% of the trait solver). Today each `intern_ty` / `intern_predicate` / `mk_args` / `intern_canonical_input` and
   each `DefaultCache` lookup with a composite key builds a string (`intern_key`: `Object.keys` plus sort plus
   concatenation), and the `Map` then has to flatten and hash that rope. The proposal is a structural hash (a number
   computed over the same fields, children by `id`) with buckets compared by `intern_key_eq`. The key text would stay
   the equality spec (intern_key.test.ts already checks `intern_key_eq` against it). The same applies to
   `DefaultCache` keys for the canonical type-op queries (`type_op_prove_predicate` and friends), whose key is also
   computed twice per miss (`lookup`, then `complete`).
2. **`GenericArg.kind()`** allocates a `{ $, _0 }` per call (≈0.9 s self in the solver alone). Options: a frozen
   per-object kind wrapper made at interning time, or `instanceof` dispatch at the hot call sites. Either changes how
   `GenericArgKind` values are produced.
3. **Span storage.** One `SpanData` object per distinct span (millions of them for core) could become typed-array
   columns (`lo`, `hi`, `ctxt`, `parent`), with `data()` building the object on demand or from a small cache.
   `intern_parts` already avoids the allocation on hits. This would also cut live heap and GC marking.
4. **GC load.** User time is ≈1.5× main-thread time on check-core-bin and mir-core. At the end of check-core-bin the
   live heap is 26.6M objects / 2.15 GB (`bun:jsc` `heapStats` after a full GC). During the run about 11M
   `JSLexicalEnvironment`s and 16M functions were allocated and died: closures from the `with_*(|x| ..)` /
   `probe(|..|)` idioms. A general reduction means a convention (for example hot `with_*` accessors returning the
   value, like `session_globals_get`), which is root's call.
5. **Measurement (harness).** Under load, user time on this host is unreliable (efficiency-core scheduling). A
   `harness/` change could record `instructions retired`, which `/usr/bin/time -l` prints on macOS, alongside user
   time for heavy runs. That needs its own reviewed batch, so it is only a suggestion here.

Not pursued, for lack of a measurable win or because the cost is a natural part of the algorithm: resolution's scope
walks and effective visibilities, `KeyedMap`'s double lookup, `rust_ts/deref.ts` forwarding (arity-specializing it
could change `arguments.length` for methods with rest parameters), `PlaceRef.iter_projections` slicing, and
`sorted_keys` caching.

## Notes
- Bun 1.4.3 `--heap-prof-md` crashes (trap) at exit on a 5 GB heap, so allocation-site data came from CPU profiles
  plus `positionTicks` and `heapStats`.
- Bun's CPU profiler charges GC pauses to the allocating frame. That is why `FieldMut` (26 s) and one iterator line
  in `validate.ts` (23 s) topped the mir profile. Both are fixed, but read self-time on allocation sites with that in
  mind.

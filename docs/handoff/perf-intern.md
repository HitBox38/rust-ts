# Handoff: perf-intern (performance of the runtime; no output change)

Branch `lane/perf-intern`, base `166acc73`. No ported logic changed, no new `unported(...)`, no new upstream markers.
`coverage.ts --check`: markers ok. `bunx tsc --noEmit -p .`: clean.

## Measurements before the changes
The machine was loaded the whole time (load average 45-110 on 12 cores, other lanes running). Absolute times are
inflated. Every comparison below runs base and lane **interleaved or at the same time** and compares user CPU seconds.
Profiles: `bun --cpu-prof` with `RUST_TS_JS_STACK` set (so the stack re-exec keeps the profiler). On a loaded host
the sample deltas have gaps (up to 2.6 s) that the profiler charges to whatever frame ran last, so a module frame
such as `(module) rustc_span/symbol.gen.ts` or `rustc_ast/attr/version.ts:62` can show 5-10% that is really
descheduling or module loading. Read these percentages as rough.

`projection-cache-rematch-impl-141124.rs#next` profiled with `#![recursion_limit = "48"]` (same code paths, ~1/3
of the work; the full case under the profiler did not finish in 10 min):
- `rust_ts/intern_key.ts` 27% inclusive: `push_key` + `intern_key` self 16%, `sort` 9%, `JSON.stringify` 2%.
  Callers: `reuse_or_mk_predicate` 10%, `intern_predicate` 5%, `intern_canonical_input` 4%, `slice_intern` 3%,
  `mk_external_constraints` 2%, `TyKind_eq` 2%.
- `require` 15% inclusive. These are the lazy init-order accessors (`structural_impls.ts` `predicate_kind_gen`,
  `generic_args`, `binder`, `opaque_ty_gen`, `ir_fold`, ...). Bun resolves on every call: about 1.1 us per call,
  against 2 ns for a cached binding.
- `newtype_index` `from_u32` 5% self: every call built its `assert!` message (a template string).
- The rest is spread out: `map` in folds, search-graph `NestedGoals`, hashbrown emulation (`u64_trailing_zeros`
  shifted a `bigint` bit by bit).

Typical cases are dominated by startup. `bun src/rust_ts/tydump.ts --version` costs 0.61 s user: loading about
1,685 modules (32 MB of TS) through Bun's transpiler cache. Without the cache it costs 1.05 s. The profiler cannot
split this cost, and nothing in `src/rust_ts` controls it (see "Not done").

## Changes
1. **`src/rust_ts/intern_key.ts`, the key builder. The key text is unchanged.**
   - The key is built by string concatenation instead of `push` + `join`.
   - Field names are sorted by insertion sort with `<`, not by `Object.keys(v).sort()`. Both use UTF-16 code-unit
     order, and field names are distinct, so stability does not matter.
   - A string goes through `JSON.stringify` only if JSON would escape one of its characters: `"`, `\`, below
     U+0020, or a surrogate. Otherwise the result is `'"' + s + '"'`, which is the same text.
   - `-0` is tested as `v === 0 && 1 / v < 0` and numbers become text with `"" + v` (same as `String(v)`).
   - Same order of checks as before (interned, array, `Map`/`Set` panic, object) and the same panic messages.
2. **`intern_key_eq(a, b)`**, also in `intern_key.ts`, is exactly `intern_key(a) === intern_key(b)`, including
   panics, but builds no keys. Why it is exact (module comment): when every field name is in `[A-Za-z0-9_$]`, the
   key text can be decoded in only one way. So two keys are equal exactly when the values are equal leaf by leaf:
   - numbers by `Object.is`, other primitives by `===`, interned objects by `"" + id`;
   - arrays element-wise;
   - objects by the set of own enumerable fields that are not `undefined`.

   The walk never stops at the first difference, so it always reaches every node. A rejected value
   (`Map`/`Set`/function/symbol) or an odd field name throws an internal sentinel. `intern_key_eq` then compares
   the real keys, which panic exactly as before.

   It is used at the hot equality sites that were literally `intern_key(a) === intern_key(b)` (or `!==`):
   - `context.ts` `reuse_or_mk_predicate`;
   - `structural_impls.ts` `TyKind_eq` and `T_eq` (`a === b || ...`, unchanged otherwise);
   - `interner.ts` `Result_eq` and `AmbiguityKind_eq`;
   - `search_graph.ts` `certainty_eq`;
   - `relate.ts` `eq_by_key`.

   The other ~45 `intern_key(a) === intern_key(b)` sites are cold and unchanged.
3. **164 lazy `require` accessors in 53 files are memoized.** The form
   `function f(): typeof import(P) { return require(P) as ...; }` becomes
   `return (f__m ??= require(P) as ...)` with `var f__m: ... | undefined;` and a one-line `// PORT (perf-intern)`
   note. Why this is safe:
   - It is `var`, not `let`, so an accessor called during module evaluation (an import cycle) sees `undefined`
     instead of hitting the TDZ.
   - Checked on Bun 1.4.3: `require` returns the module's live namespace object, the same object (`===`) on every
     call, even in the middle of a cycle. A cached namespace therefore sees exactly what a fresh `require` sees.
   - A `require` that throws caches nothing.

   This was a mechanical codemod: exact text match only, no generated (`// GENERATED`) file touched. The ~100 other
   `require` forms (inline destructuring, one-shot `provide`) were left alone. None of them shows in the profiles.
4. **`src/rustc_index/newtype_index.ts`**: the two `assert!` message strings are built once per index type instead
   of on every `from_u32` / `from_usize` / `from_u16` / `new` call. Same messages.
5. **`src/vendor/hashbrown/control/bitmask.ts`**: `u64_trailing_zeros` / `u64_leading_zeros` take a fast path for
   a value in 0..2^64. They split it into two 32-bit halves and use `Math.clz32` (of `lo & -lo` for trailing
   zeros). The old bit loops stay as the path for any other value. Both functions are now exported for their test.

What did not change: ported control flow, iteration order, FxHash order emulation (D6), what is interned and when,
and the equivalence classes of every key.

## Tests (why the changes keep behaviour)
- `src/rust_ts/intern_key_corpus.ts` keeps the first `intern_key` verbatim as `intern_key_reference`. Run as a
  script, it runs the tydump subject in-process with an observer on every `intern_key` call and checks three
  things:
  - the new key equals the reference key;
  - `intern_key_eq` equals key equality *at the time of the check*, against the first value seen under the same
    key and against the previous value;
  - in `--bench` mode, it also times both key functions.
- `src/rust_ts/intern_key.test.ts`:
  - **Generated values** (30k values and 30k pairs): every leaf kind, `-0`, `NaN`, `±Infinity`, bigints, holes,
    inherited fields, interned stand-ins, odd strings (quotes, controls, lone surrogates, `,` `:` `}`), odd field
    names, shuffled field order, `undefined` fields, near-equal copies, and rejected values. The test checks that
    keys and panics match the reference, and that `intern_key_eq` matches `ref(a) === ref(b)`, panics included. Each
    category is checked to occur thousands of times. Mutation check: breaking the quote fast path, or using `===`
    instead of `Object.is` in `eq_rec`, fails these tests.
  - **Explicit cases**: `0` vs `-0`, `NaN`, missing vs `undefined` fields, `[1]` vs `{0:1}`,
    `{"a:1,b":2}` vs `{a:1,b:2}` (equal keys: the fallback path), and a panic after an earlier difference.
  - **Real compilations** (subprocess runs of the corpus runner): `mini_core.rs` with tydump-minicore's argv, an
    old-solver crate against the oracle's std, and the 141124 source with `recursion_limit = 20` under
    `-Znext-solver`. Each asserts 0 key mismatches and 0 `intern_key_eq` mismatches, a minimum number of values,
    and the expected exit code.
- A larger corpus run (141124 with `recursion_limit = 48`) saw 1,308,081 keyed values and 7,577 distinct keys.
  It found 0 key mismatches and 0 `intern_key_eq` mismatches over 1,338,519 equal and 1,244,659 unequal checks.
  77,436 kept values had **changed after they were keyed**: values such as a `Vec` under construction are keyed
  and later mutated. So memoizing keys per object would be unsound; this lane does not do it.
- `src/vendor/hashbrown/control/bitmask.test.ts`: both bit counts equal the old loops on every single-bit, mask and
  edge value, and on 60k xorshift u64s.

## Results
Interleaved A/B, minimum user CPU seconds over 3 runs each (harness argv; output hash identical on every run):

| case | base | lane | speedup |
|---|---|---|---|
| startup (`tydump.ts --version`) | 0.61 | 0.61 | 1.00x |
| tydump-minicore `mini_core.rs` | 2.61 | 2.55 | 1.02x |
| tydump-ui `traits/cycle-type-trait.rs` | 1.18 | 1.12 | 1.05x |
| tydump-ui `traits/issue-22110.rs` | 1.17 | 1.19 | 0.98x (noise) |
| expanded `macros/colorful-write-macros.rs` | 0.92 | 0.89 | 1.03x |
| 141124#next, `recursion_limit = 48` | 9.69 | 6.85 | 1.41x |
| **141124#next (full), both run at the same time** | 49.1 user / 193.8 wall | 30.3 user / 117.3 wall | **1.62x** |

Profile of the r48 case after the changes: total samples 29.2 s → 17.2 s at comparable load. `require` is gone (0.0%).
Key work is now `key_of` + `sorted_keys` + `intern_key_eq` at about 18%, plus the interner `Map.get` on the key
string at about 5%. `from_u32` is gone.

Microbenchmark on 400k values captured from that run (key built and inserted into a `Map`, as the interners do):
862 → 709 ns per value. Building the key alone: 745 → 336 ns. Most of what is left is rope flattening and string
hashing inside `Map`.

**141124#next is still a TIMEOUT under the current load.** Base and lane both TIMEOUT in `difftest --filter` at
load ~80. The lane run got 15.4 s of CPU in the 60 s window (27% of a core) and needs ~30 s. On a quiet machine,
the base's 31.5 s wall should become about 19 s.

`bun test src` (`RUST_TS_REQUIRE_PROBES=1 --timeout=120000`): 5393 pass, 1 skip, **0 fail** (base: 5386 pass,
1 skip, 0 fail; the 7 extra tests are this lane's). Wall-time A/B with both run at the same time (load 73-90): base 2298 s wall / 975 s user, lane 2303 s / 983 s. There is **no measurable change**. The suite is dominated by subprocess startup and small cases, and the lane adds 7 tests, including three corpus compilations.
Lone runs are not comparable on this host: base 545 s at load 7-20, lane 1241 s at load ~40 and 1530 s at load
~100.

## Sample difftests (identical case by case to base `166acc73`)
The same sample of each suite (`RUST_TS_AGENT=perf-intern`) was run in a temporary detached worktree of the base
(since removed) and on the lane. The `<suite>.jsonl` records and the diff files were compared case by case.

| suite | cases | statuses (both) | record diffs | diff-file diffs |
|---|---|---|---|---|
| tydump-ui `--sample 400` | 400 | 316 MATCH, 82 UNPORTED, 2 UNSTABLE | 0 | 2 (see below) |
| tydump-minicore (all) | 46 | 45 MATCH, 1 UNPORTED | 0 | 0 |
| tydump-nocore `--sample 300 --seed m17` | 300 | 291 MATCH, 9 UNPORTED | 0 | 0 |
| hir-tree `--sample 300` | 300 | 299 MATCH, 1 UNPORTED | 0 | 0 |
| expanded `--sample 300` | 300 | 299 MATCH, 1 UNPORTED | 0 | 0 |
| resdump `--sample 300` | 300 | 299 MATCH, 1 UNPORTED | 0 | 0 |
| tydump-ui `--filter 141124.rs#next` | 1 | TIMEOUT (both, load ~80) | 0 | 1 (truncated output) |

The 2 tydump-ui diff files that differ are the UNSTABLE ICE cases (`projection-cache-rematch-impl-122529.rs#old`,
`old-solver-caching-bug-151069.rs#old`). They are identical once two things are stripped: the oracle's thread id,
and the port's JS stack frames (worktree path and line numbers of edited files).

## For root
- `docs/next.md` claim: none (root-assigned lane).
- The 141124#next TIMEOUT is now ~1.6x further from the limit, but still exceeds 60 s whenever load is above
  ~40. The suite timeout stays a harness decision.
- Not done, and possible next steps:
  - **Startup** (0.61 s of every small case) is module loading. Options are a pre-bundled entry, or lazy loading of
    crates that most suites never reach. Both change the harness/entry setup or module init order, so they need
    root.
  - **Interning without string keys.** A structural hash plus `intern_key_eq` was prototyped and measured no
    faster than the string key on the captured corpus (eq walks both values), so it was dropped.
  - **hashbrown / FxHasher on `bigint`** (`lanes_to_u64`, `add_to_hash`): ~2-3%. A two-number u64 would be a
    rewrite of vendor code.

verdict: CHANGES_REQUESTED

Reviewer: independent read-only review of `lane/perf-core-a` (`git diff main...lane/perf-core-a`, head `23ffb4ae`).

## Summary

I checked every `// PORT: (perf)` change against the code it replaces and against upstream. All of them except one
give the same results, the same panic texts, the same iteration order and the same side effects. That one is the
`visit_List` cache (finding 1). It does not change output, but it adds heap growth with no bound to a lane whose only
job is to cut constant factors. Its fix is small.

What I verified as equivalent:
- **`intern_key_eq`** (`src/rust_ts/intern_key.ts`):
  - `id === id` matches `"" + id === "" + id`, because `Interned.id` and `List.id` are always numbers from
    `next_intern_id()`. It also gives the same answer when `id` is `undefined`.
  - In the same-names fast path, `ka` equals `kb` element by element, so the old `includes` lookups always hit. The
    four cases (both undefined, a only, b only, both defined) do the same `walk`/`eq` updates as the two old loops.
    `check_name` runs on the same names. Only the order of visits changes, and nothing but `FALLBACK` can be thrown,
    so the result is the same.
- **`filter_specialized_impls`**: `intern_key_eq` replaces `intern_key(a) === intern_key(b)`. The only difference is
  that the test-only observer hook no longer fires.
- **Query caches and calls**:
  - `DefaultCache` stores `[V, idx, K]` and returns it as the `CacheEntry`. Every caller (`calls.ts`,
    `execution.ts:181,252`) only reads `[0]` and `[1]`, and nothing mutates the entry or reads its length.
  - `for_each` destructures in the new order.
  - `VecCache` now fills with explicit `undefined`s instead of holes. That is the same for `lookup`, for the
    `present` count and for `for_each` (its `forEach` filters `undefined`).
  - `query_get_at` and `query_ensure_ok` are `try_get_cached` inlined: the same `read_index`, then the value.
  - `TyCtxt.$q` runs the body of `TyCtxtAt.$q` with `DUMMY_SP` (`TyCtxt_at` only builds `new TyCtxtAt`).
  - Nothing assigns to `query_vtables`, so the vtable memo cannot go stale.
- **Spans**:
  - `interned_data` is `Interned(i).data()`, including the index-0 shortcut.
  - `session_globals_get` has the same check and panic text as `SESSION_GLOBALS.with`.
  - `inline_ctxt` always returned `Err`, so the simplified `ctxt` and `eq_ctxt` are exact.
  - `intern_parts` uses the same equality as `SpanData_eq`, the same hash (`|0` keeps the masked bits) and the same
    append order, so span indices are unchanged.
  - The stored-hash filter can have no false negatives (the int32 round-trip is exact).
  - `grow` rehashes from the stored hashes.
- **AST and MIR visitors**:
  - The `visit_id`/`visit_span` shortcuts are taken only when the method is the prototype's no-op.
  - In MIR `super_source_info` they also require `super_span`/`super_source_scope` to be the default (empty) methods.
  - Building a `field_mut` view has no side effects.
  - The early return in `visit_ident` only skips work that would end in that same no-op.
- **`try_visit`**: the unit fast path takes the same `Continue` path as `VisitorResult_unit.branch`.
- **`std` helpers**:
  - `FieldMut` has the same get/set behaviour. Nothing inspects the view's own properties (`hasOwnProperty` or
    `in` on `"value"`).
  - `assert_eq` keeps the same default comparison.
  - `Str.find` and `Str.lines` make the same bounded scans.
  - `splitn` keeps the same `next()` protocol for both callers.
- **`validate.ts`**: the indexed loop consumes exactly as the iterator did (upstream `while let Some(proj) = iter.next()`).
- **`MirPhase_cmp`**: same comparison.
- **Lazy-require memos**: same modules, required in the same order the first time.
- **`VecU8.write_fmt`**:
  - `Vec<u8>::write_all` cannot fail, so the result is always `Ok`.
  - `encodeInto` gives the same bytes as `TextEncoder.encode`, including U+FFFD for lone surrogates.
  - `reserve(3n)` always leaves room for the tail of the string.
- **Combined lint passes**: no `LateLintPass_provided` or `EarlyLintPass_provided` method has a default or rest
  parameter, so `provided.length` is the arity in every case. Arity 7 (`check_fn`) takes the rest branch, and
  `field_list` follows `names` order.

Checks run:
- No changes under `harness/`, `scripts/`, `harness/baseline` or `tools/`.
- `bunx tsc --noEmit -p .` is clean.
- `bun test` on `intern_key.test.ts`, `stream.test.ts`, `src/rustc_span` and `src/rustc_lint`: 226 tests, 0 fail.
- `difftest --suite mir --filter trait-object`: 111/111 MATCH.
- `difftest --suite expanded --filter dyn`: 300/300 MATCH.
- I read the summary files of the handoff's runs (`*-root-f5de-{l2a3,jyh6,txw1,3mar,qofo}`). They match what the
  handoff claims: mir 297/1 UNPORTED/2 UNSTABLE, expanded 300/300, tydump-ui 298/2 UNSTABLE, mir-minicore 46/46,
  mir-core 47,734/47,734. I found no lost MATCH.

## Findings

1. **`src/rustc_middle/ty/generic_args.ts:752-762` (`VISIT_LIST_CACHE` in `visit_List`). Severity: blocking.**
   - **What is wrong:** the cache is a strong `Map` keyed by the identity of the element descriptor. Its comment says
     the cache is built "once per element descriptor", but that is false for callers that build a new descriptor on
     every call.
   - **Where the fresh descriptors come from:** `structural_impls.ts:1001` `list_fold(..).visit_with` calls
     `generic_args().visit_List(d_T())`. For three of the six `list_fold` instances, `d_T` is a factory that returns
     a new object on every call:
     - `fold_PolyExistentialPredicate` (via `binder().fold_Binder({..})`) for `BoundExistentialPredicates`, so every
       `dyn Trait` visit;
     - `fold_OpaqueTypeKey_Ty` (via `fold_tuple2(..)`) for `PredefinedOpaques`;
     - `fold_ArgOutlivesClause` (an object literal) for `RegionAssumptions`.
   - **Effect:** every `visit_with` on one of those lists adds a permanent entry to the module-level map. The entry
     holds the fresh descriptor, its closures, and the new list descriptor with its closure.
   - **Reproduced:** I imported the branch and called `visit_with` 1000 times on each of `fold_BoundExistentialPredicates`,
     `fold_PredefinedOpaques`, `fold_RegionAssumptions` and `fold_PlaceElems`. That added 3001 entries to
     `VISIT_LIST_CACHE`: three per iteration, one for the first `PlaceElems` call.
   - **Why it blocks:** the growth has no bound for the process's lifetime. It contradicts the handoff's statement
     that "no change here should grow the heap measurably". The handoff's mir-core max RSS (8.6–9.5 GB → 9.7–10.0 GB)
     fits it, though it does not prove it.
   - **Fix:** do not grow a map keyed on descriptor identity on a hot path. For example, drop the generic map and keep
     only the two hoisted descriptors, `visit_List_GenericArg` and `visit_List_Ty`, which give the measured win.
     Alternatively, key a `WeakMap` (still one allocation per call for those three), or hoist the three `d_T`
     descriptors in `structural_impls.ts`. That file is outside this lane's set and would need root's say.
   - **Output:** not affected. The cached descriptor behaves the same as a fresh one (its closure captures `d_T`, and
     nothing mutates or compares it).

2. **`src/rustc_middle/query/query_api.ts:202` (vtable memo `last_query_system` / `last_vtable`). Severity: non-blocking.**
   - The memo is exact. No code writes to `query_vtables`, and a different `query_system` triggers a new lookup.
   - **Side effect:** each of the roughly 300 per-query closures keeps a strong reference to the last `QuerySystem`
     it saw, which includes every query cache. In a process that runs several compilations (unit tests, batched
     workers), a finished compilation's caches stay reachable. This lasts until each query name is called again with
     a new tcx; names the next compilation never calls keep the old one forever.
   - **Suggested fix:** a `WeakRef`, or memoizing on `query_vtables`. Alternatively, record that only one compilation
     runs per process.

3. **`src/rustc_lint/passes.ts:241` (`combined_method`). Severity: non-blocking.**
   - Today this is correct: I checked every `*_provided` signature, and none has a default or rest parameter.
   - **Risk:** it depends on `provided.length` being the true arity. If a provided method later gains a default
     parameter (`= ..`), the combined method would silently drop trailing arguments and nothing would fail.
   - **Suggested fix:** a unit test that checks each `provided.length` against the expected parameter count, or an
     assertion at installation time.

4. **`docs/handoff/perf-core-a.md`. Severity: non-blocking.**
   - The handoff says there are 40 `// PORT: (perf)` notes; the diff adds 42 lines containing `PORT: (perf)`. The
     extra two are doc-comment variants, so this is cosmetic.
   - The handoff says the new helpers have no markers. That is true and acceptable, since they are local helpers:
     `interned_data`, `intern_parts`, `session_globals_get`, `combined_method`, `make_visit_List`, `push_str`,
     `FieldMut`, `MirPhase_variant` and `MirPhase_inner`. The existing `// rustc:` markers stay on the upstream
     functions; `make_visit_List` keeps the `generic_args.rs:716 visit_with` marker.

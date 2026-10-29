# Handoff: perf-stalled-goals

Lane goal: get `tests/ui/try-trait/deep-try-chain-issue-153583.rs` (protected `mir` set) back under the 60 s limit by
cutting constant factors only. Branch `lane/perf-stalled-goals`, based on main `5a542fbf`.

**Result: about 2.6x fewer instructions, about 1.8x less time. That is under 60 s, but the ~30 s target was not
reached.** At low load (load average ~2-3) the case takes ~37 s user; at load ~6 it takes 47 s, against 78.5 s for
the base measured right before it.

## What the case does

- 1,154 `?` give 48,439 `try_evaluate_obligations` calls with up to 26,493 pending obligations: **456.6M**
  `goal_remains_stalled` checks, with 654M stalled-var probes, 235M sub-root probes and 323M opaque-storage checks.
  Only 43,792 entries are actually re-evaluated.
- Upstream does the same quadratic work. The oracle's time grows 4x per doubling (288 `?`: 0.12 s, 577: 0.44 s,
  1154: 1.66 s, 2308: 6.51 s) and it retires 44.9G instructions at n=1154, which is at most ~98 per check. I found no
  divergence: the port does not re-check more goals or record more stalled vars than upstream (1-2 vars per goal).

## Changes (each carries a `// PORT: (perf)` note)

1. `rustc_next_trait_solver/solve/eval_ctxt/fast_path.ts` `inlined_rerunning_stalled_goal_may_make_progress`: the two
   `iter().any(..)` closures became plain `for` loops (one closure allocation per call before), and `delegate.deref()`
   is read once.
2. `rustc_trait_selection/solve/fulfill.ts` `try_evaluate_obligations`:
   - `retain_mut` works in place: no new array per pass.
   - It keeps `Vec::retain_mut`'s unwind behaviour (backshift guard in `finally`): if the closure throws, the
     unprocessed entries, starting with the current one, stay after the kept ones.
   - The `any_changed = true` closure is made once per pass instead of once per entry.
   - The closure's first statement, the still-stalled check, now runs in the loop. The common case no longer calls
     `retain_pending`, which is now the rest of the closure, in the same order.
3. `rustc_infer/infer/type_variable.ts`: two new direct read-only probes on `TypeVariableStorage`:
   - `try_probe_eq_relations_value(vid)` and `is_sub_unification_table_root(vid)`;
   - they do the same reads as ena's `value` + `try_probe_value`: index the `VarValue`s, and the var is a root iff
     `parent.vid == vid`;
   - they keep the exact `index out of bounds: the len is .. but the index is ..` panic;
   - they skip the `TyVidEqKey`/`TyVidSubKey` wrappers, the `Some` wrapper and the generic `UnifyKey` dictionary calls,
     which Rust monomorphises away.
   - `InferCtxtInner::try_type_variables_probe_ref` (`infer/mod.ts`) and `is_sub_unification_table_root_var`
     (`infer/context.ts`) use them.
4. `rustc_infer/infer/context.ts` `opaque_types_storage_num_entries`: reads `inner.opaque_type_storage.num_entries()`
   directly instead of building an `OpaqueTypeTable` view, whose `Deref` is that same storage, on every call.
5. Removed the now-unused `TyVidEqKey_from` / `TyVidSubKey_from` imports.

There are no `unported(...)` calls and no changes to vendor/ena, harness, scripts, suites or baselines.

## Numbers

From `/usr/bin/time -l`, the same command as the lane brief. Instructions retired are stable under load; user time is
not, because loaded runs land on E-cores and share caches.

| | instructions | cycles | user | max RSS |
|---|---|---|---|---|
| base 5a542fbf (back-to-back, load ~6) | 860G | 333G | 78.5 s | 1.26 GB |
| lane (back-to-back, load ~6) | 327G | 202G | 47.4 s | 0.98 GB |
| lane, low load (~2-3) | 323G-363G | 162G-171G | 37.2-39.5 s | ~1.0 GB |

Root's quiet number for the base was 68.2 s.

Output is byte-identical to the base (stdout and stderr), and
`bun scripts/difftest.ts --suite mir --filter deep-try-chain-issue-153583 --jobs 1`: **MATCH** (run `pstall-after-dtc`).

Sample runs with `RUST_TS_AGENT=root-f5de`, before (detached base worktree at 5a542fbf) and after:

| suite | before | after |
|---|---|---|
| mir --sample 300 | 297 MATCH, 1 UNPORTED, 2 UNSTABLE | 297 MATCH, 1 UNPORTED, 2 UNSTABLE |
| tydump-ui --sample 300 | 298 MATCH, 2 UNSTABLE | 298 MATCH, 2 UNSTABLE |
| borrowck-ui --sample 300 | 300 MATCH | 300 MATCH |
| mir-minicore (full) | 46 MATCH | 46 MATCH |

Run ids: `pstall-before-<suite>` and `pstall-after-<suite>` under `$RUST_TS_DATA/runs`.

Spot check `tests/ui/consts/const-eval/infinite_loop.rs`: base 22.1 / 21.9 s real (486G instructions), lane 22.0 /
22.3 s (488G). No change, and identical output.

Checks:
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok.
- `bun test src/vendor/ena src/rustc_infer src/rustc_trait_selection src/rustc_next_trait_solver`: 369 pass, 0 fail.
- Coverage of the touched files, unchanged: context.rs 66/66, mod.rs 123/123, type_variable.rs 37/37,
  fast_path.rs 4/4, fulfill.rs 18/18.

## Why it stops at ~37 s: the check is now memory-bound

- Each check still costs ~350 cycles in situ.
- A standalone copy of the same loop, with the same sizes (26k pending, 42,620 type vars), costs:
  - 16.8 ns per check when its objects are allocated compactly (IPC ~6);
  - ~31 ns per check with a scattered heap.
- In the real ~1 GB heap, each check walks about 13-15 separate objects or cache lines; Rust touches about 5. The
  objects are:
  - the entry tuple's cell and butterfly;
  - `stalled_on` and its `opaques`;
  - the `stalled_vars` cell, butterfly and element objects;
  - per var: the table slot, the `VarValue`, its `parent` key object and its `value` object;
  - the same for sub-roots.
- A fully hand-inlined, allocation-free check (an experiment, never committed) saves another 20% of instructions but
  no cycles under load.
- Sharing the `Unknown` value objects, entries as objects instead of tuples, and a shared empty `sub_roots` gave
  about 5% together in the benchmark, and nothing measurable in situ. I did not keep them.
- GC is not the cause: the GC count grows linearly with N (10 / 21 / 59 GCs for 288 / 577 / 1154 `?`), so the loop
  does not allocate.
- The hot functions reach FTL with no OSR exits (checked with `BUN_JSC_reportCompileTimes` and `printEachOSRExit`).

## For root to decide

- The case now fits 60 s with margin on a quiet or moderately loaded machine. Under full gate load (12 jobs) it may
  still be tight. Options:
  - run it in the heavy (serial) class from harness-m5a. This changes harness or suite data, so it is a root or
    reviewed-batch call;
  - accept the current margin.
- Getting much further needs a representation change, not constant factors: for example ena `VarValue` storage as
  parallel arrays (parent index / rank / value) instead of objects with key objects. That is a redesign of the vendor
  crate's storage and needs a recorded decision.

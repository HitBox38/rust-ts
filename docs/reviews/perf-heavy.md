# Independent review: perf-heavy

Branch `t3/perf-heavy`, head `c6031afb`, base `main` `26e61959`. Line numbers are at `c6031afb`. Read-only: the planted writes below were in a
scratch worktree, reverted, and none is committed. Host: the root Mac, AC power throughout, load 1-3 when idle.

## Verdict: APPROVE WITH NITS

**`90fad7d0` (`share_elements`): approve.** I found no way to observe the sharing, and no output moved anywhere I looked.

**`0d4092c4` (unfrozen lists): DROP as it stands; re-land it unchanged once a gate step runs with `RUST_TS_FREEZE_LISTS=1`.** The
panicking mutators are good and should stay whatever root decides. But with this commit the gate's difftests no longer catch a write to an
interned list. A planted write made 9 of 10 `mir` cases CRASH with lists frozen and left all 10 MATCH without the freeze (F1). The
protected set gains nothing from the commit today: hello is unchanged, and every case it speeds up is unprotected (`mir-heavy`, which reports
only, and the three TAIT cases, which I advise against protecting, F5). The commit meets two of the perf-near-limit review's four conditions
(mutators throw everywhere; the alias checker skips lists by class) and the alias-sweep half of a third. Still missing: the sampled frozen
gate step and the check for casts. The first is cheap and is root's (`scripts/`). With it, I would say KEEP.

**The three TAIT cases are not safe to protect yet** (F5). At gate-like load all three time out in the pool every time. They pass only on
difftest's alone retry, at 46.0-46.7 s against a 60 s limit.

## 1. `90fad7d0`: equal list elements shared

Read `sharded.ts:155-233`, the `context.ts` hunks, and every producer and consumer of the two tables:

- **Producers.** `canonical_var_kinds`: `rustc_next_trait_solver/canonical/canonicalizer.ts:330` (`finalize`) and
  `rustc_infer/infer/canonical/canonicalizer.ts:597`. `predefined_opaques_in_body`: `rustc_next_trait_solver/canonical/mod.ts:114`, from
  `clone_opaque_types_lookup_table` (`rustc_infer/infer/context.ts:316`), which builds a fresh `[k, h.ty]` tuple per entry, plus the folder
  `structural_impls.ts:1040` and `probe.ts:285`.
- **Nothing writes into an element after interning.** I searched for field writes to `universe`, `ui`, `sub_root`, `bound`, `var`, `kind`, `_0`
  in the solver and the canonicalizers, and for `.args =` / `.def_id =` on opaque keys. The only array writes are to the canonicalizer's own
  `var_kinds` slots (`canonicalizer.ts:314`, which replaces the slot with `CanonicalVarKind.with_updated_universe(...)`). The `with_updated_universe`
  helpers (`rustc_type_ir/binder.ts:1141`, `:1198`) build new objects. The cached `var_kinds` copy at `canonicalizer.ts:174` copies the array, not the
  elements. *Read, not reproduced.*
- **No identity keys.** The opaque storage is a `KeyedMap` on `intern_key` (`rustc_infer/infer/opaque_types/table.ts:91`), keyed by value. There is
  no `Map`, `Set` or `WeakMap` keyed on a `CanonicalVarKind`, an `OpaqueTypeKey` or a tuple outside a keyed map. Upstream compares these `Copy`
  values with `==`, so where sharing changes anything it moves the port toward upstream. *Read.*
- **Ids and order.** `shared_elements` never calls `next_intern_id`. The list's bucket hash is still computed from the caller's elements,
  through the same `hash_mix` sequence. Hits are untouched, and `make` is called at the same points. First-interning order and ids cannot
  move. `rmeta-core` (82,338 cases, below) agrees. *Read and reproduced.*
- **Interned elements** are skipped by the `INTERNED` brand, which is on `Interned.prototype` (`intern.ts:87`) and `RawList.prototype`
  (`list.ts:163`) at run time, not only declared. *Read.*
- **Handoff point (d), `elem_hashes`:** filled and read inside one `intern_slice` call. Between the two run only `hashed.get`, `slice_eq`
  (`value_eq`, pure) and the collided bucket scan. Nothing can re-enter. `Int32Array` truncates `value_hash` to int32, but the write and the
  read go through the same array, so the keys agree. A truncation collision would only cost a bucket scan, never a wrong substitution,
  because `value_eq` decides. *Read.*
- **Handoff point (c), `Array.from(v)` on a `RawList`:** `Array.from` called on `Array` builds a plain array, and `of_slice` copies it. Tables that do not
  share pass `v` itself to `make`, as before. *Read.*
- **Alias checker:** it skips `RawList`s (`alias_check.ts:141`) and does not walk into list elements. The sweep below found 0 hits. *Reproduced.*
- **PORT(perf):** this is not memoisation with a packed key. Equality is the full `value_eq` the tables already rely on for hits, so there is
  no injectivity question. It is aliasing of immutable values, not a change of representation, so I don't think it needs a decision of its own.
  The unit tests cover the boundaries that matter: unequal values with equal fields in a different order, `-0`, `undefined` against a missing field,
  and the caller's array left unwritten.

I could not construct a failing program. Every route I found to observing the sharing needs a write to an element, and I found none.

## 2. `0d4092c4`: unfrozen lists outside tests

### What protection is lost (reproduced)

A scratch probe made a `RawList` and tried 19 kinds of write. Under `bun test` (frozen) all 19 throw. Under plain `bun` (production):

| write | production |
|---|---|
| `l.push`, `l.sort`, `l.reverse` (all 9 `LIST_MUTATORS`) | panic, as designed |
| assigning an own `l.push = ...` | throws: the prototype property is non-writable |
| `l.id = 1` | throws (`defineProperty` default) |
| `l[0] = x`, `l[2] = x`, `l.length = 0`, `l.length = 5`, `delete l[0]` | **silent** |
| `Object.defineProperty(l, 0, ...)`, `Object.assign(l, [x])`, `Reflect.set(l, 0, x)` | **silent** |
| `Array.prototype.push/sort/splice/fill.call(l, ...)` | **silent**: the panic sits on `RawList.prototype`, and `.call` bypasses it |
| `l.extra = 1`, `Object.setPrototypeOf(l, Array.prototype)` (then `push` works) | **silent** |

The handoff names index and `length` writes as the gap. The `Array.prototype.<m>.call` route, `delete`, `Object.assign`, `defineProperty` and
`setPrototypeOf` are also open. None of them occurs in the tree today: I searched for `.length =` on lists, `Array.prototype.<mutator>.call/apply`,
`Reflect.set`, `Object.assign` onto list-named values, and casts of a list to a writable array. The only cast is `of_slice`'s own fill
(`list.ts:62`). I also looked at every `catch` in `src/` that does not rethrow, because a swallowed `TypeError` from a frozen write would behave
differently once unfrozen. All of them wrap file system calls.

### F1 (`list.ts:40-41`): the gate's difftests stop catching list writes. Reproduced.

I planted one benign write in `TyCtxt.slice_intern` (`context.ts:1957`): `(r as T[])[0] = r[0]!` after interning, which writes the value the
slot already holds.

- `bun test src/rustc_middle/ty/interning.test.ts`: **5 of 18 fail.** Unit tests do catch it, as the handoff says.
- `difftest --suite mir --sample 10`, unfrozen (production): **10/10 MATCH**.
- The same with `RUST_TS_FREEZE_LISTS=1`: **9 CRASH, 1 MATCH.**

So the 180k-case gate that root relies on no longer sees this class of bug. A write that changes a value would usually show up as a DIFF
somewhere. But the interner compares against the stored list, so after such a write a lookup can make a duplicate, and `===` then fails far
from the cause (perf-near-limit review). That is a harder bisect than an ICE at the write. The unit tests and the alias sweep do catch it, but
only on the paths they run, which is a small slice of the gate's 180k cases.

**Fix (root, `scripts/`):** a gate step that runs a deterministic sample of `mir`, `mir-o2` and `check-ui` with `RUST_TS_FREEZE_LISTS=1`. Frozen
runs cost about 22% more instructions on the heavy next-solver cases and nothing on hello. Exclude near-limit cases from that step, or it will
time out on them (F5).

### F2 (`list.ts:41`): `bun test` freezes only when `NODE_ENV` was unset. Reproduced; minor.

`bun test` sets `NODE_ENV=test` only if it is unset. With `NODE_ENV=production` or `development` in the caller's environment, lists are not
frozen under `bun test` (scratch test: `frozen=false` for both). The tripwire is `interning.test.ts:260`
(`expect(Object.isFrozen(l)).toBe(true)`), which then fails, and the gate's unit step fails with it. So this cannot pass unnoticed at the gate.
Worth a line in the `FREEZE_LISTS` comment.

### F3 (`list.ts:41`, `scripts/lib/env.ts:41-71`): the harness passes `NODE_ENV` and `RUST_TS_FREEZE_LISTS` through to the subject. Read; minor.

Neither variable is scrubbed (`RUST_TS_*` is kept on purpose). A gate started from a shell that exports either variable runs every subject
frozen. Output does not change, because a correct program never writes to a list. But it runs slower, and if the TAIT cases were protected
they would turn into false losses: frozen, `recursive-drop-elaboration.rs` takes 62.3 s alone, against the limit of 60. `gate.json` could record
both variables, or the gate could refuse to start when either is set.

Not a problem (checked): **a `.env` in the cwd** cannot flip the switch for `main.ts`. `FREEZE_LISTS` is read when `list.ts` is evaluated, but
`main.ts` imports the compiler dynamically after `ensure_stack()` has removed what dotenv loaded (`main.ts:27-30`). A bare script that imports
`list.ts` does see a cwd `.env` (scratch test: `frozen true`). **A `bun build --compile` bundle** hard-codes `process.env.NODE_ENV` as
`"development"` (scratch test), so `NODE_ENV=test` never freezes a bundle. No harness path builds one today.

### What the commit does buy (reproduced)

- Head with `RUST_TS_FREEZE_LISTS=1` is `90fad7d0` alone in effect, since the panicking mutators cost nothing. That way,
  `recursive-drop-elaboration.rs` takes **62.3 s, 1,326 G, 6,717 MB** alone, against **46.2 s, 1,021 G, 4,020 MB** unfrozen. The three TAIT
  cases need both commits to finish under 60 s.
- On `rl48` and the full case (§5) the two commits together are what bring them under their limits.
- Hello: no change (§3).

### Alias checker (reproduced)

`sweep.ts` sets `RUST_TS_ALIAS_OUT` for driver and `dump` runs (`sweep.ts:215`), and lists are frozen there: I checked `Object.isFrozen` with the
variable set, including set to the empty string, where `!== undefined` holds. Sweep on head: `--tests tests/ui --passing --sample 100
--modes o0,o2,o4,mono,dump --jobs 4` (`RUST_TS_AGENT=review-perf-heavy`): 500 runs, 198,085 walks, **distinct hits 0**. `o0`, `o2`, `o4`
and `dump` are 400/400 MATCH; `mono` gives 95 CHECKED and 5 FAILED. The 5 are programs the oracle rejects too (exit 1 in `o0`, port equal).
I did not run the `tests/mir-opt` sweep (about 45 min at 4 jobs).

## 3. Results unchanged (reproduced)

HEAD `c6031afb`, `RUST_TS_AGENT=review-perf-heavy` (a different sample from the lane's), default jobs:

| suite | sample | result |
|---|---|---|
| `mir` | 200 | 200 MATCH |
| `mir-o2` | 200 | 200 MATCH |
| `check-ui` | 200 | 200 MATCH |
| `mono-ui` | 200 | 200 MATCH |
| `expanded` | 200 | 200 MATCH |
| `tydump-ui` | 200 | 200 MATCH |
| `rmeta-ui` | 200 | 200 MATCH |
| `run-pass-miri` | 200 | 200 MATCH |
| `rmeta-core` | full, alone | **82,338 / 82,338 MATCH**, as at gate `gate-20261106-224720-root-i68w` |
| `mir` `type-alias-impl-trait/` | 345, default jobs | the three TAIT cases MATCH on the alone retry (F5) |

**Hello** (`fn main` with `println!`, std, `--emit=metadata`, x86_64 target): 5 alternating runs from scratch worktrees at paths of equal
length. `main` 10.83, 10.62, 10.62, 10.60, 10.60 G; head 10.78, 10.62, 10.59, 10.61, 10.62 G. RSS is 349-353 MB on both, and the output is the
same (the empty `.rmeta` of a bin crate). **No change.**

## 4. The three TAIT cases

### F5: not safe to protect yet. Reproduced.

| measurement | `recursive-drop-elaboration.rs` | `-2.rs` | `error-tainting-issue-122904.rs` |
|---|---|---|---|
| alone, load 1.2-1.6, 3 runs, wall s | 46.41, 46.72, 46.18 | 46.01, 45.99, 45.99 | 46.02, 46.00, 46.01 |
| alone, Ginstr / RSS MB | 1,019-1,023 / 4,002-4,025 | 1,019-1,022 / 3,966-4,012 | 1,018-1,022 / 4,012-4,024 |
| alone, while a `mir` pool ran (load 9 at start) | — | **55.99 s** | — |
| `difftest --suite mir --filter type-alias-impl-trait/` at default jobs (load up to 25) | pool TIMEOUT 60 s, alone 46.2 s, MATCH | pool TIMEOUT 60 s, alone 46.4 s, MATCH | pool TIMEOUT 60 s, alone 46.5 s, MATCH |
| last gate (`main`), for comparison | pool TIMEOUT, alone TIMEOUT (10.1 GB) | same | same |

Output was identical on every run (one hash per case) and equal to the oracle's; I checked `error-tainting` against the oracle directly.

So at the gate these cases always time out in the pool and pass only on the alone retry, at 77% of the limit. The retry cap is not the risk:
the last gate retried 4 `mir` cases against a cap of 50. The risk is the alone run losing 13 s:

- a run under load, which the gate's power check does not cover: 56 s at load 9 here;
- a 30% next-solver slowdown in some later wave (this lane alone moved them 27%);
- the freeze being on (F3): 62 s.

A loss in a protected case is a STOP. **Advice: keep them out of the protected set,** by an exclusion list or by moving them to `mir-heavy`,
until they run alone in under about 30 s.

## 5. The reported figures

**Reduced input, `recursion_limit = "48"`** (the test file with `#![recursion_limit = "48"]` inserted after its feature attributes), alone,
same argv as `mir-heavy`:

| side | wall s | user s | sys s | max RSS MB | footprint MB | Ginstr | stdout+stderr |
|---|---|---|---|---|---|---|---|
| oracle | 8.86 | 8.57 | 0.16 | 1,772 | 1,707 | 144.5 | `9121df1a362e` |
| `main` `26e61959` | 146.59 | 140.28 | 58.77 | 13,904 | 24,716 | 2,532.2 | same |
| head `c6031afb` | **83.92** | 88.07 | 2.61 | **5,396** | 3,422 | **1,820.5** | same |

This agrees with the handoff (after: 94.4 s, 1,828.9 G, 5,368 MB). My "before" used more memory than the handoff's (13.9 GB RSS and a 24.7 GB
footprint, against 10.05 GB), so `main` swapped harder here, which shows as 58.8 s of system time. The instruction drop is 28%.

**The full case** (`closures/supertrait-hint-cycle.rs`, the `mir-heavy` argv, alone, AC power, load 2-7 from my own idle session):

| side | wall s | user s | sys s | max RSS MB | footprint MB | Ginstr | stdout+stderr+exit |
|---|---|---|---|---|---|---|---|
| oracle | 60.0 | — | — | 11,631 | — | 937.3 | `1f6c54c17a` |
| head `c6031afb` | **959.3** | 871.2 | 563.7 | 14,512 | 24,128 | 13,565 | **equal to the oracle's** |

The output is byte-identical, the same as the handoff reports. My wall time is lower than its 1,250 s, which it measured with load 14-33 for the last
part of the run. The case is still memory-bound: 564 s of system time, and a 24 GB footprint on a 24 GB host. It fits `mir-heavy`'s 1,800 s limit
with room. I did not run `main` on the full case: the handoff's timeout at 1,800 s fits my `rl48` "before" figures.

## 6. Findings, one line each

- **F1** `src/rustc_middle/ty/list.ts:40-41`: with `0d4092c4` the gate's difftests run unfrozen. A planted list write gave 10/10 MATCH unfrozen
  against 9/10 CRASH frozen. Reproduced. Fix: a frozen sampled gate step (root, `scripts/`).
- **F2** `src/rustc_middle/ty/list.ts:41`: `bun test` does not freeze when `NODE_ENV` is preset. The tripwire `interning.test.ts:260` then fails, so the
  gate notices. Reproduced. Nit.
- **F3** `src/rustc_middle/ty/list.ts:41` / `scripts/lib/env.ts`: `NODE_ENV` and `RUST_TS_FREEZE_LISTS` reach the subject at the gate. Frozen runs are
  slower but give the same output, and would turn near-limit protected cases into false losses. Read. Nit.
- **F4** `src/rustc_middle/ty/list.ts:44`: `LIST_MUTATORS` does not stop `Array.prototype.<m>.call(list, ...)`, `delete`, `Object.assign`,
  `defineProperty` or `setPrototypeOf` on an unfrozen list, beyond the index and `length` writes the handoff names. Reproduced. None is in the
  tree today. Say so in the comment.
- **F5** the three TAIT cases: pool TIMEOUT every time at gate-like load, MATCH only on the alone retry at 46 s of 60. Reproduced. Do not
  protect them yet.
- **`90fad7d0`:** no finding.

## 7. Not checked

- The `tests/mir-opt` alias sweep, and modes `dbg`, `abort`, `inl`, `miropt` and `all`.
- Full suites other than `rmeta-core`. `check-core` was not run.
- Windows.
- A heap census of my own. I relied on the handoff's for the causes, and reproduced only the end-to-end figures.
- Any `value_eq`/`value_hash` property beyond what `90fad7d0` relies on (the perf-near-limit review covered them).
- A value-changing planted write: I planted only a write of the slot's own value. A value-changing write's gate-level effect is argued, not shown.

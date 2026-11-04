# Independent review: miri-perf (plan-m6 D11)

Branch `t3/profile-miri-performance`, head `994a7e56`, reviewed against merge base `c9d3c553`. Tested on a private merge with
`integ-w38` (`223c634a`), `e5c5e7d7`, which was never pushed. Line numbers are at `994a7e56`.

## Verdict: REQUEST CHANGES

Two memo keys are wrong, and each changes a program's result. Both are confirmed against the oracle, neither happens on
base, and each has a small fix that I confirmed on its reproducer. Everything else I tested matched the oracle. Nothing in
the samples hits these two bugs, because they need inputs that ordinary tests don't have. The rest of the lane can land once
they are fixed.

| id | severity | where | what |
|---|---|---|---|
| F1 | high | `src/rust_ts/typing_env_no.ts:41` | `pack_def_id` is not injective, so a call can run the wrong function |
| F2 | medium | `src/rustc_const_eval/interpret/stack.ts:530` | the required-consts key has no env bound, so a post-mono error can vanish |
| N1 | nit | `src/rustc_middle/mir/interpret/pointer.ts:516`, `src/miri/alloc_addresses/mod.ts:472` | "truncation does nothing below 2^32" is false on a 16-bit target |
| N2 | nit | `src/rustc_const_eval/interpret/eval_context.ts:148` | `resolve_memo_tcx` keeps the whole `TyCtxt` alive to process exit |
| N3 | nit | `stacked_borrows/item.ts:14`, `stacked_borrows/stack.ts:10` | comments now false after the shared `Stack::new` slot |
| N4 | nit | `place.ts:770`, `eval_context.ts:145`, `rustc_abi/lib.ts:1095` | new code separates upstream comments from what they describe |
| N5 | nit | `docs/handoff/miri-perf.md` | three handoff statements need correcting |

## F1: `pack_def_id` overlaps `krate` and `index` (high)

Commit `56e2eafb`. Callers: `InterpCx::resolve` (`eval_context.ts:463`) and the query keys at `query/keys.ts:618` and `:628`.

```ts
return env * 0x8_0000_0000_0000 + d.krate * 0x100_0000_0000 + d.index * 0x100_0000 + id;
```

`index` is accepted below 2^20 and shifted by 2^24, so it reaches bit 43. `krate` is shifted by only 2^40. So `(krate, index +
65536)` and `(krate + 1, index)` get the same key. The comment at `:36` says "Injective on what it accepts"; a grid over the
accepted range finds 256 collisions, the first being `0:0:65536:0 == 0:1:0:0`.

**Failing scenario.** A crate with more than 65,536 local DefIndexes, in which `fn t_i` packs like a std fn with no generics:

```ts
// bun gen.ts > pack3.rs
const out = ["#![allow(dead_code, unused)]"]; let left = 65534, s = 0;
while (left > 0) { const n = Math.min(left - 1, 4000); out.push(`pub struct S${s++}{${Array.from({length:n},(_,i)=>`f${i}:u8`).join(",")}}`); left -= n + 1; }
for (let i = 0; i < 700; i++) out.push(`fn t${i}() -> u32 { ${i} }`);
out.push(`fn main() { let mut s = 0u32; ${Array.from({length:700},(_,i)=>`s = s.wrapping_add(t${i}());`).join(" ")} println!("{}", s); }`);
console.log(out.join("\n"));
```

| side | result |
|---|---|
| Miri oracle | prints `244650`, exit 0 |
| `integ-w38` (`223c634a`) | byte-identical to the oracle |
| merge | exit 101: a call in `main` runs `std::rt::init` instead of the local fn, then the interpreter ICEs |

The resolve memo returns another function's `Instance`, and the two query caches can return another key's result. I did not
separate which of the three fires first here.

**Reach today.** Only a DefIndex at or above 2^16 can collide. Of the sysroot crates I enumerated (`core`, `alloc` and the
next two crate numbers), only `core` gets there (82,313 DefIndexes). `std` was not enumerated; the highest std index any run
resolved was 12,936. `core`'s top 16.7k are almost all lifetime params, anon consts and consts, and the only functions there are
28 assoc fns. With Miri's crate order on hello they give 6 function pairs against `alloc`, all `Dispatch` impl methods on the
`core` side. Only one pair shares its args (`<f64 as
log::Dispatch>::dispatch` and `alloc::raw_vec::layout_array`), and Miri intercepts the `log` intrinsic before the dispatch
method runs; a program using both matches the oracle. Instrumented runs of hello, `layout.rs` and `thr.rs` saw 0 collisions,
and the compile of `core` packs no key at all (its envs are numbered 4 or above by then). So I expect no protected case to change, but I did not run
the full suites, and other crate orders were not enumerated. This also explains how it passed every sample.

**Fix.** `d.krate * 0x1000_0000_0000` (2^44). `krate` below 2^7 then stays under 2^51. With it the grid has 0 collisions and
the program above matches the oracle. Please add the injectivity grid as a test; the lane's new tests do not touch this function.

## F2: the required-consts key has no env bound (medium)

Commit `299fed14`, `stack.ts:530`:

```ts
const required_key = instance.args.id * 0x40 + typing_env_no(this.typing_env);
```

Every other `* 0x40` memo stops at env 64. This one does not, so `(args, env)` and `(args - 1, env + 64)` share a key, and the
required consts of a frame are skipped if the other pair already passed. Frames do reach such envs: the program below reaches
env 404, and compiling `core` reaches env 2287.

**Failing scenario.** Generic const exprs give each fn's frames its own env. `Chk<Bb>, Chk<Ga>` places the two args lists 3 ids
apart, so `g::<Ga>` in env 212 hides `g::<Bb>` in env 404:

```ts
// bun gen.ts > reqc.rs; rustc reqc.rs --crate-type lib --emit=metadata --target x86_64-unknown-linux-gnu --edition=2021
const out = ["#![feature(generic_const_exprs)]", "#![allow(incomplete_features, dead_code, unused)]",
  `pub struct Chk<T>(T); impl<T> Chk<T> { const C: () = assert!(std::mem::size_of::<T>() < 4, "too big"); }`,
  "pub struct Ga; pub struct Bb([u8; 8]);", "pub struct U(Chk<Bb>, Chk<Ga>);",
  "const fn g<T>() -> usize { if false { Chk::<T>::C } 1 }"];
for (let i = 0; i < 400; i++) out.push(`pub trait T${i} {}`);
for (let i = 0; i < 400; i++) out.push(`pub fn a${i}<X: T${i}>() -> [u8; g::<Ga>()] { [0; 1] }`);
out.push("pub fn bad<X: T0>() -> [u8; g::<Bb>()] { [0; 1] }");
console.log(out.join("\n"));
```

| side | result |
|---|---|
| oracle | `error[E0080]: evaluation panicked: too big`, exit 1 |
| `integ-w38` | byte-identical to the oracle |
| merge | no error, exit 0 |

The ids depend on the build's interning order, so the 400 envs are a margin rather than an exact figure. Reaching this takes an
incomplete feature, so it is unlikely in a protected case, but a compiler that accepts what the oracle rejects is what the
project forbids.

**Fix.** Do what the other memos do: use the memo only when the env is below `0x40`, and always run the checks otherwise. With
that guard the program matches the oracle.

## Nits

**N1.** The comments say the wrap and the truncation "do nothing" below 2^32. On a 16-bit target they do: base vs head, 4,225
pairs each, gives 0 differences at 64 and 32 bits and 1,080 at 16 bits (`0 + 65536`: base `0`, head `65536`). It is not
reachable today: `avr-none` stops at `unported` (`rustc_target/spec/mod.ts:2145`) and JSON targets stop at `Target::from_json`. It
would silently be wrong the day a 16-bit target is ported, so bound the fast path by the target's pointer size, or say in the
comment that it assumes 32-bit pointers or wider.

**N2.** `resolve_memo_tcx` holds the `TyCtxt` strongly (`f25cfc13`). See "rmeta-core RSS". It costs memory only after compilation
ends, and it does not change output. It is worth fixing because it misleads anyone reading a heap at exit. A `WeakRef` removes it.

**N3.** `item.ts:14` says nothing aliases one `Item` from two places, and `stack.ts:10` says every copy into or out of the cache
is `clone_Item`. `Stack::new` now aliases all 32 slots. The change itself is right (see below); the two headers need updating.

**N4.** Porting rule section 2 keeps upstream comments with their code. `class LocalImmediateRef` sits between the upstream doc
comment of `as_mplace_or_mutable_local` and the function, `SMALL_SIZES` between `/// Size of a type in bytes.` and `Size`, and
the frame memos between the `PORT:` note on `InterpCx`'s impls and the class. Move them above the comments.

**N5.** In the handoff:
- "the per-type ones stop at 64 typing envs" is not true of `REQUIRED_CONSTS_OK` until F2 is fixed.
- "Why this should be invisible" holds only once F1 and F2 are fixed.
- The rmeta-core RSS section needs the figures below.

Comments that were checked and are accurate: the "Measured" figures I could compare (move-3-unique took 36.3 s CPU and 33.8 s wall
here at load about 15-25, around the whole difftest run, in line with the table), and the upstream statements I read against the pinned
source: `layout_of_local`, the required-consts loop, `read_discriminant`'s walk, `resolve`, `wrapping_offset`, `Stack::new` and the
cached-item update loop.

## rmeta-core RSS

**The new caches do not retain meaningful memory. The budget can be exceeded on base as well, and exceeding it does not fail a gate.**

Peak readings on `rmeta-core`'s compile, direct `src/rust_ts/main.ts` runs, one at a time on my side:

| condition | base | merge | merge + `WeakRef` |
|---|---|---|---|
| quiet machine (load 2-4), no probe: RSS MiB | 11,401 / 13,289 / 12,357 | 12,480 / 13,240 / 13,229 | 12,541 / 13,377 / 13,345 |
| same runs: peak footprint MiB | 12,181 / 10,863 / 10,021 | 10,300 / 10,828 / 10,819 | 10,225 / 10,824 / 10,902 |
| load 15-18, exit-heap probe: RSS MiB | 11,744 / 11,923 / 10,740 | 12,249 / 10,425 / 11,913 | |
| concurrent GC and JIT off: RSS MiB (load 3-30) | 9,354 / 12,043 | 9,874 / 10,362 / 9,905 (last with counters) | |
| same runs: peak footprint MiB | 9,806 / 9,637 | 7,306 / 7,869 / 7,477 | |

- **Spread hides any difference.** Base alone spans 1,888 MiB on a quiet machine. The merge mean there is 634 MiB above base on
  three runs each, inside that spread, so RSS shows no proven change. Peak footprint is the same or lower on merge, about 2 GB
  lower with concurrent GC and JIT off.
- **The lane's range is too low for a quiet machine.** RSS is higher when the machine is quiet: 5 of 6 base and merge runs were
  above the 12,288 budget at load 2-4, base included. The handoff's 11,959 maximum comes from loaded runs.
- **Gate effect.** A reading over budget is reported as an `ERROR:` line and recorded, but it is not a status and does not fail
  the gate (`harness/suites.ts:61`, `scripts/gate.ts:9` and `:368`). Since heavy suites run after the others, on a quiet machine,
  expect that line at the next gate with or without this lane. Root may want to reset the budget. This machine has 24 GiB, so a
  single run does not threaten it.
- **What the caches hold**, counted on the compile of `core` with an instrumented copy: `FRAME_NORMALIZE_MEMO` 12,746 values and
  14,034 entries; `LAYOUT_MEMO` 242 layouts and 2,755 entries (294 new variant layouts); `ADT_DISCR_MEMO` 7 and 36;
  `CALLEE_SIG_MEMO` 696; `OPSEM_INHABITED` 194; `RESOLVE_MEMO` 0; 2,473 env numbers; `LIST_INPUTS` 71,598 arrays with 124,112
  elements; required-consts and always-live 2,320 bodies each. All are bounded by distinct MIR values, types or lists. My
  estimate is tens of MB at most against 10+ GB. Before `f25cfc13` the exit heap equals base: 2.386 GB and 48.32M objects
  against 2.388 GB and 48.29M.
- **The one large effect is N2.** From `f25cfc13` on, the heap at exit is 3.06 GB and 59.98M objects on every run, against 2.37 GB
  and 48.28M on base. I bisected this on `core`, and a `WeakRef` brings it back to 2.386 GB. It does not lower peak RSS (table), so
  the retention starts after the peak.

## What I checked, change by change

**Caches and memos (question 1).** For each one I read the key, what it depends on and who can write the value. Apart from F1 and
F2 the keys are complete.
- `read_discriminant`: the key is `(AdtDef, bits)`, and a `Map` compares bigints by value. Hits skip only walks already made, and
  failed searches are not stored. Tested: tags at 2^53 ± 1, `u64::MAX`, `i64::MIN`, `u128` and `i128` extremes, negative `i8`,
  generics, niche enums, async state, and a valid tag followed by an invalid one.
- `InterpCx::resolve`: correct apart from F1; `Instance` is not written to. One consequence is N2.
- Local reads and writes: same cached field as `layout_of_local`, `from_known_layout`'s release behaviour, same arms as
  `as_mplace_or_local`, and the `MutRef` class does the same reads and writes.
- `LAYOUT_MEMO`: the bit layout is sound. The result depends on the outer `Layout`, `ty`, env, index and kind. Types sharing one
  `Layout` are distinguished by `ty.id`. `for_variant` keeps its early return first.
- Frame normalize: all four callers pass MIR-held values, so the map does not grow per call. `Err` is not stored.
- `interp_ok` shared results: no code writes to a `Result` field in `src/rustc_const_eval` or `src/miri`.
- `Stack::new` shared slot: the only write is `set_permission`, inside a loop over all slots with the same tag, and it is
  idempotent. `clone_StackCache` splits the slots again. Tested with more than 32 tags, disabled Uniques, the base tag and GC.
- Stacktrace reuse: same list in the same order; `FrameInfo` fields are never written; `Right` locations are not stored.
- Query keys: interned ids come from one process-wide counter, so `Ty`, `Region` and `Const` cannot collide in a `GenericArg` key.
  Apart from F1 the keys give the same equality as `intern_key`. `hash_key` is only used as a map key.

**Bigint to Number (question 2).** A differential test of base against merge, over a boundary grid around 2^16, 2^29, 2^31, 2^32,
2^48, 2^52, 2^53, 2^60, 2^61, 2^62 and 2^63 (each ±9): 1,035,070 `Size` comparisons including what is thrown (`from_bytes`,
`from_bits`, `bits`, `align_to`, `is_aligned`, `checked_add`, `checked_mul`, `add`, `sub`, `mul`). The one difference is
`from_bytes(-0)`, now `0` rather than `-0`, which is harmless. `truncate` and `sign_extend` in both files, 960 comparisons, including
negative and oversized values: 0 differences. `read_target_uint` and `write_target_uint`, both endians, lengths 0-16, plus 200,000
random reads: 0 differences. `wrapping_offset`: N1. End to end, against the oracle: layouts up to 2^53 - 1 (`sizes_safe`), offsets at
2^32, 2^53 and 2^53 + 1, the wrap at 2^32 on `wasm32-wasip2`, and scalars across the `hi` boundary at every offset. A size at or
above 2^53 in a layout stops at `unported`, on base too.

**Ordering and flags (question 3).** No change moves an RNG draw, an allocation or a scheduling decision. Hand-written programs against
the isolated Miri, 241 runs, on 50 programs (discriminants, pointers, scalars and partial pointers, layouts and validation paths,
Stacked Borrows, threads, and 41 UB programs including wrong-ABI calls, a data race and leak reports). Flags per program: `-Zmiri-tree-borrows`,
`-Zmiri-disable-validation`; for the main ones also `-Zmiri-disable-stacked-borrows`, `-Zmiri-provenance-gc=1`, `-Zmiri-seed=7`; for
Stacked Borrows and threads also `-Zmiri-disable-weak-memory-emulation`, `-Zmiri-disable-data-race-detector`,
`-Zmiri-symbolic-alignment-check`, `-Zmiri-strict-provenance`, `-Zmiri-recursive-validation`, `-Zmiri-preemption-rate=0`,
`-Zmiri-address-reuse-rate=0`, `-Zmiri-compare-exchange-weak-failure-rate=0.5`. All byte-identical except these, none caused by the lane:
- `ptr.rs` with no flag, `-Zmiri-seed=7` and `-Zmiri-provenance-gc=1`: the ICE in O1, on base too.
- `sizes.rs`: `unported` at 2^53, on base too.
- `-Zmiri-many-seeds` on `sb.rs` and `thr.rs`: stops at exit 70 (D13 puts many-seeds out of M6). Not run on base.
- `scalar.rs` with `-Zmiri-provenance-gc=1`: killed by my own 280 s limit; matched with a longer one.

`MIRI_LOG=info` stops the port at exit 70 before any record (`rustc_log/lib.ts:91`, not this lane), so tracing cannot change output, and
`scripts/miri-diff.ts` could not compare traces.

**CTFE (question 4).** A crate of 89 consts and statics giving 53 const-eval errors: invalid values with paths, dangling and out-of-bounds pointers at
the boundaries, partial pointers, post-mono failures, generics across envs. It is byte-identical plain and with
`-Zextra-const-ub-checks`, `-Zunleash-the-miri-inside-of-you` and `-Zmir-opt-level=0`. `mir` filtered to `tests/ui/consts/const-eval`: 163
MATCH and 1 UNSTABLE of 164. `tests/ui/enum-discriminant`: 45 of 45.

**Upstream fidelity (question 5).** Each change keeps the function's logic on its first run and adds a skip on repeats or a fast path
that equals the slow one, with a `// PORT(perf):` comment. `coverage.ts --check` passes (24,707 markers); `tsc --noEmit` is clean. PORTING
section 3 says not to simplify, and no recorded decision covers memoizing upstream's logic. Root may want to record one for this
lane and later perf work.

**Reproduction (question 6).** On the merge, against the oracle:

| case | suite | result | CPU / wall s (load about 15-25) |
|---|---|---|---|
| `moves/move-3-unique.rs` | `run-pass-miri` | MATCH | 36.3 / 33.8 |
| `drop/dynamic-drop.rs` | `run-pass-miri` | MATCH | 53.1 / 47.6 |
| `threads-sendsync/issue-8827.rs` | `run-pass-miri` | MATCH | 48.0 / 43.4 |
| `tests/pass/float.rs` | `miri-pass` | MATCH | 25.1 / 12.7 |
| `test-attrs/terse.rs` | `run-fail-miri` | MATCH | not timed |

`--sample 200`, `RUST_TS_AGENT=review-miri-perf`, 0 DIFF, 0 CRASH, 0 TIMEOUT in all:

| suite | total | MATCH | UNPORTED | UNSTABLE | not MATCH |
|---|---|---|---|---|---|
| `miri-hello` | 1 | 1 | 0 | 0 | |
| `miri-pass-tb` | 132 | 130 | 2 | 0 | `sync.rs` twice, D5 |
| `miri-fail` | 200 | 197 | 3 | 0 | D5 twice; `erroneous_const.rs`, E0080 long text |
| `borrowck-ui` | 200 | 200 | 0 | 0 | |
| `tydump-ui` | 200 | 200 | 0 | 0 | |
| `pm-ui` | 200 | 197 | 1 | 2 | `expand-expr.rs`; `load-panic-backtrace.rs`, `proc_macro_generated_packed.rs` |

`bun test ./src/miri ./src/rustc_const_eval ./src/rustc_abi ./src/rustc_middle`: 860 pass, 0 fail.

## Observation, not this lane

**O1. Stacked Borrows ICE on a valid program, on base and merge.** The oracle exits 0; the port exits 101 with `TypeError: undefined is
not an object (evaluating 'item.tag')` at `stacked_borrows/stack.ts:282`, from `Stack_dealloc`: `this.borrows[stack_idx]` is a hole.
`-Zmiri-tree-borrows`, `-Zmiri-disable-validation` and `-Zmiri-disable-stacked-borrows` do not hit it. Reduced program:

```rust
fn main(){
  let a=[1u8,2,3,4,5,6,7,8]; let p=a.as_ptr(); let b=p.addr();
  for d in [0usize,1,7,8,9,0x7fff_ffff,0x8000_0000,0xffff_ffff,0x1_0000_0000,0x1_0000_0001,(1<<52),(1<<53)-1,1<<53,(1<<53)+1,1<<62,1<<63,usize::MAX,usize::MAX-1,usize::MAX-b,usize::MAX-b+1,usize::MAX-b+2] {
  }
  let e=std::ptr::with_exposed_provenance::<u8>(p.expose_provenance()); unsafe{println!("{}", *e);}
  let mut d=[0u8;8]; unsafe{std::ptr::copy(p,d.as_mut_ptr(),8);} println!("{:?}", d);
}
```

I did not look for the cause. It stops loudly, so it is not a silent wrong result. It deserves its own fixer item.

## Not checked

- The gate and full suites, as instructed. Whether any protected case hits F1 or F2 is reasoning plus samples, not a full run.
- The two fixes beyond their reproducers and the grid: no sample suites on them. They should be re-sampled after the change.
- `-Zmiri-many-seeds` beyond the stop above, and GenMC and native-lib, which are out of M6.
- `run-pass-miri-heavy`.
- `scripts/miri-diff.ts` trace comparison, which the port stops (above).
- Pack collisions for crate orders other than Miri's on hello.
- Processes with more than one `TyCtxt`, except through the unit tests.
- Most of the lane's per-change gain figures, and D11's targets: speed was not my job here.
- Whether RSS's dependence on load comes from JSC's GC pacing: that is my reading, and I did not investigate it.

# Review: lane vendor-rand (independent reviewer, read-only)

Batch: `b0008692..4e4b3bd9` (one commit, `4e4b3bd9`, branch `t3/port-vendor-rand-crates`). Plan: plan-m6 D5.
Crate sources: cargo's registry cache (`rand-0.10.1`, `rand_core-0.10.1`, `chacha20-0.10.0`).

## Verdict: **APPROVE WITH NITS**

No blocking findings. The StdRng stream and every draw shape Miri uses are byte-identical to the oracle-built
crates. I checked this independently (below): I rebuilt the probe, and forced the `soft` backend in a second build.
The port follows the crate sources function by function. Two items need root's decision. Neither blocks the lane:
the `harness/scope.json` edit (§4) and the committed oracle fixture versus a registered probe (§3).

## 1. Version provenance: verified
- Upstream `Cargo.lock` (`$RUST_TS_DATA/rust/Cargo.lock`):
  - `miri 0.1.0` is the only package that depends on `rand 0.10.1`.
  - `rand 0.10.1` depends on `chacha20` (the only version in the lock is 0.10.0), `getrandom 0.4.3` and `rand_core 0.10.1`.
  - `rand` is the only package that depends on `chacha20`. `rand_core 0.10.1` is also pulled in by `getrandom 0.4.3` (`sys_rng`), which adds no features to rand or chacha20.
- `src/tools/miri/Cargo.toml:21`: `rand = "0.10"`, default features (`std`, `std_rng`, `sys_rng`, `thread_rng`).
  - `unbiased` and `simd_support` are off.
  - rand's manifest pulls chacha20 with `default-features = false, features = ["rng"]`, so chacha20's `cipher`, `legacy`, `xchacha` and `zeroize` are off.
  - In rand 0.10.1, `StdRng` is `chacha20::ChaCha12Rng` (`rngs/std.rs`).
- Checksums (`shasum -a 256` of the cached `.crate` files) equal the lock's checksums:
  - chacha20-0.10.0 (yanked; fetched with `cargo update --precise`): `6f8d983286843e49675a4b7a2d174efe136dc93a18d69130dd18198a6c167601` ✔
  - rand-0.10.1: `d2e8e8bc…62207` ✔
  - rand_core-0.10.1: `63b81761…69` ✔
- The probe's own lockfile resolves to the same versions: rand 0.10.1, rand_core 0.10.1, chacha20 0.10.0, cpufeatures 0.3.0, cfg-if 1.0.4.

## 2. Fidelity: matches upstream
I compared these line by line with the crate sources:
- **chacha20**
  - `lib.rs`: constants, `R8`/`R12`/`R20`, `new_internal` (state layout, `ctr_size` split, LE key/iv words), `get/set_block_pos`, Debug (including upstream's odd `)>`), `quarter_round`.
  - `backends/soft.rs`: `gen_ks_blocks`, which always writes `state[13]` on the rng path, and `run_rounds`.
  - `variants.rs`.
  - `rng.rs`: `from_seed` with the `[0; 8]` iv, `generate`, the `impl_chacha_rng!` methods (`get/set_word_pos` with the 68-bit mask, `get/set_block_pos`, `set/get_stream`, `get_seed`, `serialize/deserialize_state`, `eq`).
- **rand_core**
  - `block.rs`: `new`, `reconstruct`, `index`/`set_index` (the index lives in `results[0]`), `reset_and_skip`, `word_offset`, `next_word`, `next_u64_from_u32` (both block-edge arms), `fill_bytes`. The `zip`/`src.next()` rendering as `index < N` is correct: `&mut I` is not `TrustedRandomAccess`, so `zip` polls the chunk iterator first.
  - `seedable_rng.rs`: `seed_from_u64` with `pcg32`, `rotate_right(0)` included; `from_rng`.
  - `lib.rs`: the blanket impls, in upstream order.
- **rand**
  - `rng.rs`: `random`, `random_range` (assert, then `unwrap`), `random_bool` / `random_ratio` and their panic texts, `fill` / `impl_fill!`.
  - `bernoulli.rs`: `new` (NaN goes to `Err`, `p == 1.0` to `ALWAYS_TRUE`, `Math.trunc` is exact for `p < 1`), `from_ratio`, `sample` (`v < p_int`).
  - `integer.rs`: u128 is LE, x then y.
  - `other.rs`: bool is the sign bit of `next_u32`.
  - `uniform.rs`: the `SampleRange` impls for `Range`, `RangeInclusive`, `RangeTo`, `RangeToInclusive`, and the provided `sample_single*`.
  - `uniform_int.rs`: every `uniform_int_impl!` path for the non-`unbiased` `sample_single_inclusive`. I checked the casts per width: u8/i8 go through a u32 sample type; `thresh as $uty as $ty`.
  - `UniformUsize`: `mode64`, with the u32 and u64 split in `new_inclusive`, `sample` and `sample_single*`.
  - `utils.rs` `wmul`: u32 is built from 16-bit halves, which is exact; u128 follows `__mulddi3`.
  - `coin_flipper.rs`: the masked shifts match LLVM codegen of unchecked `<<` and `wrapping_shl`. The `saturating_sub` / `clamp` order matches.
  - `iterator.rs` `choose`: both loops; `upper == Some(lower)` is `===` against `undefined`.
  - `slice.rs` `choose`.
- Markers follow the `// crate: <crate>-<ver>/<path>:<line> <name>` convention (as in twox-hash and polonius-engine). `coverage.ts --check --offline` passes.
- Backend skips are justified. ChaCha is defined on u32 words. The lane's probe ran the `neon` backend (aarch64 host) and matches the port's `soft`. I also rebuilt the probe with `RUSTFLAGS='--cfg chacha20_backend="soft"'`: the output is byte-identical to the neon build. avx2/sse2 (the x86_64 Windows host in AGENTS.md §5) were not run here. chacha20's own KATs and the port's ported `tests/rng.rs` vectors cover them indirectly.

## 3. Oracle test: valid; fixture form is root's call
- I rebuilt the probe myself (`$RUST_TS_DATA/tmp/vendor-rand/probe`, whose sources equal `docs/handoff/vendor-rand-probe/`). Build: `cargo +nightly-2026-10-11 build --release --offline --locked`, separate target dir, no toolchain changes. Its output is **byte-identical** to `src/vendor/rand/stdrng.oracle.txt`: 254 lines, `cmp` clean.
- `stdrng.oracle.test.ts` recomputes every line from the port and compares the lines exactly. Each line ends with the generator's next u32, so the number of words consumed is checked too. The test passes.
- It covers Miri's draw sites (`grep` of `src/tools/miri/src`):
  - `StdRng::seed_from_u64` (machine.rs:721, genmc).
  - `random::<bool>()` (operator, math, machine:1451, fd, intrinsics).
  - `random_range`: `0..16` u64 (address_generator:48), usize `0..N` / `begin..end` (machine:2106, reuse_pool:129), i64 `-m..=m` (math:130), u128 `0..1<<PREC` (math:92).
  - `random_bool` (thread:1105, data_race:930, reuse_pool:69/99/102).
  - `fill_bytes` (helpers:396).
  - slice `choose` (fs:2138, mkstemp).
  - `IteratorRandom::choose` (scheduler:137, weak_memory:413, operator:109).
- The operator.rs NaN iterator, `once().chain(filter().map()).chain(filter_map())`, has hint `(1, Some(k))`. `choose` sends that through the same `next()` + coin-flip arm the `Filter` cases exercise, and the `(1, 0)` chain case covers the exact-1 arm.
- **Rule question (non-blocking, root):** AGENTS.md §2 names the oracle as the pinned rustc plus probes in `tools/probes`. A committed fixture produced from an unregistered probe is weaker: tooling cannot regenerate it. There is precedent for committed oracle fixtures (`src/rust_ts/hash_map_oracle/fx_order.txt`, `src/rustc_ast/attr/testdata/ext.oracle.txt`, `src/rustc_ast/fixtures/ast_core_oracle/probe.out`), and I have now reproduced this one. I find it acceptable for this lane.
  - Recommendation: queue the harness follow-up the handoff describes (`tools/probes/randstream`, `lockfile = "upstream"`).
  - Then make the test also run against the built probe when it is present, as `xxhash3_128.oracle.test.ts` does, and keep the fixture as the always-run check.

## 4. `harness/scope.json` (flag for root)
- `harness/scope.json:73-75` adds `"rand": "=0.10.1"`, `"rand_core": "=0.10.1"`, `"chacha20": "=0.10.0"`. The versions are correct (§1).
- AGENTS.md §2 says harness changes need their own reviewed batch. PORTING.md §5b, however, tells porters to record the vendor version in `scope.json`, and the previous vendor lanes did the same in-lane: twox-hash `17df27c6`, polonius `c643269f`.
- I reviewed the three entries as part of this batch; they are data only, no runner or suite change. **Root:** accept them here, as for the earlier vendor lanes, or split them out. Either way is fine with me.

## 5. `unported(...)` and performance
All five are genuine: usize is `number`, and none of them is reachable from Miri's draws. Miri's usize bounds are allocation-pool indices, `ADDRS_PER_ANON_GLOBAL` and thread counts, all `< 2^32`, so `UniformUsize` stays in `mode32` or the exact `sample_single` path.
- `src/vendor/rand/distr/uniform_int.ts:421`: the full-range `mode64` `sample`. It is in fact dead code, because `new_inclusive` calls `check_usize(high)` first, and a full range needs `high = usize::MAX`. Harmless.
- `src/vendor/rand/distr/uniform_int.ts:487` (`check_usize`), `src/vendor/rand/distr/utils.ts:108` (usize `wmul`, no caller), `src/vendor/rand/distr/distribution.ts:86` (`Iter::size_hint`, `usize::MAX`), `src/vendor/chacha20/variants.ts:73` (only `cipher` calls it).
- `src/vendor/rand/seq/coin_flipper.ts:52` asserts `d < 2^52`. That is acceptable: it is a panic rather than `unported`, but it is still a visible stop, not a silent divergence.
- **Performance (non-blocking, Miri lane / plan D11):** the note is accurate.
  - `maybe_preempt_active_thread` (thread.rs:1105) calls `random_bool` at every scheduling point, and each call builds a `Bernoulli` (a `BigInt`), draws a bigint `next_u64`, and allocates the `Ok(...)` from `try_next_u64` (`src/vendor/chacha20/rng.ts:114`).
  - Measure this once the step loop runs. A u32-pair compare against `p_int` split in halves would be the obvious fast path, behind a `// PORT:` note.

## 6. Results
- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun scripts/coverage.ts --check --offline`: `markers ok (23169; vendor 5050)`. Per crate: rand_core 85/85, chacha20 130/130, rand 152/399 (the Miri subset, as the handoff says).
- `bun test src/vendor/rand src/vendor/rand_core src/vendor/chacha20`: 71 pass, 0 fail (11 files). This includes the oracle test.
- `bun scripts/difftest.ts --suite mir-o0 --sample 46`: 46 MATCH, 0 DIFF/UNPORTED/CRASH (run `20261031-231125-root-bvcl`). This is expected: nothing outside `src/vendor/{rand,rand_core,chacha20}` imports the new crates.
- Independent probe rebuild: identical to the fixture. The forced-`soft` rebuild: identical too.

## Findings
1. `harness/scope.json:73`: **non-blocking (root decision)**. A harness edit inside a port lane. It follows the vendor-lane precedent and PORTING.md §5b; root should accept it explicitly or split it out (§4).
2. `src/vendor/rand/stdrng.oracle.txt` / `stdrng.oracle.test.ts:34`: **non-blocking**. The fixture comes from an unregistered probe. Queue `tools/probes/randstream`, and make the test also run against the probe when it is built (§3).
3. `src/vendor/rand/distr/integer.ts:96-97`: **non-blocking nit**. The `__m128i`/`__m256i` crate-skip reason says "not on the oracle host". These impls *are* compiled on x86_64 hosts, including the Windows host in AGENTS.md §5. The real reason is "x86 SIMD register type; Miri never samples it". Reword.
4. `src/vendor/rand/distr/bernoulli.ts:113-117`: **non-blocking nit**. `ALWAYS_TRUE` and `SCALE` sit after `impl Bernoulli`, while upstream declares them before (bernoulli.rs:72/76). Move them up to keep the file's order.
5. `src/vendor/rand/distr/uniform_int.ts:421`: **non-blocking nit**. This `unported` cannot be reached, because `check_usize` in `new_inclusive` fires first. Keep it, or point the comment at `check_usize`.
6. `src/vendor/rand/rng.ts:66` and `src/vendor/chacha20/rng.ts:114`: **non-blocking (perf, Miri lane)**. Each `random_bool` creates bigints and an `Ok` (§5).
7. `src/vendor/chacha20/backends.ts`: **non-blocking**. avx2/sse2 are not verified on this host; I verified neon and soft. When the probe is registered, run it once on the x86_64 Windows host.

# Handoff: vendor-rand (vendor rand 0.10.1 + rand_core 0.10.1 + chacha20 0.10.0; plan-m6 D5)

Branch `t3/4170cf12`, on top of `b0008692`.

## Versions (confirmed)
- Upstream's root `Cargo.lock`: `miri 0.1.0` is the only package that depends on `rand 0.10.1`. rand 0.10.1 depends on
  `chacha20` (only 0.10.0 is in the lock), `getrandom 0.4.3` and `rand_core 0.10.1`. Miri asks for `rand = "0.10"` with
  default features (`std`, `std_rng`, `sys_rng`, `thread_rng`). No other package can unify extra features (`unbiased`,
  `simd_support`) onto it, so the `unbiased` sampler is off. That matters, because it changes `random_range`'s draws.
- The probe (below) resolves the same versions through upstream's `Cargo.lock`. `cargo tree` shows
  `rand v0.10.1 → chacha20 v0.10.0 (cfg-if, rand_core v0.10.1)`. In rand 0.10.1, `StdRng` is `chacha20::ChaCha12Rng`.
- **chacha20 0.10.0 is yanked on crates.io.** That is why `bun scripts/crate-src.ts chacha20 --version 0.10.0` fails,
  online too ("version 0.10.0 is yanked"). I fetched it in a scratch crate
  (`$RUST_TS_DATA/tmp/vendor-rand/fetch`): `generate-lockfile`, then `cargo update -p chacha20 --precise 0.10.0`
  (cargo allows yanked versions with `--precise`), then `cargo fetch`.
  - The `.crate` sha256 is `6f8d9832…7601`, which equals the root `Cargo.lock` checksum.
  - It is now in cargo's registry cache, so `crate-src.ts --offline` and `coverage.ts --offline` find it.
  - **Harness follow-up:** `scripts/crate-src.ts` cannot fetch yanked locked versions. It could write a lockfile pinned
    with `cargo update --precise`, or copy upstream's `Cargo.lock` the way probes do.

## Files
- `harness/scope.json` (**harness change, needs root's/owner's review**, as plan-m6 D2b/D5 say): `vendor` gains
  `"rand": "=0.10.1"`, `"rand_core": "=0.10.1"`, `"chacha20": "=0.10.0"`. Coverage markers need these entries.
- `src/vendor/rand_core/` (all of rand_core):
  - `lib.ts`: `Rng`, `TryRng`, `CryptoRng`, `TryCryptoRng`, the deprecated stubs, `Rng_for_TryRng` (blanket impl)
    and `TryRng_for_DerefMut`.
  - `block.ts`: `Generator`, `BlockRng`.
  - `seedable_rng.ts`: `SeedableRng`, `SeedableRng_provided`, `pcg32`.
  - `utils.ts`, `word.ts` (`Word_u32`/`Word_u64`), `unwrap_err.ts`.
  - Tests: `tests/{block,mod,utils}.test.ts`.
- `src/vendor/chacha20/` (the `rng` feature):
  - `lib.ts`: `ChaChaCore`, `Rounds` `R8`/`R12`/`R20`, `quarter_round`.
  - `rng.ts`: `impl_chacha_rng!`, i.e. `ChaCha8Rng`/`ChaCha12Rng`/`ChaCha20Rng`, plus `Generator for ChaChaCore`.
  - `variants.ts` (`Ietf`, `Legacy`), `backends.ts`, `backends/soft.ts`.
  - Tests: `tests/rng.test.ts`, all 24.
- `src/vendor/rand/` (the subset Miri uses):
  - `lib.ts`, `rng.ts` (`RngExt` and `Fill`), `rngs/{mod,std}.ts` (`StdRng`).
  - `distr/`: `mod`, `distribution`, `integer`, `other` (bool), `bernoulli`, `uniform`, `uniform_int`, `utils` (wmul).
  - `seq/`: `mod`, `slice` (`IndexedRandom::choose`), `iterator` (`IteratorRandom::choose`, `RustIterator`),
    `coin_flipper`.
  - `test_util.ts`: `crate::test::{rng, const_rng, step_rng, StepRng}`, plus `rand_pcg` 0.10.2's `Pcg32` as test
    support only. It is a dev-dependency and is not vendored, so it has no markers.
  - Tests: `rng.test.ts`, `rngs/std.test.ts`, `distr/{bernoulli,integer,uniform_int}.test.ts`, `seq/iterator.test.ts`.
  - Oracle test: `stdrng.oracle.test.ts` against `stdrng.oracle.txt`.
- `docs/handoff/vendor-rand-probe/{Cargo.toml,main.rs}`: the probe source (see below).
- `docs/handoff/vendor-rand.md`: this file.

## Coverage (`bun scripts/coverage.ts --offline --crate <c>`)
| crate | covered |
|---|---|
| rand_core-0.10.1 | **85/85** (all src + tests) |
| chacha20-0.10.0 | **130/130**. The crate-skips are SIMD backends `neon`/`avx2`/`sse2`/`avx512` (same keystream as `soft`), `cipher`/`legacy`/`xchacha`/`zeroize` items, and `tests/kats.rs` (cipher API) |
| rand-0.10.1 | **152/399** (38%), the Miri subset. Fully covered: bernoulli, integer, uniform_int, rngs/std, coin_flipper. Partly: rng (24/25), uniform (24/32), lib (6/18, the test helpers), distribution (7/14), iterator (10/24), utils (7/35), slice (4/31), other (2/17). Not ported: float, uniform_float, uniform_other, weighted/*, seq/index, increasing_uniform, small/xoshiro*, thread |

`bun scripts/coverage.ts --check --offline`: markers ok (23169; vendor 5050).

rand crate-skip markers cover `simd_support`, `unbiased`, `serde` and the x86-only `__m128i`/`__m256i` items, and only
cfg-disabled code. **Root to decide:** whether rand's unported modules (float, weighted, index, small rngs,
`thread_rng`/getrandom) should get crate-skip markers. I did not add them: they are compiled in Miri's build, Miri
just never calls them.

## Verification
- **Oracle probe:** `$RUST_TS_DATA/tmp/vendor-rand/probe`, with a copy in `docs/handoff/vendor-rand-probe/`.
  - Built with `cargo +nightly-2026-10-11 build --release` and upstream's `Cargo.lock` copied next to the manifest.
    No toolchain components were added.
  - Host aarch64, so the crate runs the `neon` ChaCha backend. Its output (254 lines) is committed as
    `src/vendor/rand/stdrng.oracle.txt` (sha256 `c9d07ad6…aa87`).
  - `stdrng.oracle.test.ts` recomputes every line with the port and compares them byte for byte. **All 254 lines match.**
  - What the lines cover:
    - StdRng `seed_from_u64` for 6 seeds (0, 1, 2, 42, 0xdeadbeef, u64::MAX). Each seed gets 200 `next_u32`, 100
      `next_u64`, u32/u64 interleavings, and `fill_bytes` at 19 lengths across block edges.
    - Fills of 1..9/255/256/257 bytes and `next_u64` at every buffer offset 0..130.
    - `from_seed` and `from_rng`.
    - Miri's draws: `random::<bool>`; `random_range` over `0..16u64`, usize ranges (including the >u32::MAX
      `mode64` path), u32 inclusive, i64 `-m..=m` and the full range, and u128 `0..1<<{11,24,53,64,113}` (the
      float-rounding-error ranges); `random_bool` at 9 values of p; `random_ratio`; `random::<u8..i128>`.
    - `choose`: slice `choose`; `IteratorRandom::choose` over exact, `Filter`, `Chain` (the `lower > 1` loop) and
      scheduler-shaped `skip.chain(take).filter` iterators; Miri's `mkstemp` suffix.
  - Each line ends with the generator's next `u32`, so the number of words each draw consumed is checked too.
- **Mutation check:** I made one mutation at a time and restored the file after each.
  - These made the test fail: the `next_u64_from_u32` block-edge arm, `R12.COUNT` 6→5, CoinFlipper's chunk shift,
    and the u128 word order.
  - This made the test hang: the `fill_bytes` `index < N` remainder test. That is a detection too.
  - Equivalent and not detectable: Bernoulli `<` vs `<= +1` (2^-64 odds) and Canon's `>` vs `>=` (2^-32).
- **Crate unit tests:** `bun test src/vendor/rand src/vendor/rand_core src/vendor/chacha20` gives 71 pass, 0 fail.
  - They include rand's own value-stability vectors (via the ported `Pcg32`) for uniform_int (every int type and
    usize), Bernoulli, integers, `IteratorRandom::choose` (all hint shapes), and StdRng's ChaCha12 true values and
    counter-wrap vector.
  - They also include all of chacha20's `tests/rng.rs`: IETF/RFC vectors, 32/64-bit counter wrap, word_pos, and
    serialize_state.
- `bunx tsc --noEmit -p .`: clean. I ran `bun install --frozen-lockfile` because the worktree had no `node_modules`.
- **Sample difftest:** `mir-o0 --sample 46` (`RUST_TS_AGENT=vendor-rand`, run `20261031-230831-vendor-rand-msaa`):
  46 MATCH, 0 DIFF. Nothing outside `src/vendor/{rand,rand_core,chacha20}` imports these crates, so no compiler path
  changed.

## Probe registration (for a harness lane)
The probe should become `tools/probes/randstream/`, a registry-dependency probe like `xxh3`. That is a tools/ change,
so I did not make it.
- `Cargo.toml.in`: the manifest in `docs/handoff/vendor-rand-probe/Cargo.toml` with
  `[package.metadata.rust-ts] lockfile = "upstream"` and `path = "@SRC@/main.rs"`.
- `main.rs`: as given.
- The oracle test could then run the built probe when present (like `xxhash3_128.oracle.test.ts`) and keep the
  committed fixture as the always-run check.

## unported(...) left
Every one comes from usize being a `number`: values at or above 2^53 have no exact representation. Miri's
usize draws are lengths and indices far below that.
- `src/vendor/rand/distr/uniform_int.ts:421`: `UniformUsize::sample` with the full 64-bit range (`range == 0` in
  `mode64`).
- `src/vendor/rand/distr/uniform_int.ts:487`: `check_usize`, for a UniformUsize bound above 2^53.
- `src/vendor/rand/distr/utils.ts:108`: usize `wmul` with a half above 2^53 (no caller).
- `src/vendor/rand/distr/distribution.ts:86`: `distr::Iter::size_hint` (`usize::MAX`).
- `src/vendor/chacha20/variants.ts:73`: `Legacy::remaining_blocks` above 2^53 (only the disabled `cipher` feature
  calls it).

## // PORT: decisions (55 comments; the main ones)
- **Types:**
  - u32 and smaller, and usize, are `number`. u64/u128 are `bigint`, masked after wrapping ops.
  - `&mut [u8]` is a `Uint8Array`, and `subarray` views write through. `Result<(), E>` is `Result<void, E>`.
  - `Infallible` is `never`.
  - The ChaCha state is a `Uint32Array(16)`: stores wrap, so `wrapping_add` is `+`.
- **Traits** are tables or interfaces:
  - Provided methods are `<Trait>_provided` (`SeedableRng_provided`, `Distribution_provided`,
    `UniformSampler_provided`, `IndexedRandom_provided`, `Generator_provided`).
  - Blanket impls are `Rng_for_TryRng` (each infallible generator's class calls it from `next_u32`/`next_u64`/
    `fill_bytes`), `TryRng_for_DerefMut`, `Distribution_for_ref` and `SampleBorrow_*` (identity, since `&T` is `T`).
  - `RngExt` is a table whose methods take the rng first.
  - `SeedableRng<S>` is `{ Seed_default, from_seed }`; generators also get static `seed_from_u64`/`from_rng`
    wrappers.
- **Generic dispatch on `T`:**
  - `StandardUniform: Distribution<T>` is a `StandardUniform_<T>` table.
  - `T: SampleUniform` is a `SampleUniform_<T>` table (`{ Sampler }`, plus `ZERO` for unsigned types, which
    `impl_sample_range_u!` needs).
  - `uniform_int_impl!` is `uniform_int_impl(ty, S)`, built from `IntTy`/`SampleTy` descriptors (8/16/32-bit types as
    `number` with a u32 sample type; 64/128-bit as `bigint`). The casts are `to_sample` (zero-extend) and
    `from_sample` (truncate and reinterpret).
  - `core::ops::{Range, RangeInclusive, RangeTo, RangeToInclusive}` with their `SampleRange` impls are classes in
    `uniform.ts` that carry the element table.
- **Iterators:** `RustIterator<T>` has `next`, `size_hint` and an optional `nth` (the default is `iter_nth`). What
  `choose` returns, and how many words it draws, depends on `size_hint`.
- **Macros:** `impl_chacha_rng!` is a class factory; `impl_int_from_uint!`, `impl_nzint!` and `impl_fill!` are table
  factories.
- **Backends:** chacha20's `cfg_if!` takes its `soft` arm, and the SIMD backends are crate-skip (same keystream, which
  the probe checks).
- **Module cycles:**
  - `chacha20/lib.ts` does not re-export `rng.ts`, because rng.ts builds its classes from `R8`/`R12`/`R20` at module
    evaluation. Import the generators from `chacha20/rng.ts`.
  - `distr/uniform.ts` does not re-export `UniformInt`/`UniformUsize`. Import from `distr/uniform_int.ts`.
- **CoinFlipper:**
  - Its usize arithmetic is exact for `d < 2^52` (asserted).
  - `saturating_mul` / `wrapping_sub` overflows only feed `>= d` / `> n` comparisons, and those stay correct.
  - Shift amounts are masked as in a release build (no overflow checks).
- **No destructors:** `BlockRng`'s `Drop` (→ `Generator::drop`) is ported but never runs implicitly. The only
  override, chacha20's zeroize, is cfg-off.

## For the Miri lanes (how to call it)
These calls produce the oracle's draws:

| Miri call | TS |
|---|---|
| `StdRng::seed_from_u64(seed)` | `StdRng.seed_from_u64(BigInt(seed))` |
| `rng.random::<bool>()` | `RngExt.random(rng, StandardUniform_bool)` |
| `rng.random_bool(p)` | `RngExt.random_bool(rng, p)` |
| `random_range(0..16)` on u64 (address_generator.rs:48) | `RngExt.random_range(rng, new Range(SampleUniform_u64, 0n, 16n))` |
| `random_range(0..ADDRS_PER_ANON_GLOBAL)` / `(begin..end)`, usize | `new Range(SampleUniform_usize, a, b)` |
| `random_range(-max_error..=max_error)`, i64 (math.rs:130) | `new RangeInclusive(SampleUniform_i64, -m, m)` |
| `random_range(0..(1 << F::PRECISION))`, u128 (math.rs:92) | `new Range(SampleUniform_u128, 0n, 1n << BigInt(p))` |
| `rng.fill_bytes(&mut data)` | `rng.fill_bytes(uint8array)` |
| `slice.choose(rng)` (operator.rs:109, fs.rs:2138) | `choose(slice, rng)` (`seq/slice.ts`) |
| `iter.choose(rng)` (scheduler.rs:137, weak_memory.rs:413) | `IteratorRandom.choose(it, rng)` |

- **Iterator hints.** `IteratorRandom.choose` needs iterators whose `size_hint` (and `nth`, if overridden) equals
  core's. Miri's iterators are `Filter`s (`(0, upper)`), so only the `next` loop runs. A shared `core::iter` adapter
  module with exact hints (`Filter`, `Chain`, `Skip`, `Take`, slice `Iter`) belongs in `src/std/`, which is not this
  lane's file. `stdrng.oracle.test.ts` has test-local versions that match the oracle and can serve as a starting
  point.
- **Performance (plan D11).** Every `next_u64` builds a `bigint`. `random_bool` (preemption, the data-race failure
  rate, address reuse) draws a u64 each time. Each word also allocates the `Ok(...)` that the faithful
  `TryRng` → `Rng` path returns. Measure this if the step loop shows it.

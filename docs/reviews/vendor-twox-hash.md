verdict: APPROVE-WITH-NOTES

Lane: vendor-twox-hash (branch `lane/vendor-twox-hash`, one commit 17df27c6 on main 644cc1e0).
Upstream: twox-hash 2.1.2 from the cargo registry. The `.crate` sha256 9ea3136b…419c matches the pinned
`.data/rust/Cargo.lock` entry. rustc_metadata's Cargo.toml enables `xxhash3_128` and `std`.

## What I checked
- Each ported fn against upstream lib.rs, xxhash3.rs, xxhash3/{secret,large,streaming}.rs, large/scalar.rs and
  xxhash3_128.rs. Order, control flow, constants and messages match. The 1–3/4–8/9–16/17–128/129–240/241+
  paths are exact, including:
  - the `head.by_ref().zip(ss).take(4)` consumption order;
  - the half-swapped tail with `seed.wrapping_neg()`;
  - the `!len.wrapping_mul(PRIME64_2)` in `finalize_128`;
  - the u64 shifts that wrap, each masked.
  `finish_impl`'s small path passes `DEFAULT_SECRET` even for a custom secret, which is faithful to upstream.
  It works on a copy of `StripeAccumulator`, as Rust's `let RawHasherCore { mut stripe_accumulator, .. } = *this`
  does, and the copy is load-bearing.
- Constants: the `DEFAULT_SECRET_RAW` 192 bytes and all 10 primes diff identical to upstream. The 39 expected
  128-bit test vectors in xxhash3_128.test.ts diff identical to upstream's test module.
- The u32-pair `Acc` in large.ts / scalar.ts is exact:
  - `mul_32_32` uses a 16-bit split. Every intermediate is < 2^34, so it is exact in f64.
  - `hi` is correct: `a_hi*b_hi + floor(mid/2^16) + floor(lo/2^32)`.
  - The adds carry with `sum >= 2^32`. The `Uint32Array` stores reduce mod 2^32.
  - In `round_scramble`, `>> 47` becomes `lo ^= hi >>> 15` (hi unchanged), and `wrapping_mul(PRIME32_1)` is
    `lo*P` full width plus `Math.imul(hi, P)` into the high word.
  - I fuzzed `Impl.accumulate` / `Impl.round_scramble` against a bigint reference for 30,000 cases with edge
    lanes (0, 1, 2^64−1, 2^63, 2^32±1, 0xffffffff00000000) and 0xff-heavy stripes/secrets: 0 mismatches.
- Probe `tools/probes/xxh3` is sound:
  - registry dependency `twox-hash = "=2.1.2"` with rustc_metadata's exact features;
  - `lockfile = "upstream"` is a supported probes.ts setting, already used by emitdump/objlist;
  - its E0464 rationale for not using rustc-dev is credible;
  - it runs the crate's real SIMD dispatch (neon here), so agreement shows scalar == oracle digest;
  - the command protocol and `gen_data` / `stream` are mirrored exactly in the TS test.
  I rebuilt it (`bun scripts/probes.ts build xxh3`) in a scratch worktree: it builds.
- In the scratch worktree:
  - `bunx tsc --noEmit -p .`: clean.
  - `bun scripts/coverage.ts --check`: markers ok (22798; vendor 4680).
  - `--crate twox-hash`: 197/340, as the handoff says.
  - `RUST_TS_REQUIRE_PROBES=1 bun test src/vendor/twox_hash`: 27 pass, 0 fail.
- Harness: the only change under `harness/` or `scripts/` is `harness/scope.json` `vendor` gaining
  `"twox-hash": "=2.1.2"`. That is the Cargo.lock version rustc_metadata resolves to (1.6.3 is
  rustc_sanitizers', out of scope). I approve it as the reviewed harness change. No baselines, suites or
  runner scripts were touched.
- Sample claim: no file outside `src/vendor/twox_hash/` imports the crate (`git grep` on the branch), so no
  compiler path changes and no MATCH can be lost. The handoff's mir sample (195 MATCH / 0 DIFF) is plausible.
- No `unported(...)` calls, and none needed: every in-scope fn is ported, and the cfg-off and SIMD fns carry
  `crate-skip` with reasons.

## Findings

1. `src/vendor/twox_hash/xxhash3/streaming.ts:161` (`SecretBuffer.allocate_with_seed_and_secret`) and
   `xxhash3_128.ts:148` (`Hasher.with_seed_and_secret`), non-blocking.
   - Upstream takes `secret: impl Into<Box<[u8]>>`. For a `&[u8]` argument that copies into a fresh Box, so
     later mutation by the caller cannot affect the hasher.
   - The port stores the caller's `Uint8Array` as is, so the hasher aliases it. The oracle test hides this
     by passing `.slice()`.
   - No compiler user exists (encoder.rs only uses `XxHash3_128::new()`), so the risk is nil today.
   - Fix: copy in the ctor, or add a `// PORT:` noting that ownership passes to the hasher.

2. `tools/probes/xxh3/main.rs` `stream` (and its mirror in `xxhash3_128.oracle.test.ts`), non-blocking.
   - If every size in `<chunks>` is 0 and the data is non-empty, the loop never ends.
   - No chunking in the test does this (`[0, 5]` is fine).
   - A guard, or a doc note that a chunking must contain a non-zero size, would make the probe robust for
     future callers.

3. `src/vendor/twox_hash/xxhash3/streaming.ts:193,201`, `xxhash3_128.ts:436`, `large.ts:81`, non-blocking.
   - The `dispatch!` macro-input "fns" (`streaming.rs:176 write_impl`, `:188 finish_impl`,
     `xxhash3_128.rs:418 oneshot_impl`) and `large.rs:29 do_scalar` have markers above call sites or the
     shared `do_scalar` rather than above distinct fn definitions.
   - This is the honest mapping for macro expansions. It is documented in the handoff and the PORT headers,
     and `coverage --check` accepts it.
   - Noted only so root knows these markers are intentionally at use sites.

4. Coverage of `xxhash32.rs`, `xxhash64.rs`, `xxhash3_64.rs` (0/143 fns): non-blocking, root decision.
   - These modules are compiled out (`cfg(feature = ...)` not enabled by rustc_metadata).
   - The lane already uses `crate-skip` for the `xxhash3_64`-gated items in secret.rs and large.rs.
   - Marking the three files `crate-skip` with the same reason would be consistent and bring the crate to
     340/340.
   - I recommend root records that decision and a small follow-up adds the markers. Not a defect of this lane,
     which was scoped to its named files.

5. `src/vendor/twox_hash/xxhash3/streaming.ts:166` (`clone_SecretBuffer`), non-blocking, informational.
   - It deep-copies `secret` even when upstream's `S` is a shared reference (`&'static [u8; N]`).
   - This gives the same value, because the secret is never written after construction. Equivalent; no change
     needed.

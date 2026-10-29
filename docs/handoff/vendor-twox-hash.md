# Handoff: vendor-twox-hash (vendor twox-hash 2.1.2, XXH3-128 scalar path; plan-m5 D8)

Branch `lane/vendor-twox-hash`, on top of main `644cc1e0`.

## Files
- `harness/scope.json` (**harness change, needs root's review**): one line, `vendor` gains `"twox-hash": "=2.1.2"`.
  This is the version in upstream's Cargo.lock that compiler/rustc_metadata uses (`twox-hash = { version = "2",
  default-features = false, features = ["xxhash3_128", "std"] }`). rustc_sanitizers' 1.6.3 is not in scope.
- `src/vendor/twox_hash/` (new):
  - `lib.ts`: lib.rs, i.e. the `IntoU32`/`IntoU64`/`IntoU128` traits and the `xxhash3_128` / `XxHash3_128` exports.
  - `xxhash3.ts`: xxhash3.rs, i.e. the primes, the default secret, `derive_secret`, the 1–3 and 17–128 helpers,
    `mix_step`, `avalanche*`, `X128`, the `Halves`/`U8SliceExt`/`SliceBackport` traits, plus small u64/u128
    `wrapping_*` helpers.
  - `xxhash3/secret.ts`: secret.rs.
  - `xxhash3/large.ts`: large.rs, i.e. `Algorithm`, `Vector`, `INITIAL_ACCUMULATORS` and the `dispatch!` scalar arm as `do_scalar`.
  - `xxhash3/large/scalar.ts`: scalar.rs.
  - `xxhash3/streaming.ts`: streaming.rs, i.e. `SecretBuffer`, `RawHasherCore`, `write_impl`/`finish_impl`,
    `Finalize`, `StripeAccumulator` and the error types; the `with_alloc` constructors are static methods.
  - `xxhash3_128.ts`: xxhash3_128.rs, i.e. `Hasher` (oneshot*, new/with_seed/with_seed_and_secret/write/finish_128),
    `RawHasher`, `Finalize128` and all the size paths.
  - Tests: `xxhash3.test.ts`, `xxhash3/streaming.test.ts` and `xxhash3_128.test.ts` are the crate's own `#[cfg(test)]`
    modules with all its vectors. `xxhash3_test_util.ts` holds `gen_bytes`/`bytes!`. `xxhash3_128.oracle.test.ts`
    is the oracle test.
- `tools/probes/xxh3/` (new probe): `Cargo.toml.in` + `main.rs`.
  - It is a **registry-dependency probe** (`twox-hash = "=2.1.2"` with rustc_metadata's features,
    `lockfile = "upstream"`), not a rustc-dev one. The sysroot ships two `twox_hash` rmetas (1.6.3 and 2.1.2), so
    `extern crate twox_hash` fails with E0464 (multiple candidates), and a rustc-dev manifest may not add `--extern`.
  - Built for the host, it runs the crate's SIMD path (neon here, avx2/sse2 on x86_64), so the oracle test also
    shows that the scalar port gives the same digest.
  - Build it with `bun scripts/probes.ts build xxh3`.
- `docs/handoff/vendor-twox-hash.md` (this file).

## Coverage (`bun scripts/coverage.ts --crate twox-hash`)
| file | covered |
|---|---|
| lib.rs | 8/8 |
| xxhash3.rs | 36/36 |
| xxhash3/large.rs | 14/14 (`do_neon`/`do_avx2`/`do_sse2` and `finalize_64` are crate-skip) |
| xxhash3/large/scalar.rs | 4/4 (the aarch64 `umaddl` asm `multiply_64_as_32_and_add` is crate-skip) |
| xxhash3/large/{neon,avx2,sse2}.rs | 7/7, 5/5, 5/5 (all crate-skip: SIMD, same digest, plan-m5 D8) |
| xxhash3/secret.rs | 31/31 (`for_64` and `Secret64BitView`'s 8 fns are crate-skip: `cfg(feature = "xxhash3_64")`) |
| xxhash3/streaming.rs | 36/36 |
| xxhash3_128.rs | 51/51 |
| xxhash32.rs, xxhash64.rs, xxhash3_64.rs | 0/46, 0/44, 0/53: features rustc_metadata does not enable, so not in the lane |

Total: 197/340 fns (57.94%).

**Root to decide:** whether the three unused modules should get `crate-skip` markers
(`cfg(feature = ...)` not enabled), which would bring the crate to 340/340. I did not add them: the lane named its files.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (22798; vendor 4680).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/vendor/twox_hash`: 27 pass, 0 fail. The 22 crate tests are all of
  xxhash3_128.rs's vectors (0/1–3/4–8/9–16/17–128/129–240/241+ bytes, each oneshot and byte-by-byte streaming) and
  the other crate tests. The 5 oracle tests are:
  - oneshot of every length 0..=1100 and of ±{1,63,64,65} around 1..6 blocks (1,161 cases);
  - `oneshot_with_seed` / `_with_secret` / `_with_seed_and_secret` at 33 boundary lengths × 5 seeds × 8 secret
    lengths, including 135-byte too-short secrets (693 cases);
  - the streaming `Hasher` (`new`, `with_seed`, `with_seed_and_secret`) under 12 chunkings over 19 lengths, with
    `finish_128` after every write (342 cases);
  - generated 64 KiB–9 MiB inputs, oneshot and in 64 KiB and odd-sized writes (12 cases);
  - a pinned digest that always runs.
- Mutation check: I broke `round_scramble`'s `>> 47`, and separately made `finish_impl` work on the live
  `StripeAccumulator` instead of a copy. The oracle test failed both times, and the files were restored.
- Sample difftest: `mir --sample 200`, `RUST_TS_AGENT=root-f5de` (run 20261029-104239-root-f5de-904c): 195 MATCH,
  0 DIFF, 3 UNPORTED, 2 UNSTABLE. Before and after are identical by construction: no module outside
  `src/vendor/twox_hash` imports it, so no compiler path changed.

## u64 representation (measured, D8)
The bench scripts are kept outside the tree at `$RUST_TS_DATA/tmp/w30/twox/bench.ts` and `bench2.ts`
(`bun bench.ts <repo> <core rmeta>`). Setup: the first 54 MiB of the oracle's `libcore-*.rmeta` (67.8 MB on this
aarch64 host), fed through the same `process_stripe` driver in 64 KiB writes (FileEncoder `BUF_SIZE`), on bun 1.4.3
and an Apple M4 Pro.

| lanes | time | throughput |
|---|---|---|
| u32 pairs (`Uint32Array(16)`, kept) | 0.27–0.28 s | ~205 MB/s |
| `bigint` per lane, fastest form (`DataView.getBigUint64` reads) | 0.52 s | ~110 MB/s |

Other measurements:
- The port end to end: `Hasher.write` ×864 + `finish_128` takes 0.27–0.28 s; `Hasher.oneshot` takes 0.27 s. Both give
  the same digest.
- The per-stripe `subarray` views cost 0.03 s of that, so slices stay views (faithful) and are not offsets.

Only the accumulators are pairs. Every other u64 (per-hash scalars, `final_merge`, the small-input paths) is `bigint`.
This is recorded in the `// PORT:` header of `xxhash3/large.ts`.

## unported(...) left
None.

## // PORT: decisions
- lib.ts:
  - Import the crate only through `lib.ts`. `xxhash3.ts` must evaluate before `large.ts`/`streaming.ts` (they read
    its constants at module level), so `xxhash3.ts` imports only `secret.ts`.
  - xxhash3.rs's `pub use` re-exports are therefore not repeated; users import from the submodule.
- Types: u64 is `bigint` masked to 64 bits (the `u64_wrapping_*` helpers), u128 is `bigint`, and u8/u32/usize are
  `number`. `&[u8]`/`&[u8; N]` are `Uint8Array` `subarray` views, so `&mut` chunk writes go through.
- `SliceBackport` (`bp_as_chunks{,_mut}`, `bp_as_rchunks`): free functions taking `(slice, N)`. Bytes become views;
  arrays of chunks become new arrays.
- large.ts:
  - The `[u64; 8]` accumulators are `Acc` u32 pairs (measured, above). By-value `[u64; 8]` is copied with `slice()`.
  - Only the scalar `Vector` is ported: `dispatch!` is `do_scalar(fn, ...args)`, and its macro-input fns
    (xxhash3_128.rs:418 `oneshot_impl`, streaming.rs:176 `write_impl`, :188 `finish_impl`) are marked at the use sites.
- scalar.ts:
  - The hot loop is written out on (lo, hi) halves.
  - Stripe and secret 8-byte chunks are read in place, without materialising `bp_as_chunks::<8>`.
  - `multiply_64_as_32_and_add` takes the low 32 bits of `lhs`/`rhs` and writes into acc lane `i`.
  - Upstream compiles the aarch64 `umaddl` variant there. The portable `cfg(not(target_arch = "aarch64"))` variant
    is ported and the asm variant is crate-skip: same value.
- secret.ts: `Secret([u8])` is a class over the `Uint8Array`. `reassert_preconditions` is a no-op, keeping
  `debug_assert!` as a comment, and `assert_unchecked` is an optimizer hint only.
- streaming.ts:
  - `S: FixedBuffer` is always a `Uint8Array`.
  - `#[derive(Clone)]` / `#[derive(Copy, Clone)]` are hand-written `clone_<Type>`. This is load-bearing:
    `finish_impl` works on a copy of `StripeAccumulator`, so `finish_128` does not change the hasher.
- `DEFAULT_SECRET_RAW` is shared and never written; `let mut secret = DEFAULT_SECRET_RAW` becomes `slice()`.
- Tests:
  - `is_clone` (a compile-time `Clone` check) is a runtime test of `clone_Hasher`.
  - `gen_bytes`/`bytes!` live in `xxhash3_test_util.ts`. Importing a `*.test.ts` would register its tests twice.

## Where XXH3-128 is used upstream, and where to wire it
- The only user in the compiler is **compiler/rustc_metadata/src/rmeta/encoder.rs**. `rustc_hashes` and
  `StableHasher` stay SipHasher128; rustc_sanitizers uses twox-hash 1.6.3 `XxHash64`, which is out of scope.
- The SVH (crate hash) is the XXH3-128 of every flushed metadata byte, by default (`-Z metadata-crate-hash`):
  - `:46` `use twox_hash::XxHash3_128;` and `:54` the `EncodeContext.metadata_hasher` field.
  - `:2677` `with_encode_metadata_header` (or `encode_metadata`'s body) creates `XxHash3_128::new()`.
  - `:2690` then `write`s the 16 LE bytes of the supplement fingerprint, i.e. the `StableHasher` of
    `dep_tracking_hash(true)` + `compute_hir_hash`.
  - `:2694–2701` installs `FileEncoder::with_flush_strategy(path, |bytes| hasher.write(bytes))`. This is already
    ported in `src/rustc_serialize/opaque.ts:95`.
  - `:836–840`: after `self.opaque.flush()`, the SVH is `Svh::new(Fingerprint::from_le_bytes(finish_128().to_le_bytes()))`.
    `Fingerprint.from_le_bytes` exists in `src/rustc_data_structures/fingerprint.ts:114`. A u128 `to_le_bytes`
    (16 bytes, LE) is still needed at the call site.
- In TS: `import { XxHash3_128 } from "../../vendor/twox_hash/lib.ts"`, then `XxHash3_128.new()`,
  `.write(Uint8Array)` and `.finish_128(): bigint`. `Arc<Mutex<..>>` is just the shared object.
- **Not wired**: `src/rustc_metadata/rmeta/encoder.ts` does not exist yet. The work goes to wave 33 `encoder-a`
  (the struct field, :54) and `encoder-d` (`encode_metadata` / `with_encode_metadata_header` / SVH, :2677 and :836).

## For root
- Review the one-line `harness/scope.json` vendor addition.
- Decide whether xxhash32/xxhash64/xxhash3_64 get `crate-skip` (cfg-gated features), as described under Coverage.
- The new probe `xxh3` is not rustc-dev, so it needs crates.io access the first time it builds (or a warm cargo
  cache). It was built here: `$RUST_TS_DATA/target/probes/release/xxh3`.

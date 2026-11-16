# Review: lane cargo-fix-a (independent, read-only)

Reviewed: branch `t3/add-aarch64-cargo-intrinsics`, commit `9009c1ef` (parent `c3a5c9ac`), against the pinned LLVM sources in
`$RUST_TS_DATA/llvm-src/aab11ee0…/` (`IntrinsicsAArch64.td` SHA-256 `8200e34f…d78b`, equal to `harness/llvm-manifest.json`).
Scope per `docs/plan-m8.md` D22 and §8 wave 41 step 5. Scratch is in `$RUST_TS_DATA/tmp/review-cargo-fix-a/`.

## Verdict: **PASS WITH NOTES**

All 22 signatures match the pinned `.td` line for line, and the oracle test checks each of them against libLLVM.dylib. Two
mutations prove that test bites. The new fixed-vector decode is LLVM's `IITDescriptor::Vector` case. My re-run of the per-crate
proof reproduces the handoff: `crc32fast` is byte-identical, and in `sha1`/`sha2` every intrinsic declaration and call matches.
The only remaining differences are the inliner-suffix and alloca-order swaps of pm-self F1. No regression in a different
`ir-run-pass` sample. The notes are minor and none blocks acceptance.

## What was checked

**1. Fidelity to LLVM.** Each of the 22 cited `td:` lines was read in the pinned `IntrinsicsAArch64.td`:
- `sha1c/p/m` at 838-840 are `Crypto_SHA_5Hash4Schedule_Intrinsic` (:771-773), `[v4i32] <- [v4i32, i32, v4i32]`.
- `sha1h` at 841 is `Crypto_SHA_1Hash_Intrinsic` (:777-778), `[i32] <- [i32]`.
- `sha1su0` at 843 is `Crypto_SHA_12Schedule` (:785-787), three `v4i32`.
- `sha1su1` at 844 is `Crypto_SHA_8Schedule` (:781-782), two `v4i32`.
- `sha256h`/`h2` at 847/848 are `Crypto_SHA_8Hash4Schedule` (:790-792), three `v4i32`.
- `sha256su0` at 849 is `8Schedule`, two `v4i32`.
- `sha256su1` at 850 is `12Schedule`, three `v4i32`.
- `sha512h`/`h2`/`su1` at 861/862/864 are `Crypto_SHA512_3Arg` (:799-801), three `v2i64`.
- `sha512su0` at 863 is `Crypto_SHA512_2Arg` (:795-796), two `v2i64`.
- `crc32{b,cb,h,ch,w,cw}` at 882/884/886/888/890/892 are `[i32] <- [i32, i32]`.
- `crc32{x,cx}` at 894/896 are `[i32] <- [i32, i64]`.
- `llvm_v4i32_ty` is `Intrinsics.td:675` and `llvm_v2i64_ty` is `:688`, as cited.

All return and parameter types, all line numbers, and the class line ranges in the block comment (771-801, 882-897) are right.
None of these is overloaded, so none takes an overload slot. `overloadClasses` and `descriptors` handle a `vec` correctly through
their default branches.

`decodeFixedType`'s new arm returns `ctx.getVectorType(fixed(t.elt), t.n, false)`. LLVM's `Intrinsics.cpp:576-578` is
`case IITDescriptor::Vector: return VectorType::get(DecodeFixedType(Infos, OverloadTys, Context), D.VectorWidth);`. That is a
recursive decode of the next descriptor (the element) with a fixed `ElementCount`, so the logic is the same. `Context::
getVectorType` (`ir.ts:2005`) uniques by element id, width and scalable flag, as LLVM's `VectorType::get` does. The existing
`// llvm: llvm/lib/IR/Intrinsics.cpp:538 DecodeFixedType` marker covers the function. No new function was added, so no new marker is
due. `coverage.ts --check`: markers ok (27358; llvm 676). No guessed value was found, and the unported stop for unmodelled
signatures is unchanged (the new test checks `crypto.rax1` still stops).

**2. Scope.** The source of the three crates as cargo `29c5daa1` locks them (`crc32fast 1.5.0`, `sha1 0.11.0`, `sha2 0.11.0`, plus
`cmov`, `ctutils`, `cpufeatures`) calls exactly 16 aarch64 intrinsics:
- `__crc32b` and `__crc32d` (`crc32b`, `crc32x`);
- `vsha1{c,p,m}q_u32`, `vsha1h_u32`, `vsha1su{0,1}q_u32`;
- `vsha256h{,2}q_u32`, `vsha256su{0,1}q_u32`;
- `vsha512h{,2}q_u64`, `vsha512su{0,1}q_u64`.

The oracle's `--emit=llvm-ir` declares exactly these 16 and no other `llvm.aarch64.*`. No `veor3`/`vbcax`/`vrax1`/`vxar`
(SHA3), AES or SM3/SM4 call appears, though this host's target features (apple-m1: `sha3`, `aes`, `crc`) would allow them.
`sha512h` is the same kind of stop as the brief's three: `sha2`'s first stop on `sha256h` hid it. plan-m8 §4b's measurement
had 389 of 392 calls exit 0, so nothing else in cargo's graph is known to stop on a signature yet.

**3. Tests.**
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rust_ts/llvm/` with `.env.local` present gives 231 pass and 0 fail.
  `intrinsics.oracle.test.ts` alone gives 9 pass. Output in `llvm-tests.txt`.
- The oracle test "LLVMGetIntrinsicDeclaration: name and function type of every modelled signature" loops over
  `MODELLED_SIGNATURES = [...SIGNATURES.keys()]`, so it covers all 22. Each one is compared against libLLVM's declaration by name
  and printed type.
- **Mutation check** (reverted afterwards; the tree is equal to `9009c1ef` in `src/`):
  - `v2i64` changed to width 4: the oracle test fails on `llvm.aarch64.crypto.sha512h`.
  - `crc32cx`'s second parameter changed to `i32`: the oracle test fails on `crc32cx`.
  - The model-only test failed too in both cases.
- The model-only test pins printed types for 8 entries, one or two per family, both CRC shapes and both vector widths. It
  also checks that a neighbour stops. Its value is on hosts without the oracle dylib, where the oracle test skips. There it is a
  real guard on the decode (it caught both mutations). On the root host it is redundant with the oracle test, which is fine.

**4. Proof re-run.** I copied the lane's `proj/`, `cargo-home/` and `bin/` to my scratch dir, changing only `T`. I ran
`build-side.sh {oracle,port} {0,1}` with `WT` set to this review worktree, whose `src/` was set to `9009c1ef`'s. All four cargo
runs exit 0, and every call to the three crates exits 0 on both sides.
- **e0, cargo's exact flags:**
  - Every file under `build/crc32fast/**` is byte-identical, including the `.rlib`, the `.o`, the `.rmeta`, the `.d` and the
    build-script outputs.
  - In `sha1`, the `.rmeta`, the `.d` and the fingerprints are the same. `cgu.0.rcgu.o` differs at the same size
    (181536 bytes), and so does the `.rlib` that contains it.
  - In `sha2`, `cgu.0` and `cgu.1` are the same. `cgu.2` differs at the same size (240472 bytes), and so does the `.rlib`.
  - The three crates' diagnostics (stderr logs) are identical on both sides.
  - This matches the handoff's table exactly.
- **e1, IR** (`bin/review-ir.ts`, my script on the project's `normalForm` and `firstIrDifference`):
  - `crc32fast`: N2 and N3 are SAME. N1 differs first at `%self.dbg.spill.i2` against `.i1`.
  - `sha1` and `sha2`: N1, N2 and N3 differ first in `hybrid_array::Array::split`. The first difference is
    `store ptr %17, ptr %3` against `ptr %4`: two unnamed allocas swapped.
  - At N1, with the inliner suffixes `(\.i\d*)+` removed, every group matches as a line multiset: all 83/83, 103/103 and
    144/144 functions plus the module-level lines (declarations, attributes, metadata).
  - The raw `.ll` files have identical `declare … @llvm.aarch64.*` lines (2, 6 and 8) and identical call counts per intrinsic.
  - So the signatures are not the cause. The differences are pm-self F1 (use-list order lost through `opt`, so the
    AlwaysInliner visits call sites in another order). `docs/next.md` queues that as the `uselistorder` directives item.

**5. Regression.**
- `RUST_TS_AGENT=review-cargo-fix-a bun scripts/difftest.ts --suite ir-run-pass --sample 200 --jobs 4` (tier N1,
  run `20261115-235513-review-cargo-fix-a-3gsk`): **196 MATCH, 0 DIFF, 4 UNPORTED**, 0 CRASH, 0 TIMEOUT.
  - My sample differs from the lane's (`cargo-fix-a`).
  - Of the 3430 protected cases, 196 were sampled, and all 196 MATCH.
  - The 4 UNPORTED cases are all unprotected, known stops unrelated to this lane:
    - `extern/issue-64655-extern-rust-must-allow-unwind.rs#fat2` and `#fat3` stop on the fat-LTO merged named struct types;
    - `sanitizer/cfi/closures.rs#cfi` and `sanitizer/cfi/async-closures.rs#cfi` stop on `rustc_sanitizers` (out of scope).
- `bunx tsc --noEmit -p .`: clean (exit 0, no output). I ran it after `bun install --frozen-lockfile`; the fresh worktree had no
  `node_modules`, and without it tsc fails with TS2688 on the `bun` types.

## Findings

1. **Note (handoff accuracy).** The handoff says the model-only test "pins the printed types of six of them". It pins
   eight: `crc32b`, `crc32cx`, `sha1h`, `sha1c`, `sha256h`, `sha256su0`, `sha512h` and `sha512su0`. This has no effect on the
   code.
2. **Note (switch order, cosmetic).** In LLVM's `DecodeFixedType` the cases run `Metadata` … `Integer`, `Vector`, `Pointer`.
   The port's inner `fixed` switch runs `int`, `ptr`, `metadata`, then the new `vec`. That order was already off before this lane,
   and the new arm went at the end rather than between `int` and `ptr`. The arms are disjoint, so behaviour is the same. A
   later touch could reorder to LLVM's order, per PORTING §3 ("same order").
3. **Note (scope beyond reach, accepted).** 6 of the 22 entries are not reached by the three crates: `crc32cb`, `crc32h`,
   `crc32ch`, `crc32w`, `crc32cw` and `crc32cx`. Adding whole families goes beyond the brief's three names. They come from the
   `.td`, nothing is guessed, and the oracle test checks each one, so the risk is nil. SHA-512 was also outside the brief, but
   `sha2` reached it, as item 2 above shows. Root should record that the brief's "three signatures" grew to 22 (16 reached).
4. **Note (proof setup is not cargo's full graph).** As the handoff says, `sha1`/`sha2`'s `-C metadata` hashes differ from
   plan-m8's logged build, because the scratch graph does not reproduce `libc`'s features. The flags that affect codegen are the
   same, and D22 defers the end-to-end check to `cargo-build`. I add one expectation for that run, as the handoff does: until the
   `uselistorder` lane lands, a byte comparison of `sha1`/`sha2` rlibs will DIFF from pm-self F1, not from this lane.
5. **Note (worktree environment).** In a worktree without `.env.local`, `bun test src/rust_ts/llvm/` prints a WARNING and
   skips the probe-dependent tests. With `RUST_TS_DATA` and `RUST_TS_HOST_TUPLE` exported it still prints that warning. I copied
   `.env.local` from the main checkout (it is gitignored) before the counted run. The lane's numbers (231/0) match mine with
   `.env.local` present.

No FAIL-level finding.

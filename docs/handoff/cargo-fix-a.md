# Handoff: cargo-fix-a (M8 wave 41, step 5): the aarch64 CRC32 and SHA intrinsic signatures

Branch `t3/add-aarch64-cargo-intrinsics` (from `c3a5c9ac`; no merges). Only `src/rust_ts/llvm/intrinsics.ts`,
`src/rust_ts/llvm/intrinsics.oracle.test.ts` and this file. **No harness touch**: `IntrinsicsAArch64.td` was already pinned in
`harness/llvm-manifest.json` (lane ir-fix-b), so `llvm-src.ts add` was not needed. No `scripts/`, `scope.json` or baseline change.
No cargo-build run and no build of cargo (D20, D22).

## What changed
- **The signatures** (`SIGNATURES`, intrinsics.ts), written from `IntrinsicsAArch64.td` at the pin, cited per entry. That is
  where the port keeps them; the signature table is hand-written, not generated. `gen_intrinsics_aarch64.ts` generates only the
  name table, which already had all 580 aarch64 names, so nothing was regenerated.
  - CRC32, all eight (td:882-897): `crc32{b,h,w,cb,ch,cw}` are `i32 (i32, i32)`, `crc32{x,cx}` are `i32 (i32, i64)`.
  - SHA-1, all six (td:838-844): `sha1{c,p,m}` are `<4 x i32> (<4 x i32>, i32, <4 x i32>)`, `sha1h` is `i32 (i32)`, `sha1su0` takes
    three `<4 x i32>`, `sha1su1` takes two.
  - SHA-256, all four (td:847-850): `sha256h`, `sha256h2` and `sha256su1` take three `<4 x i32>`, `sha256su0` takes two.
  - SHA-512, all four (td:861-864): `sha512h`, `sha512h2` and `sha512su1` take three `<2 x i64>`, `sha512su0` takes two. This
    family was **not in the brief**. It is the same kind of stop, reached by `sha2` once `sha256h` was fixed (see Proof).
  - I added whole families, not just the members the three crates reach, so siblings that other code reaches don't each need
    a lane. The oracle's IR of the three crates declares 16 of these 22: `crc32b`, `crc32x`, all six SHA-1, all four SHA-256 and all
    four SHA-512.
- **A fixed vector type in the signature model.** The new `TdType` variant `{ k: "vec", n, elt }` covers `llvm_v4i32_ty`
  (Intrinsics.td:675) and `llvm_v2i64_ty` (Intrinsics.td:688). `decodeFixedType` decodes it as `DecodeFixedType`'s
  `IITDescriptor::Vector` case does: `VectorType::get(<element>, D.VectorWidth)` (Intrinsics.cpp:576), fixed width. Until now
  the model had only overloaded vectors.
- **Tests.** `intrinsics.oracle.test.ts` already checks every `SIGNATURES` entry against libLLVM.dylib's
  `LLVMGetIntrinsicDeclaration` (name and function type), so all 22 new entries are checked against the oracle. I also added a
  model-only test that pins the printed types of six of them (`i32 (i32, i32)`, `i32 (i32, i64)`, `<4 x i32> (...)`,
  `<2 x i64> (...)`) and checks that a neighbour outside the families (`crypto.rax1`) still stops.

No `unported(...)` was added or removed. The existing stop for a signature the model lacks is unchanged. No `// PORT:` decisions.

## Proof (D22): `crc32fast`, `sha1` and `sha2` alone, port against oracle
Setup in `$RUST_TS_DATA/tmp/cargo-fix-a/` (153 MB):
- `proj/` is a scratch crate whose `Cargo.lock` is cargo `29c5daa1`'s (cargo pruned it to the 15 packages used, versions
  unchanged). It depends on `crc32fast =1.5.0`, `sha1 =0.11.0` and `sha2 =0.11.0` (features `alloc`, `oid`), plus
  `hmac =0.13.0`, so that `digest 0.11.3` gets `mac` (and with it `ctutils`/`cmov`) as in cargo's graph.
- `cargo-home/` holds the sources, fetched by the oracle's cargo (`nightly-2026-10-11`, `RUSTUP_AUTO_INSTALL=0`).
- `sha1 0.10.6` is in the lock too, but it compiled under the port in the plan's measurement (no aarch64 intrinsics without
  its `asm` feature). The stopping `sha1` was 0.11.0.

**Same flags as cargo's build.** `bin/build-side.sh <oracle|port> <0|1>` runs the oracle's
`cargo build --offline --locked -j1` (dev profile, `CARGO_INCREMENTAL=0`) with `RUSTC=bin/rustc-side.sh`. That wrapper sends
only `crc32fast`, `sha1` and `sha2` to the side's compiler: the port is `bun <worktree>/src/rust_ts/main.ts --sysroot <oracle
sysroot>`, as plan-m8's `rustc-port.sh` runs it. Every other call (dependencies, the build script, probes) goes to the oracle
(plan-m7 §3). So cargo supplies the argv, env and cwd on both sides.
- Both sides build at one absolute target path, then move to `kept/<side>-e<n>`, as rg-build does.
- Mode `e0` is cargo's flags unchanged. Mode `e1` appends `--emit=llvm-ir` to the three crates on both sides, for the IR.
- The argv matches plan-m8's logged port build (`port-build.err`):
  - `crc32fast`: identical, `-C metadata=5544f9e267f9e7d2` and the build script's `--cfg stable_arm_crc32_intrinsics` included.
  - `sha1`/`sha2`: identical except the `-C metadata`/`extra-filename` hashes. Their dependency hashes differ because the scratch
    graph does not reproduce `libc`'s features in cargo's full graph (cpufeatures' hash). Features, cfgs, edition, `-Z
    embed-metadata=no`, `-C debuginfo=2`, `-C split-debuginfo=unpacked`, `--cap-lints allow` and the externs are the same.

**With the first draft** (CRC32, SHA-1 and SHA-256 only), `crc32fast` and `sha1` compiled, and `sha2` stopped next on
`llvm.aarch64.crypto.sha512h`, so I added the SHA-512 family.

**Results, e0 (cargo's exact flags):**

| Crate | Exit (oracle / port) | Diagnostics (stdout, stderr) | `.rmeta` | `.d` | `.rlib` | Objects |
|---|---|---|---|---|---|---|
| `crc32fast` 1.5.0 | 0 / 0 | same | same | same | **same bytes** | same (1 CGU) |
| `sha1` 0.11.0 | 0 / 0 | same | same | same | differs only in its object member | cgu.0 differs (653 bytes, same size) |
| `sha2` 0.11.0 | 0 / 0 | same | same | same | differs only in its object member | cgu.0, cgu.1 same; cgu.2 differs (same size) |

- Inside the rlibs, `lib.rmeta`, `lib.rmeta-link` and `__.SYMDEF` are the same in all three. Member list and order are the same.
- cargo's stdout is the same; its stderr is the same once the `Compiling` lines are sorted (rg-build sorts them) and the
  `Finished` time is dropped.
- The oracle is deterministic here: a second oracle build gave the same objects.
- Port cost per compile: 1.7 s / 886 MiB, 2.0 s / 921 MiB, 5.6 s / 1,376 MiB (oracle 0.05-0.22 s).

**Results, e1 (IR, `bin/ir-cmp.ts`, the IR suites' normal forms from `scripts/lib/ir-normal.ts`):**

| Crate | N1 | N2 | N3 | Every function, as a multiset of lines with the inliner's `.i<n>` suffixes removed |
|---|---|---|---|---|
| `crc32fast` | differs (10 lines: `%self.dbg.spill.i2` vs `.i1`) | same | same | 83/83 same |
| `sha1` | differs | differs | differs | 103/103 same |
| `sha2` | differs | differs | differs | 144/144 same |

**Further stop found: none.** All three compile through the port. **Further mismatch found (recorded, not the same kind, not
fixed):** the remaining IR and object differences are **pm-self F1, use-list order lost through `opt`**
(docs/handoff/pm-self.md "F1"; docs/next.md queues it as "`uselistorder` directives (waits, decision recorded)").
- The model prints its module and the pinned `opt` re-parses it. The parser builds use-lists in its own order.
- At `-Copt-level=0`, LLVM's AlwaysInliner walks `F.users()`, so it inlines one callee's call sites in another order than
  rustc's in-process run. That gives different `.i<n>` suffixes and a different alloca order in the entry block.
- The first N2 difference is in `hybrid_array::Array::split`: two inlined `self.dbg.spill` slots swap (`store ptr %17, ptr %3`
  against `%4`).
- `bin/multiset.ts` shows nothing else: with those suffixes removed, every function of all three modules has the same lines as
  the oracle's.
- In the objects, stack slots swap at equal size (pm-self's "Bytes of objects ... differ whenever a function has two or more
  always-inline call sites of one callee").
- Behaviour is unaffected, but **a protected `cargo-build` that compares rlib bytes would show these three as DIFF until the
  `uselistorder` lane lands.** (rg-build compares names, dep-info and build-script outputs, not rlib bytes, so the same may hold
  for cargo-build's design; harness-m8a-build decides.)

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (27358; llvm 676). No marker added: the change is table data and one `switch` arm in
  `decodeFixedType`, whose existing `// llvm:` marker stands. Per PORTING §5c, `// llvm:` markers count in no coverage figure, and
  `coverage.ts --missing` takes no llvm-project path, so there is no per-file number to give.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rust_ts/llvm/`: **231 pass, 0 fail** (`intrinsics.oracle.test.ts` 9 pass, against
  libLLVM.dylib). `bun test src/rustc_codegen_llvm`: 174 pass, 0 fail.
- Sample difftests (`RUST_TS_AGENT=cargo-fix-a`, `--sample 200 --jobs 4`, tier N1):
  - **ir-run-pass: 198 MATCH, 0 DIFF, 2 UNPORTED** (run `20261115-234705-cargo-fix-a-fwyo`).
  - **ir-host (the aarch64 host IR suite): 198 MATCH, 0 DIFF, 2 UNPORTED** (run `20261115-234816-cargo-fix-a-w2cy`).
  - In both, all 198 sampled protected cases MATCH, so none was lost.
  - The 2 UNPORTED in each are unprotected, known stops:
    - `extern/issue-64655-allow-unwind-when-calling-panic-directly.rs#thin` (ThinLTO, plan-m7 D8);
    - `lto/lto-still-runs-thread-dtors.rs` (ir-fix-b's fat-LTO merged-types stop).

## For root
- The end-to-end check through `cargo-build` waits on D20 (D22), and so does any further signature that run reaches.
- When that run comes, expect `crc32fast` to be byte-identical, and `sha1`/`sha2` to differ in one object each from pm-self F1
  unless the `uselistorder` lane has landed.
- The proof setup can be re-run with
  `WT=<worktree> $RUST_TS_DATA/tmp/cargo-fix-a/bin/build-side.sh <oracle|port> <0|1>`, then `bun <...>/bin/ir-cmp.ts e1`
  (it imports `scripts/lib/*` by this worktree's absolute path; edit `WT` in it to reuse it).

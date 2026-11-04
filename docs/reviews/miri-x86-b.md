# Review: miri-x86-b (M6 wave 38: x86 AVX, AVX2, AVX-512, AES, BMI, GFNI, SHA intrinsics)

**Verdict: APPROVE WITH NITS.** No correctness finding in the port. Nothing below blocks the merge. All findings are
low severity: one gap in the tests and fixtures, four in the handoff, the end-to-end script and the integration branch.

Reviewed: `t3/port-miri-x86-intrinsics-1` at `0837513a` (merge base `c9d3c553`), against upstream
`src/tools/miri/src/intrinsics/x86/` at the pin. The branch has since moved to `2cd2817a`, which only edits the handoff.
The integration branch has moved from `07c3ecaf` to `2bac277e`, which merges x86-a's `dee9e4fa`. x86-a's own later
`45a51f79` also only edits its handoff. I checked both integration heads.

## The evidence that decides it

All of this ran on a scratch merge of `2bac277e` with miri-tail-a's `02e53812`, so with the **real** `-C target-feature`
and through the real `src/miri/bin/miri.ts` entry. There was no patch and no `driver.mts`. Load average was about 25-45.

| Check | Result |
|---|---|
| The lane's 24 fixtures (`e2e.ts --jobs 4 --timeout-ms 3300000`) | **MATCH=23 DIFF=0 TIMEOUT=0 UNPORTED=1** (`aes_rounds`, as expected) |
| Upstream's `tests/pass/shims/x86`: bmi, sha, avx, avx2, avx512, gfni | **6/6 exit 0, empty stdout and stderr**, the same as the oracle |
| Upstream's `intrinsics-x86-aes-vaes.rs` | exit 70, `aes::hazmat::equiv_inv_cipher_round` (D5). The oracle exits 0 |
| Five deliberate bugs against those upstream tests (pdep, psign, gather scale, pternlog, rnds2) | 5/5 caught, exit 101, so their passes are meaningful |
| `bun test src/miri/intrinsics/x86 src/miri/contract.test.ts` | 46 pass, 0 fail (387 s wall, 288 s user) |
| `bunx tsc --noEmit -p .` | no errors |

Fixture wall times: bmi 819 s, sha 423 s, gfni 1,487 s, avx 1,695 s, avx512 1,705 s, avx2 2,774 s.
Upstream test wall times: 12-43 s, except gfni at 326 s.

## Findings

**F1. Low. `src/miri/intrinsics/x86/fixtures/avx2.rs:73-80`, `x86b.test.ts:143`: a negative 64-bit gather offset is never
read, and the direct test cannot see a wrong sign on 32-bit offsets.**
Handoff line 55 says the fixtures cover negative offsets. Across all 41 gather lines, negative offsets on an enabled lane
are 20 for 32-bit offsets and **0 for 64-bit offsets**. All 30 negative 64-bit offsets sit on masked-off lanes (`oq2`,
`oq4` against `m2q`, `m4q`, `m4`). The direct test also compares addresses only modulo 256, because `mem_copy` stores
`src.addr + i` into a `Uint8Array`.
Scenario: change `Scalar.to_int` to `Scalar.to_uint` at `avx2.ts:158`. All of `x86b.test.ts` still passes. This is the
one non-equivalent survivor of my 37 mutations.
The port itself is correct: a probe of mine with negative 64-bit offsets on enabled lanes (all four `gather.q.*` forms, all
scales, plus masked-off out-of-bounds lanes and a lane fault) matched the oracle on stdout, stderr and exit code.
Fix: add one line with an enabled negative lane to the `q` forms in `avx2.rs`, and regenerate.

**F2. Low. `docs/handoff/miri-x86-b-probe/e2e.ts:22`: the default timeout is too short for `avx2`.**
The default is 30 min. `avx2` took 2,774 s at `--jobs 4` with the host at load 25-45.
Scenario: root runs the command as the handoff gives it and gets `TIMEOUT avx2`, which is not a port problem.
Fix: raise the default, or have root pass `--timeout-ms 3600000` (see "What root must rerun").

**F3. Low. `docs/handoff/miri-x86-b.md:18,96,98`: stale.**
Line 18 says `-C target-feature` needs an owner, and line 96 says flagged programs report UNPORTED until it is resolved.
Miri-tail-a's `3357957e` resolves it on its branch, though it is not on `integ-w38` or `main` yet. Line 98 says "allow
hours", but none took over 46 minutes here.
Scenario: root reads this and either skips the fixtures or budgets far too long.

**F4. Low. `docs/handoff/miri-x86-b.md:23`: the AES lift is understated, and the fixtures are not what it implies.**
"Port `mod hazmat`" is not enough: those functions call `sub_bytes`, `inv_sub_bytes`, the mix-columns macro, `bitslice` and
more. I count about 635 code lines in `soft/fixslice64.rs`. See "AES" below.

**F5. Low. `avx.ts:21` on `t3/miri-x86-b-on-x86-a`: unused imports after removing the stand-ins.**
`type Float, type FloatType` are only used by the deleted block. `tsc` does not flag it. Drop them when replaying `07c3ecaf`.

## 1. Match arms and markers

Compared with a script, not by eye: the arm lists are identical and in the same order in all seven files (avx 49 string
patterns, avx2 67, avx512 21, aesni 14, bmi 4, gfni 9, sha 3, counting inner `match` arms). Also identical: the sequence of
`expect_target_feature_for_intrinsic` calls, the arity of every `check_shim_sig_llvm_intrinsic`, and the sequence of helper
calls. (The script's helper count was not usable for aesni, where I compared by reading.) I read argument and result
handling line by line against upstream in all seven files. `coverage.ts --missing`: 1/1, 1/1, 2/2, 3/3, 1/1, 3/3, 7/7.
`coverage.ts --check --offline`: `markers ok`. The lane touched only its assigned files, plus `docs/handoff`.

## 2. Bit-level semantics

I found no JS pitfall that bites:
- **BMI:** bigint throughout, so 64-bit values keep every bit. `checked_shr` is correct at `start >= 64`, and `wrapping_shl`
  is only reached below 64. Zero masks give 0.
- **`pternlog`:** bit 31 is handled by `>>> 0`. `>>` vs `>>>` before `& 1` is an equivalent mutant.
- **`vpdpbusd`:** cannot overflow in the sum, and `| 0` wraps. `to_i8` / `to_u8` are the right way round.
- **GFNI:** values stay below 2^15, parity reduces to one bit, and the table is computed as upstream does.
- **SHA:** sums are below 2^53, then `>>> 0`.
- **`aeskeygenassist`:** extracts `a >> 32` and `a >> 96`, and rotates correctly.
- **Gather:** same order as upstream: scale check, `read_pointer`, then per lane: project mask and dest, read mask, then
  read offset and `mem_copy`, or copy from `src`. A masked-off out-of-bounds lane does not fault. The fault and the
  `alloc`-numbered message match the oracle.
- **`psign`, `mpsadbw`, `permute`, `permute2` (x86-a's `mod.ts`):** read against upstream and correct, and exercised by the
  upstream avx2 and avx512 tests. The rest of `mod.ts` is left to x86-a's review.

Forms the lane only tested directly, now through the interpreter:
- 64-bit `bmi`: 175 lines of my own program, including values above 2^53, and all 240 fixture lines. Identical.
- GFNI affine at 256/512: 48 lines of my own program with **a different matrix in each chunk** (the fixture only does that
  at 128 bits) at imm 0, 0x63, 0xff, and the fixture's lines. Identical.

## 3. Fixtures

- **Reproducible from committed source: yes.** `gen.ts` rewrote all 24 `.oracle.txt` byte-identically (`git status` clean)
  in 104 s under load.
- **From the isolated Miri: yes.** `gen.ts` uses `miriBinary()` and `MIRI_CASE_ENV`, after `verifyMiriOracle()`.
- **Direct tests assert oracle values: yes.** `run_fixture` compares with the fixture's line, on a destination prefilled
  with `0xaa`. Only the panic and UB texts are compared by message.
- **Every arm reached: yes.** 127 string arms plus the 8 BMI forms all appear in oracle output. `vzeroupper` / `vzeroall`
  share one combined line. Through the port, every arm runs except the AES round arms, which stop at their first call.
- **Unit step: none of the 24 programs runs there.** `x86b.test.ts` is 14 tests, 7,172 expects, no subprocess: 0.8 s at load
  ~30. The cost is 49 files and 221 KB in the tree. Merging this lane also switches on x86-a's `values: wide` (59 s wall, 15 s
  CPU under load), which skips until `avx2.ts` is no longer a stub.
- **Consequence:** the 24 programs and their helper-dependent lines have no regression protection in the gate. Only `wide`
  and, once it is a gated suite, `miri-pass` cover that path. Root may want to record this; I am not asking for more unit-step
  time.

My mutation check, separate from the lane's: 37 mutations against `x86b.test.ts`, 35 killed. The survivors are the equivalent
`pternlog` shift and F1. All were reverted, in a scratch tree only.

## 4. AES

**D5 is real and the lane followed it.** `docs/plan-m6.md:234` lists "aes (AES-NI shims)" as `unported(...)` in M6.
Only `aesni.ts:37-54` stops, on the four `hazmat_*` functions; the closures and conversions are in upstream form.

**Are upstream's semantics exactly the crate's soft implementation? Not as what runs, but yes in value.** `aes-0.9.0/src/hazmat.rs`
calls `armv8::hazmat` when `cpufeatures` detects `aes`, so on this host (FEAT_AES=1) the oracle should be taking the ARMv8
backend, and on an x86 host AES-NI. `soft` is the fallback. I inferred that selection from the source and did not instrument
it. The values agree:
- Built natively, default and with `--cfg aes_backend="soft"`, 200,000 inputs through all four functions give the same hash.
- An independent FIPS-197 implementation reproduces all 28 round lines of `aes_rounds.oracle.txt`, across every width.

So porting `soft` reproduces the oracle's values, and it is the only backend JS can port.

**What it would take:**
- `src/vendor/aes/` with `// crate:` markers, a `harness/scope.json` vendor entry, and the crate's `tests/hazmat.rs` (PORTING 5b).
- About 635 code lines of `soft/fixslice64.rs`: `sub_bytes` 133, `inv_sub_bytes` 146, the mix-columns macro 109, `bitslice` /
  `inv_bitslice` 96, swaps, rotations and the `hazmat` block. Some of that is not needed (`mix_columns_1`, the `_par` fns).
  It is straight-line `u64` code with no dependency on the interpreter.
- Filling the four stand-ins and updating the AES test in `x86b.test.ts`. `aes_rounds.oracle.txt` and upstream's test are then
  ready oracles.
- Note: cargo reports `aes 0.9.0` as yanked. It is in the local registry, and `crate-src.ts` found it there.

**Better done now? No.** It buys one test of `miri-pass`'s 389: `intrinsics-x86-aes-vaes.rs`, the only upstream x86 test
that needs it. M6b's bar there is 80%. Nothing else in this lane depends on it, and it is small enough to be a single later lane
if the measured `miri-pass` shows it matters. Whether to amend D5 is root's call.

## 5. End to end

**The lane's partial evidence supported its claims, but only just.** Before my run overwrote them, the lane's logs in
`$RUST_TS_DATA/tmp/miri-x86-b/` showed exactly what the handoff says: avx 60/141, avx2 45/164, avx512 19/62, bmi 201/480,
gfni 38/48, all prefix-identical, sha and aes_keygen complete, aes_rounds exit 70. A prefix and uncommitted "tail" copies are
weak, and the rig was a local patch. They did not show that the rest of those five programs agreed, or that the real flag behaves
like the rig. My run settles both on the real flag. The timeouts were load: all five finish.

### What root must rerun after merging

On the tree with x86-a, x86-b (stand-ins removed) and miri-tail-a. Merging my scratch tree with `integ-w38` at `b34dde23` reports
no conflicts, but I did not run on it.

1. `bunx tsc --noEmit -p .`, then `bun test src/miri/intrinsics/x86 src/miri/contract.test.ts`: expect 46 pass, 0 fail, with
   `values: wide` run, not skipped.
2. `bun docs/handoff/miri-x86-b-probe/e2e.ts --jobs 4 --timeout-ms 3600000`: expect `MATCH=23 DIFF=0 UNPORTED=1 TIMEOUT=0`. It
   overwrites `$RUST_TS_DATA/tmp/miri-x86-b/`.
3. Upstream's seven `tests/pass/shims/x86` tests above, by hand or through `miri-pass` once it is gated: six exit 0, and
   `intrinsics-x86-aes-vaes` exit 70 on `aes::hazmat::equiv_inv_cipher_round` until D5 is lifted. My run used
   `--edition=2021` and each test's `-C target-feature` flag only, not ui.rs's full flags.
4. Then `bun test src/miri` as the handoff says. Alone on the lane it gives 258 pass, 0 fail in 100 s.

## 6. Stand-ins and the integration branch

- **Stand-ins:** all 23 (`avx.ts` 7 plus `cmp_from_imm`, `avx2.ts` 14, `avx512.ts` 1) match the real exports in x86-a's
  `mod.ts` by name, parameter order and return type. `cmp_from_imm` is on the companion at `mod.ts:183,192`. `tsc` agrees after
  they are deleted, as the handoff says it would. No `pending miri-x86-a` marker is left under `src`.
- **Before x86-a lands:** on this lane alone they cannot be reached from a program, because `emulate_x86_intrinsic` is still a
  stub. They are harmless.
- **Merge correctness:** correct, apart from F5. The lanes change no file in common. `54f50fb4` has an empty combined diff.
  `07c3ecaf` only removes the blocks and replaces the two `cmp_from_imm` calls. At `2bac277e`, the tree differs from x86-a's
  `dee9e4fa` only by lane b's paths, and from the lane only in the three stand-in files and the handoff.
- **For the merge:** take `2bac277e`, or replay `07c3ecaf`, so the stand-ins do not stay behind. If they do, nothing fails, and
  a later signature change would be hidden by the overloads.

## 7. The `contract.test.ts` failure

**x86-a's file and x86-a's fix, already done. Not this lane's.** I reproduced it at `07c3ecaf`: 7 pass, 1 fail, naming
`src/miri/intrinsics/x86/probes/driver.ts`. At `2bac277e` it is 8 pass, 0 fail, because `dee9e4fa` renamed the file to `driver.mts`
and did not touch the test. That rename meets the rule as written; x86-a's reviewer can say whether a scaffold belongs there. This lane
put its own tools under `docs/handoff/miri-x86-b-probe/` instead.

## Not checked

- x86-a's `mod.ts` beyond the four helpers named above, and its SSE files.
- miri-tail-a itself, which is reviewed separately. I relied on `02e53812`, and my results depend on it.
- Running on `integ-w38`, or a build of all three lanes on `main`. Nothing here is on either yet.
- ICE frames: panics are compared by message only.
- `i686`: the "64-bit `bmi` is not supported" path ran only on the stand-in, with no oracle run. Only the default seed was used.
- The AES round arms' `write_scalar` after the crate call, in a real interpreter.
- The lane's own 12 mutations (I ran my own 37 + 5), and its uncommitted tail copies.
- Which 4 tests failed in a first `bun test src/miri` at load ~200 (254 pass, 4 fail). That output was cut off and I did not capture
  the names. Alone, at the code of `0837513a`, it gives 258 pass, 0 fail, so I treat them as load, per the brief, but I cannot name them.
- Windows.

Note on the raw evidence: a host reboot wiped my scratchpad, including the outputs of the early probes (64-bit `bmi`, GFNI at 256/512,
negative gather offsets), the AES backend check and the mutation log. Their results are as I recorded them at the time. The table at the
top was rerun after the reboot.

# Independent review: abi-vtable

Branch `t3/aarch64-abi-vtable`, head `dcb622c4`. The lane's own commits are `1de34928`, `7c5030f1`, `01f3f628` and `dcb622c4`, on top of `51d9ada2`;
the merge base with `main` is `24d2c786`, and the commits between are integ-w39's. Tested at the lane head. Code read-only: mutations and spec patches
ran in throwaway worktrees, since removed. Upstream checkout left clean. No gate or full suite run.

## Verdict: APPROVE WITH NITS

**Both ports are correct.** All 6 + 3 fns read line for line against upstream, in order, with correct markers. I found no output difference caused by
either port in about 400 new `#[rustc_abi(debug)]` dumps, 129 vtable allocations compared byte for byte, or `rg` through mono at three profiles.
Every remaining difference is a stop or ICE format listed below; none comes from the lane's code. Every claim in the handoff that I tested held, except
that "slot by slot" overstates what the committed fixture proves for `TraitVPtr` (F1).

The findings are one real gap in the committed tests that matters for M7 (F1), one smaller gap (F2), and stops outside the lane's logic.

| # | Severity | Where | Finding |
|---|---|---|---|
| F1 | **medium, test gap only** | `collector_oracle/run.ts:73`, `collector_oracle/probe/main.rs:63`, `oracle/vtable_static.vtables.txt:8` | A supertrait vtable pointer is printed as `memory +0`, and the vtable behind it is never compared. A wrong `TraitVPtr` target passes every committed test |
| F2 | low, test gap only | `aarch64_oracle/abi.rs:65` | Three branches of `aarch64.ts` are in no committed test: the vector-size limit (upper side), `pass_indirectly`, scalable vectors |
| F3 | low, stop | `callconv/mod.ts:1007,1065`; `callconv/x86_64.ts:114` | Rust-ABI by-value above 2^53 bytes stops on both aarch64 targets, and so does `extern "C"` on x86_64. The `bits_u64` fix was applied only inside `aarch64.ts` |
| N1 | nit, wording | `aarch64_oracle/run.ts:5-7`, handoff "It can only fail extra" | Slight overclaim; see item 4 |
| N2 | nit, for root | `collector_oracle/run.ts`, `partitioning.oracle.test.ts` | Both conflict with `t3/wire-monomorphize-providers` at merge |

Not blocking, but F1 should be fixed before a native suite relies on trait upcasting. It is about ten lines plus a regen.

### F1: the supertrait vtable's contents are not asserted

The lane's walk has a `GlobalAlloc::Memory` arm that only recurses through provenance, and `slot()` prints `memory` for that pointer. So the fixture shows
that a `TraitVPtr` slot exists at offset 40, not what it points to.

**Failing scenario, reproduced.** Change `ty/vtable.ts:165` to `tcx.vtable_allocation([ty, undefined])`. Every `dyn Both` vtable then points at a
no-principal vtable. `bun test collector.oracle.test.ts -t vtable_static` still passes. In M7, upcasting to `dyn Second` and calling `second` reads past
the end of that vtable: a miscompile with a green fixture.

**The port itself is right here.** My own probe recurses into `Memory`, and 11 nested supertrait vtables are byte-identical on both targets.

**Fix.** In the probe and in `run.ts`, have the `Memory` arm dump the block as the `VTable` arm does when reached from a vtable slot, then regenerate.
The handoff's "4 mutations: size, align, drop slot, `Vacant`" are all caught; none of them covers this slot.

### F2: branches of `aarch64.ts` no committed test reaches

| Mutation | Committed fixture | Why | Does a run outside the fixture catch it? |
|---|---|---|---|
| `valid_unit = true` for every vector size (`aarch64.ts:56`) | **survives** | `HvaWide { a: F32x8 }` is a one-field wrapper with `BackendRepr::SimdVector`, so `is_aggregate()` is false and the check is never reached | my `HV32x2 { U8x4, U8x4 }`: yes |
| remove `pass_indirectly_in_non_rustic_abis` (`:131`) | **survives** | no such type in `abi.rs` | `tests/ui/abi/pass-indirectly-attr.rs` **with minicore**: yes |
| remove `is_scalable_vector` (`:96`, `:127`) | **survives** | none in `abi.rs` | not tried |
| remove `compute_rust_abi_info` call (`mod.ts:954`) | survives, as it must | a no-op without softfloat | n/a |

The lane's "vector sizes" mutation is real in the other direction: limiting to 128 bits is caught. **Fix:** add `{ a: F32x8, b: F32x8 }`, `{ a: U8x4, b: U8x4 }`
and a `#[rustc_pass_indirectly_in_non_rustic_abis]` struct to `abi.rs`. The cost is negligible.

**A trap for anyone repeating these runs.** `pass-indirectly-attr.rs` uses `add-minicore`. Run bare, it fails on the missing crate with the same `E0463` on
both sides, which looks identical and proves nothing; my first sweep did exactly this. With a minicore built per target it is identical and the mutation is
caught. The handoff does not say how its manual run built minicore, so its line for that test is confirmed by my run, not by its own evidence.

### F3: stops above 2^53 bytes

Exit 70, never a wrong answer. `struct H1([u8; 1 << 60]); #[rustc_abi(debug)] type R = fn(H1);`, or `fn() -> H1`, on darwin, linux-gnu and x86_64: the oracle
prints the dump. `mod.ts:1007` and `:1065` call `size.bytes()` where upstream compares `Size` or `u64`. `abi.rs`'s own `CHuger` on x86_64 stops at
`x86_64.ts:114`. Same class as item 6's lint. `extern "C"` on both aarch64 targets is right up to 2^61 − 1. Low for M7: real programs do not pass these by
value, and it is a stop.

## 1. `callconv/aarch64.rs`

Read against upstream: `AbiKind`, all 6 fns, order, arm order, comments. `bits_u64` is sound: below `obj_size_bound` (2^61), `bytes * 8` cannot overflow `u64`,
so upstream's checked `Size::bits` never panics here. The Arm64EC `is_power_of_two` matches `u64` (false for 0). The two `mod.ts` arms match upstream.

**Oracle comparisons, stderr and exit code byte for byte, all identical:**

| Program | Targets and flags | Dumps | Contents |
|---|---|---|---|
| `adv1.rs`, `no_core`, mine | darwin and linux-gnu, each at `-O` and without; darwin `-Cpanic=abort`; linux-gnu `-Ctarget-feature=-neon` | 280 each | below |
| `adv2.rs`, std, mine | darwin, `-O` and without | 117 + 3 `assert_eq` | below |
| `adv3.rs`, huge sizes | both, up to F3's stop | 14 `extern "C"` | `[u8; 2^61 − 1]`, `[f32; 2^58]`, huge unions and enums |
| `tests/ui`: `rustc_abi(`, `rustc_scalable_vector`, `abi/`, `c-variadic/`, `simd/*abi*` | both | 114 files, 228 runs: 222 same | the 6 others below |
| The same, with `add-minicore` given minicore | both | 27 files, 54 runs: 52 same | |

`adv1` and `adv2` cover:
- **HFA merge rules:** ZST positions, 1-ZST vs aligned ZST, padding, packed, `repr(align)`, f16 to f128 limits, nested arrays and tuples.
- **Unions:** 16 shapes.
- **Enums:** tagged, uninhabited variants, `Option` niches, `repr(C)`, `repr(u32)`, `repr(u128)`.
- **Vectors:** every width from 16 to 256 bits; HVA with different signs, elements and floats; arrays of vectors; `arch::aarch64` types (`uint8x16x4_t`, `float64x1x4_t`), `Simd<_, N>`, `Mask`.
- **128-bit alignment on both ABIs:** `repr(align)` in wrappers, `[u128; 0]`, `packed(4)`, `align(32)`.
- **Boundaries and returns:** 16 and 17 bytes, sret, `-> !`, unsized args.
- **Varargs:** `VaList` by value, c-variadic definitions.
- **ABIs:** `"C-unwind"`, `"system"`, `"system-unwind"`, `"efiapi"`, `"rust-cold"`, `"rust-call"`, `"rust-preserve-none"`, `"cdecl"`.
- **Other:** `#[track_caller]`, deduced attributes at `-O`, ~60 Rust-ABI signatures, `Box`/`Vec`/`String`/`Pin`/`MaybeUninit`.

The 8 differences across the two UI sweeps, none from the lane:
- `simd-abi-checks-sse.rs` (once per sweep, 4 runs) and `fixed_x18.rs` (2 runs) stop at `rustc_codegen_llvm::llvm_util::configure_llvm`, which any `-Ctarget-cpu` reaches.
- `sysv64-zst.rs` and `x86-64-sysv64-arg-ext.rs` on darwin (2 runs): both sides exit 101, panicking at the same `unwrap` (`rustc_ty_utils/abi.rs:556`, `abi.ts:565`). Only the ICE's format differs, as the handoff says.

**The branches the handoff says have never run: mostly exercised now.** In a throwaway worktree I patched the `aarch64_unknown_linux_gnu` spec and compared
the port with the oracle's real target, on `abi.rs` and `adv1.rs`:

| Patch | Oracle target | Result |
|---|---|---|
| `rustc_abi: Softfloat`, `panic_strategy: Abort`, its features | `aarch64-unknown-none-softfloat` | all 361 `FnAbi` dumps identical. The port adds two `neon`/`fp-armv8` "must be disabled" warnings, an artefact of the patched spec or the stubbed backend, not `aarch64.ts`. Re-check when that target is really ported |
| `is_like_windows`, its data layout | `aarch64-pc-windows-gnullvm` | byte-identical (`AbiKind::Win64`) |
| `arch: Arm64EC`, `is_like_msvc`, its layout | `arm64ec-pc-windows-msvc` | `abi.rs` identical; `adv1.rs` both ICE at the same `unwrap` |

The Arm64EC variadic loop is still unexercised: a `#[rustc_abi(debug)]` signature has no variadic portion.

Suites use `--target x86_64-unknown-linux-gnu`, so no suite exercises this ABI today. M7's native suites will be the first.

## 2. `vtable_allocation_provider`

Read against upstream: all 3 fns, slot order, drop/size/align, `Vacant` left uninit, `TraitVPtr`, `Allocation::new(.., Uninit, ..)`, `mutability = Not`, `reserve_and_set_memory_alloc`.
The `u64`s are needed: `from_uint` of 2^60 is right.

**A stricter probe than the lane's.** It dumps raw bytes as hex, the init mask per byte, align, mutability, each provenance entry with `immutable` and
`shared_ref`, and nested `Memory` blocks recursively. It calls the query twice with freshly built keys to check caching. Same walk on the port side.

| Program | Targets | Vtables | Result |
|---|---|---|---|
| `vt1.rs`, std | darwin, x86_64-linux | 106 | byte-identical (708 lines), all `cached=true` |
| `vt2.rs`, `no_core` | linux-gnu, darwin | 22, 23 | byte-identical |
| the lane's `vtable_static.rs` | darwin, x86_64-linux | 11 | byte-identical (closes the handoff's host gap) |

`vt1` covers:
- **Hierarchies:** diamonds and deep multi-supertrait, marker supertraits, `Gn<u8> + Gn<u16>` (key injectivity), `for<'a>` supertraits.
- **Vacant slots:** in every position.
- **Drop:** `Drop`, ZST, enum, union, `[T; 0]`, `ManuallyDrop`, `MaybeUninit`, `!`.
- **Sizes and alignments:** 2^32, 2^53 − 1, 2^53, 2^53 + 1, 2^60; align 4096 and 2^29.
- **No principal:** with and without drop.
- **Instance kinds:** `Iterator`-sized traits, fn pointer and closure `Fn*` shims, `self: Box/Rc/Arc/Pin`, by-value `self` with `VTableShim`, `#[track_caller]` with `ReifyShim`.
- **Reached through:** `const`, promoteds, const upcasts, nested and self-referencing statics, generic associated consts.

Mono (`-Zprint-mono-items` through the partitioning driver, sorted lines, CGU and linkage, stderr, exit), all identical:
- `vt1` at dev and `-O`, on darwin and x86_64-linux (dev only there).
- `vt2` on linux-gnu.
- The fatal path `tcx.dcx().fatal(e.to_string())` with a type too big for the target, on darwin and x86_64-linux.

**UI sweep, mine, seeded random:** 177 `tests/ui` programs with `dyn` (trait-upcasting, vtable, coercion, statics and consts, others), through mono on darwin and
x86_64-linux. 354 runs: 348 identical (2,452 mono lines), 4 skipped for aux crates, 2 are the `short_string` stop in item 6.

**Shared `Copy` values (the fixers-39 F1 class): none.** `Size`, `Reg`, `Uniform` and `RegKind` are immutable or frozen. `Scalar`, `Pointer` and `AllocRange` are made fresh each
iteration. `cast_to` makes a new mode and `CastTarget` with fresh `attrs`. Nothing mutates `vtable` after `mk_const_alloc`.

**Did this change results in protected suites? No.** The only caller of `tcx.vtable_allocation` is `collect_alloc` (`collector.ts:1362`) plus test drivers.
`main.ts` does not reach it: `--emit=mir` stops at `collect_and_partition_mono_items provider (not ported)` on x86_64-linux and darwin, and `passes.ts:970` lists
`rustc_monomorphize` as still pending. After `mono-wire` merges that changes; the comparisons above are what will cover it.

**Could a stop have been hiding a difference? I found none.** The 3 pinned stops are real comparisons and pass. One program was hiding another stop:
`infinite-instantiation-struct-tail-ice-114484.rs` stops at `vtable_allocation` at `51d9ada2` and at `short_string_namespace` now (item 6).

The handoff's statement that const eval cannot read vtable memory holds: reads are errors on both sides, so only a probe can check the contents.

## 3. Fixtures and mutation claims

- **Source committed and from the oracle: confirmed.** `abi.rs`, `vtable_static.rs` and the probe's source are committed. I reran the pinned rustc: both `oracle/*.txt` (81 dumps each) and
  `vtable_static.vtables.txt` (from the lane's own probe, rebuilt) match byte for byte. They are oracle values, not port output. The test needs no toolchain at run time.
- **Only `vtable_static`'s oracle changed among the 61 programs:** confirmed by diff.
- **Mutations spot-checked:** 21 on the ABI and 9 on the vtable. All the classes the handoff lists are caught, on the ABI side
  the `AbiKind` branch, 4-member limit, vector size (one direction), both alignments, 128-bit limit, extensions and consecutive flag, on the vtable side size, align,
  drop slot and `Vacant`. Also caught: init mode, mutability. A ninth, on `ptr_align`, failed the test, but my patch was crude and may simply have crashed, so I do not count it.
- **Survivors:** F1 (supertrait target), F2's three, the `compute_rust_abi_info` no-op, and the fn-pointer salt in the `Method` arm, which has no visible output (a different `AllocId` only). One further
  planned vtable mutation, the salt in the drop arm, did not apply as written and was not run.

## 4. Two sessions in one process: keep

**Sound today, tested directly.** `abi.rs` in one process against one oracle process per target, byte for byte, all identical: `[linux]`, `[darwin]`, `[linux, darwin]`,
`[darwin, linux, darwin, linux]`; also `adv1.rs` as `[linux, darwin]`. A narrow grep of the ABI, target-spec and layout modules finds only state keyed on `Layout`
objects (`LAYOUT_MEMO`) or constant (`TY_ABI_INTERFACE`, `LINKER_FLAVOR_CLI_TABLE_`); I did not audit the rest of the compiler. The two runs with x86_64 in the sequence fail on `CHuger`: that is F3, as x86_64 alone shows, and not a leak.

**N1: "it can only fail extra" is not strictly true.** A second session inherits lazily initialised module state, so a bug that shows only in a *fresh* process on the *second* target would be hidden.

**Why that does not matter here.** The order is `[darwin, linux]`, so darwin, M7's native target, always gets a fresh process, exactly as rustc. Linux-gnu is the only exposed target,
it is a second-kind check, and M7 runs nothing native on it.

**The saving is real.** CPU, measured the same way at load about 40: 2.9 s in one process, 4.9 s in two, so +2.0 s. The lane's total, with its own unverified +1.07 s for `vtable_static` and the two `vtable-through-const` cases I measured at about +0.25 s each,
is about 4.5 s. One process per target would take it to about 6.5 s, over the 5 s limit of `plan-m7` F5.

**Recommendation: keep it, and reword the comment** to "darwin runs first, in a fresh process; a fresh-process-only bug on linux-gnu would not show here".

## 5. Samples and `rg`

| `--sample 200`, `RUST_TS_AGENT=review-abi-vtable`, `RUST_TS_REQUIRE_PROBES=1`, shared machine | MATCH | Other |
|---|---|---|
| `mir` | 200/200 | none |
| `check-ui` | 200/200 | none |
| `tydump-ui` | 200/200 | none |
| `run-pass-miri` | 200/200 | none |

`bun test` with `RUST_TS_REQUIRE_PROBES=1`: `callconv/` 2 pass; `collector` + `partitioning` 128 pass (61 + 67, as the handoff says). `tsc` clean. `coverage --check --offline`: markers ok; 6/6 and 3/3.

**`rg` on the host through mono: yes, it really matches.** Built by the oracle's cargo into my own target dir (`Cargo.lock` unchanged), then the driver on the bin:

| Profile | Mono lines, oracle/port | Sorted lines | stderr | Exit |
|---|---|---|---|---|
| dev | 6,910 / 6,910 | identical | identical (empty) | 0 / 0 |
| dev dependencies, `-Copt-level=3 -Ccodegen-units=16` (the lane's second) | 8,448 / 8,448 | identical | identical | 0 / 0 |
| **real `--release`, with release-built dependencies** (not in the handoff) | 6,800 / 6,800 | identical | identical | 0 / 0 |

Same limits as the handoff: `-C incremental` dropped, dependencies built by the oracle, nothing past mono, `rg` and its dependencies' ABI not compared call by call.

## 6. The three reports outside the lane

| Report | Confirmed | Cause | Severity for M7 |
|---|---|---|---|
| `rustc_lint/builtin.ts:541` | **Yes**, on x86_64-linux and darwin; threshold exactly 2^53: `(1 << 53) - 1` is fine, `1 << 53` stops, and a private type does not stop | `size.bytes()` where upstream has `u64`. `bytes_u64()` is right, as the handoff says | **Low.** Exit 70, never wrong. Needs a `pub` type of 2^53 bytes or more; `rg` has none. One-line fix |
| `mentioned_items` ICE | **Yes**, x86_64-linux and darwin, and at `51d9ada2` on x86_64-linux. Not from the lane | **The test driver, not the port.** The error is a lint (`long_running_const_eval`), so `analysis`'s `has_errors_excluding_lint_errors` lets it through, as upstream. Upstream then stops in `start_codegen` (`passes.rs:1317`, ported at `passes.ts:1370`), which `partitioning_oracle/run.ts:88` skips by forcing the collector directly | **None, if `mono-wire` goes through `start_codegen`**, which I did not verify on its branch. Adding `abort_if_errors()` before the collector in a copy of the driver gives exit 1 and byte-identical stderr |
| `short_string_namespace` stop | **Yes**, both targets | The long-type file (`DefaultHasher` over `T`, file I/O) is unported. Reached only with `-Zwrite-long-types-to-disk=yes`, which is the default and this test's own flag. With `=no` the program is byte-identical on both targets | **Low to medium.** A stop. 33 `tests/ui` programs ask for `=yes`, so `mono-ui`'s denominator may carry some of them; a real build only hits it on a long type in an error, and `rg` has none. Give it a lane if `mono-ui` needs them |

## Not checked

- Anything past mono: no LLVM IR, `alloc_<hash>` names (`HashStable` of the vtable allocation), or linking. **M7 will be the first to exercise those.**
- `rg` on linux-gnu (no `rust-std` for it), and `rg`'s ABI call by call.
- Softfloat, Win64 and Arm64EC on real specs: only through a patched spec, on two `no_core` programs. The Arm64EC variadic loop has not run.
- Scalable-vector mutants against a run outside the fixture. I only compared the 25-odd unmutated programs.
- Big-endian and 32-bit vtables: the port has no such target.
- Aux-crate `dyn` programs (4 skipped); the lane's exact 109-program list, which is not committed, so I used my own sample.
- **The `(vtable: impl .. for ..)` line of a MIR allocation dump (`mir/pretty.ts:2054`).** `-Zunpretty=mir` is identical on `vt1` (darwin, x86_64-linux) and `vt2` (linux-gnu), `-Zdump-mir=runtime-optimized -Zalways-encode-mir` on `vt1` (darwin) and `vt2` (linux-gnu), and both on a purpose-written `vt5.rs` with consts and promoteds holding `dyn` (darwin and x86_64-linux, with and without `-O`). But the oracle printed no such line in any of them, even at `-Zmir-opt-level=4`, so that printer stays unexercised here. `-Zdump-mir=all` stops at `rustc_graphviz::render`, which I did not look into.
- A full suite or the gate.

My adversarial programs and scripts were in the session scratchpad and are not committed. They can be added as a fixture if root wants them; F1's and F2's reproductions are in this file.

**N2, for root.** `git merge-tree` of this head with `t3/wire-monomorphize-providers` conflicts in `collector_oracle/run.ts` and `partitioning.oracle.test.ts`.

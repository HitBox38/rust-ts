APPROVE WITH NITS: the one behaviour change is faithful and costs nothing measurable; the nits are one unpinned boundary on the changed line and three wrong or too-broad claims in the handoff and fixture comments.

# Independent review: fixers-44

Branch `t3/fix-eii-metadata-tests`, head `b2406157`, on `9e11cc8b`. Commits `901e335e`, `8f81548b`, `1642fd77`, plus the handoff. All runs used `RUST_TS_REQUIRE_PROBES=1` and `RUST_TS_AGENT=review-fixers-44`, in throwaway copies of that head (since removed), at load about 2 to 12. No gate or full suite was run, and no code was edited outside those copies.

| # | Severity | Where | Finding | Evidence |
|---|---|---|---|---|
| F1 | low, test gap | `callconv/x86_64.ts:117` | The `n > MAX_EIGHTBYTES` boundary on the rewritten line is not pinned: `>=` survives the ABI test | reproduced |
| F2 | low, wrong claim | handoff "abi-vtable F2"; `callconv/aarch64.ts:127` | That `is_scalable_vector` guard is not equivalent. `:96` is | reproduced |
| F3 | nit, wrong claim | handoff "mir-alias F1"; `alias_check_oracle/match_const.rs:1`; `1642fd77`'s message | At `-O` the site is reached and merges, in dead blocks. Nothing changes in the output. One line in `shims.rs` would also close the test gap, with no extra process | reproduced |
| F4 | nit, correction | handoff "Left"; `callconv/x86_win64.ts:18,51` | Only `:18` stops, and from 2^50 bytes, not 2^53. `:51` is not a stop | reproduced |
| F5 | for root's queue, not this batch | `known_panics_lint.ts:1115`; `rustc_lint/types.ts:914` | Two more stops at or above 2^53 bytes, outside the ABI files, on ordinary by-value code | reproduced |
| F6 | nit, optional | `eii.oracle.test.ts`; handoff "What it does not show" | `decl.name.span` is cheap to cover. The other four fields have no consumer. `impl_marked_unsafe` is not a field | reproduced, plus reading |

## 1. `901e335e`, the behaviour change

**Against upstream, line by line: faithful.**

| Port | Upstream | Check |
|---|---|---|
| `mod.ts:1008` `Size_cmp(arg.layout.size, ptr.mul(2)) > 0` | `mod.rs:848` `arg.layout.size > Pointer.size(cx) * 2` | same comparison, exact |
| `mod.ts:1066` `Size_cmp(size, ptr) <= 0` | `size <= Pointer.size(cx)` | same |
| `x86_64.ts:116-120` `(bytes_u64() + 7n) / 8n`, `> BigInt(MAX_EIGHTBYTES)`, then `Number` | `size.bytes().div_ceil(8) as usize`, `n > MAX_EIGHTBYTES` | exact over all of `u64`; the `bigint` sum cannot wrap; `Number` runs only for `n` <= 8 |

`Size_cmp` (`rustc_abi/lib.ts:1466`) compares `small` only when neither side is big, so the `NaN` in a big `Size` is never compared. No function moved. `coverage.ts --check --offline` passes (24,848 markers), and `--missing` gives `mod.rs` 45/45, `x86_64.rs` 5/5, `x86_win64.rs` 1/1. `tsc` is clean.

**Sizes of my own: byte-identical on stderr and exit code.** There are 70 sizes: 2^k − 8, −7, −1, +0, +1, +7, +8, +9 for k in 50..55 and 60; 2^61 − 1, −2, −8, −9; and 24 to 73 bytes. Each is in argument-only, return-only and argument-plus-return position.

| Program | ABIs | Targets, flags | Dumps | Result |
|---|---|---|---|---|
| `[u8; N]` wrappers | Rust, `C`, `rust-cold` | darwin, linux-gnu, x86_64-linux at `-O`; darwin and x86_64-linux without; `x86_64-apple-darwin` at `-O` | 630 each | identical |
| same | `sysv64`, `system`, `C-unwind`, `rust-preserve-none` | x86_64-linux `-O` | 840 | identical |
| 18 shapes at 5 sizes: `[u64;_]`, `[f32;_]`, `[f64;_]`, bare arrays, `repr(C)`, tuple, unions, enums, `repr(align)`, packed, transparent | Rust, `C` | darwin, x86_64-linux `-O` | 360 each | identical |
| same | `sysv64`, `rust-cold` | x86_64-linux `-O` | 360 | identical |

The same `[u8; N]` program stops at exit 70 at `9e11cc8b` on darwin and x86_64-linux, so it does exercise the fix. The handoff's `abi.rs` claim also holds: on x86_64 it is identical to line 11,948, then both sides ICE on `CScalable`.

**Precision: none lost nearby.** Every `.bytes()` and `.bits()` left in `callconv/` either stops on a big `Size` or runs on a size already known to be small. The remaining float arithmetic is `mod.ts:447` (`Uniform`'s rest, small by construction) and `x86_64.ts:98-99`, reached only after `n` <= 8. All that is left above 2^53 is stops, none of them silent.

**Hot paths: no measurable cost.** Instructions retired, Ginstr, base `9e11cc8b` against this head, alternating:

| Program under Miri | Calls | Run 1 | Run 2 | Run 3 |
|---|---|---|---|---|
| hello | `classify_arg` 20, Rust-ABI loop 1,087 | 21.75 / 21.73 | 21.72 / 21.49 | 21.51 / 21.64 |
| 400 distinct `extern "C"` fns, my worst case | `classify_arg` 2,412, loop 523 | 73.40 / 73.26 | 72.85 / 73.14 | 73.11 / 73.66 |

The means move by −0.2% and +0.3%, inside each program's own run-to-run spread. `Size_cmp`'s common path has no `bigint`, and `bytes_u64` shares small values. The `classify_arg` count is per signature, not per call, as `fn_abi` is a cached query.

### F1: the boundary of the rewritten test is not pinned

| Mutation | ABI test | Note |
|---|---|---|
| `(… + 7n) / 8n` → floor | killed | |
| `x86_64.ts` back to the old form | killed | |
| the `n` test removed | killed | |
| `Size_cmp` sites back to the old form, each | killed | |
| `> 0` → `>= 0` | killed | **by `abi.rs`, not `sizes.rs`.** `sizes.rs` on darwin is unchanged by it: `make_indirect` on an already-indirect `Memory` type changes nothing, so `B16`/`B17` do not pin this test |
| `<= 0` → `< 0` | killed | |
| `n_u64 > MAX` → `>=` | **survives** | not equivalent, below |
| `n_u64 > MAX + 1` | survives | I built no case that shows it |
| `mul(2)` → `mul(3)` | survives | Equivalent as far as I can build: six `packed` and `repr(C)` shapes gave `Memory` or a 32-byte `ScalarPair`, none between 17 and 24 bytes. Not proven |

**Failing scenario for `>=`:**

```rust
#[repr(simd)] pub struct V64([f64; 8]);
#[rustc_abi(debug)] pub type A = extern "C" fn(V64) -> V64;
```

On x86_64-linux the oracle and this head both give `mode: Direct`. The mutant gives `mode: Indirect`. The ABI test stays green, and so do `mono-ui --filter tests/ui/abi` (49) and `--filter tests/ui/simd` (39), though `mono-ui` does not print an `FnAbi`. I did not run this mutant through every suite that might.

**Fix:** add `V64` to `sizes.rs` for x86_64. One type and a regen, or leave it to root.

## 2. `8f81548b`, the EII guard

**It compares against the oracle.** The test runs the pinned rustc live on oracle-built metadata (`eii.oracle.test.ts:66-75`), and the port reads that same metadata. It also asserts that the oracle's stderr contains the error and lacks `in addition to these two`, so it cannot pass with both sides failing earlier.

| Mutation | Result |
|---|---|
| the stop; empty result; `is_default` forced true; forced false | killed (the lane's four I reran) |
| `inner_span` read dropped, so the stream desyncs | killed: `is_default` is read last (`data_structures.gen.ts:195`), so a wrong width shows |
| `span` and `inner_span` swapped; `impl_unsafe` flipped; `impl_unsafe_span` forced `None`; `resolution` forced | survive |
| `decl.name`'s span replaced | survives |

### F6: what can be covered cheaply

**`decl.name.span`: yes.** It is printed by `EiiWithoutImpl` (`rustc_passes/eii.rs:146`). A crate `#[eii(eii2)] pub fn decl2(_x: u64);` and a user `extern crate decl2;` with `--crate-type=dylib` gave oracle exit 1, port exit 1, stderr identical, about 0.7 s wall for the port. The mutation above changes that stderr. Optional: it spends part of the budget.

**`resolution`, `impl_unsafe_span`, `span`, `inner_span`: no consumer, so no oracle output to compare.** The readers of the query's result are `rustc_passes/eii.rs:65`, `check_attr.rs:522`, `check_unused.rs:453`, and `codegen_attrs.rs:237` and `base.rs:970` in `rustc_codegen_ssa`. They use `decl.name`, `decl.foreign_item`, `is_default`, `impls.is_empty()` and, in `check_attr`, `impl_unsafe`. `check_eii_impl`'s `span`, `inner_span`, `resolution` and `impl_unsafe_span` come from the local attribute, not from this map.

**`impl_unsafe`: read only in the `Known` arm.** By reading `rustc_builtin_macros/eii.rs:330`, `Known` is only the generated default, whose foreign item is in the same crate, so that path gets the local provider and never the decoder. This one I read and did not test. Only a rustc-dev probe could show these five, which I would not build for fields nothing reads.

**Wording.** `impl_marked_unsafe` in the handoff is not a field; it is `impl_unsafe_span` (`data_structures.rs:46`). The handoff also does not mention `check_unused.rs:453` (the `unused_extern_crates` lint), and the test's `-Awarnings` means it does not exercise that reader. I did not test it.

## 3. `1642fd77`, the fifth clone

The fixture does reach the site: on `match_const.rs` at its flags, a scratch print shows one entry and one merge. Reverting `clone_Place(dest)` fails the test, and so does reverting `clone_ConstOperand(first_const)`. The oracle comparison is live.

### F3: "at `-O` never reached" is true of this program only

| Program, flags | Entries | Merges | Note |
|---|---|---|---|
| `match_const.rs`, `-O`; `-Copt-level=1`; `-Zmir-opt-level=2` | 0 | 0 | the lane's measurement holds |
| `match_const.rs`, `-O -Zmir-enable-passes=-GVN`, or its own flags | 1 | 1 | |
| 24 functions of mine, `-O` | 5, all in **dead** blocks | 5 | |
| same, `-O -Zmir-enable-passes=-GVN` | 22 (17 live, 5 dead) | 21 | |
| `mir-o2 --sample 300`, instrumented | 27, all live | **0** | |
| `mir-opt-o4 --sample 150`, instrumented | 27, all live | **0** | |

**Failing scenario for the claim:**

```rust
pub fn f(i: i32) -> bool { if false { match i { 7 => false, _ => false } } else { i == 1 } }
```

This also happens with `cfg!(ub_checks)`, a `const F: bool` and `W::<u8>::A` as the condition, and with `loop { if true { break …; } match … }`. GVN walks `reverse_postorder` only (`gvn.rs:153-154`), while `MatchBranchSimplification` walks every block (`match_branches.rs:26`). So the constants in a dead arm keep their own spans, `identical_stmts` fails, and `unify_if_equal_const` merges them.

**No output changes.** With the clone reverted, `-O` output on those programs stays identical to the oracle, because `simplify_cfg` removes the blocks. The alias walker does report 5 hits. No reachable merge at `-O` turned up, which is evidence and not proof.

So the conclusion stands, but the sentence in `match_const.rs:1` ("GVN has given every constant the same span") and the commit message should say "in reachable blocks".

**A cheaper test follows from this.** I added that `f` as one line to `alias_check_oracle/shims.rs`, already run at `-Copt-level=3` under the walker. The `shims` test still passes, and fails with the clone reverted. That needs no new process, against `match_const`'s 0.7 s wall. Optional: `match_const` also compares the merged output, which the dead-arm form cannot.

## 4. The "already closed" table

| Item | Mutation | Result |
|---|---|---|
| abi-vtable F1 | `tcx.vtable_allocation([ty, undefined])` | killed, `vtable_static` |
| abi-vtable F2 | `valid_unit = true` | killed |
| mono-wire W2 | sort reversed at `mono.ts:748` | killed, 1 of 66 |
| mono-wire W3 | `overlap += 1` | killed, 1 of 66 |
| mir-alias F3 | `by_move_body.ts:246` back to `clone_Body` | killed, `fixed aliasing` |
| mir-alias F3 | `promote_consts.ts:1179` without the clone | killed, `fixed aliasing` |

**W3 survivors, both rerun (66 pass): I agree they are equivalent.**

- **`!inlined` counted.** `instantiation_mode` is one value per item, so a root is placed in one CGU and is never a reachable inlined item. A non-inlined item in the source is therefore never in the destination.
- **`consumed_cgu_names` truncated.** The first element is all a source can hold. Every CGU has a root of size at least 1, so a merged CGU is strictly larger than the old destination, which was at least as large as everything in the tail. It therefore stays in the top N, and a source has never consumed anything. `cgu_contents` is also read only under `opts.incremental` (`partitioning.ts:476`). fixers-40's argument holds; I re-derived it by reading and did not build a chain.

### F2: the `is_scalable_vector` guards

- **`aarch64.ts:96` (`classify_ret`): equivalent.** The next branch runs `extend_integer_width_to`, which acts only on `Scalar`, and `softfloat_float_abi`, which acts on `Scalar` and `ScalarPair`. With both guards removed, a plain scalable vector is identical on both aarch64 targets. Softfloat is by reading only.
- **`aarch64.ts:127` (`classify_arg`): not equivalent.** The next statement is not the non-aggregate branch but `pass_indirectly_in_non_rustic_abis`, which the handoff's and fixers-40's reasoning skips.

```rust
#[rustc_scalable_vector(4)] #[rustc_pass_indirectly_in_non_rustic_abis] pub struct SV(f32);
#[rustc_abi(debug)] pub type A = extern "C" fn(SV);
```

The oracle and this head both exit 101 on the assertion at `rustc_ty_utils/abi.rs:456`, and the port's ICE differs from the oracle's only in format. With the guard removed, the port exits 1 and prints a dump. So this is a missing test, though a contrived one: two internal attributes, and the only outcome is an ICE. Byte comparison cannot hold it, since the ICE formats differ; an exit-code and message check could.

**Fix:** correct the claim; a test is optional.

**`lib.ts:697`: a no-op, as claimed.** The revert survives all 24 alias tests. `clone_Body_with_annotations` differs from `clone_Body` only in copying `user_type_annotations`. `mir_drops_elaborated_and_const_checked` always runs `run_analysis_cleanup_passes` (`lib.rs:638-641`), and `cleanup_post_borrowck.ts:73` empties the list. That is by reading plus the revert; I did not log the length at run time.

### F4 and F5: the siblings

**F4, `x86_win64.ts`.**

- **`:51` is in the `Scalar` arm,** whose size is at most 16 bytes, so it cannot stop.
- **`:18`'s `bits()` stops at 2^50 bytes,** where the product passes 2^53 − 1: the 2^50 − 1 signatures print and the 2^50 one stops. The handoff had not measured this.
- **It is reached by more than `extern "win64"`:** `extern "C"` on `x86_64-pc-windows-msvc` stops there too, and by reading so does `"vectorcall"`, which goes to the same function (`mod.ts:864-866`).
- **Patching `:18` alone is enough.** With only `:18` patched, in a copy, every dump is identical: 210 and 180 on `win64`, 630 on msvc. It is the only sibling inside `callconv/`.

**F5, outside `callconv/`.** Exit 70, never a wrong value, older than this batch. They mean the commit's title holds for the ABI and not for a program that uses such a type:

| Site | Upstream | Reproduction, on x86_64-linux and, for the first, darwin |
|---|---|---|
| `known_panics_lint.ts:1115` | `layout.size < Size::from_bytes(MAX_ALLOC_LIMIT)` (`:908`) | `pub struct H1([u8; 1 << 53]); #[rustc_abi(debug)] pub fn a1(_: H1) {}` at `-O --emit=metadata`: the oracle prints the dump, the port stops |
| `rustc_lint/types.ts:914` | `variant_size_differences`' `size.bytes()` as `u64` | `pub enum E { A(H1), B(u8) }` at `-Zunpretty=mir` |

With the first patched in a copy and `E` left out of the program (I did not patch the second), 17 by-value functions (moves, `drop`, `ptr::read`, closures, `fn` pointers, `extern "C"`) gave stdout identical to the oracle's at `-Zunpretty=mir` at three opt levels. By reading, the first fix is `Size_cmp`, the second `bytes_u64`, each about one line. `builtin.ts:541`, already in `abi-vtable`'s item 6, is a third of this class. I did not run these through mono or Miri.

## 5. Protect the 16 EII cases?

Root decides; this is what I found.

- **Stable.** `--filter tests/ui/eii`: 16/16 MATCH on three runs at this head, 4 to 7 s wall each, no `UNSTABLE` or `TIMEOUT`.
- **They do guard the decoder.** The stop gives 16 UNPORTED. `is_default` forced false gives 4 DIFF: `default/call_impl.rs` and `static/default_cross_crate_explicit.rs`, two revisions each. The new unit test sees only `name` and `is_default` through one error, and these cover the run-time side.
- **They cannot be protected alone as things stand.** Accept grows a suite's baseline with that run's new MATCHes (`scripts/gate.ts:16`, read, not run), and the suite has no baseline. So the choice is the whole suite or a new 16-case suite.
- **The whole suite.** Three full runs in `$RUST_TS_DATA/runs` show 338, 338 and then 355 of 356 MATCH, in 137 to 206 s, no `UNSTABLE` or `TIMEOUT`. The one left is `rust-log.rs`, `RUSTC_LOG`. Against a gate of about 10 hours, that is small. I did not run the full suite here.

## 6. Unit time

| Test | CPU at load 2 | CPU at load 4 to 9 | Wall |
|---|---|---|---|
| `eii.oracle.test.ts` | 1.56 s | 1.58 to 1.82 s | 0.85 to 0.95 s |
| `match_const`, alone with `-t` | 0.86 s | 1.30 to 1.81 s | 0.65 to 0.73 s |
| ABI test, before / after | | 2.63 to 2.79 / 2.72 to 2.90 s | |

**The lane's 2.4 s reproduces at low load** (1.56 + 0.86), and is about 3.2 s under load. By wall, which is what `plan-m7`'s line 432 limits, it is about 1.6 s. Within the 5 s either way. `match_const`'s 0.9 to 1.0 s is a low-load figure.

## 7. Oracle outputs, baselines, suites, scripts

**None changed.** The diff is 11 added and 7 modified files, none under `harness/`, `scripts/` or `tools/`, and no baseline. Both `abi.rs` oracle files are untouched. `regen.ts` from a copy reproduces all five oracle files byte for byte, so they are the oracle's and not the port's. The `aarch64_oracle/{common,regen,run}.ts` changes only generalise from targets to cases.

**Samples at this head,** unmodified, `--sample` with this review's seed:

| Suite | Result |
|---|---|
| `mono-ui --sample 40` | 40/40 |
| `run-pass-miri --sample 40` | 40/40 |
| `check-ui --filter tests/ui/abi` | 3/3 |
| `mir-o2 --filter tests/ui/abi` | 49/49 |
| `mir-o2 --sample 300` (instrumented with logging only) | 299 MATCH, 1 UNPORTED: `log-backtrace.rs`, `RUSTC_LOG`, not this batch |
| `mir-opt-o4 --sample 150` (same) | 150/150 |

## Not checked

- Full suites or the gate.
- abi-vtable F2's `pass_indirectly` removal, mir-alias F1's other four clones, mir-alias F2, F4 and W5: not re-run.
- Softfloat, Arm64EC or Windows AArch64 at huge sizes: specs not ported.
- A reachable merge of `unify_if_equal_const` at `-O`: none found, not proven absent.
- `check_unused.rs:453` against the oracle across crates.
- `n >= 8` (F1) through every suite that prints an `FnAbi`.

## Side effects

In `$RUST_TS_DATA/runs`, these are **deliberately bad**, from mutated copies:

- `20261106-204708-review-fixers-44-pwhw`, `20261106-204721-review-fixers-44-14w8`: `n >= 8`.
- `20261106-205533-review-fixers-44-j3pf`: the decoder stopped.
- `20261106-205538-review-fixers-44-tl4g`: `is_default` forced false.

`20261106-203911-…-dsyl`, `-203915-…-msxv` and `-204027-…-gieg` are logging-only. The other `review-fixers-44` runs are this head unmodified.

# fixers-44: EII metadata decoding, and test gaps from wave 39's reviews

Branch `t3/fix-eii-metadata-tests`, on `9e11cc8b`. No gate, full suite or full unit step run. Two commits' worth of tests are new; only F3 changes port code.

Most of this queue was already closed by `db43206f`, `ecc69f9b` (fixers-40) and `a3087db7` (root). I checked each by reverting the code in a scratch copy.

## Summary

| Item | State | Commit |
|---|---|---|
| 1. `EiiMapEncodedKeyValue` decoding | **Already closed** (`775991c0`). **New: a guard**, as nothing protected reached it | `8f81548b` |
| abi-vtable F1 | Already closed | `db43206f` |
| abi-vtable F2 | Already closed, two guards equivalent (below) | `ecc69f9b` |
| abi-vtable F3 | **Fixed here; it can be fixed faithfully.** One sibling left: `x86_win64.ts` | `901e335e` |
| mono-wire W2 | Already closed | `ecc69f9b` |
| mono-wire W3 | Already closed: one mutation killed, two equivalent (below) | `ecc69f9b` |
| mono-wire W5 | **Open, for root:** proposal below | |
| mir-alias F1 | 4 of 5 clones already closed (`a3087db7`); **the fifth closed here** | `1642fd77` |
| mir-alias F2, F4 | Already closed. F4's tool is under `src/`, not `scripts/` | `ecc69f9b` |
| mir-alias F3 | Already closed, except `lib.ts:697`, which is a no-op and cannot have a test | `a3087db7` |

`docs/next.md`'s queue lines for these items (wave 38's report line, line 463, and the reviews line of wave 39) are stale; that file is root's.

## Item 1: EII

Upstream read against the port: `get_externally_implementable_items` (decoder.rs:1594), the provider (cstore_impl.rs:347), and the tuple `(DefId, (EiiDecl, Vec<(DefId, EiiImpl)>))` (eii.rs:9). `decode_EiiDecl` and `decode_EiiImpl` are generated. No change needed.

| `run-pass-aux-miri`, seed `fixers-44`, `RUST_TS_REQUIRE_PROBES=1` | Result |
|---|---|
| `--sample 200`, after this lane's commits' code | **200 MATCH** |
| `--filter tests/ui/eii` (the 16), before F3 | **16 MATCH** |
| `--filter tests/ui/rustc-env` | 1 UNPORTED: `rust-log.rs`, `RUSTC_LOG`, not EII |

I did not run the full suite. fixers-40 reports 355/356 at its head, the one being `rust-log.rs`.

**What I found: the decoder had no guard.** With `decode_EiiMapEncodedKeyValue` replaced by a stop in a scratch copy, on `--filter tests/ui/eii`:

| Suite | Protected | Result with the stop |
|---|---|---|
| `run-pass-aux-miri` | no | 16 UNPORTED |
| `check-ui`, `rmeta-ui`, `mir`, `mono-ui`, `run-pass-miri` | yes | 11, 11, 92, 10, 10: **all still MATCH** |

So the gate would have accepted the decoder regressing, as these suites have no EII across crates. No unit test named it either.

**The guard:** `src/rustc_metadata/eii.oracle.test.ts`. Metadata built by the oracle, a decl with a default in one crate and an explicit impl in each of two others, read by the port; stderr and exit code byte for byte. Each of these fails it, in a scratch copy: the stop; `get_externally_implementable_items` returning nothing; `is_default` forced false; forced true; `decl.name` wrong.

**What it does not show:** `EiiImpl`'s `resolution`, `impl_marked_unsafe`, `span`, `inner_span` and `EiiDecl`'s `impl_unsafe`. That check prints none of them. Anything beyond the error stays with `run-pass-aux-miri`. **Root may want to protect that suite's 16**; it is report-only today.

## abi-vtable

**F1.** `tcx.vtable_allocation([ty, undefined])` in the `TraitVPtr` arm fails `vtable_static`.

**F2.** `valid_unit = true` and `pass_indirectly` removed both fail the fixture. The `is_scalable_vector` guards at `aarch64.ts:96,127`, each removed alone, still pass, as fixers-40 says: `SimdScalableVector` is non-aggregate and non-scalar, so the next branch does nothing to it. The dump (`CScalable`) is pinned.

**F3: fixed.** `mod.ts` compared with `size.bytes()` where upstream compares `Size`: `Size_cmp` now, as upstream's `>` and `<=`. `x86_64.ts` computes `div_ceil(8)` in `bigint`, as upstream's `u64`, with a `// PORT:`. `src/rustc_target/callconv/aarch64_oracle/sizes.rs` is new, run on all three targets at `-O`; the oracle files are regenerated, and `abi.rs`'s two came out byte-identical.

- **Sizes:** 8, 9, 16, 17, 2^53 − 1, 2^53, 2^53 + 1, 2^60, 2^61 − 1 bytes, Rust and `extern "C"`.
- **Also compared by hand on the fix:** all three targets with and without `-O`; 11 dumps each, `"rust-cold"` too; identical.
- **`abi.rs` on x86_64, by hand:** the first 11,948 lines of stderr are identical. Both sides then ICE with the same message on `CScalable`, `scalable vectors are unsupported`; only the ICE's format differs. So the review's `CHuger` stop is gone.
- **Mutations, each fails the fixture:** each of the three back to the old form; `> 0` as `>= 0`; `<= 0` as `< 0`.

**Left: `x86_win64.ts:18` (`bits()`) and `:51` (`bytes()`).** `extern "win64" fn(H)` with `H` of 2^61 − 1 bytes on x86_64-linux stops at exit 70 where the oracle prints the dump. The same fix would apply. The file was not assigned, so it is yours to queue; I did not measure the threshold.

The other `.bytes()` and `.bits()` in `mod.ts` and `x86_64.ts` I read but did not test above 2^53. Those at `mod.ts:969-974` are SIMD only, and those at `mod.ts:718,1144,1177-1188` and `x86_64.ts:98-99` come after a size test or a cast. I found no route to them with such a size. Any I missed stops loudly.

## mono-wire

**W2.** The reversed order at `mono.ts:748` fails `overlap`'s `-Zcodegen-source-order` case. (The review's `:855` is now `:748`.)

**W3.** `overlap += 1` fails. Both of these still pass all 66 cases, as fixers-40 reports, for the reasons in its handoff: `!inlined` counted, and `consumed_cgu_names` truncated. I reran them and did not re-derive the reasoning.

**W5, a proposal; I changed nothing under `scripts/`.** `bun scripts/coverage.ts --order` now exists (`61448ce9`, harness-w41): it finds what the deleted scripts did, but is report-only and no gate step runs it.

- **It does see this crate:** two markers swapped in a scratch copy of `partitioning.ts` gives a row, and 917 → 918 markers. Today there is no `rustc_monomorphize` row. `rustc_middle/mono.ts` has one, N4's, which PORTING section 8 allows and which a prefix leaves out.
- **Smallest replacement:** `--order --require-clean <prefix>` in `scripts/coverage.ts`: keep the rows whose file starts with the prefix, one `ERROR:` line each, exit 1. About five lines, and one line in the gate's marker step with `src/rustc_monomorphize/`.
- **Why not everywhere:** 917 markers out of order in 189 file pairs, and section 8 allows some, so a repo-wide rule needs an allowlist first. A clean crate needs none.

## mir-alias

**F1.** Each of `unify_by_eq_op`, `unify_by_int_to_int` and `unify_by_copy`'s two clones, reverted alone, fails `fixed aliasing`. **The fifth, `unify_if_equal_const`, is new:** `alias_check_oracle/match_const.rs`, `#![no_core]`, `-Zmir-opt-level=0 -Zmir-enable-passes=+MatchBranchSimplification`. Reverting it fails the new test. Why that flag: `try_as_constant` gives each constant `DUMMY_SP` (`gvn.rs:1990-1999`), so at `-O` `identical_stmts` takes the case first. With a scratch print on this program, the site is reached 0 times at `-O` and once at this flag or at `-O -Zmir-enable-passes=-GVN`.

**F2.** The walker from before `ecc69f9b` fails 7 of `find_shared_objects`' tests.

**F3.** Reverting `by_move_body.ts:246` or `promote_consts.ts:1179` fails `fixed aliasing`.

**F4.** `sweep_outcome.ts`'s `CHECKED` on any exit, and `BOTH_ICE` comparing nothing, each fail the `sweep.ts` tests.

Also still failing when reverted: borrowck's annotations, `raw_ptr`, `cor_ref_place`, `cor_pin_place`.

## Results

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean. Needed `bun install --frozen-lockfile` here |
| `coverage.ts --check --offline` | markers ok (24,848) |
| `coverage.ts --missing` | `callconv/mod.rs` 45/45, `x86_64.rs` 5/5, `decoder.rs` 156/156, `eii.rs` 1/1, `match_branches.rs` 15/15 |
| `bun test src/rustc_target src/rustc_metadata src/rustc_monomorphize alias_check.test.ts` | 304 pass, 0 fail |

`--sample`, seed `fixers-44`, with F3's code in, at load up to 33:

| Suite | MATCH | Other |
|---|---|---|
| `run-pass-aux-miri`, 200 | 200/200 | |
| `run-pass-miri`, 100 | 100/100 | |
| `mono-ui`, 100 | 100/100 | |
| `mono-ui`, `--filter tests/ui/abi` | 49/49 | |
| `mir-o2`, 60 | 60/60 | |
| `check-ui`, 60 | 60/60 | |
| `miri-fail`, 60 | 60/60 | |
| `miri-hello` | 1/1 | |

## Unit-time budget

CPU, user + sys, 3 runs each at load about 5, `bun test`'s own start (0.06 s) included: the `eii` test 1.3-1.4 s; `match_const` 0.9-1.0 s, alone with `-t` (`1642fd77`'s message says about 1.1 s, an earlier measurement); the ABI test 2.6-3.2 s before and 2.6-2.9 s after, so no cost I can separate from its noise. **About 2.4 s of the 5 s.**

## `// PORT:` decisions

`callconv/x86_64.ts`, `classify_arg`: `div_ceil(8)` in `bigint`. `mod.ts` gets none, as `Size_cmp` is what upstream's comparison is.

`unported(...)` left by this lane: none. Removed: none, as the stop was `rustc_abi::Size`'s, reached no longer on these paths.

## Files

Port: `src/rustc_target/callconv/mod.ts`, `x86_64.ts`. Tests and fixtures: `callconv/aarch64.oracle.test.ts`, `aarch64_oracle/{common,regen,run}.ts`, `sizes.rs`, `oracle/sizes.*.txt`; `rustc_mir_transform/alias_check.test.ts`, `alias_check_oracle/match_const.rs`; `rustc_metadata/eii.oracle.test.ts`, `eii_oracle/{decl,impl1,impl2,both}.rs`.

## Side effects

`.data/runs/*-fixers-44-mut-*`, 6 runs, are **deliberately bad**: the decoder stopped in a scratch copy. They are the table in item 1, not results. This lane's `.data/tmp/*/fixers-44*` are removed. `.data/coverage-order.txt` was rewritten; my last run was from an unmutated tree (917).

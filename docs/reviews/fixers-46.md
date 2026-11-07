APPROVE WITH NITS: every `Size` fix matches upstream, its fixtures are the oracle's output, and nothing measurable changes on a protected path. The nits are: one fix that no test pins, a `tempdir_in` test that breaks once fixers-45's error path is merged, an ICE fixture that changes on every regen, and two more stops of the same kind for root's queue.

# Independent review: fixers-46

Branch `t3/03b233c5`, head `fb984fe4`, on `main` `26e61959`. Commits `25f7527d`, `2b1da04c`, `9fca3d9e`, `23e9262f`, `a9ff88d7` and the handoff.
All runs used `RUST_TS_REQUIRE_PROBES=1`, `RUST_TS_AGENT=review-fixers-46` and `RUSTUP_AUTO_INSTALL=0`. They ran in detached worktrees of `fb984fe4` and
`26e61959` under my scratchpad, since removed. The machine was on AC at a load of 4 to 34 from other lanes. I ran no gate and no full suite. The only
file I wrote in the repo is this one; the edits I made for mutants were in those throwaway copies.

| # | Severity | Where | Finding | Evidence |
|---|---|---|---|---|
| F1 | low, test gap and wrong claim | `rustc_hir_typeck/intrinsicck.ts:129` | The E0591 check's `Size_eq` is not pinned. Reverting it to `bytes() ===` passes the ABI test, although the handoff says every fix fails its test when reverted alone | reproduced |
| F2 | merge note, for root | `rustc_metadata/fs.test.ts` (the path-limit test); fixers-45's `fs.ts` | Once fixers-45's `with_err_path` is merged, the error is `Custom`. Its `raw_os_error()` is then `None`, and this lane's test fails (`Expected: 63, Received: undefined`) | reproduced |
| F3 | nit | `callconv/aarch64_oracle/regen.ts:19`; `oracle/scalable_indirect.aarch64-apple-darwin.txt:3` | The thread id should be masked when the fixture is written, not restored by hand | reproduced |
| F4 | for root's queue, not this batch | `rustc_middle/mir/interpret/allocation.ts:113`; `rustc_mir_transform/gvn.ts` `simplify_place_projection` | Two more stops at or above 2^53 that ordinary code reaches: a `static` that large (the oracle gives E0080), and a constant index that large at `-O` | reproduced |
| F5 | nit | `scripts/miri-sysroot-run.ts:80-87` | The comment says the file is "written when absent", but the code also overwrites a `lib.rs` whose content differs | read only |
| F6 | nit, wording | handoff §5 | For F6, "stderr identical with thread ids masked" also needs the backtrace body masked: the oracle prints 20 Rust frames and the port prints its JS stack | reproduced |

## 1. The `Size` fixes

**Against upstream, line by line: faithful.**

| Port | Upstream (pin `6f5da406`) | Check |
|---|---|---|
| `known_panics_lint.ts:1115` `Size_cmp(layout._0.size, Size.from_bytes(MAX_ALLOC_LIMIT)) < 0`, else `NoPropagation` | `known_panics_lint.rs:908` `Ok(layout) if layout.size < Size::from_bytes(MAX_ALLOC_LIMIT) => {}` | same guard, same arms |
| `rustc_lint/types.ts:907-933`: `tag_size`, `bytes`, `largest`, `slargest` as `bigint`; `variant_bytes > tag_size ? variant_bytes - tag_size : 0n`; the fold; `largest > slargest * 3n && slargest > 0n` | `types.rs:991-1027`: `u64`s, `saturating_sub`, the same fold and test | exact. `slargest * 3` cannot wrap below 2^61 in either version |
| `rustc_abi/layout.ts:349-364`: `head_space`, `niche_len`, `tail_space` and the `alt_` ones from `bytes_u64()`; `head_space !== 0n && tail_space > 0n`; `prefer_alt_layout` | `layout.rs:297-317` | same order, same comparisons, exact. The niche lies inside the size, so the subtraction cannot go below 0 on either side |
| `rustc_middle/ty/layout.ts:786` `size.bytes_u64() === 0n && align …bytes() === 1` | `layout.rs:530` | same |
| `rustc_middle/ty/layout.ts:878` `Size_eq(a, b)` | `layout.rs:603` `a == b` | the derived `PartialEq` |
| `intrinsicck.ts:71` `size.bytes_u64() * 8n` | `intrinsicck.rs:50`, `u128::from(size.bytes()).checked_mul(8)` | exact |
| `intrinsicck.ts:129` `Size_eq(sk._0, Primitive.size(Pointer…))` | `intrinsicck.rs:110` `size_to == Pointer(..).size(&tcx)` | same |
| `move_check.ts:144` `bytes_u64() > BigInt(limit._0)`; `:183` `size: bytes_u64()` | `move_check.rs:134` `bytes_usize() > limit.0`; `:182` `size: too_large_size.bytes()` | exact on a 64-bit host |

`Size_eq` and `Size_cmp` (`rustc_abi/lib.ts:1460,1466`) compare `small` only when neither size is big, so the `NaN` of a big `Size` is never compared.
`bytes_u64()` shares a `bigint` for sizes below 1,024. `tsc` is clean. `coverage.ts --check --offline` passes (24,872 markers), and `--missing` gives
`types.rs` 28/28, `known_panics_lint.rs` 37/37, `move_check.rs` 9/9, `rustc_abi/layout.rs` 16/16, `rustc_middle/ty/layout.rs` 61/61,
`intrinsicck.rs` 6/6 and `rustc_metadata/fs.rs` 5/5.

**The fixtures are the oracle's output.** I re-ran the pinned rustc (`+nightly`, `rustc 1.101.0-nightly (6f5da406b 2026-10-10)`) on every ABI case
using `common.ts`'s own `abi_args` and `test_env`. `abi.rs` on both targets, `sizes.rs` on all four, `big.rs` and `big_err.rs` are byte-identical
to the committed files. `scalable_indirect` is identical once the thread id is masked (F3). `collector_oracle/regen.ts large_assign` rewrote
`large_assign.txt` byte for byte.

**Mutants, each reverted alone in a copy of the head:**

| Fix reverted | Test | Result |
|---|---|---|
| `known_panics_lint.ts:1115` back to `bytes() <` | ABI oracle test | fails (killed) |
| `types.ts` `variant_bytes` back to `bytes()` | ABI | killed |
| `rustc_abi/layout.ts` `tail_space` back to `bytes()` | ABI | killed |
| `same_size` back to `a.bytes() === b.bytes()` | ABI | killed |
| the 1-ZST test back to `bytes() === 0` | ABI | killed |
| `intrinsicck.ts:71` back to `BigInt(size.bytes())` | ABI | killed |
| **`intrinsicck.ts:129` back to `sk._0.bytes() === Pointer.size.bytes()`** | ABI | **passes (survives): F1** |
| `move_check.ts:144` back to `bytes_usize() > limit._0` | collector oracle `-t large_assign` | killed |
| `move_check.ts:183` back to `BigInt(bytes())` | collector | killed |

**F1.** Ordinary code reaches this site: `fn foo() {}` and `transmute::<_, B53>(foo)`, in `big_err.rs`'s `#![no_core]` prelude. The head matches the
oracle byte for byte: exit 1, E0512, `` `fn() {foo}` (0 bits) `` and `` `B53` (72057594037927936 bits) ``. The mutant stops with
`rustc_abi::Size beyond 2^53` (exit 70). The fix is right, but nothing tests it. Adding those two lines to `big_err.rs` and regenerating it would pin it.

**`layout_of_univariant` and the protected paths.** For every size below 2^53, the change gives the same comparisons on exact values, so no layout can
change. Samples at the head, all with this agent's seed, which differs from the lane's:

| Suite | Result | Run |
|---|---|---|
| `mir --sample 150` | 150/150 | `20261107-112055-review-fixers-46-xf3a` |
| `mir-o2 --sample 150` | 150/150 | `-112128-review-fixers-46-73y0` |
| `tydump-ui --sample 150` | 150/150 | `-112214-review-fixers-46-u42t` |
| `mono-ui --sample 100` | 100/100 | `-112255-review-fixers-46-0o6x` |
| `check-ui --sample 150` | 150/150 | `-112331-review-fixers-46-6v41` |
| `rmeta-ui --sample 100` | 100/100 | `-112405-review-fixers-46-2omz` |

**Hello's instructions.** `/usr/bin/time -l`, `fn main` with `println!`, `--edition 2021 --target x86_64-unknown-linux-gnu --emit=metadata`, one
warm-up run each, alternating, at a load of 20 to 34.

| Checkouts | n | `26e61959` median (range) | `fb984fe4` median (range) |
|---|---|---|---|
| main = this worktree, head = scratchpad (different path lengths) | 9 | 10.29 G (10.18-10.38) | 10.65 G (10.49-10.70) |
| both under the scratchpad, paths of equal length | 7 | 10.62 G (10.27-10.64) | 10.63 G (10.19-10.67) |

The first row's +3.5% comes from the checkout's path, not from the code. With equal paths there is no difference. As a third arm, the head with
`fs.ts` reverted to `main`'s (`node:crypto` no longer imported) gave 10.61 G (10.32-10.66). **No cost is detectable.**

**Remaining sites of the same kind (F4).** I swept by-value code at `--emit=metadata`, `-O --emit=metadata` and `-Zunpretty=mir -O` with std on
aarch64-apple-darwin. The cases were: `Option`, niche and non-niche enums, `size_of`/`align_of`, `&B as &dyn Any`, `Box`, tuples, arrays of
the type, `repr(C)` structs and unions, `packed`, `align(64)`, closures capturing the value, slices, indexing, `ptr::add`, a `const` of `size_of`,
and returning or assigning `[0; 2^53 + 1]`. All of it is byte-identical to the oracle, except for two stops, both present before this batch:
- `pub static S: [u8; 9007199254740993] = [0; 9007199254740993];` gives oracle exit 1 with `E0080: tried to allocate more memory than available to
  compiler`. The port exits 70 at `AllocBytes_Box.zeroed` (`allocation.ts:113`, `new Uint8Array(size.bytes())`). `size.is_big()` there can
  only be an allocation failure on any host, since 2^53 bytes exceeds every 64-bit address space in use, so it could return `undefined`. That is a
  `PORT:` decision for root.
- `x[9007199254740992]` on a by-value array that large, at `-O`, stops at `gvn::simplify_place_projection` (ConstantIndex offset beyond 2^53).
  This is a `u64` offset rather than a `Size`, so it is a sibling problem.
- The handoff's own leftover, `-Zprint-type-sizes`, is a `-Z` flag. I did not run it.

## 2. `tools/codegen/`

**This is the existing mechanism, used as intended.** `fields` with `::rust_ts::u64_exact` is followups-34's per-field override in
`mir.typemap.json`. A set-local `typemap_extra` (`lint.typemap.json`) is how other crates add one (`borrowck.typemap.json` and others). The
`diag_args.json` path lets `number_into_diag_arg`, which already takes `number | bigint`, serve the new type. Under PORTING §1 these files belong to
root, and AGENTS §2 asks that `harness/` and `scripts/` changes come as a batch of their own. Root should accept these explicitly. Nothing in them is
wrong.

**The regeneration reproduces the committed files.** In a clean checkout of the head I ran `bun tools/codegen/types.ts <set>` in place for `rustc_lint`,
`rustc_monomorphize`, and every other set that loads `mir.typemap.json`: `rustc_middle_mono`, `rustc_middle_diagnostics`, `rustc_middle_mir`,
`rustc_mir_build_builder`, `rustc_mir_transform`, `rustc_const_eval_interpret`, `rustc_borrowck` and `miri`. Afterwards `git status` was clean. Each
`.gen.ts` in the diff changes by the one field line. No other typemap uses `u64_exact`.

**Formatting.** Upstream's `u64` `IntoDiagArg` is `Number` when the value fits an `i32`, else a string. `number_into_diag_arg` takes the same branch on
`BigInt(self)` for either type, so a `bigint` formats exactly as a `number` does below 2^53, and exactly above it. Both messages that use these fields,
`VariantSizeDifferencesDiag` (`({$largest} bytes)`) and `LargeAssignmentsLint` (`moving {$size} bytes`), are pinned against the oracle at
9007199254740992 and 9007199254741001 (`big.*.txt`, `large_assign.txt`).

## 3. `tempdir_in`

**It matches tempfile 3.23.0** (Cargo.lock: tempfile 3.23.0, fastrand 2.3.0; `crate-src.ts tempfile`):
- `util::create_helper`: makes the base absolute from `current_dir()`, tries `NUM_RETRIES` = 65,536 times, and on `AlreadyExists` takes the next name.
  Any other error is returned at once, and the last error is `AlreadyExists, "too many temporary files exist"`.
- `tmpname`: the prefix, then `random_len` = 6 (`NUM_RAND_CHARS`), then the suffix. The `Builder::default` prefix is `.tmp`, which `fs.ts` keeps.
- `dir::create`: `DirBuilder::new().create`, with the default mode, because rustc never sets `permissions`.
- The character set is fastrand's `alphanumeric`: `A-Z`, `a-z`, `0-9`, 62 characters.

**Not ported, and harmless:** the `AddrInUse` arm, which `mkdir` never returns, and rustc_fs_util's Windows retry on `PermissionDenied` (Windows is
unchecked). **Randomness:** `crypto.randomBytes` is a CSPRNG. `% 62` slightly favours the first 8 characters (256 mod 62 = 8). That does not matter for
collisions, and the retry loop covers them.

**No protected output holds a temp directory name.** I grepped the whole oracle cache (5.0 GB) for `(rmeta|/rustc)[A-Za-z0-9]{6}[/"\]` and
`.tmp[A-Za-z0-9]{6}.temp-archive`: 0 files. The `rmeta-ui` sample above goes through the new code.

**The merge with fixers-45 (F2).** fixers-45 (`t3/fix-rustc-findings-logging`, `bd538a1d`) independently rewrote the same function to the same shape,
adding `with_err_path`. The merged function must keep all of the following:
- the absolute base;
- one `mkdirSync(path)` per try, of `base/<prefix><6 alphanumerics><suffix>`;
- no `mkdtempSync` and no rename;
- a retry on `AlreadyExists` only, decided on the kind after `with_err_path` wraps it (it keeps the kind);
- `NUM_RETRIES` 65,536;
- the default mode;
- `with_err_path(e, path)` on the `mkdir` error, and `with_err_path(…, base)` on "too many temporary files exist".

**This lane's test has to change too.** With fixers-45's `fs.ts` on this head, `fs.test.ts`'s path-limit test fails, because
`IoError_raw_os_error` of a `Custom` error is `undefined`, as `raw_os_error()` is `None` upstream. It should compare `IoError_kind` and check that the
`Display` starts with `mkdir`'s message and ends with `` at path "<path>"``.

## 4. `custom_local_sysroot`

- **Where it writes.** `miriSysrootBuildDir` takes the first match of `^(/.*?/rustc-build-sysroot-[A-Za-z0-9]+)/target/` in the one
  `custom_local_sysroot-*.d` under `$RUST_TS_DATA/miri-sysroot/.../lib`, and throws on zero or several files. The only file written is `<that>/lib.rs`,
  and only when it is missing or differs. The contents are always `""`, from the corpus's `sources`. If the sysroot is rebuilt, the `.d` names the new
  build's temp directory, which tempfile has already removed, so the script recreates that directory under the system temp dir. A `.d` naming some
  other directory would still need a `rustc-build-sysroot-*` component followed by `/target/`. The worst it can do is create an empty `lib.rs` in a
  directory of that name. I consider that safe. F5 is only the comment's wording.
- **It is confined to the report suites.** `miriSysrootRun` (`scripts/miri-sysroot-run.ts`) is the only writer, and only the `miri-sysroot-{core,alloc,std}`
  suites call it (`harness/suites.ts:2245-2265`). None of them builds `custom_local_sysroot`: `MIRI_SYSROOT_SUITE_CRATES` is unchanged. The unit test
  calls `miriSysrootInvocation` only, which reads the `.d` and writes nothing.
- **The protected set is unchanged.** `crates.json`, `harness/miri-sysroot.ts` and the script are hashed only in the `miri-sysroot-*` `oracleKey`. Those
  suites have no baseline file, nothing else reads these files (grep of `src`, `scripts`, `harness`, `tools`), and no baseline, suite definition or
  oracle output is in the diff.
- On this host, `/var/folders/23/.../T/rustc-build-sysroot-XIGEBx/lib.rs` exists and is empty. It is dated 13:05 today, so a later run than the lane's
  rewrote it, or recreated it after a temp-dir clean.

I did not re-run `miri-sysroot-alloc` with the crate swapped in. That is one heavy process of about 3 GB.

## 5. F2's `scalable_indirect` test

**Strong enough for what it pins.** The compared message is the assertion text plus the `Debug` of `left`, which is
`Direct(ArgAttributes { …, pointee_size: Size(0 bytes), … })`. Removing the guard gives exit 1 with a dump (the lane's check). The check
does not compare the panic location or the query stack (`fn_abi_of_fn_ptr`), so the same assertion reached from another query would pass. That is an
acceptable trade-off for a case whose two ICE reports differ in form. I did not check whether the port's report has the query stack.

**F3.** `regen.ts` writes the oracle's stderr unchanged, so every regen rewrites `thread 'rustc' (60294247)`. `ice_message` already accepts any `\d+`.
Masking it in `regen.ts` (for example `(\d+)` to `(0)` on the `thread 'rustc'` line, with `ice_message` still accepting digits) makes regen
idempotent. Restoring the old id by hand is easy to forget. `RUSTC_ICE=0` (`test_env`) keeps the ICE file out of the source tree; I checked that none
was left.

## 6. miri-sysroot F6

**Already fixed by `c6517ac5`, which is in `main`.** With the isolated Miri binary called directly (`RUSTUP_HOME=rustup-miri`, never `+nightly`) and
`MIRI_BE_RUSTC=target --crate-type dylib` and then `staticlib`, both sides exit 101. Both print `panicked at
/rustc/6f5da406…/src/tools/miri/src/bin/miri.rs:302:21:` with `assertion failed: !config.opts.crate_types.is_empty()`, and the rest of the report
matches apart from the backtrace body, the thread id and the ICE file path. The "location refused: unmarked frame" stop is gone. I did not run the
118-case ICE comparison.

## 7. Unit time, side effects

- **Unit time.** At a load of 4 to 9, the ABI oracle test took 1.15-1.19 s on `main` and 1.42 s on the head, about +0.25 s for three more cases.
  `fs.test.ts` takes 0.22 s and `harness/miri-sysroot.test.ts` 0.06-0.12 s. In total the unit step gains about 0.5 s. All lane tests pass at the head
  (9 tests in 4 files, plus the collector's `large_assign`).
- **Written outside the worktree by the lane:** `$RUST_TS_DATA/tmp/ice-report/res-fixers46{,.json}`; under `$RUST_TS_DATA/tmp/`, the
  `fixers-46` directories of `aarch64-abi-oracle`, `aarch64-abi-test`, `mono-collector-oracle` and `mono-collector-test` (268 KB); 10 run directories;
  and the temp `lib.rs`. All are as the handoff lists, or ordinary run output.
- **Written by me:** run directories `*-review-fixers-46-*`, `$RUST_TS_DATA/tmp/{aarch64-abi-test,mono-collector-oracle,…}/review-fixers-46`,
  and scratchpad files only.

## Not checked

- I did not run the full unit step, the 118-case ICE comparison or `miri-sysroot-alloc`.
- I did not run the lane's own sweep programs, only my own (§1).
- I did not run `-Zprint-type-sizes`.
- I did not run any target other than aarch64-apple-darwin for `big*.rs`. The fixtures exist only for darwin.
- I did not check Windows behaviour of `tempdir_in`.

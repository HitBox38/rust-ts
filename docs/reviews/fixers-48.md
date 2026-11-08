APPROVE WITH NITS: all five items are fixed as the handoff says, each matches upstream (or memmap2 0.2.3 / tempfile 3.23.0 / std at the pin) and the oracle, and no protected output moves: check-std matches, every rmeta-ui/check-ui/pm-ui sample and slice/array/pattern filter matches on protected cases, and module evaluation order for the three real entries is identical. The nits: the new vendor code has no `// crate:` markers, and two observations.

# Independent review: fixers-48

Branch `t3/6b4c6b71`, head `6962913b`, on `main` `519e6360`. Commits `6ff7d2a9`, `2b7dc43f`, `e1f80cc4`, `fbacf9ad`, `76504908` and the handoff
`6962913b`. All runs used `RUST_TS_REQUIRE_PROBES=1`, `RUST_TS_AGENT=rv-fixers-48`, `RUSTUP_AUTO_INSTALL=0` and `RUSTC_ICE=0`, with `.env.local` copied
from `integ-w39`. They ran in detached worktrees of `519e6360` and `6962913b` under my scratchpad, at paths of equal length (`…/scratchpad/wmain`,
`…/scratchpad/whead`), plus a third of head for mutants (`wmutx`). All three have since been removed. The host was on AC power, at a load of 10 to 17 from other lanes. No gate and no full suite.
check-std ran once, alone. This file is the only one I wrote in the repo.

| # | Severity | Where | Finding | Evidence |
|---|---|---|---|---|
| N1 | nit | `src/rustc_data_structures/memmap.ts:116`, `src/rustc_codegen_ssa/back/archive.ts:182`, `:211` | New vendor logic without `// crate:` markers | read |
| O1 | observation | `src/rustc_data_structures/memmap.ts:116` | `map_copy_read_only_ffi`'s success path (a non-regular file that maps) is untested | read |
| O2 | observation | `src/rustc_codegen_ssa/back/archive.ts:199` | `openSync(path, "wx")` is write-only; tempfile opens read+write (from before this batch) | read |

## Findings

**N1 (nit, read).** PORTING §5b: vendor code carries `// crate: <crate>-<version>/<path>:<line> <name>`. `map_copy_read_only_ffi` is memmap2-0.2.3
`src/unix.rs:119 map_copy_read_only` (through `MmapInner::new`, `:36`). `tempfile_with_suffix` now follows tempfile-3.23.0 `src/util.rs:22 create_helper`
and `src/file/mod.rs:1063 create_named`. `with_err_path` is `src/error.rs:30 with_err_path`. They cite these in doc comments, not markers.
No memmap2 or tempfile marker exists anywhere in `src/` (neither crate is vendored, and neither is in `harness/scope.json`), so this follows the files' existing practice.
The handoff says so ("external, with no markers"). Failing scenario: `bun scripts/coverage.ts` cannot see these functions, and a later bump of either
crate has no marker to find them by. Not blocking. Either add markers or record that inlined helpers from unvendored crates go unmarked.

**O1 (observation, read).** When `mmap(2)` succeeds on a non-regular file of non-zero `st_size`, the port copies the bytes (`toArrayBuffer(...).slice()`)
and `munmap`s at once. I found no such file reachable without root on darwin (`/dev/zero` and `/dev/null` have `st_size` 0, and a directory fails with
EINVAL). By reading: the mapping is unmapped on that path, and the dangling `toArrayBuffer` view is never kept, so nothing leaks and nothing reads after the unmap.
Regular files never reach the FFI path: `Bun.mmap` is unchanged for them, so nothing new can leak or misread on the rmeta path.

**O2 (observation, read; not this batch).** tempfile's `imp::create_named` uses `read(true).write(true).create_new(true)` with mode 0o600. The port opens
`"wx"` (no read). Nothing reads the fd through that flag and no output shows it, so this is noted only because the lane re-ported the surrounding function.

## 1. `6ff7d2a9`: array patterns past 2^53 (`pat.ts`)

- **Upstream** (`compiler/rustc_hir_typeck/src/pat.rs:3152-3234`): `check_array_pat_len`'s `len` and `min_len` are `u64`. The two diagnostics take `u64`s and use
  `pluralize!` (`== 1`). The port now passes the `bigint` `pat_len` to `Ty::new_array` (which takes `number | bigint`). `Const::from_target_usize` does
  `BigInt(n)`, so a `bigint` and a `number` length intern to the same `Ty`. It also passes `BigInt(min_len)`/`len` to both diagnostics. `pluralize(Number(x))` is correct:
  `Number(x) === 1` only for `1n`. Same branches, same order. `min_len` stays a `number` (it counts pattern elements in the source).
- **Reproduced against the oracle** (stdout, stderr and exit code, `--emit=metadata`): the lane's `g` (rest binding of 2^53+1) and `h` (E0527 against 2^53+1)
  ICE on `main` and are identical at head. My own extra file is also identical at head. It has E0527 and E0528 with small arrays, and a 4-element-and-rest pattern on a
  2^53+1 array with an E0308. It also has an E0308 whose message prints the rest binding's type, `&[u8; 18446744073709551614]`, from `let [a, r @ ..] = x` on `&[u8; u64::MAX]`.
  On `main` it differs.
- **Fixture:** `regen.ts` run from a head worktree rewrote all `oracle/*.txt` files (fresh mtimes), and `git status` stayed clean, so the committed
  `big_err.aarch64-apple-darwin.txt` is the pinned oracle's output. `aarch64.oracle.test.ts` 2/2 passes.
- **Protected slice patterns** (head, `--sample 40 --jobs 4` with each filter): mir `slice`/`array`/`pattern` 40/40 each. mir-o2 40/40 each.
  tydump-ui typeck+traits 5/5, 5/5, 4/4, and rustc_dump 0/0, 2/3, 3/3. The one UNPORTED, `tests/ui/layout/gce-rigid-const-in-array-len.rs` (Backtrace Display),
  is not in `harness/baseline/tydump-ui.txt`. Runs `rv48-{mir,mir-o2,tydump-ui}-{slice,array,pattern}`.

## 2. `2b7dc43f`: `rlib_macho.test.ts` header

I extracted `nc.rs` with the header's own command (`grep '^// |' … | sed 's/^\/\/ |//'`): 221 bytes, 11 lines. I built it with the header's command in a
directory holding only `nc.rs`, and decoded `HOST_RLIB` from the test. `cmp`: **byte-identical** (2,328 bytes). 7/7 pass.

## 3. `e1f80cc4`: `Mmap::map` of a non-regular file

- **Version:** upstream's `Cargo.lock` has a single `memmap2` entry, 0.2.3 (rustc_data_structures asks `"0.2.1"`), and that is the source
  `bun scripts/crate-src.ts memmap2` gives. Upstream `memmap.rs` calls `MmapOptions::new().map_copy_read_only(&file)` → `get_len` (`file.metadata()?.len()`)
  → `MmapInner::map_copy_read_only` → `MmapInner::new`: aligned length 0 is `InvalidInput("memory map must have a non-zero length")`, otherwise
  `mmap(NULL, len, PROT_READ, MAP_PRIVATE, fd, 0)` and `last_os_error()` on `MAP_FAILED`. memmap2 never checks the file type. The port tests size 0
  first for every file type, then sends non-regular files to real `mmap(2)` and keeps `Bun.mmap` for regular ones. `PROT_READ` = 1 and `MAP_PRIVATE` = 2 hold on darwin and linux.
  `errno_reader()` is taken before the lazy `dlopen`, and `errno` is read right after the call. The `try`s now catch only Node's errors, so `unported` propagates
  (the old catch-all turned it into an `Os` error with no errno, the bug).
- **Reproduced against the oracle**, `-Zcodegen-backend=dummy --crate-type rlib`: `-l static=dir` with a directory `libdir.a`, host and
  `--target x86_64-unknown-linux-gnu`, gives "Invalid argument (os error 22)" on both. `libnull.a → /dev/null`, host and ELF, and `libzero.a → /dev/zero`
  give "memory map must have a non-zero length". All are identical at head. On `main`, dir and null stop with `unported: std::io::Error raw OS error (darwin, UNKNOWN)`.
  `static:+whole-archive=dir` is identical on both (`Is a directory (os error 21)`). (A FIFO blocks in `open(2)` on the oracle too, so I dropped it.)
- **Test:** passes. With `main`'s `memmap.ts` it fails (mutant reproduced).
- **Samples (head, `--sample 120 --jobs 4`):** rmeta-ui 120/120, check-ui 120/120. pm-ui is 119/120: the UNPORTED `tests/ui/proc-macro/expand-expr.rs` (cross-thread
  proc macro) is not protected. check-std (once, alone): **MATCH** 1/1, subject 17.7 s, 3,184 MB. Runs `rv48-{rmeta-ui,check-ui,pm-ui,check-std}`.
- **Instructions retired**, `hellobin.rs` (`fn main` with `println!`) as `--crate-type bin --emit=metadata`, 5 interleaved runs from the equal-length paths:
  `main` median 10,536 M (10,406 to 10,707), head median 10,504 M (10,157 to 10,574). That is noise: regular files take the same path as before.

## 4. `fbacf9ad`: `std::env::temp_dir` and tempfile paths

- **std at the pin** (`library/std/src/sys/paths/unix.rs:432/442`, `sys/pal/unix/conf.rs:16`): `var_os("TMPDIR")` as is (no empty filter, unlike `home_dir`).
  Otherwise darwin uses `confstr(_CS_DARWIN_USER_TEMP_DIR, Some(64))`, falling back to `/tmp`. Android is out of scope, and everything else uses `/tmp`. The port follows this.
  It does call `confstr` with 65537, which is libc-0.2.189's value (`src/unix/bsd/apple/mod.rs:3166`, the version both lockfiles pin). The `confstr` loop matches
  upstream, `Vec::reserve`'s growth (`max(2·cap, needed, 8)` from len 0) included, and so do the NUL check and the error path. Upstream's `confstr` is `cfg(target_vendor = "apple")`.
  The port only calls it on darwin. Linux returns `/tmp`, by reading.
- **tempfile 3.23.0** (`Builder::tempfile` → `tempfile_in(env::temp_dir())` → `create_helper` → `create_named` + `with_err_path`): the port matches. That covers the
  absolute-base join with `current_dir()?`, `NUM_RETRIES` 65,536, retry on `AlreadyExists`/`AddrInUse` (the kind survives `with_err_path`),
  `"{err} at path {path:?}"`, and the final "too many temporary files exist" with the base.
- **Reproduced against the oracle**, universal `libfat.a` from the test's fixture, random names masked: `TMPDIR` unset gives no leftover in the cwd on either side, and
  one each in `getconf DARWIN_USER_TEMP_DIR` (I deleted the two). `TMPDIR=` (empty) gives one leftover in the cwd on each side. `TMPDIR=/nonexistent` and `TMPDIR=nodir` give identical
  stderr, `… (os error 2) at path "…/.tmpXXXXXXlibfat.a"`, the relative one joined to the cwd.
- **The changed fat-file test is still meaningful.** It still checks the byte-identical rebuild, and now also that the one leftover lands in its own dir and the
  `with_err_path` text. `set_var`/`remove_var` write both C's `environ` and `process.env` (`env.ts:474-493`), so `temp_dir` sees the test's dir. The error case
  points at a missing directory, so it creates nothing. `TMPDIR` is restored in `finally`. Running all 9 touched test files left the per-user dir's entry count
  unchanged (388 before and after, no `libfat` file). With `main`'s `archive.ts` the test fails (mutant reproduced).
- **Callers:** `temp_dir` has one caller, `archive.ts` `tempfile_with_suffix` (from `try_extract_macho_fat_archive`). Metadata temp dirs use
  `rustc_metadata/fs.ts` `TempDirBuilder.tempdir_in(OutFileName.parent(out_filename) ?? "")`, not `temp_dir` (confirmed by grep). No protected suite uses a fat archive that I know of.
  The samples above all match.

## 5. `76504908`: module-order cycles

- **Evaluation order unchanged, reproduced.** I used a `--preload` (through `BUN_OPTIONS`) whose sync `Bun.plugin` `onLoad` prepends a logging call to every
  module under the worktree, with the paths made relative:
  `main.ts … --crate-type lib --emit=metadata hello.rs` (2,094 modules), `miri.ts --version` (2,276) and
  `main.ts … --crate-type rlib -Zcodegen-backend=dummy -Zprint-mono-items hello.rs` (2,106) give **identical** lists on `main` and head. The `.rmeta`, the `.rlib` and
  stdout are byte-identical. Each entry ran in one process.
- **`first_import.test.ts`** is sound: 11 child processes, each importing one module first, and it compares exit codes plus the first `Error` line. It takes 0.50 s
  (`--isolate`, twice). **Mutants**, each fails it: `inhabitedness/mod.ts` back to `def.gen.ts`; `remove_noop_landing_pads.ts` without
  `import "../rustc_target/lib.ts"`; `v0.ts` with its `pretty.ts` import moved back below `print/mod.ts`. It covers only those 11. The 23 other
  `print/mod.ts` importers, the generated `decodable.gen.ts`/`diagnostics.gen.ts` and the 14 in-crate spec importers stay uncovered, as the handoff says.
- **The three further cycles, reproduced** (the same on `main` and head, `bun -e "await import(…)"`): `rustc_symbol_mangling/v0.ts` gives `Cannot access
  'BoundRegionKind'`, `rustc_hir_typeck/op.ts` gives `'ObligationCause'`, and `rustc_hir_typeck/method/suggest.ts` gives `'InferOk'`. For root's queue.
- Every importer of `def.ts` that now gets `debug_DefKind`/`PerNS` from it type-checks (tsc is clean).

## 6. Units, tsc, coverage, protected files

- Touched tests, each `--isolate` at head: `pat_b` 10, `aarch64.oracle` 2, `rlib_macho` 7, `rlib_native.oracle` 9, `env` 6, `diagnostics_b` 18,
  `codegen_backend.oracle` 17, `encoder_contract` 8, `first_import` 1. All pass. Added unit time is about 0.5 s (`first_import`) plus milliseconds.
- `bunx tsc --noEmit -p .` (with the main checkout's `node_modules` linked in): clean. `coverage.ts --check`: `markers ok (24893; vendor 5302; library 610)`.
  `pat.rs` 70/70.
- `git diff --stat 519e6360 6962913b -- harness scripts tools package.json tsconfig.json`: empty. No baseline, suite, runner or difftest oracle output
  changed. The one oracle-derived file changed is the unit fixture `callconv/aarch64_oracle/oracle/big_err.aarch64-apple-darwin.txt`, for a case the lane added.
  It regenerates byte-identical from the pinned rustc (item 1).

## Not checked

- Linux and Windows behavior: ENODEV for a directory under Linux `mmap`, `libc.so.6` loading, Linux `/tmp`, and the Windows `unported`s. All by reading only.
- The FFI success path (O1).
- The full unit step, full suites, the gate, and suites other than those named above (mono-ui, unpretty, miri, IR).
- Instruction counts of anything but one hello program.
- Whether any other module in the tree fails as a first import (only the three cycles' importers, as the lane did, plus my three mutants).

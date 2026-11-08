# Review: link-rlib-native

**Verdict: APPROVE WITH NITS**

Batch: branch `t3/bundle-native-libraries-rlib` (worktree `t3-2c4f25c1`), head `5ccfd699`, one commit on `main` at `5c884ab9`.
Handoff: `docs/handoff/link-rlib-native.md`. Reviewer: independent, read-only on code. Environment: `aarch64-apple-darwin` on AC,
load 12 to 35, `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_REQUIRE_PROBES=1`, `.env.local` from `integ-w39`, `RUST_TS_AGENT=review-rlib-native`.

The port is faithful in every function I compared with upstream. 76 whole compilations of my own design (not the lane's) agree
with the oracle on exit, stdout, stderr, out-dir file list, rlib, rmeta, dep-info and the temp files left behind. Those include the
four error paths the lane could not reach, or the ones a port can reach. One more case stops as an honest `unported` (exit 70) in a
file this lane does not own. The unit test's fixtures are genuine oracle output: I regenerated all three rlibs byte for byte. No
finding blocks.

## Findings

| # | where | finding | how found |
|---|---|---|---|
| N1 | `src/std/io.ts:171`, reached from `ArArchiveBuilder::add_archive` (`src/rustc_codegen_ssa/back/archive.ts:246`) | A **directory** named like the library (`d3/libdir.a/`, `-L d3 -l static=dir`). The oracle exits 1 with `error: failed to add native library d3/libdir.a: Invalid argument (os error 22)` (the mmap of a directory). The port exits 70 with `rust-ts: unported: std::io::Error raw OS error (darwin, UNKNOWN)`. This is an `unported`, not wrong output, and it is in pre-existing code outside the lane's files. The packed form (`+whole-archive`) is **same**: `failed to read file: Is a directory (os error 21)`. A follow-up item can map that Node error, or have `Mmap::map` return EINVAL for a directory. | reproduced |
| N2 | `src/rustc_codegen_ssa/back/rlib_native.oracle.test.ts:107-108` | `rebuild()` feeds the oracle's own `lib.rmeta-link` back in as an input. So in the three foo/baz tests, nothing checks the port's `RmetaLink` record for unpacked libraries (`native_lib_filenames = [None, None]`). Flipping one byte in that member of `RLIB_HOST_FOO_BAZ` or `RLIB_ELF_FOO_BAZ` leaves the test at 7 pass. Only the `+whole-archive` test (:161) encodes a record (`[Some("libfoo.a")]`) and compares it. The end-to-end runs do cover it. Fix: build the member from `new RmetaLink([], [undefined, undefined]).encode()` through `create_wrapper_file`, as the `+whole-archive` test already does. | reproduced |
| N3 | `src/rustc_codegen_ssa/back/archive.ts:177` (`tempfile_with_suffix`) | The temp directory when `TMPDIR` is unset or empty. Upstream's `env::temp_dir()` (library/std/src/sys/paths/unix.rs:442) takes `TMPDIR` as given, even when empty (then the file is cwd-relative). When `TMPDIR` is unset it uses `confstr(_CS_DARWIN_USER_TEMP_DIR)` on Apple and `/tmp` elsewhere. The port uses Node's `os.tmpdir()` for both, which is `/tmp` when unset. Only where the kept file lands differs. Its name is random on both sides, so no deterministic output shows it. The `// PORT:` comment says "else `os.tmpdir()`" but not that this differs from upstream. Make the comment exact, or follow upstream. tempfile's retry limit (65,536, against unbounded in the port) cannot show. | read only |

## 1. Fidelity

I read every changed function against the pinned upstream and object 0.39.1:

- **`link.rs`**: `NativeLibSearchFallback`, `walk_native_lib_search_dirs` (:142), `try_find_native_static_library` (:212),
  `try_find_native_dynamic_library` (:241; upstream also uses `staticlib_components` there), `find_native_static_library` (:273),
  `find_bundled_library` (:282) and the bundling loop of `link_rlib` (:660). The order and logic match: the `Native` (and `All`)
  `-L` dirs come first, then `Framework` dirs other than `All`; the fallback dirs only when a fallback is passed. Within each dir,
  `default` comes before `("lib", ".a")`, with the pair dropped when it equals `default`. `+verbatim` gives `("", "")`. The match
  test is `Path::exists` (statSync follows symlinks, as `fs::metadata` does). A packed library is searched again by its **file
  name** with verbatim = true, which can find a different file in an earlier `-L` dir. That upstream quirk is mirrored and
  checked against the oracle (`h-verb-repack`).
- **`archive.rs`**: `target_archive_format_to_object_kind` (:332), `archive_kinds_compatible` (:343, including the one-way
  `(Gnu64, Coff)`), `archive_kind_display_name` (:365), `try_filter_fat_archs` (:421), `try_extract_macho_fat_archive` (:445),
  `add_archive` (:469) and the `Archive` arm of `build_inner`.
  - The fat file is extracted **before** the dedup check.
  - The dedup key is `PathBuf` equality (`path_eq`, by component). `././libx.a` equals `./libx.a`, but `d1/../d1/libfoo.a` does
    not equal `d1/libfoo.a`, and both cases match the oracle.
  - Thin members are resolved as `archive_path.parent().join(name)`.
  - The `invalid archive member` message is upstream's format, byte for byte.
- **object `read/macho/fat.rs`**: `parse`, `arches`, `architecture` (the 7 CPU types), `file_range` and `data` all match, and so do
  the `FatArch32` and `FatArch64` accessors (64-bit offset and size). The constants (`FAT_MAGIC`/`_64`, `FAT_CIGAM`/`_64`,
  `CPU_TYPE_MIPS = 8`) and the struct layouts match `macho.rs`. The slice choice is the first arch whose `cputype` maps to the
  target's `Architecture` (subtype ignored), as upstream.
- Markers: `bun scripts/coverage.ts --check` gives `markers ok`. `bunx tsc --noEmit -p .` is clean (with the main checkout's
  `node_modules` symlinked in temporarily, then removed).

**Error paths the lane did not reach, built and compared with the oracle (all same):**

- **A member past the end.** It *is* reachable: object's `ArchiveMember::parse` does not check the size against the data. On
  `libpastend.a` (last member header claims 99,999 bytes) both sides give `error: failed to build archive at X/libs.rlib: invalid
  archive member: archive member of ./libpastend.a at offset 640 with size 99999 exceeds archive size …`, exit 1. Packed
  (`-Zpacked-bundled-libs`) it is exit 0 on both sides.
- **A non-UTF-8 member name.** GNU short name `\xff\xfe.o` gives `… invalid utf-8 sequence of 1 bytes from index 0`. BSD
  `#1/` name `ab\xc3(.o` gives `… from index 2`. A bad header terminator gives `Invalid archive terminator`.
- **A fat file with no slice for the target.** These all give `Unsupported archive identifier`, with no temp file: x86_64 only on
  the arm64 host, `nfat_arch = 0`, and a truncated arch table. A slice whose offset is past EOF gives `Invalid fat arch offset or
  size`, and one empty temp file is kept on both sides. The same file with `--target x86_64-apple-darwin` is exit 0.
- **The COFF and AIX format warnings.** The port cannot reach them: `x86_64-pc-windows-msvc` stops earlier at
  `create_object_file (COFF object files)`, and the target specs of `powerpc64-ibm-aix`, `x86_64-unknown-uefi` and
  `wasm32-unknown-unknown` are not ported (exit 70). The oracle prints `… but the target expects COFF` / `AIX big`, which are the
  strings `archive_kind_display_name` returns. Checked by reading only.

## 2. The main claim, reproduced with my own cases

The inputs are C built by the host's clang: an object with a `-fcommon` symbol, TLS, a weak undefined symbol, a hidden symbol and
a rodata string; 30 small objects; names of 15, 16, 17 and 37 bytes and one with a space; an odd-sized text member; and an
`-flto` bitcode object. They were archived with host `ar` (BSD) and the toolchain's `llvm-ar` (`--format=gnu|darwin|bsd`,
`--thin`, `S`, and `SYM64_THRESHOLD=0` for `/SYM64/` and `__.SYMDEF_64`), and with `lipo`. Hand-built archives cover the
`/` and `//` members and the corrupt files. Every case ran in a scratch cwd with its own `TMPDIR` per side. The comparison
covered exit, stdout, stderr, the out-dir file list, each file (the `.d` with the out dir normalized), and the names (randomness
masked) and sizes of the temp files left. Host cases: a std crate, `--sysroot <oracle>`. ELF cases: a `#![no_core]` crate,
`--target x86_64-unknown-linux-gnu`.

**76 compilations, 75 same, 1 `unported` (N1):**

- **Long names, 38 members**: BSD, GNU and darwin inputs, on the host (darwin output) and on ELF (GNU output), plus packed and
  `+whole-archive` forms. This covers the GNU `//` name table, BSD `#1/`, names with spaces, 8-byte and 2-byte padding, and the
  odd-sized text member. Same.
- **`/` and `//` members**: GNU-style and BSD-style, on both targets, and in a mix with three other libraries. Same: 6 and 5
  rlib members.
- **A `.a` that contains a `.a`**: `inner.a` as a member of GNU and BSD archives. Same, and the nested archive is bundled
  unexpanded.
- **Bitcode members, archives without a symbol table (`Unknown` kind), `Gnu64` and `Bsd64` symbol tables, thin archives with
  long names**: all same. The incompatible-format warnings match: GNU on darwin, BSD on GNU.
- **`-L` orders**:
  - `-L d1 -L d2` against `-L d2 -L d1` (`libfoo.a` in both);
  - `native=d2 all=d1` and the reverse;
  - `framework=d1`, `dependency=d1` and `crate=d1`, each before `d2`;
  - a dir holding only `libfoo.a.a`;
  - `+verbatim=libfoo.a.a`, `+verbatim=../d1/libfoo.a` (added a second time: a different path), `-L d1 -L ./d1` with
    `+verbatim=libfoo.a` (deduplicated), and an absolute `+verbatim` path with and without `-L`;
  - the packed re-search quirk above, and the same order on ELF.

  All same.
- **Fat files**: `-fat64`, an arm64e slice ahead of arm64 (subtype ignored, first match wins), the 3-arch `lipo` order, x86_64
  only, `nfat_arch = 0`, a truncated arch table and a slice past EOF, on the host and on `x86_64-apple-darwin`. All same,
  including the temp files left (count, size and name pattern).
- **A consumer through `--extern`** of an oracle rlib that bundles four libraries, packed and unpacked: same.

## 3. The unit test

- **Fixtures are oracle output.** In the lane's scratch dir (`…t3-2c4f25c1/…/scratchpad/fx`, where the source path the fixture's
  rmeta embeds still exists), I ran `rustc +nightly --crate-type rlib --emit=link -Zcodegen-backend=dummy -L <dir> -l
  static=foo -l static=baz nc.rs`, the `+whole-archive` form, and the ELF form. The `-L <dir>` held the test's own decoded input
  archives. All three are **byte-identical** to `RLIB_HOST_FOO_BAZ`, `RLIB_HOST_WHOLE_ARCHIVE` and `RLIB_ELF_FOO_BAZ`. The input
  archives equal the files in that dir (host `ar`, `llvm-ar`, `lipo`), not the port's output. My outputs went to my scratchpad;
  nothing was written in the lane's dir.
- **Planted one-byte differences** (in a throwaway worktree at `5ccfd699`, since removed):

  | mutation | result |
  |---|---|
  | `foo.o` member of `RLIB_HOST_FOO_BAZ` | 3 fail |
  | `bar.o` member of `RLIB_ELF_FOO_BAZ` | 1 fail |
  | symbol table of `RLIB_HOST_FOO_BAZ`, `RLIB_ELF_FOO_BAZ`, `RLIB_HOST_WHOLE_ARCHIVE` | 3, 1 and 1 fail |
  | the packed `libfoo.a` member | 1 fail |
  | `lib.rmeta-link` of `RLIB_HOST_WHOLE_ARCHIVE` | 1 fail |
  | `lib.rmeta-link` of `RLIB_HOST_FOO_BAZ` / `RLIB_ELF_FOO_BAZ` | **7 pass** (N2) |

- The test cannot pass for the wrong reason on the bundled members or the symbol table. It does not exercise `link_rlib` itself
  (member order, `find_bundled_library`); the end-to-end runs and the proposed suite cover those.
- Run alone in its own process (what `--parallel=4`'s per-file isolation does), it gives 7 pass in 0.3 s. The lane adds no new
  module-order failure:
  - Each `src/rustc_codegen_ssa/back/*.test.ts`, `src/vendor/object/read/macho/*.test.ts` and
    `src/vendor/ar_archive_writer/*.test.ts` file, run alone, gives the same result at `5c884ab9` and at `5ccfd699`.
  - `link.test.ts` and `rlib_stub.oracle.test.ts` fail alone on **both** (`Cannot access 'Os' before initialization`, the cycle
    the unit-parallel item already records).

## 4. Temp files

- Faithful. Upstream's `tempfile::Builder::new().suffix(file_name).tempfile()?.keep()` leaves `.tmp` + 6 random alphanumerics +
  the file name in `env::temp_dir()`, never removed. The port does the same (`O_EXCL`, mode 0o600, retry on `EEXIST`). Every
  fat case showed the same leftover files on both sides. The one difference is where the file goes when `TMPDIR` is unset or
  empty (N3).
- **No collision** with a parallel unit run:
  - `O_EXCL` plus 62^6 random names means a clash only causes a retry.
  - The lane's test points `TMPDIR` at a `mkdtemp` dir of its own for the one fat-file test, inside a synchronous body that
    restores it in `finally`. `afterAll` removes the whole dir.
  - `--parallel` runs files in separate processes, so another file cannot see the change. Nothing is left in the real `$TMPDIR`:
    I counted 0 `.tmp*lib*.a` there after my runs.
  - A test that crashes before `afterAll` would leave its `rlib-native-*` dir behind, which is harmless.

## 5. Protected paths

Samples ran with `RUST_TS_AGENT=review-rlib-native` (different samples from the lane's), on AC:

| suite | result | run |
|---|---|---|
| check-ui | 40/40 MATCH | `20261108-030011-review-rlib-native-rksd` |
| rmeta-ui | 40/40 MATCH | `20261108-030017-review-rlib-native-orsa` |
| mono-ui | 40/40 MATCH | `20261108-030024-review-rlib-native-m4em` |
| pm-ui | 40/40 MATCH | `20261108-030039-review-rlib-native-kllt` |
| check-std (heavy, once) | 1/1 MATCH | `20261108-030045-review-rlib-native-4cbw` (subject 18.4 s, 3,182 MB) |

The commit touches only `src/rustc_codegen_ssa/back/{archive,link}.ts`, the new test, `src/vendor/object/{macho.ts,
read/macho/fat.ts, read/macho/mod.ts}` and the handoff. No oracle output, baseline, suite, script or `harness/` file changes.

## 6. The proposed `rlib-native` report suite

The design is sound: report only, fixtures checked into `harness/corpus/rlib-native/` and built by host tools (never by the port),
`TMPDIR` per case. Root decides. Points the runner must get right:

1. **A fixed cwd and a relative source path.** The rmeta embeds the working directory and the source path as given. With
   `nc.rs` relative, the fixture rmeta still holds the lane's absolute cwd; with an absolute path it holds that path instead, and
   the rmeta's size and hash change. An rmeta sha256 cached by the oracle is only valid when every run uses the same cwd string.
   Run cases from a fixed directory (or with `--remap-path-prefix`), not from per-agent worktrees or scratch dirs.
2. **No case whose diagnostics name the extracted temp file.** The oracle itself is not stable then. A universal file whose arm64
   slice is a GNU-format archive printed `warning: archive \`…/.tmpNfGocalibfatgnu.a\` was built as GNU format …` on one run and
   `.tmpzkABjg…` on the next (reproduced). The same holds for any error after extraction (a corrupt slice archive). Keep fat-file
   cases to clean slices, the no-slice case and the past-EOF slice; the last names only the original path.
3. Print the rlib's member list (name, size) besides its sha256, so that a DIFF names the member.
4. Worth adding: my cases from §2 (long names at 15/16/17 bytes, `/` and `//` members, a nested `.a`, bitcode, `Unknown`/`Gnu64`/
   `Bsd64` inputs, the past-end and non-UTF-8 errors, the fat variants, the `-L` order and `+verbatim` re-search cases). Leave out
   the directory case (N1) until it is ported, or list it as expected UNPORTED.

## Not checked

- Windows (`{}.lib` before `lib{}.a`, COFF archives): no Windows target gets as far as `link_rlib` in the port (COFF object files
  and `create_raw_dylib_dll_import_libs` are unported). I checked the format list by reading only.
- AIX big archives and the `aix_big`/`coff` incompatible-format warnings end to end (targets unported); `bsd` as the *output*
  format (no target I tried uses it).
- The `fallback` branch of `walk_native_lib_search_dirs` (only a linker passes one): read only.
- `AddArchiveKind::Rlib` (the `RmetaLinkCache` and `skip`): only `link_staticlib` passes it, and that is unported.
- Archives over 4 GiB, a real 64-bit symbol table forced by size, and `x86_64h` slices.
- I did not run the gate or any full suite.

## Cleanup

- I wrote nothing under `$RUST_TS_DATA` except difftest's own run dirs and nothing in other sessions' dirs, and I left no temp
  files in the real `$TMPDIR`.
- The throwaway worktree is removed. `node_modules` was symlinked into my worktree only for `tsc`, then removed.
- No process I started is still running.

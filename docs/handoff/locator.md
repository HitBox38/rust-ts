# Handoff: locator (wave 11: rustc_metadata locator.rs + fs.rs, rustc_session filesearch/search_paths)

Branch `lane/locator`, based on d0697a1. No merges.

## Result
`rustc_metadata::locator` is fully ported (22/22). Crate loads now get through the locator. When a candidate file is found, they stop where its metadata must be decoded (`MetadataBlob::new`, rmeta-decoder) or read from an object (`DefaultMetadataLoader`, object-read).

Crate-not-found errors match rustc byte for byte whenever no metadata has to be decoded. That covers E0463 with all its target/sysroot notes, E0462, the `--extern` path errors, unknown-type + lib filename form, and `-L` handling. This holds in a sysroot without the target's libraries.

With the real oracle sysroot, every E0463 for a non-sysroot crate first probes `core` (`missing_core`, creader.rs). That reaches the decoder, so it stops there with nothing printed yet.

**Stop histogram, expanded-nocore `--sample 300` (`RUST_TS_AGENT=locator`):**

| stop | before (run 20261013-141544-locator-3tfx) | after (run 20261013-144555-locator-wtot) |
|---|---|---|
| `rustc_metadata::locator::CrateLocator::new (wave 11 locator)` | 26 | 0 |
| `rustc_metadata::rmeta::decoder::MetadataBlob::new (wave 11 rmeta-decoder)` | 0 | 26 |
| `std::path::Path::file_name` | 2 | 2 |
| MATCH | 272 | 272 (DIFF 0) |

The 26 cases are `extern crate <aux>` / `minicore`. Each one now fails to find the crate, then probes `core` in the real sysroot.

## Files
- **Ported:**
  - `src/rustc_metadata/locator.ts`: all of locator.rs (22/22), with the module doc.
  - `src/rustc_metadata/diagnostics.ts`: the hand-written `impl Diagnostic` for `MultipleCandidates`, `InvalidMetadataFiles` and `CannotFindCrate` (3/3 hand impls; the derives stay generated).
- **New:**
  - `src/rustc_metadata/fs.ts`: `METADATA_FILENAME` only (the read path). `lib.ts` exports `fs`, `METADATA_FILENAME` and `METADATA_HEADER`.
  - `src/rustc_fs_util/lib.ts`: `try_canonicalize` (1/10), with `std::path::absolute` as a local helper (same logic as passes.ts's private copy).
- **Tests:**
  - `src/rustc_metadata/locator.oracle.test.ts`: 35 cases (below).

**Outside the lane's own files (needed; please review):**
- `src/rustc_metadata/rmeta/mod.ts`:
  - Ported `rustc_version`, `METADATA_VERSION` and `METADATA_HEADER` (mod.rs:62/69/77).
  - `CrateHeader.triple` is now typed `TargetTuple`.
- `src/rustc_metadata/rmeta/decoder.ts`: extended the contract-first `MetadataBlob` stub with what the locator calls.
  - `static new` and `check_compatibility`.
  - `get_header`, `list_crate_metadata` and `get_proc_macro_info`.
  - All of these are `unported`; the rmeta-decoder lane fills them.
- `src/rustc_session/utils.ts`: `CanonicalizedPath::new` is real (`try_canonicalize(..).ok()`).
- `src/rustc_session/config.ts`: `parse_externs` builds the `--extern name=path` `CanonicalizedPath` instead of `unported`. Without this, no `--extern` path reaches the locator. See decision 2 for the load-order hook.
- `src/rustc_session/filesearch.ts`: `get_library_candidates` stops with `unported` when a search would include the stand-in default sysroot (decision 3).
- PENDING texts advanced:
  - `src/rustc_driver_impl/driver.oracle.test.ts`: `x.rs` / `-ooptimize x.rs` now stop at `rustc_session::filesearch::default_sysroot (crate search in the default sysroot; pass --sysroot)`.
  - `src/rustc_metadata/creader.oracle.test.ts`:
    - The stop is now `MetadataBlob::new`.
    - `extern crate foo` and `-Zprofiler-runtime=my_profiler` now also load `core` (the missing_core probe), as the oracle does.

## Coverage (`bun scripts/coverage.ts --missing`)
| file | ported |
|---|---|
| rustc_metadata locator.rs | 22/22 (0 missing) |
| rustc_metadata diagnostics.rs | 3/3 |
| rustc_metadata fs.rs | 0/5 (all write path / encoder, M5; `METADATA_FILENAME` is a const) |
| rustc_session filesearch.rs | 7/14 (unchanged, see decision 3) |
| rustc_session search_paths.rs | 4/4 |
| rustc_fs_util lib.rs | 1/10 |
| rustc_metadata rmeta/mod.rs | 1/18 |

`--check`: markers ok (7413; vendor 3004).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3653 pass, 1 skip, 0 fail.
- `--suite parse --sample 200`: 200/200 MATCH (run 20261013-144547-locator-rjok).
- **locator.oracle.test.ts: 35/35.** Each case runs `-Zunpretty=expanded --target x86_64-unknown-linux-gnu` through `src/rust_ts/main.ts` and through rustc, in the same cwd.
  - **31 "full" cases.** They compare exit code, stdout and stderr byte for byte, using an empty or nonexistent sysroot:
    - std / no_std / explicit `extern crate std|core`, also with `-Cpanic=abort`, `--crate-name` and `-Zui-testing`
    - `extern crate nonexistent`, two missing crates (fatal after the first), `rustc_*` help, non-ASCII name
    - profiler runtime (default and custom), panic runtime (unwind/abort)
    - `--extern` with:
      - a nonexistent path, a directory, or an unknown type (+ LibFilenameForm, then E0463)
      - a staticlib path or an empty rmeta
      - two paths, or no path
    - `-L` with:
      - a staticlib (E0462), or two staticlibs
      - `crate=`, `dependency=` or `native=` kinds
      - an empty rmeta, or a nonexistent directory
  - **4 "stop" cases.** Ours must be a prefix of the oracle's output at the named stop:
    - real sysroot with `extern crate nonexistent` (decoder)
    - real sysroot with a std crate (decoder)
    - a garbage `.rmeta` via `-L`: decoder; the oracle gives E0786
    - `--extern foo=libfoo.so`: object-read
  - **Negative control.** Flipping `should_check_staticlibs` and the `std || core` check in `CannotFindCrate` fails 5 cases.

## `unported(...)` left
- `rustc_metadata::rmeta::decoder::MetadataBlob::new` / `check_compatibility` / `get_header` / `get_crate_hash` / `list_crate_metadata` / `get_proc_macro_info` (wave 11 rmeta-decoder).
- `DefaultMetadataLoader::get_{rlib,dylib}_metadata` (wave 11 object-read; already a stub in rustc_interface/stand_ins.ts).
- `rustc_metadata::locator::get_metadata_section (sdylib interface: compiles it with the current compiler binary)`.
  - Upstream runs `current_exe()` with `--emit=metadata -Zbuild-sdylib-interface`.
  - rust-ts has no compiler binary of its own and emits no metadata (M5).
  - It is only reached for `lib<name>.rs` interface files.
- `rustc_session::filesearch::default_sysroot (crate search in the default sysroot; pass --sysroot)` (decision 3).
- `get_proc_macros` calls `host_dylib::dlsym_proc_macros` (M6).
- fs.rs write path (no markers): `emit_wrapper_file`, `encode_and_write_metadata`, `non_durable_rename`, `copy_to_stdout` (M5).

## PORT decisions (please record)
1. **Paths and maps.**
   - `PathBuf` is a string; `Path::display()` is the string.
   - `FxIndexMap` / `FxIndexSet` are an ordered `Map` / `Set`.
   - `OwnedSlice` is a `Uint8Array`.
   - `Vec<PathBuf>::sort` uses a local `PathBuf_cmp`, a component-wise `compare_components`.
   - `Path::exists` / `is_file` / `metadata().len()` are local `statSync` helpers in locator.ts. src/std has no fs module yet; move them there later.
2. **`--extern` paths and load order.**
   - config.ts cannot import utils.ts at runtime. A static import gives a TDZ: utils.ts extends `Session`, and options.ts must be evaluated before config.ts.
   - So config.ts exports `CanonicalizedPath_new_hook`. utils.ts installs `CanonicalizedPath::new` into it when it loads, after a bare `import "./options.ts"` for the ordering.
   - `parse_externs` calls the hook (`unwrap`).
3. **Default sysroot.**
   - `Sysroot::new` always calls `default_sysroot()`, and upstream derives it from `librustc_driver` via `dladdr` (`dll_path` / `current_dll_path` / `default_from_rustc_driver_dll` / `from_env_args_next`). Porting it faithfully would stop every run, so filesearch.rs keeps the `DEFAULT_SYSROOT_STANDIN` (7/14 unchanged).
   - With a real locator, a run without `--sysroot` would otherwise report std as missing while the oracle finds it, i.e. a DIFF instead of a stop.
   - So `FileSearch::get_library_candidates` now calls `unported` when the search includes the stand-in sysroot. This does not happen when the sysroot is excluded (`-Zimplicit-sysroot-deps=no` for `Crate` paths).
4. **`Mmap::map` in `get_rmeta_metadata_section`.**
   - It opens the file (open error → "failed to open"), then reads it whole (error → "failed to mmap").
   - `Bun.mmap` opens files read-write and fails on read-only sysroots.
   - memmap2 0.2.3 refuses zero-length maps, so an empty file is a "failed to mmap" error here too.
5. **Dylib length decoding.** `u64::from_le_bytes(..) as usize` is decoded as a bigint. A length past the buffer panics with Rust's slice-index text, as upstream's indexing would.
6. **Other types.**
   - `ProcMacroKind` is `unknown` in locator.ts until rmeta-types declares it.
   - `MetadataError` / `CrateMismatch` are file-private, as upstream.
   - The derived `Debug` impls of `CratePaths` / `CrateRejections` / `CombinedLocatorError` / `CrateError` / `MetadataError` are not written. Nothing prints them; they are only used by `info!` logs and `unwrap` panics.
7. **`CFG_RELEASE_CHANNEL`** is `"nightly"` in diagnostics.ts, as in rustc_driver_impl/rustc_ast_passes.

## For root / other lanes
- **rmeta-decoder:** fill `MetadataBlob::{new, check_compatibility, get_header, get_crate_hash, list_crate_metadata, get_proc_macro_info}` in decoder.ts. The locator's 4 "stop" oracle cases then become full comparisons; switch them to "full".
- **object-read:** `METADATA_FILENAME` is exported from `rustc_metadata/lib.ts` (fs.ts). Don't create a second one.
- **rmeta-types:** rmeta/mod.ts now has `rustc_version` / `METADATA_VERSION` / `METADATA_HEADER` near the top, in upstream position. `CrateHeader.triple` is a `TargetTuple`.
- **passes.ts** has a private `try_canonicalize` / `std_path_absolute`. It could import `rustc_fs_util` now.
- **Environment:** the worktree's tracked `node_modules` symlink was broken. I replaced it locally with `bun install` and never staged it (`git status` shows ` D node_modules`, uncommitted).

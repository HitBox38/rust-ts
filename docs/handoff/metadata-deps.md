# Handoff: metadata-deps (plan-m5 wave 32): dependency formats, native libs, foreign modules, fs.rs

Base `c58a6fc4`, branch `lane/metadata-deps`.

## Summary
- `rustc_metadata` `dependency_format.rs`, `native_libs.rs`, `foreign_modules.rs` and `fs.rs` are ported in full.
  The local providers `native_libraries`, `foreign_modules` and `dependency_formats`, and `native_libs::relevant_lib`
  (used by `native_library`), are installed in `cstore_impl.ts`. Before, all four were `unported`.
- The `rustc_middle` `middle/dependency_format.rs` types (`Linkage`, `DependencyList`, `Dependencies`) now have their
  own file. The local stand-ins that driver-m5 put in codegen_ssa `lib.ts` are gone; `lib.ts` and `base.ts` import the
  new file. symbol_export.ts had no dependency_format stand-ins. Its `SymbolExportLevel` / `SymbolExportInfo` /
  `ExportedSymbol` stand-ins come from `exported_symbols.rs`, which is outside this lane, so I left them.
- **Where a metadata check stops now.** I used `pub fn add(a: u32, b: u32) -> u32 { a + b } pub struct S;` with
  `--crate-type lib --emit=metadata --target x86_64-unknown-linux-gnu` and the oracle's sysroot. It exits 70 at
  `rustc_metadata::rmeta::encoder::encode_metadata (lanes encoder-a..d)`. That is the pending-lane shim at the end of
  `src/rustc_metadata/fs.ts`, called from `encode_and_write_metadata` (fs.ts) ← `start_codegen` (passes.ts). That is
  one frame deeper than before (`rustc_metadata::fs::encode_and_write_metadata (metadata encoding; plan-m5 waves 32-33)`).
  The oracle exits 0 and writes a 2,370-byte `liblib.rmeta`. The port deletes its `rmeta*` temp dir on the way out
  (see the PORT decisions), so the output directory is left empty.
- `--crate-type bin --emit=metadata` (`fn main() {}`) goes further, because `needs_metadata()` is false. The port
  writes the same empty `libmain.rmeta` as the oracle, renamed into place from the temp dir. It then stops at
  `rustc_metadata::rmeta::encoder::EncodedMetadata::from_path (lanes encoder-a..d)`.
- Erroring crates still match. `pub fn f() -> u32 { "x" }` as a lib with `--emit=metadata` gives exit 1, and stderr
  differs only in the input path because I ran it from another directory.

## Files
New:
- `src/rustc_metadata/dependency_format.ts`: `calculate`, `calculate_type`, `add_library`, `attempt_static`,
  `activate_injected_dep`, `verify_ok`.
- `src/rustc_metadata/native_libs.ts`: `collect`, `relevant_lib`, `Collector` (`process_module`,
  `process_command_line`, `i686_arg_list_size`, `build_dll_import`).
- `src/rustc_metadata/foreign_modules.ts`: `collect`.
- `src/rustc_middle/middle/dependency_format.ts`: the types plus `debug_Linkage`.

Edited:
- `src/rustc_metadata/fs.ts`: the whole file, which was only `METADATA_FILENAME` before. It now has
  `emit_wrapper_file`, `encode_and_write_metadata`, both `non_durable_rename` variants and `copy_to_stdout`, plus
  stand-ins and shims (see the PORT decisions).
- `src/rustc_metadata/lib.ts`: re-exports `emit_wrapper_file`, as upstream's `pub use` does. The private
  `mod dependency_format/foreign_modules/native_libs` are imported directly by `cstore_impl.ts`, as `eii` is.
- `src/rustc_codegen_ssa/lib.ts` and `base.ts`: the stand-ins are replaced by the import (assigned).
- **Outside the assigned list (wiring):**
  - `src/rustc_metadata/rmeta/decoder/cstore_impl.ts`: providers installed; the `native_libs_relevant_lib` shim
    removed.
  - `src/rustc_interface/passes.ts`: the `rustc_metadata_fs_encode_and_write_metadata` shim is replaced by
    `rustc_metadata::fs::encode_and_write_metadata`; an unused `Result` import is dropped.
  - `src/rustc_interface/stand_ins.ts`: one doc comment on `EncodedMetadata` (fs.rs is ported now; encoder.rs is not).
  - `tools/codegen/queries.config.json` → regenerated `src/rustc_middle/queries.gen.ts`. There are 6 new `types`
    entries: `rustc_middle::middle::dependency_format::Dependencies` and the rustc_crate_store `CrateDepKind`,
    `CrateSource`, `ForeignModule`, `LinkagePreference` and `NativeLib`, all with their generated Debug.
    `dependency_formats`, `dylib_dependency_formats`, `crate_dep_kind`, `used_crate_source`, `native_libraries`,
    `native_library` and `foreign_modules` are typed now, so the ported code needs no casts. Generator report:
    unknown types 120 → 114, values without Debug 126 → 120. `--check` is up to date and tsc is clean.
- **Pinned tests updated by the delta:**
  - `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts`: the `refine_rpitit` PENDING stop is re-pinned
    to `rustc_metadata::rmeta::encoder::encode_metadata (lanes encoder-a..d)`.
  - `src/rustc_metadata/rmeta/decoder/cstore_impl.test.ts`: the test "unported local providers stop at unported(..)"
    became "… are the ported local providers". It checks that `native_libraries` / `foreign_modules` are the ported
    fns, and that `dependency_formats` with no linking gives an empty list per crate type.

## Coverage (`bun scripts/coverage.ts --missing compiler/<file>`)
| file | before | after |
|---|---|---|
| rustc_metadata/src/dependency_format.rs | 0/6 | 6/6 |
| rustc_metadata/src/native_libs.rs | 0/6 | 6/6 |
| rustc_metadata/src/foreign_modules.rs | 0/1 | 1/1 |
| rustc_metadata/src/fs.rs | 0/5 | 5/5 |
| rustc_middle/src/middle/dependency_format.rs | 0/0 | 0/0 (types only) |

`coverage.ts --check`: markers ok (23010; vendor 4680).

## Sample difftests (`RUST_TS_AGENT=root-f5de`)
I ran "before" in a detached worktree at `c58a6fc4` and "after" on this branch at `700b463a`.

| suite | before | after |
|---|---|---|
| mir --sample 300 | MATCH 297, UNPORTED 1, UNSTABLE 2, DIFF 0 (20261030-080255-root-f5de-lwar) | MATCH 297, UNPORTED 1, UNSTABLE 2, DIFF 0 (20261030-084148-root-f5de-4xlj) |
| tydump-ui --sample 300 | MATCH 298, UNSTABLE 2, DIFF 0 (20261030-080345-root-f5de-cu3i) | MATCH 298, UNSTABLE 2, DIFF 0 (20261030-084238-root-f5de-ajd8) |
| borrowck-ui --sample 300 | MATCH 300/300 (20261030-080436-root-f5de-27gp) | MATCH 300/300 (20261030-084331-root-f5de-ulft) |

The single mir UNPORTED is the same case in both runs, for a reason unrelated to this lane:
`const-generics/transmute-fail.rs`, `rustc_abi::Size beyond 2^53`. None of the protected suites reach
`start_codegen` (driver-m5's analysis still holds), so on the protected set only the new providers can change
behaviour. That happens only if something asks for `native_libraries` / `foreign_modules` / `dependency_formats` /
`native_library` for the local crate, and the samples show no change.

Unit tests:
- `bun test src/rustc_metadata src/rustc_codegen_ssa src/rustc_interface src/rustc_crate_store tools/codegen/queries.test.ts`:
  123/123 pass.
- `bun test src/rustc_middle src/rustc_driver_impl`: 536/536.
- compare_impl_item.oracle.test.ts and cstore_impl.test.ts: 62/62.
- `bunx tsc --noEmit -p .`: clean.

## `unported(...)` left
- fs.ts `encode_metadata`: `rustc_metadata::rmeta::encoder::encode_metadata (lanes encoder-a..d)`. **This is the
  stop.**
- fs.ts `EncodedMetadata_from_path`: `rustc_metadata::rmeta::encoder::EncodedMetadata::from_path (lanes encoder-a..d)`.
  The no-metadata path (bin crates) reaches it.

Nothing else. dependency_format.rs, native_libs.rs and foreign_modules.rs have no `unported`.

## PORT decisions
- **fs.ts stand-ins:**
  - `TempDirBuilder` (rustc_fs_util over `tempfile::Builder`), `TempDir` (tempfile) and `MaybeTempDir`
    (rustc_data_structures `temp_dir.rs`) are local stand-ins with only the API fs.rs uses. Their files are not
    ported, and they are outside this lane.
  - `tempdir_in` makes a relative dir absolute (`current_dir().join(dir)`), as tempfile does. It then calls node's
    `mkdtempSync(<dir>/<prefix>)`, which uses the same naming as tempfile: 6 random alphanumerics, mode 0o700.
  - Dropping a `TempDir` is `rmSync(recursive, force)`, ignoring errors, as tempfile's `Drop` does.
  - Move these into `rustc_fs_util/lib.ts` and a new `rustc_data_structures/temp_dir.ts` when those are ported.
- **Drops in `encode_and_write_metadata` are explicit.** A `finally` drops the `MaybeTempDir` unless it reached a
  successful `EncodedMetadata::from_path`. This covers a fatal error, an ICE or an `unported` stop (Rust's unwinding
  drop) and the early `return Err(guar)`. So the `rmeta*` dir is removed, or kept with `-C save-temps`, as rustc does.
  After a successful `from_path`, the dir belongs to the `EncodedMetadata`, whose drop the encoder lanes model.
- **`encode_metadata` / `EncodedMetadata::from_path` are pending-lane shims** at the end of fs.ts. `EncodedMetadata`
  is still the driver's stand-in interface (`rustc_interface/stand_ins.ts`, a type-only import). When lane
  encode-contract / encoder-a..d land rmeta/encoder.ts, root should:
  - replace the two shims with the real imports;
  - point `EncodedMetadata` at the real type.
- `non_durable_rename`: the `#[cfg(target_os = "linux")]` variant and the other one are both ported, with markers
  :121 and :133. The export picks one from `process.platform`, the host rustc runs on.
- `copy_to_stdout` copies with `readSync`/`writeSync(1)` in a loop, standing in for `io::copy`. `File::create` is
  `open(.., "w")` + close.
- **native_libs.ts:**
  - `sess.opts.libs` holds `rustc_session::utils::NativeLib`, whose `kind` is still an opaque stand-in for
    `rustc_structures::NativeLibKind`, so `session_lib_kind` reads it with a cast. `-l` parsing (`parse_native_lib`)
    is unported, so the list is empty whenever this code runs.
  - `Vec::extract_if` is an in-order partition. The predicate mutates the extracted libs, as upstream's does.
  - `HashSet::insert`'s return value comes from a small `set_insert` helper.
- **dependency_format.ts:**
  - `IndexVec::push`'s returned index is `ret.length - 1` in the `assert_eq!`s.
  - `attempt_static`'s lazy `.filter_map(..).all(..)` is a loop that stops at the first non-rlib crate, as the lazy
    chain does. Later crates are not pushed to `unavailable`.
  - `switch (preferred_linkage as Linkage)` keeps upstream's `IncludedFromDylib` arm, which TS's narrowing would
    reject.
  - `info!` tracing is kept as comments. The `let name = tcx.crate_name(cnum)` before the `info!` is kept, because
    it is a query call.
- `Arc::new(calculate(tcx))` is the value itself (arenas and `Arc` are erased).
- `Linkage`'s derived `StableHash`/`Encodable`/`Decodable` are not written. Linkage is not in crate metadata (only
  rlink files carry it), and nothing hashes `dependency_formats` without incremental.

## For root
- When the encoder lanes land, swap the two fs.ts shims and the `EncodedMetadata` stand-in (see above). After that,
  the next stop on a clean lib check is `CrateInfo_new` (driver-m5's handoff: `back::linker::exported_symbols` and
  friends).
- The 6 new `types` entries in `tools/codegen/queries.config.json` are a generator-config change; the regenerated
  `queries.gen.ts` is committed.
- Nothing under `harness/` or `scripts/` was touched. I removed the before-worktree (`$RUST_TS_DATA/tmp/w32/md-before`).

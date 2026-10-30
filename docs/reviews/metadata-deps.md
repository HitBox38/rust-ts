verdict: APPROVE-WITH-NOTES

Lane metadata-deps (`git diff main...lane/metadata-deps`, commits 700b463a + 3b013ba0) plus root's integ fix d35336d0.

## What was checked
- **dependency_format.rs → dependency_format.ts.** I compared `calculate`, `calculate_type`, `add_library`, `attempt_static`, `activate_injected_dep` and `verify_ok` line by line. The order, branches, diagnostics and field order are all faithful.
  - The lazy `filter_map(..).all(..)` in `attempt_static` is correctly a loop that stops after pushing the first non-rlib crate.
  - `drain(..)` is `splice(0)`.
  - `info!` arguments are not evaluated, which is correct because tracing is off. The `let name = tcx.crate_name(cnum)` query call is kept.
  - The `IncludedFromDylib` arm is kept.
  - The final-pass match guards (`Static if rlib`, `Dynamic if dylib||sdylib_interface`) are faithful.
  - The diagnostic texts come from the existing diagnostics.ts.
- **native_libs.rs, foreign_modules.rs.** These are faithful.
  - The `extract_if` partition keeps the order, and the predicate mutates `lib` as upstream does.
  - `HashSet::insert`'s return value is handled correctly.
  - The `split_once('@')` check, the x86 / non-x86 ABI matches, `link_ordinal.map_or` and the symbol type / size logic are faithful.
  - The `NativeLib` / `DllImport` constructor argument order matches the generated field order (cstore.rs:69 / :89).
  - The `session_lib_kind` cast and the `lib.cfg` cast are documented. `NativeLib.cfg` is `unknown` in cstore.gen.ts, and `sess.opts.libs` is always empty while `-l` parsing is unported.
  - `foreign_modules::collect` builds a `KeyedMap(DefId_hash_key)`, the same shape as the extern provider (cstore_impl.ts:613), so `map.get(fm_id)` in `native_library` works.
- **fs.rs.** `emit_wrapper_file`, `encode_and_write_metadata`, both `non_durable_rename` variants (cfg chosen by `process.platform`, the host) and `copy_to_stdout` are faithful in order and logic.
  - The `MaybeTempDir` stand-in matches rustc_data_structures temp_dir.rs: `ManuallyDrop` plus a Drop that keeps the dir if `keep` is set and removes it otherwise.
  - `tempdir_in` makes a relative dir absolute, as tempfile does.
  - The default prefix `.tmp` and the 6 random characters match.
  - The `try/finally` drop covers the fatal, ICE and unported paths and the early `return Err(guar)`. All of these unwind or return in Rust, so the drop runs there too.
  - I verified it by running the port (integ-w32) on macOS:
    - lib `--emit=metadata`: exit 70 at `rustc_metadata::rmeta::encoder::encode_metadata (lanes encoder-a..d)`, and the out dir is empty.
    - The same with `-C save-temps`: `rmetaXXXXXX/` is kept.
    - bin `--emit=metadata`: exit 70 at `EncodedMetadata::from_path`, and the 0-byte `libmain.rmeta` is in place. The oracle writes the same 0-byte file.
- **middle/dependency_format.ts.** It matches upstream: `DependencyList` = array, `Dependencies` = insertion-ordered `Map` (FxIndexMap), and the `Linkage` variants are in upstream order. driver-m5's stand-ins in codegen_ssa lib.ts are removed, and lib.ts and base.ts import the new file. Not writing the `StableHash` / `Encodable` / `Decodable` derives is justified in a PORT note: Linkage is not in rmeta.
- **queries.config.json.** The 6 new entries (Dependencies, CrateDepKind, CrateSource, ForeignModule, LinkagePreference, NativeLib) are correct.
  - The paths include both the `rustc_crate_store::X` and `rustc_crate_store::cstore::X` forms.
  - `Arc<CrateSource>` / `&'tcx [..]` erase correctly.
  - Dependencies has no `debug` entry, so `debug_value` stays undefined.
  - The generator code is unchanged, so this is a config-only change. `queries.ts --check` on integ-w32 reports up to date (unknown types 114).
- **Markers.** Every marker line number is correct: dependency_format.rs :73/:84/:294/:329/:382/:403, native_libs.rs :20/:56/:69/:116/:203/:229, fs.rs :27/:38/:121/:133/:138, foreign_modules.rs :9. Coverage is 6/6, 6/6, 5/5 and 1/1.
- **Unported gaps.** The only two `unported` calls are the encoder shims, as the handoff says. Nothing is guessed.
- **harness/ and scripts/.** Neither is touched (empty diff).
- **Re-pinned tests.**
  - The compare_impl_item `refine_rpitit` PENDING stop moves one frame deeper, to the new real stop, which is legitimate.
  - The cstore_impl test now asserts that the ported providers are installed and checks the no-link early return.
- **Runs.** On integ-w32, `bunx tsc --noEmit -p .` is clean, and `bun test` over src/rustc_metadata, src/rustc_codegen_ssa, compare_impl_item.oracle.test.ts and tools/codegen/queries.test.ts gives 170/170 pass.
  - Filtered difftests: `mir --filter raw-dylib` MATCH 26/26 (20261030-085443-root-sq7w), `tydump-ui --filter extern` MATCH 4/4 (20261030-085454-root-q0m9).
  - The lane's sample claims (no MATCH lost on mir, tydump-ui or borrowck-ui) are plausible. Protected suites do not reach `start_codegen`, and the only newly reachable code is the four local providers.

## Findings
1. src/rustc_metadata/rmeta/decoder/cstore_impl.test.ts:415-419: **non-blocking** (process).
   - The handoff says "`bunx tsc --noEmit -p .`: clean". That is false: the lane branch has 3 TS errors here, because `q`'s providers are typed `(tcx, key: unknown) => unknown`.
   - Root's fix d35336d0 (`as unknown` on the two `toBe` comparisons, `as Iterable<unknown>` on the spread) is sound. It only widens the static types, and `toBe` identity and `toEqual` still check the same runtime values. tsc is clean on integ-w32.
   - Lanes must re-run tsc after their last edit, before they claim it is clean.
2. src/rustc_metadata/fs.ts:276 (`TempDirBuilder.tempdir_in`): **non-blocking**.
   - The stand-in omits rustc_fs_util's `#[cfg(windows)]` retry-with-backoff loop on `PermissionDenied` (rustc_fs_util/src/lib.rs:132-139).
   - The primary host is Windows (AGENTS.md section 5), and the PORT header does not mention the omission.
   - Either add the loop when this moves to `rustc_fs_util/lib.ts`, or document the omission now.
3. src/rustc_metadata/fs.ts:201 (`copy_to_stdout`): **non-blocking**.
   - The function writes straight to fd 1 with `writeSync(1, ..)`. std's `io::stdout()` treats EBADF (stdout closed) as success, and the port already models that in `stdout()` (src/vendor/anstream/stream.ts:303, `handle_ebadf`).
   - With `-o -` and stdout closed, rustc succeeds silently, but the port would emit `FailedCopyToStdout`.
   - Prefer the existing `stdout()` writer, or document the difference.
4. src/rustc_metadata/fs.ts:152 (`moved = true` on any `Ok` from `from_path`): **non-blocking** (note for root and the encoder lanes).
   - Upstream `EncodedMetadata::from_path` (encoder.rs:2486-2500) takes `temp_dir` by value. It drops it, which deletes the dir, when the file is empty (`_temp_dir: None`) and on its own `?` errors.
   - When the shim is replaced, the real port must call `temp_dir?.drop()` on those paths. Otherwise the bin / `--emit=metadata` case, which returns `Ok` with a 0-byte file, will leave an `rmetaXXXXXX` dir behind.
   - The handoff says the encoder lanes model the drop, but does not name this empty-file path.
   - A related ordering detail: when `from_path` fails, upstream drops the dir inside `from_path`, before `emit_fatal`. The port drops it in `finally`, after. This is not observable.
5. src/rustc_metadata/native_libs.ts:39 and cstore_impl.ts:690/697: **non-blocking** (nit). The casts `as Map<DefId, ForeignModule>` / `as NativeLib[]` are redundant now that the queries are typed (queries.gen.ts:354/1278). They are harmless, and can be dropped in a later touch.

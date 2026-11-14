# Handoff: ssa-link-b (M7b, wave 40r): `back/link.rs` from `exec_linker` to the end, and `link/raw_dylib.rs`

Every function of `compiler/rustc_codegen_ssa/src/back/link.rs` from `exec_linker` (:2105) to the end is now in
`src/rustc_codegen_ssa/back/link.ts`, in upstream order, each with its marker. `link/raw_dylib.rs` is the new
`src/rustc_codegen_ssa/back/link/raw_dylib.ts`. The five ssa-link-b stubs in link.ts's `xlane` table now forward to these ports.
Review ssa-link-a's nits N1, N2 and N3 are fixed.

Branch `t3/port-ssa-link-b` (worktree t3-1bdee765), on `main` at e80bc814.

## Files touched

- `src/rustc_codegen_ssa/back/link.ts`: the port (:2105-end), the `xlane` forwarders, helpers, N3, and `link_natively` /
  `link_staticlib` exported for the tests.
- `src/rustc_codegen_ssa/back/link/raw_dylib.ts` (new): raw_dylib.rs whole.
- `src/rustc_codegen_ssa/back/link_with_args.oracle.test.ts` (new): the oracle evidence below, 2 tests, about 1.5 s.
- `src/rustc_codegen_ssa/back/link.test.ts`: the `link_staticlib` test (N2), and the misleading test title renamed (N2's
  linked nit).
- `docs/handoff/ssa-link-a.md`: the reach claims corrected (N1).
- `docs/handoff/ssa-link-b.md` (this file).

No file of another lane was touched. In particular `back/linker.ts`, `command.ts`, `apple.ts`, `archive.ts`, `rustc_session/`,
vendor `object`, `harness/` and `scripts/` are unchanged. ssa-linker's fixtures (`back/linker_oracle/`) are reused as they are.

## Coverage

- `bun scripts/coverage.ts --missing compiler/rustc_codegen_ssa/src/back/link.rs`: **87/87** (was 43/87).
- `bun scripts/coverage.ts --missing compiler/rustc_codegen_ssa/src/back/link/raw_dylib.rs`: **5/5** (was 0/5).
- `bun scripts/coverage.ts --check`: markers ok.
- `bun src/rust_ts/info_sites_check.ts`: `exec_linker` 3/3 sites ok. Every other link.rs function is unchanged: ok.

Each `#[cfg]` twin is ported and marked, and the host's is picked by `process.platform`, as ssa-link-a did for
`escape_linker_output`. That covers `flush_linked_file` (:2174 not windows, :2179 windows) and `command_line_too_big` (:2203
unix, :2208 windows, :2214 other). `exec_linker`'s local `Escape` is a class, and its `Display` is `fmt` (:2224). The nested
`msvc_drectve_export` (:2617) and `elf_has_gold_version_note` (:4158) are closures with their markers.

## The `xlane` table

The five ssa-link-b entries forward to the ports: `exec_linker`, `self_contained_components`, `linker_with_args`,
`relevant_lib` and `create_raw_dylib_dll_import_libs`. They stay forwarders so tests can replace them. New entries forward to
code this range calls in files I do not own. Each stops in its owner, or is a one-line stand-in with a note:

| entry | upstream | what it does now |
|---|---|---|
| `Object_add_symbol(file, symbol)` | object 0.39.1 `write::Object::add_symbol` | stops: `object::write::Object::add_symbol` (vendor object has no symbols) |
| `Object_set_subsections_via_symbols(file)` | `write::Object::set_subsections_via_symbols` | sets the existing `macho_subsections_via_symbols` field, which is the method's whole body (PORT note) |
| `apple_add_data_and_relocation(..)` | apple.rs:81 | forwards to apple.ts, which stops (needs `object::write` relocations) |
| `apple_get_sdk_root(sess)` | apple.rs:160 | forwards to apple.ts, which stops (`xcrun` not ported) |
| `apple_sdk_name(target)` | apple.rs:19 | forwards to apple.ts (ported) |
| `create_dylib_metadata_wrapper(abb, ..)` | archive.rs:69 (provided) | forwards to `ArchiveBuilderBuilder_provided`. It reaches metadata.ts `create_compressed_metadata_file`, which stops |

## Evidence

### `linker_with_args` against the oracle

`link_with_args.oracle.test.ts`, test 1, covers ssa-linker's 11 cases (`back/linker_oracle/common.ts`). For the 10 that link,
the port's own `linker_with_args` builds the line. `link_natively`'s environment additions follow (`disable_localization`,
`link_env`, `link_env_remove`). The result is compared byte for byte with the oracle's `--print link-args` line in
`linker_oracle/oracle/<case>.args`, after ssa-linker's normalisation. **All 10 are byte-identical:**

| case | target | result |
|---|---|---|
| host-bin | aarch64-apple-darwin | same |
| host-bin-strip (`-Cstrip=symbols`) | aarch64-apple-darwin | same |
| host-bin-dead (`-Clink-dead-code`) | aarch64-apple-darwin | same |
| host-dylib (`-Cprefer-dynamic`) | aarch64-apple-darwin | same |
| host-cdylib | aarch64-apple-darwin | same |
| host-staticlib | aarch64-apple-darwin | not linked: the oracle prints no line (link_staticlib) |
| linux-bin | x86_64-unknown-linux-gnu | same |
| linux-bin-static-reloc (`-Crelocation-model=static`) | x86_64-unknown-linux-gnu | same |
| linux-bin-strip (`-Cstrip=symbols`) | x86_64-unknown-linux-gnu | same |
| linux-cdylib | x86_64-unknown-linux-gnu | same |
| linux-dylib (`-Cprefer-dynamic`) | x86_64-unknown-linux-gnu | same |

The port decides everything in the line from its own `CrateInfo::new` (base.ts), session and target. That includes:
- the upstream rlibs and their order;
- `rehome_lib_path`;
- the `-Bstatic`/`-Bdynamic` hints around the std dylib and `compiler_builtins`;
- the native libraries (`-lSystem -lc -lm`, `-lgcc_s -lutil ...`), through `relevant_lib` and the rmeta-link cache;
- whether the allocator object is passed (`needs_allocator_shim_for_linking`);
- `rmeta.o` for dylibs;
- Apple's `-arch` / `-mmacosx-version-min` (`add_apple_link_args`) and `SDKROOT` (`add_apple_sdk`);
- `-L` (`add_library_search_dirs`), the raw-dylibs `-L` on ELF, `-o`, gc/relro/strip/pie, and the export list.

The test also checks `link_output_kind` against each case's `output_kind`. It checks that `add_linked_symbol_object` passes
`Object::add_symbol` exactly the port's `CrateInfo.linked_symbols`, with one ld64 relocation each on Mach-O and none on ELF.

The test supplies these inputs, and its header says so:
- **The object paths** (codegen names them).
- **The oracle's default sysroot**, set on the session as `linker_args.oracle.test.ts` does. Without it, `get_linker` stops on
  the port's placeholder default sysroot, which lane default-sysroot fixes.
- **A recording `Object_add_symbol` / `apple_add_data_and_relocation`**: the vendor writer has no symbols or relocations, so
  `symbols.o` is written without them; only its path is in the line.
- **The fixture's `SDKROOT` as `apple_get_sdk_root`**: `xcrun` is not ported, and the function is reached only when `SDKROOT`
  is unset in the environment.
- **Fixed bytes from `create_dylib_metadata_wrapper`**: `create_compressed_metadata_file` is not ported.

Test 2 runs `link_natively` end to end on host-bin and linux-bin. The steps are `linker_and_flavor`,
`self_contained_components`, `linker_with_args`, the environment, `--print link-args=<file>` and `exec_linker`. The linker is a
script named `cc` that writes its argv and exits 0. Two checks pass:
- the printed file equals the oracle's line;
- the argv the linker received equals the oracle's arguments.

Mutations of link.ts, each reverted with `git checkout` and the tree clean afterwards:

| mutation | result |
|---|---|
| upstream native libraries not `link_dynamic` | test 1 fails |
| `keep_metadata` on Cdylib instead of Dylib | fails |
| `link_output_kind`: `Pic` no longer gives `DynamicPicExe` | fails |
| `-mmacosx-version-min` split into two args | fails |
| drop `add_late_link_args` | **survives**: no fixture target has late link args |
| drop `reset_per_library_state` | **survives**: every case ends on a dynamic library already |
| drop the consecutive-library dedup in `add_native_libs_from_crate` | **survives**: no crate repeats a library |
| swap the metadata and allocator objects | **survives**: no case has both |

The four survivors need a target or crate the fixtures do not have. A synthetic unit test could pin them (follow-up).

### N2: `link_staticlib`

The new link.test.ts test drives `link_staticlib` with:
- a recording `ArchiveBuilder`;
- one upstream rlib crate with a dylib native library;
- `--print native-static-libs`.

It checks four things:
- the base archive's members (`RlibFlavor::StaticlibBase`);
- the rlib member filter on metadata, rmeta-link, a Rust object and another member;
- `build(out, None)`;
- the `native-static-libs: -lx` note.

ssa-link-a's three surviving mutations are now caught:

| mutation | result |
|---|---|
| `"StaticlibBase"` → `"Normal"` | 1 fail |
| drop the `rmeta_link::FILENAME` skip | 1 fail |
| drop the `print_native_static_libs` call | 1 fail |

`link_natively`, `exec_linker` and `linker_with_args` are now exercised by `link_with_args.oracle.test.ts`. These are still
not run by any test: `report_linker_output`, `add_sanitizer_libraries` and `strip_with_external_utility` (ssa-link-a's code,
unchanged).

### A real link on the host

The input is `fn main() { println!("hello from rust-ts"); }`, built with `--edition 2024 --crate-type bin --emit=link
--sysroot <oracle sysroot>` on aarch64-apple-darwin, against the oracle's std rlibs (D6). Scratch drivers are not committed.

1. **`bun src/rust_ts/main.ts` as is.** Codegen completes (both `.rcgu.o` are written), then `linker_with_args` → `get_linker`
   stops with `rustc_session::filesearch::default_sysroot (the default sysroot's tools directory in the linker's PATH)`.
   This is the known blocker; lane default-sysroot fixes it.
2. **The oracle's default sysroot put on the session**, through `compiler_entrypoint`'s `config` callback, as the tests do.
   The first stop is `object::write::Object::add_symbol (vendor object: symbols are not ported; add_linked_symbol_object)`.
   **This is the first stop of a real link once default-sysroot lands.** It hits every bin, dylib and cdylib: hello has 20
   linked symbols. On Mach-O, `apple::add_data_and_relocation` (object relocations) comes right after it.
3. **Scratch experiment** (only to see the rest of the path, not a result to keep). Same as 2, except that `Object_add_symbol`
   and `apple_add_data_and_relocation` are replaced by no-ops, so `symbols.o` has no undefined symbols, and `SDKROOT` is set
   from `xcrun --show-sdk-path`. **The link completes, and the binary runs.**
   - hello: stdout `hello from rust-ts`, exit 0. Byte-identical to the oracle-built binary's stdout, same exit code.
   - A second program (collect a `Vec`, print `sum=55`, `process::exit(3)`): the same stdout and exit code 3 on both.
   - So after default-sysroot, what stands between the port and a real native hello is the vendored object writer's symbols
     (`add_symbol` and Mach-O/ELF symbol tables) and relocations (`add_relocation`, for apple.rs `add_data_and_relocation`).
     Without `SDKROOT`, `apple::get_sdk_root` (`xcrun`) stops next.

### Regressions

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_ssa/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`:
  204 pass, 0 fail.
- Added unit-test wall time is about 1.6 s: link_with_args.oracle 1.5 s, the link.test.ts addition under 0.1 s.
- `--sample 200 --jobs 6`, `RUST_TS_AGENT=ssa-link-b`:
  - check-ui: 200/200 MATCH (run 20261114-133724-ssa-link-b-a1fd).
  - rmeta-ui: 200/200 MATCH (run 20261114-133826-ssa-link-b-psda).
  - mono-ui: 200/200 MATCH, 488 skipped (run 20261114-133934-ssa-link-b-ncym).
- The new tests read only `RUST_TS_REQUIRE_PROBES` and `RUST_TS_AGENT` (both listed). Nothing under `src/` writes to
  `process.stdout`/`process.stderr`. The port's `get_apple_sdk_root` reads `SDKROOT`, as upstream does. In the oracle test, a
  different `SDKROOT` in the environment can only fail, never pass falsely (test header).

## Every `unported(...)` left in this range

link.ts:
- `std::fs::File::sync_all (exec_linker's flush_linked_file, Windows host)`.
- `object::read::File::sections (vendor object: add_c_staticlib_symbols, ...)`: a cdylib with `-l static:+export-symbols`.
  The archive is parsed and the LLVM-bitcode check runs first.
- `object::read::elf::SectionHeader::notes (vendor object; warn_if_linked_with_gold, ...)`: only when the ELF output has a
  `.note.gnu.gold-version` section. Without one, `warn_if_linked_with_gold` now completes; it used to stop for every
  well-formed ELF output.
- `rustc_target::spec::Target PartialEq (self_contained_components: InferredForMingw, windows-gnu)`: `sess.host ==
  sess.target` is not modelled, and only windows-gnu targets ask.
- `core::slice::sort_unstable_by (ipnsort past 20 elements, raw-dylib libraries of one name)`: see the PORT decisions.
- `object::write::Object::add_symbol (...)`: in the `xlane` entry, above.
- Reached in other files: `rustc_data_structures::jobserver::client` (explicit linker jobs with LLD), apple.rs
  `add_data_and_relocation` and `get_sdk_root`, and metadata.rs `create_compressed_metadata_file` (dylib and proc-macro
  metadata objects).

raw_dylib.ts:
- `object::write::elf::Writer (dynamic symbols, GNU versions and .dynamic: vendor object; raw-dylib on ELF)`.
  `create_elf_raw_dylib_stub` is ported whole against `ElfStubWriter`, an interface of exactly the writer methods it calls.
  Getting the writer stops, so it is reached only with `kind = "raw-dylib"` on ELF. The Windows path
  (`create_raw_dylib_dll_import_libs`) is ported and calls archive.ts's provided `create_dll_import_lib` (ar_archive_writer
  COFF, or the mingw stop).

## `// PORT:` decisions

- **`exec_linker`**: `cmd.command().stdout(piped).stderr(piped).spawn()` + `wait_with_output()` is `ProcessCommand::output()`
  (`Bun.spawnSync`, D15). A spawn error is the same `io::Error`, so `command_line_too_big` (E2BIG from `node:os`) and the
  `@`-file fallback work as upstream. The child's stdin is null where `spawn` would inherit it; a linker reads none.
  `args.encode_utf16()` uses JS's UTF-16 code units, which are the same units.
- **`jobserver::Acquired`** stays the minimal `JobserverAcquired` stand-in, with a note. The port's jobserver
  (rustc_data_structures/jobserver.ts) hands out no tokens and its `client()` stops; vendor jobserver has no `Acquired`.
  `linker_with_args` returns `[]` unless explicit LLD jobs reach `client()`.
- **`Session::is_wasi_reactor`** (session.rs:799) is not in session.ts. A copy of its body sits in link.ts, as
  `get_tools_search_paths` sits in linker.ts, for rustc_session's owner to take.
- **`native_libraries_from_nonstatics.sort_unstable_by(name)`** uses JS's stable sort. Core's ipnsort is insertion sort, which
  is stable, up to 20 elements (core/src/slice/sort/unstable/mod.rs:49), so the two agree there. Past 20, equal names could
  come out in a different order. That is visible only through the raw-dylib collations, which read only `RawDylib` libraries
  keyed by name. So a list over 20 with two raw-dylib libraries of one name stops; nothing is guessed.
- **`sess.prof.generic_activity_with_arg("link_altering_rlib", ..).run(..)`** in `add_static_crate`: the closure runs
  directly, because the self-profiler is not ported.
- **`warn_if_linked_with_gold`'s `ReadCache`**: the whole file is read, and the same bytes are parsed.
- **Map indexing panics as upstream's does**, through `crate_info_used_crate_source` / `crate_info_crate_name` (`UnordMap`:
  "no entry found for key"), `index_map_get` (`FxIndexMap`: "IndexMap: key not found") and `vec_index` (`IndexVec`: core's
  out-of-bounds message). This is N3. The same fix is applied to `each_linked_rlib`'s two lookups, which had the same `!`.
- **`DllCallingConvention`'s derived `PartialEq`** is a local `DllCallingConvention_eq`. `DllImport::clone()` shares the
  value, which is never written after decoding.
- **Seven `elf::` constants** are local in raw_dylib.ts, with their elf.rs lines: `STV_DEFAULT`, `VERSYM_HIDDEN`,
  `VER_DEF_CURRENT`, `VER_FLG_BASE`, `DT_SONAME`, `DT_VERDEFNUM` and `DT_NULL`. The vendored `elf.ts` lacks them.
- **`get_apple_sdk_root`**: the guarded match arms are one boolean, `ignored`. An arm whose guard holds falls through to
  `apple::get_sdk_root`, as `{}` does, and any other value returns `Some(p)`.

## Requests for other owners

- **vendor object (write)**: `Object::add_symbol` and symbol writing for Mach-O and ELF (`elf_symbol_flags`, `macho_write`'s
  symbol table), and `Object::add_relocation` for Mach-O. These are the next stop of every native link after default-sysroot.
  Also `write::elf::Writer`'s dynamic-symbol, GNU-version and `.dynamic` writers (raw-dylib on ELF), `read::File::sections`
  and `read::elf::SectionHeader::notes`. `object::write::SymbolId` is a local branded number in link.ts until the writer has
  one.
- **apple.ts**: `add_data_and_relocation` (needs the relocations above) and `get_sdk_root` / `xcrun_show_sdk_path`. Without
  `SDKROOT` set, `get_sdk_root` is the stop after the object writer.
- **metadata.ts**: `create_compressed_metadata_file` (dylib and proc-macro links).
- **rustc_session**: take `Session::is_wasi_reactor` (copy in link.ts) and `get_tools_search_paths` (copy in linker.ts).
- **Follow-up tests**: a synthetic `linker_with_args` unit test for the four surviving mutations above. Tests for
  `report_linker_output`, `add_sanitizer_libraries` and `strip_with_external_utility`.

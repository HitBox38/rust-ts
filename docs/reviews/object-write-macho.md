**Verdict: APPROVE WITH NITS.** No finding blocks acceptance. The three nits and the suite notes below can go in a follow-up.

# Review of lane object-write-macho (independent reviewer)

I reviewed branch `t3/3faba041` at `d16f353f` (one commit on `main` at `26e61959`), fast-forwarded into the reviewer
branch `t3/ecac148c`. Host: aarch64-apple-darwin, on AC, load 5 to 15, `RUST_TS_AGENT=review-object-write-macho`.
The oracle is `rustc +nightly` (1.101.0-nightly 6f5da406b, `RUSTUP_AUTO_INSTALL=0`). Upstream sources: `object-0.39.1`,
`ar_archive_writer-0.5.3` (via `scripts/crate-src.ts`), and `$RUST_TS_DATA/rust` at the pin.

## 1. Fidelity

I compared these line by line with upstream: all of `write/macho.rs`; the darwin branch of `create_object_file`;
`macho_object_build_version_for_target` with `pack_version`; `macho_is_arm64e`; `back/apple.rs` (`sdk_name`, `macho_platform`,
`add_version_to_llvm_target`, `stdout_to_path`, and the four stubs); `Session::apple_deployment_target`; the read side
(`MachOSymbolIterator`, `MachOSymbol` up to `is_local`, `File::symbols`, `SymbolSection::index`); and the write/mod.rs
Mach-O fields and dispatches. Order, logic, names and markers match. Specific points:

- **Load commands and layout.** The header, then `LC_SEGMENT(_64)` with its section headers, then `LC_BUILD_VERSION`
  (only when set), then `LC_SYMTAB` and `LC_DYSYMTAB`, in upstream order with upstream `ncmds`/`sizeofcmds`. Section data
  follows the commands with no padding. Non-bss sections are `align_u64`-ed, then bss ones. Relocations, then the symtab,
  sit at `align(offset, pointer_align)`, and `write_align` comes before the symtab. The strtab starts with a NUL and is
  padded to `pointer_align`. These match upstream.
- **`LC_BUILD_VERSION`.** 24 bytes with `ntools` 0 and `sdk` 0. `pack_version` is `(major << 16) | (minor << 8) | patch`
  with `>>> 0`, and `OSVersion::from_str` already bounds the fields to u16/u8/u8. `macho_platform`'s arms are in upstream
  order (`(MacOs, _)` first).
- **Symbol and string tables, and the dysymtab.** Partitioning: `Section` symbols are kept only on Aarch64/Aarch64_Ilp32,
  `File` is skipped and `Label` is an error. External and undefined symbols are sorted by a stable sort on the name bytes.
  Indices run local, then external, then undefined. `n_type`/`n_sect`/`n_desc`/`n_value` come out as upstream (`n_sect`
  is `& 0xff`, as `as u8`). Dysymtab: `ilocalsym` 0, `iextdefsym = nlocal`, `iundefsym = nlocal + nextdef`, and 14 zero
  words. Every struct size matches upstream: header 28/32, segment 56/72, section 68/80, nlist 12/16, symtab 24,
  dysymtab 80, build version 24.
- **Constants.** I evaluated all 68 numeric constants in `object/macho.ts` that have a literal upstream definition against
  `macho.rs`: 0 mismatches. The three derived ones are correct too: `CPU_SUBTYPE_I386_ALL` = 3, `CPU_TYPE_ARM64` =
  0x100000c, `CPU_TYPE_ARM64_32` = 0x200000c.
- **32-bit, arm64e and Catalyst.** `AddressSize::U32` selects `MachO32` (`LC_SEGMENT`, `% 2^32` for `as u32`). arm64e gets
  `CPU_SUBTYPE_ARM64E | CPU_SUBTYPE_PTRAUTH_ABI` through `macho_cpu_subtype`, keyed on `llvm_target.starts_with("arm64e")`
  as upstream. Mac Catalyst gets `PLATFORM_MACCATALYST`.
- **Endianness.** Every field is written with the object's `endian`. The magic is `MH_MAGIC*` if big-endian, else
  `MH_CIGAM*`, always written big-endian, as upstream. Nothing uses the host's endianness or the host's target where
  upstream uses the target's.
- **`__.SYMDEF`.** ar_archive_writer is not this lane's code, but the darwin symbol table now goes through this lane's
  Mach-O symbol reader. `ar_archive_writer-0.5.3` does not sort the symbol table. Darwin members are padded to 8 with
  `\n` (`archive_writer.ts:665`). See §2 for the byte checks with real symbols.
- **Unported branches.** TLS and relocations stop `unported` (`macho_tlv_bootstrap`, `macho_add_thread_var`,
  `macho_translate_relocation`, `macho_adjust_addend`, `macho_relocation_size`, and the relocation loop of `macho_write`),
  as do `add_data_and_relocation`, `get_sdk_root`, `xcrun_show_sdk_path` and `xcode_select_developer_dir`. None returns a
  guessed value. The read side's missing `MachOSymbol` methods (`name`, `size`, `is_definition`, `is_common`, `flags`)
  have no marker and no caller.

## 2. Reproduction (my own crates, none of the lane's)

I wrote a compare script in my scratchpad. It runs the oracle and `src/rust_ts/main.ts` with `--crate-type rlib
--emit=dep-info,metadata,link -Zcodegen-backend=dummy` in the same cwd on the same relative path, with `RUSTC_ICE=0`. It
compares exit, stdout, stderr, `.rmeta`, `.rlib` and dep-info (out dir spelled `X/`). "6/6" means all six are equal.

| case | result |
|---|---|
| `depa.rs` (std, edition 2021): 2 modules, a trait with a default method, derives, generic fns with bounds, a generic enum with an `impl` over operator traits, `pub static`, `pub(crate) const`, `#[macro_export]` macro, `pub use` | 6/6 (rlib 17,048 bytes) |
| `userb.rs`: nested modules, const generics, generic `impl`, a `#[macro_export]` macro with repetition, a trait with a `where Self: Debug` default method; uses `depa`'s macro, re-exports and generics through `--extern depa=<the port-built libdepa.rlib>` (byte-equal to the oracle's) | 6/6 (rlib 10,000 bytes) |
| `userb.rs` with `--extern depa=` the oracle's `.rlib`, and with its `.rmeta` | 6/6, 6/6 |
| `#![no_core]` crate (modules, unit struct, trait, macro; sizedness and `copy` lang items) | 6/6 |
| same, `MACOSX_DEPLOYMENT_TARGET` = `11.0`, `12.7.6`, `26.1`, `99.255.255`, `10.11` (too-low warning), `+14`, `12.\xff` and `\xff` (non-UTF-8: ignored on both sides) | 6/6 each |
| same, `IPHONEOS_DEPLOYMENT_TARGET=1.0` on macOS (ignored) | 6/6 |
| same, `--target x86_64-apple-darwin`, without and with `MACOSX_DEPLOYMENT_TARGET=10.13` | 6/6, 6/6 |
| same, `--crate-name nc -C metadata=abc -C extra-filename=-xyz` | rlib, rmeta, stderr and exit equal |
| `--crate-type rlib --crate-type staticlib --emit=link,metadata` | equal rlib and rmeta, exit 0 on both |
| `MACOSX_DEPLOYMENT_TARGET` = `abc`, `11.300`, `14.`, empty, ` 12.0`, `12.0.0.1` | oracle exits 1 and writes the rlib; port exits 70 `unported: std::num::ParseIntError Display`, with stdout, `.rmeta` and dep-info equal and no rlib. A clean stop (§5). |

**`staticlib`, `dylib`, `cdylib`, `proc-macro`** with `-Zcodegen-backend=dummy`, on the no_core crate and on `depa.rs`:
the oracle exits 0 and writes no file, and so does the port, with equal stderr. This is the real behaviour, not a stop,
so nothing wrong is written. With the default backend, `staticlib`, `dylib` and `rlib` all stop `unported` at
`LlvmCodegenBackend::codegen_crate` (exit 70, no file).

**Paths no rlib above reaches** (driven in-process against the batch's code in my scratchpad):

- **Mach-O symbol reading and a non-empty `__.SYMDEF`.** I compiled two C files with clang (globals, a `static` fn, a
  weak fn, a hidden fn, an undefined reference, `ltmp*` section symbols) into `libfoo.a`. The oracle bundles it into an
  rlib (`-l static=foo`). Rebuilding that rlib's five members with the port's `write_archive_to_stream(.., "Darwin",
  false, false)` and `DEFAULT_OBJECT_READER` gives the oracle's bytes exactly. I did this for arm64 (5,744 bytes, 9
  symbols), arm64_32 watchOS (a 32-bit Mach-O, 4,560 bytes), x86_64 (5,272 bytes) and arm64e iOS (4,920 bytes). In the
  port itself, `-l static=foo` stops `unported` at `link_rlib (bundled native library foo)`, which is safe.
- **`lib.rmeta` wrappers with real, odd-sized payloads.** I rebuilt both members of oracle rlibs with
  `create_wrapper_file` and a stand-in session, and they come out byte-identical (member padding checked). Targets:
  arm64_32-watchos with `WATCHOS_DEPLOYMENT_TARGET=7.1` (a 1,678-byte payload in a 32-bit object, so 4-byte alignment and
  4 bytes of member padding), arm64e-ios with `IPHONEOS_DEPLOYMENT_TARGET=15.2.1`, macabi with `16.0`, and with the
  default minimum: ios-sim, tvos, watchos-sim, visionos and visionos-sim. The stand-in session supplies
  `object_architecture` and the deployment target, as the lane's test does. Those target specs are not ported.

## 3. The unit test `back/rlib_macho.oracle.test.ts`

It compares against **fixtures** (base64 oracle bytes captured once), not live oracle output. Its header says so. The
sessions are stand-ins: `object_architecture` and `apple_deployment_target` are stubbed, so `Target::object_architecture`
and the env-var path are covered only by end-to-end runs (§2).

**Mutation check.** I wrote an in-process copy of its four assertions and flipped every byte of every fixture, one at a
time:

- **Host rlib (2,576 bytes).** Every flip outside bytes 480–2145 fails a test. That covers all 16 `__.SYMDEF` bytes, the
  archive and member headers, and every byte of both wrapper headers and tails. The 1,666 flips that pass are exactly the
  `.rmeta` section payload (1,666 bytes), which the test takes from the fixture as input.
- **The four `lib.rmeta-link` fixtures** (x86_64, arm64_32, arm64e, macabi): 0 undetected flips out of 336, 304, 336 and
  336.

So it cannot pass for the wrong reason on the bytes it owns. It runs in 152 ms (8 tests with `apple/tests.test.ts`),
in line with the lane's 0.15 s.

## Findings

1. **src/rustc_codegen_ssa/back/rlib_macho.oracle.test.ts:1, nit (read).** In this repo, `*.oracle.test.ts` files run
   against a live oracle (`src/miri/float_error.oracle.test.ts`, `src/rust_ts/*.oracle.test.ts`); this one only reads
   fixtures. The fixture rmeta also embeds the lane's scratch path
   (`/private/tmp/claude-501/-Users-tomernorman--t3-worktrees-rust-ts-t3-3faba041/...`) and a user name. Failing scenario:
   none today. A reader may take the name to mean the test checks the live oracle at the pin, and it does not. Fix:
   rename it to `rlib_macho.test.ts`, or regenerate the fixtures from a neutral path such as `/x/nc.rs` with a recorded
   command.
2. **src/vendor/object/write/macho.ts:407, nit (read).** The relocation count is `section.relocations.length` instead of
   upstream's `Σ (1 + (addend != 0) + subtractor.is_some())`. The `PORT:` comment explains it, and `Section.relocations` is
   always empty because `add_relocation` is not ported. If a later lane ports `add_relocation` before `macho_write`'s
   relocation loop (`:593`), offsets would be computed wrongly, though the loop still stops `unported` before anything is
   written. Fix: port the upstream formula now. It is one line and needs no other code.
3. **src/rustc_driver_impl/lib.ts:652, nit (reproduced; not the lane's file).** `--print deployment-target` still stops
   `unported` with the reason "`EarlySession::apple_deployment_target`", which this lane has now ported. The oracle prints
   `MACOSX_DEPLOYMENT_TARGET=11.0` (and `=13.2.1` with that variable set). Fix for the driver owner: port the three lines
   (`println_info!("{}={}", deployment_target_env_var(..), sess.apple_deployment_target().fmt_pretty())`).

## 4. Changes outside the lane's files

- **`Session::apple_deployment_target` (session.ts:167–206).** It matches session.rs:384 in order and logic. The
  too-low warning compares against `os_min`. `version.max(min)` returns `min` on a tie, as `Ord::max` does, though the
  values are equal then anyway. The `Invalid` arm returns `min` after emitting. Duplicate warnings collapse as on the
  oracle: the `10.11` case gives one warning on both sides. The `as unknown as diagnostics.ParseIntError` cast
  (session.ts:199) is safe only because the diagnostic stops `unported` before it reads the value; §5 removes it.
- **object read side.** `File::symbols`'s ELF arm is unchanged. The Mach-O arm and `MachOSymbol` match upstream; the
  heuristic `ltmp<digits>` check gets the right result on real clang objects (§2). `SymbolSection::index` and
  `AddressSize::bytes` match, and so does `align_u64` (remainders on a power of two equal upstream's `&`).
- **Regression samples** (`RUST_TS_AGENT=review-object-write-macho`, so different cases from the lane's):

  | suite | sample | result |
  |---|---|---|
  | check-ui | 40 | 40 MATCH |
  | rmeta-ui | 60 | 60 MATCH |
  | mono-ui | 60 | 60 MATCH |
  | check-std | 1 (the suite) | MATCH |
  | miri-sysroot-alloc | 1 (the suite) | MATCH |

- **Other checks.** `bunx tsc --noEmit -p .` passes, run with `node_modules` linked from the main checkout. Unit tests of
  `src/vendor/object`, `src/vendor/ar_archive_writer`, `src/rustc_codegen_ssa`, `src/rustc_session` and
  `src/rustc_target`: 170 pass, 0 fail.

## 5. The `MACOSX_DEPLOYMENT_TARGET=abc` stop

The proposed fix is right. Make `diagnostics.ts`'s `ParseIntError` stand-in `rustc_abi`'s `ParseIntError` (the kind), and
display it with `display_ParseIntError`, which is `into_diag_arg_using_display` as upstream. Then drop the cast in
`session.ts:199`. I applied exactly that in a throwaway detached worktree. All nine invalid values I tried then give
6/6 against the oracle, including the oracle's exit 1 with the rlib still written: `abc`, `11.300`, `14.`, empty,
` 12.0`, `12.0.0.1`, `+`, `-1` and `70000`, which cover `InvalidDigit`, `PosOverflow` and `Empty`. `tsc` passes with it.
The three kinds `parse_uint` returns are exactly the three that `display_ParseIntError` covers.

## 6. Coverage and markers

`bun scripts/coverage.ts --check`: `markers ok (24882; vendor 5286; library 605)`. `--missing` gives write/macho.rs 37/37,
back/apple.rs 8/8, back/metadata.rs 16/16, read/macho/symbol.rs 20/53 and session.rs 85/104, as the handoff says.

## 7. The proposed `host-rlib` report suite

The design is sound: report only, sizes and sha256 for rmeta and rlib, and `$OUT` in dep-info. Before root adds it:

- **Pin the source path and cwd.** The rmeta embeds the absolute working directory and source path (the unit-test fixture
  shows it), so both sides must run on one fixed directory. The difftest cache key covers the file hash, args and
  `Case.env`, not the cwd.
- **Scrub the deployment-target variables.** `MACOSX_`, `IPHONEOS_`, `WATCHOS_`, `TVOS_` and `XROS_DEPLOYMENT_TARGET` are
  not in `scripts/lib/env.ts`'s scrubbed set (`:41`). A shell that exports `MACOSX_DEPLOYMENT_TARGET` would change every
  case and put that output into the shared oracle cache. Cases that need a value set it in `Case.env`, which joins the
  key. No protected suite reads these variables today: they are read only for darwin targets, and only on this lane's
  path. This is a `scripts/` change, so it needs its own reviewed batch.
- **Case 5 should keep only the files that build.** The 6 that fail to compile write no rlib and add nothing here.
- **Add these cases:** a dependency crate consumed through `--extern` (as `userb` above), `rlib` + `staticlib` together,
  and the invalid deployment targets once the §5 fix lands.
- **Host-specific.** The std case needs the host's oracle sysroot, so the suite only runs on the root host, as
  `mirimath` does.

## Not checked

- The gate. No full suites other than the single-case check-std and miri-sysroot-alloc.
- Big-endian Mach-O end to end. No pinned Apple target is big-endian; I checked it by reading only.
- `--print deployment-target` and the other Apple target specs. They are not ported, and my non-host checks used a
  stand-in session.
- Windows.
- Whether rlibs with real object code (codegen) would match. That path stops `unported` at `codegen_crate`.

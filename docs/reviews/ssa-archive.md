# Review: lane ssa-archive (wave 40q)

Reviewer, read-only on code. Subject: branch `t3/port-ssa-archive-symbol-rpath`, commit `45bf7043`, on main `bcbd0c28`
(pin 6f5da406b56c, 1.101.0-nightly). This review is committed on top of the subject commit.

## Verdict: FAIL (one test-only must-fix)

The port itself is faithful. I found no logic divergence in `archive.rs`, `symbol_edit.rs`, `rpath.rs`, the vendor pieces or
pathdiff. Every marker sits on the right upstream `fn` line. No value is guessed. Every stop names what it is waiting for.

The one must-fix is evidence. The checked-in test does not exercise `-Zstaticlib-hide-internal-symbols`: a mutant that turns
hide into a no-op passes it (F1). I built a fixture where hide does change the oracle's bytes, and the port matches the oracle
there on both targets. So the fix is a fixture, not a code change.

## Findings

**F1 (must fix, test only). The hide path has no regression guard.**
- **Where:** `src/rustc_codegen_ssa/back/archive_oracle.test.ts:50` and `:72`, `archive_oracle/nc.rs`, `archive_oracle/regen.ts:19-25`.
- **Code it fails to guard:** `symbol_edit.ts:267-271` (ELF; upstream symbol_edit.rs:209-213) and `symbol_edit.ts:448-451`
  (Mach-O; upstream :393-396).
- **Why:** on `nc.rs` the internal globals are already `STV_HIDDEN` (ELF) or `N_PEXT` (Mach-O), so the patch writes back
  the byte that is already there. The handoff says so, but its "10 of 10, including hide" table reads as hide coverage.
- **Mutants that survive the lane's test (14 pass, 0 fail):**
  - M2: Mach-O `value: nlist.n_type | macho.N_PEXT` → `value: nlist.n_type`.
  - M3: ELF `patches.push({ offset, value: new_vis })` → `value: sym.st_other`.
- **A fixture where hide matters.** Take `nc.rs`, add an unused `#[inline(never)] pub fn root_pub(x: u32) -> u32` and a
  `pub static ROOT_DATA: u32`, and build the four staticlib variants with `--crate-type staticlib --crate-type rlib`:
  - The rlib crate type makes `root_pub` and `ROOT_DATA` reachable. They stay global with default visibility but are not
    in the StaticLib export set.
  - With staticlib alone they are not reachable, so they are dropped or internalized and hide is again a no-op. I tried
    that first.
- **Result on that fixture:** the oracle's hide archive differs from plain in exactly 2 bytes per target:
  - ELF: `st_other` 0 → 2.
  - Mach-O: `n_type` 0x0f → 0x1f.

  The port is byte-identical to the oracle in all 8 builds (plain, hide, rename, both × two targets), and it catches M2
  and M3.
- **Fix:** add this build (or an equivalent crate) to `regen.ts` and `fixtures.json`, so that the test asserts
  hide ≠ plain and port = oracle.
- **Scratch:** `$RUST_TS_DATA/tmp/review-ssa-archive/hidecheck.ts` and `nc3.rs`. Run with
  `EXTRA="--crate-type rlib" bun hidecheck.ts nc3.rs nc_exported,NC_DATA`.

**N1. pathdiff's unit tests are not ported.**
- **Where:** `src/vendor/pathdiff/lib.test.ts` ports only the doc examples (pathdiff-0.2.3 src/lib.rs:20-32).
- **Missing:** the crate's `mod tests` (src/lib.rs:170-251; `test_absolute`, `test_identity`, `test_subset`,
  `test_empty`, `test_relative`, `test_current_directory`). PORTING §5b says to port a vendor crate's unit tests too.
- I ran all 31 assertions against the port, comparing by components as `PathBuf ==` does, and all pass. That includes the
  `"." vs "foo" → "../."` and trailing-slash cases. Script: `$RUST_TS_DATA/tmp/review-ssa-archive/pathdiff_upstream.ts`.
  Porting them is mechanical.

**N2. Make `symbols` required once ssa-link-a lands.**
- **Where:** `archive.ts:288`, `:600` (`build(output, symbols?)`). Upstream: archive.rs:329, :554.
- **Sound today:**
  - The only caller is `link.ts:349`, which corresponds to upstream's explicit `None` at link.rs:373.
  - `link_staticlib`, the only caller that passes `Some`, is still `unported` (`link.ts:353`).
  - `undefined` means exactly `None` all the way down: `build_inner` (`archive.ts:611`) takes `symbols: ArchiveSymbols | undefined`.
- **Risk:** with the parameter optional, tsc will not flag a ported `link_staticlib` that forgets the argument. If that
  happens, the `-Zstaticlib-*` flags would be silently ignored.
- **Fix:** the handoff already plans this. Make the parameter required in ssa-link-a's integration.

**N3. `ImportLibraryItem` is an interface plus a companion const.**
- **Where:** `archive.ts:58`, `:70` (upstream archive.rs:36, :48).
- **Why it's a nit:** PORTING §5 "Structs" asks for a `class` when a struct has inherent methods.
- **Why it's harmless:** callers (raw_dylib.rs) build it with struct literals, and the companion keeps the marker greppable.
  Cosmetic. Fix it or record the choice as a `// PORT:`.

## Fidelity notes (checked, no finding)

### symbol_edit.ts

**Structure**
- 14/14 functions, in upstream order.
- The `mem::offset_of!` constants match the `#[repr(C)]` byte-array layouts:

  | constant | value |
  |---|---|
  | Sym64 `st_other` | 5 |
  | Sym32 `st_other` | 13 |
  | Nlist `n_type` | 4 |
  | FileHeader64 / 32 `e_shoff` | 40 / 32 |
  | SectionHeader64 `sh_offset` / `sh_size` | 24 / 32 |
  | SectionHeader32 `sh_offset` / `sh_size` | 16 / 20 |
  | SymtabCommand `stroff` / `strsize` | 16 / 20 |

**Offsets**
- The `sym_addr - data_ptr` arithmetic uses `byteOffset`s on the same buffer. `PodSlice` is always a `subarray` of the input
  (pod.ts:122, :169), so archive-member subarrays work too.

**String-table rebuild**
- ELF: `e_shoff` is rounded up to 8, with zero padding. `sh_offset` and `sh_size` of the strtab header are written in the
  relocated section-header copy. Endianness goes through `DataView`.
- The `data.get(e_shoff..)?` check moves before the copies. It has no side effect, and a `// PORT:` comment says so.
- Names sort with `str_cmp`. That is code-point order, which equals UTF-8 byte order, as `&str` `Ord` is.
- `dedup` is adjacent-only, as upstream's.

**Hide patches**
- `& ~0x03 & 0xff` gives the same byte as Rust's `u8` `!0x03`.

**COFF**
- `coff_*` stop by name, after `assert!(!hide)` in upstream order.
- They cannot be reached: `File.parse` already stops for COFF/PE/XCOFF (vendor/object/read/any.ts:78-88). Bitcode or unknown
  magic gives `Err`, so the input comes back borrowed.

### archive.ts

22/22 functions.

**`build_inner`**
- The rename-set collection matches archive.rs:582-608:
  - only `RustObj` entries;
  - `get(start..end)` is a bounds test;
  - `fs::read` errors are ignored.
- `apply_edits` runs on both entry sources only for `RustObj` with `Some(symbols)`.

**`extract_bundled_libs`**
- Error variants and their order match: open, mmap, parse, entry, data before name, `Symbol::intern`, section, write.

**`create_dll_import_lib`**
- `File::create_new` is `openSync("wx", 0o666)`.
- `exports` is built before the `machine` match.
- The `panic!` text uses `Arch`'s Display.
- The `write_import_library` stop comes after the file is created, as upstream orders it.

**`find_binutils_dlltool`**
- Assertion, `-Cdlltool`, the tool names, a `PATH` search with `is_file` (following symlinks), then the fallback.

### rpath.ts and pathdiff
- `rpath.ts` is 6/6, and `rpath/tests.test.ts` ports upstream's 4 tests.
- The path arithmetic is pathdiff 0.2.3's `diff_paths`, arm for arm.
- `PathBuf` collection is `path_join` of each component's `as_os_str`, which is `PathBuf::push`.

### Vendor
- `Sym::name` / `is_undefined` (object-0.39.1 read/elf/symbol.rs:507, :519) match.
- `Nlist::name` / `is_stab` / `is_undefined` (read/macho/symbol.rs:477, :490, :495) match.
- `STB_GLOBAL`=1, `STB_WEAK`=2 and `STV_HIDDEN`=2 match elf.rs:1003, :1005, :1049.
- `MachineTypes` matches ar_archive_writer-0.5.3 coff.rs:9-16, including `ARM64X`=0xA64E.
- `COFFShortExport` has the same fields in the same order.

## Evidence (reviewer)

Setup: AC power, no `GATE_RUNNING`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_AGENT=rev-ssa-archive-q7`.

**Static checks**
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (26891, ...; vendor 5316; ...)`. The pathdiff marker is still a comment
  (`lib.ts:31`), as expected until root adds `"pathdiff": "=0.2.3"` to `harness/scope.json`.
- `--missing`: archive.rs 22/22, symbol_edit.rs 14/14, rpath.rs 6/6, rpath/tests.rs 4/4.
- A per-marker scan confirmed each `// rustc:` line names the upstream `fn` at that line, directly above its function.

**Unit tests**
- `bun test ./src/rustc_codegen_ssa/ ./src/vendor/ar_archive_writer/ ./src/vendor/object/ ./src/vendor/pathdiff/
  ./scripts/lib/unit-steps.test.ts`: 194 pass, 0 fail, 0 skip.
- Run on their own, archive_oracle, rpath.oracle, rpath/tests and pathdiff give 22 pass, 0 skip: the 2 oracle rpath tests
  ran.

**Fixtures**
- `bun src/rustc_codegen_ssa/back/archive_oracle/regen.ts` rewrote `fixtures.json` byte-identically: SHA-256 `6ef17b5a…`
  before and after.
- So the fixtures are the oracle's own output, and regen reproduces them.

**Mutations**
Each was applied with sed and reverted with `git checkout`; the tree was clean afterwards.

| mutant | lane test | reviewer fixture (8 builds) |
|---|---|---|
| M1 ELF drop `\| STV_HIDDEN` (symbol_edit.ts:269) | 2 fail | 2 mismatch |
| M2 Mach-O drop `\| N_PEXT` (:450) | **0 fail** | 2 mismatch |
| M3 ELF hide patch writes the old `st_other` (:270) | **0 fail** | 2 mismatch |
| M4 new strtab offset +1 (:553) | 4 fail | 4 mismatch |
| M5 `e_shoff` aligned to 4, not 8 (:343) | 2 fail | 2 mismatch |
| M6 `STV_HIDDEN` → 3 | 2 fail | 2 mismatch |

**Difftest**
- `difftest --suite rmeta-ui --sample 200 --jobs 6` with `RUST_TS_AGENT=rev-ssa-archive-q7`: 200/200 MATCH, run
  `20261114-061443-rev-ssa-archive-q7-zcuy`.

**Environment reads and output**
- No `process.stdout` / `process.stderr` / `console.` in the new or changed `src/` files.
- New env reads in tests:
  - `archive_oracle.test.ts:55` reads `RUST_TS_AGENT`;
  - `rpath.oracle.test.ts:13` reads `RUST_TS_REQUIRE_PROBES`;
  - `rpath.oracle.test.ts:26` reads `RUST_TS_AGENT`.
- Both names are already allowed by `scripts/lib/unit-steps.test.ts`, which passes. `RUST_TS_AGENT` only picks a scratch
  directory, and `RUST_TS_REQUIRE_PROBES` only turns a skip into a failure, so neither can make a test pass falsely.
- In `src/`, `find_binutils_dlltool` reads `PATH` through `var_os`. That is upstream's own `env::var_os("PATH")`, not a test
  knob.

Scratch dirs under `$RUST_TS_DATA/tmp/` from this review are deleted, except the three scripts kept in
`$RUST_TS_DATA/tmp/review-ssa-archive/`.

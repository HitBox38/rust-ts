# Review: ssa-link-b (wave 40r), `back/link.rs` from `exec_linker` to the end, and `link/raw_dylib.rs`

**Verdict: FAIL** (one must-fix, F1: a one-line fix plus a test; everything else is nits)

- Subject: branch `t3/port-ssa-link-b`, commits `7728afba`, `97b5ce54` and `330371b2`, on main `e80bc814`.
- Handoff: `docs/handoff/ssa-link-b.md`.
- Reviewer branch: `t3/review-ssa-link-b-r`, on `330371b2`.
- Upstream: `$RUST_TS_DATA/rust/compiler/rustc_codegen_ssa/src/back/link.rs` and `link/raw_dylib.rs` at the pin (6f5da406b56c).
- Host: AC power, `--jobs 6` at most, and `.data/tmp/GATE_RUNNING` absent throughout. `.env.local` from integ-w39 plus
  `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`.

The link.rs range is faithful. I found no wrong order, no guessed value and no unnamed stop in it, and the evidence holds:
the oracle test, the fake-`cc` end-to-end test, and every regression check pass. The one defect is in raw_dylib.ts. A
template string interpolates a `BaseNString` object, so the stub's file name comes out as `lib[object Object].so`. It cannot
show yet, because `create_elf_raw_dylib_stub` stops on the vendored ELF writer before the name is built. Still, it is a wrong
value in ported code, and it would surface the day the writer lands.

## Findings

### F1. raw_dylib.ts builds the stub's file name from an object, not a string

- Where: `src/rustc_codegen_ssa/back/link/raw_dylib.ts:183`. Upstream: `raw_dylib.rs:179-184`, `format!("{}{}{}", dll_prefix,
  library_filename.as_u128().to_base_fixed_len(CASE_INSENSITIVE), dll_suffix)`.
- `to_base_fixed_len` returns a `BaseNString` (rustc_data_structures/base_n.ts:6). That class has `as_str()` and `fmt()` but no
  `toString()`, so the template literal prints `[object Object]`. I checked this directly: `` `lib${to_base_fixed_len(12345n,
  CASE_INSENSITIVE, ToBaseN_u128)}.so` `` evaluates to `lib[object Object].so`. Its `.as_str()` gives `00000000000000000000009ix`.
- Effect once reached:
  - every raw-dylib stub gets the same name, so the second one fails `create_new` (`"wx"`) with `ErrorCreatingImportLibrary`;
  - the `-l` verbatim name in the link line, and so in `--print link-args`, is wrong.
- Not reachable today. `create_elf_raw_dylib_stub` runs first (raw_dylib.rs:169) and stops on `object::write::elf::Writer`.
  No test reaches this line.
- Fix: `.as_str()` (mono.ts:621 does the same with this type). Add a small unit test of the name. It could stub the stub
  builder, or call the name computation with a known hash.

### N1. Five orderings in `linker_with_args` are not pinned by any test (the lane's four survivors, plus one more)

I read each of these lines against upstream, and each is faithful:
- `reset_per_library_state`: link.ts:3004, link.rs:3120;
- `add_late_link_args`: link.ts:3009, link.rs:3125;
- the consecutive-library dedup: link.ts:3262, link.rs:3410;
- metadata then allocator objects: link.ts:2917-2918, link.rs:2975/2984.

Each one's mutation survives, as the handoff says. My own mutation run found a fifth survivor: moving `add_pre_link_args`
(link.ts:2870, link.rs:2928) after `add_pre_link_objects` (link.ts:2875, link.rs:2933). Neither fixture target has
non-self-contained pre-link objects.

The 10 byte-identical lines therefore cannot vouch for these five positions. A wrong order in any of them would pass. Cheap
tests are possible. Three are new oracle cases for ssa-linker's `regen.ts`, which the oracle test picks up as they are:
- **Metadata and allocator order:** host-dylib without `-Cprefer-dynamic`. std is linked statically into the dylib, so the
  oracle line has both `rmeta.o` and the allocator object.
- **`reset_per_library_state`:** a `#![no_std]` x86_64-unknown-linux-gnu cdylib with a panic handler. It has no dynamic
  upstream native library, so the GNU hint state should end on `-Bstatic`, and the reset's `-Bdynamic` shows in the line.
- **Dedup:** two consecutive `#[link(name = "m")] extern "C" {}` blocks in a case's crate.

The other two need a synthetic test. Late link args and pre-link objects belong to no target whose std the oracle has. In
`link_with_args.oracle.test.ts`, set `late_link_args{,_static,_dynamic}` and `pre_link_objects` on a linux-bin session's
target, and expect the oracle line with those arguments where upstream's code puts them.

A related gap: the test supplies an allocator module only when the oracle line has one. So `needs_allocator_shim_for_linking`
is exercised only in the "pass it" direction. No case has a module that must be left out, for example
`--crate-type bin,dylib`.

### N2. `create_dll_import_lib` is called as the provided method, so the dummy backend's override is lost

- Where: raw_dylib.ts:114 calls `ArchiveBuilderBuilder_provided.create_dll_import_lib(..)`. Upstream: raw_dylib.rs:101 calls
  `archive_builder_builder.create_dll_import_lib(..)`, a trait method.
- `DummyArchiveBuilderBuilder` overrides it (rustc_interface/src/util.rs:499) to write an empty archive. Its `link_binary`
  reaches `link_rlib`, which calls `create_raw_dylib_dll_import_libs` on Windows targets (link.rs:685).
- So upstream succeeds where the port stops in ar_archive_writer. This is a stop, not a wrong output, and it is Windows-only.
- The comment at rustc_interface/util.ts:365 ("only `link_natively` reaches it") is wrong.
- The fix belongs to the owners of back/archive.ts and rustc_interface/util.ts: an optional `create_dll_import_lib` on the
  interface, used when present, and a port of the dummy's version. Record the request in the handoff.
- `xlane.create_dylib_metadata_wrapper` (link.ts) uses the same receiver-first pattern. No backend overrides that method, so
  it is correct today.
- raw_dylib.ts:4-5 says `create_dll_import_lib` is "reached through link.ts's `xlane` table". It is not: the `xlane` entry
  wraps `create_raw_dylib_dll_import_libs`. Correct the comment.

### N3. One `crate_name` lookup was missed by ssa-link-a's N3 fix

- Where: `eii_impl_crate_name`, link.ts:141. It has `if (name === undefined) return bug("CrateInfo::crate_name: no entry for
  the crate")`. Upstream (link.rs:77) is `crate_info.crate_name[&cnum]`, which panics with `no entry found for key`.
- Use `crate_info_crate_name` (link.ts:4199), as the lane did for the other sites. It is reachable only once an upstream
  invariant is already broken.

### N4. `add_lld_args` short-circuits the existence check

- Where: link.ts:3983 has `linker_path_exists ||= path_exists(linker_path)`. Upstream (link.rs:4097) has `|=`, which stats
  every path.
- No output can differ, but the form should follow upstream: `linker_path_exists = path_exists(linker_path) ||
  linker_path_exists`.

### N5. The `@`-file fallback of `exec_linker` has no test, though it is reachable

- I checked reachability: `ProcessCommand.output()` with 4 MB of arguments returns `Err(Os { errno: 7, code: "E2BIG" })`.
  `IoError_raw_os_error` gives 7, `LIBC_E2BIG` is 7, so `command_line_too_big` holds and the fallback runs.
- No test runs it, or `Escape::fmt` (link.ts:2204, link.rs:2224).
- A test could reuse the fake `cc` from the end-to-end test. Use a command over the spawn limit, have `cc` read its `@`-file,
  and include an argument with a space and a backslash. That pins the POSIX escaping, the trailing newline per argument, and
  the `@<file>` argument.

### N6. Stale comments in apple.ts (another owner's file)

- apple.ts:68-69 says `add_data_and_relocation` is reached "only from the linker's `add_linked_symbol_object` (not ported)".
- apple.ts:104 says `get_sdk_root` is reached "only from `link_natively` (not ported)".
- Both callers are now ported. Add this to the handoff's requests for apple.ts's owner.

## 1. Fidelity

### link.rs

I read every function from `exec_linker` (:2105) to `warn_if_linked_with_gold` (:4153) side by side with upstream. A second
reader independently covered :3773-end, plus `add_linked_symbol_object`, `add_library_search_dirs`, `add_relro_args`,
`add_rpath_args`, `undecorate_c_symbol` and `add_c_staticlib_symbols`; I spot-checked their claims.

- **Markers.** Every marker names the `fn` line and sits directly above its function, including:
  - the cfg twins `flush_linked_file` (:2174, :2179) and `command_line_too_big` (:2203, :2208, :2214);
  - the nested `fmt` (:2224), `msvc_drectve_export` (:2617) and `elf_has_gold_version_note` (:4158).
  - `bun scripts/coverage.ts --check`: markers ok; link.rs 87/87, raw_dylib.rs 5/5.
- **`linker_with_args`** (link.ts:2811). Every call is in upstream's order:
  - export symbols;
  - pre-link args and pre-link objects;
  - `symbols.o`, then sanitizers;
  - regular, metadata, then allocator objects;
  - `add_as_needed`;
  - local natives, offload, upstream crates, then upstream natives;
  - the ELF `raw-dylibs` dir;
  - local raw-dylibs, then upstream non-static raw-dylibs (FxIndexMap order, then the name sort);
  - reset, then late args;
  - order-independent options, user args, link script, post-link objects, then post-link args;
  - LLD threads.

  The lookups are right too:
  - `exported_symbols[&crate_type]` panics as an `UnordMap` index, and `linked_symbols[&crate_type]` as an `FxIndexMap` index.
  - `dependency_formats.get(..).expect(..)` keeps upstream's message.
  - The Cdylib `seen` set's key is injective.
- **`add_order_independent_options`** (:3202). The call order and every condition match: Fuchsia, eh-frame, no-exec, CRT,
  Emscripten, Llbc/Bpf, plugin LTO, search dirs, output, subsystem, gc-sections with `keep_metadata` (Dylib or PGO),
  output kind, relro, optimize, natvis, debuginfo, default libs, PGO, mcount, CFG, ehcont, then rpath.
- **`add_native_libs_from_crate`, `add_local_native_libraries`, `add_upstream_rust_crates`, `add_upstream_native_libraries`,
  `add_static_crate`, `add_dynamic_crate`**:
  - the arms and the `link_static`/`link_dynamic` flags match;
  - `link_static_crate` keeps its `compiler_builtins`/`profiler_runtime` clause;
  - the bundled-libs FxIndexSet is an insertion-ordered `Set`;
  - the rlib member filter is the same three tests in the same order;
  - `link_upstream` goes through `rehome_lib_path`, and `as_needed` is `true` for dylibs.
  - Linker flavors are interned (rustc_target spec/mod.ts:186), so `Map<LinkerFlavor, ..>` lookups and `flavor ===
    LinkerFlavor.Llbc` are sound.
- **`exec_linker`**:
  - `spawn` + `wait_with_output` is `output()`, as the PORT note says;
  - the Escape rules and the MSVC BOM + UTF-16LE encoding are right;
  - the `CFG_WINDOWS && uses_lld && !uses_cc` clause is there;
  - the flush runs after both spawns;
  - the host-cfg variants are picked by `process.platform`, as `escape_linker_output` does.
- **`link_output_kind`, `self_contained_components`, `detect_self_contained_mingw`, pre/post objects and args,
  `add_link_script`, `add_late_link_args`**: the arm order and the guards match.
  - `Target_eq` stops by name. Only the windows-gnu `InferredForMingw` arm reaches it.
  - `Session_is_wasi_reactor` is a faithful copy of session.rs:799.
- **`relevant_lib`** is faithful. `as Parameters<..>` is a redundant cast, since `NativeLib.cfg` is already `CfgEntry |
  undefined`. Harmless.
- **`add_apple_link_args`, `add_apple_sdk`, `get_apple_sdk_root`, `add_lld_args`, `warn_if_linked_with_gold`**: faithful. The
  arch table, platform arms and `fmt_full` all match. So do the nine `SDKROOT` guards, the `-B<dir>/gcc-ld`, `-fuse-ld=lld`
  and `--target=` rules, and the gold-note stop. The only exception is N4.
- **The jobserver stand-in** is minimal: an interface with `drop()`. The port's real `rustc_data_structures/jobserver.ts`
  `client()` is the one called (link.ts:3049), and it stops by name, so no token is ever invented. `link_natively` drops the
  tokens (link.ts:1430).
- **The new `xlane` forwarders**:
  - `Object_add_symbol` stops by name.
  - `apple_add_data_and_relocation`, `apple_get_sdk_root` and `apple_sdk_name` forward to apple.ts. The first two stop
    there by name.
  - `create_dylib_metadata_wrapper` forwards to `ArchiveBuilderBuilder_provided`, and reaches metadata.ts's stop.
  - `Object_set_subsections_via_symbols` sets the one field the method sets, with a PORT note.
- **The PORT note on `sort_unstable_by`** holds:
  - upstream's `native_libraries` is an `FxIndexMap` (lib.rs:288), so the input order is the port's insertion order;
  - ipnsort is insertion sort up to 20 elements, which is stable;
  - past 20, the only order the output can observe (ties between raw-dylib libraries of one name) stops by name.

### raw_dylib.rs

All five functions are in order, and their markers are right. The seven local `elf::` constants match object 0.39.1's elf.rs
in value and in the cited line.

The collations match upstream:
- the `.dll` suffix by `verbatim`;
- the insert-keeps-position rule and `MultipleExternalFuncDecl`, emitted before `abort_if_errors`;
- the ELF `as_needed` fold.

`create_raw_dylib_dll_import_libs` matches: the `_imports` / `_imports_indirect` names, the X86 decoration and the item fields.

`create_elf_raw_dylib_stub` matches in its order of string adds, reservations and writes, its 30 `e_machine` arms, its header
and section fields, the versym arithmetic and the `.dynamic` entries. The writer itself stops by name, which is correct.

There are two defects: F1, and N2's dispatch. One small difference does not count as a finding: `BufWriter::write_all` hides a
failure of the drop-time flush, while the port's `writeSync` reports every failure as fatal. That shows only on an I/O error.

## 2. Evidence

**The oracle test passes.** I ran `RUST_TS_REQUIRE_PROBES=1 bun test link_with_args.oracle.test.ts` and got 2 pass, 0 fail.
Test 1 covers 10 byte-identical lines plus the staticlib no-line case. Test 2 is the fake-`cc` `link_natively` end to end: the
printed file and the argv the linker got both equal the oracle's, for host-bin and linux-bin.

**What the test supplies.** It gives the port five inputs, and each is something the port cannot produce yet:
- **Object paths.** Codegen names them.
- **The default sysroot.** Lane default-sysroot fixes this.
- **`add_symbol` and `add_data_and_relocation`.** They are recorded, and the recorded names are checked against the port's
  own `linked_symbols`.
- **`SDKROOT` for `get_sdk_root`.** `xcrun` is not ported.
- **The dylib wrapper bytes.** Only the path is in the line.

Everything else in the line is the port's own: `CrateInfo::new`, the session and target, `get_linker`, `link_output_kind`,
`self_contained_components` and the whole of `linker_with_args`. `{} as EncodedMetadata` is never read, because the wrapper
is replaced. The allocator caveat is in N1.

**What 10 identical lines can hide.** Yes, they can hide a wrong order in a section the fixtures don't exercise; see N1. Each
of the four surviving mutations the lane names is real:
- no fixture target has late link args;
- every case ends on a dynamic library;
- no crate repeats a library;
- no case has both metadata and allocator objects.

I found a fifth, the pre-link args/objects order. Each has a cheap test, listed in N1.

## 3. ssa-link-a's N1-N3

- **N1:** the reach claims in `docs/handoff/ssa-link-a.md` are corrected.
- **N2:** the new `link_staticlib` test in link.test.ts catches all three earlier survivors. I re-ran each mutation:
  - `"StaticlibBase"` → `"Normal"` at link.ts:805: 1 fail.
  - The `rmeta_link::FILENAME` skip dropped at link.ts:832: 1 fail.
  - The `print_native_static_libs` call dropped at link.ts:940: 1 fail.
- **N3:** these lookups now panic as upstream's indexes do:
  - `crate_info_crate_name` / `crate_info_used_crate_source`, link.ts:4192-4203: "no entry found for key", as `UnordMap`
    (std `HashMap` index);
  - `crate_info_native_libraries`, link.ts:946, and `index_map_get` on `FxIndexMap`: "IndexMap: key not found";
  - `vec_index` on `IndexVec` / slice: core's "index out of bounds: the len is .. but the index is ..".

  `link_staticlib` and `each_linked_rlib` use them. One site was missed, `eii_impl_crate_name` (N3 above).

## 4. Reach

I made a scratch worktree at `330371b2` and merged `e3e5797d` (`t3/port-default-sysroot`) with `--no-commit`. The merge was
clean. Then I ran:

`bun src/rust_ts/main.ts hello.rs --edition 2024 --crate-type bin --emit=link -o out/hello --sysroot <oracle sysroot>`

on aarch64-apple-darwin, with `fn main() { println!("hello from rust-ts"); }`.

- Codegen writes both objects: `hello.<hash>.rcgu.o` (the allocator module) and `hello.hello.<hash>-cgu.0.rcgu.o`.
- Then it exits 70 with `unported: object::write::Object::add_symbol (vendor object: symbols are not ported;
  add_linked_symbol_object)`.
- **There is no earlier stop.** This is the stop the lane reports.

I aborted the scratch merge and removed the worktree. Nothing from it was committed.

## 5. Regressions

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok. `--missing` gives link.rs 87/87 and raw_dylib.rs 5/5.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_ssa/ ./scripts/lib/unit-steps.test.ts`: 201 pass, 0 fail, across 29
  files. The lane's 204 also counted `./src/std/result.test.ts`.
- `--sample 200 --jobs 6`, with `RUST_TS_AGENT=rev-ssa-link-b-r7`:
  - check-ui: 200/200 MATCH (run 20261114-134848-rev-ssa-link-b-r7-50y4).
  - rmeta-ui: 200/200 MATCH (run 20261114-134957-rev-ssa-link-b-r7-8evw).
- Environment reads: the new tests read only `RUST_TS_REQUIRE_PROBES` and `RUST_TS_AGENT`. unit-steps.test.ts's env-read scan
  passes. The port's own reads are upstream's: `PATH` in `detect_self_contained_mingw`, and `SDKROOT` in
  `get_apple_sdk_root`.
- No added line under `src/` writes to `process.stdout` or `process.stderr`.

## 6. Mutations

Each mutation was applied to link.ts, tested, and reverted with `git checkout`. The tree was clean afterwards.

| mutation | where | result |
|---|---|---|
| swap `add_upstream_rust_crates` and `add_upstream_native_libraries` | link.ts:2942/2945 (link.rs:3016/3028) | 2 fail (both tests) |
| `add_as_needed` before the local objects | link.ts:2928 (link.rs:2994) | 2 fail |
| drop the `compiler_builtins` clause of `link_static_crate` | link.ts:3403 (link.rs:3541) | 1 fail (test 1: the dylib cases) |
| `add_dynamic_crate` with `as_needed = false` | link.ts:3629 (link.rs:3770) | 1 fail |
| `add_pre_link_args` after `add_pre_link_objects` | link.ts:2870/2875 (link.rs:2928/2933) | **survives** (N1) |

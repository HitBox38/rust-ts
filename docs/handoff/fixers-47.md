# Handoff: lane fixers-47 (queued port findings)

Branch `t3/916330c7`, on `main` at `5c884ab9`. Six commits, one per item (item 3 has two), then this file.
Host: root host, AC power, load 5 to 36 (three other lanes). `RUST_TS_AGENT=fixers-47`, `RUST_TS_REQUIRE_PROBES=1`,
`RUSTUP_AUTO_INSTALL=0`, `RUSTC_ICE=0`. No gate, no full suite, no full unit step.

All five items reproduced against the oracle first, and all five are fixed. Each fix has a test that fails on the old
code (checked in a scratch worktree at the previous commit).

| Item | Source | Commit | Pinned by |
|---|---|---|---|
| 1 | fixers-45 review F1, F2 | `caa388b7` | `src/std/env.test.ts` (new test) |
| 2 | fixers-45 review F5 | `f0285c98` | `src/rustc_metadata/locator.oracle.test.ts` (new case) |
| 3a | fixers-46 review F4, `static` | `3cfc1018` | `aarch64_oracle/big_err.rs` + its fixture |
| 3b | fixers-46 review F4, gvn | `93c190b4` | `aarch64_oracle/big.rs` (fixture unchanged: the oracle output is the same) |
| 4 | root-w42-check N5 (`docs/next.md:512`) | `edb8e464` | `src/rust_ts/codegen_backend.oracle.test.ts` (2 new tests) |
| 5 | object-write-macho review N1, N2 | `ae8651da` | `rlib_macho.test.ts` (renamed, fixture rebuilt) |

## 1. `host_canonicalize` by bytes (F1, F2)

**Reproduced.** In a cwd of 1,015 bytes with `link` → a short directory, the old `host_canonicalize("link/liblib-a.rmeta")`
gave `Os { errno: 63, ENAMETOOLONG }`. A Rust program built with the oracle toolchain (`std::fs::canonicalize`) resolves it.

**Fix.** `src/std/env.ts` gets `libc_canonicalize`, a port of std's unix `canonicalize`
(`library/std/src/sys/fs/unix.rs:2053`). It calls `realpath(path, NULL)` on the path's bytes through the existing libc
handle (`realpath` and `free` were added to `open_env_libc`), copies the C string and frees it. An interior NUL gives
std's `InvalidInput` (as `run_path_with_cstr` does). `src/std/path.ts` `host_canonicalize` calls it, then decodes the
result lossily (its `PathBuf` is a `string`). The cwd is never joined or decoded, so F2's U+FFFD twin cannot happen
either. Windows (no libc read) keeps the old `realpathSync.native` path, comment included.

**Against `std::fs::canonicalize`** (oracle toolchain, same layout, cwd of 1,015 bytes): `link/liblib-a.rmeta`,
`link/nope`, `""`, `./link/../link/liblib-a.rmeta` (NotFound: `link/..` is the parent of the target) and `link` all give
the same answers.

**Startup cost: none detectable.** std hello `--emit=metadata`, same checkout, the two files toggled, alternating,
7 runs each: old 10.183 G instructions (10.026-10.328), new 10.179 G (10.028-10.216).

## 2. E0464 with a symlinked `-L` (F5)

**Cause.** Upstream `FileSearch::new` (`filesearch.rs:66`) sorts every `lib*` file of all search paths, the sysroot's
included, by file name alone, with `sort_unstable_by`. With more than 20 files that is ipnsort, so one name found in
two search paths (a directory given twice) ends up in ipnsort's order, not insertion order. The locator then keeps the
first path of each canonical file (`find_library_crate`'s `seen_paths`). The port sorted with `Array.prototype.sort`
(stable), so it kept the other path. Canonicalization and dedup were already faithful. Bun's `readdirSync` keeps
`readdir(3)`'s order (checked against `ls -f` on the sysroot's 318-entry lib dir), as Rust's `read_dir` does.

**Fix.** `filesearch.ts` sorts with `src/std/slice_sort.ts`'s `slice_sort_unstable_by` (the existing line-by-line ipnsort
port). The layout is `FileSearchCandidate`'s: `Arc<Path>` and `Box<str>` (16 bytes each), `PathKind`, `bool`: 40 bytes,
`Freeze`, not `Copy`. That is a `PORT:` comment at the call.

**Against the oracle**, with `dup/liblib-{a,b,c,d,e}.rmeta`, `dup/liblib-r.rlib`, two symlinks to `dup` and a second
directory: `-L link -L <abs dup>`, the reverse, `-L link -L link2 -L dup`, `-L dup -L other -L link`,
`-L dependency=link -L crate=dup` and `-L link -L ./dup -L <abs link2>` all give the same output (6/6). The old code
differed on the ones I checked.

**Test.** One case in `locator.oracle.test.ts`. Its setup builds two `foo` rmetas with the oracle in `d_dup/`, adds 17
filler `lib*` names and a symlink `d_dup_link`. With 17 fillers (on APFS, whose `readdir` order these names fix), ipnsort
orders both pairs unlike a stable sort. With 12 it did not, which I found with a small simulation over 4 to 40 fillers
(16 to 18 work). On another file system the case still compares live with the oracle; it may just stop discriminating.

**Cost.** Hello `--emit=metadata`: 10.191 G vs 10.202 G (7 runs each, ranges overlap).

## 3. Two stops at 2^53

### 3a. A `static` of 2^53 bytes or more (`3cfc1018`)

**Reproduced:** `pub static S: [u8; 9007199254740993] = [0; ..];` gives oracle E0080 ("tried to allocate more memory than
available to compiler"); the port stopped `unported` (`Size beyond 2^53`). There were two sites:
- `AllocBytes_Box.zeroed` (`allocation.ts:110`): a size of 2^53 or more now returns `undefined`, as allocation failure.
  This is a `PORT (fixers-47):` decision, as the fixers-46 review proposed: no 64-bit host's address space reaches 2^53
  bytes, so upstream fails there on any host.
- `create_static_alloc` (`interpret/util.ts:150`): its `assert_eq!(size, layout.size)` compared `bytes()`. It now uses `Size_eq`.

Same as the oracle: 2^53 + 1, 2^53, 2^53 - 1 (the JS engine refuses that typed array: `RangeError`, already
handled), `[u16; 2^52]`, `static mut` with `[1; ..]`, a `const` of that size used in a fn, a tuple `([u8; 2^53 + 1], u8)`,
and `[[u8; 2^53 + 1]; 0]` (exit 0). Not comparable: a 1 TiB static. The oracle was killed (exit 137, host memory) where
the port reports E0080. That is host-dependent, as upstream documents (`Allocation::new_inner`); I did not run more of
those.

**Pinned:** `big_err.rs` gets `pub static mut STATIC: [u8; 2^53 + 1]` (with `impl Copy for u8 {}`). I regenerated the
fixture with `regen.ts`: only `big_err`'s file changed, and it now has the E0080. Reverting `zeroed` makes
`aarch64.oracle.test.ts` fail.

### 3b. `ConstantIndex` / `Subslice` as `bigint` (`93c190b4`)

**Reproduced:** `x[9007199254740992]` at `-O` on `[u8; 2^53 + 1]`, **by value or through `&`**, stopped at
`gvn::simplify_place_projection`. While checking I found a sibling: an array pattern (`let [a, .., b] = x;`, also
`rest @ ..`) over such an array ICEd at any opt level (`prefix_slice_suffix`: `target usize exceeds 2^53`). Also,
`dataflow_const_prop` built `ConstantIndex { offset: Number(offset) }`, which rounds.

**Fix: the upstream type.** `ProjectionElem::ConstantIndex { offset, min_length }` and `Subslice { from, to }` are `u64`
upstream, and are now `bigint`:
- `tools/codegen/mir.typemap.json` lists the four fields as `::rust_ts::u64_exact` (the per-field mechanism fixers-46
  used). Regenerating `rustc_middle_mir` changes only those fields in `syntax.gen.ts`. The other sets that load
  `mir.typemap.json` regenerate unchanged.
- `tools/codegen/serialize.json` gets entries for `rust_ts::u64_exact` / `i64_exact` (`decode_u64($D)` /
  `encode_u64($v, $E)`, no `Number`/`BigInt` conversions).
- `tools/codegen/type_fold.json` lists both as trivial.

  Without these entries the generator emitted `unported_encodable`/`unported_type_fold` for the fields. **These three are
  root-owned files (`tools/`): please accept them explicitly**, as with fixers-46's. `bun test tools/codegen`: 60 pass.
- Consumers converted (tsc found every site):
  - places_conflict (`max` on bigints), the pretty printer (`0n`), `PlaceTy::projection_ty`;
  - `prefix_slice_suffix` and its caller (no `u64_to_number`);
  - move paths (`MoveSubPath::ConstantIndex`, `MoveSubPathResult::Subslice`, `len`);
  - borrowck `check_if_subslice_element_is_moved`, check_enums (`bytes_u64()`), dataflow_const_prop (no `Number()`),
    known_panics_lint, and gvn (the unported is gone).
- `Ty::new_array` and `Const::from_target_usize` take `number | bigint` (upstream `n: u64`), with `PORT:` comments.
- Kept as `number`, converted at the `ProjectionElem` boundary with `PORT:` comments:
  - `ProjectedUserTypesOp::Subslice` (pattern lengths);
  - `open_drop_for_array`'s indices: it walks every index up to `size`, as upstream does;
  - `array_subpath`'s `index`.
- gvn's `project` (`ConstantIndex` on an `Aggregate`) indexes `operands` with `Number(offset)`: a `PORT:` comment says
  why that is exact in effect.
- Tests: the literals in 5 test files become `n` literals.

**Against the oracle**, each at `--emit=metadata`, `-O --emit=metadata`, `-Zunpretty=mir` and `-O -Zunpretty=mir`, all
SAME:
- `let [a, .., b] = x` by value;
- `let [_, rest @ .., _] = x` through `&`;
- `x[2^53]` through `&`, as a literal and through a local;
- `x[2^53 + 1]` (the out-of-bounds lint and error);
- `&mut [String; ..]` with `[a, rest @ .., b]`.

Not compared: moving `String`s out of a `[String; 2^53 + 1]` by value at `-O`. `open_drop_for_array` loops over every
element, upstream too, so I stopped it after 120 s. The port also still ICEs there at `u64_to_number(.., "open_drop_for_array")`
(pre-existing, left: upstream does not finish either).

**Pinned:** `big.rs` gets `index` (the gvn case, with the `index` and `legacy_receiver` lang items typeck needs before it
uses built-in array indexing) and `pattern` (the array pattern). The oracle's output is unchanged (the existing warning,
exit 0), so the fixture file is too. At the previous commit the port ICEs on it.

## 4. `MACOSX_DEPLOYMENT_TARGET` at `--emit=metadata` (N5)

**Where upstream reads it:** rustc_codegen_llvm `llvm_util::target_config` (`llvm_util.rs:325`) builds the LLVM triple with
`versioned_llvm_target(sess)`, after `global_llvm_features` and before `target_cpu`. On an Apple target that calls
`sess.apple_deployment_target()`, which emits the parse error or the too-low warning. `target_config` runs in every
session, so `--emit=metadata`, `--print cfg`, `-Zunpretty=..` and the rest all report it.

**Fix.** New `src/rustc_codegen_ssa/back/mod.ts` with `versioned_llvm_target` (`back/mod.rs:25`; coverage 1/1). The LLVM
stand-in (`src/rust_ts/codegen_backend.ts` `target_config`) calls it at upstream's place and drops the triple: LLVM's
answer is the oracle table, keyed by the tuple. That is a `PORT:` comment: the table was read with no deployment-target
variable set, and the OS version in the triple does not change the features LLVM reports. The Miri backend reaches it
through `native.target_config`, as upstream.

**Against the oracle:**
- `--crate-type lib --emit=metadata` on the host: `abc`, `99999`, `""`, `1.x` (exit 1) and `10.5` (warning), plus
  `10.12`, `11.0`, `14.2.1`, `+11` and unset: 10/10 SAME.
- `abc` and `10.5` each with `--print deployment-target` (once on its own, once with `--emit=metadata`), `--print cfg`,
  `-Zunpretty=mir`, `-Zunpretty=hir`, a crate with a type error, `--target x86_64-apple-darwin`,
  `--target x86_64-unknown-linux-gnu` (not read: exit 0), `-Zcodegen-backend=dummy --emit=link` and
  `-Zparse-crate-root-only`: 20/20 SAME.

**Tests:** `codegen_backend.oracle.test.ts` runs `--print cfg --target aarch64-apple-darwin` with `abc` and with `10.5`,
live against the oracle (every other `*_DEPLOYMENT_TARGET` is removed from the env).

## 5. object-write-macho review N1, N2

- **N1.** `rlib_macho.oracle.test.ts` is now `rlib_macho.test.ts`: it reads captured fixtures and never runs the oracle.
  I rebuilt the host rlib fixture so its rmeta embeds `/x/nc.rs` and no scratch path or user name:
  `--remap-path-prefix="$PWD=/x"`, with the full command in the file's header. Its size went from 2,576 to 2,328
  bytes. The four `lib.rmeta-link` fixtures embed no path and are unchanged. 7 pass.
- **N2.** `macho_write` sizes relocations by upstream's `1 + (addend != 0) + subtractor.is_some()`. `write/mod.ts` gets a
  `RelocationInternal` interface holding the two fields it reads (`PORT:`: `add_relocation` is not ported, so none is
  made), and `Section.relocations` is typed with it instead of `never[]`.

## Samples

Agent seed `fixers-47` (it differs from root's and the reviewers'):

| Suite | Run | Result |
|---|---|---|
| check-ui `--sample 150` | `20261108-030220-fixers-47-0bwq` | 150/150 |
| mir `--sample 150` | `-030242-fixers-47-ptls` | 150/150 |
| mir-o2 `--sample 150` | `-030320-fixers-47-bm9h` | 149/150: `simd/shuffle.rs#opt` DIFF (an ICE's backtrace line; not protected) |
| mono-ui `--sample 150` | `-030422-fixers-47-8ve0` | 149/150: `rustc-env/def-path-hash-ice-157238.rs` DIFF (the logger warning, fixers-45 review section 7; not protected) |
| rmeta-ui `--sample 150` | `-030457-fixers-47-mvrx` | 150/150 |
| mirdump-ui `--filter slice` | `-030555-fixers-47-znvw` | 26/26 |
| borrowck-ui `--filter slice` | `-030601-fixers-47-s1gv` | 13/13 |
| mir `--filter slice` | `-030605-fixers-47-996t` | 217/217 |
| mir-o2 `--filter slice` | `-030642-fixers-47-zdlj` | 92/92 |
| run-pass-miri `--filter slice` | `-030703-fixers-47-eyom` | 92/92 |
| run-pass-miri `--sample 100` | `-030819-fixers-47-omy5` | 100/100 |
| mir-opt-o4 `--filter slice` | `-030907-fixers-47-y6hn` | 12/12 |
| check-std (once) | `-030911-fixers-47-xu4b` | 1/1 |

Unit tests run: the touched test files (`bck_lib_b`, `debug.oracle`, `visit`, `move_paths`, `matches_c`,
`aarch64.oracle`, `env`, `rlib_macho`, the new `codegen_backend.oracle` and `locator.oracle` cases), all pass, and
`tools/codegen` (60 pass). I did not run the full unit step. `bunx tsc --noEmit -p .` is clean, and
`bun scripts/coverage.ts --check` gives `markers ok (24883; vendor 5286; library 607)`.

**Unit budget.** Measured at load 10:
- the two `codegen_backend` cases about 0.45 s each;
- the `locator` case with its setup 0.7 s for the filtered file;
- the `env` test about 0.1 s;
- the `big.rs`/`big_err.rs` additions no measurable change (`aarch64.oracle.test.ts` 4.2-4.5 s at load 35, before and after).

That is about 1.7 s in all. I dropped a second `locator` case (the other `-L` order) for the budget.

## Coverage

| File | Coverage |
|---|---|
| `compiler/rustc_codegen_ssa/src/back/mod.rs` | 1/1 (new) |
| `rustc_mir_transform/src/gvn.rs` | 62/62 |
| `rustc_mir_build/src/builder/matches/match_pair.rs` | 5/5 |
| `rustc_middle/src/mir/interpret/allocation.rs` | 51/51 |
| `rustc_const_eval/src/interpret/util.rs` | 7/7 |
| `rustc_mir_dataflow/src/move_paths/builder.rs` | 15/15 |
| `rustc_borrowck/src/places_conflict.rs` | 4/4 |
| `rustc_session/src/filesearch.rs` | 7/14, unchanged by this lane |

## `unported(...)` left or removed

- **Removed:** `rustc_mir_transform::gvn::simplify_place_projection (ConstantIndex offset beyond 2^53)`.
- **Added:** none.
- **Left, pre-existing:** `open_drop_for_array`'s `u64_to_number` ICE on an array of 2^53 elements or more with drop glue
  (upstream walks every element, so it does not finish either).

## `PORT:` decisions

- `allocation.ts` `zeroed`: size 2^53 or more is an allocation failure (item 3a).
- `filesearch.ts`: `sort_unstable_by` through ipnsort with `FileSearchCandidate`'s layout (item 2).
- `codegen_backend.ts` `target_config`: `versioned_llvm_target` called, its triple dropped (item 4).
- `back/mod.ts`: no `mod`/`pub use` re-exports.
- `env.ts` `libc_canonicalize` / `path.ts` `host_canonicalize`: realpath on bytes, with Windows' stand-in kept (item 1).
- `sty.ts`/`consts.ts`: `n: number | bigint`.
- `user_ty.ts`, `elaborate_drop(s).ts`: iteration counts stay `number` and convert at `ProjectionElem`.
- gvn `project`: `Number(offset)` as an index.
- `write/mod.ts`: `RelocationInternal` reduced to two fields (item 5).

## For root

- Accept the `tools/codegen/` changes (`mir.typemap.json`, `serialize.json`, `type_fold.json`) explicitly.
  Regenerating `rustc_middle_mir` from them reproduces `syntax.gen.ts`, and every other set that loads `mir.typemap.json`
  regenerates unchanged (`git status` was clean after running all ten).
- Close `docs/next.md:512`'s `MACOSX_DEPLOYMENT_TARGET` and object-write-macho N1/N2 clauses and the line-540 lane row.
- `docs/next.md` mentions `rlib_macho.oracle.test.ts` by name; it is now `rlib_macho.test.ts`.

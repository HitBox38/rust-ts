APPROVE WITH NITS: every change matches upstream and reaches no protected output: rmeta-core is 82,338/82,338, every sample and slice/array/pattern filter matches, and the `tools/codegen/` inputs regenerate every committed `.gen.ts`. The nits: one sibling 2^53 ICE in typeck that the lane's cases miss (on `main` too), an rlib fixture header that does not give the exact source, and three observations.

# Independent review: fixers-47

Branch `t3/916330c7`, head `760e57f7`, on `main` `5c884ab9`. Commits `ae8651da`, `3cfc1018`, `93c190b4`, `edb8e464`, `caa388b7`, `f0285c98` and the
handoff. All runs used `RUST_TS_REQUIRE_PROBES=1`, `RUST_TS_AGENT=review-fixers-47` and `RUSTUP_AUTO_INSTALL=0`. They ran in detached worktrees of
`760e57f7` and `5c884ab9` under my scratchpad, at paths of equal length (`…/scratchpad/wh`, `…/scratchpad/wm`), plus a third for mutants (`wx`).
All three have since been removed. The machine was on AC power, at a load of 10 to 24 from other lanes. No gate, and no full suite but rmeta-core, which ran once,
alone. This file is the only one I wrote in the repo.

| # | Severity | Where | Finding | Evidence |
|---|---|---|---|---|
| F1 | low, for root's queue (on `main` too, not a regression) | `src/rustc_hir_typeck/pat.ts:2847`, also `:2841`, `:2851` (`check_array_pat_len`, pat.rs:3152) | Another 2^53 stop of fixers-46 F4's kind, in typeck. A rest binding of 2^53 elements or more ICEs at `u64_to_number(pat_len, "Ty::new_array")`: `pub fn g(x: &[u8; 9007199254740995]) -> usize { let [_, r @ .., _] = x; r.len() }` builds with the oracle (exit 0) and ICEs in the port (exit 101). `let [a, b] = x` on `[u8; 2^53 + 1]` gives E0527 in the oracle and ICEs at `:2841`. The lane's cases use `[u8; 2^53 + 1]`, whose rest is 2^53 - 1, so they never get here. Now that `Ty::new_array` takes `number \| bigint`, `:2847` only has to drop the conversion. `:2841` and `:2851` need the diagnostic's `u64` arguments as `bigint` | reproduced on head and `main` |
| F2 | nit | `src/rustc_codegen_ssa/back/rlib_macho.test.ts:8-12` | The header describes `nc.rs` in words, not as text. The rmeta embeds the file's length, hash and spans, so the layout matters. The fixture is the oracle's output, byte for byte, but only for one layout, with a blank line after `#![no_core]` and before `pub fn f() {}`, and none between the three lang items. Two other plausible layouts gave 272 and 432 differing bytes. Failing scenario: whoever regenerates it from the header gets a different fixture. Fix: put the exact source in the header | reproduced (third try identical) |
| O1 | observation (on `main` too) | `src/rustc_middle/mir/interpret/allocation.ts:110-116` | The 2^53 boundary is right, but below it the port and the oracle part ways where the host could allocate: `pub static S: [u8; 68719476736]` (64 GiB) builds with the oracle (exit 0, calloc is lazy) and gives E0080 in the port (the typed array's `RangeError`). This is host-dependent, as upstream documents, and predates the lane | reproduced on head and `main` |
| O2 | observation, Linux only | `src/std/path.ts:779-781` | `host_canonicalize` takes a `string` and decodes the result lossily, so a resolved path that is not UTF-8 comes back with U+FFFD. Every `PathBuf` that is a `string` has this limit; APFS refuses such names, so it cannot happen on the root host | read only |
| O3 | observation | `src/rustc_metadata/locator.oracle.test.ts:74-87` | The new E0464 case tells ipnsort from a stable sort only under APFS's `readdir` order for these names, as its comment says. On another file system it still compares live with the oracle, but may stop discriminating | read; the mutant below fails it on APFS |

## 1. `ProjectionElem`'s `ConstantIndex` and `Subslice` as `bigint`

**Encoding, printing, hashing.** Upstream's fields are `u64` (`syntax.rs`). The generated `encode_ProjectionElem` now calls `encode_u64(self.offset)` where it
called `encode_u64(BigInt(self.offset))`, which writes the same LEB128. `decode` drops a `Number(..)` that rounded values of 2^53 and up. The generated `debug_` uses
`debug_int`, which prints a `bigint` in decimal, as it printed the number. `ProjectionElem` has no generated `HashStable` or `key_`, and no `cmp`. `List<PlaceElem>`
interns through `value_hash`/`value_eq`/`key_of` (`src/rust_ts/intern_key.ts`), which handle `bigint`. I found no site that still builds these fields as
`number`, which would intern apart from the `bigint` form (`key_of` spells `3` and `3n` differently). Every constructor (`match_pair.ts:57,65,78`, `builder.ts:283`,
`dataflow_const_prop.ts:647,885`, `elaborate_drop.ts:1302,1305`, `gvn.ts:1107,1112,1163`, `check_enums.ts:330`, `user_ty.ts:143`, `statement.ts:658,660`) passes a
`bigint`, and tsc checks each one.

**Mixed `bigint`/`number`.** tsc rejects arithmetic, `===`, indexing and `Math.max` across the two types, and `bunx tsc --noEmit -p .` is clean at head. What tsc lets
through is relational comparison, which is exact in JS (`validate.ts:908,912,932`, `known_panics_lint.ts:159`, `dataflow_const_prop.ts`), and template strings,
which print the same. The `number` sites kept on purpose convert at the boundary with `BigInt(..)`: `elaborate_drop.ts:1302-1305`,
`elaborate_drops.ts:302` (`e.offset === BigInt(index)`) and `user_ty.ts:143`. `MoveSubPath_key` builds its string with `${sub._0}`, so its keys do not change.
`builder.ts`'s `for (let offset = from; offset < to; offset++)` increments a `bigint`, which is valid. gvn's `project` (`gvn.ts:1102`) indexes with `Number(offset)`: upstream's
`operands.len() - offset as usize` wraps to a huge index and `get` gives `None`, and here a negative index reads `undefined`. Same result.

**Against upstream.** `prefix_slice_suffix` (match_pair.rs:18) matches line by line, with `u64` arithmetic throughout. `places_conflict.ts:390`'s `max` and
`statement.ts:535`'s `size - from - to` are exact. `known_panics_lint.ts:159` keeps upstream's `u64::try_into::<u32>()`.

**Codegen inputs (root to accept).** The entries are the existing per-field `fields` mechanism of fixers-46 (`mir.typemap.json`), plus the serializer and
trivial-fold entries for its `rust_ts::u64_exact`/`i64_exact` path (`serialize.json`, `type_fold.json`), which no other path reaches. I regenerated **all 63
sets** of `types.sets.json` with `bun tools/codegen/types.ts <set>`, on head and on `main`. Both trees came out unchanged, apart from an untracked
`src/rustc_lexer/lib.gen.ts`, the same byte for byte on both, which predates this lane. So the committed `syntax.gen.ts` is exactly the generator's output for
the committed inputs. `bun test tools/codegen`: 60 pass.

**Suites (head).**

| Suite | Result | Run id |
|---|---|---|
| rmeta-core (full, alone) | 82,338/82,338 (112 s, 9.8 GB) | `rv47-rmeta-core` |
| mir-core `--sample 300` | 300/300 | `rv47-mir-core-s` |
| mir-core `--filter slice` | 1,223/1,223 | `rv47-mir-core-slice` |
| mir-core `--filter array` | 503/503 | `rv47-mir-core-array` |
| mir `--sample 200` / `--filter array` / `--filter pattern` | 200/200, 296/296, 733/733 | `rv47-mir-__*` |
| mir-o2 `--sample 200` / `--filter array` / `--filter pattern` | 200/200, 95/95, 154/154 | `rv47-mir-o2-__*` |
| mir-opt-o4 `--sample 150` / `--filter array` / `--filter pattern` | 149/150 (`dump_dataflow.rs` UNPORTED: graphviz, not protected), 14/14, 4/4 | `rv47-mir-opt-o4-__*` |
| rmeta-ui `--sample 150` / `--filter crate` | 150/150, 178/178 | `rv47-rmeta-ui-__*` |
| check-ui `--sample 200` / `--filter crate-loading` / `--filter extern` | 200/200, 1/1, 83/83 | `rv47-check-ui-__*` |
| pm-ui `--sample 150` | 149/150 (`expand-expr.rs` UNPORTED: cross-thread proc macro, not protected) | `rv47-pm-ui-__sample_150_` |

I wrote a slice-heavy library: 40 `#[inline]` fns, each with array and slice patterns, rest bindings and constant indices. Its `-Zunpretty=mir` (8,522 lines) and `-O -Zunpretty=mir` (7,422 lines, 635
`[i of n]`/subslice projections) are the same as the oracle's. In a cross-crate round trip, a crate built by the oracle at `-O --emit=metadata`, whose inline fn
holds constant indices past 2^53, inlined into a second crate, gives the oracle's `-O -Zunpretty=mir` in the port. The same holds with the oracle reading it. (The port could not
build that first crate itself: F1.)

**Instructions** (`/usr/bin/time -l`, one warm-up run each, then 7 runs alternating, at a load of 12 to 20, equal-length paths):

| Program | `main` median (range) | head median (range) |
|---|---|---|
| hello, `--edition 2021 --emit=metadata` | 10.547 G (10.351-10.589) | 10.434 G (10.307-10.651) |
| the slice library, `-O --emit=metadata` | 29.191 G (29.054-29.487) | 29.117 G (28.278-29.696) |

No cost is detectable.

## 2. `MACOSX_DEPLOYMENT_TARGET`

- **Source and scope.** The new code is `versioned_llvm_target` from `compiler/rustc_codegen_ssa/src/back/mod.rs:25`. Its marker names that line, which is
  the `pub fn`. `rustc_codegen_ssa` is in scope: `harness/scope.json` excludes `rustc_codegen_llvm`, not it. `coverage --missing` gives 1/1. Nothing is
  ported from `rustc_codegen_llvm`. The lane adds one call inside the existing D4 stand-in, `src/rust_ts/codegen_backend.ts` `target_config`, and drops the triple,
  which only LLVM reads. The scope rule holds.
- **Placement.** Upstream `llvm_util.rs:325-330` calls `global_llvm_features(sess, true)`, then `versioned_llvm_target(sess)`, then `target_cpu`. The stand-in calls
  it right after its `non_default_llvm_input` stop and before the table lookup. That is the same place, since the feature warnings are emitted earlier (in
  `init`), deduplicated, and in upstream's order. Checked with `-Ctarget-feature=+foo`, `-neon`, `+sve,+bogus` and `crt-static` under `abc` and `10.5`, at
  `--emit=metadata` and `--print cfg`: 16/16 the same as the oracle, with the warnings interleaved.
- **Against the oracle (host).** `MACOSX_DEPLOYMENT_TARGET` unset, `abc`, `10.5`, `""`, `1.x`, `99999`, `11.0.0.1`, `10.13`, `"14.2 "` and `0.0`, each with
  `--emit=metadata` on a lib with an unused-variable warning, on one with a parse error and on one with a type error, plus `--print cfg`, `-Zunpretty=expanded`,
  `-Zparse-crate-root-only` and `--print deployment-target`: **70/70 the same** (stdout, stderr and exit code). `--target x86_64-apple-darwin` with `abc`, `1.0`
  and `99.0` at `--emit=metadata` and `--print cfg`: 6/6. The other Apple targets (ios, macabi, tvos, watchos, visionos) stop `unported` at target selection,
  and `-Ctarget-cpu` stops in `configure_llvm`, both before this code and on `main` too.

## 3. `host_canonicalize`

`libc_canonicalize` is std's unix `canonicalize` (`library/std/src/sys/fs/unix.rs:2053`, marker right): `realpath(path, NULL)`, `last_os_error` on null, then the
bytes copied and `free`d. `errno_reader()` is taken before the call, as its doc requires. An interior NUL gives `run_path_with_cstr`'s `InvalidInput`, "file name contained an
unexpected NUL byte", the same as Rust's. I built a Rust program with the oracle toolchain that prints `fs::canonicalize`, and ran it in a cwd of 1,015 bytes.
For `link/liblib-a.rmeta`, `link/nope`, `""`, `./link/../link/liblib-a.rmeta`, `link`, a symlink loop (`loopA`, `loopA/x`: `ELOOP`), `file/x` (`ENOTDIR`),
`/nonexistent/x` and an absolute path through the symlink, **head gives the same Ok paths and errnos on all 11 inputs**. `main` gives `ENAMETOOLONG` for the first two (F1 of
fixers-45). Non-UTF-8: O2.

**Cost and load order.** `realpath` and `free` join the existing lazy `dlopen` table (`env_libc()`), which the first `getenv` opens at startup, so the FFI
does not load any earlier. Bun compiles a trampoline per symbol: 40 `dlopen`s of the 8-symbol table took 0.05 to 0.09 ms each, and with 10 symbols 0.06 to 0.11 ms.
That is noise next to a 10 G-instruction hello.

## 4. E0464 and the sort

`filesearch.rs:66` sorts with `files.sort_unstable_by(|lhs, rhs| lhs.filename.cmp(&rhs.filename))`. The port calls `slice_sort_unstable_by` with `byte_cmp`, which
compares code points, the same order as `str::cmp`'s UTF-8 bytes, and gives `compare(a, b) < 0` as `is_less`, upstream's `== Less`. At 20 elements or fewer,
`unstable_sort` does `insertion_sort_shift_left(v, 0, len, 1, ..)` (`MAX_LEN_ALWAYS_INSERTION_SORT = 20`), as upstream does. The layout is `Arc<Path>` (16), `Box<str>` (16), `PathKind` (1)
and `bool` (1), padded to 40, with no `UnsafeCell`, so `Freeze` and not `Copy`. That is correct. File names are distinct except where one name is found in two search paths, so only
those pairs can change order. The locator samples above show no change: check-ui 200 + 1 + 83, rmeta-ui 150 + 178, pm-ui 150. **Mutant:** with the stable sort
restored, the new locator case fails (1 fail, 35 pass).

## 5. The 2^53 static

This is not a guessed value. 2^53 is the point where `Size.bytes()` can no longer return a number, so it is a representation boundary, not a host's. Every
size from the typed array's limit up to 2^53 already fails in the port with `RangeError`, as before. Oracle against head, the same path on both sides:

| Size | Oracle | head | `main` |
|---|---|---|---|
| 2^52 | E0080, exit 1 | same | same |
| 2^53 - 1 | E0080 | same | same |
| 2^53 | E0080 | same | `unported` (`Size beyond 2^53`) |
| 2^53 + 1 | E0080 | same | `unported` |
| 64 GiB | exit 0 | E0080 | E0080 (O1) |

No size that the oracle allocates gives E0080 because of this change. `regen.ts`, rerun at head, rewrites `big_err.aarch64-apple-darwin.txt` byte for byte. **Mutant:**
without the `is_big()` line, `aarch64.oracle.test.ts` fails.

## 6. Mach-O nits

N2 is right. object 0.39.1 `write/macho.rs:562-568` sums `1 + usize::from(reloc.addend != 0) + usize::from(reloc.subtractor.is_some())`, and the port has the
same expression, `addend` being a `bigint` as `i64`. `RelocationInternal` (mod.rs:1126) keeps its two fields' types. N1: the renamed test reads fixtures only, and nothing in
`scripts/` or `harness/` names it. `docs/next.md:512` and `docs/handoff/object-write-macho.md:50,88` still use the old name, as the handoff tells root. The fixture is
oracle output (F2).

## 7. Units, tsc, coverage

- `bunx tsc --noEmit -p .` at head: clean.
- `bun scripts/coverage.ts --check`: `markers ok (24883; vendor 5286; library 607)`. `back/mod.rs` is 1/1 and `gvn.rs` 62/62.
- The touched test files at head (`bck_lib_b`, `debug.oracle`, `visit`, `move_paths`, `matches_c`, `rlib_macho`, `slice_sort`): 54 pass.
  `env`, `locator.oracle`, `codegen_backend.oracle` and `aarch64.oracle`: 60 pass, against 56 on `main`.
- Unit time for those four files, alternating runs: `main` 30.5 s and 35.6 s, head 31.6 s and 39.1 s, so +1.1 s and +3.4 s at a load of 10 to 20. That is consistent with the
  lane's 1.7 s, within the noise.
- **Mutant:** without the `versioned_llvm_target(sess)` call, both new `codegen_backend` cases fail.

## What I did not check

The gate, and every full suite but rmeta-core. Miri suites (`run-pass-miri*`, `miri-pass`), so not the Miri backend's path through `native.target_config` either.
Linux and Windows: non-UTF-8 paths (O2) and Windows' fallback to `realpathSync.native`. `open_drop_for_array` past 2^53, which loops over every element upstream too.
The full unit step. Whether any protected case finds one library name in two search paths: I checked by samples and filters only. I wrote no mutant for the `bigint`
widening; tsc and the suites cover it.

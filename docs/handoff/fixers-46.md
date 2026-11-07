# Handoff: lane `fixers-46` (ABI, lint and Miri stops; test gaps)

Branch `t3/03b233c5`, on `26e61959` (Start wave 40c). Commits:

| Commit | Item |
|---|---|
| `25f7527d` | fixers-44 F5 (and the sites the same sweep found), F2, root-w41 N2 |
| `2b1da04c` | F5: a `big_err.rs` shape that reaches `SizeSkeleton`'s 1-ZST test |
| `9fca3d9e` | F5: `large_assign.rs` pins the `large_assignments` move check |
| `23e9262f` | root-w41 N5, N6 |
| `a9ff88d7` | miri-sysroot review F1 (item 4; the only `harness/`/`scripts/` change) |

No STOP was open. All runs were on AC, with `RUST_TS_REQUIRE_PROBES=1` and `RUST_TS_AGENT=fixers-46`.

## 1. fixers-44 F5: sizes at or above 2^53 bytes

Both named sites are fixed. A sweep with ordinary by-value code (moves, copies, `Option`, enums with and without niches,
`repr(C)`, `packed`, `align`, closures, `fn` pointers, `extern "C"`, `dyn` vtables, `Box`, `ptr::read`, `drop`, `transmute`)
found four more, now fixed too. Each is `Size_cmp`/`Size_eq`, or `bytes_u64()` and `bigint` where upstream has a `u64`:

| Site | Upstream | Reached by |
|---|---|---|
| `rustc_mir_transform/known_panics_lint.ts:1115` | `layout.size < Size::from_bytes(MAX_ALLOC_LIMIT)` | any by-value local of that size, `-O` |
| `rustc_lint/types.ts:904-932` | `variant_size_differences`' `u64`s | an enum with such a variant (the lint pass runs whatever its level) |
| `rustc_abi/layout.ts:345-364` | `layout_of_univariant`'s `head_space`, `niche_len`, `tail_space` and the `alt_` ones | a struct with a niche and a large field, e.g. `(&u8, [u8; 1 << 53])` |
| `rustc_middle/ty/layout.ts:876` | `SizeSkeleton::same_size` (`Size` equality) | `transmute` between two such types |
| `rustc_middle/ty/layout.ts:784` | `SizeSkeleton::compute`'s `size.bytes() == 0` | `transmute` of a `TooGeneric` struct with such a field |
| `rustc_hir_typeck/intrinsicck.ts:71,129` | E0512's size in bits; `size_to == Pointer.size` | a size mismatch at that size |
| `rustc_monomorphize/mono_checks/move_check.ts:138,181` | `bytes_usize() > limit`, the lint's `size: u64` | `#![feature(large_assignments)]` with such a copy |

Two diagnostics carry the `u64`: `VariantSizeDifferencesDiag.largest` and `LargeAssignmentsLint.size`. Their generated fields
are now `bigint` through the codegen typemaps' existing per-field mechanism (`fields`, lane followups-34):

- **`tools/codegen/` changed, outside PORTING §1's ownership, for root to accept or redo.** New `lint.typemap.json` (set
  `rustc_lint`'s first `typemap_extra`, in `types.sets.json`); one `fields` entry added to `mir.typemap.json`; `rust_ts::u64_exact`
  added to `diag_args.json`'s integer entry (`number_into_diag_arg` takes a `bigint`). I regenerated only sets `rustc_lint` and
  `rustc_monomorphize`: each `.gen.ts` changes by that one line. The other sets with `mir.typemap.json` hold no such item.

**Oracle check.** Every program in the sweep is now identical to the oracle (stdout, stderr, exit) at `-Zunpretty=mir` (`-O`,
`-Copt-level=0`, `-Copt-level=3 -Zmir-opt-level=4`), `--emit=metadata`, and through `scripts/mono-run.ts` with
`-Zprint-mono-items=yes` at `-O` and `-Copt-level=0`, on aarch64-apple-darwin.

**Pins.** `callconv/aarch64_oracle/big.rs` (known_panics_lint, the lint, univariant, `same_size`) and `big_err.rs` (E0512's
bits, the 1-ZST test) run on darwin in the ABI test's process. `collector_oracle/programs/large_assign.rs` gains a
2^53 + 9-byte copy. Every fix above, reverted alone, fails its test (mutants run one at a time; all killed).

**Left:** `-Zprint-type-sizes` still stops at that size (`rustc_ty_utils/layout.ts:1171`, `build_variant_info`, and
`CodeStats`' `u64` fields). It is a `-Z` debugging flag, not ordinary code, and needs a typemap change of its own.

## 2. fixers-44 F2: the `is_scalable_vector` guard at `aarch64.ts:127`

`aarch64_oracle/scalable_indirect.rs` is a scalable vector that is also `#[rustc_pass_indirectly_in_non_rustic_abis]`. Both
sides ICE on `rustc_ty_utils/src/abi.rs:456`. The ICE reports differ in form, so the test compares the exit code (101) and the
panic message: the oracle's lines between `panicked at ...:` and the `RUST_BACKTRACE` note must follow the port's
`rust-ts: internal compiler error: `. Removing the guard makes the port exit 1 with a dump, and the test fails.

`run.ts` catches a `Panic` per case for a case marked `ice` (`catch_with_exit_code` rethrows it). That case is last, so no
session runs after a panic. **Regen note:** the oracle file holds the oracle's thread id, which changes each run, so
`regen.ts` rewrites it every time; I restored the committed one after my last regen.

## 3. root-w41 N2: `x86_win64.ts`'s 8, 16 and 32-bit arms

`sizes.rs` gains `B1`, `B2`, `B4` (and `Rust1 C1` ... `Rust4 C4`), appended so that earlier output keeps its lines. I
regenerated all four `sizes.*` oracle files with `regen.ts`; it also reproduced both `abi.rs` files byte for byte. Mutating
`case 8n`, `16n`, `32n` to `9n`, `17n`, `33n` now fails the ABI test, each alone.

**Unit time:** the run.ts process takes 1.18-1.25 s with the six old cases and 1.28-1.29 s with all nine (three runs each,
load about 7); the ABI test is 1.3-1.6 s in all.

## 4. root-w41 N5 and N6: `TempDirBuilder::tempdir_in`

`rustc_metadata/fs.ts` now does what tempfile 3.23.0 does (`util::create_helper`, `tmpname`, `dir::create`): one `mkdir` of
`<dir>/<prefix><6 alphanumerics><suffix>`, with the default mode (0o777 less the umask, which is upstream's: tempfile sets no mode on a
directory), retrying on `AlreadyExists` only, up to `NUM_RETRIES`. `mkdtempSync` is gone, and so is the suffix's rename.

- **N5:** from a cwd of 1,008 to 1,015 bytes with `--out-dir out`, both sides now print `couldn't create a temp dir: File name
  too long (os error 63)` (scratch script, oracle against port). The one difference left is the oracle's ` at path "..."`,
  which is **fixers-45's item** ("the temp-dir error's path"). It lands in this same function, so expect a merge conflict
  there; `with_err_path` goes around the `mkdirSync` error (and the "too many temporary files exist" one, with `base`).
- **N6:** a failure now leaves nothing behind, as there is no rename.
- **Test:** `src/rustc_metadata/fs.test.ts` (0.2 s): the suffix path's name, that it is the only entry, and that drop removes it;
  and, at the host's path length limit, for both an empty and a non-empty suffix, that `tempdir_in` fails exactly where `mkdir` of a
  name that long fails, with the same errno, leaving nothing. The old code fails the second test.

## 5. miri-sysroot review F6

**Already fixed at this base**, by fixers-43's `c6517ac5`: the ICE resolver's marker pattern now accepts `src/tools/miri`
paths. With `MIRI_BE_RUSTC=target` and `--crate-type dylib` or `staticlib` alone, the port and the isolated Miri both exit 101,
and their stderr is identical with thread ids masked (`miri.rs:302:21`). Nothing to change.

`track_caller_check.ts` (static part): 0 proven swaps, 22 anchors and const markers, 0 bad; the ICE corpus maps 49 of 49.
**The 118-case ICE comparison still gives 92 of 118** (same per-suite table as `docs/handoff/ice-report-impl.md`), and against
that run's `res-impl.json`, no case changed its result, first differing line or stop. 117 of 118 panic locations equal the
oracle's. The other is `mirdump-ui no-storage.rs`, one of the 5 unchanged backtrace stops. (I ran a copy of
`$RUST_TS_DATA/tmp/ice-report/cmp-impl.ts` pointed at this worktree; results in `res-fixers46.json` there.)

## 6. miri-sysroot review F1: `custom_local_sysroot` (item 4, report-only)

- `gen-miri-sysroot.ts` keeps the crate. Its cwd and `CARGO_MANIFEST_*` are `$BUILD`, and `sources` is `{ "lib.rs": "" }`. The
  setup log is of another run (`8DEjGx`), so `$BUILD` is read at run time from the sysroot's own `custom_local_sysroot-*.d`
  (`harness/miri-sysroot.ts` `miriSysrootBuildDir`), and only for a template that uses it.
- `scripts/miri-sysroot-run.ts` writes `sources` into the cwd when absent and **never removes them**, as the other side or
  another worktree may be reading. So `/var/folders/23/.../T/rustc-build-sysroot-XIGEBx/lib.rs` (empty) now exists on this host.
- Regenerating `crates.json` added the one entry; the other 26 are unchanged.
- `harness/miri-sysroot.test.ts`: 27 crates; this one's cwd, manifest, sources and externs; `$BUILD` resolved from the `.d`;
  and `$BUILD` read only when used.
- **Checked through the suites' wrapper:** I ran `miri-sysroot-alloc`'s two commands with the crate swapped. Both sides exit 0 with
  identical output, and both print `sysroot rmeta: same` and `sysroot rlib: same`. That run also goes through the new `tempdir_in`
  (the rlib's archive dir). No suite runs this crate: the suites are still core, alloc and std.
- **Protected suites: I checked that nothing changes.** These three files are hashed only by the `miri-sysroot-*` suites'
  `oracleKey` (`harness/suites.ts:2261`). No other suite or script reads them (grep), and their `inputDirs` are `[]`. No
  baseline, oracle output or suite definition changed. The `miri-sysroot-*` keys do change, as intended.

## Samples (this head, unmodified)

| Suite | Result | Run |
|---|---|---|
| `mono-ui --filter tests/ui/abi` | 49/49 | `20261107-110605-fixers-46-cquv` |
| `mono-ui --sample 60` | 60/60 | `-110729-fixers-46-fkc8` |
| `check-ui --sample 120` | 120/120 | `-110620-fixers-46-nzds` |
| `mir-o2 --sample 200` | 200/200 | `-110644-fixers-46-xnfh` |
| `miri-hello` | 1/1 | `-110743-fixers-46-zosz` |
| `miri-sysroot-alloc` | 1/1, subject 21.5 s, 3.0 GB | `-110751-fixers-46-vpqa` |
| `rmeta-ui --sample 80` (for `tempdir_in`) | 80/80 | `-110912-fixers-46-qrwn` |

Unit tests run: the ABI test, `fs.test.ts`, `harness/miri-sysroot.test.ts`, `tools/codegen/typemap_fields.test.ts`, and the whole
`collector.oracle.test.ts` (61 pass). I did not run the full unit step. `tsc` is clean, and `coverage.ts --check --offline` passes
(24,872 markers).

**Coverage** (`--missing`): `rustc_lint/types.rs` 28/28, `known_panics_lint.rs` 37/37, `move_check.rs` 9/9,
`rustc_abi/layout.rs` 16/16, `rustc_middle/ty/layout.rs` 61/61, `intrinsicck.rs` 6/6, `rustc_metadata/fs.rs` 5/5.

## `unported(...)` left, `// PORT:` decisions

- No new `unported`.
- `// PORT (size-bigint):` comments at each F5 site.
- `fs.ts` `tempdir_in`/`tmpname`: not `mkdtempSync`; `with_err_path` not added; the random draw is from `crypto`,
  `% 62` (fastrand's draw is uniform, and its re-seed is moot). The name is never compared, only its shape.
- `aarch64_oracle/run.ts`: the per-case `Panic` catch for `ice` cases.

## Side effects

- `$RUST_TS_DATA/tmp/ice-report/res-fixers46{,.json}`; the shared oracle cache there was reused, not rewritten.
- The empty `lib.rs` under the sysroot's build temp dir (§6).
- Scratch files only in my scratchpad; the `.env.local` and `node_modules` link in the worktree are gitignored.

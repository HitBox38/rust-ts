APPROVE WITH NITS

# Review: lane fixers-50 (wave 40g, queued review findings)

Reviewer: independent, read-only. Branch `t3/fix-rustc-port-findings-1` at `fa44dce6` (commits `c9af96b9`, `08488d69`, `e6898af4`,
`5520ccd4`, `ab3970c1`, `fa44dce6`), based on main `9015f665`. Reviewed `git diff 9015f665...t3/fix-rustc-port-findings-1` against the
pinned upstream (`$RUST_TS_DATA/rust` at `6f5da406`), hashbrown 0.17.1, rustc-hash 2.1.1 and tempfile 3.23.0. Host: root host, AC power,
no gate running, load 5 to 11. `RUST_TS_AGENT=fixers-50-review`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`.

No must-fix findings. Every claim in the handoff that I checked holds, including the three "already fixed" items.

## Evidence

| Check | Result |
|---|---|
| `bun scripts/difftest.ts --suite mir --sample 200 --jobs 6` (branch) | 200/200 MATCH, skipped=1 (`20261109-201016-fixers-50-review-9tu8`) |
| `bun scripts/difftest.ts --suite check-ui --sample 200 --jobs 6` (branch) | 200/200 MATCH (`20261109-201048-fixers-50-review-yjd5`) |
| `bunx tsc --noEmit -p .` (branch) | clean |
| `bun scripts/coverage.ts --check --offline` (branch) | `markers ok (24896; vendor 5311; library 610)`; no `// rustc:`/`// crate:` line added, removed or moved in any touched file; `code_stats.rs` 3/3 |
| Unit tests: `src/rustc_session/`, `src/rustc_codegen_ssa/back/`, `scripts/lib/unit-steps.test.ts` | 148 pass, 0 fail |
| Unit tests: `element_eq`, `path`, `env`, `first_import`, `coercion`, `typeck_impl`, `aarch64.oracle` | 61 pass, 0 fail; the removed-cwd test passed 5 runs out of 5 |

Both difftest runs printed `ERROR: the upstream checkout is not clean`. The strays are three `rustc-ice-2026-11-09T20_*.txt` files in
`$RUST_TS_DATA/rust`. Their stacks name worktree `t3-2ba7f49e`, another session, not this lane. The runs still completed. See O1.

## 1. `c9af96b9`: `-Zprint-type-sizes` ties in `FxHashSet<TypeSizeInfo>` order

**The hash is upstream's derived `Hash`.** I compared it with `code_stats.rs:8-71` field by field:
- `TypeSizeInfo` has `kind`, `type_description`, `align`, `overall_size`, `packed`, `opt_discr_size` and `variants`.
- `VariantInfo` has `name`, `kind`, `size`, `align` and `fields`.
- `FieldInfo` has `kind`, `name`, `offset`, `size`, `align` and `type_name`.

The order and the write calls match:
- **Fieldless enums.** The derive hashes `discriminant_value`, an `isize`, through `write_isize`. Declaration order gives the values: `SizeKind`
  0-1, `FieldKind` 0-2 and `DataTypeKind` 0-4.
- **`Option`.** `Option` is `#[derive(Hash)]`, so `None` hashes `isize` 0 and `Some` hashes 1, then the payload.
- **`String`.** `str::hash` is `write_str`. rustc-hash's `nightly` override is off: no crate in the compiler graph enables it (`rustc-hash =
  "2.0.0"` in `rustc_data_structures`, `rustc_type_ir` and `rustc_pattern_analysis`). The override would hash the same way anyway, `write(bytes)`
  plus `write_u8(0xff)`.
- **`Vec`.** `[T]::hash` writes `write_length_prefix(len)`, which is `write_usize`, then each element.
- **Scalars.** `bool` uses `write_u8`, `u64` uses `write_u64`, and `Symbol` uses `write_u32` (derived over `SymbolIndex`).

I counted `size_of::<TypeSizeInfo>() = 88` myself: 24 + 8 + 8 + 16 + 24 = 80 bytes, plus `kind` and `packed`, padded to 88. `(T, ())` has the
same layout.

**The insertion is upstream's.**
- `HashSet::insert` in hashbrown 0.17.1 (`set.rs:1074`) is `self.map.insert(value, ()).is_none()`. `HashMap::insert` (`map.rs:1806`) goes
  through `find_or_find_insert_index`, which runs `reserve(1)` before the lookup, so a duplicate insert can still grow the table.
- The vendored `HashMap.insert` (`src/vendor/hashbrown/map.ts:214`) and `find_or_find_insert_index` (`raw.ts:458-460`) do the same.
- `FxKeyedMap.set` routes every `record_type_size` call through `base.insert`, duplicates included. An equal key resolves to the stored
  object, and the bucket keeps it, as hashbrown keeps the first key.
- `key_TypeSizeInfo` compares every field, which is the derived `PartialEq`.
- `print_type_sizes` iterates `keys()` in bucket order and keeps the stable sort (`Array.prototype.sort` is stable).

**My own tie cases** (not the lane's), run with the test's argv on both sides: `--sysroot <oracle> --edition 2021 --crate-type lib
-Zprint-type-sizes -Zcodegen-backend=dummy`:
- `adt.rs`: a user ADT and `Peekable`/`Zip`/`Enumerate`/`Skip`/`StepBy` from std, all wrapping a generic closure. The std field names are
  decoded from metadata. The file also has doc comments, string, byte-string and raw-string literals, `derive(Debug)` and `format!`. It has
  11 tie groups and 880 lines: **SAME**.
- `asyncs.rs`: async blocks with disjoint field captures (`p.xa`-style upvar names), a named local held across `.await`, and unnamed
  temporaries across an await, which use the `.coroutine_fieldN` names and the interned `type_name` strings. It also awaits
  `std::future::Ready` and uses `HashMap` and `format!`. It has 12 tied async blocks and 1,141 lines: **SAME**.
- `closures2.rs`: closures in `Option` and in a user ADT. It has 2 tie groups: **SAME**.
- I generated 48 more files with a separate generator: 4 shapes, random decoys and identifiers, and 1 to 30 instantiations, across 2 seeds.
  All 48 are **SAME**, with 0 to 12 tie groups each, so the table sizes vary across growth boundaries.
- On main (`9015f665`), `adt.rs`, `asyncs.rs` and `closures2.rs` all stop at exit 70 with the old tie `unported`.

**Mutants** (each applied alone, then reverted; my 3 files plus the lane's 3):

| Mutant | Fails |
|---|---|
| iterate in insertion order (`Map.prototype.keys`) | 5 of 6: all except the lane's `closures.rs` (N1) |
| `hash_Symbol` writes `index + 1` | 5 of 6 |
| `Option` discriminants swapped | 5 of 6 |
| `Vec` length prefix dropped | 5 of 6 |
| `packed` through `write_u64` | none: an equivalent mutant, since FxHasher's `write_u8` and `write_u64` both `add_to_hash(i as usize)` |
| old `code_stats.ts` | the 3 tie tests in `code_stats.oracle.test.ts` (1 pass, 3 fail) |

**Symbol interning risk.** The order depends on the Symbol indices of upvar, local, `.coroutine_fieldN`, variant and type-name strings. Those
are interned at record time, in the same order as the inserts. The indices of source and metadata symbols matched upstream in every case
above. That includes `adt.rs` and `asyncs.rs`, which intern through string and doc literals, metadata decoding, derives and `format!` before
any record. A future divergence in interning order would show here first. The handoff states this exposure. It is shared by every `u32_key`
user of `hash_map.ts`, so it is no finding against this lane.

## 2. `08488d69`: `GenericArg::as_*`

Upstream's `as_region`, `as_type` and `as_const` (`generic_args.rs:249/257/265`) are `match self.kind() { X(v) => Some(v), _ => None }`.
- **Hit.** It still returns after one `instanceof`, as before.
- **Miss on another kind.** It returns `undefined`.
- **Anything else.** It calls `panic_unreachable()`, the same function that `kind()` (`generic_args.ts:195`) and `fold_with` call:
  `bug("GenericArg::kind: not a Ty, Region or Const")`. The kind and the message are the same.

On the old `generic_args.ts`, the new test fails (9 pass, 1 fail).

## 3. `e6898af4`: `"wx+"`

tempfile 3.23.0 `src/file/imp/unix.rs:14 create_named` sets `read(true).write(true).create_new(true)` and `mode(0o600)` when `permissions`
is `None`. That is `O_RDWR | O_CREAT | O_EXCL` with mode 0o600 under the umask, which is what Node's `"wx+"` with mode `0o600` opens.
- **Existing file.** Both fail with `EEXIST`, which maps to `AlreadyExists` and to the existing retry loop (`create_helper`). That loop is unchanged.
- **Test.** `archive.test.ts` fails with `"wx"`: 0 pass, 1 fail.

## 4. `5520ccd4`: `absolute` with a removed cwd

This pins upstream's `?`.
- **Oracle.** I built a Rust program with the pinned nightly that removes its cwd and then calls `std::path::absolute("x")` and
  `std::path::absolute("/a/./b")`. Three runs on this macOS host all printed `Err NotFound|Ok /a/b`, which is exactly what the test expects.
- **Port.** `current_dir` reads libc's `getcwd`, and macOS returns `ENOENT` for a removed cwd. It does not read Bun's cached `process.cwd()`.
- **Mutation.** With `current_dir()?` replaced by a throw, the test fails: 3 pass, 1 fail.
- **Isolation.** The test runs in a child process, so the parent's cwd is never touched.

## 5. `ab3970c1`: the `InferOk` cycle

The change is a single import specifier, `infer/mod.gen.ts` → `infer/mod.ts`, which re-exports the gen module (`export * from
"./mod.gen.ts"`, `mod.ts:117`), plus a `// Load order:` comment. No function, marker or upstream order moved.

I reproduced the comparison with my own `--preload` plugin. It appends an evaluation-time log statement to every `src/**/*.ts` module, run
on main and on the branch:

| Entry | Modules | Order |
|---|---|---|
| `main.ts --crate-type lib --emit=metadata` | 2,095 | identical; `.rmeta` byte-identical |
| `src/miri/bin/miri.ts --version` | 2,276 | identical |
| `main.ts --crate-type rlib -Zcodegen-backend=dummy -Zprint-mono-items` | 2,107 | identical; stdout identical |

In the real entries, `infer/mod.gen.ts` evaluates at position 685 and `infer/mod.ts` at 721, long before `coercion.ts` (1663) and `_match.ts`
(1673). The new import therefore adds no evaluation edge for them. `first_import.test.ts` fails on the old import: 0 pass, 1 fail.

## 6. Items fixed earlier

All four commits are ancestors of `9015f665`, and each fix is still in HEAD:

| Item | Fixed by | Still in HEAD | Mutant | Fails |
|---|---|---|---|---|
| fixers-44 F2 | `25f7527d` | `aarch64.ts:96,127` keep `is_scalable_vector`, as `aarch64.rs:84,117` do | guard removed at :127 | `aarch64.oracle.test.ts` (1 pass, 1 fail) |
| fixers-44 F5 | `25f7527d` | `known_panics_lint.ts:1115` uses `Size_cmp(..., Size.from_bytes(MAX_ALLOC_LIMIT))`; `rustc_lint/types.ts:917` uses `bytes_u64()` | `.bytes() < MAX_ALLOC_LIMIT` | `aarch64.oracle.test.ts` (1 pass, 1 fail) |
| fixers-43 F2 | `bd538a1d`, `caa388b7` | `rustc_fs_util/lib.ts:17`, `passes.ts:550` and `miri.ts:219` call `host_canonicalize`; the only `realpathSync` left is the Windows fallback in `std/path.ts:789` | not rerun | (lane's evidence) |
| fixers-43 F4 | `bd538a1d` | `std/path.ts:748` and `passes.ts:584` return `current_dir_str()`'s `Err` | covered in 4 | (see 4) |
| root-w40-check3 O1 | `5f8f40a0` | `codegen_fn_attrs.ts:40` imports `rustc_attr_ir/data_structures.ts` | import pointed at `data_structures.gen.ts` | `typeck_impl.test.ts` (0 pass, 1 fail) |

`docs/next.md:537-538` also records fixers-45 and fixers-46 as having taken these items. The queue lines at `docs/next.md:503-504` and
`:576` are the stale ones, as the handoff says.

## Nits

**N1.** `src/rustc_session/code_stats_oracle/ties/closures.rs` does not test the order.
- It passes when `print_type_sizes` iterates in insertion order (`[...Map.prototype.keys.call(type_sizes)]`), and under every hash mutant above.
- It only shows that a closure tie no longer stops, yet the test header (`code_stats.oracle.test.ts:21-26`) presents each case as pinning
  `FxHashSet` order. `upvars.rs` and `locals.rs` do pin it.
- Fix: replace it with a closure-only case where insertion order and bucket order differ, or say in the header that it only pins the
  removed stop.

**N2.** `src/rustc_codegen_ssa/back/archive.ts:191`: the new `// PORT: exported for archive.test.ts` line sits between the `// crate:` markers
and the `function`. PORTING §3 puts the marker directly above the fn, and the file's other `PORT` notes (and `generic_args.ts:184`) sit above
the markers. The checker accepts it, so this is placement only.

## Observations (not this lane's)

**O1.** `$RUST_TS_DATA/rust` holds three stray `rustc-ice-2026-11-09T20_09_16-40989.txt`-style files written at 22:09-22:11 local time. Their
stacks name `/Users/tomernorman/.t3/worktrees/rust-ts/t3-2ba7f49e/src/rustc_hir_typeck/lib.ts:762` (`fatally_break_rust`). Some session ran the
port with its cwd in the upstream checkout. The difftest preflight now prints `ERROR` for them. I did not move them, because this review is
read-only. Root should move them to `$RUST_TS_DATA/tmp/upstream-strays/` before the next gate.

**O2.** As the handoff notes, `rustc_attr_ir/data_structures.gen.ts` and `rustc_middle/middle/region.gen.ts` still fail as the first module of
a process. No importer enters them first today.

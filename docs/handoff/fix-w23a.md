# Handoff: fix-w23a (fixer for docs/reviews/w23a.md)

Branch `lane/fix-w23a`, based on main `5156c44` (fix-w23b merged in first, so the merge was a fast-forward; `partition_point` is imported from `src/std/slice.ts` and left alone).

## Findings

### Batch 1: span-wire
- **#1 (low) `display_Edition` order**: fixed in `src/rustc_span/edition.ts`. It now sits between the `Edition` type and its companion, with a PORT note.
- **#2 (low) flt2dec has no per-fn markers**: deferred. This needs a std marker convention in `scripts/coverage.ts`, which is a harness batch, and `src/std/fmt.ts` is not owned by this lane.
- **#3 (low) `SourceFile.clone` shares `lines`**: the PORT note is now at the call site in `src/rustc_span/lib.ts`. Nothing else changed.
- Other marker inversions found by the same scan:
  - `src/rustc_span/lib.ts`: `display_SourceFileHashAlgorithm` and `display_SourceFileHash` moved above their companion/class (fixed).
  - `debug_SourceFile` (`lib.ts`), `debug_Ident` and `debug_Symbol` (`symbol.ts`) cannot be placed monotonically, because PORTING §8 merges the impl blocks on both sides of them. Each has a PORT note instead.

### Batch 2: ast-types
- **#1 (high) Pu128 Debug**: already resolved on main by codegen-derive. `typemap.json` has its own Pu128 entry, `ast.gen.ts` emits `debug_tuple(f, "Pu128", ..)`, and `tools/codegen/derive.test.ts` covers it.
- **#2 (med) `_discriminant` for PartialOrd/Ord**: already resolved by codegen-derive. `types.ts:562` emits the table on PartialOrd/Ord; it is generated for `ParamKindOrd_discriminant` and `ExprPrecedence_discriminant` (`parser.gen.ts`), and `parser.ts` now uses the generated one.
- **#3 (med) `DUMMY_NODE_ID` etc.**: already resolved by ast-core. `src/rustc_ast/node_id.ts` has `DUMMY_NODE_ID`, `placeholder_{from,to}_expn_id` and `display_NodeId`.
- **#4 (low) `visit::FnKind`**: already resolved. It is in the `skip` list of `types.sets.json` with a note (hand-written in visit.ts / mut_visit.ts).
- **#5 (low) golden/oracle skips**: fixed in `tools/codegen/macros.test.ts` and `tools/codegen/oracle.test.ts`.
  - The golden now fails when the upstream checkout is missing and `RUST_TS_REQUIRE_PROBES=1` is set; otherwise it is a visible skip.
  - It also compares the set of `*.gen.ts` files on disk under `src/rustc_ast{,_ir}` with the generated set. Verified: a stale `stale.gen.ts` makes it fail.
  - The typedefs oracle test uses the same probe-required guard.
  - **Deferred (not owned):** `src/rustc_ast/ast.test.ts` still turns link errors and `Unported` into `test.skip` (the `A`/`globals_ok`/`ctxt_ok` guards). Those guards now look dead, since span-wire landed. Whoever owns rustc_ast should drop them.

### Batch 3: span-map
- **#1 (high) `stable_source_file_id_key` vs `Hash for Path`**: fixed.
  - `src/std/path.ts` gains `path_hash`, a port of `impl Hash for Path` (path.rs:3799-3850). It covers:
    - the parsed prefix, via derived `Hash for Prefix`: an isize discriminant, then OsStr = length prefix + bytes, or u8;
    - the byte chunks between separators;
    - skipping `.` after a separator when not verbatim;
    - never hashing the root;
    - the 64-bit `chunk_bits` wrapping_add/rotate_right tail.
  - In `src/rustc_span/source_map.ts`, `path_key` feeds `path_hash` into `StableHasherBytes`. That class records the exact byte stream `StableHasher` (rustc-stable-hash 0.1.2) would hash, including the write_isize one-byte/0xFF form and u64 LE usize.
  - Tests:
    - `src/std/path.test.ts`: `/a`=`a`, `/`=`""`, `a/./b`=`a/b`, `a//b`=`a/b`, trailing `/` and `.`, leading `./` kept, `..` kept, and `foo/bar` vs `foobar` chunk_bits.
    - `src/rustc_span/source_map/stable_id.test.ts`: with `--remap-path-prefix <dir>=/`, `load_file("x.rs")` and `load_file("<dir>/x.rs")` return the same `SourceFile` (1 file). Without the remap they give 2 files. With the old key, the remap test fails.
  - Oracle (`rustc +nightly` 6f5da406b, scratch): `include!("x.rs"); include!("<dir>/x.rs");` where x.rs is `const _: u32 = "a";`. With the remap it prints 1 E0308 at `x.rs:1:16`; without it, 2 (the second at the absolute path).
  - Also checked: a scratch Rust program with a recording `Hasher` over 22 paths (empty, root, `.`, `..`, `//`, non-ASCII, ...) gives call logs identical to `path_hash`.
  - The Windows prefix path (`c:` vs `C:` hash the same via the parsed `Disk(b'C')`) is ported but unexercised on this host.
- **#2 (med) u32 wrap in `span_extend_to_prev_char_before`**: fixed in `source_map.ts`, as `(… - len - 1) >>> 0` with a PORT note.
- **#3 (med) unicode-width oracle silently passing**: fixed in `src/vendor/unicode_width/oracle.test.ts`. The same guard went into `src/vendor/annotate_snippets/oracle.test.ts` and `src/vendor/intl_pluralrules/oracle.test.ts`.
  - When the probe is missing, the test is a visible `test.skipIf` skip with a `SKIP:` line. With `RUST_TS_REQUIRE_PROBES=1` it throws `ERROR: <name> probe not built (...)`. Verified by moving the uwidth probe away.
  - `fluent_bundle/oracle.test.ts` uses a checked-in snapshot, not a probe, so it is unchanged.
  - Root: the gate should set `RUST_TS_REQUIRE_PROBES=1`. That change is in `scripts/`, so it was not made here.
- **#4 (med) `read_binary_file_handles_lying_stat`**: ported in `src/rustc_span/source_map/tests.test.ts` as `test.skipIf(process.platform !== "linux")`, with both the `/proc/self/cmdline` and `/sys/.../kernel_max` assertions.
  - It has not run here (macOS host; the Docker daemon is down). It is the 1 skip in `bun test`.
- **#5 (med) SourceMap Debug `RwLock` wrappers**: fixed. `files` now prints `RwLock(RwLock { data: [..] })` (rustc_data_structures `RwLock` newtype around lock_api 0.4.14 Debug), with a PORT note.
  - `debug_SourceMap` moved between `SourceMapInputs` and `class SourceMap`.
  - It is still masked by the `{:p}` unported field.
- **#6 (low) `doctest_offset_line` usize wrap**: fixed (PORT note). Per the recorded decision (usize values that wrap negative stay as exact signed numbers), the result stays signed.
- **#7 (low) `remap_path_prefix` order**: fixed. It is now nested inside `map_prefix` after the `return`, exactly as upstream (a hoisted function declaration), with a PORT note. Markers 1179 → 1190 → 1229 are now monotonic.
- **#8 (low) `debug_IoError` SimpleMessage**: fixed in the new `src/std/io.ts`.
  - It has `IoError` with `Os`/`Custom`/`SimpleMessage`, `INVALID_UTF8`, `io_error_other`, `io_error_from_node`, and `display_IoError`/`debug_IoError` (now `Debug<IoError>`).
  - `RealFileLoader::read_file` now returns `INVALID_UTF8` (a SimpleMessage).
  - `src/std/io.test.ts` checks the Debug/Display texts against the oracle: `Custom { kind: Other, error: "…" }`, `Error { kind: InvalidData, message: "stream did not contain valid UTF-8" }`, and the pretty form.
- **#9 (low) std shims in source_map.ts**: fixed, with no behaviour change.
  - std::path moved to `src/std/path.ts` (exports `path_components`, `path_strip_prefix`, `path_is_absolute`, `path_eq`, `path_join`, `Components`, `Component`, `Prefix`).
  - The str helpers (`str_*`, `is_valid_utf8`) are appended to `src/std/str.ts`.
  - io moved to `src/std/io.ts`.
  - `index`, `USIZE_MAX` and `saturating_sub` stay in source_map.ts, as asked (fix-w23b area). The `index()` negative-index text is untouched.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 345 pass, 1 skip (the linux-only test), 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (1950). `--missing`: source_map.rs 84/84, source_map/tests.rs 29/29, edition.rs 10/10.
- `RUST_TS_AGENT=fix-w23a bun scripts/difftest.ts --suite lex --sample 300`: 300/300 MATCH. `--suite escape --sample 300`: 300/300 MATCH.

## unported(...) left
None added. Existing ones that remain:
- the `SourceMap` Debug `{:p}`;
- io `Os` error Display/Debug (now in `src/std/io.ts`).

## PORT decisions
- `StableHasherBytes` (source_map.ts) records the StableHasher byte stream as a latin1 key.
- `path_hash`:
  - uses bigint for the 64-bit `chunk_bits`;
  - converts the prefix length from UTF-16 units to bytes.
- The `>>> 0` u32 wrap in `span_extend_to_prev_char_before`.
- `doctest_offset_line` keeps the signed value (recorded usize decision).
- The RwLock Debug wrappers.
- `remap_path_prefix` is nested after the `return`.
- The placement notes for `display_Edition`, `debug_SourceFile`, `debug_Ident` and `debug_Symbol`.
- The `SourceFile.clone` lines sharing.
- The Linux-only test is `skipIf`.

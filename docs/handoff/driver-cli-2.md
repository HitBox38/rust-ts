# driver-cli-2 (wave 40k): handoff

Porter lane. Pin `6f5da406b56c`. Base `92c72880`. Branch `t3/2c0d3fb4`. AC power throughout. Bun 1.4.4 (the machine's,
per the owner decision). `RUST_TS_AGENT=driver-cli-2 RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`, `--jobs 6`. No
gate and no full suites other than the `cli` report suite the brief asks for.

## Evidence

| check | result |
|---|---|
| `difftest --suite cli --jobs 6`, **before** (base `92c72880`) | 2009: MATCH 1991, DIFF 0, UNPORTED 18 (`runs/20261111-105041-driver-cli-2-x1tg`) |
| `difftest --suite cli --jobs 6`, **after** (`6738d1e1`) | 2009: MATCH 1991, DIFF 0, UNPORTED 18; every subset as before (`runs/20261111-112015-driver-cli-2-e2jl`) |
| `check-ui --sample 200 --jobs 6` | MATCH 200/200 (`runs/20261111-113056-driver-cli-2-zsez`) |
| `rmeta-ui --sample 200 --jobs 6` | MATCH 200/200 (`runs/20261111-113143-driver-cli-2-3ic3`) |
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24997; vendor 5311; library 735)` |
| `bun tools/codegen/options.ts --check` | up to date |
| `bun test ./src/std/result.test.ts` | 3 pass |
| `bun test src/rustc_driver_impl src/rustc_errors src/rustc_metadata src/rustc_session src/rustc_interface/metadata_temp_dir.test.ts src/std src/rustc_feature tools/codegen/options.test.ts tools/codegen/diagnostics.test.ts` | 694 pass, 0 fail, 0 skip |

The `cli` suite does not change: its 18 UNPORTED are the codegen-backend `--print` kinds, `all-target-specs-json` and
`target-spec-json-schema` (outside this lane), and its `-Zls` cases are the M5 aux rmetas, which have no target
modifiers. A note on the before-run: I regenerated `diagnostics.gen.ts` (item 1) while it was running; that change
touches only `UnstableFeatureUsage`, which no `cli` case reaches.

The per-item checks against the oracle (`rustc +nightly`, same argv and env, `RUSTC_ICE=0`) are below. The scratch
scripts compare exit, stdout, stderr, and the files left in the output dir (and for item 3 the rmeta bytes plus `-Zls`).

## 1. `-Zmetrics-dir` errors

- `UnstableFeatureUsage.error: Box<dyn Error>` was `unknown` with `unported_into_diag_arg` in the generated derive.
  Now:
  - `tools/codegen/driver_impl.typemap.json` (new, the set's `typemap_extra` in `types.sets.json`) maps
    `dyn std::error::Error` to `IoError` **for the `rustc_driver_impl` set only**.
  - `diag_args.json` gains the `IntoDiagArg` of `Box<dyn Error>` (`into_diag_arg_using_display!`,
    diagnostic_impls.rs:71) as `into_diag_arg_using_display(display_IoError)`, matched on `arg0` `dyn Error`.
  - PORT: `Box<dyn Error>` is `IoError`, as in rustc_borrowck `polonius/legacy/facts.ts`. The only producer is
    `Features::dump_feature_usage_metrics`. Its errors are an `io::Error`, or a `serde_json::Error` made by
    `Error::io`, whose Display is the io error's.
  - Not global, because `rustc_codegen_ssa`'s `ExtractBundledLibsError` has `Box<dyn std::error::Error>` fields
    holding other errors. I checked that regenerating `rustc_codegen_ssa` into scratch gives the committed bodies
    unchanged: its fields stay `unknown`, and its arg text `dyn std :: error :: Error` does not match `arg0`. A set
    that reached the entry with another TS type would fail `tsc`.
- Oracle comparison (`libfoo.rs`, no_core lib, `--emit=metadata`):

  | case | result |
  |---|---|
  | `-Zmetrics-dir=<out>/m` (missing) | MATCH: exit 1, `error: cannot dump feature usage metrics: No such file or directory (os error 2)`, `liblibfoo.rmeta`, no `rmeta*` |
  | `-Zmetrics-dir=ro` (mode 555) | MATCH: exit 1, `Permission denied (os error 13)` |
  | `-Zmetrics-dir=libfoo.rs` (not a directory) | MATCH: exit 1, `Not a directory (os error 20)` |
  | `-Zmetrics-dir=good` | MATCH: exit 0, the same JSON file name |
  | missing dir without `--emit=metadata` | the port stops earlier at `LlvmCodegenBackend::codegen_crate` (M7), not this lane |

- `metadata_temp_dir.test.ts` (3 tests):
  - The "stop once the Linker exists" case now uses `-Zincremental-verify-ich`. It stops `unported` in `tcx.finish()`
    (`verify_query_key_hashes`, D3). That is after the `create_and_enter_global_ctxt` closure returns the Linker and
    before `link`, so the run unwinds through `run_compiler`'s `catch`.
  - The oracle exits 0 with `d2/liblibfoo.rmeta` and no `rmeta*`. The test asserts the rmeta exists (root-w50-check
    N4) and that no temp dir is left.
  - Mutation check: with `built_linker?.drop()` commented out, the run leaves `d2/rmetacHYv7H`.
  - A new case pins the oracle's metrics-dir error: exact stderr, exit 1, the rmeta, no leftovers. That run exits 1
    from `link` (`has_errors_or_delayed_bugs` → `raise_fatal`).
  - The old comment called this diagnostic a warning (N5). The comment is replaced.
- Extra on the same `run_compiler` path: `CantEmitMIR` was a stale `unported`, though its derive is generated. It is now
  `tcx.dcx().emit_fatal(CantEmitMIR_diagnostic({ error }))`. `--emit=mir -o nope/x.mir` and `-o ro/x.mir` both MATCH
  (exit 1, `error: could not emit MIR: ...`).
- Left as is, noted for root: `Features::dump_feature_usage_metrics` (rustc_feature unstable.ts, not my file) writes
  through a `BufWriter`.
  - Upstream, a write error on JSON of 8 KiB or less surfaces only at the drop's flush, which ignores it. The port
    reports any `writeSync` error.
  - Only a full disk or an EIO reaches this; a missing or unwritable dir fails at `File::create`, as before.

## 2. driver-cli review nits

- **N1**: the stale doc comment went with the `encode_TargetModifier` stub (item 3).
- **N2**: behaviour unchanged, PORT note kept (lib.ts `show_md_content_with_pager`).
  - I checked both spawn APIs under Bun 1.4.4. Neither `Bun.spawnSync` with a `stdin` buffer nor `node:child_process`
    `spawnSync` with `input` reports EPIPE when the child exits without reading, even for 1 MiB to `true`.
  - So modelling it needs a pipe + `posix_spawn` + `write` + `waitpid` FFI, which rust-ts lacks (no `std::process`
    port).
  - Upstream's own outcome is racy below the pipe capacity. The largest `--explain` output (about 8 KB) is below it.
  - Recommendation: leave it until a `std::process` port exists.
- **N3**: gone with generation. The generator emits the derive's ``"`E` has no variants to decode"`` panic, with no
  read, for zero variants. `tools/codegen/options.test.ts` checks the 0 / 1 / 1-with-field / 2 / 254 / 255-variant
  shapes.
- **N4**: the lane's std helpers are in `src/std`, with `// std:` markers:
  - new `src/std/num.ts`: `u16_from_str`, `u32_from_str` (`library/core/src/num/mod.rs:1645 from_str`), over
    `from_ascii_bytes_radix_impl` (:1788, unsigned, radix 10), with `IntErrorKind` / `ParseIntError`;
  - `src/std/path.ts`: `path_extension` (`library/std/src/path.rs:2960 extension`, over the existing
    `rsplit_file_at_dot`);
  - `src/std/str.ts`: `string_trim`, `string_trim_start`, `string_trim_end` on JS strings (`library/core/src/str/mod.rs`
    :2185 / :2224 / :2263). The `Str` versions already own the `str_trim_*` names.
  - Users: lib.ts (`handle_explain`, `list_metadata`) and markdown/parse.ts (`ord_list_start`, `trim`, `trim_end`).
  - Local copies deleted: `parse_u32`, `path_extension`, `parse_u16`, `str_trim*`.
  - Kept local: the pattern forms (`trim_matches('\n')`, `{starts,ends}_with(char::is_whitespace)`), the `[u8]` ones,
    and the one-line `to_ascii_uppercase` / `trim_prefix('E')`.
  - `src/std/num.test.ts` compares 42 lines against a Rust program built with the pinned toolchain: 21 int inputs ×
    u16/u32 with error kinds, 15 paths, 6 trims (non-ASCII whitespace, NEL, ZWSP). All identical.
  - Not touched, for root: `rustc_session/options.ts` has its own `u8/u32/u64/usize_from_str` (bigint-based), and
    `rustc_errors/lib.ts` its own `str_trim`. Both could move to these later.
- **N5**: fixed, faithfully. `write_wrapping`'s `char_indices` is now a lazy cursor (`CharIndices.get(n)` decodes only
  as far as asked), as Rust's iterator is. Same output. Measured with the old file beside the new one, byte-identical
  output:

  | paragraph | old | new |
  |---|---:|---:|
  | 2,000 words | 6.6 ms | 1.0 ms |
  | 8,000 words | 64 ms | 0.8 ms |
  | 32,000 words | 946 ms | 2.9 ms |

  The 21 markdown tests pass, including `test_output` against the blessed `output.stdout`.
- **N6**: `list_metadata` no longer has the `unported`.
  - `String::from_utf8(v).unwrap()` becomes `Str.of_bytes(v.bytes()).toString()`. `VecU8` only ever holds `write!`s of
    JS strings, so the conversion cannot fail. PORT note as in `node_label`.
  - The two `fatal`s pair with upstream's by count. The first (`fatal(error.to_string())`) has no message literal to key
    on, so it carries `// rustc-call: 619:28` (`coverage.ts --check` validates it).
  - `-Zls=root missing.rmeta|libfoo.rs|-` with `-Ztrack-diagnostics` MATCH. The oracle prints no "created at" for these
    span-less fatals, so the location itself is not observable here.
- **N7**: nothing.

## 3. Generated `TargetModifier` codecs

- `tools/codegen/options.ts` emits, into `options.gen.ts`, `decode_<T>(__decoder: BlobDecoder)` and
  `encode_<T>(self, __encoder: Encoder)` for:
  - each `$tmod_enum` (`UnstableOptionsTargetModifiers`, 12 variants; `CodegenOptionsTargetModifiers`, 1);
  - `OptionsTargetModifiers` (2 variants, one field each);
  - `TargetModifier`: parsed from `pub struct TargetModifier { .. }` at options.rs:81. Fields in declaration order,
    built with the hand class's constructor. Field types it accepts: `OptionsTargetModifiers`, `String`. Anything else
    is an ERROR.
- The shapes follow rustc_macros serialize.rs `decodable_body` / `encodable_body`:
  - zero variants: the panic, no read; no write;
  - one variant: no tag;
  - 2..254 variants: a `u8` index;
  - 255 or more: `usize`;
  - then the variant's field. The panic texts are the derive's.
- The generator checks the derive lists: `#[derive(..)]` on `enum $tmod_enum` in `macro_rules! options`, on
  `enum OptionsTargetModifiers` in `macro_rules! top_level_options`, and on `struct TargetModifier`. Each must name
  `Encodable` and `BlobDecodable`, or it is an ERROR (`itemDerives` / `requireCodecDerives`).
- Removed: decoder.ts's hand-written `decode_TargetModifier`, `decode_OptionsTargetModifiers` and `decode_tmod_enum`
  (the recorded exception of 2026-11-11T03:13 can be closed), and encoder.ts's `unported` `encode_TargetModifier` stub.
  Both files now import the generated fns.
- `src/rustc_session/target_modifier_codec.test.ts`:
  - every one of the 13 values round-trips through `FileEncoder` / `MemDecoder`, with empty and non-ASCII value names,
    to the interned object;
  - exact bytes: `[0, 0, str]` BranchProtection, `[0, 9, str]` Sanitizer, `[0, 11, str]` SanitizerCfiMinimalRuntime,
    `[1, str]` TargetCpu (no inner tag);
  - bad outer and inner tags panic with the derive text.
- Oracle, rmeta bytes (`--emit=metadata` of a no_core lib; `cmp` of `libtm.rmeta`, plus `-Zls=target_modifiers` of
  each):
  - **byte-identical, port-encoded**: `-Zsanitizer=address`; `-Zindirect-branch-cs-prefix`; both together;
    `-Zindirect-branch-cs-prefix=yes -Zsanitizer=address,leak`; `-Zsanitizer=cfi -Zsanitizer-cfi-minimal-runtime
    -Zsanitizer-cfi-recover -Clto -Ccodegen-units=1 -Cembed-bitcode=yes` (x86_64-unknown-linux-gnu). On the host
    aarch64-apple-darwin: `-Zsanitizer=address`; `-Zbranch-protection=bti`;
    `-Zbranch-protection=bti,pac-ret,leaf -Zsanitizer=address`; `-Zpointer-authentication=+aarch64-jump-table-hardening`;
    the same on aarch64-unknown-linux-gnu; `-Ctarget-feature=+neon`; `-Ctarget-feature=+retpoline-indirect-calls` and
    the no-flag baseline (empty list).
  - That encodes 6 of the 13 variants: Sanitizer, IndirectBranchCsPrefix, BranchProtection, PointerAuthentication,
    SanitizerCfiMinimalRuntime, and two at once.
  - Error cases match too, with exit 1 and the same stderr: kcfi, reg-struct-return and regparm on x86_64.
  - The port cannot build with Retpoline, RetpolineExternalThunk, FixedX18, LlvmTargetFeature or TargetCpu. It stops at
    `rustc_codegen_llvm::llvm_util::configure_llvm (-Z retpoline | -Z fixed-x18 | -C target-cpu |
    -Z llvm-target-feature)`, before metadata. Not this lane.
  - i686 targets stop at `rustc_target::spec::targets::i686_unknown_linux_gnu`.
- Oracle, decoding: port `-Zls=target_modifiers` and `-Zls=all` on every oracle-built rmeta above, plus 3 more:
  - i686: `-Zsanitizer=address -Zretpoline -Ctarget-cpu=znver3 -Zregparm=3 -Zreg-struct-return
    -Zretpoline-external-thunk -Zindirect-branch-cs-prefix`;
  - aarch64-linux: `-Zfixed-x18 -Zbranch-protection=bti -Zsanitizer=kcfi -Zsanitizer-cfi-normalize-integers`;
  - `-Zllvm-target-feature=+avx2`.
  - **37/37 MATCH**. Together they decode all 13 variants and both groups.
- The rmeta suites have no case with target modifiers.
  - `rmeta-ui` / `check-ui` admit only aux crates with no directive other than `edition` / `no-prefer-dynamic`
    (harness/suites.ts `RMETA_UI_CORPUS`).
  - The 12 aux crates that carry target-modifier flags (`tests/ui/target_modifiers/auxiliary/*.rs`) all have
    `compile-flags`, so they are not in either suite. The hand cases above stand in for them.
  - The `rmeta-ui --sample 200` above is the regression check.
- Not done (review suggestion, not in the brief): moving `DeniedPartialMitigationKind`'s hand-expanded codecs
  (`options/mitigation_coverage.ts`) onto `emitEnumCodecs`. That needs that file, which is not mine. It is about 10
  generator lines plus deleting the hand pair; queue it with a lane that owns mitigation_coverage.ts.

## Files touched

- `src/rustc_driver_impl/lib.ts`: `handle_explain`, `list_metadata`, the `CantEmitMIR` branch, imports; local helpers
  removed.
- `src/rustc_driver_impl/diagnostics.gen.ts` (regenerated)
- `src/rustc_errors/markdown/parse.ts`, `src/rustc_errors/markdown/term.ts`
- `src/rustc_interface/metadata_temp_dir.test.ts`
- `src/rustc_metadata/rmeta/decoder.ts`, `src/rustc_metadata/rmeta/encoder.ts`
- `src/rustc_session/options.gen.ts` (regenerated); new `src/rustc_session/target_modifier_codec.test.ts`
- new `src/std/num.ts`, `src/std/num.test.ts`; `src/std/path.ts`, `src/std/str.ts`
- `tools/codegen/options.ts`, `tools/codegen/options.test.ts`
- `tools/codegen/diag_args.json`, `tools/codegen/types.sets.json`, new `tools/codegen/driver_impl.typemap.json`. These
  sit under `tools/` beyond `options.ts`, but they are the generator inputs item 1 needs: generated files are never
  hand-edited (PORTING §6).

Nothing under `harness/` or `scripts/` was touched.

## Coverage (`bun scripts/coverage.ts --missing <file> --offline`)

| file | before | after |
|---|---:|---:|
| rustc_driver_impl/src/lib.rs | 38/43 | 38/43 (left: `install`, `config`, `process_rlink`, `init_logger_with_additional_layer`, `install_ctrlc_handler`) |
| rustc_metadata/src/rmeta/encoder.rs | 95/95 | 95/95 |
| rustc_metadata/src/rmeta/decoder.rs | 156/156 | 156/156 |
| rustc_session/src/options.rs | 100/100 | 100/100 |
| rustc_errors/src/markdown/{parse,term}.rs | 20/20, 7/7 | 20/20, 7/7 |
| library/core/src/num/mod.rs | 0/40 | 2/40 |
| library/std/src/path.rs | 6/209 | 7/209 |
| library/core/src/str/mod.rs | 0/90 | 3/90 |

The compiler total is unchanged. The derive codecs are generated code with no `// rustc:` markers, like other derives.

## `unported(...)` left / removed

- removed:
  - `rustc_driver_impl::list_metadata (String::from_utf8(..).unwrap() on invalid UTF-8)`;
  - `rustc_driver_impl::diagnostics::CantEmitMIR (--emit=mir write error)`;
  - `rustc_session::options: Encodable for TargetModifier (target-modifier flags)`;
  - the generated `IntoDiagArg without a TS impl` in `UnstableFeatureUsage`.
- added: none.
- the stops that remain on paths I ran: `configure_llvm (-Z retpoline | -Z fixed-x18 | -C target-cpu |
  -Z llvm-target-feature)`, `verify_query_key_hashes (-Z incremental-verify-ich)` (now the metadata_temp_dir test's
  stop), `LlvmCodegenBackend::codegen_crate` (M7).

## `// PORT:` decisions

1. `Box<dyn Error>` is `IoError` for the `rustc_driver_impl` set (driver_impl.typemap.json; reasons in item 1).
2. N2: the pager's EPIPE stays unmodelled (no sync spawn API reports it; upstream is racy below the pipe capacity).
3. N6: `String::from_utf8(v).unwrap()` has no TS mirror (infallible). The other `fatal` gets a `rustc-call:` anchor.
4. `std/num.ts`: one checked loop instead of `can_not_overflow`'s unchecked fast path (same results); unsigned, radix
   10, `number` only.
5. num.test.ts keeps the Rust output as a string array, not a `String.raw` template. Bun's transpiler rewrites a
   non-ASCII char in source as a `\u` escape, which `raw` then keeps as text (seen with U+0661).
6. `decode_CodegenOptionsTargetModifiers(_decoder)` / `encode_*(_self, _encoder)`: the unit-like shapes name their
   unused parameters with `_`.

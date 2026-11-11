APPROVE WITH NITS

# Review: porter lane `driver-cli-2` (wave 40k)

Independent reviewer, read-only on code. Branch `t3/driver-cli-metrics-targetmodifier` at `9d6c0635` (commits `6738d1e1`,
`c10ec0e8`, `9d6c0635`), merge-base `92c72880`. Pin `6f5da406b56c`. AC power. Bun 1.4.4. `RUST_TS_AGENT=rev-dcli2
RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`, `--jobs 6`. No `GATE_RUNNING` at any point. Ad-hoc runs were
in my scratchpad. The one temporary edit (the mutation below) was reverted with `git checkout`, and the tree was clean
afterwards.

No must-fix findings. Every claim I re-ran held. The nits are about test sharpness and follow-up queueing.

## Reproduction

| check | result |
|---|---|
| `difftest --suite cli --jobs 6` | 2009: **MATCH 1991, DIFF 0, UNPORTED 18** (`runs/20261111-113540-rev-dcli2-2jig`). The 18 by kind: 11 `LlvmCodegenBackend::print` (code-models ×2, relocation-models ×2, stack-protector-strategies ×2, target-cpus ×1, target-features ×2, tls-models ×2); 2 `LLVMRustLLVMHasZstdCompression`; 1 `target_has_mnemonic`; 2 `all-target-specs-json` (`x86_64_unknown_linux_gnux32`); 2 `target-spec-json-schema`. All subsets are 100% except `print` (44/62). |
| `check-ui --sample 200 --jobs 6` (own agent) | MATCH 200/200 (`runs/20261111-114048-rev-dcli2-s45e`) |
| `rmeta-ui --sample 200 --jobs 6` (own agent) | MATCH 200/200 (`runs/20261111-114122-rev-dcli2-0bxt`) |
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24997; vendor 5311; library 735)` |
| `bun test ./src/std/result.test.ts` | 3 pass |
| the handoff's test list (driver_impl, errors, metadata, session, metadata_temp_dir, std, feature, options.test, diagnostics.test) | **694 pass, 0 fail, 0 skip** |
| `bun tools/codegen/options.ts --check` | up to date |
| options.ts from scratch (both `.gen.ts` deleted, regenerated) | byte-identical to the committed files |
| `types.ts rustc_driver_impl` / `rustc_codegen_ssa` regenerated into scratch | no body line differs; the only differences are `--out`-relative import paths |

## 1. `Box<dyn Error>` → `IoError` (rustc_driver_impl only)

- **Scope is right.** At the pin, `Box<dyn Error>` appears in a diagnostic field in only two crates:
  - `rustc_driver_impl/src/diagnostics.rs:114`: `UnstableFeatureUsage.error`. It is the only use in the crate, and the
    set's only file is `diagnostics.rs`, so the set-local typemap reaches this one field.
  - `rustc_codegen_ssa/src/diagnostics.rs:625-646`: eight `ExtractBundledLibsError` fields. These hold object/archive
    errors, not io errors, so a global map would be wrong.

  After my regeneration, codegen_ssa's fields are still `unknown /* dyn std :: error :: Error */`.
- **Every value really is an io error at the pin.** The only producer is `Features::dump_feature_usage_metrics`
  (`rustc_feature/src/unstable.rs:804`). It has two `?` sites:
  - `File::create(..)?` gives an `io::Error`.
  - `serde_json::to_writer(..)?`: serializing two `Vec`s of structs of `String`/`u128`/`Option<String>` cannot produce a
    data error. Any error is `Error::io`, which has `line: 0`, so `Display` is the io error's (`serde_json-1.0.145`
    `error.rs:330`, `:407-408`, `:353`).
- **The display text is the oracle's.** I compared stderr, exit code and output-dir listing with `rustc +nightly`:

  | case | result |
  |---|---|
  | missing dir (ENOENT, os error 2) | in the test, exact stderr |
  | mode-555 dir (EACCES, 13) | same: exit 1/1, stderr, files |
  | a file as the dir (ENOTDIR, 20) | same: exit 1/1, stderr, files |
- **`CantEmitMIR`** (`lib.ts:345-349`) matches `lib.rs:331-333`. `--emit=mir -o nope/x.mir` and `-o ro/x.mir` give the
  same exit, stderr and files as the oracle.
- The `diag_args.json` entry cites the right line (`diagnostic_impls.rs:71`, inside `into_diag_arg_using_display!`).

## 2. `metadata_temp_dir.test.ts`

- **The stop is where the header says.** The oracle `-Zincremental-verify-ich --emit=metadata` exits 0 and leaves only
  `liblibfoo.rmeta`. The port prints `rust-ts: unported: rustc_query_impl::incremental::verify_query_key_hashes (-Z
  incremental-verify-ich)`, exits 70, and leaves `liblibfoo.rmeta`. So the stop comes after `encode_and_write_metadata`
  (the rmeta has been renamed into place). It is in `tcx.finish()` (`context.ts:1965`), after the closure returned the
  Linker and before `link`.
- **Mutation.** I commented out `built_linker?.drop();` (`lib.ts:372`). The `-Zincremental-verify-ich` test fails with
  `d2/rmetaxAjdOa` left over. Reverted afterwards.
- **Will the stop stay?** It is the D3 (no dep graph / incremental) stop, and nothing in `docs/next.md` queues it. If it
  is ported, the test fails loudly (exit 0, not 70), so it cannot silently pass that way. The remaining gap is a
  *different* stop replacing it; see N1.

## 3. Generated `TargetModifier` codecs

- **Expansion rules.** I compared `emitEnumCodecs` with `rustc_macros/src/serialize.rs` `decodable_body` (:57-113) and
  `encodable_body` (:173-248). All match:

  | variants | decode | encode |
  |---|---|---|
  | 0 | the `"\`E\` has no variants to decode"` panic, no read | nothing |
  | 1 | no tag, then the field | no tag, then the field; nothing for a unit variant |
  | 2..254 | `read_u8` tag (`len < u8::MAX`) | `emit_u8` of the variant index |
  | ≥255 | `read_usize` | `emit_usize` |

  The panic text `invalid enum variant tag while decoding \`E\`, expected 0..N, actual n` is the derive's.
- **Variant order.** The tag order is the order of `UnstableOptionsTargetModifiers_discriminant`, which follows the
  upstream option order (`options.rs:2430` branch_protection … `:2854` sanitizer_cfi_minimal_runtime). That puts
  `SanitizerCfiNormalizeIntegers` (10) before `SanitizerCfiMinimalRuntime` (11), as upstream does. The `TargetModifier`
  struct writes `opt` then `value_name`, in declaration order (`options.rs:80-86`).
- **The guard works.** I ran mutation tests on scratch copies of the three upstream inputs, with `generate()` under a
  fake `RUST_TS_DATA`:

  | upstream change | result |
  |---|---|
  | `BlobDecodable` → `Decodable` on `TargetModifier` | ERROR `does not derive BlobDecodable` |
  | `Encodable` dropped on `OptionsTargetModifiers` | ERROR |
  | both dropped on `$tmod_enum` | ERROR |
  | `Encodable` → `Encodable_NoContext` | ERROR |
  | a path inside the derive list | ERROR `unsupported derive list` |
  | `value_name: Symbol` | ERROR `unsupported TargetModifier field type` |
  | `opt: Vec<..>` | ERROR |
  | an extra `String` field | accepted; caught only by `tsc` (see N6) |
  | a second, unrelated `#[derive(Hash)]` | accepted; correct |
- **Encode, against the oracle** (`--emit=metadata` of an item-free `no_core` lib, `cmp` of `libtm.rmeta`). All
  **IDENTICAL**, with the same exit and stderr:
  - `-Zsanitizer=address` (1123 B);
  - `-Zbranch-protection=bti,pac-ret` (1127 B);
  - `-Zpointer-authentication=+aarch64-jump-table-hardening` (1145 B);
  - `-Zbranch-protection=bti -Zsanitizer=address` (1130 B);
  - x86_64-linux `-Zindirect-branch-cs-prefix -Zsanitizer=address,leak` (1136 B);
  - x86_64-linux `-Zsanitizer=cfi -Zsanitizer-cfi-minimal-runtime -Zsanitizer-cfi-recover -Clto -Ccodegen-units=1
    -Cembed-bitcode=yes` (1127 B);
  - the no-flag baseline (1111 B).

  That covers all 5 variants the handoff names, plus two at once, which the handoff counts as its sixth.
- **Decode, against the oracle.** The oracle built 5 rmetas that together carry all 13 variants and both groups:
  - i686: Sanitizer, Retpoline, RetpolineExternalThunk, Regparm, RegStructReturn, IndirectBranchCsPrefix, TargetCpu;
  - aarch64-linux: FixedX18, BranchProtection, Sanitizer=cfi, SanitizerCfiNormalizeIntegers;
  - `-Zllvm-target-feature=+avx2`;
  - cfi-minimal-runtime;
  - pointer-authentication + pac-ret.

  The port's `-Zls=target_modifiers` and `-Zls=all` give **10/10 MATCH** (stdout+stderr, exit). One more build, the
  handoff's `-Zsanitizer=kcfi` on aarch64-linux, fails in the oracle itself (`requires -C panic=abort`). The port fails
  identically, exit 1/1, same output.
- `target_modifier_codec.test.ts` passes, and its exact-byte cases agree with the oracle rmetas above.

## 4. std moves

- **Markers.** `// std:` markers are correct at the pin:
  - `core/src/num/mod.rs:1645` `from_str`; `:1788` `from_ascii_bytes_radix_impl`;
  - `std/src/path.rs:2960` `extension`;
  - `core/src/str/mod.rs:2185` / `:2224` / `:2263` `trim` / `trim_start` / `trim_end`.
- **`num.ts` against upstream.** It follows the checked loop (`:1840-1850`): `checked_mul` is computed before the digit
  check, the digit error wins, then the mul overflow, then the add overflow. `"99999999999x"` → `PosOverflow` agrees.
  `[b'+' | b'-']` → InvalidDigit. `-` is not a sign for unsigned types. The single-loop PORT note is sound: the unchecked
  path gives the same results when it cannot overflow.
- **`path_extension`** is `file_name().map(rsplit_file_at_dot).and_then(|(b, a)| b.and(a))`.
- **The 42-input test is sound.** I wrote my own Rust program with the same inputs and format, built it with `rustc
  +nightly` (6f5da406b) and ran it. Its 42 lines are byte-identical to the test's `RUST` array, which I extracted by
  evaluating the array literal.
- **No behaviour change elsewhere.** The removed locals are equivalent at their call sites:
  - `markdown/parse.ts`: `str_trim*` is the same code as `string_trim*`. `parse_u16`'s `undefined` is exactly the `Err`
    cases.
  - `lib.ts`: `parse_u32` the same way. `path_extension` is only compared with `"rs"`.

  `term.ts`'s `CharIndices` keeps upstream's `nth`/`find` positions (`iter_pos = ch_count + 1`), and the 21 markdown
  tests, including `test_output`, pass. No other module is in the diff.

## Findings (must fix)

None.

## Nits

- **N1** `src/rustc_interface/metadata_temp_dir.test.ts:44`: assert the stop's identity, e.g.
  `toContain("verify_query_key_hashes")`, not just `"rust-ts: unported:"`.
  - Today any `unported` stop after `encode_and_write_metadata` passes this test. That includes one before the Linker
    exists that is cleaned up by another `catch`.
  - The test's title and header promise the post-Linker path specifically.
- **N2** `src/rustc_interface/metadata_temp_dir.test.ts:21` `leftovers()`: it scans the whole shared `cwd`. Under the
  mutation, test 3 (`-Zmetrics-dir`, a different exit) also failed on test 2's `d2/rmeta*`. Checking leftovers per
  output dir (`d2`, `d3`) would make each test point at its own exit.
- **N3** `tools/codegen/diag_args.json:30`: the `Box` entry is global and keys on the source spelling `dyn Error`. It is
  correct today, and a wrong-type reach would fail `tsc`. But when M7 lanes give codegen_ssa's
  `Box<dyn std::error::Error>` fields a TS type, they must not reuse this entry: those errors' `Display` is not
  `display_IoError`. Put a line in the codegen_ssa lane brief.
- **N4** Duplicate helpers remain, as the brief expected:
  - `src/rustc_session/options.ts:113-160`: its own `IntErrorKind` type and bigint-based `u8/u32/u64/usize_from_str`.
    Its `u32_from_str` has the same name as `src/std/num.ts:53` but returns `Result<number, IntErrorKind>`, not
    `Result<number, ParseIntError>`. Two same-named exports with different error shapes invite a wrong import.
  - `src/rustc_errors/lib.ts:247`: `str_trim`, code-point based, same results as `string_trim`.
  - Other local trim/parse copies worth a sweep (not each checked against `str::trim`): `rustc_abi/lib.ts:65`
    `parse_u32`, `rustc_ast/util/comments.ts:166,177`, `rustc_middle/mir/pretty.ts:160`, `rustc_resolve/rustdoc.ts:387`,
    `rustc_parse/parser/expr/diagnostics.ts:236`, `rustc_attr_parsing/attributes/rustc_internal.ts:865`.
- **N5** `src/rustc_feature/unstable.ts:177` (not this lane's file; the handoff already flags it): the port reports a
  `writeSync` error.
  - Upstream's `BufWriter` loses a write error on JSON of ≤ 8 KiB in the drop's flush.
  - This lane removed the stop that used to mask the difference, so on ENOSPC/EIO the port now prints `cannot dump
    feature usage metrics` where the oracle exits 0.
  - Rare, but queue it with a rustc_feature owner.
- **N6** `tools/codegen/options.ts:1417`: `genTargetModifierCodecs` accepts any number of `String` /
  `OptionsTargetModifiers` fields and emits `new TargetModifier(f1, …, fn)`. A field added upstream is caught only by
  `tsc` (constructor arity), not by the generator's own ERROR. Optionally require exactly the fields the hand class
  declares.
- **N7** Scope note for root: besides `options.ts`, the lane edited `tools/codegen/diag_args.json`,
  `tools/codegen/types.sets.json`, and the new `tools/codegen/driver_impl.typemap.json`. They are generator inputs that
  item 1 of the brief needs, the handoff discloses them, and none is under `harness/` or `scripts/`. I see no issue, but
  PORTING §1 lists `tools/` as off-limits to porting lanes, so record the exception when integrating.

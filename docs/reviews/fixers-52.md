APPROVE WITH NITS

# Review: lane `fixers-52` (wave 40l), queued review findings

Reviewer: independent, read-only. Branch `t3/fixer-review-findings` at `c936b424` (commits `c9919f48`, `64ed2861`,
`fcf84a2b`, `3305280b`, `c41ac772`, `c936b424`). The diff was read as `git diff b3772ebb...c936b424` against the pin
(`6f5da406b`), upstream `library/` and serde_json 1.0.145 (the version in upstream's `Cargo.lock`), and against the
findings named in the brief. No STOP was open.

## Findings (must fix)

None.

## Nits

- **N1** `src/rustc_session/session.ts:1268-1269` and `:1364-1368`. Two comments still say that
  `PointerAuthConfig`/`PointerAuthSchema` "is not ported". This lane ported both types (`:105-174`), so the comments
  are now stale. What stays unported is their constructors (`from_raw` and the defaults).
  - With the types in place, the `validate_commandline_args_with_session_available` check (upstream session.rs:1560-1571)
    can be ported as written: `function_pointers?.discrimination_kind === "Type"` →
    `PointerAuthenticationTypeDiscriminationNotSupportedForTarget`. The generated diagnostic already exists
    (`diagnostics.gen.ts:563`). Today the check is an `unported` stop.
  - The check is unreachable either way, because `build_session` stops first, so this is cosmetic. A later rustc_session
    lane can do it.

## What I checked

### 1. The shared `f64_fixed1` (`src/std/fmt.ts:560`)

- **Algorithm.** The function rounds `v * 10` exactly in BigInt, on the binary value, with ties to even, and then prints
  `q/10 . q%10`. That is `flt2dec::to_exact_fixed_str` at precision 1.
  - Sign follows `Sign::Minus`: a `-` for a negative value and for `-0.0`.
  - NaN prints `NaN`; infinities print `inf` / `-inf`.
  - Subnormals use exponent `1 - 1075` with no hidden bit, which is correct.
  - For `e >= 0` the value is an exact integer, so large values come out exact.
  - Exact ties at one decimal place can only be `odd/4`, and the remainder test `r2 === den && q odd` handles them.
- **My own oracle comparison.** The value set is disjoint in construction from the lane's 16,779 (splitmix64 with a
  different seed). There are 23,500 values:
  - 6,000 raw 64-bit patterns, covering NaN payloads, ±inf, subnormals and the full exponent range;
  - 1,000 random subnormals with either sign;
  - 3,000 exact ties `k/4` (odd `k` up to 2^55), each with its ±1-ulp neighbours, which adds 3,146 ties in all;
  - 2,000 decimal literals ending in `.d5`, `.d05`, `.d95`, `.d45`, `.d49999999` or `.d50000001`, at magnitudes up to
    10^16;
  - 500 powers of ten up to 10^308 with either sign, and 500 values around 2^50 to 2^69 with ulp neighbours;
  - 500 values next to the 0.05 round-to-zero boundary;
  - 1,000 widened f32 patterns;
  - 1,000 `a*100/b` percentages.

  I compiled a Rust program with `rustc +nightly` (1.101.0-nightly 6f5da406b) that prints `{:.1}` of each bit pattern,
  and compared its output with `f64_fixed1`. **23,500 agree, 0 differ.** The set includes 6 NaNs and 1,003 subnormals.
  The `fmt.test.ts` cases cover -0.0 and ±inf.
- **Marker.** `// std: library/core/src/fmt/float.rs:36 float_to_decimal_common_exact` resolves: line 36 at the pin is
  that fn's `fn` line. Strictly, the entry point is `float_to_decimal_display` (:87), which picks `Sign::Minus` and then
  calls this fn. The doc comment spells out that chain, so the marker is acceptable.
- **Copies removed.** The copies in `thousands/mod.ts` and `ty/context.ts` were identical to the shared function, apart
  from how they read the bits (`DataView` there, `F64_SPEC.to_bits` here). `encoder.ts` and `input_stats.ts` now
  import the std one. `tsc` confirms that nothing still imports the thousands export.

### 2. The N4 helper consolidation

- **`std/num.ts` parsers.**
  - Checked against `from_ascii_bytes_radix_impl` (core num/mod.rs:1788):
    - a lone `+` or `-` is `InvalidDigit`;
    - a `-` on an unsigned type falls through to `InvalidDigit`;
    - in the checked loop, the multiplication is computed first, then the digit is checked (`InvalidDigit` wins), then
      the overflow;
    - the unchecked fast path gives the same results.
  - `NonZero::from_str` (nonzero.rs:1612): the parse, then `Zero`.
  - `Display` (error.rs:138): the texts are verbatim. `NotAPowerOfTwo` is not modelled; its note is correct.
  - The removed local copies are equivalent to std's. I traced:
    - options.ts `uint_from_str`: digit check, then `>max` after the add;
    - rustc_abi `parse_uint` and Apple `parse_uint`: a lone `+` is not stripped, so it becomes `InvalidDigit`;
    - util.ts `u16_parse`: it gave `None` exactly when std's `u16` parse fails.

    Overflow is reported at the same digit as before, and a non-digit is reported before overflow.
- **`{ kind }` shape.**
  - Every caller of the moved parsers either reads `.kind` or passes the error to `display_ParseIntError`, which reads
    `.kind`:
    - `options.ts:1482` (`parse_treat_err_as_bug`);
    - `attributes/util.ts:88` (`parse_limit_int`);
    - `attributes/stability.ts:511`;
    - `miri.ts:746,766,800,807,852,861`;
    - `rustc_abi/lib.ts:967,975`;
    - `rustc_session/diagnostics.ts:71`.
  - `options.gen.ts` imports `u32/u64/usize_from_str` through the `options.ts` re-export, and passes them only to
    `parse_number`/`parse_opt_number`, which now take `Result<T, ParseIntError>`.
  - I grepped `src/` and `tools/` for `=== "Empty"|"InvalidDigit"|"PosOverflow"|"NegOverflow"|"Zero"` and for
    `case "…"` outside a `.kind`. The only hits are other enums (`$` tags, region kinds, `angle_brackets`).
  - No `IntErrorKind` import from options.ts remains. `rustc_driver_impl/lib.ts:422` `parse_isize` keeps its own string
    kind, which is unchanged and has its own formatter.
- **Trim, code points → UTF-16 units.**
  - `is_whitespace` over all of 0..=0x10FFFF is exactly the 25 `White_Space` scalars (9-d, 20, 85, a0, 1680,
    2000-200a, 2028, 2029, 202f, 205f, 3000). All are in the BMP, and none is in D800-DFFF.
  - So for any string, a unit walk and a code-point walk stop at the same index. A surrogate unit and an astral code
    point are both non-whitespace.
  - The one divergence is `comments.ts`'s old end trim. When `t[j-1]` is a lone low surrogate after whitespace, its
    `codePointAt(j-2)` read the whitespace and dropped the surrogate. It needs a lone surrogate, which a Rust `&str`
    cannot hold, and these strings come from `Symbol.as_str`, which is UTF-8 source text. Not reachable.
- **Sample difftests** (`RUST_TS_AGENT=review-fixers-52`, `--sample 200 --jobs 6`, AC power, no gate running):

  | suite | result | run |
  |---|---|---|
  | check-ui | 200/200 MATCH | `runs/20261111-214104-review-fixers-52-ncic` |
  | rmeta-ui | 200/200 MATCH | `runs/20261111-214134-review-fixers-52-mnd9` |
  | cli | 200/200 MATCH (explain 54, explain-color 62, crate-root-lint-levels 73, print 5, print-unstable 1, ls 5) | `runs/20261111-214204-review-fixers-52-rcdr` |
  | miri-pass | 199 MATCH, 1 UNSTABLE (`tests/panic/panic1.rs`, oracle not reproducible); all 199 sampled protected cases MATCH | `runs/20261111-214246-review-fixers-52-cn2e` |

### 3. N5: `dump_feature_usage_metrics` (`src/rustc_feature/unstable.ts`)

- **Buffer size.** `DEFAULT_BUF_SIZE` at the pin is `8 * 1024` (library/alloc/src/io/read.rs:787; 512 only on espidf).
  `BufWriter::new` passes it to `with_capacity` (bufwriter.rs:98-99). A `Vec<u8>` of that capacity holds exactly
  8,192 bytes. Nothing is guessed.
- **Flush points.** These match bufwriter.rs at the pin:
  - `write_all` buffers when `len < spare` (:575);
  - otherwise `write_all_cold` (:430) flushes when `len > spare`, then writes straight through when
    `len >= capacity`, else buffers;
  - `flush_buf` (:208) loops `inner.write`: `Ok(0)` → `WriteZero` "failed to write the buffered data", `Interrupted`
    retries, and the `BufGuard` keeps the unwritten tail;
  - the direct path is `File::write_all`, the default `Write::write_all`: `Ok(0)` → "failed to write whole buffer";
  - `Drop` (:712) runs `let _r = self.flush_buf()` when `!panicked`, so its error is dropped.
- **When an error surfaces.** `serde_json::to_writer` never flushes. So an error can reach the caller only from a write
  made during serialization, which happens only once the output outgrows the buffer. For JSON of at most 8 KiB, the
  error is lost, as upstream.
- **Close order.** The writer is moved into `to_writer` and dropped inside it, before the file is closed. The port flushes
  and then calls `closeSync`, in the same order, on both the error path and the success path.
- **serde_json write sequence**, checked against serde_json-1.0.145 `ser.rs`:
  - `begin_object_key` writes `,` when not first;
  - a key is `format_escaped_str`: `"`, the runs and each escape as a separate `write_all`, then `"`;
  - `begin_object_value` writes `:`;
  - `write_u128` is one `itoa` write;
  - `None` is `null`;
  - `begin_array_value` writes `,`;
  - an empty `Vec` gives `[` then `]` (`serialize_seq(Some(0))`, then `end` on `State::Empty` writes nothing).

  The escape table and `write_char_escape` agree with the port: `\"`, `\\`, `\b`, `\t`, `\n`, `\f`, `\r`, and
  `\u00xx` with lowercase hex for other bytes below 0x20. 0x7f is not escaped. The port's JS slices split only at ASCII
  positions, so the byte fragments are the same.
- `rustc_feature` tests pass, including the 4 new ones. The `metadata_temp_dir.test.ts` missing-dir test also passes.

### 4. ssa-contract N4: pointer-auth types and accessors (`src/rustc_session/session.ts`)

- **Types.** They match upstream session.rs:89-162:
  - `PointerAuthARM8_3Key` (:90) with discriminants 0..3;
  - `PointerAuthDiscrimination` (:98);
  - `PointerAuthAddressDiscriminator` (:110), whose `Synthetic(u64)` is a `bigint` with a PORT note;
  - `PointerAuthSchema` (:118), whose `u16` field is a `number`;
  - `PointerAuthConfig` (:146), with all 11 fields in order and their doc comments.

  The five `rustc-type:` lines are the right upstream lines.
- **Accessors.** The three accessors (:1267, :1271, :1275) are `is_some()`, `.and_then(|c| c.function_pointers)` and
  `.and_then(|c| c.init_fini)`.
- **`build_langcall`.** It now calls the real accessor, and the `never` alias is gone.
- **The "nothing reaches them" claim is correct.** The constructors are `function_pointers_default`,
  `init_fini_default`, `PointerAuthConfig::default` and `calculate_pauth_abi_version`, and they are reached only from
  `from_raw` (:231). `build_session` (`session.ts:1270`) types `pointer_auth_config` as the literal `undefined`: it is
  `undefined` for any `cfg_abi` other than `Pauthtest`, and an `unported("…from_raw (pauthtest target)")` stop otherwise.
  Upstream's `from_raw` returns `None` for every non-Pauthtest target before it touches a constructor, so the port
  agrees everywhere it runs. `tsc` would reject any other `Session` construction that put a non-`PointerAuthConfig`
  value in the field. See N1 for the stale comments nearby.

### 5. fixers-51 N2: the `-5` stop code (`src/std/thread.c:103`, `thread.ts:182`)

- Upstream (`library/std/src/sys/thread/unix.rs:59-83`) has two asserts:
  - `assert_eq!(n, libc::EINVAL)` panics while the `DropGuard` is live;
  - the guard's `assert_eq!(libc::pthread_attr_destroy(..), 0)` then runs during unwinding, and if it fails, the process
    aborts.
- The `-1` path (line 114) is different. There the `Err` is returned normally, so a failing destroy is an ordinary
  panic, which is `-4`.
- So the new distinct `-5` is the right split, and the existing codes keep their meaning:
  - `-1` is the `Err`;
  - `-2`, `-3` and `-4` are single panics;
  - `-5` is panic-then-abort;
  - `pthread_create` errors are > 0.
- `spawn_error`'s messages pair with each code, and every code ends in the same `unported("std::thread::spawn (…)")`.
  The new test checks -3, -4 and -5.

### 6. Toolchain checks (on `c936b424`, detached in my worktree)

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check` | markers ok (25,789) |
| `bun scripts/coverage.ts --order` | report only: 973 out of order in 199 file pairs. None involves the lane's moved fns. The `session.ts` row (2, first `target_can_use_split_dwarf:808`) predates the lane. The new accessors follow `sanitizers:1263` in order. |
| `--order --require-clean src/rustc_passes/input_stats.ts` | no inversions (stats N1) |
| `bun test ./src/std/result.test.ts` | 3 pass, 0 fail |
| touched crates' tests: `src/std`, rustc_feature, rustc_session, codegen_ssa `common.test.ts` and `mir`, `metadata_temp_dir.test.ts`, rustc_passes, thousands, obligation_forest, rustc_attr_parsing, rustc_target, rustc_abi, rustc_errors, `rustc_ast/util`, `miri/bin/miri.test.ts`, rustc_metadata, `rustc_middle/mir`, rustc_resolve, rustc_parse, rustc_hir_typeck, `rustc_borrowck/region_infer`, `vendor/intl_pluralrules` (`RUST_TS_REQUIRE_PROBES=1`) | **2,294 pass, 0 fail**, 0 skipped, 150 files |

### Other items in the brief

- **stats N3.** The staleness test asserts that the probe exists before calling `probeOutput()`, so `die` cannot be
  reached from the test.
- **stats N4.** `is_size` is `>= 0` and has its own test.
- **driver-cli-2 N1.** The stop's identity is asserted, and the string matches `rustc_query_impl/incremental.ts`.
- **driver-cli-2 N2.** `leftovers(sub)` scans only the test's own output dir. The temp dir is created directly there,
  so the non-recursive scan is right.
- **driver-cli-2 N6.** It is correctly left to a `tools/` batch, with a concrete suggestion in the handoff.
- **ssa-contract N2.** The `IntrinsicResult` companion const now has a frozen `WroteIntoPlace`.
- **fixers-51 N4.** Both double blank lines are removed.
- **Root's concern.** The file-ownership spill-over listed under "For root" is limited to import repoints, `.kind` reads
  and deleted duplicates. I saw no logic change in those files beyond what is described above.

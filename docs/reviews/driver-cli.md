APPROVE WITH NITS

# Review: porter lane `driver-cli` (wave 40j)

Reviewer: independent, read-only on code. Branch `t3/port-driver-cli` at `2c011c48` (port `48bdce42`, handoff
`797ef951`, `2c011c48`), diffed against merge base `0ce28aa2`. Pin `6f5da406b56c`. I checked the code against
`$RUST_TS_DATA/rust` at the pin, function by function. The runs used a detached checkout of the branch with lane
harness-cli's `harness/cli.ts` (branch `t3/add-cli-report-suite`, `a162f53c`) laid over it, and
`RUST_TS_AGENT=review-driver-cli`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `--jobs 6`, on AC power.
I removed the harness files before running `tsc`, the marker check and the unit tests, so those ran on the branch alone.

No must-fix findings. The nits below are follow-ups for root, not reasons to hold the merge.

## Reproduced results (my runs)

| run | result | run dir (`$RUST_TS_DATA/runs/`) |
|---|---|---|
| `cli --filter explain`: `--explain` of all 518 codes, plus 130 removed codes and `e0001`/`0001` | **650/650 MATCH** | `rv-dcli-explain` |
| same, `explain-color`: all 518 codes with `--color always` (no tty, so `show_colored_md_content`) | **518/518 MATCH** | `rv-dcli-explain` |
| `cli --filter W-help` (`-W help` with no input and with the trivial input) | **2/2 MATCH** | `rv-dcli-whelp` |
| `cli --filter crate-root-lint-levels --sample 50 --seed rv-dcli-7` (check-ui's aux crates; a different corpus and seed from the lane's) | **50/50 MATCH** (49 check-ui crates + 1 on the trivial input) | `rv-dcli-crll` |
| `cli --filter ls=`: `-Zls=root`/`all` on the 19 M5 aux rmetas | **38/38 MATCH** | `rv-dcli-ls` |
| `cli --filter print` (includes `calling-conventions` on host and x86_64-linux) | 56 MATCH, 18 UNPORTED, **0 DIFF**. Both `calling-conventions` cases MATCH. The 18 are all outside this lane: codegen-backend kinds (`target-cpus`, `target-features`, `relocation-models`, `code-models`, `tls-models`, `stack-protector-strategies`, `backend-has-zstd`, `backend-has-mnemonic`), `all-target-specs-json` and `target-spec-json-schema` | `rv-dcli-print` |
| `check-ui --sample 200` | **200/200 MATCH** | `rv-dcli-checkui` |
| `rmeta-ui --sample 200` | **200/200 MATCH** | `rv-dcli-rmetaui` |
| `bunx tsc --noEmit -p .` | clean | |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24997; vendor 5311; library 722)` | |
| `bun test ./src/std/result.test.ts` | 3 pass, 0 fail | |
| `bun test src/rustc_errors/markdown` | 21 pass (includes `test_output` against the blessed `output.stdout`) | |
| `bun test src/rustc_driver_impl src/rustc_errors` | 348 pass, 0 fail | |
| `bun test src/rustc_metadata src/rustc_session` | 247 pass, 0 fail | |

Environment and tty probes, run by hand (`$SCRATCH/probe/cmp.sh`). Oracle `rustc +nightly` and the port ran with the
same argv and env. The tty cases ran through `script -q /dev/null`, which merges stdout and stderr into the pty. All
**15/15 + 2 MATCH** (stdout, stderr, exit):

- tty: `PAGER=cat` × `--color={auto,always,never}`; a missing pager (`/nonexistent/pager`) × auto/never, which falls
  back to the pretty output on stdout even for `never`, as upstream does; `PAGER="cat -v"` (a program named with a space,
  so spawn fails on both sides); `PAGER=""`; `PAGER=true`; `PAGER=false --color=always`; `E9999` with
  `CLICOLOR_FORCE=1` and with `NO_COLOR=1` (the emitter's colour choice on a tty stderr).
- no tty: `NO_COLOR=1 --color=always`, `CLICOLOR_FORCE=1` (auto), `TERM=dumb --color=always`, and `E9999` with
  `CLICOLOR_FORCE=1` and with `--color=always`.
- `PAGER` unset (so `less -R`) hangs inside `script` on **both** sides, because `less` waits on the pty. I stopped it, so
  that case is unchecked. The lane's six pty cases did not include `less` either.

## 1. Fidelity

**markdown/mod.rs → mod.ts.** `parse_str`, `write_anstream_buf`, `create_stdout_bufwtr` (`AutoStream::always(stdout)`)
and `From<Vec<MdTree>>` are faithful. `MdTree`'s variants are in upstream order. `Debug` is not ported (PORT 8). That is
fine: it is printed only by a failing upstream unit test.

**markdown/parse.rs → parse.ts.** All 20 fns are in order, with correct markers. I checked:

- the `match (top_blk, prev)` arms in `parse_recursive`. The if-chain keeps the arm order. Once a guard matches, the arm
  is taken even if its parse fails, as in Rust: a failed `parse_heading` gives `None` and does not fall through. The
  tuple patterns (`(true, Newline)`, `(_, Newline | Whitespace)`, ...) all match upstream's.
- `next_prev` checks `\\` before `is_ascii_whitespace`.
- `u8::is_ascii_whitespace` excludes `\x0B`, as Rust's does.
- `prev_buf` uses the `wip_buf.len() - loop_buf.len()` arithmetic on `subarray` views.
- the anchor arm's `disp.chars().all(|ch| LNK_CHARS.contains(ch))`. `chars_all` iterates code-point *strings*, so
  `includes` is a character test, not a number coerced to a string.
- `parse_codeblock`: the end pattern `\n` + seps, an all-ASCII-whitespace rest of line, and `trim_matches('\n')`.
- `parse_heading` keeps the `&buf[1..]` panic when `#` ends the buffer (`slice_from`, same panic text).
- `get_indented_section`, `unordered_list_start`.
- `ord_list_start`: `take(10)`, `from_utf8(..).ok()?`, `get(pos + 1)?`, and `parse::<u16>`, which takes a leading `+`
  and rejects `-`.
- `parse_any_link`'s arm order.
- `normalize`. The `dedup_by` port compares with the original previous element, not the last kept one. That is the
  same for a chain of `ParagraphBreak`s, since equality is transitive there. Also checked: the `windows(3)` keep mask
  padded with `true` at both ends; and the insertion offsets `idx + insertions`, with `insertions` incremented before
  use.
- `should_break`'s arm order. The final `else` is reachable only for `LineBreak`.
- `expand_plaintext`: the per-item `pop` inside the REPLACEMENTS loop, `split` with a non-empty pattern, and the
  `char::is_whitespace` trims.
- `trim_extra_ws`: byte positions, which equal UTF-16 indices because only ASCII is skipped.

**markdown/term.rs → term.ts.** All 7 fns are faithful. **Width:** upstream never reads `COLUMNS` or the tty size.
`WIDTH` is the constant 140, and only `tests/term.rs` sets it. The port matches: a module `let WIDTH = 140`, and
`WIDTH_set` is used only by the test, which restores it. The tty and non-tty paths therefore wrap identically at 140,
which the 518 `explain-color` matches and the pty cases confirm.

`write_wrapping` keeps:

- `iter.nth(ch_count)` and the reverse search over `to_write[..end_idx]` for whitespace, `_` or `-`;
- the forward search from `ch_count + 1` in the no-break branch;
- `get(ws_idx + 1..)` → `""` when the index is not a char boundary (multi-byte whitespace) or is past the end;
- the `&b"          "[..indent]` panic for `indent > 10`;
- the OSC-8 link prefix and suffix.

The `usize` subtraction note at term.ts:226 is correct. `CURSOR` grows only in the "entire line" branch, by at most
`ch_count`, and code blocks leave it alone. The ANSI output goes through the vendored anstyle `Style::render`
/`render_reset`. Heading styles, `{base:<4}` and the `HorizontalRule` `unwrap` are faithful.

**highlighter.rs → highlighter.ts.** All 3 fns are faithful. I checked:

- PRIMITIVE_TYPES and KEYWORDS, verbatim and in order;
- the 8 colour consts;
- the `prev_was_special` path (Blue; cleared on any token other than `" "`);
- the Ident overrides in upstream order: keyword, then `use`, then the next byte `(`, then `derive`, then a first char
  `is_uppercase`, then primitive. The last one wins, as in Rust.
- the green literals: `Str | Char | RawStr | CStr`, so byte strings, raw byte strings and raw C strings fall through
  to BrightRed, as upstream does despite its comment;
- other tokens: BrightWhite + DIMMED;
- the shebang strip, with `len_accum` starting at `stripped_idx` and slicing the *unstripped* code.

**lib.rs.**

- `handle_explain`: ASCII uppercase, `trim_prefix('E')` (one `E`), `parse::<u32>`, the `MAX_AS_U32` bound,
  `lines()`, the dedent by `char::is_whitespace`, the code-fence toggle and the `# ` hiding. The tty check is
  `isatty(1)`.
- `show_md_content_with_pager` and `show_colored_md_content`: faithful apart from PORT 5 (N2).
- `list_metadata`: `Path::extension`, which handles `..`, a leading dot and `foo.`; the Cargo note; and
  `fatal(error.to_string())`.
- `describe_lints`, `sort_lints`, `sort_lint_groups`: `{:7.7}` both pads and truncates; `"warnings".len()` in the
  second max; the four `match` arms, including the panic arm.
- `dump_feature_usage_metrics` and the two `print_crate_info` branches match upstream line for line.
- The `DynLintStore::lint_groups_iter` marker in session.ts is right (session.rs:84).

**rmeta decoder.**

- The `lang_items` arm matches decoder.rs:846: `(LocalDefId, LangItem)` (mod.rs:288), `DefPath::make` through
  `def_keys`, the missing items, and the trailing `"\n"`.
- The `target_modifiers` arm matches decoder.rs:951, with no trailing blank line, as upstream.
- No file outside the lane's assignment changed: no `src/std`, `harness/`, `scripts/` or `tools/`.

## 2. Environment dependence (item 4)

The pinned upstream reads exactly one variable on this path: `PAGER`, via `env::var_os`, at lib.rs:472. `RUSTC_PAGER`
and `RUSTC_COLOR` do not exist at the pin (grep over `compiler/`). The colour variables (`NO_COLOR`, `TERM`,
`CLICOLOR`, `CLICOLOR_FORCE`) do not touch `--explain`'s stdout:

- `create_stdout_bufwtr` is anstream's `AutoStream::always`, which on non-Windows is `always_ansi` and checks no env.
- `--color=auto` without a tty prints the raw markdown.
- The `pretty_on_pager` decision looks only at the pager's name.

They matter only for the `early_fatal` of an invalid code on a tty stderr, which goes through the existing emitter
(`ColorConfig::to_color_choice` → anstream's `Auto`). The port follows this. It reads `PAGER` with the ported
`env::var_os` (libc `getenv`), and the tty test is the vendored anstream `Stdout::is_terminal` (`isatty(1)`). It did
not re-derive any env logic. The probes above cover each variable.

## 3. The hand-written `TargetModifier` decoder (item 3)

**Byte-for-byte check against the derive expansion.** `rustc_macros/src/serialize.rs:57` `decodable_body` is shared by
`BlobDecodable` (`blob_decodable_derive`, :19):

- A struct reads its fields in declaration order. `TargetModifier` (options.rs:80) is `{ opt: OptionsTargetModifiers,
  value_name: String }`, and `decode_TargetModifier` reads `opt`, then `decode_String`.
- An enum with 2 to 254 variants (`variants.len() < u8::MAX`) reads `read_u8() as usize`. It panics with ``invalid
  enum variant tag while decoding `X`, expected 0..N, actual n`` on a bad tag.
  - `OptionsTargetModifiers` (options.rs:239; variants from config.rs:386/388, in order `UnstableOptions`,
    `CodegenOptions`) reads a `u8` and maps 0 and 1 correctly, with the same panic text.
  - `UnstableOptionsTargetModifiers` has 12 variants. The generated `_discriminant` table (options.gen.ts:2265) lists
    them in options.rs declaration order: BranchProtection :2430, FixedX18 :2537, IndirectBranchCsPrefix :2588,
    LlvmTargetFeature :2644, PointerAuthentication :2766, RegStructReturn :2817, Regparm :2820, Retpoline :2834,
    RetpolineExternalThunk :2836, Sanitizer :2840, SanitizerCfiNormalizeIntegers :2848, SanitizerCfiMinimalRuntime
    :2854. So `decode_tmod_enum`'s sort by discriminant gives the derive's index order, and it reads one `u8`.
- A one-variant enum reads nothing (`[vi] => vi.construct(..)`). `CodegenOptionsTargetModifiers` is `TargetCpu` only,
  and `decode_tmod_enum` returns it without reading.

So the bytes consumed and the values built match the expansion exactly. The only gap is the zero-variant case (N3),
which no type here can reach. The lane's oracle-built rmetas with 6 modifiers across both groups, and my 38 `-Zls`
cases, agree.

**Advice to root: accept it now as a recorded exception, and queue a small `tools/codegen/options.ts` batch to generate
it.**

- **Precedent.** `src/rustc_session/options/mitigation_coverage.ts:140-177` already hand-expands `BlobDecodable` (and
  `Encodable`, lane encoder-d) for `DeniedPartialMitigationKind`, another type generated inside a macro by
  `tools/codegen/options.ts`. `docs/reviews/exported-symbols-codec.md:47` records hand-written `Decodable`s too. This
  lane follows the same pattern and says so in a PORT comment.
- **Effort is low.** `tools/codegen/options.ts` already emits, for `OptionsTargetModifiers` (:1126) and for each
  `$tmod_enum` (:1351), the `_discriminant` tables, `_cmp` and `debug_`, from the same variant lists the derive
  iterates. Emitting `decode_<E>`/`encode_<E>` next to them is roughly 30–40 generator lines plus a test against the
  committed `.gen.ts`: a `u8` tag when there are 2 or more variants, nothing for one, the `has no variants` panic for
  zero. `TargetModifier` is a hand-written class in `options.ts` (:297), so its two-field decode and encode can stay
  hand-written beside the class, or go through a `types.ts` set if root prefers.
- **When.** Do it in the batch that ports `encode_TargetModifier`, still `unported` at
  `src/rustc_metadata/rmeta/encoder.ts:2887`, so both halves come from one generator. Move
  `DeniedPartialMitigationKind`'s hand expansion over in the same batch, then delete the three functions this lane
  added to decoder.ts.

## Nits

- **N1** `src/rustc_metadata/rmeta/encoder.ts:2886`, not this lane's file: the doc comment on `encode_TargetModifier`
  still says "decoder.ts's decoder is unported too". That is stale after this lane. Fix it when the encoder is ported
  (see §3).
- **N2** `src/rustc_driver_impl/lib.ts`, `show_md_content_with_pager` (the `Bun.spawnSync` block, PORT 5): a failed
  write to the pager's stdin, when the pager exits before reading, is not observed, so that case does not fall back to
  stdout. This is documented. In practice it is unreachable, because the largest `--explain` output (about 8 KB
  coloured, for example E0277 at 5.2 KB) fits in the pipe buffer before the pager can exit. Keep the PORT note. If the
  limitation ever matters, `Bun.spawn` with a stdin sink that reports EPIPE would model it.
- **N3** `src/rustc_metadata/rmeta/decoder.ts`, `decode_tmod_enum`: for a zero-variant enum it would read a `u8` and
  panic with the "invalid enum variant tag" text, where the derive panics ``"`X` has no variants to decode"`` without
  reading. Unreachable (both enums are non-empty), and it goes away with generation (§3). It also re-sorts
  `Object.keys` on every call, which is harmless at this volume.
- **N4** `src/rustc_driver_impl/lib.ts` (`parse_u32`, `path_extension`) and `src/rustc_errors/markdown/parse.ts`
  (`parse_u16`, the `str_trim*` helpers): local copies of std behaviour (PORT 6). Each one is correct; I checked the
  leading `+`, the rejected `-`, overflow → `Err`, and `Path::extension`'s `..`, leading-dot and `foo.` cases. A
  later `src/std` batch should hoist them (`str::parse::<uN>`, `Path::extension`) so they are not duplicated again.
- **N5** `src/rustc_errors/markdown/term.ts`, `write_wrapping`: each loop iteration rebuilds `char_indices` of the
  whole remaining text, which is quadratic in a paragraph's length. Not observable, and explain texts are small. Leave
  it unless it shows in a profile.
- **N6** `src/rustc_driver_impl/lib.ts`, `list_metadata`: the `String::from_utf8(v).unwrap()` failure becomes
  `unported(...)` instead of upstream's panic. The lane argues it is unreachable (the buffer only ever holds UTF-8
  encodings of JS strings), and I agree. Acceptable as written: it avoids guessing the `FromUtf8Error` Debug text.
- **N7** Coverage note for root: one tty case remains unchecked, `PAGER` unset (so `less -R`), because `less` blocks
  inside `script` on both sides. The spawn and argv logic (`-R` exactly when the name is `less`) was checked by reading
  the code.

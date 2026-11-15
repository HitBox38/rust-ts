# Review: rg-fix-a (wave 40t, M7d): `rustc_fs_util::link_or_copy`, ripgrep release build

Reviewer: independent (AGENTS.md §1), read-only on code. Subject: branch `t3/ripgrep-release-build-port`, commit `ca078749`
on main `9c662b55`; handoff `docs/handoff/rg-fix-a.md`. Review branch `t3/review-rg-fix-a-v` (on `ca078749`),
`RUST_TS_AGENT=rv-rgfa-7q`, AC power throughout, no GATE_RUNNING.

## Verdict: **APPROVE WITH NITS**

The port of `link_or_copy` is faithful, the oracle test is sound, and the claims I reproduced hold: `cargo build --release`
of ripgrep 15.2.0 exits 0 with appendix C's G1 patch (scratch only), 33/33 rmeta byte-identical at one target path, pre-pass
IR identical for 3/3 crates checked, stderr 50/50, and the port-built `rg` matches the oracle's on every query I ran. No
regression in the checks run. Nits only: two mutants survive the unit test, and three comments in another lane's file are now
stale.

## 1. `link_or_copy`

- **Against upstream** (`compiler/rustc_fs_util/src/lib.rs:62`, read at the pin): same steps in the same order:
  `fs::hard_link(p, q)` → `Ok(Link)`; on error, only if `err.kind() == AlreadyExists`: `fs::remove_file(q)?` (error
  propagated), then a second `hard_link`, whose error is discarded, `Ok(Link)` on success; otherwise fall through to
  `fs::copy`. The comments are kept. The marker (`src/rustc_fs_util/lib.ts:23`) points at `:62`; `LinkOrCopy` (`:55`) is a
  fieldless enum as PORTING §5 says. `hard_link`/`remove_file` are src/std's ports (`src/std/fs.ts:1659`, `:1637`, over
  `link(2)`/`unlink(2)`), and `IoError_kind` maps `EEXIST` → `AlreadyExists` (`src/std/io.ts:210`) as std's
  `decode_error_kind` does. Errors are `Err(IoError)` values exactly as upstream; nothing is remapped.
- **The caller** (`src/rustc_codegen_llvm/back/write.ts:1106-1117`) matches `rustc_codegen_llvm/src/back/write.rs:1115-1124`:
  `EmitObj::Bitcode` → `link_or_copy(bc_out, obj_out)`, `CopyBitcode { err }` on error, then `ensure_removed(bc_out)` unless
  `emit_bc`. The old cross-lane stub is gone, and the per-crate stub count in `skeleton.test.ts` drops `rustc_fs_util`.
  `-C linker-plugin-lto` reaching `EmitObj::Bitcode` is upstream's own `ModuleConfig` logic (already ported, not changed
  here).
- **Oracle test** (`src/rustc_codegen_llvm/back/linker_plugin_lto.oracle.test.ts`): sound. It compares exit code, stderr,
  the complete file list of the output directory (so it also proves the `.bc` temp was removed and nothing else was left)
  and the 4-byte bitcode-wrapper magic, oracle first, and fails rather than skips under `RUST_TS_REQUIRE_PROBES=1`. Not
  comparing the bitcode bytes is right under plan-m7 D2. It is the test that catches "always copy" (mutant M1 below:
  exit 70). Its work directory is per agent and pid, removed in `afterAll`. Cost about 1.3–4 s.
- **Copy fallback: do not port it now.** It is reached only when the first `hard_link` fails with an error other than
  `AlreadyExists`, or the retry fails. `bc_out` and `obj_out` are both `temp_path_for_cgu` paths in the same output
  directory, so on APFS/HFS+ the link succeeds; only a file system without hard links (FAT/exFAT, some network mounts)
  reaches `fs::copy`. The other upstream callers (`rustc_incremental` `work_product.rs:33`, `rustc_metadata`
  `encoder.rs:2578`, `rustc_codegen_ssa` `write.rs:898`/`:2226`) are `-C incremental` paths, out of scope (plan-m7 D11) and
  still `unported`. **No protected suite and no M7d path (`rg-build`, `rg-behaviour`, `check-rg`, `pm-self`) reaches it.**
  Size if wanted later: `fs::copy` (`library/std/src/fs.rs:3198`) → `sys/fs/mod.rs:133` → the Apple `copy`
  (`sys/fs/unix.rs:2281`, about 70 lines: `fclonefileat`, falling back on `ENOTSUP`/`EEXIST`/`EXDEV` to `fcopyfile` with a
  `copyfile_state_t`), plus `open_from` (`:2065`) and `open_to_and_set_permissions` (`:2183`): roughly 150–200 TS lines and
  five new `bun:ffi` libc symbols (`fclonefileat`, `fcopyfile`, `copyfile_state_alloc/get/free`), in a src/std batch. Not
  worth a batch until something reaches it; the `unported` stop is correct.

## 2. Claims reproduced (scratch only; nothing committed)

Setup: a detached scratch worktree of `ca078749` with appendix C's `LLVMRustGetSymbols` patch only (G1 objects, plus the
llvm-nm bitcode branch, which `release` never takes); **not** the G3 `-non-global-value-max-name-size` tools change. Driver and
runner copied from appendices A and B (target `$RUST_TS_DATA/tmp/rvrgfa-same`, `-j4`, `--locked --offline`). Both sides
built at the same target path, one after the other.

| check | result |
|---|---|
| oracle `cargo build --release` | exit 0, 50 calls, 12.8 s wall, 124 MB |
| port `cargo build --release` (G1 patch) | **exit 0, 50/50 calls exit 0**, 2 min 44 s wall (397 s summed over calls; the handoff's 6 min 21 s was under heavier load), 114 MB |
| rmeta, same target path | **33/33 byte-identical** |
| stderr per call (keyed by crate, argv, OUT_DIR) | **50/50 identical**, every argv matched |
| pre-pass IR (`-Cno-prepopulate-passes --emit=llvm-ir`, `scripts/ir-run.ts --tier N1`, both sides at one `--out`, unpatched committed port) | **memchr SAME (8.9k lines), aho_corasick SAME (136k), globset SAME (105k)** |
| port `rg` vs oracle `rg` (10 substantive queries over `library/` at the pin, plus 2 error cases) | **12/12 MATCH** (stdout+stderr+exit) |

Queries (`--no-config`, `--sort path`, cwd `$RUST_TS_DATA/rust/library`): `-n 'fn main' core/src` (131 lines);
`-c -i unsafe -t rust .` (1031); `-o -w '[A-Z][a-z]+Error' std/src` (379); `--files -g '*.rs' alloc/src` (96);
`-U -n 'struct\s+\w+\s*\{\n\s+pub' std/src` (238, multiline); `--color always -C1 -e 'fn copy\(' -e hard_link std/src` (112);
`-z -l -s 'TODO|FIXME' .` (312); `-r X -n 'Option<T>' core/src/option.rs` (81); `--max-count 3 -i safety: core/src/ptr` (18);
`-v -c '^\s*//' core/src/num` (41); and two errors, `-P` (PCRE2 not built in, exit 2) and an unknown flag (exit 2). A first
batch against ripgrep's own packaged tree also matched 8/8, but most of it was trivially small (the `.crate` has only
`crates/core`), so I don't count it. `rg` sizes: port 7,073,056 B, oracle 6,624,256 B (D8, as the handoff says).

Not reproduced (time and disk): `release-lto`, the 323-test integration suite, IR for all 35 units. Time for part 2: about
20 min wall, peak disk about 125 MB per target directory plus 39 MB kept oracle reference; everything deleted after.

## 3. `serde_derive`

Confirmed dev-only. `Cargo.toml` of ripgrep 15.2.0 lists `serde` and `serde_derive` only under `[dev-dependencies]`
(`serde_json` is the only serde-family normal dependency, through `serde_core`). `cargo tree --locked --offline -e all -i
serde_derive` reaches it only through ripgrep's `[dev-dependencies]`, and `-e normal,build -i serde_derive` prints nothing.
No `proc-macro` crate is on the normal or build graph. `docs/plan-m7.md:316` already says so; **`docs/next.md:738` ("`serde_derive`
as a proc macro") is wrong** (finding N3, root's to fix).

## 4. Regressions

- `bunx tsc --noEmit -p .`: clean (12.7 s).
- `bun scripts/coverage.ts --check`: markers ok (27,350). `--missing compiler/rustc_fs_util/src/lib.rs`: 2/10.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_ssa/ ./scripts/lib/unit-steps.test.ts ./src/rustc_fs_util/
  ./src/rustc_codegen_llvm/back/linker_plugin_lto.oracle.test.ts ./src/rustc_codegen_llvm/skeleton.test.ts`: **233 pass,
  0 fail** (21.6 s).
- Samples (`--sample 200 --jobs 6`, `RUST_TS_AGENT=rv-rgfa-7q`), run after the scratch worktree was removed (committed code):
  - run-pass-native (run `rvrgfa-run-pass-native`, 214 s): 197 MATCH, 0 DIFF, 2 UNPORTED, 1 UNSTABLE. All 197 MATCHes are
    protected cases. The UNPORTED ones are `tests/ui/extern/issue-64655-extern-rust-must-allow-unwind.rs#thin0`/`#thin1`
    (`thin_lto`, plan-m7 D8). The UNSTABLE one is `tests/ui/runtime/rt-explody-panic-payloads.rs`. None of the three is
    protected. **No protected case left MATCH.**
  - check-ui (run `rvrgfa-check-ui`, 59 s): 200/200 MATCH.

## 5. Mutation (`src/rustc_fs_util/lib.ts`, each reverted with `git checkout`)

| mutant | killed by |
|---|---|
| M1 always copy (first `hard_link` replaced by an error) | lib.test.ts "hard-links" **and** the oracle test (exit 70) |
| M2 error kind ignored (any `hard_link` error takes the retry path) | lib.test.ts "copy fallback stops unported" (`remove_file` of the missing dest returns `Err`) |
| M3 `remove_file`'s error not propagated (`?` dropped, :40) | **survives** |
| M4 retry result ignored (always `Ok(Link)` after `remove_file`, :41) | **survives** |

## Findings

- **N1** `src/rustc_fs_util/lib.test.ts:13` (code at `src/rustc_fs_util/lib.ts:40`): the `fs::remove_file(q)?` propagation is
  untested (mutant M3 survives). A one-line test kills it: a directory as the destination makes `hard_link` fail with
  `AlreadyExists` and `remove_file` fail with `PermissionDenied` (checked: `link_or_copy(file, dir)` returns
  `Err(PermissionDenied)`; under M3 it throws `Unported` instead). M4 (`:41`) needs a failure after a successful
  `remove_file`, which is not reachable without fault injection; acceptable to leave.
- **N2** `src/rustc_codegen_ssa/back/write.ts:31`, `:1138`, `:2388`: comments still say `link_or_copy` is "rustc_fs_util, not
  ported"; the `unported` text at `:1142` names it as the missing piece. These paths still stop correctly (they need
  rustc_incremental and `WorkProduct`s, D11), but the reason is now stale. Not the lane's file: root or the next
  rustc_codegen_ssa touch should reword them ("needs rustc_incremental's session directories").
- **N3** `docs/next.md:738`: M7d's "`serde_derive` as a proc macro" is wrong for `cargo build --release`; `serde_derive` is a
  dev-dependency only (§3). Root to correct, as the brief says; `rg-behaviour`'s integration tests are the only M7d piece that
  builds it.
- **N4** (note, no action) The brief puts the stub in `rustc_codegen_ssa`'s `back/write.ts`; it was in
  `rustc_codegen_llvm`'s, which is where upstream's `EmitObj::Bitcode` call is. The `harness/llvm-manifest.json` hunk in
  `git diff 9c662b55 ca078749` is root's `6a74a1de` (Mangler.cpp pin for llir-callbr-mangler, already in main), not this
  lane's commit; `ca078749` touches no `harness/` or `scripts/` file.
- **N5** (note for llir-callbr-mangler) G1 reproduced on a minimal case, not on all 33 libs: with committed code, a one-fn
  `--crate-type lib -Copt-level=3 -Cembed-bitcode=no` (cargo's release flags) writes its CGU object, then exits 70 with
  `unported: llir: LLVMRustGetSymbols`. The object-only branch of appendix C is enough for `release`. The scratch patch's llvm-nm branch and G3's tools flag are not
  acceptable as committed code, as the handoff itself says.

# Re-check: lane ssa-archive (wave 40q)

Reviewer, read-only on code. Subject: commit `42ca0b77` on branch `t3/port-ssa-archive-symbol-rpath`, on top of
`45bf7043` (pin 6f5da406b56c, 1.101.0-nightly). The first review is `docs/reviews/ssa-archive.md` (commit `4ee54255` on
`review/ssa-archive`): FAIL on F1, with nits N1–N3. This re-check is committed on top of the subject commit.

## Verdict: PASS WITH NOTES

F1, N1 and N3 are fixed. N2 is still deferred to root's ssa-link-a integration, as the first review agreed.

- **F1:** the new `pub-*` fixtures make hide change the oracle's bytes on both targets. The port matches the oracle in all 18
  builds, and every hide mutant I tried now fails.
- **Behaviour:** the only change outside tests and fixtures is the `ImportLibraryItem` class. Nothing calls it yet.
- **Notes:** the three below are not lane defects.

## Notes

1. **The pathdiff source is not where the brief says.**
   - `$RUST_TS_DATA/crate-fetch/` has no pathdiff.
   - I used `~/.cargo/registry/src/.../pathdiff-0.2.3/src/lib.rs`. Its `.crate` SHA-256 `df94ce21…` equals the checksum in
     upstream's `Cargo.lock` (`$RUST_TS_DATA/rust/Cargo.lock`), so it is the pinned source.
   - Root may want `bun scripts/crate-src.ts pathdiff` to fetch it into `crate-fetch` when adding `"pathdiff": "=0.2.3"`
     to `harness/scope.json`, which is already the handoff's "For root" item 1.
2. **Wording nit in the handoff and in `regen.ts:13`.** They say `-Cembed-bitcode=no` keeps "`.llvmbc`" out of the objects.
   - That is the ELF section. On Mach-O it is `__LLVM,__bitcode`.
   - What they claim is right (see F1, last check).
3. **N2 is still open, as planned.** `ArchiveBuilder.build(output, symbols?)` stays optional until ssa-link-a's integration
   ports `link_staticlib`. The handoff's "For root" item 2 now gives the reason.

## F1: fixed

**Regen is reproducible**
- `bun src/rustc_codegen_ssa/back/archive_oracle/regen.ts` rewrote `fixtures.json` byte-identically: SHA-256 `c26a47a4…`
  before and after.
- Against `45bf7043`'s `fixtures.json`:
  - all 18 earlier blobs are present with the same content;
  - all 10 earlier builds (5 per target) are unchanged, entry for entry;
  - the new file adds 11 blobs (29 in total).

**Hide really differs from plain in the oracle's own output**
Byte comparison of the fixture archives:

| target | pub-plain → pub-hide | pub-rename → pub-both | plain → hide, rename → both |
|---|---|---|---|
| aarch64-apple-darwin | 2 bytes, `n_type` 0x0f → 0x1f | 2 bytes, 0x0f → 0x1f | 0 bytes |
| x86_64-unknown-linux-gnu | 2 bytes, `st_other` 0 → 2 | 2 bytes, 0 → 2 | 0 bytes |

- Which symbols flip: `nm -m` on Mach-O and `objdump -t` on ELF show exactly
  `_RNvCshiMNQ7p2vRf_2nc8root_pub` and `_RNvCshiMNQ7p2vRf_2nc9ROOT_DATA`.
  - They go from external / default visibility to private external / `.hidden`.
  - `nc_exported` and `NC_DATA` stay exported.
  - `a::helper` and `a::A_DATA` were already hidden.
- So the test's `EXPORTED` set (`nc_exported`, `NC_DATA`) is the oracle's StaticLib export set for nc_pub.rs too.
- The `pub-plain` and `pub-hide` builds have identical member inputs: the difference comes from the archive-time edit, not
  from codegen.
- The new test `the pub-* fixtures exercise hide` asserts both inequalities, so a later regen cannot silently lose the
  coverage.

**Mutations**
Each was applied with `sed` to `symbol_edit.ts`, run with `bun test src/rustc_codegen_ssa/back/archive_oracle.test.ts`, and
reverted with `git checkout`. `git status` was clean after each one.

| mutant | result (24 tests) |
|---|---|
| M2 Mach-O `value: nlist.n_type \| macho.N_PEXT` → `nlist.n_type` (:450) | **2 fail**: aarch64 pub-hide, pub-both (was 0) |
| M3 ELF `value: new_vis` → `sym.st_other` (:270) | **2 fail**: x86_64 pub-hide, pub-both (was 0) |
| M1 ELF drop `\| elf.STV_HIDDEN` (:269) | 4 fail: x86_64 hide, both, pub-hide, pub-both |
| M7 Mach-O hide ignores `exported` (:448) | 5 fail |
| M8 Mach-O hide includes undefined symbols (:448) | 4 fail |
| M9 ELF hide ignores `exported` (:267) | 5 fail |

Unmutated: 24 pass, 0 fail.

**`-Cembed-bitcode=no` is harmless to what is compared**
- **Inputs:** port and oracle get the same objects. The flag changes the inputs, not which code compares them.
- **Experiment:** I ran a scratch copy of `regen.ts` without the flag, writing to my scratchpad, and a scratch copy of the
  test reading those fixtures:
  - **Objects:** the CGU objects then carry bitcode. Mach-O has `__LLVM,__bitcode` (4.1–4.5 KB per object); ELF has
    `.llvmbc` (4.5–5.1 KB). With the flag they are 0.5–1.6 KB, with no bitcode.
  - **Hide:** it still differs from plain in exactly 2 bytes per target, with the same byte values (offsets shift by the
    bitcode size).
  - **Port:** all 24 tests pass; it matches the oracle in all 18 builds.
  - **Mutants:** M2 and M3 still fail 2 tests each.
- **Verdict:** the flag only shrinks the fixture, as `regen.ts` says. It does not mask a difference or narrow what hide
  checks.
- **Regen:** the earlier five builds are untouched by the flag; only `pub-*` gets it.

## N1: fixed

`src/vendor/pathdiff/lib.test.ts` ports `mod tests` of pathdiff 0.2.3 `src/lib.rs:170-251`.

- **Coverage:** all six tests, with every assertion in upstream order: 4 + 7 + 2 + 3 + 14 + 3.
- **Line comments:** they name the right `fn` lines: 176, 195, 207, 213, 220, 241.
- **`assert_diff_paths`:**
  - `None` compares by `toBe(undefined)`.
  - `Some` compares through `path_eq`, which is `path_components(a).eq(path_components(b))`. That is `PathBuf`'s `==`, so
    `"../."` vs `".."` is equal, as in Rust.
  - The camino half is omitted. That is correct: the feature is off in rustc's build.
- **Unix only:** `abs` is the Unix arm of upstream's `cfg_if!`, and the Windows arm is said not to run. That is consistent
  with the rest of the vendor tests.
- **Not vacuous:** I changed two expected values (`("", "foo", ".")` and `("foo", "/bar", "foo")`), and each made its test
  fail. Both were reverted.
- **Markers:** the line comments are `// crate pathdiff-0.2.3/...`, not `// crate: ...` markers, because pathdiff is not in
  `harness/scope.json` yet. That has the same reason, and the same `// PORT:` and handoff item, as the pending marker in
  `lib.ts:31`. Acceptable until root adds the scope entry.

## N3: fixed

`ImportLibraryItem` (`archive.ts:58`) is a `class`, per PORTING §5 "Structs".

- **Fields:** the constructor takes all four fields in declaration order, `name, ordinal, symbol_name, is_data`, matching
  archive.rs:37-46. Upstream has no `new`, so there is no `static new`.
- **Method:**
  - `into_coff_short_export(sess)` uses `this`, with its marker (`archive.rs:49`) directly above it. `coverage --check`
    passes.
  - The body is unchanged apart from `self` → `this`:
    - `(arch == Arm64EC).then(|| name.clone())` → a ternary with `undefined`;
    - `ordinal.unwrap_or(0)` → `?? 0`;
    - `is_some()` → `!== undefined`.
- **Callers:** the only one, `create_dll_import_lib` (`archive.ts:139`), now calls `item.into_coff_short_export(sess)`.
  Nothing else in `src/` names `ImportLibraryItem`, so no object-literal construction site breaks. tsc is clean.

## Nothing else changed in behaviour

`git diff --stat 45bf7043 42ca0b77` touches only these 7 files:

- `docs/handoff/ssa-archive.md`;
- `archive.ts` (N3);
- `archive_oracle.test.ts`;
- `archive_oracle/fixtures.json`, `nc_pub.rs`, `regen.ts`;
- `src/vendor/pathdiff/lib.test.ts`.

Only `archive.ts` is non-test code, and its change is the N3 refactor above. `symbol_edit.ts`, `rpath.ts`, pathdiff
`lib.ts` and the vendor `object`/`ar_archive_writer` pieces are untouched.

In the test, the only change to existing behaviour is the `SYMBOLS[b.replace(/^pub-/, "")]` lookup. It maps the `pub-*`
builds to the same `ArchiveSymbols` as their plain-named counterparts, and is the identity on the earlier five names.

The handoff's new text matches what I observed:
- 18 of 18 builds byte-identical;
- 29 blobs;
- the mutation table;
- the earlier blobs reproduced unchanged.

The one exception is the `.llvmbc` wording in note 2.

## Evidence (reviewer)

**Setup**
- AC power (`pmset`: "AC Power", 100%).
- No open STOP.
- `.env.local` copied from `integ-w39`, plus `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`.
- `bun install --frozen-lockfile`.
- `RUST_TS_AGENT=rev-ssa-archive-recheck`.
- Branch `review/ssa-archive-recheck`, at `42ca0b77`.

**Commands**
- `bunx tsc`: exit 0, no output.
- `bun scripts/coverage.ts --check`: `markers ok (26891, 72 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5316;
  library 745; llvm 523)`.
- `--missing`: archive.rs 22/22, symbol_edit.rs 14/14, rpath.rs 6/6.
- `bun test ./src/rustc_codegen_ssa/ ./src/vendor/ar_archive_writer/ ./src/vendor/object/ ./src/vendor/pathdiff/
  ./scripts/lib/unit-steps.test.ts`: **210 pass, 0 fail, 0 skip** across 32 files.
  - That is the first review's 194, plus 8 `pub-*` archive builds, 2 hide-differs tests and 6 pathdiff unit tests.
- `bun test ./src/vendor/pathdiff/`: 8 pass.

**Tree and scratch**
- The tree was clean after every mutation and after regen.
- Scratch scripts (fixture comparison, symbol dump, the no-embed-bitcode regen and test copies) are in the session
  scratchpad, outside the repo and `$RUST_TS_DATA`.

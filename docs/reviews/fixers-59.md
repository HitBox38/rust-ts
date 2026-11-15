# Review: fixer lane `fixers-59` (wave 40s), queued src nits

Reviewer, independent and read-only. Subject: branch `t3/fixer-59-queued-src-nits`, 12 fix commits (`7058691d` … `8b10c49f`) plus
the handoff `024d1ba7`, on main `2bf7435a` (`git diff 2bf7435a 024d1ba7`, 19 files, +304 −56). Handoff: `docs/handoff/fixers-59.md`.
Reviewed on branch `t3/review-fixers-59-r` at `024d1ba7`.

Setup: `.env.local` copied from `integ-w39`, plus `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`;
`bun install --frozen-lockfile`. On AC power the whole time (`pmset`: "AC Power", 100%, charged). No `GATE_RUNNING` file existed.
Other lanes kept the host busy: the 1-minute load ran from 23 to 125 during the review.

## Verdict: **APPROVE WITH NITS**

Only item 5's dummy-backend override changes behaviour, and no protected path reaches it. Everything else is comments, tests, one
moved test helper, a generator's error path, or a refactor that changes no value; I checked the refactor (item 7) against the base
in all four cases the lane names. Every finding listed in the brief is addressed as its review asked. The tests fail under the
mutations that matter, with one gap (N1). There are no F findings.

## 1. Behaviour

**Whole-diff scan.** Leaving out comments and test files, the diff changes five things:
- `back/archive.ts:99`: an optional `create_dll_import_lib?` member on `ArchiveBuilderBuilder`. This is a type-only change.
- `back/link/raw_dylib.ts:118-122`: dispatch to that member when present, else to the provided method, as before.
- `rustc_interface/util.ts:373-377`: the dummy's override.
- `back/apple.ts:263, :279`: `ignoreBOM: true` in the two `xcrun_show_sdk_path` decodes. This is behaviour in principle, but
  `xcrun` prints no BOM.
- The item-7 refactor of `filesearch.ts`, `tools.ts` and `oracle_sysroot_env.ts`, plus `gen_intrinsics_x86.ts`'s error path, a
  tool and not compiler code.

`codegen_backend.ts` and `base.ts` change only in comments.

**Item 5 against upstream at the pin (`6f5da406b56c`).**
- `rustc_interface/src/util.rs:499-508` is `create_dll_import_lib(&self, sess, _lib_name, _items, output_path)` with the comment
  "Build an empty static library to avoid calling an external dlltool on mingw" and
  `ArArchiveBuilderBuilder.new_archive_builder(sess).build(output_path, None);`.
- The port (`util.ts:373-377`) has the same parameters, the same comment, and the same call. The `bool` that `build` returns is
  discarded in both. The marker line is correct, and `coverage.ts --check` accepts it.
- Upstream, `raw_dylib.rs:101` calls `archive_builder_builder.create_dll_import_lib(...)`, a trait method, so an override wins.
  `raw_dylib.ts:118-122` gives exactly that dispatch.
- At the pin, only `DummyArchiveBuilderBuilder` overrides the method (`grep -rn "fn create_dll_import_lib" compiler/` finds
  util.rs:499 and archive.rs:83 only). So no other TS builder needs the member, and leaving it off them is correct.
- `raw_dylib.ts:118` is the only caller of either version in `src/`. Its three call sites in link.ts (`:729`, `:2961`, `:2990`)
  go through `xlane.create_raw_dylib_dll_import_libs`.

**Reach.** The override runs only from `create_raw_dylib_dll_import_libs`, and `link_rlib` calls that only under
`sess.target.is_like_windows` (link.rs:685). No protected suite compiles for a Windows target. They use
`COMPILETEST_TARGET` / `M5_TARGET` (`x86_64-unknown-linux-gnu`), Miri's pinned target, or the host (`aarch64-apple-darwin`).
- The protected rows that mention raw-dylib (`tests/ui/linkage-attr/raw-dylib/windows/*.rs`, including `dlltool-failed.rs` and
  `invalid-dlltool.rs`) are all in front-end dump suites (lex, parse, expanded, hir-tree, resdump, tydump, mir, unpretty-*).
  None of them links.
- No `tests/ui` file uses `-Zcodegen-backend=dummy`.

So no protected case reaches the change.

**The new test** (`raw_dylib.test.ts:51-72`) is meaningful for the dispatch. With the `!== undefined` branch forced to `false`, it
fails (1 of 2; see §6). It checks the library name, the item names and the output path passed to the override. It does not
exercise the dummy's own body: see N1.

## 2. Item 7: the shared `--print sysroot` spawn

**Values unchanged.** I imported `default_sysroot` (filesearch.ts) and `oracle_sysroot` (tools.ts) from a scratch worktree at
`2bf7435a` and from this branch, and printed the value or the thrown error in each of the four situations:

| case | `default_sysroot` (base = branch) | `oracle_sysroot` (base = branch) |
|---|---|---|
| success | `".../toolchains/nightly-2026-10-11-aarch64-apple-darwin"` | same path |
| `rustc` missing (`env -i HOME=…`) | `Unported: … --print sysroot failed: Executable not found in $PATH: "rustc")` | `Error: Executable not found in $PATH: "rustc"` |
| fake `rustc` printing two stderr lines, exit 1 | `Unported: … failed: error: toolchain broken)` | `Panic: llir: cannot find the pinned LLVM tools: … failed: error: toolchain broken` |
| fake `rustc` printing `"  /odd path \n"` | `"  /odd path "` (newline stripped only) | `"/odd path"` (trimmed) |

Base and branch print byte-identical lines in all eight cells.

**stdin.** The handoff says Bun's `spawnSync` already gives the child `/dev/null` by default, which makes the explicit `"ignore"`
a no-op for tools.ts. That holds on Bun 1.4.4: with a pipe on the parent's stdin, a `sh -c 'cat; ls -l /dev/fd/0'` child read
nothing, and fd 0 was a character device.

**`config_sysroot.test.ts`** passes in both full runs (§7).

**Driver test message.** `driver.oracle.test.ts:114-120` `compare_bytes` returns `"equal"` only when the lengths match and every
byte matches. Otherwise it returns `"<name>: port N bytes, oracle M bytes, first difference at offset K"`.
- K is the first differing index.
- When one buffer is a strict prefix of the other, K is the shorter length, which is the right offset.
- `name` is the `LINKED` output name (`x`, `optimize`).

The message gives both sizes and the first differing offset, as root-w58-recheck N2 asked.

## 3. Item 2 N2: `tools.test.ts`'s `opt.ll` compare

- **Source of the oracle side.** `tools.test.ts:431` runs the pinned rustc in the test, not a fixture:
  `join(oracle_sysroot(), "bin", "rustc")` on the same arguments, in its own subdirectory. The test then compares the two
  `opt.ll` at N1 with the pinned `opt` (`normalForm(…, "N1", bin())`).
- **Cost.** The extra rustc run took 0.03 s when I timed it directly. The whole R1 test took 3.0 s at load about 26. It keeps
  its explicit 60 s timeout.
- **Env reads.** No new named variable read: `envReads` finds nothing new, and `unit-steps.test.ts` passes. The oracle child gets
  `{ ...process.env, RUSTC_ICE, RUST_BACKTRACE }`, the same environment the port child already got. A spread copy is not a read
  under `unit-steps.test.ts`'s rule.
- `oracle_sysroot()` is cached, so the extra call spawns nothing.

## 4. Item 6

- **`gen_intrinsics_x86.ts --check`.**
  - On the clean tree: exit 0, no output.
  - With one extra newline appended to `intrinsics_x86.ts`: exactly one stderr line,
    `ERROR: intrinsics_x86.ts differs from what gen_intrinsics_x86.ts writes`, exit 1, no stack.
  - I then restored the file from a copy. Its SHA-1 was unchanged (`7d24b901…`) and `git status` was clean.
- **The `simd_stop.rs` assertion is exact.** `simd_intrinsic.test.ts:86` uses `toBe("rust-ts: unported: cg-intrinsic-b: …
  simd_fsqrt\n")`, the whole stderr, so a second line or a changed prefix fails.
- **For root, at integration with cg-intrinsic-b.** cg-intrinsic-b (`t3/port-simd-vaarg-abis`, `d4aa3ac2`) deletes
  `simd_stop.rs` and both of its tests.
  - The merge does **not** resolve itself. `git merge-tree --write-tree 024d1ba7 d4aa3ac2` reports one content conflict, in
    `src/rustc_codegen_llvm/simd_intrinsic.test.ts`: a single hunk, this lane's edited `simd_stop.rs` test against
    cg-intrinsic-b's replacement `describe`.
  - Take cg-intrinsic-b's side of that hunk. This lane's one-line edit then simply drops out, and nothing else of this lane
    touches that file.

## 5. Items 1, 3, 4

1. **w40q-audit N2: fixed.**
   - The upstream claim holds. queries.rs:49 is `Linker::link`, which reaches the three statistics forwards after both the
     check-only `Ok(compiled_modules)` branch and `join_codegen`, under `codegen_units() == 1 && time_llvm_passes`,
     `print_llvm_stats()` (`print_codegen_stats`) and `print_llvm_stats_json()`.
   - The lane also notes that the stand-in's `init` stops these flags first. That is correct too: `codegen_backend.ts:98, :100`
     returns `-Z time-llvm-passes` and `-Z print-codegen-stats` from `non_default_llvm_input`.
2. **fixers-58 N1–N3: fixed.**
   - N1: the `Device` case at `codegen_backend.test.ts:66-67`; see §6 for its mutation.
   - N2: see §3.
   - N3: `assert_diff_paths` is now the last item in the `describe`. The `/** */` doc sits above the
     `// crate: pathdiff-0.2.3/src/lib.rs:247` marker, and the marker is directly above the `function`. The body is unchanged.
3. **mono-run-head N3: fixed.** `base.ts:809` is a one-line comment, the first line of `codegen_crate`'s body, so the
   `// rustc:` marker stays directly above the `function`.
4. **vendor-object-write N1, N3: fixed.**
   - N1: both lines the review named (`apple.ts:263`, `:279`) now decode with `ignoreBOM: true`, with a `PORT:` note. See N2 for
     `stdout_to_path`.
   - N3:
     - `lookup_sdk` (`apple/tests.test.ts:35-41`) now calls `xcode_select_developer_dir()` unconditionally and keeps upstream's
       comment. Only the `SDKROOT`-gated `assert!` is left out, with a `PORT:` note. This matches `apple/tests.rs:30-35`.
     - The `object/write/util.test.ts` header and the comment at `:30-31` label the LEB128 test as rust-ts's own.

Item 5's other parts:
- ssa-link-b N2: the stale comments are corrected, at `util.ts:365-366` and in the `raw_dylib.ts` header at `:4-6`, which no
  longer says the method is "reached through link.ts's `xlane` table".
- N6, already fixed upstream of this lane: `apple.ts` has no "(not ported)" reach comment left (`grep -n "not ported"` finds
  none in it).

## 6. Mutations (each reverted with `git checkout <file>`; `git status` clean after each)

| mutation | tests run | result |
|---|---|---|
| `codegen_backend.ts:345`: drop `offload.some((o) => o.$ === "Device") \|\|` | `codegen_backend.test.ts` | **1 fail of 5** (`-Zoffload Device`) |
| `raw_dylib.ts:118`: dispatch condition → `false` (always the provided method) | `raw_dylib.test.ts` | **1 fail of 2** (the new case) |
| `util.ts:376`: dummy override's `build(...)` call replaced by a comment | `bunx tsc` + `src/rustc_interface/` + `src/rustc_codegen_ssa/back/` | 122 pass, **0 fail** (N1) |
| `apple.ts:263, :279`: `ignoreBOM` removed (back to `new TextDecoder()`) | `src/rustc_codegen_ssa/back/apple` | 5 pass, **0 fail** (expected: no test can make `xcrun` print a BOM; informational) |

## 7. Commands

- `bunx tsc`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (27221, 75 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745;
  llvm 527)`, the lane's number.
- `bun test ./src/rust_ts/ ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/rustc_session/ ./src/rustc_driver_impl/
  ./src/rustc_interface/ ./src/vendor/pathdiff/ ./src/vendor/object/ ./scripts/lib/unit-steps.test.ts`:
  - with `CI=1`: **989 pass, 0 fail**, no skips, 100 files (584 s, at a 1-minute load of 70-125).
  - without `CI`: **989 pass, 0 fail**, no skips, 100 files (336 s, load falling to 24).
  - The lane's 1898 tests in 210 files came from all of `./src/vendor/`. The brief's list names only `pathdiff` and `object`.
- **`src/vendor/odht/odht.oracle.test.ts`: the timeout did not reproduce.**
  - 8 runs alone at a 1-minute load of 23-31, 5 pass / 0 fail each time.
  - The junit reporter timed the "build: insert results, len and raw bytes match the oracle's odht" test at 3.95 s, 2.78 s and
    3.90 s, at load about 28. The host never got below load 23 during the review, so I have no true low-load figure.
  - At load 28 it already uses 55-80% of Bun's 5 s default, which fits the lane's 5.0-6.0 s failures at load 50-57. The lane's
    advice to root stands: an explicit timeout on that test (as `tools.test.ts` does with `60_000`) is a one-line fix in a file no
    lane of this wave owns.
- `RUST_TS_AGENT=review-fixers-59-r bun scripts/difftest.ts --suite mono-ui --sample 200 --jobs 6`: **200/200 MATCH**, 0 DIFF,
  UNPORTED, CRASH or TIMEOUT. Run `20261115-004534-review-fixers-59-r-y3rc`.

## Findings

**N1 (test gap).** `src/rustc_interface/util.ts:374-377`: no test runs the dummy's `create_dll_import_lib` itself.
- Replacing its `build(output_path, undefined)` call with nothing leaves `tsc` clean and all 122 tests in `src/rustc_interface/`
  and `src/rustc_codegen_ssa/back/` passing. The new `raw_dylib.test.ts` case uses its own mock builder, so it pins the dispatch
  only.
- A small test would close the gap: call the dummy builder's `create_dll_import_lib` on a temp path and check that an empty
  archive (`!<arch>\n`) is written. That needs `DummyArchiveBuilderBuilder` exported, or reached through
  `DummyCodegenBackend`.
- Optional: no protected path reaches the code (§1).

**N2 (for root, on the lane's open question).** `src/rustc_codegen_ssa/back/apple.ts:307` `stdout_to_path` still uses
`new TextDecoder()`. I recommend `{ ignoreBOM: true }` there too.
- Upstream (`apple.rs:299-300`) keeps the bytes as they are (`OsStringExt::from_vec`), so a leading U+FEFF, which is valid
  UTF-8, stays part of the path.
- The default decoder drops it, a departure the existing `PORT:` note ("read as UTF-8 (lossy)") does not cover. That note is
  about invalid bytes, which `ignoreBOM` does not change.
- It belongs to apple.ts's owner. It has no effect in practice.

**N3 (informational).** The `ignoreBOM` change at `apple.ts:263, :279` has no test, and removing it passes (§6). A test would need a
fake `xcrun` on `PATH`. That is not worth it for output `xcrun` never produces, so no action.

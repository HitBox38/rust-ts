# Handoff: fixer lane `fixers-56` (M7, wave 40p)

Branch `t3/025e4c66`, based on `7b71d658`. One commit per item; each commit message cites its finding. No behaviour change
except item 4's error handling in a hand-run tool.

## Items

1. **done** (`34010c94`, root-w55-check 1-4).
   - `mir/mir_rest.test.ts:374`: `statement.rs:62` → `:73` (checked: `StorageLive` is at statement.rs:73 at the pin).
   - `mir/mod.ts` `xlane`, `mir/block.ts` `block_xlane` (its header at :19-20 and the table comment) and `mir/statement.ts`
     `stmt_xlane`: the text now says the tables hold forwarders (section titles "Cross-lane forwarders"); the unused `unported`
     imports in all three are removed.
   - Unused type imports removed: rustc_codegen_ssa `back/lto.ts` `Lto`, rustc_codegen_llvm `back/write.ts` `AutoDiff`.
   - `mir/debuginfo.ts`: the header no longer describes placeholders; `dctx`/`per_local` are gone and the fields are used
     directly (4 + 2 sites). I also dropped the matching write-side self-cast `new_context as unknown as typeof
     this.debug_context` (:903), which the old header described with them. The `PerLocalVarDebugInfo_`/`ConstDebugInfo_`/
     `DebugScope_` aliases stay (the declarations below use them); their PORT comment now says they are the same types as the
     plain names.
2. **done** (`ef204833`, n1-name-anon N1-N3). Comments only.
   - `scripts/lib/ir-normal.ts:6` (N1): "every module whose `NeedThinLTOBufferPasses` is set", with the flag's three cleared
     cases (PassWrapper.cpp:961, 970) and that on fat-LTO output the pass renames on both sides alike.
   - `scripts/lib/ir-normal.ts:25-26` (N2): the hash joins names with no separator (`@f` + `@g` = `@fg`) and skips
     declarations, so a definition change "usually" changes the names, and shows in the definition lines anyway.
   - `docs/handoff/n1-name-anon.md:35` (N3): the old N1 fails on 4 lines per side (definition, two uses, `!9` guid).
   - **For root: this is a comment-only edit under `scripts/`; it needs its own review.** It changes `ir-normal.ts`'s hash, so
     `irToolsKey` re-keys cached IR normal forms (no protected suite reads N1; ir-hello has no baseline).
3. **done** (`a19bdaf6`, llir-folder-notes-recheck R1). `folder.oracle.test.ts` gets the type row
   `{ <vscale x 4 x i32>, <vscale x 2 x i64> }`. The test passes. With fold.ts `containsHomogeneousTypes` weakened to
   `ElementTys.length !== 0` it fails (the model folds `icmp eq/ne ptr @g0, @g90..g92` to `i1 false/true` where libLLVM keeps
   the instruction); fold.ts restored with `git checkout`.
4. **done** (`04bb7f43`, cg-write-recheck R1, R2).
   - R1, `write_oracle/record.ts` (no second tool; the ideas of `3972d1c6`'s gen.ts folded in): the lldb spawn error is caught
     (one `ERROR:` line); lldb gets `-x`; 120 s timeout per lldb run, reported as an `ERROR:` line; the `ERROR:` lines carry the
     last 3 lines of stderr; `die` throws, the top level prints the one `ERROR:` line and exits 1, so the `finally` always removes
     the scratch directory. All recordings are now made before any fixture is written, so a failure on the second target no longer
     leaves the first rewritten. Checked by hand:
     - no lldb on `PATH` (a scratch dir with only `bun`, plus `~/.cargo/bin`): `ERROR: x86_64-unknown-linux-gnu: lldb could not
       be started (Executable not found in $PATH: "lldb")`, exit 1, scratch dir gone;
     - temporary 50 ms timeout: `ERROR: x86_64-unknown-linux-gnu: lldb did not finish within 0.05 s (stderr: (empty))`, exit 1,
       no leftover rustc; restored;
     - a real run: wrote both `.tm` files (2 calls each) and `version.txt`; `git status` clean, so byte-identical.
   - R2, `llvm_util.ts:402-403`: a NUL cannot come from argv itself, but can from an `@argfile` line
     (rustc_driver_impl/src/args.rs:26-27) or a target-spec JSON. `back/write.ts:253` and `context.ts` refer to this comment.
5. **done, dropped** (`cceda39c`, fixers-55 N2). `analyze_oracle/driver.ts` no longer reads `RUST_TS_SSA_STACK`: it only
   appended a stack trace to an unported stop's stderr line, which is debug output the test never relies on. The driver reads
   no environment variable now. (`base_oracle/driver.ts` prints the stack unconditionally; I did not change that.)
6. **done** (`66d9afaf`):
   - fixers-55 N1: `docs/handoff/fixers-55.md:3` branch → `t3/fixers-55-codegen-nits`.
   - fixers-55 N3: `abi_consts.test.ts:11` rewrapped.
   - fixers-55 N4: `base_unsized_info.test.ts:21` `!12` → `!N`.
   - stable-hash-alloc N1: `docs/handoff/stable-hash-alloc.md:100` lists `A_DYN` and the vtable allocation too.
   - stable-hash-alloc N2: `abi_consts.test.ts` header item 4 names the vtable relocation (`GlobalAlloc::VTable`,
     mir/interpret/mod.rs:262).
   - ssa-write N6: `back/write.ts:1420` (rustc_codegen_ssa) `as OptLevel` removed; `OptLevel` is still used elsewhere.
   - cg-write N4: **skipped, already done** (cg-write-recheck §3: `skeleton.test.ts:273` names `back/write.test.ts`).

## Noticed, not changed (outside the listed findings)

- `mir/analyze_oracle/driver.ts:22` still says "The `xlane` stubs of other fill lanes are replaced by recorders"; they are
  forwarders now (same wording issue as item 1).

## Evidence (AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`)

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 (before every commit) |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26758, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 434)` |
| `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/folder.oracle.test.ts ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts` | 290 pass, 0 fail, 35 files, no skips |
| `bun test ./scripts/ir-normal.test.ts ./scripts/ir-diff.test.ts ./scripts/ir-sides.test.ts ./scripts/gate-probes.test.ts ./scripts/lib/` | 343 pass, 0 fail, 21 files |
| `difftest --suite mono-ui --sample 200 --jobs 6` | 200/200 MATCH, 0 DIFF/UNPORTED/CRASH/TIMEOUT (run `20261113-214702-root-ii9n`) |
| `difftest --suite mir --sample 200 --jobs 6` | 200/200 MATCH, 0 DIFF/UNPORTED/CRASH/TIMEOUT (run `20261113-214744-root-svhy`) |

Coverage (`coverage.ts --missing`), all unchanged: rustc_codegen_ssa mir/debuginfo.rs 31/31, mir/statement.rs 1/1,
mir/block.rs 35/35, mir/mod.rs 6/6, back/write.rs 40/40, back/lto.rs 8/8; rustc_codegen_llvm llvm_util.rs 26/26,
back/write.rs 32/32.

`unported(...)` left: none added. `// PORT:` decisions: none new; one reworded (debuginfo.ts aliases, item 1) and one widened
(llvm_util.ts NUL, item 4).

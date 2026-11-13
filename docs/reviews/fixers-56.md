PASS WITH NOTES

# Review: fixer lane fixers-56 (M7, wave 40p), including a comment-only `scripts/` edit

- **Reviewed:** `git diff 7b71d658..edf9476a` on `t3/rust-ts-fixer-nits`. Commits `34010c94` (item 1), `ef204833` (item 2),
  `a19bdaf6` (item 3), `04bb7f43` (item 4), `cceda39c` (item 5), `66d9afaf` (item 6), `ba1922b4` and `edf9476a` (handoff). I
  merged them into this review branch for the runs below. The handoff is `docs/handoff/fixers-56.md`.
- **Reviewer:** independent, read-only on code. Pin `6f5da406b56c`. Upstream was read from `$RUST_TS_DATA/rust`, which is at the
  pin.
- **Result:** each item fixes its finding and nothing more. The only behaviour change is item 4, in the hand-run
  `write_oracle/record.ts`, plus item 5's removal of a debug-only stack trace from an oracle test driver's stderr. There are no F
  findings and three nits.
- **`scripts/` batch (AGENTS.md §2):** this review is the reviewed batch for the `scripts/lib/ir-normal.ts` change in `ef204833`.
  The change is comments only: no code token changed, and no protected suite reads the file (§2 below). It is cleared for merge.

## Evidence (AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, Bun 1.4.4)

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26758, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 434)` |
| `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/folder.oracle.test.ts ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts` | 290 pass, 0 fail, 35 files |
| `bun test ./scripts/ir-normal.test.ts ./scripts/ir-diff.test.ts ./scripts/ir-sides.test.ts ./scripts/gate-probes.test.ts ./scripts/lib/` (the tests that cover `ir-normal`) | 343 pass, 0 fail, 21 files, 0 skips |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass, 0 fail |

No difftest samples were taken, as the brief asked.

## 1. Scope (item 1: root-w55-check 1-4)

- **`mir_rest.test.ts:374`:** now cites `statement.rs:73`. At the pin, line 73 is
  `mir::StatementKind::StorageLive(local) => {`. Correct.
- **Stub wording and imports:**
  - `mod.ts`, `block.ts` (header :19-20 and table comment) and `statement.ts` now describe forwarders. The section titles read
    "Cross-lane forwarders".
  - None of the three files has a `unported(` call left, so removing the `unported` imports is safe (tsc agrees).
  - Neither file mentions a stub any more.
- **Dead type imports:** `back/lto.ts` `Lto` and rustc_codegen_llvm `back/write.ts` `AutoDiff` are removed. Both were type-only
  imports and are erased at runtime.
- **`mir/debuginfo.ts` self-casts:** these are pure type-level no-ops.
  - `mod.ts:105-106` re-exports and imports `FunctionDebugContext`, `PerLocalVarDebugInfo` and `ConstDebugInfo` from
    debuginfo.ts.
  - The field types are `FunctionDebugContext<B["DIScope"], B["DILocation"]> | undefined` (`mod.ts:117`) and
    `PerLocalVarDebugInfo<B["DIVariable"]>[][] | undefined` (`mod.ts:108`, `:186`). These are exactly the types `dctx` and
    `per_local` cast to.
  - Each helper was `return fx.<field> as unknown as <same type>`, so replacing `dctx(this)` with `this.debug_context` (4 sites)
    and `per_local(this)` with `this.per_local_var_debug_info` (2 sites) emits the same JavaScript.
  - The write-side cast at the old `:903` (now `:893`, `this.debug_context = new_context`) was also an `as unknown as` to the
    field's own type. Dropping it only makes tsc check `new_context` against the field type, and tsc passes.
  - The kept `_` aliases and their reworded PORT comment are accurate.

## 2. The `scripts/` edit (`ef204833`, `scripts/lib/ir-normal.ts`)

- **Comments only:**
  - Bun's transpiler (`loader: "ts"`, `minifyWhitespace: true`, which drops comments) gives identical output for `7b71d658`
    and `edf9476a` (2264 bytes each).
  - Every `+`/`-` line of the diff starts with `//`.
- **What re-keys:**
  - `harness/suites.ts:2110` `irToolsKey` hashes `ir-normal.ts`. It feeds `irOracleKey`, which only `irSuite` uses.
  - The only `irSuite` is `ir-hello` (`suites.ts:2224`), and there is no `harness/baseline/ir-*.txt`.
  - `scripts/gate.ts:70` and `harness/suites.ts:11` import only the type `IrTier`, which is erased.
  - No other runner key hashes `scripts/` as a whole. difftest's `splitKey` hashes only `scripts/lib/split.ts`.
  - So no protected suite's oracle key changes. Cached IR normal forms of `ir-hello` re-key once.
- **The text against upstream:**
  - N1: `PassWrapper.cpp:907` sets `NeedThinLTOBufferPasses = true`. `:961` clears it for `PreLinkThinLTO`/`PreLinkFatLTO`
    (shared case), and `:970` clears it for `FatLTO`. `:992-997` adds `CanonicalizeAliasesPass`, `NameAnonGlobalPass` and
    `AssignGUIDPass` under the flag. The new header says exactly this.
  - N2: the no-separator and declarations caveat and "usually" match the finding.
- **`docs/handoff/n1-name-anon.md:35` (N3):** now says 4 lines per side, with the same lines review n1-name-anon N3 lists.

## 3. Item 3: the new struct row in `folder.oracle.test.ts`

- **Row:** `{ <vscale x 4 x i32>, <vscale x 2 x i64> }` is added at `:560-562`. It is built in the same way on both sides, as
  `rI(64), 2` and `mI(64), 2`.
- **Mutation run:** I weakened `fold.ts:753` `containsHomogeneousTypes` to `return ElementTys.length !== 0;`.
  - The test fails, with 9 pass and 1 fail: `icmp of pointer constants folds as libLLVM's`.
  - Every differing line names `g90 { <vscale x 4 x i32>, <vscale x 2 x i64> }`. libLLVM keeps `icmp eq/ne ptr @g0, @g90`,
    and the mutant folds it to `i1 false/true`.
- **Control run:** the same mutant with the new row deleted passes (10 pass). So the new row is what catches the mutant.
- **Restored:** both files were reverted with `git checkout`, the test passes again (10 pass), and `git status` is clean.

## 4. Item 4: `write_oracle/record.ts` (cg-write-recheck R1) and the `llvm_util.ts` comment (R2)

### R1 checks

- **Missing lldb:**
  - The spawn is wrapped in a `try`/`catch` that calls `die`.
  - Reproduced with a `PATH` holding only a `bun` symlink and `~/.cargo/bin`. Output:
    `ERROR: x86_64-unknown-linux-gnu: lldb could not be started (Executable not found in $PATH: "lldb")`, exit 1.
  - `$RUST_TS_DATA/tmp/cg-write-record/` was empty afterwards, and the tree was unchanged.
- **`-x`:** it is passed. `lldb --help` lists `-x` as the alias for `--no-lldbinit`. Otherwise the argv is the old one
  verbatim: the same `-o` commands, `-k`, rustc arguments and cwd.
- **Timeout:**
  - The lldb spawn has `timeout: 120_000`, and `exitedDueToTimeout` is checked before stdout.
  - The old code passed 300 s but never checked for it.
  - I confirmed Bun 1.4.4's semantics separately: `spawnSync(["sh","-c","echo oops >&2; sleep 5"], {timeout: 200})` gives
    `exitedDueToTimeout: true`, `signalCode: "SIGTERM"`, and stderr `"oops\n"`. So the timeout path reports, and it carries
    stderr.
  - A real recording takes about 1.7 s, so 120 s is ample.
- **Stderr in the error line:** all four process-failure lines carry `stderr_tail`, the last 3 non-empty lines joined with
  ` | `, or `(empty)`. These are the lines for the sysroot, the timeout, a non-zero exit and `rustc -vV`.
- **`finally`:**
  - `die` now throws a `RecordError` instead of calling `process.exit` inside the `try`. So the `finally` (`rmSync(WORK)`) runs
    on every path after `mkdirSync`.
  - The top level prints one `ERROR:` line and exits 1. Anything that is not a `RecordError` (for example a missing `rustc`)
    also comes out as one `ERROR: Error: ...` line.
- **Recordings before writes:** both `.tm` texts and `version.txt` are collected in `files`. They are written only after the
  `try`/`finally` completes, so a failure on the second target no longer leaves the first rewritten.
- **`write.test.ts`:** it never runs lldb. It does not import `record.ts`, its only mentions of lldb, `record.ts` and
  `record_tm.py` are comments, and its spawns are `rustc --print sysroot` (`:68`) and `rustc -vV` (`:310`).
- **Fixtures byte-identical:**
  - The diff touches no fixture: there is no `.tm`, `version.txt` or `record_tm.py` in `--stat`.
  - I also ran the tool for real on this branch. It printed `wrote x86_64-unknown-linux-gnu.tm (2 calls)`,
    `wrote aarch64-apple-darwin.tm (2 calls)` and `wrote version.txt`, with exit 0.
  - Afterwards `git status` was clean, and the scratch directory was gone.

### R2

- `rustc_driver_impl/src/args.rs:26-27` at the pin reads the file and pushes each `contents.lines()` item.
- The widened PORT reason at `llvm_util.ts:402-404` is accurate. See N1 for its line length and N2 for the handoff's claim about
  `context.ts`.

## 5. Item 5: the analyze driver

- `grep -nE 'process\.env|Bun\.env|import\.meta\.env|getenv|env\['` on `mir/analyze_oracle/driver.ts` finds nothing.
- `RUST_TS_SSA_STACK` now appears only in docs. No test set it.
- The unported line is now `rust-ts: unported: <what>\n`, and the test treats any nonzero exit as an error (fixers-55 N2). So
  dropping the variable changes debug output only.
- `bun test ./scripts/lib/unit-steps.test.ts`: 10 pass.
- The handoff notes that `base_oracle/driver.ts:224` prints the stack unconditionally. The two drivers now differ in the other
  direction. That is not in scope, and fixers-55 N2 left the choice open.

## 6. Item 6: small nits

- **fixers-55 N1:** `docs/handoff/fixers-55.md:3` now names `t3/fixers-55-codegen-nits`, and that branch exists locally.
- **fixers-55 N3:** `abi_consts.test.ts:11-12` is rewrapped. The text is unchanged.
- **fixers-55 N4:** `base_unsized_info.test.ts:21` now reads `!N`.
- **stable-hash-alloc N1:** the handoff's negative-control list now adds `A_DYN` and the vtable allocation, with the finding's
  reason.
- **stable-hash-alloc N2:** the `abi_consts.test.ts` header item 4 names the vtable relocation. `mir/interpret/mod.rs:262` at the
  pin is `VTable(Ty<'tcx>, &'tcx ty::List<ty::PolyExistentialPredicate<'tcx>>)`.
- **ssa-write N6:** the `as OptLevel` cast is removed. `queries.gen.ts:1576` gives `Value: OptLevel`, so the change is a no-op,
  and `OptLevel` is still imported and used (`back/write.ts:48`, `:334`, `:383`).
- **cg-write N4:** skipped, and correctly: it was already done.

## Findings

No F findings.

- **N1 (nit, comment width)** `src/rustc_codegen_llvm/llvm_util.ts:404`.
  - The widened R2 comment line is 201 columns. It is the only line over 140 in the file, while its neighbours are 111-130.
  - This is the same unwrapped-insertion issue that fixers-55 N3 fixed in `abi_consts.test.ts`. Rewrap it at the next touch.
- **N2 (nit, handoff accuracy)** `docs/handoff/fixers-56.md:43`.
  - The handoff says "`back/write.ts:253` and `context.ts` refer to this comment". `back/write.ts:253` does refer to it.
  - `context.ts` `create_module` (`:424`, `:465`, `:468`) has only the commented `SmallCStr::new` lines and no reason or
    pointer. The reference goes the other way: llvm_util.ts names `create_module`'s drop.
  - There is no code impact. A one-line pointer in context.ts, or a corrected handoff sentence, would close it.
- **N3 (nit, disclosed, out of scope)** `src/rustc_codegen_ssa/mir/analyze_oracle/driver.ts:22`.
  - It still says "The `xlane` stubs of other fill lanes are replaced by recorders". They are forwarders now.
  - The handoff lists this under "Noticed, not changed". Queue it with the next fixer lane.

## For root

- Accept the lane: all six items are correct and in scope, and every check passes.
- This review covers the `scripts/lib/ir-normal.ts` change as its own reviewed batch (AGENTS.md §2). It is comments only, and no
  protected suite reads the file.
- N1-N3 can ride with the next touch of those files.

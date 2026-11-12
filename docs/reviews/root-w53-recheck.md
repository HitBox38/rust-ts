# Re-check: root's fix commit `2abd1fe3` on `integ-w53` (wave 40m / M7 wave 41)

**Verdict: APPROVE WITH NITS**

This re-check covers `2abd1fe3`, which answers findings 1–6 of `docs/reviews/root-w53-check.md` (`48cbff2b`) and removes
the `APFLOAT_TEST_VERBOSE` print. All six nits are fixed. No check got weaker. The type-only import in analyze.ts is safe
in every load order I tried. Finding 7 is still open, as the brief says, and root will list it as a test gap. The three
nits below are cosmetic and none blocks the commit.

## Commands (`2abd1fe3` merged into this branch, `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`, AC power, Bun 1.4.4)

| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check --offline` | exit 0, `markers ok (26359, …)` |
| `bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/rust_ts/llvm/ ./scripts/lib/unit-steps.test.ts` | 268 pass, 0 fail, 0 skip, 29 files |

Because probes were required, the libLLVM differential test (`apfloat.oracle.test.ts`) ran; it was not skipped.

## Q1: Is each nit really fixed?

1. **`const_bytes` (old finding 1): fixed.** skeleton.test.ts:266 now checks the printed constant:
   `printValueToString(out[8])` must equal `[1 x i8] c"\01"`. That is what `LLVMConstStringInContext2(.., [1], 1, True)`
   gives: no trailing NUL, and the byte is escaped.
   - The `out[8]` placeholder at :256 compares `shown[8]` with `out[8]`. It still catches a failure: a thrown `Error`
     becomes a string in `shown` and so no longer equals the `Error` in `out`.
   - An `Unported` stop would get past :256, because `step()` stores `e.what`, a string, on both sides. But then :266
     calls `printValueToString` on a string, and that fails.
2. **Named `TypeError`s (old finding 2): fixed.** Each matcher is now `^TypeError: .*<source>` against
   `${name}: ${message}` (skeleton.test.ts:245-262). `bx.data_layout()` must throw `/this\.tcx\.data_layout is not a function/`
   (:227). That is tighter than the `/data_layout/` the earlier review suggested. Each regex names the failure that the
   earlier review replayed (type_of `this.layout.internee`, `intrinsics.get` twice, `Val.type`, `B.createLoad`,
   `Block.insts`).
3. **Count-table comment (old finding 3): fixed.** skeleton.test.ts:125-127 now credits the 10 stubs to cg-contract.
   `git log -S'excluded (plan-m7 D18)'` confirms this:
   - The stubs come from cg-contract commits `72e43136` (coverageinfo/mod 2) and `a915f565` (autodiff 2, gpu_offload 5,
     typetree 1). That makes 10.
   - The wave base `620acf48` already has `"excluded (plan-m7 D18)": 10`.
4. **Stale `xlane` comments and imports (old finding 4): fixed.**
   - The analyze.ts header (:8-9) now says that mod.ts installs `monomorphized_place_ty`, and that analyze.ts imports
     mod.ts for types only.
   - analyze.ts:36 is `import type { FunctionCx }`, and analyze.ts no longer mentions `xlane` anywhere.
   - The mod.ts header (:17-18) no longer counts ssa-operand-place among the lanes that have not landed. The `xlane`
     table has no ssa-operand-place entries left; it holds only ssa-base, retag, ssa-debuginfo and ssa-block.
   - The unused `type PlaceRef as mir_PlaceRef` import is gone.
5. **`cleanup_pad` tautology (old finding 5): fixed.** builder.test.ts:673 checks that `funclet.cleanuppad()` is the same
   object as the block's last instruction. If `cleanup_pad` wrapped any value other than the pad it just built, the check
   would fail. The IR model has no `LLVMGetLastInstruction`, so reading `BasicBlock.insts` (rust_ts/llvm/inst.ts:55) is the
   only way to check this. Nit 2 below is about the cast.
6. **The `bug!` throw (old finding 6): fixed.** operand_place.test.ts:427 now requires the substring
   `using still-pending operand local _3 as place`. That is place.ts:398's message (place.rs:363) with the `{:?}` filled in,
   so a `TypeError` from an unset `fx` field can no longer pass.

## Q2: Are the new expectations tight without being brittle?

They are tight. Two kinds of coupling are worth knowing about. I accept both.
- **Local variable names.** The regexes name local variables of the IR model and the context (`Val`, `Block`, `B`,
  `intrinsics`, `this.layout.internee`). That is on purpose: each one says which marker value the failure hits. If one of
  those locals is renamed, the test fails at once and shows the new message, so the fix is a one-line update.
- **JavaScriptCore wording.** `evaluating 'Val.type'` (:259) and `evaluating 'Block.insts'` (:262) are JavaScriptCore's
  wording. V8 would say `Cannot read properties of undefined (reading 'type')`. `… is not a function` is the same in both
  engines. The project runs only under the machine's Bun (memory "Project follows the machine's Bun"), and a Bun change
  already needs its own validation batch. So this coupling cannot fail by surprise. See nit 3.

## Q3: Did the change weaken anything?

No. File by file:
- **skeleton.test.ts:** `expect.any(TypeError)` became a match on the name plus the message, which is stricter.
  `expect.anything()` became the printed-constant check, which is stricter. The `out[7]` check is unchanged.
- **builder.test.ts:** a check that could not fail was replaced by one that can. The removed line,
  `bundle() === operand.as_ref()`, compared a method with its own body (common.ts:155-156), so it lost no coverage.
- **operand_place.test.ts:** `toThrow()` became `toThrow(<message>)`, which is stricter.
- **analyze.ts / mod.ts:** only comments and imports changed. The removed value import of `xlane` was not used, because
  the parent commit's analyze.ts never calls `xlane.`.
- **apfloat.oracle.test.ts:** see Q5.

## Q4: Is the type-only import in analyze.ts safe?

Yes.
- **The import itself.** `import type` is always erased, so analyze.ts no longer loads mod.ts at run time. This removes
  the analyze.ts ↔ mod.ts cycle.
- **Nothing runs at load time.** analyze.ts calls `this.fx.monomorphized_place_ty` (analyze.ts:168) only inside
  `non_ssa_locals`'s visitor. So it runs only when someone passes in an `fx`.
- **Where a real `FunctionCx` comes from.** The class is defined in mod.ts (:104), and mod.ts installs operand.rs's and
  place.rs's methods at its top level, right after the class (:261-262). So any real `FunctionCx` exists only after
  those methods are on its prototype.
- **Entry points:**
  - mod.ts's `codegen_mir` calls `analyze.non_ssa_locals(fx, ..)` (:463), so mod.ts has finished loading by then.
  - The only other importer of analyze.ts is analyze_oracle/mock.ts. It imports mod.ts (:17) before analyze.ts (:18),
    and drives everything through `codegen_mir`.
  - analyze.test.ts imports mock.ts only as a type and runs the driver in a subprocess.
  - operand_place.test.ts and mod.test.ts import mod.ts directly.
- **Checked by running it** (scratch scripts, Bun 1.4.4):
  - Importing analyze.ts alone loads neither `rustc_codegen_ssa/mir/mod.ts` nor `place.ts`. I checked
    `require.cache`: 565 entries, and analyze.ts is among them.
  - In each of these orders, `FunctionCx.prototype.monomorphized_place_ty` and `codegen_place` are functions:
    analyze.ts then mod.ts, mod.ts alone, and mock.ts then mod.ts.

## Q5: Did removing the `APFLOAT_TEST_VERBOSE` print change what the differential test checks?

No.
- The removed line was `if (process.env.APFLOAT_TEST_VERBOSE) console.log(...)`. Its template only reads `agreed` and
  spreads `stops` into a new array, so it changed no state.
- `done()` still snapshots `wrong`, `stops` and `agreed`, resets them, and asserts on the snapshot exactly as before
  (apfloat.oracle.test.ts:196-205).
- No other file reads `APFLOAT_TEST_VERBOSE`.
- I checked the runner rule at scripts/lib/unit-steps.test.ts:241-260. It does scan every `*.test.ts` for named env reads,
  so the print did trip it. That test now passes.
- Removing the read was the right fix. The other option was to list the variable in `UNIT_ENV_HARMLESS`, but that edits
  `scripts/`, which needs its own reviewed batch (AGENTS.md §2).

## Findings

1. **One rewritten comment line was not rewrapped** (src/rustc_codegen_ssa/mir/mod.ts:18). It is 168 columns long. The
   lines around it in the header wrap near 120. This is cosmetic.
2. **An ad-hoc cast where the model's type would do** (src/rustc_codegen_llvm/builder.test.ts:673).
   `(bbs[0] as unknown as { insts: unknown[] }).insts.at(-1) as never` reaches into the IR model through a cast written in
   the test. Casting to the model's `BasicBlock` (rust_ts/llvm/inst.ts:53) would type-check the field name, so a rename of
   `insts` would break at tsc instead of as a `TypeError` at run time.
   - Optional: the check could also assert that `funclet.bundle()` carries the pad as its only input, so that both halves
     of `Funclet::new` (common.rs:115) are covered.
3. **Two matchers use JavaScriptCore-only wording** (src/rustc_codegen_llvm/skeleton.test.ts:259, 262). `evaluating 'X.y'`
   holds only under Bun. That is fine while the project is pinned to Bun (Q2). If the expected strings are ever touched
   again, `/Val\b.*\btype\b/` would match both engines' wording and still name the failure. No change is needed now.

Finding 7 of `root-w53-check.md` (no test reaches the `project_index` / `new_sized_aligned` calls in
`write_operand_repeatedly_*`, builder.ts:1845, 1863-1864, 1880) is still open. As the brief says, root will list it as a
test gap. It does not block this commit.

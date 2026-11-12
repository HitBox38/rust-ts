# Review: fixer lane `fixers-55` (wave 40o)

- Reviewed: branch `t3/fixers-55-codegen-nits`, commits `e5fe67c8`, `328270c8`, `2b4d279b`, `478aaa5d`, `95c6e798`,
  `c2650fbe`, `5d2c5672`, `4466a6e7` and `b20c480e` (handoff). Base: `main` at `ba273e7f`; `git diff ba273e7f..b20c480e`.
- Findings checked against: `docs/reviews/ssa-base-recheck.md`, `root-w54-recheck.md`, `ssa-operand-place.md`,
  `cg-builder.md`, `ssa-rvalue-intrinsic.md` and `cg-abi-consts.md`.
- Setup: AC power (`pmset`), `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `bun install --frozen-lockfile`, then
  `git merge --no-edit b20c480e` (a fast-forward). No `GATE_RUNNING`. Oracle `rustc +nightly -vV` reports commit-hash
  `6f5da406b56c2db6607202b63daee73aa8c61297` (the pin). I took no samples.

## Verdict: **PASS WITH NOTES**

Each item fixes its finding and nothing more. The only behaviour change in non-test code is item 5's failure mode. No
must-fix findings. There are four nits.

## 1. Item by item

**Item 1 (ssa-base-recheck note 1): fixed.**
- `mir/analyze_oracle/driver.ts:33-35` takes `--ssa-out=<file>` as `argv[2]` and splices it out. This is the same code
  as `base_oracle/driver.ts:34-36`.
- `analyze.test.ts:101` passes the flag, and the test passes `env: ENV` without `RUST_TS_SSA_OUT`.
- `RUST_TS_SSA_OUT` no longer appears anywhere under `src/` or `scripts/`.
- The driver still reads one variable, `RUST_TS_SSA_STACK` (:66); see N2.
- `bun test ./scripts/lib/unit-steps.test.ts`: 10 pass, 0 fail.

**Item 2 (root-w54-recheck N1): fixed.** Comments only.
- `statement.ts:6-9` now names the three ssa-debuginfo stubs and the two rvalue.rs forwarders, as the review's
  `mir/mod.ts` wording suggested.
- `statement.ts:55` reads "The stubs and forwarders above".
- `rustc_codegen_ssa/mono_item.ts:48` reads "The forwarders above".

**Item 3 (unused imports left by integ-w54): correct and complete.**
- For each of the 17 removed names I counted word occurrences at three points:

  | revision | occurrences |
  |---|---|
  | `7f61ad18`, before integ-w54 | more than one (the import plus uses) |
  | `38fbcf9c`, the last integ-w54 commit | exactly 1 (the import) |
  | `ba273e7f` | exactly 1 |

  No commit in `38fbcf9c..ba273e7f` touches these nine files. So every removed import was one that integ-w54 left
  unused.
- `bunx tsc --noEmit -p .` passes, which confirms none of them is used.
- `bunx tsc --noEmit -p . --noUnusedLocals`, filtered to the touched files plus `rustc_codegen_llvm/mono_item.ts`,
  `abi_consts.test.ts` and `mir/block.ts`, reports only the two imports the handoff leaves on purpose because they
  predate integ-w54: `PreDefineCodegenMethods` (`rustc_codegen_llvm/mono_item.ts:16`) and `Debug` (`mir/block.ts:86`).

**Item 4 (root-w54-recheck N2): correct.** The test is `src/rustc_codegen_ssa/base_unsized_info.test.ts`.
- **Upstream derivation.** I re-read `base.rs:163-221` (`unsized_info`), `:225` (`unsize_ptr`), `meth.rs:103`
  (`get_vtable`) and `:126` (`load_vtable`).
  - `&dyn Sub → &dyn Sub2`: the principals differ, so the arm calls `supertrait_vtable_slot`, which returns
    `Some(5)`. The offset is `5 * pointer_size.bytes() = 5 * 8 = 40`. Then
    `load_vtable(bx, old_info, bx.type_ptr(), 40, source, true)` runs with no VFE. That gives
    `inbounds_ptradd(llvtable, const_usize(40))`, then `load(type_ptr, gep, ptr_align = 8)`, `set_invariant_load`, and
    `nonnull_metadata` (because `nonnull` is true). This is exactly the expected log at :207.
  - `&u8 → &dyn Tr`: the `(_, Dynamic)` arm calls `get_vtable(cx, u8, Some(Tr))`. That is a cache miss, then
    `static_addr_of(alloc, Some("vtable"))`, `apply_vcall_visibility_metadata`, `create_vtable_debuginfo`, and the cache
    insert. The second call is a cache hit with no backend call. This matches :187-200.
  - The vtable has four entries (drop, size, align, `m`), so 32 bytes at align 8, as :194 expects.
  - `→ dyn Sup` (`Sup` is the prefix) returns `old_info` because the slot is `None`.
  - `dyn Sub + Send → dyn Sub` and `→ dyn Send` return `old_info` through the NOP arm (same principal, or no principal
    in the target).
- **Oracle facts, regenerated with the pinned rustc** in my scratchpad:
  - `#[rustc_dump_vtable]` on `impl Sub for u16` prints `[MetadataDropInPlace, MetadataSize, MetadataAlign,
    Method(<u16 as Sup>::a), Method(<u16 as Sub2>::c), TraitVPtr(<u16 as Sub2>), Method(<u16 as Sub>::b)]`. That is
    entry 5, as cited.
  - `-Cno-prepopulate-passes --emit=llvm-ir` for `up2` gives `%0 = getelementptr inbounds i8, ptr %x.1, i64 40` and
    `%_0.1 = load ptr, ptr %0, align 8, !invariant.load !8, !nonnull !8`.
  - `up1` has only the two `insertvalue`s.
  - `@vtable.0 = private unnamed_addr constant <{ [24 x i8], ptr }> …, align 8`.
  - These all match the test's comments. The metadata number is `!8` in my smaller crate, not the cited `!12`; see N4.
- **Mutation.** I changed `base.ts:283` to `(entry_idx + 1) * ptr_size.bytes()`. The test failed (`usize 48` vs
  `usize 40`). I reverted the change, and the test passed again.
- **No absolute path.** The temp dir comes from `DATA` and the sysroot from `oracleSysroot()`. The dir is removed in
  `finally`.

**Item 5 (ssa-operand-place N3): correct.**
- `traits/builder.ts:835`, `:836`, `:869` and `:877` now pass `self.debug_Value` to `PlaceValue.with_type`.
- `src`, `dst`, `left` and `right` are each `PlaceValue<B["Value"]>`, so `B["Value"]`'s `Debug` is the right one.
- Upstream `place.rs:60-66` formats `self.llextra` (an `Option<V>`) with `{:?}`. The port's message,
  `debug_option(this.llextra, PLAIN, debug_V)`, is that.
- The message is built lazily, so a passing assertion has no effect. Only a failing one changes: exit 101 with
  upstream's text, where before it stopped as unported (exit 70).

**Item 6.**
- **cg-builder N3, no change needed: confirmed.** `skeleton.test.ts:256` expects
  `typeError(/evaluating 'Block\.insts'/)` for the `build_inherent` step. `typeError` pins `^TypeError: .*<message>`
  (:240). No `expect.any(TypeError)` is left in `src/rustc_codegen_llvm/`.
- **cg-builder N4: fixed.** The diff adds only a two-line comment at `builder.test.ts:390-391`.

**Item 7.**
- **ssa-rvalue-intrinsic N1: fixed, comments only.** Each decision the review lists now has a `// PORT:` line at the
  cited site:

  | decision | site | upstream |
  |---|---|---|
  | 3 | rvalue.ts:1272 | rvalue.rs:433-434 |
  | 4 | rvalue.ts:1283 | rvalue.rs:223-224 |
  | 5 | rvalue.ts:1160 | rvalue.rs:1097 |
  | 5 | naked_asm.ts:635 | naked_asm.rs:478/480 |
  | 6 | naked_asm.ts:637 | naked_asm.rs:349 |
  | 8 | rvalue.ts:1142 | rvalue.rs:368, nested in `codegen_transmute_operand` at :335 |
  | 12 | naked_asm.ts:60 | naked_asm.rs:54 |

- **ssa-rvalue-intrinsic N3: fixed.** `_h: u16` is appended after `_t`, so it is local 16 and locals 1-15 keep their
  indices. `names` gains `"h"` at index 16. The only other expectation change is the `S.c` operand
  (`copy_(3)` → `copy_(16)`) and its store (`%c:i8` → `%h:i16`), with the same offset `%3` and `align4`. Nothing else in
  the file moved, and the test passes.

**Item 8 (cg-abi-consts N1, N2): fixed.**
- **N1.**
  - `canon_sig` now captures the text after the parameter list, `([^)]*)$`.
  - `fn_flags` expands `#N` through `attr_groups`, which parses `attributes #N = { … }` lines exactly as LLVM prints
    them. It then keeps `noreturn`/`nounwind`. Both the oracle and the port go through this for `define`, `declare` and
    `call` lines.
  - The comparison is real. In the regenerated `sigs.rs` oracle IR (x86_64-unknown-linux-gnu, `-Copt-level=0`), group
    `#1` is `{ nounwind nonlazybind uwtable … }`, on every `extern "C"` fn plus `cc_sysv64` and `cc_win64`. Group `#3` is
    `{ noreturn … }`, on `r_never`.
  - Two mutations of `abi.ts`, each reverted:

    | mutation | result |
    |---|---|
    | `:555` `apply_attrs_llfn` `nounwind` disabled | the fn-signature tests fail at `-Copt-level=0` and `=1` (2 fail) |
    | `:707` `apply_attrs_callsite` `nounwind` disabled | the `call_*` test fails |

- **N2.**
  - The spill test now checks that the port has exactly `spill_bool`, `spill_direct` and `spill_pair`. Their block
    lengths must be Pair 4, Direct 2 and bool 3, the alloca included. These are the counts the review suggested.
  - Mutation 1 (test-side): the port text is replaced by `""`. The test fails (`Expected […3 names] / Received []`).
  - Mutation 2 (code-side): in `abi.ts` `store_fn_arg`, the `Direct`/`Indirect`/`Cast` arm skips `this.store`, which
    truncates the blocks. The new test fails (`spill_direct: 1`, `spill_bool: 1`). With the same mutation, the
    **pre-fix** test from `ba273e7f` passes 6/6, which shows the gap N2 described.
  - I reverted both mutations with `git checkout`. `git status` is clean.

## 2. Scope

`git diff --name-only ba273e7f..b20c480e` lists 20 files: the handoff plus 19 under `src/`. Each maps to an item:

| item | files |
|---|---|
| 1 | driver.ts, analyze.test.ts |
| 2 | statement.ts, rustc_codegen_ssa/mono_item.ts |
| 3 | nine files |
| 4 | the new test |
| 5 | traits/builder.ts |
| 6 | builder.test.ts |
| 7 | rvalue.ts, naked_asm.ts, rvalue_intrinsic.test.ts |
| 8 | abi_consts.test.ts |

`rvalue.ts` is the only file two items touch: item 3 removes an import, and item 7 adds comments. No file falls outside the
`docs/next.md:672` scope.

## 3. Commands

| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check --offline` | exit 0, `markers ok (26581, 44 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 404)` |
| `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts` | 244 pass, 0 fail, 2359 `expect()` calls, 31 files, no SKIP lines |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass, 0 fail |
| `bunx tsc --noEmit -p . --noUnusedLocals` (filtered to the touched files) | only the two pre-existing imports above |

## Findings

No F (must-fix) findings.

- **N1 (nit): wrong branch name in the handoff.** `docs/handoff/fixers-55.md:3` says "Branch `t3/acbe0095`". The work is
  on `t3/fixers-55-codegen-nits`, and no `t3/acbe0095` branch contains `b20c480e`.
- **N2 (note): the analyze driver still reads one environment variable.**
  - `src/rustc_codegen_ssa/mir/analyze_oracle/driver.ts:66` reads `RUST_TS_SSA_STACK`. It only appends a stack trace to
    the stderr line of an unported stop.
  - The test treats any nonzero exit as an error, and passing output does not depend on it.
  - It predates this lane, and the handoff discloses it. The finding (ssa-base-recheck note 1) was about
    `RUST_TS_SSA_OUT`, which is gone.
  - `base_oracle/driver.ts` reads no variable at all, so the two drivers still differ by this one debug switch. Root
    may want a `--stack` flag later. It is not blocking.
- **N3 (nit): the item-8 header line is not rewrapped.** `src/rustc_codegen_llvm/abi_consts.test.ts:11` is 159 columns.
  The new text was inserted without reflowing the rest of the sentence; nearby comment lines are 109-128 columns.
  Cosmetic only.
- **N4 (nit): a crate-specific metadata number in a comment.** `src/rustc_codegen_ssa/base_unsized_info.test.ts:21`
  cites `!invariant.load !12, !nonnull !12`. The number depends on the crate: a minimal crate with the same traits gives
  `!8`. Writing `!N` would keep the comment true when someone else reproduces it. The cited facts themselves
  (`getelementptr inbounds i8, ptr %x.1, i64 40`, `align 8`, both metadata kinds) reproduce exactly.

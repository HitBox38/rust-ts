verdict: ACCEPT WITH AMENDMENTS

Design: plan-m7 (`docs/plan-m7.md`, `docs/handoff/plan-m7.md`, branch `t3/plan-m7-clang-ir`, head a6966e12).
Reviewed against AGENTS.md, PORTING.md, PLAN.md, the pinned upstream, and the pinned LLVM sources, which the plan did not read. I am
read-only: this file is all I wrote to the tree. I did not run the gate or a full suite. No oracle component was added or removed. My
scripts and small outputs are in `$RUST_TS_DATA/tmp/review-plan-m7/`. Load average was 2-36, shared with other lanes, so compare user CPU.

The architecture is right, and it held up better than I expected: D1, D2's comparison, D4 and D13 all survive direct attempts to break
them. I tried to falsify the ripgrep estimate and could not. What must not stand:

- **The fallback (§9) is not viable as written (F1).** Behaviour is almost blind to what IR catches. Making every signed compare
  unsigned changed 0 of 113 programs. "IR report-only, gate on behaviour" would give up the protection the plan says it wants. Replace
  it with tiers of normal form (tested below), and decide by a rule written now.
- **M7a's order cannot run (F2).** `ir-hello` is due in wave 41, but the code that reaches the printer is scheduled for wave 42.
- **M7c's denominator is undefined, and D9 pre-spends most of its allowance (F3).** The native suites inherit a case list selected for
  x86_64-linux.
- **Stock `rg-build` stops on D9's own wording (F4).** Cargo passes `-Csplit-debuginfo=unpacked` on macOS.
- **The unit-time rule overspends its budget by arithmetic (F5).**

Two premises are out of date, both in the plan's favour. O2 is one bug and `fixers-39` already fixes it, including on `rg` (F7). And
"nothing here can execute x86_64" is false: Rosetta runs x86_64-apple-darwin here (F8).

## What I checked

| Claim | How | Result |
|---|---|---|
| Apple clang cannot parse rustc's IR | `clang -c -x ir` on prog.rs | **OK.** Same token, `nocreateundeforpoison`, clang-2100.3.34.2 |
| `llc` uses rustc's `libLLVM.dylib` | `otool`, `DYLD_PRINT_LIBRARIES`, `shasum` | **OK in substance, prefix wrong.** They load **two files**, `lib/libLLVM.dylib` and `lib/rustlib/aarch64-apple-darwin/lib/libLLVM.dylib`. Same size, same SHA-256 (`468b56993bc4`, not the plan's `b7a4d6261326`), same UUID `EEB002FB…`. D1's guard must hash both |
| `llvm-tools` needs no `rustup component add` | `rustup component list --installed`, `UPSTREAM.json:11` | **OK.** Already installed and in the checked list. Files dated Oct 13 00:45, the project's first day. I ran only the read-only listing |
| 381 FFI fns, 131 `LLVMRust*`, 2,227-line builder, 31,078 lines | `grep`, `wc` at the pin | **OK.** Exact. 31,078 − 2,630 (FFI) − 3,163 (out of M7) = 25,285, the plan's "about 25k" |
| `libLLVM` exports 1,309 `LLVM*`, driver exports 1 `LLVMRust*` | `nm` | **OK.** Exact. The driver imports 349 C functions, which is what made the tracer below possible |
| LLVM submodule `aab11ee0ea5e` | `git ls-tree` | **OK.** 15 files fetched from `rust-lang/llvm-project` at that commit without trouble (F6) |
| Normal form catches real differences | My own 31 mutations, not the plan's | **OK, one hole (F10).** Everything semantic was caught |
| Control: pipeline loses almost nothing | The `none` row of my behaviour run on a different sample | **OK.** 113 of 114 the same; the other is CFI's `llvm.type.test`, which the plan also names |
| `-O` on 3,358; `prefer-dynamic` 3,440; CGU=1 on all | Re-counted from the case argv | **OK.** Exact. CGU=1 is on all 3,478 |
| Level-2 MIR barely covered | Re-ran `mir/cov.ts` | **OK, slightly understated.** Besides 3 of `mir-minicore`, `run-pass-miri` has 33 cases at an explicit `-Zmir-opt-level` of 3 or 4 (fixers-39 counts 36 with Inline on, all MATCH) |
| O2 repro, 5 of 120 ICE | `o2/p2.rs` and the plan's own 5 | **Reproduced, then fixed (F7).** `rg` ICEs on my branch. On `fixers-39`: p2 identical, 5 of 5 MATCH |
| ripgrep cost not off by 10× | Timed real crates at level 2 (F12) | **OK.** Level 2 plus MIR encoding adds about 20% on libraries |
| 10.66 h gate, unit limit 1,800 s | Summed 52 suite summaries; `scripts/gate.ts:270` | **OK.** Exact |
| 37 lanes, 51.7k lines | Summed §8 against §2 | **OK.** 25.3k + 26.4k adds up. Lane sizes fine, except F11 |

## How much of the oracle's IR depends on LLVM's behaviour (question 2)

The plan's list was from memory, so I measured it. `DYLD_INSERT_LIBRARIES` interposes on all 349 C functions the driver imports, with
nothing on disk changed, and the traced IR is **byte-identical** to untraced IR. 239 sampled run-pass cases, compiletest's argv:

| | `-O` (as compiletest) | `-Copt-level=0` |
|---|---|---|
| IR lines | 480,716 | 464,378 |
| `LLVMBuild*` calls / returning a constant | 293,866 / 6,951 (2.4%) | 253,717 / 7,447 (2.9%) |
| **Cases with at least one builder fold** | **131 (55%)** | **125 (52%)** |
| Cases with an FP fold | 1 | 1 |
| Distinct shapes of fold on a non-numeric constant (normalised) | 47 | 51 |
| `LLVMSetValueName2` / instruction and argument collisions | 66,966 / 5,066 (7.6%) | 72,718 / 4,552 (6.3%) |
| Block name collisions | 940 | 1,101 |
| **Cases with a collision in a value or block name** | **85 (36%)** | **96 (40%)** |
| Global name collisions (`LLVMAddGlobal`) | 0 | 0 |
| Casts returning their own non-constant operand | 26,869 | not summed |

So the folder and the suffix rule are **not edge cases**: a model without them fails most cases. They are **also small**: nearly all
folds are integer (`zext`, `or`, `shl`, `sub`, `icmp`), plus constant `getelementptr`, `inttoptr` and `insertvalue`. `ConstantFold.cpp`
is 1,380 lines at the pin and this sample reaches a fraction of it. The plan's 1.5k for `llir-folder` is credible, and D5's "only what
a reached call needs" fits what I saw.

**What the model needs that §2c does not say, read from the pinned source:**
- `IRBuilder::CreateCast` returns its operand when the type already matches (`IRBuilder.h:2277`). This is not constant folding. It is
  26,869 of the calls above, nearly all `LLVMBuildPointerCast`. A model that folds only constants emits a pile of no-op casts.
- The collision counter is **one per symbol table, shared by every name, and never reset** (`ValueSymbolTable.cpp`, `++LastUnique`), with
  a dot only for globals. Real output: `self` → `self1`, `src` → `src3`, `e.0` → `e.07`. One extra or missing collision anywhere in a
  function renumbers the rest of it. Blocks share the table.
- Folding to `i1 true` on `icmp @g, null` (`evaluateICmpRelation`, `ConstantFold.cpp:1079`, with a weak-linkage rule). 457 compares had a symbolic
  operand at `-O`, and the shapes I read were all `@g` against null, from precondition checks.
- `and (ptrtoint @g), mask` folds using the global's alignment **and the data layout** (`ConstantFold.cpp:783-792`, including "assume
  functions are aligned to 4"). Seen 17 times at O0. It is the one rule so far that needs a data layout in the model.
- `distinct` on metadata: `hasSelfReference` (`Metadata.cpp:877-895`). This is what the plan's "the printer marks some `DICompositeType`
  `distinct`" (§1b) comes down to. Metadata nodes are uniqued by content, so `llir-di` needs uniquing and this rule.
- Named struct types exist in output (48 of 240 cases, 335 types, e.g. `%"core::sync::atomic::Atomic<usize>"`), but **0** collided, so
  `StructType::setName`'s suffix is not yet reached.

**What the model does not need:** the parser folds constant expressions, so `getelementptr … i64 0` and `inttoptr (i64 0 …)` normalise
away. That confirms the plan's reasoning. Value names exist only with `--emit=llvm-ir`, because `fewer_names` is on for native builds, so
the behaviour path never depends on the suffix rule.

**Is it a port or a redesign?** Port above the seam, plainly new code below it. The trait seam (B) really is a redesign, and the counts
that say so are right. `src/rust_ts/` is PORTING §2's place for non-ported code, and "the FFI's names unchanged" keeps `builder.ts`
readable against `builder.rs`. D4 stands. But the plan leaves the new code's contract loose, see F6.

## Decisions

| | Verdict | Reason |
|---|---|---|
| D1 | **agree** | Not drift. PLAN.md's point is text IR through LLVM, and the only LLVM that reads this IR is the pinned one. It adds no dependency M9 did not already have: LLVM was never ported. Correct the hash; guard both dylib copies |
| D2 | **amend** | Comparing before passes is right, and after passes is rightly not a gate. Add tiers (F1) and anchor the `preds` strip (F10) |
| D3 | **amend** | F3, F8 |
| D4 | **agree** | Needs the owner's approval before wave 40. `rustc_llvm`'s wrappers should carry markers (F6) |
| D5 | **amend** | F6 |
| D6 | **agree** | The level-2 inliner already reads the oracle's rmetas correctly: `rg` matches byte for byte |
| D7 | **agree** | |
| D8 | **amend, minor** | State what `-Cembed-bitcode`'s default does for port-built rlibs: `back/write.rs:1001` embeds bitcode, and a text pipeline has no buffer. Fat LTO has **no measurement**: the control could not compare it (F3) |
| D9 | **amend** | F4 |
| D10, D11, D15, D16 | **agree** | |
| D12 | **amend** | F9 |
| D13 | **amend** | Right order, stale content, and three additions (F7) |
| D14 | **amend** | F13 |
| D17 | **amend** | Add the call-level diff (F6) |
| D18 | **amend** | Same split-debuginfo wording as D9 (F4) |
| D19 | **agree** | `-j4` with F12's memory note |
| D20 | **amend** | Split the harness lanes (F11) |

## Findings

### F1. HIGH, blocking: the fallback gives up what IR protects, and "stalls under about 90%" is not a rule

§9 says that if `ir-run-pass` stalls, "lower IR to report-only and keep behaviour as the gate". I tested what behaviour can see. Oracle
IR with bugs injected across the whole module, then `opt`, `llc`, the oracle's link line, run, against the oracle's binary. 114 cases
compared (`fb/fb.ts`, host):

| Injected into every function of the program's own module | Behaviour changed |
|---|---|
| None (control) | 0 of 113 |
| `noalias` on every pointer parameter (unsound) | **0 of 113** |
| `nuw nsw` on every `add`, `sub`, `mul` (unsound) | **0 of 113** |
| `!nonnull` on every loaded pointer | **0 of 113** |
| Loads and stores of integers claim `align 16` | **0 of 113** |
| Every plain GEP becomes `inbounds nuw` | **0 of 113** |
| `icmp slt/sgt` becomes `ult/ugt` | **0 of 113** |
| Lifetime markers dropped | 0 of 113 |
| `readonly` on every pointer parameter | 3 of 87 (the verifier rejected 27) |
| `sub i64` becomes `add i64` | 6 of 113 |
| `store i64` deleted | 37 of 113 |
| `icmp eq` and `ne` swapped (control: can the detector fire?) | 62 of 113 |

**Failing scenario.** IR goes report-only in wave 43. A later lane mis-lowers a `noalias` rule or a signedness in `rvalue.rs`. Run-pass
stays at 98%: most of what these small programs run is in the oracle's `libstd.dylib` (`prefer-dynamic` on 3,440), and they assert little
about the rest. M7 closes. `rg` miscompiles only when LLVM happens to exploit the fact. On x86_64-linux, where nothing runs, no check is
left at all.

This also changes how the two gates read. Behaviour passing says the program is **linked and unwinds**, which is what the plan says it is
for, but it is not evidence the IR is right. M7's real parity claim rests on IR.

**Amendment, replace the §9 fallback with tiers of normal form.** I tested these (`nf/tier.ts`; N2 and N3 go through `llvm-as`, since `opt
--discard-value-names` refuses text):

| Mutation | N1 (the plan's) | N2: + `--discard-value-names` | N3: N2 + `function(instsimplify)` |
|---|---|---|---|
| Every collision name wrong | caught | **absorbed** | **absorbed** |
| 3 builder folds missed | caught | caught | **absorbed** |
| `noalias` dropped; `align` wrong; `!noundef` dropped; `nuw` added on `add`; two declarations swapped; `slt` → `ult` | caught | caught | caught |
| `nuw` dropped on one GEP | caught | caught | **absorbed** (that GEP had a zero index; not generalised) |

The rule, recorded before wave 41:
- N1 is the target and what M7c asks for.
- If, at M7c's gate, `ir-run-pass` is under 95% on N1 and at least half of the failures are classed as model behaviour (`ir-diff` and the
  call-level diff, F6), gate on **N2**. If names are not the cause, on **N3**. Each is one recorded decision, and the lost tier stays as a
  report.
- **Behaviour is never the only gate on codegen.** Below 95% on N3 is a STOP.
- **The first decision point is M7b, not "when it stalls":** at M7b's gate root records each of `ir-run-pass`'s three tiers and the
  failure classes, so a stall is visible a wave early.

### F2. HIGH: M7a cannot run in wave 41

§8 puts `ir-hello` in M7a, gated after wave 41, and says wave 41 "unlocks x86_64-linux IR for hello". But `ssa-base` (41) reaches
`start_async_codegen` (`base.rs:771` → `back/write.rs:423`) and `submit_codegened_module_to_llvm` (`back/write.rs:2199`), which are
`ssa-write` (**wave 42**), and the only call that prints a module is `LLVMRustPrintModule` in `codegen()`
(`rustc_codegen_llvm/back/write.rs:942`, `:1044`), which is `cg-write` (**wave 42**). `-Cno-prepopulate-passes` still goes through
`LLVMRustOptimize`, which is `llir-tools` (**wave 42**).

**Failing scenario.** All 12 wave-41 lanes merge. `ir-hello` stops `unported` at `start_async_codegen`. M7a cannot gate, and the "fixers
from `ir-hello`" have nothing to look at, unless someone writes a throwaway driver the plan does not have.

**Amendment.** Move `ssa-write`, `cg-write` and the print and `assign-guid` part of `llir-tools` to wave 41. That is 5.2k lines, so the wave
needs sequencing against the 5-6-heavy-lanes rule. Wave 42 keeps link, archive, vendor and native.

### F3. HIGH: M7c's denominator is not defined, and it is mostly spent in advance

The native suites inherit a list built for another target. `harness/compiletest.ts:115` hardcodes `COMPILETEST_TARGET =
x86_64-unknown-linux-gnu`, and the plan's native sample filters that list with no host evaluation (`np/sample.ts`).

- **47 corpus files have directives that exclude this host:** `only-x86_64` 22, `only-linux` 20, `only-x86` 5, `ignore-apple` 4,
  `ignore-aarch64` 2, `only-gnu` 2, others (overlaps counted once). compiletest would not run them. Under §1g's "the oracle's program is
  the expectation" they still count, either as errors on both sides or as programs that test something else.
- **12 host-specific tests are in no suite:** `tests/ui/asm/aarch64/*` (5), `darwin-objc/*` (3), `target-feature/aarch64-neon-works.rs`,
  `backtrace/apple-no-dsymutil.rs`, others. They are the run-pass tests aimed most directly at the code `abi-aarch64` and the native path
  add.
- **At M7c, D8, D9 and D18 stop by name 43 cases that build on the host** (`st2.ts`): debuginfo 25, because D9 lands it in wave 44, after
  M7c in wave 43; sanitizers 12 of 24, the other 12 being oracle errors; `-Clto=thin` 6. 2% of 3,478 is 69.6, so **26 are left** for
  everything else: 22 fat-LTO cases with no measurement, all of `asm!`, SIMD, runtime surprises. The plan's "sanitizers 24, CFI, asm"
  does not count debuginfo.

**Failing scenario.** Wave 43 ends at 97%, with 25 of the failures being debuginfo. The gate is met only by moving the denominator after
seeing the result, which is what the plan-m6 review's G1 warned against.

**Amendment.**
- `harness-m7b` evaluates directives for the host (`COMPILETEST_TARGET` becomes a parameter, its own reviewed batch), so `run-pass-native`
  is compiletest's list for `aarch64-apple-darwin`.
- The list of named exclusions is written **before** the suite's first port run and recorded with counts. Debuginfo cases are excluded
  from M7c by name and return at M7d.
- State what an oracle-side compile failure counts as. The sample has about 1.7% of these (2 link failures, for instance), and D12 only
  describes running twice.

### F4. HIGH: stock `rg-build` stops at D9's own wording

D9 ends "(`-Csplit-debuginfo`, dwp: `unported`.)" and D18 lists "`-Csplit-debuginfo` packages". M7d requires the stock release profile. I
ran the oracle's cargo with ripgrep's `[profile.release] debug = 1` on this host: it passes **`-C split-debuginfo=unpacked`** to every
crate.

**Failing scenario.** `rg-build` stops on the first crate. The argv kept in the plan's `rg/args*` does not show this, because it is all
for x86_64-linux (`--target x86_64-unknown-linux-gnu`).

**Amendment.** D9 and D18 say: `Off` and `Unpacked` are ported (`link.rs:1498` does nothing for them). `Packed` runs `dsymutil`
(`link.rs:1507`) and is ported too, because it is Apple's default (`spec/base/apple/mod.rs:174`), so the 25 debuginfo cases with no split
flag reach it. Only DWARF packages stay `unported`.

A relief for the same wave: `-Cdebuginfo=1` is far smaller than `=2`. On a small trait-object program it emits only `DILocation`,
`DISubprogram`, `DILexicalBlock`, `DILexicalBlockFile`, `DINamespace`, `DIFile`, one `DICompileUnit` and one `DISubroutineType`, with no
composite types. So `rg-build` needs only that part of `llir-di` first. Order the two `cg-di-*` lanes' fixes accordingly.

### F5. HIGH: the unit-time rule overspends by arithmetic

§6: unit step 1,266 s quiet, limit 1,800 s (`scripts/gate.ts:270`), and "each lane adds ≤ 15 s". 37 × 15 s = 555 s; 1,266 + 555 = **1,821 s,
over the limit**, before about 15 fixers. The plan itself records 2,005 s under load.

**Failing scenario.** Late in wave 44 the unit step times out, and a 13-hour gate reports a failure unrelated to the code under test.

**Amendment.** ≤ 5 s per lane, fixers included, checked per wave. Or a harness batch first that splits the unit step. Either way, record it
before wave 40.

### F6. MEDIUM: the model's contract is too loose for how much depends on it

D5 asks lanes to port from LLVM source, with `// llvm:` markers. Nothing specifies that source, and nothing checks the markers:
`coverage.ts` knows only rustc paths. "Never guess a fold" is unverifiable as written.

`llir-core`'s proof is "fixtures … driven by a recorded script of FFI calls", but nobody says who records. **It cannot be complete from
real rustc:** the C functions can be recorded, as above (builders, including `LLVMBuildCallWithOperandBundles`), but the 131 `LLVMRust*`
wrappers are inside the driver (1 exported), including every attribute creator, `LLVMRustAddFunctionAttributes` and
`LLVMRustGetOrInsertGlobal`.

**Failing scenario.** `llir-core` merges against hand-written fixtures that encode the author's reading. 11 fill lanes build on it. The
first real comparison is wave 41's fixers, with no way to tell a model bug from a port bug except by reading.

**Amendment to D5 and D17, all small:**
1. A manifest of the LLVM files used, by path and hash at `aab11ee0ea5e` (fetching works; I fetched 15), and a check that `// llvm:` lines
   point at them. Reviewers need the same files. The wrappers in `compiler/rustc_llvm/llvm-wrapper/*.cpp` get `// rustc:`-style markers,
   since they are in the checkout at the pin.
2. Adopt the tracer as a probe (`ffi/gen.ts`, about 50 lines). It gives each case's real fold and collision events, so `llir-folder` is
   tested against what LLVM did on that case.
3. For rules the corpus reaches rarely, differential tests of the model against the real C API in `libLLVM.dylib`. **In tests only**, so
   this does not reopen option C: it is the same oracle-through-a-probe pattern as `tools/probes`.
4. D17's `ir-diff` names the first differing function. Add the first differing **C API call**, from the same tracer. It separates "the
   port called something else" from "the model answered differently", which is the classification F1's rule depends on.

**Size.** I judge "about 3k" low for `llir-core`: about 290 API functions and every instruction form in one contract lane. It does not need
canonical printing (`AsmWriter.cpp`'s 5,550 lines), since `opt` canonicalises. I would plan on about 5k and split it behind one contract.

### F7. MEDIUM: D13's order is right, its content is stale, and it misses three things

**O2 is one bug and it is fixed.** `fixers-39` (`42927bfb`, "Inline: each mapped unwind edge gets its own copy of `cleanup_block`", not
yet merged; review in progress) on that worktree:

| | Result |
|---|---|
| Plan's 5 ICE cases | 5 of 5 MATCH |
| Fresh salted sample of 80, compiletest's argv, `-Zunpretty=mir` | 79 of 80. The miss is `rustc-env/def-path-hash-ice-157238.rs`: a `RUSTC_LOG` stop, not MIR |
| **`rg`, release argv, oracle-built rlibs, `-Copt-level=3 -Zunpretty=mir`** | **5,763 KB, byte-identical.** My unfixed branch ICEs at `flags::complete::bash::generate`, as the plan says |
| Upstream's `tests/mir-opt`, 72 files, `-Zmir-opt-level=4 -Zvalidate-mir -Zmir-enable-passes=+Inline` plus each test's flags and pass | 71 of 72. The miss is `dump_dataflow.rs`: `rustc_graphviz::render` |
| Host target, hello, `-O -Zunpretty=mir` | byte-identical (the only host level-2 run I did) |

So §9's "O2 may not be one bug" is largely retired, and `mir-o2` ≥ 99% is roughly where it already stands.

**Amendment to wave 39:** delete `o2-inline`; it becomes "merge `fixers-39`". Take O1 out of `real-crates`: `4c0c1cfe` has it. Keep O3-O7.

**Is the front end otherwise tested at those levels? Not on these paths, and D13 should add them:**
1. **No suite encodes optimized MIR.** `should_encode_mir` (`encoder.rs:1196`) gives false under `--emit=metadata`, so every `rmeta-*` suite
   and **`check-rg` as defined** never run `optimized_mir` on non-const functions or encode it. The 29 of 34 identical `.rmeta`s do not
   test what a real rlib carries. **Failing scenario:** M7d's first port-built rlib is read back by the port with a mis-encoded MIR body,
   and it shows up as a wrong program at the end of the milestone. **Cheap fix, already promising:** `--emit=metadata -Copt-level=3
   -Zalways-encode-mir` is byte-identical on `memchr` and `regex_syntax`. Run `check-rg` in both modes, and add a sample of `rmeta-ui`'s
   730 in that mode. (`serde_core` needs its build-script environment, so I did not get a comparison.)
2. **`check-rg` and `mir-o2` are x86_64-linux; `rg-build` is the host.** `cfg(target_arch = "aarch64")` in `memchr` and friends and
   `libc`'s macOS modules have never gone through the port. Add `check-rg-host` once `abi-aarch64` lands, in the same wave.
3. **`tests/mir-opt` (408 files) is the corpus built for this and is unused.** Directed at each pass, a few minutes per gate, 71 of 72
   today. Add `mir-opt-o4`. It is outside `UPSTREAM.json`'s sparse list, as `tests/codegen-llvm` is. Both sparse additions need recording
   before `harness-m7a`.

Not addressed by anything before IR: shim bodies (`make_shim` at level 2). `-Zunpretty=mir` does not print them, and `mono-ui` prints only
names. I have no cheap check, so accept that IR finds these first.

### F8. MEDIUM: "nothing here can execute x86_64" is false

§1f, §9 and D3 say so. **Rosetta is installed and running** (`oahd`; `arch -x86_64` works). I downloaded `rust-std-nightly-x86_64-apple-darwin`
(30.5 MB, SHA-256 checked) into a scratch directory, **not** into the oracle, and built with the oracle's `rustc --sysroot` on it. A
program with `extern "C"` struct passing, `f32`, `u128` and `catch_unwind` ran correctly. **58 of 58 sampled run-pass cases that built ran
with exit 0** under `arch -x86_64` (60 sampled, 2 did not build; `x86/ctl.ts`).

It does not give x86_64-linux: no ELF, no glibc. But it does execute the x86_64 ABI lowering, which is the same `callconv/x86_64.rs` the
plan says only IR can check, unwinding included.

**Amendment to D3.** Add report suite `run-pass-native-x86darwin`, with a sysroot under `$RUST_TS_DATA` (the plan-m6 pattern), from wave 43.
It costs little once Mach-O works and directly narrows §9's "Host-only native checks" and F1's blind spot. Correct §1f and §9. The Docker
client (29.6.1) is present with no daemon, and `RosettaLinux` exists; whether to start a Linux VM is the owner's call, and I did not try.

### F9. MEDIUM: what D12 leaves out of a native comparison

- **Flakes in the ratchet.** Today's suites are deterministic. Native ones have real threads (106 corpus files use `thread::`), clocks and
  ASLR. Oracle stability comes from two runs, and the port side runs once. The plan's sample has 3 of 236 unstable on two runs, so more
  will be unstable less often. **Failing scenario:** one protected case flakes at load 100+ and rejects a 13-hour gate. `fixers-39`'s
  handoff has a live example of a clock bound failing 8 of 16 under load on the Miri path. **Amendment:** three oracle runs at accept time;
  on a port-side DIFF of a protected native case, one rerun, recorded as FLAKY and listed in the gate record, never silently passed.
- **`exec-env` is lost.** The corpus carries it as `-Zmiri-env-set` (4 cases), and the plan's scripts strip every `-Zmiri-*`, so as far as I
  can read, its sample ran those without their environment. D12 should say native runs take it from the directive. Run-flags (6 cases) are handled.
- **The allocator shim is in no `ir-*` comparison.** `--emit=llvm-ir -Csave-temps` wrote only `p.ll` and the CGU's `.rcgu.ll`. Say so in
  §1a; on x86_64 only IR could have checked it, and F8 would.

### F10. LOW: the normal form has one hole, and its acceptance test is circular

I ran 31 mutations of my own against §1b's normal form (`nf/m.ts`; 2 turned out to be parse errors and 1 a no-op, so 28 tested). All semantic ones were caught, including ordering of declarations,
globals and allocas, `noalias`, `nuw`, `!noundef`, alignment, triple, datalayout, module flags, `sret` types, and an extra declaration. The
absorbed ones are harmless: parser defaults, unused nodes, implied `dso_local`, folded constexprs, and attributes on intrinsic declarations
(the parser replaces those, so a wrong `noreturn` there is ignored by everything).

**The hole:** ` +; preds = .*` is not anchored. On `static S: &str = "abc  ; preds = %bb1, %bb2"`, a wrong `align 64` or an added `section`
on that global's line is **absorbed**, as is any later difference in the literal. No `tests/ui` file contains that text today. **Amendment
to D2:** strip only on block-label lines, and pin it as one of `harness-m7a`'s "what it must not absorb" tests.

**On the parity evidence (question 3).** `normsim.ts`'s 150 of 150 mutates exactly what the normal form was designed to absorb, so it tests
the normaliser's design against itself. It says nothing about a real port's parity, and it does not claim to in §10, but §0's table sits
next to "how big is the work". The honest statement is:

> The normal form is a sound comparator: it keeps what matters and absorbs printer artefacts. No port IR exists. Per-case IR parity depends
> on one model behaviour hit by about half of cases and another by about a third. Each is small and has a known rule, and the layer above is
> a line port of the kind that reached 97% on MIR. M7c's 95% is a target with no measurement behind it; the first real number comes at
> wave 41's end.

Whole-module equality means one wrong function fails a case. That is not as harsh as it sounds, because the corpus has p50 10 items sharing
the same std paths, so early failures should be common and fixed once.

### F11. LOW: lane and batch shape

- §6 says "each suite is a separately reviewed harness batch". `harness-m7b` holds a run mode and 7 suites, and `harness-m7a` a normal form,
  3 suites, a ripgrep setup and a tool. **Failing scenario:** one review covers the run mode that defines behaviour parity together with the
  suites that use it. Split: the normal form and run mode first, each with negative tests, then the suites.
- `vendor-object-b` is 3,326 lines, over the ~3k rule, and D3 means nothing executes ELF. If IR-only x86_64 cases need no metadata object,
  it can wait; the plan already wonders. Decide in wave 41.
- Everything else is within size, contract-first is right, and ✱ merge order is stated. Porting and harness work stay separate (D20).
- Thresholds exist before lanes start, which is good. Two are not defined enough: `rg-behaviour`'s "about 50 scripted queries" (write it
  before `rg-build` first succeeds, in a separate commit) and what M7d does with ripgrep's 333 `rgtest!`. Given F1, a set of 50 queries is
  weak evidence; I would gate on the oracle's pass count on those 333 if they can drive a port-built `rg`, which I did not check.

### F12. LOW: ripgrep estimate holds, but the table is for the wrong profile

I tried to break the 7-9 min estimate through the fact that `cargo check` skips `optimized_mir` and MIR encoding. It did not break:

| Crate, port user CPU / RSS, oracle-built deps, `fixers-39` | `--emit=metadata` | Level 1, all bodies | Level 2, all bodies | Level 2 + encode all MIR | rmeta |
|---|---|---|---|---|---|
| `memchr` | 9.16 s / 1.3 GB | 10.04 s | 11.36 s | 11.10 s | identical |
| `regex_syntax` | 24.62 s / 4.0 GB | | 30.33 s / 5.4 GB (printing 11 MB) | 29.61 s / 3.6 GB | identical |
| `rg` (bin) | (plan: 15.7 s) | 22.29 s / 1.5 GB | 30.28 s / 1.7 GB | | |

So release costs about 20% more on libraries and about 2× on `rg`. The plan's table is **debug**, while M7d is **release with `debug = 1`**.
Redone for that profile:

| Phase, CPU | Estimate |
|---|---|
| Front end through level 2 | about 420 s |
| Collection (25,865 items) | about 26 s |
| TS codegen and printing | 17-100 s (the plan's range; the port's front-end ratio on `regex_syntax` is 50×, so it is defensible, and I cannot narrow it) |
| `opt` + `llc` | 36 s + text parsing |
| Spawns | about 30 s |
| **Total** | **about 9-11 min CPU**. Same order |

**Amendment:** replace §4's table, and note that `-j4` can see several 4-5 GB processes plus codegen's models on 24 GB, so `rg-build` needs
the heavy class.

**The std story holds for M7.** The release build's own logs agree: `memchr` 103 items, `serde_core` 180, `regex_syntax` 2,019,
`regex_automata` 4,693, `rg` 6,800, of 25,865. Generics are paid for downstream, and those numbers already include them. I did not re-run
core's 1,316. **One overclaim:** "its cost was already paid in M5" and "a port-built sysroot is minutes" rest on `--emit=metadata` times,
which run no `optimized_mir` on non-const functions. `std-self` needs level 2 over core's 47,734 bodies, and the last gate's `rmeta-core`
peaks at 11,959 MB of 12,288 (`docs/state/history.jsonl:610`). Report-only, so not blocking, but say "unmeasured".

### F13. LOW: D14's mechanism cannot work as written

"Load by `import()` at `codegen_crate`": the call is synchronous, inside `tcx.sess.time` (`rustc_interface/passes.ts:1385-1397`), so nothing
can await it. The port already has the working idiom (`require`, `rustc_trait_selection/traits/fulfill.ts:88`). More importantly, the front
end **statically imports** `rustc_codegen_ssa/lib.ts` (7 sites), `base.ts` (3) and `back/link.ts` (3), and PORTING §8 makes crate roots the
import point. Those files are about to grow by thousands of lines.

**Failing scenario.** `link.ts` fills in wave 42, `--emit=metadata` loads it, and startup rises for 530k cases. Unnoticed, because no test
looks. At today's 1.08M TS lines and 0.7-0.8 s startup, 60k lines is about 40 ms, which is about 45 min per gate at 8 jobs (my arithmetic,
not measured).

**Amendment:** `require` at the seam; a boundary for what the front end may import from `rustc_codegen_ssa`; a guard test that `--emit=metadata`
loads no `rustc_codegen_llvm` or `rust_ts/llvm` module and no `back/link`. **Bundle:** keep it out of wave 39's gate, as the plan already
allows. Nothing depends on it, it is unreproduced on the rustc entry, and it changes every suite's subject.

## What must be settled before a lane starts (question 8)

Before wave 39:
- Merge `fixers-39`, and delete `o2-inline` (F7).
- Worktree env: handoff item 3. `RUST_TS_HOST_TUPLE` is unset without `.env.local`, and I hit this too. Briefs or setup must supply it.

Before wave 40:
- **Owner's approval for D4's `scope.json` change** and PLAN.md's edits (D1, D3).
- F1's tier rule, F5's budget, F6's manifest and markers, F3's exclusions list format, F2's re-order.
- `UPSTREAM.json` sparse additions for `tests/codegen-llvm` and `tests/mir-opt` (F7).

Can wait, and §10's list agrees: bundle, ThinLTO through `rust-lld`, `llc` byte differences, Apple clang's LLVM base, why `default<O3>`
differs. O6's root cause belongs to `real-crates`. `crate-src.ts`'s one online run is a lane detail.

**Waves and cost (question 7).** Gate time adds up as the plan says: its table sums to 127 min, and 3 s CPU per case agrees with
`run-pass-miri`'s measured 3.5 s. These amendments add minutes (`mir-opt-o4`, a sample of `rmeta` at `-O`) and one x86-darwin report of about
20 min. The 7-12 days and 30-40 M tokens are extrapolations I cannot test, and they are honest about that. The fill lanes copy; the
uncertain part is the fixers after the model meets real output, which F6 makes cheaper.

## Amendments, by decision

| # | Change |
|---|---|
| D1 | Correct the hash; the guard hashes both `libLLVM.dylib` copies |
| D2 | Tiers N1, N2, N3; anchor the `preds` strip to block labels |
| D3 | Host directives for native suites; report `run-pass-native-x86darwin` under Rosetta in a separate sysroot; correct §1f and §9 |
| D4 | Owner's approval before wave 40; markers on `rustc_llvm` wrappers |
| D5 | Add the rules in "what the model needs"; LLVM manifest with checked `// llvm:` markers; tracer-backed and C-API differential tests in tests only; `llir-core` about 5k, split behind a contract |
| D8 | State embed-bitcode's behaviour for port-built rlibs; fat LTO is unmeasured |
| D9 | `Off`, `Unpacked` and `Packed` (`dsymutil`) ported; only DWARF packages stay `unported`; `-Cdebuginfo=1` first |
| D12 | Three oracle runs at accept; a recorded FLAKY rerun for protected native DIFFs; `exec-env` from the directive; define what an oracle compile failure counts as; note the shim is outside `ir-*` |
| D13 | `o2-inline` deleted, O1 removed; add `check-rg` in `-Zalways-encode-mir -Copt-level=3` mode, a `rmeta-ui` sample in that mode, `check-rg-host`, `mir-opt-o4` |
| D14 | `require`, a front-end import boundary, a guard test; bundle stays out of wave 39's gate |
| D17 | First differing C API call alongside first differing function |
| D18 | Same split-debuginfo wording as D9 |
| D20 | Split `harness-m7a` and `harness-m7b`: normal form and run mode reviewed before their suites |
| §4 | Release-profile table; `rg-build` in the heavy class; "unmeasured" for `std-self` |
| §6 | M7c's exclusions by name before the first port run, debuginfo back at M7d; ≤ 5 s unit-test wall per lane; `rg-behaviour` written before `rg-build` first passes |
| §8 | `ssa-write`, `cg-write`, and the print and guid part of `llir-tools` move to wave 41 |
| §9 | F1's rule replaces the report-only fallback; behaviour is never the only gate on codegen |

## What I did not check

- **No port IR exists here either.** F1's tiers and the tracer run on oracle IR. My statements about the model's size are from a sample of 239
  small programs and from reading source; a larger program could reach more of `ConstantFold.cpp`. I traced no ripgrep crate, and no
  `LLVMRust*` call is visible to the tracer. I measured C API counts, not wrappers.
- **TS codegen cost:** still an estimate. I narrowed the front-end part, not this.
- **F1's numbers are for these mutations on 114 programs.** Real port bugs are often louder, and many would crash. What it shows is what
  behaviour cannot be relied on to see. Mutations hit only each program's own module, as a port bug would.
- **`fixers-39` is unmerged and its review is still running.** My F7 results are on that worktree. I checked the outcome, not the fix's code.
- **Full `mir-o2`, `mono-ui` or `check-rg`:** samples only. `mono-ui` not run. O3-O6 not reproduced: `serde_core`'s rmeta (O6) needs a build-script
  environment I did not set up, and I confirmed only that O5's `unported` is at `rustc_interface/util.ts:394`.
- **Rosetta:** oracle only. No port output; `x86_64-apple-darwin` differs from x86_64-linux in object format and libc.
- **Bundle, ThinLTO through `rust-lld`, fat LTO, `rgtest!` driving a port-built `rg`, Docker, a Linux VM:** not tried. Fat LTO's 22 cases have no
  evidence from anyone.
- **`tests/mir-opt`'s flags are approximate.** I used level 4, `-Zvalidate-mir` and each test's flags, not compiletest's exact mir-opt setup, and I
  compared `-Zunpretty=mir`, not its `.diff` files. 8 of the 80 sampled were skipped for directives.
- **Tokens and days:** not tested. The 3 s per case is checked only against `run-pass-miri`'s rate.
- **Side effects:** `DYLD_INSERT_LIBRARIES` on oracle processes only, changing no file. I ran the oracle's cargo with the plan's `CARGO_HOME` under
  `tmp/plan-m7/rg/cargo`, offline, with the target directory in my scratchpad (deleted). 15 LLVM files and one `rust-std` tarball were downloaded to my
  scratchpad. At most 3 workers. Scripts are in `$RUST_TS_DATA/tmp/review-plan-m7/`.

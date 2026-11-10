# Handoff: perf-subject-bin (wave 40h; harness batch, needs an independent review)

Branch `t3/optimize-subject-binary` (worktree `t3-7f5f0ad9`). Files: `scripts/lib/subject-bin.ts`, `scripts/subject-bin.cases.ts`, `scripts/subject-bin-bench.ts` (new),
`scripts/subject-bin-order.ts`, this file. No `src/`, `harness/`, baseline, suite, oracle output or runner change. No `unported(...)`.

**Bottom line.** The binary is slower on long cases because of **the shape of Bun's bundle**, not because of the compile step.
A plain `Bun.build` bundle run with `bun` costs the same as the compiled binary; bytecode, the bytecode optimizer and the
sourcemap each change nothing measurable. No build option removes the cost, so the build options stay as they are. The one
mechanism I could isolate and reproduce: Bun wraps nearly every module (1,962 of ~2,100 for `main.ts`) in a lazy `__esm`
initializer, because the port has 426 lazy `require()` sites and `main.ts` loads the driver with a dynamic `import()`. JSC
then creates the classes inside a function, and constructs them more slowly than classes created by module code. Hoisting
the four hottest interned classes out of their initializers cut 3% of the instructions. The rest of the gap (about 15 points)
is spread evenly over the whole compiler (every mid-level function 1.10-1.20x in inclusive time). I could not tie it to one
cause, and a bundle without the wrappers cannot be built without changing module evaluation order. The change this lane
makes: the builder deletes the unused 60-64 MB `rts.map` (w40g-audit N3), plus comments, tests and a timing tool. The
remaining cost and the trade-offs are in section 6.

## 1. Method

- The three cases of w40g-audit N1/N2: `dynamic-drop.rs`, `issue-8827.rs` (run-pass-miri) and `recursive-drop-elaboration.rs`
  (mir), with the harness's exact argv (`s.subject([c])`), cwd (`cwdOf(s)`, the upstream checkout) and environment
  (`{...caseEnv(c.env), RUST_TS_IMPL: "port"}`), through the harness's `run()`, alone. Only the subject prefix is swapped
  (`bun [--preload …] <repo>/<entry>` for a build), as `subjectCmd` does.
- Each run under `/usr/bin/time -l`: besides wall, user and max RSS, **instructions retired**. That count moved by less than
  1% between runs while another lane's unit tests pushed the 1-minute load to 19, where wall time moved by up to 40%. All
  tables below are from a quiet machine (load next to each) unless marked.
- AC power throughout (`pmset -g batt` before and after each phase); no `GATE_RUNNING`; `RUSTC_ICE=0`; scratch builds in my
  scratchpad, at most ~1.1 GB at a time, all deleted.
- `scripts/subject-bin-bench.ts` (new, section 5) is this method as a tool.

The variants (all with the lane's plugin, define and banner, from this tree):

| label | what |
|---|---|
| source | `bun <entry>`, as the harness's source mode |
| cur | the current build: `compile`, `bytecode: true`, `optimize: { bytecode: false }`, inline sourcemap |
| nobc | `compile` without bytecode |
| opt | `compile` + bytecode with the optimizer **on** |
| nomap | `compile` + bytecode, no sourcemap |
| bundle | plain `Bun.build` (no compile, no bytecode, no sourcemap), the `.js` run with `bun` |

## 2. Measurements per hypothesis

### Baseline (reproduces N1)

`recursive-drop-elaboration.rs`, 3 rounds interleaved, load 1.5-3.8 (medians; G instr = instructions retired):

| variant | wall s | user s | max RSS MB | G instr |
|---|---|---|---|---|
| source | 25.42, 25.86, 26.03 → **25.86** | 28.48 | 3,093 | 510.1, 512.1, 514.9 → **512.1** |
| cur | 28.27, 28.83, 30.94 → **28.83** (+11.5%) | 32.71 (+14.9%) | 3,765 | 607.7, 608.1, 608.7 → **608.1** (+18.7%) |
| nobc | 28.27, 28.43, 31.81 → 28.43 | 32.55 | 3,931 | 603.7, 603.7, 604.7 → 603.7 |
| opt | 28.80, 29.08, 31.28 → 29.08 | 32.90 | 3,711 | 613.0, 613.5, 617.4 → 613.5 |
| nomap | 28.23, 28.23, 29.51 → 28.23 | 32.33 | 3,774 | 604.2, 606.8, 610.4 → 606.8 |
| bundle | 28.80, 28.97, 29.93 → 28.97 | 33.36 | 3,886 | 615.7, 617.8, 618.0 → 617.8 |

`dynamic-drop.rs` (Miri), 3 rounds interleaved, load 1.3-2.2:

| variant | wall s | user s | max RSS MB | G instr |
|---|---|---|---|---|
| source | 34.08, 35.41, 35.80 → **35.41** | 42.38 | 2,138 | 467.5, 469.0, 470.6 → **469.0** |
| cur | 38.18, 39.09, 40.64 → **39.09** (+10.4%) | 47.80 (+12.8%) | 2,131 | 528.4, 530.0, 530.8 → **530.0** (+13.0%) |
| opt | 39.50, 39.91, 40.66 → 39.91 | 48.64 | 2,147 | 542.2, 544.1, 547.0 → 544.1 |
| bundle | 37.99, 38.64, 38.81 → 38.64 | 47.79 | 2,117 | 542.1, 543.6, 544.3 → 543.6 |

The same audit numbers again: the binary costs 11% wall and 13-15% user. The output hash (exit, stdout, stderr with a panic's
thread id masked) was the same in every run of every variant. `issue-8827.rs` was in the first, noisier rounds only (source
36.4-37.2 s, cur 40.2-40.5 s, +10%); I did not repeat it, as the two Miri cases behave alike (audit).

### H1: bytecode caching

**Not the cause.** `nobc` (compiled, no bytecode) costs the same as `cur` (603.7 against 608.1 G), and the plain bundle run by
`bun` from JS text, with no compile and no bytecode, costs as much or more (617.8 G; Miri 543.6 G against cur's 530.0 G).
JIT compile logs (`BUN_JSC_reportCompileTimes`) of the bundle against source show fewer DFG compiles (1,772 against 2,282;
1,452 distinct functions against 1,930), slightly fewer FTL compiles (626 against 670), and fewer inlined calls (FTL 5,423
against 5,820, DFG 3,516 against 4,301; `BUN_JSC_printEachDFGFTLInlineCall`). That holds for the plain bundle too, so it is a
property of the bundled code, not of cached bytecode. JIT code size is the same (10.5 against 11.2 MB), so executable-memory
pressure does not explain it.

### H2: the bytecode optimizer

**No run-time gain; keep it off.** On, it costs 0.9% more instructions on the TAIT case (613.5 against 608.1 G) and 2.7% on
Miri (544.1 against 530.0 G), with wall times 0.3-0.8 s higher. Its known cost is depth (−4.4%, subject-bin handoff 4.3). The
comment on `optimizeBytecode` and the `VALIDATED_BUN` rationale now say so.

### H3: bundle shape

**The cause.** Each piece I could test:

| experiment (TAIT case, plain bundle) | G instr | against the bundle (615.6-618.8) |
|---|---|---|
| lazy `require()` objects: `__toCommonJS` returns the `exports_x` object (one getter level, no bound `__accessProp`, no `this[key]`) | 613.3, 614.1 | −0.5% |
| `minify: { syntax: true }` | 616.5 | 0 |
| JSC global inlining planner off (`BUN_JSC_useGlobalInliningPlanner=0`; same for source) | 617.4 | 0 (source 512.1) |
| lower tier-up thresholds (both modes) | 684.4 | worse (source 572.1, worse too) |
| the 4 hottest interned classes (`Ty`, `Region`, `Const`, `RawList`) moved out of their `__esm` initializers to module level | 595.8, 599.2, 599.4 | **−3%** |
| all 377 classes that can move safely (no base, a builtin base, or a moved or module-level base; no static field, static block or computed key) | 605.2, 605.2 | −2% |

- **Lazy-require accessors.** An instrumented run counted 4.29 M property reads through `__toCommonJS` getters (top:
  `fold_Binder`, `*_PredicateKind`, `fold_Region`, `fold_list`). At tens of ns each that is ~0.1-0.2 s, which the first row
  confirms. The lazy helpers (`ty_util()`, `generic_args()`, ...) are inlined at 10-20 sites each from source and at none in
  the bundle, but that is a small part.
- **`__esm` wrapping and classes.** Micro-benchmarks (`/usr/bin/time -l`, DFG-only via `BUN_JSC_useFTLJIT=0`, and all tiers)
  separate the bundle's ingredients. A module-level `var` assigned later costs nothing against a `class`/`const`. 60,000 extra
  module-scope bindings cost ~1%. Methods defined inside a closure cost nothing. But **constructing a class that was created
  inside a function** (any function: the `__esm` arrow, a `function`, a plain IIFE; a base or a derived class) costs **+12% at
  DFG and +4% at FTL** per construction. `forcePolyProto` does not reproduce it, so it is not poly-proto. In the real bundle,
  moving 4 hot classes out gives 3%, but moving 377 gives 2%, so this is a real but small part.
- **The rest is diffuse.** Inclusive time per function, bundle against source (CPU profiles, quiet): `enter_single_candidate`
  1.16, `fold_with` 1.16, `fold_list` 1.16, `canonicalize_goal` 1.10, `instantiate_and_apply_query_response` 1.15,
  `fold_with_OpaqueTypeKey` 1.21, `relate` 1.13, `unify_var_var` 1.15, and so on down the tree, with the whole run at 1.155. No
  function or subsystem stands out. The bundler emits the same code text for the functions (checked against `bun build
  --no-bundle` for two hot classes, `ProvisionalHiddenType` and `HasTypeFlagsVisitor`), so the difference is how JSC treats the same functions inside one big module of
  lazily initialised scopes, against 2,100 modules.
- **Why it cannot be removed from the build.** Bun wraps a module when it is reached by `require()` or a dynamic `import()`.
  The main bundle has 1,962 wrapped modules (1,942 even with the driver import made static), Miri's 1,473. I tried three
  unwrapped builds; none runs, because each changes module evaluation order, which the port depends on (it is the reason
  for the lazy `require()`s): turning every `require("x")` into a hoisted `import * as` (`IR_PRINT` is used before it is
  initialised); code splitting with every module an entry (prototype-extension methods missing); `format: "cjs"` (refused:
  top-level `await` in `main.ts`). Moving class definitions in the bundled text is possible for the safe subset, but the
  gain measured above (2-3%) does not justify a second build pass, sourcemap composition and its review.

### H4: sourcemap, `NODE_ENV` and `process.argv`

- **Sourcemap: no run-time cost** (`nomap` 606.8 G against `cur` 608.1 G), and **it is required**: a build without one cannot
  resolve frames, so `-Ztrack-diagnostics` stops with `unported` (exit 70), where source and `cur` print `created at
  …/rustc_trait_selection/src/error_reporting/infer/mod.rs:2242:35`.
- **`rts.map` (N3).** `Bun.build` writes the map next to the binary although it is embedded in it. With `rts.map` moved away,
  the binary prints the same `-Ztrack-diagnostics` output byte for byte (sha1 `d238a7fbab41` in all three: source, binary with
  the file, binary without it). Nothing else in the harness reads it. **Fixed**: the builder deletes it (section 4).
- **`NODE_ENV` and argv.** The banner runs once. The only `NODE_ENV` read in the bundle is `src/rustc_middle/ty/list.ts:55`,
  once at module initialisation (`FREEZE_LISTS`). Nothing hot goes through either.

### H5: memory

The extra RSS is **GC pacing, not retained bytecode or source text**. `BUN_JSC_logGC=1` on the TAIT case:

| | GCs (eden/full) | total GC cycle time | largest heap before a GC | largest heap after a GC |
|---|---|---|---|---|
| source | 134 (130/4) | 687 ms | 2,680 MB | 1,690 MB |
| plain bundle | 130 (127/4) | 727 ms | 3,420 MB | 1,463 MB |
| binary (cur) | 129 (127/3) | 694 ms | 3,415 MB | 1,445 MB |

The live heap after a collection is *smaller* in the bundle. It grows further before the next collection (larger eden budgets),
which is what max RSS sees. The plain bundle run by `bun` shows it too (3,726-3,901 MB), so it is not a different heap
configuration of compiled executables, and not the 24 MB of source text or the bytecode. GC time is the same, so this costs
memory, not speed. Miri's two cases do not change (2.1 GB either way). I did not find why the eden budget grows larger.

### Startup (must not regress)

Unchanged; 7 runs each, wall s:

| | source | binary (new build `3cd72627`) |
|---|---|---|
| `main.ts --version` | 0.51-0.57 | 0.05 (0.11 first run) |
| an E0308 compile (`fn main() { let x: u32 = "a"; }`) | 0.66-0.70 | 0.14-0.16 |

## 3. The cause, in one paragraph

Gates run a bundle of ~2,100 modules where `bun <entry>` runs them as separate ESM modules. Because the port uses lazy
`require()` (426 sites) and a dynamic `import()` of the driver, Bun's bundler turns almost every module into a lazily
initialised scope (`var x; var init_x = __esm(() => { x = …; class … })`). The same functions then run with about 18% more
instructions on the next-solver TAIT case and 13% more on the Miri cases: JSC compiles fewer functions at DFG, inlines fewer
calls, and constructs classes created inside the initializers more slowly (measured: 3% of the 18%). Bytecode caching, the
bytecode optimizer, the sourcemap and the banner patches are not involved.

## 4. The change

`60d583e6` (and the order-tool guard in this commit):

- `scripts/lib/subject-bin.ts`: `buildFiles(dir)` runs right after `Bun.build` writes the binary. It deletes `rts.map`
  (`STRAY_MAP`) and throws if anything but `rts` is left, so a Bun that writes something new cannot slip into the cache
  unrecorded. A build is now `rts` + `meta.json`: 182 MB for `main.ts`, 187 MB for `miri.ts` (was +63/+67 MB). Comments: the
  per-build size (`PRUNE_AFTER_MS`), the optimizer's run-time effect (`optimizeBytecode`), the cause of the run-time cost (file
  header), and the checks a new Bun needs (`VALIDATED_BUN`).
- The builder's source is part of the key (`BUILDER_SOURCE`), so the next gate builds new binaries, from the same options. The
  binary file is what it was; only the map file beside it is gone.
- Build options: **unchanged** (no variant was faster; section 2).
- `scripts/subject-bin.cases.ts`: three tests. (a) A fixture build's directory is exactly `meta.json` + `rts`, and a frame
  from an imported module prints the source's file, line and column without `rts.map` (from source
  `<repo>/src/lib/frame_lib.ts:2:N`, from the build `src/lib/frame_lib.ts:2:N`). (b) `buildFiles` deletes the map, keeps a
  lone `rts`, refuses an extra file and an empty directory. (c) The bench tool's helpers. Mutation: with the `buildFiles(tmp)`
  call removed, test (a) fails (21 pass, 1 fail). The cases file: 22 pass (was 19); `bun test scripts/subject-bin.test.ts`: pass.
- `scripts/subject-bin-order.ts`: Bun drops a `--` that comes first after the script, so `bun scripts/subject-bin-order.ts --
  --version` ran the entry with **no** arguments on both sides (rustc's help, "same output"). It now refuses that form with
  an `ERROR:` line and says to pass an option first (`--entry … -- <args>`).
- `scripts/subject-bin-bench.ts` (new): see section 5.

## 5. Evidence for the final configuration

New builds through the builder: `main.ts` `3cd726276e09b4c7ef6f1ae54f648795f0c4dd84` (2,097 inputs), `miri.ts`
`0296680978032342f32537de1882ed20585ade6a` (2,285 inputs); each directory holds only `rts` and `meta.json`; both passed the
builder's `--version` check.

**Raw comparison**, `RUST_TS_AGENT=perf-subject-bin`, `difftest --sample 200 --raw-subject` in each mode, then
`scripts/subject-bin-compare.ts`:

| suite | source | binary | compare | subject s (source → binary) |
|---|---|---|---|---|
| `mir` | 200 MATCH | 200 MATCH | 200/200 same, 0 differ | 334.0 → 143.5 |
| `run-pass-miri` | 200 MATCH | 200 MATCH | 200/200 same, 0 differ | 742.0 → 510.8 |
| `pm-ui` | 199 MATCH, 1 UNPORTED | the same | 199 same + 1 pid-masked, 0 differ | 302.3 → 103.8 |
| `mono-ui` | 200 MATCH | 200 MATCH | 200/200 same, 0 differ (subject runs from source in both modes) | 457.8 → 453.9 |
| `rmeta-ui` | 200 MATCH | 200 MATCH | 200/200 same, 0 differ | 295.6 → 83.1 |

**1,000 processes, 0 differences.** Raw records and logs: `…/scratchpad/evidence/` (`raw/{source,binary}/<suite>/`,
`cmp-<suite>.txt`, `difftest-<mode>-<suite>.log`). The upstream checkout was clean after every phase (`git status --short`:
0 lines), with no `rustc-ice-*` file.

**Stack depth**, deepest `fn main() { let _x = ((…1…)); }` that compiles at `-Zunpretty=normal`, bisected to ±6, quiet
machine (load 2.6-2.9):

| build | 5 (or 3) bisections | |
|---|---|---|
| source | 10,182, 10,187, 10,176, 10,182, 10,176 | — |
| new build (`3cd72627`) | 10,084, 10,078, 10,095, 10,084, 10,089 | −1.0% |
| the gate's build (`2e56dd07`) | 10,095, 10,089, 10,089 | −0.9% |

The same gap as the subject-bin handoff (source ~10,150-10,170, binary ~10,060-10,080), and the new build holds the gate
build's depth. Under load (another lane's tests, load 8-16) the binaries' results spread from 10,079 to 10,200: JIT timing
changes frame sizes, so depth must be measured on a quiet machine.

**Module evaluation order** (`scripts/subject-bin-order.ts`, with arguments actually passed, see section 4):

| run | result |
|---|---|
| `main.ts --version` | same order (2,080 modules), same output (exit 0, 45 bytes) |
| `main.ts` E0308 with `-Ztrack-diagnostics` | same order (2,080), same output (exit 1, 625 bytes of stderr) |
| `main.ts`, the mir suite's args on `recursive-drop-elaboration.rs` | same order (2,081), same output (exit 1, 995 bytes) |
| `miri.ts` on `dynamic-drop.rs`, the harness's args, cwd and environment | same order (2,266), same output (exit 0, 40,149 bytes) |

**Oracle keys** (`scripts/oracle-keys.ts`): at this branch and in a `git archive` tree of `bbde79e5` (before the lane),
**372,181 keys, 0 suites not listed, sha1 `5d0766429cc8b685d9c12369a5ae59dd2a5049db` at both**, `cmp` identical: the sha1 the
subject-bin review and w40g-audit recorded.

**Timing tool** (`scripts/subject-bin-bench.ts --suite mir --file recursive-drop-elaboration.rs --reps 1`): source 25.42 s,
28.44 s user, 515.1 G instructions; binary 28.13 s, 32.41 s user, 610.0 G; same output. It runs each mode's command as the
harness would (binary mode builds or finds this tree's build; `--bin <path>` uses a given build, e.g. a gate's, without
building), interleaves rounds, prints medians, and prints `ERROR:` if the outputs differ.

## 6. Remaining cost and trade-offs

The binary still costs about 11% wall and 13-15% user on long cases, ~20% more max RSS on the TAIT cases, and ~1% depth.
It still saves 0.4-0.5 s per process, which is why the suites take 6.0 h instead of 10.4 h. Options, best first:

1. **Run the solo retry from source** (recommended). The near-limit cases are exactly the ones the gate retries alone after a
   pool timeout, and for them startup does not matter while the 11% does: `dynamic-drop.rs` would go from ~39 s back to
   ~35 s, the TAIT cases from ~28.5 s to ~25.5 s, and the retry's RSS from 3.9 back to 3.2 GB. Outputs are byte-identical
   between the modes (section 5 and the subject-bin evidence), and the retry would record its mode. It mixes modes inside a
   gate (subject-bin review N4), but only for retries, and source mode is the deeper of the two. That is a change to
   `scripts/difftest.ts` (`RUST_TS_SUBJECT=source` for the retry's subject command, and the mode in the retry record), so it is
   outside this lane: root's decision, then a harness batch with review.
2. **Accept the cost** and keep the 2026-11-09 rule (revisit when a case nears 45 s alone). Today: 39-40 s for the two Miri
   cases, and no further growth from this lane.
3. **Make the port bundle without wrappers**: replace the 426 lazy `require()`s and `main.ts`'s dynamic driver import with
   static imports, keeping today's evaluation order. That is a port-wide `src/` change, and its gain is **unproven**: the only
   piece I could isolate is worth 2-3%, and an unwrapped build could not be produced to measure the rest. Not recommended
   without a smaller experiment first (e.g. one crate's cycle broken without `require`, then re-measured).
4. Moving the two Miri cases to `run-pass-miri-heavy`: root declined this on 2026-11-09 (it changes a suite and two
   baselines); nothing here changes that.

Memory: if 12 TAIT-sized jobs at once ever matter, option 1 removes the difference for retries. In the pool, the larger eden
budget is JSC's choice; no build option changed it.

## 7. Side effects outside the scratchpad

- `.env.local` copied into this worktree with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0` (gitignored).
  `bun install --frozen-lockfile` in this worktree (`node_modules`, gitignored; `bunx tsc` needs it).
- Ten run directories, 544 KB: `$RUST_TS_DATA/runs/20261110-1049…-perf-subject-bin-*` to `…-1054…` (the section 5 difftests).
- Two builds keyed to this worktree (`$RUST_TS_DATA/subject-bin/3cd72627…`, `02966809…`): **deleted** after the evidence. The
  gate's builds (`2e56dd07…`, `511e00b7…`) were not touched by the builder; I ran their `rts` directly for depth only.
- The difftests and key dumps touched mtimes of cached aux entries and refreshed the upstream checkout's index, as the w40g
  audit describes; no oracle cache entry was needed (all samples cached).
- One empty file `/tmp/x.py` created by a slip in a shell command; deleted at once.

## 8. Decisions (`// PORT:`-like)

- Build options unchanged: no variant was faster at run time, and the optimizer costs depth.
- `rts.map` deleted rather than recorded: nothing reads it (frames resolve from the embedded map, tested).
- The order tool refuses a leading `--` instead of guessing which arguments were meant for the subject.
- No `src/` change proposed in this batch; option 3 of section 6 is a proposal only.

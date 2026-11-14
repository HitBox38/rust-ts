# Review: harness batch `mono-run-head` (wave 40q)

Reviewer: independent, read-only (AGENTS.md §1). Date: 2026-11-14. Host: aarch64-apple-darwin, on AC power, `--jobs 6`.

**Subject:** `24030842` (scripts/mono-run.ts) on `t3/register-llvm-backend`, with its dependency `42faaf21`
(exports `mono_collection_head` from src/rust_ts/codegen_backend.ts). Compared against main `bcbd0c28`, which is
`24030842`'s grandparent: the range adds only these two commits.

## Verdict: APPROVE WITH NITS

The new `MonoOnly.codegen_crate` runs the same lines as the old stop-and-catch path, in the same order, and any other stop
still comes out the same. `mono-run` reaches no other method that the rest of the branch forwards. Every evidence run gives 0
changed cases. All findings below are non-blocking.

## 1. Exact behaviour

I diffed the old stand-in `codegen_crate` body (`bcbd0c28` src/rust_ts/codegen_backend.ts) line by line against
`mono_collection_head` (`42faaf21`). The statements are identical, in the same order:

1. The offload check: `offload.some(Device) || offload.some(Host)` → `return unported("…codegen_crate (-Zoffload; plan-m7 D18)")`.
2. `CpuRequired` when `need_explicit_cpu` is set and `cg.target_cpu` is `undefined`.
3. `CpuUnsupported` when `target_cpu` is in `unsupported_cpus`.
4. `tcx.collect_and_partition_mono_items(null)`.

The `return unported(...)` in a `void` function is fine: `unported` is `never` and only throws (src/std/panic.ts:56). It has
no other side effect, so the old path lost nothing it would have kept by catching the `AFTER_COLLECTION` throw.

- **Offload.** The check is now inside the helper, before the CPU checks, where it was before. A `-Zoffload` run throws the
  same `Unported`, which never matched the old `AFTER_COLLECTION` prefix, so it propagated then and propagates now. By hand,
  `mono-run.ts … -Zunstable-options -Zoffload=Device` on a hello world gives exit 70 and
  `rust-ts: unported: rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (-Zoffload; plan-m7 D18)` on main, on `24030842`
  and on the branch tip `b2c47ad0`. Without `-Zunstable-options`, all three give the same option error, exit 1.
- **Other `Unported` stops.** The old catch let through every `Unported` without the prefix, and every non-`Unported`
  (`FatalErrorMarker` from the CPU diagnostics, `Panic`). The new code has no catch, so the same things leave
  `codegen_crate` and reach the same top-level handler in mono-run.ts, which this commit does not change. The only thing
  the old catch swallowed was the stand-in's own after-collection stop, and `MonoOnly` no longer calls that.
- **`AFTER_COLLECTION`.** It was used only in mono-run.ts: no other user in `src/`, `scripts/`, `harness/` or `tools/`.
  Removing it is right, since nothing catches that stop now. The stand-in's message text stays in codegen_backend.ts at
  `24030842`, where its tests still pin it (src/rustc_monomorphize/wire.test.ts:49 and
  compare_impl_item.oracle.test.ts:49, both through `main.ts`). The branch tip updates them when the stop moves into the
  port, which is outside this batch. `Unported` is still imported and used by mono-run.ts's top-level handler.
- The head matches the ported `base.rs:716 codegen_crate` (src/rustc_codegen_ssa/base.ts:804) except
  `CodegenUnitNameBuilder::new(tcx)`, a constructor with no side effects (rustc_middle/mono.ts:792). The old stand-in skipped
  it too, so nothing changes.

## 2. What else `mono-ui` reads

These are the `CodegenBackend` methods that `Linker::link` (src/rustc_interface/queries.ts:55) can call on `MonoOnly`, and
what the branch does to them:

| Method | Reached from mono-run? |
|---|---|
| `join_codegen` | No. `ongoing_codegen instanceof CompiledModules` takes the check-only branch, and `MonoOnly` always returns one (queries.ts:61). |
| `link` | Overridden as a no-op in `MonoOnly`, unchanged. |
| `print_pass_timings` | Only with `-Ztime-llvm-passes` (and one CGU). The stand-in's `init` stops that first (codegen_backend.ts:94 at `24030842`, :98 at the tip: `configure_llvm (-Z time-llvm-passes)`), on main, `24030842` and the tip. |
| `print_statistics`, `print_statistics_json` | Only with `-Zprint-codegen-stats` / `-Zprint-codegen-stats-json=…`. `init` stops both first (codegen_backend.ts:96 at `24030842`, :100 at the tip), on all three trees. |
| `init`, `target_config`, `target_cpu`, `metadata_loader`, `supported_crate_types` | Inherited, and unchanged by the whole branch: its codegen_backend.ts diff touches only the five forwarded methods and comments. |

No `mono-ui` case passes any of those flags (see §3). At the branch tip, `mono-run` never calls `ported_backend`, so
rustc_codegen_llvm and the IR model are not loaded. A plain hello-world run at the tip gives exit 0 with the same 9
`MONO_ITEM` lines as main. So nothing `mono-ui` compares has changed. N2 records how fragile that is.

## 3. Evidence

All runs use the same `.env.local` (`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`), main from a detached worktree at
`bcbd0c28`, and subject `24030842`. Run dirs are under `$RUST_TS_DATA/runs/mrh-*`. "Changed" means a different status or
different diff contents for the same case id.

| Run | main `bcbd0c28` | `24030842` | Changed |
|---|---|---|---|
| `--sample 400`, `RUST_TS_AGENT=review-mrh-a` | 400 MATCH | 400 MATCH | 0 / 400 |
| `--sample 400`, `RUST_TS_AGENT=review-mrh-b` | 399 MATCH, 1 DIFF | 399 MATCH, 1 DIFF | 0 / 400 |

The two samples share 47 cases, so together they cover 753 distinct cases. The one DIFF,
`tests/ui/explicit-tail-calls/callee_is_track_caller_polymorphic.rs`, is not protected. Its diff files are identical on
both sides (`first difference at line 14`: the oracle's `warning: tail calling a function marked with #[track_caller]…`, a
lint that codegen emits after partitioning, which `mono-ui` deliberately leaves out).

**Flag-specific cases.** I listed the whole case list (3479 cases, 3475 protected) by argv, including `-Z x` / `-C x` pairs:

- `-Zoffload`, `-Ctarget-cpu`, `-Zprint-codegen-stats*`, `-Ztime-llvm-passes`, `-Zno-link`: **no cases**.
- Target: every case has `--target=x86_64-unknown-linux-gnu`, compiletest's target, which is not the host's default. No case
  names any other target, so the "non-default target" set is the whole suite. I did not run the full suite: the agent brief
  keeps full suites to root, and the two samples already exercise that target on 800 runs.
- As the closest available stand-in for the CPU-check paths, I ran in full every case that passes `-Ctarget-feature`
  (`-C target-feature=` or joined) or `-Cllvm-args`, with all of `sanitizer/`: 33 cases (24 `sanitizer/`, plus
  `abi/homogenous-floats-target-feature-mixup`, `cfg/crt-static-off-works`, `linking/export-executable-symbols`,
  `process/nofile-limit`, `simd/target-feature-mixup`, `target-feature/target-feature-detection`,
  `alloc-error/alloc-error-backtrace`, `codegen/issue-82833-slice-miscompile`, `runtime/backtrace-debuginfo`). All 33 MATCH on
  both sides, 0 changed.
- By hand on a hello world, on main, `24030842` and the tip: `-Ctarget-cpu=x86-64-v3` and `-Ctarget-cpu=bogus` both give
  exit 70 at `configure_llvm (-C target-cpu)`, before `codegen_crate`, the same on all three. The offload results are in §1.

**Tests.** There is no test file for mono-run.ts. `harness/m7-suites.test.ts`, the only test that names it, checks its path:
6 pass. `bun test ./scripts/lib/unit-steps.test.ts`: 10 pass. `bunx tsc --noEmit -p .`: clean.

## 4. Scope

`24030842` touches only `scripts/mono-run.ts` (8 insertions, 12 deletions), with no test. Its dependency `42faaf21` touches
only `src/rust_ts/codegen_backend.ts`: a pure extraction, with the stand-in's `codegen_crate` calling the helper and then
stopping as before.

## Findings

1. **N1 (test gap).** No test pins `mono-run.ts`'s behaviour. The cg-register handoff says so too. Only the gate's
   `mono-ui` run would catch a break, for example `MonoOnly` starting to load the port, or `mono_collection_head` losing a
   statement. Suggestion, for a later harness batch: one test that runs mono-run.ts on a tiny program and checks exit 0, the
   `MONO_ITEM` lines, and that `require.cache` holds no `rustc_codegen_llvm` module, as wire.test.ts's "no codegen" test
   does for `main.ts`.
2. **N2 (latent reach).** `MonoOnly` inherits `print_pass_timings`, `print_statistics` and `print_statistics_json`, which
   now forward to the ported backend at the branch tip. `mono-run` can't reach them today only because the stand-in's
   `init` stops `-Ztime-llvm-passes` and `-Zprint-codegen-stats(-json)` first (codegen_backend.ts:94-96 at `24030842`, :98-100 at the tip), and no
   `mono-ui` case passes them. If that guard is ever relaxed, `mono-run` would print the model's LLVM statistics for a
   compile that ran no codegen, and score a DIFF, where it now scores UNPORTED. Suggestion: `MonoOnly` overrides those three
   with an `unported(...)`, or a comment in mono-run.ts names the dependency.
3. **N3 (drift).** `mono_collection_head` is now a second copy of `llvm_backend.rs:336`'s offload check plus
   `base.rs:723-739`. The ported copies (back/llvm_backend.ts, rustc_codegen_ssa/base.ts:804) have markers; this one has
   none. A later fix to the ported head won't reach `mono-ui`, which then measures the copy, not the code that `main.ts`
   runs. This is accepted under the recorded decision (2026-11-14, cg-register). A one-line cross-reference in base.ts's
   `codegen_crate` would make drift visible.
4. **N4 (comment order).** At `24030842` itself, mono-run.ts's new header says `main.ts` "runs codegen (the stand-in
   forwards it…)". That only becomes true at `b52d34f6`, two commits later on the same branch. It is harmless if the branch
   merges as a whole, but the comment is wrong if `24030842` is ever taken alone.

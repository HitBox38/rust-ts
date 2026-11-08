**Verdict: APPROVE WITH NITS.** Root's commits on `integ-w43` and its four merges hold up. No merge drops or changes a lane's work, the baselines are untouched, and no protected suite's oracle key or case list moves. The `--isolate` change is a real behaviour change, and its two test updates follow from it. The step still fails on every failure I planted. Nothing blocks the merge. N1 (PORTING.md still says interned lists are frozen) is worth fixing before `main`.

# Independent check of root's commits and merges on `integ-w43` (lane `root-w43-check`)

Head checked: `integ-w43` at `e0fe9068`, against `main` at `5c884ab9`. Line numbers are at `e0fe9068`. The host was the root Mac, on AC, at load 2 to 5. `.env.local` came from `integ-w39`, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. Code mutations were made in this worktree, run, and undone with `git checkout <file>`; `git status` was clean after each. A detached worktree of `main`, used for the key dump, has been removed. This file is my only change to the tree.

## Findings

| # | Severity | Where | Scenario | Evidence |
|---|---|---|---|---|
| N1 | Nit, docs (contract) | `PORTING.md:147-149` | It still says the lists are "**frozen** class instances" and that `RawList` is "a frozen `Array` subclass". On `integ-w43`, `0d4092c4` freezes them only under `bun test`, the alias checker or `RUST_TS_FREEZE_LISTS=1` (`src/rustc_middle/ty/list.ts:30-55`). Root's 2026-11-08T03:41 decision records the change. But PORTING is the contract lanes read first, and AGENTS.md says to stop on a contradiction. A porter who trusts it will assume a stray write to a list throws in the port. In a `--sample` difftest that write now passes silently. Only the gate's 48-case `frozen lists` step or a unit test would catch it. Fix: one sentence in PORTING §5 naming where lists are frozen and pointing to `list.ts`. | read; `main:src/rustc_middle/ty/list.ts` has no `FREEZE_LISTS` |
| N2 | Nit, test | `src/rustc_codegen_ssa/back/rlib_native.oracle.test.ts:61-69, 134-138` (`b0914628`) | The ELF record is only decoded. So any byte of the ELF wrapper outside the record's bytes goes unchecked. I flipped `e_ident[EI_OSABI]` and then the member's last byte in `RLIB_ELF_FOO_BAZ`'s `lib.rmeta-link`. Both still decode to `[[], [None, None]]`, and the test passes. The stand-in session *can* build the ELF wrapper. It only lacks `options.os`/`options.env`, because `sess()` puts `os` and `env` on `target`, while `elf_os_abi` (`metadata.ts:244`) reads `target.options.os`. I added both to `options` in a scratch copy. `create_wrapper_file(ELF, ".rmeta-link", new RmetaLink([], [undefined, undefined]).encode())` then gives 592 bytes, **byte-identical** to the oracle's member. Moving two fields would pin it the same way as the host. As it stands it is enough for the record. The end-to-end ELF runs in the link-rlib-native review covered the wrapper once, but no suite repeats them. | reproduced |
| N3 | Nit, message | `scripts/frozen-lists.ts:59` (`95a9b2d4`) | The TIMEOUT hint says "frozen lists read about 10x slower". That is the per-element microbenchmark (`list.ts:44`). A whole case runs about 22% to 35% longer (46 s became 62 s; the file's own header, `:14-16`, says 22%). Root, reading "10x", may think a case near 6 s of a 60 s limit is at risk, or may raise limits. It also says "exclude it in scripts/frozen-lists.ts", but the script has no exclusion list. Excluding a case means writing new code in `scripts/`, which needs its own reviewed batch. Suggest: "frozen, a heavy case runs about 22-35% longer; change `SEED`, or add an exclusion (a reviewed scripts/ change)". | read |
| N4 | Nit, queue | `docs/next.md:512`, `:516-523` | The "Queued from wave 40b/40c's reviews" bullets still list as open work that `integ-w43` does. Root edited the `:512` bullet in `2409d0b4` (the `rlib_macho.test.ts` rename) but kept "the port compiles and exits 0" (fixers-47: 70/70 the same), "have no unit test" for root-w42-check N4 (harness-w44 §3 adds them) and "host-rlib … needs … `*_DEPLOYMENT_TARGET` in the scrubbed set first" (`a4ef962b`, `2233a7ef`). Also open there: fixers-45 F1/F2/F4/F5 (`:516`), "make `info_sites_check.ts` a gate step" and audit N4 (`:517`), fixers-46 F4's `static` (`:518`), harness-w43 F6/F7 (`:521`), "perf-heavy: re-land 0d4092c4 once a gate step …" (`:522`) and the parallel unit-time item (`:523`). The lane table (`:540-545`) does say they landed. But a planner picking from the queue for wave 41 would re-assign finished work. Prune those bullets when the wave is recorded. Keep root-w42-check N6, `gvn.ts`'s index, the print-type-sizes item, and perf-heavy F2-F4 as notes. | read |

## Root's commits

### `b0914628`: the foo/baz `rmeta-link` records (link-rlib-native N2)

- **Does it check what the review asked?** The review asked for `new RmetaLink([], [undefined, undefined]).encode()` to go through `create_wrapper_file` and be compared with the member. For the host it does exactly that, with the darwin 8-byte `\n` padding the `+whole-archive` test uses. For ELF it decodes and compares the record only (N2).
- **Mutations** (each undone):
  - Decoder tags swapped (`tag === 0` read as `Some`, `1` as `None`): **1 fail**, the new test.
  - Encoder `None` tag written as `2`: **1 fail**, the new test.
  - The review's mutation (a byte of the host member): fails through the byte comparison.
  - An ELF header byte, or the ELF member's last byte: **passes** (N2).
- Clean: 8 pass.

### `95a9b2d4`: the frozen-lists TIMEOUT line (harness-w44 N1)

It touches only the TIMEOUT arm of the ERROR message, so other statuses print as before. The wording is N3.

### `e0fe9068`: `--isolate` on the alone pass (unit-parallel N1)

- **The two test updates are legitimate.** `gate-unit.test.ts:115` and `unit-steps.test.ts:56` assert the exact argv the step builds. The argv changed on purpose, and the only change to each is the inserted `"--isolate"`. Nothing else in them changed: the `.only`, failure, skip, timeout and env assertions are as before. The commit adds no assertion that the flag is *needed*, though. My order plant below is the evidence for that.
- **The four alone files pass isolated.** I ran them as the step does: `RUST_TS_REQUIRE_PROBES=1 CI=true bun test <4 files> --isolate --timeout=60000 --reporter=junit`. Result: **39 pass, 0 fail, 0 skipped**, 88 s, and the junit report names all 4 files. None of the four assigns `process.env`, so `--isolate` cannot carry env from one file to the next (the harness-w43 §8 concern is about scripts/harness).
- **Planted cases**, run through the gate's own `unitStaticSteps` + `runStaticStep` on fixture trees (`parallel: 2`, two alone files each). The commands carry `--isolate`.

  | plant in the alone pass | result |
  |---|---|
  | a failing test | workers ok; `ERROR: unit tests (alone)`, `failed: src/f.test.ts: fails` |
  | `test.only` (`CI=true`) | `ERROR: unit tests (alone)` |
  | the same `.only` without `CI` | passes, so the refusal is what failed it |
  | a file that throws at load | `ERROR: unit tests (alone)`, with no `failed:` line (unit-parallel N3, queued) |
  | the second file needs a global the first sets (stands in for a cycle entered first by an earlier file) | `ERROR: unit tests (alone)`, `failed: src/h2.test.ts: needs global`. Without `--isolate` it would pass (unit-parallel review N1 reproduced the shared `globalThis`). |

### Decision records and `docs/next.md`

- **2026-11-08T03:41 (`c8ca9c27` kept; the 2026-11-06 frozen-lists decision superseded).**
  - True as worded. The three 2026-11-06 records saying "interned lists stay frozen" are the ones superseded. The condition the perf-heavy review set (a gate step with a frozen sample) is met by `scripts/gate.ts:387`.
  - "4 cases; no suite's oracleKey changes": confirmed by my key dump (below).
  - "path and file list": the hash also covers file sizes (`difftest.ts:397-410`). That is accurate enough.
  - What the decision makes false is PORTING.md (N1).
- **2026-11-08T03:55 (fixers-47's `tools/codegen/` inputs).** The lane's diff to `tools/` is exactly `mir.typemap.json`, `serialize.json` and `type_fold.json`. The fixers-47 review regenerated all 63 sets unchanged. The record matches both. I did not regenerate the sets myself.
- **`docs/next.md`.** The lane table's statuses are right: link-rlib-native "root pinned N2", unit-parallel "root added --isolate". The new unit-parallel N2-N5 and fixers-47/link-rlib-native/harness-w44 notes match their reviews. The stale queue is N4.

## Merges

- **Lane content against the merged tree.** For every file each lane changes (from its merge base with `main`), I compared the lane head with the merge commit and with `integ-w43`:
  - `5ccfd699` and `6674133d` (link-rlib-native and its review), `2ff85538` (harness-w44) and `760e57f7` (fixers-47): identical in their merges.
  - `d3c84620` (unit-parallel): its merge differs from the lane only in `scripts/gate.ts`.
  - At head, the only remaining differences are root's own commits above (`rlib_native.oracle.test.ts`, `frozen-lists.ts`, the `--isolate` files) and `gate.ts` from the other lane.
- **`scripts/gate.ts`.**
  - At `6327a2db`, the added and removed lines of `git diff <base> d3c84620` equal those of `git diff 6327a2db^1 6327a2db` (unit-parallel's side).
  - The lines of `git diff <base> 6327a2db^1` equal those of `git diff d3c84620 6327a2db` (harness-w44's side).
  - Both lanes' edits are in, and nothing else is.
- **Static steps** (`gate.ts:374-405`): typecheck, unit tests (4 workers), unit tests (alone, `--isolate`), runner unit tests, markers, marker order, **info sites**, **frozen lists** (`RUST_TS_FREEZE_LISTS=1` in that step's env only). Every step runs, and any failure makes `ok` false. `gate.ts:460-470` then writes the stopped `gate.json` and runs no suite (harness-w44 F7). I read this; I did not plant a failing static step in a gate run. The harness-w44 review did.

## Whole branch

- `git diff main..integ-w43 -- harness/baseline`: **empty**.
- **Oracle keys and case lists.** I dumped every suite on `main` and on head, with the checkout path normalized:
  - What I dumped: `oracleKey()`, a hash of `cases()` (id, file, args, env), `skipped()`, `unstable()`, the timeouts and the oracle argv.
  - **All 60 protected suites are identical.** The one new suite is `host-rlib` (222 cases, not protected).
  - `ir-hello` and `miri-sysroot-*` did not differ in this dump either, which is allowed.
  - Cases keyed on the sysroot (`logsSysrootPaths`) at head: exactly 4, `log-backtrace.rs` and `def-path-hash-ice-157238.rs` in `mir-o2` and `mono-ui`.
- `bunx tsc --noEmit -p .`: clean. This worktree first needed `bun install --frozen-lockfile`, which wrote only `node_modules/`.
- `bun test ./scripts ./harness`: **414 pass, 0 fail**, 52 s.
- `bun scripts/frozen-lists.ts`: **48/48 MATCH**, 11 s, exit 0.
- `bun src/rust_ts/info_sites_check.ts`: 136 sites (3 skipped), 83 in ported fns, 18 fns not ported, exit 0, no ERROR.
- Samples (`RUST_TS_AGENT=root-w43-check`, `--sample 100`):
  - `mir`: 100/100 MATCH
  - `check-ui`: 100/100 MATCH
  - `rmeta-ui`: 100/100 MATCH
  - `mono-ui`: 99/100 MATCH. The 1 DIFF is `tests/ui/explicit-tail-calls/callee_is_track_caller_polymorphic.rs`: it is not protected, and it is a DIFF on `main` too (checked with `--filter`, on both trees). Line 14: the port omits "warning: tail calling a function marked with `#[track_caller]` has no special effect".

## What I did not check

- No gate, no full suite, and no full `src/tools` unit step (parallel or serial). Only the four alone files ran, isolated.
- I did not regenerate the codegen sets (fixers-47's review did), and did not re-run the lanes' own mutants in `marker-check`, `case-lock`, `env`, `miri-sysroot` or `host-rlib` tests (they pass in the runner step).
- I did not run the `host-rlib` report suite, the ELF end-to-end compilations, or any run under load.
- I did not plant a failing static step in a real `gateRun` (read only; harness-w44's review reproduced it).

# Review root-w58-check: root's wave 40r integration commits on `integ-w58`

Reviewer (independent, read-only on code). Subject: `c474942a`, `72b2eeeb` and `c708c5d5`, plus the lane merges on
`integ-w58` (checked for resolution only). Reviewed at `c708c5d5`.

## Verdict: APPROVE WITH NITS

- **Forwarders:** both are exactly object 0.39.1's methods.
  - The port really links hello now. A port build of hello without `--sysroot` is byte-identical to the oracle's
    (sha256 `a93f71e5…`) and runs.
  - The link goes through both forwarders (20 `add_symbol` calls, 1 `set_subsections_via_symbols`).
  - The driver test's two moved cases produce byte-identical artifacts too.
- **Manifest pins:** the hashes equal an independent download at the gitlink commit.
- **Skeleton test:** the removed check is covered by `simd_stop.rs`.
- **Env restriction (`c708c5d5`):** this is right. Upstream's `default_sysroot` reads no environment variable, so the
  compile's environment has no business reaching the oracle. The kept set is enough for rustup everywhere the port runs
  on the root host. Dropping `RUSTUP_TOOLCHAIN` or `RUSTUP_DIST_*` cannot change the printed sysroot.
- **Merges:** every merge on the branch is exactly git's automatic merge. The one file both sides changed (`regen.ts`)
  combines correctly.

The four nits are about placement, duplication, Windows, and what the driver test compares. Nothing must be fixed before
acceptance.

## Evidence

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check` | `markers ok (27220, 75 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 527)` |
| `bun test <the 7 paths>` with `CI=1` | 970 pass, 0 fail, 0 skipped, 96 files |
| same, `CI` unset | 970 pass, 0 fail, 0 skipped, 96 files (`harness/m7-suites.test.ts` is not under these paths) |
| `codegen_backend.oracle`, `config_sysroot`, `driver.oracle`, `simd_intrinsic`, `skeleton` alone, `RUST_TS_REQUIRE_PROBES=1` | 88 pass, 0 fail, 0 skipped |
| `check-ui --sample 200 --jobs 6` (`RUST_TS_AGENT=root-w58-check-r1`) | MATCH 200/200 (run `20261114-145929-root-w58-check-r1-1k9j`) |
| `rmeta-ui`, same flags | MATCH 200/200 (run `20261114-150000-root-w58-check-r1-phll`) |
| `mono-ui`, same flags | MATCH 200/200, 488 skipped (run `20261114-150034-root-w58-check-r1-xxm3`) |
| `mir-o2`, same flags | MATCH 200/200, 488 skipped (run `20261114-150125-root-w58-check-r1-bucs`) |
| `run-pass-miri`, same flags | MATCH 200/200, 497 skipped (run `20261114-150213-root-w58-check-r1-ijfi`) |
| `ir-hello`, same flags | MATCH 2/2, tier N1 (run `20261114-150326-root-w58-check-r1-7k4d`) |
| `bun scripts/llvm-src.ts check` | `llvm-src ok: 96 files at aab11ee0ea5e (the checkout's gitlink)` |

Setup:
- `.env.local` from `integ-w39`, plus `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`.
- `bun install --frozen-lockfile`.
- The review branch starts at `c708c5d5`.
- The machine was on AC power, and no `GATE_RUNNING` file existed in the main checkout.
- `bun scripts/state.ts summary` showed no open STOP.

## 1. The forwarders (`c474942a`)

- **`Object_add_symbol`** (`src/rustc_codegen_ssa/back/link.ts:4407`) returns `file.add_symbol(symbol)`. The vendored
  `Object.add_symbol` (`src/vendor/object/write/mod.ts:406`) follows object-0.39.1 `write/mod.rs:432` arm for arm:
  - the `debug_assert!` on scope;
  - the section-symbol early return, which updates `flags` unless `None`;
  - the global-prefix mangling for named Text/Data/Tls symbols, with `symbol_map` keyed on the unmangled name;
  - `add_raw_symbol` otherwise.
- **`Object_set_subsections_via_symbols`** (`link.ts:4411`) calls `file.set_subsections_via_symbols()`. The vendored
  method (`write/mod.ts:288`, marker `write/mod.rs:307`) sets `macho_subsections_via_symbols` only when the format is
  MachO, as upstream's `#[cfg(feature = "macho")] if self.format == BinaryFormat::MachO` does. The old forwarder set the
  flag unconditionally (with the `debug_assert!` as a comment). The caller (`link.ts:2513`, link.rs:2531) only reaches it
  for MachO, so behaviour is the same, and the new form is the faithful one.
- **`SymbolId`:** the stand-in is gone, and `WriteSymbolId` is now the writer's `SymbolId`. `apple_add_data_and_relocation`
  and the test overrides in `link_with_args.oracle.test.ts:159,264` type-check against it (`tsc` clean).
- **Hello really links through the port.** I compiled `fn main() { println!("Hello, world!"); }` with
  `bun src/rust_ts/main.ts --emit=link hello.rs` (no `--sysroot`, `RUST_TS_IMPL` unset, so the port and not the shim)
  and with `rustc +nightly --emit=link hello.rs`:
  - Both binaries are 472536 bytes, `cmp`-identical, sha256
    `a93f71e5eb0ef91ac0589b623543dabaec4f8af984d5324686732027742baf04`.
  - The port's binary prints `Hello, world!` and exits 0.
  - A `--preload` that wraps the two `xlane` entries counted 20 `Object_add_symbol` calls and 1
    `Object_set_subsections_via_symbols` call during that compile, with the output still identical. So `add_linked_symbol_object`
    really runs through the vendored writer (the linked-symbols list is not empty for a std executable).
- **The driver test's moved cases** (`src/rustc_driver_impl/driver.oracle.test.ts:97-98`) are sound as MATCH for what the
  test compares:
  - For `x.rs` (`fn main() {}`), both sides print the same 126-byte `--edition` warning on stderr, nothing on stdout, and
    exit 0.
  - Run by hand in separate directories, `x` and `optimize` are byte-identical between the port and the oracle, and both run.
  - The test itself does not compare the artifacts (N4).
  - The PENDING entries they replace named `ssa-link-b: self_contained_components`, which ssa-link-b has ported.

## 2. Manifest pins (`72b2eeeb`)

- `harness/llvm-manifest.json:39` (`IntrinsicsX86.td`, `c62fccf0…`) and `:48` (`Support/ModRef.h`, `f44f0a5c…`).
  Both equal the sha256 of the file downloaded independently from
  `raw.githubusercontent.com/rust-lang/llvm-project/aab11ee0ea5e…/<path>`, and of the copy under
  `$RUST_TS_DATA/llvm-src/aab11ee0…/`.
- `aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019` is the rust checkout's `src/llvm-project` gitlink (`git ls-tree`).
- `llvm-src.ts check` and `coverage --check` pass.
- Neither file carries a `// llvm:` marker yet. The references are the citations review ir-fix-a N2 asked to make
  checkable (`intrinsics.ts:410` `td: 461, file: "IntrinsicsX86.td"`, `core.ts:1076`), so pinning is what was asked.
- The stale `get_tools_search_paths` comments in `link.ts` now say where the function lives (session.ts, with
  linker.ts's forwarder). That is accurate.

## 3. The skeleton change (`72b2eeeb`)

- The removed check called a whole-function `generic_simd_intrinsic` stub and expected
  `/^cg-intrinsic-b: .*\/intrinsic\.rs generic_simd_intrinsic$/`. That stub no longer exists: ir-fix-a ported the head,
  and each unported arm stops through `stop()` (`intrinsic.ts:2399`) with the intrinsic's name appended.
- `simd_intrinsic.test.ts:83` compiles `simd_oracle/simd_stop.rs` through the port and asserts exit 70 and
  `rust-ts: unported: cg-intrinsic-b: compiler/rustc_codegen_llvm/src/intrinsic.rs generic_simd_intrinsic simd_fsqrt`.
- `:96` checks that the fixture compiles under the oracle, so the stop is a real unported arm and not a user error.
- So the fill lane's name is still pinned, end to end. Both tests ran and passed here (`RUST_TS_REQUIRE_PROBES=1`, no skip).

## 4. The env restriction (`c708c5d5`)

- **Is it right?** Yes.
  - Upstream `default_sysroot` (filesearch.rs:279) reads `argv[0]` (`from_env_args_next`) or the `librustc_driver`
    location, and no environment variable.
  - The port's stand-in asks the oracle. Whatever the compile's environment holds that rustc reads at session start must
    therefore not reach that spawn. Otherwise a compile error (or warning) of the user's environment becomes a failure to
    find the sysroot.
  - Confirmed: `MACOSX_DEPLOYMENT_TARGET=abc rustc +nightly --print sysroot` prints the deployment-target error and exits
    1, which the old inherited-env spawn turned into `unported`.
  - With the fix, `MACOSX_DEPLOYMENT_TARGET=abc bun src/rust_ts/main.ts --print sysroot` gives the oracle's stderr,
    stdout and exit 1 exactly.
  - The same reasoning holds for `tools.ts` `oracle_sysroot` (the LLVM tools' directory).
- **Is the set enough?** `rustc +nightly --print sysroot` (rustup proxy at `~/.cargo/bin/rustc`) printed the same
  `/Users/…/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin` with exit 0 under each of these environments:
  - the full environment;
  - `env -i PATH HOME`;
  - `env -i PATH RUSTUP_HOME CARGO_HOME`, with no `HOME`;
  - `env -i PATH` alone (rustup falls back to the passwd home).
- **Each environment the port runs in:**
  - **Main harness:** the subject gets the caller's environment minus scrubbed variables. `pinSessionEnv` may unset
    `HOME` and pin `PATH`, but only for cases whose sources read them, and those pass `--sysroot`. Either way the new set
    is a subset of what the old spawn saw, minus variables rustup does not read for an installed toolchain.
  - **Miri's `RUSTUP_HOME`:** forwarded. The spawn fails there as before:
    `error: toolchain 'nightly-aarch64-apple-darwin' is not installed`, checked with
    `RUSTUP_HOME=$RUST_TS_DATA/rustup-miri`. The lazy read keeps that unreachable for `--sysroot` compiles (run-pass-miri
    200/200 above).
  - **Gate unit step:** both full unit runs above are clean.
  - **CI-like minimal environments:** `PATH` plus either `HOME` or `RUSTUP_HOME`/`CARGO_HOME`, as in the official
    container images, is enough. The no-`HOME` case works too.
- **Can a dropped variable change the printed sysroot?**
  - `RUSTUP_TOOLCHAIN=stable` added to the minimal environment: same path. `+toolchain` outranks it.
  - `RUSTUP_DIST_SERVER=http://127.0.0.1:1`: same path, exit 0. Dist variables only matter when installing, and
    `RUSTUP_AUTO_INSTALL=0` forbids that.
  - A directory override or `rust-toolchain.toml` is outranked by `+toolchain` too.
- **The guard test still exercises the spawn.** `PATH` is forwarded. I ran the port without `--sysroot`
  (`--print sysroot`) in an `env -i HOME RUSTC_ICE=0 PATH=<fake bin>:/usr/bin:/bin` environment with
  `config_sysroot.test.ts`'s fake `rustc`:
  - The fake was called (`+nightly --print sysroot` in its log).
  - The port stopped with `unported: rustc_session::filesearch::default_sysroot (rustc +nightly --print sysroot failed: error: toolchain is not installed)`.
  - So an eager read would still be caught by the guard's empty-log assertion. The guard test itself passes.
- **`codegen_backend.oracle.test.ts`:** passes, both `MACOSX_DEPLOYMENT_TARGET=abc` and `=10.5`. Its compile passes no
  `--sysroot` (`:203-214`), so it does reach the restricted spawn.

## 5. Merges

I recomputed every merge in `main..c708c5d5` with `git merge-tree --write-tree <p1> <p2>` and compared the result with the
merge commit's tree:

| Merge | Branch | Auto tree == actual |
|---|---|---|
| `7686d043` | fixers-58-queued-nits | yes |
| `007875ff` | review/fixers-58 | yes |
| `ed0388de` | port-default-sysroot | yes |
| `e571fd87` | review-default-sysroot-r | yes |
| `3f1e3d01` | review-default-sysroot-recheck-r | yes |
| `66cb17ea` | port-ssa-link-b | yes |
| `2f4167a4` | review-ssa-link-b-r | yes |
| `b2171953` | review-ssa-link-b-recheck2 | yes |
| `338b624a` | port-vendor-object-writer | yes |
| `9c5aa7c0` | review-vendor-object-write-w40r | yes |
| `ce42dfc2` | fix-ir-run-pass-differences | yes |
| `3df82930` | review-ir-fix-a-r | yes |
| `99663b9b` | review-ir-fix-a-recheck2 | yes |

- No hand resolution anywhere.
- The only file changed on both sides of any merge is `src/rustc_codegen_ssa/back/linker_oracle/regen.ts`, in `66cb17ea`:
  - The integ side made every case exit 0, since at the pin `-Cstrip` on Apple only warns.
  - ssa-link-b added `EXTRA_CASES` and the header text.
  - The hunks don't overlap, but the combination needs every `EXTRA_CASES` entry to exit 0 under the oracle.
- I checked that combination without writing to the tree, using a scratch copy of the merged loop that compares instead
  of writing. All 15 cases (`CASES` + `EXTRA_CASES`) exit 0, and their normalised `.args` and captured `.list` equal the
  committed `oracle/` fixtures. So running `regen.ts` today would succeed and leave the fixtures unchanged.

## Findings

**N1 (nit, placement): `src/rustc_session/filesearch.ts:165-182`.** The new `oracle_sysroot_env` helper sits between
`default_sysroot`'s upstream doc comment (`/// This function checks if sysroot is found using env::args().next(), …` and
the "not ported (no marker; filesearch.rs:279 …)" note, `:165-168`) and the function's own `PORT` block (`:184`). The
upstream doc now reads as the helper's. Move the helper above `:165`, for example next to `REPO`/`DEFAULT_SYSROOT`.

**N2 (nit, duplication): `src/rustc_session/filesearch.ts:175` and `src/rust_ts/llvm/tools.ts:67`.**
- The helper is copied word for word in two files.
- `default_sysroot`'s doc says it finds the toolchain "the way rust_ts/llvm/tools.ts `oracle_sysroot` finds the pinned
  toolchain". The two spawns are meant to stay in lockstep, and a later change to one list will not reach the other.
- Export one helper and use it from both, or at least cross-reference the copies.

**N3 (nit, Windows, unchecked host): `filesearch.ts:177`, `tools.ts:69`.**
- The kept list is `PATH`, `HOME`, `RUSTUP_HOME`, `CARGO_HOME`.
- The project's own audit of what a process "needs to start and find the toolchain" (`scripts/lib/env.ts:34-35`) also
  names `USERPROFILE`, `SYSTEMROOT` and `TMPDIR`/`TEMP`/`TMP`.
- On macOS and Linux none of these matters for this spawn (checked above).
- On Windows, a child process started without `SYSTEMROOT` is known to fail in some system DLLs, and rustup locates its
  home from `USERPROFILE` first. AGENTS.md §5 keeps Windows "where cheap", and adding the two names is cheap. Consider
  forwarding `USERPROFILE` and `SYSTEMROOT` too, or say in the PORT note why not.

**N4 (nit, test strength): `src/rustc_driver_impl/driver.oracle.test.ts:97-98`.**
- The two cases now perform a real link, but the test compares only stderr, stdout and exit.
- Both sides write their output (`x`, `optimize`) into the same `WORK` directory, the port second, and nothing compares
  them. A port that linked a wrong binary would still MATCH.
- I checked the artifacts by hand (identical, §1), so the cases are correct today.
- A cheap guard would be to rename the oracle's output before the port runs and `expect` the bytes equal for these two
  cases. The ir-hello and native suites will cover this eventually, but this is the only test that links through the
  port's default sysroot now.

No F-level findings.

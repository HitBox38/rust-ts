**Verdict: APPROVE WITH NITS.** The port and the suites do what they claim, and nothing protected moves. The handoff's one claim that fails is about `custom_local_sysroot`: it can be replayed (F1).

# Review: lane `miri-sysroot` and harness batch `harness-m6d`

Batch: `t3/miri-sysroot-report`, head `58695e83`, on `main` at `9e11cc8b`. Commits: port `28877855`, harness `02a3d9da`, handoff `58695e83`. The commits are cleanly separated: the port commit touches no `harness/` or `scripts/`, and the harness commit touches no `src/`. Runs were on AC, one heavy process at a time, with other lanes running (load 3 to 38). No STOP is open.

Every plant and experiment ran in a scratch copy of the tree or through one-shot scripts in my scratchpad. Nothing in the tree changed except this file.

## Findings

**F1, medium: `custom_local_sysroot` can be replayed, on both sides. Reproduced.**
`docs/handoff/miri-sysroot.md:5`, `harness/corpus/gen-miri-sysroot.ts:9-10`.
The handoff says the crate cannot be replayed because its source was a temp file that is gone. The file's contents and path are both recoverable:
- rustc-build-sysroot 0.5.14 (`src/lib.rs:480-485`, the version in upstream's `Cargo.lock`) writes an empty `lib.rs` for a sysroot with std.
- The path is in the sysroot's own `custom_local_sysroot-21f6299cb1b7fe0a.d`: `.../T/rustc-build-sysroot-XIGEBx`.

I created an empty `lib.rs` at that path and ran there as the cwd, with the log's argv otherwise (`--extern`, `-L` and `--out-dir` remapped as `gen-miri-sysroot.ts` does). The rlib (1,492 bytes) and rmeta (1,692 bytes) equal the sysroot's on the oracle and on the port, and dep-info matches between the two. In one other temp directory I tried, the oracle's rlib and rmeta kept their sizes but differed from the sysroot's.

So the path has to be the `.d` file's. The log's `rustc-build-sysroot-8DEjGx` is a different directory: `setup-v.log` is not the run that built this sysroot. The other 26 crates are not affected, since they replay byte-identically.
Fix: correct the handoff and the generator's comment, so the result reads 27 of 27. Adding the case to the corpus needs the wrapper to create that temp path. That is optional, as this crate is an empty leaf that no crate depends on.

**F2, low: two runs of one crate and side share an out dir, and the second breaks the first. Reproduced.**
`scripts/miri-sysroot-run.ts:76-78`.
`out` is `$RUST_TS_DATA/rmeta/miri-sysroot/<crate>/<side>`, removed at start. It is shared between worktrees. I started two subject runs of `getopts` one second apart. One finished correctly, and the other exited 2 with `couldn't create a temp dir: No such file or directory`. In a suite that reads as a false failure on a report case, so it costs no protected case. I did not produce a false MATCH. By reading, one would need a run to read files another worktree wrote in the moment between them, which is a narrow window.
`scripts/rmeta-run.ts` avoids this with a pid-named temp file and an atomic rename.
Fix: make the out dir unique per process.

**F3, low: the oracle cache key ignores the code that builds the argv. Reproduced.**
`harness/suites.ts:2232`.
The key hashes the wrapper, the corpus and `miriOracleKey`, but not `harness/miri-sysroot.ts`, which adds `--sysroot` and `MIRI_BE_RUSTC` and expands the templates. I added a flag there in the scratch copy: `caseOracleCacheKey` stayed `864c9ad2...` while the argv changed. The result is a cached oracle compared with a fresh subject under a different argv. That is usually a loud false DIFF, but it could be a false MATCH if the changed flag affects only the oracle.
`rgOracleKey` (`harness/suites.ts:2100`) already hashes its helpers.
Fix: add this file to the key. That is safe to do now, as these suites have no baseline.

**F4, low: extra files in the out dir are not compared. Reproduced.**
`scripts/miri-sysroot-run.ts:89-96`.
A plant writing a stray `stray-file.o` next to the outputs still gave `MATCH=1`. The port leaves no such file today: on `custom_local_sysroot` it wrote exactly the three expected files. A leftover temp directory from a future change would pass unseen.
Fix: print the sorted names in the out dir.

**F5, nit: `RmetaLink.decode` reads the `Option` tag as a `usize`. Read only.**
`src/rustc_codegen_ssa/back/rmeta_link.ts:67`.
Upstream's `Decodable for Option` uses `read_u8` (`rustc_serialize/src/serialize.rs:395`), and `encode` here uses `emit_u8`. On a corrupt `.rmeta-link` starting `80 00`, upstream panics on the invalid discriminant, and the port reads `0` as `None`. Valid data is the same either way, and this lane's path does not reach `decode` outside tests.
Fix: `read_u8`.

**F6, nit: the ICE report differs when `config`'s assertion fires. Reproduced.**
`src/miri/bin/miri.ts:417`.
`--crate-type dylib` or `staticlib` alone gives exit 101 on both sides, but the port prints `the ICE report stopped: location refused: unmarked frame src/miri/bin/miri.ts:417`. It is a stop, not a wrong value. No crate in the corpus reaches it.

**F7, nit: stale comments. Read only.**
- `scripts/gate.ts:151-155`: `oracleRuns`'s doc lists the other wrappers but not the new one.
- `harness/suites.ts:2215`: says 9 GB on core, where difftest measures 10.0 to 10.8 GB.

## What was asked

### 1. Fidelity

Read against upstream:
- `object::write`: `mod.rs`, `elf/object.rs`, `elf/writer.rs`, `string.rs`, `util.rs`.
- `ar_archive_writer`: `archive_writer.rs`, `object_reader.rs`, `alignment.rs`, `math_extras.rs`.
- `rustc_codegen_ssa`: `create_object_file`, `add_gnu_property_note`, `elf_os_abi`, `elf_e_flags`, `create_wrapper_file`, `link_binary`, `link_rlib`, `find_bundled_library`, `preserve_objects_for_their_debuginfo`, `warn_if_linked_with_gold`, `build_inner`, `rmeta_link.rs`.
- `object_architecture`, `to_object`, and `MiriDepCompilerCalls`.

Order, logic and values match, apart from F5.

Because the 26 crates exercise a very narrow part of this code, I also tested it three other ways:

| check | what | result |
|---|---|---|
| Real crates, ELF | a probe built on the real `object` 0.39.1: 33 architectures, both endians, 3 flag sets, 7 data lengths, with and without the note, against the port's `Object` | 2,772 of 2,772 byte-identical |
| Real crates, archives | a probe on the real `ar_archive_writer` 0.5.3: all 7 kinds, thin, `is_ec` none/false/true, real ELF members with symbols (32/64, LE/BE; local, weak, undefined, absolute, common, duplicates, import descriptors), names at the 15/16 boundary, with `/`, repeated, non-ASCII, large uid/gid/mtime | 528 of 528 byte-identical |
| Oracle, every target | oracle against port on all 334 targets from `--print target-list`, `-Zembed-metadata` no and yes, with varied padding | 4 same, 664 stop `unported`, no wrong output |
| Oracle, edge cases | 33 cases: emit sets, `-o` forms, save-temps, split debuginfo, crate types, `#[link]` kinds, exports, post-mono error, read-only output | 27 same; 6 differ, explained below |

On the targets: the 4 same are `aarch64-unknown-linux-gnu` and `x86_64-unknown-linux-gnu`, each with both metadata modes. The 664 stops are at an unported target module, or at Mach-O, COFF or wasm metadata.

The 6 edge cases that differ:
- `-o -`, a missing out dir and a bundled static library each stop `unported`.
- `dylib` and `staticlib` are F6.
- `save-temps`: exit, stdout and stderr match, and both sides list the same files apart from the random temp directory names. My comparison keyed hashes by path, so those names made it report a difference; I did not compare the file contents separately for this case.

**Host dependence:** none found. All byte order is explicit, and no new code reads the host's platform. Output is keyed on `sess.target`.

**Unported branches:** they stop `unported` and I found none silently wrong. `elf_e_flags` returns 0 only for architectures upstream also gives 0, and the rest stop. The markers on `create_object_file`, `elf_e_flags` and `create_wrapper_file` count those functions as ported although some arms stop. The header comments say so.

### 2. Does the suite prove what it says?

Reproduced through difftest:

| suite | status | subject wall | subject max RSS |
|---|---|---|---|
| `miri-sysroot-alloc` | `MATCH=1` | 21.4 s | 3,026 MB |
| `miri-sysroot-std` | `MATCH=1` | 24.9 s | 4,074 MB |
| `miri-sysroot-core` | `MATCH=1` | 91.4 s | 10,000 MB |

The other 23 crates through the wrapper: stdout, stderr, exit and all report lines equal, and the oracle replay equals the sysroot for all 26.

Plants in the port, through `difftest --suite miri-sysroot-alloc`:

| plant | status | first difference |
|---|---|---|
| none | MATCH | |
| one rmeta byte flipped | DIFF | line 2 |
| one byte flipped in an rlib member | DIFF | line 3 |
| dep-info changed | DIFF | line 1 |
| rmeta and rlib not written | DIFF | line 2 |
| rlib under a wrong name | DIFF | line 5 |
| stray extra file | MATCH | F4 |

- **Fresh output:** yes. The subject's out dir is cleared before each run, the subject is never cached, and the "no output" plant shows the wrapper does not fall back on the sysroot's files. The only route to reading another run's files is F2.
- **The argv:** regenerating the corpus from `setup-v.log` with the generator gives `crates.json` byte for byte. Beyond the recorded argv, the corpus adds `--sysroot` and `panic_abort`'s `-Cpanic=abort`. cargo-miri's source is not available, so equality with its true argv rests on the replay: the oracle reproduces the sysroot's rmeta and rlib for all 26. That is strong evidence but not a direct comparison.
- **Dependencies:** every `--extern` and `-L dependency=` points at the sysroot, so a port-side difference in a dependency cannot hide.
- **The chain:** the handoff's inference is sound, and it is now measured. I ran all 26 crates in order with each crate's `--extern` pointing at the port's own earlier outputs: **26 of 26 rmeta and rlib byte-identical to the sysroot**. Earlier in this review the script reported 24 of 26 because of a bug in my file-name filter (`libc`, `std`); the rerun with the filter fixed is the result given here.

### 3. `custom_local_sysroot`

Not as the handoff states: see F1.

### 4. Protected state and the harness batch

- **Cases, baselines, keys:** `git diff` on `harness/baseline`, `harness/scope.json`, `scripts/difftest.ts` and `scripts/lib` is empty. The `harness/suites.ts` diff removes one import line, to extend it, and otherwise only appends. No wrapper or input hashed by an existing oracle key changed.
- **Default set:** unchanged. It is `protectedSuites()`, and these suites have no baseline file.
- **`oracleRuns`:** it cannot widen anything for existing suites. The new branch is taken only when the command is this wrapper under Bun, and no existing suite's is. It returns the first word after `--`, which `undeclaredRuns` still requires to be `rustc`, a declared probe or the isolated Miri.
- **Heavy memory:** safe with a gate. These suites run only if named with `--suites`, heavy suites run last and one at a time, and going over budget is a reported `ERROR:` line, not a failure. Core was 10.0 GB here and 10.8 to 10.9 GB for the lane, against a 12,288 MB budget, so it is near the limit as the handoff says.
- **Isolated homes:** yes. `MIRI_CASE_ENV` sets both homes through the case's env.
- **The sysroot:** the out dir is `$RUST_TS_DATA/rmeta/miri-sysroot`, not `$RUST_TS_DATA/miri-sysroot`. The sysroot's hash was identical before and after the reproduction, replays, plants and chain, which included fresh oracle runs.
- **Unvalidated `--crate`:** the wrapper clears the out dir before checking the crate name. The last path part is always `oracle` or `subject`, and the suites pass fixed names, so this is harmless.

### 5. Unit tests

The new tests add 15 tests in 76 ms, well inside the 5 s budget. Under `RUST_TS_REQUIRE_PROBES=1 CI=true` nothing skips, and there is no skip call in them. They also pass with `RUST_TS_DATA` pointing at an empty directory, so they do not need the Miri sysroot: `rlib_stub.oracle.test.ts` uses an inline fixture despite its name. `./harness` alone: 52 pass, 0 skipped, 2.9 s. `gate-probes` and `unit-steps` pass.

### 6. The `// crate-pending:` markers

- `coverage.ts --check` says `markers ok` and does not see them, as intended.
- I applied the handoff's scope line and `sed` in a scratch copy: `markers ok`, vendor count 5,193 to 5,231 (the 38 markers), and `--missing` gives the handoff's numbers (27/27, 2/2, 1/1, 6/7, 2/7).
- The `sed` leaves the sentence in `lib.ts:4`, which the handoff says to drop by hand. The source is in cargo's cache, so the gate's `--offline` step can find it.
- PORTING §5b allows the entry: 0.5.3 is the single locked version, and `rustc_codegen_ssa` depends on it. The crate has no `#[cfg(test)]` unit tests to port; its `tests/` are integration tests.

### 7. Leftovers and scope

- The tree is clean, with no `rustc-ice-*` files in it or in the commits.
- Temp paths: `OUT_DIR` in the corpus keeps the setup run's path for 5 crates, which the handoff discloses. Replays match, so no output depends on it, but it is a machine-specific path in a committed file.
- The wrapper keeps its out dir when a sysroot line says `differs`, by design, until the next run clears it. Core's would be about 70 MB, and the disk was near full at the last recorded check (97%).
- Scope: changes outside the lane's list (`rustc_target/spec/mod.ts`, `session.ts`, `fs.ts`, `rustc_interface`, `codegen_backend.ts`) are small, needed by the path and disclosed. The lane went over the 3k-line guide with about 3.5k ported. That was disclosed and reasonable, since stopping at `link_rlib` would have left every crate at exit 70.

### 8. Regression risk

**By reading:** the only logic these changes add to shared paths is behind `should_link()`, which used to stop `unported`, so no protected case can have depended on it. `check-*` and `rmeta-*` use `--emit=metadata`, and `mono-ui` uses `--emit=llvm-ir`. `TempDirBuilder` is unchanged when no suffix is set.

**Samples:** `--sample 30`, except `check-std`, which is its one case.

| suite | result |
|---|---|
| `check-ui`, `rmeta-ui`, `mono-ui`, `emit`, `expanded`, `run-pass-miri`, `mirdump-ui` | 30 of 30 each |
| `pm-ui` | 29 of 30; one UNPORTED, `tests/ui/proc-macro/expand-expr.rs` (cross-thread proc macro), not in `harness/baseline/pm-ui.txt` |
| `check-std` | MATCH |

**Startup:** a `no_core` metadata run took 628 to 648 ms against the base's 663 to 669 ms, so the new imports add no measurable cost. `bunx tsc` passes in a scratch copy, since this worktree has no `node_modules`.

## Not checked

- The gate, full suites and the full unit steps. Only the sampled suites and the named tests ran.
- A Linux or Windows host.
- Target-dependent values on ELF targets the port has not ported: `elf_os_abi` on FreeBSD, Solaris and Hermit, and `elf_e_flags`' arms, which stop anyway. `add_gnu_property_note` and `create_wrapper_file` ran only on x86_64 and aarch64 Linux through rustc. The probe covers the writer below them, with the steps written by me.
- Mach-O, COFF, XCOFF and wasm wrappers, ELF object symbols, and bundled native libraries: all stop `unported`.
- Archives above 4 GB (the `Gnu64` switch, by reading only) and EC paths with real COFF members. The probe's members were ELF and non-objects, and its `object` features are my own choice rather than rustc's.
- `exported_non_generic_symbols_helper` and `reachable_non_generics_helper` beyond the byte comparisons, as they were not part of this diff.

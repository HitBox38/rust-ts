# Re-check: ssa-link-b (wave 40r), round 2

**Verdict: PASS WITH NOTES.** F1 is fixed and pinned by two tests. N1, N3, N4 and N5 are fixed. Every mutation I re-applied is
caught. Nothing changes in production beyond the fixes. The notes below are small, and none blocks the merge.

- Subject: branch `t3/port-ssa-link-b`, commits `cf5ddeba` and `8bd97318`, on `330371b2`. Diff: `git diff 330371b2 8bd97318`.
- First review: `docs/reviews/ssa-link-b.md` (commit `9e59c6ef`, branch `t3/review-ssa-link-b-r`). It failed on F1, with
  nits N1–N6.
- Reviewer branch: `t3/review-ssa-link-b-recheck2`, on `8bd97318`.
- Upstream: `$RUST_TS_DATA/rust/compiler/rustc_codegen_ssa/src/back/{link.rs,link/raw_dylib.rs,command.rs}` at the pin
  (6f5da406b56c).
- Host: AC power and `--jobs 6`. `.data/tmp/GATE_RUNNING` was absent each time I checked. `.env.local` came from integ-w39,
  plus `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. `RUST_TS_AGENT=rev-slb-recheck-q4`.

## 1. F1: fixed

- raw_dylib.ts:187 now builds the name with `to_base_fixed_len(..).as_str()`, as upstream's `format!` does at
  raw_dylib.rs:179-184.
- **The expected name is the oracle's own.** `lib2n3wl7ye29258ssp0kfgmj7i1.so` is the `-l:` argument in
  `linker_oracle/oracle/linux-raw-dylib.args`, and the pinned rustc wrote that file:
  - `regen.ts` runs `rustc +<pin> --print link-args` on `rawdylib.rs` (`#[link(name = "foo", kind = "raw-dylib")]` with
    `fn foo_fn`), and I re-ran it (§2);
  - the unit test reads the name from that file and does not hard-code it.
- **The unit test's inputs give the same hash.** Upstream hashes only `load_filename` and each import's name (raw_dylib.rs:172-176):
  - here `load_filename` is `libfoo.so` (`foo`, not verbatim, on x86_64-linux), and the one import is `foo_fn`, matching the
    crate the oracle compiled;
  - the hash does not depend on the work directory. My regen ran in a different directory from the lane's and wrote the same
    name.
- **Two tests catch the F1 mutation.** With `.as_str()` dropped:
  - `linker_with_args builds the oracle's --print link-args line for each case` fails (the linux-raw-dylib case);
  - `create_raw_dylib_elf_stub_shared_objects names the stub by the oracle's hash` fails.
- **The `vendor_object` table changes nothing in production.** Its default `new_elf_stub_writer` is the old function's body,
  which calls `unported` with the same message. Its only caller is raw_dylib.ts:243. Only the two test files replace it, and
  both restore it in `afterEach`.
- **A new side-effect import in raw_dylib.ts:** `import "../../../rustc_target/lib.ts"`. link.ts (line 88) already loads that
  module before it imports raw_dylib.ts, so in production the import does nothing. It lets raw_dylib.test.ts load first in a
  fresh process, and `bun test --isolate` on that file alone passes.

## 2. N1: fixed

**The fixtures reproduce byte for byte.** `bun src/rustc_codegen_ssa/back/linker_oracle/regen.ts` writes its scratch under
`$RUST_TS_DATA/tmp/linker-args-oracle/<agent>` and its fixtures into this worktree. It ran all 15 cases with exit 0 and rewrote
all 21 `oracle/*` files, which I confirmed by their mtimes. `git status` was clean afterwards. So the 11 old cases' fixtures
and the 4 new cases' fixtures, the 1796-line `host-dylib-static.list` included, are exactly what the pinned rustc prints. I
deleted the 18 MB of scratch.

**The old fixtures are unchanged.** In the diff, `CASES` and all its `oracle/*` files are untouched. The four cases are a
separate `EXTRA_CASES` list, so `linker_args.oracle.test.ts` (ssa-linker's test, which reads only `CASES`) is unchanged too.
`linker_oracle/` belongs to ssa-linker. The handoff says root gave leave for these edits; I did not check that.

**What each new case pins, read against its fixture:**

| case | in the oracle's line | upstream |
|---|---|---|
| host-dylib-static | `rmeta.o` then `lib.6vit7a70….rcgu.o` (the allocator object) | link.rs:2975, :2984 |
| linux-nostd-cdylib | the line ends its libraries on `-Bstatic`, and a `-Wl,-Bdynamic` follows the raw-dylibs `-L` | link.rs:3120 |
| linux-dedup | one `-lm` before the std rlibs | link.rs:3410 |
| linux-raw-dylib | `-l:lib2n3wl7ye29258ssp0kfgmj7i1.so` right after the raw-dylibs `-L` | raw_dylib.rs:179-184 |

**The synthetic pre-link and late-args test is right by upstream's code:**
- the pre-link object goes after `-m64`, which is the target's pre-link argument (link.rs:2928-2933);
- the late arguments go after `reset_per_library_state` and before `--eh-frame-hdr` (link.rs:3120-3125);
- `_dynamic` is used for the dylib and `_static` for the bin, each before the plain `late_link_args`, as `add_late_link_args`
  orders them (link.rs:2443-2457);
- the target maps are keyed on the target's flavor, which is the interned `Gnu(Yes, No)` that `add_late_link_args` looks up.

**The allocator is now checked in both directions.**
- Every crate that links std is given an allocator module.
- Where the oracle's line has no allocator object, the module gets a made-up path, `not-linked-allocator.rcgu.o`, so the
  port must leave it out. This applies to both prefer-dynamic dylibs.

**Mutations.** I applied each one with a perl substitution and ran `link_with_args.oracle.test.ts` and
`link/raw_dylib.test.ts`. Then I reverted it with `git checkout`, and the tree was clean after each one.

| mutation | where | result |
|---|---|---|
| F1: drop `.as_str()` | raw_dylib.ts:187 | 2 fail (oracle lines; raw_dylib unit test) |
| `add_pre_link_args` after `add_pre_link_objects` | link.ts:2868/2873 | 1 fail (pre-link/late) |
| allocator always passed (no `needs_allocator_shim_for_linking`) | link.ts:2639 | 2 fail (oracle lines; pre-link/late) |
| allocator never passed | link.ts:2639 | 3 fail (oracle lines; `link_natively`; pre-link/late) |
| allocator objects before metadata objects | link.ts:2915/2916 | 1 fail (oracle lines) |
| drop `reset_per_library_state` | link.ts:3002 | 1 fail (oracle lines) |
| drop the consecutive-library dedup | link.ts:3260 | 1 fail (oracle lines) |
| drop `add_late_link_args` | link.ts:3007 | 1 fail (pre-link/late) |
| `@`-file: no backslash escape | link.ts:2237 | 1 fail (`@`-file) |
| `command_line_too_big` always false | link.ts:2172 | 1 fail (`@`-file) |

This covers 10 of the lane's 12 mutations, and every one fails. I did not re-run the `late_link_args_static`/`_dynamic` swap
or the `@`-file newline mutation.

## 3. N3, N4 and N5: fixed

- **N3.** `eii_impl_crate_name` (link.ts:137) now calls `crate_info_crate_name`, which panics with `no entry found for key`.
  That is the message of upstream's `crate_info.crate_name[&cnum]` (link.rs:77, an `UnordMap` index).
- **N4.** `linker_path_exists = path_exists(linker_path) || linker_path_exists` checks every path, like upstream's
  `linker_path_exists |= linker_path.exists()` (link.rs:4097).
- **N5.** The test of `exec_linker`'s `@`-file fallback (link.rs:2105-2170) checks, in both paths in:
  - the POSIX escaping and the trailing `\n` per argument (`a\ b\\c\n<filler>\n`);
  - that the linker gets the one `@<file>` argument (argc 1);
  - that the first spawn really failed. A direct spawn would leave `DIRECT` in the capture file, and the length check would
    catch it.

**Is the E2BIG case deterministic?** Yes. The filler `lo` is the largest one the estimate lets through
(`very_likely_to_exceed_some_spawn_limit`, command.rs:139), so the estimated size is exactly `ARG_MAX` (1048576 here, from
`sysconf`). That estimate counts each argument as its bytes, a NUL and a pointer, which is how XNU charges argv, but it leaves
out the program. The kernel also charges argv[0] (the script's path) and the inherited environment. So the real total is
always over `ARG_MAX`, by at least argv[0]'s cost, and E2BIG follows whatever the environment holds. A bigger environment
only adds to the excess. I checked:
- `env -i` (an almost empty environment): passes;
- a 500 kB extra variable: passes;
- three runs in my normal environment: pass.

It could only break if the environment alone came near `ARG_MAX`. Then every spawn in the gate would fail too.

On Linux, a single argument of about 2 MB is also over `MAX_ARG_STRLEN`, so E2BIG holds there as well.

**Is it cheap?** The test takes 0.45 s, and a filtered run of its file takes 1.7 s in all. Most of the lane's 2.5 s is loading
the module. That is well under the unit step's 60 s timeout. It writes about 1 MB of scratch under
`$RUST_TS_DATA/tmp/linker-args-port/lwa-<agent>/atfile` and deletes it in `finally`.

## 4. No other behaviour change

Under `src/`, the diff touches only these production lines:
- link.ts: N3 and N4, above;
- raw_dylib.ts: the F1 `.as_str()`, the `vendor_object` table (§1), the side-effect import (§1), `ElfStubWriter` exported, and
  the header comment corrected for N2.

Everything else is tests, fixtures, `linker_oracle/common.ts` (`EXTRA_CASES` and the `src` union) and `regen.ts`, which now
loops over both lists.

## 5. Commands

- `bunx tsc`: clean.
- `bun scripts/coverage.ts --check`: markers ok. `--missing` gives link.rs 87/87 and raw_dylib.rs 5/5.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_ssa/ ./scripts/lib/unit-steps.test.ts`: 204 pass, 0 fail, across 30
  files.
- `bun test --isolate ./src/rustc_codegen_ssa/back/link/raw_dylib.test.ts`: 1 pass.
- `bun scripts/difftest.ts --suite check-ui --sample 200 --jobs 6`: 200/200 MATCH (run
  `20261114-141323-rev-slb-recheck-q4-km2v`).

## Notes

1. **The `@`-file test does not skip on Windows.** It is not under `skipIf`, its linker is a `/bin/sh` script, and on a
   Windows host `very_likely_to_exceed_some_spawn_limit` stops by name. So there it would fail rather than skip. Windows is
   unchecked (AGENTS.md §5), so this does not block. A `test.skipIf(process.platform === "win32")` with a printed reason would
   be the cheap fix, if the skip allowlist allows it.
2. **The pre-link and late-args expectation is built by the test.** The test inserts the arguments into the oracle's line,
   because no target in the oracle's std has these options. Its correctness rests on reading upstream. I checked the insertion
   points against link.rs:2928-2933, 3120-3125 and 2443-2457 (§2). This is informational.
3. **A duplicate import.** `link_with_args.oracle.test.ts` imports from `./command.ts` twice (`debug_Command`, then `Command`).
   Cosmetic.
4. **N2 and N6 are still open.** They are in the handoff's "Requests for other owners", with root:
   - N2: back/archive.ts and rustc_interface/util.ts, the `create_dll_import_lib` dispatch;
   - N6: apple.ts's stale comments.

   raw_dylib.ts's own header no longer makes the wrong `xlane` claim.

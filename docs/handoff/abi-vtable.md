# abi-vtable: M7 preflight O7 (`abi-aarch64`) and O3 (`vtable-alloc`)

Branch `t3/aarch64-abi-vtable`, on top of `integ-w39`.

| Commit | What |
|---|---|
| `1de34928` | O7: port `callconv/aarch64.rs`, ABI fixture |
| `7c5030f1` | O3: port `vtable_allocation_provider`, stop pins become comparisons, vtable contents dump |
| `01f3f628` | O7: ABI fixture's two targets in one process (unit budget) |

## Results

**O7.** Both aarch64 targets now pass `compute_rust_abi_info` and `compute_abi_info`. Hello on `aarch64-apple-darwin` is
byte-identical to the oracle through `-Zprint-mono-items`. The next stop on the host is
`rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate`, which is M7's own work; `--emit=metadata` exits 0.

**O3.** `vtable_allocation_provider` is fully ported. The 3 pinned stops (`vtable_static`, `vtable-through-const{,-nonincr}`)
are real comparisons and pass.

**ripgrep's `rg` bin on the host, through the partitioning driver, with the real provider:** byte-identical stdout and stderr,
6,910 `MONO_ITEM` lines at the dev profile and 8,448 at `-Copt-level=3 -Ccodegen-units=16`. CPU 29 s and 38 s user, RSS
2.4 and 2.6 GB (load about 30). The oracle built the dependencies. Limits are under "Not checked".

Nothing stops next on these paths before codegen. The two stops the sweep below found are listed under "For root".

## Coverage

- `compiler/rustc_target/src/callconv/aarch64.rs` 6/6, `compiler/rustc_middle/src/ty/vtable.rs` 3/3.
- Total 24,236 / 27,053 (89.59%), up 6.
- `coverage.ts --check --offline`: markers ok. `tsc`: clean.

## Oracle comparisons

| Check | Where | Result |
|---|---|---|
| `#[rustc_abi(debug)]`, 81 dumps: HFAs, HVAs, large aggregates, alignment, packed, enums, unions, wide pointers, ZSTs, unsized, 2^40 and 2^60 byte arrays, variadic, `extern "C"`, `"C-unwind"`, `"system"`, Rust ABI | committed: `callconv/aarch64_oracle/`, at `-O`, both targets | identical |
| Same program without `-O` | manual | identical |
| 8 mutations of `aarch64.ts`: `AbiKind` branch, 4-member limit, vector sizes, 128-bit alignment, 128-bit limit, return and argument extension, consecutive flag | manual | all detected; the `kind`-only ones on one target, as expected |
| `tests/ui/abi/{debug,c-zst,compatibility,pass-indirectly-attr}.rs`, `tests/ui/c-variadic/pass-by-value-abi.rs`, both targets, stderr and exit code | manual | identical |
| 25 `rustc_scalable_vector` files in `tests/ui`, both targets | manual | identical (50 runs) |
| `sysv64-zst.rs`, `x86-64-sysv64-arg-ext.rs` on darwin | manual | both exit 101; the oracle's ICE text differs, which is not compared anywhere. On linux-gnu both identical |
| Vtable contents, slot by slot: null and glue drop slots, size, align, default and overriding methods, vacant slots, `TraitVPtr`, no principal, closure, generic, a type of 2^60 bytes | committed: `oracle/vtable_static.vtables.txt`, from a rustc-dev probe; x86_64-linux | identical |
| The same contents on `aarch64-apple-darwin` | manual, before the program gained the last 2 statics | identical |
| 4 mutations of `vtable_allocation_provider`: size, align, drop slot, `Vacant` | manual | all detected |
| Collector 61 tests, partitioning 67 tests | `bun test` with `RUST_TS_REQUIRE_PROBES=1` | all pass |
| 109 `tests/ui` programs mentioning `dyn` (static or const, coercion, vtable, upcasting, consts), through mono, on x86_64-linux and the host | manual | 214 of 218 identical; 4 below |

| Sample (`--sample 100`, `RUST_TS_AGENT=abi-vtable`) | MATCH |
|---|---|
| `mir` | 100/100 |
| `check-ui` | 100/100 |
| `tydump-ui` | 100/100 |
| `run-pass-miri` | 100/100 |

Const eval cannot read vtable memory: the interpreter gives a vtable allocation size 0. So reads through a vtable pointer in a
`const` are errors on both sides, and those errors are byte-identical on both targets. Const eval therefore does not check the
contents, which is why the probe does.

## Not checked against the oracle

- **`softfloat_float_abi`'s two branches, `AbiKind::Win64` and the Arm64EC variadic path.** They are ported from the source and
  have never run: the port has only `aarch64_apple_darwin` and `aarch64_unknown_linux_gnu` among aarch64 specs, and no
  `--target <file>.json`. The first softfloat, Windows or Arm64EC target to be ported needs its own `rustc_abi(debug)` run.
- **`rg` was compared up to mono only**, not through ABI or layout of every call, and not linked. Its dependencies were built
  by the oracle, so **`libc`'s macOS modules and `memchr`'s aarch64 paths have still not gone through the port**, which is what
  review item D13.2's `check-rg-host` is for. `-C incremental` was dropped on both sides (O5). The `-Copt-level=3` run used
  debug-built dependencies; it is not the release profile.
- **The committed fixtures cover less than the manual runs.** UI `rustc_abi` tests and scalable vectors are in no suite. No
  committed fixture covers the host's `vtable_static`, since the collector fixture is x86_64-linux.

## For root

**Stops and ICEs found, none from this lane, none fixed (not my files):**

1. **`rustc_lint/builtin.ts:541` stops on a `pub struct` over 2^53 bytes.** `MissingCopyImplementations` calls
   `l._0.size.bytes()`. Upstream compares a `u64`, so `bytes_u64()` looks right, and the comparison with `MAX_SIZE = 256n`
   already expects a bigint. Reproduce: `pub struct H(pub [u8; 1 << 60]);`. `vtable_static.rs` uses a private type to avoid it.
2. **`mentioned_items for main have not yet been set`** (ICE) from the partitioning driver on
   `tests/ui/consts/do-not-ice-on-field-access-of-err-type.rs`, x86_64-linux and host; the oracle exits 1. Same at the pre-lane
   commit `51d9ada2`, so it is not from this lane, and `main.ts --emit=metadata` reports the error properly. For `mono-wire`.
3. **`TyCtxt::short_string_namespace` stops** (long-type file) on
   `tests/ui/infinite/infinite-instantiation-struct-tail-ice-114484.rs`, both targets. Not vtable or ABI.

**Unit time (review F5, limit 5 s).** Measured at load about 40: the new `aarch64.oracle.test.ts` is 3.05 s of CPU;
`vtable_static` goes from 2.04 s to 3.11 s, so +1.07 s. Together about 4.1 s. The two `vtable-through-const` cases also run
further than their old stop; I did not measure those separately. So the lane is under 5 s by a small margin, not a measured one
on a quiet host.

**A choice to review: two sessions in one process.** `aarch64_oracle/run.ts` calls `compiler_entrypoint` twice, which rustc
never does. Starting a process costs more than the fixture's work, and this took the test from 4.7 s to 3 s. It can only fail
extra, since the oracle's files come from one process per target. Going back to one process per target is a one-line change if
root prefers that over the budget.

**Left in place on purpose.** `EXPECTED_UNPORTED` (collector test) and `STOPS` (partitioning test) are now empty, with their
logic kept for the next stop. `tests/ui` cases that need a harness batch were not touched: `harness-m7a` owns `mono-ui` and
`check-rg-host`. A fresh worktree has no `node_modules`; I symlinked it from the main checkout (gitignored).

## Files

- New: `src/rustc_target/callconv/aarch64.ts`, `aarch64.oracle.test.ts`, `aarch64_oracle/{abi.rs,common.ts,regen.ts,run.ts,oracle/*}`.
- `src/rustc_target/callconv/mod.ts`: the two aarch64 arms and the header.
- `src/rustc_middle/ty/vtable.ts`: the provider.
- `src/rustc_monomorphize/collector_oracle/{run.ts,regen.ts,probe/main.rs,programs/vtable_static.rs,oracle/vtable_static*}`,
  `collector.oracle.test.ts`, `partitioning.oracle.test.ts`, `partitioning_oracle/common.ts`: the pins, the dump, two comments
  this port made stale. Only `vtable_static`'s oracle output changed; regenerating left the other 60 programs' files identical.

## `unported(...)` left

None in these two ports. `callconv/mod.ts` still stops for every other architecture, as before.

## `// PORT:` decisions

- `aarch64.ts`: `size.bits()` compared with 128 or the pointer width is the exact `size.bytes_u64() * 8n` (`bits_u64`, not an
  upstream fn). `Size::bits` stops beyond 2^53, and a by-value aggregate can reach `obj_size_bound`, where upstream takes
  `make_indirect`. The 2^60 array case covers this.
- `vtable.ts`: size and align are `u64` as `bigint`, because a layout can exceed 2^53 and `Scalar::from_uint` takes them;
  `mir::interpret` is reached through `require` for init order, as `ty/layout.ts` already is there.

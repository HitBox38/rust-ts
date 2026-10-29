# Handoff: plan-m5 (design lane, wave 30)

Branch `lane/plan-m5` from main `bbbe6dd3`. No code changed.

## Files touched
- `docs/plan-m5.md` (new): the M5 plan (oracle commands, port status, inventory, suites, D1–D13, waves 31–34, risks).
- `docs/handoff/plan-m5.md` (this file).

## Coverage / samples
No ported code, so coverage is unchanged (22,219 / 25,518 fns) and no sample difftests were run. Before/after numbers
are not applicable; the plan's measurements are in its §1c and §2 (scripts under `$RUST_TS_DATA/tmp/plan-m5/`).

## Headline measurements (plan §1c, §2)
- Oracle, core `--emit=metadata`: 7.6–8.0 s user, ~1 GB, 54.3 MB rmeta, byte-identical across runs; alloc 1.3 s; std
  1.6 s (with oracle-built deps); core `-Zunpretty=mir` 50,239 bodies / 46.8 MB.
- Port on core: `-Zunpretty=expanded` (22.5 MB) and, as a no_main bin, `-Zunpretty=hir-tree` (1.56 GB) are
  **byte-identical** to the oracle. Costs: 46 s user / 5.3 GB (expanded, oracle 1.35 s / 0.6 GB) and 57 s / 6.7 GB
  (hir-tree).
- Port core lib check: exit 70 at `stable_hash_InlineAsmRegOrRegClass` (src/rustc_hir/stable_hash.gen.ts:1494), HIR
  hashing of a lib crate, after ~55 s user / 4.6–5.6 GB.
- Port core as a no_main bin, `--emit=metadata` (full analysis, no encoder): see plan §2 (`check-core-bin` row).

## Decisions for root to record (plan §5)
- D1 M5 command = minimal bootstrap-faithful argv (1b), `--emit=metadata`, default opt; dist flags only as a report.
- D2 alloc/std use an empty `--sysroot` and oracle-built aux crates (compiler_builtins; std's 13 deps); add
  `library/backtrace` (submodule `d902726a`) to the sparse checkout; crates.io deps from library/Cargo.lock.
- D3 `Encodable` via tools/codegen (mirror of Decodable); hand impls by lanes; PORTING §3's Encodable skip ends for
  metadata types (PORTING edit by root).
- D4 Gate = byte-identical rmeta + identical stderr/exit per crate; progress via `rmeta-*` (probe dump) and `mir-*`
  (split MIR) suites; `check-core-bin` gates analysis first.
- D5 M5 keeps `should_codegen() == false` (no optimized_mir encoding, exported symbols, mangling, mono).
- D6 Harness `split` mode + heavy resource class (serial, ~1,800 s subject timeout).
- D7 rust_ts codegen-backend stand-in with LLVM's metadata-level answers; `link` = codegen_ssa `link_binary`;
  `DummyCodegenBackend` ported verbatim.
- D8 Vendor twox-hash 2.1.2, XXH3-128 scalar path; SIMD paths `crate-skip`.
- D9 Close the 13 `unported_stable_hash` codegen gaps first (core's first stop).
- D10 Performance workstream with targets (core check ≤ 15 min user, ≤ 12 GB for M5a) and perf lanes.
- D11 Heavy runs serial with RSS recorded; over-budget RSS is a reported regression.
- D12 Chained checks (oracle alloc against the port's core rmeta) are report-only.
- D13 No new tests/ui suites in M5; existing protected suites must not regress.

## Things root must know
- **Disk**: during this lane the shared volume hit 100% (674 MB free, later 227 MB); an oracle core `-Zunpretty=hir-tree`
  run died with `No space left on device`. `$RUST_TS_DATA/scratch` was 18 GB (not this lane's). It later recovered
  (20 GB free). Core-scale outputs must never be stored raw (1.56 GB per HIR/THIR tree). This lane's scratch is
  ~370 MB under `$RUST_TS_DATA/tmp/plan-m5/` (a library/ copy with backtrace, the build-std target, three core rmetas);
  root may delete it after reading the plan.
- The upstream checkout lacks `library/backtrace` (submodule); this lane fetched it into its own copy only.
- Harness/scripts were not touched. Proposed harness work (split mode, heavy class, binary compare, std aux chain,
  `rmetadump` probe) is in plan §4 and needs reviewed batches.
- `bun scripts/coverage.ts --missing <dir>` crashes with EISDIR (it takes a file); `--crate <name>` gives per-file
  rows. Minor scripts nit.

## unported / PORT
None (no code).

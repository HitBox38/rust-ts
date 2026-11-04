// Oracle check of `collect_crate_mono_items` (lane mono-collector) against the committed output of the pinned rustc
// (collector_oracle/oracle/*.txt, written by collector_oracle/regen.ts; see its header for what each part is).
//
// For each program it runs the test driver collector_oracle/run.ts and compares, against the oracle:
// - the item set: its `MONO_ITEM` lines without the ` @@ cgu[linkage]` part, which needs mono-partition;
// - the collector's order: the items are sorted by `MonoItem::to_stable_hash_key` upstream, and the fingerprints and that
//   order come from the rustc-dev probe collector_oracle/probe/main.rs;
// - stderr and the exit code, which covers the post-monomorphization diagnostics, the mono checks and their order;
// - for -Zprofile-closures, the csv, whose lines appear in the collector's walk order.
//
// The driver needs the oracle toolchain's x86_64-unknown-linux-gnu sysroot for `std`; without rustc it skips visibly
// (RUST_TS_REQUIRE_PROBES=1 makes that a failure).
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import { clean_env, flags_of, HERE, normalize_stderr, parse_oracle, program_files, read_closure_profile, TARGET } from "./collector_oracle/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
const SYSROOT = HAVE ? Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim() : "";
const WORK = join(DATA, "tmp", "mono-collector-test", process.env.RUST_TS_AGENT ?? "default");
const RUNNER = join(HERE, "run.ts");

// Programs the port does not reach the end of yet, with the stop they must report. Nothing else may stop.
const EXPECTED_UNPORTED = new Map<string, string>([
  // `GlobalAlloc::VTable` reaches `tcx.vtable_allocation`, whose provider (rustc_middle ty/vtable.ts, not this lane) stops.
  ["vtable_static", "rustc_middle::mir::interpret::Allocation::new (ty/vtable.rs vtable_allocation_provider, M4)"],
]);

describe.skipIf(SKIP)("collect_crate_mono_items against the oracle", () => {
  for (const { name, path } of program_files()) {
    test(
      name,
      () => {
        const cwd = join(WORK, name);
        rmSync(cwd, { recursive: true, force: true });
        mkdirSync(cwd, { recursive: true });
        const oracle = parse_oracle(readFileSync(join(HERE, "oracle", `${name}.txt`), "utf8"));
        const flags = flags_of(readFileSync(path, "utf8"));
        const r = Bun.spawnSync(
          [process.execPath, RUNNER, "--sysroot", SYSROOT, `--target=${TARGET}`, ...flags, path, "--crate-name", name.replaceAll("-", "_"), "--emit=obj", "-o", join(WORK, `${name}.o`)],
          { cwd, env: clean_env(), stdout: "pipe", stderr: "pipe" },
        );
        const stderr = normalize_stderr(r.stderr.toString(), path);
        const expected_stop = EXPECTED_UNPORTED.get(name);
        if (expected_stop !== undefined) {
          expect(r.exitCode).toBe(70);
          expect(stderr).toContain(expected_stop);
          return;
        }
        expect(stderr).toBe(oracle.stderr);
        expect(r.exitCode).toBe(oracle.code);
        if (oracle.code !== 0) return;

        const lines = r.stdout
          .toString()
          .split("\n")
          .filter((l) => l !== "");
        const items = lines.map((l) => l.slice(33));
        // The oracle sorts its lines with the ` @@ ..` part still on, so the order of what is left is not quite sorted:
        // both sides are sorted again here. The collector's own order is checked against the fingerprints below.
        expect([...items].sort(byte_order)).toEqual([...oracle.items].sort(byte_order));
        // Every item, with its fingerprint, in the collector's order. A CGU holds all of them in these programs, so the
        // probe saw them all; were that to change, the lengths here would say so.
        expect(oracle.fingerprints.length).toBe(oracle.items.length);
        expect(lines).toEqual(oracle.fingerprints);

        // `create_fn_mono_item` call order, the only view of the collector's walk order the oracle has.
        const profile = join(HERE, "oracle", `${name}.closure_profile.csv`);
        if (existsSync(profile)) expect(read_closure_profile(cwd, path)).toBe(readFileSync(profile, "utf8"));
      },
      { timeout: 600_000 },
    );
  }
});

function byte_order(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

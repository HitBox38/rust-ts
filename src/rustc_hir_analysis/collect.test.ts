// Lane collect-a: the `generics_of` / `type_of` providers (collect/generics_of.rs, collect/type_of.rs, collect.rs) on small
// `#![no_core]` crates through the ported driver (collect_test/run.ts), against the tydump probe's `generics_of` / `type_of`
// lines (tools/probes/tydump, run directly with the tydump-nocore argv).
//
// Two checks per crate:
// 1. The report equals collect_test/<crate>.expected.txt. A fact that reaches another lane's stub prints
//    `STOP UNPORTED: <exact unported text>` there: that is the PENDING list (docs/handoff/collect-a.md); when the lane
//    lands, the fact turns into a value, this check fails, and the expected file is regenerated (and check 2 vouches for it).
// 2. With the probe: the same DefId headers, and every computed fact (not `STOP`) equals the probe's line byte for byte.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "collect_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function probe(): string | undefined {
  try {
    const { probePath } = require("../../scripts/probes.ts") as typeof import("../../scripts/probes.ts");
    const p = probePath("tydump");
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

/** `{ header -> { fact name -> line } }` and the header order, from a report or the probe's dump. */
function facts(out: string): { order: string[]; by: Map<string, Map<string, string>> } {
  const order: string[] = [];
  const by = new Map<string, Map<string, string>>();
  let cur: Map<string, string> | undefined;
  for (const line of out.split("\n")) {
    if (line === "" || line.startsWith("== ") || line.startsWith("    ")) continue;
    if (!line.startsWith("  ")) {
      order.push(line);
      cur = new Map();
      by.set(line, cur);
    } else {
      const name = line.slice(2).split(" ")[0]!;
      cur!.set(name, line);
    }
  }
  return { order, by };
}

const CRATES: [string, number][] = [
  // [file, number of computed facts that must match the probe]
  ["generics.rs", 72],
  ["misc.rs", 41],
];

for (const [file, min_matched] of CRATES) {
  test(`collect_test/${file}: generics_of / type_of against the expected report and the tydump probe`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", s, "--edition=2021", file];
    const r = Bun.spawnSync(["bun", join(DIR, "run.ts"), ...args], { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
    const ours = r.stdout.toString();
    const expected_file = join(DIR, file.replace(/\.rs$/, ".expected.txt"));
    expect({ exit: r.exitCode, stdout: ours }).toEqual({ exit: 0, stdout: readFileSync(expected_file, "utf8") });

    const p = probe();
    if (p === undefined) {
      if (REQUIRE) throw new Error("ERROR: tydump probe missing (bun scripts/probes.ts build tydump)");
      return;
    }
    const o = Bun.spawnSync([p, ...args], { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
    const theirs = facts(o.stdout.toString());
    const mine = facts(ours);
    expect(mine.order).toEqual(theirs.order);
    let matched = 0;
    const diffs: string[] = [];
    for (const [header, fs] of mine.by) {
      for (const [name, line] of fs) {
        if (line.startsWith(`  ${name} STOP `)) continue;
        const want = theirs.by.get(header)?.get(name);
        if (want === line) matched++;
        else diffs.push(`${header}\n  ours:  ${line}\n  probe: ${want}`);
      }
    }
    expect(diffs).toEqual([]);
    expect(matched).toBeGreaterThanOrEqual(min_matched);
  }, 120_000);
}

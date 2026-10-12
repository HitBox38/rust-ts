// rust-ts: `UnicodeWidthChar::width`/`width_cjk` for every scalar value against the oracle
// (the `uwidth` probe, unicode-width =0.2.2). Skips if the probe isn't built.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { UNICODE_VERSION, UnicodeWidthChar } from "./lib.ts";

const PROBE = join(DATA, "target", "probes", "release", "uwidth" + (process.platform === "win32" ? ".exe" : ""));

test("width/width_cjk match the oracle for all scalars", () => {
  if (!existsSync(PROBE)) {
    console.log("SKIP: uwidth probe not built (bun scripts/probes.ts build uwidth)");
    return;
  }
  const r = Bun.spawnSync([PROBE], { stdout: "pipe" });
  expect(r.exitCode).toBe(0);
  const data = JSON.parse(r.stdout.toString()) as { unicode_version: string; width: [number, number, number][]; width_cjk: [number, number, number][] };
  expect(`(${UNICODE_VERSION.join(", ")})`).toBe(data.unicode_version);
  for (const [name, f, runs] of [
    ["width", UnicodeWidthChar.width, data.width],
    ["width_cjk", UnicodeWidthChar.width_cjk, data.width_cjk],
  ] as const) {
    let checked = 0;
    const bad: string[] = [];
    for (const [lo, hi, w] of runs) {
      const want = w < 0 ? undefined : w;
      for (let c = lo; c <= hi; c++, checked++) {
        if (f(c) !== want && bad.length < 10) bad.push(`${name}(U+${c.toString(16)}) = ${f(c)}, oracle ${want}`);
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBe(0x110000 - 0x800);
  }
});

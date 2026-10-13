// tools/codegen/target-config.ts: the committed src/rust_ts/target_config.gen.ts is what the generator
// produces from the pinned oracle (rustc_private probe + `rustc --print cfg` for every built-in target).
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../scripts/lib/common.ts";
import { OUT, generate } from "./target-config.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

test.skipIf(SKIP)(
  "target_config.gen.ts is up to date with the oracle",
  async () => {
    if (!HAVE) throw new Error("ERROR: pinned rustc unavailable and RUST_TS_REQUIRE_PROBES=1");
    const text = await generate();
    expect(readFileSync(join(REPO, OUT), "utf8") === text).toBe(true);
  },
  300_000,
);

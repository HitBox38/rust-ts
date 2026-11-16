// deprecated_lints.ts (lane clippy-contract-a) against the pinned deprecated_lints.rs: its `declare_with_version!` statics are
// transcribed by hand (PORT in the file), so every entry, version and the order are checked here against the source.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEPRECATED, DEPRECATED_VERSION, RENAMED, RENAMED_VERSION } from "./deprecated_lints.ts";

test("deprecated_lints statics equal the pinned declare_with_version! invocations", async () => {
  const { UPSTREAM } = await import("../../scripts/lib/common.ts");
  const src = readFileSync(join(UPSTREAM, "src/tools/clippy/clippy_lints/src/deprecated_lints.rs"), "utf8");
  const blocks = new Map<string, [string, [string, string][], string[]]>();
  for (const m of src.matchAll(/declare_with_version! \{ (\w+)\((\w+)\) = \[([\s\S]*?)\n\]\}/g)) {
    const entries: [string, string][] = [];
    const versions: string[] = [];
    for (const e of m[3]!.matchAll(/#\[clippy::version = "([^"\\]*)"\]\s*\("([^"\\]*)", "([^"\\]*)"\),/g)) {
      versions.push(e[1]!);
      entries.push([e[2]!, e[3]!]);
    }
    // every non-blank line of the block is a version attribute or an entry
    expect(m[3]!.split("\n").filter((l) => l.trim() !== "").length).toBe(2 * entries.length);
    blocks.set(m[1]!, [m[2]!, entries, versions]);
  }
  expect([...blocks.keys()]).toEqual(["DEPRECATED", "RENAMED"]);
  expect(blocks.get("DEPRECATED")).toEqual(["DEPRECATED_VERSION", DEPRECATED.map(([a, b]) => [a, b]), [...DEPRECATED_VERSION]]);
  expect(blocks.get("RENAMED")).toEqual(["RENAMED_VERSION", RENAMED.map(([a, b]) => [a, b]), [...RENAMED_VERSION]]);
  expect(DEPRECATED.length).toBe(17);
  expect(RENAMED.length).toBeGreaterThan(50);
});

// Review w456b S3: `CFG_RELEASE` (version.ts) is a second copy of the pin's release; it must follow a
// re-pin. Read from the source text: the const is module-private and only a test needs it.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("CFG_RELEASE equals UPSTREAM.json rust.release", () => {
  const root = join(import.meta.dir, "..", "..", "..");
  const upstream = JSON.parse(readFileSync(join(root, "UPSTREAM.json"), "utf8")) as { rust: { release: string } };
  const m = /^const CFG_RELEASE = "([^"]*)";$/m.exec(readFileSync(join(import.meta.dir, "version.ts"), "utf8"));
  expect(m?.[1]).toBe(upstream.rust.release);
});

// The pure parts of check-rg (scripts/lib/rg-check.ts). What cargo really does is measured by the suite: a unit test must stay cheap (plan-m7 review F5).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argValue, classifyCall, crateSection, mirArgs, stopLine, treeLine, unitKey, unitMetadata, unitRmeta } from "./rg-check.ts";

const TMP = mkdtempSync(join(tmpdir(), "rust-ts-rg-check-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("routing", () => {
  test("cargo's probes go to the side, a compile that links goes to the oracle, the rest are units", () => {
    expect(classifyCall(["-vV"])).toBe("probe");
    expect(classifyCall(["-", "--crate-name", "___", "--print=file-names"])).toBe("probe");
    expect(classifyCall(["--print", "sysroot"])).toBe("probe");
    expect(classifyCall(["--crate-name", "build_script_build", "--emit=dep-info,link", "build.rs"])).toBe("link");
    expect(classifyCall(["--crate-name", "x", "build.rs"])).toBe("link"); // no --emit: rustc's default links
    expect(classifyCall(["--crate-name", "memchr", "--emit=dep-info,metadata", "lib.rs"])).toBe("unit");
  });
  test("argValue, both spellings", () => {
    expect(argValue(["--crate-name", "a"], "--crate-name")).toBe("a");
    expect(argValue(["--crate-name=a"], "--crate-name")).toBe("a");
    expect(argValue(["--crate-namex=a"], "--crate-name")).toBeUndefined();
  });
  test("unitMetadata, both spellings; a compile cargo did not make has none", () => {
    expect(unitMetadata(["-C", "metadata=ab"])).toBe("ab");
    expect(unitMetadata(["-Cmetadata=ab"])).toBe("ab");
    expect(unitMetadata(["--crate-name=anyhow"])).toBe("none");
  });
});

describe("what is compared", () => {
  const cargoUnit = { crate: "memchr", code: 0, args: ["--out-dir", "/t/deps", "-C", "metadata=ab", "-C", "extra-filename=-ab"] };
  test("a build script's probe is its own section, not a crate's", () => {
    expect(unitKey(cargoUnit)).toBe("memchr");
    expect(unitKey({ crate: "anyhow", args: ["--crate-name=anyhow"] })).toBe("anyhow (a build script's probe)");
  });
  test("the rmeta path, as cargo asks for it", () => {
    expect(unitRmeta(cargoUnit)).toBe("/t/deps/libmemchr-ab.rmeta");
    expect(unitRmeta({ crate: "a", args: ["-Cextra-filename=-x", "--out-dir=/d"] })).toBe("/d/liba-x.rmeta");
    expect(unitRmeta({ crate: "a", args: [] })).toBeUndefined();
  });
  test("a section holds exit, bytes and stderr; a failure adds why, and differs", () => {
    const ok = crateSection(cargoUnit, new Uint8Array([1, 2]), new Uint8Array());
    expect(ok[0]).toBe("== memchr");
    expect(ok[1]).toBe("  exit 0");
    expect(ok[2]).toStartWith("  rmeta 2 bytes, sha256 ");
    expect(ok).toHaveLength(4);
    expect(crateSection(cargoUnit, new Uint8Array([1, 3]), new Uint8Array())).not.toEqual(ok);
    const stopped = crateSection({ ...cargoUnit, code: 70 }, undefined, Buffer.from("rust-ts: unported: x\n"));
    expect(stopped).toContain("  rmeta none");
    expect(stopped).toContain("  stop rust-ts: unported: x");
    expect(crateSection(cargoUnit, new Uint8Array(), new Uint8Array(), ["  mir 1 bytes"]).at(-1)).toBe("  mir 1 bytes");
  });
  test("stopLine prefers `unported`, then an error", () => {
    expect(stopLine("a\nerror: b\nunported: c\n")).toBe("unported: c");
    expect(stopLine("a\nerror: b\n")).toBe("error: b");
    expect(stopLine("a\n")).toBe("a");
    expect(stopLine("")).toBe("(no stderr)");
  });
  test("mirArgs: what makes it a cargo compile goes, -Zunpretty=mir is last", () => {
    expect(mirArgs(["--crate-name", "rg", "--error-format=json", "--json=x", "--emit=dep-info,metadata", "-C", "opt"], ["-Copt-level=3"])).toEqual(["--crate-name", "rg", "-C", "opt", "-Copt-level=3", "-Zunpretty=mir"]);
  });
  test("treeLine: a file's path and content count, cargo's lock and cache do not", () => {
    const d = join(TMP, "tree");
    mkdirSync(join(d, "a"), { recursive: true });
    writeFileSync(join(d, "a", "f"), "1");
    const base = treeLine(d);
    expect(base).toStartWith("tree 1 files, sha256 ");
    writeFileSync(join(d, ".cargo-lock"), "x");
    writeFileSync(join(d, ".rustc_info.json"), "x");
    expect(treeLine(d)).toBe(base);
    writeFileSync(join(d, "a", "f"), "2");
    expect(treeLine(d)).not.toBe(base);
    expect(treeLine(join(TMP, "missing"))).toStartWith("tree 0 files");
  });
});

// `Suite.inputDirs`' key text (scripts/lib/input-dirs.ts; review harness-m8a-build-recheck R1): a symbolic link to a directory, or to
// nothing, is keyed by its link text and not followed; everything that keyed before keys the same.
import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inputDirsText } from "./input-dirs.ts";

const TMP = mkdtempSync(join(tmpdir(), "rust-ts-input-dirs-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const sha1 = (b: Uint8Array) => createHash("sha1").update(b).digest("hex");

/** scripts/difftest.ts's walk before R1, verbatim but for the hash: the reference for trees that keyed then. */
function before(cwd: string, dirs: readonly string[]): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(join(cwd, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  for (const d of dirs) walk(d);
  files.sort();
  return files.map((f) => `${f}\0${sha1(readFileSync(join(cwd, f)))}`).join("\n");
}

test("a tree with files and links to files keys exactly as before", () => {
  const root = join(TMP, "plain");
  mkdirSync(join(root, "src", "a", "Z"), { recursive: true });
  mkdirSync(join(root, "reg"), { recursive: true });
  writeFileSync(join(root, "src", "b.rs"), "fn b() {}\n");
  writeFileSync(join(root, "src", "a", "Z", "c.rs"), "fn c() {}\n");
  writeFileSync(join(root, "src", "a", "B.txt"), "upper\n");
  writeFileSync(join(root, "reg", "x"), "x\n");
  symlinkSync("b.rs", join(root, "src", "link-to-file"));
  expect(inputDirsText(root, ["src", "reg"], sha1)).toBe(before(root, ["src", "reg"]));
  // A link to a file is keyed by the file's contents, as before.
  expect(inputDirsText(root, ["src"], sha1)).toContain(`src/link-to-file\0${sha1(Buffer.from("fn b() {}\n"))}`);
});

test("a link to a directory, or to nothing, is keyed by its link text and not followed; the old walk threw on both", () => {
  const root = join(TMP, "links");
  mkdirSync(join(root, "src", "remove-basic.in"), { recursive: true });
  mkdirSync(join(root, "src", "dry_run"), { recursive: true });
  writeFileSync(join(root, "src", "remove-basic.in", "Cargo.toml"), "[package]\n");
  symlinkSync("../remove-basic.in/", join(root, "src", "dry_run", "in"));
  expect(() => before(root, ["src"])).toThrow("EISDIR");
  const text = inputDirsText(root, ["src"], sha1);
  expect(text.split("\n")).toEqual([`src/dry_run/in\0-> ../remove-basic.in/`, `src/remove-basic.in/Cargo.toml\0${sha1(Buffer.from("[package]\n"))}`]);
  // A change behind the link shows once, through the directory itself; a retargeted link shows by its text.
  symlinkSync("missing", join(root, "src", "dangling"));
  expect(() => before(root, ["src"])).toThrow();
  expect(inputDirsText(root, ["src"], sha1).split("\n")[0]).toBe("src/dangling\0-> missing");
  rmSync(join(root, "src", "dry_run", "in"));
  symlinkSync("../other.in/", join(root, "src", "dry_run", "in"));
  expect(inputDirsText(root, ["src"], sha1)).toContain("src/dry_run/in\0-> ../other.in/");
});

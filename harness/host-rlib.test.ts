// The report suite `host-rlib` and its wrapper scripts/host-rlib-run.ts (lane harness-w44, review object-write-macho §7). suites.ts and
// gate.ts load scripts/lib/common.ts, so (as harness/miri-sysroot.test.ts) they are loaded in a child; the wrapper's own run uses a
// stub compiler in a temp `host-rlib/<16 hex>` directory.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { caseDirRefusal, outReport, parseHostRlibRunArgs } from "../scripts/host-rlib-run.ts";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-host-rlib-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

test("the suite: report only, no baseline, out of the gate's default set; its sides run in one fixed directory per case", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { DATA } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const x = s.suite("host-rlib");
const cases = x.cases();
const at = (id) => cases.find((c) => c.id === id);
const o = x.oracle([at("extern")]), sub = x.subject([at("extern")]);
const dirOf = (cmd) => cmd[cmd.indexOf("--dir") + 1];
console.log(JSON.stringify({
  mode: x.mode, heavy: Boolean(x.heavy), n: cases.length,
  ids: cases.slice(0, 9).map((c) => c.id),
  ui: cases.slice(9).every((c) => c.file.startsWith("tests/ui/") && c.id === c.file),
  sameDir: dirOf(o) === dirOf(sub) && dirOf(o).startsWith(DATA + "/host-rlib/"),
  dirsDistinct: new Set(cases.map((c) => dirOf(x.oracle([c])))).size === cases.length,
  lock: x.caseLock(at("extern")) === dirOf(o) + ".case.lock",
  runs: g.oracleRuns(o), undeclared: g.undeclaredRuns(x),
  deploy: cases.filter((c) => c.env && "MACOSX_DEPLOYMENT_TARGET" in c.env).map((c) => c.env.MACOSX_DEPLOYMENT_TARGET),
  srcs: o.filter((a, i) => o[i - 1] === "--src").map((p) => p.slice(p.lastIndexOf("/") + 1)),
  steps: o.filter((a) => a === "--then").length,
  key: x.oracleKey() === x.oracleKey() && /^[0-9a-f]+$/.test(x.oracleKey()),
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(j).toEqual({
    mode: "single",
    heavy: false,
    n: 222,
    ids: ["nocore", "nocore@x86_64-apple-darwin", "nocore@MACOSX_DEPLOYMENT_TARGET=13.2", "nocore@MACOSX_DEPLOYMENT_TARGET=15.1.3", "nocore@MACOSX_DEPLOYMENT_TARGET=10.9", "nocore@MACOSX_DEPLOYMENT_TARGET=abc", "std", "extern", "rlib+staticlib"],
    ui: true,
    sameDir: true,
    dirsDistinct: true,
    lock: true,
    runs: ["rustc"],
    undeclared: [],
    deploy: ["13.2", "15.1.3", "10.9", "abc"],
    srcs: ["dep.rs", "user.rs"],
    steps: 1,
    key: true,
  });
  expect(existsSync(join(REPO, "harness", "baseline", "host-rlib.txt"))).toBe(false);
}, 60_000);

test("the wrapper's command line", () => {
  const a = parseHostRlibRunArgs(["--dir", "/d/host-rlib/0123456789abcdef", "--side", "subject", "--src", "/s/a.rs", "--compiler", "2", "--", "bun", "main.ts", "-x", "a.rs", "--then", "b.rs"]);
  expect(a).toEqual({ dir: "/d/host-rlib/0123456789abcdef", side: "subject", srcs: ["/s/a.rs"], compiler: ["bun", "main.ts"], steps: [["-x", "a.rs"], ["b.rs"]] });
  const bad = (argv: string[]) => {
    try {
      parseHostRlibRunArgs(argv);
      return "parsed";
    } catch (e) {
      return (e as Error).message;
    }
  };
  expect(bad(["--dir", "/d", "--side", "x", "--compiler", "1", "--", "rustc", "a.rs"])).toBe("host-rlib-run: --side must be oracle or subject, not x");
  expect(bad(["--dir", "/d", "--side", "oracle", "--compiler", "2", "--", "rustc"])).toBe("host-rlib-run: the compiler command is shorter than --compiler");
  expect(parseHostRlibRunArgs(["--dir", "/d", "--side", "oracle", "--compiler", "1", "--", "rustc"]).steps).toEqual([]);
  expect(bad(["--dir", "/d", "--side", "oracle", "--compiler", "1", "--", "rustc", "a.rs", "--then"])).toBe("host-rlib-run: an empty step");
  expect(bad(["--dir", "/d", "--side", "oracle", "--", "rustc", "a.rs"])).toBe("host-rlib-run: --dir, --side and --compiler are required");
});

test("the directory it empties must be an absolute <...>/host-rlib/<16 hex>", () => {
  expect(caseDirRefusal("/data/host-rlib/0123456789abcdef")).toBeUndefined();
  for (const d of ["", "/", "relative/host-rlib/0123456789abcdef", "/data/host-rlib", "/data/host-rlib/", "/data/other/0123456789abcdef", "/data/host-rlib/0123456789ABCDEF", "/data/host-rlib/../host-rlib/0123456789abcdef", "/data/host-rlib/0123456789abcdef/.."]) {
    expect(caseDirRefusal(d)).toContain("--dir must be an absolute");
  }
});

test("a run: each step in the fixed work dir, the report, and the out dir kept per side", async () => {
  const dir = join(TMP, "host-rlib", "0123456789abcdef");
  mkdirSync(join(dir, "work"), { recursive: true });
  writeFileSync(join(dir, "work", "stale"), "from the last run");
  const src = join(TMP, "a.rs");
  writeFileSync(src, "pub fn f() {}\n");
  // The stub writes what a compiler would, naming its cwd in the dep-info; with `fail` it exits 1.
  const stub = join(TMP, "stub.ts");
  writeFileSync(
    stub,
    `import { readdirSync, writeFileSync } from "node:fs";
const a = process.argv.slice(2);
if (a.includes("fail")) { console.error("error: no"); process.exit(1); }
const name = a.at(-1).replace(/\\.rs$/, "");
console.log("files: " + readdirSync(".").sort().join(" "));
writeFileSync("out/lib" + name + ".rlib", "rlib " + name);
writeFileSync("out/" + name + ".d", process.cwd() + "/out/lib" + name + ".rlib: " + name + ".rs\\n");
`,
  );
  const run = (side: string, steps: string[]) => Bun.spawnSync([process.execPath, join(REPO, "scripts/host-rlib-run.ts"), "--dir", dir, "--side", side, "--src", src, "--compiler", "2", "--", process.execPath, stub, ...steps], { stdout: "pipe", stderr: "pipe" });
  const r = run("oracle", ["a.rs", "--then", "b.rs"]);
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const sha = (t: string) => new Bun.CryptoHasher("sha256").update(t).digest("hex");
  expect(r.stdout.toString()).toBe(
    ["files: a.rs out", "files: a.rs out", "a.d:", "$DIR/out/liba.rlib: a.rs", "b.d:", "$DIR/out/libb.rlib: b.rs", `liba.rlib: 6 bytes, sha256 ${sha("rlib a")}`, `libb.rlib: 6 bytes, sha256 ${sha("rlib b")}`, ""].join("\n"),
  );
  expect(readdirSync(dir).sort()).toEqual(["oracle.out", "work"]);
  expect(readdirSync(join(dir, "oracle.out")).sort()).toEqual(["a.d", "b.d", "liba.rlib", "libb.rlib"]);
  // A failing step: its exit code, nothing reported, and the kept out dir of the other side untouched.
  const f = run("subject", ["a.rs", "--then", "fail"]);
  expect([f.exitCode, f.stdout.toString(), f.stderr.toString()]).toEqual([1, "files: a.rs out\n", "error: no\n"]);
  expect(readdirSync(dir).sort()).toEqual(["oracle.out", "work"]);
  // A directory outside a host-rlib/<16 hex> is refused before anything is removed.
  const other = join(TMP, "other");
  mkdirSync(join(other, "work"), { recursive: true });
  const bad = Bun.spawnSync([process.execPath, join(REPO, "scripts/host-rlib-run.ts"), "--dir", other, "--side", "oracle", "--compiler", "1", "--", "true", "x"], { stdout: "pipe", stderr: "pipe" });
  expect(bad.exitCode).toBe(2);
  expect(existsSync(join(other, "work"))).toBe(true);
  // No step: refused too (the parser takes it only for the gate's reading of the command).
  const none = Bun.spawnSync([process.execPath, join(REPO, "scripts/host-rlib-run.ts"), "--dir", dir, "--side", "oracle", "--compiler", "1", "--", "true"], { stdout: "pipe", stderr: "pipe" });
  expect([none.exitCode, none.stderr.toString()]).toEqual([2, "host-rlib-run: no step after the compiler command\n"]);
  expect(outReport(join(TMP, "other", "work"), "/w")).toBe("out: none\n");
  // The kept file is the compiler's, unmasked (the stub names its cwd, the real path of `work`).
  expect(readFileSync(join(dir, "oracle.out", "a.d"), "utf8")).toBe(`${realpathSync(dir)}/work/out/liba.rlib: a.rs\n`);
}, 30_000);

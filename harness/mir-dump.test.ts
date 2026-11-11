// The suite `mir-opt-o4`'s wrapper scripts/mir-dump-run.ts (lane harness-w50). suites.ts and gate.ts load
// scripts/lib/common.ts, so (as harness/host-rlib.test.ts) they are loaded in a child; the wrapper's own run uses a stub compiler in a
// temp `mir-opt-o4/<side>/<16 hex>` directory.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dumpDirRefusal, dumpReport, parseMirDumpRunArgs } from "../scripts/mir-dump-run.ts";

const REPO = resolve(import.meta.dir, "..");
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "rust-ts-mir-dump-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

test("the suite: mir-opt-o4's sides run through the wrapper, each side in its own dump dir, under a case lock", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { DATA, PIN } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const { mirOptCases } = await import(${JSON.stringify(join(REPO, "harness/compiletest.ts"))});
const x = s.suite("mir-opt-o4");
const cases = x.cases();
const c = cases.find((c) => c.id === "tests/mir-opt/dump_dataflow.rs");
const o = x.oracle([c]), sub = x.subject([c]);
const dirOf = (cmd) => cmd[cmd.indexOf("--dir") + 1];
const tail = (cmd) => cmd.slice(cmd.indexOf("--") + 1);
console.log(JSON.stringify({
  mode: x.mode,
  n: cases.length,
  // The case's argv is mirOptCases' as before; the wrapper adds the dump dir itself.
  args: JSON.stringify(c.args) === JSON.stringify(mirOptCases().cases.find((m) => m.id === c.id).args),
  oracleCmd: JSON.stringify(tail(o)) === JSON.stringify(["rustc", "+" + PIN.toolchain, ...c.args]),
  subjectCmd: tail(sub).slice(-c.args.length).join(" ") === c.args.join(" ") && tail(sub).some((a) => a.endsWith("src/rust_ts/main.ts")),
  head: [o[0] === process.execPath, o[1].endsWith("scripts/mir-dump-run.ts"), sub[1] === o[1]],
  dirs: [dirOf(o).slice(DATA.length), dirOf(sub).slice(DATA.length)].map((d) => d.replace(/[0-9a-f]{16}$/, "<hash>")),
  abs: [dirOf(o), dirOf(sub)],
  dirsDistinct: new Set(cases.map((c) => dirOf(x.oracle([c])))).size === cases.length,
  lock: x.caseLock(c).slice(DATA.length).replace(/[0-9a-f]{16}/, "<hash>"),
  runs: g.oracleRuns(o), undeclared: g.undeclaredRuns(x),
  key: x.oracleKey() === x.oracleKey() && /^[0-9a-f]+$/.test(x.oracleKey()),
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const { abs, ...j } = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  // The wrapper accepts the suite's dirs.
  expect((abs as string[]).map(dumpDirRefusal)).toEqual([undefined, undefined]);
  expect(j).toEqual({
    mode: "single",
    n: 406,
    args: true,
    oracleCmd: true,
    subjectCmd: true,
    head: [true, true, true],
    dirs: ["/tmp/mir-opt-o4/oracle/<hash>", "/tmp/mir-opt-o4/subject/<hash>"],
    dirsDistinct: true,
    lock: "/tmp/mir-opt-o4/<hash>.case.lock",
    runs: ["rustc"],
    undeclared: [],
    key: true,
  });
}, 60_000);

test("the wrapper's command line", () => {
  expect(parseMirDumpRunArgs(["--dir", "/d", "--", "rustc", "+x", "a.rs"])).toEqual({ dir: "/d", compiler: ["rustc", "+x", "a.rs"] });
  const bad = (argv: string[]) => {
    try {
      parseMirDumpRunArgs(argv);
      return "parsed";
    } catch (e) {
      return (e as Error).message;
    }
  };
  expect(bad(["--", "rustc"])).toBe("mir-dump-run: --dir is required");
  expect(bad(["--dir", "/d"])).toBe("mir-dump-run: missing `--` and the compiler command");
  expect(bad(["--dir", "/d", "--"])).toBe("mir-dump-run: missing `--` and the compiler command");
  expect(bad(["--dir"])).toBe("mir-dump-run: --dir needs a value");
  expect(bad(["--dir", "/d", "--dir", "/e", "--", "rustc"])).toBe("mir-dump-run: --dir given twice");
  expect(bad(["--side", "oracle", "--dir", "/d", "--", "rustc"])).toBe("mir-dump-run: unknown option --side");
});

test("the directory it empties must be an absolute <...>/mir-opt-o4/oracle|subject/<16 hex>", () => {
  for (const d of ["/data/tmp/mir-opt-o4/oracle/0123456789abcdef", "/data/tmp/mir-opt-o4/subject/0123456789abcdef"]) expect(dumpDirRefusal(d)).toBeUndefined();
  for (const d of [
    "",
    "/",
    "relative/mir-opt-o4/oracle/0123456789abcdef",
    "/data/mir-opt-o4/oracle",
    "/data/mir-opt-o4/other/0123456789abcdef",
    "/data/mir-opt-o5/oracle/0123456789abcdef",
    "/data/mir-opt-o4-dumps/oracle/0123456789abcdef",
    "/data/mir-opt-o4/oracle/0123456789ABCDEF",
    "/data/mir-opt-o4/oracle/0123456789abcdef/..",
    "/data/mir-opt-o4/oracle/../oracle/0123456789abcdef",
  ]) {
    expect(dumpDirRefusal(d)).toContain("--dir must be an absolute");
  }
});

test("the report: every file sorted by path, its text with the dump dir masked, a size, and UTF-8 or a sha256", () => {
  const d = join(TMP, "report", "mir-opt-o4", "oracle", "0123456789abcdef");
  expect(dumpReport(d)).toBe(""); // no directory
  mkdirSync(join(d, "sub", "empty"), { recursive: true });
  expect(dumpReport(d)).toBe(""); // directories only
  writeFileSync(join(d, "b.mir"), `// MIR at ${d}/b.mir\nfn b() {}\n`);
  writeFileSync(join(d, "a.dot"), "digraph {}"); // no final newline
  writeFileSync(join(d, "sub", "c.mir"), "");
  writeFileSync(join(d, "Z.bin"), Buffer.from([0xff, 0xfe, 0x00]));
  symlinkSync(join(d, "a.dot"), join(d, "sub", "link"));
  const sha = new Bun.CryptoHasher("sha256").update(Buffer.from([0xff, 0xfe, 0x00])).digest("hex");
  const text = `// MIR at ${d}/b.mir\nfn b() {}\n`;
  expect(dumpReport(d)).toBe(
    [
      "-Zdump-mir-dir: 5 file(s)",
      `--- Z.bin (3 bytes, not UTF-8): sha256 ${sha}`,
      "--- a.dot (10 bytes)",
      "digraph {}",
      `--- b.mir (${Buffer.byteLength(text)} bytes)`,
      "// MIR at $DUMP_DIR/b.mir",
      "fn b() {}",
      "--- sub/c.mir (0 bytes)",
      "--- sub/link: not a regular file",
      "",
    ].join("\n"),
  );
});

test("a run: the dump dir emptied, the compiler's output and exit passed through, then the tree; nothing when it wrote none", () => {
  const dir = join(TMP, "run", "mir-opt-o4", "subject", "0123456789abcdef");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stale.mir"), "from the last run");
  // The stub writes into the dir its last argument names (as rustc's -Zdump-mir-dir=), unless `none`; with `fail` it exits 3 after writing.
  const stub = join(TMP, "stub.ts");
  writeFileSync(
    stub,
    `import { mkdirSync, writeFileSync } from "node:fs";
const a = process.argv.slice(2);
const dir = a.at(-1).slice("-Zdump-mir-dir=".length);
console.log("args: " + a.slice(0, -1).join(" "));
console.error("note: stderr");
if (!a.includes("none")) { mkdirSync(dir, { recursive: true }); writeFileSync(dir + "/x.main.mir", "fn main() {}\\n"); }
process.exit(a.includes("fail") ? 3 : 0);
`,
  );
  const run = (...args: string[]) => Bun.spawnSync([process.execPath, join(REPO, "scripts/mir-dump-run.ts"), "--dir", dir, "--", process.execPath, stub, ...args], { stdout: "pipe", stderr: "pipe" });
  const r = run("-Zdump-mir=main");
  expect([r.exitCode, r.stdout.toString(), r.stderr.toString()]).toEqual([0, "args: -Zdump-mir=main\n-Zdump-mir-dir: 1 file(s)\n--- x.main.mir (13 bytes)\nfn main() {}\n", "note: stderr\n"]);
  expect(readdirSync(dir)).toEqual(["x.main.mir"]); // the stale file is gone, the tree kept
  const f = run("fail");
  expect([f.exitCode, f.stdout.toString()]).toEqual([3, "args: fail\n-Zdump-mir-dir: 1 file(s)\n--- x.main.mir (13 bytes)\nfn main() {}\n"]);
  const n = run("none");
  expect([n.exitCode, n.stdout.toString()]).toEqual([0, "args: none\n"]);
  expect(existsSync(dir)).toBe(false);
  // A directory outside the pattern is refused before anything runs or is removed.
  const other = join(TMP, "other");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "keep"), "");
  const bad = Bun.spawnSync([process.execPath, join(REPO, "scripts/mir-dump-run.ts"), "--dir", other, "--", process.execPath, stub], { stdout: "pipe", stderr: "pipe" });
  expect([bad.exitCode, bad.stdout.toString()]).toEqual([2, ""]);
  expect(existsSync(join(other, "keep"))).toBe(true);
}, 30_000);

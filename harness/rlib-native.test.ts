// The report suite `rlib-native` and its wrapper scripts/rlib-native-run.ts (lane harness-w46, review link-rlib-native §6). suites.ts
// and gate.ts load scripts/lib/common.ts, so (as harness/host-rlib.test.ts) they are loaded in a child; the wrapper's own run uses a
// stub compiler in a temp `rlib-native/<16 hex>` directory. The member listing is checked on the checked-in archives.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { arMembers, parseRlibNativeRunArgs, rlibNativeDirRefusal, tmpReport } from "../scripts/rlib-native-run.ts";

const REPO = resolve(import.meta.dir, "..");
const LIBS = join(REPO, "harness", "corpus", "rlib-native", "libs");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-rlib-native-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const sha = (b: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(b).digest("hex");

test("the suite: report only, no baseline, out of the gate's default set; one fixed directory per case; its sources and libraries checked in", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { DATA } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const { oracleSysroot } = await import(${JSON.stringify(join(REPO, "scripts/lib/oracle.ts"))});
const x = s.suite("rlib-native");
const cases = x.cases();
const at = (id) => cases.find((c) => c.id === id);
const ext = at("-L host nc_link.rs --then --extern nc_link=out/libnc_link.rlib nc_user.rs");
const o = x.oracle([ext]), sub = x.subject([ext]);
const dirOf = (cmd) => cmd[cmd.indexOf("--dir") + 1];
const after = (cmd, flag) => cmd.filter((a, i) => cmd[i - 1] === flag);
const std = at("std: -L host std_link.rs");
console.log(JSON.stringify({
  mode: x.mode, heavy: Boolean(x.heavy), n: cases.length, ids: new Set(cases.map((c) => c.id)).size,
  sameDir: dirOf(o) === dirOf(sub) && dirOf(o).startsWith(DATA + "/rlib-native/"),
  dirsDistinct: new Set(cases.map((c) => dirOf(x.oracle([c])))).size === cases.length,
  lock: x.caseLock(ext) === dirOf(o) + ".case.lock",
  runs: g.oracleRuns(o), undeclared: g.undeclaredRuns(x),
  tree: after(o, "--tree"),
  srcs: after(o, "--src").map((p) => p.slice(p.lastIndexOf("/") + 1)),
  steps: o.filter((a) => a === "--then").length,
  // Sources are named by base name (the rmeta embeds the path as given), never as absolute paths.
  relative: cases.every((c) => c.args.filter((a) => a.endsWith(".rs")).every((a) => !a.includes("/"))),
  sysroot: cases.filter((c) => c.args.includes("--sysroot")).map((c) => c.id),
  stdSysroot: after(std.args, "--sysroot")[0] === oracleSysroot(),
  envs: [...new Set(cases.map((c) => JSON.stringify(c.env)))],
  key: x.oracleKey() === x.oracleKey() && /^[0-9a-f]+$/.test(x.oracleKey()),
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(j).toEqual({
    mode: "single",
    heavy: false,
    n: 58,
    ids: 58,
    sameDir: true,
    dirsDistinct: true,
    lock: true,
    runs: ["rustc"],
    undeclared: [],
    tree: [LIBS],
    srcs: ["nc_link.rs", "nc_user.rs"],
    steps: 1,
    relative: true,
    sysroot: ["std: -L host std_link.rs"],
    stdSysroot: true,
    envs: [JSON.stringify({ RUSTC_ICE: "0", RUST_BACKTRACE: "0" })],
    key: true,
  });
  expect(existsSync(join(REPO, "harness", "baseline", "rlib-native.txt"))).toBe(false);
}, 60_000);

test("the wrapper's command line: --tree, then scripts/host-rlib-run.ts's", () => {
  const a = parseRlibNativeRunArgs(["--dir", "/d/rlib-native/0123456789abcdef", "--side", "subject", "--tree", "/libs", "--src", "/s/a.rs", "--compiler", "2", "--", "bun", "main.ts", "-x", "a.rs", "--then", "b.rs"]);
  expect(a).toEqual({ tree: "/libs", dir: "/d/rlib-native/0123456789abcdef", side: "subject", srcs: ["/s/a.rs"], compiler: ["bun", "main.ts"], steps: [["-x", "a.rs"], ["b.rs"]] });
  const bad = (argv: string[]) => {
    try {
      parseRlibNativeRunArgs(argv);
      return "parsed";
    } catch (e) {
      return (e as Error).message;
    }
  };
  expect(bad(["--dir", "/d", "--side", "oracle", "--compiler", "1", "--", "rustc", "a.rs"])).toBe("rlib-native-run: --tree is required");
  // A `--tree` of the compiler's arguments is not the wrapper's.
  expect(bad(["--dir", "/d", "--side", "oracle", "--compiler", "1", "--", "rustc", "--tree", "x"])).toBe("rlib-native-run: --tree is required");
  expect(bad(["--dir", "/d", "--side", "oracle", "--compiler", "1", "--tree"])).toBe("rlib-native-run: --tree needs a value");
  expect(bad(["--dir", "/d", "--side", "x", "--tree", "/t", "--compiler", "1", "--", "rustc", "a.rs"])).toBe("rlib-native-run: --side must be oracle or subject, not x");
  expect(parseRlibNativeRunArgs(["--dir", "/d", "--side", "oracle", "--tree", "/t", "--compiler", "1", "--", "rustc"]).steps).toEqual([]);
});

test("the directory it empties must be an absolute <...>/rlib-native/<16 hex>", () => {
  expect(rlibNativeDirRefusal("/data/rlib-native/0123456789abcdef")).toBeUndefined();
  for (const d of ["", "/", "relative/rlib-native/0123456789abcdef", "/data/rlib-native", "/data/host-rlib/0123456789abcdef", "/data/rlib-native/0123456789ABCDEF", "/data/rlib-native/../rlib-native/0123456789abcdef", "/data/rlib-native/0123456789abcdef/.."]) {
    expect(rlibNativeDirRefusal(d)).toContain("--dir must be an absolute");
  }
});

test("archive members: BSD `#1/` names, GNU short names and the `//` table, in order, with their data", () => {
  const names = (p: string) => arMembers(readFileSync(join(LIBS, p))).map((m) => m.name);
  expect(names("host/liblong.a")).toEqual(["__.SYMDEF SORTED", "foo.o", "long_member_name_over_16.o"]);
  expect(names("elf/liblong.a")).toEqual(["/", "//", "foo.o", "long_member_name_over_16.o"]);
  expect(names("elf/libbsd.a")).toEqual(["__.SYMDEF", "foo.o", "bar.o"]);
  // The data is the member's, its BSD name left out: the object file's own magic, and the size `ar` stored less the name.
  const foo = arMembers(readFileSync(join(LIBS, "host/libfoo.a"))).find((m) => m.name === "foo.o")!;
  expect(foo.size).toBe(readFileSync(join(LIBS, "host/foo.o")).length);
  expect(sha(foo.data)).toBe(sha(readFileSync(join(LIBS, "host/foo.o"))));
  const bad = (b: Uint8Array) => {
    try {
      arMembers(b);
      return "parsed";
    } catch (e) {
      return (e as Error).message;
    }
  };
  expect(bad(readFileSync(join(LIBS, "host/libbad.a")))).toBe("not an ar archive");
  expect(bad(readFileSync(join(LIBS, "host/libfoo.a")).subarray(0, 100))).toMatch(/^a (truncated|bad) member header at 8$/);
  expect(arMembers(new TextEncoder().encode("!<arch>\n"))).toEqual([]);
});

test("the temp directory's report masks tempfile's random characters only", () => {
  const t = join(TMP, "tmp-report");
  expect(tmpReport(t)).toBe("tmp: none\n");
  mkdirSync(t);
  expect(tmpReport(t)).toBe("tmp: none\n");
  writeFileSync(join(t, ".tmpZ9aBc0libfat.a"), "xyz");
  writeFileSync(join(t, ".tmpshort"), "1");
  expect(tmpReport(t)).toBe("tmp: .tmpXXXXXXlibfat.a: 3 bytes\ntmp: .tmpshort: 1 bytes\n");
});

test("a run: the tree and sources in the fixed work dir, TMPDIR the case's own, the report after a failed step too", async () => {
  const dir = join(TMP, "rlib-native", "0123456789abcdef");
  mkdirSync(join(dir, "work"), { recursive: true });
  mkdirSync(join(dir, "tmp"), { recursive: true });
  writeFileSync(join(dir, "work", "stale"), "from the last run");
  writeFileSync(join(dir, "tmp", "stale"), "from the last run");
  const tree = join(TMP, "tree");
  mkdirSync(join(tree, "host"), { recursive: true });
  writeFileSync(join(tree, "host", "libfoo.a"), readFileSync(join(LIBS, "host/libfoo.a")));
  const src = join(TMP, "a.rs");
  writeFileSync(src, "pub fn f() {}\n");
  // The stub writes an rlib (a copy of libfoo.a) and a temp file, and prints where it ran; with `fail` it exits 3.
  const stub = join(TMP, "stub.ts");
  writeFileSync(
    stub,
    `import { copyFileSync, readdirSync, writeFileSync } from "node:fs";
const a = process.argv.slice(2);
console.log("tmp is " + (process.env.TMPDIR === ${JSON.stringify(join(dir, "tmp"))}) + "; files: " + readdirSync(".").sort().join(" "));
if (a.includes("fail")) { console.error("error: no"); process.exit(3); }
copyFileSync("host/libfoo.a", "out/liba.rlib");
writeFileSync(process.env.TMPDIR + "/.tmpQ1w2E3libfat.a", "slice");
`,
  );
  const run = (side: string, steps: string[]) =>
    Bun.spawnSync([process.execPath, join(REPO, "scripts/rlib-native-run.ts"), "--dir", dir, "--side", side, "--tree", tree, "--src", src, "--compiler", "2", "--", process.execPath, stub, ...steps], { stdout: "pipe", stderr: "pipe" });
  const lib = readFileSync(join(LIBS, "host/libfoo.a"));
  const members = arMembers(lib).map((m) => `  ${m.name}: ${m.size} bytes, sha256 ${sha(m.data)}`);
  const r = run("oracle", ["a.rs"]);
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  expect(r.stdout.toString()).toBe(["tmp is true; files: a.rs host out", `liba.rlib: ${lib.length} bytes, sha256 ${sha(lib)}`, "liba.rlib members:", ...members, "tmp: .tmpXXXXXXlibfat.a: 5 bytes", ""].join("\n"));
  expect(readdirSync(dir).sort()).toEqual(["oracle.out", "tmp", "work"]);
  // A failing step: its exit code, and the report still printed (an error still writes the rmeta); the temp dir emptied first.
  const f = run("subject", ["a.rs", "--then", "fail"]);
  expect(f.exitCode).toBe(3);
  expect(f.stderr.toString()).toBe("error: no\n");
  expect(f.stdout.toString()).toContain("tmp is true; files: a.rs host out\ntmp is true; files: a.rs host out\n");
  expect(f.stdout.toString()).toEndWith("tmp: .tmpXXXXXXlibfat.a: 5 bytes\n");
  expect(readdirSync(join(dir, "tmp"))).toEqual([".tmpQ1w2E3libfat.a"]);
  expect(readdirSync(dir).sort()).toEqual(["oracle.out", "subject.out", "tmp", "work"]);
  // A directory outside rlib-native/<16 hex> is refused before anything is removed.
  const other = join(TMP, "other");
  mkdirSync(join(other, "work"), { recursive: true });
  const bad = Bun.spawnSync([process.execPath, join(REPO, "scripts/rlib-native-run.ts"), "--dir", other, "--side", "oracle", "--tree", tree, "--compiler", "1", "--", "true", "x"], { stdout: "pipe", stderr: "pipe" });
  expect(bad.exitCode).toBe(2);
  expect(existsSync(join(other, "work"))).toBe(true);
}, 30_000);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** Polls `f` until it holds; an assertion fails after `ms`, never sooner. */
const until = async (f: () => boolean, ms = 30_000) => {
  const end = performance.now() + ms;
  while (!f() && performance.now() < end) await Bun.sleep(10);
  expect(f()).toBe(true);
};

// As scripts/ir-normal.test.ts's test of ir-run (review harness-w42 N1).
test("a SIGKILLed run whose compiler lives on keeps the work lock until the compiler ends, so the next run does not empty `work` under it (review harness-w46 N3)", async () => {
  const dir = join(TMP, "rlib-native", "fedcba9876543210");
  const pid = join(TMP, "orphan-pid");
  const go = join(TMP, "orphan-go");
  const tree = join(TMP, "orphan-tree");
  mkdirSync(tree, { recursive: true });
  // The orphan writes into `out` only once `go` exists, which the test creates after it has seen the next run still blocked: a next
  // run that does not wait empties `work`, runs its compiler and ends before `go`, which fails the test.
  const orphan = ["/bin/sh", "-c", `echo $$ > ${pid}; while [ ! -e ${go} ]; do sleep 0.05; done; echo orphan > out/orphan.rlib`, "sh"];
  const wrapper = (side: string, compiler: string[]) => [process.execPath, join(REPO, "scripts/rlib-native-run.ts"), "--dir", dir, "--side", side, "--tree", tree, "--compiler", String(compiler.length), "--", ...compiler, "x"];
  const first = Bun.spawn(wrapper("oracle", orphan), { stdout: "pipe", stderr: "pipe" });
  let orphanPid = 0;
  try {
    await until(() => existsSync(pid) && readFileSync(pid, "utf8").endsWith("\n"));
    orphanPid = Number(readFileSync(pid, "utf8"));
    // The run names its compiler in the lock as soon as it has started it (a run that never does fails here).
    await until(() => existsSync(join(dir, "work.lock")) && readFileSync(join(dir, "work.lock"), "utf8").includes(`\n${orphanPid}\n`));
    first.kill("SIGKILL");
    await first.exited;
    expect(alive(orphanPid)).toBe(true);
    const next = Bun.spawn(wrapper("subject", ["/bin/sh", "-c", "true", "sh"]), { stdout: "pipe", stderr: "pipe" });
    let nextDone = false;
    void next.exited.then(() => (nextDone = true));
    await Bun.sleep(1000);
    expect(nextDone).toBe(false);
    writeFileSync(go, "");
    const code = await next.exited;
    expect([code, await new Response(next.stdout).text(), await new Response(next.stderr).text()]).toEqual([0, "out: none\ntmp: none\n", ""]);
    expect(alive(orphanPid)).toBe(false);
    // The orphan's file was emptied with `work` before the next run's compiler ran; the lock is gone.
    expect(readdirSync(dir).sort()).toEqual(["subject.out", "tmp", "work"]);
  } finally {
    writeFileSync(go, "");
    if (orphanPid && alive(orphanPid)) process.kill(orphanPid, "SIGKILL");
  }
}, 90_000);

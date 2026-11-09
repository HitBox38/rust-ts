// The `miri-sysroot-*` report suites' definitions (plan-m6 D4; lane harness-m6d), in a child process for the parts that load
// scripts/lib/common.ts (see scripts/lib/deps.test.ts). No crate is compiled here: the results are in docs/handoff/miri-sysroot.md.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-miri-sysroot-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const CORPUS = JSON.parse(readFileSync(join(REPO, "harness/corpus/miri-sysroot/crates.json"), "utf8")) as Record<
  string,
  { cwd: string; args: string[]; env: Record<string, string>; sources?: Record<string, string> }
>;

test("the corpus: all 27 crates, cargo-miri's flags, nothing tied to the setup run but OUT_DIR", () => {
  expect(Object.keys(CORPUS).length).toBe(27);
  for (const [name, c] of Object.entries(CORPUS)) {
    expect(c.args[c.args.indexOf("--crate-name") + 1]).toBe(name);
    expect(c.args.filter((a) => a === "$OUT").length).toBe(1);
    expect(c.args).toContain("--emit=dep-info,metadata,link");
    expect(c.args).toContain("embed-metadata=no");
    expect(c.args[c.args.indexOf("--target") + 1]).toBe("x86_64-unknown-linux-gnu");
    expect(JSON.stringify(c.args)).not.toContain("/var/folders");
    expect(c.cwd).toBe(c.env.CARGO_MANIFEST_DIR!);
    expect(JSON.stringify({ ...c.env, OUT_DIR: undefined })).not.toContain("rustc-build-sysroot-");
    if (name === "custom_local_sysroot") continue;
    expect(c.cwd.startsWith("$TC/") || c.cwd.startsWith("$CARGO_HOME/")).toBe(true);
    expect(c.sources).toBeUndefined();
  }
  // rustc-build-sysroot's own crate (review miri-sysroot F1): built in its temp directory, `$BUILD`, from an empty `lib.rs`.
  const local = CORPUS.custom_local_sysroot!;
  expect(local.cwd).toBe("$BUILD");
  expect(local.env.CARGO_MANIFEST_PATH).toBe("$BUILD/Cargo.toml");
  expect(local.sources).toEqual({ "lib.rs": "" });
  expect(local.args).toContain("lib.rs");
  expect(local.args.filter((a) => a.includes("$BUILD"))).toEqual([]);
  expect(local.args.filter((a) => /^(std|sysroot)=/.test(a))).toEqual(["std=$LIB/libstd-823d78ffe8cfce5b.rlib", "std=$LIB/libstd-823d78ffe8cfce5b.rmeta", "sysroot=$LIB/libsysroot-8bee418f84e2411a.rmeta"]);
  // cargo passes both files of a dep, both now in the sysroot's library directory.
  expect(CORPUS.core!.args).not.toContain("--extern");
  expect(CORPUS.std!.args.filter((a) => a.startsWith("core=$LIB/libcore-"))).toHaveLength(2);
  expect(CORPUS.std!.env.STD_ENV_ARCH).toBe("x86_64");
  // cargo-miri's own patch, which the cargo log does not show; no other crate has it.
  expect(Object.keys(CORPUS).filter((n) => CORPUS[n]!.args.includes("-Cpanic=abort"))).toEqual(["panic_abort"]);
});

test("the suites: report only, heavy, Miri's oracle, no baseline, out of the gate's default set", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const m = await import(${JSON.stringify(join(REPO, "harness/miri-sysroot.ts"))});
const { miriBinary, MIRI_SYSROOT } = await import(${JSON.stringify(join(REPO, "scripts/lib/miri.ts"))});
const names = ["miri-sysroot-core", "miri-sysroot-alloc", "miri-sysroot-std"];
const inv = m.miriSysrootInvocation("alloc", "/o");
const local = m.miriSysrootInvocation("custom_local_sysroot", "/o");
const lib = (await import(${JSON.stringify(join(REPO, "scripts/lib/miri.ts"))})).miriTargetLibDir();
const dfile = (await import("node:fs")).readdirSync(lib).find((f) => /^custom_local_sysroot-[0-9a-f]+\\.d$/.test(f));
const dtext = (await import("node:fs")).readFileSync(lib + "/" + dfile, "utf8");
console.log(JSON.stringify({
  fields: names.map((n) => { const x = s.suite(n); return { mode: x.mode, miri: x.miri, heavy: Boolean(x.heavy), criterion: x.criterion, ids: x.cases().map((c) => c.id), runs: g.oracleRuns(x.oracle(x.cases())), isMiri: g.oracleRuns(x.oracle(x.cases()))[0] === miriBinary(), undeclared: g.undeclaredRuns(x), subject: x.subject(x.cases()).slice(-2)[1], side: [x.oracle(x.cases())[5], x.subject(x.cases())[5]] }; }),
  all: s.SUITES.map((x) => x.name),
  dupes: s.SUITES.length - new Set(s.SUITES.map((x) => x.name)).size,
  local: { cwd: local.cwd, manifest: local.env.CARGO_MANIFEST_DIR, sources: local.sources, left: JSON.stringify(local).match(/\\$(TC|LIB|OUT|CARGO_HOME|BUILD)/g), inD: dtext.startsWith(local.cwd + "/target/x86_64-unknown-linux-gnu/custom_sysroot/build/custom-local-sysroot/"), expand: [m.expandMiriSysroot("$BUILD/x", { tc: "", cargoHome: "", lib: "", out: "", build: () => "/b" }), m.expandMiriSysroot("$TC", { tc: "/t", cargoHome: "", lib: "", out: "", build: () => { throw new Error("read"); } })] },
  inv: { hasOut: inv.args.includes("/o"), sysroot: inv.args.slice(-2)[0], be: inv.env.MIRI_BE_RUSTC, left: JSON.stringify(inv).match(/\\$(TC|LIB|OUT|CARGO_HOME)/g), extern: inv.args.filter((a) => a.startsWith("core=")).map((a) => a.startsWith("core=" + MIRI_SYSROOT + "/lib/rustlib/x86_64-unknown-linux-gnu/lib/libcore-")) },
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  for (const [i, f] of j.fields.entries()) {
    expect(f.mode).toBe("single");
    expect(f.miri).toBe(true);
    expect(f.heavy).toBe(true);
    expect(f.criterion).toBeUndefined();
    expect(f.ids).toEqual([["core", "alloc", "std"][i]]);
    expect(f.isMiri).toBe(true);
    expect(f.undeclared).toEqual([]);
    expect(f.subject.endsWith("src/miri/bin/miri.ts")).toBe(true);
    expect(f.side).toEqual(["oracle", "subject"]);
  }
  expect(j.dupes).toBe(0);
  expect(j.inv).toEqual({ hasOut: true, sysroot: "--sysroot", be: "target", left: null, extern: [true] });
  // `$BUILD` is the directory the sysroot's own dep-info names, read only when a template uses it.
  expect(j.local.cwd).toMatch(/\/rustc-build-sysroot-[A-Za-z0-9]+$/);
  expect(j.local.manifest).toBe(j.local.cwd);
  expect(j.local.sources).toEqual({ "lib.rs": "" });
  expect(j.local.left).toBeNull();
  expect(j.local.inD).toBe(true);
  expect(j.local.expand).toEqual(["/b/x", "/t"]);
  // scripts/gate.ts's default is the suites with a baseline file: these have none.
  const base = readdirSync(join(REPO, "harness/baseline"));
  for (const c of ["core", "alloc", "std"]) expect(base).not.toContain(`miri-sysroot-${c}.txt`);
  expect(existsSync(join(REPO, "harness/baseline/miri-sysroot-core.txt"))).toBe(false);
}, 30_000);

test("the wrapper: its command line, and the lines it prints", async () => {
  const code = `
const m = await import(${JSON.stringify(join(REPO, "scripts/miri-sysroot-run.ts"))});
const { writeFileSync } = await import("node:fs");
const T = ${JSON.stringify(TMP)};
writeFileSync(T + "/a", "abcd"); writeFileSync(T + "/b", "abXd"); writeFileSync(T + "/c", "abcd");
const parse = (a) => { try { return m.parseMiriSysrootRunArgs(a); } catch (e) { return e.message; } };
console.log(JSON.stringify({
  ok: parse(["--crate", "core", "--side", "subject", "--", "bun", "x"]),
  bad: [parse(["--crate", "core", "--side", "x", "--", "a"]), parse(["--crate", "core", "--side", "oracle"]), parse(["--side", "oracle", "--", "a"]), parse(["--nope"])],
  none: [m.fileLine("rlib", undefined), m.sysrootLine("rlib", undefined, T + "/a")],
  file: m.fileLine("rmeta", T + "/a"),
  same: m.sysrootLine("rmeta", T + "/a", T + "/c"),
  differs: m.sysrootLine("rmeta", T + "/a", T + "/b"),
  absent: m.sysrootLine("rlib", T + "/a", T + "/no-such"),
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(j.ok).toEqual({ crate: "core", side: "subject", compiler: ["bun", "x"] });
  expect(j.bad).toEqual(["miri-sysroot-run: --side must be oracle or subject, not x", "miri-sysroot-run: no compiler command after `--`", "miri-sysroot-run: --crate and --side are required", "miri-sysroot-run: unknown option --nope"]);
  expect(j.none).toEqual(["rlib: none", "sysroot rlib: none"]);
  expect(j.file).toBe(`rmeta: 4 bytes, sha256 ${new Bun.CryptoHasher("sha256").update("abcd").digest("hex")}`);
  expect(j.same).toBe("sysroot rmeta: same");
  expect(j.differs).toBe(`sysroot rmeta: differs from 4 bytes, sha256 ${new Bun.CryptoHasher("sha256").update("abXd").digest("hex")}, first at byte 2`);
  expect(j.absent).toBe("sysroot rlib: differs: not in the sysroot");
  writeFileSync(join(TMP, "done"), "");
}, 30_000);

test("two runs of one crate and side at once each compile into a directory of their own (review miri-sysroot F2)", async () => {
  const data = join(TMP, "data");
  const stub = join(TMP, "stub-compiler.ts");
  // Writes its three files a second after it starts, into the out dir it was given, as rustc would fail to if that dir were gone.
  writeFileSync(
    stub,
    `import { writeFileSync } from "node:fs";
const a = process.argv.slice(2);
const i = a.indexOf("--out-dir");
const out = i >= 0 ? a[i + 1] : a.find((x) => x.startsWith("--out-dir="))!.slice("--out-dir=".length);
await Bun.sleep(1000);
writeFileSync(out + "/libcore.rmeta", "rmeta");
writeFileSync(out + "/libcore.rlib", "rlib!");
writeFileSync(out + "/core.d", out + "/libcore.rmeta: lib.rs\\n");
`,
  );
  // The crate's cwd, under the temp data root's toolchain.
  const setup = `const { miriSysrootInvocation } = await import(${JSON.stringify(join(REPO, "harness/miri-sysroot.ts"))}); console.log(miriSysrootInvocation("core", "x").cwd);`;
  const env = { ...process.env, RUST_TS_DATA: data } as Record<string, string>;
  const cwd = Bun.spawnSync([process.execPath, "-e", setup], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  expect(cwd.exitCode, cwd.stderr.toString()).toBe(0);
  Bun.spawnSync(["mkdir", "-p", cwd.stdout.toString().trim()]);
  const one = () => Bun.spawn([process.execPath, join(REPO, "scripts/miri-sysroot-run.ts"), "--crate", "core", "--side", "subject", "--", process.execPath, stub], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  const first = one();
  await Bun.sleep(300);
  const second = one();
  const rs = await Promise.all([first, second].map(async (p) => [await p.exited, await new Response(p.stdout).text(), await new Response(p.stderr).text()] as const));
  expect(rs[0]![0], rs[0]![2]).toBe(0);
  expect(rs[1]).toEqual(rs[0]!);
  expect(rs[0]![1]).toContain("rmeta: 5 bytes, sha256 ");
  expect(rs[0]![1]).toContain("files: core.d libcore.rlib libcore.rmeta\n");
  // Not in this sysroot, so `differs`: one is kept for diagnosis under the side's name, and no run's own directory is left.
  expect(readdirSync(join(data, "rmeta", "miri-sysroot", "core"))).toEqual(["subject"]);
}, 60_000);

test("a run removes the run directories of its crate, side and pid namespace whose pid is gone, and only those (review root-w42-check N4, N6)", async () => {
  const data = join(TMP, "data-stale");
  const stub = join(TMP, "stub-compiler-stale.ts");
  writeFileSync(
    stub,
    `import { writeFileSync } from "node:fs";
const a = process.argv.slice(2);
const i = a.indexOf("--out-dir");
const out = i >= 0 ? a[i + 1] : a.find((x) => x.startsWith("--out-dir="))!.slice("--out-dir=".length);
writeFileSync(out + "/libcore.rmeta", "rmeta");
`,
  );
  const setup = `const { miriSysrootInvocation } = await import(${JSON.stringify(join(REPO, "harness/miri-sysroot.ts"))}); console.log(miriSysrootInvocation("core", "x").cwd);`;
  const env = { ...process.env, RUST_TS_DATA: data } as Record<string, string>;
  const cwd = Bun.spawnSync([process.execPath, "-e", setup], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  expect(cwd.exitCode, cwd.stderr.toString()).toBe(0);
  Bun.spawnSync(["mkdir", "-p", cwd.stdout.toString().trim()]);
  // This host's pid namespace tag, as the run computes it: stable, 12 hex digits.
  const nsOf = () => Bun.spawnSync([process.execPath, "-e", `const { pidNamespace } = await import(${JSON.stringify(join(REPO, "scripts/miri-sysroot-run.ts"))}); console.log(pidNamespace());`], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
  const ns = nsOf();
  expect(ns).toMatch(/^[0-9a-f]{12}$/);
  expect(nsOf()).toBe(ns);
  const other = ns === "000000000000" ? "111111111111" : "000000000000";
  // A pid that has exited, and one that lives for the whole run (killed below; only processes this test started).
  const dead = Bun.spawnSync(["true"]).pid;
  const live = Bun.spawn(["sleep", "60"], { stdout: "ignore", stderr: "ignore" });
  try {
    const crate = join(data, "rmeta", "miri-sysroot", "core");
    const mine = (x: string | number) => `subject.run-${ns}-${x}`;
    const leftovers = [mine(dead), mine(live.pid), mine("abc"), mine("0"), mine("1"), mine("0x1"), `subject.run-${other}-${dead}`, `subject.run-${dead}`, `oracle.run-${ns}-${dead}`, "subject"];
    for (const d of leftovers) mkdirSync(join(crate, d), { recursive: true });
    const r = Bun.spawnSync([process.execPath, join(REPO, "scripts/miri-sysroot-run.ts"), "--crate", "core", "--side", "subject", "--", process.execPath, stub], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    // Gone: the dead pid's directory of this side and namespace. Kept: a live pid's, pid 1 (`EPERM`: alive, not ours), names that are
    // no pid, another pid namespace's (a VM or container sharing the data root: its pids mean nothing here), one named before the
    // namespace tag, the other side's, and `subject` (replaced by this run's, which differs from the sysroot).
    expect(readdirSync(crate).sort()).toEqual(leftovers.filter((d) => d !== mine(dead)).sort());
  } finally {
    live.kill();
  }
}, 60_000);

// Review harness-w45 N6: on Linux with an unreadable /proc/self/ns/pid, two containers with one boot and one host name would share a
// tag (and pids repeat across containers), so the namespace is not known, the run takes a random tag no namespace has, and removes nothing.
test("a pid namespace that cannot be known: no tag, a random run directory no namespace matches, nothing removed (review harness-w45 N6)", async () => {
  const child = (code: string, data: string) => {
    const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, env: { ...process.env, RUST_TS_DATA: data } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    return r.stdout.toString().trim();
  };
  const RUN = JSON.stringify(join(REPO, "scripts/miri-sysroot-run.ts"));
  const data = join(TMP, "data-unknown-ns");
  const got = JSON.parse(
    child(
      `const m = await import(${RUN});
const reader = (platform, link) => ({ platform, hostname: () => "fixed", readlink: () => { if (link === undefined) throw new Error("EACCES"); return link; }, readFile: () => "boot" });
const tags = ["pid:[4026531836]", "pid:[4026532001]"].map((l) => m.pidNamespace(reader("linux", l)));
const dir = m.runDirOf("/d/core/subject", undefined, 77, () => "0123456789ab");
console.log(JSON.stringify({
  linuxUnknown: m.pidNamespace(reader("linux", undefined)) ?? null,
  linuxKnown: tags,
  darwin: m.pidNamespace(reader("darwin", undefined)),
  known: m.runDirOf("/d/core/subject", "abcdefabcdef", 77),
  dir,
  random: [m.runDirOf("/d", undefined, 1), m.runDirOf("/d", undefined, 1)],
  // As every namespace would judge it, with every pid gone: never stale.
  stale: [tags[0], tags[1], "0123456789ab", "r0123456789a"].flatMap((ns) => m.staleRunDirs(["subject.run-r0123456789ab-77"], "subject", ns, () => false)),
}));`,
      data,
    ),
  );
  expect(got.linuxUnknown).toBeNull();
  expect(got.linuxKnown[0]).toMatch(/^[0-9a-f]{12}$/);
  expect(got.linuxKnown[1]).toMatch(/^[0-9a-f]{12}$/);
  expect(got.linuxKnown[0]).not.toBe(got.linuxKnown[1]);
  expect(got.darwin).toMatch(/^[0-9a-f]{12}$/);
  expect(got.known).toBe("/d/core/subject.run-abcdefabcdef-77");
  expect(got.dir).toBe("/d/core/subject.run-r0123456789ab-77");
  expect(got.random[0]).toMatch(/^\/d\.run-r[0-9a-f]{12}-1$/);
  expect(got.random[0]).not.toBe(got.random[1]);
  expect(got.stale).toEqual([]);
  // A whole run with the namespace unknown: every leftover stays, even a dead pid's of this host's own tag.
  const stub = join(TMP, "stub-compiler-unknown.ts");
  writeFileSync(stub, `import { writeFileSync } from "node:fs";\nconst a = process.argv.slice(2);\nwriteFileSync(a[a.indexOf("--out-dir") + 1] + "/libcore.rmeta", "rmeta");\n`);
  mkdirSync(child(`const { miriSysrootInvocation } = await import(${JSON.stringify(join(REPO, "harness/miri-sysroot.ts"))}); console.log(miriSysrootInvocation("core", "x").cwd);`, data), { recursive: true });
  const ns = child(`const { pidNamespace } = await import(${RUN}); console.log(pidNamespace());`, data);
  const dead = Bun.spawnSync(["true"]).pid;
  const crate = join(data, "rmeta", "miri-sysroot", "core");
  const leftovers = [`subject.run-${ns}-${dead}`, `subject.run-r0123456789ab-${dead}`, `subject.run-${dead}`];
  for (const d of leftovers) mkdirSync(join(crate, d), { recursive: true });
  const out = child(`const m = await import(${RUN}); const code = await m.miriSysrootRun({ crate: "core", side: "subject", compiler: [process.execPath, ${JSON.stringify(stub)}] }, () => undefined); console.log("exit " + code);`, data);
  expect(out).toContain("rmeta: 5 bytes");
  expect(out.endsWith("exit 0")).toBe(true);
  // The run's own directory differed from the sysroot, so it is kept as `subject`; nothing else changed.
  expect(readdirSync(crate).sort()).toEqual([...leftovers, "subject"].sort());
}, 60_000);

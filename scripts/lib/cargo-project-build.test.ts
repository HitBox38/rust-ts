// The project-build harness (scripts/lib/cargo-project-build.ts, scripts/cargo-project-build.ts; plan-m8 D8, D15, D20; lanes harness-m7d,
// harness-m8a-build). What cargo really does with ripgrep and cargo is measured by the suites; a unit test must stay cheap (plan-m7 §6,
// review F5; plan-m8 D13). scripts/cargo-project-build.ts loads scripts/lib/common.ts, so what needs it runs in child processes (see
// scripts/lib/deps.test.ts for why), all started when this file loads, so they overlap (as scripts/gate-headroom.test.ts does).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CARGO_NO_RESULT_MARK,
  NO_RESULT_MARK,
  artifactLines,
  buildExit,
  builtPathRefusal,
  callKind,
  callLine,
  cargoNoResultReason,
  comparedBytes,
  markedPids,
  noResultReason,
  normaliseCargoStderr,
  normaliseSmokeStream,
  notArtifact,
  otoolLines,
  signalNumber,
  sysBuildScriptLines,
  unportedLine,
  walkFiles,
} from "./cargo-project-build.ts";

const TMP = mkdtempSync(join(tmpdir(), "rust-ts-project-build-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const HARNESS = resolve(import.meta.dir, "..", "cargo-project-build.ts");

/** Runs `code` in a child Bun; resolves to its last stdout line as JSON. */
const child = (code: string, env: Record<string, string> = {}) => {
  const p = Bun.spawn([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTUP_AUTO_INSTALL: "0", ...env } });
  return (async () => {
    const [out, err, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (exit !== 0) throw new Error(`child exit ${exit}: ${err}${out}`);
    return JSON.parse(out.trim().split("\n").at(-1)!);
  })();
};

// --- Children, started now ---------------------------------------------------------------------------------------------------------------

/** Keys and stamps: prune by last use (re-check note 2), unreadable stamps (note 3), and the preconditions on fake hosts (D20, D15). */
const KEYS = (() => {
  const bin = join(TMP, "bin");
  for (const d of ["cur", "recent", "old", "used", "x.tmp-999999", `y.tmp-${process.pid}`]) mkdirSync(join(bin, d), { recursive: true });
  writeFileSync(join(bin, "recent", "stamp.json"), '{"key":"recent","outcome":"ok","builtAt":"x"}');
  writeFileSync(join(bin, "old", "stamp.json"), "{half");
  return child(`
const h = await import(${JSON.stringify(HARNESS)});
const { existsSync, utimesSync } = await import("node:fs");
const bin = ${JSON.stringify(bin)};
const t = (Date.now() - 4 * 24 * 3_600_000) / 1000;
for (const d of ["old", "cur", "used"]) utimesSync(bin + "/" + d, t, t);
// "used" is old by its build date but handed out now: a user touches it, so it stays.
h.touchKey(bin + "/used");
h.touchKey(bin + "/gone");
const pruned = h.pruneKeys(bin, "cur").sort();
const stamps = [h.readStamp(bin + "/recent"), h.readStamp(bin + "/old") ?? null, h.readStamp(bin + "/nothing") ?? null];
const power = (onBattery) => async () => onBattery ? "Now drawing from 'Battery Power'\\n -InternalBattery-0 (id=1)\\t50%; discharging;" : "Now drawing from 'AC Power'\\n";
const host = (o) => ({
  readers: { pmset: power(o.battery), swapusage: async () => \`total = 8192.00M  used = \${o.swapMb}.00M  free = 1.00M\`, load: () => [1, 1, 1], now: () => new Date(0), freeBytes: async () => o.freeGiB * 2 ** 30, vmPressure: async () => String(o.pressure) },
  gateRunning: () => o.gate,
  underGate: () => o.underGate,
  exists: (p) => (o.pathHas ?? []).includes(p),
});
const ok = { battery: false, swapMb: 1000, freeGiB: 30, pressure: 1, gate: false, underGate: false };
const bad = { battery: true, swapMb: 9000, freeGiB: 1, pressure: 4, gate: true, underGate: false, pathHas: ["/usr/local/bin/pkg-config"] };
const pre = async (p, o) => (await h.preconditionRefusal(h.PROJECTS[p], host(o))) ?? null;
console.log(JSON.stringify({
  pruned, left: ["cur", "recent", "used", "y.tmp-${process.pid}"].map((d) => existsSync(bin + "/" + d)),
  stamps,
  rg: [await pre("ripgrep", bad)],
  cargo: [
    await pre("cargo", ok),
    await pre("cargo", { ...ok, battery: true }),
    await pre("cargo", { ...ok, gate: true }),
    await pre("cargo", { ...ok, gate: true, underGate: true }),
    await pre("cargo", { ...ok, freeGiB: 19 }),
    await pre("cargo", { ...ok, swapMb: 4096 }),
    await pre("cargo", { ...ok, pressure: 4 }),
    await pre("cargo", { ...ok, pathHas: ["/usr/bin/curl-config"] }),
    await pre("cargo", { ...ok, pathHas: ["/usr/sbin/pkg-config"] }),
  ],
  dirs: h.BUILT_PATH_DIRS,
}));
`);
})();

/** The sweep on real processes (re-check note 1, w40t-audit N6): only an environment entry, whole, with this build's nonce, is killed. */
const SWEEP = (async () => {
  const tag = `${join(TMP, "tree-for-sweep")}#0123456789abcdef`;
  const idle = "setTimeout(() => {}, 30000)";
  // Bun processes, as the port's compiler is: macOS's `ps -E` shows no environment for a platform binary such as /bin/sleep.
  const withEnv = (v: string) => Bun.spawn([process.execPath, "-e", idle], { env: { ...process.env, CPB_TREE: v }, stdout: "ignore", stderr: "ignore" });
  const procs = {
    mine: withEnv(tag),
    otherNonce: withEnv(`${join(TMP, "tree-for-sweep")}#fedcba9876543210`),
    longer: withEnv(`${tag}x`),
    oldName: Bun.spawn([process.execPath, "-e", idle], { env: { ...process.env, RGB_TREE: tag }, stdout: "ignore", stderr: "ignore" }),
    argvOnly: Bun.spawn([process.execPath, "-e", idle, `CPB_TREE=${tag}`], { stdout: "ignore", stderr: "ignore" }),
    platformArgv: Bun.spawn(["/bin/sh", "-c", "sleep 30", "x", `CPB_TREE=${tag}`], { stdout: "ignore", stderr: "ignore" }),
  };
  try {
    await Bun.sleep(300);
    const killed = (await child(`const h = await import(${JSON.stringify(HARNESS)}); console.log(JSON.stringify(h.killBuildProcesses(${JSON.stringify(tag)})));`)) as number[];
    await procs.mine.exited;
    return { killed, mine: procs.mine.pid, signal: procs.mine.signalCode, alive: Object.entries(procs).filter(([k]) => k !== "mine").map(([k, p]) => [k, p.exitCode === null && p.signalCode === null]) };
  } finally {
    for (const p of Object.values(procs)) p.kill("SIGKILL");
  }
})();

/** runInGroup (re-check note 5): SIGHUP to the runner stops the whole group, and the runner learns it was interrupted. */
const GROUP = (async () => {
  const pidFile = join(TMP, "group-child.pid");
  const runner = Bun.spawn(
    [
      process.execPath,
      "-e",
      `const h = await import(${JSON.stringify(HARNESS)}); const r = await h.runInGroup(["/bin/sh", "-c", "sleep 30 & echo $! > ${pidFile}; sleep 30"], { cwd: ${JSON.stringify(TMP)}, env: { PATH: "/usr/bin:/bin" }, timeoutMs: 60000 }); console.log(JSON.stringify({ interrupted: r.interrupted ?? null, timedOut: r.timedOut }));`,
    ],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } },
  );
  for (let i = 0; i < 200 && !existsSync(pidFile); i++) await Bun.sleep(25);
  const grandchild = Number(readFileSync(pidFile, "utf8"));
  runner.kill("SIGHUP");
  const out = await new Response(runner.stdout).text();
  await runner.exited;
  await Bun.sleep(100);
  let grandchildAlive = true;
  try {
    process.kill(grandchild, 0);
  } catch {
    grandchildAlive = false;
  }
  return { result: JSON.parse(out.trim().split("\n").at(-1) ?? "null"), exit: runner.exitCode, grandchildAlive };
})();

/**
 * A real oracle build of a tiny project (a `-sys` crate with a build script and a binary that uses it) through the harness, with fake
 * host readers: once with room (the report's D15 sections, the kept binary, the tree deleted, D17), once with the free disk under the
 * watchdog's floor (stopped: the record exists, no stamp, no tree; review harness-m8a-gate N2).
 */
const BUILD = (() => {
  const root = join(TMP, "proj-root");
  const src = join(root, "src-proj");
  mkdirSync(join(src, "src"), { recursive: true });
  mkdirSync(join(src, "tiny-sys", "src"), { recursive: true });
  writeFileSync(join(src, "Cargo.toml"), '[package]\nname = "tiny"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\ntiny-sys = { path = "tiny-sys" }\n\n[workspace]\n');
  writeFileSync(join(src, "src", "main.rs"), 'fn main() { println!("tiny {}", tiny_sys::answer()); }\n');
  writeFileSync(join(src, "tiny-sys", "Cargo.toml"), '[package]\nname = "tiny-sys"\nversion = "0.1.0"\nedition = "2021"\nlinks = "tiny"\nbuild = "build.rs"\n');
  writeFileSync(join(src, "tiny-sys", "build.rs"), 'fn main() {\n    println!("cargo:rerun-if-changed=build.rs");\n    println!("cargo:rustc-link-lib=z");\n    println!("cargo:root={}", std::env::var("OUT_DIR").unwrap());\n}\n');
  writeFileSync(join(src, "tiny-sys", "src", "lib.rs"), "pub fn answer() -> u32 { 42 }\n");
  writeFileSync(join(src, "Cargo.lock"), 'version = 4\n\n[[package]]\nname = "tiny"\nversion = "0.1.0"\ndependencies = [\n "tiny-sys",\n]\n\n[[package]]\nname = "tiny-sys"\nversion = "0.1.0"\n');
  mkdirSync(join(root, "cargo-home"), { recursive: true });
  const stops = join(TMP, "build-stops");
  return child(`
const h = await import(${JSON.stringify(HARNESS)});
const { oracleSysroot } = await import(${JSON.stringify(resolve(import.meta.dir, "oracle.ts"))});
const { existsSync, readdirSync } = await import("node:fs");
const root = ${JSON.stringify(root)};
const project = (headroom) => ({ ...h.PROJECTS.cargo, name: "cargo", suite: "tiny-build", root, src: () => "src-proj", isSetUp: () => true, cargoHome: root + "/cargo-home",
  cargoArgs: (tree) => ["build", "--locked", "--offline", "-j1", "--target-dir", tree], binary: "tiny", header: () => "tiny-build", rootName: "$TINY", headroom, keyParts: () => ["tiny"] });
const readers = (freeGiB) => ({ pmset: async () => "Now drawing from 'AC Power'\\n", swapusage: async () => "total = 1.00M  used = 0.00M  free = 1.00M", load: () => [], now: () => new Date(), freeBytes: async () => freeGiB * 2 ** 30, vmPressure: async () => "1" });
const host = (freeGiB) => ({ preconditions: { readers: readers(Math.max(freeGiB, 30)), gateRunning: () => false, underGate: () => false, exists: () => false }, watchdog: { readers: readers(freeGiB), stopDir: ${JSON.stringify(stops)} } });
const compiler = [oracleSysroot() + "/bin/rustc"];
const ok = await h.buildSide(project("heavy-build"), "oracle", compiler, host(30));
const key = h.binKey(project("heavy-build"), "oracle", compiler);
const kept = root + "/bin/oracle/" + key;
const okState = { kept: existsSync(kept + "/tiny"), stamp: h.readStamp(kept)?.outcome ?? null, tree: existsSync(root + "/target/tiny-build"), logs: existsSync(root + "/kept/tiny-build/oracle-logs/cargo.stderr") };
const stopped = await h.buildSide({ ...project("heavy-build"), suite: "tiny-stop" }, "oracle", compiler, host(1));
const records = existsSync(${JSON.stringify(stops)}) ? readdirSync(${JSON.stringify(stops)}).filter((f) => f.endsWith(".json")).length : 0;
console.log(JSON.stringify({ ok, okState, stopped, records, stopTree: existsSync(root + "/target/tiny-stop") }));
`);
})();

// --- Pure parts ------------------------------------------------------------------------------------------------------------------------------

describe("cargo's stderr", () => {
  test("paths named, the Finished time masked in every form, Compiling lines sorted and counted, the rest in order", () => {
    const text = [
      "   Compiling serde v1.0.228",
      "warning: a warning from /data/ripgrep/cargo/registry/src/x.rs",
      "   Compiling memchr v2.7.6",
      "    Finished `release` profile [optimized + debuginfo] target(s) in 1m 02s",
      "",
    ].join("\r\n");
    expect(normaliseCargoStderr(text, [["/data", "$DATA"], ["/data/ripgrep", "$RG_ROOT"]])).toEqual([
      "compiling: 2",
      "  Compiling memchr v2.7.6",
      "  Compiling serde v1.0.228",
      "the rest, in order:",
      "  warning: a warning from $RG_ROOT/cargo/registry/src/x.rs",
      "      Finished `release` profile [optimized + debuginfo] target(s) in <time>",
    ]);
    for (const t of ["42.13s", "7s", "1h 03m 04s"]) expect(normaliseCargoStderr(`    Finished x in ${t}`, []).at(-1)).toBe("      Finished x in <time>");
    // Only the Finished line's time: a compiler's message that ends the same way is compared as it is.
    expect(normaliseCargoStderr("note: took in 3s", []).at(-1)).toBe("  note: took in 3s");
  });
});

describe("cargo-smoke's streams", () => {
  test("roots named, thread id and libtest time masked, Finished time masked, Compiling/Checking sorted where the first was", () => {
    const text = [
      "    Checking memchr v2.7.6",
      "   Compiling serde v1.0.228 (/private/var/c/work/hello)",
      "    Checking aho-corasick v1.1.3",
      "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.21s",
      "thread 'tests::fails' (123456) panicked at src/main.rs:14:9:",
      "test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s",
      "",
    ].join("\r\n");
    expect(normaliseSmokeStream(text, [["/private/var/c", "$CASE"]])).toEqual([
      "    Checking aho-corasick v1.1.3",
      "    Checking memchr v2.7.6",
      "   Compiling serde v1.0.228 ($CASE/work/hello)",
      "    Finished `dev` profile [unoptimized + debuginfo] target(s) in <time>",
      "thread 'tests::fails' (<tid>) panicked at src/main.rs:14:9:",
      "test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in <time>s",
    ]);
    expect(normaliseSmokeStream("", [])).toEqual([]);
    expect(normaliseSmokeStream("\n", [])).toEqual([]);
  });
});

describe("calls and exit", () => {
  test("a call that asks the compiler about itself is a probe", () => {
    expect(callKind(["-vV"])).toBe("probe");
    expect(callKind(["--version"])).toBe("probe");
    expect(callKind(["-", "--print=cfg"])).toBe("probe");
    expect(callKind(["--crate-name", "build_script_build", "build.rs"])).toBe("compile");
  });
  test("a call's line: its stdout (a probe's answer to cargo, review N3) and its stderr; a recorded signal is not on it", () => {
    const empty = "0 bytes, sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(callLine({ kind: "probe", crate: "-", metadata: "none", code: 0, stdout: "5 bytes, sha256 x" }, new Uint8Array())).toBe(`  probe - none: exit 0, stdout 5 bytes, sha256 x, stderr ${empty}`);
    const killed = { kind: "compile" as const, crate: "cargo", metadata: "m", code: 101, signal: "SIGKILL", stdout: "0 bytes" };
    expect(callLine(killed, new Uint8Array())).not.toContain("SIGKILL");
  });
  test("each project's no-result mark is found only at the start of a stderr line, and only its own", () => {
    expect(noResultReason(`warning: x\n${NO_RESULT_MARK}the build was interrupted (SIGTERM)\n`)).toBe("detected: the ripgrep harness had no result: the build was interrupted (SIGTERM)");
    expect(noResultReason(`a ${NO_RESULT_MARK}x`)).toBeUndefined();
    expect(noResultReason("")).toBeUndefined();
    expect(cargoNoResultReason(`${CARGO_NO_RESULT_MARK}the build was stopped: watchdog\n`)).toBe("detected: the cargo harness had no result: the build was stopped: watchdog");
    expect(cargoNoResultReason(`${NO_RESULT_MARK}x\n`)).toBeUndefined();
    expect(noResultReason(`${CARGO_NO_RESULT_MARK}x\n`)).toBeUndefined();
  });
  test("the port's first unported stop is UNPORTED, a panic a crash, otherwise 0", () => {
    expect(unportedLine("a\nrust-ts: unported: rustc_codegen_llvm::x\nb")).toBe("rust-ts: unported: rustc_codegen_llvm::x");
    expect(buildExit([{ code: 0, stderrText: "" }, { code: 70, stderrText: "rust-ts: unported: a" }, { code: 70, stderrText: "rust-ts: unported: b" }])).toEqual({ code: 70, unported: "rust-ts: unported: a" });
    expect(buildExit([{ code: 101, stderrText: "error: internal compiler error" }])).toEqual({ code: 101 });
    expect(buildExit([{ code: 1, stderrText: "error[E0308]" }])).toEqual({ code: 0 });
  });
  test("an interrupted run's exit is 128 + the signal's number, for every signal (re-check note 6)", () => {
    expect(["SIGHUP", "SIGINT", "SIGKILL", "SIGTERM", "SIGUSR1"].map(signalNumber)).toEqual([1, 2, 9, 15, 30]);
    expect(signalNumber("SIGNOPE")).toBe(0);
  });
});

describe("artifacts", () => {
  test("bookkeeping is no artifact; dep-info and build-script outputs are compared by bytes, the rest by name", () => {
    expect([".fingerprint/x-1/lib", "incremental", ".cargo-lock", "deps/rg-1", "build/x-1/out/a.rs"].map(notArtifact)).toEqual([true, true, true, false, false]);
    expect(["deps/x-1.d", "rg.d", "build/x-1/output", "build/x-1/stderr", "build/x-1/root-output", "build/x-1/out/output", "deps/libx-1.rlib", "rg"].map(comparedBytes)).toEqual([true, true, true, true, true, false, false, false]);
    // The oracle cargo's build-dir layout (review F3): a build script's run under `<package>/<hash>/run`, its printed `cargo:` lines in
    // `stdout`, seen in every one of the oracle tree's 10 runs; its `out` directory is not compared by bytes, nor an `output` there.
    expect(["build/serde/f8aa/run/stdout", "build/serde/f8aa/run/stderr", "build/serde/f8aa/run/root-output", "build/serde/f8aa/run/invoked.timestamp", "build/serde/f8aa/out/stdout", "build/serde/f8aa/out/x.d", "build/serde/f8aa/run/output"].map(comparedBytes)).toEqual([true, true, true, false, false, true, false]);
    const p = join(TMP, "release");
    for (const d of [".fingerprint/a", "deps", "build/b-1/out"]) mkdirSync(join(p, d), { recursive: true });
    writeFileSync(join(p, ".fingerprint/a/x"), "1");
    writeFileSync(join(p, "deps/a-1.d"), "dep");
    writeFileSync(join(p, "deps/liba-1.rlib"), "rlib");
    writeFileSync(join(p, "build/b-1/output"), "cargo:rustc-cfg=x\n");
    writeFileSync(join(p, "rg"), "bin");
    expect(walkFiles(p)).toEqual([".fingerprint/a/x", "build/b-1/output", "deps/a-1.d", "deps/liba-1.rlib", "rg"]);
    const lines = artifactLines(p);
    expect(lines.slice(0, 5)).toEqual(["artifacts: 4 files", "  build/b-1/output", "  deps/a-1.d", "  deps/liba-1.rlib", "  rg"]);
    expect(lines.slice(5).map((l) => l.split(":")[0])).toEqual(["  bytes build/b-1/output", "  bytes deps/a-1.d"]);
    expect(artifactLines(join(TMP, "none"))).toEqual(["artifacts: 0 files"]);
  });
});

describe("D15's recorded checks", () => {
  test("each -sys crate's build-script output: its cargo: lines but rerun-if-*, roots named; other crates' are not listed", () => {
    const p = join(TMP, "debug");
    const put = (rel: string, text: string) => {
      mkdirSync(join(p, rel, ".."), { recursive: true });
      writeFileSync(join(p, rel), text);
    };
    put("build/openssl-sys/1a2b/run/stdout", "cargo:rerun-if-env-changed=OPENSSL_DIR\ncargo::rerun-if-changed=build.rs\ncargo:rustc-link-search=native=/data/cargo-src/target/x/out/lib\ncargo:rustc-link-lib=static=ssl\ncargo:include=/data/cargo-src/target/x/out/include\nOPENSSL_DIR unset\ncargo:warning=hello\n");
    put("build/openssl-sys/1a2b/run/stderr", "noise\n");
    put("build/serde/3c4d/run/stdout", "cargo:rustc-cfg=x\n");
    put("build/libz-sys-5e6f/output", "cargo:rustc-link-lib=z\r\n");
    expect(sysBuildScriptLines(p, [["/data/cargo-src", "$CARGO_ROOT"]])).toEqual([
      "-sys build scripts:",
      "  libz-sys-5e6f: 1 lines",
      "    cargo:rustc-link-lib=z",
      "  openssl-sys/1a2b: 4 lines",
      "    cargo:rustc-link-search=native=$CARGO_ROOT/target/x/out/lib",
      "    cargo:rustc-link-lib=static=ssl",
      "    cargo:include=$CARGO_ROOT/target/x/out/include",
      "    cargo:warning=hello",
    ]);
    expect(sysBuildScriptLines(join(TMP, "none"), [])).toEqual(["-sys build scripts:"]);
  });
  test("otool -L: the dylibs, without the binary's own line; a Homebrew library would show by name", () => {
    const text = "/data/cargo-src/bin/oracle/k/cargo:\n\t/usr/lib/libz.1.dylib (compatibility version 1.0.0, current version 1.2.12)\n\t/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib (compatibility version 3.0.0)\n";
    expect(otoolLines(text, [["/data/cargo-src", "$CARGO_ROOT"]])).toEqual(["  /usr/lib/libz.1.dylib (compatibility version 1.0.0, current version 1.2.12)", "  /opt/homebrew/opt/openssl@3/lib/libssl.3.dylib (compatibility version 3.0.0)"]);
  });
  test("the built PATH: no pkg-config anywhere, no curl-config but the OS's", () => {
    const dirs = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
    expect(builtPathRefusal(dirs, (f) => f === "/usr/bin/curl-config")).toBeUndefined();
    expect(builtPathRefusal(dirs, (f) => f === "/bin/curl-config" || f === "/usr/sbin/pkg-config")).toBe(
      "the built PATH (/usr/bin:/bin:/usr/sbin:/sbin) has /bin/curl-config, /usr/sbin/pkg-config: a -sys build script would use the host's library instead of the pinned one (plan-m8 D15)",
    );
  });
});

describe("the sweep's match (re-check note 1, w40t-audit N6)", () => {
  const tag = "CPB_TREE=/d/target/cargo-build#00ff";
  test("only a whole entry of the environment part matches: not the argv, not a longer value, not another nonce", () => {
    const plain = [
      "  10 bun main.ts",
      "  11 bun -e x CPB_TREE=/d/target/cargo-build#00ff",
      "  12 /bin/sh -c sleep 30 x CPB_TREE=/d/target/cargo-build#00ff",
      "  13 bun main.ts",
      "  14 bun main.ts",
      "  15 bun main.ts",
      "  16 bun main.ts",
    ].join("\n");
    const withEnv = [
      "  10 bun main.ts PATH=/usr/bin CPB_TREE=/d/target/cargo-build#00ff HOME=/h",
      // The tag in argv only (a Bun process with no tag in its environment, and a platform binary, whose -E line is its argv).
      "  11 bun -e x CPB_TREE=/d/target/cargo-build#00ff PATH=/usr/bin",
      "  12 /bin/sh -c sleep 30 x CPB_TREE=/d/target/cargo-build#00ff",
      "  13 bun main.ts CPB_TREE=/d/target/cargo-build#00ffx",
      "  14 bun main.ts CPB_TREE=/d/target/cargo-build#11aa",
      "  15 bun main.ts XCPB_TREE=/d/target/cargo-build#00ff",
      "  16 bun main.ts A=1 CPB_TREE=/d/target/cargo-build#00ff",
      // Not in the plain listing (it started between the two): unsure, listed again.
      "  17 bun main.ts CPB_TREE=/d/target/cargo-build#00ff",
      // This process.
      "  99 bun main.ts CPB_TREE=/d/target/cargo-build#00ff",
    ].join("\n");
    expect(markedPids(withEnv, plain, tag, 99)).toEqual({ pids: [10, 16], unsure: [17] });
  });
  test("a pid that exec'd between the listings (its argv no longer a prefix) is unsure, never matched", () => {
    expect(markedPids("  20 cc -c x.c CPB_TREE=/d/target/cargo-build#00ff", "  20 bun main.ts", tag, 1)).toEqual({ pids: [], unsure: [20] });
  });
});

// --- What needs the harness module --------------------------------------------------------------------------------------------------------

test("kept keys: pruned by last use, not build date (re-check note 2); an unreadable stamp is no stamp (note 3); D20 and D15 before a build", async () => {
  const j = await KEYS;
  expect(j.pruned).toEqual(["old", "x.tmp-999999"]);
  expect(j.left).toEqual([true, true, true, true]);
  expect(j.stamps).toEqual([{ key: "recent", outcome: "ok", builtAt: "x" }, null, null]);
  // ripgrep is outside D20 and keeps lane harness-m7d's environment: no check, whatever the host.
  expect(j.rg).toEqual([null]);
  const [ok, battery, gate, underGate, free, swap, pressure, osCurl, pkg] = j.cargo;
  expect(ok).toBeNull();
  expect(battery).toStartWith("cargo-build: this host is on battery at 50%");
  expect(gate).toStartWith("cargo-build: a gate is running (");
  expect(underGate).toBeNull();
  expect(free).toBe("cargo-build: host headroom (plan-m8 D20, heavy-build: 20 GiB free, swap under 4 GiB, memory pressure not critical): 19.0 GiB free on the data volume, under 20 GiB");
  expect(swap).toContain("4.0 GiB of swap in use, not under 4 GiB");
  expect(pressure).toContain("memory pressure is critical");
  expect(osCurl).toBeNull();
  expect(pkg).toContain("/usr/sbin/pkg-config");
  expect(j.dirs).toEqual(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]);
}, 30_000);

test("a build's leftover processes: only an environment entry with this build's tag is killed (re-check note 1)", async () => {
  const j = await SWEEP;
  expect(j.killed).toEqual([j.mine]);
  expect(j.signal).toBe("SIGKILL");
  expect(j.alive).toEqual([
    ["otherNonce", true],
    ["longer", true],
    ["oldName", true],
    ["argvOnly", true],
    ["platformArgv", true],
  ]);
}, 30_000);

test("runInGroup: a SIGHUP to the runner stops the whole group, grandchildren included (re-check note 5)", async () => {
  const j = await GROUP;
  expect(j.result).toEqual({ interrupted: "SIGHUP", timedOut: false });
  expect(j.exit).toBe(0);
  expect(j.grandchildAlive).toBe(false);
}, 30_000);

test("a real oracle build through the harness: D15's report sections, the binary kept and the tree deleted (D17); at the floor the watchdog records its stop and the build leaves nothing (D20, N2)", async () => {
  const j = await BUILD;
  expect(j.ok.exit).toEqual({ code: 0 });
  const r = j.ok.report as string[];
  expect(r[0]).toBe("tiny-build");
  expect(r).toContain("tiny built");
  expect(r).toContain("-sys build scripts:");
  const sys = r.indexOf("-sys build scripts:");
  expect(r[sys + 1]).toMatch(/^ {2}tiny-sys\/[0-9a-f]+: 2 lines$/);
  expect(r[sys + 2]).toBe("    cargo:rustc-link-lib=z");
  expect(r[sys + 3]).toMatch(/^ {4}cargo:root=\$TINY\/target\/tiny-build\/debug\/build\/tiny-sys\/[0-9a-f]+\/out$/);
  const otool = r.indexOf("otool -L tiny:");
  expect(otool).toBeGreaterThan(sys);
  expect(r.slice(otool + 1).some((l) => l.startsWith("  /usr/lib/libz."))).toBe(true);
  expect(r.slice(otool + 1).every((l) => !l.includes("/opt/homebrew"))).toBe(true);
  expect(j.okState).toEqual({ kept: true, stamp: "ok", tree: false, logs: true });
  expect(j.stopped.stopped).toBe("watchdog (plan-m8 D20): 1.0 GiB free on the data volume, under the 4.0 GiB floor");
  expect(j.stopped.record).toContain("build-stops");
  expect(j.records).toBe(1);
  expect(j.stopTree).toBe(false);
}, 60_000);

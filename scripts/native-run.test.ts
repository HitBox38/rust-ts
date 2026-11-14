// scripts/native-run.ts (lane harness-m7b): the native suites' wrapper, with a fake compiler that copies a small C program into place, so no
// rustc runs. Checks the safety rules (environment, cwd, sandbox, timeout and process group), compiletest's run rules, the output format,
// the oracle's two runs, and that a compiler's failure passes through. macOS only, as the wrapper (sandbox-exec).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { UNSTABLE_ORACLE_PATTERNS, maskProgramOutput, maskedTexts, unstableOracleReason } from "./lib/unstable.ts";
import { compiletestVerdict, cutBacktraces, nativeDirRefusal, parseNativeRunArgs, programEnv, runsDiffer, UNSTABLE_MARK } from "./native-run.ts";

const REPO = resolve(import.meta.dir, "..");
const NATIVE_RUN = join(REPO, "scripts", "native-run.ts");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-native-run-"));
const DIR = join(TMP, "native", "unit", "0123456789abcdef");
const PROG = join(TMP, "prog");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const C = String.raw`
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <time.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
int main(int argc, char **argv) {
  const char *mode = argc > 1 ? argv[1] : "";
  if (!strcmp(mode, "env")) {
    char cwd[4096];
    getcwd(cwd, sizeof cwd);
    printf("argv0=%s\ncwd=%s\n", argv[0], cwd);
    const char *vars[] = {"PATH", "HOME", "TMPDIR", "RUST_TEST_TMPDIR", "RUST_TEST_THREADS", "DYLD_LIBRARY_PATH", "FOO", "GONE", "RUST_BACKTRACE", "CALLER", 0};
    for (int i = 0; vars[i]; i++) { const char *v = getenv(vars[i]); printf("%s=%s\n", vars[i], v ? v : "<unset>"); }
    for (int i = 2; i < argc; i++) printf("arg=%s\n", argv[i]);
    return 0;
  }
  if (!strcmp(mode, "sandbox")) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in a; memset(&a, 0, sizeof a); a.sin_family = AF_INET; a.sin_port = htons(9); a.sin_addr.s_addr = htonl(0x7f000001);
    printf("connect=%s\n", s < 0 ? strerror(errno) : connect(s, (struct sockaddr *)&a, sizeof a) < 0 ? strerror(errno) : "ok");
    printf("outside=%s\n", open(argv[2], O_WRONLY | O_CREAT, 0644) < 0 ? strerror(errno) : "ok");
    printf("inside=%s\n", open("inside.txt", O_WRONLY | O_CREAT, 0644) < 0 ? strerror(errno) : "ok");
    return 0;
  }
  if (!strcmp(mode, "fail")) {
    printf("out");
    fprintf(stderr, "thread 'main' (%d) panicked at x.rs:1:1:\nboom\nstack backtrace:\n   0: f\n             at x.rs:1\nnote: end\n", getpid());
    return 101;
  }
  if (!strcmp(mode, "random")) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); printf("%ld\n", t.tv_nsec); return 0; }
  if (!strcmp(mode, "sleep")) {
    pid_t c = fork();
    if (c == 0) { sleep(100); return 0; }
    printf("child=%d\n", c);
    fflush(stdout);
    sleep(100);
    return 0;
  }
  if (!strcmp(mode, "setsid")) {
    pid_t c = fork();
    if (c == 0) { setsid(); close(0); close(1); close(2); sleep(100); return 0; }
    printf("child=%d\n", c);
    return 0;
  }
  if (!strcmp(mode, "libtest")) {
    printf("running 1 test\ntest t ... FAILED\n\nfailures:\n\n---- t stdout ----\n\nthread 't' (%d) panicked at x.rs:1:1:\nboom\n\ntest result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.%02lds\n", getpid(), (long)(getpid() % 100));
    return 101;
  }
  if (!strcmp(mode, "abort")) abort();
  return 0;
}
`;

/** The fake compiler: copies the program to the path after the `-o` the wrapper appends (its last word). */
const FAKE = ["/bin/sh", "-c", 'eval last=\\${$#}; cp "$1" "$last"', "sh", PROG];

beforeAll(() => {
  if (process.platform !== "darwin") return;
  writeFileSync(join(TMP, "prog.c"), C);
  const r = Bun.spawnSync(["cc", "-o", PROG, join(TMP, "prog.c")], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
});

const run = (opts: string[], compiler: string[] = FAKE) => {
  const r = Bun.spawnSync([process.execPath, NATIVE_RUN, "--dir", DIR, "--side", "oracle", ...opts, "--", ...compiler], {
    cwd: TMP,
    env: { ...process.env, RUST_BACKTRACE: "1", CALLER: "x" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const field = (out: string, k: string) => out.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1);

describe.skipIf(process.platform !== "darwin")("native-run on this host", () => {
  test("the program's argv, cwd and environment: compiletest's, nothing inherited", () => {
    const r = run(["--lib-path", "/L", "--env", "FOO=a=b", "--env", "GONE=x", "--unset", "GONE", "--arg", "env", "--arg", "y z"]);
    expect(field(r.out, "RUST_TEST_TMPDIR")).toBe(join(DIR, "tmp"));
    expect(field(r.out, "RUST_TEST_THREADS")).toBe("<unset>");
    expect(r.code, r.err).toBe(0);
    expect(r.out.startsWith("native-run: exit 0\nnative-run: program stdout follows\nargv0=")).toBe(true);
    expect(r.err).toBe("native-run: program stderr follows\n");
    expect(field(r.out, "argv0")).toBe(join(DIR, "work", "a"));
    expect(field(r.out, "cwd")).toBe(join(realpathSync(DIR), "work"));
    expect(field(r.out, "PATH")).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
    expect(field(r.out, "HOME")).toBe(join(DIR, "home"));
    expect(field(r.out, "TMPDIR")).toBe(join(DIR, "tmp"));
    // Through SIP's removal of DYLD_* (see runProgram): the lib paths, then the aux dir.
    expect(field(r.out, "DYLD_LIBRARY_PATH")).toBe(`/L:${join(DIR, "work", "auxiliary")}`);
    expect(field(r.out, "FOO")).toBe("a=b");
    expect(field(r.out, "GONE")).toBe("<unset>");
    expect(field(r.out, "RUST_BACKTRACE")).toBe("<unset>");
    expect(field(r.out, "CALLER")).toBe("<unset>");
    expect(r.out.split("\n").filter((l) => l.startsWith("arg="))).toEqual(["arg=y z"]);
    // The work directory goes with the run; the lock too.
    expect(existsSync(join(DIR, "work"))).toBe(false);
    expect(existsSync(join(DIR, "work.lock"))).toBe(false);
    // A libtest program runs one test at a time; a test's own exec-env still wins (root's decision for review harness-m7b F1).
    expect(field(run(["--libtest", "--arg", "env"]).out, "RUST_TEST_THREADS")).toBe("1");
    expect(field(run(["--libtest", "--env", "RUST_TEST_THREADS=4", "--arg", "env"]).out, "RUST_TEST_THREADS")).toBe("4");
  }, 30_000);

  test("the sandbox: no network, even localhost; no writes outside the case directory", () => {
    const outside = join(TMP, "outside.txt");
    const r = run(["--arg", "sandbox", "--arg", outside]);
    expect(r.code, r.err).toBe(0);
    expect(field(r.out, "connect")).toBe("Operation not permitted");
    expect(field(r.out, "outside")).toBe("Operation not permitted");
    expect(field(r.out, "inside")).toBe("ok");
    expect(existsSync(outside)).toBe(false);
  }, 20_000);

  test("a failing run: its exit, its output verbatim, backtraces cut, compiletest's verdict; two runs equal but for the thread id", () => {
    const r = run(["--runs", "2", "--expect", "run-fail", "--error-pattern", " boom ", "--error-pattern", "nope", "--regex-error-pattern", " pan+icked", "--regex-error-pattern", "(?x)a", "--arg", "fail"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe(
      [
        "native-run: exit 101",
        "native-run: compiletest run-fail: met (Fail)",
        "native-run: compiletest error-pattern 'boom': found",
        "native-run: compiletest error-pattern 'nope': not found",
        "native-run: compiletest regex-error-pattern 'pan+icked': found",
        "native-run: compiletest regex-error-pattern '(?x)a': unchecked (not a JS regex)",
        "native-run: program stdout follows",
        "out",
      ].join("\n"),
    );
    expect(r.err).toMatch(/^native-run: program stderr follows\nthread 'main' \(\d+\) panicked at x\.rs:1:1:\nboom\nstack backtrace: <cut>\nnote: end\n$/);
    expect(unstableOracleReason(r.err)).toBeUndefined();
  }, 20_000);

  test("libtest's output: its time and the thread id on stdout are masked when the two runs are compared", () => {
    const r = run(["--runs", "2", "--expect", "run-fail", "--arg", "libtest"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("test result: FAILED.");
    expect(unstableOracleReason(r.err)).toBeUndefined();
  }, 20_000);

  test("the oracle's two runs differ: the unstable mark, which difftest reads; one run never has it", () => {
    const two = run(["--runs", "2", "--arg", "random"]);
    expect(two.code).toBe(0);
    expect(two.err.endsWith(`${UNSTABLE_MARK}the two runs' stdout differ\n`)).toBe(true);
    expect(unstableOracleReason(two.err)).toContain("native-run");
    expect(run(["--arg", "random"]).err).toBe("native-run: program stderr follows\n");
  }, 30_000);

  test("a timeout kills the program's whole group, and is unstable on the oracle's side", () => {
    // Room for perl, sandbox-exec, env and the first exec of a freshly written binary (over 1 s under load, review harness-m7b N4) before the
    // program prints its child.
    const r = run(["--run-timeout", "4000", "--arg", "sleep"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out.split("\n")[0]).toBe("native-run: timed out after 4000 ms");
    const child = Number(field(r.out, "child"));
    expect(child).toBeGreaterThan(0);
    expect(() => process.kill(child, 0)).toThrow();
    expect(runsDiffer({ end: { timedOut: 300 }, stdout: "", stderr: "" }, { end: { timedOut: 300 }, stdout: "", stderr: "" })).toBe("a run timed out");
  }, 30_000);

  test("a child that leaves the group with setsid() is killed after the run (review harness-m7b N1)", () => {
    const r = run(["--arg", "setsid"]);
    expect(r.code, r.err).toBe(0);
    const child = Number(field(r.out, "child"));
    expect(child).toBeGreaterThan(0);
    expect(() => process.kill(child, 0)).toThrow();
  }, 20_000);

  test("a crash, and compiletest's run-crash", () => {
    const r = run(["--expect", "run-crash", "--arg", "abort"]);
    expect(r.out.split("\n").slice(0, 2)).toEqual(["native-run: signal SIGABRT", "native-run: compiletest run-crash: met (Crash)"]);
  }, 20_000);

  test("the compiler's failure passes through; no program is said so", () => {
    const failed = run([], ["/bin/sh", "-c", "echo out; echo err >&2; exit 70", "sh"]);
    expect([failed.code, failed.out, failed.err]).toEqual([70, "out\n", "err\n"]);
    const none = run([], ["/bin/sh", "-c", "exit 0", "sh"]);
    expect([none.code, none.out, none.err]).toEqual([0, "native-run: no program\n", ""]);
  }, 20_000);
});

test("the case directory, the command line and the pure parts", () => {
  expect(nativeDirRefusal(DIR)).toBeUndefined();
  for (const bad of ["native/unit/0123456789abcdef", join(TMP, "native", "unit", "0123"), join(TMP, "x", "unit", "0123456789abcdef"), join(TMP, "native=1", "native", "unit", "0123456789abcdef"), `${TMP}/native/../native/unit/0123456789abcdef`]) {
    expect(nativeDirRefusal(bad)).toContain("--dir");
  }
  expect(() => parseNativeRunArgs(["--dir", DIR, "--side", "oracle", "--runs", "3", "--", "rustc"])).toThrow("--runs");
  expect(() => parseNativeRunArgs(["--dir", DIR, "--side", "oracle", "--expect", "check-pass", "--", "rustc"])).toThrow("--expect");
  expect(() => parseNativeRunArgs(["--dir", DIR, "--side", "oracle", "--env", "=x", "--", "rustc"])).toThrow("K=V");
  expect(() => parseNativeRunArgs(["--dir", DIR, "--side", "oracle"])).toThrow("--");
  expect(parseNativeRunArgs(["--dir", DIR, "--side", "subject", "--", "rustc", "+x", "a.rs"]).compiler).toEqual(["rustc", "+x", "a.rs"]);
  // compiletest's order: the dylib path, exec-env over it, then unset-exec-env.
  expect(programEnv({ dir: "/d", libPaths: ["/l"], env: [["DYLD_LIBRARY_PATH", "/e"], ["HOME", "/h"]], unset: ["TMPDIR"], libtest: true }, "darwin")).toEqual({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/h", RUST_TEST_TMPDIR: "/d/tmp", RUST_TEST_THREADS: "1", DYLD_LIBRARY_PATH: "/e" });
  expect(programEnv({ dir: "/d", libPaths: ["/l"], env: [], unset: [], libtest: false }, "linux").LD_LIBRARY_PATH).toBe("/l:/d/work/auxiliary");
  expect(cutBacktraces("a\nstack backtrace:\n   0: x\n      at y\nb\nstack backtrace:")).toBe("a\nstack backtrace: <cut>\nb\nstack backtrace: <cut>");
  // RunResult: Fail is an exit code of 1 to 127, anything else not 0 a Crash.
  const v = (expect_: "run-pass" | "run-fail" | "run-fail-or-crash", end: Parameters<typeof compiletestVerdict>[1]) => compiletestVerdict({ expect: expect_, errorPatterns: [], regexErrorPatterns: [], checkStdout: false, shouldFail: false }, end, "", "")[0];
  expect(v("run-fail", { exit: 128 })).toBe("native-run: compiletest run-fail: not met (Crash)");
  expect(v("run-fail-or-crash", { signal: "SIGSEGV" })).toBe("native-run: compiletest run-fail-or-crash: met (Crash)");
  expect(v("run-pass", { exit: 1 })).toBe("native-run: compiletest run-pass: not met (Fail)");
  // check-stdout: stdout, then stderr.
  expect(compiletestVerdict({ expect: "run-fail", errorPatterns: ["ab"], regexErrorPatterns: [], checkStdout: true, shouldFail: false }, { exit: 1 }, "a", "b")[1]).toContain("found");
  expect(compiletestVerdict({ expect: "run-fail", errorPatterns: ["ab"], regexErrorPatterns: [], checkStdout: false, shouldFail: false }, { exit: 1 }, "a", "b")[1]).toContain("not found");
  // should-fail (review harness-m7b N5): met when any check fails, the check lines unchanged.
  const sf = (patterns: string[]) => compiletestVerdict({ expect: "run-fail", errorPatterns: patterns, regexErrorPatterns: [], checkStdout: false, shouldFail: true }, { exit: 101 }, "", "boom");
  expect(sf(["nope"]).at(-1)).toBe("native-run: compiletest should-fail: met (a check failed)");
  expect(sf(["boom"]).at(-1)).toBe("native-run: compiletest should-fail: not met (every check passed)");
  expect(sf(["nope"]).slice(0, 2)).toEqual(["native-run: compiletest run-fail: met (Fail)", "native-run: compiletest error-pattern 'nope': not found"]);
  // The masks the two runs and difftest share: libtest's time and a thread id on stdout; a program's own "finished in" text compares.
  const lt = (tid: number, t: string) => `---- t stdout ----\nthread 't' (${tid}) panicked at x.rs:1:1:\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in ${t}s\n`;
  expect(runsDiffer({ end: { exit: 0 }, stdout: lt(1, "0.01"), stderr: "" }, { end: { exit: 0 }, stdout: lt(2, "0.33"), stderr: "" })).toBeUndefined();
  expect(maskProgramOutput("finished in 0.01s\n")).toBe("finished in 0.01s\n");
  expect(maskProgramOutput("test result: ok. 0 passed; finished in <time>s")).toBe("test result: ok. 0 passed; finished in <<time>s");
  // difftest's comparison (`maskedTexts`): with the native suites' mask, stdout's thread id and time compare equal; without it, they differ.
  const render = (out: string) => `${out}\n--- stderr ---\n\n--- exit: 0 ---\n`;
  const [mo, ms] = maskedTexts(false, render(lt(1, "0.01")), render(lt(2, "0.40")), maskProgramOutput);
  expect(mo).toBe(ms);
  const [ro, rs] = maskedTexts(false, render(lt(1, "0.01")), render(lt(2, "0.40")));
  expect(ro).not.toBe(rs);
  // The pattern difftest reads is anchored to a line's start, and no other text has it.
  expect(UNSTABLE_ORACLE_PATTERNS.filter((p) => p.re.test(`x\n${UNSTABLE_MARK}y`)).length).toBe(1);
  expect(UNSTABLE_ORACLE_PATTERNS.some((p) => p.re.test(`x ${UNSTABLE_MARK}y`))).toBe(false);
});

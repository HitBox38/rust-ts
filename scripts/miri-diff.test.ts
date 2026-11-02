// Tests of scripts/miri-diff.ts (lane miri-diff, plan-m6 D10 / A6). The normalisation (scripts/lib/miri-trace.ts) runs
// in-process on real oracle trace fragments (scripts/fixtures/miri-diff/, captured from the isolated Miri oracle with
// `MIRI_LOG=info` on harness/corpus/miri/hello.rs and on a small panicking program; lines naming local paths left out).
// The CLI runs in child processes (it loads scripts/lib/common.ts; see scripts/lib/deps.test.ts for why).
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareTraces, firstEventDifference, maskAddresses, normaliseTrace, traceLine, traceText } from "./lib/miri-trace.ts";

const REPO = resolve(import.meta.dir, "..");
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "miri-diff", name), "utf8");

describe("normaliseTrace on real oracle fragments", () => {
  test("hello world's first lines: the frame span and statement events, indentation dropped", () => {
    expect(normaliseTrace(fixture("hello-start.stderr"))).toEqual({
      events: [
        "SPAN rustc_const_eval::interpret::stack::frame frame=std::rt::lang_start::<()>",
        "INFO rustc_const_eval::interpret::step StorageLive(_5)",
        "INFO rustc_const_eval::interpret::step StorageLive(_6)",
        "INFO rustc_const_eval::interpret::step StorageLive(_7)",
        "INFO rustc_const_eval::interpret::step StorageLive(_8)",
      ],
      other: [],
    });
  });

  test("a frame push and pop: every line a record, the child span's deeper lines are records too", () => {
    const t = normaliseTrace(fixture("hello-frames.stderr"));
    expect(t.other).toEqual([]);
    expect(t.events.length).toBe(23);
    expect(t.events.every((e) => /^(INFO|SPAN) \S+/.test(e) && !e.includes("\n"))).toBe(true);
    expect(t.events[6]).toBe("SPAN rustc_const_eval::interpret::stack::frame frame=std::mem::ManuallyDrop::<{closure@std::rt::lang_start_internal::{closure#0}}>::new");
    expect(t.events[7]!.startsWith("INFO miri::borrow_tracker retag_ptr_value: type=&dyn std::ops::Fn() -> i32 + std::marker::Sync + std::panic::RefUnwindSafe, mode=FnEntry, val=ScalarPair(")).toBe(true);
    expect(t.events.slice(15, 18)).toEqual([
      "INFO rustc_const_eval::interpret::call popping stack frame (returning from function)",
      "INFO miri::machine Leaving std::mem::ManuallyDrop::<{closure@std::rt::lang_start_internal::{closure#0}}>::new",
      "INFO miri::machine Continuing in std::panicking::catch_unwind::<isize, {closure@std::rt::lang_start_internal::{closure#0}}>",
    ]);
  });

  test("the last lines: an event outside every span (one space of indentation)", () => {
    expect(normaliseTrace(fixture("hello-end.stderr")).events).toEqual([
      "INFO rustc_const_eval::interpret::step return",
      "INFO rustc_const_eval::interpret::call popping stack frame (returning from function)",
      "INFO miri::machine Leaving std::rt::lang_start::<()>",
      "INFO miri::eval Additional static roots: [alloc43]",
    ]);
  });

  test("colours (RUSTC_LOG_COLOR=always: escapes and the padded ` INFO`) normalise to the plain trace", () => {
    const color = fixture("hello-start-end.color.stderr");
    expect(color).toContain("\x1b[1;32m INFO\x1b[0m");
    const plain = normaliseTrace(fixture("hello-start.stderr") + fixture("hello-end.stderr"));
    expect(normaliseTrace(color)).toEqual(plain);
  });

  test("the interpreted program's stderr between events is other, also when indented", () => {
    const t = normaliseTrace(fixture("panic-interleaved.stderr"));
    expect(t.other).toEqual(["about to panic", "  indented second line"]);
    expect(t.events).toEqual([
      "INFO rustc_const_eval::interpret::step // executing bb4",
      "INFO rustc_const_eval::interpret::step StorageDead(_13)",
      "INFO rustc_const_eval::interpret::step _6 = libc::unix::write(move _7, move _9, move _12) -> [return: bb5, unwind unreachable]",
      "INFO rustc_const_eval::interpret::step // executing bb5",
      "INFO rustc_const_eval::interpret::step StorageDead(_12)",
    ]);
  });

  test("the same records at another depth (tracing-tree wraps its indentation) normalise alike", () => {
    const deeper = fixture("hello-frames.stderr")
      .split("\n")
      .map((l) => (l === "" ? l : `${" ".repeat(40)}${l}`))
      .join("\n");
    expect(normaliseTrace(deeper)).toEqual(normaliseTrace(fixture("hello-frames.stderr")));
  });
});

describe("normaliseTrace: tracing-tree's other shapes (constructed after tracing-tree 0.4.1, no real fragment)", () => {
  test("a multi-line value: continuation lines (indented deeper, right after a record) join the record", () => {
    const t = normaliseTrace(["    INFO miri::machine first line", "       second line", "         third", "    INFO miri::machine next", "      not a continuation: follows nothing"].join("\n"));
    // (The last line follows a record and is deeper, so it is a continuation too: only a record start ends one.)
    expect(t.events).toEqual(["INFO miri::machine first line\n   second line\n     third", "INFO miri::machine next\n  not a continuation: follows nothing"]);
    expect(traceLine(t.events[0]!)).toBe("INFO miri::machine first line\\n   second line\\n     third");
    expect(traceText(t.events).split("\n").length).toBe(3);
  });
  test("a span without fields (tracing-tree writes `name ` with a trailing space) and an event without fields", () => {
    expect(normaliseTrace("   miri::concurrency::thread::run \n    INFO miri::eval\n").events).toEqual(["SPAN miri::concurrency::thread::run", "INFO miri::eval"]);
  });
  test("lines at column 0, blank lines and the port's unported line are other; a blank line ends a continuation", () => {
    const t = normaliseTrace("rust-ts: unported: x (y)\n  INFO miri::eval a\n\n     deeper but after a blank line\n");
    expect(t.events).toEqual(["INFO miri::eval a"]);
    expect(t.other).toEqual(["rust-ts: unported: x (y)", "", "     deeper but after a blank line"]);
    expect(normaliseTrace("")).toEqual({ events: [], other: [] });
  });
});

describe("pointer addresses (lane harness-w36; offsets kept by lane harness-w37)", () => {
  test("a pointer's address is relative to its allocation's first address; its allocation id and tag, and bare integers, stay", () => {
    const t = normaliseTrace(
      [
        "  INFO miri::borrow_tracker retag_ptr_value: type=&u8, mode=Default, val=Scalar(0x20150[alloc27]<20>)",
        "    INFO miri::borrow_tracker retag_ptr_value: type=&dyn Fn(), mode=FnEntry, val=ScalarPair(0x20158[alloc27]<25>, 0x2a160[alloc28]<23>)",
        "  INFO miri::x val=Scalar(0x0000002a), p=0xdeadbeef[wildcard], q=0x20148[a27]",
        "",
      ].join("\n"),
    );
    expect(t.events).toEqual([
      "INFO miri::borrow_tracker retag_ptr_value: type=&u8, mode=Default, val=Scalar(0xADDR+0x0[alloc27]<20>)",
      "INFO miri::borrow_tracker retag_ptr_value: type=&dyn Fn(), mode=FnEntry, val=ScalarPair(0xADDR+0x8[alloc27]<25>, 0xADDR+0x0[alloc28]<23>)",
      "INFO miri::x val=Scalar(0x0000002a), p=0xADDR[wildcard], q=0xADDR-0x8[a27]",
    ]);
    expect(maskAddresses("x=0x1f")).toBe("x=0x1f");
  });

  // Real records of the cached oracle trace of tests/miri/hello (MIRI_LOG=info; stderr lines 4963-4976 and 5284-5331,
  // indentation shortened): `&str` pointers into alloc1, then a `OnceLock` in alloc223 and its `Once` field 0x38 in.
  const HELLO = [
    "  INFO miri::borrow_tracker retag_ptr_value: type=&str, mode=FnEntry, val=ScalarPair(0x20f46[alloc1]<492>, 0x000000000000000e)",
    "    INFO miri::borrow_tracker retag_ptr_value: type=*const str, mode=Raw, val=ScalarPair(0x20f46[alloc1]<495>, 0x000000000000000e)",
    "  INFO miri::borrow_tracker retag_ptr_value: type=&std::sync::OnceLock<std::sync::ReentrantLock<std::cell::RefCell<std::io::LineWriter<std::io::stdio::StdoutRaw>>>>, mode=Default, val=Scalar(0x20fe8[alloc223]<526>)",
    "    INFO miri::borrow_tracker retag_ptr_value: type=&std::sync::Once, mode=Default, val=Scalar(0x21020[alloc223]<538>)",
    "",
  ];
  /** HELLO with every address of the trace moved by `d` (another environment: every base shifts). */
  const shifted = (d: number, lines: string[] = HELLO): string =>
    lines.join("\n").replace(/0x([0-9a-f]+)(?=\[alloc)/g, (_m, h: string) => `0x${(parseInt(h, 16) + d).toString(16)}`);

  test("real trace fragments: the offset within an allocation shows, the environment's base shift does not", () => {
    const o = normaliseTrace(HELLO.join("\n")).events;
    expect(o.map((e) => /val=.*$/.exec(e)![0])).toEqual([
      "val=ScalarPair(0xADDR+0x0[alloc1]<492>, 0x000000000000000e)",
      "val=ScalarPair(0xADDR+0x0[alloc1]<495>, 0x000000000000000e)",
      "val=Scalar(0xADDR+0x0[alloc223]<526>)",
      "val=Scalar(0xADDR+0x38[alloc223]<538>)",
    ]);
    // Every base 0x1000 higher (e.g. a longer argv): same trace.
    expect(compareTraces(o, normaliseTrace(shifted(0x1000)).events)).toEqual({ kind: "match" });
    // The `Once` field at offset 0x30 instead of 0x38: the traces differ at that record (the old mask hid this).
    const wrongField = HELLO.map((l) => l.replace("0x21020[alloc223]", "0x21018[alloc223]"));
    expect(compareTraces(o, normaliseTrace(wrongField.join("\n")).events)).toEqual({ kind: "diverges", index: 3 });
    // Another allocation or tag still differs.
    expect(compareTraces(o, normaliseTrace(HELLO.join("\n").replace("[alloc223]<538>", "[alloc224]<538>")).events)).toEqual({ kind: "diverges", index: 3 });
    expect(compareTraces(o, normaliseTrace(HELLO.join("\n").replace("<538>", "<539>")).events)).toEqual({ kind: "diverges", index: 3 });
  });

  test("the bases are per trace and an address in a continuation line counts too", () => {
    const one = "  INFO m p=0x500[alloc9]\n";
    // Two normalisations do not share bases: each trace's first address of alloc9 is its own +0x0.
    expect(normaliseTrace(one).events).toEqual(["INFO m p=0xADDR+0x0[alloc9]"]);
    expect(normaliseTrace(one.replace("0x500", "0x900")).events).toEqual(["INFO m p=0xADDR+0x0[alloc9]"]);
    const t = normaliseTrace("  INFO m v=Foo {\n      a: 0x510[alloc9]<1>,\n    }\n  INFO m p=0x500[alloc9]\n");
    expect(t.events).toEqual(["INFO m v=Foo {\n    a: 0xADDR+0x0[alloc9]<1>,\n  }", "INFO m p=0xADDR-0x10[alloc9]"]);
    // 64-bit addresses do not lose precision.
    expect(maskAddresses("p=0xfffffffffffffff8[alloc3] q=0xffffffffffffffff[alloc3]")).toBe("p=0xADDR+0x0[alloc3] q=0xADDR+0x7[alloc3]");
  });
});

describe("comparing traces", () => {
  const o = ["SPAN a::frame frame=main", "INFO a::step x", "INFO a::step y"];
  test("verdicts", () => {
    expect(compareTraces(o, [...o])).toEqual({ kind: "match" });
    expect(compareTraces(o, ["SPAN a::frame frame=main", "INFO a::step z", "INFO a::step y"])).toEqual({ kind: "diverges", index: 1 });
    expect(compareTraces(o, [])).toEqual({ kind: "port-stops", index: 0 });
    expect(compareTraces(o, o.slice(0, 2))).toEqual({ kind: "port-stops", index: 2 });
    expect(compareTraces(o, [...o, "INFO a::step w"])).toEqual({ kind: "port-extra", index: 3 });
    expect(firstEventDifference([], [])).toBe(-1);
  });
});

/**
 * Why the isolated Miri oracle cannot run here (scripts/lib/miri.ts `miriOracleProblem`, asked in a child process), or
 * undefined if it can. The real-run test is a visible skip with this reason (lane harness-w36; review miri-diff 7), and
 * a failure under RUST_TS_REQUIRE_PROBES=1.
 */
const MIRI_ORACLE_PROBLEM: string | undefined = (() => {
  const r = Bun.spawnSync(
    [process.execPath, "-e", `const m = await import(${JSON.stringify(join(REPO, "scripts/lib/miri.ts"))}); console.log(JSON.stringify(m.miriOracleProblem({ sysroot: true }) ?? null));`],
    { cwd: REPO, stdout: "pipe", stderr: "pipe" },
  );
  if (r.exitCode !== 0) return `cannot check the Miri oracle: ${r.stderr.toString().trim().split("\n")[0]}`;
  return JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!) ?? undefined;
})();
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

describe("the CLI (child processes)", () => {
  const runIds: string[] = [];
  afterAll(() => {
    const data = process.env.RUST_TS_DATA;
    if (data) for (const id of runIds) rmSync(join(resolve(data), "runs", id), { recursive: true, force: true });
  });
  const cli = (args: string[]) => {
    const r = Bun.spawnSync([process.execPath, join(REPO, "scripts", "miri-diff.ts"), ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString() };
  };
  test("usage without a case; ERROR lines for a non-Miri suite, a missing --case and an unknown case", () => {
    expect(cli([])).toMatchObject({ code: 0, out: expect.stringContaining("usage: bun scripts/miri-diff.ts") });
    expect(cli(["--suite", "parse", "--case", "x"])).toEqual({ code: 2, out: "ERROR: suite parse is not a Miri suite (Suite.miri)\n" });
    expect(cli(["/etc/hosts"])).toMatchObject({ code: 2, out: expect.stringContaining("ERROR: /etc/hosts is outside the repo") });
    expect(cli(["--suite", "miri-hello"])).toEqual({ code: 2, out: "ERROR: --suite miri-hello needs --case <id>\n" });
    expect(cli(["--suite", "miri-hello", "--case", "nope.rs"])).toEqual({ code: 2, out: "ERROR: no case nope.rs in miri-hello\n" });
    expect(cli(["no/such/file.rs"]).out).toStartWith("ERROR: no such file: ");
  });
  const realRun = MIRI_ORACLE_PROBLEM === undefined || REQUIRE ? test : test.skip;
  realRun(`a real run on miri-hello's program (needs the isolated Miri oracle: bun scripts/miri.ts setup)${MIRI_ORACLE_PROBLEM !== undefined ? ` (skipped: ${MIRI_ORACLE_PROBLEM})` : ""}`, () => {
    expect(MIRI_ORACLE_PROBLEM).toBeUndefined();
    const id = `miri-diff-test-${process.pid}`;
    runIds.push(id);
    const r = cli(["harness/corpus/miri/hello.rs", "--run-id", id]);
    const lines = r.out.trimEnd().split("\n");
    expect(lines[0]).toStartWith("miri-diff miri-hello harness/corpus/miri/hello.rs (port ");
    // The oracle's trace of hello world at the pin (plan-m6 D10: 22,954 lines, every one a record).
    expect(lines[1]).toStartWith("records: oracle 22954, port ");
    expect(r.out).not.toContain("ERROR:");
    expect(lines.at(-1)).toStartWith("files: ");
    const report = JSON.parse(readFileSync(join(lines.at(-1)!.slice("files: ".length), "report.json"), "utf8"));
    expect(report).toMatchObject({ suite: "miri-hello", case: "harness/corpus/miri/hello.rs", oracle: { code: 0, records: 22954, other: 0 } });
    // Until the Miri port runs hello world, the port stops (unported) before the first record; then this shows it.
    if (report.verdict.kind === "port-stops") expect(lines[2]).toStartWith(`port stops after ${report.verdict.index} of the oracle's 22954 records (`);
    expect(r.code).toBe(report.verdict.kind === "match" ? 0 : 1);
  }, 120_000);
});

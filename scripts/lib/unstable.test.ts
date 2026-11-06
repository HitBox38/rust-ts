// Unit tests of the comparison's mask (lane harness-w40; docs/handoff/ice-report-impl.md 5.2): what stays different and what
// compares equal. `equal` is the question `classify` asks of two rendered outputs (scripts/difftest.ts `compared`).
import { describe, expect, test } from "bun:test";
import { EXIT_MARK, STDERR_MARK, UNSTABLE_ORACLE_PATTERNS, isIceStderr, maskThreadId, maskedTexts, stderrMask, unstableOracleReason } from "./unstable.ts";

const render = (stdout: string, stderr: string, code = 101) => `${stdout}${STDERR_MARK}${stderr}${EXIT_MARK}${code} ---\n`;
const equal = (o: string, s: string, miri = false, ostdout = "", sstdout = ostdout) => {
  const [a, b] = maskedTexts(miri, render(ostdout, o), render(sstdout, s));
  return a === b;
};
const ICE_NOTE = "\nnote: we would appreciate a bug report: https://github.com/rust-lang/rust/issues/new\n";

describe("the plan's negative tests: still different", () => {
  test("1: a thread name", () => expect(equal("thread 'rustc' (1) panicked at a.rs:1:1:", "thread 'main' (1) panicked at a.rs:1:1:")).toBe(false));
  test("2: a location", () => expect(equal("thread 'rustc' (1) panicked at a.rs:1:1:", "thread 'rustc' (2) panicked at a.rs:1:2:")).toBe(false));
  test("3: a payload", () => expect(equal("thread 'rustc' (1) panicked at a.rs:1:1:\nBox<dyn Any>", "thread 'rustc' (2) panicked at a.rs:1:1:\nboom")).toBe(false));
  test("4: an id that is not digits", () => expect(equal("thread 'rustc' (1) panicked at a.rs:1:1:", "thread 'rustc' (abc) panicked at a.rs:1:1:")).toBe(false));
  test("5: an interpreted program's id on a Miri case, no ICE", () => expect(equal("thread 'main' (1000) panicked at a.rs:1:1:", "thread 'main' (1001) panicked at a.rs:1:1:", true)).toBe(false));
  test("6: stdout is never masked", () => expect(equal("", "", false, "thread 'a' (1) panicked\n", "thread 'a' (2) panicked\n")).toBe(false));
});

describe("further negative tests: still different", () => {
  test("a stdout that prints the stderr marker cannot put its own digits in the masked range", () => {
    const line = (n: number) => `x${STDERR_MARK}thread 'a' (${n}) panicked\n`;
    expect(equal("", "", false, line(1), line(2))).toBe(false);
  });
  test("a stderr that prints the marker masks less, so the part before it still compares", () => {
    expect(equal(`thread 'a' (1) panicked${STDERR_MARK}y`, `thread 'a' (2) panicked${STDERR_MARK}y`)).toBe(false);
  });
  test("the exit code", () => {
    const [a, b] = maskedTexts(false, render("", "thread 'a' (1) panicked", 101), render("", "thread 'a' (2) panicked", 1));
    expect(a === b).toBe(false);
  });
  test("a line that only looks like it", () => {
    for (const [o, s] of [
      ["LL | thread 'a' (1) panicked at x", "LL | thread 'a' (2) panicked at x"], // not at the line's start: source in a diagnostic
      ["thread 'a' (1) panicked", "thread 'a' (1 ) panicked"],
      ["thread 'a' (rtid 1) panicked", "thread 'a' (1) panicked"], // `rtid` kept
      ["thread 'a' (1) paniced", "thread 'a' (2) paniced"],
      ["thread a (1) panicked", "thread a (2) panicked"],
      ["thread 'a\nb' (1) panicked", "thread 'a\nb' (2) panicked"], // a name does not span lines
      ["thread 'a' (-1) panicked", "thread 'a' (-2) panicked"],
      ["thread 'a' (1.5) panicked", "thread 'a' (1.6) panicked"],
    ] as const) {
      expect([o, equal(o, s)]).toEqual([o, false]);
    }
  });
  test("no text equals a masked id: a literal `<tid>` stays different from digits", () => {
    expect(equal("thread 'a' (<tid>) panicked", "thread 'a' (5) panicked")).toBe(false);
    expect(equal("thread 'a' (<<tid>) panicked", "thread 'a' (<tid>) panicked")).toBe(false);
    expect(maskThreadId("thread 'a' (<tid>) panicked")).toBe("thread 'a' (<<tid>) panicked");
  });
  test("a line of its own: a different number of panics", () => {
    expect(equal("thread 'a' (1) panicked at x:\n", "thread 'a' (1) panicked at x:\nthread 'a' (1) panicked at x:\n")).toBe(false);
  });
  test("Miri: the subject's ICE does not turn the mask on for the oracle's program panic", () => {
    expect(equal("thread 'main' (1000) panicked at a.rs:1:1:\nboom\n", `thread 'main' (1001) panicked at a.rs:1:1:\nboom\n${ICE_NOTE}`, true)).toBe(false);
  });
});

describe("what compares equal", () => {
  test("differing digits", () => {
    expect(equal("thread 'rustc' (1) panicked at a.rs:1:1:\nboom", "thread 'rustc' (73787783) panicked at a.rs:1:1:\nboom")).toBe(true);
  });
  test("`rtid`", () => expect(equal("thread 'a' (rtid 5) panicked at x", "thread 'a' (rtid 6) panicked at x")).toBe(true));
  test("a nameless thread's name, and no name at all", () => {
    expect(equal("thread '<unnamed>' (1) panicked", "thread '<unnamed>' (2) panicked")).toBe(true);
    expect(equal("thread '' (1) panicked", "thread '' (2) panicked")).toBe(true);
  });
  test("in the middle of a multi-line stderr (`m`)", () => {
    expect(equal("error: x\n\nthread 'a' (1) panicked at x:\nmsg\nmore\n", "error: x\n\nthread 'a' (2) panicked at x:\nmsg\nmore\n")).toBe(true);
  });
  test("the first line of stderr, right after the marker", () => expect(equal("thread 'a' (1) panicked", "thread 'a' (2) panicked")).toBe(true));
  test("more than one occurrence (`g`), each with its own id", () => {
    expect(equal("thread 'a' (1) panicked at x\nthread 'b' (2) panicked at y\n", "thread 'a' (3) panicked at x\nthread 'b' (3) panicked at y\n")).toBe(true);
  });
  test("a Miri ICE, on both sides", () => {
    expect(equal(`thread 'rustc' (1) panicked at a.rs:1:1:\nboom\n${ICE_NOTE}`, `thread 'rustc' (2) panicked at a.rs:1:1:\nboom\n${ICE_NOTE}`, true)).toBe(true);
  });
  test("a text with no markers (a subject that timed out) stays as it is", () => {
    const [a, b] = maskedTexts(false, render("o", "thread 'a' (1) panicked"), "");
    expect(a).toBe(render("o", "thread 'a' (<tid>) panicked"));
    expect(b).toBe("");
  });
});

describe("the mask is a comparison's, not a detector's", () => {
  test("a thread id alone is no longer a reason for UNSTABLE; the other patterns still are", () => {
    expect(unstableOracleReason("thread 'rustc' (178972394) panicked at compiler/a.rs:1:1:\n")).toBeUndefined();
    expect(UNSTABLE_ORACLE_PATTERNS.some((p) => p.re.test("thread 'rustc' (rtid 5) panicked at x\n"))).toBe(false);
    expect(unstableOracleReason("note: please attach the file at `/u/rustc-ice-2026-10-21T11_18_00-4242.txt` to your bug report\n")).toContain("ICE note");
  });
  test("stderrMask: everyone but Miri always masks; Miri only on the oracle's ICE", () => {
    const line = "thread 'main' (1000) panicked at a.rs:1:1:\n";
    expect(stderrMask(false, "")(line)).toBe("thread 'main' (<tid>) panicked at a.rs:1:1:\n");
    expect(stderrMask(true, line)(line)).toBe(line);
    expect(isIceStderr(line + ICE_NOTE)).toBe(true);
    expect(stderrMask(true, line + ICE_NOTE)(line)).toBe("thread 'main' (<tid>) panicked at a.rs:1:1:\n");
  });
});

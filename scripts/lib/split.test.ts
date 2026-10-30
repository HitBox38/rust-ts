import { describe, expect, test } from "bun:test";
import { compareSections, mirBodyKey, splitHashes, splitMirPretty, splitRmetaDump, uniqueIds, type SplitOutput } from "./split.ts";

const PREAMBLE = [
  "// WARNING: This output format is intended for human consumers only",
  "// and is subject to change without notice. Knock yourself out.",
  "// HINT: See also -Z dump-mir for MIR at specific points during compilation.",
];

/** A body as `write_mir_fn` prints it (blank line between blocks, allocations after the `}`). */
const body = (header: string, ...extra: string[]): string[] => [header, "    let mut _0: ();", "", "    bb0: {", "        return;", "    }", "}", ...extra];

const ALLOC = ["", "alloc7 (size: 2, align: 1) {", "    61 62                                           │ ab", "}"];

/** Items of a `-Zunpretty=mir` output (each a list of lines), joined as `write_mir_pretty` does. */
const mir = (...items: string[][]): string => [...PREAMBLE, ...items.flatMap((it, i) => (i === 0 ? it : ["", ...it]))].join("\n") + "\n";

/** The output rebuilt from the skeleton and the sections. */
function rebuild(out: SplitOutput): string {
  const byId = new Map(out.sections.map((s) => [s.id, s.text]));
  return out.skeleton
    .split("\n")
    .map((l) => (l.startsWith("<<") && l.endsWith(">>") ? byId.get(l.slice(2, -2))! : l))
    .join("\n");
}

const A = body("fn a(_1: u8) -> () {", ...ALLOC);
const B = [...body("fn b() -> () {"), "", ...body("const b::promoted[0]: &u8 = {")];
const CF = [...body("fn cf() -> u8 {"), "", "// MIR FOR CTFE", ...body("fn cf() -> u8 {")];
const T = ["const T: u8 = const 3_u8;"];
const ANON = body("a::{constant#0}: usize = {");
const S = body("static mut S: <impl at x.rs:1:1: 1:8> = {");

describe("splitMirPretty", () => {
  const text = mir(A, B, CF, T, ANON, S);
  const out = splitMirPretty(text);

  test("one section per body, keyed by header (ctfe and promoted bodies are their own)", () => {
    expect(out.sections.map((s) => s.id)).toEqual([
      "fn a(_1: u8) -> ()",
      "fn b() -> ()",
      "const b::promoted[0]: &u8",
      "fn cf() -> u8",
      "fn cf() -> u8 [ctfe]",
      "const T: u8",
      "a::{constant#0}: usize",
      "static mut S: <impl at x.rs:1:1: 1:8>",
    ]);
  });

  test("allocations stay in their body; the CTFE comment starts its section", () => {
    expect(out.sections[0]!.text).toBe([...A].join("\n"));
    expect(out.sections[4]!.text.split("\n")[0]).toBe("// MIR FOR CTFE");
    expect(out.sections[5]!.text).toBe("const T: u8 = const 3_u8;");
  });

  test("skeleton holds the preamble, separators and ids; rebuilding gives the output back", () => {
    expect(out.skeleton.split("\n").slice(0, 5)).toEqual([...PREAMBLE, "<<fn a(_1: u8) -> ()>>", ""]);
    expect(rebuild(out)).toBe(text);
  });

  test("empty and preamble-only outputs have no sections", () => {
    expect(splitMirPretty("").sections).toEqual([]);
    const p = splitMirPretty(PREAMBLE.join("\n") + "\n");
    expect(p.sections).toEqual([]);
    expect(p.skeleton).toBe(PREAMBLE.join("\n") + "\n");
  });
});

describe("splitRmetaDump", () => {
  // As tools/probes/rmetadump prints it (rows indented, a multi-line value's lines by 4), after the wrapper's lines.
  const text = [
    "rmeta: 120 bytes, sha256 ab",
    "rmetadump foo",
    "== root",
    "  version \"rustc\"",
    "== crate_deps",
    "== def <crate root>",
    "  index 0",
    "  mir_for_ctfe",
    "    fn f() -> () {",
    "",
    "    }",
    "== def ::Clone",
    "  index 1",
    "== def ::Clone",
    "  index 2",
    "",
    "",
  ].join("\n");
  const out = splitRmetaDump(text);

  test("one section per == line, repeated keys numbered, empty sections kept", () => {
    expect(out.sections.map((s) => s.id)).toEqual(["root", "crate_deps", "def <crate root>", "def ::Clone", "def ::Clone @2"]);
    expect(out.sections[1]!.text).toBe("== crate_deps");
    expect(out.sections[2]!.text).toBe("== def <crate root>\n  index 0\n  mir_for_ctfe\n    fn f() -> () {\n\n    }");
  });

  test("the skeleton holds the lines outside sections and trailing empty lines", () => {
    expect(out.skeleton).toBe(["rmeta: 120 bytes, sha256 ab", "rmetadump foo", "<<root>>", "<<crate_deps>>", "<<def <crate root>>>", "<<def ::Clone>>", "<<def ::Clone @2>>", "", ""].join("\n"));
    expect(rebuild(out)).toBe(text);
  });

  test("no sections: everything is skeleton", () => {
    const o = splitRmetaDump("error: x\n");
    expect(o.sections).toEqual([]);
    expect(o.skeleton).toBe("error: x\n");
  });
});

describe("mirBodyKey", () => {
  test("drops the body's opening brace or a trivial const's value", () => {
    expect(mirBodyKey("fn f(_1: u8) -> u8 {")).toBe("fn f(_1: u8) -> u8");
    expect(mirBodyKey("const X: &dyn Iterator<Item = u8> = {")).toBe("const X: &dyn Iterator<Item = u8>");
    expect(mirBodyKey("const X: u8 = const 3_u8;")).toBe("const X: u8");
  });
});

describe("uniqueIds", () => {
  test("occurrence index among equal keys only", () => {
    expect(uniqueIds(["a", "b", "a", "a"])).toEqual(["a", "b", "a @2", "a @3"]);
  });
  test("a key that looks like an indexed id is never reused", () => {
    expect(uniqueIds(["a", "a @2", "a"])).toEqual(["a", "a @2", "a @3"]);
  });
});

describe("split comparison", () => {
  const D = body("fn d() -> () {");
  const oracle = splitHashes(splitMirPretty(mir(A, B, D)));

  test("identical output: every section matches, same skeleton", () => {
    const sub = splitHashes(splitMirPretty(mir(A, B, D)));
    expect(compareSections(oracle, sub)).toEqual({ outcomes: oracle.sections.map(([id]) => [id, "match"]), extra: [] });
    expect(sub.skeleton).toBe(oracle.skeleton);
  });

  test("missing section: not a match, the other ids do not shift, the skeleton differs", () => {
    const sub = splitHashes(splitMirPretty(mir(A, D)));
    const { outcomes, extra } = compareSections(oracle, sub);
    expect(outcomes).toEqual([
      ["fn a(_1: u8) -> ()", "match"],
      ["fn b() -> ()", "missing"],
      ["const b::promoted[0]: &u8", "missing"],
      ["fn d() -> ()", "match"],
    ]);
    expect(extra).toEqual([]);
    expect(sub.skeleton).not.toBe(oracle.skeleton);
  });

  test("two equal headers, one missing: the survivor takes the first id (ids follow occurrence)", () => {
    // Equal keys are told apart only by occurrence, so the survivor takes the first id: the first matches if equal.
    const o = splitHashes(splitMirPretty(mir(D, D)));
    const s = splitHashes(splitMirPretty(mir(D)));
    expect(compareSections(o, s).outcomes).toEqual([
      ["fn d() -> ()", "match"],
      ["fn d() -> () @2", "missing"],
    ]);
  });

  test("extra section: listed, every oracle section still matches, the skeleton differs", () => {
    const E = body("fn e() -> () {");
    const sub = splitHashes(splitMirPretty(mir(A, E, B, D)));
    const { outcomes, extra } = compareSections(oracle, sub);
    expect(outcomes.every(([, o]) => o === "match")).toBe(true);
    expect(extra).toEqual(["fn e() -> ()"]);
    expect(sub.skeleton).not.toBe(oracle.skeleton);
  });

  test("reordered sections: each matches by id, only the skeleton differs", () => {
    const sub = splitHashes(splitMirPretty(mir(D, A, B)));
    const { outcomes, extra } = compareSections(oracle, sub);
    expect(outcomes.every(([, o]) => o === "match")).toBe(true);
    expect(extra).toEqual([]);
    expect(sub.skeleton).not.toBe(oracle.skeleton);
  });

  test("a changed body differs; a changed separator only changes the skeleton", () => {
    const D2 = body("fn d() -> () {").map((l) => l.replace("return", "unreachable"));
    const changed = compareSections(oracle, splitHashes(splitMirPretty(mir(A, B, D2))));
    expect(changed.outcomes.at(-1)).toEqual(["fn d() -> ()", "differs"]);
    const noBlank = splitHashes(splitMirPretty([...PREAMBLE, ...A, ...B, "", ...D].join("\n") + "\n"));
    expect(compareSections(oracle, noBlank).outcomes.every(([, o]) => o === "match")).toBe(true);
    expect(noBlank.skeleton).not.toBe(oracle.skeleton);
  });
});

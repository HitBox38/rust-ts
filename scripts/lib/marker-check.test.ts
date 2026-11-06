// Unit tests of the `// rustc-call:` / `// rustc-const:` checks and the order report (scripts/lib/marker-check.ts), against
// the pinned upstream's proc_macro_attrs.rs and macro_attrs.rs: each kind of stale marker must fail.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anchorErrors, orderRows } from "./marker-check.ts";

const TMP = mkdtempSync(join(tmpdir(), "rust-ts-marker-check-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
let k = 0;
const errors = (text: string): string[] => {
  const f = join(TMP, `f${k++}.ts`);
  writeFileSync(f, text);
  return anchorErrors(f, "x.ts");
};
const FN = "// rustc: compiler/rustc_attr_parsing/src/attributes/proc_macro_attrs.rs:59 parse_derive_like\nfunction parse_derive_like(cx: any) {\n";
const anchored = (anchor: string, call: string) => `${FN}  // rustc-call: ${anchor}\n  ${call};\n}\n`;
const CONST = "compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs";

describe("rustc-call", () => {
  test("a good anchor", () => expect(errors(anchored("81:19", "cx.adcx().expected_not_literal(x)"))).toEqual([]));
  test("a text with no markers costs nothing", () => expect(errors("const x = 1;\n// The marker is `rustc-const:`, in prose.\n")).toEqual([]));
  test("the wrong line", () => expect(errors(anchored("82:19", "cx.adcx().expected_not_literal(x)"))[0]).toContain("no call of"));
  test("the wrong column: inside the name", () => expect(errors(anchored("81:20", "cx.adcx().expected_not_literal(x)"))[0]).toContain("no call of"));
  test("the wrong column: the receiver is not where the call starts", () => expect(errors(anchored("81:9", "cx.adcx().expected_not_literal(x)"))[0]).toContain("no call of"));
  test("a line past the end of the file", () => expect(errors(anchored("999999:1", "f(x)"))[0]).toContain("names nothing"));
  test("the TS call is another name: a call that moved away from its anchor", () => {
    expect(errors(anchored("81:19", "cx.adcx().expected_identifier(x)"))[0]).toContain("the next line calls no `expected_not_literal`");
  });
  test("a blank or comment line between the anchor and the call", () => {
    expect(errors(`${FN}  // rustc-call: 81:19\n\n  cx.adcx().expected_not_literal(x);\n}\n`)[0]).toContain("the next line calls no");
  });
  test("a position in another fn's body", () => {
    // convert, at :35, has its own body; 81:19 is parse_derive_like's.
    const other = "// rustc: compiler/rustc_attr_parsing/src/attributes/proc_macro_attrs.rs:35 convert\nfunction convert(cx: any) {\n  // rustc-call: 81:19\n  cx.adcx().expected_not_literal(x);\n}\n";
    expect(errors(other)[0]).toContain("no call of");
  });
  test("outside any marked fn", () => expect(errors("// rustc-call: 81:19\ncx.adcx().expected_not_literal(x);\n")[0]).toContain("outside any marked fn"));
  test("a marker naming no upstream file", () => {
    expect(errors("// rustc: compiler/nope/src/x.rs:1 f\nfunction f() {\n  // rustc-call: 1:1\n  g();\n}\n")[0]).toContain("no upstream file");
  });
  test("malformed", () => {
    expect(errors(anchored("81", "f(x)"))[0]).toContain("malformed");
    expect(errors(anchored("81:19 extra", "f(x)"))[0]).toContain("malformed");
  });
  test("keys of one kind that differ: an anchor on a sibling call, or a call with another message", () => {
    const v = (lit: string) => `// rustc: compiler/rustc_middle/src/ty/sty.rs:1765 ptr_metadata_ty_or_tail\nfunction f() {\n  // rustc-call: 1816:86\n  bug(\`${lit}\`);\n}\n`;
    expect(errors(v("`ptr_metadata_ty_or_tail` applied to unexpected type: {} (tail = {})".replaceAll("`", "\\`")))).toEqual([]);
    expect(errors(v("some other message"))[0]).toContain("in TS");
  });
});

describe("rustc-const", () => {
  test("a good marker", () => expect(errors(`// rustc-const: ${CONST}:45 ATTRIBUTES\nconst A = 1;\n`)).toEqual([]));
  test("text after the name is allowed, as `TEMPLATE = include_str!(..)` has it", () => {
    expect(errors("// rustc-const: compiler/rustc_borrowck/src/polonius/dump.rs:26 TEMPLATE = include_str!(\"./x\")\nconst A = 1;\n")).toEqual([]);
  });
  test("a stale line", () => expect(errors(`// rustc-const: ${CONST}:46 ATTRIBUTES\nconst A = 1;\n`)[0]).toContain("no `const ATTRIBUTES`"));
  test("the wrong name", () => expect(errors(`// rustc-const: ${CONST}:45 ATTRIBUTE\nconst A = 1;\n`)[0]).toContain("no `const ATTRIBUTE`"));
  test("no such file", () => expect(errors("// rustc-const: compiler/nope/src/x.rs:1 A\nconst A = 1;\n")[0]).toContain("no upstream file"));
  test("malformed", () => expect(errors(`// rustc-const: ${CONST} ATTRIBUTES\nconst A = 1;\n`)[0]).toContain("malformed"));
});

describe("the order report", () => {
  const m = (file: string, line: number, path = "p") => ({ file, path, line, name: `f${line}` });
  test("in order: no row", () => expect(orderRows([m("a", 1), m("a", 2), m("a", 2), m("a", 9)])).toEqual([]));
  test("one marker moved up counts once, however far", () => {
    expect(orderRows([m("a", 9), m("a", 1), m("a", 2), m("a", 3)])).toEqual([{ file: "a", path: "p", markers: 4, descents: 1, outOfOrder: 1, first: "f1:1 after f9:9" }]);
  });
  test("a block moved counts its length, in one descent", () => {
    expect(orderRows([m("a", 4), m("a", 5), m("a", 6), m("a", 1), m("a", 2), m("a", 3), m("a", 7)])[0]).toMatchObject({ descents: 1, outOfOrder: 3 });
  });
  test("two upstream files in one TS file, and one upstream file in two TS files, are separate", () => {
    expect(orderRows([m("a", 5, "p"), m("a", 1, "q"), m("b", 1, "p")])).toEqual([]);
  });
  test("worst first", () => {
    expect(orderRows([m("a", 2), m("a", 1), m("b", 3), m("b", 2), m("b", 1)]).map((r) => r.file)).toEqual(["b", "a"]);
  });
});

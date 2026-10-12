// Tests for src/std/result.ts. Panic texts come from a scratch program built with the pinned
// nightly (rustc 1.101.0-nightly 6f5da406b), printing each payload with `{:?}`:
//   #[derive(Debug)] enum E { Bad { code: u32, what: &'static str }, Unit }
//   Err::<u8, E>(E::Bad { code: 7, what: "x\ny" }).unwrap();
//     -> "called `Result::unwrap()` on an `Err` value: Bad { code: 7, what: \"x\\ny\" }"
//   Err::<u8, E>(E::Unit).expect("custom message");        -> "custom message: Unit"
//   Err::<u8, Vec<&str>>(vec!["a"]).expect("");             -> ": [\"a\"]"
//   Err::<u8, ()>(()).unwrap();                             -> "called `Result::unwrap()` on an `Err` value: ()"
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { debug_str, debug_struct, debug_vec, type Debug } from "./fmt.ts";
import { Panic } from "./panic.ts";
import { Err, expect_result, Ok, unwrap_result, type Result } from "./result.ts";

type E = { $: "Bad"; code: number; what: string } | { $: "Unit" };
const debug_E: Debug<E> = (v, f) => (v.$ === "Unit" ? "Unit" : debug_struct(f, "Bad", [["code", String(v.code)], ["what", debug_str(v.what)]]));

/** The exact message of the `Panic` `f` throws. */
function panicText(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof Panic) return e.message;
    throw e;
  }
  throw new Error("did not panic");
}

test("unwrap / expect panic texts (oracle)", () => {
  const bad: Result<number, E> = Err({ $: "Bad", code: 7, what: "x\ny" });
  expect(panicText(() => unwrap_result(bad, debug_E))).toBe('called `Result::unwrap()` on an `Err` value: Bad { code: 7, what: "x\\ny" }');
  expect(panicText(() => expect_result(Err({ $: "Unit" }) as Result<number, E>, "custom message", debug_E))).toBe("custom message: Unit");
  const list: Result<number, string[]> = Err<string[]>(["a"]);
  expect(panicText(() => expect_result(list, "", (v, f) => debug_vec(v, f, (s) => debug_str(s))))).toBe(': ["a"]');
  expect(panicText(() => unwrap_result(Err(undefined) as Result<number, undefined>, () => "()"))).toBe("called `Result::unwrap()` on an `Err` value: ()");
  expect(unwrap_result(Ok(3) as Result<number, E>, debug_E)).toBe(3);
  expect(expect_result(Ok(4) as Result<number, E>, "m", debug_E)).toBe(4);
});

/**
 * The one-argument `unwrap_result(r)` (no `E: Debug`, inexact panic text) is for unit tests only.
 * Outside `*.test.ts` files and `tests/` directories (and result.ts itself), every mention of
 * `unwrap_result` must be either an import/export specifier without `as`, or a direct call with at
 * least two arguments (a trailing comma is not an argument). Anything else (an alias such as
 * `unwrap_result as uw`, `const f = unwrap_result`, passing it as a value) is rejected, so the
 * one-argument form cannot be reached by another name.
 */
export function unwrapResultViolations(text: string): number[] {
  // Blank out comments and string/template literals (keeping offsets and newlines) so only code is scanned.
  const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, (m) =>
    m.startsWith('"') || m.startsWith("'") ? m[0] + m.slice(1, -1).replace(/[^\n]/g, " ") + m[0] : m.replace(/[^\n]/g, " "),
  );
  const specifiers: [number, number][] = [];
  for (const m of code.matchAll(/\b(?:import|export)\s+(?:type\s+)?\{[^}]*\}/g)) specifiers.push([m.index!, m.index! + m[0].length]);
  const bad: number[] = [];
  for (const m of code.matchAll(/\bunwrap_result\b/g)) {
    const at = m.index!;
    const after = code.slice(at + m[0].length);
    const lineOf = () => code.slice(0, at).split("\n").length;
    if (specifiers.some(([a, b]) => a <= at && at < b)) {
      if (/^\s+as\b/.test(after)) bad.push(lineOf());
      continue;
    }
    const call = /^\s*\(/.exec(after);
    if (!call) {
      bad.push(lineOf());
      continue;
    }
    // Top-level arguments of the call, ignoring a trailing comma.
    let depth = 1;
    let args = 0;
    let sawToken = false;
    for (let i = call[0].length; i < after.length && depth > 0; i++) {
      const c = after[i]!;
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      if (depth === 0) break;
      if (depth === 1 && c === ",") {
        if (sawToken) args++;
        sawToken = false;
      } else if (!/\s/.test(c)) sawToken = true;
    }
    if (sawToken) args++;
    if (args < 2) bad.push(lineOf());
  }
  return bad;
}

test("unwrap_result guard: rejects aliases, values and one-argument calls", () => {
  expect(unwrapResultViolations("import { unwrap_result } from './result.ts';\nunwrap_result(r, debug_E);")).toEqual([]);
  expect(unwrapResultViolations("unwrap_result(f(a, b), (v, f) => g(v, f))")).toEqual([]);
  expect(unwrapResultViolations("// unwrap_result(r)\nconst s = 'unwrap_result(r)';")).toEqual([]);
  expect(unwrapResultViolations("unwrap_result(r)")).toEqual([1]);
  expect(unwrapResultViolations("unwrap_result(r,)")).toEqual([1]);
  expect(unwrapResultViolations("unwrap_result(\n  f(a, b),\n)")).toEqual([1]);
  expect(unwrapResultViolations("import { unwrap_result as uw } from './result.ts';\nuw(r);")).toEqual([1]);
  expect(unwrapResultViolations("export { unwrap_result as uw } from './result.ts';")).toEqual([1]);
  expect(unwrapResultViolations("const uw = unwrap_result;\nuw(r);")).toEqual([1]);
  expect(unwrapResultViolations("xs.map(unwrap_result)")).toEqual([1]);
  expect(unwrapResultViolations("import * as R from './result.ts';\nR.unwrap_result(r);")).toEqual([2]);
});

test("non-test code never reaches the one-argument unwrap_result", () => {
  const repo = join(import.meta.dir, "..", "..");
  const bad: string[] = [];
  const rec = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "tests" && e.name !== "node_modules") rec(p);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && p !== join(import.meta.dir, "result.ts")) {
        for (const line of unwrapResultViolations(readFileSync(p, "utf8"))) bad.push(`${relative(repo, p)}:${line}`);
      }
    }
  };
  for (const d of ["src", "tools", "scripts", "harness"]) rec(join(repo, d));
  expect(bad).toEqual([]);
});

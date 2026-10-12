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
 * The one-argument `unwrap_result(r)` (no `E: Debug`, inexact panic text) is for unit tests only:
 * every call outside `*.test.ts` files and `tests/` directories must pass the error's Debug.
 */
test("non-test code always passes debug_err to unwrap_result", () => {
  const src = join(import.meta.dir, "..");
  const bad: string[] = [];
  const rec = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "tests") rec(p);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(/\bunwrap_result\(/g)) {
          // Find the call's top-level argument count by bracket matching.
          let depth = 1;
          let commas = 0;
          let i = m.index! + m[0].length;
          for (; i < text.length && depth > 0; i++) {
            const c = text[i]!;
            if (c === "(" || c === "[" || c === "{") depth++;
            else if (c === ")" || c === "]" || c === "}") depth--;
            else if (c === "," && depth === 1) commas++;
          }
          const line = text.slice(0, m.index).split("\n").length;
          const isDecl = /function\s+$/.test(text.slice(Math.max(0, m.index! - 20), m.index));
          if (!isDecl && commas === 0) bad.push(`${relative(src, p)}:${line}`);
        }
      }
    }
  };
  rec(src);
  expect(bad).toEqual([]);
});

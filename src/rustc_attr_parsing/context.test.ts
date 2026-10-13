// Unit scenarios for context.ts's port of the `attribute_parsers!` macro expansion (the
// `ATTRIBUTE_PARSERS` registry): one state object per parser type shared by all its paths, accept
// fns mutating it in place, `STATE_OBJECT.take()` in the finalizer (the state is reset to
// `default()` after each finalize), the deferred check computed before `finalize`, and the
// duplicate-path panic (`panic!("Attribute {path:?} has multiple accepters")`, `&[Symbol]` Debug).
// The real parser tables are attr-parse-b's; these use small hand-written trait tables.
import { expect, test } from "bun:test";
import type { AttributeKind } from "../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../rustc_feature/lib.ts";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { Panic } from "../std/panic.ts";
import { AttributeSafety, type AttributeParser as AttributeParserTrait } from "./attributes/mod.ts";
import { type AcceptContext, attribute_parsers, type FinalizeContext, path_key } from "./context.ts";
import "./lib.ts";
import { ArgParser } from "./parser.ts";
import { AllowedTargets } from "./target_checking.ts";
import { template } from "./template.ts";

interface Counter {
  n: number;
  seen: string[];
}

function counter_parser(paths: string[], log: string[]): AttributeParserTrait<Counter> {
  return {
    default: () => ({ n: 0, seen: [] }),
    ATTRIBUTES: paths.map(
      (p) =>
        [
          [Symbol.intern(p)],
          template({ Word: true }),
          AttributeStability.Stable,
          (s: Counter, _cx: AcceptContext, _args: ArgParser) => {
            s.n++;
            s.seen.push(p);
          },
        ] as const,
    ),
    ALLOWED_TARGETS: AllowedTargets.ManuallyChecked,
    SAFETY: AttributeSafety.Normal,
    finalize(s: Counter, _cx: FinalizeContext): AttributeKind | undefined {
      log.push(`finalize n=${s.n} seen=${s.seen.join(",")}`);
      return s.n === 0 ? undefined : { $: "Cold" } as AttributeKind;
    },
    deferred_finalize_check(s: Counter) {
      log.push(`deferred n=${s.n}`);
      return undefined;
    },
  };
}

test("attribute_parsers: one shared state per parser type, taken by the finalizer", () => {
  create_default_session_globals_then(() => {
    const log: string[] = [];
    const g = attribute_parsers([counter_parser(["aa", "bb"], log), counter_parser(["cc"], log)]);
    expect([...g.accepters.keys()]).toEqual([
      path_key([Symbol.intern("aa")]),
      path_key([Symbol.intern("bb")]),
      path_key([Symbol.intern("cc")]),
    ]);
    const aa = g.accepters.get(path_key([Symbol.intern("aa")]))!;
    const bb = g.accepters.get(path_key([Symbol.intern("bb")]))!;
    const cc = g.accepters.get(path_key([Symbol.intern("cc")]))!;
    expect(aa.safety).toBe(AttributeSafety.Normal);
    expect(aa.allowed_targets).toBe(AllowedTargets.ManuallyChecked);
    expect(aa.template.word).toBe(true);
    const cx = {} as AcceptContext;
    const fcx = {} as FinalizeContext;
    aa.accept_fn(cx, ArgParser.NoArgs);
    bb.accept_fn(cx, ArgParser.NoArgs);
    aa.accept_fn(cx, ArgParser.NoArgs);
    // `aa` and `bb` share the first type's state; `cc` has its own.
    expect(aa.finalizer(fcx).attr).toEqual({ $: "Cold" });
    // Taken: a second finalizer call of the same type sees a fresh `default()`.
    expect(bb.finalizer(fcx).attr).toBeUndefined();
    expect(cc.finalizer(fcx).attr).toBeUndefined();
    expect(log).toEqual([
      "deferred n=3",
      "finalize n=3 seen=aa,bb,aa",
      "deferred n=0",
      "finalize n=0 seen=",
      "deferred n=0",
      "finalize n=0 seen=",
    ]);
  });
});

test("attribute_parsers: a path with two accepters panics", () => {
  create_default_session_globals_then(() => {
    const log: string[] = [];
    let msg = "";
    try {
      attribute_parsers([counter_parser(["dup"], log), counter_parser(["dup"], log)]);
    } catch (e) {
      if (!(e instanceof Panic)) throw e;
      msg = e.message;
    }
    expect(msg).toBe('Attribute ["dup"] has multiple accepters');
  });
});

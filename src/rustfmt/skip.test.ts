// Unit tests for src/rustfmt/skip.ts (lane rustfmt-contract-3). skip.rs has no `#[cfg(test)]` tests upstream; these check
// the port against skip.rs's own logic (no `// rustc:` markers: nothing upstream to mirror).
import { expect, test } from "bun:test";
import { PathSegment } from "../rustc_ast/lib.ts";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { Ident } from "../rustc_span/symbol.ts";
import { SkipContext, SkipNameContext, clone_SkipContext, default_SkipContext, is_skip_attr } from "./skip.ts";

test("SkipNameContext: default, extend, skip", () => {
  const c = SkipNameContext.default_();
  expect(SkipNameContext.skip(c, "foo")).toBe(false);
  SkipNameContext.extend(c, ["foo", "bar"]);
  expect(SkipNameContext.skip(c, "foo")).toBe(true);
  expect(SkipNameContext.skip(c, "baz")).toBe(false);
});

test("SkipNameContext: skip_all replaces the value in place; All ignores extend and update", () => {
  const ctx = default_SkipContext();
  SkipNameContext.skip_all(ctx.macros);
  expect(ctx.macros.$).toBe("All");
  expect(SkipNameContext.skip(ctx.macros, "anything")).toBe(true);
  SkipNameContext.extend(ctx.macros, ["x"]);
  SkipNameContext.update(ctx.macros, { $: "Values", _0: new Set(["y"]) });
  expect(ctx.macros).toEqual({ $: "All" });
  expect(SkipNameContext.skip(ctx.attributes, "anything")).toBe(false);
});

test("SkipNameContext: update merges values, or becomes All", () => {
  const a = SkipNameContext.default_();
  SkipNameContext.extend(a, ["a"]);
  SkipNameContext.update(a, { $: "Values", _0: new Set(["b"]) });
  expect(SkipNameContext.skip(a, "a") && SkipNameContext.skip(a, "b")).toBe(true);
  SkipNameContext.update(a, { $: "All" });
  expect(a.$).toBe("All");
});

test("SkipContext: update and clone", () => {
  const base = default_SkipContext();
  const other = new SkipContext({ $: "Values", _0: new Set(["m"]) }, { $: "All" });
  const saved = clone_SkipContext(base);
  base.update(other);
  expect(SkipNameContext.skip(base.macros, "m")).toBe(true);
  expect(base.attributes.$).toBe("All");
  // the clone is independent of later updates (visitor.rs:452 saves and restores it)
  expect(SkipNameContext.skip(saved.macros, "m")).toBe(false);
  expect(saved.attributes.$).toBe("Values");
});

test("is_skip_attr", () => {
  create_default_session_globals_then(() => {
    const segs = (...names: string[]) => names.map((n) => PathSegment.from_ident(Ident.from_str(n)));
    expect(is_skip_attr(segs("rustfmt"))).toBe(false);
    expect(is_skip_attr(segs("rustfmt", "skip"))).toBe(true);
    expect(is_skip_attr(segs("rustfmt", "other"))).toBe(false);
    expect(is_skip_attr(segs("other", "skip"))).toBe(false);
    expect(is_skip_attr(segs("rustfmt", "skip", "macros"))).toBe(true);
    expect(is_skip_attr(segs("rustfmt", "skip", "attributes"))).toBe(true);
    expect(is_skip_attr(segs("rustfmt", "skip", "other"))).toBe(false);
    expect(is_skip_attr(segs("rustfmt", "skip", "macros", "x"))).toBe(false);
  });
});

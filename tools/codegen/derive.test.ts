// tools/codegen derives beyond Debug: derive(Clone) -> clone_<T>, derive(Walkable) -> walkable.gen.ts /
// mut_walkable.gen.ts (rustc_macros/src/visitable.rs), `<Enum>_discriminant` for derive(PartialOrd/Ord),
// Pu128's derived Debug, and skip entries for types the probe cannot see.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { debug_LitKind } from "../../src/rustc_ast/ast.ts";
import { PLAIN, PRETTY } from "../../src/std/fmt.ts";
import { generate, loadSet, loadTypeMap, type ProbeJson, REPO, type SetConfig } from "./types.ts";

const haveUpstream = existsSync(join(UPSTREAM, "compiler/rustc_ast/src/node_id.rs"));
const probe = (): ProbeJson => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "rustc_ast.typedefs.json"), "utf8"));
const run = (set: SetConfig) => {
  const src = join(REPO, "src");
  return generate(probe(), set, loadTypeMap(), { set: "rustc_ast", out: src, srcRoot: src, upstream: UPSTREAM });
};
const file = (res: ReturnType<typeof run>, rel: string) => res.files.get(join(REPO, "src", rel))!;

test.skipIf(!haveUpstream)("rustc_ast: clone, walkable and discriminant counts; manual Clone of Ty", () => {
  const res = run(loadSet("rustc_ast"));
  expect(res.report.errors).toEqual([]);
  expect(res.report.missing_clone).toEqual({});
  expect(res.report.manual_clone.map((m) => m.type)).toEqual(["rustc_ast::ast::Ty"]);
  const sum = (k: "clone_fns" | "walkable") => res.report.files.reduce((a, f) => a + f[k], 0);
  expect(sum("clone_fns")).toBe(231);
  expect(sum("walkable")).toBe(2 * 147);
  // derive(PartialOrd/Ord) on fieldless enums (+ TraitObjectSyntax's explicit discriminants)
  const disc = [...res.files.values()].flatMap((c) => [...c.matchAll(/^export const (\w+)_discriminant\b/gm)].map((m) => m[1]));
  expect(disc.sort()).toEqual(
    ["ExprPrecedence", "FloatTy", "IntTy", "Movability", "Mutability", "ParamKindOrd", "Pinnedness", "TraitObjectSyntax", "UintTy"].sort(),
  );
  expect(file(res, "rustc_ast/util/parser.gen.ts")).toContain(
    "export const ExprPrecedence_discriminant: Record<ExprPrecedence, number> = { Jump: 0, Assign: 1, Range: 2, LOr: 3, LAnd: 4, Compare: 5, BitOr: 6, BitXor: 7, BitAnd: 8, Shift: 9, Sum: 10, Product: 11, Cast: 12, Prefix: 13, Unambiguous: 14 };",
  );
  // visit::FnKind lives inside macro_rules! common_visitor_and_walkers: skipped with a reason
  expect(res.report.notes.some((n) => n.startsWith("rustc_ast::visit::FnKind: skipped by config") && n.includes("common_visitor_and_walkers"))).toBe(true);
});

test.skipIf(!haveUpstream)("derive(Walkable): field order, #[visitable(ignore)], #[visitable(extra = ..)], generic impls", () => {
  const res = run(loadSet("rustc_ast"));
  const ref = file(res, "rustc_ast/walkable.gen.ts");
  const mut = file(res, "rustc_ast/mut_walkable.gen.ts");
  // format.rs:178 FormatPlaceholder { argument, span, #[visitable(ignore)] format_trait, #[visitable(ignore)] format_options }
  expect(ref).toContain(
    [
      "  FormatPlaceholder: <R>(self: FormatPlaceholder, __visitor: Visitor<R>): R => {",
      "    let r: R | undefined;",
      "    if ((r = try_visit(__visitor.Result, Visitable.FormatArgPosition(self.argument, __visitor, undefined))) !== undefined) return r;",
      "    if ((r = try_visit(__visitor.Result, Visitable.Option(self.span, __visitor, undefined, Visitable.Span))) !== undefined) return r;",
      "    return __visitor.Result.output();",
      "  },",
    ].join("\n"),
  );
  // ast.rs:458 GenericParam: `bounds: GenericBounds` (= ThinVec<GenericBound>) with extra BoundKind::Bound
  expect(ref).toContain('Visitable["ThinVec<GenericBound>"](self.bounds, __visitor, BoundKind.Bound)');
  expect(mut).toContain('    MutVisitable["ThinVec<GenericBound>"](self, "bounds", __visitor, BoundKind.Bound);');
  // `Box<[(Symbol, Option<Symbol>, Span)]>` -> `[T]` over a tuple impl; Spanned and ThinVec<Box<..>> keys
  expect(ref).toContain(
    'Visitable["[T]"](self.template_strs, __visitor, undefined, (x, v, e) => Visitable["(T1, T2, T3)"](x, v, e, Visitable.Symbol, (x, v, e) => Visitable.Option(x, v, e, Visitable.Symbol), Visitable.Span))',
  );
  expect(mut).toContain(
    'MutVisitable.Vec(self, "operands", __visitor, undefined, <K extends PropertyKey>(o: Place<[InlineAsmOperand, Span], K>, k: K, v: MutVisitor, e: undefined) => MutVisitable["(T1, T2)"](o, k, v, e, MutVisitable.InlineAsmOperand, MutVisitable.Span));',
  );
  // a fieldless enum walks nothing
  expect(ref).toContain("  Safety: <R>(self: Safety, __visitor: Visitor<R>): R => {");
  expect(ref).toContain("  BinOpKind: <R>(_self: BinOpKind, __visitor: Visitor<R>): R => {\n    return __visitor.Result.output();\n  },");
});

test.skipIf(!haveUpstream)("derive(Clone): deep for owned data, shared for Arc, identity for handles; manual impl -> hand clone_<T>", () => {
  const res = run(loadSet("rustc_ast"));
  const ast = file(res, "rustc_ast/ast.gen.ts");
  const ts = file(res, "rustc_ast/tokenstream.gen.ts");
  expect(ast).toContain("export function clone_Path(v: Path): Path {\n  return new Path(v.span, v.segments.map(clone_PathSegment));\n}");
  expect(ast).toContain("import { clone_Ty, "); // manual `impl Clone for Ty` (ast.rs:2455)
  expect(ts).toContain("export function clone_TokenStream(v: TokenStream): TokenStream {\n  return new TokenStream(v._0);\n}"); // Arc<Vec<TokenTree>>
  expect(ts).toContain("export function clone_LazyAttrTokenStream(v: LazyAttrTokenStream): LazyAttrTokenStream {\n  return new LazyAttrTokenStream(v._0);\n}");
  expect(ts).toContain("export function clone_WithTokens<T>(v: WithTokens<T>, clone_T: (v: T) => T): WithTokens<T> {");
  // Spanned<T> is copied structurally; Range<T> through its template with identity element clones elided
  expect(ast).toContain('_2: { node: clone_RangeEnd(v._2.node), span: v._2.span }');
  expect(ts).toContain("_0: { start: v._0.start, end: v._0.end },");
});

test.skipIf(!haveUpstream)("a skip entry naming no item needs a skip_notes reason", () => {
  const set = { ...loadSet("rustc_ast"), skip_notes: {} };
  const res = run(set);
  expect(res.report.errors).toEqual([
    "skip entry rustc_ast::visit::FnKind matches no item of the set (named inside compiler/rustc_ast/src/visit.rs:382 macro_rules! common_visitor_and_walkers); add a skip_notes reason",
  ]);
});

test("Pu128 Debug is the derived tuple struct (oracle: -Zunpretty=hir-tree on `let _ = 1u8;`)", () => {
  const lit = { $: "Int", _0: 1n, _1: { $: "Unsigned", _0: "U8" } } as const;
  // rustc +nightly -Zunpretty=hir-tree: `node: Int(\n    Pu128(\n        1,\n    ),\n    Unsigned(\n        u8,\n    ),\n),`
  expect(debug_LitKind(lit, PRETTY)).toBe("Int(\n    Pu128(\n        1,\n    ),\n    Unsigned(\n        u8,\n    ),\n)");
  expect(debug_LitKind(lit, PLAIN)).toBe("Int(Pu128(1), Unsigned(u8))");
});

// Lane res-diag-b: diagnostics/impls.rs 1978..end (`show_candidates`, `UsePlacementFinder`, `add_typo_suggestion`,
// `check_for_module_export_macro` and its span helpers) against the oracle, byte for byte, on the `#![no_core]`
// crates in impls_b_oracle/.
//
// Fixtures: impls_b_oracle/<case>.rs -> <case>.stderr, rustc's stderr for
//   cd impls_b_oracle && rustc +nightly --crate-type lib --edition=2021 -Zcrate-attr=feature(no_core) \
//     -Zcrate-attr=no_core --emit=metadata -o <tmp> <case>.rs
// (regenerate with `REGEN=1 bun test src/rustc_resolve/diagnostics/impls_b.test.ts`; with the pinned toolchain
// present the last test re-runs the oracle and requires the fixtures to be current).
//
// What the test does in place of the pipeline that is not running yet (expansion, late resolution and the
// res-diag-a / res-late-diag callers): it parses the case with the ported parser (into the session's source map,
// under the same relative file name the oracle printed), builds the *outer* diagnostic exactly as the upstream
// caller builds it (message, code, primary label; e.g. `report_with_use_injections` + late diagnostics for
// E0425, `throw_unresolved_import_error` for E0432) and hands it to the ported function under test with the
// inputs rustc computes (the import candidates of `lookup_import_candidates`, the `TypoSuggestion`, the
// `Import`). Everything in the compared output that the ported function adds (notes, helps, suggestions and
// their spans, the `use` placement found by `UsePlacementFinder`) comes from the port. The diagnostic is
// rendered by the ported `AnnotateSnippetEmitter` and compared with the oracle's block for it.
//
// Test scaffolding (not ports): `NodeId`s for the `mod` items (expansion assigns them), `tcx.source_span` for
// the inaccessible-candidate cases (the def collector feeds it), and a resolver/import/module stand-in for
// `check_for_module_export_macro` (its `resolution` of the crate root yields a `macro_rules!` declaration).
//
// PENDING (end to end, through the driver): every path that needs the resolver pipeline (lint-early-a ->
// expansion -> late resolution) and other lanes' code: `unresolved_macro_suggestions` (needs
// `early_lookup_typo_candidate` / `lookup_import_candidates`, res-diag-a), `report_privacy_error` (`dcx`,
// res-diag-a), `report_path_resolution_error` / `make_path_suggestion` / `find_cfg_stripped` (reached from
// res-ident / res-imports / late once the pipeline runs).
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../lib.ts";
import { type Crate, type Item, Path, PathSegment } from "../../rustc_ast/lib.ts";
import { CRATE_NODE_ID, NodeId } from "../../rustc_ast/node_id.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { type Diag, DiagCtxt, DiagCtxtFlags_default, type DiagCtxtHandle, E0425, E0432, MultiSpan } from "../../rustc_errors/lib.ts";
import { MacroKinds, type Res } from "../../rustc_hir/def.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { new_parser_from_source_str } from "../../rustc_parse/lib.ts";
import { DefId, DefIndex, LOCAL_CRATE, type LocalDefId } from "../../rustc_span/def_id.ts";
import { BytePos, DUMMY_SP, type FileName, Span } from "../../rustc_span/lib.ts";
import { Ident, kw, Symbol } from "../../rustc_span/symbol.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../../vendor/anstream/stream.ts";
import { PIN } from "../../../scripts/lib/common.ts";
import { ImportData } from "../imports.ts";
import { type Resolver, Segment } from "../lib.ts";
import { with_resolver } from "../macros_oracle/with_resolver.ts";
import {
  DiagMode,
  extend_span_to_previous_binding,
  find_span_immediately_after_crate_name,
  find_span_of_binding_until_next_binding,
  type ImportSuggestion,
  import_candidates,
  show_candidates,
  TypoSuggestion,
  UsePlacementFinder,
} from "./impls.ts";

const DIR = join(import.meta.dir, "impls_b_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const CASES = ["cands_root", "cands_mod", "via_reexport", "refer_direct", "inaccessible", "inaccessible_many", "typo_prim", "typo_underscore", "macro_export"];

// ---- oracle side ------------------------------------------------------------------------------

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

function run_oracle(name: string): string {
  const tmp = mkdtempSync(join(tmpdir(), "res-diag-b-"));
  try {
    const r = Bun.spawnSync(
      ["rustc", `+${PIN.toolchain}`, "--crate-type", "lib", "--edition=2021", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core", "--emit=metadata", "-o", join(tmp, "out.rmeta"), `${name}.rs`],
      { cwd: DIR, stdout: "pipe", stderr: "pipe" },
    );
    return r.stderr.toString();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.env.REGEN === "1") {
  for (const name of CASES) writeFileSync(join(DIR, `${name}.stderr`), run_oracle(name));
}

/** The diagnostics of a rustc stderr, one block each (trailing blank line removed). */
function blocks(stderr: string): string[] {
  const out: string[] = [];
  let cur: string[] | undefined;
  for (const line of stderr.split("\n")) {
    if (/^(error|warning)(\[E\d{4}\])?: /.test(line)) {
      if (cur !== undefined) out.push(cur.join("\n").trimEnd());
      cur = [line];
    } else if (cur !== undefined) {
      cur.push(line);
    }
  }
  if (cur !== undefined) out.push(cur.join("\n").trimEnd());
  return out;
}

/** The oracle's diagnostics of `name` whose first line starts with `head`. */
function oracle(name: string, head: string): string[] {
  const all = blocks(readFileSync(join(DIR, `${name}.stderr`), "utf8"));
  const sel = all.filter((b) => b.startsWith(head));
  if (sel.length === 0) throw new Error(`ERROR: no oracle diagnostic \`${head}\` in ${name}.stderr`);
  return sel;
}

// ---- subject side -----------------------------------------------------------------------------

interface Ctx {
  r: Resolver;
  tcx: TyCtxt;
  krate: Crate;
  src: string;
  /** Span of the `nth` occurrence of `needle`. */
  sp: (needle: string, nth?: number) => Span;
  /** Span of the first occurrence of `needle` at or after string index `from`. */
  at: (needle: string, from: number) => Span;
  /** A `DiagCtxt` rendering through `AnnotateSnippetEmitter` into a buffer, and that buffer's text. */
  h: DiagCtxtHandle;
  out: () => string;
}

const contexts: Ctx[] = [];
/** Runs `f` with the session of `name` (via `with_resolver`), the case parsed under its relative name. */
function with_case<R>(name: string, f: (c: Ctx) => R): R {
  return with_resolver(join(DIR, `${name}.rs`), (r, _krate, tcx) => {
    const sess = tcx.sess;
    const sm = sess.source_map();
    const src = readFileSync(join(DIR, `${name}.rs`), "utf8");
    const file_name: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), `${name}.rs`) };
    const p = new_parser_from_source_str(sess.psess, file_name, src, "ShebangAndFrontmatter");
    if (p.$ !== "Ok") throw new Error("parser");
    const pr = p._0.parse_crate_mod();
    if (pr.$ !== "Ok") throw new Error("parse");
    const krate = pr._0;
    const base = sm.lookup_source_file(Span.lo(krate.spans.inner_span)).start_pos as number;
    const span_at = (at: number, needle: string): Span => {
      if (at < 0) throw new Error(`no ${needle}`);
      const lo = new TextEncoder().encode(src.slice(0, at)).length;
      return Span.with_root_ctxt(BytePos(base + lo), BytePos(base + lo + new TextEncoder().encode(needle).length));
    };
    const sp = (needle: string, nth = 0): Span => {
      let at = -1;
      for (let i = 0; i <= nth; i++) at = src.indexOf(needle, at + 1);
      return span_at(at, needle);
    };
    const at = (needle: string, from: number): Span => span_at(src.indexOf(needle, from), needle);
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
    const c: Ctx = { r, tcx, krate, src, sp, at, h: dcx.handle(), out: () => new TextDecoder().decode(buf.bytes()).trimEnd() };
    contexts.push(c);
    return f(c);
  });
}

const id = (s: string, span: Span = DUMMY_SP): Ident => Ident.new(Symbol.intern(s), span);
/** `crate::a::b` as the `ast::Path` `lookup_import_candidates` builds (dummy spans). */
function path_of(s: string): Path {
  return new Path(
    DUMMY_SP,
    s.split("::").map((n) => PathSegment.from_ident(Ident.with_dummy_span(n === "crate" ? kw.Crate : Symbol.intern(n)))),
  );
}
let next_index = 1;
function local_def_id(): DefId {
  return new DefId(DefIndex.from_u32(next_index++), LOCAL_CRATE);
}
function cand(path: string, descr: string, o: Partial<ImportSuggestion> = {}): ImportSuggestion {
  return { did: local_def_id(), descr, path: path_of(path), accessible: true, doc_visible: true, via_import: false, note: undefined, is_stable: true, ...o };
}
/** The item `mod <name>` (any depth). */
function mod_item(items: readonly Item[], name: string): Item | undefined {
  for (const item of items) {
    if (item.kind.$ === "Mod") {
      if (Symbol.as_str(item.kind._1.name) === name) return item;
      if (item.kind._2.$ === "Loaded") {
        const m = mod_item(item.kind._2._0, name);
        if (m !== undefined) return m;
      }
    }
  }
  return undefined;
}

/**
 * `report_with_use_injections` (impls.rs:397) for one `UseError` whose diagnostic late resolution built as
 * `E0425` + "not found in ..." label: placement via `UsePlacementFinder::check`, then `show_candidates`.
 */
function use_injection(c: Ctx, msg: string, span: Span, label: string, candidates: ImportSuggestion[], module: NodeId, path: Segment[]): string {
  const err: Diag = c.h.struct_span_err(span, msg).with_code(E0425);
  err.span_label(span, label);
  const [use_span, found_use] = UsePlacementFinder.check(c.krate, module);
  show_candidates(c.tcx, err, use_span, candidates, "No", found_use, DiagMode.Normal, path, "");
  err.emit();
  return c.out();
}

/** `tcx` whose `source_span` of the given local ids is fed (the def collector does this). */
function with_source_spans(tcx: TyCtxt, spans: Map<number, Span>): TyCtxt {
  return new Proxy(tcx, {
    get(t, k, recv) {
      if (k === "source_span") return (local: LocalDefId) => spans.get(local as unknown as number) ?? Reflect.get(t, k, recv).call(t, local);
      return Reflect.get(t, k, recv);
    },
  });
}

afterAll(() => void contexts.splice(0));

test("show_candidates: two accessible structs, crate root without `use` (FoundUse::No)", () => {
  const got = with_case("cands_root", (c) =>
    use_injection(c, "cannot find type `Foo` in this scope", c.sp("Foo", 2), "not found in this scope", [cand("crate::b::Foo", "struct"), cand("crate::a::Foo", "struct")], CRATE_NODE_ID, [Segment.from_ident(id("Foo", c.sp("Foo", 2)))]),
  );
  expect(got).toBe(oracle("cands_root", "error[E0425]")[0]!);
});

test("show_candidates + UsePlacementFinder: module with a `use` item (FoundUse::Yes)", () => {
  const got = with_case("cands_mod", (c) => {
    const m = mod_item(c.krate.items, "m")!;
    m.id = NodeId.from_u32(7);
    return use_injection(c, "cannot find function `helper` in this scope", c.sp("helper", 1), "not found in this scope", [cand("crate::a::helper", "fn")].map((x) => ({ ...x, descr: "function" })), m.id, [Segment.from_ident(id("helper", c.sp("helper", 1)))]);
  });
  expect(got).toBe(oracle("cands_mod", "error[E0425]")[0]!);
});

test("show_candidates: through a public re-export, nested module without `use` (inject span)", () => {
  const got = with_case("via_reexport", (c) => {
    const m = mod_item(c.krate.items, "m")!;
    m.id = NodeId.from_u32(9);
    return use_injection(c, "cannot find function `run` in this scope", c.sp("run", 2), "not found in this scope", [cand("crate::a::run", "function", { via_import: true })], m.id, [Segment.from_ident(id("run", c.sp("run", 2)))]);
  });
  expect(got).toBe(oracle("via_reexport", "error[E0425]")[0]!);
});

test("show_candidates: `if you import `Foo`, refer to it directly`", () => {
  const got = with_case("refer_direct", (c) => {
    const foo = c.sp("Foo", 1);
    const path = [Segment.from_ident(id("x", c.sp("x::"))), Segment.from_ident(id("Foo", foo))];
    path[0]!.ident = id("x", Span.with_hi(c.sp("x::"), Span.lo(c.sp("x::")) + 1 as BytePos));
    return use_injection(c, "cannot find type `Foo` in module `x`", foo, "not found in `x`", [cand("crate::a::Foo", "struct")], CRATE_NODE_ID, path);
  });
  expect(got).toBe(oracle("refer_direct", "error[E0425]")[0]!);
});

test("show_candidates: one inaccessible + one accessible candidate", () => {
  const got = with_case("inaccessible", (c) => {
    const priv = cand("crate::a::Foo", "struct", { accessible: false });
    c.tcx = with_source_spans(c.tcx, new Map([[priv.did!.index as number, c.sp("struct Foo;")]]));
    return use_injection(c, "cannot find type `Foo` in this scope", c.sp("Foo", 2), "not found in this scope", [priv, cand("crate::b::Foo", "struct")], CRATE_NODE_ID, [Segment.from_ident(id("Foo", c.sp("Foo", 2)))]);
  });
  expect(got).toBe(oracle("inaccessible", "error[E0425]")[0]!);
});

test("show_candidates: several inaccessible candidates", () => {
  const got = with_case("inaccessible_many", (c) => {
    const a = cand("crate::a::Foo", "struct", { accessible: false });
    const b = cand("crate::b::Foo", "struct", { accessible: false });
    c.tcx = with_source_spans(c.tcx, new Map([[a.did!.index as number, c.sp("struct Foo;")], [b.did!.index as number, c.sp("struct Foo;", 1)]]));
    return use_injection(c, "cannot find type `Foo` in this scope", c.sp("Foo", 2), "not found in this scope", [b, a], CRATE_NODE_ID, [Segment.from_ident(id("Foo", c.sp("Foo", 2)))]);
  });
  expect(got).toBe(oracle("inaccessible_many", "error[E0425]")[0]!);
});

test("add_typo_suggestion: builtin type (no definition span)", () => {
  const got = with_case("typo_prim", (c) => {
    const span = c.sp("u3");
    const err = c.h.struct_span_err(span, "cannot find type `u3` in this scope").with_code(E0425);
    err.span_label(span, "not found in this scope");
    const res: Res = { $: "PrimTy", _0: { $: "Uint", _0: "U32" } };
    c.r.add_typo_suggestion(err, new TypoSuggestion(Symbol.intern("u32"), undefined, res, "SimilarlyNamed"), span, undefined);
    err.emit();
    return c.out();
  });
  expect(got).toBe(oracle("typo_prim", "error[E0425]")[0]!);
});

test("add_typo_suggestion: `x` -> `_x` suggests renaming the binding", () => {
  const got = with_case("typo_underscore", (c) => {
    const span = c.sp("x;");
    const use_ = Span.with_hi(span, (Span.lo(span) + 1) as BytePos);
    const err = c.h.struct_span_err(use_, "cannot find value `x` in this scope").with_code(E0425);
    err.span_label(use_, "not found in this scope");
    const res: Res = { $: "Local", _0: NodeId.from_u32(3) };
    c.r.add_typo_suggestion(err, new TypoSuggestion(Symbol.intern("_x"), c.sp("_x"), res, "SimilarlyNamed"), use_, undefined);
    err.emit();
    return c.out();
  });
  expect(got).toBe(oracle("typo_underscore", "error[E0425]")[0]!);
});

// `check_for_module_export_macro` for the four imports of macro_export.rs, each reported as
// `throw_unresolved_import_error` (impls.rs:145) reports one `UnresolvedImportError` (note, label, suggestion,
// candidates).
test("check_for_module_export_macro (+ find_span_* helpers, import_candidates)", () => {
  const got = with_case("macro_export", (c) => {
    const decl = { res: (): Res => ({ $: "Def", _0: { $: "Macro", _0: MacroKinds.BANG }, _1: local_def_id() }) };
    const root = { parent: undefined, name: (): undefined => undefined };
    const m = { parent: root, name: () => Symbol.intern("m") };
    const r = Object.assign(Object.create(Object.getPrototypeOf(c.r)) as Resolver, {
      tcx_: c.tcx,
      resolution: (module: unknown) => (module === root ? { best_decl: () => decl } : undefined),
    });
    const line = (n: number): string => c.src.split("\n")[n - 1]!;
    const outs: string[] = [];
    // Per import: the line, the use tree's span (`import.span`), the visibility, the first path segment,
    // the rename target, whether the use tree is nested, the path printed in the message, the candidates.
    const cases: { line: number; span: string; vis: string; first: Symbol; target: string; nested: boolean; path: string; cands?: ImportSuggestion[] }[] = [
      { line: 9, span: "makro", vis: "", first: kw.Crate, target: "makro", nested: true, path: "crate::m::makro" },
      { line: 10, span: "makro as renamed", vis: "", first: kw.Crate, target: "renamed", nested: true, path: "crate::m::makro" },
      { line: 11, span: "crate::m::makro as plain", vis: "", first: kw.Crate, target: "plain", nested: false, path: "crate::m::makro" },
      { line: 13, span: "makro}", vis: "pub(crate)", first: kw.Super, target: "makro", nested: true, path: "super::m::makro", cands: [cand("crate::makro", "unresolved item", { via_import: true })] },
    ];
    for (const k of cases) {
      const from = c.src.indexOf(line(k.line));
      const use_span = c.at(line(k.line).trim(), from);
      let span = c.at(k.span, from);
      if (k.span === "makro}") span = Span.with_hi(span, (Span.hi(span) - 1) as BytePos);
      const vis_span = k.vis === "" ? Span.shrink_to_lo(use_span) : c.at(k.vis, from);
      const seg = c.at("makro", c.src.indexOf(k.span, from));
      const target = k.target === "makro" ? seg : c.at(k.target, from);
      const import_ = Object.assign(Object.create(ImportData.prototype) as ImportData, {
        kind: { $: "Single", source: id("makro", seg), target: id(k.target, target), nested: k.nested },
        span,
        use_span,
        vis_span,
        module_path: [Segment.from_ident(Ident.new(k.first, DUMMY_SP))],
      });
      const sugg = r.check_for_module_export_macro(import_, { $: "Module", _0: m as never }, id("makro", seg));
      if (sugg === undefined) throw new Error("no suggestion");
      const [suggestion, note] = sugg;
      const diag = c.h.struct_span_err(MultiSpan.from_spans([span]), `unresolved import \`${k.path}\``).with_code(E0432);
      diag.note(note!);
      diag.span_label(seg, "no `makro` in `m`");
      const [parts, msg, applicability] = suggestion!;
      diag.multipart_suggestion(msg, parts, applicability);
      if (k.cands !== undefined) import_candidates(c.tcx, diag, undefined, k.cands, DiagMode.Normal, "");
      const before = c.out().length;
      diag.emit();
      outs.push(c.out().slice(before).trim());
    }
    return outs;
  });
  expect(got).toEqual(oracle("macro_export", "error[E0432]"));
});

test("find_span_* on the upstream doc examples", () => {
  with_case("macro_export", (c) => {
    const snip = (s: Span): string => {
      const r = c.tcx.sess.source_map().span_to_snippet(s);
      return r.$ === "Ok" ? r._0.toString() : "<err>";
    };
    const sess = c.tcx.sess;
    // `use crate::m::{makro, Other};`: `makro, ` up to the next binding, no closing brace.
    const [brace1, s1] = find_span_of_binding_until_next_binding(sess, c.sp("makro", 1), c.sp("use crate::m::{makro, Other};"));
    expect([brace1, snip(s1)]).toEqual([false, "makro, "]);
    // `pub(crate) use super::m::{Other, makro};`: last binding, closing brace; extends back over `, `.
    const last = c.sp("makro}");
    const binding = Span.with_hi(last, (Span.hi(last) - 1) as BytePos);
    const [brace2, s2] = find_span_of_binding_until_next_binding(sess, binding, c.sp("pub(crate) use super::m::{Other, makro};"));
    expect([brace2, snip(s2)]).toEqual([true, "makro"]);
    expect(snip(extend_span_to_previous_binding(sess, s2)!)).toBe(", makro");
    // `use crate::m::{makro, Other};` -> after `crate::`: `m::{makro, Other};`, not nested right after it.
    const [nested, after] = find_span_immediately_after_crate_name(sess, c.sp("use crate::m::{makro, Other};"));
    expect([nested, snip(after)]).toEqual([false, "m::{makro, Other};"]);
  });
});

test("the fixtures are the current oracle output", () => {
  if (!rustc_at_pin()) {
    if (REQUIRE) throw new Error(`ERROR: rustc +${PIN.toolchain} at ${PIN.commit} not available`);
    return;
  }
  for (const name of CASES) expect({ name, stderr: run_oracle(name) }).toEqual({ name, stderr: readFileSync(join(DIR, `${name}.stderr`), "utf8") });
}, 120_000);

test("negative control: a changed candidate path is detected", () => {
  const got = with_case("cands_root", (c) =>
    use_injection(c, "cannot find type `Foo` in this scope", c.sp("Foo", 2), "not found in this scope", [cand("crate::b::Foo", "struct"), cand("crate::c::Foo", "struct")], CRATE_NODE_ID, [Segment.from_ident(id("Foo", c.sp("Foo", 2)))]),
  );
  expect(got).not.toBe(oracle("cands_root", "error[E0425]")[0]!);
  expect(existsSync(join(DIR, "cands_root.stderr"))).toBe(true);
});

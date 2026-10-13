// Oracle scenarios for lane attr-parse-a: `ArgParser::from_attr_args` (parser.rs) in every
// `ShouldEmit` mode and the accessors of its result, `MetaItemOrLitParser::parse_single`,
// `validate_attr::{parse_meta, check_builtin_meta_item, emit_malformed_attribute, check_attr}` and
// `AttributeTemplate::suggestions` (template.rs), over attributes parsed by the ported rustc_parse.
//
// Expectations: attr_oracle/out.json, produced by the rustc-dev probe attr_oracle/gen.rs (pinned
// nightly; how to rebuild it is in its header) over attr_oracle/cases.txt. `run_case` below is the
// probe's per-case body ported to the TS API; every event string, the fatal flag and the full
// -Zui-testing stderr must match byte for byte.
//
// The `limited:` scenarios (attr_oracle/list_gen.rs over list_cases.txt -> list_out.json) run
// `AttributeParser::parse_limited_all` on every attribute list of the crate with a real `Session`
// (rustc_interface::run_compiler, edition 2024). Here the `Session` is a stand-in that holds only the
// `ParseSess` (see `test_session`): the scenarios reach nothing else of it.
//
// PENDING: cases that reach code owned by a later lane (the generated diagnostics of
// rustc_attr_parsing's diagnostics.rs and the attribute parsers behind `ATTRIBUTE_PARSERS`, both lane
// attr-parse-b) must throw exactly the listed `Unported` until that lane lands; then they must match
// the oracle and root drops them from PENDING.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type * as ast from "../rustc_ast/lib.ts";
import { debug_MetaItem, debug_MetaItemLit } from "../rustc_ast/lib.ts";
import { debug_Token } from "../rustc_ast/token.ts";
import { AttrPath, debug_AttrPath, display_AttrPath } from "../rustc_attr_ir/lib.ts";
import { debug_MultiSpan } from "../rustc_error_messages/lib.gen.ts";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, FatalErrorMarker } from "../rustc_errors/lib.ts";
import { new_parser_from_source_str, parser as rustc_parse_parser, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import { Features, UnstableFeatures } from "../rustc_feature/lib.ts";
import { Options_default } from "../rustc_session/config.ts";
import { EarlySession, Session } from "../rustc_session/lib.ts";
import { ParseSess } from "../rustc_session/parse.ts";
import { create_session_globals_then, DUMMY_SP, debug_Span, type FileName, type Span } from "../rustc_span/lib.ts";
import { FilePathMapping, get_source_map, RealFileLoader } from "../rustc_span/source_map.ts";
import { debug_Ident, debug_Symbol, Symbol } from "../rustc_span/symbol.ts";
import { debug_list, debug_option, debug_str, PLAIN } from "../std/fmt.ts";
import { Unported, unwrap } from "../std/panic.ts";
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../vendor/anstream/stream.ts";
import { CRATE_NODE_ID } from "../rustc_ast/node_id.ts";
import { debug_Attribute as debug_hir_Attribute, target } from "../rustc_attr_ir/lib.ts";
import { debug_vec } from "../std/fmt.ts";
import { AttributeParser, AttributeTemplate, type ParsedDescription, type ShouldEmit } from "./lib.ts";
import "./lib.ts";
import { ArgParser, debug_ArgParser, debug_MetaItemOrLitParser, display_PathParser, MetaItemOrLitParser } from "./parser.ts";
import * as validate_attr from "./validate_attr.ts";

interface Case {
  name: string;
  ops: string;
  src: string;
  events: string[];
  fatal: boolean;
  stderr: string;
}
const oracle = JSON.parse(readFileSync(join(import.meta.dir, "attr_oracle", "out.json"), "utf8")) as Case[];

/** The first stub parser (lanes attr-parse-c/d) that building `ATTRIBUTE_PARSERS` reaches. */
const PARSERS_PENDING = "rustc_attr_parsing::attributes::allow_unstable::AllowInternalUnstableParser::PATH";
/** case -> the `Unported` it must reach until the owning lane (attr-parse-b) lands. */
const PENDING: Record<string, string> = {
  // `check_attr` on a builtin attribute asks `AttributeParser::is_parsed_attribute`, which builds
  // `ATTRIBUTE_PARSERS` from the attribute parsers (stubs of lanes attr-parse-c/d until they land;
  // the first one the registry build reaches is `Combine(AllowInternalUnstableParser)`).
  check_builtin: PARSERS_PENDING,
};

function leak_syms(s: string[]): Symbol[] {
  return s.map((x) => Symbol.intern(x));
}

/** The probe's `template`. */
function template(name: string): AttributeTemplate {
  const mk = (
    word: boolean,
    list: readonly string[] | undefined,
    one_of: readonly Symbol[],
    nv: readonly string[] | undefined,
    docs: string | undefined,
  ) => new AttributeTemplate(word, list, one_of, nv, docs);
  switch (name) {
    case "lint":
      return mk(
        false,
        ["lint1", "lint1, lint2, ...", 'lint1, lint2, lint3, reason = "..."'],
        [],
        undefined,
        "https://doc.rust-lang.org/reference/attributes/diagnostics.html#lint-check-attributes",
      );
    case "word":
      return mk(true, undefined, [], undefined, undefined);
    case "word_list":
      return mk(true, ["a", 'b = "c"'], [], undefined, undefined);
    case "nv":
      return mk(false, undefined, [], ["reason"], undefined);
    case "word_nv_docs":
      return mk(true, undefined, [], ["x"], "https://example.com/doc");
    case "oneof":
      return mk(false, undefined, leak_syms(["on", "off"]), undefined, undefined);
    case "many":
      return mk(true, ["a", "b"], [], ["c"], undefined);
    case "list_nv":
      return mk(false, ["x"], [], ["y", "z"], "https://example.com/l");
    case "empty":
      return mk(false, undefined, [], undefined, undefined);
    default:
      throw new Error(`template ${name}`);
  }
}

function mode(m: string): ShouldEmit {
  switch (m) {
    case "emit":
      return { $: "ErrorsAndLints", recovery: "Allowed" };
    case "forbid":
      return { $: "ErrorsAndLints", recovery: "Forbidden" };
    case "nothing":
      return { $: "Nothing" };
    case "fatal":
      return { $: "EarlyFatal", also_emit_lints: false };
    default:
      throw new Error(`mode ${m}`);
  }
}

const dbg_opt_span = (s: Span | undefined) => debug_option(s, PLAIN, debug_Span);
const dbg_no_args = (a: ArgParser) => {
  const r = ArgParser.as_no_args(a);
  return r.$ === "Ok" ? "Ok(())" : `Err(${debug_Span(r._0, PLAIN)})`;
};

/** The probe's `walk`. */
function walk(a: ArgParser, ev: string[], pre: string): void {
  ev.push(`${pre}span=${dbg_opt_span(ArgParser.span(a))} as_no_args=${dbg_no_args(a)}`);
  switch (a.$) {
    case "NoArgs":
      break;
    case "List": {
      const l = a._0;
      ev.push(`${pre}list len=${l.len()} is_empty=${l.is_empty()} single=${l.as_single() !== undefined} span=${debug_Span(l.span, PLAIN)}`);
      let i = 0;
      for (const item of l.mixed()) {
        ev.push(
          `${pre}[${i}] span=${debug_Span(MetaItemOrLitParser.span(item), PLAIN)} lit=${debug_option(MetaItemOrLitParser.as_lit(item), PLAIN, debug_MetaItemLit)}`,
        );
        const m = MetaItemOrLitParser.meta_item(item);
        if (m !== undefined) {
          const p = m.path();
          ev.push(
            `${pre}[${i}] path=${display_PathParser(p)} len=${p.len()} word=${debug_option(p.word(), PLAIN, debug_Ident)} ` +
              `word_sym=${debug_option(p.word_sym(), PLAIN, debug_Symbol)} ident=${debug_option(m.ident(), PLAIN, debug_Ident)} ` +
              `span=${debug_Span(m.span(), PLAIN)} no_args=${MetaItemOrLitParser.meta_item_no_args(item) !== undefined} ` +
              `attr_path=${debug_AttrPath(p.get_attribute_path(), PLAIN)}`,
          );
          walk(m.args(), ev, `${pre}[${i}].`);
        }
        i++;
      }
      break;
    }
    case "NameValue": {
      const nv = a._0;
      ev.push(
        `${pre}nv str=${debug_option(nv.value_as_str(), PLAIN, debug_Symbol)} ident=${debug_option(nv.value_as_ident(), PLAIN, debug_Ident)} ` +
          `args_span=${debug_Span(nv.args_span(), PLAIN)} eq_span=${debug_Span(nv.eq_span, PLAIN)} value_span=${debug_Span(nv.value_span, PLAIN)} ` +
          `lit=${debug_MetaItemLit(nv.value_as_lit(), PLAIN)}`,
      );
      break;
    }
  }
}

function attr_name(attr: ast.Attribute): Symbol {
  const segs = attr.get_normal_item().path.segments;
  return unwrap(segs[segs.length - 1]).ident.name;
}

/** The probe's `run_op`. */
function run_op(psess: ParseSess, attr: ast.Attribute, op: string, ev: string[], idx: number): void {
  const i = op.indexOf(":");
  const name = i < 0 ? op : op.slice(0, i);
  const arg = i < 0 ? "" : op.slice(i + 1);
  if (attr.kind.$ !== "Normal") {
    ev.push(`#${idx} ${op} => doc/synthetic`);
    return;
  }
  const item = attr.kind._0.item;
  const parts = item.path.segments.map((s) => s.ident.name);
  let r: string;
  switch (name) {
    case "args":
      r = debug_option(ArgParser.from_attr_args(item.args, parts, psess, mode(arg), "No"), PLAIN, debug_ArgParser);
      break;
    case "walk": {
      const a = ArgParser.from_attr_args(item.args, parts, psess, mode(arg), "No");
      const sub: string[] = [];
      if (a !== undefined) walk(a, sub, "  ");
      ev.push(`#${idx} ${op} => ${a !== undefined ? "Some" : "None"}`);
      ev.push(...sub);
      return;
    }
    case "single": {
      if (item.args.$ === "Delimited") {
        const d = item.args._0;
        const p = rustc_parse_parser.Parser.new(psess, d.tokens, undefined);
        const res = MetaItemOrLitParser.parse_single(p, mode(arg), "No");
        if (res.$ === "Ok") {
          r = `Ok(${debug_MetaItemOrLitParser(res._0, PLAIN)}) next=${debug_Token(p.token, PLAIN)}`;
        } else {
          res._0.emit();
          r = "Err";
        }
      } else {
        r = "not delimited";
      }
      break;
    }
    case "meta": {
      const res = validate_attr.parse_meta(psess, attr);
      if (res.$ === "Ok") {
        r = `Ok(${debug_MetaItem(res._0, PLAIN)})`;
      } else {
        res._0.emit();
        r = "Err";
      }
      break;
    }
    case "builtin": {
      const res = validate_attr.parse_meta(psess, attr);
      if (res.$ === "Ok") {
        validate_attr.check_builtin_meta_item(psess, res._0, attr.style, attr_name(attr), template(arg), true);
        r = "checked";
      } else {
        res._0.emit();
        r = "Err";
      }
      break;
    }
    case "malformed":
      validate_attr.emit_malformed_attribute(psess, attr.style, attr.span, attr_name(attr), template(arg));
      r = "emitted";
      break;
    case "suggest": {
      const j = arg.indexOf(":");
      const t = arg.slice(0, j);
      const dn = arg.slice(j + 1);
      const d: ParsedDescription = dn === "attr" ? "Attribute" : dn === "macro" ? "Macro" : (() => {
        throw new Error(`descr ${dn}`);
      })();
      const path = AttrPath.from_ast(item.path, (x) => x);
      r = debug_list(
        PLAIN,
        template(t)
          .suggestions(d, item.unsafety, display_AttrPath(path))
          .map((s) => debug_str(s)),
      );
      break;
    }
    case "check":
      validate_attr.check_attr(psess, attr);
      r = "checked";
      break;
    default:
      throw new Error(`op ${op}`);
  }
  ev.push(`#${idx} ${op} => ${r}`);
}

function run_case(c: Case): { events: string[]; fatal: boolean; stderr: string } {
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  const events: string[] = [];
  let fatal = false;
  let stderr = "";
  const ops = c.ops.split(/\s+/).filter((s) => s !== "");
  create_session_globals_then("Edition2024", [], inputs, () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const psess = ParseSess.with_dcx(DiagCtxt.new(em), sm);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    try {
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, fname, c.src, "Nothing"));
      const kr = p.parse_crate_mod();
      if (kr.$ === "Err") {
        kr._0.emit();
        events.push("parse_crate_mod => Err");
      } else {
        const krate = kr._0;
        const attrs: ast.Attribute[] = [...krate.attrs];
        for (const it of krate.items) attrs.push(...it.attrs);
        attrs.forEach((attr, idx) => {
          for (const op of ops) run_op(psess, attr, op, events, idx);
        });
        for (const l of psess.buffered_lints) {
          events.push(`buffered ${l.lint_id.lint.name} ${debug_option(l.span, PLAIN, debug_MultiSpan)}`);
        }
      }
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
      fatal = true;
    }
    psess.dcx().reset_err_count();
    stderr = new TextDecoder().decode(buf.bytes());
  });
  return { events, fatal, stderr };
}

for (const c of oracle) {
  test(`attr-parse-a oracle: ${c.name}`, () => {
    let got: ReturnType<typeof run_case> | undefined;
    let unported: string | undefined;
    try {
      got = run_case(c);
    } catch (e) {
      if (!(e instanceof Unported)) throw e;
      unported = e.what;
    }
    if (unported !== undefined) {
      expect(PENDING[c.name]).toBe(unported);
      return;
    }
    expect(PENDING[c.name]).toBeUndefined();
    expect(got!.events).toEqual(c.events);
    expect(got!.fatal).toBe(c.fatal);
    expect(got!.stderr).toBe(c.stderr);
  });
}

test("attr-parse-a oracle: every PENDING entry names a case", () => {
  const names = new Set(oracle.map((c) => c.name));
  for (const k of Object.keys(PENDING)) expect(names.has(k)).toBe(true);
});

const list_oracle = JSON.parse(readFileSync(join(import.meta.dir, "attr_oracle", "list_out.json"), "utf8")) as Case[];

/** list case -> the `Unported` it must reach until attr-parse-b lands. Every non-doc-comment
 *  attribute looks up `ATTRIBUTE_PARSERS`, whose list starts with the `Combine<..>` stub. */
const LIST_PENDING: Record<string, string> = {
  doc_raw: PARSERS_PENDING,
  unparsed: PARSERS_PENDING,
  parsed_basic: PARSERS_PENDING,
  parsed_nothing: PARSERS_PENDING,
  duplicates: PARSERS_PENDING,
  safety: PARSERS_PENDING,
  malformed: PARSERS_PENDING,
  unstable: PARSERS_PENDING,
  wrong_target: PARSERS_PENDING,
  diagnostic_namespace: PARSERS_PENDING,
};

/**
 * PORT(test): a `Session` that holds only `psess` and `opts` (through `EarlySession`) and
 * `unstable_features`; the target and the rest of the session are not reached by these scenarios
 * (`parse_limited_all` uses `sess.psess`, `sess.dcx()`, `sess.source_map()`, and feature gates).
 */
function test_session(psess: ParseSess): Session {
  const sess = Object.create(Session.prototype) as Session;
  // PORT(test, lane attr-parse-d): feature-gate errors (`feature_err`) read `sess.opts` (`ui_testing`,
  // `unstable_features`) and `sess.unstable_features`: the probe's `Options::default()` with edition
  // 2024, and `UnstableFeatures::from_environment(None)` as in `build_session`.
  const opts = Options_default();
  opts.edition = "Edition2024";
  sess.early_sess = new EarlySession(undefined as never, undefined as never, opts, psess);
  sess.unstable_features = UnstableFeatures.from_environment(undefined);
  return sess;
}

function run_list_case(c: Case): { events: string[]; fatal: boolean; stderr: string } {
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  const events: string[] = [];
  let fatal = false;
  let stderr = "";
  const ops = c.ops.split(/\s+/).filter((s) => s !== "");
  create_session_globals_then("Edition2024", [], inputs, () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const psess = ParseSess.with_dcx(DiagCtxt.new(em), sm);
    const sess = test_session(psess);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    try {
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, fname, c.src, "Nothing"));
      const kr = p.parse_crate_mod();
      if (kr.$ === "Err") {
        kr._0.emit();
        events.push("parse_crate_mod => Err");
      } else {
        const krate = kr._0;
        const lists: [readonly ast.Attribute[], target.Target, Span][] = [[krate.attrs, target.Target.Crate, krate.spans.inner_span]];
        for (const item of krate.items) lists.push([item.attrs, target.Target.from_ast_item(item), item.span]);
        lists.forEach(([attrs, t, target_span], idx) => {
          for (const op of ops.filter((op) => op !== "lints")) {
            const i = op.indexOf(":");
            const name = i < 0 ? op : op.slice(0, i);
            const arg0 = i < 0 ? "" : op.slice(i + 1);
            // `M+f1,f2`: the features enabled for this op (list_gen.rs, lane attr-parse-d)
            const j = arg0.indexOf("+");
            const arg = j < 0 ? arg0 : arg0.slice(0, j);
            const feats = j < 0 ? "" : arg0.slice(j + 1);
            const features = Features.default();
            for (const f of feats.split(",").filter((f) => f !== "")) {
              features.set_enabled_lang_feature({ gate_name: Symbol.intern(f), attr_sp: DUMMY_SP, stable_since: undefined });
            }
            if (name !== "limited") throw new Error(`op ${op}`);
            const r = AttributeParser.parse_limited_all(sess, attrs, undefined, t, target_span, CRATE_NODE_ID, features, mode(arg), undefined);
            events.push(`#${idx} ${op} => ${debug_vec(r, PLAIN, debug_hir_Attribute)}`);
          }
        });
        for (const l of psess.buffered_lints) {
          events.push(`buffered ${l.lint_id.lint.name} ${debug_option(l.span, PLAIN, debug_MultiSpan)}`);
        }
        // `lints`: render every buffered early lint (list_gen.rs, lane attr-parse-d)
        if (ops.includes("lints")) {
          const lints = psess.buffered_lints.splice(0);
          for (const l of lints) {
            const diag = l.diagnostic._0(psess.dcx(), { $: "Warning", _0: undefined }, sess);
            if (l.span !== undefined) {
              diag.span(l.span);
            }
            diag.emit();
          }
        }
      }
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
      fatal = true;
    }
    psess.dcx().reset_err_count();
    stderr = new TextDecoder().decode(buf.bytes());
  });
  return { events, fatal, stderr };
}

for (const c of list_oracle) {
  test(`attr-parse-a oracle (parse_limited_all): ${c.name}`, () => {
    let got: ReturnType<typeof run_list_case> | undefined;
    let unported: string | undefined;
    try {
      got = run_list_case(c);
    } catch (e) {
      if (!(e instanceof Unported)) throw e;
      unported = e.what;
    }
    if (unported !== undefined) {
      expect(LIST_PENDING[c.name]).toBe(unported);
      return;
    }
    expect(LIST_PENDING[c.name]).toBeUndefined();
    expect(got!.events).toEqual(c.events);
    expect(got!.fatal).toBe(c.fatal);
    expect(got!.stderr).toBe(c.stderr);
  });
}

test("attr-parse-a oracle (parse_limited_all): every LIST_PENDING entry names a case", () => {
  const names = new Set(list_oracle.map((c) => c.name));
  for (const k of Object.keys(LIST_PENDING)) expect(names.has(k)).toBe(true);
});

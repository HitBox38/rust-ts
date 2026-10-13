// Oracle scenarios for lane mbe-b: `compile_declarative_macro` (macro_rules! / macro 2.0 definition
// parsing and its errors, FOLLOW-set checks, `attr`/`derive` rules, the or-pattern lint, unused-rule
// detection), `MacroRulesMacroExpander` as `TTMacroExpander` (`expand_macro`, `try_match_macro`,
// `ParserAnyMacro::make`), `expand_with_safety` (`expand_macro_attr`), `expand_derive`, the slow error
// path (`failed_to_match_macro`, `CollectTrackerAndEmitter`, `emit_frag_parse_err`), `trace_macros`
// notes, and `transcribe` (repetitions, meta-variable expressions, `${concat}`, hygiene marks).
//
// Expectations: mbe_b_oracle/out.json, produced by the rustc-dev probe mbe_b_oracle/probe/main.rs (how to
// build it is in probe/Cargo.toml.in; `bun src/rustc_expand/mbe/mbe_b_oracle/gen.ts` regenerates the
// fixture) over mbe_b_oracle/cases/*.rs. `run_case` below is the probe's driver ported to the TS API;
// every event string (pretty-printed results, `{:#?}` ASTs with hygiene contexts, trace notes, the
// hygiene tables, buffered lints, gated spans) and the full stderr must match byte for byte.
//
// The `Session` is a stand-in holding the `ParseSess` and default options with the case's edition (as in
// attr_oracle.test.ts / mbe_oracle.test.ts). `Features` are set from the case's `#![feature(..)]`
// (the probe computes them with `rustc_expand::config::features` and prints them; the first event
// checks they agree). The `ResolverExpand` is the probe's: only `next_node_id` and
// `record_macro_rule_usage` are reachable.
//
// PENDING: cases that reach code owned by another lane must throw exactly the listed `Unported` until
// that lane lands; then they must match the oracle and root drops them from PENDING (a pending case
// that stops throwing fails, so nothing passes silently).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import "../../rustc_parse/lib.ts";
import { ast } from "../../rustc_ast/lib.ts";
import { DUMMY_NODE_ID, debug_NodeId, type NodeId } from "../../rustc_ast/node_id.ts";
import { TokenStream, debug_TokenStream } from "../../rustc_ast/tokenstream.ts";
import { HasAttrs, HasTokens } from "../../rustc_ast/lib.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import { debug_MultiSpan } from "../../rustc_error_messages/lib.gen.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, FatalErrorMarker, type ErrorGuaranteed } from "../../rustc_errors/lib.ts";
import { Features, UnstableFeatures } from "../../rustc_feature/lib.ts";
import { new_parser_from_source_str } from "../../rustc_parse/lib.ts";
import { Options_default, UnstableOptions_impl } from "../../rustc_session/config.ts";
import type { Options } from "../../rustc_session/options.gen.ts";
import { EarlySession, Session } from "../../rustc_session/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import { Hash64 } from "../../rustc_hashes/lib.ts";
import { DefPathHash, StableCrateId } from "../../rustc_span/def_id.ts";
import { debug_ExpnHash, debug_ExpnId, debug_hygiene_data, HygieneData, LocalExpnId, type MacroKind } from "../../rustc_span/hygiene.ts";
import { create_session_globals_then, DUMMY_SP, debug_Span, Span } from "../../rustc_span/lib.ts";
import { FilePathMapping, get_source_map, RealFileLoader } from "../../rustc_span/source_map.ts";
import { debug_Ident, debug_Symbol, Symbol } from "../../rustc_span/symbol.ts";
import { SourceSpanCache, StableHashState } from "../../rustc_middle/ich.ts";
import { debug_option, debug_vec, type Fmt, PRETTY, PLAIN } from "../../std/fmt.ts";
import { panic, Unported } from "../../std/panic.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../../vendor/anstream/stream.ts";
import type { ExtCtxt as ExtCtxtT, MacResult, ResolverExpand, SyntaxExtension } from "../base.ts";
import { ExtCtxt } from "../base.ts";
import { ExpansionConfig } from "../expand.ts";
import { compile_declarative_macro, type MacroRulesMacroExpander } from "./macro_rules.ts";

interface Case {
  name: string;
  edition: string;
  args: string[];
  events: string[];
  stderr: string;
  exit: number;
}
const oracle = JSON.parse(readFileSync(join(import.meta.dir, "mbe_b_oracle", "out.json"), "utf8")) as Case[];

/** case -> the `Unported` it must reach until the owning lane lands. */
// All three reach a `crate::diagnostics` stand-in of mbe/macro_check.rs (lane mbe-a), which stops with
// `unported` until mbe-a imports the generated diagnostics.rs (src/rustc_expand/diagnostics.gen.ts). With
// those stand-ins replaced by the generated impls, all 19 cases match the oracle (checked in an
// integration scratch, see docs/handoff/mbe-b.md).
const PENDING: Record<string, string> = {
  concat: "rustc_expand::diagnostics::MetaVarStillRepeatingLint",
  fragerr: "rustc_expand::diagnostics::UnknownMacroVariable",
  nested: "rustc_expand::diagnostics::UnknownMacroVariable",
};

function test_session(psess: ParseSess, opts: Options): Session {
  const sess = Object.create(Session.prototype) as Session;
  // PORT(test): the mbe code reads `sess.psess`, `sess.dcx()`, `sess.source_map()` and, through
  // `feature_err` / `SyntaxExtension::new`, `sess.opts` and `sess.unstable_features`.
  sess.early_sess = new EarlySession(undefined as never, undefined as never, opts, psess);
  sess.unstable_features = UnstableFeatures.from_environment(undefined);
  return sess;
}

type Kind = "Items" | "Expr" | "Ty" | "Stmts" | "Pat";

/** `#![feature(a, b)]` at the top of a case. */
function case_features(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^#!\[feature\(([^)]*)\)\]/gm)) {
    for (const f of m[1]!.split(",")) if (f.trim() !== "") out.push(f.trim());
  }
  return out;
}

function run_case(c: Case): { events: string[]; stderr: string } {
  const src = readFileSync(join(import.meta.dir, "mbe_b_oracle", "cases", `${c.name}.rs`), "utf8");
  const edition = `Edition${c.edition}` as Edition;
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  const ev: string[] = [];
  let stderr = "";
  create_session_globals_then(edition, [], inputs, () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    const opts = Options_default();
    opts.edition = edition;
    const dcx = DiagCtxt.new(em).with_flags(UnstableOptions_impl.dcx_flags(opts.unstable_opts, true));
    const psess = ParseSess.with_dcx(dcx, sm);
    const sess = test_session(psess, opts);

    // The probe's crate root `DefPathHash` (the `ExpnHash` prefix), from its first event.
    const m = /^crate_root DefPathHash\(Fingerprint\((\d+), (\d+)\)\)$/.exec(c.events[0]!);
    if (m === null) throw new Error("ERROR: first oracle event is not crate_root");
    ev.push(c.events[0]!);
    const root = DefPathHash.new(StableCrateId.of(Hash64.new(BigInt(m[1]!))), Hash64.new(BigInt(m[2]!)));
    const hcx = new StableHashState(
      {
        definitions: { def_path_hash: () => root },
        cstore: { def_path_hash: () => panic("cstore") },
        source_span: [],
      },
      false,
      { $: "Unused", _0: sm },
      { hash_spans: true },
      SourceSpanCache.default(),
    );

    try {
      // The probe's session first parsed its real (empty, `#![no_core]`) crate root, which allocated
      // two `AttrId`s (visible in `{:#?}` of attributes produced by the expansions).
      const root_p = new_parser_from_source_str(psess, { $: "Custom", _0: "probe-root" }, "#![feature(no_core)]\n#![no_core]\n", "Nothing");
      if (root_p.$ === "Err" || root_p._0.parse_crate_mod().$ === "Err") throw new Error("ERROR: probe root did not parse");
      const pr = new_parser_from_source_str(psess, { $: "Custom", _0: "case.rs" }, src, "Nothing");
      if (pr.$ === "Err") {
        for (const e of pr._0) e.emit();
        ev.push("parse error");
        return;
      }
      const kr = pr._0.parse_crate_mod();
      if (kr.$ === "Err") {
        kr._0.emit();
        ev.push("parse error");
        return;
      }
      const krate = kr._0;
      const crate_name = Symbol.intern("case");
      const features = Features.default();
      for (const f of case_features(src)) {
        features.set_enabled_lang_feature({ gate_name: Symbol.intern(f), attr_sp: DUMMY_SP, stable_since: undefined });
      }
      ev.push(`features ${debug_vec(features.enabled_lang_features().map((f) => f.gate_name), PLAIN, debug_Symbol)}`);
      const ecfg = ExpansionConfig.default(crate_name, features);
      ecfg.trace_mac = true;
      let next = 0x10000;
      // PORT(test): the probe's `ProbeResolver`; every other method is `unimplemented!()` there.
      const resolver = {
        next_node_id(): NodeId {
          next += 1;
          return next as NodeId;
        },
        record_macro_rule_usage(mac_id: NodeId, rule_index: number): void {
          ev.push(`record_macro_rule_usage ${debug_NodeId(mac_id, PLAIN)} ${rule_index}`);
        },
      } as unknown as ResolverExpand;
      const cx = ExtCtxt.new(sess, ecfg, resolver, undefined);
      const macros = new Map<Symbol, SyntaxExtension>();

      const fresh_expn = (ext: SyntaxExtension, call_site: Span, name: Symbol, kind: MacroKind): void => {
        const id = LocalExpnId.fresh_empty();
        const data = ext.expn_data(LocalExpnId.ROOT, call_site, name, kind, undefined, undefined);
        LocalExpnId.set_expn_data(id, data, hcx);
        cx.current_expansion.id = id;
        const eid = LocalExpnId.to_expn_id(id);
        ev.push(`expn ${debug_ExpnId(eid, PLAIN)} hash ${debug_ExpnHash(HygieneData.with((h) => h.local_expn_hashes[id]!), PLAIN)}`);
      };
      const traces = (): void => {
        for (const [sp, msgs] of cx.expansions) {
          for (const msg of msgs) ev.push(`trace ${debug_Span(sp, PLAIN)} ${msg}`);
        }
        cx.expansions.clear();
      };
      const make = (res: MacResult, kind: Kind): void => {
        switch (kind) {
          case "Items": {
            const items = res.make_items();
            if (items === undefined) return void ev.push("make_items None");
            for (const item of items) {
              ev.push(`item ${pprust.item_to_string(item)}`);
              ev.push(`ast ${ast.debug_Item(item, PRETTY, ast.debug_ItemKind)}`);
            }
            return;
          }
          case "Expr": {
            const e = res.make_expr();
            if (e === undefined) return void ev.push("make_expr None");
            ev.push(`expr ${pprust.expr_to_string(e)}`);
            ev.push(`ast ${ast.debug_Expr(e, PRETTY)}`);
            return;
          }
          case "Ty": {
            const t = res.make_ty();
            if (t === undefined) return void ev.push("make_ty None");
            ev.push(`ty ${pprust.ty_to_string(t)}`);
            ev.push(`ast ${ast.debug_Ty(t, PRETTY)}`);
            return;
          }
          case "Pat": {
            const p = res.make_pat();
            if (p === undefined) return void ev.push("make_pat None");
            ev.push(`pat ${pprust.pat_to_string(p)}`);
            ev.push(`ast ${ast.debug_Pat(p, PRETTY)}`);
            return;
          }
          case "Stmts": {
            const stmts = res.make_stmts();
            if (stmts === undefined) return void ev.push("make_stmts None");
            for (const s of stmts) {
              ev.push(`stmt ${pprust.stmt_to_string(s)}`);
              ev.push(`ast ${ast.debug_Stmt(s, PRETTY)}`);
            }
            return;
          }
        }
      };
      const bang = (mac: ast.MacCall, kind: Kind): void => {
        const name = mac.path.segments[0]!.ident.name;
        const span = mac.span();
        const ext = macros.get(name);
        if (ext === undefined) return void ev.push(`invoke ${Symbol.as_str(name)} (no such macro)`);
        ev.push(`invoke ${Symbol.as_str(name)}! as ${kind} at ${debug_Span(span, PLAIN)}`);
        fresh_expn(ext, span, name, "Bang");
        const k = ext.kind;
        if (k.$ === "MacroRules") {
          const r = k._0.as_TTMacroExpander().expand(cx, span, new TokenStream(mac.args.tokens._0));
          if (r.$ !== "Ready") throw new Error("Retry");
          make(r._0, kind);
          traces();
        } else if (k.$ === "Bang") {
          const r = k._0.expand(cx, span, new TokenStream(mac.args.tokens._0));
          ev.push(`bang (dummy) -> is_err ${r.$ === "Err"}`);
        } else {
          throw new Error("unexpected extension kind");
        }
      };
      const tokens_result = (r: { $: "Ok"; _0: TokenStream } | { $: "Err"; _0: ErrorGuaranteed }): void => {
        traces();
        if (r.$ === "Ok") {
          ev.push(`tokens ${pprust.tts_to_string(r._0)}`);
          ev.push(`tokens_debug ${debug_TokenStream(r._0, PRETTY)}`);
        } else {
          ev.push("Err(ErrorGuaranteed)");
        }
      };
      const item_tokens = (item: ast.Item): TokenStream =>
        TokenStream.from_ast(item, { tokens: HasTokens.Item.tokens, attrs: HasAttrs.Item.attrs, debug: (v: ast.Item, f: Fmt) => ast.debug_Item(v, f, ast.debug_ItemKind) });
      const attr_invocation = (item: ast.Item): boolean => {
        const attr = item.attrs[0];
        if (attr === undefined || attr.kind.$ !== "Normal") return false;
        const ai = attr.kind._0.item;
        if (ai.path.segments.length !== 1) return false;
        const aname = ai.path.segments[0]!.ident.name;
        const stripped = ast.clone_Item(item, ast.clone_ItemKind);
        stripped.attrs = stripped.attrs.slice(1);
        if (Symbol.as_str(aname) === "mbe_derive") {
          if (ai.args.$ !== "Delimited") return false;
          const t = ai.args._0.tokens._0[0];
          if (t === undefined || t.$ !== "Token") return false;
          const id = t._0.ident();
          if (id === undefined) return false;
          const ident = id[0];
          const ext = macros.get(ident.name);
          if (ext === undefined) return false;
          const span = ident.span;
          ev.push(`invoke #[derive(${Symbol.as_str(ident.name)})] at ${debug_Span(span, PLAIN)}`);
          fresh_expn(ext, span, ident.name, "Derive");
          const body = item_tokens(stripped);
          if (ext.kind.$ !== "MacroRules") {
            ev.push("not MacroRules");
            return true;
          }
          tokens_result((ext.kind._0 as MacroRulesMacroExpander).expand_derive(cx, span, body));
          return true;
        }
        const ext = macros.get(aname);
        if (ext === undefined) return false;
        const span = attr.span;
        ev.push(`invoke #[${Symbol.as_str(aname)}] at ${debug_Span(span, PLAIN)}`);
        fresh_expn(ext, span, aname, "Attr");
        let args: TokenStream;
        switch (ai.args.$) {
          case "Empty":
            args = TokenStream.default();
            break;
          case "Delimited":
            args = new TokenStream(ai.args._0.tokens._0);
            break;
          default:
            throw new Error("unexpected #[m = ..]");
        }
        const body = item_tokens(stripped);
        if (ext.kind.$ !== "MacroRules") {
          ev.push("not MacroRules");
          return true;
        }
        tokens_result(ext.kind._0.as_AttrProcMacro().expand_with_safety(cx, ai.unsafety, span, args, body));
        return true;
      };
      const expr_mac = (e: ast.Expr): void => {
        if (e.kind.$ === "MacCall") bang(e.kind._0, "Expr");
      };

      krate.items.forEach((item, idx) => {
        if (attr_invocation(item)) return;
        const k = item.kind;
        switch (k.$) {
          case "MacroDef": {
            const [ident, def] = [k._0, k._1];
            const node_id = Symbol.as_str(ident.name).startsWith("ext_") ? DUMMY_NODE_ID : ((idx + 1) as NodeId);
            const ext = compile_declarative_macro(sess, features, def, ident, [], item.span, node_id, edition);
            const ek = ext.kind;
            if (ek.$ === "MacroRules") {
              const exp = ek._0;
              ev.push(
                `def ${Symbol.as_str(ident.name)} ${debug_NodeId(node_id, PLAIN)}: MacroRules kinds=MacroKinds(${exp.kinds()}) nrules=${exp.nrules()} is_macro_rules=${exp.is_macro_rules()}`,
              );
              for (let i = 0; i < exp.nrules(); i++) {
                const u = exp.get_unused_rule(i);
                ev.push(`  get_unused_rule(${i}) = ${u === undefined ? "None" : `Some((${debug_Ident(u[0], PLAIN)}, ${debug_MultiSpan(u[1], PLAIN)}))`}`);
              }
            } else if (ek.$ === "Bang") {
              ev.push(`def ${Symbol.as_str(ident.name)} ${debug_NodeId(node_id, PLAIN)}: Bang (dummy)`);
            } else {
              throw new Error("unexpected extension kind");
            }
            macros.set(ident.name, ext);
            break;
          }
          case "MacCall":
            bang(k._0, "Items");
            break;
          case "Const":
            if (k._0.body !== undefined) expr_mac(k._0.body);
            break;
          case "TyAlias":
            if (k._0.ty !== undefined && k._0.ty.kind.$ === "MacCall") bang(k._0.ty.kind._0, "Ty");
            break;
          case "Fn":
            if (k._0.body !== undefined) {
              for (const s of k._0.body.stmts) {
                const sk = s.kind;
                switch (sk.$) {
                  case "MacCall":
                    bang(sk._0.mac, "Stmts");
                    break;
                  case "Let":
                    if (sk._0.pat.kind.$ === "MacCall") bang(sk._0.pat.kind._0, "Pat");
                    if (sk._0.kind.$ === "Init") expr_mac(sk._0.kind._0);
                    break;
                  case "Expr":
                  case "Semi":
                    expr_mac(sk._0);
                    break;
                  default:
                    break;
                }
              }
            }
            break;
          default:
            break;
        }
      });
      void (cx as ExtCtxtT);
      ev.push(`hygiene ${debug_hygiene_data(false)}`);
      for (const l of psess.buffered_lints) {
        ev.push(`lint ${l.lint_id.lint.name} ${debug_option(l.span, PLAIN, debug_MultiSpan)} ${debug_NodeId(l.node_id, PLAIN)}`);
      }
      const gated = [...psess.gated_spans.spans].map(([k, v]) => [Symbol.as_str(k), v] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      for (const [k, v] of gated) ev.push(`gated ${k} ${debug_vec(v, PLAIN, debug_Span)}`);
      for (const [sym, sp] of psess.symbol_gallery.symbols) {
        if (Span.ctxt(sp) !== 0) ev.push(`gallery ${debug_Symbol(sym, PLAIN)} ${debug_Span(sp, PLAIN)}`);
      }
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
    } finally {
      // The driver's `finish_diagnostics` after the probe's `Compilation::Stop`.
      psess.dcx().print_error_count();
      stderr = new TextDecoder().decode(buf.bytes());
    }
  });
  return { events: ev, stderr };
}

for (const c of oracle) {
  test(`mbe-b oracle: ${c.name}`, () => {
    let got: ReturnType<typeof run_case> | undefined;
    let unported: string | undefined;
    try {
      got = run_case(c);
    } catch (e) {
      if (!(e instanceof Unported)) throw e;
      unported = e.what;
    }
    if (unported !== undefined) {
      expect(unported).toBe(PENDING[c.name]!);
      return;
    }
    expect(PENDING[c.name]).toBeUndefined();
    expect(got!.events).toEqual(c.events);
    expect(got!.stderr).toBe(c.stderr);
  });
}

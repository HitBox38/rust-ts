// Oracle scenarios for lane attr-parse-c: the attribute parsers of codegen_attrs.rs, link_attrs.rs,
// doc.rs, repr.rs, inline.rs, instruction_set.rs, deprecation.rs and stability.rs, through
// `AttributeParser::parse_limited_all`.
//
// Expectations: attr_oracle/c_list_out.json, produced by the rustc-dev probe attr_oracle/list_gen.rs
// (how to rebuild it is in its header) over attr_oracle/c_list_cases.txt. Ops: `limited:M[+f1,f2]`
// and `lints` (see list_gen.rs). Unlike attr_oracle.test.ts (a stand-in `Session`), this runner gets
// a real `Session` from the ported `rustc_interface::run_compiler` with the probe's `Config`
// (`Options::default()`, edition 2024, host target): these parsers read `sess.target` and
// `sess.opts`. Events, the fatal flag (any unwind, like the probe's `catch_unwind`) and the full
// -Zui-testing stderr must match byte for byte.
//
// PENDING: cases that reach code that is not ported yet must throw exactly the listed `Unported`.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type * as ast from "../rustc_ast/lib.ts";
import { CRATE_NODE_ID } from "../rustc_ast/node_id.ts";
import { debug_Attribute as debug_hir_Attribute, target } from "../rustc_attr_ir/lib.ts";
import { debug_MultiSpan } from "../rustc_error_messages/lib.gen.ts";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import { FatalErrorMarker } from "../rustc_errors/lib.ts";
import { Features } from "../rustc_feature/lib.ts";
import { run_compiler } from "../rustc_interface/interface.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import { Options_default } from "../rustc_session/config.ts";
import { DUMMY_SP, type FileName, type Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { debug_option, debug_vec, PLAIN } from "../std/fmt.ts";
import { Panic, Unported } from "../std/panic.ts";
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../vendor/anstream/stream.ts";
import { AttributeParser, type ShouldEmit } from "./lib.ts";

interface Case {
  name: string;
  ops: string;
  src: string;
  events: string[];
  fatal: boolean;
  stderr: string;
}

const oracle = JSON.parse(readFileSync(join(import.meta.dir, "attr_oracle", "c_list_out.json"), "utf8")) as Case[];

/** What stays pending once the attribute parsers of lane attr-parse-d are in the registry. */
// (`c_doc_auto_cfg_multi` iterates an `FxHashSet`, whose order lane hashbrown-order ported.)
const AFTER_D: Record<string, string> = {};
/**
 * Building `ATTRIBUTE_PARSERS` reaches the stubs of lane attr-parse-d (not merged into this lane) before
 * any of these cases runs. On a local merge with lane/attr-parse-d every case matches the oracle except
 * `AFTER_D`'s. Root, on integration with attr-parse-d: replace `PENDING` with `AFTER_D`.
 */
const D_STUB = "rustc_attr_parsing::attributes::allow_unstable::AllowInternalUnstableParser::PATH";
/** case -> the `Unported` it must reach. */
const PENDING: Record<string, string> = AFTER_D;
void D_STUB;

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

/** The probe's per-case body (list_gen.rs `main`). */
function run_case(c: Case): { events: string[]; fatal: boolean; stderr: string } {
  const ops = c.ops.split(/\s+/).filter((s) => s !== "");
  const events: string[] = [];
  let fatal = false;
  const buf = new VecU8();
  const opts = Options_default();
  opts.edition = "Edition2024";
  run_compiler(
    {
      opts,
      crate_cfg: [],
      crate_check_cfg: [],
      input: { $: "Str", name: { $: "Custom", _0: "unused" }, input: "" },
      output_dir: undefined,
      output_file: undefined,
      ice_file: undefined,
      file_loader: undefined,
      lint_caps: new Map(),
      psess_created: undefined,
      track_state: undefined,
      register_lints: undefined,
      override_queries: undefined,
      extra_symbols: [],
      make_codegen_backend: undefined,
      using_internal_features: { value: false },
    },
    (compiler) => {
      const sess = compiler.sess;
      const sm = sess.psess.clone_source_map();
      let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
      em = AnnotateSnippetEmitter.sm(em, sm);
      em = AnnotateSnippetEmitter.ui_testing(em, true);
      sess.dcx().set_emitter(em);
      const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
      try {
        const p = unwrap_or_emit_fatal(new_parser_from_source_str(sess.psess, fname, c.src, "Nothing"));
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
          for (const l of sess.psess.buffered_lints) {
            events.push(`buffered ${l.lint_id.lint.name} ${debug_option(l.span, PLAIN, debug_MultiSpan)}`);
          }
          if (ops.includes("lints")) {
            const lints = sess.psess.buffered_lints.splice(0);
            for (const l of lints) {
              const diag = l.diagnostic._0(sess.dcx(), { $: "Warning", _0: undefined }, sess);
              if (l.span !== undefined) {
                diag.span(l.span);
              }
              diag.emit();
            }
          }
        }
      } catch (e) {
        // `std::panic::catch_unwind`: fatal errors and panics; `Unported` is not an unwind.
        if (e instanceof Unported || !(e instanceof FatalErrorMarker || e instanceof Panic)) throw e;
        fatal = true;
      }
      sess.dcx().reset_err_count();
    },
  );
  return { events, fatal, stderr: new TextDecoder().decode(buf.bytes()) };
}

for (const c of oracle) {
  test(`attr-parse-c oracle (parse_limited_all): ${c.name}`, () => {
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

test("attr-parse-c oracle: every PENDING entry names a case", () => {
  const names = new Set(oracle.map((c) => c.name));
  for (const k of Object.keys(PENDING)) expect(names.has(k)).toBe(true);
});

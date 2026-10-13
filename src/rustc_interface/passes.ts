// Partial port of compiler/rustc_interface/src/passes.rs: `parse`. Everything after parsing (expansion,
// `create_and_enter_global_ctxt`, `write_dep_info`, ...) needs rustc_expand/rustc_middle and is unported.
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import type { Crate } from "../rustc_ast/ast.gen.ts";
import { Input } from "../rustc_session/config.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import type { Session } from "../rustc_session/session.ts";
import "../rustc_session/utils.ts"; // `Session::time`
import { unported } from "../std/panic.ts";
import { new_parser_from_file, new_parser_from_source_str, unwrap_or_emit_fatal } from "./pending_parser.ts";
import type { Compiler } from "./interface.ts";

// rustc: compiler/rustc_interface/src/passes.rs:54 parse
export function parse(sess: Session): Crate {
  const r = sess.time("parse_crate", () => {
    const input = sess.io.input;
    let parser;
    switch (input.$) {
      case "File":
        parser = unwrap_or_emit_fatal(new_parser_from_file(sess.psess, input._0, "ShebangAndFrontmatter", undefined));
        break;
      case "Str":
      case "DocTestStr":
        parser = unwrap_or_emit_fatal(
          new_parser_from_source_str(sess.psess, Input.file_name(input, sess), input.input, "ShebangAndFrontmatter"),
        );
        break;
    }
    return parser.parse_crate_mod();
  });
  if (r.$ === "Err") {
    const guar = r._0.emit_err();
    return guar.raise_fatal();
  }
  const krate = r._0;

  cmdline_attrs_inject(krate, sess.psess, sess.opts.unstable_opts.crate_attr);

  return krate;
}

/**
 * `rustc_builtin_macros::cmdline_attrs::inject` (cmdline_attrs.rs:10). PORT: rustc_builtin_macros is not
 * ported; with no `-Z crate-attr` the upstream loop body never runs.
 */
function cmdline_attrs_inject(_krate: Crate, _psess: ParseSess, attrs: readonly string[]): void {
  for (const raw_attr of attrs) {
    unported(`rustc_builtin_macros::cmdline_attrs::inject (-Z crate-attr=${raw_attr})`);
  }
}

/** `create_and_enter_global_ctxt` (passes.rs:932): not ported (rustc_middle). */
export function create_and_enter_global_ctxt<T>(_compiler: Compiler, _krate: Crate, _f: (tcx: never) => T): T {
  return unported("rustc_interface::passes::create_and_enter_global_ctxt");
}

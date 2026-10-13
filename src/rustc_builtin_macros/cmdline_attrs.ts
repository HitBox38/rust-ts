//! Attributes injected into the crate root from command line using `-Z crate-attr`.

import type * as ast from "../rustc_ast/ast.gen.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import { InnerAttrPolicy } from "../rustc_parse/parser/attr.gen.ts";
import { parse_in, source_str_to_stream } from "../rustc_parse/lib.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import { FileName } from "../rustc_span/lib.ts";
import { Err, Ok, type Result } from "../std/result.ts";

// rustc: compiler/rustc_builtin_macros/src/cmdline_attrs.rs:10 inject
export function inject(krate: ast.Crate, psess: ParseSess, attrs: readonly string[]): void {
  for (const raw_attr of attrs) {
    const source = `#![${raw_attr}]`;
    const parse = (): Result<ast.Attribute, Diag[]> => {
      const tokens = source_str_to_stream(psess, FileName.cli_crate_attr_source_code(raw_attr), source, undefined);
      if (tokens.$ === "Err") return tokens;
      const r = parse_in(psess, tokens._0, "<crate attribute>", (p) => p.parse_attribute(InnerAttrPolicy.Permitted));
      if (r.$ === "Err") return Err<Diag[]>([r._0]);
      return Ok(r._0);
    };
    let meta: ast.Attribute;
    const r = parse();
    if (r.$ === "Ok") {
      meta = r._0;
    } else {
      const errs = r._0;
      for (const err of errs) {
        err.emit();
      }
      continue;
    }

    krate.attrs.push(meta);
  }
}

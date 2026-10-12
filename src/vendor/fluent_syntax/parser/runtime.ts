// Port of fluent-syntax-0.12.0/src/parser/runtime.rs.

import { Err, Ok, type Result as StdResult } from "../../../std/result.ts";
import type * as ast from "../ast/mod.ts";
import { Parser, type Result } from "./core.ts";
import type { ParserError } from "./errors.ts";
import { get_current_byte } from "./macros.ts";
import { Slice_str } from "./slice.ts";

declare module "./core.ts" {
  interface Parser {
    parse_runtime(): StdResult<ast.Resource, [ast.Resource, ParserError[]]>;
    get_entry_runtime(entry_start: number): Result<ast.Entry | undefined>;
  }
}

// crate: fluent-syntax-0.12.0/src/parser/runtime.rs:12 parse_runtime
Parser.prototype.parse_runtime = function (this: Parser): StdResult<ast.Resource, [ast.Resource, ParserError[]]> {
  const errors: ParserError[] = [];

  // That default allocation gives the lowest
  // number of instructions and cycles in ioi.
  const body: ast.Entry[] = [];

  this.skip_blank_block();

  while (this.ptr < this.length) {
    const entry_start = this.ptr;
    const entry = this.get_entry_runtime(entry_start);

    if (entry.$ === "Ok" && entry._0 !== undefined) {
      body.push(entry._0);
    } else if (entry.$ === "Ok") {
      // Ok(None) => {}
    } else {
      const err = entry._0;
      this.skip_to_next_entry_start();
      err.slice = { start: entry_start, end: this.ptr };
      errors.push(err);
      const content = Slice_str.slice(this.source, entry_start, this.ptr);
      body.push({ $: "Junk", content });
    }
    this.skip_blank_block();
  }

  if (errors.length === 0) {
    return Ok({ body });
  } else {
    return Err<[ast.Resource, ParserError[]]>([{ body }, errors]);
  }
};

// crate: fluent-syntax-0.12.0/src/parser/runtime.rs:50 get_entry_runtime
Parser.prototype.get_entry_runtime = function (this: Parser, entry_start: number): Result<ast.Entry | undefined> {
  let entry: ast.Entry | undefined;
  switch (get_current_byte(this)) {
    case 0x23 /* b'#' */:
      this.skip_comment();
      entry = undefined;
      break;
    case 0x2d /* b'-' */: {
      const r = this.get_term(entry_start);
      if (r.$ === "Err") return r;
      entry = { $: "Term", _0: r._0 };
      break;
    }
    default: {
      const r = this.get_message(entry_start);
      if (r.$ === "Err") return r;
      entry = { $: "Message", _0: r._0 };
    }
  }
  return Ok(entry);
};

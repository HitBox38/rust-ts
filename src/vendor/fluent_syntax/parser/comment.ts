// Port of fluent-syntax-0.12.0/src/parser/comment.rs.

import { type Debug } from "../../../std/fmt.ts";
import { Ok } from "../../../std/result.ts";
import type { Str } from "../../../std/str.ts";
import type * as ast from "../ast/mod.ts";
import { Parser, type Result } from "./core.ts";
import { Slice_str } from "./slice.ts";

export type Level = "None" | "Regular" | "Group" | "Resource";
export const Level = { None: "None", Regular: "Regular", Group: "Group", Resource: "Resource" } as const;
/** `level as usize` */
export const Level_discriminant: Record<Level, number> = { None: 0, Regular: 1, Group: 2, Resource: 3 };
export const debug_Level: Debug<Level> = (v) => v;

declare module "./core.ts" {
  interface Parser {
    get_comment(): Result<[ast.Comment, Level]>;
    skip_comment(): void;
    get_comment_level(): Level;
    get_comment_line(): Str;
  }
}

// crate: fluent-syntax-0.12.0/src/parser/comment.rs:16 get_comment
Parser.prototype.get_comment = function (this: Parser): Result<[ast.Comment, Level]> {
  let level: Level = Level.None;
  const content: Str[] = [];

  while (this.ptr < this.length) {
    const line_level = this.get_comment_level();
    if (line_level === Level.None) {
      this.ptr -= 1;
      break;
    } else if (level !== Level.None && line_level !== level) {
      this.ptr -= Level_discriminant[line_level];
      break;
    }

    level = line_level;

    if (this.ptr === this.length) {
      break;
    } else if (this.is_eol()) {
      content.push(this.get_comment_line());
    } else {
      const e = this.expect_byte(0x20 /* b' ' */);
      if (e.$ === "Err") {
        if (content.length === 0) {
          return e;
        } else {
          this.ptr -= Level_discriminant[line_level];
          break;
        }
      }
      content.push(this.get_comment_line());
    }
    this.skip_eol();
  }

  return Ok([{ content }, level]);
};

// crate: fluent-syntax-0.12.0/src/parser/comment.rs:53 skip_comment
Parser.prototype.skip_comment = function (this: Parser): void {
  for (;;) {
    while (this.ptr < this.length && !this.is_eol()) {
      this.ptr += 1;
    }
    this.ptr += 1;
    if (this.is_current_byte(0x23 /* b'#' */)) {
      this.ptr += 1;
    } else {
      break;
    }
  }
};

// crate: fluent-syntax-0.12.0/src/parser/comment.rs:67 get_comment_level
Parser.prototype.get_comment_level = function (this: Parser): Level {
  if (this.take_byte_if(0x23 /* b'#' */)) {
    if (this.take_byte_if(0x23 /* b'#' */)) {
      if (this.take_byte_if(0x23 /* b'#' */)) {
        return Level.Resource;
      }
      return Level.Group;
    }
    return Level.Regular;
  }
  return Level.None;
};

// crate: fluent-syntax-0.12.0/src/parser/comment.rs:80 get_comment_line
Parser.prototype.get_comment_line = function (this: Parser): Str {
  const start_pos = this.ptr;

  while (!this.is_eol()) {
    this.ptr += 1;
  }

  return Slice_str.slice(this.source, start_pos, this.ptr);
};

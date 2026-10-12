// Port of fluent-syntax-0.12.0/src/ast/helper.rs.
// PORT: `#[cfg(feature = "serde")]` imports/derives skipped (feature off in rustc); `CommentDef` is only
// used by the serde deserializer of `Comment`, but the type and its `From` impl are not cfg-gated, so
// they are ported.

import { debug_struct, debug_vec, type Debug } from "../../../std/fmt.ts";
import type { Str } from "../../../std/str.ts";
import { debug_S, type Comment } from "./mod.ts";

// This is a helper struct used to properly deserialize referential
// JSON comments which are single continuous String, into a vec of
// content slices.
export type CommentDef = { $: "Single"; content: Str } | { $: "Multi"; content: Str[] };

export const debug_CommentDef: Debug<CommentDef> = (v, f) => {
  switch (v.$) {
    case "Single":
      return debug_struct(f, "Single", [["content", debug_S(v.content, f)]]);
    case "Multi":
      return debug_struct(f, "Multi", [["content", debug_vec(v.content, f, debug_S)]]);
  }
};

// PORT: `impl<S> From<CommentDef<S>> for Comment<S>` → `Comment_from_CommentDef`.
// crate: fluent-syntax-0.12.0/src/ast/helper.rs:17 from
export function Comment_from_CommentDef(input: CommentDef): Comment {
  switch (input.$) {
    case "Single":
      return {
        content: [input.content],
      };
    case "Multi":
      return { content: input.content };
  }
}

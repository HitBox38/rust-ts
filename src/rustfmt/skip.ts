//! Module that contains skip related stuffs.
// Port of src/tools/rustfmt/src/skip.rs (lane rustfmt-contract-3).

import { type Attribute, MetaItemInner, type PathSegment } from "../rustc_ast/lib.ts";
import { pprust } from "../rustc_ast_pretty/lib.ts";
import { display_Ident } from "../rustc_span/symbol.ts";
import { replace_in_place } from "../std/mut_ref.ts";

/// Track which blocks of code are to be skipped when formatting.
///
/// You can update it by:
///
/// - attributes slice
/// - manually feeding values into the underlying contexts
///
/// Query this context to know if you need to skip a block.
// `#[derive(Default, Clone)]`
export class SkipContext {
  constructor(
    public macros: SkipNameContext,
    public attributes: SkipNameContext,
  ) {}

  // rustc: src/tools/rustfmt/src/skip.rs:22 update_with_attrs
  update_with_attrs(attrs: readonly Attribute[]): void {
    SkipNameContext.extend(this.macros, get_skip_names("macros", attrs));
    SkipNameContext.extend(this.attributes, get_skip_names("attributes", attrs));
  }

  // rustc: src/tools/rustfmt/src/skip.rs:27 update
  update(other: SkipContext): void {
    const { macros, attributes } = other;
    SkipNameContext.update(this.macros, macros);
    SkipNameContext.update(this.attributes, attributes);
  }
}

/** `#[derive(Default)]` of `SkipContext`. */
export function default_SkipContext(): SkipContext {
  return new SkipContext(SkipNameContext.default_(), SkipNameContext.default_());
}

/** `#[derive(Clone)]` of `SkipContext`. PORT: hand-written, as lib.ts's `clone_FormatReport` (no rustfmt codegen for derives
 *  outside `config/`). */
export function clone_SkipContext(v: SkipContext): SkipContext {
  return new SkipContext(clone_SkipNameContext(v.macros), clone_SkipNameContext(v.attributes));
}

/// Track which names to skip.
///
/// Query this context with a string to know whether to skip it.
// `#[derive(Clone)]`
// PORT: the methods taking `&mut self` replace the value in place (`replace_in_place`, std/mut_ref.ts), so a
// `SkipNameContext` is never a shared frozen singleton: `All` is a fresh object each time.
export type SkipNameContext = { readonly $: "All" } | { readonly $: "Values"; _0: Set<string> };
export const SkipNameContext = {
  // `impl Default for SkipNameContext`
  // rustc: src/tools/rustfmt/src/skip.rs:44 default
  default_(): SkipNameContext {
    return { $: "Values", _0: new Set() };
  },

  // `impl Extend<String> for SkipNameContext`
  // rustc: src/tools/rustfmt/src/skip.rs:50 extend
  extend(self: SkipNameContext, iter: Iterable<string>): void {
    switch (self.$) {
      case "All":
        break;
      case "Values": {
        const values = self._0;
        for (const v of iter) values.add(v);
        break;
      }
    }
  },

  // rustc: src/tools/rustfmt/src/skip.rs:59 update
  update(self: SkipNameContext, other: SkipNameContext): void {
    if (self.$ === "All") {
      // If we're already skipping everything, nothing more can be added
    } else if (other.$ === "All") {
      // If we want to skip all, set it
      replace_in_place<SkipNameContext>(self, { $: "All" });
    } else {
      // If we have some new values to skip, add them
      const existing_values = self._0;
      for (const v of other._0) existing_values.add(v);
    }
  },

  // rustc: src/tools/rustfmt/src/skip.rs:74 skip
  skip(self: SkipNameContext, name: string): boolean {
    switch (self.$) {
      case "All":
        return true;
      case "Values":
        return self._0.has(name);
    }
  },

  // rustc: src/tools/rustfmt/src/skip.rs:81 skip_all
  skip_all(self: SkipNameContext): void {
    replace_in_place<SkipNameContext>(self, { $: "All" });
  },
};

/** `#[derive(Clone)]` of `SkipNameContext`. */
export function clone_SkipNameContext(v: SkipNameContext): SkipNameContext {
  return v.$ === "All" ? { $: "All" } : { $: "Values", _0: new Set(v._0) };
}

const RUSTFMT = "rustfmt";
const SKIP = "skip";

/// Say if you're playing with `rustfmt`'s skip attribute
// rustc: src/tools/rustfmt/src/skip.rs:90 is_skip_attr
export function is_skip_attr(segments: readonly PathSegment[]): boolean {
  if (segments.length < 2 || display_Ident(segments[0]!.ident) !== RUSTFMT) {
    return false;
  }
  switch (segments.length) {
    case 2:
      return display_Ident(segments[1]!.ident) === SKIP;
    case 3:
      return (
        display_Ident(segments[1]!.ident) === SKIP &&
        ["macros", "attributes"].some((n) => n === pprust.path_segment_to_string(segments[2]!))
      );
    default:
      return false;
  }
}

// rustc: src/tools/rustfmt/src/skip.rs:106 get_skip_names
function get_skip_names(kind: string, attrs: readonly Attribute[]): string[] {
  const skip_names: string[] = [];
  const path = `${RUSTFMT}::${SKIP}::${kind}`;
  for (const attr of attrs) {
    // rustc_ast::ast::Path is implemented partialEq
    // but it is designed for segments.len() == 1
    const kind_ = attr.kind;
    if (kind_.$ === "Normal") {
      const normal = kind_._0;
      if (pprust.path_to_string(normal.item.path) !== path) {
        continue;
      }
    }

    const list = attr.meta_item_list();
    if (list !== undefined) {
      for (const meta_item_inner of list) {
        const name = MetaItemInner.ident(meta_item_inner);
        if (name !== undefined) {
          skip_names.push(display_Ident(name));
        }
      }
    }
  }
  return skip_names;
}

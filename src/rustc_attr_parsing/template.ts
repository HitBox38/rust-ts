// Port of compiler/rustc_attr_parsing/src/template.rs
//
// PORT:
// - `AttributeTemplate` is `#[derive(Clone, Copy, Default)]` and never mutated: a class with readonly
//   fields, shared where Rust copies it (no `clone_` needed). Its `Default` is not used by the
//   crate at the pin and is not provided.
// - `name: impl std::fmt::Display` -> the displayed string (callers format their value first).
// - `macro_rules! template` -> the function `template(arms, link?)`: `template!(Word, List: &["a"],
//   "link")` is `template({ Word: true, List: ["a"] }, "link")`; `OneOf:` takes the symbol list,
//   `NameValueStr:` always takes a list (the macro wraps a single literal into `&[$descr]`). Every
//   arm builds `AttributeTemplate { word, list, one_of, name_value_str, docs }` like the `@` arm.
import type { Safety } from "../rustc_ast/lib.ts";
import { display_Symbol, type Symbol } from "../rustc_span/symbol.ts";
import { str_cmp } from "../rustc_session/options.ts";
import type { ParsedDescription } from "./diagnostics.ts";

/// A template to suggest the correct syntax of an attribute.
///
/// This is not used to *check* attributes. The attribute's parser is responsible for that.
/// Only top-level shape (`#[attr]` vs `#[attr(...)]` vs `#[attr = ...]`) is considered now.
export class AttributeTemplate {
  constructor(
    /// If `true`, the attribute is allowed to be a bare word like `#[test]`.
    readonly word: boolean,
    /// If `Some`, the attribute is allowed to take a list of items like `#[allow(..)]`.
    readonly list: readonly string[] | undefined,
    /// If non-empty, the attribute is allowed to take a list containing exactly
    /// one of the listed words, like `#[coverage(off)]`.
    readonly one_of: readonly Symbol[],
    /// If `Some`, the attribute is allowed to be a name/value pair where the
    /// value is a string, like `#[must_use = "reason"]`.
    readonly name_value_str: readonly string[] | undefined,
    /// A link to the document for this attribute.
    readonly docs: string | undefined,
  ) {}

  // rustc: compiler/rustc_attr_parsing/src/template.rs:27 suggestions
  suggestions(description: ParsedDescription, safety: Safety, name: string): string[] {
    let macro_call: string;
    switch (description) {
      case "Macro":
        macro_call = "!";
        break;
      case "Attribute":
        macro_call = "";
        break;
    }

    const suggestions: string[] = [];

    let safety_start: string;
    let safety_end: string;
    switch (safety.$) {
      case "Unsafe":
        [safety_start, safety_end] = ["unsafe(", ")"];
        break;
      default:
        [safety_start, safety_end] = ["", ""];
    }

    if (this.word) {
      // debug_assert!(macro_call.is_empty(), "Macro suggestions use list style");
      suggestions.push(`${safety_start}${name}${safety_end}`);
    }
    if (this.list !== undefined) {
      const descr = this.list;
      for (const descr_ of descr) {
        suggestions.push(`${safety_start}${name}${macro_call}(${descr_})${safety_end}`);
      }
    }
    for (const word of this.one_of) {
      suggestions.push(`${safety_start}${name}(${display_Symbol(word)})${safety_end}`);
    }
    if (this.name_value_str !== undefined) {
      const descr = this.name_value_str;
      // debug_assert!(macro_call.is_empty(), "Macro suggestions use list style");
      for (const descr_ of descr) {
        suggestions.push(`${safety_start}${name} = "${descr_}"${safety_end}`);
      }
    }
    suggestions.sort(str_cmp);

    return suggestions;
  }
}

/** The arms of `template!` (all optional; the macro accepts the combinations listed upstream). */
export interface TemplateArms {
  Word?: true;
  List?: readonly string[];
  OneOf?: readonly Symbol[];
  NameValueStr?: readonly string[];
}

/// A convenience macro for constructing attribute templates.
/// E.g., `template!(Word, List: "description")` means that the attribute
/// supports forms `#[attr]` and `#[attr(description)]`.
export function template(arms: TemplateArms, link?: string): AttributeTemplate {
  return new AttributeTemplate(arms.Word === true, arms.List, arms.OneOf ?? [], arms.NameValueStr, link);
}

// Port of src/tools/rustfmt/src/config/lists.rs (lane rustfmt-contract-1).
//! Configuration options related to rewriting a list.
// The types, their derives and the `#[config_type]` expansions are generated into lists.gen.ts (tools/codegen/rustfmt.ts);
// the inherent methods are added to the companion consts here (PORTING §8).
import * as gen from "./lists.gen.ts";
import type { IndentStyle } from "./options.gen.ts";

export * from "./lists.gen.ts";

/// The definitive formatting tactic for lists.
export type DefinitiveListTactic = gen.DefinitiveListTactic;
export const DefinitiveListTactic = {
  ...gen.DefinitiveListTactic,

  // rustc: src/tools/rustfmt/src/config/lists.rs:18 ends_with_newline
  ends_with_newline(self: DefinitiveListTactic, indent_style: IndentStyle): boolean {
    switch (indent_style) {
      // PORT: the derived `PartialEq` against a unit variant compares the tag.
      case "Block":
        return self.$ !== "Horizontal";
      case "Visual":
        return false;
    }
  },
};

export type SeparatorTactic = gen.SeparatorTactic;
export const SeparatorTactic = {
  ...gen.SeparatorTactic,

  // rustc: src/tools/rustfmt/src/config/lists.rs:51 from_bool
  from_bool(b: boolean): SeparatorTactic {
    if (b) {
      return "Always";
    } else {
      return "Never";
    }
  },
};

/// Where to put separator.
export type SeparatorPlace = gen.SeparatorPlace;
export const SeparatorPlace = {
  ...gen.SeparatorPlace,

  // rustc: src/tools/rustfmt/src/config/lists.rs:68 is_front
  is_front(self: SeparatorPlace): boolean {
    return self === "Front";
  },

  // rustc: src/tools/rustfmt/src/config/lists.rs:72 is_back
  is_back(self: SeparatorPlace): boolean {
    return self === "Back";
  },

  // rustc: src/tools/rustfmt/src/config/lists.rs:76 from_tactic
  from_tactic(default_: SeparatorPlace, tactic: DefinitiveListTactic, sep: string): SeparatorPlace {
    switch (tactic.$) {
      case "Vertical":
        return default_;
      default: {
        if (sep === ",") {
          return "Back";
        } else {
          return default_;
        }
      }
    }
  },
};

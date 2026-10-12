// Port of compiler/rustc_ast/src/attr/data_structures.rs
// Types and derived Debug impls are generated into data_structures.gen.ts (tools/codegen/types.ts).
//
// PORT: `CfgEntry`'s inherent fns live on a companion const (PORTING §8); the generated module has
// none (no unit variants), so it is defined here.
import type { Span } from "../../rustc_span/lib.ts";
import { display_Symbol, Symbol } from "../../rustc_span/symbol.ts";
import { debug_str } from "../../std/fmt.ts";
import type { CfgEntry as CfgEntryT } from "./data_structures.gen.ts";
import { display_RustcVersion, type RustcVersion, RustcVersion_eq } from "./version.ts";

export * from "./data_structures.gen.ts";

export type CfgEntry = CfgEntryT;
export const CfgEntry = {
  // rustc: compiler/rustc_ast/src/attr/data_structures.rs:20 lower_spans
  lower_spans(self: CfgEntry, lower_span: (span: Span) => Span): void {
    switch (self.$) {
      case "All":
      case "Any":
        self._1 = lower_span(self._1);
        self._0.forEach((sub) => CfgEntry.lower_spans(sub, lower_span));
        break;
      case "Not":
        self._1 = lower_span(self._1);
        CfgEntry.lower_spans(self._0, lower_span);
        break;
      case "Bool":
        self._1 = lower_span(self._1);
        break;
      case "NameValue":
        self.span = lower_span(self.span);
        break;
      case "Version":
        self._1 = lower_span(self._1);
        break;
    }
  },

  // rustc: compiler/rustc_ast/src/attr/data_structures.rs:38 span
  span(self: CfgEntry): Span {
    switch (self.$) {
      case "All":
      case "Any":
      case "Not":
      case "Bool":
        return self._1;
      case "NameValue":
        return self.span;
      case "Version":
        return self._1;
    }
  },

  /// Same as `PartialEq` but doesn't check spans and ignore order of cfgs.
  // rustc: compiler/rustc_ast/src/attr/data_structures.rs:49 is_equivalent_to
  is_equivalent_to(self: CfgEntry, other: CfgEntry): boolean {
    if ((self.$ === "All" && other.$ === "All") || (self.$ === "Any" && other.$ === "Any")) {
      const a = self._0;
      const b = other._0;
      return a.length === b.length && a.every((a) => b.some((b) => CfgEntry.is_equivalent_to(a, b)));
    } else if (self.$ === "Not" && other.$ === "Not") {
      return CfgEntry.is_equivalent_to(self._0, other._0);
    } else if (self.$ === "Bool" && other.$ === "Bool") {
      return self._0 === other._0;
    } else if (self.$ === "NameValue" && other.$ === "NameValue") {
      return self.name === other.name && self.value === other.value;
    } else if (self.$ === "Version" && other.$ === "Version") {
      // PORT: `Option<RustcVersion> == Option<RustcVersion>` (derived `PartialEq`).
      const a = self._0;
      const b = other._0;
      return a === undefined || b === undefined ? a === b : RustcVersion_eq(a, b);
    } else {
      return false;
    }
  },
};

// impl fmt::Display for CfgEntry
// rustc: compiler/rustc_ast/src/attr/data_structures.rs:67 fmt
// PORT: `Display` impls are `display_<Type>(v): string` (as in rustc_span).
export function display_CfgEntry(self: CfgEntry): string {
  // rustc: compiler/rustc_ast/src/attr/data_structures.rs:68 write_entries
  function write_entries(name: string, entries: readonly CfgEntry[]): string {
    let f = `${name}(`;
    entries.forEach((entry, nb) => {
      if (nb !== 0) {
        f += ", ";
      }
      f += display_CfgEntry(entry);
    });
    f += ")";
    return f;
  }
  switch (self.$) {
    case "All":
      return write_entries("all", self._0);
    case "Any":
      return write_entries("any", self._0);
    case "Not":
      return `not(${display_CfgEntry(self._0)})`;
    case "Bool":
      return `${self._0}`;
    case "NameValue": {
      const name = self.name;
      const value = self.value;
      if (value !== undefined) {
        // We use `as_str` and debug display to have characters escaped and `"`
        // characters surrounding the string.
        return `${display_Symbol(name)} = ${debug_str(Symbol.as_str(value))}`;
      } else {
        return `${display_Symbol(name)}`;
      }
    }
    case "Version": {
      const version: RustcVersion | undefined = self._0;
      if (version !== undefined) {
        return `${display_RustcVersion(version)}`;
      } else {
        return "";
      }
    }
  }
}

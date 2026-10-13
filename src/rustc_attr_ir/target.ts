// Port of compiler/rustc_attr_ir/src/target.rs
//! This module lists attribute targets, with conversions from other types.
//
// Types and derived Debug/Clone impls are generated into target.gen.ts (tools/codegen/types.ts).
// PORT: `Target`'s inherent fns live on its companion const (PORTING §8), next to the generated
// unit-variant singletons; `Display` is `display_Target`.
import type { AssocItemKind, Expr, ForeignItemKind, Item } from "../rustc_ast/lib.ts";
import { into_diag_arg_using_display } from "../rustc_error_messages/lib.ts";
import type { AssocCtxt } from "../rustc_ast/visit.ts";
import * as gen from "./target.gen.ts";
import type { MethodKind } from "./target.gen.ts";

export * from "./target.gen.ts";
// pub use rustc_ast::visit::AssocCtxt;
export { AssocCtxt, debug_AssocCtxt } from "../rustc_ast/visit.ts";

export type Target = gen.Target;

// impl Display for Target
// rustc: compiler/rustc_attr_ir/src/target.rs:69 fmt
export function display_Target(self: Target): string {
  return Target.name(self);
}

// rustc_error_messages::into_diag_arg_using_display!(Target);
export const Target_into_diag_arg = into_diag_arg_using_display<Target>(display_Target);

export const Target = {
  ...gen.Target,

  // rustc: compiler/rustc_attr_ir/src/target.rs:77 is_associated_item
  is_associated_item(self: Target): boolean {
    switch (self.$) {
      case "AssocConst":
      case "AssocTy":
      case "Method":
        return true;
      case "ExternCrate":
      case "Use":
      case "Static":
      case "Const":
      case "Fn":
      case "Closure":
      case "Mod":
      case "ForeignMod":
      case "GlobalAsm":
      case "TyAlias":
      case "Enum":
      case "Variant":
      case "Struct":
      case "Field":
      case "Union":
      case "Trait":
      case "TraitAlias":
      case "Impl":
      case "Expression":
      case "Statement":
      case "Arm":
      case "ForeignFn":
      case "ForeignStatic":
      case "ForeignTy":
      case "TypeParam":
      case "LifetimeParam":
      case "ConstParam":
      case "MacroDef":
      case "Param":
      case "PatField":
      case "ExprField":
      case "MacroCall":
      case "Crate":
      case "WherePredicate":
      case "Delegation":
      case "Loop":
      case "While":
      case "ForLoop":
      case "Break":
        return false;
    }
  },
  // rustc: compiler/rustc_attr_ir/src/target.rs:121 from_ast_item
  from_ast_item(item: Item): Target {
    const kind = item.kind;
    switch (kind.$) {
      case "ExternCrate":
        return Target.ExternCrate;
      case "Use":
        return Target.Use;
      case "Static":
        return Target.Static;
      case "Const":
        return Target.Const;
      case "ConstBlock":
        return Target.Const;
      case "Fn":
        return Target.Fn;
      case "Mod":
        return Target.Mod;
      case "ForeignMod":
        return Target.ForeignMod;
      case "GlobalAsm":
        return Target.GlobalAsm;
      case "TyAlias":
        return Target.TyAlias;
      case "Enum":
        return Target.Enum;
      case "Struct":
        return Target.Struct;
      case "Union":
        return Target.Union;
      case "Trait":
        return Target.Trait;
      case "TraitAlias":
        return Target.TraitAlias;
      case "Impl": {
        const i = kind._0;
        return { $: "Impl", of_trait: i.of_trait !== undefined };
      }
      case "MacCall":
        return Target.MacroCall;
      case "MacroDef":
        return Target.MacroDef;
      case "Delegation":
        return { $: "Delegation", mac: false };
      case "DelegationMac":
        return { $: "Delegation", mac: true };
      case "TestBinderConstraints":
        return Target.MacroCall;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/target.rs:147 from_foreign_item_kind
  from_foreign_item_kind(kind: ForeignItemKind): Target {
    switch (kind.$) {
      case "Static":
        return Target.ForeignStatic;
      case "Fn":
        return Target.ForeignFn;
      case "TyAlias":
        return Target.ForeignTy;
      case "MacCall":
        return Target.MacroCall;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/target.rs:156 from_assoc_item_kind
  from_assoc_item_kind(kind: AssocItemKind, assoc_ctxt: AssocCtxt): Target {
    switch (kind.$) {
      case "Const":
        return { $: "AssocConst", _0: assoc_ctxt };
      case "Fn": {
        const f = kind._0;
        let method: MethodKind;
        switch (assoc_ctxt.$) {
          case "Trait":
            method = { $: "Trait", body: f.body !== undefined };
            break;
          case "Impl": {
            const of_trait = assoc_ctxt.of_trait;
            if (of_trait) {
              method = gen.MethodKind.TraitImpl;
            } else {
              method = gen.MethodKind.Inherent;
            }
            break;
          }
        }
        return { $: "Method", _0: method };
      }
      case "Type":
        return { $: "AssocTy", _0: assoc_ctxt };
      case "Delegation":
        return { $: "Delegation", mac: false };
      case "DelegationMac":
        return { $: "Delegation", mac: true };
      case "MacCall":
        return Target.MacroCall;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/target.rs:176 from_expr
  from_expr(expr: Expr): Target {
    const kind = expr.kind;
    switch (kind.$) {
      case "Closure":
      case "Gen":
        return Target.Closure;
      case "Paren": {
        const e = kind._0;
        return Target.from_expr(e);
      }
      case "ForLoop":
        return Target.ForLoop;
      case "Loop":
        return Target.Loop;
      case "While":
        return Target.While;
      case "Break":
        return Target.Break;
      default:
        return Target.Expression;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/target.rs:188 name
  name(self: Target): string {
    switch (self.$) {
      case "ExternCrate":
        return "extern crate";
      case "Use":
        return "use";
      case "Static":
        return "static";
      case "Const":
        return "constant";
      case "Fn":
        return "function";
      case "Closure":
        return "closure";
      case "Mod":
        return "module";
      case "ForeignMod":
        return "foreign module";
      case "GlobalAsm":
        return "global asm";
      case "TyAlias":
        return "type alias";
      case "Enum":
        return "enum";
      case "Variant":
        return "enum variant";
      case "Struct":
        return "struct";
      case "Field":
        return "struct field";
      case "Union":
        return "union";
      case "Trait":
        return "trait";
      case "TraitAlias":
        return "trait alias";
      case "Impl":
        return "implementation block";
      case "Expression":
        return "expression";
      case "Statement":
        return "statement";
      case "Arm":
        return "match arm";
      case "AssocConst":
        return "associated const";
      case "Method": {
        const kind = self._0;
        if (kind.$ === "Inherent") return "inherent method";
        else if (kind.$ === "Trait" && kind.body === false) return "required trait method";
        else if (kind.$ === "Trait" && kind.body === true) return "provided trait method";
        else return "trait method in an impl block"; // MethodKind::TraitImpl
      }
      case "AssocTy":
        return "associated type";
      case "ForeignFn":
        return "foreign function";
      case "ForeignStatic":
        return "foreign static item";
      case "ForeignTy":
        return "foreign type";
      case "TypeParam":
        return "type parameter";
      case "LifetimeParam":
        return "lifetime parameter";
      case "ConstParam":
        return "const parameter";
      case "MacroDef":
        return "macro def";
      case "Param":
        return "function param";
      case "PatField":
        return "pattern field";
      case "ExprField":
        return "struct field";
      case "WherePredicate":
        return "where predicate";
      case "MacroCall":
        return "macro call";
      case "Crate":
        return "crate";
      case "Delegation":
        return "delegation";
      case "Loop":
        return "loop";
      case "ForLoop":
        return "for loop";
      case "While":
        return "while loop";
      case "Break":
        return "break expression";
    }
  },

  // rustc: compiler/rustc_attr_ir/src/target.rs:240 plural_name
  plural_name(self: Target): string {
    switch (self.$) {
      case "ExternCrate":
        return "extern crates";
      case "Use":
        return "use statements";
      case "Static":
        return "statics";
      case "Const":
        return "constants";
      case "Fn":
        return "functions";
      case "Closure":
        return "closures";
      case "Mod":
        return "modules";
      case "ForeignMod":
        return "foreign modules";
      case "GlobalAsm":
        return "global asms";
      case "TyAlias":
        return "type aliases";
      case "Enum":
        return "enums";
      case "Variant":
        return "enum variants";
      case "Struct":
        return "structs";
      case "Field":
        return "struct fields";
      case "Union":
        return "unions";
      case "Trait":
        return "traits";
      case "TraitAlias":
        return "trait aliases";
      case "Impl":
        if (self.of_trait === false) return "inherent impl blocks";
        else return "trait impl blocks"; // Target::Impl { of_trait: true }
      case "Expression":
        return "expressions";
      case "Statement":
        return "statements";
      case "Arm":
        return "match arms";
      case "AssocConst":
        return "associated consts";
      case "Method": {
        const kind = self._0;
        if (kind.$ === "Inherent") return "inherent methods";
        else if (kind.$ === "Trait" && kind.body === false) return "required trait methods";
        else if (kind.$ === "Trait" && kind.body === true) return "provided trait methods";
        else return "trait methods in impl blocks"; // MethodKind::TraitImpl
      }
      case "AssocTy":
        return "associated types";
      case "ForeignFn":
        return "foreign functions";
      case "ForeignStatic":
        return "foreign statics";
      case "ForeignTy":
        return "foreign types";
      case "TypeParam":
        return "type parameters";
      case "LifetimeParam":
        return "lifetime parameters";
      case "ConstParam":
        return "const parameters";
      case "MacroDef":
        return "macro defs";
      case "Param":
        return "function params";
      case "PatField":
        return "pattern fields";
      case "ExprField":
        return "struct fields";
      case "WherePredicate":
        return "where predicates";
      case "MacroCall":
        return "macro calls";
      case "Crate":
        return "crates";
      case "Delegation":
        return "delegations";
      case "ForLoop":
        return "for loops";
      case "Loop":
        return "loops";
      case "While":
        return "while loops";
      case "Break":
        return "break expressions";
    }
  },
};

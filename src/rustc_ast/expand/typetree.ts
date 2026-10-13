// Port of compiler/rustc_ast/src/expand/typetree.rs
// Types and derived Debug impls are generated into typetree.gen.ts (tools/codegen/types.ts).
//
// PORT: `TypeTree` and `Type` are generated classes; their associated fns are assigned onto them
// and re-exported with the extended type, `self`-consuming methods go on the prototype (the
// token.ts pattern). `self` by value: the TS method builds a new value and leaves `this` alone.
import { type Fmt, PLAIN } from "../../std/fmt.ts";
import * as gen from "./typetree.gen.ts";

export * from "./typetree.gen.ts";

declare module "./typetree.gen.ts" {
  interface TypeTree {
    add_indirection(): TypeTree;
  }
  interface Type {
    add_offset(add: number): Type;
  }
}

export type TypeTree = gen.TypeTree;
// PORT: statics of the generated class, attached below in upstream order.
export const TypeTree = gen.TypeTree as typeof gen.TypeTree & {
  "new": () => TypeTree;
  all_ints: () => TypeTree;
  int: (size: number) => TypeTree;
};

// rustc: compiler/rustc_ast/src/expand/typetree.rs:45 new
TypeTree.new = function (): TypeTree {
  return new gen.TypeTree([]);
};

// rustc: compiler/rustc_ast/src/expand/typetree.rs:48 all_ints
TypeTree.all_ints = function (): TypeTree {
  return new gen.TypeTree([new gen.Type(-1, 1, gen.Kind.Integer, TypeTree.new())]);
};

// rustc: compiler/rustc_ast/src/expand/typetree.rs:51 int
TypeTree.int = function (size: number): TypeTree {
  const ints: gen.Type[] = [];
  for (let i = 0; i < size; i++) {
    ints.push(new gen.Type(i, 1, gen.Kind.Integer, TypeTree.new()));
  }
  return new gen.TypeTree(ints);
};

// rustc: compiler/rustc_ast/src/expand/typetree.rs:63 add_indirection
gen.TypeTree.prototype.add_indirection = function (this: TypeTree): TypeTree {
  return new gen.TypeTree([new gen.Type(0, 1, gen.Kind.Pointer, this)]);
};

export type Type = gen.Type;
// PORT: statics of the generated class, attached below in upstream order.
export const Type = gen.Type as typeof gen.Type & {
  from_ty: (offset: number, other: Type) => Type;
};

// rustc: compiler/rustc_ast/src/expand/typetree.rs:82 from_ty
Type.from_ty = function (offset: number, other: Type): Type {
  return new gen.Type(offset, other.size, other.kind, gen.clone_TypeTree(other.child));
};

// rustc: compiler/rustc_ast/src/expand/typetree.rs:88 add_offset
gen.Type.prototype.add_offset = function (this: Type, add: number): Type {
  let offset: number;
  switch (this.offset) {
    case -1:
      offset = add;
      break;
    default: {
      const x = this.offset;
      offset = add + x;
    }
  }

  return new gen.Type(offset, this.size, this.kind, this.child);
};

// impl fmt::Display for Type
// PORT: `<Self as fmt::Debug>::fmt(self, f)` forwards the caller's formatter, so this takes the
// `Fmt` too (default: plain `{}`).
// rustc: compiler/rustc_ast/src/expand/typetree.rs:99 fmt
export function display_Type(self: Type, f: Fmt = PLAIN): string {
  return gen.debug_Type(self, f);
}

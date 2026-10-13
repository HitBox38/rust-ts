// Port of compiler/rustc_ast/src/format.rs
// Types and derived Debug impls are generated into format.gen.ts (tools/codegen/types.ts).
//
// PORT: method placement (PORTING §8, the token.ts pattern). `FormatArguments` is a generated
// class: `FormatArguments::new` is assigned onto it, its `&self` methods go on the prototype
// (declared via `declare module`). `FormatArgumentKind::ident` lives on a companion const.
import { FxHashMap, LAYOUT_USIZE, u32_key } from "../rust_ts/hash_map.ts";
import type { Ident, Symbol } from "../rustc_span/symbol.ts";
import { assert } from "../std/panic.ts";
import * as gen from "./format.gen.ts";
import type { FormatArgument, FormatArgumentKind as FormatArgumentKindT } from "./format.gen.ts";

export * from "./format.gen.ts";

declare module "./format.gen.ts" {
  interface FormatArguments {
    add(arg: FormatArgument): number;
    by_name(name: Symbol): [number, FormatArgument] | undefined;
    by_index(i: number): FormatArgument | undefined;
    unnamed_args(): readonly FormatArgument[];
    named_args(): readonly FormatArgument[];
    explicit_args(): readonly FormatArgument[];
    all_args(): readonly FormatArgument[];
    all_args_mut(): FormatArgument[];
  }
}

export type FormatArguments = gen.FormatArguments;
// PORT: statics of the generated class, attached below in upstream order.
export const FormatArguments = gen.FormatArguments as typeof gen.FormatArguments & {
  "new": () => FormatArguments;
};

// PORT: `names: FxHashMap<Symbol, usize>` iterates (and `{:?}`s) in rustc's bucket order.
// rustc: compiler/rustc_ast/src/format.rs:85 new
FormatArguments.new = function (): FormatArguments {
  return new gen.FormatArguments([], 0, 0, FxHashMap.default<Symbol, number>(u32_key, LAYOUT_USIZE));
};

// rustc: compiler/rustc_ast/src/format.rs:94 add
gen.FormatArguments.prototype.add = function (this: FormatArguments, arg: FormatArgument): number {
  const index = this.arguments.length;
  const name = FormatArgumentKind.ident(arg.kind);
  if (name !== undefined) {
    this.names.set(name.name, index);
  } else if (this.names.size === 0) {
    // Only count the unnamed args before the first named arg.
    // (Any later ones are errors.)
    this.num_unnamed_args += 1;
  }
  if (!(arg.kind.$ === "Captured")) {
    // This is an explicit argument.
    // Make sure that all arguments so far are explicit.
    // PORT: `assert_eq!(l, r, msg)` panics with the custom message plus both values.
    assert(
      this.num_explicit_args === this.arguments.length,
      `assertion \`left == right\` failed: captured arguments must be added last\n  left: ${this.num_explicit_args}\n right: ${this.arguments.length}`,
    );
    this.num_explicit_args += 1;
  }
  this.arguments.push(arg);
  return index;
};

// rustc: compiler/rustc_ast/src/format.rs:117 by_name
gen.FormatArguments.prototype.by_name = function (this: FormatArguments, name: Symbol): [number, FormatArgument] | undefined {
  const i = this.names.get(name);
  if (i === undefined) return undefined;
  return [i, this.arguments[i]!];
};

// rustc: compiler/rustc_ast/src/format.rs:122 by_index
gen.FormatArguments.prototype.by_index = function (this: FormatArguments, i: number): FormatArgument | undefined {
  return i < this.num_explicit_args ? this.arguments[i]! : undefined;
};

// rustc: compiler/rustc_ast/src/format.rs:126 unnamed_args
gen.FormatArguments.prototype.unnamed_args = function (this: FormatArguments): readonly FormatArgument[] {
  return this.arguments.slice(0, this.num_unnamed_args);
};

// rustc: compiler/rustc_ast/src/format.rs:130 named_args
gen.FormatArguments.prototype.named_args = function (this: FormatArguments): readonly FormatArgument[] {
  // PORT: Rust slicing panics when `start > end`; `num_unnamed_args <= num_explicit_args` holds by
  // construction in `add`, so the TS `slice` never sees that case.
  return this.arguments.slice(this.num_unnamed_args, this.num_explicit_args);
};

// rustc: compiler/rustc_ast/src/format.rs:134 explicit_args
gen.FormatArguments.prototype.explicit_args = function (this: FormatArguments): readonly FormatArgument[] {
  return this.arguments.slice(0, this.num_explicit_args);
};

// rustc: compiler/rustc_ast/src/format.rs:138 all_args
gen.FormatArguments.prototype.all_args = function (this: FormatArguments): readonly FormatArgument[] {
  return this.arguments;
};

// rustc: compiler/rustc_ast/src/format.rs:142 all_args_mut
gen.FormatArguments.prototype.all_args_mut = function (this: FormatArguments): FormatArgument[] {
  return this.arguments;
};

export type FormatArgumentKind = FormatArgumentKindT;
export const FormatArgumentKind = {
  ...gen.FormatArgumentKind,

  // rustc: compiler/rustc_ast/src/format.rs:168 ident
  ident(self: FormatArgumentKind): Ident | undefined {
    switch (self.$) {
      case "Normal":
        return undefined;
      case "Named":
        return self._0;
      case "Captured":
        return self._0;
    }
  },
};

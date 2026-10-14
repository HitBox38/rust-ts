// Port of compiler/rustc_type_ir/src/walk.rs (lane tyir-binder).
//
//! An iterator over the type substructure.
//! WARNING: this does not keep track of the region depth.
//
// PORT (D3): `I: Interner` is erased: `I::GenericArg` is `GenericArg` (`Ty | Region | Const`), `I::Pat` is
// rustc_middle's `Pattern`.
// PORT: `debug!` (tracing) produces no output in the oracle and is left as comments.
import type { Pattern } from "../rustc_middle/ty/decls.ts";
import { fold_GenericArgs, GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { Term } from "../rustc_middle/ty/mod.ts";
import type { Value } from "../rustc_middle/ty/decls.ts";
import { Value as ValueC } from "../rustc_middle/ty/consts/valtree.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { unported, unwrap } from "../std/panic.ts";
import { Binder } from "./binder.ts";
import type { PatternKind } from "./pattern.ts";
import { UnsafeBinderInner_deref } from "./ty_kind.ts";

// The TypeWalker's stack is hot enough that it's worth going to some effort to
// avoid heap allocations.
// PORT: `SmallVec<[GenericArg; 8]>` is an array.
// rustc-type: compiler/rustc_type_ir/src/walk.rs:13 TypeWalkerStack
type TypeWalkerStack = GenericArg[];

/// An iterator for walking the type tree.
///
/// It's very easy to produce a deeply
/// nested type tree with a lot of
/// identical subtrees. In order to work efficiently
/// in this situation walker only visits each type once.
/// It maintains a set of visited types and
/// skips any types that are already there.
// rustc-type: compiler/rustc_type_ir/src/walk.rs:23 TypeWalker
export class TypeWalker implements Iterable<GenericArg> {
  constructor(
    public stack: TypeWalkerStack,
    public last_subtree: number,
    // PORT: `SsoHashSet<I::GenericArg>` keyed by the interned object, only probed for membership (D6): a `Set`.
    public visited: Set<GenericArg>,
  ) {}

  // rustc: compiler/rustc_type_ir/src/walk.rs:30 new
  static new(root: GenericArg): TypeWalker {
    return new TypeWalker([root], 1, new Set());
  }

  /// Skips the subtree corresponding to the last type
  /// returned by `next()`.
  ///
  /// Example: Imagine you are walking `Foo<Bar<i32>, usize>`.
  ///
  /// ```ignore (illustrative)
  /// let mut iter: TypeWalker = ...;
  /// iter.next(); // yields Foo
  /// iter.next(); // yields Bar<i32>
  /// iter.skip_current_subtree(); // skips i32
  /// iter.next(); // yields usize
  /// ```
  // rustc: compiler/rustc_type_ir/src/walk.rs:46 skip_current_subtree
  skip_current_subtree(): void {
    // `SmallVec::truncate`: no-op when already shorter.
    if (this.stack.length > this.last_subtree) this.stack.length = this.last_subtree;
  }

  // impl Iterator for TypeWalker: type Item = I::GenericArg;

  // rustc: compiler/rustc_type_ir/src/walk.rs:54 next
  next(): GenericArg | undefined {
    // debug!("next(): stack={:?}", self.stack);
    for (;;) {
      const next = this.stack.pop();
      if (next === undefined) return undefined;
      this.last_subtree = this.stack.length;
      if (!this.visited.has(next)) {
        this.visited.add(next);
        push_inner(this.stack, next);
        // debug!("next: stack={:?}", self.stack);
        return next;
      }
    }
  }

  // PORT: lets `for (const arg of walker)` drive `next` like a Rust `for` loop.
  *[globalThis.Symbol.iterator](): Iterator<GenericArg> {
    for (;;) {
      const n = this.next();
      if (n === undefined) return;
      yield n;
    }
  }
}

/// We push `GenericArg`s on the stack in reverse order so as to
/// maintain a pre-order traversal. As of the time of this
/// writing, the fact that the traversal is pre-order is not
/// known to be significant to any code, but it seems like the
/// natural order one would expect (basically, the order of the
/// types as they are written).
// rustc: compiler/rustc_type_ir/src/walk.rs:74 push_inner
function push_inner(stack: TypeWalkerStack, parent: GenericArg): void {
  const pk = GenericArg.kind(parent);
  switch (pk.$) {
    case "Type": {
      const parent_ty = pk._0;
      const k = parent_ty.kind();
      switch (k.$) {
        case "Bool":
        case "Char":
        case "Int":
        case "Uint":
        case "Float":
        case "Str":
        case "Infer":
        case "Param":
        case "Never":
        case "Error":
        case "Placeholder":
        case "Bound":
        case "Foreign":
          break;

        case "Pat": {
          const ty = k._0;
          const pat = k._1;
          push_ty_pat(stack, pat);
          stack.push(GenericArg.from_Ty(ty));
          break;
        }
        case "Array": {
          const ty = k._0;
          const len = k._1;
          stack.push(GenericArg.from_Const(len));
          stack.push(GenericArg.from_Ty(ty));
          break;
        }
        case "Slice": {
          const ty = k._0;
          stack.push(GenericArg.from_Ty(ty));
          break;
        }
        case "RawPtr": {
          const ty = k._0;
          stack.push(GenericArg.from_Ty(ty));
          break;
        }
        case "Ref": {
          const lt = k._0;
          const ty = k._1;
          stack.push(GenericArg.from_Ty(ty));
          stack.push(GenericArg.from_Region(lt));
          break;
        }
        case "Alias": {
          const alias = k._1;
          stack.push(...[...alias.args].reverse());
          break;
        }
        case "Dynamic": {
          const obj = k._0;
          const lt = k._1;
          stack.push(GenericArg.from_Region(lt));
          for (const predicate of [...obj].reverse()) {
            let args: readonly GenericArg[];
            let opt_ty: Term | undefined;
            const p = Binder.skip_binder(predicate);
            switch (p.$) {
              case "Trait": {
                const tr = p._0;
                args = tr.args;
                opt_ty = undefined;
                break;
              }
              case "Projection": {
                const pr = p._0;
                args = pr.args;
                opt_ty = pr.term;
                break;
              }
              case "AutoTrait":
                continue;
            }

            stack.push(...[...args].reverse());
            if (opt_ty !== undefined) {
              const tk = Term.kind(opt_ty);
              switch (tk.$) {
                case "Ty":
                  stack.push(GenericArg.from_Ty(tk._0));
                  break;
                case "Const":
                  stack.push(GenericArg.from_Const(tk._0));
                  break;
              }
            }
          }
          break;
        }
        case "Adt":
        case "Closure":
        case "CoroutineClosure":
        case "Coroutine":
        case "CoroutineWitness": {
          const args = k._1;
          stack.push(...[...args].reverse());
          break;
        }
        case "FnDef": {
          const args = k._1;
          stack.push(...[...unwrap(Binder.no_bound_vars(args, fold_GenericArgs))].reverse());
          break;
        }
        case "Tuple": {
          const ts = k._0;
          stack.push(...[...ts].reverse().map((ty: Ty) => GenericArg.from_Ty(ty)));
          break;
        }
        case "FnPtr": {
          const sig_tys = k._0;
          stack.push(...[...Binder.skip_binder(sig_tys).inputs_and_output].reverse().map((ty: Ty) => GenericArg.from_Ty(ty)));
          break;
        }
        case "UnsafeBinder": {
          const bound_ty = k._0;
          stack.push(GenericArg.from_Ty(Binder.skip_binder(UnsafeBinderInner_deref(bound_ty))));
          break;
        }
      }
      break;
    }
    case "Lifetime":
      break;
    case "Const": {
      const parent_ct = pk._0;
      const k = parent_ct.kind();
      switch (k.$) {
        case "Infer":
        case "Param":
        case "Placeholder":
        case "Bound":
        case "Error":
          break;

        case "Value": {
          const cv = k._0;
          stack.push(GenericArg.from_Ty(Value_ty(cv)));
          break;
        }

        case "Expr": {
          const expr = k._0;
          // PORT: `inherent::ExprConst::args` (rustc_middle ty/consts/kind.rs:27) is `self.args`.
          stack.push(...[...expr.args].reverse());
          break;
        }
        case "Alias": {
          const ct = k._1;
          stack.push(...[...ct.args].reverse());
          break;
        }
      }
      break;
    }
  }
}

// rustc: compiler/rustc_type_ir/src/walk.rs:172 push_ty_pat
function push_ty_pat(stack: TypeWalkerStack, pat: Pattern): void {
  const k = Pattern_kind(pat);
  switch (k.$) {
    case "Range": {
      const start = k.start;
      const end = k.end;
      stack.push(GenericArg.from_Const(end));
      stack.push(GenericArg.from_Const(start));
      break;
    }
    case "Or": {
      const pats = k._0;
      for (const pat of pats) {
        push_ty_pat(stack, pat);
      }
      break;
    }
    case "NotNull":
      break;
  }
}

// ---- PORT stand-ins for items of files that are not ported yet ----------------------------------------------------

/** PORT: stand-in for `Pattern::kind` (`impl IntoKind for Pattern`, rustc_middle ty/pattern.rs; `Pattern` is pending). */
function Pattern_kind(_pat: Pattern): PatternKind {
  return unported("rustc_middle::ty::Pattern::kind (Pattern not ported yet)");
}

/** `inherent::ValueConst::ty` (rustc_middle ty/consts/valtree.rs:231, lane ty-results). */
function Value_ty(cv: Value): Ty {
  return ValueC.ty(cv);
}

// Port of compiler/rustc_hir/src/pat_util.rs
//
// PORT: `impl hir::Pat<'_>` fns are prototype methods of the generated `Pat` class, declared via
// `declare module` on the hir types module (PORTING §5 "Methods defined in another file"); the crate
// root imports this file for its side effects after hir.ts.
import { BindingMode, ByRef } from "../rustc_ast/lib.ts";
import type { Mutability } from "../rustc_ast/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { type DefId, DefIdSet } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Ident } from "../rustc_span/symbol.ts";
import { Pat } from "./hir.ts";
import type { DotDotPos } from "./hir.ts";

declare module "./hir.gen.ts" {
  interface Pat {
    each_binding(f: (binding_mode: BindingMode, hir_id: HirId, span: Span, ident: Ident) => void): void;
    each_binding_or_first(f: (binding_mode: BindingMode, hir_id: HirId, span: Span, ident: Ident) => void): void;
    simple_ident(): Ident | undefined;
    necessary_variants(): DefId[];
    contains_explicit_ref_binding(): Mutability | undefined;
  }
}

// PORT: `std::iter::Enumerate<I>` over the slice iterators upstream calls this on
// (`pats.iter().enumerate_and_adjust(..)`): a cursor into a readonly array. Pending a home in src/std.
export class Enumerate<T> {
  constructor(
    public iter: readonly T[],
    public count: number,
  ) {}
  /** `Iterator::next` */
  next(): [number, T] | undefined {
    if (this.count >= this.iter.length) return undefined;
    const i = this.count;
    this.count += 1;
    return [i, this.iter[i]!];
  }
  /** `Iterator::size_hint` */
  size_hint(): [number, number | undefined] {
    const n = this.iter.length - this.count;
    return [n, n];
  }
}

// rustc-type: compiler/rustc_hir/src/pat_util.rs:9 EnumerateAndAdjust
export class EnumerateAndAdjust<T> implements Iterable<[number, T]> {
  constructor(
    public enumerate: Enumerate<T>,
    public gap_pos: number,
    public gap_len: number,
  ) {}

  // impl<I> Iterator for EnumerateAndAdjust<I> where I: Iterator
  // type Item = (usize, <I as Iterator>::Item);

  // rustc: compiler/rustc_hir/src/pat_util.rs:21 next
  next(): [number, T] | undefined {
    const n = this.enumerate.next();
    if (n === undefined) return undefined;
    const [i, elem] = n;
    return [i < this.gap_pos ? i : i + this.gap_len, elem];
  }

  // rustc: compiler/rustc_hir/src/pat_util.rs:27 size_hint
  size_hint(): [number, number | undefined] {
    return this.enumerate.size_hint();
  }

  // PORT: lets `for (const [i, p] of it)` drive `next` like a Rust `for` loop.
  *[Symbol.iterator](): Iterator<[number, T]> {
    for (;;) {
      const n = this.next();
      if (n === undefined) return;
      yield n;
    }
  }
}

// rustc-trait: compiler/rustc_hir/src/pat_util.rs:32 EnumerateAndAdjustIterator
// PORT: the trait (one method, one blanket impl for `T: ExactSizeIterator`) becomes the free function
// below taking the iterated slice as `self`.
// rustc: compiler/rustc_hir/src/pat_util.rs:33 enumerate_and_adjust
// (trait declaration: `fn enumerate_and_adjust(self, expected_len: usize, gap_pos: hir::DotDotPos)
//  -> EnumerateAndAdjust<Self> where Self: Sized;`)

// impl<T: ExactSizeIterator> EnumerateAndAdjustIterator for T
// rustc: compiler/rustc_hir/src/pat_util.rs:43 enumerate_and_adjust
export function enumerate_and_adjust<T>(self: readonly T[], expected_len: number, gap_pos: DotDotPos): EnumerateAndAdjust<T> {
  const actual_len = self.length;
  const opt = gap_pos.as_opt_usize();
  // PORT: `expected_len - actual_len` is a `usize` subtraction; callers guarantee
  // `expected_len >= actual_len` (rustc ships without overflow checks).
  return new EnumerateAndAdjust(new Enumerate(self, 0), opt === undefined ? expected_len : opt, expected_len - actual_len);
}

// impl hir::Pat<'_>

/// Call `f` on every "binding" in a pattern, e.g., on `a` in
/// `match foo() { Some(a) => (), None => () }`
// rustc: compiler/rustc_hir/src/pat_util.rs:63 each_binding
Pat.prototype.each_binding = function (this: Pat, f: (binding_mode: BindingMode, hir_id: HirId, span: Span, ident: Ident) => void): void {
  this.walk_always((p) => {
    if (p.kind.$ === "Binding") {
      const binding_mode = p.kind._0;
      const ident = p.kind._2;
      f(binding_mode, p.hir_id, p.span, ident);
    }
  });
};

/// Call `f` on every "binding" in a pattern, e.g., on `a` in
/// `match foo() { Some(a) => (), None => () }`.
///
/// When encountering an or-pattern `p_0 | ... | p_n` only the first non-never pattern will be
/// visited. If they're all never patterns we visit nothing, which is ok since a never pattern
/// cannot have bindings.
// rustc: compiler/rustc_hir/src/pat_util.rs:77 each_binding_or_first
Pat.prototype.each_binding_or_first = function (
  this: Pat,
  f: (binding_mode: BindingMode, hir_id: HirId, span: Span, ident: Ident) => void,
): void {
  this.walk((p) => {
    switch (p.kind.$) {
      case "Or": {
        const ps = p.kind._0;
        for (const p of ps) {
          if (!p.is_never_pattern()) {
            p.each_binding_or_first(f);
            break;
          }
        }
        return false;
      }
      case "Binding": {
        const bm = p.kind._0;
        const ident = p.kind._2;
        f(bm, p.hir_id, p.span, ident);
        return true;
      }
      default:
        return true;
    }
  });
};

// rustc: compiler/rustc_hir/src/pat_util.rs:96 simple_ident
Pat.prototype.simple_ident = function (this: Pat): Ident | undefined {
  const kind = this.kind;
  if (kind.$ === "Binding" && kind._0._0.$ === "No" && kind._3 === undefined) {
    // PatKind::Binding(BindingMode(ByRef::No, _), _, ident, None)
    return kind._2;
  }
  return undefined;
};

/// Returns variants that are necessary to exist for the pattern to match.
// rustc: compiler/rustc_hir/src/pat_util.rs:104 necessary_variants
Pat.prototype.necessary_variants = function (this: Pat): DefId[] {
  let variants: DefId[] = [];
  this.walk((p) => {
    const kind = p.kind;
    if (kind.$ === "Or") {
      return false;
    }
    let path;
    if (kind.$ === "Expr" && kind._0.kind.$ === "Path" && kind._0.kind._0.$ === "Resolved") {
      path = kind._0.kind._0._1;
    } else if ((kind.$ === "TupleStruct" || kind.$ === "Struct") && kind._0.$ === "Resolved") {
      path = kind._0._1;
    }
    if (path !== undefined) {
      const res = path.res;
      if (res.$ === "Def" && (res._0.$ === "Variant" || (res._0.$ === "Ctor" && res._0._0 === "Variant"))) {
        const id = res._1;
        variants.push(id);
      }
      return true;
    }
    return true;
  });
  // We remove duplicates by inserting into a hash set to avoid re-ordering
  // the bounds
  const duplicates = new DefIdSet();
  // PORT: `HashSet::insert` returns whether the value was new.
  variants = variants.filter((def_id) => {
    if (duplicates.has(def_id)) return false;
    duplicates.add(def_id);
    return true;
  });
  return variants;
};

/// Checks if the pattern contains any `ref` or `ref mut` bindings, and if
/// yes whether it contains mutable or just immutables ones.
//
// FIXME(tschottdorf): this is problematic as the HIR is being scraped, but
// ref bindings are be implicit after #42640 (default match binding modes). See issue #44848.
// rustc: compiler/rustc_hir/src/pat_util.rs:135 contains_explicit_ref_binding
Pat.prototype.contains_explicit_ref_binding = function (this: Pat): Mutability | undefined {
  let result: Mutability | undefined = undefined;
  this.each_binding((annotation, _, __, ___) => {
    if (BindingMode_is(annotation, BindingMode.REF) && result === undefined) {
      result = "Not";
    } else if (BindingMode_is(annotation, BindingMode.REF_MUT)) {
      result = "Mut";
    }
  });
  return result;
};

// PORT: pattern match against the `BindingMode::REF`/`REF_MUT` consts (structural equality of
// `BindingMode(ByRef, Mutability)`).
function BindingMode_is(a: BindingMode, b: BindingMode): boolean {
  if (a._1 !== b._1) return false;
  const x: ByRef = a._0;
  const y: ByRef = b._0;
  if (x.$ === "No" || y.$ === "No") return x.$ === y.$;
  return x._0 === y._0 && x._1 === y._1;
}

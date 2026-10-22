// Port of compiler/rustc_mir_transform/src/mentioned_items.rs (lane mt-cleanup).
//
// PORT: `MentionedItemsVisitor` `extends Visitor` (mir/visit.ts, D4); the `span` closures are local arrow fns.
import { type Body, type Location, type MentionedItem, Operand, type Rvalue, type Terminator } from "../rustc_middle/mir/mod.ts";
import { Const as mir_Const } from "../rustc_middle/mir/consts.ts";
import { Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Spanned } from "../rustc_span/lib.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/mentioned_items.rs:9 MentionedItems
export class MentionedItems extends MirPass {
  readonly type_name = "rustc_mir_transform::mentioned_items::MentionedItems";

  // rustc: compiler/rustc_mir_transform/src/mentioned_items.rs:18 policy
  policy(_ctx: PassCtx): PassPolicy {
    // If this pass is skipped the collector assume that nothing got mentioned! We could
    // potentially skip it in opt-level 0 if we are sure that opt-level will never *remove* uses
    // of anything, but that still seems fragile. Furthermore, even debug builds use level 1, so
    // special-casing level 0 is just not worth it.
    return PassPolicy.Required;
  }

  // rustc: compiler/rustc_mir_transform/src/mentioned_items.rs:26 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const visitor = new MentionedItemsVisitor(tcx, body, []);
    visitor.visit_body(body);
    body.set_mentioned_items(visitor.mentioned_items);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/mentioned_items.rs:11 MentionedItemsVisitor
class MentionedItemsVisitor extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public body: Body,
    public mentioned_items: Spanned<MentionedItem>[],
  ) {
    super();
  }

  // This visitor is carefully in sync with the one in `rustc_monomorphize::collector`. We are
  // visiting the exact same places but then instead of monomorphizing and creating `MonoItems`, we
  // have to remain generic and just recording the relevant information in `mentioned_items`, where it
  // will then be monomorphized later during "mentioned items" collection.
  // rustc: compiler/rustc_mir_transform/src/mentioned_items.rs:38 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    this.super_terminator(terminator, location);
    const span = () => this.body.source_info(location).span;
    const kind = terminator.kind;
    switch (kind.$) {
      case "Call":
      case "TailCall": {
        const func = kind.func;
        const callee_ty = Operand.ty(func, this.body, this.tcx);
        this.mentioned_items.push({ node: { $: "Fn", _0: callee_ty }, span: span() });
        break;
      }
      case "Drop": {
        const place = kind.place;
        const ty = place.ty(this.body, this.tcx).ty;
        this.mentioned_items.push({ node: { $: "Drop", _0: ty }, span: span() });
        break;
      }
      case "InlineAsm": {
        const operands = kind.operands;
        for (const op of operands) {
          if (op.$ === "SymFn") {
            const value = op.value;
            this.mentioned_items.push({
              node: { $: "Fn", _0: mir_Const.ty(value.const_) },
              span: span(),
            });
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/mentioned_items.rs:68 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    this.super_rvalue(rvalue, location);
    const span = () => this.body.source_info(location).span;
    if (rvalue.$ === "Cast" && rvalue._0.$ === "PointerCoercion" && rvalue._0._0.$ === "Unsize") {
      // We need to detect unsizing casts that required vtables.
      const operand = rvalue._1;
      const target_ty = rvalue._2;
      // This isn't monomorphized yet so we can't tell what the actual types are -- just
      // add everything that may involve a vtable.
      const source_ty = Operand.ty(operand, this.body, this.tcx);
      const a = source_ty.builtin_deref(true)?.kind();
      const b = target_ty.builtin_deref(true)?.kind();
      let may_involve_vtable: boolean;
      if (a !== undefined && a.$ === "Array" && b !== undefined && (b.$ === "Str" || b.$ === "Slice")) {
        // &str/&[T] unsizing
        may_involve_vtable = false;
      } else {
        may_involve_vtable = true;
      }
      if (may_involve_vtable) {
        this.mentioned_items.push({
          node: { $: "UnsizeCast", source_ty, target_ty },
          span: span(),
        });
      }
    } else if (rvalue.$ === "Cast" && rvalue._0.$ === "PointerCoercion" && rvalue._0._0.$ === "ClosureFnPointer") {
      // Similarly, record closures that are turned into function pointers.
      const operand = rvalue._1;
      const source_ty = Operand.ty(operand, this.body, this.tcx);
      this.mentioned_items.push({ node: { $: "Closure", _0: source_ty }, span: span() });
    } else if (rvalue.$ === "Cast" && rvalue._0.$ === "PointerCoercion" && rvalue._0._0.$ === "ReifyFnPointer") {
      // And finally, function pointer reification casts.
      const operand = rvalue._1;
      const fn_ty = Operand.ty(operand, this.body, this.tcx);
      this.mentioned_items.push({ node: { $: "Fn", _0: fn_ty }, span: span() });
    } else {
    }
  }
}

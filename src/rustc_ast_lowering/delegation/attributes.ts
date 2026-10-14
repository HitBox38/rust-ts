// Port of compiler/rustc_ast_lowering/src/delegation/attributes.rs (lane lower-delegation).
//
// The `impl LoweringContext` methods of this file are declared in ../decls.ts (the contract) and assigned onto the
// prototype here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { type Attribute, clone_Attribute, InlineAttr } from "../../rustc_attr_ir/lib.ts";
import { ItemLocalId } from "../../rustc_hir_id/lib.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { LoweringContext } from "../decls.ts";
import type { DelegationResolution, PerOwnerLoweringStateFields } from "./resolution.ts";

// ---- Types of this file ----
// PORT(gen): codegen set rustc_ast_lowering generates these with `unknown` fn-pointer fields; the hand types below
// give the fn pointers their signatures. Keep them hand-written (list them under `hand` in the set).
// rustc-type: compiler/rustc_ast_lowering/src/delegation/attributes.rs:9 AdditionInfo
interface AdditionInfo {
  equals: (a: Attribute) => boolean;
  kind: AdditionKind;
}

// rustc-type: compiler/rustc_ast_lowering/src/delegation/attributes.rs:14 AdditionKind
type AdditionKind =
  | { readonly $: "Default"; factory: (span: Span) => Attribute }
  | { readonly $: "Inherit"; factory: (span: Span, original_attr: Attribute) => Attribute };

const ADDITIONS: readonly AdditionInfo[] = [
  {
    equals: (a) => a.$ === "Parsed" && a._0.$ === "MustUse",
    kind: {
      $: "Inherit",
      factory: (span, original_attr) => {
        const reason = original_attr.$ === "Parsed" && original_attr._0.$ === "MustUse" ? original_attr._0.reason : undefined;

        return { $: "Parsed", _0: { $: "MustUse", span, reason } };
      },
    },
  },
  {
    equals: (a) => a.$ === "Parsed" && a._0.$ === "Inline",
    kind: {
      $: "Default",
      factory: (span) => ({ $: "Parsed", _0: { $: "Inline", _0: InlineAttr.Hint, _1: span } }),
    },
  },
];

// rustc: compiler/rustc_ast_lowering/src/delegation/attributes.rs:46 add_attrs_if_needed
LoweringContext.prototype.add_attrs_if_needed = function (this: LoweringContext, resolution: DelegationResolution): void {
  const { span, sig_id } = resolution;

  const PARENT_ID: ItemLocalId = ItemLocalId.ZERO;
  const curr_owner = this.curr_owner as PerOwnerLoweringStateFields;
  const new_attrs = this.create_new_attrs(span, sig_id, curr_owner.attrs.get(PARENT_ID));

  if (new_attrs.length !== 0) {
    const existing_attrs = curr_owner.attrs.get(PARENT_ID);
    const new_attrs_ =
      existing_attrs !== undefined
        ? this.arena.alloc_from_iter([...existing_attrs.map((a) => clone_Attribute(a)), ...new_attrs])
        : this.arena.alloc_from_iter(new_attrs);

    curr_owner.attrs.insert(PARENT_ID, new_attrs_);
  }
};

// rustc: compiler/rustc_ast_lowering/src/delegation/attributes.rs:64 create_new_attrs
LoweringContext.prototype.create_new_attrs = function (
  this: LoweringContext,
  span: Span,
  sig_id: DefId,
  existing: readonly Attribute[] | undefined,
): Attribute[] {
  const out: Attribute[] = [];
  for (const addition of ADDITIONS) {
    if (!(existing === undefined || !existing.some((a) => addition.equals(a)))) continue;
    let attr: Attribute | undefined;
    switch (addition.kind.$) {
      case "Default":
        attr = addition.kind.factory(span);
        break;
      case "Inherit": {
        const factory = addition.kind.factory;
        // #[allow(deprecated)]
        // PORT: `TyCtxt::get_all_attrs` is typed with rustc_middle's pending `hir::Attribute`, which is
        // `rustc_attr_ir::Attribute` at the pin.
        const attrs = this.tcx.get_all_attrs(sig_id) as unknown as readonly Attribute[];
        attr = undefined;
        for (const a of attrs) {
          if (addition.equals(a)) {
            attr = factory(span, a);
            break;
          }
        }
        break;
      }
    }
    if (attr !== undefined) out.push(attr);
  }
  return out;
};

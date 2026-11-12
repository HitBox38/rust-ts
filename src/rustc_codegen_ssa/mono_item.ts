// Port of compiler/rustc_codegen_ssa/src/mono_item.rs (lane ssa-mir-rest, plan-m7 wave 41).
//
// PORT (ssa-mir-rest):
// - `trait MonoItemExt` has one implementor, `MonoItem`; its methods live on the companion const `MonoItemExt`, taking the
//   `MonoItem` first (PORTING §8). The trait's declarations (:12, :18, :25) are the `MonoItemExt_methods` interface.
// - `define::<Bx>` calls `base::codegen_instance::<Bx>`, which builds `Bx`s: it takes the builder's static side `Bx_` first,
//   as `codegen_mir(Bx_, cx, instance)` does (ssa-mir-core PORT 1). `predefine::<Bx>` uses `Bx` only to type `cx`, so it
//   takes no `Bx_`.
// - `debug!` is compiled out of rustc (STATIC_MAX_LEVEL = INFO, rust_ts/tracing.ts) and stays a comment.
// - Calls into lanes that have not landed are typed module-private stubs (`unported("<lane>: <path> <fn>")`): base.rs
//   `codegen_instance` and `codegen_global_asm` (ssa-base) and mir/naked_asm.rs `codegen_naked_asm`
//   (ssa-rvalue-intrinsic). Root repoints them at integration.
import type { Linkage } from "../rustc_attr_ir/data_structures.gen.ts";
import type { ItemId } from "../rustc_hir/hir.ts";
import { debug_ItemId } from "../rustc_hir/hir.ts";
import { CodegenFnAttrFlags, TyCtxt_codegen_instance_attrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { MonoItem, type MonoItemData, type Visibility } from "../rustc_middle/mono.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import { debug_DefId } from "../rustc_span/def_id.ts";
import { PLAIN } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { BackendTypes } from "./traits/backend.ts";
import type { BuilderMethods, BuilderMethodsStatic } from "./traits/builder.ts";
import type { CodegenMethods } from "./traits/mod.ts";

/** Stub: `rustc_codegen_ssa::base::codegen_global_asm` (base.rs, lane ssa-base). */
function base_codegen_global_asm<B extends BackendTypes>(_cx: CodegenMethods<B>, _item_id: ItemId): void {
  return unported("ssa-base: compiler/rustc_codegen_ssa/src/base.rs codegen_global_asm");
}

/** Stub: `rustc_codegen_ssa::base::codegen_instance::<Bx>` (base.rs, lane ssa-base). */
function base_codegen_instance<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
  _Bx_: BuilderMethodsStatic<B, Cx, Bx>,
  _cx: Cx,
  _instance: Instance,
): void {
  return unported("ssa-base: compiler/rustc_codegen_ssa/src/base.rs codegen_instance");
}

/** Stub: `rustc_codegen_ssa::mir::naked_asm::codegen_naked_asm::<Bx::CodegenCx>` (mir/naked_asm.rs, lane ssa-rvalue-intrinsic). */
function naked_asm_codegen_naked_asm<B extends BackendTypes>(_cx: CodegenMethods<B>, _instance: Instance, _item_data: MonoItemData): void {
  return unported("ssa-rvalue-intrinsic: compiler/rustc_codegen_ssa/src/mir/naked_asm.rs codegen_naked_asm");
}

/** The stubs above, as one table so a test can replace them; not upstream. */
export const mono_item_xlane = {
  codegen_global_asm: base_codegen_global_asm,
  codegen_instance: base_codegen_instance,
  codegen_naked_asm: naked_asm_codegen_naked_asm,
};

/** `pub trait MonoItemExt<'a, 'tcx>` (the declarations; header). */
export interface MonoItemExt_methods {
  // rustc: compiler/rustc_codegen_ssa/src/mono_item.rs:12 define
  define<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
    self: MonoItem,
    Bx_: BuilderMethodsStatic<B, Cx, Bx>,
    cx: Cx,
    cgu_name: string,
    item_data: MonoItemData,
  ): void;
  // rustc: compiler/rustc_codegen_ssa/src/mono_item.rs:18 predefine
  predefine<B extends BackendTypes>(self: MonoItem, cx: CodegenMethods<B>, cgu_name: string, linkage: Linkage, visibility: Visibility): void;
  // rustc: compiler/rustc_codegen_ssa/src/mono_item.rs:25 to_raw_string
  to_raw_string(self: MonoItem): string;
}

// impl<'a, 'tcx: 'a> MonoItemExt<'a, 'tcx> for MonoItem<'tcx>
export const MonoItemExt: MonoItemExt_methods = {
  // rustc: compiler/rustc_codegen_ssa/src/mono_item.rs:29 define
  define<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
    self: MonoItem,
    Bx_: BuilderMethodsStatic<B, Cx, Bx>,
    cx: Cx,
    _cgu_name: string,
    item_data: MonoItemData,
  ): void {
    // debug!("BEGIN IMPLEMENTING '{} ({})' in cgu {}", self, self.to_raw_string(), cgu_name);

    switch (self.$) {
      case "Static": {
        const def_id = self._0;
        cx.codegen_static(def_id);
        break;
      }
      case "GlobalAsm": {
        const item_id = self._0;
        mono_item_xlane.codegen_global_asm(cx, item_id);
        break;
      }
      case "Fn": {
        const instance = self._0;
        const flags = TyCtxt_codegen_instance_attrs(cx.tcx_(), instance.def).flags;
        if (CodegenFnAttrFlags.contains(flags, CodegenFnAttrFlags.NAKED)) {
          mono_item_xlane.codegen_naked_asm(cx, instance, item_data);
        } else {
          mono_item_xlane.codegen_instance(Bx_, cx, instance);
        }
        break;
      }
    }

    // debug!("END IMPLEMENTING '{} ({})' in cgu {}", self, self.to_raw_string(), cgu_name);
  },

  // rustc: compiler/rustc_codegen_ssa/src/mono_item.rs:57 predefine
  predefine<B extends BackendTypes>(self: MonoItem, cx: CodegenMethods<B>, _cgu_name: string, linkage: Linkage, visibility: Visibility): void {
    // debug!("BEGIN PREDEFINING '{} ({})' in cgu {}", self, self.to_raw_string(), cgu_name);

    const symbol_name = MonoItem.symbol_name(self, cx.tcx_()).name;

    // debug!("symbol {symbol_name}");

    switch (self.$) {
      case "Static": {
        const def_id = self._0;
        cx.predefine_static(def_id, linkage, visibility, symbol_name);
        break;
      }
      case "Fn": {
        const instance = self._0;
        const attrs = TyCtxt_codegen_instance_attrs(cx.tcx_(), instance.def);

        if (CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.NAKED)) {
          // do not define this function; it will become a global assembly block
        } else {
          cx.predefine_fn(instance, linkage, visibility, symbol_name);
        }
        break;
      }
      case "GlobalAsm":
        break;
    }

    // debug!("END PREDEFINING '{} ({})' in cgu {}", self, self.to_raw_string(), cgu_name);
  },

  // rustc: compiler/rustc_codegen_ssa/src/mono_item.rs:89 to_raw_string
  to_raw_string(self: MonoItem): string {
    switch (self.$) {
      case "Fn":
        // `format!("Fn({:?}, {})", instance.def, instance.args.as_ptr().addr())`
        // PORT: the address of the interned args list has no equivalent here; only the compiled-out `debug!` lines above
        // call this.
        return unported("rustc_codegen_ssa::mono_item::to_raw_string: the address of an interned `GenericArgs` list");
      case "Static": {
        const id = self._0;
        return `Static(${debug_DefId(id, PLAIN)})`;
      }
      case "GlobalAsm": {
        const id = self._0;
        return `GlobalAsm(${debug_ItemId(id, PLAIN)})`;
      }
    }
  },
};

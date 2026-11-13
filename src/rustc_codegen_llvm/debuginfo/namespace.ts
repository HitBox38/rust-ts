// Port of compiler/rustc_codegen_llvm/src/debuginfo/namespace.rs (lane cg-di-a, plan-m7 wave 40p).
// Namespace Handling.
//
// PORT (cg-di-a):
// - `output: String` handed to `type_names::push_item_name` as `&mut String` is a `MutRef<string>` (ssa-debuginfo's
//   type_names.ts); `String::with_capacity(64)` is the empty string.
// - `namespace_map: RefCell<DefIdMap<&DIScope>>` is a `DefIdMap` (rustc_span); `.borrow()` / `.borrow_mut()` read the field.
// - `DefId { krate, index }` is `new DefId(index, krate)` (the class's field order).
import { push_item_name } from "../../rustc_codegen_ssa/debuginfo/type_names.ts";
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import type { SymbolName } from "../../rustc_middle/ty/mod.ts";
import { DefId } from "../../rustc_span/def_id.ts";
import { utf8_len } from "../../std/str.ts";
import type { CodegenCx } from "../context.ts";
import * as llvm from "../llvm/mod.ts";
import type { DIScope } from "../llvm/mod.ts";
import { DIB, debug_context } from "./utils.ts";

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/namespace.rs:12 mangled_name_of_instance
export function mangled_name_of_instance(cx: CodegenCx, instance: Instance): SymbolName {
  return cx.tcx.symbol_name(instance);
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/namespace.rs:19 item_namespace
export function item_namespace(cx: CodegenCx, def_id: DefId): DIScope {
  const scope0 = debug_context(cx).namespace_map.get(def_id);
  if (scope0 !== undefined) {
    return scope0;
  }

  const def_key = cx.tcx.def_key(def_id);
  const parent_scope = def_key.parent === undefined ? undefined : item_namespace(cx, new DefId(def_key.parent, def_id.krate));

  const namespace_name_string = (() => {
    const output = { value: "" };
    push_item_name(cx.tcx, def_id, false, output);
    return output.value;
  })();

  const scope = llvm.LLVMDIBuilderCreateNameSpace(
    DIB(cx),
    parent_scope,
    namespace_name_string,
    utf8_len(namespace_name_string),
    llvm.FALSE, // ExportSymbols (only relevant for C++ anonymous namespaces)
  );

  debug_context(cx).namespace_map.set(def_id, scope);
  return scope;
}

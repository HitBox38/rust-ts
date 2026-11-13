// Port of compiler/rustc_codegen_llvm/src/debuginfo/gdb.rs (lane cg-di-a, plan-m7 wave 40p).
// .debug_gdb_scripts binary section.
//
// PORT (cg-di-a):
// - Free fns taking `&CodegenCx` called with a `Builder` (deref coercion) are passed `bx.cx_` (cg-contract's rule, as `cx.scx`
//   for a `&SimpleCx`).
// - `c"__rustc_debug_gdb_scripts_section__"` and its `to_str().unwrap()` are the same JS string (ffi.ts types `*const c_char`
//   as `string`, consts.ts header); `c".debug_gdb_scripts"` likewise.
// - `section_contents: Vec<u8>` is a `number[]` of bytes, made a `Uint8Array` where upstream takes `as_slice()`;
//   `format!(..).as_bytes()` is its UTF-8 bytes (`utf8`).
// - `section_contents.len() as u64` is a `bigint` (`type_array` takes `len: u64`, type_.ts).
import { Align } from "../../rustc_abi/lib.ts";
import { DebuggerVisualizerType } from "../../rustc_attr_ir/data_structures.gen.ts";
import { collect_debugger_visualizers_transitive } from "../../rustc_codegen_ssa/base.ts";
import { LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { CrateType } from "../../rustc_structures/crate_type.gen.ts";
import { utf8 } from "../../std/str.ts";
import type { Builder } from "../builder.ts";
import type { CodegenCx } from "../context.ts";
import * as llvm from "../llvm/mod.ts";
import type { Value } from "../llvm/mod.ts";

/// Inserts a side-effect free instruction sequence that makes sure that the
/// .debug_gdb_scripts global is referenced, so it isn't removed by the linker.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/gdb.rs:18 insert_reference_to_gdb_debug_scripts_section_global
export function insert_reference_to_gdb_debug_scripts_section_global(bx: Builder): void {
  if (needs_gdb_debug_scripts_section(bx.cx_)) {
    const gdb_debug_scripts_section = get_or_insert_gdb_debug_scripts_section_global(bx.cx_);
    // Load just the first byte as that's all that's necessary to force
    // LLVM to keep around the reference to the global.
    bx.volatile_load(bx.type_i8(), gdb_debug_scripts_section, Align.ONE);
  }
}

/// Allocates the global variable responsible for the .debug_gdb_scripts binary
/// section.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/gdb.rs:29 get_or_insert_gdb_debug_scripts_section_global
export function get_or_insert_gdb_debug_scripts_section_global(cx: CodegenCx): Value {
  const c_section_var_name = "__rustc_debug_gdb_scripts_section__";
  const section_var_name = c_section_var_name;

  const section_var = llvm.LLVMGetNamedGlobal(cx.llmod(), c_section_var_name);

  if (section_var !== undefined) {
    return section_var;
  }
  const section_contents: number[] = [];

  // Add the pretty printers for the standard library first.
  section_contents.push(...utf8("\x01gdb_load_rust_pretty_printers.py\0"));

  // Next, add the pretty printers that were specified via the `#[debugger_visualizer]`
  // attribute.
  const visualizers = collect_debugger_visualizers_transitive(cx.tcx, DebuggerVisualizerType.GdbPrettyPrinter);
  const crate_name = cx.tcx.crate_name(LOCAL_CRATE);
  for (const [index, visualizer] of visualizers.entries()) {
    // The initial byte `4` instructs GDB that the following pretty printer
    // is defined inline as opposed to in a standalone file.
    section_contents.push(...utf8("\x04"));
    const vis_name = `pretty-printer-${Symbol.as_str(crate_name)}-${index}\n`;
    section_contents.push(...utf8(vis_name));
    section_contents.push(...visualizer.src);

    // The final byte `0` tells GDB that the pretty printer has been
    // fully defined and can continue searching for additional
    // pretty printers.
    section_contents.push(...utf8("\0"));
  }

  {
    const section_contents_ = Uint8Array.from(section_contents);
    const llvm_type = cx.type_array(cx.type_i8(), BigInt(section_contents_.length));

    const section_var = cx.define_global(section_var_name, llvm_type) ?? bug(`symbol \`${section_var_name}\` is already defined`);
    llvm.set_section(section_var, ".debug_gdb_scripts");
    llvm.set_initializer(section_var, cx.const_bytes(section_contents_));
    llvm.LLVMSetGlobalConstant(section_var, llvm.TRUE);
    llvm.set_unnamed_address(section_var, llvm.UnnamedAddr.Global);
    llvm.set_linkage(section_var, llvm.Linkage.LinkOnceODRLinkage);
    // This should make sure that the whole section is not larger than
    // the string it contains. Otherwise we get a warning from GDB.
    llvm.LLVMSetAlignment(section_var, 1);
    return section_var;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/gdb.rs:84 needs_gdb_debug_scripts_section
export function needs_gdb_debug_scripts_section(cx: CodegenCx): boolean {
  // To ensure the section `__rustc_debug_gdb_scripts_section__` will not create
  // ODR violations at link time, this section will not be emitted for rlibs since
  // each rlib could produce a different set of visualizers that would be embedded
  // in the `.debug_gdb_scripts` section. For that reason, we make sure that the
  // section is only emitted for leaf crates.
  const embed_visualizers = cx.tcx.crate_types().some((crate_type) => {
    switch (crate_type) {
      case CrateType.Executable:
      case CrateType.Dylib:
      case CrateType.Cdylib:
      case CrateType.StaticLib:
      case CrateType.Sdylib:
        // These are crate types for which we will embed pretty printers since they
        // are treated as leaf crates.
        return true;
      case CrateType.ProcMacro:
        // We could embed pretty printers for proc macro crates too but it does not
        // seem like a good default, since this is a rare use case and we don't
        // want to slow down the common case.
        return false;
      case CrateType.Rlib:
        // As per the above description, embedding pretty printers for rlibs could
        // lead to ODR violations so we skip this crate type as well.
        return false;
    }
  });

  return cx.sess().opts.debuginfo !== "None" && cx.sess().target.emit_debug_gdb_scripts && embed_visualizers;
}

// Test helper of src/rustc_codegen_llvm/type_of.test.ts and attributes.test.ts (lane cg-types-attrs). Not ported code.
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`), builds a `CodegenCx` over an IR-model module by hand
// (`CodegenCx::new` is cg-context's, not ported yet), and prints what the oracle's `--emit=llvm-ir` shows:
//   bun run.ts types <rustc arguments...>   for each local struct / enum / union `Name`: `llvm_type Name <type>` and
//                                           `immediate Name <type>`; for each field `i` of `Probe`, the same as `Probe<i>`; then
//                                           the module's named type definitions (`%Name = type { .. }`), as LLVM prints them.
//   bun run.ts attrs <rustc arguments...>   for each local fn `a_*`: the ported attribute fns of `llfn_attrs_from_instance` that
//                                           do not stop on another lane's stub, applied to a declaration (`attrs a_x <set>`).
// An `unported(..)` stop exits 70 with `UNPORTED: <what>` on stderr.
//
// Test scaffolding (marked `SHIM`): cg-context's stubs this path reaches (`sess`, `tcx`, `typing_env`, `data_layout`,
// `handle_layout_err`) are given their upstream one-line bodies on the instance, until cg-context ports them.
import type { Compiler } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Unported } from "../../std/panic.ts";
import { write_stderr, write_stdout } from "../../std/io.ts";

async function main(mode: string, args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { DefKind } = await import("../../rustc_hir/def.ts");
  const { KeyedMap } = await import("../../rust_ts/keyed.ts");
  const { EarlyBinder } = await import("../../rustc_type_ir/binder.ts");
  const { Unnormalized } = await import("../../rustc_type_ir/unnormalized.ts");
  const { TypingEnv } = await import("../../rustc_middle/ty/mod.ts");
  const { FieldsShape } = await import("../../rustc_abi/lib.ts");
  const { Instance } = await import("../../rustc_middle/ty/instance.ts");
  const { TyCtxt_codegen_instance_attrs } = await import("../../rustc_middle/middle/codegen_fn_attrs.ts");
  const { Symbol } = await import("../../rustc_span/symbol.ts");
  const { LocalDefId } = await import("../../rustc_span/def_id.ts");
  const { printModule } = await import("../../rust_ts/llvm/printer.ts");
  await import("../lib.ts");
  const { CodegenCx, FullCx, SCx, SimpleCx } = await import("../context.ts");
  const { debug_Type } = await import("../type_.ts");
  const llvm = await import("../llvm/mod.ts");
  const attributes = await import("../attributes.ts");
  const { declare_simple_fn } = await import("../declare.ts");
  const { PLAIN } = await import("../../std/fmt.ts");
  type ModuleItems = import("../../rustc_middle/hir/mod.ts").ModuleItems;
  type Ty = import("../../rustc_middle/ty/mod.ts").Ty;

  const make_cx = (tcx: TyCtxt): InstanceType<typeof CodegenCx> => {
    const llcx = llvm.LLVMContextCreate();
    const llmod = llvm.LLVMModuleCreateWithNameInContext("cg_types_attrs_test", llcx);
    const isize_ty = llvm.LLVMIntTypeInContext(llcx, tcx.data_layout().pointer_size().bits());
    const scx = new SimpleCx(new SCx(llmod, llcx, isize_ty));
    // `FullCx`'s 31 fields in declaration order (context.ts); the ones this path never reads are left `undefined`.
    const f: unknown[] = Array.from({ length: 31 }, () => undefined);
    f[0] = tcx;
    f[1] = false; // bitcode_needed
    f[2] = scx;
    f[3] = false; // use_dll_storage_attrs
    f[6] = new KeyedMap<unknown, unknown>((k) => (k as { id: number }).id); // instances (unused here)
    f[14] = new KeyedMap<readonly [Ty, number | undefined], unknown>(([t, v]) => `${t.id}:${v ?? "-"}`); // type_lowering
    f[15] = new Map(); // scalar_lltypes
    const cx = new CodegenCx(new (FullCx as unknown as new (...a: unknown[]) => InstanceType<typeof FullCx>)(...f));
    // SHIM: cg-context's one-line bodies (context.rs), on this instance only (header).
    const shim = cx as unknown as Record<string, unknown>;
    shim.sess = () => tcx.sess;
    shim.tcx_ = () => tcx;
    shim.typing_env_ = () => TypingEnv.fully_monomorphized();
    shim.data_layout = () => tcx.data_layout();
    shim.handle_layout_err = (err: unknown) => {
      throw new Error(`layout error: ${String(err)}`);
    };
    return cx;
  };

  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      const items = tcx.hir_crate_items(null) as ModuleItems;
      const cx = make_cx(tcx);
      const out: string[] = [];
      for (const local of items.definitions()) {
        const def_id = LocalDefId.to_def_id(local);
        const kind = tcx.def_kind(def_id);
        const wanted = mode === "types" ? kind.$ === "Struct" || kind.$ === "Enum" || kind.$ === "Union" : kind.$ === "Fn";
        if (!wanted) continue;
        const name = Symbol.as_str(tcx.item_name(def_id));
        if (mode === "types") {
          const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id))) as Ty;
          const layout = cx.layout_of(ty);
          if (name === "Probe") {
            for (let i = 0; i < FieldsShape.count(layout.fields); i++) {
              const field = layout.field(cx, i);
              out.push(`llvm_type Probe${i} ${debug_Type(field.llvm_type(cx), PLAIN)}`);
              out.push(`immediate Probe${i} ${debug_Type(field.immediate_llvm_type(cx), PLAIN)}`);
            }
          } else {
            const llty = layout.llvm_type(cx);
            out.push(`llvm_type ${name} ${debug_Type(llty, PLAIN)}`);
            out.push(`immediate ${name} ${debug_Type(layout.immediate_llvm_type(cx), PLAIN)}`);
            // A declaration of the type makes the module print its definition.
            cx.declare_global(`v_${name}`, llty);
          }
        }
        if (mode === "attrs" && name.startsWith("a_")) {
          const instance = Instance.mono(tcx, def_id);
          const codegen_fn_attrs = TyCtxt_codegen_instance_attrs(tcx, instance.def);
          const llfn = declare_simple_fn(cx.scx, name, llvm.CallConv.CCallConv, "Global", "Default", cx.type_func([], cx.type_void()));
          // `llfn_attrs_from_instance` (attributes.rs:490) up to its first call into another lane's stub
          // (`Session::must_emit_unwind_tables`): the `optimize` arms and `inline_attr`. Then the frame pointer.
          const to_add: InstanceType<typeof Object>[] = [];
          switch (codegen_fn_attrs.optimize) {
            case "Default":
              to_add.push(...attributes.default_optimisation_attrs(cx.scx, tcx.sess));
              break;
            case "DoNotOptimize":
              to_add.push(llvm.AttributeKind_impl.create_attr(llvm.AttributeKind.OptimizeNone, cx.llcx()));
              break;
            case "Size":
              to_add.push(llvm.AttributeKind_impl.create_attr(llvm.AttributeKind.MinSize, cx.llcx()));
              to_add.push(llvm.AttributeKind_impl.create_attr(llvm.AttributeKind.OptimizeForSize, cx.llcx()));
              break;
            case "Speed":
              break;
          }
          const inline = attributes.inline_attr(cx.scx, tcx, instance, codegen_fn_attrs);
          if (inline !== undefined) to_add.push(inline);
          const fp = attributes.frame_pointer_type_attr(cx.scx, tcx.sess);
          if (fp !== undefined) to_add.push(fp);
          attributes.apply_to_llfn(llfn, llvm.AttributePlace.Function, to_add as never);
        }
      }
      const text = printModule(cx.llmod());
      if (mode === "types") {
        for (const line of text.split("\n")) if (line.startsWith("%")) out.push(line);
      } else {
        // `declare void @a_x() unnamed_addr #N` and `attributes #N = { .. }`
        const groups = new Map<string, string>();
        for (const m of text.matchAll(/^attributes (#\d+) = \{ (.*) \}$/gm)) groups.set(m[1]!, m[2]!);
        for (const m of text.matchAll(/^declare void @(a_\w+)\(\)[^#\n]*(#\d+)?/gm)) out.push(`attrs ${m[1]} ${m[2] === undefined ? "" : groups.get(m[2])}`);
      }
      write_stdout(out.join("\n") + "\n");
      return "Stop" as const;
    },
  };
  try {
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
  } catch (e) {
    if (e instanceof Unported) {
      write_stderr(`UNPORTED: ${e.what}\n`);
      return 70;
    }
    throw e;
  }
}

const [mode, ...rest] = process.argv.slice(2);
process.exitCode = await main(mode!, rest);

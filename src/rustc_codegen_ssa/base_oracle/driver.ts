// Test driver for base.test.ts (lane ssa-base; test helper, not a port).
//   RUST_TS_SSA_OUT=<file> bun src/rustc_codegen_ssa/base_oracle/driver.ts <rustc arguments...>
//
// Runs the real driver up to `analysis` (as mir/analyze_oracle/driver.ts does), then runs the port's `codegen_crate`
// over a mock backend and writes one JSON object (`DriverResult`):
// - `write_calls`: the back/write.rs calls `codegen_crate` makes, in order (the `ssa_write` table's entries are replaced
//   by recorders; `start_async_codegen` returns a mock `OngoingCodegen`).
// - `allocator`: the module name and methods `codegen_allocator` got, if it was called.
// - `cgus`: the codegen units in the order `codegen_crate` passed them to `compile_codegen_unit`. For each, the `Fn` items
//   in `items_in_deterministic_order` (the order cg_llvm's `compile_codegen_unit` defines them, each through
//   `base::codegen_instance` and its `info!("codegen_instance({})")`), as `[Display of the Instance (what that info!
//   prints), Display of the MonoItem without trimmed paths (what -Zprint-mono-items prints)]`.
// - `entry`: for the CGU where `maybe_create_entry_wrapper` returned a function, the IR the mock builder emitted for it
//   (the `define` line, `top:` and the instructions), and `entry_calls`, the context/builder calls that leave no
//   instruction.
//
// The mock context/builder implement exactly what `maybe_create_entry_wrapper` calls. Values are `{ ty, text }`; types are
// LLVM type strings. `intcast` follows LLVM's `CreateIntCast` on a non-constant (trunc / sext / zext / no-op by width).
import { appendFileSync } from "node:fs";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";
import { write_stderr } from "../../std/io.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";

const EXIT_UNPORTED = 70;
const OUT = process.env.RUST_TS_SSA_OUT;

export interface DriverResult {
  kind: "RESULT";
  write_calls: string[];
  allocator: { name: string; methods: string[] } | undefined;
  cgus: { name: string; items: [string, string][] }[];
  entry: string[] | undefined;
  entry_cgu: string | undefined;
  entry_calls: string[];
}

function line(o: unknown): void {
  if (OUT !== undefined) appendFileSync(OUT, `${JSON.stringify(o)}\n`);
  else write_stderr(`${JSON.stringify(o)}\n`);
}

type Any = any; // PORT: test mock; backend values are opaque records.

async function load() {
  return {
    base: await import("../base.ts"),
    lib: await import("../lib.ts"),
    symbol: await import("../../rustc_span/symbol.ts"),
    ty: await import("../../rustc_middle/ty/mod.ts"),
    instance: await import("../../rustc_middle/ty/instance.ts"),
    mono: await import("../../rustc_middle/mono.ts"),
    pretty: await import("../../rustc_middle/ty/print/pretty.ts"),
  };
}
type CodegenUnit = import("../../rustc_middle/mono.ts").CodegenUnit;

function run(m: Awaited<ReturnType<typeof load>>, tcx: TyCtxt): DriverResult {
  const { base } = m;
  const { ModuleCodegen } = m.lib;
  const { Symbol } = m.symbol;
  const { TypingEnv } = m.ty;
  const { display_Instance } = m.instance;
  const { display_MonoItem } = m.mono;
  const { with_no_trimmed_paths } = m.pretty;

  const res: DriverResult = { kind: "RESULT", write_calls: [], allocator: undefined, cgus: [], entry: undefined, entry_cgu: undefined, entry_calls: [] };
  const w = res.write_calls;

  // ---- the back/write.rs stubs, as recorders ----
  const ongoing = { coordinator: { __Coordinator: "mock" } } as Any;
  base.ssa_write.ModuleConfig_new = (kind, _tcx, no_builtins) => {
    w.push(`ModuleConfig::new(${kind}, no_builtins=${no_builtins})`);
    return { kind } as Any;
  };
  base.ssa_write.ModuleConfig_bitcode_needed = (c) => {
    w.push(`bitcode_needed(${(c as Any).kind})`);
    return false;
  };
  base.ssa_write.start_async_codegen = (_b, _tcx, r, a, m) => {
    w.push(`start_async_codegen(${(r as Any).kind}, ${(a as Any).kind}, ${m === undefined ? "None" : `Some(${m.name}, ${m.kind})`})`);
    return ongoing;
  };
  base.ssa_write.OngoingCodegen_wait_for_signal_to_codegen_item = () => void w.push("wait_for_signal_to_codegen_item");
  base.ssa_write.OngoingCodegen_check_for_errors = () => void w.push("check_for_errors");
  base.ssa_write.OngoingCodegen_codegen_finished = () => void w.push("codegen_finished");
  base.ssa_write.submit_codegened_module_to_llvm = (_c, m, cost) => void w.push(`submit_codegened_module_to_llvm(${m.name}, ${m.kind}, cost=${cost})`);

  // ---- the mock context and builder for maybe_create_entry_wrapper ----
  interface V {
    ty: string;
    text: string;
  }
  const typed = (v: V): string => `${v.ty} ${v.text}`;
  const width = (ty: string): number => Number(ty.slice(1));
  const make_cx = (cgu_name: string): Any => {
    const ir: string[] = [];
    let next = 0;
    let params: string[] = [];
    let define: string | undefined;
    const instr = (ty: string, text: string): V => {
      const v = { ty, text: `%${next++}` };
      ir.push(`  ${v.text} = ${text}`);
      return v;
    };
    const cx: Any = {
      ir,
      define: () => define,
      tcx_: () => tcx,
      typing_env_: () => TypingEnv.fully_monomorphized(),
      sess: () => tcx.sess,
      type_ptr: () => "ptr",
      type_i8: () => "i8",
      type_int: () => `i${tcx.sess.target.c_int_width}`,
      type_isize: () => `i${tcx.data_layout().pointer_size().bits()}`,
      type_func: (args: string[], ret: string) => ({ args, ret }),
      val_ty: (v: V) => v.ty,
      get_fn_addr: (instance: Any, _pauth: Any): V => ({ ty: "ptr", text: `@${tcx.symbol_name(instance).name}` }),
      declare_c_main: (sig: { args: string[]; ret: string }) => {
        params = sig.args;
        next = sig.args.length;
        define = `define ${sig.ret} @main(${sig.args.map((t, i) => `${t} %${i}`).join(", ")}) {`;
        res.entry_calls.push(`declare_c_main(${sig.ret} (${sig.args.join(", ")}))`);
        return { name: "main", sig };
      },
      set_frame_pointer_type: () => void res.entry_calls.push("set_frame_pointer_type(main)"),
      apply_target_cpu_attr: () => void res.entry_calls.push("apply_target_cpu_attr(main)"),
    };
    const bx: Any = {
      cx: () => cx,
      tcx_: () => tcx,
      insert_reference_to_gdb_debug_scripts_section_global: () => void res.entry_calls.push("insert_reference_to_gdb_debug_scripts_section_global"),
      get_param: (i: number): V => ({ ty: params[i]!, text: `%${i}` }),
      const_u8: (n: number): V => ({ ty: "i8", text: String(n) }),
      intcast: (v: V, ty: string, signed: boolean): V => {
        const [from, to] = [width(v.ty), width(ty)];
        if (from === to) return v;
        return instr(ty, from > to ? `trunc ${typed(v)} to ${ty}` : `${signed ? "sext" : "zext"} ${typed(v)} to ${ty}`);
      },
      call: (sig: { args: string[]; ret: string }, _attrs: Any, _abi: Any, f: V, slot: Any, args: V[], funclet: Any, instance: Any): V => {
        res.entry_calls.push(`call(slot=${slot.$}, funclet=${funclet === undefined ? "None" : "Some"}, instance=${instance === undefined ? "None" : display_Instance(instance)})`);
        return instr(sig.ret, `call ${sig.ret} ${f.text}(${args.map(typed).join(", ")})`);
      },
      ret: (v: V) => void ir.push(`  ret ${typed(v)}`),
    };
    const Bx_: Any = {
      append_block: (_cx: Any, llfn: Any, name: string) => {
        res.entry_calls.push(`append_block(${llfn.name}, ${name})`);
        ir.push(`${name}:`);
        return name;
      },
      build: (_cx: Any, llbb: string) => {
        res.entry_calls.push(`build(${llbb})`);
        return bx;
      },
    };
    cx.Bx_ = Bx_;
    cx.cgu_name = cgu_name;
    return cx;
  };

  // ---- the mock backend ----
  const backend: Any = {
    codegen_allocator(_tcx: TyCtxt, module_name: string, methods: readonly Any[]): string {
      res.allocator = { name: module_name, methods: methods.map((m) => Symbol.as_str(m.name)) };
      return `allocator-module`;
    },
    compile_codegen_unit(tcx: TyCtxt, cgu_name: Any, _bitcode_needed: boolean): [Any, number] {
      const name = Symbol.as_str(cgu_name);
      const cgu = tcx.codegen_unit(cgu_name) as CodegenUnit;
      const items: [string, string][] = [];
      for (const [item] of cgu.items_in_deterministic_order(tcx)) {
        if (item.$ === "Fn") items.push([display_Instance(item._0), with_no_trimmed_paths(() => display_MonoItem(item))]);
      }
      res.cgus.push({ name, items });
      const cx = make_cx(name);
      const entry = base.maybe_create_entry_wrapper(cx.Bx_, cx, cgu);
      if (entry !== undefined) {
        res.entry = [cx.define(), ...cx.ir];
        res.entry_cgu = name;
      }
      return [ModuleCodegen.new_regular(name, `module:${name}`), items.length];
    },
  };

  base.codegen_crate(backend, tcx);
  return res;
}

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");

  const mods = await load();
  const callbacks = {
    config(_config: Config): void {},
    after_analysis(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      line(run(mods, tcx));
      line({ kind: "DONE" });
      return "Stop";
    },
  };
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof Unported) {
    write_stderr(`rust-ts: unported: ${e.what}\n${e.stack ?? ""}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else if (e instanceof FatalErrorMarker) {
    process.exitCode = 101;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    write_stderr(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}

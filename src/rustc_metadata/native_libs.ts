// Port of compiler/rustc_metadata/src/native_libs.rs.
//
// PORT:
// - `struct Collector<'tcx>` with its `impl` is a class (PORTING section 5).
// - `find_attr!(self.tcx, def_id, Pat => e)` is `find_attr(HasAttrs_<Id>.get_attrs(id, tcx), ..)` (rustc_attr_ir/lib.ts).
// - `sess.opts.libs` holds `rustc_session::utils::NativeLib`; `-l` parsing (`parse_native_lib`) is unported, so
//   the list is always empty when this runs.
import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { Size } from "../rustc_abi/lib.ts";
import { type LinkEntry, type PeImportNameType, find_attr } from "../rustc_attr_ir/lib.ts";
import { EvalConfigResult, eval_config_entry } from "../rustc_attr_parsing/attributes/cfg.ts";
import { type DllCallingConvention, DllImport, type DllImportSymbolType, type ForeignModule, NativeLib } from "../rustc_crate_store/lib.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { CodegenFnAttrFlags, type CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { LocalCrate } from "../rustc_middle/query/keys.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_List_Ty } from "../rustc_middle/ty/generic_args.ts";
import { HasAttrs_DefId, HasAttrs_LocalDefId, type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import type { Session } from "../rustc_session/session.ts";
import { type DefId, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { NativeLibKind, NativeLibKind_eq } from "../rustc_structures/native_lib_kind.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { assert } from "../std/panic.ts";
import { expect_result } from "../std/result.ts";
import * as diagnostics from "./diagnostics.ts";
import { debug_LayoutError } from "../rustc_middle/ty/layout.ts";

// rustc: compiler/rustc_metadata/src/native_libs.rs:20 collect
export function collect(tcx: TyCtxt, _LocalCrate: LocalCrate): NativeLib[] {
  const collector = new Collector(tcx, []);
  if (tcx.sess.opts.unstable_opts.link_directives) {
    for (const module of (tcx.foreign_modules(LOCAL_CRATE) as Map<DefId, ForeignModule>).values()) {
      collector.process_module(module);
    }
  }
  collector.process_command_line();
  for (const lib of collector.libs) {
    // FIXME(jchlanda) Pauthtest does not support static linking. It must be dynamically linked,
    // with a dynamic linker acting as the ELF interpreter that can resolve pauth relocations
    // and enforce pointer authentication constraints.
    if (tcx.sess.target.cfg_abi.$ === "Pauthtest") {
      if (lib.kind.$ === "Static") {
        if (!tcx.sess.opts.unstable_opts.ui_testing) {
          let diag: diagnostics.StaticLinkingNotSupported;
          if (lib.foreign_module === undefined) {
            diag = {
              $: "UserRequested",
              lib_name: lib.name,
              target: tcx.sess.target.llvm_target,
            };
          } else {
            diag = {
              $: "FromDependency",
              lib_name: lib.name,
              target: tcx.sess.target.llvm_target,
            };
          }
          tcx.dcx().emit_warn(diagnostics.StaticLinkingNotSupported_diagnostic(diag));
        }

        lib.kind = { $: "Dylib", as_needed: undefined };
      }
    }
  }
  return collector.libs;
}

// rustc: compiler/rustc_metadata/src/native_libs.rs:56 relevant_lib
export function relevant_lib(sess: Session, lib: NativeLib): boolean {
  const cfg = lib.cfg as Parameters<typeof eval_config_entry>[1] | undefined;
  if (cfg !== undefined) {
    return EvalConfigResult.as_bool(eval_config_entry(sess, cfg));
  } else {
    return true;
  }
}

/** `HashSet::insert`: whether the value was newly inserted. */
function set_insert<T>(set: Set<T>, value: T): boolean {
  if (set.has(value)) return false;
  set.add(value);
  return true;
}

class Collector {
  constructor(
    public tcx: TyCtxt,
    public libs: NativeLib[],
  ) {}

  // rustc: compiler/rustc_metadata/src/native_libs.rs:69 process_module
  process_module(module: ForeignModule): void {
    const { def_id: def_id_, abi, foreign_items } = module;
    const def_id = def_id_.expect_local();

    const sess = this.tcx.sess;

    if (abi.$ === "Rust") {
      return;
    }

    const links = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, this.tcx), (k): readonly LinkEntry[] | undefined => (k.$ === "Link" ? k._0 : undefined));
    for (const attr of links ?? []) {
      let dll_imports: DllImport[];
      if (attr.kind.$ === "RawDylib") {
        dll_imports = [];
        for (const child_item of foreign_items) {
          const imp = this.build_dll_import(abi, attr.import_name_type === undefined ? undefined : attr.import_name_type[0], child_item);
          if (imp !== undefined) dll_imports.push(imp);
        }
      } else {
        for (const child_item of foreign_items) {
          const span = find_attr(HasAttrs_DefId.get_attrs(child_item, this.tcx), (k) => (k.$ === "LinkOrdinal" ? k.span : undefined));
          if (span !== undefined) {
            sess.dcx().emit_err(diagnostics.LinkOrdinalRawDylib_diagnostic({ span }));
          }
        }

        dll_imports = [];
      }

      this.libs.push(new NativeLib(attr.kind, attr.name, attr.cfg, LocalDefId.to_def_id(def_id), attr.verbatim, dll_imports));
    }
  }

  // Process libs passed on the command line
  // rustc: compiler/rustc_metadata/src/native_libs.rs:116 process_command_line
  process_command_line(): void {
    // First, check for errors
    const renames = new Set<string>();
    for (const lib of this.tcx.sess.opts.libs) {
      if (lib.kind.$ === "Framework" && !this.tcx.sess.target.is_like_darwin) {
        // Cannot check this when parsing options because the target is not yet available.
        this.tcx.dcx().emit_err(diagnostics.LibFrameworkApple_diagnostic({}));
      }
      const new_name = lib.new_name;
      if (new_name !== undefined) {
        const any_duplicate = this.libs.some((n) => Symbol.as_str(n.name) === lib.name);
        if (new_name.length === 0) {
          this.tcx.dcx().emit_err(diagnostics.EmptyRenamingTarget_diagnostic({ lib_name: lib.name }));
        } else if (!any_duplicate) {
          this.tcx.dcx().emit_err(diagnostics.RenamingNoLink_diagnostic({ lib_name: lib.name }));
        } else if (!set_insert(renames, lib.name)) {
          this.tcx.dcx().emit_err(diagnostics.MultipleRenamings_diagnostic({ lib_name: lib.name }));
        }
      }
    }

    // Update kind and, optionally, the name of all native libraries
    // (there may be more than one) with the specified name. If any
    // library is mentioned more than once, keep the latest mention
    // of it, so that any possible dependent libraries appear before
    // it. (This ensures that the linker is able to see symbols from
    // all possible dependent libraries before linking in the library
    // in question.)
    for (const passed_lib of this.tcx.sess.opts.libs) {
      // If we've already added any native libraries with the same
      // name, they will be pulled out into `existing`, so that we
      // can move them to the end of the list below.
      // PORT: `Vec::extract_if(.., pred)`: visits the elements in order, removes those the predicate (which may
      // mutate them) accepts and yields them in order.
      const existing: NativeLib[] = [];
      const kept: NativeLib[] = [];
      for (const lib of this.libs) {
        const extract = ((): boolean => {
          if (Symbol.as_str(lib.name) === passed_lib.name) {
            // FIXME: This whole logic is questionable, whether modifiers are
            // involved or not, library reordering and kind overriding without
            // explicit `:rename` in particular.
            if (lib.has_modifiers() || passed_lib.has_modifiers()) {
              const def_id = lib.foreign_module;
              if (def_id !== undefined) {
                this.tcx.dcx().emit_err(
                  diagnostics.NoLinkModOverride_diagnostic({
                    span: this.tcx.def_span(def_id),
                  }),
                );
              } else {
                this.tcx.dcx().emit_err(diagnostics.NoLinkModOverride_diagnostic({ span: undefined }));
              }
            }
            if (!NativeLibKind_eq(passed_lib.kind, NativeLibKind.Unspecified)) {
              lib.kind = passed_lib.kind;
            }
            const new_name = passed_lib.new_name;
            if (new_name !== undefined) {
              lib.name = Symbol.intern(new_name);
            }
            lib.verbatim = passed_lib.verbatim;
            return true;
          }
          return false;
        })();
        (extract ? existing : kept).push(lib);
      }
      this.libs = kept;
      if (existing.length === 0) {
        // Add if not found
        const new_name: string | undefined = passed_lib.new_name;
        const name = Symbol.intern(new_name ?? passed_lib.name);
        this.libs.push(new NativeLib(passed_lib.kind, name, undefined, undefined, passed_lib.verbatim, []));
      } else {
        // Move all existing libraries with the same name to the
        // end of the command line.
        this.libs.push(...existing);
      }
    }
  }

  // rustc: compiler/rustc_metadata/src/native_libs.rs:203 i686_arg_list_size
  i686_arg_list_size(item: DefId): number {
    const argument_types: List<Ty> = this.tcx.instantiate_bound_regions_with_erased(
      Binder.map_bound(PolyFnSig.inputs(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(item))).fn_sig(this.tcx)), (slice) => this.tcx.mk_type_list(slice)),
      fold_List_Ty,
    );

    let sum = 0;
    for (const ty of argument_types) {
      const layout = expect_result(this.tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty)), "layout", debug_LayoutError).layout;
      // In both stdcall and fastcall, we always round up the argument size to the
      // nearest multiple of 4 bytes.
      sum += (layout.size().bytes_usize() + 3) & ~3;
    }
    return sum;
  }

  // rustc: compiler/rustc_metadata/src/native_libs.rs:229 build_dll_import
  build_dll_import(abi: ExternAbi, import_name_type: PeImportNameType | undefined, item: DefId): DllImport | undefined {
    const span = this.tcx.def_span(item);

    // This `extern` block should have been checked for general ABI support before, but let's
    // double-check that.
    assert(this.tcx.sess.target.is_abi_supported(abi), "assertion failed: self.tcx.sess.target.is_abi_supported(abi)");

    // This logic is similar to `AbiMap::canonize_abi` (in rustc_target/src/spec/abi_map.rs) but
    // we need more detail than those adjustments, and we can't support all ABIs that are
    // generally supported.
    let calling_convention: DllCallingConvention;
    if (this.tcx.sess.target.arch.$ === "X86") {
      switch (abi.$) {
        case "C":
        case "Cdecl":
          calling_convention = { $: "C" };
          break;
        case "Stdcall":
          calling_convention = { $: "Stdcall", _0: this.i686_arg_list_size(item) };
          break;
        // On Windows, `extern "system"` behaves like msvc's `__stdcall`.
        // `__stdcall` only applies on x86 and on non-variadic functions:
        // https://learn.microsoft.com/en-us/cpp/cpp/stdcall?view=msvc-170
        case "System": {
          const c_variadic = PolyFnSig.c_variadic(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(item))).fn_sig(this.tcx));

          if (c_variadic) {
            calling_convention = { $: "C" };
          } else {
            calling_convention = { $: "Stdcall", _0: this.i686_arg_list_size(item) };
          }
          break;
        }
        case "Fastcall":
          calling_convention = { $: "Fastcall", _0: this.i686_arg_list_size(item) };
          break;
        case "Vectorcall":
          calling_convention = { $: "Vectorcall", _0: this.i686_arg_list_size(item) };
          break;
        default:
          this.tcx.dcx().emit_err(diagnostics.RawDylibUnsupportedAbi_diagnostic({ span }));
          return undefined;
      }
    } else {
      switch (abi.$) {
        case "C":
        case "Win64":
        case "System":
          calling_convention = { $: "C" };
          break;
        default:
          this.tcx.dcx().emit_err(diagnostics.RawDylibUnsupportedAbi_diagnostic({ span }));
          return undefined;
      }
    }

    const codegen_fn_attrs = this.tcx.codegen_fn_attrs(item) as CodegenFnAttrs;
    const ord = codegen_fn_attrs.link_ordinal;
    const import_name_type_: PeImportNameType | undefined = ord === undefined ? import_name_type : { $: "Ordinal", _0: ord };

    const name = codegen_fn_attrs.symbol_name ?? this.tcx.item_name(item);

    if (this.tcx.sess.target.binary_format === "Elf") {
      const name_ = Symbol.as_str(name);
      const at = name_.indexOf("@");
      if (name_.includes("\0")) {
        this.tcx.dcx().emit_err(diagnostics.RawDylibMalformed_diagnostic({ span }));
      } else if (at !== -1) {
        const left = name_.slice(0, at);
        const right = name_.slice(at + 1);
        if (left.length === 0 || right.length === 0 || right.includes("@")) {
          this.tcx.dcx().emit_err(diagnostics.RawDylibMalformed_diagnostic({ span }));
        }
      }
    }

    const def_kind = this.tcx.def_kind(item);
    let symbol_type: DllImportSymbolType;
    if (DefKind.is_fn_like(def_kind)) {
      symbol_type = "Function";
    } else if (def_kind.$ === "Static") {
      if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.THREAD_LOCAL)) {
        symbol_type = "ThreadLocal";
      } else {
        symbol_type = "Static";
      }
    } else if (def_kind.$ === "ForeignTy") {
      return undefined;
    } else {
      return bug(`Unexpected type for raw-dylib: ${DefKind.descr(def_kind, item)}`);
    }

    let size: Size;
    switch (symbol_type) {
      // We cannot determine the size of a function at compile time, but it shouldn't matter anyway.
      case "Function":
        size = Size.ZERO;
        break;
      case "Static":
      case "ThreadLocal": {
        const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(item)));
        const r = this.tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
        size = r.$ === "Ok" ? r._0.size : bug("Non-function symbols must have a size");
        break;
      }
    }

    return new DllImport(name, import_name_type_, calling_convention, span, symbol_type, size);
  }
}

// Port of compiler/rustc_codegen_llvm/src/consts.rs (skeleton: lane cg-contract; bodies: lane cg-abi-consts, plan-m7 §8 wave 41).
//
// `impl CodegenCx` and `impl StaticCodegenMethods for CodegenCx` are attached with PORTING §5's extension pattern (lib.ts
// imports this file after the class's own module). common.ts imports this file eagerly (for `const_alloc_to_llvm`), and
// builder.ts imports common.ts: so `crate::base` and `crate::debuginfo`, whose imports reach builder.ts, are read lazily
// (`base()` / `debuginfo()` at the end of this file, context.ts's pattern); common.ts itself is used only inside function
// bodies.
//
// PORT (cg-abi-consts):
// - `self.llmod` (an `SCx` field reached through the derefs) is the accessor `llmod()` (type_.rs:156); `self.statics_to_rauw`
//   (a `FullCx` field whose name is also a method of `CodegenCx`) is `this._0.statics_to_rauw` (context.ts header); the other
//   `FullCx` fields are the forwarded accessors (`this.instances`, `this.const_globals`, ...). `self.typing_env()` is
//   `HasTypingEnv::typing_env_()` (context.ts header). `self.tcx.data_layout` (a field upstream) is `tcx.data_layout()`.
// - Inherent before trait (review cg-contract F1): `cx.const_struct(..)` / `self.const_null(..)` on a `CodegenCx` resolve to
//   `GenericCx`'s inherent fns, so they are `const_struct_inherent` / `const_null_inherent`.
// - `c"..."` literals are strings (ffi.ts types `*const c_char` as `string`); `llvm::TRUE` is `llvm.TRUE`.
// - `tracing::{debug!, trace!}` and `#[instrument]` are comments.
// - `crate::debuginfo::build_global_var_di_node` is debuginfo/mod.rs's re-export of `metadata::build_global_var_di_node`; the
//   TS debuginfo/mod.ts (cg-di's) has no re-export yet, so it is called from debuginfo/metadata.ts.
// - `rustc_sanitizers` is out of scope (harness/scope.json): the items `codegen_static_item` names under a sanitizer ignorelist
//   are local typed stubs (`sanitizers_stub`). A `SanitizerIgnoreList` is never constructed (context.ts), so that branch is
//   unreachable today.
// - Integer widths: allocation offsets and lengths are `number` (`usize`, < 2^53); the relocation's pointer offset
//   (`read_target_uint(..) as u64`) is a `bigint`.
import { type Align, Align_max, type Scalar, Size, WrappingRange } from "../rustc_abi/lib.ts";
import type { Linkage } from "../rustc_attr_ir/data_structures.gen.ts";
import { i686_decorated_name, is_using_dlltool } from "../rustc_codegen_ssa/common.ts";
import type { StaticCodegenMethods } from "../rustc_codegen_ssa/traits/statics.ts";
import { CodegenFnAttrFlags, type CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import {
  type Allocation,
  AllocRange_from_Range_usize,
  type ConstAllocation,
  clone_InitChunkIter,
  InitChunk,
} from "../rustc_middle/mir/interpret/allocation.ts";
import type { ErrorHandled } from "../rustc_middle/mir/interpret/error.ts";
import { GlobalAlloc, read_target_uint } from "../rustc_middle/mir/interpret/mod.ts";
import { CtfeProvenance, Pointer } from "../rustc_middle/mir/interpret/pointer.ts";
import { Scalar as InterpScalar } from "../rustc_middle/mir/interpret/value.ts";
import type { MonoItem } from "../rustc_middle/mono.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { display_Ty, with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { LinkerPluginLto } from "../rustc_session/config.ts";
import { PointerAuthARM8_3Key_discriminant } from "../rustc_session/session.ts";
import { type DefId, debug_DefId, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { FileName } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { NativeLibKind } from "../rustc_structures/native_lib_kind.ts";
import { SanitizerSet } from "../rustc_target/spec/mod.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PolyFnSig, PolyFnSigTys } from "../rustc_type_ir/ty_kind.ts";
import { debug_IoError } from "../std/io.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, panic, unported, unwrap } from "../std/panic.ts";
import { Err, expect_result, Ok, type Result } from "../std/result.ts";
import { from_utf8 } from "../std/str.ts";
import * as common from "./common.ts";
import { CodegenCx } from "./context.ts";
import { SymbolAlreadyDefined_diagnostic } from "./diagnostics.gen.ts";
import * as llvm from "./llvm/mod.ts";
import { debug_FromUtf8Error, type Type, type Value } from "./llvm/mod.ts";


/// Indicates whether a value originates from a `static`.
export type IsStatic = "Yes" | "No";
export const IsStatic = { Yes: "Yes", No: "No" } as const;
/// Indicates whether a symbol is part of `.init_array` or `.fini_array`.
// #[derive(PartialEq)]
export type IsInitOrFini = "Yes" | "No";
export const IsInitOrFini = { Yes: "Yes", No: "No" } as const;

// rustc: compiler/rustc_codegen_llvm/src/consts.rs:39 const_alloc_to_llvm
export function const_alloc_to_llvm(cx: CodegenCx, alloc: Allocation, is_static: IsStatic, is_init_fini: IsInitOrFini): Value {
  // We expect that callers of const_alloc_to_llvm will instead directly codegen a pointer or
  // integer for any &ZST where the ZST is a constant (i.e. not a static). We should never be
  // producing empty LLVM allocations as they're just adding noise to binaries and forcing less
  // optimal codegen.
  //
  // Statics have a guaranteed meaningful address so it's less clear that we want to do
  // something like this; it's also harder.
  if (is_static === "No") {
    assert(alloc.len() !== 0, "assertion failed: alloc.len() != 0");
  }
  const llvals: Value[] = [];
  const dl = cx.data_layout();
  const pointer_size = dl.pointer_size();
  const pointer_size_bytes = pointer_size.bytes();

  // Note: this function may call `inspect_with_uninit_and_ptr_outside_interpreter`, so `range`
  // must be within the bounds of `alloc` and not contain or overlap a pointer provenance.
  // rustc: compiler/rustc_codegen_llvm/src/consts.rs:62 append_chunks_of_init_and_uninit_bytes
  function append_chunks_of_init_and_uninit_bytes(llvals: Value[], cx: CodegenCx, alloc: Allocation, range: { start: number; end: number }): void {
    const chunks = alloc.init_mask_().range_as_init_chunks(AllocRange_from_Range_usize({ start: range.start, end: range.end }));

    const chunk_to_llval = (chunk: InitChunk): Value => {
      if (chunk.$ === "Init") {
        const range = chunk._0;
        const range_ = { start: range.start.bytes(), end: range.end.bytes() };
        const bytes = alloc.inspect_with_uninit_and_ptr_outside_interpreter(range_);
        return cx.const_bytes(bytes);
      } else {
        const range = chunk._0;
        const len = range.end.bytes_u64() - range.start.bytes_u64();
        return cx.const_undef(cx.type_array(cx.type_i8(), len));
      }
    };

    // Generating partially-uninit consts is limited to small numbers of chunks,
    // to avoid the cost of generating large complex const expressions.
    // For example, `[(u32, u8); 1024 * 1024]` contains uninit padding in each element, and
    // would result in `{ [5 x i8] zeroinitializer, [3 x i8] undef, ...repeat 1M times... }`.
    const max = cx.sess().opts.unstable_opts.uninit_const_chunk_threshold;
    // `chunks.clone().take(max.saturating_add(1)).count() <= max` (a `usize` option: `max + 1` cannot overflow a JS number).
    let count = 0;
    const take = max + 1;
    for (const counted = clone_InitChunkIter(chunks); count < take && !counted.next().done; ) count++;
    const allow_uninit_chunks = count <= max;

    if (allow_uninit_chunks) {
      for (const chunk of chunks) llvals.push(chunk_to_llval(chunk));
    } else {
      // If this allocation contains any uninit bytes, codegen as if it was initialized
      // (using some arbitrary value for uninit bytes).
      const bytes = alloc.inspect_with_uninit_and_ptr_outside_interpreter(range);
      llvals.push(cx.const_bytes(bytes));
    }
  }

  let next_offset = 0;
  for (const [offset_, prov] of alloc.provenance_().ptrs_().iter()) {
    // assert_eq!(offset as usize as u64, offset): an allocation offset is below 2^53 here.
    const offset = offset_.bytes();
    if (offset > next_offset) {
      // This `inspect` is okay since we have checked that there is no provenance, it
      // is within the bounds of the allocation, and it doesn't affect interpreter execution
      // (we inspect the result after interpreter execution).
      append_chunks_of_init_and_uninit_bytes(llvals, cx, alloc, { start: next_offset, end: offset });
    }
    const ptr_offset = BigInt.asUintN(
      64,
      expect_result(
        read_target_uint(
          dl.endian,
          // This `inspect` is okay since it is within the bounds of the allocation, it doesn't
          // affect interpreter execution (we inspect the result after interpreter execution),
          // and we properly interpret the provenance as a relocation pointer offset.
          alloc.inspect_with_uninit_and_ptr_outside_interpreter({ start: offset, end: offset + pointer_size_bytes }),
        ),
        "const_alloc_to_llvm: could not read relocation pointer",
        debug_IoError,
      ),
    );

    const address_space = GlobalAlloc.address_space(cx.tcx.global_alloc(CtfeProvenance.alloc_id(prov)), cx);
    let schema;
    if (cx.sess().pointer_authentication()) {
      switch (is_init_fini) {
        case "Yes":
          schema = cx.sess().pointer_authentication_init_fini();
          break;
        case "No":
          schema = cx.sess().pointer_authentication_functions();
          break;
      }
    } else {
      schema = undefined;
    }
    const layout: Scalar = {
      $: "Initialized",
      value: { $: "Pointer", _0: address_space },
      valid_range: WrappingRange.full(pointer_size),
    };
    llvals.push(cx.scalar_to_backend_with_pac(InterpScalar.from_pointer(Pointer.new(prov, Size.from_bytes(ptr_offset)), cx.tcx), layout, cx.type_ptr_ext(address_space), schema));
    next_offset = offset + pointer_size_bytes;
  }
  if (alloc.len() >= next_offset) {
    const range = { start: next_offset, end: alloc.len() };
    // This `inspect` is okay since we have check that it is after all provenance, it is
    // within the bounds of the allocation, and it doesn't affect interpreter execution (we
    // inspect the result after interpreter execution).
    append_chunks_of_init_and_uninit_bytes(llvals, cx, alloc, range);
  }

  // Avoid wrapping in a struct if there is only a single value. This ensures
  // that LLVM is able to perform the string merging optimization if the constant
  // is a valid C string. LLVM only considers bare arrays for this optimization,
  // not arrays wrapped in a struct. LLVM handles this at:
  // https://github.com/rust-lang/llvm-project/blob/acaea3d2bb8f351b740db7ebce7d7a40b9e21488/llvm/lib/Target/TargetLoweringObjectFile.cpp#L249-L280
  if (llvals.length === 1) {
    return llvals[0]!;
  } else {
    return cx.const_struct_inherent(llvals, true);
  }
}

// rustc: compiler/rustc_codegen_llvm/src/consts.rs:158 codegen_static_initializer
function codegen_static_initializer(cx: CodegenCx, def_id: DefId): Result<[Value, ConstAllocation], ErrorHandled> {
  const r = cx.tcx.eval_static_initializer(def_id);
  if (r.$ === "Err") return r;
  const alloc = r._0;
  const attrs = cx.tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
  // FIXME(jchlanda) Decide if this could be better served by `ctor` crate. See the discussion
  // here: <https://github.com/rust-lang/rust/pull/155722#discussion_r3320477047>
  let is_in_init_fini: IsInitOrFini;
  if (attrs.link_section !== undefined) {
    const s = Symbol.as_str(attrs.link_section);
    if (s.startsWith(".init_array") || s.startsWith(".fini_array")) {
      is_in_init_fini = IsInitOrFini.Yes;
    } else {
      is_in_init_fini = IsInitOrFini.No;
    }
  } else {
    is_in_init_fini = IsInitOrFini.No;
  }
  return Ok([const_alloc_to_llvm(cx, alloc.inner(), IsStatic.Yes, is_in_init_fini), alloc]);
}

// rustc: compiler/rustc_codegen_llvm/src/consts.rs:180 set_global_alignment
function set_global_alignment(cx: CodegenCx, gv: Value, align: Align): void {
  // The target may require greater alignment for globals than the type does.
  // Note: GCC and Clang also allow `__attribute__((aligned))` on variables,
  // which can force it to be smaller. Rust doesn't support this yet.
  const min_global = cx.sess().target.min_global_align;
  if (min_global !== undefined) {
    align = Align_max(align, min_global);
  }
  llvm.set_alignment(gv, align);
}

// rustc: compiler/rustc_codegen_llvm/src/consts.rs:190 check_and_apply_linkage
function check_and_apply_linkage(cx: CodegenCx, attrs: CodegenFnAttrs, llty: Type, sym: string, def_id: DefId): Value {
  const linkage: Linkage | undefined = attrs.import_linkage;
  if (linkage !== undefined) {
    // debug!("get_static: sym={} linkage={:?}", sym, linkage);

    let should_sign = false;
    // Declare a symbol `foo`. If `foo` is an extern_weak symbol, we declare
    // an extern_weak function, otherwise a global with the desired linkage.
    let g1: Value;
    if (attrs.import_linkage === "ExternalWeak") {
      // An `extern_weak` function is represented as an `Option<unsafe extern ...>`,
      // we extract the function signature and declare it as an extern_weak function
      // instead of an extern_weak i8.
      const instance = Instance.mono(cx.tcx, def_id);
      const kind = Instance.ty(instance, cx.tcx, cx.typing_env_()).kind();
      let sig_header: ReturnType<typeof fn_ptr_parts> = undefined;
      if (kind.$ === "Adt" && cx.tcx.is_lang_item(kind._0.did(), "Option")) {
        sig_header = fn_ptr_parts(kind._1.type_at(0));
      }
      if (sig_header !== undefined) {
        const [sig, header] = sig_header;
        const fn_sig = PolyFnSigTys.with(sig, header);
        const fn_abi = cx.fn_abi_of_fn_ptr(fn_sig, RawList.empty<Ty>());
        // Decide if the initializer needs to be signed
        const abi = PolyFnSig.abi(fn_sig);
        if (cx.sess().pointer_authentication_functions() !== undefined && (abi.$ === "C" || abi.$ === "System")) {
          should_sign = true;
        }
        g1 = cx.declare_fn(sym, fn_abi, undefined);
      } else {
        g1 = cx.declare_global(sym, cx.type_i8());
      }
    } else {
      g1 = cx.declare_global(sym, cx.type_i8());
    }
    llvm.set_linkage(g1, base().linkage_to_llvm(linkage));

    // Normally this is done in `get_static_inner`, but when as we generate an internal global,
    // it will apply the dso_local to the internal global instead, so do it here, too.
    cx.assume_dso_local(g1, true);

    // Declare an internal global `extern_with_linkage_foo` which
    // is initialized with the address of `foo`. If `foo` is
    // discarded during linking (for example, if `foo` has weak
    // linkage and there are no definitions), then
    // `extern_with_linkage_foo` will instead be initialized to
    // zero.
    // `{:016x}` of the `StableCrateId` (its `LowerHex` is the inner `Hash64`'s, a `u64`).
    const real_name = `_rust_extern_with_linkage_${cx.tcx.stable_crate_id(LOCAL_CRATE).toString(16).padStart(16, "0")}_${sym}`;
    const g2 =
      cx.define_global(real_name, llty) ??
      cx.sess().dcx().emit_fatal(SymbolAlreadyDefined_diagnostic({ span: cx.tcx.def_span(def_id), symbol_name: sym }));
    llvm.set_linkage(g2, "InternalLinkage");
    llvm.set_unnamed_address(g2, "Global");

    // Sign the function pointer that is used to initialize the global
    let initializer: Value;
    if (should_sign) {
      const schema = unwrap(cx.tcx.sess.pointer_authentication_functions(), "pointer authentication functions must be available when signing");

      initializer = llvm.const_ptr_auth(
        cx.const_bitcast(g1, llty),
        PointerAuthARM8_3Key_discriminant[schema.key],
        BigInt(schema.constant_discriminator),
        undefined /* address_diversity */,
      );
    } else {
      initializer = g1;
    }

    llvm.set_initializer(g2, initializer);

    return g2;
  } else {
    const dllimport = cx.tcx.sess.target.arch.$ === "X86" && is_using_dlltool(cx.tcx.sess.target) ? common.get_dllimport(cx.tcx, def_id, sym) : undefined;
    if (dllimport !== undefined) {
      return cx.declare_global(i686_decorated_name(dllimport, true, true, false), llty);
    } else {
      // Generate an external declaration.
      // FIXME(nagisa): investigate whether it can be changed into define_global
      return cx.declare_global(sym, llty);
    }
  }
}

/** `let ty::FnPtr(sig, header) = ty.kind()`: the two fields, or `undefined` for any other kind. */
function fn_ptr_parts(ty: Ty): readonly [Parameters<typeof PolyFnSigTys.with>[0], Parameters<typeof PolyFnSigTys.with>[1]] | undefined {
  const kind = ty.kind();
  return kind.$ === "FnPtr" ? [kind._0, kind._1] : undefined;
}

// ---- impl<'ll> CodegenCx<'ll, '_> (consts.rs:283) ----
declare module "./context.ts" {
  interface CodegenCx {
    const_bitcast(val: Value, ty: Type): Value;
    const_pointercast(val: Value, ty: Type): Value;
    static_addr_of_mut(cv: Value, align: Align, kind: string | undefined): Value;
    static_addr_of_impl(cv: Value, align: Align, kind: string | undefined): Value;
    get_static(def_id: DefId): Value;
    get_static_inner(def_id: DefId, llty: Type): Value;
    codegen_static_item(def_id: DefId): void;
    add_used_global(global: Value): void;
    add_compiler_used_global(global: Value): void;
    define_objc_classname(classname: string): Value;
    get_objc_class_t(): Type;
    get_objc_classref(classname: Symbol): Value;
    get_objc_selref(methname: Symbol): Value;
    define_objc_module_info(): void;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/consts.rs:284 const_bitcast
CodegenCx.prototype.const_bitcast = function (this: CodegenCx, val: Value, ty: Type): Value {
  return llvm.LLVMConstBitCast(val, ty);
};

// rustc: compiler/rustc_codegen_llvm/src/consts.rs:288 const_pointercast
CodegenCx.prototype.const_pointercast = function (this: CodegenCx, val: Value, ty: Type): Value {
  return llvm.LLVMConstPointerCast(val, ty);
};

/// Create a global variable.
///
/// The returned global variable is a pointer in the default address space for globals.
/// Fails if a symbol with the given name already exists.
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:296 static_addr_of_mut
CodegenCx.prototype.static_addr_of_mut = function (this: CodegenCx, cv: Value, align: Align, kind: string | undefined): Value {
  let gv: Value;
  if (kind !== undefined && !this.tcx.sess.fewer_names()) {
    const name = this.generate_local_symbol_name(kind);
    const gv_ = this.define_global(name, this.val_ty(cv)) ?? bug(`symbol \`${name}\` is already defined`);
    gv = gv_;
  } else {
    gv = this.define_global("", this.val_ty(cv)) ?? bug("anonymous global symbol is already defined");
  }
  llvm.set_linkage(gv, "PrivateLinkage");
  llvm.set_initializer(gv, cv);
  set_global_alignment(this, gv, align);
  llvm.set_unnamed_address(gv, "Global");
  return gv;
};

/// Create a global constant.
///
/// The returned global variable is a pointer in the default address space for globals.
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:324 static_addr_of_impl
CodegenCx.prototype.static_addr_of_impl = function (this: CodegenCx, cv: Value, align: Align, kind: string | undefined): Value {
  const cached = this.const_globals.get(cv);
  if (cached !== undefined) {
    const gv = cached;
    // Upgrade the alignment in cases where the same constant is used with different
    // alignment requirements
    const llalign = align.bytes() >>> 0;
    if (llalign > llvm.LLVMGetAlignment(gv)) {
      llvm.LLVMSetAlignment(gv, llalign);
    }
    return gv;
  }
  const gv = this.static_addr_of_mut(cv, align, kind);
  llvm.set_global_constant(gv, true);

  this.const_globals.set(cv, gv);
  return gv;
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:349 get_static
CodegenCx.prototype.get_static = function (this: CodegenCx, def_id: DefId): Value {
  const instance = Instance.mono(this.tcx, def_id);
  // trace!(?instance);

  const def_kind = this.tcx.def_kind(def_id);
  if (def_kind.$ !== "Static") {
    return bug();
  }
  const nested = def_kind.nested;
  // Nested statics do not have a type, so pick a dummy type and let `codegen_static` figure
  // out the llvm type from the actual evaluated initializer.
  let llty: Type;
  if (nested) {
    llty = this.type_i8();
  } else {
    const ty = Instance.ty(instance, this.tcx, this.typing_env_());
    // trace!(?ty);
    llty = this.layout_of(ty).llvm_type(this);
  }
  return this.get_static_inner(def_id, llty);
};

// #[instrument(level = "debug", skip(self, llty))]
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:367 get_static_inner
CodegenCx.prototype.get_static_inner = function (this: CodegenCx, def_id: DefId, llty: Type): Value {
  const instance = Instance.mono(this.tcx, def_id);
  const cached = this.instances.get(instance);
  if (cached !== undefined) {
    // trace!("used cached value");
    return cached;
  }

  const static_item: MonoItem = { $: "Static", _0: def_id };
  const defined_in_current_codegen_unit = this.codegen_unit.items().has(static_item);
  assert(
    !defined_in_current_codegen_unit,
    () => `consts::get_static() should always hit the cache for statics defined in the same CGU, but did not for \`${debug_DefId(def_id, PLAIN)}\``,
  );

  const sym = this.tcx.symbol_name(instance).name;
  const fn_attrs = this.tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;

  // debug!(?sym, ?fn_attrs);

  let g: Value;
  if (def_id.is_local() && !this.tcx.is_foreign_item(def_id)) {
    const declared = this.get_declared_value(sym);
    if (declared !== undefined) {
      const g_ = declared;
      if (this.val_ty(g_) !== this.type_ptr()) {
        span_bug(this.tcx.def_span(def_id), "Conflicting types for static");
      }
    }

    const g_ = this.declare_global(sym, llty);

    if (!this.tcx.is_reachable_non_generic(def_id)) {
      llvm.set_visibility(g_, "Hidden");
    }

    g = g_;
  } else if (fn_attrs.objc_class !== undefined) {
    const classname = fn_attrs.objc_class;
    g = this.get_objc_classref(classname);
  } else if (fn_attrs.objc_selector !== undefined) {
    const methname = fn_attrs.objc_selector;
    g = this.get_objc_selref(methname);
  } else {
    g = check_and_apply_linkage(this, fn_attrs, llty, sym, def_id);
  }

  // Thread-local statics in some other crate need to *always* be linked
  // against in a thread-local fashion, so we need to be sure to apply the
  // thread-local attribute locally if it was present remotely. If we
  // don't do this then linker errors can be generated where the linker
  // complains that one object files has a thread local version of the
  // symbol and another one doesn't.
  if (CodegenFnAttrFlags.contains(fn_attrs.flags, CodegenFnAttrFlags.THREAD_LOCAL)) {
    llvm.set_thread_local_mode(g, this.tls_model);
  }

  const dso_local = this.assume_dso_local(g, true);

  if (!def_id.is_local()) {
    const is_eii = CodegenFnAttrFlags.contains(fn_attrs.flags, CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM);
    const needs_dll_storage_attr =
      this.use_dll_storage_attrs &&
      // EII static declarations are encoded as foreign items, but their symbols are
      // resolved by Rust crates, not native libraries.
      (!this.tcx.is_foreign_item(def_id) || is_eii) &&
      // Local definitions can never be imported, so we must not apply
      // the DLLImport annotation.
      !dso_local &&
      // Linker plugin ThinLTO doesn't create the self-dllimport Rust uses for rlibs
      // as the code generation happens out of process. Instead we assume static linkage
      // and disallow dynamic linking when linker plugin based LTO is enabled.
      // Regular in-process ThinLTO doesn't need this workaround.
      !LinkerPluginLto.enabled(this.tcx.sess.opts.cg.linker_plugin_lto);

    // If this assertion triggers, there's something wrong with commandline
    // argument validation.
    assert(
      !(LinkerPluginLto.enabled(this.tcx.sess.opts.cg.linker_plugin_lto) && this.tcx.sess.target.is_like_windows && this.tcx.sess.opts.cg.prefer_dynamic),
      "assertion failed: !(self.tcx.sess.opts.cg.linker_plugin_lto.enabled() &&\n            self.tcx.sess.target.is_like_windows &&\n            self.tcx.sess.opts.cg.prefer_dynamic)",
    );

    if (needs_dll_storage_attr) {
      // This item is external but not foreign, i.e., it originates from an external Rust
      // crate. EII static declarations are handled the same way, even though they are
      // represented as foreign items. Since we don't know whether this crate will be
      // linked dynamically or statically in the final application, we always mark such
      // symbols as 'dllimport'. If final linkage happens to be static, we rely on
      // compiler-emitted __imp_ stubs to make things work.
      //
      // However, in some scenarios we defer emission of statics to downstream
      // crates, so there are cases where a static with an upstream DefId
      // is actually present in the current crate. We can find out via the
      // is_codegened_item query.
      if (!this.tcx.is_codegened_item(def_id)) {
        llvm.set_dllimport_storage_class(g);
      }
    }
  }

  if (this.use_dll_storage_attrs) {
    const library = this.tcx.native_library(def_id);
    if (library !== undefined && NativeLibKind.is_dllimport(library.kind)) {
      // For foreign (native) libs we know the exact storage type to use.
      llvm.set_dllimport_storage_class(g);
    }
  }

  this.instances.set(instance, g);
  return g;
};

// rustc: compiler/rustc_codegen_llvm/src/consts.rs:474 codegen_static_item
CodegenCx.prototype.codegen_static_item = function (this: CodegenCx, def_id: DefId): void {
  assert(
    llvm.LLVMGetInitializer(unwrap(this.instances.get(Instance.mono(this.tcx, def_id)))) === undefined,
    "assertion failed: llvm::LLVMGetInitializer(self.instances.borrow().get(&Instance::mono(self.tcx,\n                            def_id)).unwrap()).is_none()",
  );
  const attrs = this.tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;

  const r = codegen_static_initializer(this, def_id);
  if (r.$ !== "Ok") {
    // Error has already been reported
    return;
  }
  const [v, alloc_] = r._0;
  const alloc = alloc_.inner();

  const val_llty = this.val_ty(v);

  let g = this.get_static_inner(def_id, val_llty);
  const llty = this.get_type_of_global(g);

  if (val_llty === llty) {
    // g
  } else {
    // codegen_static_initializer creates the global value just from the
    // `Allocation` data by generating one big struct value that is just
    // all the bytes and pointers after each other. This will almost never
    // match the type that the static was declared with. Unfortunately
    // we can't just LLVMConstBitCast our way out of it because that has very
    // specific rules on what can be cast. So instead of adding a new way to
    // generate static initializers that match the static's type, we picked
    // the easier option and retroactively change the type of the static item itself.
    // `String::from_utf8(llvm::get_value_name(g)).expect(..)`
    const bytes = llvm.get_value_name(g);
    const utf8 = from_utf8(bytes);
    const name = expect_result(utf8.$ === "Err" ? Err({ bytes, error: utf8._0 }) : utf8, "we declare our statics with a utf8-valid name", debug_FromUtf8Error);
    llvm.set_value_name(g, new Uint8Array(0));

    const linkage = llvm.get_linkage(g);
    const visibility = llvm.get_visibility(g);

    const new_g = this.declare_global(name, val_llty);

    llvm.set_linkage(new_g, linkage);
    llvm.set_visibility(new_g, visibility);

    // The old global has had its name removed but is returned by
    // get_static since it is in the instance cache. Provide an
    // alternative lookup that points to the new global so that
    // global_asm! can compute the correct mangled symbol name
    // for the global.
    this.renamed_statics.set(def_id, new_g);

    // To avoid breaking any invariants, we leave around the old
    // global for the moment; we'll replace all references to it
    // with the new global later. (See base::codegen_backend.)
    this._0.statics_to_rauw.push([g, new_g]);
    g = new_g;
  }

  // NOTE: Alignment from attributes has already been applied to the allocation.
  set_global_alignment(this, g, alloc.align);
  llvm.set_initializer(g, v);

  this.assume_dso_local(g, true);

  // Forward the allocation's mutability (picked by the const interner) to LLVM.
  if (alloc.mutability === "Not") {
    llvm.set_global_constant(g, true);
  }

  debuginfo().build_global_var_di_node(this, def_id, g);

  if (CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.THREAD_LOCAL)) {
    llvm.set_thread_local_mode(g, this.tls_model);
  }

  // Wasm statics with custom link sections get special treatment as they
  // also go into custom sections of the wasm executable. The exception to
  // this is the `.init_array` section for which we can't emit a custom
  // section as it contains relocations.
  if (this.tcx.sess.target.is_like_wasm && (attrs.link_section !== undefined ? !Symbol.as_str(attrs.link_section).startsWith(".init_array") : true)) {
    if (attrs.link_section !== undefined) {
      const section_ = attrs.link_section;
      const section = this.create_metadata(new TextEncoder().encode(Symbol.as_str(section_)));
      assert(alloc.provenance_().ptrs_().is_empty(), "assertion failed: alloc.provenance().ptrs().is_empty()");

      // The `inspect` method is okay here because we checked for provenance, and
      // because we are doing this access to inspect the final interpreter state (not
      // as part of the interpreter execution).
      const bytes = alloc.inspect_with_uninit_and_ptr_outside_interpreter({ start: 0, end: alloc.len() });
      const alloc_md = this.create_metadata(bytes);
      const data = [section, alloc_md];
      this.module_add_named_metadata_node(this.llmod(), "wasm.custom_sections", data);
    }
  }

  base().set_link_section(g, attrs);
  base().set_variable_sanitizer_attrs(g, attrs);

  const ignorelist = this.sanitizer_ignorelist;
  if (ignorelist !== undefined) {
    const instance = Instance.mono(this.tcx, def_id);
    const sym_name = this.tcx.symbol_name(instance).name;
    const span = this.tcx.def_span(def_id);
    const source_map = this.tcx.sess.source_map();
    const filename = FileName.prefer_local_unconditionally(source_map.span_to_filename(span)).to_string();
    const ty_name = with_no_trimmed_paths(() => display_Ty(EarlyBinder.skip_binder(this.tcx.type_of(def_id))));
    // `.and_then(|path| path.local_path().map(|p| p.display().to_string())).unwrap_or_default()`
    const mainfile = this.tcx.sess.local_crate_source_file()?.local_path() ?? "";

    const demangled = with_no_trimmed_paths(() => this.tcx.def_path_str(def_id));

    const global_blame = (section: string): [Blame, Blame] => {
      let no_san = Blame.NONE();
      let san = Blame.NONE();
      const update = (prefix: string, query: string): void => {
        const [ns, s] = in_section_blame(ignorelist, section, prefix, query);
        no_san = Blame.max(no_san, ns);
        san = Blame.max(san, s);
      };
      update("global", sym_name);
      update("global", demangled);
      update("src", filename);
      if (mainfile.length !== 0) {
        update("mainfile", mainfile);
      }
      update("type", ty_name);
      return [no_san, san];
    };

    const sanitizers = this.tcx.sess.sanitizers();
    const [address_nosan, address_san] = global_blame("address");
    const [kaddress_nosan, kaddress_san] = global_blame("kernel-address");
    const [hwaddress_nosan, hwaddress_san] = global_blame("hwaddress");
    const [khwaddress_nosan, khwaddress_san] = global_blame("kernel-hwaddress");

    const ignore_address = is_blame_ignored(address_nosan, address_san);
    const ignore_kernel_address = is_blame_ignored(Blame.max(address_nosan, kaddress_nosan), Blame.max(address_san, kaddress_san));
    const ignore_hwaddress = is_blame_ignored(hwaddress_nosan, hwaddress_san);
    const ignore_kernel_hwaddress = is_blame_ignored(Blame.max(hwaddress_nosan, khwaddress_nosan), Blame.max(hwaddress_san, khwaddress_san));

    if (
      (SanitizerSet.contains(sanitizers, SanitizerSet.ADDRESS) && ignore_address) ||
      (SanitizerSet.contains(sanitizers, SanitizerSet.KERNELADDRESS) && ignore_kernel_address)
    ) {
      llvm.LLVMRustSetNoSanitizeAddress(g);
    }
    if (
      (SanitizerSet.contains(sanitizers, SanitizerSet.HWADDRESS) && ignore_hwaddress) ||
      (SanitizerSet.contains(sanitizers, SanitizerSet.KERNELHWADDRESS) && ignore_kernel_hwaddress)
    ) {
      llvm.LLVMRustSetNoSanitizeHWAddress(g);
    }
  }

  if (CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.USED_COMPILER)) {
    // `USED` and `USED_LINKER` can't be used together.
    assert(!CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.USED_LINKER), "assertion failed: !attrs.flags.contains(CodegenFnAttrFlags::USED_LINKER)");

    // The semantics of #[used] in Rust only require the symbol to make it into the
    // object file. It is explicitly allowed for the linker to strip the symbol if it
    // is dead, which means we are allowed to use `llvm.compiler.used` instead of
    // `llvm.used` here.
    //
    // Additionally, https://reviews.llvm.org/D97448 in LLVM 13 started emitting unique
    // sections with SHF_GNU_RETAIN flag for llvm.used symbols, which may trigger bugs
    // in the handling of `.init_array` (the static constructor list) in versions of
    // the gold linker (prior to the one released with binutils 2.36).
    //
    // That said, we only ever emit these when `#[used(compiler)]` is explicitly
    // requested. This is to avoid similar breakage on other targets, in particular
    // MachO targets have *their* static constructor lists broken if `llvm.compiler.used`
    // is emitted rather than `llvm.used`. However, that check happens when assigning
    // the `CodegenFnAttrFlags` in the `codegen_fn_attrs` query, so we don't need to
    // take care of it here.
    this.add_compiler_used_global(g);
  }
  if (CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.USED_LINKER)) {
    // `USED` and `USED_LINKER` can't be used together.
    assert(!CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.USED_COMPILER), "assertion failed: !attrs.flags.contains(CodegenFnAttrFlags::USED_COMPILER)");

    this.add_used_global(g);
  }
};

/// Add a global value to a list to be stored in the `llvm.used` variable, an array of ptr.
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:681 add_used_global
CodegenCx.prototype.add_used_global = function (this: CodegenCx, global: Value): void {
  this.used_statics.push(global);
};

/// Add a global value to a list to be stored in the `llvm.compiler.used` variable,
/// an array of ptr.
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:687 add_compiler_used_global
CodegenCx.prototype.add_compiler_used_global = function (this: CodegenCx, global: Value): void {
  this.compiler_used_statics.push(global);
};

// We do our best here to match what Clang does when compiling Objective-C natively.
// See Clang's `CGObjCCommonMac::CreateCStringLiteral`:
// https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGObjCMac.cpp#L4134
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:694 define_objc_classname
CodegenCx.prototype.define_objc_classname = function (this: CodegenCx, classname: string): Value {
  assert_eq_u32(this.objc_abi_version(), 1);

  const llval = this.null_terminate_const_bytes(new TextEncoder().encode(classname));
  const llty = this.val_ty(llval);
  const sym = this.generate_local_symbol_name("OBJC_CLASS_NAME_");
  const g = this.define_global(sym, llty) ?? bug(`symbol \`${sym}\` is already defined`);
  set_global_alignment(this, g, this.tcx.data_layout().i8_align);
  llvm.set_initializer(g, llval);
  llvm.set_linkage(g, "PrivateLinkage");
  llvm.set_section(g, "__TEXT,__cstring,cstring_literals");
  llvm.LLVMSetGlobalConstant(g, llvm.TRUE);
  llvm.LLVMSetUnnamedAddress(g, "Global");
  this.add_compiler_used_global(g);

  return g;
};

// We do our best here to match what Clang does when compiling Objective-C natively.
// See Clang's `ObjCNonFragileABITypesHelper`:
// https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGObjCMac.cpp#L6052
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:717 get_objc_class_t
CodegenCx.prototype.get_objc_class_t = function (this: CodegenCx): Type {
  const cached = this.objc_class_t;
  if (cached !== undefined) {
    return cached;
  }

  assert_eq_u32(this.objc_abi_version(), 2);

  // struct _class_t {
  //     struct _class_t* isa;
  //     struct _class_t* const superclass;
  //     void* cache;
  //     IMP* vtable;
  //     struct class_ro_t* ro;
  // }

  const class_t = this.type_named_struct("struct._class_t");
  const p = this.type_ptr();
  const els = [p, p, p, p, p];
  const packed = false;
  this.set_struct_body(class_t, els, packed);

  this.objc_class_t = class_t;
  return class_t;
};

// We do our best here to match what Clang does when compiling Objective-C natively. We
// deduplicate references within a CGU, but we need a reference definition in each referencing
// CGU. All attempts at using external references to a single reference definition result in
// linker errors.
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:745 get_objc_classref
CodegenCx.prototype.get_objc_classref = function (this: CodegenCx, classname: Symbol): Value {
  const classrefs = this.objc_classrefs;
  const classref = classrefs.get(classname);
  if (classref !== undefined) {
    return classref;
  }

  let g: Value;
  switch (this.objc_abi_version()) {
    case 1: {
      // See Clang's `CGObjCMac::EmitClassRefFromId`:
      // https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGObjCMac.cpp#L5205
      const llval = this.define_objc_classname(Symbol.as_str(classname));
      const llty = this.type_ptr();
      const sym = this.generate_local_symbol_name("OBJC_CLASS_REFERENCES_");
      const g_ = this.define_global(sym, llty) ?? bug(`symbol \`${sym}\` is already defined`);
      set_global_alignment(this, g_, this.tcx.data_layout().pointer_align().abi);
      llvm.set_initializer(g_, llval);
      llvm.set_linkage(g_, "PrivateLinkage");
      llvm.set_section(g_, "__OBJC,__cls_refs,literal_pointers,no_dead_strip");
      this.add_compiler_used_global(g_);
      g = g_;
      break;
    }
    case 2: {
      // See Clang's `CGObjCNonFragileABIMac::EmitClassRefFromId`:
      // https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGObjCMac.cpp#L7423
      const extern_sym = `OBJC_CLASS_$_${Symbol.as_str(classname)}`;
      const extern_llty = this.get_objc_class_t();
      const llval = this.declare_global(extern_sym, extern_llty);
      const llty = this.type_ptr();
      const sym = this.generate_local_symbol_name("OBJC_CLASSLIST_REFERENCES_$_");
      const g_ = this.define_global(sym, llty) ?? bug(`symbol \`${sym}\` is already defined`);
      set_global_alignment(this, g_, this.tcx.data_layout().pointer_align().abi);
      llvm.set_initializer(g_, llval);
      llvm.set_linkage(g_, "InternalLinkage");
      llvm.set_section(g_, "__DATA,__objc_classrefs,regular,no_dead_strip");
      this.add_compiler_used_global(g_);
      g = g_;
      break;
    }
    default:
      return panic("internal error: entered unreachable code");
  }

  classrefs.set(classname, g);
  return g;
};

// We do our best here to match what Clang does when compiling Objective-C natively. We
// deduplicate references within a CGU, but we need a reference definition in each referencing
// CGU. All attempts at using external references to a single reference definition result in
// linker errors.
//
// Newer versions of Apple Clang generate calls to `@"objc_msgSend$methname"` selector stub
// functions. We don't currently do that. The code we generate is closer to what Apple Clang
// generates with the `-fno-objc-msgsend-selector-stubs` option.
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:803 get_objc_selref
CodegenCx.prototype.get_objc_selref = function (this: CodegenCx, methname: Symbol): Value {
  const selrefs = this.objc_selrefs;
  const selref = selrefs.get(methname);
  if (selref !== undefined) {
    return selref;
  }

  const abi_version = this.objc_abi_version();
  const by_version = <T>(v1: T, v2: T): T => {
    switch (abi_version) {
      case 1:
        return v1;
      case 2:
        return v2;
      default:
        return panic("internal error: entered unreachable code");
    }
  };

  // See Clang's `CGObjCCommonMac::CreateCStringLiteral`:
  // https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGObjCMac.cpp#L4134
  const methname_llval = this.null_terminate_const_bytes(new TextEncoder().encode(Symbol.as_str(methname)));
  const methname_llty = this.val_ty(methname_llval);
  const methname_sym = this.generate_local_symbol_name("OBJC_METH_VAR_NAME_");
  const methname_g = this.define_global(methname_sym, methname_llty) ?? bug(`symbol \`${methname_sym}\` is already defined`);
  set_global_alignment(this, methname_g, this.tcx.data_layout().i8_align);
  llvm.set_initializer(methname_g, methname_llval);
  llvm.set_linkage(methname_g, "PrivateLinkage");
  llvm.set_section(methname_g, by_version("__TEXT,__cstring,cstring_literals", "__TEXT,__objc_methname,cstring_literals"));
  llvm.LLVMSetGlobalConstant(methname_g, llvm.TRUE);
  llvm.LLVMSetUnnamedAddress(methname_g, "Global");
  this.add_compiler_used_global(methname_g);

  // See Clang's `CGObjCMac::EmitSelectorAddr`:
  // https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGObjCMac.cpp#L5243
  // And Clang's `CGObjCNonFragileABIMac::EmitSelectorAddr`:
  // https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGObjCMac.cpp#L7586
  const selref_llval = methname_g;
  const selref_llty = this.type_ptr();
  const selref_sym = this.generate_local_symbol_name("OBJC_SELECTOR_REFERENCES_");
  const selref_g = this.define_global(selref_sym, selref_llty) ?? bug(`symbol \`${selref_sym}\` is already defined`);
  set_global_alignment(this, selref_g, this.tcx.data_layout().pointer_align().abi);
  llvm.set_initializer(selref_g, selref_llval);
  llvm.set_externally_initialized(selref_g, true);
  llvm.set_linkage(selref_g, by_version<llvm.Linkage>("PrivateLinkage", "InternalLinkage"));
  llvm.set_section(selref_g, by_version("__OBJC,__message_refs,literal_pointers,no_dead_strip", "__DATA,__objc_selrefs,literal_pointers,no_dead_strip"));
  this.add_compiler_used_global(selref_g);

  selrefs.set(methname, selref_g);
  return selref_g;
};

// We do our best here to match what Clang does when compiling Objective-C natively.
// See Clang's `ObjCTypesHelper`:
// https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGObjCMac.cpp#L5936
// And Clang's `CGObjCMac::EmitModuleInfo`:
// https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGObjCMac.cpp#L5151
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:874 define_objc_module_info
CodegenCx.prototype.define_objc_module_info = function (this: CodegenCx): void {
  assert_eq_u32(this.objc_abi_version(), 1);

  // struct _objc_module {
  //     long version;                // Hardcoded to 7 in Clang.
  //     long size;                   // sizeof(struct _objc_module)
  //     char* name;                  // Hardcoded to classname "" in Clang.
  //     struct _objc_symtab* symtab; // Null without class or category definitions.
  //  }

  const llty = this.type_named_struct("struct._objc_module");
  const i32_llty = this.type_i32();
  const ptr_llty = this.type_ptr();
  const packed = false;
  this.set_struct_body(llty, [i32_llty, i32_llty, ptr_llty, ptr_llty], packed);

  const version = this.const_uint(i32_llty, 7n);
  const size = this.const_uint(i32_llty, 16n);
  const name = this.define_objc_classname("");
  const symtab = this.const_null_inherent(ptr_llty);
  const llval = common.named_struct(llty, [version, size, name, symtab]);

  const sym = "OBJC_MODULES";
  const g = this.define_global(sym, llty) ?? bug(`symbol \`${sym}\` is already defined`);
  set_global_alignment(this, g, this.tcx.data_layout().pointer_align().abi);
  llvm.set_initializer(g, llval);
  llvm.set_linkage(g, "PrivateLinkage");
  llvm.set_section(g, "__OBJC,__module_info,regular,no_dead_strip");

  this.add_compiler_used_global(g);
};

// ---- impl<'ll> StaticCodegenMethods for CodegenCx<'ll, '_> (consts.rs:909) ----
declare module "./context.ts" {
  interface CodegenCx {
    static_addr_of(alloc: ConstAllocation, kind: string | undefined): Value;
    codegen_static(def_id: DefId): void;
  }
}

/// Get a pointer to a global variable.
///
/// The pointer will always be in the default address space. If global variables default to a
/// different address space, an addrspacecast is inserted.
// rustc: compiler/rustc_codegen_llvm/src/consts.rs:914 static_addr_of
CodegenCx.prototype.static_addr_of = function (this: CodegenCx, alloc: ConstAllocation, kind: string | undefined): Value {
  // FIXME: should we cache `const_alloc_to_llvm` to avoid repeating this for the
  // same `ConstAllocation`?
  const cv = const_alloc_to_llvm(this, alloc.inner(), IsStatic.No, IsInitOrFini.No);

  const gv = this.static_addr_of_impl(cv, alloc.inner().align, kind);
  // static_addr_of_impl returns the bare global variable, which might not be in the default
  // address space. Cast to the default address space if necessary.
  return this.const_pointercast(gv, this.type_ptr());
};

// rustc: compiler/rustc_codegen_llvm/src/consts.rs:925 codegen_static
CodegenCx.prototype.codegen_static = function (this: CodegenCx, def_id: DefId): void {
  this.codegen_static_item(def_id);
};

/** `assert_eq!(self.objc_abi_version(), N)` (`u32`). */
function assert_eq_u32(left: number, right: number): void {
  if (left !== right) {
    panic(`assertion \`left == right\` failed\n  left: ${left}\n right: ${right}`);
  }
}

// ---- rustc_sanitizers::ignorelist: out of scope (harness/scope.json), the items codegen_static_item names (header) ----

/** `rustc_sanitizers::ignorelist::Blame`: opaque here. */
type Blame = number & { readonly __brand: "rustc_sanitizers::ignorelist::Blame" };

function sanitizers_stub(what: string): never {
  return unported(`rustc_sanitizers: ${what} (rustc_sanitizers is out of scope, harness/scope.json)`);
}

const Blame = {
  NONE: (): Blame => sanitizers_stub("ignorelist::Blame::NONE"),
  max: (_self: Blame, _other: Blame): Blame => sanitizers_stub("ignorelist::Blame::max"),
};

function in_section_blame(_ignorelist: unknown, _section: string, _prefix: string, _query: string): [Blame, Blame] {
  return sanitizers_stub("ignorelist::SanitizerIgnoreList::in_section_blame");
}

function is_blame_ignored(_no_san: Blame, _san: Blame): boolean {
  return sanitizers_stub("ignorelist::is_blame_ignored");
}

// ---- Sibling modules, read lazily (header: init order) ----
/** `crate::base` (base.ts), read lazily (init order). */
function base(): typeof import("./base.ts") {
  return (base__m ??= require("./base.ts") as typeof import("./base.ts"));
}
var base__m: typeof import("./base.ts") | undefined;
/** `crate::debuginfo` (`build_global_var_di_node`, re-exported from debuginfo/metadata.ts; header), read lazily (init order). */
function debuginfo(): typeof import("./debuginfo/metadata.ts") {
  return (debuginfo__m ??= require("./debuginfo/metadata.ts") as typeof import("./debuginfo/metadata.ts"));
}
var debuginfo__m: typeof import("./debuginfo/metadata.ts") | undefined;

//! Handles codegen of callees as well as other call-related
//! things. Callees are a superset of normal rust values and sometimes
//! have different representations. In particular, top-level fn items
//! and methods are represented as just a fn ptr and not a full
//! closure.
// Port of compiler/rustc_codegen_llvm/src/callee.rs (skeleton: lane cg-contract; body: lane cg-types-attrs, plan-m7 §8 wave 41).
//
// PORT (cg-types-attrs): `cx.tcx()` / `cx.typing_env()` are `HasTyCtxt::tcx_()` / `HasTypingEnv::typing_env_()` (context.ts
// header); `cx.tcx` is the field. `tracing::debug!` lines are comments.
import { is_using_dlltool, i686_decorated_name } from "../rustc_codegen_ssa/common.ts";
import { TyCtxt_codegen_instance_attrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { NativeLibKind } from "../rustc_structures/native_lib_kind.ts";
import { Options_impl } from "../rustc_session/config.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { assert } from "../std/panic.ts";
import * as common from "./common.ts";
import type { CodegenCx } from "./context.ts";
import * as llvm from "./llvm/mod.ts";
import type { Value } from "./llvm/mod.ts";

/// Codegens a reference to a fn/method item, monomorphizing and
/// inlining as it goes.
// rustc: compiler/rustc_codegen_llvm/src/callee.rs:19 get_fn
export function get_fn(cx: CodegenCx, instance: Instance): Value {
  const tcx = cx.tcx_();

  // debug!("get_fn(instance={:?})", instance);

  assert(!TypeVisitableExt.has_infer(instance.args, fold_GenericArgs), "assertion failed: !instance.args.has_infer()");
  assert(!TypeVisitableExt.has_escaping_bound_vars(instance.args, fold_GenericArgs), "assertion failed: !instance.args.has_escaping_bound_vars()");

  const cached = cx.instances.get(instance);
  if (cached !== undefined) {
    return cached;
  }

  const sym = tcx.symbol_name(instance).name;
  // debug!("get_fn({:?}: {:?}) => {}", instance, instance.ty(cx.tcx(), cx.typing_env()), sym);

  const fn_abi = cx.fn_abi_of_instance(instance, RawList.empty<Ty>());

  let llfn: Value;
  const declared = cx.get_declared_value(sym);
  if (declared !== undefined) {
    llfn = declared;
  } else {
    const instance_def_id = Instance.def_id(instance);
    let llfn_: Value;
    const dllimport = tcx.sess.target.arch.$ === "X86" ? common.get_dllimport(tcx, instance_def_id, sym) : undefined;
    if (tcx.sess.target.arch.$ === "X86" && dllimport !== undefined) {
      // When calling functions in generated import libraries,
      // LLVM/ar_archive_writer needs the fully decorated name
      // (as would have been in the declaring object file), but dlltool
      // wants the name as exported (as would be in the def file)
      // which may be missing decorations.
      const using_dlltool = is_using_dlltool(tcx.sess.target);
      const llfn__ = cx.declare_fn(i686_decorated_name(dllimport, using_dlltool, true, !using_dlltool), fn_abi, instance);

      // Fix for https://github.com/rust-lang/rust/issues/104453
      // On x86 Windows, LLVM uses 'L' as the prefix for any private
      // global symbols, so when we create an undecorated function symbol
      // that begins with an 'L' LLVM misinterprets that as a private
      // global symbol that it created and so fails the compilation at a
      // later stage since such a symbol must have a definition.
      //
      // To avoid this, we set the Storage Class to "DllImport" so that
      // LLVM will prefix the name with `__imp_`. Ideally, we'd like the
      // existing logic below to set the Storage Class, but it has an
      // exemption for MinGW for backwards compatibility.
      llvm.set_dllimport_storage_class(llfn__);
      llfn_ = llfn__;
    } else {
      llfn_ = cx.declare_fn(sym, fn_abi, instance);
    }
    // debug!("get_fn: not casting pointer!");

    // Apply an appropriate linkage/visibility value to our item that we
    // just declared.
    //
    // This is sort of subtle. Inside our codegen unit we started off
    // compilation by predefining all our own `MonoItem` instances. That
    // is, everything we're codegenning ourselves is already defined. That
    // means that anything we're actually codegenning in this codegen unit
    // will have hit the above branch in `get_declared_value`. As a result,
    // we're guaranteed here that we're declaring a symbol that won't get
    // defined, or in other words we're referencing a value from another
    // codegen unit or even another crate.
    //
    // So because this is a foreign value we blanket apply an external
    // linkage directive because it's coming from a different object file.
    // The visibility here is where it gets tricky. This symbol could be
    // referencing some foreign crate or foreign library (an `extern`
    // block) in which case we want to leave the default visibility. We may
    // also, though, have multiple codegen units. It could be a
    // monomorphization, in which case its expected visibility depends on
    // whether we are sharing generics or not. The important thing here is
    // that the visibility we apply to the declaration is the same one that
    // has been applied to the definition (wherever that definition may be).

    llvm.set_linkage(llfn_, "ExternalLinkage");
    // `.next().is_some()`
    const is_generic = !instance.args.non_erasable_generics()[Symbol.iterator]().next().done;

    let is_hidden: boolean;
    if (is_generic) {
      // This is a monomorphization of a generic function.
      if (!(Options_impl.share_generics(cx.tcx.sess.opts) || TyCtxt_codegen_instance_attrs(tcx, instance.def).inline.$ === "Never")) {
        // When not sharing generics, all instances are in the same
        // crate and have hidden visibility.
        is_hidden = true;
      } else {
        const local = instance_def_id.as_local();
        if (local !== undefined) {
          // This is a monomorphization of a generic function
          // defined in the current crate. It is hidden if:
          // - the definition is unreachable for downstream
          //   crates, or
          // - the current crate does not re-export generics
          //   (because the crate is a C library or executable)
          is_hidden = cx.tcx.is_unreachable_local_definition(local) || !cx.tcx.local_crate_exports_generics();
        } else {
          // This is a monomorphization of a generic function
          // defined in an upstream crate. It is hidden if:
          // - it is instantiated in this crate, and
          // - the current crate does not re-export generics
          is_hidden = Instance.upstream_monomorphization(instance, tcx) === undefined && !cx.tcx.local_crate_exports_generics();
        }
      }
    } else {
      // This is a non-generic function. It is hidden if:
      // - it is instantiated in the local crate, and
      //   - it is defined an upstream crate (non-local), or
      //   - it is not reachable
      is_hidden = cx.tcx.is_codegened_item(instance_def_id) && (!instance_def_id.is_local() || !cx.tcx.is_reachable_non_generic(instance_def_id));
    }
    if (is_hidden) {
      llvm.set_visibility(llfn_, "Hidden");
    }

    // MinGW: For backward compatibility we rely on the linker to decide whether it
    // should use dllimport for functions.
    if (cx.use_dll_storage_attrs) {
      const library = tcx.native_library(instance_def_id);
      if (library !== undefined && NativeLibKind.is_dllimport(library.kind) && !(tcx.sess.target.env.$ === "Gnu" || tcx.sess.target.env.$ === "Uclibc")) {
        llvm.set_dllimport_storage_class(llfn_);
      }
    }

    cx.assume_dso_local(llfn_, true);

    llfn = llfn_;
  }

  cx.instances.set(instance, llfn);

  return llfn;
}

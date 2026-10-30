// Port of compiler/rustc_metadata/src/dependency_format.rs.
//! Resolution of mixing rlibs and dylibs
//!
//! When producing a final artifact, such as a dynamic library, the compiler has
//! a choice between linking an rlib or linking a dylib of all upstream
//! dependencies. The linking phase must guarantee, however, that a library only
//! show up once in the object file. For example, it is illegal for library A to
//! be statically linked to B and C in separate dylibs, and then link B and C
//! into a crate D (because library A appears twice).
//!
//! The job of this module is to calculate what format each upstream crate
//! should be used when linking each output type requested in this session. This
//! generally follows this set of rules:
//!
//! 1. Each library must appear exactly once in the output.
//! 2. Each rlib contains only one library (it's just an object file)
//! 3. Each dylib can contain more than one library (due to static linking),
//!    and can also bring in many dynamic dependencies.
//!
//! With these constraints in mind, it's generally a very difficult problem to
//! find a solution that's not "all rlibs" or "all dylibs". I have suspicions
//! that NP-ness may come into the picture here...
//!
//! The current selection algorithm below looks mostly similar to:
//!
//! 1. If static linking is required, then require all upstream dependencies
//!    to be available as rlibs. If not, generate an error.
//! 2. If static linking is requested (generating an executable), then
//!    attempt to use all upstream dependencies as rlibs. If any are not
//!    found, bail out and continue to step 3.
//! 3. Static linking has failed, at least one library must be dynamically
//!    linked. Apply a heuristic by greedily maximizing the number of
//!    dynamically linked libraries.
//! 4. Each upstream dependency available as a dynamic library is
//!    registered. The dependencies all propagate, adding to a map. It is
//!    possible for a dylib to add a static library as a dependency, but it
//!    is illegal for two dylibs to add the same static library as a
//!    dependency. The same dylib can be added twice. Additionally, it is
//!    illegal to add a static dependency when it was previously found as a
//!    dylib (and vice versa)
//! 5. After all dynamic dependencies have been traversed, re-traverse the
//!    remaining dependencies and add them statically (if they haven't been
//!    added already).
//!
//! While not perfect, this algorithm should help support use-cases such as leaf
//! dependencies being static while the larger tree of inner dependencies are
//! all dynamic. This isn't currently very well battle tested, so it will likely
//! fall short in some use cases.
//!
//! Currently, there is no way to specify the preference of linkage with a
//! particular library (other than a global dynamic/static switch).
//! Additionally, the algorithm is geared towards finding *any* solution rather
//! than finding a number of solutions (there are normally quite a few).
//
// PORT: `IndexVec<CrateNum, Linkage>` is an array indexed by the crate number; `IndexVec::push` returns the new
// element's index, which the `assert_eq!(ret.push(..), cnum)` checks compare as `ret.length - 1`. `info!` tracing
// is kept as comments.
import { CrateDepKind, type LinkagePreference } from "../rustc_crate_store/lib.ts";
import { UnstableFeatures } from "../rustc_feature/lib.ts";
import { type Dependencies, type DependencyList, Linkage } from "../rustc_middle/middle/dependency_format.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { CrateNum, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import type { CrateType } from "../rustc_structures/crate_type.ts";
import type { PanicStrategy } from "../rustc_target/spec/mod.ts";
import { assert } from "../std/panic.ts";
import { CStore } from "./creader.ts";
import * as diagnostics from "./diagnostics.ts";

// rustc: compiler/rustc_metadata/src/dependency_format.rs:73 calculate
export function calculate(tcx: TyCtxt): Dependencies {
  const out: Dependencies = new Map();
  for (const ty of tcx.crate_types()) {
    const linkage = calculate_type(tcx, ty);
    verify_ok(tcx, linkage);
    out.set(ty, linkage);
  }
  return out;
}

// rustc: compiler/rustc_metadata/src/dependency_format.rs:84 calculate_type
function calculate_type(tcx: TyCtxt, ty: CrateType): DependencyList {
  const sess = tcx.sess;

  if (!sess.opts.output_types.should_link()) {
    return [];
  }

  let preferred_linkage: Linkage;
  switch (ty) {
    // Generating a dylib without `-C prefer-dynamic` means that we're going
    // to try to eagerly statically link all dependencies. This is normally
    // done for end-product dylibs, not intermediate products.
    //
    // Treat cdylibs and staticlibs similarly. If `-C prefer-dynamic` is set,
    // the caller may be code-size conscious, but without it, it makes sense
    // to statically link a cdylib or staticlib. For staticlibs we use
    // `-Z staticlib-prefer-dynamic` for now. This may be merged into
    // `-C prefer-dynamic` in the future.
    case "Dylib":
    case "Cdylib":
    case "Sdylib":
      preferred_linkage = sess.opts.cg.prefer_dynamic ? Linkage.Dynamic : Linkage.Static;
      break;
    case "StaticLib":
      if (sess.opts.unstable_opts.staticlib_prefer_dynamic) {
        preferred_linkage = Linkage.Dynamic;
      } else {
        preferred_linkage = Linkage.Static;
      }
      break;

    // If the global prefer_dynamic switch is turned off, or the final
    // executable will be statically linked, prefer static crate linkage.
    case "Executable":
      if (!sess.opts.cg.prefer_dynamic || sess.crt_static(ty)) {
        preferred_linkage = Linkage.Static;
      } else {
        preferred_linkage = Linkage.Dynamic;
      }
      break;

    // proc-macro crates are mostly cdylibs, but we also need metadata.
    case "ProcMacro":
      preferred_linkage = Linkage.Static;
      break;

    // No linkage happens with rlibs, we just needed the metadata (which we
    // got long ago), so don't bother with anything.
    case "Rlib":
      preferred_linkage = Linkage.NotLinked;
      break;
  }

  const unavailable_as_static: CrateNum[] = [];

  // PORT: `as Linkage` keeps upstream's `IncludedFromDylib` arm, which TS's narrowing knows cannot happen.
  switch (preferred_linkage as Linkage) {
    // If the crate is not linked, there are no link-time dependencies.
    case "NotLinked":
      return [];
    case "Static": {
      // Attempt static linkage first. For dylibs and executables, we may be
      // able to retry below with dynamic linkage.
      const v = attempt_static(tcx, unavailable_as_static);
      if (v !== undefined) {
        return v;
      }

      // Static executables must have all static dependencies.
      // If any are not found, generate some nice pretty errors.
      if (
        (ty === "StaticLib" && !sess.opts.unstable_opts.staticlib_allow_rdylib_deps) ||
        (ty === "Executable" && sess.crt_static(ty) && !sess.target.crt_static_allows_dylibs)
      ) {
        for (const cnum of tcx.crates(null)) {
          if (CrateDepKind.macros_only(tcx.crate_dep_kind(cnum))) {
            continue;
          }
          const src = tcx.used_crate_source(cnum);
          if (src.rlib !== undefined) {
            continue;
          }
          sess.dcx().emit_err(diagnostics.RlibRequired_diagnostic({ crate_name: tcx.crate_name(cnum) }));
        }
        return [];
      }
      break;
    }
    case "Dynamic":
    case "IncludedFromDylib":
      break;
  }

  const all_dylibs = (): CrateNum[] =>
    tcx.crates(null).filter(
      (cnum) =>
        !CrateDepKind.macros_only(tcx.crate_dep_kind(cnum)) &&
        (tcx.used_crate_source(cnum).dylib !== undefined || tcx.used_crate_source(cnum).sdylib_interface !== undefined),
    );

  const upstream_in_dylibs = new Set<CrateNum>();

  if (tcx.features().rustc_private()) {
    // We need this to prevent users of `rustc_driver` from linking dynamically to `std`
    // which does not work as `std` is also statically linked into `rustc_driver`.

    // Find all libraries statically linked to upstream dylibs.
    for (const cnum of all_dylibs()) {
      const deps = tcx.dylib_dependency_formats(cnum);
      for (const [depnum, style] of deps) {
        if (style === "RequireStatic") {
          upstream_in_dylibs.add(depnum);
        }
      }
    }
  }

  const formats = new Map<CrateNum, LinkagePreference>();

  // Sweep all crates for found dylibs. Add all dylibs, as well as their
  // dependencies, ensuring there are no conflicts. The only valid case for a
  // dependency to be relied upon twice is for both cases to rely on a dylib.
  for (const cnum of all_dylibs()) {
    if (upstream_in_dylibs.has(cnum)) {
      // info!("skipping dylib: {}", tcx.crate_name(cnum));
      // If this dylib is also available statically linked to another dylib
      // we try to use that instead.
      continue;
    }

    const _name = tcx.crate_name(cnum);
    // info!("adding dylib: {}", name);
    add_library(tcx, cnum, "RequireDynamic", formats, unavailable_as_static);
    const deps = tcx.dylib_dependency_formats(cnum);
    for (const [depnum, style] of deps) {
      // info!("adding {:?}: {}", style, tcx.crate_name(depnum));
      add_library(tcx, depnum, style, formats, unavailable_as_static);
    }
  }

  // Collect what we've got so far in the return vector.
  const last_crate = tcx.crates(null).length;
  const ret: DependencyList = [];

  // We need to fill in something for LOCAL_CRATE as IndexVec is a dense map.
  // Linkage::Static semantically the most correct thing to use as the local
  // crate is always statically linked into the linker output, even when
  // linking a dylib. Using Linkage::Static also allow avoiding special cases
  // for LOCAL_CRATE in some places.
  ret.push(Linkage.Static);
  assert(ret.length - 1 === LOCAL_CRATE, "assertion `left == right` failed");

  for (let cnum_ = 1; cnum_ < last_crate + 1; cnum_++) {
    const cnum = CrateNum.new(cnum_);
    const f = formats.get(cnum);
    ret.push(f === "RequireDynamic" ? Linkage.Dynamic : f === "RequireStatic" ? Linkage.IncludedFromDylib : Linkage.NotLinked);
    assert(ret.length - 1 === cnum, "assertion `left == right` failed");
  }

  // Run through the dependency list again, and add any missing libraries as
  // static libraries.
  //
  // If the crate hasn't been included yet and it's not actually required
  // (e.g., it's a panic runtime) then we skip it here as well.
  for (const cnum of tcx.crates(null)) {
    const src = tcx.used_crate_source(cnum);
    if (src.dylib === undefined && !formats.has(cnum) && tcx.crate_dep_kind(cnum) === "Unconditional") {
      assert(src.rlib !== undefined || src.rmeta !== undefined, "assertion failed: src.rlib.is_some() || src.rmeta.is_some()");
      // info!("adding staticlib: {}", tcx.crate_name(cnum));
      add_library(tcx, cnum, "RequireStatic", formats, unavailable_as_static);
      ret[cnum] = Linkage.Static;
    }
  }

  // We've gotten this far because we're emitting some form of a final
  // artifact which means that we may need to inject dependencies of some
  // form.
  //
  // Things like panic runtimes may not have been activated quite yet, so do so here.
  activate_injected_dep(CStore.from_tcx(tcx).injected_panic_runtime(), ret, (cnum) => tcx.is_panic_runtime(cnum));

  // When dylib B links to dylib A, then when using B we must also link to A.
  // It could be the case, however, that the rlib for A is present (hence we
  // found metadata), but the dylib for A has since been removed.
  //
  // For situations like this, we perform one last pass over the dependencies,
  // making sure that everything is available in the requested format.
  for (let i = 0; i < ret.length; i++) {
    const cnum = CrateNum.new(i);
    const kind_ = ret[i]!;
    if (cnum === LOCAL_CRATE) {
      continue;
    }
    const src = tcx.used_crate_source(cnum);
    if (kind_ === "NotLinked" || kind_ === "IncludedFromDylib") {
      // {}
    } else if (kind_ === "Static" && src.rlib !== undefined) {
      continue;
    } else if (kind_ === "Dynamic" && (src.dylib !== undefined || src.sdylib_interface !== undefined)) {
      continue;
    } else {
      const kind = kind_ === "Static" ? "rlib" : "dylib";
      const crate_name = tcx.crate_name(cnum);
      if (Symbol.as_str(crate_name).startsWith("rustc_")) {
        sess.dcx().emit_err(diagnostics.RustcLibRequired_diagnostic({ crate_name, kind }));
      } else {
        sess.dcx().emit_err(diagnostics.LibRequired_diagnostic({ crate_name, kind }));
      }
    }
  }

  return ret;
}

// rustc: compiler/rustc_metadata/src/dependency_format.rs:294 add_library
function add_library(tcx: TyCtxt, cnum: CrateNum, link: LinkagePreference, m: Map<CrateNum, LinkagePreference>, unavailable_as_static: CrateNum[]): void {
  const link2 = m.get(cnum);
  if (link2 !== undefined) {
    // If the linkages differ, then we'd have two copies of the library
    // if we continued linking. If the linkages are both static, then we
    // would also have two copies of the library (static from two
    // different locations).
    //
    // This error is probably a little obscure, but I imagine that it
    // can be refined over time.
    if (link2 !== link || link === "RequireStatic") {
      const linking_to_rustc_driver =
        UnstableFeatures.is_nightly_build(tcx.sess.unstable_features) && tcx.crates(null).some((cnum) => tcx.crate_name(cnum) === sym.rustc_driver);
      tcx.dcx().emit_err(
        diagnostics.CrateDepMultiple_diagnostic({
          crate_name: tcx.crate_name(cnum),
          non_static_deps: unavailable_as_static.splice(0).map((cnum) => ({ sub_crate_name: tcx.crate_name(cnum) })),
          rustc_driver_help: linking_to_rustc_driver,
        }),
      );
    }
  } else {
    m.set(cnum, link);
  }
}

// rustc: compiler/rustc_metadata/src/dependency_format.rs:329 attempt_static
function attempt_static(tcx: TyCtxt, unavailable: CrateNum[]): DependencyList | undefined {
  // PORT: `.filter_map(..).all(..)` is lazy and stops at the first crate that is not an rlib, so later crates are
  // not pushed to `unavailable`.
  let all_crates_available_as_rlib = true;
  for (const cnum of tcx.crates(null)) {
    if (CrateDepKind.macros_only(tcx.crate_dep_kind(cnum))) {
      continue;
    }
    const is_rlib = tcx.used_crate_source(cnum).rlib !== undefined;
    if (!is_rlib) {
      unavailable.push(cnum);
      all_crates_available_as_rlib = false;
      break;
    }
  }
  if (!all_crates_available_as_rlib) {
    return undefined;
  }

  // All crates are available in an rlib format, so we're just going to link
  // everything in explicitly so long as it's actually required.
  const ret: DependencyList = [];
  ret.push(Linkage.Static);
  assert(ret.length - 1 === LOCAL_CRATE, "assertion `left == right` failed");
  for (const cnum of tcx.crates(null)) {
    let l: Linkage;
    switch (tcx.crate_dep_kind(cnum)) {
      case "Unconditional":
        l = Linkage.Static;
        break;
      case "MacrosOnly":
      case "Conditional":
        l = Linkage.NotLinked;
        break;
    }
    ret.push(l);
    assert(ret.length - 1 === cnum, "assertion `left == right` failed");
  }

  // Our panic runtime may not have been linked above if it wasn't explicitly
  // linked, which is the case for any injected dependency. Handle that here
  // and activate it.
  activate_injected_dep(CStore.from_tcx(tcx).injected_panic_runtime(), ret, (cnum) => tcx.is_panic_runtime(cnum));

  return ret;
}

/// Given a list of how to link upstream dependencies so far, ensure that an
/// injected dependency is activated. This will not do anything if one was
/// transitively included already (e.g., via a dylib or explicitly so).
///
/// If an injected dependency was not found then we're guaranteed the
/// metadata::creader module has injected that dependency (not listed as
/// a required dependency) in one of the session's field. If this field is not
/// set then this compilation doesn't actually need the dependency and we can
/// also skip this step entirely.
// rustc: compiler/rustc_metadata/src/dependency_format.rs:382 activate_injected_dep
function activate_injected_dep(injected: CrateNum | undefined, list: DependencyList, replaces_injected: (cnum: CrateNum) => boolean): void {
  for (let i = 0; i < list.length; i++) {
    const cnum = CrateNum.new(i);
    const slot = list[i]!;
    if (!replaces_injected(cnum)) {
      continue;
    }
    if (slot !== Linkage.NotLinked) {
      return;
    }
  }
  if (injected !== undefined) {
    assert(list[injected] === Linkage.NotLinked, "assertion `left == right` failed");
    list[injected] = Linkage.Static;
  }
}

/// After the linkage for a crate has been determined we need to verify that
/// there's only going to be one panic runtime in the output.
// rustc: compiler/rustc_metadata/src/dependency_format.rs:403 verify_ok
function verify_ok(tcx: TyCtxt, list_: DependencyList): void {
  const sess = tcx.sess;
  const list: CrateNum[] = [];
  for (let i = 0; i < list_.length; i++) {
    if (list_[i] !== Linkage.NotLinked) list.push(CrateNum.new(i));
  }
  if (list.length === 0) {
    return;
  }
  const desired_strategy = sess.panic_strategy();

  // If we are panic=immediate-abort, make sure everything in the dependency tree has also been
  // compiled with immediate-abort.
  if (list.some((cnum) => tcx.required_panic_strategy(cnum) === "ImmediateAbort")) {
    const invalid_crates: CrateNum[] = [];
    for (const cnum of list) {
      if (tcx.required_panic_strategy(cnum) !== "ImmediateAbort") {
        invalid_crates.push(cnum);
        // If core is incompatible, it's very likely that we'd emit an error for every
        // sysroot crate, so instead of doing that emit a single fatal error that suggests
        // using build-std.
        if (tcx.crate_name(cnum) === sym.core) {
          sess.dcx().emit_fatal(diagnostics.IncompatibleWithImmediateAbortCore_diagnostic({}));
        }
      }
    }
    for (const cnum of invalid_crates) {
      sess.dcx().emit_err(diagnostics.IncompatibleWithImmediateAbort_diagnostic({ crate_name: tcx.crate_name(cnum) }));
    }
  }

  let panic_runtime: [CrateNum, PanicStrategy] | undefined = undefined;
  for (const cnum of list) {
    if (tcx.is_panic_runtime(cnum)) {
      if (panic_runtime !== undefined) {
        const [prev, _] = panic_runtime;
        const prev_name = tcx.crate_name(prev);
        const cur_name = tcx.crate_name(cnum);
        sess.dcx().emit_err(diagnostics.TwoPanicRuntimes_diagnostic({ prev_name, cur_name }));
      }
      panic_runtime = [cnum, tcx.required_panic_strategy(cnum) ?? bug("cannot determine panic strategy of a panic runtime")];
    }
  }

  // If we found a panic runtime, then we know by this point that it's the
  // only one, but we perform validation here that all the panic strategy
  // compilation modes for the whole DAG are valid.
  if (panic_runtime !== undefined) {
    const [runtime_cnum, found_strategy] = panic_runtime;
    // First up, validate that our selected panic runtime is indeed exactly
    // our same strategy.
    if (found_strategy !== desired_strategy) {
      sess.dcx().emit_err(
        diagnostics.BadPanicStrategy_diagnostic({
          runtime: tcx.crate_name(runtime_cnum),
          strategy: desired_strategy,
        }),
      );
    }

    // Next up, verify that all other crates are compatible with this panic
    // strategy. If the dep isn't linked, we ignore it, and if our strategy
    // is abort then it's compatible with everything. Otherwise all crates'
    // panic strategy must match our own.
    for (const cnum of list) {
      if (cnum === runtime_cnum || tcx.is_compiler_builtins(cnum)) {
        continue;
      }

      const found_strategy = tcx.required_panic_strategy(cnum);
      if (found_strategy !== undefined && desired_strategy !== found_strategy) {
        sess.dcx().emit_err(
          diagnostics.RequiredPanicStrategy_diagnostic({
            crate_name: tcx.crate_name(cnum),
            found_strategy,
            desired_strategy,
          }),
        );
      }

      // panic_in_drop_strategy isn't allowed for LOCAL_CRATE
      if (cnum !== LOCAL_CRATE) {
        const found_drop_strategy = tcx.panic_in_drop_strategy(cnum);
        if (tcx.sess.opts.unstable_opts.panic_in_drop !== found_drop_strategy) {
          sess.dcx().emit_err(
            diagnostics.IncompatiblePanicInDropStrategy_diagnostic({
              crate_name: tcx.crate_name(cnum),
              found_strategy: found_drop_strategy,
              desired_strategy: tcx.sess.opts.unstable_opts.panic_in_drop,
            }),
          );
        }
      }
    }
  }
}

// Port of src/tools/clippy/clippy_utils/src/msrvs.rs (crate `clippy_utils`, plan-m8 D4; lane clippy-contract-b2, wave 41).
//
// PORT: `msrv_aliases! { .. }` is generated (msrvs.gen.ts, tools/codegen/clippy.ts, plan-m8 D5) and re-exported here, so
// `msrvs::LET_CHAINS` is `msrvs.LET_CHAINS` for an `import * as msrvs from ".../msrvs.ts"`.
// PORT: `#[derive(Copy, Clone, Debug, Default)] struct Msrv(Option<RustcVersion>)` is an immutable class (`Copy`: a copy
// shares the object, nothing writes it); `MsrvStack`'s `stack` is a `RustcVersion[]` (`SmallVec<[_; 2]>`). The derived
// `PartialOrd` `msrv >= required` is `RustcVersion_cmp(msrv, required) >= 0` (rustc_ast/attr/version.ts). `Clone` of
// `MsrvStack` is a derive (PORTING §5 "Other derives"): not hand-written here.
import type { Attribute as AstAttribute } from "../rustc_ast/lib.ts";
import { type AttributeExt, AttributeExt as AstAttributeExt } from "../rustc_ast/attr/mod.ts";
import { AttributeExt as HirAttributeExt } from "../rustc_attr_ir/attr.ts";
import { RustcVersion, RustcVersion_cmp, debug_RustcVersion } from "../rustc_ast/attr/version.ts";
import type { ConstStability, Stability, StabilityLevel } from "../rustc_attr_ir/stability.gen.ts";
import { parse_version } from "../rustc_attr_parsing/attributes/util.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import type { Constness } from "../rustc_hir/hir.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { LateContext } from "../rustc_lint/context.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Session } from "../rustc_session/session.ts";
import { type Debug, debug_option, debug_struct, debug_tuple, debug_vec } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { sym } from "./sym.ts";

export * from "./msrvs.gen.ts";

// PORT: `crate::is_in_const_context` (clippy_utils/src/lib.rs) belongs to lane clippy-utils-e, which has not landed:
// `src/clippy_utils/lib.ts` does not exist yet. When it does, replace this stub with
// `import { is_in_const_context } from "./lib.ts";` (handoff clippy-contract-b2).
function is_in_const_context(_cx: LateContext): boolean {
  return unported("clippy_utils::is_in_const_context (clippy_utils/src/lib.rs, lane clippy-utils-e)");
}

// macro_rules! msrv_aliases { .. }   (expanded in msrvs.gen.ts)

// names may refer to stabilized feature flags or library items
// msrv_aliases! { .. }   (msrvs.gen.ts)

/// `#[clippy::msrv]` attributes are rarely used outside of Clippy's test suite, as a basic
/// optimization we can skip traversing the HIR in [`Msrv::meets`] if we never saw an MSRV attribute
/// during the early lint passes
// PORT: `static SEEN_MSRV_ATTR: AtomicBool` is a module-level `let` (PORTING §5 "Global state"); `Ordering::Relaxed`
// loads and stores are plain reads and writes.
let SEEN_MSRV_ATTR = false;

/** PORT: test-only reset of `SEEN_MSRV_ATTR` (a process-wide static upstream; unit tests share one process). */
export function reset_seen_msrv_attr_for_tests(): void {
  SEEN_MSRV_ATTR = false;
}

/// Tracks the current MSRV from `clippy.toml`, `Cargo.toml` or set via `#[clippy::msrv]` in late
/// lint passes, use [`MsrvStack`] for early passes
// #[derive(Copy, Clone, Debug, Default)]
export class Msrv {
  constructor(public readonly _0: RustcVersion | undefined) {}

  /** `#[derive(Default)]`: `Msrv(None)`. */
  static default(): Msrv {
    return new Msrv(undefined);
  }

  // impl From<Option<RustcVersion>> for Msrv
  // #[inline]
  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:113 from
  static from(value: RustcVersion | undefined): Msrv {
    return new Msrv(value);
  }

  /// Returns the MSRV at the current node
  ///
  /// If the crate being linted uses an `#[clippy::msrv]` attribute this will search the parent
  /// nodes for that attribute, prefer to run this check after cheaper pattern matching operations
  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:123 current
  current(cx: LateContext): RustcVersion | undefined {
    if (SEEN_MSRV_ATTR) {
      return this.for_attrs(cx.tcx, cx.last_node_with_lint_attrs);
    } else {
      return this._0;
    }
  }

  /// Returns the MSRV at the specified node
  ///
  /// If the crate being linted uses an `#[clippy::msrv]` attribute this will search the parent
  /// nodes for that attribute, prefer to run this check after cheaper pattern matching operations
  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:135 at
  at(tcx: TyCtxt, node: HirId): RustcVersion | undefined {
    if (SEEN_MSRV_ATTR) {
      return this.for_attrs(tcx, node);
    } else {
      return this._0;
    }
  }

  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:143 for_attrs
  private for_attrs(tcx: TyCtxt, node: HirId): RustcVersion | undefined {
    // once(node).chain(tcx.hir_parent_id_iter(node)).find_map(|id| parse_attrs(tcx.hir_attrs(id))).or(self.0)
    const parents = tcx.hir_parent_id_iter(node);
    const found = parse_attrs(HirAttributeExt.Attribute, tcx.hir_attrs(node));
    if (found !== undefined) {
      return found;
    }
    for (const id of parents) {
      const v = parse_attrs(HirAttributeExt.Attribute, tcx.hir_attrs(id));
      if (v !== undefined) {
        return v;
      }
    }
    return this._0;
  }

  /// Checks if a required version from [this module](self) is met at the current node
  ///
  /// If the crate being linted uses an `#[clippy::msrv]` attribute this will search the parent
  /// nodes for that attribute, prefer to run this check after cheaper pattern matching operations
  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:154 meets
  meets(cx: LateContext, required: RustcVersion): boolean {
    const msrv = this.current(cx);
    return msrv === undefined || RustcVersion_cmp(msrv, required) >= 0;
  }
  /// Checks if a required version from [this module](self) is met at the specified node
  ///
  /// If the crate being linted uses an `#[clippy::msrv]` attribute this will search the parent
  /// nodes for that attribute, prefer to run this check after cheaper pattern matching operations
  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:161 meets_at
  meets_at(tcx: TyCtxt, node: HirId, required: RustcVersion): boolean {
    const msrv = this.at(tcx, node);
    return msrv === undefined || RustcVersion_cmp(msrv, required) >= 0;
  }

  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:165 is_stable
  is_stable(cx: LateContext, def_id: DefId): boolean {
    // PORT: the generated query table types `lookup_stability`'s value as `unknown`; it is `Option<Stability>`.
    const stability = cx.tcx.lookup_stability(def_id) as Stability | undefined;
    return this.stability_met(cx, stability === undefined ? undefined : stability.level);
  }

  /// Checks whether `def_id` is `const` and const-stable since a version met by the MSRV.
  ///
  /// `def_id` must identify a function-like definition or an impl.
  ///
  /// Nothing in the crate being linted carries a const-stability attribute, so `const` fns and
  /// impls defined there are treated as meeting any MSRV, mirroring
  /// [`is_stable`](Self::is_stable).
  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:176 is_const_stable
  is_const_stable(cx: LateContext, def_id: DefId): boolean {
    let constness: Constness;
    const def_kind = cx.tcx.def_kind(def_id);
    if (def_kind.$ === "Impl" && def_kind.of_trait === true) {
      // The constness of a trait impl is not encoded in crate metadata, where `constness`
      // would decode as its default of `Const`. It is only available from the impl header.
      constness = cx.tcx.impl_trait_header(def_id).constness;
    } else {
      constness = cx.tcx.constness(def_id);
    }

    if (!(constness.$ === "Const")) {
      return false;
    }
    // PORT: as above, `Option<ConstStability>`.
    const stability = cx.tcx.lookup_const_stability(def_id) as ConstStability | undefined;
    return this.stability_met(cx, stability === undefined ? undefined : stability.level);
  }

  /// Checks the stability relevant to where we are: const-stability inside a `const` context,
  /// regular stability everywhere else.
  ///
  /// Like [`is_in_const_context`], this requires the `LateContext` to have an enclosing body.
  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:195 is_stable_or_const_stable
  is_stable_or_const_stable(cx: LateContext, def_id: DefId): boolean {
    if (is_in_const_context(cx)) {
      return this.is_const_stable(cx, def_id);
    } else {
      return this.is_stable(cx, def_id);
    }
  }

  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:203 stability_met
  private stability_met(cx: LateContext, level: StabilityLevel | undefined): boolean {
    // level.is_none_or(|level| { .. })
    if (level === undefined) {
      return true;
    }
    if (level.$ === "Stable") {
      const since = level.since;
      let version: RustcVersion;
      switch (since.$) {
        case "Version":
          version = since._0;
          break;
        case "Current":
          version = RustcVersion.CURRENT;
          break;
        case "Err":
          return false;
      }

      return this.meets(cx, version);
    } else {
      // Unstable fn.
      // FIXME: can we check that the feature is enabled?
      // Please see https://github.com/rust-lang/rust-clippy/pull/17309#discussion_r3486693263 for false-positive concerns.
      return false;
    }
  }
}

/** `#[derive(Debug)]` for `Msrv`. */
export const debug_Msrv: Debug<Msrv> = (v, f) => debug_tuple(f, "Msrv", [debug_option(v._0, f, debug_RustcVersion)]);

/// Tracks the current MSRV from `clippy.toml`, `Cargo.toml` or set via `#[clippy::msrv]` in early
/// lint passes, use [`Msrv`] for late passes
// #[derive(Debug, Clone)]
export class MsrvStack {
  constructor(public stack: RustcVersion[]) {}

  // impl From<Option<RustcVersion>> for MsrvStack
  // #[inline]
  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:232 from
  static from(value: RustcVersion | undefined): MsrvStack {
    // SmallVec::from_iter(value)
    return new MsrvStack(value === undefined ? [] : [value]);
  }

  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:240 current
  current(): RustcVersion | undefined {
    return this.stack[this.stack.length - 1];
  }

  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:244 meets
  meets(required: RustcVersion): boolean {
    const msrv = this.current();
    return msrv === undefined || RustcVersion_cmp(msrv, required) >= 0;
  }

  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:248 check_attributes
  check_attributes(attrs: readonly AstAttribute[]): void {
    const version = parse_attrs(AstAttributeExt.Attribute, attrs);
    if (version !== undefined) {
      SEEN_MSRV_ATTR = true;
      this.stack.push(version);
    }
  }

  // rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:255 check_attributes_post
  check_attributes_post(attrs: readonly AstAttribute[]): void {
    if (parse_attrs(AstAttributeExt.Attribute, attrs) !== undefined) {
      this.stack.pop();
    }
  }
}

/** `#[derive(Debug)]` for `MsrvStack`. */
export const debug_MsrvStack: Debug<MsrvStack> = (v, f) =>
  debug_struct(f, "MsrvStack", [["stack", debug_vec(v.stack, f, debug_RustcVersion)]]);

// PORT: `impl AttributeExt` arguments take the implementing type's `AttributeExt` table first (`ast::Attribute`'s from
// rustc_ast, `hir::Attribute`'s from rustc_attr_ir), as generic trait bounds are passed in this port (PORTING §5).
// rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:262 parse_attrs
function parse_attrs<A>(ext: AttributeExt<A>, attrs: readonly A[]): RustcVersion | undefined {
  const msrv_attr = attrs.find((attr) => ext.path_matches(attr, [sym.clippy, sym.msrv]));
  if (msrv_attr === undefined) return undefined;

  const msrv = ext.value_str(msrv_attr);
  if (msrv === undefined) return undefined;

  return parse_version(msrv);
}

/** PORT: test hook for `parse_attrs` (private upstream). */
export const parse_attrs_for_tests = parse_attrs;

// rustc: src/tools/clippy/clippy_utils/src/msrvs.rs:270 check_attrs
export function check_attrs<A>(sess: Session, ext: AttributeExt<A>, attrs: readonly A[]): void {
  const msrv_attrs = attrs.filter((attr) => ext.path_matches(attr, [sym.clippy, sym.msrv]));

  // let Some(msrv_attr) = msrv_attrs.next() else { return; };
  if (msrv_attrs.length === 0) {
    return;
  }
  const msrv_attr = msrv_attrs[0]!;

  // msrv_attrs.next_back(): the last of the rest, if any
  if (msrv_attrs.length > 1) {
    const duplicate = msrv_attrs[msrv_attrs.length - 1]!;
    sess
      .dcx()
      .struct_span_err(ext.span(duplicate), "`clippy::msrv` is defined multiple times")
      .with_span_note(ext.span(msrv_attr), "first definition found here")
      .emit();
  }

  const msrv = ext.value_str(msrv_attr);
  if (msrv === undefined) {
    sess.dcx().span_err(ext.span(msrv_attr), "bad clippy attribute");
    return;
  }

  if (parse_version(msrv) === undefined) {
    sess.dcx().span_err(ext.span(msrv_attr), `\`${Symbol.as_str(msrv)}\` is not a valid Rust version`);
  }
}

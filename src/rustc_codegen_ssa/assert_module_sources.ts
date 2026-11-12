//! This pass is only used for UNIT TESTS related to incremental
//! compilation. It tests whether a particular `.o` file will be re-used
//! from a previous compilation or whether it must be regenerated.
//!
//! The user adds annotations to the crate of the following form:
//!
//! ```
//! # #![feature(rustc_attrs)]
//! # #![allow(internal_features)]
//! #![rustc_partition_reused(module="spike", cfg="rpass2")]
//! #![rustc_partition_codegened(module="spike-x", cfg="rpass2")]
//! ```
//!
//! The first indicates (in the cfg `rpass2`) that `spike.o` will be
//! reused, the second that `spike-x.o` will be recreated. If these
//! annotations are inaccurate, errors are reported.
//!
//! The reason that we use `cfg=...` and not `#[cfg_attr]` is so that
//! the HIR doesn't change as a result of the annotations, which might
//! perturb the reuse results.
//!
//! `#![rustc_expected_cgu_reuse(module="spike", cfg="rpass2", kind="post-lto")]`
//! allows for doing a more fine-grained check to see if pre- or post-lto data
//! was re-used.
// Port of compiler/rustc_codegen_ssa/src/assert_module_sources.rs (lane ssa-base, plan-m7 wave 41).
//
// PORT (ssa-base):
// - `-C incremental` is out of scope (plan-m7 D11), so `assert_module_sources` returns at its first check in every
//   supported run; the rest is ported as upstream and reached only with `-C incremental`, which stops earlier.
// - `UnordMap<String, _>` is a `Map<string, _>`; `into_sorted_stable_ord` on `String` keys sorts them by `str_cmp`
//   (byte order), and on `&str` names the same.
// - `debug!` is compiled out of rustc (STATIC_MAX_LEVEL = INFO, rust_ts/tracing.ts) and stays a comment.
// - `IncorrectCguReuseType` is not generated (diagnostics.ts header: its fields' types are not ported), so its
//   emission stops `unported`.
import type { CguFields } from "../rustc_attr_ir/data_structures.gen.ts";
import { type Attribute, find_attr } from "../rustc_attr_ir/lib.ts";
import type { DiagArgValue } from "../rustc_errors/lib.ts";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import { CRATE_HIR_ID } from "../rustc_hir_id/lib.ts";
import { CodegenUnitNameBuilder, type MonoItemPartitions } from "../rustc_middle/mono.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Session } from "../rustc_session/session.ts";
import { str_cmp } from "../rustc_session/options.ts";
import { LOCAL_CRATE } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { debug_str } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, assert_eq, unported, unwrap } from "../std/panic.ts";
import {
  CguNotRecorded_diagnostic,
  MalformedCguName_diagnostic,
  MissingQueryDepGraph_diagnostic,
  NoModuleNamed_diagnostic,
} from "./diagnostics.ts";

// #[allow(missing_docs)]
// rustc: compiler/rustc_codegen_ssa/src/assert_module_sources.rs:42 assert_module_sources
export function assert_module_sources(tcx: TyCtxt, set_reuse: (cgu_reuse_tracker: CguReuseTracker) => void): void {
  tcx.dep_graph.with_ignore(() => {
    if (tcx.sess.opts.incremental === undefined) {
      return;
    }

    const available_cgus = new Set<Symbol>(
      (tcx.collect_and_partition_mono_items(null) as MonoItemPartitions).codegen_units.map((cgu) => cgu.name()),
    );

    const ams = new AssertModuleSource(
      /* tcx */ tcx,
      /* available_cgus */ available_cgus,
      /* cgu_reuse_tracker */ tcx.sess.opts.unstable_opts.query_dep_graph ? CguReuseTracker.new() : CguReuseTracker.new_disabled(),
    );

    ams.check_attrs(tcx.hir_attrs(CRATE_HIR_ID));

    set_reuse(ams.cgu_reuse_tracker);

    let data: TrackerData | undefined;
    if (tcx.sess.opts.unstable_opts.print_mono_items && (data = ams.cgu_reuse_tracker.data) !== undefined) {
      // data.actual_reuse.items().all(|(cgu, reuse)| {
      //     println!("CGU_REUSE {cgu} {reuse}");
      //     true
      // });
      // PORT: `UnordMap::items()` visits the entries in the `FxHashMap`'s iteration order, which is printed and which the
      // port's insertion-ordered `Map` does not reproduce (review ssa-base N1). Only reachable with `-C incremental`
      // (plan-m7 D11).
      if (data.actual_reuse.size !== 0) {
        unported("rustc_codegen_ssa::assert_module_sources: CGU_REUSE in UnordMap (FxHashMap) iteration order (-C incremental)");
      }
    }

    ams.cgu_reuse_tracker.check_expected_reuse(tcx.sess);
  });
}

class AssertModuleSource {
  constructor(
    public tcx: TyCtxt,
    public available_cgus: Set<Symbol>,
    public cgu_reuse_tracker: CguReuseTracker,
  ) {}

  // rustc: compiler/rustc_codegen_ssa/src/assert_module_sources.rs:89 check_attrs
  check_attrs(attrs: readonly Attribute[]): void {
    const found = find_attr(attrs, (k) => (k.$ === "RustcCguTestAttr" ? k._0 : undefined));
    for (const [span, cgu_fields] of found ?? []) {
      let expected_reuse: CguReuse;
      let comp_kind: ComparisonKind;
      switch (cgu_fields.$) {
        case "PartitionReused":
          [expected_reuse, comp_kind] = ["PreLto", "AtLeast"];
          break;
        case "PartitionCodegened":
          [expected_reuse, comp_kind] = ["No", "Exact"];
          break;
        case "ExpectedCguReuse":
          switch (cgu_fields.kind) {
            case "No":
              [expected_reuse, comp_kind] = ["No", "Exact"];
              break;
            case "PreDashLto":
              [expected_reuse, comp_kind] = ["PreLto", "Exact"];
              break;
            case "PostDashLto":
              [expected_reuse, comp_kind] = ["PostLto", "Exact"];
              break;
            case "Any":
              [expected_reuse, comp_kind] = ["PreLto", "AtLeast"];
              break;
          }
          break;
      }
      const { cfg, module } = cgu_fields satisfies CguFields;

      if (!this.tcx.sess.opts.unstable_opts.query_dep_graph) {
        this.tcx.dcx().emit_fatal(MissingQueryDepGraph_diagnostic({ span }));
      }

      if (!this.check_config(cfg)) {
        // debug!("check_attr: config does not match, ignoring attr");
        return;
      }

      const user_path_full = Symbol.as_str(module);
      const crate_name = Symbol.as_str(this.tcx.crate_name(LOCAL_CRATE));

      if (!user_path_full.startsWith(crate_name)) {
        this.tcx.dcx().emit_fatal(
          MalformedCguName_diagnostic({
            span,
            user_path: user_path_full,
            crate_name,
          }),
        );
      }

      // Split of the "special suffix" if there is one.
      let user_path: string;
      let cgu_special_suffix: string | undefined;
      const index = user_path_full.lastIndexOf(".");
      if (index !== -1) {
        [user_path, cgu_special_suffix] = [user_path_full.slice(0, index), user_path_full.slice(index + 1)];
      } else {
        [user_path, cgu_special_suffix] = [user_path_full, undefined];
      }

      const iter = user_path.split("-");

      // Remove the crate name
      assert_eq(unwrap(iter.shift()), crate_name, debug_str);

      const cgu_path_components = iter;

      const cgu_name_builder = CodegenUnitNameBuilder.new(this.tcx);
      const cgu_name = cgu_name_builder.build_cgu_name(LOCAL_CRATE, cgu_path_components, cgu_special_suffix);

      // debug!("mapping '{user_path}' to cgu name '{cgu_name}'");

      if (!this.available_cgus.has(cgu_name)) {
        const cgu_names: string[] = [...this.available_cgus].map((cgu) => Symbol.as_str(cgu)).sort(str_cmp);
        this.tcx.dcx().emit_err(
          NoModuleNamed_diagnostic({
            span,
            user_path,
            cgu_name,
            cgu_names: cgu_names.join(", "),
          }),
        );
      }

      this.cgu_reuse_tracker.set_expectation(cgu_name, user_path, span, expected_reuse, comp_kind);
    }
  }

  /// Scan for a `cfg="foo"` attribute and check whether we have a
  /// cfg flag called `foo`.
  // rustc: compiler/rustc_codegen_ssa/src/assert_module_sources.rs:175 check_config
  check_config(value: Symbol): boolean {
    const config = this.tcx.sess.config;
    // debug!("check_config(config={:?}, value={:?})", config, value);
    if (config.iter().some(([name, _]) => name === value)) {
      // debug!("check_config: matched");
      return true;
    }
    // debug!("check_config: no match found");
    return false;
  }
}

// #[derive(Copy, Clone, Debug, PartialEq, PartialOrd)]
export type CguReuse = "No" | "PreLto" | "PostLto";
export const CguReuse = {
  No: "No",
  PreLto: "PreLto",
  PostLto: "PostLto",

  // impl fmt::Display for CguReuse
  // rustc: compiler/rustc_codegen_ssa/src/assert_module_sources.rs:195 fmt
  fmt(self: CguReuse): string {
    switch (self) {
      case "No":
        return "No";
      case "PreLto":
        return "PreLto";
      case "PostLto":
        return "PostLto";
    }
  },

  // impl IntoDiagArg for CguReuse
  // rustc: compiler/rustc_codegen_ssa/src/assert_module_sources.rs:205 into_diag_arg
  into_diag_arg(self: CguReuse, _: MutRef<PathBuf | undefined>): DiagArgValue {
    return { $: "Str", _0: CguReuse.fmt(self) };
  },
} as const;
/** `#[derive(PartialOrd)]`: the variants' declaration order. */
export const CguReuse_discriminant: Record<CguReuse, number> = { No: 0, PreLto: 1, PostLto: 2 };

// #[derive(Copy, Clone, Debug, PartialEq)]
export type ComparisonKind = "Exact" | "AtLeast";
export const ComparisonKind = { Exact: "Exact", AtLeast: "AtLeast" } as const;

interface TrackerData {
  actual_reuse: Map<string, CguReuse>;
  expected_reuse: Map<string, [string, Span, CguReuse, ComparisonKind]>;
}

export class CguReuseTracker {
  constructor(public data: TrackerData | undefined) {}

  // rustc: compiler/rustc_codegen_ssa/src/assert_module_sources.rs:226 new
  static new(): CguReuseTracker {
    const data: TrackerData = { actual_reuse: new Map(), expected_reuse: new Map() };

    return new CguReuseTracker(data);
  }

  // rustc: compiler/rustc_codegen_ssa/src/assert_module_sources.rs:233 new_disabled
  static new_disabled(): CguReuseTracker {
    return new CguReuseTracker(undefined);
  }

  // rustc: compiler/rustc_codegen_ssa/src/assert_module_sources.rs:237 set_actual_reuse
  set_actual_reuse(cgu_name: string, kind: CguReuse): void {
    const data = this.data;
    if (data !== undefined) {
      // debug!("set_actual_reuse({cgu_name:?}, {kind:?})");

      const prev_reuse = data.actual_reuse.get(cgu_name);
      data.actual_reuse.set(cgu_name, kind);
      assert(prev_reuse === undefined, "assertion failed: prev_reuse.is_none()");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/assert_module_sources.rs:246 set_expectation
  set_expectation(
    cgu_name: Symbol,
    cgu_user_name: string,
    error_span: Span,
    expected_reuse: CguReuse,
    comparison_kind: ComparisonKind,
  ): void {
    const data = this.data;
    if (data !== undefined) {
      // debug!("set_expectation({cgu_name:?}, {expected_reuse:?}, {comparison_kind:?})");

      data.expected_reuse.set(Symbol.as_str(cgu_name), [cgu_user_name, error_span, expected_reuse, comparison_kind]);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/assert_module_sources.rs:264 check_expected_reuse
  check_expected_reuse(sess: Session): void {
    const data = this.data;
    if (data !== undefined) {
      const keys = [...data.expected_reuse.keys()].sort(str_cmp);
      for (const cgu_name of keys) {
        const [cgu_user_name, error_span, expected_reuse, comparison_kind] = unwrap(data.expected_reuse.get(cgu_name));

        const actual_reuse = data.actual_reuse.get(cgu_name);
        if (actual_reuse !== undefined) {
          let error: boolean;
          let at_least_: boolean;
          switch (comparison_kind) {
            case "Exact":
              [error, at_least_] = [expected_reuse !== actual_reuse, false];
              break;
            case "AtLeast":
              [error, at_least_] = [CguReuse_discriminant[actual_reuse] < CguReuse_discriminant[expected_reuse], true];
              break;
          }

          if (error) {
            const at_least = at_least_ ? 1 : 0;
            // sess.dcx().emit_err(diagnostics::IncorrectCguReuseType {
            //     span: *error_span, cgu_user_name, actual_reuse, expected_reuse, at_least });
            void [error_span, at_least];
            unported("rustc_codegen_ssa::diagnostics::IncorrectCguReuseType (not generated; -C incremental)");
          }
        } else {
          sess.dcx().emit_fatal(CguNotRecorded_diagnostic({ cgu_user_name, cgu_name }));
        }
      }
    }
  }
}

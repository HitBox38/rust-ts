// Port of compiler/rustc_attr_parsing/src/synthetic.rs
import type { SyntheticAttr } from "../rustc_ast/lib.ts";
import { CfgEntry, clone_CfgEntry } from "../rustc_ast/attr/data_structures.ts";
import type { Attribute } from "../rustc_attr_ir/lib.ts";
import type { Span } from "../rustc_span/lib.ts";

/// Contains the state necessary to convert synthetic attributes to parsed attributes.
///
/// The only conversion that really happens here is that multiple synthetic attributes are
/// merged into a single `rustc_attr_ir::attribute`, representing their combined state.
/// FIXME: We should make this a nice and extendable system if this is going to be used more often
/** `#[derive(Default)] pub(crate) struct SyntheticAttrState` */
export class SyntheticAttrState {
  constructor(
    /// Attribute state for `SyntheticAttr::CfgTrace` attributes.
    public cfg_trace: [CfgEntry, Span][],

    /// Attribute state for `SyntheticAttr::CfgAttrTrace` attributes.
    public cfg_attr_trace: [CfgEntry, Span][],
  ) {}

  /** `#[derive(Default)]` */
  static default(): SyntheticAttrState {
    return new SyntheticAttrState([], []);
  }

  // rustc: compiler/rustc_attr_parsing/src/synthetic.rs:22 accept_synthetic_attr
  accept_synthetic_attr(attr_span: Span, lower_span: (span: Span) => Span, synthetic: SyntheticAttr): void {
    switch (synthetic.$) {
      case "CfgTrace": {
        const cfg = clone_CfgEntry(synthetic._0);
        CfgEntry.lower_spans(cfg, lower_span);
        this.cfg_trace.push([cfg, attr_span]);
        break;
      }
      case "CfgAttrTrace": {
        const cfg = clone_CfgEntry(synthetic._0);
        CfgEntry.lower_spans(cfg, lower_span);
        this.cfg_attr_trace.push([cfg, attr_span]);
        break;
      }
    }
  }

  // rustc: compiler/rustc_attr_parsing/src/synthetic.rs:42 finalize_synthetic_attrs
  finalize_synthetic_attrs(attributes: Attribute[]): void {
    if (this.cfg_trace.length !== 0) {
      attributes.push({ $: "Parsed", _0: { $: "CfgTrace", _0: this.cfg_trace } });
    }
    if (this.cfg_attr_trace.length !== 0) {
      attributes.push({ $: "Parsed", _0: { $: "CfgAttrTrace", _0: this.cfg_attr_trace } });
    }
  }
}

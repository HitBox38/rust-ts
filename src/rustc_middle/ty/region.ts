// Port of compiler/rustc_middle/src/ty/region.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into region.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { Symbol } from "../../rustc_span/symbol.ts";
import type { Debug } from "../../std/fmt.ts";
import type { EarlyParamRegion } from "./region.gen.ts";

export * from "./region.gen.ts";

// impl std::fmt::Debug for EarlyParamRegion (lane tydump-subject)
// rustc: compiler/rustc_middle/src/ty/region.rs:57 fmt
export const debug_EarlyParamRegion: Debug<EarlyParamRegion> = (self, _f) => {
  // write!(f, "{}/#{}", self.name, self.index)
  return `${Symbol.as_str(self.name)}/#${self.index}`;
};

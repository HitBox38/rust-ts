// rust-ts helper (no upstream counterpart), used by the rustc_traits port.
//
// PORT: `ParamEnvAnd<T>`'s derived `TypeFoldable` / `TypeVisitable` (rustc_middle ty/mod.rs `#[derive(TypeFoldable,
// TypeVisitable)] struct ParamEnvAnd`) as a D4 descriptor over `d_T`. rustc_middle has no generated impl yet; this is the
// derive's shape (fields in declaration order: `param_env`, `value`). Root: move it next to `ParamEnvAnd` when
// rustc_middle ty/mod.rs gets codegen'd derives.

import { try_visit } from "../rustc_ast_ir/visit.ts";
import { fold_with_ParamEnv, type ParamEnvAnd, try_fold_with_ParamEnv, visit_with_ParamEnv } from "../rustc_middle/ty/mod.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { Ok } from "../std/result.ts";

export function fold_ParamEnvAnd<T>(d_T: TypeFoldable<T>): TypeFoldable<ParamEnvAnd<T>> {
  return {
    visit_with(self, visitor) {
      let r;
      if ((r = try_visit(visitor.Result, visit_with_ParamEnv(self.param_env, visitor))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, d_T.visit_with(self.value, visitor))) !== undefined) return r;
      return visitor.Result.output();
    },
    try_fold_with(self, folder) {
      const param_env = try_fold_with_ParamEnv(self.param_env, folder);
      if (param_env.$ === "Err") return param_env;
      const value = d_T.try_fold_with(self.value, folder);
      if (value.$ === "Err") return value;
      return Ok({ param_env: param_env._0, value: value._0 });
    },
    fold_with(self, folder) {
      return { param_env: fold_with_ParamEnv(self.param_env, folder), value: d_T.fold_with(self.value, folder) };
    },
  };
}

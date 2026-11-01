// Port of src/tools/miri/src/concurrency/data_race_handler.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-race` (wave 36).
// Its types are generated into data_race_handler.gen.ts (tools/codegen set `miri`); this module re-exports them and puts
// the inherent methods of the two enums on their companions (PORTING §8), plus the `VisitProvenance` impl tables.
// PORT: `Genmc(Rc<GenmcCtx>)` / `Vclocks(Box<GlobalState>)` hold the value itself (PORTING §5). The component is built
// without GenMC (decision C7: `GenmcCtx` is concurrency/genmc/dummy.rs, which nothing can construct); GenMC arms stop
// `unported("genmc")` (lane brief).
import { type GlobalState, type VClockAlloc } from "./data_race.ts";
import { type GenmcCtx } from "./genmc/dummy.ts";
import { type AllocState as weak_memory_AllocState } from "./weak_memory.ts";
import * as gen from "./data_race_handler.gen.ts";
import { type VisitWith } from "../provenance_gc.ts";
import { unported } from "../../std/panic.ts";
export * from "./data_race_handler.gen.ts";

/** PORT: the methods of `impl GlobalDataRaceHandler` on the generated companion (PORTING §8). */
export interface GlobalDataRaceHandler_methods {
  is_none(self: GlobalDataRaceHandler): boolean;
  as_vclocks_ref(self: GlobalDataRaceHandler): GlobalState | undefined;
  as_vclocks_mut(self: GlobalDataRaceHandler): GlobalState | undefined;
  as_genmc_ref(self: GlobalDataRaceHandler): GenmcCtx | undefined;
}
export type GlobalDataRaceHandler = gen.GlobalDataRaceHandler;
export const GlobalDataRaceHandler = gen.GlobalDataRaceHandler as typeof gen.GlobalDataRaceHandler & GlobalDataRaceHandler_methods;

/** PORT: the methods of `impl AllocDataRaceHandler` on the generated companion (PORTING §8). */
export interface AllocDataRaceHandler_methods {
  as_vclocks_ref(self: AllocDataRaceHandler): VClockAlloc | undefined;
  as_vclocks_mut(self: AllocDataRaceHandler): VClockAlloc | undefined;
  as_weak_memory_ref(self: AllocDataRaceHandler): weak_memory_AllocState | undefined;
  as_weak_memory_mut(self: AllocDataRaceHandler): weak_memory_AllocState | undefined;
}
export type AllocDataRaceHandler = gen.AllocDataRaceHandler;
export const AllocDataRaceHandler = gen.AllocDataRaceHandler as typeof gen.AllocDataRaceHandler & AllocDataRaceHandler_methods;

// impl GlobalDataRaceHandler

// rustc: src/tools/miri/src/concurrency/data_race_handler.rs:35 is_none
GlobalDataRaceHandler.is_none = function (self: GlobalDataRaceHandler): boolean {
  return self.$ === "None";
};

// rustc: src/tools/miri/src/concurrency/data_race_handler.rs:39 as_vclocks_ref
GlobalDataRaceHandler.as_vclocks_ref = function (self: GlobalDataRaceHandler): GlobalState | undefined {
  return self.$ === "Vclocks" ? self._0 : undefined;
};

// rustc: src/tools/miri/src/concurrency/data_race_handler.rs:43 as_vclocks_mut
GlobalDataRaceHandler.as_vclocks_mut = function (self: GlobalDataRaceHandler): GlobalState | undefined {
  return self.$ === "Vclocks" ? self._0 : undefined;
};

// rustc: src/tools/miri/src/concurrency/data_race_handler.rs:47 as_genmc_ref
GlobalDataRaceHandler.as_genmc_ref = function (self: GlobalDataRaceHandler): GenmcCtx | undefined {
  return self.$ === "Genmc" ? self._0 : undefined;
};

// impl AllocDataRaceHandler

// rustc: src/tools/miri/src/concurrency/data_race_handler.rs:53 as_vclocks_ref
AllocDataRaceHandler.as_vclocks_ref = function (self: AllocDataRaceHandler): VClockAlloc | undefined {
  return self.$ === "Vclocks" ? self._0 : undefined;
};

// rustc: src/tools/miri/src/concurrency/data_race_handler.rs:57 as_vclocks_mut
AllocDataRaceHandler.as_vclocks_mut = function (self: AllocDataRaceHandler): VClockAlloc | undefined {
  return self.$ === "Vclocks" ? self._0 : undefined;
};

// rustc: src/tools/miri/src/concurrency/data_race_handler.rs:61 as_weak_memory_ref
AllocDataRaceHandler.as_weak_memory_ref = function (self: AllocDataRaceHandler): weak_memory_AllocState | undefined {
  return self.$ === "Vclocks" ? self._1 : undefined;
};

// rustc: src/tools/miri/src/concurrency/data_race_handler.rs:65 as_weak_memory_mut
AllocDataRaceHandler.as_weak_memory_mut = function (self: AllocDataRaceHandler): weak_memory_AllocState | undefined {
  return self.$ === "Vclocks" ? self._1 : undefined;
};

/** `impl VisitProvenance for GlobalDataRaceHandler` (provenance_gc.ts: impl tables for values that are not objects). */
export const VisitProvenance_GlobalDataRaceHandler = {
  // rustc: src/tools/miri/src/concurrency/data_race_handler.rs:71 visit_provenance
  visit_provenance(self: GlobalDataRaceHandler, visit: VisitWith): void {
    switch (self.$) {
      case "None":
        break;
      case "Vclocks":
        self._0.visit_provenance(visit);
        break;
      case "Genmc":
        // genmc_ctx.visit_provenance(visit)
        unported("genmc");
    }
  },
};

/** `impl VisitProvenance for AllocDataRaceHandler`. */
export const VisitProvenance_AllocDataRaceHandler = {
  // rustc: src/tools/miri/src/concurrency/data_race_handler.rs:81 visit_provenance
  visit_provenance(self: AllocDataRaceHandler, visit: VisitWith): void {
    switch (self.$) {
      case "None":
        break;
      case "Genmc":
        break;
      case "Vclocks": {
        self._0.visit_provenance(visit);
        // `weak_memory.visit_provenance(visit)`: `impl<T: VisitProvenance> VisitProvenance for Option<T>` visits `Some`.
        // PORT(contract): pending miri-sb: `StoreBufferAlloc::visit_provenance` (weak_memory.rs:121) is in weak_memory.ts's
        // inventory, not declared; the call goes through the `VisitProvenance` method shape (provenance_gc.ts).
        const weak_memory = self._1 as (weak_memory_AllocState & { visit_provenance(visit: VisitWith): void }) | undefined;
        if (weak_memory !== undefined) weak_memory.visit_provenance(visit);
        break;
      }
    }
  },
};

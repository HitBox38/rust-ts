// Oracle tests of lane instance-vtable: `#[rustc_dump_vtable]` (rustc_hir_analysis collect/dump.rs) over the
// `vtable_entries` provider (traits/vtable.rs), `Instance::expect_resolve_for_vtable` / `resolve_instance_raw`
// (rustc_middle ty/instance.rs, rustc_ty_utils instance.rs) and `VtblEntry`'s Debug / `Instance`'s Display, through
// type checking. See src/rust_ts/typeck_oracle_fixtures.ts for the setup (fixtures from the tydump probe, `REGEN=1`
// rewrites them).
import { join } from "node:path";
import { typeck_oracle_fixture_tests } from "../../rust_ts/typeck_oracle_fixtures.ts";

typeck_oracle_fixture_tests("vtable_test", join(import.meta.dir, "vtable_test"), ["vtable_vacant_vptr", "vtable_dyn_alias"]);

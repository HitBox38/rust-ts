// Port of compiler/rustc_const_eval/src/const_eval/mod.rs (lane small-gaps-17: only the `mod` / `pub use` lines of
// fn_queries.rs; the rest of const_eval is M4/M6).

// mod dummy_machine;   (M4/M6)
// mod dyn_trait;       (M4/M6)
// mod error;           (M4/M6)
// mod eval_queries;    (M4/M6)
// mod fn_queries;
// mod machine;         (M4/M6)
// mod type_info;       (M4/M6)
// mod valtrees;        (M4/M6)

// pub use self::fn_queries::*;
export * from "./fn_queries.ts";

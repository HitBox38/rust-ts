//! Oracle probe for tools/codegen/target-config.ts (a rustc_private driver, built against the pinned
//! nightly's rustc-dev). It runs rustc's own driver on the given arguments, stops right after the crate
//! root is parsed (the session is fully configured by then) and prints what the LLVM backend's
//! `target_config` put into the session:
//!
//!   internal_target_features <comma-separated, sorted>
//!   cfg <name> | cfg <name>="<value>"     (every `sess.config` entry, sorted)
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_driver;
extern crate rustc_interface;

use rustc_driver::{Callbacks, Compilation};
use rustc_interface::interface::Compiler;

struct Probe;

impl Callbacks for Probe {
    fn after_crate_root_parsing(
        &mut self,
        compiler: &Compiler,
        _krate: &mut rustc_ast::Crate,
    ) -> Compilation {
        let sess = &compiler.sess;
        let mut features: Vec<String> =
            sess.internal_target_features.iter().map(|s| s.to_string()).collect();
        features.sort();
        println!("internal_target_features {}", features.join(","));
        let mut cfgs: Vec<String> = sess
            .config
            .iter()
            .map(|(n, v)| match v {
                Some(v) => format!("{n}=\"{v}\""),
                None => n.to_string(),
            })
            .collect();
        cfgs.sort();
        for c in cfgs {
            println!("cfg {c}");
        }
        Compilation::Stop
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    rustc_driver::compiler_entrypoint(&args, &mut Probe);
}

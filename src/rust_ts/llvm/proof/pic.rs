#![crate_type = "lib"]
// Module setup through the dedicated wrappers: LLVMRustSetModulePICLevel and LLVMRustSetModulePIELevel
// (-Crelocation-model=pie), LLVMRustSetModuleCodeModel (-Ccode-model=large) and LLVMRustSetModuleLargeDataThreshold
// (-Zlarge-data-threshold).
pub static PIE: [u32; 2] = [1, 2];
pub static REF: &[u32; 2] = &PIE;

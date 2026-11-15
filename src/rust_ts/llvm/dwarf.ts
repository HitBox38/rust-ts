// rust-ts: the DWARF and debug-info flag names the IR model's printer writes (lane llir-di). Not ported code.
//
// Data, not logic: the name tables below are `llvm/include/llvm/BinaryFormat/Dwarf.def` at the pinned LLVM (aab11ee0ea5e),
// extracted mechanically, one row per `HANDLE_DW_TAG` / `HANDLE_DW_OP` / `HANDLE_DW_ATE` / `HANDLE_DW_LANG` / `HANDLE_DW_CC`
// line, in file order (each table's comment gives the lines; no ID repeats, as the C++ `switch`es that use them require).
// They are what `dwarf::TagString`, `OperationEncodingString`, `AttributeEncodingString`, `LanguageString` and `ConventionString`
// (llvm/lib/BinaryFormat/Dwarf.cpp:21, :138, :263, :412, :643) return; an ID that is not listed returns the empty string, which the
// writer prints as a number. The flag tables are `llvm/include/llvm/IR/DebugInfoFlags.def`.
// PORT: Dwarf.def, Dwarf.cpp, Dwarf.h and DebugInfoFlags.def are not in harness/llvm-manifest.json yet (handoff llir-di lists
// them for root to pin), so this file cites them without `// llvm:` markers.

// TAG: 115 entries, Dwarf.def lines 168-304
export const DW_TAG_NAMES: ReadonlyMap<number, string> = new Map([
  [0x0000, "DW_TAG_null"],
  [0x0001, "DW_TAG_array_type"],
  [0x0002, "DW_TAG_class_type"],
  [0x0003, "DW_TAG_entry_point"],
  [0x0004, "DW_TAG_enumeration_type"],
  [0x0005, "DW_TAG_formal_parameter"],
  [0x0008, "DW_TAG_imported_declaration"],
  [0x000a, "DW_TAG_label"],
  [0x000b, "DW_TAG_lexical_block"],
  [0x000d, "DW_TAG_member"],
  [0x000f, "DW_TAG_pointer_type"],
  [0x0010, "DW_TAG_reference_type"],
  [0x0011, "DW_TAG_compile_unit"],
  [0x0012, "DW_TAG_string_type"],
  [0x0013, "DW_TAG_structure_type"],
  [0x0015, "DW_TAG_subroutine_type"],
  [0x0016, "DW_TAG_typedef"],
  [0x0017, "DW_TAG_union_type"],
  [0x0018, "DW_TAG_unspecified_parameters"],
  [0x0019, "DW_TAG_variant"],
  [0x001a, "DW_TAG_common_block"],
  [0x001b, "DW_TAG_common_inclusion"],
  [0x001c, "DW_TAG_inheritance"],
  [0x001d, "DW_TAG_inlined_subroutine"],
  [0x001e, "DW_TAG_module"],
  [0x001f, "DW_TAG_ptr_to_member_type"],
  [0x0020, "DW_TAG_set_type"],
  [0x0021, "DW_TAG_subrange_type"],
  [0x0022, "DW_TAG_with_stmt"],
  [0x0023, "DW_TAG_access_declaration"],
  [0x0024, "DW_TAG_base_type"],
  [0x0025, "DW_TAG_catch_block"],
  [0x0026, "DW_TAG_const_type"],
  [0x0027, "DW_TAG_constant"],
  [0x0028, "DW_TAG_enumerator"],
  [0x0029, "DW_TAG_file_type"],
  [0x002a, "DW_TAG_friend"],
  [0x002b, "DW_TAG_namelist"],
  [0x002c, "DW_TAG_namelist_item"],
  [0x002d, "DW_TAG_packed_type"],
  [0x002e, "DW_TAG_subprogram"],
  [0x002f, "DW_TAG_template_type_parameter"],
  [0x0030, "DW_TAG_template_value_parameter"],
  [0x0031, "DW_TAG_thrown_type"],
  [0x0032, "DW_TAG_try_block"],
  [0x0033, "DW_TAG_variant_part"],
  [0x0034, "DW_TAG_variable"],
  [0x0035, "DW_TAG_volatile_type"],
  [0x0036, "DW_TAG_dwarf_procedure"],
  [0x0037, "DW_TAG_restrict_type"],
  [0x0038, "DW_TAG_interface_type"],
  [0x0039, "DW_TAG_namespace"],
  [0x003a, "DW_TAG_imported_module"],
  [0x003b, "DW_TAG_unspecified_type"],
  [0x003c, "DW_TAG_partial_unit"],
  [0x003d, "DW_TAG_imported_unit"],
  [0x003f, "DW_TAG_condition"],
  [0x0040, "DW_TAG_shared_type"],
  [0x0041, "DW_TAG_type_unit"],
  [0x0042, "DW_TAG_rvalue_reference_type"],
  [0x0043, "DW_TAG_template_alias"],
  [0x0044, "DW_TAG_coarray_type"],
  [0x0045, "DW_TAG_generic_subrange"],
  [0x0046, "DW_TAG_dynamic_type"],
  [0x0047, "DW_TAG_atomic_type"],
  [0x0048, "DW_TAG_call_site"],
  [0x0049, "DW_TAG_call_site_parameter"],
  [0x004a, "DW_TAG_skeleton_unit"],
  [0x004b, "DW_TAG_immutable_type"],
  [0x4081, "DW_TAG_MIPS_loop"],
  [0x4101, "DW_TAG_format_label"],
  [0x4102, "DW_TAG_function_template"],
  [0x4103, "DW_TAG_class_template"],
  [0x4104, "DW_TAG_GNU_BINCL"],
  [0x4105, "DW_TAG_GNU_EINCL"],
  [0x4106, "DW_TAG_GNU_template_template_param"],
  [0x4107, "DW_TAG_GNU_template_parameter_pack"],
  [0x4108, "DW_TAG_GNU_formal_parameter_pack"],
  [0x4109, "DW_TAG_GNU_call_site"],
  [0x410a, "DW_TAG_GNU_call_site_parameter"],
  [0x4200, "DW_TAG_APPLE_property"],
  [0x4201, "DW_TAG_SUN_function_template"],
  [0x4202, "DW_TAG_SUN_class_template"],
  [0x4203, "DW_TAG_SUN_struct_template"],
  [0x4204, "DW_TAG_SUN_union_template"],
  [0x4205, "DW_TAG_SUN_indirect_inheritance"],
  [0x4206, "DW_TAG_SUN_codeflags"],
  [0x4207, "DW_TAG_SUN_memop_info"],
  [0x4208, "DW_TAG_SUN_omp_child_func"],
  [0x4209, "DW_TAG_SUN_rtti_descriptor"],
  [0x420a, "DW_TAG_SUN_dtor_info"],
  [0x420b, "DW_TAG_SUN_dtor"],
  [0x420c, "DW_TAG_SUN_f90_interface"],
  [0x420d, "DW_TAG_SUN_fortran_vax_structure"],
  [0x42ff, "DW_TAG_SUN_hi"],
  [0x4300, "DW_TAG_LLVM_ptrauth_type"],
  [0x5101, "DW_TAG_ALTIUM_circ_type"],
  [0x5102, "DW_TAG_ALTIUM_mwa_circ_type"],
  [0x5103, "DW_TAG_ALTIUM_rev_carry_type"],
  [0x5111, "DW_TAG_ALTIUM_rom"],
  [0x6000, "DW_TAG_LLVM_annotation"],
  [0x8004, "DW_TAG_GHS_namespace"],
  [0x8005, "DW_TAG_GHS_using_namespace"],
  [0x8006, "DW_TAG_GHS_using_declaration"],
  [0x8007, "DW_TAG_GHS_template_templ_param"],
  [0x8765, "DW_TAG_UPC_shared_type"],
  [0x8766, "DW_TAG_UPC_strict_type"],
  [0x8767, "DW_TAG_UPC_relaxed"],
  [0xa000, "DW_TAG_PGI_kanji_type"],
  [0xa020, "DW_TAG_PGI_interface_block"],
  [0xb000, "DW_TAG_BORLAND_property"],
  [0xb001, "DW_TAG_BORLAND_Delphi_string"],
  [0xb002, "DW_TAG_BORLAND_Delphi_dynamic_array"],
  [0xb003, "DW_TAG_BORLAND_Delphi_set"],
  [0xb004, "DW_TAG_BORLAND_Delphi_variant"],
]);
// OP: 181 entries, Dwarf.def lines 743-943
export const DW_OP_NAMES: ReadonlyMap<number, string> = new Map([
  [0x03, "DW_OP_addr"],
  [0x06, "DW_OP_deref"],
  [0x08, "DW_OP_const1u"],
  [0x09, "DW_OP_const1s"],
  [0x0a, "DW_OP_const2u"],
  [0x0b, "DW_OP_const2s"],
  [0x0c, "DW_OP_const4u"],
  [0x0d, "DW_OP_const4s"],
  [0x0e, "DW_OP_const8u"],
  [0x0f, "DW_OP_const8s"],
  [0x10, "DW_OP_constu"],
  [0x11, "DW_OP_consts"],
  [0x12, "DW_OP_dup"],
  [0x13, "DW_OP_drop"],
  [0x14, "DW_OP_over"],
  [0x15, "DW_OP_pick"],
  [0x16, "DW_OP_swap"],
  [0x17, "DW_OP_rot"],
  [0x18, "DW_OP_xderef"],
  [0x19, "DW_OP_abs"],
  [0x1a, "DW_OP_and"],
  [0x1b, "DW_OP_div"],
  [0x1c, "DW_OP_minus"],
  [0x1d, "DW_OP_mod"],
  [0x1e, "DW_OP_mul"],
  [0x1f, "DW_OP_neg"],
  [0x20, "DW_OP_not"],
  [0x21, "DW_OP_or"],
  [0x22, "DW_OP_plus"],
  [0x23, "DW_OP_plus_uconst"],
  [0x24, "DW_OP_shl"],
  [0x25, "DW_OP_shr"],
  [0x26, "DW_OP_shra"],
  [0x27, "DW_OP_xor"],
  [0x28, "DW_OP_bra"],
  [0x29, "DW_OP_eq"],
  [0x2a, "DW_OP_ge"],
  [0x2b, "DW_OP_gt"],
  [0x2c, "DW_OP_le"],
  [0x2d, "DW_OP_lt"],
  [0x2e, "DW_OP_ne"],
  [0x2f, "DW_OP_skip"],
  [0x30, "DW_OP_lit0"],
  [0x31, "DW_OP_lit1"],
  [0x32, "DW_OP_lit2"],
  [0x33, "DW_OP_lit3"],
  [0x34, "DW_OP_lit4"],
  [0x35, "DW_OP_lit5"],
  [0x36, "DW_OP_lit6"],
  [0x37, "DW_OP_lit7"],
  [0x38, "DW_OP_lit8"],
  [0x39, "DW_OP_lit9"],
  [0x3a, "DW_OP_lit10"],
  [0x3b, "DW_OP_lit11"],
  [0x3c, "DW_OP_lit12"],
  [0x3d, "DW_OP_lit13"],
  [0x3e, "DW_OP_lit14"],
  [0x3f, "DW_OP_lit15"],
  [0x40, "DW_OP_lit16"],
  [0x41, "DW_OP_lit17"],
  [0x42, "DW_OP_lit18"],
  [0x43, "DW_OP_lit19"],
  [0x44, "DW_OP_lit20"],
  [0x45, "DW_OP_lit21"],
  [0x46, "DW_OP_lit22"],
  [0x47, "DW_OP_lit23"],
  [0x48, "DW_OP_lit24"],
  [0x49, "DW_OP_lit25"],
  [0x4a, "DW_OP_lit26"],
  [0x4b, "DW_OP_lit27"],
  [0x4c, "DW_OP_lit28"],
  [0x4d, "DW_OP_lit29"],
  [0x4e, "DW_OP_lit30"],
  [0x4f, "DW_OP_lit31"],
  [0x50, "DW_OP_reg0"],
  [0x51, "DW_OP_reg1"],
  [0x52, "DW_OP_reg2"],
  [0x53, "DW_OP_reg3"],
  [0x54, "DW_OP_reg4"],
  [0x55, "DW_OP_reg5"],
  [0x56, "DW_OP_reg6"],
  [0x57, "DW_OP_reg7"],
  [0x58, "DW_OP_reg8"],
  [0x59, "DW_OP_reg9"],
  [0x5a, "DW_OP_reg10"],
  [0x5b, "DW_OP_reg11"],
  [0x5c, "DW_OP_reg12"],
  [0x5d, "DW_OP_reg13"],
  [0x5e, "DW_OP_reg14"],
  [0x5f, "DW_OP_reg15"],
  [0x60, "DW_OP_reg16"],
  [0x61, "DW_OP_reg17"],
  [0x62, "DW_OP_reg18"],
  [0x63, "DW_OP_reg19"],
  [0x64, "DW_OP_reg20"],
  [0x65, "DW_OP_reg21"],
  [0x66, "DW_OP_reg22"],
  [0x67, "DW_OP_reg23"],
  [0x68, "DW_OP_reg24"],
  [0x69, "DW_OP_reg25"],
  [0x6a, "DW_OP_reg26"],
  [0x6b, "DW_OP_reg27"],
  [0x6c, "DW_OP_reg28"],
  [0x6d, "DW_OP_reg29"],
  [0x6e, "DW_OP_reg30"],
  [0x6f, "DW_OP_reg31"],
  [0x70, "DW_OP_breg0"],
  [0x71, "DW_OP_breg1"],
  [0x72, "DW_OP_breg2"],
  [0x73, "DW_OP_breg3"],
  [0x74, "DW_OP_breg4"],
  [0x75, "DW_OP_breg5"],
  [0x76, "DW_OP_breg6"],
  [0x77, "DW_OP_breg7"],
  [0x78, "DW_OP_breg8"],
  [0x79, "DW_OP_breg9"],
  [0x7a, "DW_OP_breg10"],
  [0x7b, "DW_OP_breg11"],
  [0x7c, "DW_OP_breg12"],
  [0x7d, "DW_OP_breg13"],
  [0x7e, "DW_OP_breg14"],
  [0x7f, "DW_OP_breg15"],
  [0x80, "DW_OP_breg16"],
  [0x81, "DW_OP_breg17"],
  [0x82, "DW_OP_breg18"],
  [0x83, "DW_OP_breg19"],
  [0x84, "DW_OP_breg20"],
  [0x85, "DW_OP_breg21"],
  [0x86, "DW_OP_breg22"],
  [0x87, "DW_OP_breg23"],
  [0x88, "DW_OP_breg24"],
  [0x89, "DW_OP_breg25"],
  [0x8a, "DW_OP_breg26"],
  [0x8b, "DW_OP_breg27"],
  [0x8c, "DW_OP_breg28"],
  [0x8d, "DW_OP_breg29"],
  [0x8e, "DW_OP_breg30"],
  [0x8f, "DW_OP_breg31"],
  [0x90, "DW_OP_regx"],
  [0x91, "DW_OP_fbreg"],
  [0x92, "DW_OP_bregx"],
  [0x93, "DW_OP_piece"],
  [0x94, "DW_OP_deref_size"],
  [0x95, "DW_OP_xderef_size"],
  [0x96, "DW_OP_nop"],
  [0x97, "DW_OP_push_object_address"],
  [0x98, "DW_OP_call2"],
  [0x99, "DW_OP_call4"],
  [0x9a, "DW_OP_call_ref"],
  [0x9b, "DW_OP_form_tls_address"],
  [0x9c, "DW_OP_call_frame_cfa"],
  [0x9d, "DW_OP_bit_piece"],
  [0x9e, "DW_OP_implicit_value"],
  [0x9f, "DW_OP_stack_value"],
  [0xa0, "DW_OP_implicit_pointer"],
  [0xa1, "DW_OP_addrx"],
  [0xa2, "DW_OP_constx"],
  [0xa3, "DW_OP_entry_value"],
  [0xa4, "DW_OP_const_type"],
  [0xa5, "DW_OP_regval_type"],
  [0xa6, "DW_OP_deref_type"],
  [0xa7, "DW_OP_xderef_type"],
  [0xa8, "DW_OP_convert"],
  [0xa9, "DW_OP_reinterpret"],
  [0xe0, "DW_OP_GNU_push_tls_address"],
  [0xe1, "DW_OP_HP_is_value"],
  [0xe2, "DW_OP_HP_fltconst4"],
  [0xe3, "DW_OP_HP_fltconst8"],
  [0xe4, "DW_OP_HP_mod_range"],
  [0xe5, "DW_OP_HP_unmod_range"],
  [0xe6, "DW_OP_HP_tls"],
  [0xe8, "DW_OP_INTEL_bit_piece"],
  [0xed, "DW_OP_WASM_location"],
  [0xee, "DW_OP_WASM_location_int"],
  [0xf0, "DW_OP_APPLE_uninit"],
  [0xf2, "DW_OP_GNU_implicit_pointer"],
  [0xf3, "DW_OP_GNU_entry_value"],
  [0xf8, "DW_OP_PGI_omp_thread_num"],
  [0xfb, "DW_OP_GNU_addr_index"],
  [0xfc, "DW_OP_GNU_const_index"],
  [0xe9, "DW_OP_LLVM_user"],
]);
// ATE: 24 entries, Dwarf.def lines 1097-1129
export const DW_ATE_NAMES: ReadonlyMap<number, string> = new Map([
  [0x01, "DW_ATE_address"],
  [0x02, "DW_ATE_boolean"],
  [0x03, "DW_ATE_complex_float"],
  [0x04, "DW_ATE_float"],
  [0x05, "DW_ATE_signed"],
  [0x06, "DW_ATE_signed_char"],
  [0x07, "DW_ATE_unsigned"],
  [0x08, "DW_ATE_unsigned_char"],
  [0x09, "DW_ATE_imaginary_float"],
  [0x0a, "DW_ATE_packed_decimal"],
  [0x0b, "DW_ATE_numeric_string"],
  [0x0c, "DW_ATE_edited"],
  [0x0d, "DW_ATE_signed_fixed"],
  [0x0e, "DW_ATE_unsigned_fixed"],
  [0x0f, "DW_ATE_decimal_float"],
  [0x10, "DW_ATE_UTF"],
  [0x11, "DW_ATE_UCS"],
  [0x12, "DW_ATE_ASCII"],
  [0x81, "DW_ATE_HP_complex_float"],
  [0x82, "DW_ATE_HP_float128"],
  [0x83, "DW_ATE_HP_complex_float128"],
  [0x84, "DW_ATE_HP_floathpintel"],
  [0x85, "DW_ATE_HP_imaginary_float90"],
  [0x86, "DW_ATE_HP_imaginary_float128"],
]);
// LANG: 63 entries, Dwarf.def lines 968-1036
export const DW_LANG_NAMES: ReadonlyMap<number, string> = new Map([
  [0x0001, "DW_LANG_C89"],
  [0x0002, "DW_LANG_C"],
  [0x0003, "DW_LANG_Ada83"],
  [0x0004, "DW_LANG_C_plus_plus"],
  [0x0005, "DW_LANG_Cobol74"],
  [0x0006, "DW_LANG_Cobol85"],
  [0x0007, "DW_LANG_Fortran77"],
  [0x0008, "DW_LANG_Fortran90"],
  [0x0009, "DW_LANG_Pascal83"],
  [0x000a, "DW_LANG_Modula2"],
  [0x000b, "DW_LANG_Java"],
  [0x000c, "DW_LANG_C99"],
  [0x000d, "DW_LANG_Ada95"],
  [0x000e, "DW_LANG_Fortran95"],
  [0x000f, "DW_LANG_PLI"],
  [0x0010, "DW_LANG_ObjC"],
  [0x0011, "DW_LANG_ObjC_plus_plus"],
  [0x0012, "DW_LANG_UPC"],
  [0x0013, "DW_LANG_D"],
  [0x0014, "DW_LANG_Python"],
  [0x0015, "DW_LANG_OpenCL"],
  [0x0016, "DW_LANG_Go"],
  [0x0017, "DW_LANG_Modula3"],
  [0x0018, "DW_LANG_Haskell"],
  [0x0019, "DW_LANG_C_plus_plus_03"],
  [0x001a, "DW_LANG_C_plus_plus_11"],
  [0x001b, "DW_LANG_OCaml"],
  [0x001c, "DW_LANG_Rust"],
  [0x001d, "DW_LANG_C11"],
  [0x001e, "DW_LANG_Swift"],
  [0x001f, "DW_LANG_Julia"],
  [0x0020, "DW_LANG_Dylan"],
  [0x0021, "DW_LANG_C_plus_plus_14"],
  [0x0022, "DW_LANG_Fortran03"],
  [0x0023, "DW_LANG_Fortran08"],
  [0x0024, "DW_LANG_RenderScript"],
  [0x0025, "DW_LANG_BLISS"],
  [0x0026, "DW_LANG_Kotlin"],
  [0x0027, "DW_LANG_Zig"],
  [0x0028, "DW_LANG_Crystal"],
  [0x002a, "DW_LANG_C_plus_plus_17"],
  [0x002b, "DW_LANG_C_plus_plus_20"],
  [0x002c, "DW_LANG_C17"],
  [0x002d, "DW_LANG_Fortran18"],
  [0x002e, "DW_LANG_Ada2005"],
  [0x002f, "DW_LANG_Ada2012"],
  [0x0030, "DW_LANG_HIP"],
  [0x0031, "DW_LANG_Assembly"],
  [0x0032, "DW_LANG_C_sharp"],
  [0x0033, "DW_LANG_Mojo"],
  [0x0034, "DW_LANG_GLSL"],
  [0x0035, "DW_LANG_GLSL_ES"],
  [0x0036, "DW_LANG_HLSL"],
  [0x0037, "DW_LANG_OpenCL_CPP"],
  [0x0038, "DW_LANG_CPP_for_OpenCL"],
  [0x0039, "DW_LANG_SYCL"],
  [0x003d, "DW_LANG_Metal"],
  [0x0040, "DW_LANG_Ruby"],
  [0x0041, "DW_LANG_Move"],
  [0x0042, "DW_LANG_Hylo"],
  [0x8001, "DW_LANG_Mips_Assembler"],
  [0x8e57, "DW_LANG_GOOGLE_RenderScript"],
  [0xb000, "DW_LANG_BORLAND_Delphi"],
]);
// CC: 32 entries, Dwarf.def lines 1149-1186
export const DW_CC_NAMES: ReadonlyMap<number, string> = new Map([
  [0x01, "DW_CC_normal"],
  [0x02, "DW_CC_program"],
  [0x03, "DW_CC_nocall"],
  [0x04, "DW_CC_pass_by_reference"],
  [0x05, "DW_CC_pass_by_value"],
  [0x40, "DW_CC_GNU_renesas_sh"],
  [0x41, "DW_CC_GNU_borland_fastcall_i386"],
  [0xb0, "DW_CC_BORLAND_safecall"],
  [0xb1, "DW_CC_BORLAND_stdcall"],
  [0xb2, "DW_CC_BORLAND_pascal"],
  [0xb3, "DW_CC_BORLAND_msfastcall"],
  [0xb4, "DW_CC_BORLAND_msreturn"],
  [0xb5, "DW_CC_BORLAND_thiscall"],
  [0xb6, "DW_CC_BORLAND_fastcall"],
  [0xc0, "DW_CC_LLVM_vectorcall"],
  [0xc1, "DW_CC_LLVM_Win64"],
  [0xc2, "DW_CC_LLVM_X86_64SysV"],
  [0xc3, "DW_CC_LLVM_AAPCS"],
  [0xc4, "DW_CC_LLVM_AAPCS_VFP"],
  [0xc5, "DW_CC_LLVM_IntelOclBicc"],
  [0xc6, "DW_CC_LLVM_SpirFunction"],
  [0xc7, "DW_CC_LLVM_DeviceKernel"],
  [0xc8, "DW_CC_LLVM_Swift"],
  [0xc9, "DW_CC_LLVM_PreserveMost"],
  [0xca, "DW_CC_LLVM_PreserveAll"],
  [0xcb, "DW_CC_LLVM_X86RegCall"],
  [0xcc, "DW_CC_LLVM_M68kRTD"],
  [0xcd, "DW_CC_LLVM_PreserveNone"],
  [0xce, "DW_CC_LLVM_RISCVVectorCall"],
  [0xcf, "DW_CC_LLVM_SwiftTail"],
  [0xd0, "DW_CC_LLVM_RISCVVLSCall"],
  [0xff, "DW_CC_GDB_IBM_OpenCL"],
]);

/** `OperationEncodingString`'s cases after the `Dwarf.def` ones (Dwarf.cpp:146-161; values from Dwarf.h:144-151). */
export const DW_OP_LLVM_NAMES: ReadonlyMap<number, string> = new Map([
  [0x1000, "DW_OP_LLVM_fragment"],
  [0x1001, "DW_OP_LLVM_convert"],
  [0x1002, "DW_OP_LLVM_tag_offset"],
  [0x1003, "DW_OP_LLVM_entry_value"],
  [0x1004, "DW_OP_LLVM_implicit_pointer"],
  [0x1005, "DW_OP_LLVM_arg"],
  [0x1006, "DW_OP_LLVM_extract_bits_sext"],
  [0x1007, "DW_OP_LLVM_extract_bits_zext"],
]);

/** `dwarf::OperationEncodingString`: a `Dwarf.def` operation, then the LLVM-only ones; "" otherwise. */
export function operationEncodingString(op: number): string {
  return DW_OP_NAMES.get(op) ?? DW_OP_LLVM_NAMES.get(op) ?? "";
}

/** `HANDLE_DI_FLAG(ID, NAME)` rows of DebugInfoFlags.def:27-66 in order (the `Largest` row is under `DI_FLAG_LARGEST_NEEDED`,
 * which the printer's translation unit does not define). */
export const DI_FLAG_ROWS: readonly (readonly [number, string])[] = [
  [0, "Zero"], [1, "Private"], [2, "Protected"], [3, "Public"], [1 << 2, "FwdDecl"], [1 << 3, "AppleBlock"],
  [1 << 4, "ReservedBit4"], [1 << 5, "Virtual"], [1 << 6, "Artificial"], [1 << 7, "Explicit"], [1 << 8, "Prototyped"],
  [1 << 9, "ObjcClassComplete"], [1 << 10, "ObjectPointer"], [1 << 11, "Vector"], [1 << 12, "StaticMember"],
  [1 << 13, "LValueReference"], [1 << 14, "RValueReference"], [1 << 15, "ExportSymbols"], [1 << 16, "SingleInheritance"],
  [2 << 16, "MultipleInheritance"], [3 << 16, "VirtualInheritance"], [1 << 18, "IntroducedVirtual"], [1 << 19, "BitField"],
  [1 << 20, "NoReturn"], [1 << 22, "TypePassByValue"], [1 << 23, "TypePassByReference"], [1 << 24, "EnumClass"],
  [1 << 25, "Thunk"], [1 << 26, "NonTrivial"], [1 << 27, "BigEndian"], [1 << 28, "LittleEndian"],
  [1 << 29, "AllCallsDescribed"], [1 << 30, "NameIsSimplified"], [(1 << 2) | (1 << 5), "IndirectVirtualBase"],
];

/** `HANDLE_DISP_FLAG(ID, NAME)` rows of DebugInfoFlags.def:79-94 in order (`Largest` excluded, as above). */
export const DISP_FLAG_ROWS: readonly (readonly [number, string])[] = [
  [0, "Zero"], [1, "Virtual"], [2, "PureVirtual"], [1 << 2, "LocalToUnit"], [1 << 3, "Definition"], [1 << 4, "Optimized"],
  [1 << 5, "Pure"], [1 << 6, "Elemental"], [1 << 7, "Recursive"], [1 << 8, "MainSubprogram"], [1 << 9, "Deleted"],
  [1 << 11, "ObjCDirect"],
];

const FlagPrivate = 1;
const FlagProtected = 2;
const FlagAccessibility = 3;
const FlagSingleInheritance = 1 << 16;
const FlagMultipleInheritance = 2 << 16;
const FlagPtrToMemberRep = 3 << 16;
const FlagIndirectVirtualBase = (1 << 2) | (1 << 5);

/** `DINode::getFlagString` (DebugInfoMetadata.cpp:466): the first row with this exact value, or "". */
export function diFlagString(flag: number): string {
  const row = DI_FLAG_ROWS.find(([id]) => id === flag);
  return row === undefined ? "" : `DIFlag${row[1]}`;
}

/** `DINode::splitFlags` (DebugInfoMetadata.cpp:476): the packed fields first, then each row's bits in row order; returns the
 * bits no row names. Flags are unsigned 32-bit (`>>> 0`). */
export function diSplitFlags(flags: number, split: number[]): number {
  let f = flags >>> 0;
  const a = f & FlagAccessibility;
  if (a) {
    if (a === FlagPrivate) split.push(FlagPrivate);
    else if (a === FlagProtected) split.push(FlagProtected);
    else split.push(FlagAccessibility); // FlagPublic
    f = (f & ~a) >>> 0;
  }
  const r = f & FlagPtrToMemberRep;
  if (r) {
    if (r === FlagSingleInheritance) split.push(FlagSingleInheritance);
    else if (r === FlagMultipleInheritance) split.push(FlagMultipleInheritance);
    else split.push(FlagPtrToMemberRep); // FlagVirtualInheritance
    f = (f & ~r) >>> 0;
  }
  if ((f & FlagIndirectVirtualBase) === FlagIndirectVirtualBase) {
    f = (f & ~FlagIndirectVirtualBase) >>> 0;
    split.push(FlagIndirectVirtualBase);
  }
  for (const [id] of DI_FLAG_ROWS) {
    const bit = (f & id) >>> 0;
    if (bit) {
      split.push(bit);
      f = (f & ~bit) >>> 0;
    }
  }
  return f;
}

/** `DISubprogram::getFlagString` (DebugInfoMetadata.cpp:1377). */
export function dispFlagString(flag: number): string {
  // `case SPFlagVirtuality: return "";` (Virtual | PureVirtual).
  if (flag === 3) return "";
  const row = DISP_FLAG_ROWS.find(([id]) => id === flag);
  return row === undefined ? "" : `DISPFlag${row[1]}`;
}

/** `DISubprogram::splitFlags` (DebugInfoMetadata.cpp:1391). */
export function dispSplitFlags(flags: number, split: number[]): number {
  let f = flags >>> 0;
  for (const [id] of DISP_FLAG_ROWS) {
    const bit = (f & id) >>> 0;
    if (bit) {
      split.push(bit);
      f = (f & ~bit) >>> 0;
    }
  }
  return f;
}

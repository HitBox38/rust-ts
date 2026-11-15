; ModuleID = 'types.ca9a2c18325d504-cgu.0'
source_filename = "types.ca9a2c18325d504-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@_RNvCs15oYSsIuqjM_5types6GLOBAL = constant <{ [13 x i8], [3 x i8] }> <{ [13 x i8] c"\00\00\00\00\00\00\00@\01\00\00\00\03", [3 x i8] undef }>, align 8, !dbg !0, !guid !14
@vtable.0 = private constant <{ [24 x i8], ptr }> <{ [24 x i8] c"\00\00\00\00\00\00\00\00\10\00\00\00\00\00\00\00\08\00\00\00\00\00\00\00", ptr @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area }>, align 8, !dbg !15, !guid !26

; types::take::<types::closure::{closure#0}>
; Function Attrs: noinline nonlazybind uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %t) unnamed_addr #0 !dbg !42 !guid !54 {
start:
  %t.dbg.spill = alloca [4 x i8], align 4
  store i32 %t, ptr %t.dbg.spill, align 4
    #dbg_declare(ptr %t.dbg.spill, !51, !DIExpression(), !55)
  ret i32 0, !dbg !56
}

; types::take::<types::rec_impl>
; Function Attrs: noinline nonlazybind uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_() unnamed_addr #0 !dbg !57 !guid !68 {
start:
  %t.dbg.spill = alloca [0 x i8], align 1
    #dbg_declare(ptr %t.dbg.spill, !65, !DIExpression(), !69)
  ret i32 0, !dbg !70
}

; types::diverge
; Function Attrs: noreturn nonlazybind uwtable
define internal void @_RNvCs15oYSsIuqjM_5types7diverge() unnamed_addr #1 !dbg !71 !guid !74 {
start:
  br label %bb1, !dbg !75

bb1:                                              ; preds = %bb1, %start
  br label %bb1, !dbg !75
}

; types::rec_impl
; Function Attrs: nonlazybind uwtable
define void @_RNvCs15oYSsIuqjM_5types8rec_impl() unnamed_addr #2 !dbg !76 !guid !77 {
start:
  ret void, !dbg !78
}

; <types::Point as types::Shape>::area
; Function Attrs: nonlazybind uwtable
define i32 @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area(ptr align 8 %self) unnamed_addr #2 !dbg !79 !guid !86 {
start:
  %self.dbg.spill = alloca [8 x i8], align 8
  store ptr %self, ptr %self.dbg.spill, align 8
    #dbg_declare(ptr %self.dbg.spill, !85, !DIExpression(), !87)
  %0 = getelementptr inbounds i8, ptr %self, i64 12, !dbg !88
  %_2 = load i8, ptr %0, align 4, !dbg !88
  %_0 = zext i8 %_2 to i32, !dbg !88
  ret i32 %_0, !dbg !89
}

; Function Attrs: nonlazybind uwtable
define i32 @basics(i8 %a, i64 %b, float %c, double %d, i64 %e, i64 %f, i128 %g, i128 %h, half %i, fp128 %j, i32 %l) unnamed_addr #2 !dbg !90 !guid !116 {
start:
  %k.dbg.spill = alloca [0 x i8], align 1
  %l.dbg.spill = alloca [4 x i8], align 4
  %_11.dbg.spill = alloca [0 x i8], align 1
  %j.dbg.spill = alloca [16 x i8], align 16
  %i.dbg.spill = alloca [2 x i8], align 2
  %h.dbg.spill = alloca [16 x i8], align 16
  %g.dbg.spill = alloca [16 x i8], align 16
  %f.dbg.spill = alloca [8 x i8], align 8
  %e.dbg.spill = alloca [8 x i8], align 8
  %d.dbg.spill = alloca [8 x i8], align 8
  %c.dbg.spill = alloca [4 x i8], align 4
  %b.dbg.spill = alloca [8 x i8], align 8
  %a.dbg.spill = alloca [1 x i8], align 1
  store i8 %a, ptr %a.dbg.spill, align 1
    #dbg_declare(ptr %a.dbg.spill, !103, !DIExpression(), !117)
  store i64 %b, ptr %b.dbg.spill, align 8
    #dbg_declare(ptr %b.dbg.spill, !104, !DIExpression(), !118)
  store float %c, ptr %c.dbg.spill, align 4
    #dbg_declare(ptr %c.dbg.spill, !105, !DIExpression(), !119)
  store double %d, ptr %d.dbg.spill, align 8
    #dbg_declare(ptr %d.dbg.spill, !106, !DIExpression(), !120)
  store i64 %e, ptr %e.dbg.spill, align 8
    #dbg_declare(ptr %e.dbg.spill, !107, !DIExpression(), !121)
  store i64 %f, ptr %f.dbg.spill, align 8
    #dbg_declare(ptr %f.dbg.spill, !108, !DIExpression(), !122)
  store i128 %g, ptr %g.dbg.spill, align 16
    #dbg_declare(ptr %g.dbg.spill, !109, !DIExpression(), !123)
  store i128 %h, ptr %h.dbg.spill, align 16
    #dbg_declare(ptr %h.dbg.spill, !110, !DIExpression(), !124)
  store half %i, ptr %i.dbg.spill, align 2
    #dbg_declare(ptr %i.dbg.spill, !111, !DIExpression(), !125)
  store fp128 %j, ptr %j.dbg.spill, align 16
    #dbg_declare(ptr %j.dbg.spill, !112, !DIExpression(), !126)
    #dbg_declare(ptr %_11.dbg.spill, !115, !DIExpression(), !127)
  store i32 %l, ptr %l.dbg.spill, align 4
    #dbg_declare(ptr %l.dbg.spill, !114, !DIExpression(), !128)
    #dbg_declare(ptr %k.dbg.spill, !113, !DIExpression(), !127)
  ret i32 0, !dbg !129
}

; Function Attrs: nonlazybind uwtable
define i32 @closure(i32 %x) unnamed_addr #2 !dbg !130 !guid !137 {
start:
  %c.dbg.spill = alloca [4 x i8], align 4
  %x.dbg.spill = alloca [4 x i8], align 4
  store i32 %x, ptr %x.dbg.spill, align 4
    #dbg_declare(ptr %x.dbg.spill, !134, !DIExpression(), !138)
  store i32 %x, ptr %c.dbg.spill, align 4, !dbg !139
    #dbg_declare(ptr %c.dbg.spill, !135, !DIExpression(), !140)
; call types::take::<types::closure::{closure#0}>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %x), !dbg !141
  ret i32 %_0, !dbg !142
}

; Function Attrs: nonlazybind uwtable
define i32 @enums(i8 %c, ptr align 8 %t, ptr align 4 %o, i8 %n, i64 %s.0, i32 %s.1, ptr %e, i128 %w.0, i8 %w.1, ptr align 8 %r) unnamed_addr #2 !dbg !143 !guid !274 {
start:
  %r.dbg.spill = alloca [8 x i8], align 8
  %w.dbg.spill = alloca [32 x i8], align 16
  %e.dbg.spill = alloca [8 x i8], align 8
  %s.dbg.spill = alloca [16 x i8], align 8
  %n.dbg.spill = alloca [1 x i8], align 1
  %o.dbg.spill = alloca [8 x i8], align 8
  %c.dbg.spill = alloca [1 x i8], align 1
  store i8 %c, ptr %c.dbg.spill, align 1
    #dbg_declare(ptr %c.dbg.spill, !266, !DIExpression(), !275)
    #dbg_declare(ptr %t, !267, !DIExpression(), !276)
  store ptr %o, ptr %o.dbg.spill, align 8
    #dbg_declare(ptr %o.dbg.spill, !268, !DIExpression(), !277)
  store i8 %n, ptr %n.dbg.spill, align 1
    #dbg_declare(ptr %n.dbg.spill, !269, !DIExpression(), !278)
  store i64 %s.0, ptr %s.dbg.spill, align 8
  %0 = getelementptr inbounds i8, ptr %s.dbg.spill, i64 8
  store i32 %s.1, ptr %0, align 8
    #dbg_declare(ptr %s.dbg.spill, !270, !DIExpression(), !279)
  store ptr %e, ptr %e.dbg.spill, align 8
    #dbg_declare(ptr %e.dbg.spill, !271, !DIExpression(), !280)
  store i128 %w.0, ptr %w.dbg.spill, align 16
  %1 = getelementptr inbounds i8, ptr %w.dbg.spill, i64 16
  store i8 %w.1, ptr %1, align 16
    #dbg_declare(ptr %w.dbg.spill, !272, !DIExpression(), !281)
  store ptr %r, ptr %r.dbg.spill, align 8
    #dbg_declare(ptr %r.dbg.spill, !273, !DIExpression(), !282)
  ret i32 0, !dbg !283
}

; Function Attrs: nonlazybind uwtable
define align 8 ptr @global() unnamed_addr #2 !dbg !284 !guid !287 {
start:
  ret ptr @_RNvCs15oYSsIuqjM_5types6GLOBAL, !dbg !288
}

; Function Attrs: nonlazybind uwtable
define i32 @never(i1 zeroext %flag) unnamed_addr #2 !dbg !289 !guid !294 {
start:
  %flag.dbg.spill = alloca [1 x i8], align 1
  %0 = zext i1 %flag to i8
  store i8 %0, ptr %flag.dbg.spill, align 1
    #dbg_declare(ptr %flag.dbg.spill, !293, !DIExpression(), !295)
  br i1 %flag, label %bb1, label %bb2, !dbg !296

bb2:                                              ; preds = %start
  ret i32 1, !dbg !297

bb1:                                              ; preds = %start
; call types::diverge
  call void @_RNvCs15oYSsIuqjM_5types7diverge() #4, !dbg !298
  unreachable, !dbg !298
}

; Function Attrs: nonlazybind uwtable
define i32 @pointers(ptr align 8 %sl.0, i64 %sl.1, ptr %s.0, i64 %s.1, ptr %d.0, ptr align 8 %d.1, ptr %raw, ptr align 2 %m, ptr %f, ptr %op) unnamed_addr #2 !dbg !299 !guid !339 {
start:
  %op.dbg.spill = alloca [8 x i8], align 8
  %f.dbg.spill = alloca [8 x i8], align 8
  %m.dbg.spill = alloca [8 x i8], align 8
  %raw.dbg.spill = alloca [8 x i8], align 8
  %d.dbg.spill = alloca [16 x i8], align 8
  %s.dbg.spill = alloca [16 x i8], align 8
  %sl.dbg.spill = alloca [16 x i8], align 8
  store ptr %sl.0, ptr %sl.dbg.spill, align 8
  %0 = getelementptr inbounds i8, ptr %sl.dbg.spill, i64 8
  store i64 %sl.1, ptr %0, align 8
    #dbg_declare(ptr %sl.dbg.spill, !332, !DIExpression(), !340)
  store ptr %s.0, ptr %s.dbg.spill, align 8
  %1 = getelementptr inbounds i8, ptr %s.dbg.spill, i64 8
  store i64 %s.1, ptr %1, align 8
    #dbg_declare(ptr %s.dbg.spill, !333, !DIExpression(), !341)
  store ptr %d.0, ptr %d.dbg.spill, align 8
  %2 = getelementptr inbounds i8, ptr %d.dbg.spill, i64 8
  store ptr %d.1, ptr %2, align 8
    #dbg_declare(ptr %d.dbg.spill, !334, !DIExpression(), !342)
  store ptr %raw, ptr %raw.dbg.spill, align 8
    #dbg_declare(ptr %raw.dbg.spill, !335, !DIExpression(), !343)
  store ptr %m, ptr %m.dbg.spill, align 8
    #dbg_declare(ptr %m.dbg.spill, !336, !DIExpression(), !344)
  store ptr %f, ptr %f.dbg.spill, align 8
    #dbg_declare(ptr %f.dbg.spill, !337, !DIExpression(), !345)
  store ptr %op, ptr %op.dbg.spill, align 8
    #dbg_declare(ptr %op.dbg.spill, !338, !DIExpression(), !346)
  %3 = getelementptr inbounds i8, ptr %d.1, i64 24, !dbg !347
  %4 = load ptr, ptr %3, align 8, !dbg !347, !invariant.load !13, !nonnull !13
  %_0 = call i32 %4(ptr %d.0), !dbg !348
  ret i32 %_0, !dbg !349
}

; Function Attrs: nonlazybind uwtable
define i32 @recursive_fn_type() unnamed_addr #2 !dbg !350 !guid !353 {
start:
; call types::rec_impl
  call void @_RNvCs15oYSsIuqjM_5types8rec_impl(), !dbg !354
; call types::take::<types::rec_impl>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_(), !dbg !355
  ret i32 %_0, !dbg !356
}

; Function Attrs: nonlazybind uwtable
define i32 @structs(ptr align 8 %p, i64 %q.0, i16 %q.1, ptr align 4 %g, ptr align 8 %l) unnamed_addr #2 !dbg !357 !guid !400 {
start:
  %_u.dbg.spill = alloca [0 x i8], align 1
  %l.dbg.spill = alloca [8 x i8], align 8
  %_3.dbg.spill = alloca [0 x i8], align 1
  %q.dbg.spill = alloca [16 x i8], align 8
  %p.dbg.spill = alloca [8 x i8], align 8
  store ptr %p, ptr %p.dbg.spill, align 8
    #dbg_declare(ptr %p.dbg.spill, !394, !DIExpression(), !401)
  store i64 %q.0, ptr %q.dbg.spill, align 8
  %0 = getelementptr inbounds i8, ptr %q.dbg.spill, i64 8
  store i16 %q.1, ptr %0, align 8
    #dbg_declare(ptr %q.dbg.spill, !395, !DIExpression(), !402)
    #dbg_declare(ptr %_3.dbg.spill, !399, !DIExpression(), !403)
    #dbg_declare(ptr %g, !397, !DIExpression(), !404)
  store ptr %l, ptr %l.dbg.spill, align 8
    #dbg_declare(ptr %l.dbg.spill, !398, !DIExpression(), !405)
    #dbg_declare(ptr %_u.dbg.spill, !396, !DIExpression(), !403)
  %1 = getelementptr inbounds i8, ptr %p, i64 12, !dbg !406
  %_6 = load i8, ptr %1, align 4, !dbg !406
  %_0 = zext i8 %_6 to i32, !dbg !406
  ret i32 %_0, !dbg !407
}

; Function Attrs: nonlazybind uwtable
define i32 @union_(i32 %0) unnamed_addr #2 !dbg !408 !guid !417 {
start:
  %1 = alloca [4 x i8], align 4
  %u = alloca [4 x i8], align 4
  store i32 %0, ptr %1, align 4
  call void @llvm.memcpy.p0.p0.i64(ptr align 4 %u, ptr align 4 %1, i64 4, i1 false)
    #dbg_declare(ptr %u, !416, !DIExpression(), !418)
  %_0 = load i32, ptr %u, align 4, !dbg !419
  ret i32 %_0, !dbg !420
}

; Function Attrs: nonlazybind uwtable
define i8 @visibility(ptr %v) unnamed_addr #2 !dbg !421 !guid !434 {
start:
  %v.dbg.spill = alloca [8 x i8], align 8
  store ptr %v, ptr %v.dbg.spill, align 8
    #dbg_declare(ptr %v.dbg.spill, !433, !DIExpression(), !435)
  %0 = getelementptr inbounds i8, ptr %v, i64 3, !dbg !436
  %_0 = load i8, ptr %0, align 1, !dbg !436
  ret i8 %_0, !dbg !437
}

; Function Attrs: nonlazybind uwtable
define { ptr, ptr } @vtable(ptr align 8 %p) unnamed_addr #2 !dbg !438 !guid !443 {
start:
  %p.dbg.spill = alloca [8 x i8], align 8
  store ptr %p, ptr %p.dbg.spill, align 8
    #dbg_declare(ptr %p.dbg.spill, !442, !DIExpression(), !444)
  %0 = insertvalue { ptr, ptr } poison, ptr %p, 0, !dbg !445
  %1 = insertvalue { ptr, ptr } %0, ptr @vtable.0, 1, !dbg !445
  ret { ptr, ptr } %1, !dbg !445
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #3

attributes #0 = { noinline nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { noreturn nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #2 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #3 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }
attributes #4 = { noreturn }

!llvm.module.flags = !{!27, !28, !29, !30, !31}
!llvm.ident = !{!32}
!llvm.dbg.cu = !{!33}

!0 = !DIGlobalVariableExpression(var: !1, expr: !DIExpression())
!1 = distinct !DIGlobalVariable(name: "GLOBAL", linkageName: "_RNvCs15oYSsIuqjM_5types6GLOBAL", scope: !2, file: !3, line: 114, type: !4, isLocal: false, isDefinition: true, align: 64)
!2 = !DINamespace(name: "types", scope: null)
!3 = !DIFile(filename: "types.rs", directory: ".", checksumkind: CSK_MD5, checksum: "d86d4b8f50e8f521bc7e930537872c82")
!4 = !DICompositeType(tag: DW_TAG_structure_type, name: "Point", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !6, templateParams: !13, identifier: "308b9833e873e4487af9ab3f6fc9138b")
!5 = !DIFile(filename: "<unknown>", directory: "")
!6 = !{!7, !9, !11}
!7 = !DIDerivedType(tag: DW_TAG_member, name: "x", scope: !4, file: !5, baseType: !8, size: 32, align: 32, offset: 64, flags: DIFlagPublic)
!8 = !DIBasicType(name: "i32", size: 32, encoding: DW_ATE_signed)
!9 = !DIDerivedType(tag: DW_TAG_member, name: "y", scope: !4, file: !5, baseType: !10, size: 64, align: 64, flags: DIFlagPrivate)
!10 = !DIBasicType(name: "f64", size: 64, encoding: DW_ATE_float)
!11 = !DIDerivedType(tag: DW_TAG_member, name: "z", scope: !4, file: !5, baseType: !12, size: 8, align: 8, offset: 96, flags: DIFlagPrivate)
!12 = !DIBasicType(name: "u8", size: 8, encoding: DW_ATE_unsigned)
!13 = !{}
!14 = !{i64 -2440327355056123239}
!15 = !DIGlobalVariableExpression(var: !16, expr: !DIExpression())
!16 = distinct !DIGlobalVariable(name: "<types::Point as types::Shape>::{vtable}", scope: null, file: !5, type: !17, isLocal: true, isDefinition: true)
!17 = !DICompositeType(tag: DW_TAG_structure_type, name: "<types::Point as types::Shape>::{vtable_type}", file: !5, size: 256, align: 64, flags: DIFlagArtificial, elements: !18, vtableHolder: !4, templateParams: !13, identifier: "3d57a5951e71546da41ef57cf0b7bf59")
!18 = !{!19, !22, !24, !25}
!19 = !DIDerivedType(tag: DW_TAG_member, name: "drop_in_place", scope: !17, file: !5, baseType: !20, size: 64, align: 64)
!20 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const ()", baseType: !21, size: 64, align: 64, dwarfAddressSpace: 0)
!21 = !DIBasicType(name: "()", encoding: DW_ATE_unsigned)
!22 = !DIDerivedType(tag: DW_TAG_member, name: "size", scope: !17, file: !5, baseType: !23, size: 64, align: 64, offset: 64)
!23 = !DIBasicType(name: "usize", size: 64, encoding: DW_ATE_unsigned)
!24 = !DIDerivedType(tag: DW_TAG_member, name: "align", scope: !17, file: !5, baseType: !23, size: 64, align: 64, offset: 128)
!25 = !DIDerivedType(tag: DW_TAG_member, name: "__method3", scope: !17, file: !5, baseType: !20, size: 64, align: 64, offset: 192)
!26 = !{i64 -6426483837549638915}
!27 = !{i32 8, !"PIC Level", i32 2}
!28 = !{i32 2, !"RtLibUseGOT", i32 1}
!29 = !{i32 7, !"uwtable", i32 2}
!30 = !{i32 7, !"Dwarf Version", i32 4}
!31 = !{i32 2, !"Debug Info Version", i32 3}
!32 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!33 = distinct !DICompileUnit(language: DW_LANG_Rust, file: !34, producer: "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug, enums: !35, globals: !41, splitDebugInlining: false, nameTableKind: None)
!34 = !DIFile(filename: "types.rs/@/types.ca9a2c18325d504-cgu.0", directory: ".")
!35 = !{!36}
!36 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "CLike", scope: !2, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagEnumClass, elements: !37)
!37 = !{!38, !39, !40}
!38 = !DIEnumerator(name: "A", value: 0, isUnsigned: true)
!39 = !DIEnumerator(name: "B", value: 5, isUnsigned: true)
!40 = !DIEnumerator(name: "C", value: 6, isUnsigned: true)
!41 = !{!0, !15}
!42 = distinct !DISubprogram(name: "take<types::closure::{closure_env#0}>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_", scope: !2, file: !3, line: 156, type: !43, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !33, templateParams: !52, retainedNodes: !50)
!43 = !DISubroutineType(types: !44)
!44 = !{!45, !46}
!45 = !DIBasicType(name: "u32", size: 32, encoding: DW_ATE_unsigned)
!46 = !DICompositeType(tag: DW_TAG_structure_type, name: "{closure_env#0}", scope: !47, file: !5, size: 32, align: 32, elements: !48, templateParams: !13, identifier: "fc485e4bf1acde5e12ed9b065b27b2ae")
!47 = !DINamespace(name: "closure", scope: !2)
!48 = !{!49}
!49 = !DIDerivedType(tag: DW_TAG_member, name: "x", scope: !46, file: !5, baseType: !45, size: 32, align: 32)
!50 = !{!51}
!51 = !DILocalVariable(name: "t", arg: 1, scope: !42, file: !3, line: 156, type: !46)
!52 = !{!53}
!53 = !DITemplateTypeParameter(name: "T", type: !46)
!54 = !{i64 1915899645086356215}
!55 = !DILocation(line: 156, column: 12, scope: !42)
!56 = !DILocation(line: 159, column: 2, scope: !42)
!57 = distinct !DISubprogram(name: "take<fn() -> <recursive_type>>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_", scope: !2, file: !3, line: 156, type: !58, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !33, templateParams: !66, retainedNodes: !64)
!58 = !DISubroutineType(types: !59)
!59 = !{!45, !60}
!60 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "fn() -> <recursive_type>", baseType: !61, align: 8, dwarfAddressSpace: 0)
!61 = !DISubroutineType(types: !62)
!62 = !{!63}
!63 = !DIBasicType(name: "<recur_type>", size: 64, encoding: DW_ATE_unsigned)
!64 = !{!65}
!65 = !DILocalVariable(name: "t", arg: 1, scope: !57, file: !3, line: 156, type: !60)
!66 = !{!67}
!67 = !DITemplateTypeParameter(name: "T", type: !60)
!68 = !{i64 -740690765248574201}
!69 = !DILocation(line: 156, column: 12, scope: !57)
!70 = !DILocation(line: 159, column: 2, scope: !57)
!71 = distinct !DISubprogram(name: "diverge", linkageName: "_RNvCs15oYSsIuqjM_5types7diverge", scope: !2, file: !3, line: 147, type: !72, scopeLine: 147, flags: DIFlagPrototyped | DIFlagNoReturn, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !33, templateParams: !13)
!72 = !DISubroutineType(types: !73)
!73 = !{null}
!74 = !{i64 3518661633375468340}
!75 = !DILocation(line: 148, column: 5, scope: !71)
!76 = distinct !DISubprogram(name: "rec_impl", linkageName: "_RNvCs15oYSsIuqjM_5types8rec_impl", scope: !2, file: !3, line: 168, type: !72, scopeLine: 168, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13)
!77 = !{i64 73545626838823865}
!78 = !DILocation(line: 170, column: 2, scope: !76)
!79 = distinct !DISubprogram(name: "area", linkageName: "_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area", scope: !80, file: !3, line: 109, type: !81, scopeLine: 109, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13, retainedNodes: !84)
!80 = !DINamespace(name: "{impl#9}", scope: !2)
!81 = !DISubroutineType(types: !82)
!82 = !{!45, !83}
!83 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::Point", baseType: !4, size: 64, align: 64, dwarfAddressSpace: 0)
!84 = !{!85}
!85 = !DILocalVariable(name: "self", arg: 1, scope: !79, file: !3, line: 109, type: !83)
!86 = !{i64 -4356820192056016148}
!87 = !DILocation(line: 109, column: 13, scope: !79)
!88 = !DILocation(line: 110, column: 9, scope: !79)
!89 = !DILocation(line: 111, column: 6, scope: !79)
!90 = distinct !DISubprogram(name: "basics", scope: !2, file: !3, line: 132, type: !91, scopeLine: 132, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13, retainedNodes: !102)
!91 = !DISubroutineType(types: !92)
!92 = !{!45, !93, !94, !95, !10, !96, !23, !97, !98, !99, !100, !21, !101}
!93 = !DIBasicType(name: "i8", size: 8, encoding: DW_ATE_signed)
!94 = !DIBasicType(name: "u64", size: 64, encoding: DW_ATE_unsigned)
!95 = !DIBasicType(name: "f32", size: 32, encoding: DW_ATE_float)
!96 = !DIBasicType(name: "isize", size: 64, encoding: DW_ATE_signed)
!97 = !DIBasicType(name: "i128", size: 128, encoding: DW_ATE_signed)
!98 = !DIBasicType(name: "u128", size: 128, encoding: DW_ATE_unsigned)
!99 = !DIBasicType(name: "f16", size: 16, encoding: DW_ATE_float)
!100 = !DIBasicType(name: "f128", size: 128, encoding: DW_ATE_float)
!101 = !DIBasicType(name: "char", size: 32, encoding: DW_ATE_UTF)
!102 = !{!103, !104, !105, !106, !107, !108, !109, !110, !111, !112, !113, !114, !115}
!103 = !DILocalVariable(name: "a", arg: 1, scope: !90, file: !3, line: 132, type: !93)
!104 = !DILocalVariable(name: "b", arg: 2, scope: !90, file: !3, line: 132, type: !94)
!105 = !DILocalVariable(name: "c", arg: 3, scope: !90, file: !3, line: 132, type: !95)
!106 = !DILocalVariable(name: "d", arg: 4, scope: !90, file: !3, line: 132, type: !10)
!107 = !DILocalVariable(name: "e", arg: 5, scope: !90, file: !3, line: 132, type: !96)
!108 = !DILocalVariable(name: "f", arg: 6, scope: !90, file: !3, line: 132, type: !23)
!109 = !DILocalVariable(name: "g", arg: 7, scope: !90, file: !3, line: 132, type: !97)
!110 = !DILocalVariable(name: "h", arg: 8, scope: !90, file: !3, line: 132, type: !98)
!111 = !DILocalVariable(name: "i", arg: 9, scope: !90, file: !3, line: 132, type: !99)
!112 = !DILocalVariable(name: "j", arg: 10, scope: !90, file: !3, line: 132, type: !100)
!113 = !DILocalVariable(name: "k", scope: !90, file: !3, line: 132, type: !21, align: 8)
!114 = !DILocalVariable(name: "l", arg: 12, scope: !90, file: !3, line: 132, type: !101)
!115 = !DILocalVariable(arg: 11, scope: !90, file: !3, line: 132, type: !21)
!116 = !{i64 -5181654353206422152}
!117 = !DILocation(line: 132, column: 15, scope: !90)
!118 = !DILocation(line: 132, column: 22, scope: !90)
!119 = !DILocation(line: 132, column: 30, scope: !90)
!120 = !DILocation(line: 132, column: 38, scope: !90)
!121 = !DILocation(line: 132, column: 46, scope: !90)
!122 = !DILocation(line: 132, column: 56, scope: !90)
!123 = !DILocation(line: 132, column: 66, scope: !90)
!124 = !DILocation(line: 132, column: 75, scope: !90)
!125 = !DILocation(line: 132, column: 84, scope: !90)
!126 = !DILocation(line: 132, column: 92, scope: !90)
!127 = !DILocation(line: 132, column: 101, scope: !90)
!128 = !DILocation(line: 132, column: 108, scope: !90)
!129 = !DILocation(line: 135, column: 2, scope: !90)
!130 = distinct !DISubprogram(name: "closure", scope: !2, file: !3, line: 151, type: !131, scopeLine: 151, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13, retainedNodes: !133)
!131 = !DISubroutineType(types: !132)
!132 = !{!45, !45}
!133 = !{!134, !135}
!134 = !DILocalVariable(name: "x", arg: 1, scope: !130, file: !3, line: 151, type: !45)
!135 = !DILocalVariable(name: "c", scope: !136, file: !3, line: 152, type: !46, align: 32)
!136 = distinct !DILexicalBlock(scope: !130, file: !3, line: 152, column: 5)
!137 = !{i64 -8001930764763462056}
!138 = !DILocation(line: 151, column: 16, scope: !130)
!139 = !DILocation(line: 152, column: 13, scope: !130)
!140 = !DILocation(line: 152, column: 9, scope: !136)
!141 = !DILocation(line: 153, column: 5, scope: !136)
!142 = !DILocation(line: 154, column: 2, scope: !130)
!143 = distinct !DISubprogram(name: "enums", scope: !2, file: !3, line: 122, type: !144, scopeLine: 122, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13, retainedNodes: !265)
!144 = !DISubroutineType(types: !145)
!145 = !{!45, !36, !146, !162, !176, !190, !199, !216, !227}
!146 = !DICompositeType(tag: DW_TAG_structure_type, name: "Tagged", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !147, templateParams: !13, identifier: "7a09859a618fbf60b7f03e353ea66444")
!147 = !{!148}
!148 = !DICompositeType(tag: DW_TAG_variant_part, scope: !146, file: !5, size: 128, align: 64, elements: !149, templateParams: !13, identifier: "b7ca2db5c6c6a2872f400277fb5bc070", discriminator: !161)
!149 = !{!150, !154, !159}
!150 = !DIDerivedType(tag: DW_TAG_member, name: "One", scope: !148, file: !5, baseType: !151, size: 128, align: 64, extraData: i8 0)
!151 = !DICompositeType(tag: DW_TAG_structure_type, name: "One", scope: !146, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !152, templateParams: !13, identifier: "c665cbede025898820f5e95706c59e3d")
!152 = !{!153}
!153 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !151, file: !5, baseType: !45, size: 32, align: 32, offset: 32, flags: DIFlagPublic)
!154 = !DIDerivedType(tag: DW_TAG_member, name: "Two", scope: !148, file: !5, baseType: !155, size: 128, align: 64, extraData: i8 1)
!155 = !DICompositeType(tag: DW_TAG_structure_type, name: "Two", scope: !146, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !156, templateParams: !13, identifier: "c09a96c7dcac441a491510fc40babb8")
!156 = !{!157, !158}
!157 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !155, file: !5, baseType: !94, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!158 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !155, file: !5, baseType: !93, size: 8, align: 8, offset: 8, flags: DIFlagPublic)
!159 = !DIDerivedType(tag: DW_TAG_member, name: "Three", scope: !148, file: !5, baseType: !160, size: 128, align: 64, extraData: i8 2)
!160 = !DICompositeType(tag: DW_TAG_structure_type, name: "Three", scope: !146, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !13, identifier: "42f47fc3dc3096c640fb5aebb978d263")
!161 = !DIDerivedType(tag: DW_TAG_member, scope: !146, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagArtificial)
!162 = !DICompositeType(tag: DW_TAG_structure_type, name: "Option<&u32>", scope: !2, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !163, templateParams: !13, identifier: "ed51b03b247287f78ba1f38cb9acddcc")
!163 = !{!164}
!164 = !DICompositeType(tag: DW_TAG_variant_part, scope: !162, file: !5, size: 64, align: 64, elements: !165, templateParams: !13, identifier: "ae32a9af7e260cba48efc82e55efccc", discriminator: !175)
!165 = !{!166, !171}
!166 = !DIDerivedType(tag: DW_TAG_member, name: "None", scope: !164, file: !5, baseType: !167, size: 64, align: 64, extraData: i64 0)
!167 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !162, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !13, templateParams: !168, identifier: "f0a46f3663c63171c9dc683a6faecac0")
!168 = !{!169}
!169 = !DITemplateTypeParameter(name: "T", type: !170)
!170 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&u32", baseType: !45, size: 64, align: 64, dwarfAddressSpace: 0)
!171 = !DIDerivedType(tag: DW_TAG_member, name: "Some", scope: !164, file: !5, baseType: !172, size: 64, align: 64)
!172 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !162, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !173, templateParams: !168, identifier: "8d7c597acf3c283f429ba8765eea1968")
!173 = !{!174}
!174 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !172, file: !5, baseType: !170, size: 64, align: 64, flags: DIFlagPublic)
!175 = !DIDerivedType(tag: DW_TAG_member, scope: !162, file: !5, baseType: !94, size: 64, align: 64, flags: DIFlagArtificial)
!176 = !DICompositeType(tag: DW_TAG_structure_type, name: "Niche", scope: !2, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !177, templateParams: !13, identifier: "2e768aced9ebecf4f9b14578e52e8ced")
!177 = !{!178}
!178 = !DICompositeType(tag: DW_TAG_variant_part, scope: !176, file: !5, size: 8, align: 8, elements: !179, templateParams: !13, identifier: "67ec8bf44e3fe796e5f398ca9090500e", discriminator: !189)
!179 = !{!180, !185, !187}
!180 = !DIDerivedType(tag: DW_TAG_member, name: "A", scope: !178, file: !5, baseType: !181, size: 8, align: 8)
!181 = !DICompositeType(tag: DW_TAG_structure_type, name: "A", scope: !176, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !182, templateParams: !13, identifier: "199633efd9ee9f6fc1ce5b3db71839a8")
!182 = !{!183}
!183 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !181, file: !5, baseType: !184, size: 8, align: 8, flags: DIFlagPublic)
!184 = !DIBasicType(name: "bool", size: 8, encoding: DW_ATE_boolean)
!185 = !DIDerivedType(tag: DW_TAG_member, name: "B", scope: !178, file: !5, baseType: !186, size: 8, align: 8, extraData: i8 2)
!186 = !DICompositeType(tag: DW_TAG_structure_type, name: "B", scope: !176, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !13, identifier: "79e87793cf0c2eacd81fa34d6de2e77")
!187 = !DIDerivedType(tag: DW_TAG_member, name: "C", scope: !178, file: !5, baseType: !188, size: 8, align: 8, extraData: i8 3)
!188 = !DICompositeType(tag: DW_TAG_structure_type, name: "C", scope: !176, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !13, identifier: "c68aa38615ac2ea80174f362c1f697a")
!189 = !DIDerivedType(tag: DW_TAG_member, scope: !176, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagArtificial)
!190 = !DICompositeType(tag: DW_TAG_structure_type, name: "Single", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !191, templateParams: !13, identifier: "99e2882fa157a99c759e60ab9c3b3f65")
!191 = !{!192}
!192 = !DICompositeType(tag: DW_TAG_variant_part, scope: !190, file: !5, size: 128, align: 64, elements: !193, templateParams: !13, identifier: "d18d65615c7b3b9e8e771a7d156b5ed4")
!193 = !{!194}
!194 = !DIDerivedType(tag: DW_TAG_member, name: "Only", scope: !192, file: !5, baseType: !195, size: 128, align: 64)
!195 = !DICompositeType(tag: DW_TAG_structure_type, name: "Only", scope: !190, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !196, templateParams: !13, identifier: "d78e06573f5341017ca9ac123671afa6")
!196 = !{!197, !198}
!197 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !195, file: !5, baseType: !45, size: 32, align: 32, offset: 64, flags: DIFlagPublic)
!198 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !195, file: !5, baseType: !94, size: 64, align: 64, flags: DIFlagPublic)
!199 = !DICompositeType(tag: DW_TAG_structure_type, name: "Option<&types::Empty>", scope: !2, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !200, templateParams: !13, identifier: "9ec6ad741cd0cf6e134acb98a307d263")
!200 = !{!201}
!201 = !DICompositeType(tag: DW_TAG_variant_part, scope: !199, file: !5, size: 64, align: 64, elements: !202, templateParams: !13, identifier: "2b71ad15b4796c5e59d0f0f8a43cf830", discriminator: !215)
!202 = !{!203, !211}
!203 = !DIDerivedType(tag: DW_TAG_member, name: "None", scope: !201, file: !5, baseType: !204, size: 64, align: 64, extraData: i64 0)
!204 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !199, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !13, templateParams: !205, identifier: "40e79cf9f10dccd63132410c3a601fa7")
!205 = !{!206}
!206 = !DITemplateTypeParameter(name: "T", type: !207)
!207 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::Empty", baseType: !208, size: 64, align: 64, dwarfAddressSpace: 0)
!208 = !DICompositeType(tag: DW_TAG_structure_type, name: "Empty", scope: !2, file: !5, align: 8, flags: DIFlagPublic, elements: !209, templateParams: !13, identifier: "64e96f3ce920dff82e10d4b6a35be4fb")
!209 = !{!210}
!210 = !DICompositeType(tag: DW_TAG_variant_part, scope: !208, file: !5, align: 8, elements: !13, identifier: "9434eb7708c8478da5032a9bd7a36f9c")
!211 = !DIDerivedType(tag: DW_TAG_member, name: "Some", scope: !201, file: !5, baseType: !212, size: 64, align: 64)
!212 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !199, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !213, templateParams: !205, identifier: "d733b5aa48f30b7797ac71a20eabbe3c")
!213 = !{!214}
!214 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !212, file: !5, baseType: !207, size: 64, align: 64, flags: DIFlagPublic)
!215 = !DIDerivedType(tag: DW_TAG_member, scope: !199, file: !5, baseType: !94, size: 64, align: 64, flags: DIFlagArtificial)
!216 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wide", scope: !2, file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !217, templateParams: !13, identifier: "580c897493afe5768312143f2fc7c866")
!217 = !{!218}
!218 = !DICompositeType(tag: DW_TAG_variant_part, scope: !216, file: !5, size: 256, align: 128, elements: !219, templateParams: !13, identifier: "4ebd4a46ef8e1b8ecda51a56fa6bf30e", discriminator: !226)
!219 = !{!220, !224}
!220 = !DIDerivedType(tag: DW_TAG_member, name: "X", scope: !218, file: !5, baseType: !221, size: 256, align: 128, extraData: i128 1)
!221 = !DICompositeType(tag: DW_TAG_structure_type, name: "X", scope: !216, file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !222, templateParams: !13, identifier: "edbe3ce3537b8454a1586fee1f8f976f")
!222 = !{!223}
!223 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !221, file: !5, baseType: !12, size: 8, align: 8, offset: 128, flags: DIFlagPublic)
!224 = !DIDerivedType(tag: DW_TAG_member, name: "Y", scope: !218, file: !5, baseType: !225, size: 256, align: 128, extraData: i128 1208925819614629174706175)
!225 = !DICompositeType(tag: DW_TAG_structure_type, name: "Y", scope: !216, file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !13, identifier: "af4b7981b1de14baf478bdaf175e1a20")
!226 = !DIDerivedType(tag: DW_TAG_member, scope: !216, file: !5, baseType: !98, size: 128, align: 128, flags: DIFlagArtificial)
!227 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::Rec<u8>", baseType: !228, size: 64, align: 64, dwarfAddressSpace: 0)
!228 = !DICompositeType(tag: DW_TAG_structure_type, name: "Rec<u8>", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !229, templateParams: !13, identifier: "bdcb87c0e6172cf96ca64813776a9af5")
!229 = !{!230}
!230 = !DICompositeType(tag: DW_TAG_variant_part, scope: !228, file: !5, size: 128, align: 64, elements: !231, templateParams: !13, identifier: "edc4b13ab14e4adebc22fdc7603c88f9", discriminator: !264)
!231 = !{!232, !260}
!232 = !DIDerivedType(tag: DW_TAG_member, name: "Recurse", scope: !230, file: !5, baseType: !233, size: 128, align: 64, extraData: i8 0)
!233 = !DICompositeType(tag: DW_TAG_structure_type, name: "Recurse", scope: !228, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !234, templateParams: !253, identifier: "47d9e89338842c2a9b75f1a10a02ddd8")
!234 = !{!235}
!235 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !233, file: !5, baseType: !236, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!236 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const types::Rec<types::Pair2<u8>>", baseType: !237, size: 64, align: 64, dwarfAddressSpace: 0)
!237 = !DICompositeType(tag: DW_TAG_structure_type, name: "Rec<types::Pair2<u8>>", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !238, templateParams: !13, identifier: "5ede9f07d678e971a0ca7153f666e62")
!238 = !{!239}
!239 = !DICompositeType(tag: DW_TAG_variant_part, scope: !237, file: !5, size: 128, align: 64, elements: !240, templateParams: !13, identifier: "546f46916dc2b0f2ea600f020e8eb308", discriminator: !259)
!240 = !{!241, !255}
!241 = !DIDerivedType(tag: DW_TAG_member, name: "Recurse", scope: !239, file: !5, baseType: !242, size: 128, align: 64, extraData: i8 0)
!242 = !DICompositeType(tag: DW_TAG_structure_type, name: "Recurse", scope: !237, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !243, templateParams: !247, identifier: "ade1e3fa13f1df495ef599f3dbd8a94c")
!243 = !{!244}
!244 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !242, file: !5, baseType: !245, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!245 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const types::Rec<types::Pair2<types::Pair2<u8>>>", baseType: !246, size: 64, align: 64, dwarfAddressSpace: 0)
!246 = !DICompositeType(tag: DW_TAG_structure_type, name: "Rec<types::Pair2<types::Pair2<u8>>>", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !13, identifier: "54791e7a79c18c75653e890640491966")
!247 = !{!248}
!248 = !DITemplateTypeParameter(name: "T", type: !249)
!249 = !DICompositeType(tag: DW_TAG_structure_type, name: "Pair2<u8>", scope: !2, file: !5, size: 16, align: 8, flags: DIFlagPublic, elements: !250, templateParams: !253, identifier: "317b48cb039e3e7fb5a8fbd2cc6135a5")
!250 = !{!251, !252}
!251 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !249, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagPrivate)
!252 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !249, file: !5, baseType: !12, size: 8, align: 8, offset: 8, flags: DIFlagPrivate)
!253 = !{!254}
!254 = !DITemplateTypeParameter(name: "T", type: !12)
!255 = !DIDerivedType(tag: DW_TAG_member, name: "Item", scope: !239, file: !5, baseType: !256, size: 128, align: 64, extraData: i8 1)
!256 = !DICompositeType(tag: DW_TAG_structure_type, name: "Item", scope: !237, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !257, templateParams: !247, identifier: "cee43346f500b874e72e06bc2d9e234a")
!257 = !{!258}
!258 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !256, file: !5, baseType: !249, size: 16, align: 8, offset: 8, flags: DIFlagPublic)
!259 = !DIDerivedType(tag: DW_TAG_member, scope: !237, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagArtificial)
!260 = !DIDerivedType(tag: DW_TAG_member, name: "Item", scope: !230, file: !5, baseType: !261, size: 128, align: 64, extraData: i8 1)
!261 = !DICompositeType(tag: DW_TAG_structure_type, name: "Item", scope: !228, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !262, templateParams: !253, identifier: "8bbff529e44d2a45a49c95f6b6c9380")
!262 = !{!263}
!263 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !261, file: !5, baseType: !12, size: 8, align: 8, offset: 8, flags: DIFlagPublic)
!264 = !DIDerivedType(tag: DW_TAG_member, scope: !228, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagArtificial)
!265 = !{!266, !267, !268, !269, !270, !271, !272, !273}
!266 = !DILocalVariable(name: "c", arg: 1, scope: !143, file: !3, line: 122, type: !36)
!267 = !DILocalVariable(name: "t", arg: 2, scope: !143, file: !3, line: 122, type: !146)
!268 = !DILocalVariable(name: "o", arg: 3, scope: !143, file: !3, line: 122, type: !162)
!269 = !DILocalVariable(name: "n", arg: 4, scope: !143, file: !3, line: 122, type: !176)
!270 = !DILocalVariable(name: "s", arg: 5, scope: !143, file: !3, line: 122, type: !190)
!271 = !DILocalVariable(name: "e", arg: 6, scope: !143, file: !3, line: 122, type: !199)
!272 = !DILocalVariable(name: "w", arg: 7, scope: !143, file: !3, line: 122, type: !216)
!273 = !DILocalVariable(name: "r", arg: 8, scope: !143, file: !3, line: 122, type: !227)
!274 = !{i64 -6981848288932498368}
!275 = !DILocation(line: 122, column: 14, scope: !143)
!276 = !DILocation(line: 122, column: 24, scope: !143)
!277 = !DILocation(line: 122, column: 35, scope: !143)
!278 = !DILocation(line: 122, column: 52, scope: !143)
!279 = !DILocation(line: 122, column: 62, scope: !143)
!280 = !DILocation(line: 122, column: 73, scope: !143)
!281 = !DILocation(line: 122, column: 92, scope: !143)
!282 = !DILocation(line: 122, column: 101, scope: !143)
!283 = !DILocation(line: 125, column: 2, scope: !143)
!284 = distinct !DISubprogram(name: "global", scope: !2, file: !3, line: 165, type: !285, scopeLine: 165, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13)
!285 = !DISubroutineType(types: !286)
!286 = !{!83}
!287 = !{i64 7866218443099566236}
!288 = !DILocation(line: 167, column: 2, scope: !284)
!289 = distinct !DISubprogram(name: "never", scope: !2, file: !3, line: 141, type: !290, scopeLine: 141, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13, retainedNodes: !292)
!290 = !DISubroutineType(types: !291)
!291 = !{!45, !184}
!292 = !{!293}
!293 = !DILocalVariable(name: "flag", arg: 1, scope: !289, file: !3, line: 141, type: !184)
!294 = !{i64 4169515925740803783}
!295 = !DILocation(line: 141, column: 14, scope: !289)
!296 = !DILocation(line: 142, column: 8, scope: !289)
!297 = !DILocation(line: 146, column: 2, scope: !289)
!298 = !DILocation(line: 143, column: 9, scope: !289)
!299 = distinct !DISubprogram(name: "pointers", scope: !2, file: !3, line: 127, type: !300, scopeLine: 127, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13, retainedNodes: !331)
!300 = !DISubroutineType(types: !301)
!301 = !{!45, !302, !308, !313, !323, !324, !327, !328}
!302 = !DICompositeType(tag: DW_TAG_structure_type, name: "&[i64]", file: !5, size: 128, align: 64, elements: !303, templateParams: !13, identifier: "b4a8090213073d4713897d6f185bba6b")
!303 = !{!304, !307}
!304 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !302, file: !5, baseType: !305, size: 64, align: 64)
!305 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !306, size: 64, align: 64, dwarfAddressSpace: 0)
!306 = !DIBasicType(name: "i64", size: 64, encoding: DW_ATE_signed)
!307 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !302, file: !5, baseType: !23, size: 64, align: 64, offset: 64)
!308 = !DICompositeType(tag: DW_TAG_structure_type, name: "&str", file: !5, size: 128, align: 64, elements: !309, templateParams: !13, identifier: "6fc9dd7daffb1f73292744aea0793200")
!309 = !{!310, !312}
!310 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !308, file: !5, baseType: !311, size: 64, align: 64)
!311 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !12, size: 64, align: 64, dwarfAddressSpace: 0)
!312 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !308, file: !5, baseType: !23, size: 64, align: 64, offset: 64)
!313 = !DICompositeType(tag: DW_TAG_structure_type, name: "&dyn types::Shape", file: !5, size: 128, align: 64, elements: !314, templateParams: !13, identifier: "fe29d79d289ba2d7e0ec59f2c9f4dc75")
!314 = !{!315, !318}
!315 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !313, file: !5, baseType: !316, size: 64, align: 64)
!316 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !317, size: 64, align: 64, dwarfAddressSpace: 0)
!317 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn types::Shape", file: !5, align: 8, elements: !13, identifier: "b991d0562d06e41c69a1bb075371dbaa")
!318 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !313, file: !5, baseType: !319, size: 64, align: 64, offset: 64)
!319 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&[usize; 4]", baseType: !320, size: 64, align: 64, dwarfAddressSpace: 0)
!320 = !DICompositeType(tag: DW_TAG_array_type, baseType: !23, size: 256, align: 64, elements: !321)
!321 = !{!322}
!322 = !DISubrange(count: 4, lowerBound: 0)
!323 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const u8", baseType: !12, size: 64, align: 64, dwarfAddressSpace: 0)
!324 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&mut [u16; 4]", baseType: !325, size: 64, align: 64, dwarfAddressSpace: 0)
!325 = !DICompositeType(tag: DW_TAG_array_type, baseType: !326, size: 64, align: 16, elements: !321)
!326 = !DIBasicType(name: "u16", size: 16, encoding: DW_ATE_unsigned)
!327 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "fn(u32) -> u32", baseType: !131, size: 64, align: 64, dwarfAddressSpace: 0)
!328 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::{extern#0}::Opaque", baseType: !329, size: 64, align: 64, dwarfAddressSpace: 0)
!329 = !DICompositeType(tag: DW_TAG_structure_type, name: "Opaque", scope: !330, file: !5, align: 8, elements: !13, identifier: "a3877f7c886e7d8757337d2282356247")
!330 = !DINamespace(name: "{extern#0}", scope: !2)
!331 = !{!332, !333, !334, !335, !336, !337, !338}
!332 = !DILocalVariable(name: "sl", arg: 1, scope: !299, file: !3, line: 127, type: !302)
!333 = !DILocalVariable(name: "s", arg: 2, scope: !299, file: !3, line: 127, type: !308)
!334 = !DILocalVariable(name: "d", arg: 3, scope: !299, file: !3, line: 127, type: !313)
!335 = !DILocalVariable(name: "raw", arg: 4, scope: !299, file: !3, line: 127, type: !323)
!336 = !DILocalVariable(name: "m", arg: 5, scope: !299, file: !3, line: 127, type: !324)
!337 = !DILocalVariable(name: "f", arg: 6, scope: !299, file: !3, line: 127, type: !327)
!338 = !DILocalVariable(name: "op", arg: 7, scope: !299, file: !3, line: 127, type: !328)
!339 = !{i64 5285204393774026867}
!340 = !DILocation(line: 127, column: 17, scope: !299)
!341 = !DILocation(line: 127, column: 29, scope: !299)
!342 = !DILocation(line: 127, column: 38, scope: !299)
!343 = !DILocation(line: 127, column: 53, scope: !299)
!344 = !DILocation(line: 127, column: 69, scope: !299)
!345 = !DILocation(line: 127, column: 87, scope: !299)
!346 = !DILocation(line: 127, column: 106, scope: !299)
!347 = !DILocation(line: 129, column: 5, scope: !299)
!348 = !DILocation(line: 129, column: 7, scope: !299)
!349 = !DILocation(line: 130, column: 2, scope: !299)
!350 = distinct !DISubprogram(name: "recursive_fn_type", scope: !2, file: !3, line: 172, type: !351, scopeLine: 172, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13)
!351 = !DISubroutineType(types: !352)
!352 = !{!45}
!353 = !{i64 -4635464101160348947}
!354 = !DILocation(line: 173, column: 10, scope: !350)
!355 = !DILocation(line: 173, column: 5, scope: !350)
!356 = !DILocation(line: 174, column: 2, scope: !350)
!357 = distinct !DISubprogram(name: "structs", scope: !2, file: !3, line: 117, type: !358, scopeLine: 117, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13, retainedNodes: !393)
!358 = !DISubroutineType(types: !359)
!359 = !{!45, !83, !360, !364, !365, !375}
!360 = !DICompositeType(tag: DW_TAG_structure_type, name: "Pair", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !361, templateParams: !13, identifier: "94ca5408626465f7a23119eb31190947")
!361 = !{!362, !363}
!362 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !360, file: !5, baseType: !326, size: 16, align: 16, offset: 64, flags: DIFlagPublic)
!363 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !360, file: !5, baseType: !306, size: 64, align: 64, flags: DIFlagPrivate)
!364 = !DICompositeType(tag: DW_TAG_structure_type, name: "Unit", scope: !2, file: !5, align: 8, flags: DIFlagPublic, elements: !13, identifier: "b08e6297ec0e9e2a1f0a6ab3d7c35d9b")
!365 = !DICompositeType(tag: DW_TAG_structure_type, name: "Gen<u8, (char, bool)>", scope: !2, file: !5, size: 96, align: 32, flags: DIFlagPublic, elements: !366, templateParams: !373, identifier: "5a83877b5744ceaeffe9ee3edc8fae67")
!366 = !{!367, !368}
!367 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !365, file: !5, baseType: !12, size: 8, align: 8, offset: 64, flags: DIFlagPrivate)
!368 = !DIDerivedType(tag: DW_TAG_member, name: "u", scope: !365, file: !5, baseType: !369, size: 64, align: 32, flags: DIFlagPrivate)
!369 = !DICompositeType(tag: DW_TAG_structure_type, name: "(char, bool)", file: !5, size: 64, align: 32, elements: !370, templateParams: !13, identifier: "23b612e9e1a9e610ca072c9f53b8f4c4")
!370 = !{!371, !372}
!371 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !369, file: !5, baseType: !101, size: 32, align: 32)
!372 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !369, file: !5, baseType: !184, size: 8, align: 8, offset: 32)
!373 = !{!254, !374}
!374 = !DITemplateTypeParameter(name: "U", type: !369)
!375 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::List", baseType: !376, size: 64, align: 64, dwarfAddressSpace: 0)
!376 = !DICompositeType(tag: DW_TAG_structure_type, name: "List", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !377, templateParams: !13, identifier: "784c52a69e4fd732fc2cb610c53ce42b")
!377 = !{!378, !392}
!378 = !DIDerivedType(tag: DW_TAG_member, name: "next", scope: !376, file: !5, baseType: !379, size: 64, align: 64, flags: DIFlagPrivate)
!379 = !DICompositeType(tag: DW_TAG_structure_type, name: "Option<&types::List>", scope: !2, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !380, templateParams: !13, identifier: "81608bde9c02ca68284619d5a8da3749")
!380 = !{!381}
!381 = !DICompositeType(tag: DW_TAG_variant_part, scope: !379, file: !5, size: 64, align: 64, elements: !382, templateParams: !13, identifier: "9911bbd4c8f3bdf55bc77752a0a44022", discriminator: !391)
!382 = !{!383, !387}
!383 = !DIDerivedType(tag: DW_TAG_member, name: "None", scope: !381, file: !5, baseType: !384, size: 64, align: 64, extraData: i64 0)
!384 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !379, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !13, templateParams: !385, identifier: "e1386b739e649cc1b2ae583acd057ecc")
!385 = !{!386}
!386 = !DITemplateTypeParameter(name: "T", type: !375)
!387 = !DIDerivedType(tag: DW_TAG_member, name: "Some", scope: !381, file: !5, baseType: !388, size: 64, align: 64)
!388 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !379, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !389, templateParams: !385, identifier: "89da0816b97d49e3dac2e41fc3e93b83")
!389 = !{!390}
!390 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !388, file: !5, baseType: !375, size: 64, align: 64, flags: DIFlagPublic)
!391 = !DIDerivedType(tag: DW_TAG_member, scope: !379, file: !5, baseType: !94, size: 64, align: 64, flags: DIFlagArtificial)
!392 = !DIDerivedType(tag: DW_TAG_member, name: "v", scope: !376, file: !5, baseType: !8, size: 32, align: 32, offset: 64, flags: DIFlagPrivate)
!393 = !{!394, !395, !396, !397, !398, !399}
!394 = !DILocalVariable(name: "p", arg: 1, scope: !357, file: !3, line: 117, type: !83)
!395 = !DILocalVariable(name: "q", arg: 2, scope: !357, file: !3, line: 117, type: !360)
!396 = !DILocalVariable(name: "_u", scope: !357, file: !3, line: 117, type: !364, align: 8)
!397 = !DILocalVariable(name: "g", arg: 4, scope: !357, file: !3, line: 117, type: !365)
!398 = !DILocalVariable(name: "l", arg: 5, scope: !357, file: !3, line: 117, type: !375)
!399 = !DILocalVariable(arg: 3, scope: !357, file: !3, line: 117, type: !364)
!400 = !{i64 -3801848370686489254}
!401 = !DILocation(line: 117, column: 16, scope: !357)
!402 = !DILocation(line: 117, column: 27, scope: !357)
!403 = !DILocation(line: 117, column: 36, scope: !357)
!404 = !DILocation(line: 117, column: 46, scope: !357)
!405 = !DILocation(line: 117, column: 72, scope: !357)
!406 = !DILocation(line: 119, column: 5, scope: !357)
!407 = !DILocation(line: 120, column: 2, scope: !357)
!408 = distinct !DISubprogram(name: "union_", scope: !2, file: !3, line: 137, type: !409, scopeLine: 137, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13, retainedNodes: !415)
!409 = !DISubroutineType(types: !410)
!410 = !{!45, !411}
!411 = !DICompositeType(tag: DW_TAG_union_type, name: "U", scope: !2, file: !5, size: 32, align: 32, elements: !412, templateParams: !13, identifier: "e8c023c6fa2b313aec2f51fb48fcaef3")
!412 = !{!413, !414}
!413 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !411, file: !5, baseType: !45, size: 32, align: 32)
!414 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !411, file: !5, baseType: !95, size: 32, align: 32)
!415 = !{!416}
!416 = !DILocalVariable(name: "u", arg: 1, scope: !408, file: !3, line: 137, type: !411)
!417 = !{i64 3738193153085972219}
!418 = !DILocation(line: 137, column: 15, scope: !408)
!419 = !DILocation(line: 138, column: 14, scope: !408)
!420 = !DILocation(line: 139, column: 2, scope: !408)
!421 = distinct !DISubprogram(name: "visibility", scope: !2, file: !3, line: 185, type: !422, scopeLine: 185, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13, retainedNodes: !432)
!422 = !DISubroutineType(types: !423)
!423 = !{!12, !424}
!424 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::inner::Vis", baseType: !425, size: 64, align: 64, dwarfAddressSpace: 0)
!425 = !DICompositeType(tag: DW_TAG_structure_type, name: "Vis", scope: !426, file: !5, size: 32, align: 8, flags: DIFlagPublic, elements: !427, templateParams: !13, identifier: "c8763aed17c9ea6b868c91e2dc0d11a2")
!426 = !DINamespace(name: "inner", scope: !2)
!427 = !{!428, !429, !430, !431}
!428 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !425, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagProtected)
!429 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !425, file: !5, baseType: !12, size: 8, align: 8, offset: 8, flags: DIFlagProtected)
!430 = !DIDerivedType(tag: DW_TAG_member, name: "c", scope: !425, file: !5, baseType: !12, size: 8, align: 8, offset: 16, flags: DIFlagPrivate)
!431 = !DIDerivedType(tag: DW_TAG_member, name: "d", scope: !425, file: !5, baseType: !12, size: 8, align: 8, offset: 24, flags: DIFlagPublic)
!432 = !{!433}
!433 = !DILocalVariable(name: "v", arg: 1, scope: !421, file: !3, line: 185, type: !424)
!434 = !{i64 3148254357277744119}
!435 = !DILocation(line: 185, column: 19, scope: !421)
!436 = !DILocation(line: 186, column: 5, scope: !421)
!437 = !DILocation(line: 187, column: 2, scope: !421)
!438 = distinct !DISubprogram(name: "vtable", scope: !2, file: !3, line: 161, type: !439, scopeLine: 161, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !33, templateParams: !13, retainedNodes: !441)
!439 = !DISubroutineType(types: !440)
!440 = !{!313, !83}
!441 = !{!442}
!442 = !DILocalVariable(name: "p", arg: 1, scope: !438, file: !3, line: 161, type: !83)
!443 = !{i64 3405836996193402751}
!444 = !DILocation(line: 161, column: 15, scope: !438)
!445 = !DILocation(line: 163, column: 2, scope: !438)

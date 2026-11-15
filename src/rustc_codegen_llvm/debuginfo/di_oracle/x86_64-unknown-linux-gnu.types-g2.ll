; ModuleID = 'types.ca9a2c18325d504-cgu.0'
source_filename = "types.ca9a2c18325d504-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@_RNvCs15oYSsIuqjM_5types6GLOBAL = constant <{ [13 x i8], [3 x i8] }> <{ [13 x i8] c"\00\00\00\00\00\00\00@\01\00\00\00\03", [3 x i8] undef }>, align 8, !dbg !0, !guid !14
@vtable.0 = private constant [24 x i8] c"\00\00\00\00\00\00\00\00\04\00\00\00\00\00\00\00\04\00\00\00\00\00\00\00", align 8, !dbg !15, !guid !26
@vtable.1 = private constant <{ [24 x i8], ptr }> <{ [24 x i8] c"\00\00\00\00\00\00\00\00\10\00\00\00\00\00\00\00\08\00\00\00\00\00\00\00", ptr @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area }>, align 8, !dbg !27, !guid !35

; types::take::<types::closure::{closure#0}>
; Function Attrs: noinline nonlazybind uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %t) unnamed_addr #0 !dbg !51 !guid !62 {
start:
  %t.dbg.spill = alloca [4 x i8], align 4
  store i32 %t, ptr %t.dbg.spill, align 4
    #dbg_declare(ptr %t.dbg.spill, !59, !DIExpression(), !63)
  ret i32 0, !dbg !64
}

; types::take::<types::rec_impl>
; Function Attrs: noinline nonlazybind uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_() unnamed_addr #0 !dbg !65 !guid !76 {
start:
  %t.dbg.spill = alloca [0 x i8], align 1
    #dbg_declare(ptr %t.dbg.spill, !73, !DIExpression(), !77)
  ret i32 0, !dbg !78
}

; types::diverge
; Function Attrs: noreturn nonlazybind uwtable
define internal void @_RNvCs15oYSsIuqjM_5types7diverge() unnamed_addr #1 !dbg !79 !guid !82 {
start:
  br label %bb1, !dbg !83

bb1:                                              ; preds = %bb1, %start
  br label %bb1, !dbg !83
}

; types::rec_impl
; Function Attrs: nonlazybind uwtable
define void @_RNvCs15oYSsIuqjM_5types8rec_impl() unnamed_addr #2 !dbg !84 !guid !85 {
start:
  ret void, !dbg !86
}

; <types::Point as types::Shape>::area
; Function Attrs: nonlazybind uwtable
define i32 @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area(ptr align 8 %self) unnamed_addr #2 !dbg !87 !guid !94 {
start:
  %self.dbg.spill = alloca [8 x i8], align 8
  store ptr %self, ptr %self.dbg.spill, align 8
    #dbg_declare(ptr %self.dbg.spill, !93, !DIExpression(), !95)
  %0 = getelementptr inbounds i8, ptr %self, i64 12, !dbg !96
  %_2 = load i8, ptr %0, align 4, !dbg !96
  %_0 = zext i8 %_2 to i32, !dbg !96
  ret i32 %_0, !dbg !97
}

; Function Attrs: nonlazybind uwtable
define i32 @basics(i8 %a, i64 %b, float %c, double %d, i64 %e, i64 %f, i128 %g, i128 %h, half %i, fp128 %j, i32 %l) unnamed_addr #2 !dbg !98 !guid !124 {
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
    #dbg_declare(ptr %a.dbg.spill, !111, !DIExpression(), !125)
  store i64 %b, ptr %b.dbg.spill, align 8
    #dbg_declare(ptr %b.dbg.spill, !112, !DIExpression(), !126)
  store float %c, ptr %c.dbg.spill, align 4
    #dbg_declare(ptr %c.dbg.spill, !113, !DIExpression(), !127)
  store double %d, ptr %d.dbg.spill, align 8
    #dbg_declare(ptr %d.dbg.spill, !114, !DIExpression(), !128)
  store i64 %e, ptr %e.dbg.spill, align 8
    #dbg_declare(ptr %e.dbg.spill, !115, !DIExpression(), !129)
  store i64 %f, ptr %f.dbg.spill, align 8
    #dbg_declare(ptr %f.dbg.spill, !116, !DIExpression(), !130)
  store i128 %g, ptr %g.dbg.spill, align 16
    #dbg_declare(ptr %g.dbg.spill, !117, !DIExpression(), !131)
  store i128 %h, ptr %h.dbg.spill, align 16
    #dbg_declare(ptr %h.dbg.spill, !118, !DIExpression(), !132)
  store half %i, ptr %i.dbg.spill, align 2
    #dbg_declare(ptr %i.dbg.spill, !119, !DIExpression(), !133)
  store fp128 %j, ptr %j.dbg.spill, align 16
    #dbg_declare(ptr %j.dbg.spill, !120, !DIExpression(), !134)
    #dbg_declare(ptr %_11.dbg.spill, !123, !DIExpression(), !135)
  store i32 %l, ptr %l.dbg.spill, align 4
    #dbg_declare(ptr %l.dbg.spill, !122, !DIExpression(), !136)
    #dbg_declare(ptr %k.dbg.spill, !121, !DIExpression(), !135)
  ret i32 0, !dbg !137
}

; Function Attrs: nonlazybind uwtable
define i32 @closure(i32 %x) unnamed_addr #2 !dbg !138 !guid !145 {
start:
  %c.dbg.spill = alloca [4 x i8], align 4
  %x.dbg.spill = alloca [4 x i8], align 4
  store i32 %x, ptr %x.dbg.spill, align 4
    #dbg_declare(ptr %x.dbg.spill, !142, !DIExpression(), !146)
  store i32 %x, ptr %c.dbg.spill, align 4, !dbg !147
    #dbg_declare(ptr %c.dbg.spill, !143, !DIExpression(), !148)
; call types::take::<types::closure::{closure#0}>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %x), !dbg !149
  ret i32 %_0, !dbg !150
}

; Function Attrs: nonlazybind uwtable
define i32 @enums(i8 %c, ptr align 8 %t, ptr align 4 %o, i8 %n, i64 %s.0, i32 %s.1, ptr %e, i128 %w.0, i8 %w.1, ptr align 8 %r) unnamed_addr #2 !dbg !151 !guid !282 {
start:
  %r.dbg.spill = alloca [8 x i8], align 8
  %w.dbg.spill = alloca [32 x i8], align 16
  %e.dbg.spill = alloca [8 x i8], align 8
  %s.dbg.spill = alloca [16 x i8], align 8
  %n.dbg.spill = alloca [1 x i8], align 1
  %o.dbg.spill = alloca [8 x i8], align 8
  %c.dbg.spill = alloca [1 x i8], align 1
  store i8 %c, ptr %c.dbg.spill, align 1
    #dbg_declare(ptr %c.dbg.spill, !274, !DIExpression(), !283)
    #dbg_declare(ptr %t, !275, !DIExpression(), !284)
  store ptr %o, ptr %o.dbg.spill, align 8
    #dbg_declare(ptr %o.dbg.spill, !276, !DIExpression(), !285)
  store i8 %n, ptr %n.dbg.spill, align 1
    #dbg_declare(ptr %n.dbg.spill, !277, !DIExpression(), !286)
  store i64 %s.0, ptr %s.dbg.spill, align 8
  %0 = getelementptr inbounds i8, ptr %s.dbg.spill, i64 8
  store i32 %s.1, ptr %0, align 8
    #dbg_declare(ptr %s.dbg.spill, !278, !DIExpression(), !287)
  store ptr %e, ptr %e.dbg.spill, align 8
    #dbg_declare(ptr %e.dbg.spill, !279, !DIExpression(), !288)
  store i128 %w.0, ptr %w.dbg.spill, align 16
  %1 = getelementptr inbounds i8, ptr %w.dbg.spill, i64 16
  store i8 %w.1, ptr %1, align 16
    #dbg_declare(ptr %w.dbg.spill, !280, !DIExpression(), !289)
  store ptr %r, ptr %r.dbg.spill, align 8
    #dbg_declare(ptr %r.dbg.spill, !281, !DIExpression(), !290)
  ret i32 0, !dbg !291
}

; Function Attrs: nonlazybind uwtable
define align 8 ptr @global() unnamed_addr #2 !dbg !292 !guid !295 {
start:
  ret ptr @_RNvCs15oYSsIuqjM_5types6GLOBAL, !dbg !296
}

; Function Attrs: nonlazybind uwtable
define i32 @never(i1 zeroext %flag) unnamed_addr #2 !dbg !297 !guid !302 {
start:
  %flag.dbg.spill = alloca [1 x i8], align 1
  %0 = zext i1 %flag to i8
  store i8 %0, ptr %flag.dbg.spill, align 1
    #dbg_declare(ptr %flag.dbg.spill, !301, !DIExpression(), !303)
  br i1 %flag, label %bb1, label %bb2, !dbg !304

bb2:                                              ; preds = %start
  ret i32 1, !dbg !305

bb1:                                              ; preds = %start
; call types::diverge
  call void @_RNvCs15oYSsIuqjM_5types7diverge() #4, !dbg !306
  unreachable, !dbg !306
}

; Function Attrs: nonlazybind uwtable
define { ptr, ptr } @no_principal(ptr align 4 %x) unnamed_addr #2 !dbg !307 !guid !322 {
start:
  %x.dbg.spill = alloca [8 x i8], align 8
  store ptr %x, ptr %x.dbg.spill, align 8
    #dbg_declare(ptr %x.dbg.spill, !321, !DIExpression(), !323)
  %0 = insertvalue { ptr, ptr } poison, ptr %x, 0, !dbg !324
  %1 = insertvalue { ptr, ptr } %0, ptr @vtable.0, 1, !dbg !324
  ret { ptr, ptr } %1, !dbg !324
}

; Function Attrs: nonlazybind uwtable
define i32 @pointers(ptr align 8 %sl.0, i64 %sl.1, ptr %s.0, i64 %s.1, ptr %d.0, ptr align 8 %d.1, ptr %raw, ptr align 2 %m, ptr %f, ptr %op) unnamed_addr #2 !dbg !325 !guid !365 {
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
    #dbg_declare(ptr %sl.dbg.spill, !358, !DIExpression(), !366)
  store ptr %s.0, ptr %s.dbg.spill, align 8
  %1 = getelementptr inbounds i8, ptr %s.dbg.spill, i64 8
  store i64 %s.1, ptr %1, align 8
    #dbg_declare(ptr %s.dbg.spill, !359, !DIExpression(), !367)
  store ptr %d.0, ptr %d.dbg.spill, align 8
  %2 = getelementptr inbounds i8, ptr %d.dbg.spill, i64 8
  store ptr %d.1, ptr %2, align 8
    #dbg_declare(ptr %d.dbg.spill, !360, !DIExpression(), !368)
  store ptr %raw, ptr %raw.dbg.spill, align 8
    #dbg_declare(ptr %raw.dbg.spill, !361, !DIExpression(), !369)
  store ptr %m, ptr %m.dbg.spill, align 8
    #dbg_declare(ptr %m.dbg.spill, !362, !DIExpression(), !370)
  store ptr %f, ptr %f.dbg.spill, align 8
    #dbg_declare(ptr %f.dbg.spill, !363, !DIExpression(), !371)
  store ptr %op, ptr %op.dbg.spill, align 8
    #dbg_declare(ptr %op.dbg.spill, !364, !DIExpression(), !372)
  %3 = getelementptr inbounds i8, ptr %d.1, i64 24, !dbg !373
  %4 = load ptr, ptr %3, align 8, !dbg !373, !invariant.load !13, !nonnull !13
  %_0 = call i32 %4(ptr %d.0), !dbg !374
  ret i32 %_0, !dbg !375
}

; Function Attrs: nonlazybind uwtable
define i32 @recursive_fn_type() unnamed_addr #2 !dbg !376 !guid !379 {
start:
; call types::rec_impl
  call void @_RNvCs15oYSsIuqjM_5types8rec_impl(), !dbg !380
; call types::take::<types::rec_impl>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_(), !dbg !381
  ret i32 %_0, !dbg !382
}

; Function Attrs: nonlazybind uwtable
define i32 @structs(ptr align 8 %p, i64 %q.0, i16 %q.1, ptr align 4 %g, ptr align 8 %l) unnamed_addr #2 !dbg !383 !guid !426 {
start:
  %_u.dbg.spill = alloca [0 x i8], align 1
  %l.dbg.spill = alloca [8 x i8], align 8
  %_3.dbg.spill = alloca [0 x i8], align 1
  %q.dbg.spill = alloca [16 x i8], align 8
  %p.dbg.spill = alloca [8 x i8], align 8
  store ptr %p, ptr %p.dbg.spill, align 8
    #dbg_declare(ptr %p.dbg.spill, !420, !DIExpression(), !427)
  store i64 %q.0, ptr %q.dbg.spill, align 8
  %0 = getelementptr inbounds i8, ptr %q.dbg.spill, i64 8
  store i16 %q.1, ptr %0, align 8
    #dbg_declare(ptr %q.dbg.spill, !421, !DIExpression(), !428)
    #dbg_declare(ptr %_3.dbg.spill, !425, !DIExpression(), !429)
    #dbg_declare(ptr %g, !423, !DIExpression(), !430)
  store ptr %l, ptr %l.dbg.spill, align 8
    #dbg_declare(ptr %l.dbg.spill, !424, !DIExpression(), !431)
    #dbg_declare(ptr %_u.dbg.spill, !422, !DIExpression(), !429)
  %1 = getelementptr inbounds i8, ptr %p, i64 12, !dbg !432
  %_6 = load i8, ptr %1, align 4, !dbg !432
  %_0 = zext i8 %_6 to i32, !dbg !432
  ret i32 %_0, !dbg !433
}

; Function Attrs: nonlazybind uwtable
define i32 @union_(i32 %0) unnamed_addr #2 !dbg !434 !guid !443 {
start:
  %1 = alloca [4 x i8], align 4
  %u = alloca [4 x i8], align 4
  store i32 %0, ptr %1, align 4
  call void @llvm.memcpy.p0.p0.i64(ptr align 4 %u, ptr align 4 %1, i64 4, i1 false)
    #dbg_declare(ptr %u, !442, !DIExpression(), !444)
  %_0 = load i32, ptr %u, align 4, !dbg !445
  ret i32 %_0, !dbg !446
}

; Function Attrs: nonlazybind uwtable
define i8 @visibility(ptr %v) unnamed_addr #2 !dbg !447 !guid !460 {
start:
  %v.dbg.spill = alloca [8 x i8], align 8
  store ptr %v, ptr %v.dbg.spill, align 8
    #dbg_declare(ptr %v.dbg.spill, !459, !DIExpression(), !461)
  %0 = getelementptr inbounds i8, ptr %v, i64 3, !dbg !462
  %_0 = load i8, ptr %0, align 1, !dbg !462
  ret i8 %_0, !dbg !463
}

; Function Attrs: nonlazybind uwtable
define { ptr, ptr } @vtable(ptr align 8 %p) unnamed_addr #2 !dbg !464 !guid !469 {
start:
  %p.dbg.spill = alloca [8 x i8], align 8
  store ptr %p, ptr %p.dbg.spill, align 8
    #dbg_declare(ptr %p.dbg.spill, !468, !DIExpression(), !470)
  %0 = insertvalue { ptr, ptr } poison, ptr %p, 0, !dbg !471
  %1 = insertvalue { ptr, ptr } %0, ptr @vtable.1, 1, !dbg !471
  ret { ptr, ptr } %1, !dbg !471
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #3

attributes #0 = { noinline nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { noreturn nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #2 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #3 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }
attributes #4 = { noreturn }

!llvm.module.flags = !{!36, !37, !38, !39, !40}
!llvm.ident = !{!41}
!llvm.dbg.cu = !{!42}

!0 = !DIGlobalVariableExpression(var: !1, expr: !DIExpression())
!1 = distinct !DIGlobalVariable(name: "GLOBAL", linkageName: "_RNvCs15oYSsIuqjM_5types6GLOBAL", scope: !2, file: !3, line: 114, type: !4, isLocal: false, isDefinition: true, align: 64)
!2 = !DINamespace(name: "types", scope: null)
!3 = !DIFile(filename: "types.rs", directory: ".", checksumkind: CSK_MD5, checksum: "7cefe7493fc42711a47beabb62f45844")
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
!16 = distinct !DIGlobalVariable(name: "<u32 as _>::{vtable}", scope: null, file: !5, type: !17, isLocal: true, isDefinition: true)
!17 = !DICompositeType(tag: DW_TAG_structure_type, name: "<u32 as _>::{vtable_type}", file: !5, size: 192, align: 64, flags: DIFlagArtificial, elements: !18, vtableHolder: !25, templateParams: !13, identifier: "d853a453a803e41b742b60c4e025482d")
!18 = !{!19, !22, !24}
!19 = !DIDerivedType(tag: DW_TAG_member, name: "drop_in_place", scope: !17, file: !5, baseType: !20, size: 64, align: 64)
!20 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const ()", baseType: !21, size: 64, align: 64, dwarfAddressSpace: 0)
!21 = !DIBasicType(name: "()", encoding: DW_ATE_unsigned)
!22 = !DIDerivedType(tag: DW_TAG_member, name: "size", scope: !17, file: !5, baseType: !23, size: 64, align: 64, offset: 64)
!23 = !DIBasicType(name: "usize", size: 64, encoding: DW_ATE_unsigned)
!24 = !DIDerivedType(tag: DW_TAG_member, name: "align", scope: !17, file: !5, baseType: !23, size: 64, align: 64, offset: 128)
!25 = !DIBasicType(name: "u32", size: 32, encoding: DW_ATE_unsigned)
!26 = !{i64 -6426483837549638915}
!27 = !DIGlobalVariableExpression(var: !28, expr: !DIExpression())
!28 = distinct !DIGlobalVariable(name: "<types::Point as types::Shape>::{vtable}", scope: null, file: !5, type: !29, isLocal: true, isDefinition: true)
!29 = !DICompositeType(tag: DW_TAG_structure_type, name: "<types::Point as types::Shape>::{vtable_type}", file: !5, size: 256, align: 64, flags: DIFlagArtificial, elements: !30, vtableHolder: !4, templateParams: !13, identifier: "3d57a5951e71546da41ef57cf0b7bf59")
!30 = !{!31, !32, !33, !34}
!31 = !DIDerivedType(tag: DW_TAG_member, name: "drop_in_place", scope: !29, file: !5, baseType: !20, size: 64, align: 64)
!32 = !DIDerivedType(tag: DW_TAG_member, name: "size", scope: !29, file: !5, baseType: !23, size: 64, align: 64, offset: 64)
!33 = !DIDerivedType(tag: DW_TAG_member, name: "align", scope: !29, file: !5, baseType: !23, size: 64, align: 64, offset: 128)
!34 = !DIDerivedType(tag: DW_TAG_member, name: "__method3", scope: !29, file: !5, baseType: !20, size: 64, align: 64, offset: 192)
!35 = !{i64 -9115322521351085872}
!36 = !{i32 8, !"PIC Level", i32 2}
!37 = !{i32 2, !"RtLibUseGOT", i32 1}
!38 = !{i32 7, !"uwtable", i32 2}
!39 = !{i32 7, !"Dwarf Version", i32 4}
!40 = !{i32 2, !"Debug Info Version", i32 3}
!41 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!42 = distinct !DICompileUnit(language: DW_LANG_Rust, file: !43, producer: "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug, enums: !44, globals: !50, splitDebugInlining: false, nameTableKind: None)
!43 = !DIFile(filename: "types.rs/@/types.ca9a2c18325d504-cgu.0", directory: ".")
!44 = !{!45}
!45 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "CLike", scope: !2, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagEnumClass, elements: !46)
!46 = !{!47, !48, !49}
!47 = !DIEnumerator(name: "A", value: 0, isUnsigned: true)
!48 = !DIEnumerator(name: "B", value: 5, isUnsigned: true)
!49 = !DIEnumerator(name: "C", value: 6, isUnsigned: true)
!50 = !{!0, !15, !27}
!51 = distinct !DISubprogram(name: "take<types::closure::{closure_env#0}>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_", scope: !2, file: !3, line: 156, type: !52, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !42, templateParams: !60, retainedNodes: !58)
!52 = !DISubroutineType(types: !53)
!53 = !{!25, !54}
!54 = !DICompositeType(tag: DW_TAG_structure_type, name: "{closure_env#0}", scope: !55, file: !5, size: 32, align: 32, elements: !56, templateParams: !13, identifier: "fc485e4bf1acde5e12ed9b065b27b2ae")
!55 = !DINamespace(name: "closure", scope: !2)
!56 = !{!57}
!57 = !DIDerivedType(tag: DW_TAG_member, name: "x", scope: !54, file: !5, baseType: !25, size: 32, align: 32)
!58 = !{!59}
!59 = !DILocalVariable(name: "t", arg: 1, scope: !51, file: !3, line: 156, type: !54)
!60 = !{!61}
!61 = !DITemplateTypeParameter(name: "T", type: !54)
!62 = !{i64 1915899645086356215}
!63 = !DILocation(line: 156, column: 12, scope: !51)
!64 = !DILocation(line: 159, column: 2, scope: !51)
!65 = distinct !DISubprogram(name: "take<fn() -> <recursive_type>>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_", scope: !2, file: !3, line: 156, type: !66, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !42, templateParams: !74, retainedNodes: !72)
!66 = !DISubroutineType(types: !67)
!67 = !{!25, !68}
!68 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "fn() -> <recursive_type>", baseType: !69, align: 8, dwarfAddressSpace: 0)
!69 = !DISubroutineType(types: !70)
!70 = !{!71}
!71 = !DIBasicType(name: "<recur_type>", size: 64, encoding: DW_ATE_unsigned)
!72 = !{!73}
!73 = !DILocalVariable(name: "t", arg: 1, scope: !65, file: !3, line: 156, type: !68)
!74 = !{!75}
!75 = !DITemplateTypeParameter(name: "T", type: !68)
!76 = !{i64 -740690765248574201}
!77 = !DILocation(line: 156, column: 12, scope: !65)
!78 = !DILocation(line: 159, column: 2, scope: !65)
!79 = distinct !DISubprogram(name: "diverge", linkageName: "_RNvCs15oYSsIuqjM_5types7diverge", scope: !2, file: !3, line: 147, type: !80, scopeLine: 147, flags: DIFlagPrototyped | DIFlagNoReturn, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !42, templateParams: !13)
!80 = !DISubroutineType(types: !81)
!81 = !{null}
!82 = !{i64 3518661633375468340}
!83 = !DILocation(line: 148, column: 5, scope: !79)
!84 = distinct !DISubprogram(name: "rec_impl", linkageName: "_RNvCs15oYSsIuqjM_5types8rec_impl", scope: !2, file: !3, line: 173, type: !80, scopeLine: 173, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13)
!85 = !{i64 73545626838823865}
!86 = !DILocation(line: 175, column: 2, scope: !84)
!87 = distinct !DISubprogram(name: "area", linkageName: "_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area", scope: !88, file: !3, line: 109, type: !89, scopeLine: 109, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !92)
!88 = !DINamespace(name: "{impl#9}", scope: !2)
!89 = !DISubroutineType(types: !90)
!90 = !{!25, !91}
!91 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::Point", baseType: !4, size: 64, align: 64, dwarfAddressSpace: 0)
!92 = !{!93}
!93 = !DILocalVariable(name: "self", arg: 1, scope: !87, file: !3, line: 109, type: !91)
!94 = !{i64 -4356820192056016148}
!95 = !DILocation(line: 109, column: 13, scope: !87)
!96 = !DILocation(line: 110, column: 9, scope: !87)
!97 = !DILocation(line: 111, column: 6, scope: !87)
!98 = distinct !DISubprogram(name: "basics", scope: !2, file: !3, line: 132, type: !99, scopeLine: 132, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !110)
!99 = !DISubroutineType(types: !100)
!100 = !{!25, !101, !102, !103, !10, !104, !23, !105, !106, !107, !108, !21, !109}
!101 = !DIBasicType(name: "i8", size: 8, encoding: DW_ATE_signed)
!102 = !DIBasicType(name: "u64", size: 64, encoding: DW_ATE_unsigned)
!103 = !DIBasicType(name: "f32", size: 32, encoding: DW_ATE_float)
!104 = !DIBasicType(name: "isize", size: 64, encoding: DW_ATE_signed)
!105 = !DIBasicType(name: "i128", size: 128, encoding: DW_ATE_signed)
!106 = !DIBasicType(name: "u128", size: 128, encoding: DW_ATE_unsigned)
!107 = !DIBasicType(name: "f16", size: 16, encoding: DW_ATE_float)
!108 = !DIBasicType(name: "f128", size: 128, encoding: DW_ATE_float)
!109 = !DIBasicType(name: "char", size: 32, encoding: DW_ATE_UTF)
!110 = !{!111, !112, !113, !114, !115, !116, !117, !118, !119, !120, !121, !122, !123}
!111 = !DILocalVariable(name: "a", arg: 1, scope: !98, file: !3, line: 132, type: !101)
!112 = !DILocalVariable(name: "b", arg: 2, scope: !98, file: !3, line: 132, type: !102)
!113 = !DILocalVariable(name: "c", arg: 3, scope: !98, file: !3, line: 132, type: !103)
!114 = !DILocalVariable(name: "d", arg: 4, scope: !98, file: !3, line: 132, type: !10)
!115 = !DILocalVariable(name: "e", arg: 5, scope: !98, file: !3, line: 132, type: !104)
!116 = !DILocalVariable(name: "f", arg: 6, scope: !98, file: !3, line: 132, type: !23)
!117 = !DILocalVariable(name: "g", arg: 7, scope: !98, file: !3, line: 132, type: !105)
!118 = !DILocalVariable(name: "h", arg: 8, scope: !98, file: !3, line: 132, type: !106)
!119 = !DILocalVariable(name: "i", arg: 9, scope: !98, file: !3, line: 132, type: !107)
!120 = !DILocalVariable(name: "j", arg: 10, scope: !98, file: !3, line: 132, type: !108)
!121 = !DILocalVariable(name: "k", scope: !98, file: !3, line: 132, type: !21, align: 8)
!122 = !DILocalVariable(name: "l", arg: 12, scope: !98, file: !3, line: 132, type: !109)
!123 = !DILocalVariable(arg: 11, scope: !98, file: !3, line: 132, type: !21)
!124 = !{i64 -5181654353206422152}
!125 = !DILocation(line: 132, column: 15, scope: !98)
!126 = !DILocation(line: 132, column: 22, scope: !98)
!127 = !DILocation(line: 132, column: 30, scope: !98)
!128 = !DILocation(line: 132, column: 38, scope: !98)
!129 = !DILocation(line: 132, column: 46, scope: !98)
!130 = !DILocation(line: 132, column: 56, scope: !98)
!131 = !DILocation(line: 132, column: 66, scope: !98)
!132 = !DILocation(line: 132, column: 75, scope: !98)
!133 = !DILocation(line: 132, column: 84, scope: !98)
!134 = !DILocation(line: 132, column: 92, scope: !98)
!135 = !DILocation(line: 132, column: 101, scope: !98)
!136 = !DILocation(line: 132, column: 108, scope: !98)
!137 = !DILocation(line: 135, column: 2, scope: !98)
!138 = distinct !DISubprogram(name: "closure", scope: !2, file: !3, line: 151, type: !139, scopeLine: 151, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !141)
!139 = !DISubroutineType(types: !140)
!140 = !{!25, !25}
!141 = !{!142, !143}
!142 = !DILocalVariable(name: "x", arg: 1, scope: !138, file: !3, line: 151, type: !25)
!143 = !DILocalVariable(name: "c", scope: !144, file: !3, line: 152, type: !54, align: 32)
!144 = distinct !DILexicalBlock(scope: !138, file: !3, line: 152, column: 5)
!145 = !{i64 -8001930764763462056}
!146 = !DILocation(line: 151, column: 16, scope: !138)
!147 = !DILocation(line: 152, column: 13, scope: !138)
!148 = !DILocation(line: 152, column: 9, scope: !144)
!149 = !DILocation(line: 153, column: 5, scope: !144)
!150 = !DILocation(line: 154, column: 2, scope: !138)
!151 = distinct !DISubprogram(name: "enums", scope: !2, file: !3, line: 122, type: !152, scopeLine: 122, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !273)
!152 = !DISubroutineType(types: !153)
!153 = !{!25, !45, !154, !170, !184, !198, !207, !224, !235}
!154 = !DICompositeType(tag: DW_TAG_structure_type, name: "Tagged", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !155, templateParams: !13, identifier: "7a09859a618fbf60b7f03e353ea66444")
!155 = !{!156}
!156 = !DICompositeType(tag: DW_TAG_variant_part, scope: !154, file: !5, size: 128, align: 64, elements: !157, templateParams: !13, identifier: "b7ca2db5c6c6a2872f400277fb5bc070", discriminator: !169)
!157 = !{!158, !162, !167}
!158 = !DIDerivedType(tag: DW_TAG_member, name: "One", scope: !156, file: !5, baseType: !159, size: 128, align: 64, extraData: i8 0)
!159 = !DICompositeType(tag: DW_TAG_structure_type, name: "One", scope: !154, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !160, templateParams: !13, identifier: "c665cbede025898820f5e95706c59e3d")
!160 = !{!161}
!161 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !159, file: !5, baseType: !25, size: 32, align: 32, offset: 32, flags: DIFlagPublic)
!162 = !DIDerivedType(tag: DW_TAG_member, name: "Two", scope: !156, file: !5, baseType: !163, size: 128, align: 64, extraData: i8 1)
!163 = !DICompositeType(tag: DW_TAG_structure_type, name: "Two", scope: !154, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !164, templateParams: !13, identifier: "c09a96c7dcac441a491510fc40babb8")
!164 = !{!165, !166}
!165 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !163, file: !5, baseType: !102, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!166 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !163, file: !5, baseType: !101, size: 8, align: 8, offset: 8, flags: DIFlagPublic)
!167 = !DIDerivedType(tag: DW_TAG_member, name: "Three", scope: !156, file: !5, baseType: !168, size: 128, align: 64, extraData: i8 2)
!168 = !DICompositeType(tag: DW_TAG_structure_type, name: "Three", scope: !154, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !13, identifier: "42f47fc3dc3096c640fb5aebb978d263")
!169 = !DIDerivedType(tag: DW_TAG_member, scope: !154, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagArtificial)
!170 = !DICompositeType(tag: DW_TAG_structure_type, name: "Option<&u32>", scope: !2, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !171, templateParams: !13, identifier: "ed51b03b247287f78ba1f38cb9acddcc")
!171 = !{!172}
!172 = !DICompositeType(tag: DW_TAG_variant_part, scope: !170, file: !5, size: 64, align: 64, elements: !173, templateParams: !13, identifier: "ae32a9af7e260cba48efc82e55efccc", discriminator: !183)
!173 = !{!174, !179}
!174 = !DIDerivedType(tag: DW_TAG_member, name: "None", scope: !172, file: !5, baseType: !175, size: 64, align: 64, extraData: i64 0)
!175 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !170, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !13, templateParams: !176, identifier: "f0a46f3663c63171c9dc683a6faecac0")
!176 = !{!177}
!177 = !DITemplateTypeParameter(name: "T", type: !178)
!178 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&u32", baseType: !25, size: 64, align: 64, dwarfAddressSpace: 0)
!179 = !DIDerivedType(tag: DW_TAG_member, name: "Some", scope: !172, file: !5, baseType: !180, size: 64, align: 64)
!180 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !170, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !181, templateParams: !176, identifier: "8d7c597acf3c283f429ba8765eea1968")
!181 = !{!182}
!182 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !180, file: !5, baseType: !178, size: 64, align: 64, flags: DIFlagPublic)
!183 = !DIDerivedType(tag: DW_TAG_member, scope: !170, file: !5, baseType: !102, size: 64, align: 64, flags: DIFlagArtificial)
!184 = !DICompositeType(tag: DW_TAG_structure_type, name: "Niche", scope: !2, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !185, templateParams: !13, identifier: "2e768aced9ebecf4f9b14578e52e8ced")
!185 = !{!186}
!186 = !DICompositeType(tag: DW_TAG_variant_part, scope: !184, file: !5, size: 8, align: 8, elements: !187, templateParams: !13, identifier: "67ec8bf44e3fe796e5f398ca9090500e", discriminator: !197)
!187 = !{!188, !193, !195}
!188 = !DIDerivedType(tag: DW_TAG_member, name: "A", scope: !186, file: !5, baseType: !189, size: 8, align: 8)
!189 = !DICompositeType(tag: DW_TAG_structure_type, name: "A", scope: !184, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !190, templateParams: !13, identifier: "199633efd9ee9f6fc1ce5b3db71839a8")
!190 = !{!191}
!191 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !189, file: !5, baseType: !192, size: 8, align: 8, flags: DIFlagPublic)
!192 = !DIBasicType(name: "bool", size: 8, encoding: DW_ATE_boolean)
!193 = !DIDerivedType(tag: DW_TAG_member, name: "B", scope: !186, file: !5, baseType: !194, size: 8, align: 8, extraData: i8 2)
!194 = !DICompositeType(tag: DW_TAG_structure_type, name: "B", scope: !184, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !13, identifier: "79e87793cf0c2eacd81fa34d6de2e77")
!195 = !DIDerivedType(tag: DW_TAG_member, name: "C", scope: !186, file: !5, baseType: !196, size: 8, align: 8, extraData: i8 3)
!196 = !DICompositeType(tag: DW_TAG_structure_type, name: "C", scope: !184, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !13, identifier: "c68aa38615ac2ea80174f362c1f697a")
!197 = !DIDerivedType(tag: DW_TAG_member, scope: !184, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagArtificial)
!198 = !DICompositeType(tag: DW_TAG_structure_type, name: "Single", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !199, templateParams: !13, identifier: "99e2882fa157a99c759e60ab9c3b3f65")
!199 = !{!200}
!200 = !DICompositeType(tag: DW_TAG_variant_part, scope: !198, file: !5, size: 128, align: 64, elements: !201, templateParams: !13, identifier: "d18d65615c7b3b9e8e771a7d156b5ed4")
!201 = !{!202}
!202 = !DIDerivedType(tag: DW_TAG_member, name: "Only", scope: !200, file: !5, baseType: !203, size: 128, align: 64)
!203 = !DICompositeType(tag: DW_TAG_structure_type, name: "Only", scope: !198, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !204, templateParams: !13, identifier: "d78e06573f5341017ca9ac123671afa6")
!204 = !{!205, !206}
!205 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !203, file: !5, baseType: !25, size: 32, align: 32, offset: 64, flags: DIFlagPublic)
!206 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !203, file: !5, baseType: !102, size: 64, align: 64, flags: DIFlagPublic)
!207 = !DICompositeType(tag: DW_TAG_structure_type, name: "Option<&types::Empty>", scope: !2, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !208, templateParams: !13, identifier: "9ec6ad741cd0cf6e134acb98a307d263")
!208 = !{!209}
!209 = !DICompositeType(tag: DW_TAG_variant_part, scope: !207, file: !5, size: 64, align: 64, elements: !210, templateParams: !13, identifier: "2b71ad15b4796c5e59d0f0f8a43cf830", discriminator: !223)
!210 = !{!211, !219}
!211 = !DIDerivedType(tag: DW_TAG_member, name: "None", scope: !209, file: !5, baseType: !212, size: 64, align: 64, extraData: i64 0)
!212 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !207, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !13, templateParams: !213, identifier: "40e79cf9f10dccd63132410c3a601fa7")
!213 = !{!214}
!214 = !DITemplateTypeParameter(name: "T", type: !215)
!215 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::Empty", baseType: !216, size: 64, align: 64, dwarfAddressSpace: 0)
!216 = !DICompositeType(tag: DW_TAG_structure_type, name: "Empty", scope: !2, file: !5, align: 8, flags: DIFlagPublic, elements: !217, templateParams: !13, identifier: "64e96f3ce920dff82e10d4b6a35be4fb")
!217 = !{!218}
!218 = !DICompositeType(tag: DW_TAG_variant_part, scope: !216, file: !5, align: 8, elements: !13, identifier: "9434eb7708c8478da5032a9bd7a36f9c")
!219 = !DIDerivedType(tag: DW_TAG_member, name: "Some", scope: !209, file: !5, baseType: !220, size: 64, align: 64)
!220 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !207, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !221, templateParams: !213, identifier: "d733b5aa48f30b7797ac71a20eabbe3c")
!221 = !{!222}
!222 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !220, file: !5, baseType: !215, size: 64, align: 64, flags: DIFlagPublic)
!223 = !DIDerivedType(tag: DW_TAG_member, scope: !207, file: !5, baseType: !102, size: 64, align: 64, flags: DIFlagArtificial)
!224 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wide", scope: !2, file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !225, templateParams: !13, identifier: "580c897493afe5768312143f2fc7c866")
!225 = !{!226}
!226 = !DICompositeType(tag: DW_TAG_variant_part, scope: !224, file: !5, size: 256, align: 128, elements: !227, templateParams: !13, identifier: "4ebd4a46ef8e1b8ecda51a56fa6bf30e", discriminator: !234)
!227 = !{!228, !232}
!228 = !DIDerivedType(tag: DW_TAG_member, name: "X", scope: !226, file: !5, baseType: !229, size: 256, align: 128, extraData: i128 1)
!229 = !DICompositeType(tag: DW_TAG_structure_type, name: "X", scope: !224, file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !230, templateParams: !13, identifier: "edbe3ce3537b8454a1586fee1f8f976f")
!230 = !{!231}
!231 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !229, file: !5, baseType: !12, size: 8, align: 8, offset: 128, flags: DIFlagPublic)
!232 = !DIDerivedType(tag: DW_TAG_member, name: "Y", scope: !226, file: !5, baseType: !233, size: 256, align: 128, extraData: i128 1208925819614629174706175)
!233 = !DICompositeType(tag: DW_TAG_structure_type, name: "Y", scope: !224, file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !13, identifier: "af4b7981b1de14baf478bdaf175e1a20")
!234 = !DIDerivedType(tag: DW_TAG_member, scope: !224, file: !5, baseType: !106, size: 128, align: 128, flags: DIFlagArtificial)
!235 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::Rec<u8>", baseType: !236, size: 64, align: 64, dwarfAddressSpace: 0)
!236 = !DICompositeType(tag: DW_TAG_structure_type, name: "Rec<u8>", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !237, templateParams: !13, identifier: "bdcb87c0e6172cf96ca64813776a9af5")
!237 = !{!238}
!238 = !DICompositeType(tag: DW_TAG_variant_part, scope: !236, file: !5, size: 128, align: 64, elements: !239, templateParams: !13, identifier: "edc4b13ab14e4adebc22fdc7603c88f9", discriminator: !272)
!239 = !{!240, !268}
!240 = !DIDerivedType(tag: DW_TAG_member, name: "Recurse", scope: !238, file: !5, baseType: !241, size: 128, align: 64, extraData: i8 0)
!241 = !DICompositeType(tag: DW_TAG_structure_type, name: "Recurse", scope: !236, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !242, templateParams: !261, identifier: "47d9e89338842c2a9b75f1a10a02ddd8")
!242 = !{!243}
!243 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !241, file: !5, baseType: !244, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!244 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const types::Rec<types::Pair2<u8>>", baseType: !245, size: 64, align: 64, dwarfAddressSpace: 0)
!245 = !DICompositeType(tag: DW_TAG_structure_type, name: "Rec<types::Pair2<u8>>", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !246, templateParams: !13, identifier: "5ede9f07d678e971a0ca7153f666e62")
!246 = !{!247}
!247 = !DICompositeType(tag: DW_TAG_variant_part, scope: !245, file: !5, size: 128, align: 64, elements: !248, templateParams: !13, identifier: "546f46916dc2b0f2ea600f020e8eb308", discriminator: !267)
!248 = !{!249, !263}
!249 = !DIDerivedType(tag: DW_TAG_member, name: "Recurse", scope: !247, file: !5, baseType: !250, size: 128, align: 64, extraData: i8 0)
!250 = !DICompositeType(tag: DW_TAG_structure_type, name: "Recurse", scope: !245, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !251, templateParams: !255, identifier: "ade1e3fa13f1df495ef599f3dbd8a94c")
!251 = !{!252}
!252 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !250, file: !5, baseType: !253, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!253 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const types::Rec<types::Pair2<types::Pair2<u8>>>", baseType: !254, size: 64, align: 64, dwarfAddressSpace: 0)
!254 = !DICompositeType(tag: DW_TAG_structure_type, name: "Rec<types::Pair2<types::Pair2<u8>>>", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !13, identifier: "54791e7a79c18c75653e890640491966")
!255 = !{!256}
!256 = !DITemplateTypeParameter(name: "T", type: !257)
!257 = !DICompositeType(tag: DW_TAG_structure_type, name: "Pair2<u8>", scope: !2, file: !5, size: 16, align: 8, flags: DIFlagPublic, elements: !258, templateParams: !261, identifier: "317b48cb039e3e7fb5a8fbd2cc6135a5")
!258 = !{!259, !260}
!259 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !257, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagPrivate)
!260 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !257, file: !5, baseType: !12, size: 8, align: 8, offset: 8, flags: DIFlagPrivate)
!261 = !{!262}
!262 = !DITemplateTypeParameter(name: "T", type: !12)
!263 = !DIDerivedType(tag: DW_TAG_member, name: "Item", scope: !247, file: !5, baseType: !264, size: 128, align: 64, extraData: i8 1)
!264 = !DICompositeType(tag: DW_TAG_structure_type, name: "Item", scope: !245, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !265, templateParams: !255, identifier: "cee43346f500b874e72e06bc2d9e234a")
!265 = !{!266}
!266 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !264, file: !5, baseType: !257, size: 16, align: 8, offset: 8, flags: DIFlagPublic)
!267 = !DIDerivedType(tag: DW_TAG_member, scope: !245, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagArtificial)
!268 = !DIDerivedType(tag: DW_TAG_member, name: "Item", scope: !238, file: !5, baseType: !269, size: 128, align: 64, extraData: i8 1)
!269 = !DICompositeType(tag: DW_TAG_structure_type, name: "Item", scope: !236, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !270, templateParams: !261, identifier: "8bbff529e44d2a45a49c95f6b6c9380")
!270 = !{!271}
!271 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !269, file: !5, baseType: !12, size: 8, align: 8, offset: 8, flags: DIFlagPublic)
!272 = !DIDerivedType(tag: DW_TAG_member, scope: !236, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagArtificial)
!273 = !{!274, !275, !276, !277, !278, !279, !280, !281}
!274 = !DILocalVariable(name: "c", arg: 1, scope: !151, file: !3, line: 122, type: !45)
!275 = !DILocalVariable(name: "t", arg: 2, scope: !151, file: !3, line: 122, type: !154)
!276 = !DILocalVariable(name: "o", arg: 3, scope: !151, file: !3, line: 122, type: !170)
!277 = !DILocalVariable(name: "n", arg: 4, scope: !151, file: !3, line: 122, type: !184)
!278 = !DILocalVariable(name: "s", arg: 5, scope: !151, file: !3, line: 122, type: !198)
!279 = !DILocalVariable(name: "e", arg: 6, scope: !151, file: !3, line: 122, type: !207)
!280 = !DILocalVariable(name: "w", arg: 7, scope: !151, file: !3, line: 122, type: !224)
!281 = !DILocalVariable(name: "r", arg: 8, scope: !151, file: !3, line: 122, type: !235)
!282 = !{i64 -6981848288932498368}
!283 = !DILocation(line: 122, column: 14, scope: !151)
!284 = !DILocation(line: 122, column: 24, scope: !151)
!285 = !DILocation(line: 122, column: 35, scope: !151)
!286 = !DILocation(line: 122, column: 52, scope: !151)
!287 = !DILocation(line: 122, column: 62, scope: !151)
!288 = !DILocation(line: 122, column: 73, scope: !151)
!289 = !DILocation(line: 122, column: 92, scope: !151)
!290 = !DILocation(line: 122, column: 101, scope: !151)
!291 = !DILocation(line: 125, column: 2, scope: !151)
!292 = distinct !DISubprogram(name: "global", scope: !2, file: !3, line: 170, type: !293, scopeLine: 170, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13)
!293 = !DISubroutineType(types: !294)
!294 = !{!91}
!295 = !{i64 7866218443099566236}
!296 = !DILocation(line: 172, column: 2, scope: !292)
!297 = distinct !DISubprogram(name: "never", scope: !2, file: !3, line: 141, type: !298, scopeLine: 141, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !300)
!298 = !DISubroutineType(types: !299)
!299 = !{!25, !192}
!300 = !{!301}
!301 = !DILocalVariable(name: "flag", arg: 1, scope: !297, file: !3, line: 141, type: !192)
!302 = !{i64 4169515925740803783}
!303 = !DILocation(line: 141, column: 14, scope: !297)
!304 = !DILocation(line: 142, column: 8, scope: !297)
!305 = !DILocation(line: 146, column: 2, scope: !297)
!306 = !DILocation(line: 143, column: 9, scope: !297)
!307 = distinct !DISubprogram(name: "no_principal", scope: !2, file: !3, line: 166, type: !308, scopeLine: 166, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !320)
!308 = !DISubroutineType(types: !309)
!309 = !{!310, !178}
!310 = !DICompositeType(tag: DW_TAG_structure_type, name: "&dyn types::Sync", file: !5, size: 128, align: 64, elements: !311, templateParams: !13, identifier: "c885107d35bcd1fca3520397c2790ef9")
!311 = !{!312, !315}
!312 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !310, file: !5, baseType: !313, size: 64, align: 64)
!313 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !314, size: 64, align: 64, dwarfAddressSpace: 0)
!314 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn types::Sync", file: !5, align: 8, elements: !13, identifier: "b0f94999abdbb52473f42d5bdd51018d")
!315 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !310, file: !5, baseType: !316, size: 64, align: 64, offset: 64)
!316 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&[usize; 3]", baseType: !317, size: 64, align: 64, dwarfAddressSpace: 0)
!317 = !DICompositeType(tag: DW_TAG_array_type, baseType: !23, size: 192, align: 64, elements: !318)
!318 = !{!319}
!319 = !DISubrange(count: 3, lowerBound: 0)
!320 = !{!321}
!321 = !DILocalVariable(name: "x", arg: 1, scope: !307, file: !3, line: 166, type: !178)
!322 = !{i64 -9201868857759523069}
!323 = !DILocation(line: 166, column: 21, scope: !307)
!324 = !DILocation(line: 168, column: 2, scope: !307)
!325 = distinct !DISubprogram(name: "pointers", scope: !2, file: !3, line: 127, type: !326, scopeLine: 127, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !357)
!326 = !DISubroutineType(types: !327)
!327 = !{!25, !328, !334, !339, !349, !350, !353, !354}
!328 = !DICompositeType(tag: DW_TAG_structure_type, name: "&[i64]", file: !5, size: 128, align: 64, elements: !329, templateParams: !13, identifier: "b4a8090213073d4713897d6f185bba6b")
!329 = !{!330, !333}
!330 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !328, file: !5, baseType: !331, size: 64, align: 64)
!331 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !332, size: 64, align: 64, dwarfAddressSpace: 0)
!332 = !DIBasicType(name: "i64", size: 64, encoding: DW_ATE_signed)
!333 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !328, file: !5, baseType: !23, size: 64, align: 64, offset: 64)
!334 = !DICompositeType(tag: DW_TAG_structure_type, name: "&str", file: !5, size: 128, align: 64, elements: !335, templateParams: !13, identifier: "6fc9dd7daffb1f73292744aea0793200")
!335 = !{!336, !338}
!336 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !334, file: !5, baseType: !337, size: 64, align: 64)
!337 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !12, size: 64, align: 64, dwarfAddressSpace: 0)
!338 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !334, file: !5, baseType: !23, size: 64, align: 64, offset: 64)
!339 = !DICompositeType(tag: DW_TAG_structure_type, name: "&dyn types::Shape", file: !5, size: 128, align: 64, elements: !340, templateParams: !13, identifier: "fe29d79d289ba2d7e0ec59f2c9f4dc75")
!340 = !{!341, !344}
!341 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !339, file: !5, baseType: !342, size: 64, align: 64)
!342 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !343, size: 64, align: 64, dwarfAddressSpace: 0)
!343 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn types::Shape", file: !5, align: 8, elements: !13, identifier: "b991d0562d06e41c69a1bb075371dbaa")
!344 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !339, file: !5, baseType: !345, size: 64, align: 64, offset: 64)
!345 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&[usize; 4]", baseType: !346, size: 64, align: 64, dwarfAddressSpace: 0)
!346 = !DICompositeType(tag: DW_TAG_array_type, baseType: !23, size: 256, align: 64, elements: !347)
!347 = !{!348}
!348 = !DISubrange(count: 4, lowerBound: 0)
!349 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const u8", baseType: !12, size: 64, align: 64, dwarfAddressSpace: 0)
!350 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&mut [u16; 4]", baseType: !351, size: 64, align: 64, dwarfAddressSpace: 0)
!351 = !DICompositeType(tag: DW_TAG_array_type, baseType: !352, size: 64, align: 16, elements: !347)
!352 = !DIBasicType(name: "u16", size: 16, encoding: DW_ATE_unsigned)
!353 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "fn(u32) -> u32", baseType: !139, size: 64, align: 64, dwarfAddressSpace: 0)
!354 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::{extern#0}::Opaque", baseType: !355, size: 64, align: 64, dwarfAddressSpace: 0)
!355 = !DICompositeType(tag: DW_TAG_structure_type, name: "Opaque", scope: !356, file: !5, align: 8, elements: !13, identifier: "a3877f7c886e7d8757337d2282356247")
!356 = !DINamespace(name: "{extern#0}", scope: !2)
!357 = !{!358, !359, !360, !361, !362, !363, !364}
!358 = !DILocalVariable(name: "sl", arg: 1, scope: !325, file: !3, line: 127, type: !328)
!359 = !DILocalVariable(name: "s", arg: 2, scope: !325, file: !3, line: 127, type: !334)
!360 = !DILocalVariable(name: "d", arg: 3, scope: !325, file: !3, line: 127, type: !339)
!361 = !DILocalVariable(name: "raw", arg: 4, scope: !325, file: !3, line: 127, type: !349)
!362 = !DILocalVariable(name: "m", arg: 5, scope: !325, file: !3, line: 127, type: !350)
!363 = !DILocalVariable(name: "f", arg: 6, scope: !325, file: !3, line: 127, type: !353)
!364 = !DILocalVariable(name: "op", arg: 7, scope: !325, file: !3, line: 127, type: !354)
!365 = !{i64 5285204393774026867}
!366 = !DILocation(line: 127, column: 17, scope: !325)
!367 = !DILocation(line: 127, column: 29, scope: !325)
!368 = !DILocation(line: 127, column: 38, scope: !325)
!369 = !DILocation(line: 127, column: 53, scope: !325)
!370 = !DILocation(line: 127, column: 69, scope: !325)
!371 = !DILocation(line: 127, column: 87, scope: !325)
!372 = !DILocation(line: 127, column: 106, scope: !325)
!373 = !DILocation(line: 129, column: 5, scope: !325)
!374 = !DILocation(line: 129, column: 7, scope: !325)
!375 = !DILocation(line: 130, column: 2, scope: !325)
!376 = distinct !DISubprogram(name: "recursive_fn_type", scope: !2, file: !3, line: 177, type: !377, scopeLine: 177, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13)
!377 = !DISubroutineType(types: !378)
!378 = !{!25}
!379 = !{i64 -4635464101160348947}
!380 = !DILocation(line: 178, column: 10, scope: !376)
!381 = !DILocation(line: 178, column: 5, scope: !376)
!382 = !DILocation(line: 179, column: 2, scope: !376)
!383 = distinct !DISubprogram(name: "structs", scope: !2, file: !3, line: 117, type: !384, scopeLine: 117, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !419)
!384 = !DISubroutineType(types: !385)
!385 = !{!25, !91, !386, !390, !391, !401}
!386 = !DICompositeType(tag: DW_TAG_structure_type, name: "Pair", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !387, templateParams: !13, identifier: "94ca5408626465f7a23119eb31190947")
!387 = !{!388, !389}
!388 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !386, file: !5, baseType: !352, size: 16, align: 16, offset: 64, flags: DIFlagPublic)
!389 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !386, file: !5, baseType: !332, size: 64, align: 64, flags: DIFlagPrivate)
!390 = !DICompositeType(tag: DW_TAG_structure_type, name: "Unit", scope: !2, file: !5, align: 8, flags: DIFlagPublic, elements: !13, identifier: "b08e6297ec0e9e2a1f0a6ab3d7c35d9b")
!391 = !DICompositeType(tag: DW_TAG_structure_type, name: "Gen<u8, (char, bool)>", scope: !2, file: !5, size: 96, align: 32, flags: DIFlagPublic, elements: !392, templateParams: !399, identifier: "5a83877b5744ceaeffe9ee3edc8fae67")
!392 = !{!393, !394}
!393 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !391, file: !5, baseType: !12, size: 8, align: 8, offset: 64, flags: DIFlagPrivate)
!394 = !DIDerivedType(tag: DW_TAG_member, name: "u", scope: !391, file: !5, baseType: !395, size: 64, align: 32, flags: DIFlagPrivate)
!395 = !DICompositeType(tag: DW_TAG_structure_type, name: "(char, bool)", file: !5, size: 64, align: 32, elements: !396, templateParams: !13, identifier: "23b612e9e1a9e610ca072c9f53b8f4c4")
!396 = !{!397, !398}
!397 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !395, file: !5, baseType: !109, size: 32, align: 32)
!398 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !395, file: !5, baseType: !192, size: 8, align: 8, offset: 32)
!399 = !{!262, !400}
!400 = !DITemplateTypeParameter(name: "U", type: !395)
!401 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::List", baseType: !402, size: 64, align: 64, dwarfAddressSpace: 0)
!402 = !DICompositeType(tag: DW_TAG_structure_type, name: "List", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !403, templateParams: !13, identifier: "784c52a69e4fd732fc2cb610c53ce42b")
!403 = !{!404, !418}
!404 = !DIDerivedType(tag: DW_TAG_member, name: "next", scope: !402, file: !5, baseType: !405, size: 64, align: 64, flags: DIFlagPrivate)
!405 = !DICompositeType(tag: DW_TAG_structure_type, name: "Option<&types::List>", scope: !2, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !406, templateParams: !13, identifier: "81608bde9c02ca68284619d5a8da3749")
!406 = !{!407}
!407 = !DICompositeType(tag: DW_TAG_variant_part, scope: !405, file: !5, size: 64, align: 64, elements: !408, templateParams: !13, identifier: "9911bbd4c8f3bdf55bc77752a0a44022", discriminator: !417)
!408 = !{!409, !413}
!409 = !DIDerivedType(tag: DW_TAG_member, name: "None", scope: !407, file: !5, baseType: !410, size: 64, align: 64, extraData: i64 0)
!410 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !405, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !13, templateParams: !411, identifier: "e1386b739e649cc1b2ae583acd057ecc")
!411 = !{!412}
!412 = !DITemplateTypeParameter(name: "T", type: !401)
!413 = !DIDerivedType(tag: DW_TAG_member, name: "Some", scope: !407, file: !5, baseType: !414, size: 64, align: 64)
!414 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !405, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !415, templateParams: !411, identifier: "89da0816b97d49e3dac2e41fc3e93b83")
!415 = !{!416}
!416 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !414, file: !5, baseType: !401, size: 64, align: 64, flags: DIFlagPublic)
!417 = !DIDerivedType(tag: DW_TAG_member, scope: !405, file: !5, baseType: !102, size: 64, align: 64, flags: DIFlagArtificial)
!418 = !DIDerivedType(tag: DW_TAG_member, name: "v", scope: !402, file: !5, baseType: !8, size: 32, align: 32, offset: 64, flags: DIFlagPrivate)
!419 = !{!420, !421, !422, !423, !424, !425}
!420 = !DILocalVariable(name: "p", arg: 1, scope: !383, file: !3, line: 117, type: !91)
!421 = !DILocalVariable(name: "q", arg: 2, scope: !383, file: !3, line: 117, type: !386)
!422 = !DILocalVariable(name: "_u", scope: !383, file: !3, line: 117, type: !390, align: 8)
!423 = !DILocalVariable(name: "g", arg: 4, scope: !383, file: !3, line: 117, type: !391)
!424 = !DILocalVariable(name: "l", arg: 5, scope: !383, file: !3, line: 117, type: !401)
!425 = !DILocalVariable(arg: 3, scope: !383, file: !3, line: 117, type: !390)
!426 = !{i64 -3801848370686489254}
!427 = !DILocation(line: 117, column: 16, scope: !383)
!428 = !DILocation(line: 117, column: 27, scope: !383)
!429 = !DILocation(line: 117, column: 36, scope: !383)
!430 = !DILocation(line: 117, column: 46, scope: !383)
!431 = !DILocation(line: 117, column: 72, scope: !383)
!432 = !DILocation(line: 119, column: 5, scope: !383)
!433 = !DILocation(line: 120, column: 2, scope: !383)
!434 = distinct !DISubprogram(name: "union_", scope: !2, file: !3, line: 137, type: !435, scopeLine: 137, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !441)
!435 = !DISubroutineType(types: !436)
!436 = !{!25, !437}
!437 = !DICompositeType(tag: DW_TAG_union_type, name: "U", scope: !2, file: !5, size: 32, align: 32, elements: !438, templateParams: !13, identifier: "e8c023c6fa2b313aec2f51fb48fcaef3")
!438 = !{!439, !440}
!439 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !437, file: !5, baseType: !25, size: 32, align: 32)
!440 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !437, file: !5, baseType: !103, size: 32, align: 32)
!441 = !{!442}
!442 = !DILocalVariable(name: "u", arg: 1, scope: !434, file: !3, line: 137, type: !437)
!443 = !{i64 3738193153085972219}
!444 = !DILocation(line: 137, column: 15, scope: !434)
!445 = !DILocation(line: 138, column: 14, scope: !434)
!446 = !DILocation(line: 139, column: 2, scope: !434)
!447 = distinct !DISubprogram(name: "visibility", scope: !2, file: !3, line: 190, type: !448, scopeLine: 190, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !458)
!448 = !DISubroutineType(types: !449)
!449 = !{!12, !450}
!450 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&types::inner::Vis", baseType: !451, size: 64, align: 64, dwarfAddressSpace: 0)
!451 = !DICompositeType(tag: DW_TAG_structure_type, name: "Vis", scope: !452, file: !5, size: 32, align: 8, flags: DIFlagPublic, elements: !453, templateParams: !13, identifier: "c8763aed17c9ea6b868c91e2dc0d11a2")
!452 = !DINamespace(name: "inner", scope: !2)
!453 = !{!454, !455, !456, !457}
!454 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !451, file: !5, baseType: !12, size: 8, align: 8, flags: DIFlagProtected)
!455 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !451, file: !5, baseType: !12, size: 8, align: 8, offset: 8, flags: DIFlagProtected)
!456 = !DIDerivedType(tag: DW_TAG_member, name: "c", scope: !451, file: !5, baseType: !12, size: 8, align: 8, offset: 16, flags: DIFlagPrivate)
!457 = !DIDerivedType(tag: DW_TAG_member, name: "d", scope: !451, file: !5, baseType: !12, size: 8, align: 8, offset: 24, flags: DIFlagPublic)
!458 = !{!459}
!459 = !DILocalVariable(name: "v", arg: 1, scope: !447, file: !3, line: 190, type: !450)
!460 = !{i64 3148254357277744119}
!461 = !DILocation(line: 190, column: 19, scope: !447)
!462 = !DILocation(line: 191, column: 5, scope: !447)
!463 = !DILocation(line: 192, column: 2, scope: !447)
!464 = distinct !DISubprogram(name: "vtable", scope: !2, file: !3, line: 161, type: !465, scopeLine: 161, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !42, templateParams: !13, retainedNodes: !467)
!465 = !DISubroutineType(types: !466)
!466 = !{!339, !91}
!467 = !{!468}
!468 = !DILocalVariable(name: "p", arg: 1, scope: !464, file: !3, line: 161, type: !91)
!469 = !{i64 3405836996193402751}
!470 = !DILocation(line: 161, column: 15, scope: !464)
!471 = !DILocation(line: 163, column: 2, scope: !464)

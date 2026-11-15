; ModuleID = 'types.ca9a2c18325d504-cgu.0'
source_filename = "types.ca9a2c18325d504-cgu.0"
target datalayout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-pc-windows-msvc"

@_RNvCs15oYSsIuqjM_5types6GLOBAL = constant <{ [13 x i8], [3 x i8] }> <{ [13 x i8] c"\00\00\00\00\00\00\00@\01\00\00\00\03", [3 x i8] undef }>, align 8, !dbg !0, !guid !17
@vtable.0 = private constant <{ [24 x i8], ptr }> <{ [24 x i8] c"\00\00\00\00\00\00\00\00\10\00\00\00\00\00\00\00\08\00\00\00\00\00\00\00", ptr @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area }>, align 8, !dbg !18, !guid !30
@"\01__imp__RNvCs15oYSsIuqjM_5types6GLOBAL" = global ptr @_RNvCs15oYSsIuqjM_5types6GLOBAL

; types::take::<types::closure::{closure#0}>
; Function Attrs: noinline uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %t) unnamed_addr #0 !dbg !308 !guid !319 {
start:
  %t.dbg.spill = alloca [4 x i8], align 4
  store i32 %t, ptr %t.dbg.spill, align 4
    #dbg_declare(ptr %t.dbg.spill, !316, !DIExpression(), !320)
  ret i32 0, !dbg !321
}

; types::take::<types::rec_impl>
; Function Attrs: noinline uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_() unnamed_addr #0 !dbg !322 !guid !333 {
start:
  %t.dbg.spill = alloca [0 x i8], align 1
    #dbg_declare(ptr %t.dbg.spill, !330, !DIExpression(), !334)
  ret i32 0, !dbg !335
}

; types::diverge
; Function Attrs: noreturn uwtable
define internal void @_RNvCs15oYSsIuqjM_5types7diverge() unnamed_addr #1 !dbg !336 !guid !339 {
start:
  br label %bb1, !dbg !340

bb1:                                              ; preds = %bb1, %start
  br label %bb1, !dbg !340
}

; types::rec_impl
; Function Attrs: uwtable
define void @_RNvCs15oYSsIuqjM_5types8rec_impl() unnamed_addr #2 !dbg !341 !guid !342 {
start:
  ret void, !dbg !343
}

; <types::Point as types::Shape>::area
; Function Attrs: uwtable
define i32 @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area(ptr align 8 %self) unnamed_addr #2 !dbg !344 !guid !351 {
start:
  %self.dbg.spill = alloca [8 x i8], align 8
  store ptr %self, ptr %self.dbg.spill, align 8
    #dbg_declare(ptr %self.dbg.spill, !350, !DIExpression(), !352)
  %0 = getelementptr inbounds i8, ptr %self, i64 12, !dbg !353
  %_2 = load i8, ptr %0, align 4, !dbg !353
  %_0 = zext i8 %_2 to i32, !dbg !353
  ret i32 %_0, !dbg !354
}

; Function Attrs: uwtable
define i32 @basics(i8 %a, i64 %b, float %c, double %d, i64 %e, i64 %f, i128 %g, i128 %h, half %i, fp128 %j, i32 %l) unnamed_addr #2 !dbg !355 !guid !390 {
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
    #dbg_declare(ptr %a.dbg.spill, !377, !DIExpression(), !391)
  store i64 %b, ptr %b.dbg.spill, align 8
    #dbg_declare(ptr %b.dbg.spill, !378, !DIExpression(), !391)
  store float %c, ptr %c.dbg.spill, align 4
    #dbg_declare(ptr %c.dbg.spill, !379, !DIExpression(), !391)
  store double %d, ptr %d.dbg.spill, align 8
    #dbg_declare(ptr %d.dbg.spill, !380, !DIExpression(), !391)
  store i64 %e, ptr %e.dbg.spill, align 8
    #dbg_declare(ptr %e.dbg.spill, !381, !DIExpression(), !391)
  store i64 %f, ptr %f.dbg.spill, align 8
    #dbg_declare(ptr %f.dbg.spill, !382, !DIExpression(), !391)
  store i128 %g, ptr %g.dbg.spill, align 16
    #dbg_declare(ptr %g.dbg.spill, !383, !DIExpression(), !391)
  store i128 %h, ptr %h.dbg.spill, align 16
    #dbg_declare(ptr %h.dbg.spill, !384, !DIExpression(), !391)
  store half %i, ptr %i.dbg.spill, align 2
    #dbg_declare(ptr %i.dbg.spill, !385, !DIExpression(), !391)
  store fp128 %j, ptr %j.dbg.spill, align 16
    #dbg_declare(ptr %j.dbg.spill, !386, !DIExpression(), !391)
    #dbg_declare(ptr %_11.dbg.spill, !389, !DIExpression(), !391)
  store i32 %l, ptr %l.dbg.spill, align 4
    #dbg_declare(ptr %l.dbg.spill, !388, !DIExpression(), !391)
    #dbg_declare(ptr %k.dbg.spill, !387, !DIExpression(), !391)
  ret i32 0, !dbg !392
}

; Function Attrs: uwtable
define i32 @closure(i32 %x) unnamed_addr #2 !dbg !393 !guid !400 {
start:
  %c.dbg.spill = alloca [4 x i8], align 4
  %x.dbg.spill = alloca [4 x i8], align 4
  store i32 %x, ptr %x.dbg.spill, align 4
    #dbg_declare(ptr %x.dbg.spill, !397, !DIExpression(), !401)
  store i32 %x, ptr %c.dbg.spill, align 4, !dbg !402
    #dbg_declare(ptr %c.dbg.spill, !398, !DIExpression(), !403)
; call types::take::<types::closure::{closure#0}>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %x), !dbg !404
  ret i32 %_0, !dbg !405
}

; Function Attrs: uwtable
define i32 @enums(i8 %c, ptr align 8 %t, ptr align 4 %o, i8 %n, i64 %s.0, i32 %s.1, ptr %e, i128 %w.0, i8 %w.1, ptr align 8 %r) unnamed_addr #2 !dbg !406 !guid !419 {
start:
  %r.dbg.spill = alloca [8 x i8], align 8
  %w.dbg.spill = alloca [32 x i8], align 16
  %e.dbg.spill = alloca [8 x i8], align 8
  %s.dbg.spill = alloca [16 x i8], align 8
  %n.dbg.spill = alloca [1 x i8], align 1
  %o.dbg.spill = alloca [8 x i8], align 8
  %c.dbg.spill = alloca [1 x i8], align 1
  store i8 %c, ptr %c.dbg.spill, align 1
    #dbg_declare(ptr %c.dbg.spill, !411, !DIExpression(), !420)
    #dbg_declare(ptr %t, !412, !DIExpression(), !420)
  store ptr %o, ptr %o.dbg.spill, align 8
    #dbg_declare(ptr %o.dbg.spill, !413, !DIExpression(), !420)
  store i8 %n, ptr %n.dbg.spill, align 1
    #dbg_declare(ptr %n.dbg.spill, !414, !DIExpression(), !420)
  store i64 %s.0, ptr %s.dbg.spill, align 8
  %0 = getelementptr inbounds i8, ptr %s.dbg.spill, i64 8
  store i32 %s.1, ptr %0, align 8
    #dbg_declare(ptr %s.dbg.spill, !415, !DIExpression(), !420)
  store ptr %e, ptr %e.dbg.spill, align 8
    #dbg_declare(ptr %e.dbg.spill, !416, !DIExpression(), !420)
  store i128 %w.0, ptr %w.dbg.spill, align 16
  %1 = getelementptr inbounds i8, ptr %w.dbg.spill, i64 16
  store i8 %w.1, ptr %1, align 16
    #dbg_declare(ptr %w.dbg.spill, !417, !DIExpression(), !420)
  store ptr %r, ptr %r.dbg.spill, align 8
    #dbg_declare(ptr %r.dbg.spill, !418, !DIExpression(), !420)
  ret i32 0, !dbg !421
}

; Function Attrs: uwtable
define align 8 ptr @global() unnamed_addr #2 !dbg !422 !guid !425 {
start:
  ret ptr @_RNvCs15oYSsIuqjM_5types6GLOBAL, !dbg !426
}

; Function Attrs: uwtable
define i32 @never(i1 zeroext %flag) unnamed_addr #2 !dbg !427 !guid !432 {
start:
  %flag.dbg.spill = alloca [1 x i8], align 1
  %0 = zext i1 %flag to i8
  store i8 %0, ptr %flag.dbg.spill, align 1
    #dbg_declare(ptr %flag.dbg.spill, !431, !DIExpression(), !433)
  br i1 %flag, label %bb1, label %bb2, !dbg !434

bb2:                                              ; preds = %start
  ret i32 1, !dbg !435

bb1:                                              ; preds = %start
; call types::diverge
  call void @_RNvCs15oYSsIuqjM_5types7diverge() #4, !dbg !436
  unreachable, !dbg !436
}

; Function Attrs: uwtable
define i32 @pointers(ptr align 8 %sl.0, i64 %sl.1, ptr %s.0, i64 %s.1, ptr %d.0, ptr align 8 %d.1, ptr %raw, ptr align 2 %m, ptr %f, ptr %op) unnamed_addr #2 !dbg !437 !guid !477 {
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
    #dbg_declare(ptr %sl.dbg.spill, !470, !DIExpression(), !478)
  store ptr %s.0, ptr %s.dbg.spill, align 8
  %1 = getelementptr inbounds i8, ptr %s.dbg.spill, i64 8
  store i64 %s.1, ptr %1, align 8
    #dbg_declare(ptr %s.dbg.spill, !471, !DIExpression(), !478)
  store ptr %d.0, ptr %d.dbg.spill, align 8
  %2 = getelementptr inbounds i8, ptr %d.dbg.spill, i64 8
  store ptr %d.1, ptr %2, align 8
    #dbg_declare(ptr %d.dbg.spill, !472, !DIExpression(), !478)
  store ptr %raw, ptr %raw.dbg.spill, align 8
    #dbg_declare(ptr %raw.dbg.spill, !473, !DIExpression(), !478)
  store ptr %m, ptr %m.dbg.spill, align 8
    #dbg_declare(ptr %m.dbg.spill, !474, !DIExpression(), !478)
  store ptr %f, ptr %f.dbg.spill, align 8
    #dbg_declare(ptr %f.dbg.spill, !475, !DIExpression(), !478)
  store ptr %op, ptr %op.dbg.spill, align 8
    #dbg_declare(ptr %op.dbg.spill, !476, !DIExpression(), !478)
  %3 = getelementptr inbounds i8, ptr %d.1, i64 24, !dbg !479
  %4 = load ptr, ptr %3, align 8, !dbg !479, !invariant.load !16, !nonnull !16
  %_0 = call i32 %4(ptr %d.0), !dbg !479
  ret i32 %_0, !dbg !480
}

; Function Attrs: uwtable
define i32 @recursive_fn_type() unnamed_addr #2 !dbg !481 !guid !484 {
start:
; call types::rec_impl
  call void @_RNvCs15oYSsIuqjM_5types8rec_impl(), !dbg !485
; call types::take::<types::rec_impl>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_(), !dbg !485
  ret i32 %_0, !dbg !486
}

; Function Attrs: uwtable
define i32 @structs(ptr align 8 %p, i64 %q.0, i16 %q.1, ptr align 4 %g, ptr align 8 %l) unnamed_addr #2 !dbg !487 !guid !512 {
start:
  %_u.dbg.spill = alloca [0 x i8], align 1
  %l.dbg.spill = alloca [8 x i8], align 8
  %_3.dbg.spill = alloca [0 x i8], align 1
  %q.dbg.spill = alloca [16 x i8], align 8
  %p.dbg.spill = alloca [8 x i8], align 8
  store ptr %p, ptr %p.dbg.spill, align 8
    #dbg_declare(ptr %p.dbg.spill, !506, !DIExpression(), !513)
  store i64 %q.0, ptr %q.dbg.spill, align 8
  %0 = getelementptr inbounds i8, ptr %q.dbg.spill, i64 8
  store i16 %q.1, ptr %0, align 8
    #dbg_declare(ptr %q.dbg.spill, !507, !DIExpression(), !513)
    #dbg_declare(ptr %_3.dbg.spill, !511, !DIExpression(), !513)
    #dbg_declare(ptr %g, !509, !DIExpression(), !513)
  store ptr %l, ptr %l.dbg.spill, align 8
    #dbg_declare(ptr %l.dbg.spill, !510, !DIExpression(), !513)
    #dbg_declare(ptr %_u.dbg.spill, !508, !DIExpression(), !513)
  %1 = getelementptr inbounds i8, ptr %p, i64 12, !dbg !514
  %_6 = load i8, ptr %1, align 4, !dbg !514
  %_0 = zext i8 %_6 to i32, !dbg !514
  ret i32 %_0, !dbg !515
}

; Function Attrs: uwtable
define i32 @union_(i32 %0) unnamed_addr #2 !dbg !516 !guid !525 {
start:
  %1 = alloca [4 x i8], align 4
  %u = alloca [4 x i8], align 4
  store i32 %0, ptr %1, align 4
  call void @llvm.memcpy.p0.p0.i64(ptr align 4 %u, ptr align 4 %1, i64 4, i1 false)
    #dbg_declare(ptr %u, !524, !DIExpression(), !526)
  %_0 = load i32, ptr %u, align 4, !dbg !527
  ret i32 %_0, !dbg !528
}

; Function Attrs: uwtable
define i8 @visibility(ptr %v) unnamed_addr #2 !dbg !529 !guid !542 {
start:
  %v.dbg.spill = alloca [8 x i8], align 8
  store ptr %v, ptr %v.dbg.spill, align 8
    #dbg_declare(ptr %v.dbg.spill, !541, !DIExpression(), !543)
  %0 = getelementptr inbounds i8, ptr %v, i64 3, !dbg !544
  %_0 = load i8, ptr %0, align 1, !dbg !544
  ret i8 %_0, !dbg !545
}

; Function Attrs: uwtable
define { ptr, ptr } @vtable(ptr align 8 %p) unnamed_addr #2 !dbg !546 !guid !551 {
start:
  %p.dbg.spill = alloca [8 x i8], align 8
  store ptr %p, ptr %p.dbg.spill, align 8
    #dbg_declare(ptr %p.dbg.spill, !550, !DIExpression(), !552)
  %0 = insertvalue { ptr, ptr } poison, ptr %p, 0, !dbg !553
  %1 = insertvalue { ptr, ptr } %0, ptr @vtable.0, 1, !dbg !553
  ret { ptr, ptr } %1, !dbg !553
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #3

attributes #0 = { noinline uwtable "target-cpu"="x86-64" "target-features"="+cx16,+sse,+sse2,+sse3,+sahf" }
attributes #1 = { noreturn uwtable "target-cpu"="x86-64" "target-features"="+cx16,+sse,+sse2,+sse3,+sahf" }
attributes #2 = { uwtable "target-cpu"="x86-64" "target-features"="+cx16,+sse,+sse2,+sse3,+sahf" }
attributes #3 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }
attributes #4 = { noreturn }

!llvm.module.flags = !{!31, !32, !33, !34}
!llvm.ident = !{!35}
!llvm.dbg.cu = !{!36}

!0 = !DIGlobalVariableExpression(var: !1, expr: !DIExpression())
!1 = distinct !DIGlobalVariable(name: "GLOBAL", linkageName: "_RNvCs15oYSsIuqjM_5types6GLOBAL", scope: !2, file: !3, line: 114, type: !4, isLocal: false, isDefinition: true, align: 64)
!2 = !DINamespace(name: "types", scope: null)
!3 = !DIFile(filename: "types.rs", directory: ".", checksumkind: CSK_SHA256, checksum: "6a1e9467d7109215017a5b336a5dbaf458aefa2b1f0086626c0efb0781fb709e")
!4 = !DICompositeType(tag: DW_TAG_structure_type, name: "Point", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !6, templateParams: !16, identifier: "308b9833e873e4487af9ab3f6fc9138b")
!5 = !DIFile(filename: "<unknown>", directory: "")
!6 = !{!7, !10, !13}
!7 = !DIDerivedType(tag: DW_TAG_member, name: "x", scope: !4, file: !5, baseType: !8, size: 32, align: 32, offset: 64, flags: DIFlagPublic)
!8 = !DIDerivedType(tag: DW_TAG_typedef, name: "i32", file: !5, baseType: !9)
!9 = !DIBasicType(name: "__int32", size: 32, encoding: DW_ATE_signed)
!10 = !DIDerivedType(tag: DW_TAG_member, name: "y", scope: !4, file: !5, baseType: !11, size: 64, align: 64, flags: DIFlagPrivate)
!11 = !DIDerivedType(tag: DW_TAG_typedef, name: "f64", file: !5, baseType: !12)
!12 = !DIBasicType(name: "double", size: 64, encoding: DW_ATE_float)
!13 = !DIDerivedType(tag: DW_TAG_member, name: "z", scope: !4, file: !5, baseType: !14, size: 8, align: 8, offset: 96, flags: DIFlagPrivate)
!14 = !DIDerivedType(tag: DW_TAG_typedef, name: "u8", file: !5, baseType: !15)
!15 = !DIBasicType(name: "unsigned __int8", size: 8, encoding: DW_ATE_unsigned)
!16 = !{}
!17 = !{i64 -2440327355056123239}
!18 = !DIGlobalVariableExpression(var: !19, expr: !DIExpression())
!19 = distinct !DIGlobalVariable(name: "impl$<types::Point, types::Shape>::vtable$", scope: null, file: !5, type: !20, isLocal: true, isDefinition: true)
!20 = !DICompositeType(tag: DW_TAG_structure_type, name: "impl$<types::Point, types::Shape>::vtable_type$", file: !5, size: 256, align: 64, flags: DIFlagArtificial, elements: !21, vtableHolder: !4, templateParams: !16, identifier: "3d57a5951e71546da41ef57cf0b7bf59")
!21 = !{!22, !25, !28, !29}
!22 = !DIDerivedType(tag: DW_TAG_member, name: "drop_in_place", scope: !20, file: !5, baseType: !23, size: 64, align: 64)
!23 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ptr_const$<tuple$<> >", baseType: !24, size: 64, align: 64, dwarfAddressSpace: 0)
!24 = !DICompositeType(tag: DW_TAG_structure_type, name: "tuple$<>", file: !5, align: 8, elements: !16, identifier: "46dc9fa5938407e177dc75118fa86611")
!25 = !DIDerivedType(tag: DW_TAG_member, name: "size", scope: !20, file: !5, baseType: !26, size: 64, align: 64, offset: 64)
!26 = !DIDerivedType(tag: DW_TAG_typedef, name: "usize", file: !5, baseType: !27)
!27 = !DIBasicType(name: "size_t", size: 64, encoding: DW_ATE_unsigned)
!28 = !DIDerivedType(tag: DW_TAG_member, name: "align", scope: !20, file: !5, baseType: !26, size: 64, align: 64, offset: 128)
!29 = !DIDerivedType(tag: DW_TAG_member, name: "__method3", scope: !20, file: !5, baseType: !23, size: 64, align: 64, offset: 192)
!30 = !{i64 -6426483837549638915}
!31 = !{i32 8, !"PIC Level", i32 2}
!32 = !{i32 7, !"uwtable", i32 2}
!33 = !{i32 2, !"CodeView", i32 1}
!34 = !{i32 2, !"Debug Info Version", i32 3}
!35 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!36 = distinct !DICompileUnit(language: DW_LANG_Rust, file: !37, producer: "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug, enums: !38, globals: !307, splitDebugInlining: false)
!37 = !DIFile(filename: "types.rs/@/types.ca9a2c18325d504-cgu.0", directory: ".")
!38 = !{!39, !44, !86, !114, !148, !165, !191, !218, !250, !278}
!39 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "CLike", scope: !2, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagEnumClass, elements: !40)
!40 = !{!41, !42, !43}
!41 = !DIEnumerator(name: "A", value: 0, isUnsigned: true)
!42 = !DIEnumerator(name: "B", value: 5, isUnsigned: true)
!43 = !DIEnumerator(name: "C", value: 6, isUnsigned: true)
!44 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !45, file: !5, baseType: !54, size: 32, align: 32, flags: DIFlagEnumClass, elements: !82)
!45 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Tagged>", file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !46, templateParams: !16, identifier: "7a09859a618fbf60b7f03e353ea66444")
!46 = !{!47, !62, !74, !81}
!47 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !45, file: !5, baseType: !48, size: 128, align: 64, flags: DIFlagPublic)
!48 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !45, file: !5, size: 128, align: 64, elements: !49, templateParams: !16, identifier: "ee6afa6597c5c511238fd6091a453dd0")
!49 = !{!50, !56, !58}
!50 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !48, file: !5, baseType: !51, size: 128, align: 64)
!51 = !DICompositeType(tag: DW_TAG_structure_type, name: "One", scope: !45, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !52, templateParams: !16, identifier: "c665cbede025898820f5e95706c59e3d")
!52 = !{!53}
!53 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !51, file: !5, baseType: !54, size: 32, align: 32, offset: 32, flags: DIFlagPublic)
!54 = !DIDerivedType(tag: DW_TAG_typedef, name: "u32", file: !5, baseType: !55)
!55 = !DIBasicType(name: "unsigned __int32", size: 32, encoding: DW_ATE_unsigned)
!56 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !48, file: !5, baseType: !57, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!57 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !44)
!58 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !48, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!59 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !60)
!60 = !DIDerivedType(tag: DW_TAG_typedef, name: "u64", file: !5, baseType: !61)
!61 = !DIBasicType(name: "unsigned __int64", size: 64, encoding: DW_ATE_unsigned)
!62 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !45, file: !5, baseType: !63, size: 128, align: 64, flags: DIFlagPublic)
!63 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !45, file: !5, size: 128, align: 64, elements: !64, templateParams: !16, identifier: "536c0951f75c238db7d9756cb97e65a7")
!64 = !{!65, !72, !73}
!65 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !63, file: !5, baseType: !66, size: 128, align: 64)
!66 = !DICompositeType(tag: DW_TAG_structure_type, name: "Two", scope: !45, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !67, templateParams: !16, identifier: "c09a96c7dcac441a491510fc40babb8")
!67 = !{!68, !69}
!68 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !66, file: !5, baseType: !60, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!69 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !66, file: !5, baseType: !70, size: 8, align: 8, offset: 8, flags: DIFlagPublic)
!70 = !DIDerivedType(tag: DW_TAG_typedef, name: "i8", file: !5, baseType: !71)
!71 = !DIBasicType(name: "__int8", size: 8, encoding: DW_ATE_signed)
!72 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !63, file: !5, baseType: !57, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!73 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !63, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!74 = !DIDerivedType(tag: DW_TAG_member, name: "variant2", scope: !45, file: !5, baseType: !75, size: 128, align: 64, flags: DIFlagPublic)
!75 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant2", scope: !45, file: !5, size: 128, align: 64, elements: !76, templateParams: !16, identifier: "f964c8150a61fec8ea04ddd26999f105")
!76 = !{!77, !79, !80}
!77 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !75, file: !5, baseType: !78, size: 128, align: 64)
!78 = !DICompositeType(tag: DW_TAG_structure_type, name: "Three", scope: !45, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !16, identifier: "42f47fc3dc3096c640fb5aebb978d263")
!79 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !75, file: !5, baseType: !57, align: 32, flags: DIFlagStaticMember, extraData: i64 2)
!80 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !75, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 2)
!81 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !45, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagPublic)
!82 = !{!83, !84, !85}
!83 = !DIEnumerator(name: "One", value: 0, isUnsigned: true)
!84 = !DIEnumerator(name: "Two", value: 1, isUnsigned: true)
!85 = !DIEnumerator(name: "Three", value: 2, isUnsigned: true)
!86 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !87, file: !5, baseType: !54, size: 32, align: 32, flags: DIFlagEnumClass, elements: !111)
!87 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Option<ref$<u32> > >", file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !88, templateParams: !16, identifier: "ed51b03b247287f78ba1f38cb9acddcc")
!88 = !{!89, !100, !110}
!89 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !87, file: !5, baseType: !90, size: 64, align: 64, flags: DIFlagPublic)
!90 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !87, file: !5, size: 64, align: 64, elements: !91, templateParams: !16, identifier: "2faeaab8e93bbeda33244fb6069000b2")
!91 = !{!92, !97, !99}
!92 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !90, file: !5, baseType: !93, size: 64, align: 64)
!93 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !87, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !16, templateParams: !94, identifier: "f0a46f3663c63171c9dc683a6faecac0")
!94 = !{!95}
!95 = !DITemplateTypeParameter(name: "T", type: !96)
!96 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<u32>", baseType: !54, size: 64, align: 64, dwarfAddressSpace: 0)
!97 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !90, file: !5, baseType: !98, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!98 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !86)
!99 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !90, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!100 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !87, file: !5, baseType: !101, size: 64, align: 64, flags: DIFlagPublic)
!101 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !87, file: !5, size: 64, align: 64, elements: !102, templateParams: !16, identifier: "8886950086c89303465a304a65944084")
!102 = !{!103, !107, !108, !109}
!103 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !101, file: !5, baseType: !104, size: 64, align: 64)
!104 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !87, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !105, templateParams: !94, identifier: "8d7c597acf3c283f429ba8765eea1968")
!105 = !{!106}
!106 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !104, file: !5, baseType: !96, size: 64, align: 64, flags: DIFlagPublic)
!107 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !101, file: !5, baseType: !98, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!108 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_BEGIN", scope: !101, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!109 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_END", scope: !101, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 -1)
!110 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !87, file: !5, baseType: !60, size: 64, align: 64, flags: DIFlagPublic)
!111 = !{!112, !113}
!112 = !DIEnumerator(name: "None", value: 0, isUnsigned: true)
!113 = !DIEnumerator(name: "Some", value: 1, isUnsigned: true)
!114 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !115, file: !5, baseType: !54, size: 32, align: 32, flags: DIFlagEnumClass, elements: !144)
!115 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Niche>", file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !116, templateParams: !16, identifier: "2e768aced9ebecf4f9b14578e52e8ced")
!116 = !{!117, !129, !136, !143}
!117 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !115, file: !5, baseType: !118, size: 8, align: 8, flags: DIFlagPublic)
!118 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !115, file: !5, size: 8, align: 8, elements: !119, templateParams: !16, identifier: "776932099d8beba7d6429ebaa1518b33")
!119 = !{!120, !125, !127, !128}
!120 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !118, file: !5, baseType: !121, size: 8, align: 8)
!121 = !DICompositeType(tag: DW_TAG_structure_type, name: "A", scope: !115, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !122, templateParams: !16, identifier: "199633efd9ee9f6fc1ce5b3db71839a8")
!122 = !{!123}
!123 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !121, file: !5, baseType: !124, size: 8, align: 8, flags: DIFlagPublic)
!124 = !DIBasicType(name: "bool", size: 8, encoding: DW_ATE_boolean)
!125 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !118, file: !5, baseType: !126, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!126 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !114)
!127 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_BEGIN", scope: !118, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!128 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_END", scope: !118, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!129 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !115, file: !5, baseType: !130, size: 8, align: 8, flags: DIFlagPublic)
!130 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !115, file: !5, size: 8, align: 8, elements: !131, templateParams: !16, identifier: "e82b86ae321196fa3194e9125df57f63")
!131 = !{!132, !134, !135}
!132 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !130, file: !5, baseType: !133, size: 8, align: 8)
!133 = !DICompositeType(tag: DW_TAG_structure_type, name: "B", scope: !115, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !16, identifier: "79e87793cf0c2eacd81fa34d6de2e77")
!134 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !130, file: !5, baseType: !126, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!135 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !130, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 2)
!136 = !DIDerivedType(tag: DW_TAG_member, name: "variant2", scope: !115, file: !5, baseType: !137, size: 8, align: 8, flags: DIFlagPublic)
!137 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant2", scope: !115, file: !5, size: 8, align: 8, elements: !138, templateParams: !16, identifier: "89995eab01536e11f33c404f42bc10ff")
!138 = !{!139, !141, !142}
!139 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !137, file: !5, baseType: !140, size: 8, align: 8)
!140 = !DICompositeType(tag: DW_TAG_structure_type, name: "C", scope: !115, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !16, identifier: "c68aa38615ac2ea80174f362c1f697a")
!141 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !137, file: !5, baseType: !126, align: 32, flags: DIFlagStaticMember, extraData: i64 2)
!142 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !137, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 3)
!143 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !115, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagPublic)
!144 = !{!145, !146, !147}
!145 = !DIEnumerator(name: "A", value: 0, isUnsigned: true)
!146 = !DIEnumerator(name: "B", value: 1, isUnsigned: true)
!147 = !DIEnumerator(name: "C", value: 2, isUnsigned: true)
!148 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !149, file: !5, baseType: !54, size: 32, align: 32, flags: DIFlagEnumClass, elements: !163)
!149 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Single>", file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !150, templateParams: !16, identifier: "99e2882fa157a99c759e60ab9c3b3f65")
!150 = !{!151, !162}
!151 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !149, file: !5, baseType: !152, size: 128, align: 64, flags: DIFlagPublic)
!152 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !149, file: !5, size: 128, align: 64, elements: !153, templateParams: !16, identifier: "2a375f42d5ee6b6b6fe1fae3b3c85a3e")
!153 = !{!154, !159, !161}
!154 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !152, file: !5, baseType: !155, size: 128, align: 64)
!155 = !DICompositeType(tag: DW_TAG_structure_type, name: "Only", scope: !149, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !156, templateParams: !16, identifier: "d78e06573f5341017ca9ac123671afa6")
!156 = !{!157, !158}
!157 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !155, file: !5, baseType: !54, size: 32, align: 32, offset: 64, flags: DIFlagPublic)
!158 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !155, file: !5, baseType: !60, size: 64, align: 64, flags: DIFlagPublic)
!159 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !152, file: !5, baseType: !160, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!160 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !148)
!161 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !152, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!162 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !149, file: !5, baseType: !148, align: 32, flags: DIFlagPublic | DIFlagStaticMember, extraData: i64 0)
!163 = !{!164}
!164 = !DIEnumerator(name: "Only", value: 0, isUnsigned: true)
!165 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !166, file: !5, baseType: !54, size: 32, align: 32, flags: DIFlagEnumClass, elements: !111)
!166 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Option<ref$<enum2$<types::Empty> > > >", file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !167, templateParams: !16, identifier: "9ec6ad741cd0cf6e134acb98a307d263")
!167 = !{!168, !180, !190}
!168 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !166, file: !5, baseType: !169, size: 64, align: 64, flags: DIFlagPublic)
!169 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !166, file: !5, size: 64, align: 64, elements: !170, templateParams: !16, identifier: "636c5c69b8529124c1f2590eac869412")
!170 = !{!171, !177, !179}
!171 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !169, file: !5, baseType: !172, size: 64, align: 64)
!172 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !166, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !16, templateParams: !173, identifier: "40e79cf9f10dccd63132410c3a601fa7")
!173 = !{!174}
!174 = !DITemplateTypeParameter(name: "T", type: !175)
!175 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<enum2$<types::Empty> >", baseType: !176, size: 64, align: 64, dwarfAddressSpace: 0)
!176 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Empty>", file: !5, align: 8, flags: DIFlagPublic, elements: !16, identifier: "64e96f3ce920dff82e10d4b6a35be4fb")
!177 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !169, file: !5, baseType: !178, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!178 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !165)
!179 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !169, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!180 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !166, file: !5, baseType: !181, size: 64, align: 64, flags: DIFlagPublic)
!181 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !166, file: !5, size: 64, align: 64, elements: !182, templateParams: !16, identifier: "487d2207a7f22fc42dc9e77e35717cd8")
!182 = !{!183, !187, !188, !189}
!183 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !181, file: !5, baseType: !184, size: 64, align: 64)
!184 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !166, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !185, templateParams: !173, identifier: "d733b5aa48f30b7797ac71a20eabbe3c")
!185 = !{!186}
!186 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !184, file: !5, baseType: !175, size: 64, align: 64, flags: DIFlagPublic)
!187 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !181, file: !5, baseType: !178, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!188 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_BEGIN", scope: !181, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!189 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_END", scope: !181, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 -1)
!190 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !166, file: !5, baseType: !60, size: 64, align: 64, flags: DIFlagPublic)
!191 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !192, file: !5, baseType: !54, size: 32, align: 32, flags: DIFlagEnumClass, elements: !215)
!192 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Wide>", file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !193, templateParams: !16, identifier: "580c897493afe5768312143f2fc7c866")
!193 = !{!194, !205, !213, !214}
!194 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !192, file: !5, baseType: !195, size: 256, align: 128, flags: DIFlagPublic)
!195 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !192, file: !5, size: 256, align: 128, elements: !196, templateParams: !16, identifier: "158ca601276ea566e6f37fb1849a6cec")
!196 = !{!197, !201, !203, !204}
!197 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !195, file: !5, baseType: !198, size: 256, align: 128)
!198 = !DICompositeType(tag: DW_TAG_structure_type, name: "X", scope: !192, file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !199, templateParams: !16, identifier: "edbe3ce3537b8454a1586fee1f8f976f")
!199 = !{!200}
!200 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !198, file: !5, baseType: !14, size: 8, align: 8, offset: 128, flags: DIFlagPublic)
!201 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !195, file: !5, baseType: !202, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!202 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !191)
!203 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR128_EXACT_LO", scope: !195, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!204 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR128_EXACT_HI", scope: !195, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!205 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !192, file: !5, baseType: !206, size: 256, align: 128, flags: DIFlagPublic)
!206 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !192, file: !5, size: 256, align: 128, elements: !207, templateParams: !16, identifier: "742bb51d783f318f3eea38fc782f2157")
!207 = !{!208, !210, !211, !212}
!208 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !206, file: !5, baseType: !209, size: 256, align: 128)
!209 = !DICompositeType(tag: DW_TAG_structure_type, name: "Y", scope: !192, file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !16, identifier: "af4b7981b1de14baf478bdaf175e1a20")
!210 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !206, file: !5, baseType: !202, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!211 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR128_EXACT_LO", scope: !206, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 -1)
!212 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR128_EXACT_HI", scope: !206, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 65535)
!213 = !DIDerivedType(tag: DW_TAG_member, name: "tag128_lo", scope: !192, file: !5, baseType: !60, size: 64, align: 64, flags: DIFlagPublic)
!214 = !DIDerivedType(tag: DW_TAG_member, name: "tag128_hi", scope: !192, file: !5, baseType: !60, size: 64, align: 64, offset: 64)
!215 = !{!216, !217}
!216 = !DIEnumerator(name: "X", value: 0, isUnsigned: true)
!217 = !DIEnumerator(name: "Y", value: 1, isUnsigned: true)
!218 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !219, file: !5, baseType: !54, size: 32, align: 32, flags: DIFlagEnumClass, elements: !251)
!219 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Rec<u8> >", file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !220, templateParams: !16, identifier: "bdcb87c0e6172cf96ca64813776a9af5")
!220 = !{!221, !268, !277}
!221 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !219, file: !5, baseType: !222, size: 128, align: 64, flags: DIFlagPublic)
!222 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !219, file: !5, size: 128, align: 64, elements: !223, templateParams: !16, identifier: "ce59f0381887f818216ec4bb73bc00")
!223 = !{!224, !265, !267}
!224 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !222, file: !5, baseType: !225, size: 128, align: 64)
!225 = !DICompositeType(tag: DW_TAG_structure_type, name: "Recurse", scope: !219, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !226, templateParams: !246, identifier: "47d9e89338842c2a9b75f1a10a02ddd8")
!226 = !{!227}
!227 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !225, file: !5, baseType: !228, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!228 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ptr_const$<enum2$<types::Rec<types::Pair2<u8> > > >", baseType: !229, size: 64, align: 64, dwarfAddressSpace: 0)
!229 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Rec<types::Pair2<u8> > >", file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !230, templateParams: !16, identifier: "5ede9f07d678e971a0ca7153f666e62")
!230 = !{!231, !255, !264}
!231 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !229, file: !5, baseType: !232, size: 128, align: 64, flags: DIFlagPublic)
!232 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !229, file: !5, size: 128, align: 64, elements: !233, templateParams: !16, identifier: "51a4b67288e271768cd7559ad32b756d")
!233 = !{!234, !248, !254}
!234 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !232, file: !5, baseType: !235, size: 128, align: 64)
!235 = !DICompositeType(tag: DW_TAG_structure_type, name: "Recurse", scope: !229, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !236, templateParams: !240, identifier: "ade1e3fa13f1df495ef599f3dbd8a94c")
!236 = !{!237}
!237 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !235, file: !5, baseType: !238, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!238 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ptr_const$<enum2$<types::Rec<types::Pair2<types::Pair2<u8> > > > >", baseType: !239, size: 64, align: 64, dwarfAddressSpace: 0)
!239 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Rec<types::Pair2<types::Pair2<u8> > > >", file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !16, identifier: "54791e7a79c18c75653e890640491966")
!240 = !{!241}
!241 = !DITemplateTypeParameter(name: "T", type: !242)
!242 = !DICompositeType(tag: DW_TAG_structure_type, name: "Pair2<u8>", scope: !2, file: !5, size: 16, align: 8, flags: DIFlagPublic, elements: !243, templateParams: !246, identifier: "317b48cb039e3e7fb5a8fbd2cc6135a5")
!243 = !{!244, !245}
!244 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !242, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagPrivate)
!245 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !242, file: !5, baseType: !14, size: 8, align: 8, offset: 8, flags: DIFlagPrivate)
!246 = !{!247}
!247 = !DITemplateTypeParameter(name: "T", type: !14)
!248 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !232, file: !5, baseType: !249, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!249 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !250)
!250 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !229, file: !5, baseType: !54, size: 32, align: 32, flags: DIFlagEnumClass, elements: !251)
!251 = !{!252, !253}
!252 = !DIEnumerator(name: "Recurse", value: 0, isUnsigned: true)
!253 = !DIEnumerator(name: "Item", value: 1, isUnsigned: true)
!254 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !232, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!255 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !229, file: !5, baseType: !256, size: 128, align: 64, flags: DIFlagPublic)
!256 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !229, file: !5, size: 128, align: 64, elements: !257, templateParams: !16, identifier: "a3513a087c97e1eea2d98407ab9e9553")
!257 = !{!258, !262, !263}
!258 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !256, file: !5, baseType: !259, size: 128, align: 64)
!259 = !DICompositeType(tag: DW_TAG_structure_type, name: "Item", scope: !229, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !260, templateParams: !240, identifier: "cee43346f500b874e72e06bc2d9e234a")
!260 = !{!261}
!261 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !259, file: !5, baseType: !242, size: 16, align: 8, offset: 8, flags: DIFlagPublic)
!262 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !256, file: !5, baseType: !249, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!263 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !256, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!264 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !229, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagPublic)
!265 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !222, file: !5, baseType: !266, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!266 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !218)
!267 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !222, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!268 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !219, file: !5, baseType: !269, size: 128, align: 64, flags: DIFlagPublic)
!269 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !219, file: !5, size: 128, align: 64, elements: !270, templateParams: !16, identifier: "303afcd472797dc2e9a9c07349eae2a5")
!270 = !{!271, !275, !276}
!271 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !269, file: !5, baseType: !272, size: 128, align: 64)
!272 = !DICompositeType(tag: DW_TAG_structure_type, name: "Item", scope: !219, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !273, templateParams: !246, identifier: "8bbff529e44d2a45a49c95f6b6c9380")
!273 = !{!274}
!274 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !272, file: !5, baseType: !14, size: 8, align: 8, offset: 8, flags: DIFlagPublic)
!275 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !269, file: !5, baseType: !266, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!276 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !269, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!277 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !219, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagPublic)
!278 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !279, file: !5, baseType: !54, size: 32, align: 32, flags: DIFlagEnumClass, elements: !111)
!279 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Option<ref$<types::List> > >", file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !280, templateParams: !16, identifier: "81608bde9c02ca68284619d5a8da3749")
!280 = !{!281, !296, !306}
!281 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !279, file: !5, baseType: !282, size: 64, align: 64, flags: DIFlagPublic)
!282 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !279, file: !5, size: 64, align: 64, elements: !283, templateParams: !16, identifier: "6c66799f47f97586bba62e66f13e5814")
!283 = !{!284, !293, !295}
!284 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !282, file: !5, baseType: !285, size: 64, align: 64)
!285 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !279, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !16, templateParams: !286, identifier: "e1386b739e649cc1b2ae583acd057ecc")
!286 = !{!287}
!287 = !DITemplateTypeParameter(name: "T", type: !288)
!288 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<types::List>", baseType: !289, size: 64, align: 64, dwarfAddressSpace: 0)
!289 = !DICompositeType(tag: DW_TAG_structure_type, name: "List", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !290, templateParams: !16, identifier: "784c52a69e4fd732fc2cb610c53ce42b")
!290 = !{!291, !292}
!291 = !DIDerivedType(tag: DW_TAG_member, name: "next", scope: !289, file: !5, baseType: !279, size: 64, align: 64, flags: DIFlagPrivate)
!292 = !DIDerivedType(tag: DW_TAG_member, name: "v", scope: !289, file: !5, baseType: !8, size: 32, align: 32, offset: 64, flags: DIFlagPrivate)
!293 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !282, file: !5, baseType: !294, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!294 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !278)
!295 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !282, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!296 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !279, file: !5, baseType: !297, size: 64, align: 64, flags: DIFlagPublic)
!297 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !279, file: !5, size: 64, align: 64, elements: !298, templateParams: !16, identifier: "6ee29b602a08e95f50e3dfe033101764")
!298 = !{!299, !303, !304, !305}
!299 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !297, file: !5, baseType: !300, size: 64, align: 64)
!300 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !279, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !301, templateParams: !286, identifier: "89da0816b97d49e3dac2e41fc3e93b83")
!301 = !{!302}
!302 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !300, file: !5, baseType: !288, size: 64, align: 64, flags: DIFlagPublic)
!303 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !297, file: !5, baseType: !294, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!304 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_BEGIN", scope: !297, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!305 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_END", scope: !297, file: !5, baseType: !59, align: 64, flags: DIFlagStaticMember, extraData: i64 -1)
!306 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !279, file: !5, baseType: !60, size: 64, align: 64, flags: DIFlagPublic)
!307 = !{!0, !18}
!308 = distinct !DISubprogram(name: "take<types::closure::closure_env$0>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_", scope: !2, file: !3, line: 156, type: !309, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !36, templateParams: !317, retainedNodes: !315)
!309 = !DISubroutineType(types: !310)
!310 = !{!54, !311}
!311 = !DICompositeType(tag: DW_TAG_structure_type, name: "closure_env$0", scope: !312, file: !5, size: 32, align: 32, elements: !313, templateParams: !16, identifier: "fc485e4bf1acde5e12ed9b065b27b2ae")
!312 = !DINamespace(name: "closure", scope: !2)
!313 = !{!314}
!314 = !DIDerivedType(tag: DW_TAG_member, name: "x", scope: !311, file: !5, baseType: !54, size: 32, align: 32)
!315 = !{!316}
!316 = !DILocalVariable(name: "t", arg: 1, scope: !308, file: !3, line: 156, type: !311)
!317 = !{!318}
!318 = !DITemplateTypeParameter(name: "T", type: !311)
!319 = !{i64 1915899645086356215}
!320 = !DILocation(line: 156, scope: !308)
!321 = !DILocation(line: 159, scope: !308)
!322 = distinct !DISubprogram(name: "take<recursive_type$ (*)()>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_", scope: !2, file: !3, line: 156, type: !323, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !36, templateParams: !331, retainedNodes: !329)
!323 = !DISubroutineType(types: !324)
!324 = !{!54, !325}
!325 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "recursive_type$ (*)()", baseType: !326, align: 8, dwarfAddressSpace: 0)
!326 = !DISubroutineType(types: !327)
!327 = !{!328}
!328 = !DIBasicType(name: "<recur_type>", size: 64, encoding: DW_ATE_unsigned)
!329 = !{!330}
!330 = !DILocalVariable(name: "t", arg: 1, scope: !322, file: !3, line: 156, type: !325)
!331 = !{!332}
!332 = !DITemplateTypeParameter(name: "T", type: !325)
!333 = !{i64 -740690765248574201}
!334 = !DILocation(line: 156, scope: !322)
!335 = !DILocation(line: 159, scope: !322)
!336 = distinct !DISubprogram(name: "diverge", linkageName: "_RNvCs15oYSsIuqjM_5types7diverge", scope: !2, file: !3, line: 147, type: !337, scopeLine: 147, flags: DIFlagPrototyped | DIFlagNoReturn, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !36, templateParams: !16)
!337 = !DISubroutineType(types: !338)
!338 = !{null}
!339 = !{i64 3518661633375468340}
!340 = !DILocation(line: 148, scope: !336)
!341 = distinct !DISubprogram(name: "rec_impl", linkageName: "_RNvCs15oYSsIuqjM_5types8rec_impl", scope: !2, file: !3, line: 168, type: !337, scopeLine: 168, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16)
!342 = !{i64 73545626838823865}
!343 = !DILocation(line: 170, scope: !341)
!344 = distinct !DISubprogram(name: "area", linkageName: "_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area", scope: !345, file: !3, line: 109, type: !346, scopeLine: 109, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16, retainedNodes: !349)
!345 = !DINamespace(name: "impl$9", scope: !2)
!346 = !DISubroutineType(types: !347)
!347 = !{!54, !348}
!348 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<types::Point>", baseType: !4, size: 64, align: 64, dwarfAddressSpace: 0)
!349 = !{!350}
!350 = !DILocalVariable(name: "self", arg: 1, scope: !344, file: !3, line: 109, type: !348)
!351 = !{i64 -4356820192056016148}
!352 = !DILocation(line: 109, scope: !344)
!353 = !DILocation(line: 110, scope: !344)
!354 = !DILocation(line: 111, scope: !344)
!355 = distinct !DISubprogram(name: "basics", scope: !2, file: !3, line: 132, type: !356, scopeLine: 132, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16, retainedNodes: !376)
!356 = !DISubroutineType(types: !357)
!357 = !{!54, !70, !60, !358, !11, !360, !26, !362, !364, !366, !371, !24, !375}
!358 = !DIDerivedType(tag: DW_TAG_typedef, name: "f32", file: !5, baseType: !359)
!359 = !DIBasicType(name: "float", size: 32, encoding: DW_ATE_float)
!360 = !DIDerivedType(tag: DW_TAG_typedef, name: "isize", file: !5, baseType: !361)
!361 = !DIBasicType(name: "ptrdiff_t", size: 64, encoding: DW_ATE_signed)
!362 = !DIDerivedType(tag: DW_TAG_typedef, name: "i128", file: !5, baseType: !363)
!363 = !DIBasicType(name: "__int128", size: 128, encoding: DW_ATE_signed)
!364 = !DIDerivedType(tag: DW_TAG_typedef, name: "u128", file: !5, baseType: !365)
!365 = !DIBasicType(name: "unsigned __int128", size: 128, encoding: DW_ATE_unsigned)
!366 = !DICompositeType(tag: DW_TAG_structure_type, name: "f16", file: !5, size: 16, align: 16, elements: !367, templateParams: !16, identifier: "482f2e429f63994a77033c9b9fb4ec97")
!367 = !{!368}
!368 = !DIDerivedType(tag: DW_TAG_member, name: "bits", scope: !366, file: !5, baseType: !369, size: 16, align: 16)
!369 = !DIDerivedType(tag: DW_TAG_typedef, name: "u16", file: !5, baseType: !370)
!370 = !DIBasicType(name: "unsigned __int16", size: 16, encoding: DW_ATE_unsigned)
!371 = !DICompositeType(tag: DW_TAG_structure_type, name: "f128", file: !5, size: 128, align: 128, elements: !372, templateParams: !16, identifier: "6f7b65fc657167ba766cd5847c5d14a0")
!372 = !{!373, !374}
!373 = !DIDerivedType(tag: DW_TAG_member, name: "low_bits", scope: !371, file: !5, baseType: !60, size: 64, align: 64)
!374 = !DIDerivedType(tag: DW_TAG_member, name: "high_bits", scope: !371, file: !5, baseType: !60, size: 64, align: 64, offset: 64)
!375 = !DIBasicType(name: "char", size: 32, encoding: DW_ATE_UTF)
!376 = !{!377, !378, !379, !380, !381, !382, !383, !384, !385, !386, !387, !388, !389}
!377 = !DILocalVariable(name: "a", arg: 1, scope: !355, file: !3, line: 132, type: !70)
!378 = !DILocalVariable(name: "b", arg: 2, scope: !355, file: !3, line: 132, type: !60)
!379 = !DILocalVariable(name: "c", arg: 3, scope: !355, file: !3, line: 132, type: !358)
!380 = !DILocalVariable(name: "d", arg: 4, scope: !355, file: !3, line: 132, type: !11)
!381 = !DILocalVariable(name: "e", arg: 5, scope: !355, file: !3, line: 132, type: !360)
!382 = !DILocalVariable(name: "f", arg: 6, scope: !355, file: !3, line: 132, type: !26)
!383 = !DILocalVariable(name: "g", arg: 7, scope: !355, file: !3, line: 132, type: !362)
!384 = !DILocalVariable(name: "h", arg: 8, scope: !355, file: !3, line: 132, type: !364)
!385 = !DILocalVariable(name: "i", arg: 9, scope: !355, file: !3, line: 132, type: !366)
!386 = !DILocalVariable(name: "j", arg: 10, scope: !355, file: !3, line: 132, type: !371)
!387 = !DILocalVariable(name: "k", scope: !355, file: !3, line: 132, type: !24, align: 8)
!388 = !DILocalVariable(name: "l", arg: 12, scope: !355, file: !3, line: 132, type: !375)
!389 = !DILocalVariable(arg: 11, scope: !355, file: !3, line: 132, type: !24)
!390 = !{i64 -5181654353206422152}
!391 = !DILocation(line: 132, scope: !355)
!392 = !DILocation(line: 135, scope: !355)
!393 = distinct !DISubprogram(name: "closure", scope: !2, file: !3, line: 151, type: !394, scopeLine: 151, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16, retainedNodes: !396)
!394 = !DISubroutineType(types: !395)
!395 = !{!54, !54}
!396 = !{!397, !398}
!397 = !DILocalVariable(name: "x", arg: 1, scope: !393, file: !3, line: 151, type: !54)
!398 = !DILocalVariable(name: "c", scope: !399, file: !3, line: 152, type: !311, align: 32)
!399 = distinct !DILexicalBlock(scope: !393, file: !3, line: 152)
!400 = !{i64 -8001930764763462056}
!401 = !DILocation(line: 151, scope: !393)
!402 = !DILocation(line: 152, scope: !393)
!403 = !DILocation(line: 152, scope: !399)
!404 = !DILocation(line: 153, scope: !399)
!405 = !DILocation(line: 154, scope: !393)
!406 = distinct !DISubprogram(name: "enums", scope: !2, file: !3, line: 122, type: !407, scopeLine: 122, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16, retainedNodes: !410)
!407 = !DISubroutineType(types: !408)
!408 = !{!54, !39, !45, !87, !115, !149, !166, !192, !409}
!409 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<enum2$<types::Rec<u8> > >", baseType: !219, size: 64, align: 64, dwarfAddressSpace: 0)
!410 = !{!411, !412, !413, !414, !415, !416, !417, !418}
!411 = !DILocalVariable(name: "c", arg: 1, scope: !406, file: !3, line: 122, type: !39)
!412 = !DILocalVariable(name: "t", arg: 2, scope: !406, file: !3, line: 122, type: !45)
!413 = !DILocalVariable(name: "o", arg: 3, scope: !406, file: !3, line: 122, type: !87)
!414 = !DILocalVariable(name: "n", arg: 4, scope: !406, file: !3, line: 122, type: !115)
!415 = !DILocalVariable(name: "s", scope: !406, file: !3, line: 122, type: !149, align: 64)
!416 = !DILocalVariable(name: "e", arg: 6, scope: !406, file: !3, line: 122, type: !166)
!417 = !DILocalVariable(name: "w", scope: !406, file: !3, line: 122, type: !192, align: 128)
!418 = !DILocalVariable(name: "r", arg: 8, scope: !406, file: !3, line: 122, type: !409)
!419 = !{i64 -6981848288932498368}
!420 = !DILocation(line: 122, scope: !406)
!421 = !DILocation(line: 125, scope: !406)
!422 = distinct !DISubprogram(name: "global", scope: !2, file: !3, line: 165, type: !423, scopeLine: 165, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16)
!423 = !DISubroutineType(types: !424)
!424 = !{!348}
!425 = !{i64 7866218443099566236}
!426 = !DILocation(line: 167, scope: !422)
!427 = distinct !DISubprogram(name: "never", scope: !2, file: !3, line: 141, type: !428, scopeLine: 141, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16, retainedNodes: !430)
!428 = !DISubroutineType(types: !429)
!429 = !{!54, !124}
!430 = !{!431}
!431 = !DILocalVariable(name: "flag", arg: 1, scope: !427, file: !3, line: 141, type: !124)
!432 = !{i64 4169515925740803783}
!433 = !DILocation(line: 141, scope: !427)
!434 = !DILocation(line: 142, scope: !427)
!435 = !DILocation(line: 146, scope: !427)
!436 = !DILocation(line: 143, scope: !427)
!437 = distinct !DISubprogram(name: "pointers", scope: !2, file: !3, line: 127, type: !438, scopeLine: 127, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16, retainedNodes: !469)
!438 = !DISubroutineType(types: !439)
!439 = !{!54, !440, !447, !452, !462, !463, !465, !466}
!440 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<slice2$<i64> >", file: !5, size: 128, align: 64, elements: !441, templateParams: !16, identifier: "b4a8090213073d4713897d6f185bba6b")
!441 = !{!442, !446}
!442 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !440, file: !5, baseType: !443, size: 64, align: 64)
!443 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !444, size: 64, align: 64, dwarfAddressSpace: 0)
!444 = !DIDerivedType(tag: DW_TAG_typedef, name: "i64", file: !5, baseType: !445)
!445 = !DIBasicType(name: "__int64", size: 64, encoding: DW_ATE_signed)
!446 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !440, file: !5, baseType: !26, size: 64, align: 64, offset: 64)
!447 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<str$>", file: !5, size: 128, align: 64, elements: !448, templateParams: !16, identifier: "6fc9dd7daffb1f73292744aea0793200")
!448 = !{!449, !451}
!449 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !447, file: !5, baseType: !450, size: 64, align: 64)
!450 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !14, size: 64, align: 64, dwarfAddressSpace: 0)
!451 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !447, file: !5, baseType: !26, size: 64, align: 64, offset: 64)
!452 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<dyn$<types::Shape> >", file: !5, size: 128, align: 64, elements: !453, templateParams: !16, identifier: "fe29d79d289ba2d7e0ec59f2c9f4dc75")
!453 = !{!454, !457}
!454 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !452, file: !5, baseType: !455, size: 64, align: 64)
!455 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !456, size: 64, align: 64, dwarfAddressSpace: 0)
!456 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn$<types::Shape>", file: !5, align: 8, elements: !16, identifier: "b991d0562d06e41c69a1bb075371dbaa")
!457 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !452, file: !5, baseType: !458, size: 64, align: 64, offset: 64)
!458 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<array$<usize,4> >", baseType: !459, size: 64, align: 64, dwarfAddressSpace: 0)
!459 = !DICompositeType(tag: DW_TAG_array_type, baseType: !26, size: 256, align: 64, elements: !460)
!460 = !{!461}
!461 = !DISubrange(count: 4, lowerBound: 0)
!462 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ptr_const$<u8>", baseType: !14, size: 64, align: 64, dwarfAddressSpace: 0)
!463 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref_mut$<array$<u16,4> >", baseType: !464, size: 64, align: 64, dwarfAddressSpace: 0)
!464 = !DICompositeType(tag: DW_TAG_array_type, baseType: !369, size: 64, align: 16, elements: !460)
!465 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "u32 (*)(u32)", baseType: !394, size: 64, align: 64, dwarfAddressSpace: 0)
!466 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<types::extern$0::Opaque>", baseType: !467, size: 64, align: 64, dwarfAddressSpace: 0)
!467 = !DICompositeType(tag: DW_TAG_structure_type, name: "Opaque", scope: !468, file: !5, align: 8, elements: !16, identifier: "a3877f7c886e7d8757337d2282356247")
!468 = !DINamespace(name: "extern$0", scope: !2)
!469 = !{!470, !471, !472, !473, !474, !475, !476}
!470 = !DILocalVariable(name: "sl", scope: !437, file: !3, line: 127, type: !440, align: 64)
!471 = !DILocalVariable(name: "s", scope: !437, file: !3, line: 127, type: !447, align: 64)
!472 = !DILocalVariable(name: "d", scope: !437, file: !3, line: 127, type: !452, align: 64)
!473 = !DILocalVariable(name: "raw", arg: 4, scope: !437, file: !3, line: 127, type: !462)
!474 = !DILocalVariable(name: "m", arg: 5, scope: !437, file: !3, line: 127, type: !463)
!475 = !DILocalVariable(name: "f", arg: 6, scope: !437, file: !3, line: 127, type: !465)
!476 = !DILocalVariable(name: "op", arg: 7, scope: !437, file: !3, line: 127, type: !466)
!477 = !{i64 5285204393774026867}
!478 = !DILocation(line: 127, scope: !437)
!479 = !DILocation(line: 129, scope: !437)
!480 = !DILocation(line: 130, scope: !437)
!481 = distinct !DISubprogram(name: "recursive_fn_type", scope: !2, file: !3, line: 172, type: !482, scopeLine: 172, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16)
!482 = !DISubroutineType(types: !483)
!483 = !{!54}
!484 = !{i64 -4635464101160348947}
!485 = !DILocation(line: 173, scope: !481)
!486 = !DILocation(line: 174, scope: !481)
!487 = distinct !DISubprogram(name: "structs", scope: !2, file: !3, line: 117, type: !488, scopeLine: 117, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16, retainedNodes: !505)
!488 = !DISubroutineType(types: !489)
!489 = !{!54, !348, !490, !494, !495, !288}
!490 = !DICompositeType(tag: DW_TAG_structure_type, name: "Pair", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !491, templateParams: !16, identifier: "94ca5408626465f7a23119eb31190947")
!491 = !{!492, !493}
!492 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !490, file: !5, baseType: !369, size: 16, align: 16, offset: 64, flags: DIFlagPublic)
!493 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !490, file: !5, baseType: !444, size: 64, align: 64, flags: DIFlagPrivate)
!494 = !DICompositeType(tag: DW_TAG_structure_type, name: "Unit", scope: !2, file: !5, align: 8, flags: DIFlagPublic, elements: !16, identifier: "b08e6297ec0e9e2a1f0a6ab3d7c35d9b")
!495 = !DICompositeType(tag: DW_TAG_structure_type, name: "Gen<u8,tuple$<char,bool> >", scope: !2, file: !5, size: 96, align: 32, flags: DIFlagPublic, elements: !496, templateParams: !503, identifier: "5a83877b5744ceaeffe9ee3edc8fae67")
!496 = !{!497, !498}
!497 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !495, file: !5, baseType: !14, size: 8, align: 8, offset: 64, flags: DIFlagPrivate)
!498 = !DIDerivedType(tag: DW_TAG_member, name: "u", scope: !495, file: !5, baseType: !499, size: 64, align: 32, flags: DIFlagPrivate)
!499 = !DICompositeType(tag: DW_TAG_structure_type, name: "tuple$<char,bool>", file: !5, size: 64, align: 32, elements: !500, templateParams: !16, identifier: "23b612e9e1a9e610ca072c9f53b8f4c4")
!500 = !{!501, !502}
!501 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !499, file: !5, baseType: !375, size: 32, align: 32)
!502 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !499, file: !5, baseType: !124, size: 8, align: 8, offset: 32)
!503 = !{!247, !504}
!504 = !DITemplateTypeParameter(name: "U", type: !499)
!505 = !{!506, !507, !508, !509, !510, !511}
!506 = !DILocalVariable(name: "p", arg: 1, scope: !487, file: !3, line: 117, type: !348)
!507 = !DILocalVariable(name: "q", scope: !487, file: !3, line: 117, type: !490, align: 64)
!508 = !DILocalVariable(name: "_u", scope: !487, file: !3, line: 117, type: !494, align: 8)
!509 = !DILocalVariable(name: "g", arg: 4, scope: !487, file: !3, line: 117, type: !495)
!510 = !DILocalVariable(name: "l", arg: 5, scope: !487, file: !3, line: 117, type: !288)
!511 = !DILocalVariable(arg: 3, scope: !487, file: !3, line: 117, type: !494)
!512 = !{i64 -3801848370686489254}
!513 = !DILocation(line: 117, scope: !487)
!514 = !DILocation(line: 119, scope: !487)
!515 = !DILocation(line: 120, scope: !487)
!516 = distinct !DISubprogram(name: "union_", scope: !2, file: !3, line: 137, type: !517, scopeLine: 137, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16, retainedNodes: !523)
!517 = !DISubroutineType(types: !518)
!518 = !{!54, !519}
!519 = !DICompositeType(tag: DW_TAG_union_type, name: "U", scope: !2, file: !5, size: 32, align: 32, elements: !520, templateParams: !16, identifier: "e8c023c6fa2b313aec2f51fb48fcaef3")
!520 = !{!521, !522}
!521 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !519, file: !5, baseType: !54, size: 32, align: 32)
!522 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !519, file: !5, baseType: !358, size: 32, align: 32)
!523 = !{!524}
!524 = !DILocalVariable(name: "u", arg: 1, scope: !516, file: !3, line: 137, type: !519)
!525 = !{i64 3738193153085972219}
!526 = !DILocation(line: 137, scope: !516)
!527 = !DILocation(line: 138, scope: !516)
!528 = !DILocation(line: 139, scope: !516)
!529 = distinct !DISubprogram(name: "visibility", scope: !2, file: !3, line: 185, type: !530, scopeLine: 185, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16, retainedNodes: !540)
!530 = !DISubroutineType(types: !531)
!531 = !{!14, !532}
!532 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<types::inner::Vis>", baseType: !533, size: 64, align: 64, dwarfAddressSpace: 0)
!533 = !DICompositeType(tag: DW_TAG_structure_type, name: "Vis", scope: !534, file: !5, size: 32, align: 8, flags: DIFlagPublic, elements: !535, templateParams: !16, identifier: "c8763aed17c9ea6b868c91e2dc0d11a2")
!534 = !DINamespace(name: "inner", scope: !2)
!535 = !{!536, !537, !538, !539}
!536 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !533, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagProtected)
!537 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !533, file: !5, baseType: !14, size: 8, align: 8, offset: 8, flags: DIFlagProtected)
!538 = !DIDerivedType(tag: DW_TAG_member, name: "c", scope: !533, file: !5, baseType: !14, size: 8, align: 8, offset: 16, flags: DIFlagPrivate)
!539 = !DIDerivedType(tag: DW_TAG_member, name: "d", scope: !533, file: !5, baseType: !14, size: 8, align: 8, offset: 24, flags: DIFlagPublic)
!540 = !{!541}
!541 = !DILocalVariable(name: "v", arg: 1, scope: !529, file: !3, line: 185, type: !532)
!542 = !{i64 3148254357277744119}
!543 = !DILocation(line: 185, scope: !529)
!544 = !DILocation(line: 186, scope: !529)
!545 = !DILocation(line: 187, scope: !529)
!546 = distinct !DISubprogram(name: "vtable", scope: !2, file: !3, line: 161, type: !547, scopeLine: 161, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !36, templateParams: !16, retainedNodes: !549)
!547 = !DISubroutineType(types: !548)
!548 = !{!452, !348}
!549 = !{!550}
!550 = !DILocalVariable(name: "p", arg: 1, scope: !546, file: !3, line: 161, type: !348)
!551 = !{i64 3405836996193402751}
!552 = !DILocation(line: 161, scope: !546)
!553 = !DILocation(line: 163, scope: !546)

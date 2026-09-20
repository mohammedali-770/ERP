# Risk register

<!--
GENERATED FILE — do not edit by hand.
Regenerate with: npm run prd:extract
source: docs/source/First_Taste_ERP_PRD_v0.9.docx
source_sha256: 895af80711dfe0a2d1dcb948b729a9d70fa4ab3d1838d1f6591c381da7dc4868
-->

The 10 key risks the PRD records in section 10.1 — 2 critical · 6 high · 2 medium.

These identifiers are cited as authority across the architecture, the spikes
and the programme documents, so they are extracted from the source rather than
transcribed. `req-lint` checks that every `R-NN` cited anywhere resolves to a
row below.

---

| | Severity | Risk | Mitigation |
|---|---|---|---|
| `R-01` | **High** | Printing reliability on iPad under simultaneous multi-channel load | Prototype persistent print queue early; test iPad, Windows and controller options in the HQ lab; approve hardware only after recovery tests. |
| `R-02` | **Critical** | Offline synchronization creates duplicates or conflicting financial records | Use immutable IDs, durable outbox, idempotent handlers, append-only corrections and repeated disconnect tests. |
| `R-03` | **High** | Scope expansion delays the nine-month POS milestone | Enforce F1 scope: platform foundation, POS, menu, OMS and essential dependencies; defer full ERP modules to later phases. |
| `R-04` | **High** | Direct delivery-platform APIs are unavailable, limited or unstable | Use replaceable adapters, contract tests, retry and monitoring; maintain an approved temporary operational fallback. |
| `R-05` | **Critical** | ZATCA requirements change or certification reveals gaps | Use current official specifications, specialist review, sandbox testing and a dedicated compliance acceptance gate. |
| `R-06` | **High** | Native accounting scope is underestimated | Treat finance as a separate governed phase with accountants, chart design, posting rules, parallel close and audit evidence. |
| `R-07` | **High** | AI performs an unauthorized or harmful action | Tool-level permissions, approval gates, allowlists, limits, audit logs, kill switches and adversarial tests. |
| `R-08` | Medium | Historical data is incomplete or inconsistent | Audit exports before committing migration scope; preserve source archives and reconcile opening balances. |
| `R-09` | **High** | Management approves features but operational users cannot perform real workflows | Use HQ lab simulations, cashier and kitchen UAT, branch-volume load, training mode and formal executive evidence. |
| `R-10` | Medium | First Taste becomes dependent on one provider or proprietary component | Own custom code and data, document licenses, isolate external adapters and maintain export and replacement paths. |

## العربية

| | الخطورة | الخطر | المعالجة |
|---|---|---|---|
| `R-01` | مرتفع | موثوقية الطباعة على الآيباد تحت حمل متزامن من عدة قنوات | بناء نموذج لقائمة طباعة دائمة مبكرا واختبار الآيباد وويندوز ووحدة التحكم وعدم اعتماد الأجهزة قبل اختبارات الاستعادة. |
| `R-02` | حرج | إنشاء المزامنة دون اتصال لسجلات مكررة أو مالية متعارضة | استخدام معرفات ثابتة وصندوق صادر دائم ومعالجات مقاومة للتكرار وتصحيحات إضافية واختبارات انقطاع متكررة. |
| `R-03` | مرتفع | توسع النطاق يؤخر هدف نقاط البيع خلال تسعة أشهر | فرض نطاق F1 للأساس ونقاط البيع والقائمة وإدارة الطلبات واعتماداته الضرورية وتأجيل بقية الوحدات. |
| `R-04` | مرتفع | واجهات منصات التوصيل المباشرة غير متاحة أو محدودة أو غير مستقرة | استخدام موصلات قابلة للاستبدال واختبارات عقود وإعادة محاولة ومراقبة والحفاظ على بديل تشغيلي مؤقت معتمد. |
| `R-05` | حرج | تغير متطلبات زاتكا أو ظهور فجوات أثناء الاعتماد | استخدام المواصفات الرسمية الحالية ومراجعة متخصصة واختبار البيئة التجريبية وبوابة قبول امتثال مستقلة. |
| `R-06` | مرتفع | الاستهانة بنطاق المحاسبة الأصلية | التعامل مع المالية كمرحلة مستقلة محكومة بمشاركة المحاسبين ودليل الحسابات وقواعد الترحيل والإقفال الموازي وأدلة التدقيق. |
| `R-07` | مرتفع | تنفيذ الذكاء الاصطناعي إجراء غير مصرح أو ضار | صلاحيات على مستوى الأدوات وبوابات اعتماد وقوائم سماح وحدود وسجلات تدقيق ومفاتيح إيقاف واختبارات هجومية. |
| `R-08` | متوسط | البيانات التاريخية ناقصة أو غير متسقة | تدقيق التصدير قبل اعتماد نطاق الترحيل والاحتفاظ بأرشيف المصدر ومطابقة الأرصدة الافتتاحية. |
| `R-09` | مرتفع | اعتماد الإدارة للميزات مع عدم قدرة المستخدمين التشغيليين على تنفيذ العمل الفعلي | استخدام محاكاة المختبر واختبار قبول الكاشير والمطبخ وحمل الفروع ووضع التدريب وأدلة تنفيذية رسمية. |
| `R-10` | متوسط | اعتماد الطعم الأول على مزود أو مكون مغلق واحد | امتلاك الشفرة والبيانات وتوثيق التراخيص وعزل الموصلات الخارجية والحفاظ على مسارات تصدير واستبدال. |

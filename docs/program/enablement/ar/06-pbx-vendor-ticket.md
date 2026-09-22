# تذكرة دعم لنظام الهاتف — مسودة

**النسخة الإنجليزية:** [`../06-pbx-vendor-ticket.md`](../06-pbx-vendor-ticket.md) — وهي المرجع عند أي اختلاف.

> ⚠️ **ترجمة لم تُراجع بعد من متحدث بالعربية.**
>
> **نص المسودة أدناه يبقى بالإنجليزية عمدا ولم يُترجم.** فهو النص الذي يُلصق في
> تذكرة الدعم لدى Yeastar، ودعمها يعمل بالإنجليزية. ترجمته تُنتج شيئا لا يمكن
> إرساله. أما الإرشادات حوله فمترجمة.

**لمن:** تقنية المعلومات، لإرسالها إلى دعم Yeastar أو الموزّع
**يرفع الحجب عن:** B-07
**الوقت اللازم:** راجع الوقائع أدناه، أضف بيانات الحساب، وأرسل

---

## لماذا كُتبت كمسودة بدل وصفها

الأدلة مجمّعة أصلا من حزمة التشخيص. وإرسالها ينبغي أن يستغرق دقائق لا أمسية من
قراءة السجلات. **أكّد الرقم التسلسلي الذي قرأناه من حزمة التشخيص، واملأ الحقول
الثلاثة بين الأقواس، وتحقق من الوقائع مقابل سجلاتك، وأرسل.**

بعض ما ورد غير مؤكد فعلا — ومُعلَّم في موضعه. قل "لا نعلم" بدل التخمين؛ فتفصيل
خاطئ يكلف أكثر من تفصيل ناقص.

---

> **⬇ النص التالي يُرسل كما هو بالإنجليزية. لا تترجمه.**

<!-- verbatim-from: ../06-pbx-vendor-ticket.md#draft -->

## Draft

> **Subject:** P560 — repeated Asterisk crashes with automatic restarts
>
> **Serial:** `3632D4574233`, read from the diagnostic bundle
> (`basicsrv-run.log`) — **please confirm against your records**
> **Account:** `[fill in — the support or reseller account reference, if we have one]`
> **Reseller:** `[fill in, if purchased through one]`
> **Contact:** `[fill in]`
>
> ---
>
> **System**
>
> - Model: Yeastar P560
> - Firmware: 37.23.0.123
> - Component versions: linkus 1.24.3.4, thirdapp 1.13.3
> - Deployment: on-premise appliance, reached through the RAS cloud tunnel
>
> **Summary**
>
> On 26 July 2026 telephony was interrupted three times. The watchdog logged
> three Asterisk restarts, and three Asterisk core dumps were produced whose
> filenames carry signal 11. At the second and third restarts every Linkus client
> lost its connection simultaneously.
>
> We are planning an API integration against this system and need the platform's
> stability understood before we proceed.
>
> **Evidence — crashes**
>
> Three Asterisk core dumps were produced. Their filenames carry signal 11:
>
> | File | Size |
> |---|---|
> | `core.asterisk.18843.11` | 202 MB |
> | `core.asterisk.9130.11` | 413 MB |
> | `core.asterisk.19360.11` | 451 MB |
>
> No log in the export contains the words `Segmentation fault`, `SIGSEGV`,
> `signal 11` or `core dump`. The crash attribution above rests on the `.11`
> suffix in the core filenames, so please treat it as our reading rather than as
> something the logs state.
>
> `astguard.log` records three watchdog restarts, and **the first is not the same
> event as the other two**:
>
> | Time | What astguard logged | Recovery |
> |---|---|---|
> | 05:01:46 | `asterisk run twice, restart asterisk`, then `asterisk has no response` | ~1 s |
> | 15:42:09 | `asterisk didnot done===restart`, then `can not connect to asterisk` | 22 s |
> | 20:57:17 | `asterisk didnot done===restart`, then `can not connect to asterisk` | 21 s |
>
> The 05:01 entry is **86 seconds after a cold boot** — `messages` records
> `Booting Linux on physical CPU 0x0` at 05:00:20 — and reports a duplicate
> process rather than an unresponsive one. It may be a startup race and not the
> same fault as the two later events.
>
> **The process generations outnumber the restarts.** `trace-old.log` and
> `trace-new.log` contain periodic process captures. The distinct `/bin/asterisk`
> PIDs across them, in order, are **9096 · 9130 · 19360 · 22677 · 13362** — five
> generations, so **at least four** restarts, against three the watchdog logged.
> Two of those PIDs are the core dumps above (`9130`, `19360`), and the capture
> showing PID 9130 at 433 MB resident is consistent with its 413 MB dump.
>
> During the **15:42 and 20:57** restarts, `web_error.log` shows nginx returning
> `connect() failed (111: Connection refused)` while proxying to `127.0.0.1:81`
> for every Linkus client websocket — extensions 116 to 135 and 222 — confirming
> all clients dropped together rather than individually. `web_error.log` records
> **nothing at 05:01**, which is a further reason we think that event differs
> from the other two.
>
> **A separate, older observation — API token issuance**
>
> This is **not** from the day of the crashes, and we are raising it as a
> question rather than as part of the same incident.
>
> The bundle's `openapi.log` contains **six requests in total**, all
> `POST /openapi/v1.0/get_token`, from five different public source addresses,
> spanning **15:20:01 to 15:23:06 on 14 October 2025** — about three minutes,
> nine months before the crashes above. Every one returned **HTTP 200** carrying
> this in the body:
>
> ```
> {"errcode":-2,"errmsg":"INTERNAL SERVER ERROR",
>  "invalid_param_list":[{"value":"invalid character 'c' looking for beginning of value"}]}
> ```
>
> The message reads like a server-side JSON parsing failure rather than a
> malformed request from our side. **We have not retested since**, so we cannot
> say whether it still occurs.
>
> **Evidence — a kernel memory allocation failure**
>
> At **00:00:09 on 27 July 2026**, about three hours after the third restart, the kernel
> logged a page allocation failure in the ethernet receive path:
>
> ```
> swapper/0: page allocation failure: order:0, mode:0x1080020(GFP_ATOMIC)
>   warn_alloc+0xe8/0x180 ... fec_enet_rx_napi+0x4fc/0xb80
>   net_rx_action+0xf4/0x2c0 ... __do_softirq+0x12c/0x228
> ```
>
> An **order:0** atomic allocation failing means the kernel could not obtain a
> single 4 KB page in interrupt context. The accompanying `Mem-Info` records:
>
> | | |
> |---|---|
> | Total RAM | 523264 pages (~2 GB) |
> | Free | **350904 kB**, of which **~294 MB is CMA** |
> | Free vs. min watermark | 350904 kB against **min 22528 kB** — about 15× |
> | Free order-0 blocks | **11909 × 4 kB** (~48 MB) |
> | CMA reserved | 163840 pages (~640 MB) |
> | Anonymous in use | ~1.0 GB |
> | Dirty / writeback | ~40 MB / **~64 MB** |
> | **Swap** | **Total 0 kB, free 0 kB** |
>
> We want to be careful not to overstate this. The appliance was **not** out of
> memory: free was roughly fifteen times the minimum watermark, and nearly 12,000
> single pages were free. But a `GFP_ATOMIC` allocation cannot reclaim and cannot
> use CMA pages, and with ~294 MB of the free total being CMA, only about **57 MB**
> was available to an atomic non-movable request — while 64 MB sat in writeback.
>
> **Is this within the expected operating envelope for a P560, and is zero swap
> the intended configuration?** It occurred once in the captured period and we
> are not asserting it caused the crashes.
>
> **Other log conditions observed at the same time**
>
> We do not know whether these are related, contributory or incidental, and we are
> not asserting that they are causes:
>
> - `pjsip … CreatePermission failed … 443/Peer Address Family Mismatch (4)` —
>   **278 times**, appears to be IPv6 or TURN related
> - `channel.c:1270 Exceptionally long voice queue length` on queue
>   `only-dialextension-queue` — 4 times, all at 00:01 on 27 July, about a minute
>   after the kernel allocation failure below
> - A dialplan evaluation error, `ast_expr2 syntax error, unexpected '='` —
>   **464 times**
> - `{"errcode":20004,"errmsg":"no active collaboration"}` from the third-party
>   application module — **9,740 times**
>
> All four counts are from the top-level incident-day logs. Note for whoever
> opens the export: the `asterisk/` subdirectory inside it is a **stale snapshot
> from 11 April 2026 running firmware 37.22.0.17**, not from the incident, so
> please do not read those files as evidence for this day.
>
> **What we are asking**
>
> 1. Analysis of the core dumps — we can upload them on request. Please advise how
>    you would prefer to receive files of this size.
> 2. Why the number of Asterisk process generations we can see (five distinct
>    PIDs) exceeds the number of restarts the watchdog logged (three), and
>    whether astguard is expected to log every restart.
> 3. Whether firmware 37.23.0.123 has a known issue matching this crash signature.
>    We note that **37.23.0.123 (V24.3) was released on 20 July 2026 and the
>    crashes occurred on 26 July**, six days later — is this a known regression in
>    that build?
> 4. Whether any release since addresses it. We are aware that **V25.1
>    (37.24.0.30) and V25.2 (37.24.0.73) have shipped** and that neither set of
>    release notes mentions an Asterisk crash, watchdog or stability fix, so we do
>    not want to upgrade expecting a fix that is not there. **Please confirm
>    whether upgrading is a remedy here or merely unrelated good practice.**
> 5. Whether the `get_token` behaviour from October 2025 above is a known defect,
>    and whether anything in the intervening releases changes it. We also do not
>    recognise the five public source addresses those six requests came from —
>    **please confirm whether they belong to Yeastar cloud services.**
> 6. Whether `errcode 20004 "no active collaboration"` indicates a licensing or
>    provisioning state that needs correcting on our account.
> 7. Whether the dialplan syntax error above — which appears 464 times across
>    26 and 27 July — needs correcting by us.
>
> **Business impact**
>
> Telephony was unavailable to all users three times in one day. We are planning
> an API integration against this system and want the platform's stability
> understood before we build on it.
>
> **A note on the diagnostic bundle**
>
> The system log export contains plaintext credentials and core dumps. We are
> rotating those credentials separately. Please confirm how the bundle is handled
> and retained on your side if we upload it.

---

## قبل الإرسال — ثلاثة فحوص

1. **هل ما زال 26 يوليو آخر حدوث؟** الحزمة تلتقط يوما واحدا. فإن تعطل النظام بعد
   ذلك فقل ذلك وأرفق التصدير الأحدث — فالعطل المتكرر يُعامل معاملة مختلفة عن
   الحادث المنفرد.
2. **هل تغيّرت البرمجية الثابتة منذئذ؟** كانت 37.23.0.123 هي الحالية وقت
   الالتقاط.
3. **هل تواصل أحد مع الدعم بشكل غير رسمي؟** محادثة سابقة بلا تذكرة تستحق الذكر،
   حتى لا يُعامَل هذا كبلاغ أول. والحزمة لا تحسم هذا: يُظهر `ssh.log` تغيّر كلمة
   مرور حساب `support` مرتين في 26 يوليو، لكن الحساب الذي غيّرها هو الحساب الذي
   تعمل تحته عملية `/bin/asterisk` في المقسم نفسه، فهذا نشاط داخلي للجهاز
   **وليس** دليلا على تواصل مع المورّد.

## بعد الإرسال

سجّل رقم التذكرة في [`../../blocked.md`](../../blocked.md) تحت B-07. وما لم يوجد
رقم، فلا توجد تذكرة.

---

*الأدلة: حزمة التشخيص في مستودع `yeastarissue`. القيود التي يوجدها ذلك:
[ADR-0016](../../../adr/ADR-0016-call-centre-integration.md).*

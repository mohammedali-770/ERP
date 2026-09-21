# PBX support ticket — draft

**For:** IT, to send to Yeastar support or the reseller
**Unblocks:** B-07
**Time needed:** review the facts below, add the account details, send

---

## Why this is drafted rather than described

The evidence is already assembled from the diagnostic bundle. Sending it should
take minutes, not an afternoon of log-reading. **Fill in the three bracketed
fields, check the facts against your records, and send.**

Some of this is genuinely uncertain — flagged inline. Say "we don't know" rather
than guessing; a wrong detail costs more than a missing one.

---

## Draft

> **Subject:** P560 — repeated Asterisk crashes with automatic restarts, and
> OpenAPI `get_token` returning INTERNAL SERVER ERROR
>
> **Account / serial:** `[fill in]`
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
> On 26 July 2026 the Asterisk process terminated three times with SIGSEGV, and
> the system watchdog restarted it each time. During each restart every Linkus
> client lost its connection simultaneously. Separately and throughout, the
> OpenAPI token endpoint was returning an internal server error, which prevents
> any API integration from authenticating at all.
>
> We are planning an API integration against this system and need both issues
> understood before we proceed.
>
> **Evidence — crashes**
>
> Three core dumps were produced, all signal 11:
>
> | File | Size |
> |---|---|
> | `core.asterisk.18843.11` | 202 MB |
> | `core.asterisk.9130.11` | 413 MB |
> | `core.asterisk.19360.11` | 451 MB |
>
> `astguard.log` records watchdog restarts at approximately **05:01**, **15:42**
> and **20:57**. At 15:42 it logged `asterisk didnot done===restart` followed by
> `can not connect to asterisk`.
>
> During each restart, `web_error.log` shows nginx returning
> `connect() failed (111: Connection refused)` while proxying to `127.0.0.1:81`
> for every Linkus client websocket — extensions 116 to 135 and 222 — confirming
> all clients dropped together rather than individually.
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
> At **00:00:09 on 27 July 2026**, shortly after the third restart, the kernel
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
> | Free | ~351 MB, of which **~294 MB is CMA** |
> | CMA reserved | 163840 pages (~640 MB) |
> | Anonymous in use | ~1.0 GB |
> | Dirty / writeback | ~40 MB / **~64 MB** |
> | **Swap** | **Total 0 kB, free 0 kB** |
>
> So roughly **57 MB of genuinely allocatable memory** remained, with no swap.
> **Is this within the expected operating envelope for a P560, and is zero swap
> the intended configuration?** It occurred once in the captured period and we
> are not asserting it caused the crashes.
>
> **Other log conditions observed at the same time**
>
> We do not know whether these are related, contributory or incidental, and we are
> not asserting that they are causes:
>
> - Continuous `pjsip … CreatePermission failed … 443/Peer Address Family Mismatch (4)`
>   — appears to be IPv6 or TURN related
> - `channel.c:1270 Exceptionally long voice queue length` on queue
>   `only-dialextension-queue`
> - A dialplan evaluation error: `ast_expr2 syntax error, unexpected '='`
> - A high volume of `{"errcode":20004,"errmsg":"no active collaboration"}` from
>   the third-party application module
>
> **What we are asking**
>
> 1. Analysis of the core dumps — we can upload them on request. Please advise how
>    you would prefer to receive files of this size.
> 2. Whether firmware 37.23.0.123 has a known issue matching this crash signature.
>    We note that **37.23.0.123 (V24.3) was released on 20 July 2026 and the
>    crashes occurred on 26 July**, six days later — is this a known regression in
>    that build?
> 3. Whether any release since addresses it. We are aware that **V25.1
>    (37.24.0.30) and V25.2 (37.24.0.73) have shipped** and that neither set of
>    release notes mentions an Asterisk crash, watchdog or stability fix, so we do
>    not want to upgrade expecting a fix that is not there. **Please confirm
>    whether upgrading is a remedy here or merely unrelated good practice.**
> 4. Whether the `get_token` behaviour from October 2025 above is a known defect,
>    and whether anything in the intervening releases changes it.
> 5. Whether `errcode 20004 "no active collaboration"` indicates a licensing or
>    provisioning state that needs correcting on our account.
> 6. Whether the dialplan syntax error above needs correcting by us.
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

## Before sending — three checks

1. **Is 26 July still the most recent occurrence?** The bundle captures one day.
   If it has crashed since, say so and attach the newer export — a recurring fault
   is treated differently from a one-off.
2. **Has the firmware changed since?** 37.23.0.123 was current at capture.
3. **Did anyone already contact support informally?** A prior conversation with no
   ticket is worth mentioning, so this is not treated as a first report.

## After sending

Record the ticket reference in [`../blocked.md`](../blocked.md) under B-07.
Until there is a reference, there is no ticket.

---

*Evidence: the diagnostic bundle in the `yeastarissue` repository. Constraints
this creates: [ADR-0016](../../adr/ADR-0016-call-centre-integration.md).*

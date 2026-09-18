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
> **Evidence — API authentication failing**
>
> `openapi.log` shows every `POST /openapi/v1.0/get_token` returning:
>
> ```
> {"errcode":-2,"errmsg":"INTERNAL SERVER ERROR",
>  "invalid_param_list":[{"value":"invalid character 'c' looking for beginning of value"}]}
> ```
>
> The message suggests a server-side JSON parsing failure rather than a malformed
> request from our side. **We would like confirmation of whether that is correct**,
> and what causes it.
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
> 2. Whether firmware 37.23.0.123 has a known issue matching this crash signature,
>    and whether a later firmware addresses it.
> 3. The cause of the `get_token` internal server error, and how to resolve it.
> 4. Whether `errcode 20004 "no active collaboration"` indicates a licensing or
>    provisioning state that needs correcting on our account.
> 5. Whether the dialplan syntax error above needs correcting by us.
>
> **Business impact**
>
> Telephony was unavailable to all users three times in one day. We are also
> unable to begin a planned API integration while token issuance fails.
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

# Credential rotation runbook — PBX

**For:** IT
**Unblocks:** B-06
**Time needed:** about two hours, plus a maintenance window for the SIP step

---

## What happened and what it means

A PBX diagnostic bundle was committed to the `yeastarissue` repository. It
contains plaintext credentials.

**The repository is private, so exposure is limited to people with access to it.
But the credentials are in git history, and deleting the file does not remove
them.** Anyone who can read the repository — now, or at any point since it was
pushed — could have read them.

There is no evidence of misuse. There is also no way to rule it out, which is why
rotation is the right response rather than monitoring.

## What is exposed

**Inventoried against the bundle on 2026-09-21.** Counts are exact.

| Credential | Count | File in the bundle | Blast radius if used |
|---|---|---|---|
| **SIP trunk credential** | **1** | `asterisk/pjsip_auth.conf` (`trunk-SIP-auth`), `pjsip_outreg.conf` | **Highest — and it was missing from this list.** This authenticates the PBX to your **carrier**. Stolen, it places calls billed to your account from anywhere, without needing any access to the PBX. Standard toll-fraud route |
| **SIP extension passwords** | **44** | `asterisk/users.conf`, `pjsip_auth.conf` | **High** — register a rogue endpoint and place calls at your cost, or intercept calls. Needs network reach to the PBX, which the trunk credential does not |
| **OpenAPI client secret** | 1 | `openapi.log` | Full API access: read CDR, recordings, contacts; place calls; change configuration |
| **AMI secrets** | 2 (`LinkusUser`, `basicsrv`) | `asterisk/manager.conf` | Deep call control. Mitigated: the ACL permits loopback only |
| **Redis password** | 1 | `asterisk/cdr_redis.conf` | Read the CDR stream. Mitigated: bound to loopback |
| **Database credentials** | 1 set | `res_config_mysql.conf`, `voicemail_mysql.conf` | Depends on what that database holds |
| **Voicemail passwords** | 2 | `voicemail.conf` | Voicemail access |

Also in the bundle: the tunnel hostname, public source IP addresses, and **three
Asterisk core dumps of 202–451 MB**.

> **The core dumps are a separate problem.** A core dump is a snapshot of process
> memory, which for a PBX can contain call audio buffers and customer telephone
> numbers as well as credentials. Rotating passwords does not address that. It is
> recorded in [`../../compliance/pdpl-assessment.md`](../../compliance/pdpl-assessment.md)
> because the question — what personal data was in them, and what follows — needs
> a privacy answer, not only a technical one.

---

## Order matters

Rotate **outward-facing and highest-blast-radius first**, and leave the ones
protected by a loopback ACL until last. If you are interrupted halfway, you want
to have done the ones that matter.

### 1 · SIP trunk credential — *do this first*

**The most expensive item, and the one this runbook originally omitted.** It is
the credential your carrier accepts. Nothing else on this list can be abused
without reaching your network; this one can.

1. Confirm first **whether the trunk is live** — `pjsip_outreg.conf` defines
   `trunk-SIP-registeration`, but whether it is actually registering to a carrier
   today is not something the bundle proves. If it is inert, this drops down the
   list. If it is live, it stays at the top.
2. Rotate with the **ITSP or carrier**, not on the PBX alone — the password is
   theirs to reissue.
3. Update the trunk configuration on the PBX and confirm it re-registers.
4. **Ask the carrier for recent call records and a spend check** while you are in
   touch. Eight weeks is long enough for fraud to have happened and be invisible
   from your side until the invoice.

**Breaks if done wrong:** outbound and inbound calling over that trunk stops.
Do it with the carrier on the phone, not asynchronously.

### 2 · OpenAPI client secret

Externally reachable through the RAS tunnel, and the widest access.

1. PBX web console → the API or integration settings where the client is defined.
2. Regenerate the client secret.
3. Update anything storing it. **As far as we know nothing currently uses it** —
   the integration is not built, and the only recorded use of it failed — but
   check for scripts or test tooling before assuming.

> **Rotation alone does not close this one.** The six recorded `get_token` calls
> passed `client_id` and `client_secret` **as query-string parameters**, and the
> PBX wrote both into `openapi.log` in plaintext, which is how they reached the
> bundle and then the repository. A new secret sent the same way is logged the
> same way. When the integration is built, send credentials in the request body
> or a header — never the query string — and treat `openapi.log` as containing
> secrets until that is confirmed. Raised against `SEC-003` and B-06.

**Breaks if done wrong:** nothing today. This is the safest one to do immediately.

### 3 · SIP extension passwords — *needs a maintenance window*

**The most disruptive to change**, and second only to the trunk for risk. A stolen
SIP credential lets someone register a handset and place calls billed to you.

1. Scope is **all 44**. An earlier draft of this runbook offered a choice between
   "every extension" and "only those in the bundle (116–135, 222)" — that second
   option was based on a miscount. 116–135 and 222 are the 21 Linkus clients that
   were *online* during the crash; the bundle exposes **44 secrets** in
   `users.conf`, across extensions 100–137, 140, 150, 200, 201 and 222–224. There
   was never a smaller set to choose.
2. Change passwords in the PBX.
3. **Every affected phone and softphone must be re-provisioned.** Desk phones
   using auto-provisioning pick it up on reboot; manually configured devices and
   Linkus clients need attention individually.
4. Verify each extension re-registers before closing the window.

**Breaks if done wrong:** phones stop registering and cannot make or receive
calls. Do it outside trading hours and have the auto-provisioning path confirmed
working beforehand.

### 4 · Database credentials

1. Establish what `res_config_mysql.conf` points at and what depends on it — this
   is the one item where **we genuinely do not know the blast radius**.
2. Rotate at the database, then update the PBX configuration.
3. Restart the affected service and confirm it reconnects.

**Breaks if done wrong:** whichever PBX feature uses that database stops working.
Know what it is before you change it.

### 5 · AMI secrets

Both accounts in `manager.conf`. Lower urgency because the ACL permits `127.0.0.1`
only — an attacker would already need to be on the box.

**Breaks if done wrong:** internal components using AMI lose access. Check what is
configured against those accounts before changing them.

### 6 · Redis password

Loopback-bound, same reasoning. Update `cdr_redis.conf` and restart the consumer.

**Breaks if done wrong:** the CDR pipeline stops, so call records stop being
written. Verify new calls appear afterwards.

### 7 · Voicemail

Lowest urgency. Rotate per your voicemail policy.

---

## The repository itself

Rotation makes the leaked values worthless, which is the point. Separately:

- **The bundle is still the repository's current content**, not only its history.
  Checked 2026-09-21: three commits, one tar and a 14-byte README, the tar still
  at HEAD, committed 2026-07-27 — about eight weeks ago.
- **There is exactly one collaborator**, the owner, with `admin`. So the usual
  reason history rewriting is treated carefully — other people holding clones that
  a force-push invalidates — does not apply here.
- **Simplest complete removal: delete the repository.** It exists to hold one
  diagnostic bundle for a vendor ticket. Once that bundle has gone to Yeastar
  through their support channel — which the B-07 ticket requires anyway — the
  repository has no further purpose, and deleting it removes the exposure entirely,
  history included, with no rewrite. **Rotate first, send the bundle to the vendor
  second, delete third.** Deleting a repository is irreversible and is the owner's
  decision.
- **The core dumps are the stronger reason to remove it**, because their contents
  are not fixed by rotation.
- **GitHub not having flagged any of this means nothing.** Secret scanning detects
  known provider token formats; Asterisk SIP, AMI and Redis passwords are not among
  them.
- **Do not commit another diagnostic bundle.** If vendor support needs one, send
  it through their support channel rather than a repository.

---

## Record when done

| Credential | Rotated | By | Date |
|---|---|---|---|
| **SIP trunk credential** | ☐ | | |
| Carrier asked for a spend/fraud check | ☐ | | |
| OpenAPI client secret | ☐ | | |
| SIP extension passwords (all 44) | ☐ | | |
| Database credentials | ☐ | | |
| AMI secrets | ☐ | | |
| Redis password | ☐ | | |
| Voicemail | ☐ | | |

Then close B-06 in [`../blocked.md`](../blocked.md), and record what the core
dumps contained — or that it could not be established — for the privacy
assessment.

---

## Scope note

This describes what was found in a diagnostic bundle and a sensible order for
addressing it. **It is not a security assessment**, and it does not establish
whether anything was actually accessed. If you need that determination, it is a
separate exercise and needs someone qualified to make it.

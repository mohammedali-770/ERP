# Branch network capability check

**For:** IT
**Unblocks:** B-03, and may decide D-3 outright
**Time needed:** about 30 minutes, at one branch
**Equipment:** two ordinary laptops or phones. **No iPads, no MDM, no special software.**

---

## Why you are being asked to do this

The new till system is planned to run on iPads with no extra hardware in the
branch. That only works if the branch Wi-Fi lets devices **talk directly to each
other**. Many business networks block exactly that, on purpose, as a security
default.

If your network blocks it and cannot be changed, then every branch needs a small
computer installed to coordinate the tills — a real cost, and a decision that
needs making early rather than late.

**This check answers that question in half an hour.** It is the cheapest test in
the whole programme, and it may settle a decision that is otherwise scheduled for
eight months from now.

You do not need the new software to run it. You are testing the network, not the
application.

---

## Before you start

Find out and write down:

- **Which Wi-Fi network would the tills use?** If staff and guests are on separate
  networks, test the one tills would join — not the guest network.
- **What access point hardware is installed?** Make, model, and who manages the
  configuration (in-house, or an external provider).
- **Are all branches configured the same way?** If you are not certain, say so.
  That uncertainty is itself a useful answer.

---

## Test 1 · Can two devices on the same Wi-Fi reach each other?

1. Connect **both** devices to the branch Wi-Fi — the same network the tills would use.
2. On each device, find its IP address:
   - **Windows:** open Command Prompt, type `ipconfig`, look for "IPv4 Address"
   - **Mac:** System Settings → Wi-Fi → Details → IP address
   - **iPhone/Android:** Wi-Fi settings → tap the connected network
3. Check both addresses start with the same first three numbers (for example, both
   `192.168.1.x`). If they do not, note that and continue anyway.
4. From device A, try to reach device B:
   - **Windows:** `ping <device B's address>`
   - **Mac / Linux:** `ping <device B's address>`
5. Repeat in the other direction, from B to A.

**Record:** did the ping get replies, or time out? Both directions.

> A timeout here is the important result. It usually means the access point has
> "client isolation" switched on.

---

## Test 2 · Can devices discover each other by name?

Tills need to *find* each other automatically, not just be able to reach a known
address. This uses a standard technology called mDNS or Bonjour.

Easiest check, in order of convenience:

- **Two Apple devices:** try AirDrop between them, or open Finder on a Mac and see
  whether the other Mac appears under "Network".
- **Any devices:** install any free "Bonjour browser" or "service discovery" app on
  both and see whether each finds the other.
- **Comfortable with a terminal:**
  - Mac: `dns-sd -B _services._dns-sd._udp`
  - Linux: `avahi-browse -a`

**Record:** did each device find the other, or not?

---

## Test 3 · Check the access point's own settings

Log into the access point or its management console and look for a setting named
something like:

- **Client Isolation** · **AP Isolation** · **Station Isolation**
- **Guest Mode** · **Wireless Isolation** · **Peer-to-Peer Blocking**

**Record:** is it on or off? **And critically — can it be turned off?** Sometimes
it is fixed by the hardware, by a management platform, or by a security policy
that is not yours to change.

---

## Test 4 · Check a second branch

Configurations drift. If you can, repeat Tests 1 and 2 at one more branch.

**Record:** same result, or different?

---

## Results

Fill this in and send it back. That is all that is needed.

| | Finding |
|---|---|
| Branch tested | |
| Wi-Fi network name | |
| Access point make and model | |
| Who manages the configuration | |
| **Test 1 — ping A→B** | Replies / Timed out |
| **Test 1 — ping B→A** | Replies / Timed out |
| **Test 2 — devices found each other** | Yes / No |
| **Test 3 — isolation setting found** | On / Off / Not found |
| **Test 3 — can it be turned off?** | Yes / No / Needs someone else's approval |
| **Test 4 — second branch same?** | Same / Different / Not tested |
| Anything else worth knowing | |

---

## What your answers mean

You do not need to work this out — but for context, here is how the result is read:

| Test 1 | Test 2 | What it means |
|---|---|---|
| Replies | Yes | **Best case.** iPad-only stays viable on network grounds. Full testing proceeds. |
| Replies | No | Devices can reach each other but not find each other. Probably workable with a different discovery method; needs an engineering look. |
| Timed out | No | Isolation is on. **If it can be switched off** (Test 3), fine — but it has to be changed across every branch, and someone must own that change. |
| Timed out | No, **and cannot be switched off** | **Decisive.** Each branch will need a small coordinating computer. That is a budget and rollout decision, and finding it out now rather than in eight months is the entire point of this check. |

---

## What happens next

Send the results table back. If the answer is decisive, a hardware decision that
was scheduled for month eight gets made this month instead — before the software
is built around an assumption that turns out to be wrong.

If you cannot get access to a branch, say so. **That is also an answer**, and it
needs escalating rather than waiting.

---

*Background, if wanted: `docs/adr/ADR-0004`, `docs/lab/hardware-decision-matrix.md`.
Full device-level testing is a separate, later exercise that does need the new
software — see `spikes/lan-peer-sync/README.md`.*

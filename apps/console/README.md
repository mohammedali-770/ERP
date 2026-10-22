# Console

The ERP's management console: Vite + React 18, the one workspace allowed a build step and
third-party dependencies (ADR-0021 §4). Arabic by default, right to left; English a click
away.

What it has today:

- **Sign-in** with employee number and PIN (ADR-0025).
- **Module 1, items and units** (ADR-0024 and its addenda): the list, an item's page with
  its units and history, create and edit, adding and retiring a unit, retiring and
  reinstating an item, and a CSV upload.
- **Module 2, suppliers** (ADR-0026 and its addenda): the list, a supplier's page with
  what it sells and its history, create and edit, the contact (no reason asked, and an
  erase action), adding, changing and stopping a supply, retiring and reinstating, and a
  CSV upload. An item's page shows who sells it, to someone who may read suppliers.
- **Module 3, transfer prices** (ADR-0027 and its addenda): the price list, with every
  active pack's price now and the next one set ahead, and unpriced packs marked; an item's
  prices pack by pack, with setting a price from now or from a Riyadh date and time, and
  withdrawing one not yet in effect; and its history. An item's page links to its prices.
- **Module 4, branches and facilities** (ADR-0028 and its addenda): the list, with open
  branches that have no ordering area flagged; a facility's page with its area, a map
  link and its history; create, edit names and addresses, set, move or remove the area
  (a point pasted whole fills both fields), and close or reopen.
- **Module 5, stock** (ADR-0029 and its addenda): at the warehouse or factory being worked
  at, and nowhere else, the stock on hand in each item's base unit, with when it was last
  counted and any balance below zero marked; an item's stock card, with every decision that
  touched it; a decision's page, line by line, with Reverse for a movement not yet
  reversed; and recording a waste, damage, expiry or adjustment, or a count, now or at a
  stated Riyadh moment. Going below zero is offered only with the override and its reason,
  to someone who holds it. Organisation-wide the page asks for a warehouse or factory; a
  branch or an office is told it holds no stock record.
- **Module 6, the bell** (ADR-0030 and its addenda): in the top bar, with the unread count,
  asked only when the person does something and never on a timer, since every request
  moves the session's idle clock. Its page lists the person's own notifications, newest
  first, marks one read or all those listed, and opens each at the stock decision it is
  about, first switching to the facility it happened at when the person works elsewhere.
- **Module 7, stock alerts** (ADR-0031 and its addenda): at a warehouse or factory, the
  items at or below their minimum, or every minimum on asking, beside what is on hand; an
  item's page with the minimum in force and its history; and setting or clearing it. The
  bell rings once each time a movement takes an item to its minimum, and the stock card
  links to the item's minimum.
- **Module 8, purchase orders** (ADR-0032 and its addenda): at a warehouse or factory, the
  orders, newest first; a new order to one supplier, up to 200 lines, with each line's
  amount and the VAT shown as the order will record them; and an order's page with its
  lines, receipts and decisions. It offers approve and reject, never to the person who
  raised the order (PRC-004); cancel before anything has arrived; close once part has; and
  receiving goods into stock. A receipt is reversed from its order only. **Approval limit**
  is its own entry: the limit before VAT, set and cleared, within which an order is
  approved as it is raised, unless whoever raised it also set the limit.
- **Module 9, ordering setup** (ADR-0033 and its addenda): three entries under Ordering.
  Item sources: which warehouse or factory supplies each item, set and cleared
  organisation-wide. Order cut-off times: each warehouse's and factory's, as `HH:MM` in its
  own time zone, changed while working at that facility. Par levels: each branch's
  order-up-to level per item, set from the warehouse or factory that supplies the item, or
  organisation-wide; at a branch, only that branch's own, read only.

## Layout

| | |
|---|---|
| `src/*.ts` | Plain TypeScript: the API client, CSV reader, ids, translations, viewer, routes, messages, and the write lifecycle every detail-page sub-form shares (`write.ts`, wrapped for React by `screens/useWrite.tsx`), with the uploads' `importRequest`. Node cannot load `.tsx`, so everything worth a test lives here and `test/` exercises it under `npm test`. |
| `src/screens/*.tsx`, `src/App.tsx` | The screens, kept as thin as they can be around the `.ts` logic. |
| `src/style.css` | One stylesheet, logical properties throughout, so RTL needs no second one. |

The menu is built from the session's viewer (`erp.viewer()`, migration 0015). **It is not
a control.** Every route the screens call asks `erp.assert_permitted()` itself (CAP-P04).

## Running it locally

Against the local stack only. Nothing here touches a hosted project.

```bash
supabase start && npm run db:reset
# erp_edge has no password in any migration. Give it a throwaway one locally, put
# ERP_DATABASE_URL (erp_edge's URL) and ERP_ALLOWED_ORIGINS=http://localhost:5173 in an
# env file OUTSIDE the repository, and serve the functions:
supabase functions serve --env-file ../erp-local.env
npm run dev -w @firsttaste/app-console      # http://localhost:5173
```

`VITE_ERP_FUNCTIONS_URL` points the console at the functions. It defaults to the local
stack's `http://127.0.0.1:54321/functions/v1`.

The seed's people are synthetic: `supabase/seeds/0015_identity.sql`, and the factory
manager in `0070_stock.sql`. The seed opens modules 1 to 9 as pilot
(`0030_capability_registry.sql`), so an entry shows to whoever holds the reads it asks.

- **A cashier at BR-001** can sign in and read that branch's items, transfer prices and
  par levels, the item sources, and the cut-off times of its brand's warehouses and
  factories, and has a bell. Current stock says a branch holds no stock record yet. A
  cashier sees nothing of suppliers, facilities, stock alerts or purchase orders, and
  changes nothing.
- **The administrator**, organisation-wide, holds every module's permissions, the stock
  override and order approval included; the migrations grant these, not the seed. Items,
  suppliers, facilities, item sources, cut-off times and approval limits are changed by
  the administrator alone, a cut-off or an approval limit while working at its facility.
  The administrator
  approves orders, but never one they raised (PRC-004).
- **The warehouse manager**, organisation-wide, reads items, suppliers, transfer prices,
  facilities, item sources and cut-off times. At a warehouse or factory they record stock
  movements and counts, set minimums, and raise and receive orders, and they set any
  item's par. They hold no override, approve no order and see no approval limit.
- **The factory manager**, scoped to FA-001, does the same at the factory alone, holds the
  override there, and sets only the pars of the items the factory supplies.
- **The accountant**, organisation-wide, sets transfer prices beside the administrator,
  reads items and suppliers, approves orders and reads the approval limits. They have no
  stock, facilities, stock alerts or ordering entry.

The seed sets a PIN only for cashiers at BR-001; set one for anyone else locally with
`erp.set_pin()`.

## On staging

Staging's console is built by Vercel once the owner has imported the repository there,
with this directory as its root. `vercel.json` gives the install, the build and the output; the install runs
`npm ci` at the repository root, where the lockfile is. `VITE_ERP_FUNCTIONS_URL` is set in
Vercel to staging's functions before the first build. Vite reads it at build time, so a
build without it still succeeds but calls the local stack, and every sign-in fails. The
functions answer the console only once their `ERP_ALLOWED_ORIGINS` secret names its exact
origin. Each is the owner's to set, in the dashboards, never in a file. The steps are in
the runbook, [`supabase-deployment.md`](../../docs/program/supabase-deployment.md),
"Staging, as built", 8 and 9.

Staging is rebuilt with the same synthetic seed. Until the owner sets the administrator's
PIN after a run, only the seeded cashiers can sign in (the runbook's 7).

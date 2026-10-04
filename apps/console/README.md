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

## Layout

| | |
|---|---|
| `src/*.ts` | Plain TypeScript: the API client, CSV reader, ids, translations, viewer, routes, messages. Node cannot load `.tsx`, so everything worth a test lives here and `test/` exercises it under `npm test`. |
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

The seed's people are synthetic (`supabase/seeds/0015_identity.sql`). The cashier at
BR-001 can sign in and read that branch's items, and nothing of suppliers. Changing items
or suppliers takes an organisation-wide role holding `inventory.items:write` or
`procurement.suppliers:write`, which the seed gives the administrator alone; the
warehouse manager reads both. The seed sets no PIN for either; set one locally with
`erp.set_pin()`.

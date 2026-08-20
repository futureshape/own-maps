# Pinboard Maps

A small Google My Maps-style application for collecting, annotating, categorising, and privately sharing Google Places. React runs in the browser, one Cloudflare Worker serves both the app and its REST API, and D1 owns all user data and permissions.

## Architecture

```mermaid
flowchart LR
    U["Browser"] --> R["React application"]
    R -->|"Maps, autocomplete, place details"| G["Google Maps Platform"]
    R -->|"Google ID credential"| I["Google Identity Services"]
    R -->|"HTTPS + HttpOnly session"| W["Cloudflare Worker"]
    I -->|"JWKS token verification"| W
    W -->|"Parameterized SQL"| D[("Cloudflare D1")]
    W --> A["Static assets"]
```

Google owns place identity and live place presentation. D1 stores map ownership, memberships, invites, revocable public-link tokens, categories, Place IDs, display names, marker coordinates, and user notes. Saved markers and named lists render from D1; loading a map does not resolve every Place ID again.

## What works

- Google account sign-in with server-side ID token verification
- opaque, random, hashed D1-backed sessions with expiry and logout
- private map creation, editing, and deletion
- normal Google map browsing and native POI click interception
- Google Places autocomplete biased to the current viewport
- one selected-place flow for POIs, search results, and saved markers
- Places UI Kit compact details in a map-side drawer
- saved `AdvancedMarkerElement` stars and named category lists restored from D1
- notes and colour-coded categories
- owner/editor/viewer permissions checked by the Worker
- sharing by verified Google-account email, including pending invites
- optional revocable public links with anonymous, read-only access
- D1 migrations and GitHub Actions deployment

## Requirements

- Node.js 24+
- a Cloudflare account with Workers and D1
- a Google Cloud project with billing enabled for Google Maps Platform
- Wrangler authenticated locally (`npx wrangler login`)

## Local development

> **Google API prerequisite:** before starting the app, enable all three APIs in the Google Cloud project that owns your browser key: **Maps JavaScript API**, **Places API (New)**, and **Places UI Kit API**. Places UI Kit API is a separate activation; enabling Places API (New) alone is not sufficient. If the browser key uses API restrictions, all three APIs must also be included in its allow-list.

Install dependencies and create local configuration:

```bash
npm ci
cp .env.example .env
cp .dev.vars.example .dev.vars
```

Fill in `.env` with browser-facing Google values and `.dev.vars` with the same OAuth client ID for Worker token verification. Neither file is committed.

Start the Worker:

```bash
npm run dev
```

`npm run dev` applies any pending local D1 migrations, builds the React app, and runs Wrangler, normally at `http://localhost:8787`. Run `npm run build` again after frontend changes. The local D1 database lives under `.wrangler/`.

Validation commands:

```bash
npm run lint
npm run check
npm test
npm run build
```

The tests run in Cloudflare's Workers Vitest runtime with a real local D1 binding. Google calls are kept outside tests; identity claims are tested at the boundary and API tests seed application sessions directly.

## One-time Google Cloud setup

1. Create or select a Google Cloud project and attach billing.
2. Open **APIs & Services → Library** and separately enable each of the following:
   - **Maps JavaScript API**
   - **Places API (New)**
   - **Places UI Kit API**

   **Places UI Kit API is a distinct API.** The place popup will not load if only Maps JavaScript API and Places API (New) are enabled.
3. Create a JavaScript map ID for Advanced Markers. Use it as `VITE_GOOGLE_MAP_ID`.
4. Create a browser API key for `VITE_GOOGLE_MAPS_API_KEY`.
5. Open the browser key's **API restrictions**, choose **Restrict key**, and allow **Maps JavaScript API**, **Places API (New)**, and **Places UI Kit API**. Under **Website restrictions**, allow `http://localhost:8787/*` plus the production hostname.
6. Configure the OAuth consent screen with only `openid`, `email`, and `profile` identity scopes. No Gmail, Drive, Contacts, or other Google data scopes are needed.
7. Create a **Web application** OAuth client. Add the production origin and `http://localhost:8787` to Authorized JavaScript origins. This app uses the Google Identity credential callback, so it does not need an OAuth redirect route.
8. Use that client ID for both `VITE_GOOGLE_CLIENT_ID` and the Worker's `GOOGLE_CLIENT_ID` binding.

The browser Maps key and OAuth client ID are public identifiers. Security comes from API/referrer restrictions, OAuth origin restrictions, and server-side token validation—not from trying to hide those values in the bundle.

### Google setup troubleshooting

#### Empty place popup or `GetPlaceWidgetMetadata` returns 403

If the console reports:

```text
Google Maps Places UI Kit Error: The API is not activated on your project
```

confirm that **Places UI Kit API** is enabled in the same Google Cloud project that issued `VITE_GOOGLE_MAPS_API_KEY`. Then confirm that the key's API restrictions include **Places UI Kit API**. Activation or restriction changes can take several minutes to propagate; hard-refresh the browser afterward. Restarting D1 is not required.

#### `[GSI_LOGGER]: The given origin is not allowed`

Open the Web OAuth client used by `VITE_GOOGLE_CLIENT_ID` and add the exact local origin under **Authorized JavaScript origins**:

```text
http://localhost
http://localhost:8787
```

An origin contains the scheme, hostname, and optional port, but no path or wildcard. If you browse using `127.0.0.1`, either switch to `localhost` or authorize that origin separately.

## Places UI Kit experimental boundary

Places UI Kit for Maps JavaScript is experimental and the app deliberately isolates it:

- `PlaceCard.tsx` owns `gmp-place-details-compact`, `gmp-place-details-place-request`, and `gmp-place-standard-content`.
- `PlaceSearch.tsx` owns `PlaceAutocompleteElement` and its `gmp-select` event.
- the Maps loader requests the `beta` channel.

If Google changes these custom elements, those two adapters are the intended update surface. Review Google's current [Place Details Element documentation](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details) and [Place Autocomplete documentation](https://developers.google.com/maps/documentation/javascript/place-autocomplete-new) before upgrading the Maps API channel.

## First Cloudflare bootstrap

Create the production database:

```bash
npx wrangler d1 create own-maps-prod
```

Replace the all-zero `database_id` in `wrangler.jsonc` with the returned UUID and commit that change. Then store the Google client ID as a Worker secret/binding:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
```

The client ID is not intrinsically secret, but storing it as a Worker secret keeps environment-specific server configuration out of the repository. Configure a custom hostname by uncommenting and changing the `routes` entry in `wrangler.jsonc`; no dashboard interaction is required.

Apply the first migration and deploy:

```bash
npm run build
npm run db:migrate:remote
npx wrangler deploy
```

All later schema changes belong in sequential SQL files under `migrations/`. Do not edit production D1 tables manually.

## GitHub Actions production deployment

The workflow in `.github/workflows/deploy.yml` validates pull requests. A push to `main` runs lint, type-checks, tests, builds, applies remote D1 migrations, and deploys the Worker and assets.

Create these GitHub production secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Narrow token with Workers Scripts edit, D1 edit, and required account read permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account |
| `VITE_GOOGLE_MAPS_API_KEY` | Restricted browser Maps key embedded at build time |
| `VITE_GOOGLE_MAP_ID` | Google map ID used by Advanced Markers |
| `VITE_GOOGLE_CLIENT_ID` | Google Identity web client ID embedded at build time |

The persistent Worker `GOOGLE_CLIENT_ID` secret is provisioned once with Wrangler. Routine production deployment is then just a push to `main`.

## Security model

- Google credentials are verified against Google's remote JWKS with issuer, audience, algorithm, expiry, and verified-email checks.
- Google `sub`, never email, is the stable external identity key.
- Session cookies are `HttpOnly`, `Secure` in production, `SameSite=Lax`, and scoped to `/`; only a SHA-256 token hash is stored in D1.
- State-changing requests require JSON and a same-origin `Origin` header. Every mutation repeats authorization in the Worker.
- Owner, editor, and viewer capabilities are centralised in `permissions.ts`; the UI's role is only presentational.
- Public links use random UUID tokens, never grant membership, and only reach a read-only GET endpoint. Every mutation still verifies an authenticated owner or editor in the Worker.
- Login throttling is a best-effort per-isolate guard. For globally consistent high-volume limits, add a Cloudflare Rate Limiting binding rather than application state in KV.
- The browser never connects directly to D1, and no Google Maps or Places secret is proxied through the Worker.

## API overview

The Worker exposes `/api/auth/google`, `/api/auth/logout`, `/api/me`, map CRUD, nested place/category CRUD, and owner-only invite/member management. `GET /api/maps/:mapId` returns map metadata, the caller's role, categories, and all saved marker coordinates and display names in one response. Owners can enable a public link through the map's Share dialog; `GET /api/public/maps/:publicToken` serves the same map data with viewer access and no authentication. Disabling the link deletes its token, and enabling it again creates a new URL.

## Cost assumptions

This design avoids search-on-pan and avoids Place Details lookups while restoring markers. A map load uses Dynamic Maps; autocomplete and an opened UI Kit detail card use the relevant Google Maps Platform SKUs. Selecting a new place requests `displayName`, which triggers the Places API Place Details Pro SKU, and stores that name so category lists and later map loads need no name lookup. Rows created before the display-name migration are backfilled lazily only when selected. Cloudflare static assets are served separately from `/api/*` Worker requests. Allowances and prices change, so confirm current figures on the official [Google Maps Platform pricing](https://mapsplatform.google.com/pricing/) and [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) pages before launch. Nothing in product logic hard-codes a price or allowance.

## Deliberate v1 boundaries

There is no realtime presence, offline mode, public map directory or discovery, file upload, contacts integration, notification email, Durable Object, KV, R2, queue, or second backend. Public maps are unlisted and require their exact link. Pending invites become memberships when the invited verified email next signs in.

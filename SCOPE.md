# UI Extension Builder — Scope

A visual, drag-and-drop builder for **HubSpot UI extensions** (app cards, settings pages and app
home pages). Users compose an extension from HubSpot's real component library, configure props,
state, data and actions in a GUI, preview it interactively with mock CRM data, and export a
**ready-to-upload HubSpot developer project** (`hs project upload`).

## 1. Web app or HubSpot app? → Web application

| Consideration | Inside HubSpot (a UI extension) | Standalone web app |
| --- | --- | --- |
| Rendering | Extensions run in a sandboxed worker via remote-ui; only HubSpot's ~80 components, no DOM, no custom CSS, no drag events | Full DOM: canvas, drag & drop, overlays, keyboard shortcuts, code editors |
| Building a canvas that *previews* HubSpot components | Impossible — you cannot render arbitrary component trees from data with custom selection chrome | Each component gets a faithful HTML preview |
| Producing deployable output | Cannot run the HubSpot CLI or write project files | Generates the full project (zip) for `hs project upload` |
| Distribution | Requires installing an app into each portal | Static site; works offline; no HubSpot account needed to design |

**Decision:** build a client-side web application (React + TypeScript + Vite). It targets HubSpot's
current developer platform (`platformVersion` **2026.03**, also 2025.2 / 2026.09) and outputs the
exact project layout produced by `hs project create`:

```
hsproject.json
src/app/app-hsmeta.json
src/app/cards/<Card>.tsx, <Card>-hsmeta.json, package.json, tsconfig.json
src/app/settings/<Settings>.tsx, settings-hsmeta.json          (optional)
src/app/pages/<AppHome>.tsx, <app-home>-hsmeta.json             (optional, location "home")
src/app/functions/<fn>.js, <fn>-hsmeta.json, package.json       (optional app functions)
README.md, .uiex.json (builder document, re-importable)
```

A companion HubSpot app (e.g. an app home page listing builder projects) is a possible later
addition but is not needed to design or ship extensions.

## 2. Users and jobs

* **HubSpot developers** — scaffold cards faster, learn the component library, get correct props.
* **RevOps / admins with light JS** — build useful cards (record summaries, calculators, forms,
  association tables) without hand-writing React.
* **Agencies** — prototype cards with clients using realistic mock data, then hand off code.

## 3. Design principle: dramatically easier than code, without a ceiling

Everything a developer can express in a hand-written card should be reachable in the GUI, but the
default path never requires writing code.

* **Easy by default** — starter cards and drop-in blocks, smart defaults on every component,
  inline text editing, guided data-source wizards with CRM property pickers, a visual action
  builder that reads as plain language ("When clicked → set *count* to *count + 1* → show success
  alert"), problems panel with one-click fixes, contextual help and docs links everywhere.
* **Powerful when needed** — expressions anywhere (`{{ }}` or full JS) with autocomplete over
  state, data, context and repeat variables and a live value preview; computed values; reusable
  helper functions; custom code actions; raw/custom props for anything the registry lacks;
  conditional rendering and repeats; app functions; command palette (⌘K) and full keyboard
  control; per-component and per-file generated code view; save your own blocks to a library;
  round-trip via `.uiex.json`, and the exported code is clean, idiomatic TSX you can keep evolving.

## 4. In scope (v1)

**Design surface**
* Component palette with every stable component of `@hubspot/ui-extensions` 0.17 and
  `@hubspot/ui-extensions/crm` (layout, text, buttons, inputs, tables, statistics, charts, overlays,
  CRM data & action components), searchable and grouped, with location-aware availability.
* Canvas that renders a HubSpot-styled preview, sized by location (record tab, sidebar, preview
  panel, help desk, settings, app home).
* Drag & drop from palette and within the canvas, nested containers, insertion indicators,
  structural rules (e.g. `TableRow` only inside table sections, `Tab` only in `Tabs`, overlays only
  attached to triggers).
* Layers tree (drag to reorder, rename, hide in designer), breadcrumbs, context menu, multi-level
  undo/redo, copy/cut/paste/duplicate, wrap in container, keyboard shortcuts.
* Overlay storyboard: Modals, Panels and Tooltips attached to buttons/links/images/tags are edited
  inline below the card.

**Properties & logic**
* Inspector generated from the registry: typed editors for every prop (enums, booleans, numbers,
  icons, option lists, dates, JSON, nested objects), defaults shown, docs links.
* Dynamic values: `{{ expression }}` templates in any text/prop, or full expression mode.
* State variables (`useState`), two-way input binding, conditional rendering, repeat (map over
  arrays).
* Data sources: `useCrmProperties`, `useAssociations`, `useCrmSearch`, `hubspot.fetch` endpoints,
  app functions (`hubspot.serverless`), each with mock data for preview.
* Event actions (no-code): set state, show alert, refresh properties, reload page, open iframe
  modal, close overlay, copy to clipboard, refetch data, fetch, run function, log, if/else, custom
  code.

**Preview, output, project management**
* Interactive preview mode that simulates the card: state, actions, alerts, overlays, iframe modal,
  data sources with mock data, console log of host calls.
* Live code view (generated TSX and every project file) with syntax highlighting.
* Validation/problems panel (missing required props, invalid identifiers, location mismatches,
  unknown references, missing permitted URLs/scopes).
* App settings (name, uid, distribution, auth type, scopes, permitted URLs, support info),
  multiple extensions per project (cards, settings page, app home), app function editor.
* Export as `.zip` HubSpot project; save/load builder documents (`.uiex.json`); autosave to local
  storage; starter templates (record summary, deal calculator, form with validation, association
  table, statistics dashboard, onboarding checklist, settings page, …).

## 5. Out of scope (v1)

* Deploying directly to HubSpot from the browser (requires CLI auth); we export a project and
  document `hs project upload`. A local helper could be added later.
* Importing arbitrary hand-written JSX back into the builder (round-trip is via `.uiex.json`).
* App pages router (`@hubspot/ui-extensions/pages` multi-page apps), bulk actions, workflow actions,
  app objects, webhooks, marketplace listing assets.
* Real CRM data in preview (mock data only; fetch actions may hit real URLs in preview mode).

## 6. Quality bar / verification

* Generated TSX for every component and every template is **type-checked against the real
  `@hubspot/ui-extensions` package** (`tsc --strict`) in the test suite, and bundled with esbuild.
* Project files follow the official 2026.03 templates (`HubSpot/hubspot-project-components`).
* Unit tests for the model, codegen, runtime and validation; Playwright end-to-end tests for drag &
  drop, property editing, preview interactions and export.

## 7. Architecture (summary)

See `ARCHITECTURE.md` for contracts. Modules:

| Folder | Responsibility |
| --- | --- |
| `src/model` | Document types, tree ops, placement rules, zustand store (undo/redo), persistence, templates (`{{ }}`) |
| `src/registry` | Component definitions: props, events, slots, children rules, previews |
| `src/preview` | HubSpot-like styles and preview helpers |
| `src/runtime` | Expression engine, preview runtime (state, actions, overlays), node renderer |
| `src/codegen` | TSX + project file generation, zip export |
| `src/canvas` | Canvas, selection, drag & drop, overlay storyboard |
| `src/inspector` | Property, events/actions, binding, conditions & repeat editors |
| `src/panels` | Data (state, data sources, functions, mock data), app/extension settings, export |
| `src/shell` | App layout, top bar, palette, layers, code/problems/console panels, shortcuts |
| `src/templates` | Starter templates & validation |
| `src/onboarding` | First-run welcome, guided setup and coach-mark tour |
| `src/ui` | Builder-chrome UI kit |

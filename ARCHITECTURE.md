# Architecture & contracts

Read `SCOPE.md` first. This file defines the contracts between modules. **Source of truth for every
HubSpot component prop is the installed package**:
`node_modules/@hubspot/ui-extensions/dist/shared.synced/types/components/*.d.ts` and
`.../types/crm.synced.d.ts` (exports in `dist/index.d.ts` and `dist/crm/index.d.ts`).
Official project templates for reference: `/home/user/hubspot/hubspot-project-components/2026.03`
and examples in `/home/user/hubspot/ui-extensions-examples`.

## 1. Document model (`src/model/types.ts`)

* `Project` → `app: AppConfig`, `extensions: Extension[]`, `functions: AppFunction[]`.
* `Extension` (kind `card` | `settings` | `home`) owns a flat `nodes` map and a synthetic root node
  (`type: '__root__'`, `rootId`). Root children = top-level JSX returned by the component.
* `UINode`: `type` (registry key), `props` (`PropValue` = JSON literal or `{ $expr }`), `text`
  (children mode 'text'), `children` (node ids), `slots` (ReactNode props such as `overlay`),
  `events` (action steps per event prop), `binding` (two-way state binding), `condition`, `repeat`.
* `NodeTemplate` is the detached/serialisable form used by templates, defaults, copy/paste.
* State: `StateVar` → `useState`. Data: `DataSource` (crmProperties | associations | crmSearch |
  fetch | function). Each data source named `x` exposes `x`, `xLoading`, `xError` in scope.
* Mock data for the designer lives in `Extension.mock` (never in generated code).

### Scope available to expressions
State variable names, their setters `setX` (in handlers/custom code), data source names and
`<name>Loading` / `<name>Error`, `context` (user, portal, crm{objectId,objectTypeId}, location,
extension), repeat item/index names of the node and its ancestors, and in event handlers the
event's params (e.g. `value`, `event`). Custom code additionally gets `actions`, `hubspot`, `logger`.

### Template strings (`src/model/template.ts`) — runtime and codegen MUST agree
1. No `{{` → plain string.
2. Exactly one `{{ expr }}` segment → raw value of `expr` (e.g. a number prop "{{ count }}").
3. Mixed text + segments → string; each segment converted with `toText` (null/undefined/booleans →
   '', objects → JSON, else `String`). Codegen emits a `toText` helper (`TO_TEXT_HELPER_SOURCE`).
4. Literal arrays/objects may contain template strings at any depth.
5. `node.text` always yields a string (single segment still goes through `toText`).

## 2. Registry (`src/registry`)

* `types.ts` defines `ComponentDef`, `PropDef`, `PropType`, `EventDef`, `SlotDef`, `ChildrenDef`,
  `ValueBindingDef`, `OverlayDef`, `PreviewProps`. `index.ts` aggregates the group files in
  `components/*.tsx`. `constants.ts` has icon names, distance/size option lists, docs URLs, CRM
  object types.
* Reference implementations: `Text` (components/text.tsx) and `Flex` (components/layout.tsx).

### Component definition rules
* `type` is the exact export name (compound: `Dropdown.ButtonItem` with `importName: 'Dropdown'`).
  `importFrom` is `@hubspot/ui-extensions` or `@hubspot/ui-extensions/crm`.
* Prop `name`s and enum values are copied **exactly** from the `.d.ts` files. Include every
  documented, non-deprecated prop (plus `testId` in group 'Advanced'). Omit callback props from
  `props` — declare them as `events` with correct positional `params`:
  * `onClick` on Button/Link/Tag/Image/etc.: `ReactionsHandler<ExtensionEvent>` → params `[event]`.
  * inputs `onChange/onInput/onBlur/onFocus(value)` → params `[value]`.
  * Form `onSubmit(event)` → `[event]` (values in `event.targetValue`).
  * Read each `.d.ts` for others (Tabs `onSelectedChange(selectedId)`, Accordion `onClick`, Table
    `onPageChange(pageNumber)`, sort events, etc.).
* Props whose TS type is `ReactNode` (other than `children`) are `slots`. Overlay triggers (Button,
  LoadingButton, Link, Image, Tag, Dropdown.ButtonItem) declare
  `slots: [{ name: 'overlay', label: 'Overlay', accepts: ['Modal', 'Panel', 'Tooltip'], max: 1 }]`
  (Dropdown.ButtonItem: `['Modal', 'Panel']`).
* Modal and Panel set `overlay: { idProp: 'id' }` and must be created with a unique `id` prop and a
  `title` (closed with `actions.closeOverlay(id)`). Tooltip sets `slotOnly: true` (it can only live
  in an `overlay` slot; shown on hover of its trigger).
* `required: true` for props that are required in TS. `create()` MUST return a template in which
  every required prop is set and required children exist, so generated code type-checks.
* `children.mode`: 'text' for components whose children are plain text (Text, Heading, Button,
  Link, Tag, Alert body, Tooltip…), 'nodes' for containers, 'none' otherwise. Use `accepts` /
  `parents` for structural rules (TableRow ⊂ TableHead/TableBody/TableFooter; TableCell ⊂ TableRow
  (body/footer); TableHeader ⊂ TableRow (head); Tab ⊂ Tabs; StatisticsItem ⊂ Statistics;
  DescriptionListItem ⊂ DescriptionList; ModalBody/ModalFooter ⊂ Modal; PanelBody/PanelSection/
  PanelFooter ⊂ Panel; Dropdown.ButtonItem ⊂ Dropdown; ...).
* Inputs declare `valueBinding` (value prop, change event, state type, initial value). Other
  controlled components may too (Tabs `selected`, Table `page`, TableHeader `sortDirection`,
  StepIndicator `currentStep`); runtime and codegen treat bindings generically (inject the bound
  prop, set state from the event's first param).
* Discriminated unions: `PropDef.requiredWhen(props)` marks a prop required only in some variants
  (Table `pageCount` when `paginated`); `EventDef.requiredWhen(props)` marks a handler that exists
  only in such variants — codegen emits a no-op handler when it passes and nothing is configured.
  `PropDef.visibleWhen(props)` hides a prop in the inspector (expression props arrive as
  `{ $expr }` objects); codegen omits hidden props and bindings to them, because TypeScript
  rejects them in the other variants.
* Constrained values: `options` props list the extra per-option keys the HubSpot option type
  accepts in `optionFields` (Select/MultiSelect: none; ToggleGroup: description, initialIsChecked,
  readOnly); a `stringList` with `options` only accepts those items (chart `colorList`:
  `ChartColor[]`).
* CRM components set `locations` to where they are available (see
  `extension-points.synced.d.ts`: `crm.record.tab`, `crm.preview`, `helpdesk.sidebar` get all CRM
  components; `crm.record.sidebar` only CrmActionButton/CrmActionLink; settings/home none).

### Preview components
* Signature `(p: PreviewProps) => JSX`. **Spread `p.rootProps` on the outermost DOM element** (merge
  `className`). Render `p.children` where child components go (it already contains drop
  placeholders in design mode). Use `p.text` for text content.
* Look like HubSpot (Canvas design system): use tokens from `src/preview/hubspot.css` (`--hsp-*`) and
  put group styles in `src/preview/styles/<group>.css` with `hsp-` class prefix. No
  `position: fixed`, no global selectors, no external assets/fonts.
* Interactions only through `p.trigger(eventName, ...args)` (no-op in design mode). Inputs use
  `usePreviewValue(props.value, props.defaultValue, empty)` and call `trigger('onChange', v)`.
* Apply HubSpot defaults yourself (absent props are absent in `p.props`). Never throw on
  unexpected prop shapes (users can type anything into expressions) — degrade gracefully.
* Overlay components (Modal/Panel) render differently for `p.overlay.presentation`:
  `'inline'` = static card-like block for the designer storyboard; `'open'` = absolutely
  positioned within the nearest `.hsp-overlay-host` container (modal centered with backdrop, panel
  sliding from the right), with a close button calling `p.overlay.close()`. While open they fire
  their own `onOpen` / `onClose` through `trigger`; the runtime never fires these itself.
* `hubspot.css` disables pointer events on `<a>` / `<button>` in design mode, so clickable
  previews render their design-mode root as a `<span>` (selection clicks must reach the root).

### Conformance (`src/registry/conformance.test.ts`)
Mechanically checks the registry against the installed package: every exported component (and
compound member such as `Dropdown.ButtonItem`) is registered unless allowlisted with a reason
(deprecated `Card`, `Stack`, `Textarea`); for every component a card is generated with its
`create()` template, a required-props-only node, one node per prop sample (every enum option, and
so on), every event, every slot content and a value binding, and type-checked strictly; every
template renders through the runtime in both modes; placement rules agree with `parents`,
`accepts` and slots. A failure means the registry (or codegen) is wrong, not the test.

## 3. Placement rules (`src/model/rules.ts`)
`canAccept(ext, parentId, childType, slot?, movingId?)` combines `children.mode/accepts`,
`parents`, `slots[].accepts/max`, overlay-only components, and location availability. Used by the
store (`insertNode`, `moveNode`, `paste`), drag & drop and the palette.

## 4. Store (`src/model/store.ts`)
`useEditor` (zustand). All document changes go through store actions (they record undo history,
coalescing rapid edits). UI state: `mode` ('design' | 'preview'), `selectedNodeId`,
`hoveredNodeId`, `leftPanel`, `rightPanel`, `bottomPanel`, `clipboard`, `previewResetKey`.
Hooks: `useActiveExtension()`, `useSelectedNode()`, `selectActiveExtension(state)`.

## 5. Runtime (`src/runtime`) — see `src/runtime/types.ts`
`RuntimeProvider`, `useRuntime`, `NodeRenderer`, `ExtensionRenderer`, `PreviewHost`,
`DropPlaceholder`; expression helpers in `expr.ts`. DOM contract for the canvas:
`data-node-id`, `data-node-type`, `data-uiex-clone`, `data-uiex-cond`, `data-uiex-repeat-empty`
(design-mode stand-in for a repeat over an empty array), `data-drop-placeholder-for` (+
`data-drop-slot`); a node whose preview throws renders a `.hsp-rt-error` box that keeps its
`data-node-id`. The overlay host element has class `hsp-overlay-host` (must be inside a
`position: relative` card frame). In design mode the canvas may dispatch a bubbling
`CustomEvent(UIEX_REVEAL_EVENT)` (`'uiex:reveal'`, exported by `registry/components/layout`) on a
selected node's element so enclosing Tabs / Accordions reveal it.

## 6. Codegen (`src/codegen`)
`generateExtensionSource(project, ext)`, `generateProjectFiles(project)`,
`buildProjectZip(project)`. Output must type-check under `strict` against the real package and
match the official 2026.03 templates. User expressions are wrapped so they type-check (`any` at
the boundaries). Imports are minimal and sorted; `@hubspot/ui-extensions/crm` used for CRM
components and `useCrmProperties`/`useAssociations`.

## 7. Conventions
* TypeScript strict, no `any` leaks into public APIs (internal `any` in previews is fine).
* Tests: Vitest (`*.test.ts(x)` next to the code), Playwright e2e in `/e2e`. Vitest globals are
  off; `src/test/setup.ts` registers Testing Library's `cleanup` after each test. Generated code is
  type-checked with the helpers in `src/test/typecheck.ts`.
* Builder chrome uses `src/ui` primitives and `ub-` CSS classes (`src/styles/app.css`).
* Don't edit files owned by another module unless the task says so; if a contract change is truly
  needed, make the smallest backwards-compatible addition and document it here.

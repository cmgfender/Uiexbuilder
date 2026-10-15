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
Plus the power features: helper functions declared in `Extension.helpers` (module level — every
other name shadows them) and computed values (`Extension.computed`, see §6c).

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
Power actions (active extension): `addComputed(partial?)` (unique valid name, default base
`computed`), `updateComputed(id, patch)` (coalesced), `removeComputed(id)`, `moveComputed(id, index)`,
`setHelpers(code)` (coalesced; empty code removes the field). `duplicateExtension` copies computed
values and helpers.

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
The base scope (`buildBaseScope` / `buildScopeWithDiagnostics`) also holds helper values and
computed values; `RuntimeApi.diagnostics` (optional) reports `helpersError` and `computedErrors`
(by computed id). Errors never throw: a failing computed value is `undefined`, and each distinct
error is logged once to the console panel.

## 6. Codegen (`src/codegen`)
`generateExtensionSource(project, ext)`, `generateProjectFiles(project)`,
`buildProjectZip(project)`. Output must type-check under `strict` against the real package and
match the official 2026.03 templates. User expressions are wrapped so they type-check (`any` at
the boundaries). Imports are minimal and sorted; `@hubspot/ui-extensions/crm` used for CRM
components and `useCrmProperties`/`useAssociations`.
`generateNodeJsx(project, ext, nodeId)` returns one node subtree's JSX exactly as it appears in the
generated component (condition / repeat wrappers, slot content as the bare element, handler names
of the full file); the root id yields the `<>…</>` fragment, unknown ids `''`.

## 6b. Templates & validation (`src/templates`, `src/model/validate.ts`)
* `ExtensionTemplate.build(existing, functionIds?)`; templates that need server code declare
  `functions?: () => AppFunction[]`. Use `instantiateExtensionTemplate(tpl, project)` — it creates
  the functions with unique uid / file name and passes their ids to `build`. `BlockTemplate` may
  list `keywords`. `freshBlockTemplate(template, ext)` renames Modal/Panel ids (and `@id`
  closeOverlay refs) that the extension already uses — call it before inserting / dragging a block.
* `validateProject(project)` issues carry a stable `rule` id (see the list at the top of
  validate.ts); `field` follows the Issue doc (`state:<id>`, `dataSource:<id>`, `computed:<id>`,
  `helpers`, `function:<id>`, `app.*`, `project.name`, extension fields, prop names, `text`,
  `condition`, `repeat`, `binding`, `event:<name>`). Every starter / block validates without
  errors or warnings and type-checks (`src/templates/templates.test.ts`).

## 6c. Power features (`src/power`)
* **Helpers** (`Extension.helpers`): module-level JavaScript or TypeScript. `helperNames(code)` lists
  top-level `function` / `class` / `const` / `let` / `var` names (`src/power/helpers.ts`, pure and
  dependency-free so model / runtime / codegen / validation import it). Codegen emits the code after
  the imports and generated helpers (`// Helper functions …` header); parameters without a type get
  `: any` (`prepareHelpersForTypeScript`) so plain JS helpers type-check under `strict` — other TS
  strictness (e.g. indexing `{}` with a string) is the author's to satisfy, so type params / locals
  or use `any`. Import names and generated helpers that clash with a helper are aliased (`Text as
  TextComponent`, `toText2`); `hubspot` / `logger` used by helper code are imported. The preview
  evaluates the code once per source text (`compileHelpers`) after `stripTypeScript` removes
  annotations, casts, generics, `type` / `interface` declarations and `export`; helpers cannot see
  the extension scope (pass values as arguments). `checkHelpersSyntax` accepts TypeScript.
* **Computed values** (`Extension.computed`): `const <name>: any = <expr>;` in list order, declared
  after state, data hooks and data source loaders and before handlers — each may use state, data,
  context, helpers and the computed values above it. Data source options are emitted earlier and so
  must not reference computed values (the generated hook would read them before their
  declaration; validation should check data source code without computed names in scope). Names that
  are invalid or redeclare state / setters / data source names / earlier computed values are
  skipped by both runtime and codegen (`usableComputed`); `validateComputedName` explains why.
  Computing a value may not call state setters (an error), but functions it returns may.
* **UI**: `ComputedSection` / `HelpersSection` live in the Data panel. `CommandPalette` (mounted
  once by the shell) toggles on ⌘K / Ctrl+K in the capture phase (works inside inputs);
  `openCommandPalette()` opens it programmatically. Commands (`buildCommands`) are rebuilt from
  the store; ranking (`rankCommands`, `fuzzyMatch`: exact > prefix > word start > words at word
  starts > acronym > substring > subsequence) caps results at 50; recent command ids are kept in
  localStorage (`uiex-builder:palette-recent`).

## 6d. Editor integration notes
* **Problems**: `Issue.subject` (optional) carries the value an issue is about (scope, origin,
  bound state name). `src/shell/quickFixes.ts` turns unambiguous issues into one-click fixes in the
  Problems panel (add scope / permitted URL, valid project name, create a missing bound state
  variable, browse components). Navigating to a node issue focuses the field (`revealField` from
  `src/inspector/Problems`); `state:` / `dataSource:` / `computed:` / `helpers` issues expand that
  item in the Data panel (`src/panels/reveal.ts`, `usePowerUi.revealComputed / focusHelpers`).
* **Validation**: data source options are checked without computed values in scope
  (`data-source-computed`, error) because data hooks and loaders are emitted before the computed
  constants. HubSpot uids follow `uidProblem` (`src/model/ids.ts`): letters, digits, `_`, `-`, `.`,
  at most 64 characters — shared by validation and the inspector.
* **Blocks**: `insertBlock(template, state, label, at?)` (src/templates/actions) inserts at an
  explicit drop target or the smart target; the canvas and the layers tree use it so a block and
  the state it needs are one undo step.
* **Drag sources** must not re-render their own list on `dragstart` (moving or detaching the
  dragged element cancels a native drag). The palette records "recently used" on a successful
  `dragend` (`dropEffect !== 'none'`).
* **Kit Dialog** listens for Escape in the bubble phase and ignores events already handled
  (`defaultPrevented`), so autocomplete lists, chip inputs and menus inside a dialog close first;
  only the topmost dialog closes; focus returns to the opener. Its `onClose` may be unstable.
* **Canvas frames** are responsive: settings / home pages follow the stage width (max 960 / 1200);
  the record page hides its decorative summary column when the stage is narrower than the frame.
* JSZip is loaded on demand by `buildProjectZip` (export only).

## 7. Conventions
* TypeScript strict, no `any` leaks into public APIs (internal `any` in previews is fine).
* Tests: Vitest (`*.test.ts(x)` next to the code), Playwright e2e in `/e2e`. Vitest globals are
  off; `src/test/setup.ts` registers Testing Library's `cleanup` after each test. Generated code is
  type-checked with the helpers in `src/test/typecheck.ts`.
* Builder chrome uses `src/ui` primitives and `ub-` CSS classes (`src/styles/app.css`).
* Don't edit files owned by another module unless the task says so; if a contract change is truly
  needed, make the smallest backwards-compatible addition and document it here.

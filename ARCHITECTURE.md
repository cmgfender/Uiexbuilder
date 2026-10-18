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
  `PreviewMockData.simulate?: Record<dataSourceId, 'ok' | 'loading' | 'empty' | 'error'>` makes the
  preview show a data source's loading / empty / error state (Data panel › Mock data › Simulate).
* `FetchSource` and `FetchAction` take optional `headers: RequestHeader[]` (`{ key, value }`, the
  value a template string) and `timeout` (ms), passed to `hubspot.fetch`; a body is never sent
  with GET.

### Importing documents (`src/model/normalize.ts`, `src/model/trust.ts`)
* `validateProjectShape` / `parseProjectJson` run `normalizeProject`: it repairs fields the editor
  dereferences (missing `location`, `objectTypes` as a string, wrong-typed props / text / events /
  bindings, `app: {}`, …) and reports each repair in `ParseResult.warnings`; it rejects unknown
  extension kinds and node graphs that are not trees (cycles, the root as a child, shared nodes,
  depth > `MAX_NODE_DEPTH` 200) and drops unreachable nodes. It never mutates its input.
* **Code trust**: a project imported from a file is *untrusted* (`markProjectUntrusted`, persisted
  per project id under `uiex-builder:untrusted-projects`). While the active project is untrusted
  the runtime evaluates only *safe expressions* (`runtime/safeExpression.ts`: no calls except
  `toText(…)`, no assignment, only scope names and harmless globals), shows the source of paused
  template segments, refuses custom code and skips helper code; `CodeTrustNotice` (rendered above
  the card) says what is paused and offers “Trust and run code” (`trustProject`). Every place that
  runs document code checks `codeExecutionAllowed()` (runtime scope / expr, power Helpers status,
  inspector live previews). Projects created in this browser are trusted.
* **Code trust and HubSpot**: document code runs in the builder's own page, on the same origin as
  the connector, so trusted code could call `/api` as the signed-in admin. `trust.ts` therefore
  remembers which projects were *imported* (`uiex-builder:imported-projects`) and which of those
  the admin trusted *while connected* (`uiex-builder:hubspot-trusted-projects`).
  `codeTrustState()` is `untrusted`, `needs-hubspot-confirmation` (imported, trusted before, but
  now connected) or `trusted`; `codeExecutionAllowed()` is true only for `trusted`. The connection
  store feeds `setHubSpotAccess()`. While connected, `CodeTrustNotice` says plainly that the code
  can read the connected account's CRM data and offers **Trust it with my HubSpot data**. Copies
  and re-imports carry the state (`snapshotCodeTrust` / `restoreCodeTrust` / `copyCodeTrust`).
  Deploying additionally needs the personal access key pasted each time and a sign-in to the
  same account (see Deploy below), so page code alone can't deploy. Residual risk: code the admin
  explicitly trusts while connected can still read CRM data; a sandboxed (opaque-origin) preview
  would be the next step.
* `src/model/jsTokens.ts` is the shared lossless JavaScript tokenizer (loop guards, safe
  expressions, codegen rewrites, validation's `context.crm` / async-data checks).

### Scope available to expressions
State variable names, their setters `setX` (in handlers/custom code), data source names and
`<name>Loading` / `<name>Error`, `context` (user, portal, crm{objectId,objectTypeId}, location,
extension), repeat item/index names of the node and its ancestors, and in event handlers the
event's params (e.g. `value`, `event`). Custom code additionally gets `actions`, `hubspot`, `logger`.
Plus the power features: helper functions declared in `Extension.helpers` (module level — every
other name shadows them) and computed values (`Extension.computed`, see §6c).
`context.crm` exists only on app cards (`SettingsContext` / `AppHomeContext` have none); the preview
matches that and validation reports `context-location`. Every expression can also call `toText(x)`
(rule 3's conversion) unless the document declares its own `toText`; codegen emits the helper when
user code uses it. The inspector's `fx` toggle writes `` `Hi ${toText(name)}` `` for `Hi {{ name }}`.

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
* `commit` records nothing when the recipe changes nothing (immer no-op), so no-op actions create
  no undo step; `updatedAt` is only bumped for real changes.
* `undo` / `redo` switch to the extension the step changes (and keep the selection only if the
  node still exists); `shell/actions.historyStep` toasts when that happens.
* `addStateVar` keeps a valid typed name and makes it unique against everything declared
  (`freeStateName`, using `panels/names.validateDeclaredName`); callers must use the returned name.
* `insertNode` / `paste` refuse templates containing components unavailable in the location
  (`unavailableComponents(ext, tpl)`; also used by `templates/actions.insertBlock` and
  `shell/actions.pasteAt` for the explanation); copies get unique Modal / Panel ids with their
  `closeOverlay` references remapped (`uniquifyOverlayIds`, `toTemplate` writes `@<id>` refs).
* `model/history.asOneUndoStep(fn)` collapses several store actions into one undo step (create a
  variable and bind it, create a function and the data source that runs it, quick fixes).
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
(by computed id). Errors never throw: a failing computed value is `undefined`. Diagnostics are
reported on mount, then debounced (`DIAGNOSTICS_DEBOUNCE_MS` 800) and kept as one console entry
per helpers block / computed id, updated in place and removed once resolved.
* **First render like HubSpot**: a preview session starts with each on-open data source in its
  first-render state (`null` for fetch / function, `{}` record properties, `[]` lists, `xLoading`
  true) and switches to the mock data after `RUNTIME_TIMING.dataSourceLatencyMs` (one latency step
  per dependency, as the generated mount effects wait for the data their request reads).
* In **preview** mode a failing condition / repeat / prop / text expression renders the node's
  error box (it would stop the card on HubSpot) and logs once (`RuntimeControls.reportNodeError`);
  design mode degrades silently as before. `NodeRendererProps.depth` stops runaway recursion at
  `MAX_RENDER_DEPTH` 250 with an error box.
* Preview alerts render at the top of the card body (`PreviewAlerts`, from `ExtensionRenderer`),
  not over the content; identical consecutive alerts collapse (`RuntimeAlert.count`). A preview
  “Copy to clipboard” also shows what was copied.
* `runtime/loopGuard.ts`: `guardLoops(code)` makes `while` / `do` / C-style `for` loops call a
  global guard that throws after 1.5 s of synchronous looping; applied to every compiled
  expression, custom code and helper code, so a runaway loop errors instead of freezing the tab.

## 6. Codegen (`src/codegen`)
`generateExtensionSource(project, ext)`, `generateProjectFiles(project)`,
`buildProjectZip(project)`. Output must type-check under `strict` against the real package and
match the official 2026.03 templates. User expressions are wrapped so they type-check (`any` at
the boundaries). Imports are minimal and sorted; `@hubspot/ui-extensions/crm` used for CRM
components and `useCrmProperties`/`useAssociations`.
`generateNodeJsx(project, ext, nodeId)` returns one node subtree's JSX exactly as it appears in the
generated component (condition / repeat wrappers, slot content as the bare element, handler names
of the full file); the root id yields the `<>…</>` fragment, unknown ids `''`.
* Requests: loaders and fetch steps read responses with a module helper `readJson` (empty / 204
  body → `null`); `fetchOptions` never emits a body for GET and passes `headers` / `timeout`.
* Each “load on open” source gets its own mount effect that waits for the `…Loading` flags of the
  CRM hooks and on-open sources its request reads, then loads once (lint-clean, no stale empty
  request values).
* User code is rewritten with `optionalContextAccess` (`context.extension?.…`, `user?.locale`, …);
  set-state values whose inferred type can't fit the state are cast (`(count + 1) as any`); an If
  step without a condition emits only its else branch. Comments built from document text go
  through `commentText` (line terminators and `*/` defused).
* `requirements.ts`: permitted URLs also come from `hubspot.fetch('…')` literals in custom code,
  helpers and computed values (`fetchUrlsInCode`); `urlOriginHint(url, ext)` explains dynamic hosts
  (suggests the origin of the state variable a URL starts with).
* Project files: function endpoint paths are written in the official leading-slash form; the
  README lists `hs secret add` per secret, `hs project install-app` (static auth) or the install
  link (OAuth) and where to add each card; the UI `package.json` includes the dev dependencies
  `hs project lint` requires (`typescript-eslint`, `jiti`).
* `src/codegen/hubspotRender.test.ts` renders every fixture with HubSpot's own test renderer
  (`@hubspot/ui-extensions/testing`) while data is still loading.

## 6b. Templates & validation (`src/templates`, `src/model/validate.ts`)
* `ExtensionTemplate.build(existing, functionIds?)`; templates that need server code declare
  `functions?: () => AppFunction[]`. Use `instantiateExtensionTemplate(tpl, project)` — it creates
  the functions with unique uid / file name and passes their ids to `build`. `BlockTemplate` may
  list `keywords`. `freshBlockTemplate(template, ext)` renames Modal/Panel ids (and `@id`
  closeOverlay refs) that the extension already uses — call it before inserting / dragging a block.
* **Data blocks** (`BlockTemplate.create(ext, project) → BuiltBlock { template, dataSources }`,
  additive): a block that brings the data it reads, built for the card it goes into (data source
  names that don't clash, the card's record type). `template` stays the gallery thumbnail.
  `prepareBlock(block)` builds it for the active card; `insertBlock(…, at?, dataSources?)` adds the
  sources in the same undo step; the template drag payload carries `dataSources?`. The first one is
  **Associated records** (`associated-records`): an associations source (deals, or contacts on a
  deal card) shown by `panels/generators.resultsTableBlock` under a heading — loading spinner,
  error + Try again, table, “none yet” empty state.
* `validateProject(project)` issues carry a stable `rule` id (see the list at the top of
  validate.ts); `field` follows the Issue doc (`state:<id>`, `dataSource:<id>`, `computed:<id>`,
  `helpers`, `function:<id>`, `app.*`, `project.name`, extension fields, prop names, `text`,
  `condition`, `repeat`, `binding`, `event:<name>`). Every starter / block validates without
  errors or warnings and type-checks (`src/templates/templates.test.ts`).
* Deploy-safety rules added after the review: `context-location` (error: `context.crm` on a
  settings / app home page), `unguarded-async-data` (warning: `weather.temp` on a fetch / function
  source that is null until loaded, unless `?.`, an in-expression check or a node / ancestor
  condition guards it), `dynamic-url-origin` (warning: a request / iframe / image URL whose host is
  an expression; `subject` is the likely origin, the issue key starts with the permitted-URL kind),
  `function-app-type` (error: app functions only in private, static-auth apps; never marketplace —
  `appFunctionsUnsupported(project)`), `function-platform` (warning: 2025.2 has only endpoint
  functions and no `hubspot.serverless`), `endpoint-path`, `set-state-value` (blank “Set variable”
  value), `set-state-type` (a value of another type than the variable), `empty-copy`, and likely
  typos of standard CRM properties under `data-source-properties` (`subject` the name,
  `suggestion` the standard property).
* `Issue.suggestion` (optional) is a likely replacement for `subject`: for `unknown-name` the
  closest name in scope (`closestName` / `editDistance`; none when ambiguous).

## 6c. Power features (`src/power`)
* **Helpers** (`Extension.helpers`): module-level JavaScript or TypeScript. `helperNames(code)` lists
  top-level `function` / `class` / `const` / `let` / `var` names (and enum, namespace and abstract
  class names) (`src/power/helpers.ts`, pure and
  dependency-free so model / runtime / codegen / validation import it). Codegen emits the code after
  the imports and generated helpers (`// Helper functions …` header); parameters without a type get
  `: any` (`prepareHelpersForTypeScript`) so plain JS helpers type-check under `strict` — other TS
  strictness (e.g. indexing `{}` with a string) is the author's to satisfy, so type params / locals
  or use `any`. Import names and generated helpers that clash with a helper are aliased (`Text as
  TextComponent`, `toText2`); `hubspot` / `logger` used by helper code are imported. The preview
  evaluates the code once per source text (`compileHelpers`, loop-guarded, only while code is
  trusted) after `stripTypeScript` removes annotations, casts, generics, `type` / `interface` /
  `declare` declarations, overload signatures, `this` parameters, abstract / declare members, index
  signatures and `export` (also inside template `${…}`), and lowers enums, namespaces and
  constructor parameter properties like tsc; helpers cannot see the extension scope (pass values
  as arguments). `checkHelpersSyntax` accepts TypeScript.
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
  starts > acronym > substring > subsequence; keywords weigh 0.65 and subtitles 0.55 so they never
  beat a title word-start match; title subsequence matches below 150 are dropped; multi-word
  queries may mix title and keyword words) caps results at 50. Commands include an “Events” group
  (“Add action: <kind>” adds a step to the selected component's first event), zoom commands and
  “Duplicate this card”. Recent command ids are kept in localStorage under
  `uiex-builder:command-recent` (the component palette keeps recently used components under
  `uiex-builder:palette-recent`).
* `CodeEditor` / `CodeEditorDialog` / `handleCodeKeyDown` (power/CodeEditor.tsx): highlighted code
  editor and the large modal editor used by Helpers, computed values and custom code actions.
  `usePowerUi.focusHelpers()` is a one-shot request (`helpersFocusPending`) consumed by
  HelpersSection.
* **Visual conditions** (`src/inspector/power-conditions.ts`, `power-ConditionBuilder.tsx`): an OR
  of AND groups (like HubSpot's filter groups) stored as a plain expression (`conditionToExpr` /
  `parseCondition`). Operators: is, is not, >, >=, <, <=, contains / doesn't contain
  (`String(S ?? "").toLowerCase().includes(…)`), is empty / is not empty
  (`String(S ?? "").length === 0`), is true / is false. Numeric comparisons wrap `Number()` unless
  the subject is a non-null typed number; typed values become literals of the subject's type (CRM
  values stay text). Code that is not of this shape stays in the code editor ("Start over with the
  builder"). Used by Advanced › Visibility (**Show when**), the If step and list filters.
* **Shaped lists** (`src/power/shape.ts`, `ShapeEditor.tsx`): a computed value
  `[...(src ?? [])].filter((row) => …).sort((a, b) => …).slice(0, N).map((row) => ({ ...row, name: format }))`
  recognised again by `parseShape`. The copy keeps hook data from being mutated by `sort` and types
  the rows `any[]`, so callbacks on untyped fetch results pass strict TS. Formats: currency,
  number, percent, date (UTC), relative date. Sorts compare as text, numbers, or `formatted`
  numbers — HubSpot's formatted values such as "$48,000.00" or "45%" (`guessSortAs` picks it;
  symbols and separators are stripped with `.replace(/[^0-9.-]/g, "")` before comparing; US-style
  separators only). Text sorts start A → Z, numbers highest first. Fields show HubSpot property
  labels (`fieldDisplayLabel`: **Deal name**, **Amount**, **Record ID**), the exact path as tooltip. Offered in Data › Computed, a data source's
  **Filter & sort**, Advanced › Repeat (**Filter, sort & limit…**: creates the list and repeats
  over it in one undo step) and the palette (`addShapedList`, `src/power/actions.ts`).
* **SubjectPicker** (`src/inspector/power-SubjectPicker.tsx`): the shared "Based on" picker of
  Rules, conditions and list filters; it also lists event values and the fields of repeat items
  and event values with their current preview value.
* **Settings and multi-selection** (`src/model/settings.ts`): store `settingsClipboard`,
  `copySettings(id)`, `pasteSettings(ids)` (one undo step, same component type only; props incl.
  rules and expressions, and text; never identity props — overlay `id`, input `name`, `testId` —
  nor events, conditions, repeats or bindings). `selectedNodeIds` (empty unless 2+ are selected;
  `selectedNodeId` stays the primary), `toggleSelection`, `selectMany`, `setPropsMany`,
  `setTextMany`, `removeNodes(ids)` (one undo step). `select()`, inserting, switching cards and
  delete / undo clear or prune the multi-selection. Gestures: Shift / Cmd / Ctrl-click on the
  canvas (`Canvas.tsx`) and in Layers (`aria-multiselectable` tree, one tab stop); the overlay
  outlines the other selected nodes (`data-testid="canvas-multi-outline"`, class `is-multi`; the
  chip and quick toolbar stay on the primary). `Inspector` mounts `MultiInspector`
  (`power-MultiInspector.tsx`) for 2+ selected: shared props by name / kind / options, "Different
  on each", Reset on all, Paste settings. Shortcuts: ⌥⌘C / ⌥⌘V (matched by `e.code`, since Alt
  changes `e.key` on macOS), Delete removes every selected component, Escape keeps only the
  primary. The node ⋯ menu and the canvas context menu have Copy settings / Paste settings (and
  "Paste settings onto N selected" / "Delete N selected" when right-clicking a multi-selection).
* **Rules in actions** (`src/inspector/power-actionRules.tsx`, the same `RulesEditor`, which now
  takes optional `node`, `nodeId` and `eventParams`): alert type (`AddAlertAction.alertTypeExpr?`,
  additive; runtime evaluates it, codegen emits a rules ternary of alert types plainly and any other
  expression `as any`; validation, rename and usages know it), alert title / message and the text
  to copy (a single `{{ rules }}` segment), and a set-state value (an expression). Alert type
  rules start ready-made like the progress bar's color (`RulesRow.start`: success from 80, warning
  from 40, otherwise error).

## 6d. Editor integration notes
* **Problems**: `Issue.subject` (optional) carries the value an issue is about (scope, origin,
  bound state name). `src/shell/quickFixes.ts` turns unambiguous issues into one-click fixes in the
  Problems panel (add scope / permitted URL — also the likely origin of a dynamic URL, valid
  project name, create a missing bound state variable and bind the name the store created,
  replace a misspelt name with the suggestion everywhere in the extension, use the standard CRM
  property for a likely typo, browse components). Validation for the panel and the top-bar count
  runs `PROBLEMS_DEBOUNCE_MS` (600) after the last edit. Navigating to a node issue focuses the field (`revealField` from
  `src/inspector/Problems`); `state:` / `dataSource:` / `computed:` / `helpers` issues expand that
  item in the Data panel (`src/panels/reveal.ts`, `usePowerUi.revealComputed / focusHelpers`).
* **Validation**: data source options are checked without computed values in scope
  (`data-source-computed`, error) because data hooks and loaders are emitted before the computed
  constants. HubSpot uids follow `uidProblem` (`src/model/ids.ts`): letters, digits, `_`, `-`, `.`,
  at most 64 characters — shared by validation and the inspector.
* **Blocks**: `insertBlock(template, state, label, at?, dataSources?)` (src/templates/actions)
  inserts at an explicit drop target or the smart target; the canvas and the layers tree use it so
  a block and the state / data it needs are one undo step.
* **Smart insert target** (`dnd/dragState.smartInsertTarget`, palette clicks, blocks, command
  palette): into the selected container, else after the selection, else at the end of the card's
  **main column** (`mainColumn(ext)`: the root's only child when it is a Flex column), else the
  root. Full-width components (`isFullWidthComponent`: CRM data, charts, tables, data display,
  forms, tabs, accordions, alerts, empty / error states, dividers, tiles) never land inside a
  side-by-side row (`isSideBySide`: Flex row — HubSpot's default — Inline, AutoGrid) next to the
  selection, e.g. beside a name and a status tag; they go after the row. Deliberate columns
  layouts (every child a Flex / Box / Tile) keep content in the selected column.
* **Design-mode flags**: a node hidden by its condition shows a striped “Hidden right now” flag.
* **Copy to clipboard in preview**: HubSpot copies silently, so the preview adds a “Copied to
  clipboard (preview)” alert — unless the same handler shows an alert of its own afterwards.
* **Drag sources** must not re-render their own list on `dragstart` (moving or detaching the
  dragged element cancels a native drag). The palette records "recently used" on a successful
  `dragend` (`dropEffect !== 'none'`).
* **Kit Dialog** listens for Escape in the bubble phase and ignores events already handled
  (`defaultPrevented`), so autocomplete lists, chip inputs and menus inside a dialog close first;
  only the topmost dialog closes; focus returns to the opener. Its `onClose` may be unstable.
* **Canvas frames** are responsive: settings / home pages follow the stage width (max 960 / 1200);
  the record page hides its decorative summary column when the stage is narrower than the frame.
* JSZip is loaded on demand by `buildProjectZip` (export only).
* **Kit focus contracts**: `Dialog` traps Tab / Shift+Tab, makes `#root` inert while open, keeps an
  autofocused field focused (else focuses itself) and returns focus to its opener — the menu
  trigger when it was opened from a menu item. `Menu` implements the ARIA menu keyboard model
  (focus the first item, Up / Down / Home / End / Tab, Escape) and returns focus to its opener or a
  `returnFocus` prop. `Tabs` is one Tab stop with Left / Right / Home / End; pass `idBase` and
  spread `tabPanelProps(idBase, value)` on the panel. Inspector popovers that are interactive pass
  `autoFocus` (focus moves in once positioned; Escape closes and refocuses the anchor). In
  multi-line fields the autocomplete list opens under the caret's line (`anchorRect`).
* **Shortcut scope**: single-key shortcuts (Delete / Backspace, Escape, arrows, Alt+arrows) only
  act with focus on `body`, `.ub-cv-stage` or inside `[data-shortcuts-scope]` (the Layers tree);
  Cmd / Ctrl shortcuts stay global.
* **Saving**: save the open project with `saveCurrentProject()` (src/shell/persistence), never
  `saveProject(current)`, so another tab's newer version is not overwritten (the conflict dialog
  asks); a failed save reports its reason (`useShell.saveError`: 'quota' → “Browser storage is
  full”). Import files with `importProjectFromText(text, { fileName })` (src/shell/importProject):
  it asks before replacing a different saved version of the same project (copy / replace /
  cancel), keeps the file's code untrusted and opens it under the boot guard.
* **Crash recovery**: `EditorErrorBoundary` (src/shell/Recovery.tsx) shows a recovery screen and
  suspends autosave; the boot guard `uiex-builder:boot-guard` (written before a project is opened
  at startup or imported, cleared once the editor settled) makes the next startup show the
  recovery screen instead of reopening a document that crashed or hung; `?safe=1` does the same.
* **Layout**: below 1180 px the left sidebar starts as a rail (`useShell.leftAutoCollapsed`, not
  persisted; read `isLeftCollapsed(state)`). Both sidebars are resizable (`leftWidth` /
  `rightWidth`, 240–560 px, persisted; separators on their inner edges). The canvas zoom is
  automatic until the user picks one (`useCanvasView.auto`): a card frame wider than the stage
  (e.g. the record tab in a small window) starts zoomed out to fit.
* **Canvas**: the selection chip and quick toolbar are placed by `placeSelectionChrome`
  (src/canvas/chromePlacement.ts) outside the outline on the side that covers the least
  surrounding content (frame text marks itself with `data-cv-obstacle`); they fade and become
  click-through after the pointer rests on covered content, and during drags. Quick-toolbar
  actions keep keyboard focus in the toolbar or on the stage. Click-to-add is form-aware: adding
  to a Form goes into its fields' layout Flex / Box, before the trailing submit / reset action area
  (`formActionsStart`). The focused stage announces keyboard selection changes, moves, duplicates
  and deletes in a polite live region (src/canvas/announce.ts); Shift+F10 / the Menu key open the
  selected node's context menu at the node and return focus to the stage when it closes.
* **Renaming** (panels/findUsages `renameReferences` / `findUsages`) is scope-aware: repeat item /
  index names, event params and fetch / runFunction `response` / `error` hide declarations, so
  they are neither counted nor renamed. `validateDeclaredName` and the computed-value name field
  reject a new name that such a local, or a name declared in custom code, would capture at a usage
  site (`renameConflicts` / `renameConflictMessage`). “Save as block” (canvas and layers) lists the
  state variables a subtree really uses (`canvas/nodeActions.usedStateVars`).
* **HubSpot ids**: `projectUidError`, `extensionFileNameError`, `functionFileNameError`,
  `ENDPOINT_PATH_RE` (src/panels/utils) are the project-wide rules shared by the dialogs, the
  inspector's extension settings and validation.

## 7. Conventions
* TypeScript strict, no `any` leaks into public APIs (internal `any` in previews is fine).
* Tests: Vitest (`*.test.ts(x)` next to the code; server tests start with
  `// @vitest-environment node`), Playwright e2e in `/e2e` (static build, no connector) and
  `/e2e-connect` (production server + fake HubSpot, `npm run e2e:connect`). The e2e helper
  `openEditor` skips the first-run welcome (“I know what I’m doing”); `first-run.spec.ts` in both
  suites covers the welcome, setup and tour. Vitest globals are
  off; `src/test/setup.ts` registers Testing Library's `cleanup` after each test. Generated code is
  type-checked with the helpers in `src/test/typecheck.ts`.
* Builder chrome uses `src/ui` primitives and `ub-` CSS classes (`src/styles/app.css`).
* Don't edit files owned by another module unless the task says so; if a contract change is truly
  needed, make the smallest backwards-compatible addition and document it here.

## 8. HubSpot connector — "Connect HubSpot" (`server/`, `src/connect`)

Non-technical admins sign in with HubSpot (OAuth, in a popup), preview cards with **real CRM
data**, get pickers filled with their portal's real schema, and can deploy without a terminal.
HubSpot's API refuses browser (CORS) calls, so a small **connector** backend runs next to the
builder on the **same origin**, with every route under `/api`. The builder never sees a token.

```
browser (builder)                         connector (server/core)                 HubSpot
src/connect/client.ts ── /api/* ──────▶  router → security (CSRF/origin)  ──▶  api.hubapi.com
  X-UIEX-Request: 1, credentials          session cookie (AES-GCM, HttpOnly)     app.hubspot.com (OAuth)
popup /api/auth/start ──────────────▶  302 → HubSpot consent → /api/auth/callback
  ◀── postMessage / BroadcastChannel ── HTML page {type:'uiex-hubspot-auth', ok, error?, message?}
```

### Contracts
* `src/connect/types.ts`: `CONNECTOR_ROUTES`, the DTOs, `CSRF_HEADER` and `ConnectorErrorBody`
  (`{ error: { code, message, status, requiredScopes?, correlationId?, portalId? } }`). It is
  types-only and compiled by both sides.
* `server/core/types.ts`: `ServerConfig`, `SessionData`, `Session`, `HubSpotApi`,
  `HubSpotApiError`, `RequestContext`, `Route`.
* `server/core/index.ts`:
  * `configFromEnv(env, overrides?)`, which reads APP_URL, HUBSPOT_CLIENT_ID / _SECRET,
    SESSION_SECRET, HUBSPOT_SCOPES / _OPTIONAL_SCOPES, HUBSPOT_API_BASE / _APP_BASE,
    ENABLE_FETCH_PROXY, ENABLE_DEPLOY, ALLOWED_ORIGINS, ALLOWED_PORTALS and NODE_ENV;
  * `createConnector(config, options?).handle(request, meta?)`, which returns `null` for
    non-`/api` paths so an adapter can serve static files instead. `meta.clientIp` (optional) is
    the caller's address as the adapter sees it (rate limits, loopback checks).
* Additive contract changes (security / UX review): `CONNECTOR_ROUTES.deployPoll`
  (`POST /api/deploy/status`); `ConnectorHealth.appBase`, `features.deployUnavailableReason`,
  `features.deployNeedsSignIn`, `missingSettings`; `formatted: boolean | string[]` on CRM search
  and record requests; `DeployRequest.useRememberedKey` / `remember` are deprecated (ignored);
  `ServerConfig.allowedPortals` and `ServerConfig.proxyFetch` (`ProxyFetch`, `ProxyFetchInit`);
  `RequestContext.signedIn(opts?: { confirm?: boolean })`; optional
  `LiveDataAdapter.getPropertyDefinitions` / `getPipelines`; `DataSource.formatted` may list
  property names (`FormattedSetting`).
* `LiveDataAdapter` (end of `src/runtime/types.ts`) and `RuntimeProviderProps.live` connect the
  connector to the preview runtime.

### Server core (`server/core`, Web APIs only: `fetch`, `crypto.subtle`, `Request`/`Response`)
* **Config** (`config.ts`):
  * `checkConfig()` lists missing settings; auth routes then answer a plain-language 503
    `not_configured`.
  * The default scopes are `DEFAULT_REQUIRED_SCOPES` (`oauth` plus contacts, companies and deals
    objects and schemas, read) and `DEFAULT_OPTIONAL_SCOPES` (tickets objects and schemas, custom
    objects and schemas, owners, line items, products and quotes, all `.read`).
  * HubSpot retired the coarse `tickets` scope, so tickets use the granular
    `crm.objects.tickets.read` and `crm.schemas.tickets.read`. `hubspot-app/` and
    `public/hubspot-connector-app.uiex.json` must list the same scopes (tests check this; run
    `node scripts/make-connector-app.mjs` after a change).
* **Sessions** (`crypto.ts`, `cookies.ts`, `session.ts`):
  * The session is the cookie `__Host-uiex_session` (`uiex_session` on plain-http local
    development): AES-256-GCM, with a key derived by HKDF from `SESSION_SECRET`, the cookie name
    bound as additional data and a server-checked expiry. It is HttpOnly, SameSite=Lax, Secure on
    https, Path=/, no Domain, Max-Age 30 days and at most 4 KB. There is no database.
  * The single-use OAuth `state` lives in `__Host-uiex_oauth` (Path=/, 10 minutes).
  * A tampered, expired or old-secret cookie reads as signed out, and so does a cookie name sent
    twice (cookie tossing from a sibling subdomain). Old unprefixed cookies are deleted.
  * The session holds no personal access key. A copied session cookie stops working for
    anything that needs a live grant: `/api/me`, catalog calls and deploy re-check the grant with
    HubSpot at least every 5 minutes (`GRANT_CHECK_INTERVAL_MS`), and deploy always forces a
    refresh, so after **Disconnect** (refresh token revoked) a replayed cookie is refused.
    Rotating `SESSION_SECRET` signs everyone out.
* **Security** (`security.ts`):
  * `X-UIEX-Request` is required on every route except `auth/start`, `auth/callback` and the
    health check.
  * `Origin` must be `APP_URL` or one of `ALLOWED_ORIGINS`, and CORS answers only those.
  * `returnTo` is validated, so there are no open redirects.
  * Every `/api` response has `Cache-Control: no-store`, nosniff, `X-Frame-Options: DENY` and
    no-referrer.
  * `ALLOWED_PORTALS` (optional): only these HubSpot accounts can sign in (the callback gives
    other grants back and keeps no session) and deploy.
  * Rate limits (`rateLimit.ts`, in-memory token buckets per instance): sign-in start / callback
    per client IP, deploy and the fetch proxy per signed-in user (else per client IP). Auth pages
    answer with a plain HTML page, API calls with `rate_limited` and Retry-After.
* **OAuth** (`oauth.ts`, `routes/auth.ts`, `authPage.ts`):
  * start → HubSpot authorize (`scope` + `optional_scope`) → callback (state check, code
    exchange, token info) → a self-contained HTML page.
  * The page's CSP allows its inline script only by hash. It posts the result to the opener's
    validated origin and on `BroadcastChannel('uiex-hubspot-auth')`, then closes.
  * `?mode=redirect` returns to the builder with `?uiex_auth=connected|<code>`.
  * `/api/me` refreshes an expiring token; `invalid_grant` gives `reason: 'revoked'`.
  * Logout revokes the refresh token.
* **HubSpot calls** (`hubspot.ts`, `SessionHubSpotApi`):
  * The token is refreshed 60 s before it expires, and once more on a 401. Concurrent refreshes
    are merged.
  * Errors map to codes: 403 MISSING_SCOPES becomes `missing_scope` with `requiredScopes`; 429
    is retried once, then `rate_limited` with Retry-After; 5xx becomes `hubspot_error` with the
    correlation id; plus `timeout` and `hubspot_unreachable`.
* **Routes** (all read-only):
  * `routes/crm.ts`: object types (standard plus custom objects), properties, pipelines, owners,
    record-picker search, a record (`formatted=1` gives en-US / UTC display values for every
    property, `formatted=a,b` only for the listed ones), associations (v4 plus batch read) and a
    validated CRM search passthrough.
  * `routes/proxy.ts`: preview `hubspot.fetch` through `ssrf.ts`. It allows https only on
    ordinary ports, blocks private, loopback, metadata and special-purpose hosts (IPv4 lists; IPv6
    only global unicast `2000::/3` outside NAT64 / Teredo / 6to4 / documentation ranges, IPv4-mapped
    addresses checked as IPv4), follows at most 3 redirects (each re-checked), times out after
    10 s and caps responses at 1 MB. On Node (`server/node.ts`) the request goes through
    `server/guardedFetch.ts` (`ServerConfig.proxyFetch`): every DNS answer is checked and the
    connection is pinned to the checked address, so names that resolve to private addresses and
    DNS rebinding are refused too. Edge hosts (Vercel, Cloudflare) have no DNS hook and rely on
    their platform's network isolation. Local development (`APP_URL` on localhost) may fetch
    http://localhost backends only for a browser on the same computer (`meta.clientIp` is
    loopback).
  * `routes/deploy.ts`: see below.
* **Deploy to HubSpot (beta)** (`server/core/deploy/**`, `src/panels/deploy/**`):
  * The personal access key is exchanged for a short-lived token; the project is found or
    created, zipped (`zip.ts`, HubSpot's ignore rules) and uploaded with the project IR
    (`ir.ts`, platform 2025.2 and later).
  * The key is pasted for every deploy and never stored. A private app token (`pat-…`) is
    recognised and explained.
  * When sign-in is set up, deploying needs a signed-in session (grant re-checked with HubSpot)
    and the key must belong to that same account (`portal_mismatch` otherwise) and to
    `ALLOWED_PORTALS` when set. While sign-in isn't set up yet (first-time setup: deploying the
    connector app itself), deploy works with the key alone, with a stricter per-IP rate limit.
  * Build and deploy are followed one step per `POST /api/deploy/status` `{ deployId }` (the
    legacy `GET /api/deploy/:deployId` still answers; Node access logs redact the id). The
    deployId is an encrypted job token that never holds the key, and it only works in the browser
    that started the deploy: the job holds a hash of a random HttpOnly cookie
    (`__Host-uiex_deploy`, 2 hours). The queue step is safe to replay: it checks the project's
    deployed build first (already deployed → finish; a newer build deployed → `superseded`).
  * `features.deploy` needs a usable `SESSION_SECRET` (`deployUnavailableReason` says why it is
    off: `session_secret` or `disabled`).
  * Without a connector, the panel falls back to the CLI steps.
  * The UI says **Publish to HubSpot** (code keeps `deploy` / `export` names): the top bar's
    **Publish** button opens the dialog (`ExportDialog`, title “Publish to HubSpot”, tabs Publish
    to HubSpot · Download · Files · Use the HubSpot CLI). `DeployPanel` is a 3-step wizard:
    1 **Get your key** (a direct link to the page the HubSpot CLI opens — verified in
    @hubspot/cli 8.16 `personalAccessKeyPrompt`: `<app>/personal-access-key/<portalId>`, else
    `<app>/l/personal-access-key` — plus the clicks and the paste field), 2 **Publish** (progress
    bar and stepper Uploading → Building → Going live → Published), 3 **Finish in HubSpot**
    (`publishChecklist`: install the app, add each card to its record page with the exact
    clicks — Settings → Data Management → Objects → <type> → Record / Preview Customization —
    linking `<app>/settings/<portal>`, open the sample record or the object's records). Ticks and
    the last publish are remembered per project (`deploy/checklist.ts`, localStorage
    `uiex-builder:publish:<projectId>`, links and ids only). Failures add **What to do next**
    (`failureAdvice(code)`).
  * Usability pass: the form's **Publish to HubSpot** button and the target account sit in a
    sticky footer (`.ub-dp-actions`), always in view; the key guide is one line per click and
    starts folded (“How do I get my key?”) for someone who published this project before;
    “Last published … · Finish in HubSpot: n of m done” plus “You’ve changed your cards since
    then” when `project.updatedAt` is newer. Progress says what is happening in plain words
    (`phaseMessage(phase)`; build numbers stay in the log). Success says which card went where
    (“Published! “Contact Summary” is in HubSpot. It’s in the HubSpot account …”), drops the
    stage tiles, and ends with **Done** (closes the dialog). Checklist items may carry numbered
    `steps` (`placementSteps(card, plural)`, additive); opening an item's HubSpot link ticks it
    (it can be unticked); a ticked item folds its instructions; all ticked → “All done”. A new
    publish keeps the one-time ticks but clears “Open a … to see your card”.

### Hosting adapters (all thin, same core)
* `server/node.ts` is the production Node server (`npm start`, `dist-server/node.mjs`, built by
  `scripts/build-server.mjs`):
  * It serves `dist/` with caching, ETags, brotli/gzip, the SPA fallback and security headers.
    COOP is left unset so the popup keeps `window.opener`.
  * `/api` goes to the connector.
  * It prints a start-up log with no secrets. The access log redacts deploy job ids.
  * The client address passed to the core is the socket address, or with `TRUST_PROXY` the
    rightmost `X-Forwarded-For` entry; it injects `proxyFetch: createGuardedFetch()`.
* The other adapters:
  * `api/[...path].ts`: Vercel Edge, with `vercel.json` rewrites.
  * `server/cloudflare.ts`: Workers, with `wrangler.toml`.
  * Docker (`Dockerfile`) and Render (`render.yaml`, health check `/api/health`).
  * `server/hosting.ts`: shared helpers (placeholder env values, a plain health check for
    monitors).
* Setup helpers served from `public/`:
  * `setup.html`: a live readiness check, the exact redirect URL and the connector app file.
  * `secret.html`: makes a `SESSION_SECRET`.
  * `hubspot-connector-app.uiex.json`: the HubSpot app as a builder document, so it can be
    deployed from the builder itself. The CLI version is in `hubspot-app/`.

### Fake HubSpot (`server/fake-hubspot`)
* `createFakeHubSpot()` is an in-memory HubSpot with:
  * an OAuth consent page (Approve / Deny), the token, token-info and revoke endpoints;
  * every CRM endpoint the connector uses, with scope checks and HubSpot-format errors;
  * developer-project endpoints for deploy (`projects.ts`). Keys containing `fail-build`,
    `fail-deploy` and similar markers trigger failures; `FAKE_PERSONAL_ACCESS_KEY` (a realistic
    `CiRuYTEt…` value) always works, and so does the older `LEGACY_FAKE_PERSONAL_ACCESS_KEY`.
  * a demo personal access key page (`/l/personal-access-key`, `/personal-access-key/<portal>`)
    with a Copy button. The connector reports the fake app host as `appBase` in `/api/health`,
    so the builder's links open the fake.
  * the signed-in user is Sam Rivera (not the mock user's name), so live previews visibly change.
  * stand-in pages for the web-app links the “Finish in HubSpot” checklist opens (install the
    app `/static-token/<portal>/authorize`, `/settings/<portal>`, a record
    `/contacts/<portal>/record/<type>/<id>`, a record list `/contacts/<portal>/objects/<type>`,
    the project page `/developer-projects/<portal>/project/<name>`), each saying what the real
    page does — so the demo never ends on an error page.
* The seed is portal 12345678 (acmedemo.com): contacts, companies, deals, tickets, products,
  line items, the custom object `p_projects`, custom properties, pipelines and owners.
* `server/fake-hubspot/server.ts` runs it on a port. `npm run dev:full` and
  `npm run start:demo` use it.
* `server/core/testing.ts` `createTestEnv()` wires the connector to the fake, with a clock,
  a cookie jar and `signIn()`.

### Browser side (`src/connect`)
* **`client.ts`** (`getConnectorClient()`):
  * Its base URL is `VITE_CONNECTOR_URL` or `''` (same origin).
  * The value `none` (`npm run build:static`) disables it: no `/api` call is ever made.
  * Every call sends `credentials: 'include'` and the CSRF header.
  * Errors become `ConnectorError` (`code`, `status`, `requiredScopes`, `retryAfter`). An HTML
    page or a 404 counts as `unavailable`.
  * Catalog GETs are cached per portal (5 minutes), and identical in-flight requests are shared.
* **`store.ts`** (`useConnection`):
  * `init()` sets the status: `checking`, then `unavailable` (no connector), `not-configured`
    (OAuth settings missing), `disconnected` or `connected`.
  * `connect()` opens the centred popup and accepts only the connector origin's message. A
    BroadcastChannel and polling cover a cut-off opener. A blocked popup no longer navigates on
    its own: it settles as `popup_blocked`, and the UI offers **Continue in this tab**
    (`connectInThisTab()`: the full-page sign-in, `?mode=redirect`; after a blocked **Switch
    account** it signs out first, and it quietly drops an open window).
  * `CONNECT_TIMINGS.stillWaitingMs` (30 s): the waiting panel then says "Still waiting for
    HubSpot…" and opens "What does the HubSpot window show?".
  * There are also `disconnect()`, `switchPortal()` and a re-check on window focus. A
    `not_connected` answer marks the sign-in as expired.
  * Nothing sensitive is stored in the browser.
* **`catalog.ts`**: `usePropertyCatalog`, `useObjectTypes`, `usePipelines` and `useOwners`. When
  signed out they return empty data with `connected: false`, so callers fall back to the
  built-in suggestions.
* **`records.ts` / `live.ts`**:
  * `useLiveData` holds the Mock / Live mode and the sample record ids per project
    (localStorage `uiex-builder:live-data:*`, ids only).
  * `buildLiveAdapter` / `useLiveAdapter()` build the `LiveDataAdapter` that `AppShell` passes
    to `RuntimeProvider`. It is `null` in mock mode, when signed out, or while a card has no
    fitting record.
  * Its key is `${portalId}|${objectTypeId}:${recordId}|live` for cards and
    `${portalId}|settings|live` or `${portalId}|home|live` otherwise.
* **`ui/`**:
  * `ConnectButton` (top bar): consent explainer → popup → connected chip → `AccountMenu`.
    When there is no connector it is muted, and a click explains why (it is not
    `aria-disabled`).
  * `RecordPicker` (canvas toolbar): Mock | Live switch and sample-record search. In preview it
    collapses into one chip.
  * `PreviewDataNote` (preview banner).
  * `ConnectDialog` (its consent body is `ConsentDetails`, reused by the guided setup), and
    `connect.css` (`ub-cn-` classes).
  * `host.ts` (`useConnectUiHost`, `setConnectResultsInline`): while the first-run screen runs
    the sign-in itself, the top-bar button shows no result dialog / "Connected" toast (nor its
    waiting panel).
  * **What did HubSpot show?** (`../signInHelp.ts` content, `ui/SignInHelp.tsx`, `ui/CopyNote.tsx`):
    when the window closed or timed out without a result (HubSpot shows install refusals inside its
    window and never redirects back), five choices — Acceptable Use Policy, not allowed to install
    apps, I closed it, it closed by itself, something else — each with the fix, links, **Continue in
    this tab** and a note to copy for whoever set up the builder or a Super Admin. Used by the
    result dialog (`ConnectDialog`'s `TroubleDialog` / `BlockedDialog`), the waiting panel
    (`WaitingPanel`, `useWaitingLong`) and the guided setup's Connect step (`FirstRun.tsx`, which
    also offers **Continue in this tab** for a blocked window and "Still waiting…" help).
    Choosing reports the kind (never the free text) to the status page (`reportSignInFeedback`);
    `ConnectButton` reports `popup_closed` / `timeout` / `popup_blocked`, also for the inline
    sign-in.
  * `AccountMenu` shows **Status page** for admins of the builder (`useStatusAdmin()`).
  * Fix-it buttons: `FriendlyError.actionLabel` / `LiveDataError.actionLabel` name the fix
    (**Reconnect to grant access** for a missing permission, **Reconnect** for an expired
    sign-in); the expired toast offers **Reconnect**; property pickers offer **Reconnect to grant
    access** when `isMissingAccessMessage(error)`; `RecordSearch` takes `offerMock`.
* **Mount points**:
  * `src/shell/TopBar.tsx`: `<ConnectButton />` before Publish.
  * `src/shell/AppShell.tsx`: `init()` once, and `live={useLiveAdapter()}`.
  * `src/canvas/Toolbar.tsx`: `<RecordPicker />` and `<PreviewDataNote />`.

### Live preview runtime (`src/runtime/live.ts`)
* With `live` set, `crmProperties`, `associations` and `crmSearch` sources load from the portal
  through the adapter. Their requests are built from the scope exactly like the generated hook
  config (`buildSearchRequest`).
* `hubspot.fetch` (fetch sources, fetch actions and custom code) goes through `proxyFetch` when
  the connector offers it. App functions keep their mocks.
* Sources start in their first-render state, as on HubSpot. A source waits for the on-open
  sources its request reads, and re-runs (debounced by `RUNTIME_TIMING.liveDebounceMs`) when its
  request changes.
* Stale responses are dropped (per-source counters and a session epoch). A key change reloads
  everything.
* Errors become `<name>Error` plus a console entry that keeps the connector code. A card without
  a record gets `NO_SAMPLE_RECORD_MESSAGE`; settings pages and app home get
  `NO_RECORD_CONTEXT_MESSAGE`.
* `live.context` overrides the portal, the user's email and id, and the record in
  `context`.
* `formatted` on CRM sources may be `true` (all properties) or a list of property names; the list
  maps to HubSpot's `propertiesToFormat` in generated code. Templates format only the deal stage
  (its label) and color stages from `hs_is_closed` / `hs_is_closed_won`, so custom pipelines show
  labels instead of ids.
* **CRM component previews** (`src/preview/liveCrm.tsx`): `RuntimeProvider` wraps the preview in
  a `LiveCrmProvider` built from the adapter. `CrmPropertyList`, `CrmDataHighlight`,
  `CrmStageTracker`, `CrmAssociationTable`, `CrmAssociationPropertyList` and
  `CrmSimpleDeadline` then render the sample record's real values with the portal's labels and
  pipeline stages (answers cached per adapter key). Components that can't be shown from real
  data (reports, pivots, statistics, …) and any failed load show a "Sample values" badge. With
  mock data nothing changes.

### Real-portal pickers (`src/panels`, `src/inspector`)
* `PropertyPicker` is a combobox in single or chip mode. It shows each property's label, internal
  name, type, group and a **Custom** badge, warns about names not found in the portal, and
  suggests near misses.
* `ObjectTypeSelect` offers standard objects plus the portal's custom objects. `portal.ts` holds
  the hooks and pure helpers.
* They are used by:
  * the Data panel: property lists, filters (dropdown and date values) and sorts;
  * the inspector (`PortalFields.tsx`): property-list props of CRM components, the options
    editor's "Import from HubSpot property", the Step indicator's "Use stages from pipeline",
    and CrmStatistics.
* Mock data has "Use a real record as mock data".
* Offline, everything falls back to the built-in suggestions.

### Key check before publishing (`server/core/deploy/keyCheck.ts`)
* `POST /api/deploy/check-key` (`CONNECTOR_ROUTES.deployCheckKey`, `DeployKeyCheckRequest` →
  `DeployKeyCheck`) exchanges the personal access key and returns, without uploading anything:
  the key's account (`DeployKeyAccount`: id, hubName, accountType, `developerProjects` 'yes' | 'no'
  | 'unknown' read from the exchange's scope groups, and a deep link to that account's key page,
  respecting `HUBSPOT_APP_BASE` and EU hosts), the target account (connected, or requested in setup
  mode) and the first `DeployKeyProblem`: `portal_mismatch`, then `portal_not_allowed`, then
  `missing_permission`. Needs a sign-in when sign-in is set up (`not_connected` otherwise); off
  with `ENABLE_DEPLOY=false`; rate limited (`RATE_RULES.keyCheck` per user, `keyCheckSetup` per IP
  before sign-in is set up). Nothing is stored or echoed.
* `startDeploy` shares `exchangeDeployKey` / `keyAccountOf`; every 403 during upload goes through
  `keyRefusal` and becomes a `DeployKeyError` carrying `ConnectorErrorBody.error.key`:
  `missing_scope` (named account, `requiredScopes`), `not_available` (GATED) or `forbidden`
  (HubSpot's own message, Super Admin fix); `portal_mismatch` / `portal_not_allowed` carry the key
  account too.
* Browser: `src/panels/deploy/useKeyCheck.ts` checks a complete-looking key ~700 ms after pasting
  and before Publish when that hasn't happened; each problem gets a callout with the accounts
  involved, **Check again**, and for a missing permission **Publish anyway**. An older server
  without the endpoint (404 / 405) just publishes. `keyAccountFrom` / `keyCheckFrom` sanitise
  server data (http(s) links only); `failureAdvice` covers every publish refusal.
* Fake HubSpot: key modes `gated`, `no-dev-tools`, `other-account`; a second account (87654321
  "Other Co", `FAKE_OTHER_ACCOUNT_KEY`); a key-page form that removes / adds back Developer
  projects (`POST /personal-access-key/<portal>/permissions`, `fakeProjects().setDeveloperProjects`);
  stand-ins of HubSpot's in-window install refusals at `/oauth/authorize/demo-error`.

### Diagnostics / status page (`server/core/diagnostics`, `src/status`)
* Contract: `src/status/types.ts` (types and constants only: `DIAGNOSTICS_ROUTES`,
  `STATUS_PAGE_PATH`, events, snapshot, reports). Routes: `GET /api/admin/access` (who is asking,
  never events), `GET /api/admin/diagnostics` (admins: signed in with HubSpot, grant re-checked,
  email in `ADMIN_EMAILS` or account in `ADMIN_PORTALS`), `POST /api/diagnostics/report`
  (browser errors and `signin_feedback`; CSRF header, ≤ 8 KB, per-visitor and global caps).
* Server: `log.ts` (in-memory ring of 600 events plus per-minute counters for 24 h; one row per
  sign-in / publish updated in place; identical problems from one visitor within 10 minutes merge
  with a count; every event also logged as `[event] {json}`), `observe.ts` (called once per `/api`
  request by `server/core/index.ts` before finalize; never throws; sign-in start / callback matched
  by a hash of the OAuth state; reads failure codes from `X-UIEX-Error-Code`, which failed auth
  pages now send too), `routes.ts`, `access.ts`, `sanitize.ts`, `visitor.ts` (HMAC of the IP with a
  daily in-memory salt, 6 hex characters). Additive: `ServerConfig.adminEmails` / `adminPortals` /
  `buildCommit` (RENDER_GIT_COMMIT, VERCEL_GIT_COMMIT_SHA, CF_PAGES_COMMIT_SHA,
  WORKERS_CI_COMMIT_SHA, GIT_COMMIT), `ConnectorOptions.diagnostics` / `eventLog`,
  `Connector.diagnostics`. Node: one log per process, `LOG_EVENTS`, a 60 s sweeper that concludes
  abandoned sign-ins. Vercel's `vercelEnv()` passes `ADMIN_EMAILS`, `ADMIN_PORTALS` and
  `VERCEL_GIT_COMMIT_SHA`; `scripts/dev.mjs` copies them (and `LOG_EVENTS`) from `.env.local` and
  defaults the fake / demo to `ADMIN_PORTALS=12345678`.
* Browser: `src/main.tsx` lazy-loads `StatusPage` on `/status` (SPA fallback on every host) and
  installs the reporter (`reporter.ts`: window `error` / `unhandledrejection`, `reportReactError`
  — called by `EditorErrorBoundary` — and `reportSignInFeedback`; cleaned, deduplicated,
  throttled, skipped without a connector and for the person's own card code). `explain.ts` turns
  events into host-facing explanations reusing `connect/describe.ts`, `connect/signInHelp.ts` and
  `panels/deploy/model.ts`; `model.ts` groups and ranks "Needs your attention". Dark tokens apply
  only while `/status` is shown.

### Builds and tests
* The build scripts:
  * `npm run build`: app (`dist/`) plus server bundles (`dist-server/node.mjs`,
    `dist-server/fake-hubspot.mjs`).
  * `build:app`: the app only (Vercel, Cloudflare).
  * `build:static`: the app with `VITE_CONNECTOR_URL=none`, for plain static hosting and the
    main e2e suite.
* The tests:
  * Unit and integration: `server/**/*.test.ts` covers the node environment (core, fake,
    adapters, deploy) against the fake HubSpot.
  * `src/connect/**`, `src/runtime/live.test.tsx` and the `*.portal.test.tsx` files cover the
    client side.
  * `e2e-connect/` (`playwright.connect.config.ts`) runs `npm run build:app &&
    node scripts/dev.mjs --fake --prod` on :4175, with the fake on :4011. It covers sign-in,
    the sample record with live properties and associations, the custom-property picker,
    disconnect, deploy (success, failed build, wrong key), the unavailable / not-configured
    states, HubSpot saying no (`trouble.spec.ts`: install refusals, blocked window, key without
    Developer projects, other account, 403) and the status page (`status.spec.ts`).
    `CONNECT_SCREENSHOTS=<dir>` saves screenshots of the main screens.

## 9. First-run experience (`src/onboarding`)

For a brand-new, non-technical HubSpot admin opening the hosted builder.

* **Cold start**: `index.html` puts a pure HTML/CSS “Waking up the builder…” splash inside
  `#root` (a note fades in after 4 s, a reload hint after 45 s); React replaces it on mount.
* **When the welcome shows** (`store.ts`, decided once before the first paint by `initFirstRun()`
  in `App`, skipped on the recovery screen): on a first visit only — never once completed or
  skipped (`uiex-builder:first-run` = `{ v, status: 'completed' | 'skipped', at }`), nor for
  returning users (old `uiex-builder:welcome-dismissed`, or any saved project). `?welcome=1` /
  `?welcome=0` force it. **Help › Getting started** reopens it (`useOnboarding.reopen()`).
* **`FirstRun`** (full window, `role="dialog"`, `data-uiex-exclusive` — the editor behind it is
  `inert` + `aria-hidden` via `AppShell`, and global shortcuts / the command palette stay off):
  * Welcome: one-line promise; **Connect my HubSpot** (recommended; `aria-disabled` with a
    one-line reason while checking / without a connector / sign-in not set up / server error),
    **Try it with sample data**, and “I know what I’m doing → open the editor” (skipped, no tour).
  * Guided setup (`SETUP_STEPS`: HubSpot `connect → where → start`, sample `where → start`),
    progress dots, Back / Next / Skip setup, focus moves to each step's heading:
    1. Connect — `ConsentDetails` in place, the existing popup flow (`useConnection.connect()`),
       waiting / failure / “Connected to <portal>” shown in place (`setConnectResultsInline`).
    2. Where — record type (standard four, plus the portal's custom objects by label when
       connected; native radio cards) and place on the page with small illustrations
       (`illustrations.tsx`): middle of the record page = `crm.record.tab`, right sidebar =
       `crm.record.sidebar`, preview panel = `crm.preview`, help desk = `helpdesk.sidebar`
       (tickets only).
    3. Start — `RecordSearch` for a real sample record (optional) and the “Start from…” gallery
       (`starters.ts` `startersFor`): **<Type> details** first (a heading + DescriptionList of
       up to six properties, `formatted: true`; from the portal's schema when connected —
       labels, custom properties first-class — else standard presets), then the ready-made cards
       for that type whose components fit the place and that need no external setup (no fetch /
       app functions; friendlier descriptions), then **Blank card**. Every starter gets the
       chosen `location` and `objectTypes`.
  * `finishSetup()` (`finish.ts`): replaces the untouched starter project
    (`shell/persistence.isUntouchedStarterProject`; its saved copy, if choosing live data saved
    it, is deleted) or saves real work first; creates the project “My HubSpot Cards” with the
    card; sets live data (`useLiveData`: mode live + the sample record when connected, else
    mock); leaves the selection empty (the inspector shows the card's settings in plain words and
    a palette click adds to the end of the card); records `completed`; starts the tour.
  * Step 3 picks the most recently updated record by itself when connected (once per record type
    and visit, `autoPickedRecordTypes`), so the card previews real data by default; **Change**
    opens the search. The keyboard-active row of `RecordSearch` only shows its focus ring while
    the search has focus (it looked already picked).
* **`Tour`** (4 coach marks: palette, inspector, preview data / Design-Preview, Publish), anchored
  to `data-tour="palette" | "inspector" | "preview-data" | "preview-mode" | "publish"`, placed by
  the pure `placeTour()` (beside tall sidebars it points at their lower part, so the tip sits
  next to the canvas below the card instead of over it); non-blocking (no backdrop, `aria-modal="false"`,
  `data-uiex-nonblocking` so `isOverlayOpen()` ignores it); Next / Skip tour / Escape; replay
  from **Help › Take the tour**; `uiex-builder:tour` remembers done / skipped.
* **Plain language**: “Publish” instead of Deploy / Export in the UI, “card” / “cards and pages”
  instead of extension(s), “Card Builder” in the top bar, uid only under the inspector's
  “Advanced: project files” with an explanation. Code / Problems / Console start collapsed
  (`ShellLayout.bottomOpen` false) and the choice is remembered.

### Contract changes (first-run work, all additive unless noted)
* `src/connect/ui`: `ConsentDetails`, `useConnectUiHost`, `setConnectResultsInline`;
  `RecordSearchProps.offerMock`; `data-tour="preview-data"` on the live-data controls.
* `src/connect/describe.ts`: `FriendlyError.actionLabel`, `isMissingAccessMessage()`;
  `src/connect/records.ts`: `LiveDataError.actionLabel`.
* `src/panels/deploy/model.ts`: `hubspotOrigin`, `WIZARD_STEPS`, `publishChecklist`,
  `placementInstructions`, `failureAdvice`, `ChecklistItem`, `ChecklistContext`;
  `deploy/checklist.ts` (new). `DEPLOY_STEPS` labels changed (Going live / Published).
* `src/shell/persistence.ts`: `isUntouchedStarterProject()`. `src/shell/shortcuts.ts`:
  `isOverlayOpen()` ignores `[data-uiex-nonblocking]`. `useAnchoredMenu`: only a press outside
  the menu swallows the next click on the trigger (choosing an item no longer does).
* **Removed**: `WelcomeCard` (and its export from `src/shell/index.ts`), replaced by
  `src/onboarding`.

### Contract changes (usability pass, all additive unless noted)
* `src/templates/catalog.ts`: `BlockTemplate.create?`, `BuiltBlock`; `src/templates/actions.ts`:
  `prepareBlock()`, `insertBlock(…, at?, dataSources?)`; `src/dnd/dragState.ts`: the template
  `DragPayload` carries `dataSources?`; `isFullWidthComponent()`, `isSideBySide()`, `mainColumn()`
  (exported helpers of `smartInsertTarget`, whose targets changed as described in §6b).
* `src/power/commands.ts`: `PaletteBlock.create?`.
* `src/shell/shellStore.ts`: `requestPaletteFocus(query?)`, `paletteFocusQuery`,
  `focusPaletteSearch(query?)` (Templates › “No blocks match” offers **Search components for …**).
* `src/panels/deploy/model.ts`: `ChecklistItem.steps?`, `placementSteps()`, `phaseMessage()`;
  checklist card items now have a short `body` plus `steps` (was one long `body`).
* `src/onboarding/store.ts`: `autoPickedRecordTypes`. `finishSetup()` no longer selects a node.
* `src/registry/components/crm.tsx`: `objectTypeId` props are labelled **Record type** (association
  components: **Associated records**); the Association table's description says HubSpot shows its
  loading and “none yet” states.
* `src/templates/projectTemplates.ts`: the Contact summary starter reads named computed values
  (`fullName`, `jobLine`, `lifecycleStage`, `lifecycleColor`, `leadStatus`, `cityAndCountry`);
  unknown lifecycle stages / lead statuses show the stored value instead of “none”.
* `src/panels/generators.ts`: the generated “none yet” empty state uses `imageWidth: 120`.
* `server/fake-hubspot/handler.ts`: demo stand-in pages (see Fake HubSpot).
* Copy: the design-mode flag reads **Hidden right now** (was “Hidden by condition”); the
  inspector's “Advanced: project files” section starts collapsed.

### Contract changes (editor ease of use, all additive unless noted)
* `src/registry/types.ts`: `EnumOption.swatch` (`OptionSwatch { fill, border?, text? }`), an enum
  `PropType` `display?: 'spacing' | 'direction'`, `ComponentDef.groupOrder?: PropGroup[]`,
  `ComponentDef.tips?: ComponentTip[]` and `TipAction` (`rules` | `data` | `event` | `condition` |
  `repeat` | `binding` | `overlay`). `src/registry/constants.ts`: `HS_SWATCH` and plain labels on
  the shared size / justify / align option lists. HubSpot prop names, enum values and the order of
  props (codegen emits them in definition order) are unchanged; only labels, descriptions, groups
  and inspector-only metadata changed. Flex is labelled **Layout box** and Inline **Inline row**
  (types unchanged).
* `src/dnd/dragState.ts`: `BlockAnchor`, `setBlockAnchor()`, `getBlockAnchor()`;
  `smartInsertTarget` puts the next click-to-add after a just-inserted block while its main
  component is still selected (the anchor clears when the selection changes).
* `src/templates/actions.ts`: `insertBlock` selects `mainComponentOf(ext, rootId)` (the progress
  bar of *Progress tracker*, the table of *Associated records* …; a wrapper of only layout and text
  stays selected). Its return value is still the block root id; the toast names the selected part.
* Inspector: `InspectorSection.forceOpen`; new modules `nodeHints.ts` (what each child does, for
  the **Inside this …** list), `tips.ts` (**You can also**), `settingsFilter.ts` (**Filter
  settings**, 8+ settings; `/` focuses it from anywhere in the inspector except text fields),
  `requests.ts` (`usePropRequests`, `revealInInspector`: tips open Rules / fx / Events /
  Advanced at the right place) and `prefs.ts` (localStorage `uiex-builder:inspector-help`, the
  "Hide help text under settings" choice). `PropertiesTab` exports `focusSettingsFilter`,
  `hasSettingsFilter`, `componentGroupOrder`, `insideTitle`, `runTip`; `PropRow` exports
  `propNameHint`. Setting rows show the exact prop name when it differs from the label, help text
  linked with `aria-describedby`, and the fx / Rules / reset icons at 60% until hovered or focused.
  Visual enum choices are native radio groups (swatches, spacing samples, direction arrows).
* Canvas: a selected container draws `data-testid="canvas-child-outline"` around each direct child
  and its chip reads "· N inside". The children section is **Inside this …** with **Add inside**.

### Contract changes (integration of the four areas, 2026-10-18)
* `src/model/store.ts`: `removeNodes(ids)`; `src/shell/actions.ts`: `removeNodesSafe(ids, notify)`.
* `src/shell/shortcuts.ts`: `SHORTCUTS` gains `copySettings` (Alt+Cmd+C), `pasteSettings`
  (Alt+Cmd+V) and `multiSelect` (Shift+Click, documentation only); `delete` and `selectParent`
  descriptions mention multi-selection.
* `src/shell/LayersPanel.tsx`: `RowProps.onClick(row, event)`; only the focusable (primary) row is
  a tab stop.
* `server/core/rateLimit.ts`: `RATE_RULES.keyCheck` / `keyCheckSetup`; `RateRule.bucket` — sign-in
  start and callback now count in their own buckets (they shared one, so every sign-in used up two
  of the 20 attempts per address; the connector e2e suite ran into it). `server/core/authPage.ts`:
  failure pages send `X-UIEX-Error-Code`.
* `src/power/shape.ts`: `SortAs` gains `'formatted'`; `src/power/ShapeEditor.tsx`:
  `fieldDisplayLabel()`. `src/inspector/power-actionRules.tsx`: `RulesRowProps.start`.
* Not done (optional, noted in STATUS.md): Rules on a status text based on a sibling progress
  bar's percentage (`ruleSubjectsFor` stays per node: a copied bar expression would not follow
  later changes of the bar); the empty-container placeholder still says "Drop components here".

### Contract changes (review fixes, 2026-10-18, all additive unless noted)
* `src/registry/types.ts`: `ComponentDef.identityProps` — props that identify a component among its
  siblings (Tab `tabId`, StatisticsItem `id`). `src/model/settings.ts` `identityProps()` includes
  them, so Copy / Paste settings and multi-edit never copy or change them.
* `src/inspector/power-conditions.ts`: `strictSubjectType` (a subject's type as the exported card's
  TypeScript sees it), `subjectMayBeNull`, `literalTypeMismatch` / `rawComparisonMismatch` /
  `expectedLiteralText` (what a fixed value must be to compile), `literalComparisons(code)` (every
  whole `ref op literal` comparison in an expression), `carryValue`, `savableCondition`. Changed:
  `clauseProblem` also reports what the type-check refuses; text thresholds are written
  `String(S ?? "") > "x"` (recognised again), so a value that may be null still compiles.
  `ConditionBuilder` saves a check only once its value fits (like a check still being chosen).
* `src/model/validate.ts`: rule `condition-type` (error) — any expression (Show when, If, Rules,
  props, templates, action values) that compares a typed value with a fixed value of another type,
  or a value that starts empty with more / less than. `CodeChecker.types`. Its accuracy is pinned by
  two type-check matrices in `src/codegen/powerUser.test.ts`.
* Status page: `POST /api/diagnostics/report` needs a trusted `Origin` header;
  `cleanClientError(raw, keepOrigins)` replaces links outside the builder with `[link]` and keeps
  only plain page paths. `DiagnosticsLog`: browser reports live in their own buffer
  (`clientCapacity`, 100); after 5 distinct rows per visitor / 30 overall per hour the rest are
  counted in one `client.overflow` row (`MORE_CLIENT_REPORTS`); at most 500 sign-ins are followed
  (`maxPendingSignIns`); an unanswered sign-in whose row is gone is only counted, and one visitor's
  close together are one row with a count; a visitor's changed answer replaces the last one within
  5 minutes (the browser's own `popup_closed` / `timeout` never do). `ClientErrorDetails.overflow`,
  `Explanation.unverified` ("Reported by a browser · not verified"; ranked with weight 1).
  `SignInHelp` reports the settled answer (`SIGN_IN_FEEDBACK_SETTLE_MS`, or at once when the person
  acts on the fix or the help closes). The "Updated …" line is no longer a live region.
* Canvas: the floating toolbar's trash button deletes every selected component
  (`removeNodesSafe`) and says **Delete N selected**.

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
  `/e2e-connect` (production server + fake HubSpot, `npm run e2e:connect`). Vitest globals are
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
    ENABLE_FETCH_PROXY, ENABLE_DEPLOY, ALLOWED_ORIGINS and NODE_ENV;
  * `createConnector(config, options?).handle(request)`, which returns `null` for non-`/api`
    paths so an adapter can serve static files instead.
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
  * The session is the cookie `uiex_session`: AES-256-GCM, with a key derived by HKDF from
    `SESSION_SECRET`, the cookie name bound as additional data and a server-checked expiry.
    It is HttpOnly, SameSite=Lax, Secure on https, Max-Age 30 days and at most 4 KB. There is
    no database.
  * The single-use OAuth `state` lives in `uiex_oauth` (Path=/api/auth, 10 minutes).
  * A tampered, expired or old-secret cookie reads as signed out.
* **Security** (`security.ts`):
  * `X-UIEX-Request` is required on every route except `auth/start`, `auth/callback` and the
    health check.
  * `Origin` must be `APP_URL` or one of `ALLOWED_ORIGINS`, and CORS answers only those.
  * `returnTo` is validated, so there are no open redirects.
  * Every `/api` response has `Cache-Control: no-store`, nosniff, `X-Frame-Options: DENY` and
    no-referrer.
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
    record-picker search, a record (`formatted=1` gives en-US / UTC display values), associations
    (v4 plus batch read) and a validated CRM search passthrough.
  * `routes/proxy.ts`: preview `hubspot.fetch` through `ssrf.ts`. It allows https only, blocks
    private, loopback and metadata hosts, follows at most 3 redirects (each re-checked), times
    out after 10 s and caps responses at 1 MB.
  * `routes/deploy.ts`: see below.
* **Deploy to HubSpot (beta)** (`server/core/deploy/**`, `src/panels/deploy/**`):
  * The personal access key is exchanged for a short-lived token; the project is found or
    created, zipped (`zip.ts`, HubSpot's ignore rules) and uploaded with the project IR
    (`ir.ts`, platform 2025.2 and later).
  * Build and deploy are followed one step per `GET /api/deploy/:deployId`. The deployId is an
    encrypted job token that never holds the key.
  * The key is stored (in the session cookie) only when the admin ticks **Remember on this
    browser**.
  * Deploy works without OAuth sign-in; `features.deploy` needs only a usable `SESSION_SECRET`.
  * Without a connector, the panel falls back to the CLI steps.

### Hosting adapters (all thin, same core)
* `server/node.ts` is the production Node server (`npm start`, `dist-server/node.mjs`, built by
  `scripts/build-server.mjs`):
  * It serves `dist/` with caching, ETags, brotli/gzip, the SPA fallback and security headers.
    COOP is left unset so the popup keeps `window.opener`.
  * `/api` goes to the connector.
  * It prints a start-up log with no secrets.
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
    `fail-deploy` and similar markers trigger failures; `FAKE_PERSONAL_ACCESS_KEY` always works.
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
    BroadcastChannel and polling cover a cut-off opener. A blocked popup falls back to a
    full-page redirect.
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
  * `ConnectDialog`, and `connect.css` (`ub-cn-` classes).
* **Mount points**:
  * `src/shell/TopBar.tsx`: `<ConnectButton />` before Export.
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
    disconnect, deploy (success, failed build, wrong key) and the unavailable / not-configured
    states. `CONNECT_SCREENSHOTS=<dir>` saves screenshots of the main screens.

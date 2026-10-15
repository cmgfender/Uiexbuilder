/**
 * Per-extension generation context: import collection, identifier allocation, helper usage and
 * the extension's scope (state variables, data sources) used to analyse user code.
 */
import type { AppFunction, ComputedValue, DataSource, Extension, ExtensionLocation, Project, StateVar } from '../model/types';
import { helperNames } from '../power/helpers';
import { extensionLocation } from '../model/rules';
import { isIdentifierName, scanCode } from './printer';

export const UI_EXTENSIONS = '@hubspot/ui-extensions';
export const UI_EXTENSIONS_CRM = '@hubspot/ui-extensions/crm';

export type ImportSource = 'react' | typeof UI_EXTENSIONS | typeof UI_EXTENSIONS_CRM;

/** Collects named imports per module (values and types separately). */
export class ImportSet {
  /** Imported name -> local identifier (differs when the import is aliased). */
  private readonly values = new Map<ImportSource, Map<string, string>>();
  private readonly types = new Map<ImportSource, Set<string>>();

  /** Imports `name` from `source` as `local` (defaults to the name itself). Idempotent. */
  add(source: ImportSource, name: string, local = name): void {
    if (!this.values.has(source)) this.values.set(source, new Map());
    const names = this.values.get(source)!;
    if (!names.has(name)) names.set(name, local);
  }

  addType(source: ImportSource, name: string): void {
    if (!this.types.has(source)) this.types.set(source, new Set());
    this.types.get(source)!.add(name);
  }

  has(source: ImportSource, name: string): boolean {
    return this.values.get(source)?.has(name) ?? false;
  }

  /** The local identifier of an imported value, or undefined when it is not imported. */
  localName(source: ImportSource, name: string): string | undefined {
    return this.values.get(source)?.get(name);
  }

  /** Every local identifier of imported values (used to avoid identifier collisions). */
  allValueNames(): Set<string> {
    const out = new Set<string>();
    for (const names of this.values.values()) names.forEach((local) => out.add(local));
    return out;
  }

  /** Import statements in a stable order: react, @hubspot/ui-extensions (values, types), /crm. */
  print(): string[] {
    const order: ImportSource[] = ['react', UI_EXTENSIONS, UI_EXTENSIONS_CRM];
    const lines: string[] = [];
    for (const source of order) {
      const values = this.values.get(source);
      if (values?.size) {
        const specifiers = sortNames([...values.keys()]).map((name) => {
          const local = values.get(name)!;
          return local === name ? name : `${name} as ${local}`;
        });
        lines.push(...printImport(specifiers, source, false));
      }
      const types = this.types.get(source);
      if (types?.size) lines.push(...printImport(sortNames([...types]), source, true));
    }
    return lines;
  }
}

/** Case-insensitive, then case-sensitive ordering (Button, Flex, hubspot, logger, Text). */
export function sortNames(names: string[]): string[] {
  return names.sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function printImport(names: string[], source: string, typeOnly: boolean): string[] {
  const head = typeOnly ? 'import type' : 'import';
  const single = `${head} { ${names.join(', ')} } from '${source}';`;
  if (single.length <= 80) return [single];
  return [`${head} {`, ...names.map((n) => `  ${n},`), `} from '${source}';`];
}

/** Allocates unique identifiers that never collide with user scope names or imports. */
export class NameAllocator {
  private readonly taken: Set<string>;

  constructor(reserved: Iterable<string>) {
    this.taken = new Set(reserved);
  }

  reserve(name: string): void {
    this.taken.add(name);
  }

  isTaken(name: string): boolean {
    return this.taken.has(name);
  }

  /** `base`, or `base2`, `base3`, ... — whichever is free first. Reserves the result. */
  allocate(base: string): string {
    let name = isIdentifierName(base) ? base : `_${base.replace(/[^A-Za-z0-9_$]/g, '')}`;
    if (!isIdentifierName(name)) name = 'value';
    let candidate = name;
    let i = 2;
    while (this.taken.has(candidate)) candidate = `${name}${i++}`;
    this.taken.add(candidate);
    return candidate;
  }

  /** A child allocator that starts with everything taken here (for handler-local names). */
  fork(): NameAllocator {
    return new NameAllocator(this.taken);
  }
}

/** Module-level helpers generated code can use (declared once, only when used). */
export type HelperName = 'toText' | 'asArray' | 'readJson';

/** How a data source is exposed in generated code. */
export interface DataSourcePlan {
  source: DataSource;
  /** Expression that re-runs the source and returns a promise, e.g. `contactQuery.refetch()`. */
  rerunCall: string;
  /** Internal identifiers declared for the source (query variable / loader). */
  queryVar?: string;
  loaderName?: string;
  /** Component-scope identifiers the source exposes (`x`, `xLoading`, `xError`). */
  exposes: string[];
}

export interface GenContext {
  project: Project;
  ext: Extension;
  location: ExtensionLocation;
  /** CRM record locations get CrmHostActions (refreshObjectProperties, ...). */
  isCrm: boolean;
  imports: ImportSet;
  names: NameAllocator;
  /** Valid state variables by name. */
  states: Map<string, StateVar>;
  /** Data sources (with valid identifiers) by id. */
  dataSources: Map<string, DataSourcePlan>;
  functions: Map<string, AppFunction>;
  /** Identifiers declared at component scope that user code may reference (for hook deps). */
  componentScope: Set<string>;
  /** Free identifiers referenced by user code anywhere (context, actions, logger, ...). */
  referenced: Set<string>;
  /** Every identifier that appears in the extension's user code (computed up front). */
  userIdentifiers: Set<string>;
  /** The generated code uses `any` (adds an eslint-disable comment for no-explicit-any). */
  usesAny: boolean;
  /** State setters the generated code calls (unused setters are not destructured). */
  usedSetters: Set<string>;
  /**
   * Names the document declares inside the component (state, setters, data source names, repeat
   * variables, handler params). Module-level identifiers with these names (imports, helpers)
   * would be shadowed, so they are referenced through an alias instead.
   */
  shadowed: Set<string>;
  /** Module-level helpers that are used, with their local names (renamed when shadowed). */
  helperNames: Map<HelperName, string>;
  /** Computed values that are declared (valid, non-conflicting names), in order. See planComputed. */
  computed: ComputedValue[];
  /** The extension's helper code (Extension.helpers) and the top-level names it declares. */
  userHelpers: { code: string; names: string[] };
}

export const CRM_LOCATIONS: ReadonlySet<ExtensionLocation> = new Set([
  'crm.record.tab',
  'crm.record.sidebar',
  'crm.preview',
  'helpdesk.sidebar',
]);

export function setterName(stateName: string): string {
  return `set${stateName.charAt(0).toUpperCase()}${stateName.slice(1)}`;
}

/** The setter of a user state variable, recorded as used (see GenContext.usedSetters). */
export function stateSetter(ctx: GenContext, stateName: string): string {
  const name = setterName(stateName);
  ctx.usedSetters.add(name);
  return name;
}

/**
 * `useState` type argument of a state variable. Primitive states keep their type (`| null` when
 * the initial value is null); arrays are `any[]`; objects and `any` are `any` so they can feed
 * typed props such as a DateInput value (a `Record<string, any>` is not assignable to
 * `{ year; month; date }`).
 */
export function stateTypeArg(s: StateVar): string {
  const initial = s.initial;
  switch (s.type) {
    case 'string':
    case 'number':
    case 'boolean':
      if (initial === null) return `${s.type} | null`;
      return typeof initial === s.type ? s.type : 'any';
    case 'array':
      return Array.isArray(initial) ? 'any[]' : 'any';
    default:
      return 'any';
  }
}

export function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Names that generated module-level code / imports use and user code must not shadow. */
export const BASE_RESERVED = [
  'React',
  'useState',
  'useEffect',
  'useCallback',
  'useMemo',
  'useCrmProperties',
  'useAssociations',
  'useCrmSearch',
  'hubspot',
  'logger',
  'context',
  'actions',
  'toText',
  'asArray',
  'readJson',
  'useRef',
  'ExtensionProps',
  'undefined',
  'NaN',
  'Infinity',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'JSON',
  'Error',
  'Promise',
  'Math',
  'Date',
];

/** Parameters of every extension component; document names cannot redeclare them. */
export const COMPONENT_PARAMS: readonly string[] = ['context', 'actions'];

/**
 * Names declared at component scope by the valid state variables (value + setter), plus the
 * component parameters. Used to drop document entries that would redeclare a name.
 */
export function declaredStateNames(states: Iterable<StateVar>): Set<string> {
  const declared = new Set<string>(COMPONENT_PARAMS);
  for (const s of states) {
    declared.add(s.name);
    declared.add(setterName(s.name));
  }
  return declared;
}

export function createContext(project: Project, ext: Extension): GenContext {
  const location = extensionLocation(ext);
  const states = new Map<string, StateVar>();
  const declared = new Set<string>(COMPONENT_PARAMS);
  for (const s of Array.isArray(ext.state) ? ext.state : []) {
    if (!s || !isIdentifierName(s.name)) continue;
    // Skip entries that would redeclare a name (duplicates, `count` + `setCount`, `context`).
    const setter = setterName(s.name);
    if (declared.has(s.name) || declared.has(setter)) continue;
    declared.add(s.name);
    declared.add(setter);
    states.set(s.name, s);
  }
  const functions = new Map((Array.isArray(project.functions) ? project.functions : []).map((f) => [f.id, f]));
  const helperCode = typeof ext.helpers === 'string' ? ext.helpers : '';
  return {
    project,
    ext,
    location,
    isCrm: CRM_LOCATIONS.has(location),
    imports: new ImportSet(),
    names: new NameAllocator(BASE_RESERVED),
    states,
    dataSources: new Map(),
    functions,
    componentScope: new Set(['context']),
    referenced: new Set(),
    userIdentifiers: new Set(),
    usesAny: false,
    usedSetters: new Set(),
    shadowed: new Set(),
    helperNames: new Map(),
    computed: [],
    userHelpers: { code: helperCode, names: helperNames(helperCode) },
  };
}

/** Base for an alias of a shadowed import: `TextComponent`, `useCrmSearchHook`, `hubspotApi`. */
function aliasBase(name: string): string {
  if (/^use[A-Z]/.test(name)) return `${name}Hook`;
  if (/^[A-Z]/.test(name)) return `${name}Component`;
  return `${name}Api`;
}

/**
 * Imports `name` from `source` and returns the identifier generated code must use for it: the
 * name itself, or a unique alias (`import { Text as TextComponent }`) when the document declares
 * the same name inside the component.
 */
export function importValue(ctx: GenContext, source: ImportSource, name: string): string {
  const existing = ctx.imports.localName(source, name);
  if (existing) return existing;
  const local = ctx.shadowed.has(name) ? ctx.names.allocate(aliasBase(name)) : name;
  ctx.imports.add(source, name, local);
  return local;
}

/** Marks a module-level helper as used and returns its (possibly renamed) identifier. */
export function useHelper(ctx: GenContext, helper: HelperName): string {
  let local = ctx.helperNames.get(helper);
  if (!local) {
    // The default name is reserved up front (BASE_RESERVED), so allocate() yields e.g. `toText2`.
    local = ctx.shadowed.has(helper) ? ctx.names.allocate(helper) : helper;
    ctx.helperNames.set(helper, local);
  }
  return local;
}

/** Records the free identifiers of a user code fragment (for `context` / `actions` / imports). */
export function noteUserCode(ctx: GenContext, code: string): Set<string> {
  const ids = scanCode(code).identifiers;
  ids.forEach((id) => ctx.referenced.add(id));
  // User code may call the interpolation helper `toText` (available in the preview too) — emit it,
  // under its own name, unless the document declares a `toText` of its own.
  if (ids.has('toText') && !ctx.shadowed.has('toText')) useHelper(ctx, 'toText');
  return ids;
}

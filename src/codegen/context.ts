/**
 * Per-extension generation context: import collection, identifier allocation, helper usage and
 * the extension's scope (state variables, data sources) used to analyse user code.
 */
import type { AppFunction, DataSource, Extension, ExtensionLocation, Project, StateVar } from '../model/types';
import { extensionLocation } from '../model/rules';
import { isIdentifierName, scanCode } from './printer';

export const UI_EXTENSIONS = '@hubspot/ui-extensions';
export const UI_EXTENSIONS_CRM = '@hubspot/ui-extensions/crm';

export type ImportSource = 'react' | typeof UI_EXTENSIONS | typeof UI_EXTENSIONS_CRM;

/** Collects named imports per module (values and types separately). */
export class ImportSet {
  private readonly values = new Map<ImportSource, Set<string>>();
  private readonly types = new Map<ImportSource, Set<string>>();

  add(source: ImportSource, name: string): void {
    if (!this.values.has(source)) this.values.set(source, new Set());
    this.values.get(source)!.add(name);
  }

  addType(source: ImportSource, name: string): void {
    if (!this.types.has(source)) this.types.set(source, new Set());
    this.types.get(source)!.add(name);
  }

  has(source: ImportSource, name: string): boolean {
    return this.values.get(source)?.has(name) ?? false;
  }

  /** Every imported value name (used to avoid identifier collisions). */
  allValueNames(): Set<string> {
    const out = new Set<string>();
    for (const names of this.values.values()) names.forEach((n) => out.add(n));
    return out;
  }

  /** Import statements in a stable order: react, @hubspot/ui-extensions (values, types), /crm. */
  print(): string[] {
    const order: ImportSource[] = ['react', UI_EXTENSIONS, UI_EXTENSIONS_CRM];
    const lines: string[] = [];
    for (const source of order) {
      const values = this.values.get(source);
      if (values?.size) lines.push(...printImport(sortNames([...values]), source, false));
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

export type HelperName = 'toText' | 'asArray';

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
  helpers: Set<HelperName>;
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

export function createContext(project: Project, ext: Extension): GenContext {
  const location = extensionLocation(ext);
  const states = new Map<string, StateVar>();
  for (const s of Array.isArray(ext.state) ? ext.state : []) {
    if (s && isIdentifierName(s.name) && !states.has(s.name)) states.set(s.name, s);
  }
  const functions = new Map((Array.isArray(project.functions) ? project.functions : []).map((f) => [f.id, f]));
  return {
    project,
    ext,
    location,
    isCrm: CRM_LOCATIONS.has(location),
    imports: new ImportSet(),
    helpers: new Set(),
    names: new NameAllocator(BASE_RESERVED),
    states,
    dataSources: new Map(),
    functions,
    componentScope: new Set(['context']),
    referenced: new Set(),
    userIdentifiers: new Set(),
    usesAny: false,
  };
}

/** Records the free identifiers of a user code fragment (for `context` / `actions` / imports). */
export function noteUserCode(ctx: GenContext, code: string): Set<string> {
  const ids = scanCode(code).identifiers;
  ids.forEach((id) => ctx.referenced.add(id));
  return ids;
}

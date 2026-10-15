import { newId, toPascalCase, toUid, uniqueName } from './ids';
import { instantiateTemplate } from './tree';
import type {
  AppConfig,
  AppFunction,
  CardLocation,
  Extension,
  ExtensionKind,
  NodeTemplate,
  PreviewMockData,
  Project,
  UINode,
} from './types';
import { ROOT_TYPE } from './types';

export const DEFAULT_PLATFORM_VERSION = '2026.03' as const;

export function defaultMockData(): PreviewMockData {
  return {
    context: {
      user: { id: 1001, email: 'jordan.lee@example.com', firstName: 'Jordan', lastName: 'Lee', locale: 'en-us' },
      portal: { id: 12345678, timezone: 'America/New_York' },
      crm: { objectId: 51, objectTypeId: '0-1' },
    },
    properties: {
      hs_object_id: '51',
      firstname: 'Ada',
      lastname: 'Lovelace',
      email: 'ada@analytical.example',
      phone: '+1 (555) 010-2030',
      company: 'Analytical Engines Ltd',
      jobtitle: 'Head of Computation',
      lifecyclestage: 'customer',
      hs_lead_status: 'OPEN',
      city: 'London',
      country: 'United Kingdom',
      createdate: '2026-01-14T10:00:00.000Z',
      dealname: 'Difference Engine Expansion',
      amount: '125000',
      dealstage: 'contractsent',
      closedate: '2026-12-01T00:00:00.000Z',
      name: 'Analytical Engines Ltd',
      domain: 'analytical.example',
      industry: 'COMPUTER_SOFTWARE',
      numberofemployees: '120',
      subject: 'Calibration issue on unit #12',
      hs_pipeline_stage: '1',
      hs_ticket_priority: 'HIGH',
    },
    dataSources: {},
    functions: {},
  };
}

export function defaultAppConfig(name = 'My UI Extensions App'): AppConfig {
  return {
    uid: toUid(name, 'my_app'),
    name,
    description: 'Built with UI Extension Builder.',
    distribution: 'private',
    authType: 'static',
    redirectUrls: [],
    requiredScopes: ['oauth', 'crm.objects.contacts.read'],
    optionalScopes: [],
    conditionallyRequiredScopes: [],
    permittedUrls: { fetch: [], iframe: [], img: [] },
    support: {
      supportEmail: 'support@example.com',
      documentationUrl: 'https://example.com/docs',
      supportUrl: 'https://example.com/support',
      supportPhone: '+18005555555',
    },
  };
}

function rootNode(): UINode {
  return { id: newId('n'), type: ROOT_TYPE, props: {}, children: [] };
}

export interface CreateExtensionOptions {
  kind?: ExtensionKind;
  name?: string;
  location?: CardLocation;
  objectTypes?: string[];
  /** Top-level elements to start with. */
  content?: NodeTemplate[];
  /** Existing extensions, used to keep uid / fileName unique. */
  existing?: Extension[];
}

export function createExtension(opts: CreateExtensionOptions = {}): Extension {
  const kind = opts.kind ?? 'card';
  const defaultName = kind === 'settings' ? 'Settings' : kind === 'home' ? 'App Home' : 'New Card';
  const name = opts.name ?? defaultName;
  const existing = opts.existing ?? [];
  const uid = uniqueName(
    toUid(kind === 'card' ? `${name}_card` : `${name}`, kind),
    existing.map((e) => e.uid),
  );
  const fileName = uniqueName(
    toPascalCase(kind === 'card' && !/card$/i.test(name) ? `${name} Card` : name),
    existing.map((e) => e.fileName),
  );
  const root = rootNode();
  const ext: Extension = {
    id: newId('e'),
    kind,
    uid,
    name,
    description: '',
    fileName,
    location: opts.location ?? 'crm.record.tab',
    objectTypes: opts.objectTypes ?? ['contacts'],
    state: [],
    dataSources: [],
    rootId: root.id,
    nodes: { [root.id]: root },
    mock: defaultMockData(),
  };
  for (const tpl of opts.content ?? []) {
    const sub = instantiateTemplate(tpl);
    Object.assign(ext.nodes, sub.nodes);
    root.children.push(sub.rootId);
  }
  return ext;
}

export const DEFAULT_FUNCTION_CODE = `// HubSpot app function (runs server-side on HubSpot's infrastructure).
// Called from a card with: hubspot.serverless('<uid>', { parameters: { ... } })
// \`context.parameters\` holds the parameters sent by the card.
// Secrets listed in secretKeys are available on process.env.

exports.main = async (context = {}) => {
  const { parameters = {} } = context;
  return {
    message: \`Hello from the server, \${parameters.name ?? 'friend'}!\`,
    receivedAt: new Date().toISOString(),
  };
};
`;

export function createAppFunction(existing: AppFunction[] = [], name = 'myFunction'): AppFunction {
  const fileName = uniqueName(name, existing.map((f) => f.fileName));
  const uid = uniqueName(toUid(fileName, 'function'), existing.map((f) => f.uid));
  return { id: newId('f'), uid, fileName, code: DEFAULT_FUNCTION_CODE, secretKeys: [] };
}

/** hsproject.json name: lowercase words joined by dashes, e.g. "My App" -> "my-app". */
export function toProjectSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'my-project'
  );
}

export function createProject(name = 'My UI Extensions App', extensions?: Extension[]): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: newId('p'),
    name: toProjectSlug(name),
    platformVersion: DEFAULT_PLATFORM_VERSION,
    app: defaultAppConfig(name),
    extensions:
      extensions ??
      [
        createExtension({
          name: 'Contact Overview',
          content: [
            {
              type: 'Flex',
              props: { direction: 'column', gap: 'small' },
              children: [
                { type: 'Heading', text: 'Hello {{ context.user.firstName }} 👋' },
                {
                  type: 'Text',
                  text: 'Drag components from the left panel onto this card to start building.',
                },
              ],
            },
          ],
        }),
      ],
    functions: [],
    createdAt: now,
    updatedAt: now,
  };
}

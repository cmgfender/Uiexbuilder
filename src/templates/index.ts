/** Templates module public API. */
export { TemplatesPanel } from './TemplatesPanel';
export { NewProjectDialog } from './NewProjectDialog';
export {
  PROJECT_TEMPLATES,
  BLOCK_TEMPLATES,
  instantiateExtensionTemplate,
  templateConflict,
  templateLocationLabel,
  freshBlockTemplate,
  matchesBlock,
} from './catalog';
export type { ExtensionTemplate, BlockTemplate, BuiltBlock, InstantiatedTemplate } from './catalog';
export { insertBlock, prepareBlock, addTemplateToProject, replaceActiveWithTemplate, projectFromTemplate, type FlowResult } from './actions';
export { Wireframe, extensionTemplates } from './Wireframe';
export { saveUserBlock, renameUserBlock, deleteUserBlock, listUserBlocks, reloadUserBlocks, useUserBlocks } from './userBlocks';
export type { UserBlock } from './userBlocks';

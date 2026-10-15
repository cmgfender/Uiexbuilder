/** Templates module public API (implemented by the templates module). */
export { TemplatesPanel } from './TemplatesPanel';
export { NewProjectDialog } from './NewProjectDialog';
export { PROJECT_TEMPLATES, BLOCK_TEMPLATES } from './catalog';
export type { ExtensionTemplate, BlockTemplate } from './catalog';
export { saveUserBlock, renameUserBlock, deleteUserBlock, listUserBlocks, useUserBlocks } from './userBlocks';
export type { UserBlock } from './userBlocks';

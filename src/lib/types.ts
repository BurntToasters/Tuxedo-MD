export type Edition = 'community' | 'full';
export type EditorMode = 'source' | 'split' | 'preview';

export interface DocumentTab {
  id: string;
  name: string;
  path: string | null;
  content: string;
  savedContent: string;
}

export interface FileDocument {
  path: string;
  name: string;
  content: string;
}

export interface WorkspaceEntry {
  path: string;
  relativePath: string;
  name: string;
}

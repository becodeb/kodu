/** Tipos que comparten la página Astro del editor y las islas de React. */

export type ModelChoice = 'FLASH' | 'PRO';

export interface WorkspaceProject {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  currentHtml: string;
  selectedModel: ModelChoice;
  isInGallery: boolean;
  screenshotUrl: string | null;
}

export interface WorkspaceThread {
  id: string;
  title: string;
}

export interface WorkspaceMessage {
  id: string;
  role: string;
  content: string;
  attachments: string[];
}

export interface WorkspaceAsset {
  id: string;
  filename: string;
  url: string;
  fileType: string;
}

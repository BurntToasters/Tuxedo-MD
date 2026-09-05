import { authorizeCapability, getBuildInfo, isDesktop } from './tauri';
import type { BuildInfo, Edition, EditionCapability } from './types';
import { shippedCapabilities } from './types';

export interface CapabilityDefinition {
  label: string;
  description: string;
  minimumEdition: Edition;
  /** False for Phase 3 placeholders that must not appear in get_build_info. */
  shipped: boolean;
}

export const capabilityRegistry = {
  workspaceSearch: {
    label: 'Indexed workspace search',
    description: 'Searches Markdown content across a local workspace with a reusable index.',
    minimumEdition: 'full',
    shipped: true,
  },
  backlinks: {
    label: 'Backlinks',
    description: 'Shows which local documents link to the current document.',
    minimumEdition: 'full',
    shipped: true,
  },
  wikiLinks: {
    label: 'Wiki links',
    description: 'Creates and resolves local [[wiki-style]] document links.',
    minimumEdition: 'full',
    shipped: true,
  },
  tags: {
    label: 'Workspace tags',
    description: 'Organizes and filters local documents using Markdown tags.',
    minimumEdition: 'full',
    shipped: true,
  },
  mermaid: {
    label: 'Mermaid diagrams',
    description: 'Renders Mermaid code blocks in the local preview and publishing pipeline.',
    minimumEdition: 'full',
    shipped: false,
  },
  math: {
    label: 'Math rendering',
    description: 'Renders mathematical notation in the local preview and publishing pipeline.',
    minimumEdition: 'full',
    shipped: false,
  },
  exportProfiles: {
    label: 'Export profiles',
    description: 'Saves reusable settings for deterministic local publishing and export.',
    minimumEdition: 'full',
    shipped: false,
  },
  themeStudio: {
    label: 'Theme Studio',
    description: 'Builds and previews custom Tuxedo MD themes using visual design controls.',
    minimumEdition: 'full',
    shipped: false,
  },
  documentRecipes: {
    label: 'Document Recipes',
    description: 'Combines templates, frontmatter defaults, naming rules, and export settings.',
    minimumEdition: 'full',
    shipped: false,
  },
  workspaceIntelligence: {
    label: 'Workspace Intelligence',
    description: 'Finds broken links, orphaned notes, missing metadata, and workspace issues.',
    minimumEdition: 'full',
    shipped: true,
  },
  focusSessionPresets: {
    label: 'Focus session presets',
    description: 'Saves reusable local writing goals, timers, and session preferences.',
    minimumEdition: 'full',
    shipped: false,
  },
} as const satisfies Record<EditionCapability, CapabilityDefinition>;

const capabilityNames = Object.keys(capabilityRegistry) as EditionCapability[];

export const requestedEdition: Edition =
  import.meta.env.VITE_TUXEDO_EDITION === 'full' ? 'full' : 'community';

export interface EditionSnapshot {
  readonly edition: Edition;
  readonly isFullEdition: boolean;
  readonly editionLabel: string;
  readonly editionVersion: string | null;
  readonly editionWarning: string | null;
  readonly opaqueWindow: boolean;
  readonly enabledCapabilities: ReadonlySet<EditionCapability>;
}

export function capabilitiesForEdition(value: Edition): EditionCapability[] {
  return value === 'full' ? [...shippedCapabilities] : [];
}

function isEditionCapability(value: unknown): value is EditionCapability {
  return typeof value === 'string' && capabilityNames.includes(value as EditionCapability);
}

export function resolveBuildInfo(
  info: BuildInfo,
  requested: Edition = requestedEdition
): EditionSnapshot {
  const reportedEdition: Edition = info.edition === 'full' ? 'full' : 'community';
  const reportedCapabilities = new Set(
    Array.isArray(info.capabilities) ? info.capabilities.filter(isEditionCapability) : []
  );
  const expectedCapabilities = capabilitiesForEdition(reportedEdition);
  const effectiveCapabilities = new Set(
    [...reportedCapabilities].filter((capability) => expectedCapabilities.includes(capability))
  );
  const missingCapabilities = expectedCapabilities.filter(
    (capability) => !reportedCapabilities.has(capability)
  );
  const unexpectedCapabilities = [...reportedCapabilities].filter(
    (capability) => !expectedCapabilities.includes(capability)
  );
  const warnings: string[] = [];

  if (info.edition !== 'community' && info.edition !== 'full') {
    warnings.push('The native build reported an unknown edition.');
  }
  if (requested !== reportedEdition) {
    warnings.push(
      `The frontend requested ${requested === 'full' ? 'Pro' : 'Community'}, but the native build reports ${reportedEdition === 'full' ? 'Pro' : 'Community'}.`
    );
  }
  if (missingCapabilities.length || unexpectedCapabilities.length) {
    warnings.push('The native capability contract does not match this frontend build.');
  }

  const isFull = reportedEdition === 'full';
  const label = isFull ? 'Pro' : 'Community';
  const warning = warnings.length
    ? `${warnings.join(' ')} Native ${label} permissions are in force.`
    : null;

  return {
    edition: reportedEdition,
    isFullEdition: isFull,
    editionLabel: label,
    editionVersion: typeof info.version === 'string' ? info.version : null,
    opaqueWindow: Boolean(info.opaqueWindow),
    enabledCapabilities: effectiveCapabilities,
    editionWarning: warning,
  };
}

export function resolveSafeFallback(error: unknown): EditionSnapshot {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    edition: 'community',
    isFullEdition: false,
    editionLabel: 'Community',
    editionVersion: null,
    opaqueWindow: false,
    enabledCapabilities: new Set(),
    editionWarning: `Native build information could not be verified. Community safeguards are in force. ${reason}`,
  };
}

let activeState: EditionSnapshot = {
  edition: requestedEdition,
  isFullEdition: requestedEdition === 'full',
  editionLabel: requestedEdition === 'full' ? 'Pro' : 'Community',
  editionVersion: null,
  editionWarning: null,
  opaqueWindow: false,
  enabledCapabilities: new Set(capabilitiesForEdition(requestedEdition)),
};

export const editionState = {
  get edition(): Edition {
    return activeState.edition;
  },
  get isFullEdition(): boolean {
    return activeState.isFullEdition;
  },
  get editionLabel(): string {
    return activeState.editionLabel;
  },
  get editionVersion(): string | null {
    return activeState.editionVersion;
  },
  get editionWarning(): string | null {
    return activeState.editionWarning;
  },
  get opaqueWindow(): boolean {
    return activeState.opaqueWindow;
  },
};

export function getEdition(): Edition {
  return activeState.edition;
}

export function isFullEdition(): boolean {
  return activeState.isFullEdition;
}

export function getEditionLabel(): string {
  return activeState.editionLabel;
}

export function getEditionVersion(): string | null {
  return activeState.editionVersion;
}

export function getEditionWarning(): string | null {
  return activeState.editionWarning;
}

export function isOpaqueWindow(): boolean {
  return activeState.opaqueWindow;
}

export function getEditionSnapshot(): EditionSnapshot {
  return activeState;
}

export function applyBuildInfo(info: BuildInfo): void {
  activeState = resolveBuildInfo(info, requestedEdition);
  if (activeState.editionWarning) console.error(`[Tuxedo MD] ${activeState.editionWarning}`);
}

export function applySafeFallback(error: unknown): void {
  activeState = resolveSafeFallback(error);
  console.error(`[Tuxedo MD] ${activeState.editionWarning}`);
}

export async function initializeEdition(): Promise<void> {
  if (!isDesktop()) return;
  try {
    applyBuildInfo(await getBuildInfo());
  } catch (error) {
    applySafeFallback(error);
  }
}

export function hasCapability(capability: EditionCapability): boolean {
  return activeState.enabledCapabilities.has(capability);
}

export function capabilityMessage(capability: EditionCapability): string {
  const definition = capabilityRegistry[capability];
  if (hasCapability(capability)) {
    return `${definition.label} is enabled in Tuxedo MD ${activeState.editionLabel}.`;
  }
  if (!definition.shipped) {
    return `${definition.label} is planned for a future Tuxedo MD Pro release. ${definition.description}`;
  }
  return `${definition.label} is available in Tuxedo MD Pro. ${definition.description} Community continues to include complete local Markdown editing.`;
}

export async function requireCapability(capability: EditionCapability): Promise<void> {
  if (!hasCapability(capability)) throw new Error(capabilityMessage(capability));
  if (isDesktop()) await authorizeCapability(capability);
}

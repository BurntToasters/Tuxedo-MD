import type { Edition } from './types';

const requestedEdition = import.meta.env.VITE_TUXEDO_EDITION;

export const edition: Edition = requestedEdition === 'full' ? 'full' : 'community';
export const isFullEdition = edition === 'full';
export const editionLabel = isFullEdition ? 'Pro' : 'Community';

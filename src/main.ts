import { mount } from 'svelte';
import App from './App.svelte';
import { initializeEdition } from './lib/edition';
import { detectPlatform } from './lib/platform';
import './styles.css';

// Apply platform chrome before first paint so Windows drag-region CSS is correct.
document.documentElement.dataset.platform = detectPlatform();
// Opaque until App syncs glass — avoids CSS frost FOUC on first paint.
document.documentElement.dataset.windowFx = 'opaque';

async function bootstrap() {
  await initializeEdition();
  mount(App, { target: document.getElementById('app')! });
}

void bootstrap();

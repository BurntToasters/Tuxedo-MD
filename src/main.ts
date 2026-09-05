import { mount } from 'svelte';
import App from './App.svelte';
import { initializeEdition } from './lib/edition';
import { detectPlatform } from './lib/platform';
import './styles.css';

// Apply platform chrome before first paint so Windows drag-region CSS is correct.
document.documentElement.dataset.platform = detectPlatform();
// Opaque until App syncs glass — avoids CSS frost FOUC on first paint.
document.documentElement.dataset.windowFx = 'opaque';

function renderFatalError(message: string) {
  const target = document.getElementById('app');
  if (!target || target.querySelector('.fatal-error-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'fatal-error-banner';
  const escaped = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  banner.innerHTML = `
    <div class="fatal-error-card">
      <h2>Tuxedo MD encountered an unexpected error</h2>
      <p class="fatal-error-message">${escaped}</p>
      <div class="fatal-error-actions">
        <button onclick="window.location.reload()">Reload Application</button>
      </div>
    </div>
  `;
  target.prepend(banner);
}

window.addEventListener('error', (event) => {
  console.error('[Tuxedo MD] Uncaught error:', event.error ?? event.message);
  renderFatalError(
    event.error?.message ?? event.message ?? 'An unexpected runtime error occurred.'
  );
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Tuxedo MD] Unhandled rejection:', event.reason);
  const msg = event.reason instanceof Error ? event.reason.message : String(event.reason);
  renderFatalError(msg || 'An unhandled asynchronous error occurred.');
});

async function bootstrap() {
  try {
    await initializeEdition();
    mount(App, { target: document.getElementById('app')! });
  } catch (error) {
    console.error('[Tuxedo MD] Bootstrap failed:', error);
    renderFatalError(error instanceof Error ? error.message : String(error));
  }
}

void bootstrap();

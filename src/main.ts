import { mount } from 'svelte';
import App from './App.svelte';
import { initializeEdition } from './lib/edition';
import './styles.css';

async function bootstrap() {
  await initializeEdition();
  mount(App, { target: document.getElementById('app')! });
}

void bootstrap();

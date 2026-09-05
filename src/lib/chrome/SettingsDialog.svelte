<script lang="ts">
  import { onMount } from 'svelte';
  import {
    BookOpenText,
    ChevronDown,
    ChevronUp,
    Info,
    Palette,
    Save,
    Search,
    Sliders,
    X,
  } from '@lucide/svelte';
  import { handleDismissibleDialogKeydown } from '../focus';
  import { getLicenses } from '../tauri';
  import { APP_VERSION, type AppSettings } from '../types';

  let {
    open = false,
    settings = $bindable(),
    editionLabel = 'Community',
    editionVersion = APP_VERSION,
    editionWarning = null,
    isFullEdition = false,
    updatesSupported = false,
    oncheckupdates,
    onclose,
    onopenexternalurl,
  }: {
    open?: boolean;
    settings: AppSettings;
    editionLabel?: string;
    editionVersion?: string | null;
    editionWarning?: string | null;
    isFullEdition?: boolean;
    updatesSupported?: boolean;
    oncheckupdates?: () => void;
    onclose: () => void;
    onopenexternalurl?: (url: string) => Promise<void>;
  } = $props();

  let activeSettingsTab = $state<'appearance' | 'editor' | 'files' | 'about'>('appearance');
  let dialog: HTMLDialogElement | undefined = $state();
  let initialFocusButton: HTMLButtonElement | undefined = $state();

  let licenses = $state<
    Record<
      string,
      {
        licenses: string | string[];
        repository?: string;
        publisher?: string;
        licenseFile?: string;
        licenseText?: string;
      }
    >
  >({});
  let licensesLoading = $state(false);
  let licensesError = $state<string | null>(null);
  let licenseSearch = $state('');
  let expandedLicensePackage = $state<string | null>(null);

  async function loadLicenses() {
    if (Object.keys(licenses).length > 0) return;
    licensesLoading = true;
    licensesError = null;
    try {
      const raw = await getLicenses();
      licenses = JSON.parse(raw);
    } catch (err) {
      licensesError = err instanceof Error ? err.message : String(err);
    } finally {
      licensesLoading = false;
    }
  }

  $effect(() => {
    if (activeSettingsTab === 'about' && open) {
      void loadLicenses();
    }
  });

  $effect(() => {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => initialFocusButton?.focus());
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  });

  onMount(() => {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => initialFocusButton?.focus());
    }
  });

  let filteredLicensesList = $derived(
    Object.entries(licenses)
      .filter(([name]) => name.toLowerCase().includes(licenseSearch.toLowerCase()))
      .sort((a, b) => a[0].localeCompare(b[0]))
  );
</script>

{#if open}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) onclose();
    }}
  >
    <dialog
      bind:this={dialog}
      class="settings-modal tabbed-layout"
      aria-modal="true"
      aria-labelledby="settings-title"
      onkeydown={(event) => handleDismissibleDialogKeydown(event, onclose)}
      oncancel={(event) => {
        event.preventDefault();
        onclose();
      }}
    >
      <header class="settings-header">
        <h2 id="settings-title">Settings</h2>
        <button
          class="icon-button"
          aria-label="Close settings"
          bind:this={initialFocusButton}
          onclick={onclose}><X /></button
        >
      </header>
      <div class="settings-body">
        <aside class="settings-sidebar">
          <button
            class:active={activeSettingsTab === 'appearance'}
            onclick={() => (activeSettingsTab = 'appearance')}
          >
            <Palette size={16} /> <span>Appearance</span>
          </button>
          <button
            class:active={activeSettingsTab === 'editor'}
            onclick={() => (activeSettingsTab = 'editor')}
          >
            <Sliders size={16} /> <span>Editor</span>
          </button>
          <button
            class:active={activeSettingsTab === 'files'}
            onclick={() => (activeSettingsTab = 'files')}
          >
            <Save size={16} /> <span>Files & AutoSave</span>
          </button>
          <button
            class:active={activeSettingsTab === 'about'}
            onclick={() => (activeSettingsTab = 'about')}
          >
            <Info size={16} /> <span>About & Licenses</span>
          </button>
        </aside>

        <main class="settings-content">
          {#if activeSettingsTab === 'appearance'}
            <div class="settings-section">
              <h3>Appearance</h3>

              <div class="settings-group">
                <div class="settings-label">Theme</div>
                <div class="select-wrapper">
                  <select bind:value={settings.theme}>
                    <option value="system">System</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="contrast">High contrast</option>
                  </select>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-label">Glass effects</div>
                <div class="select-wrapper">
                  <select bind:value={settings.glassEffects}>
                    <option value="system">Follow system</option>
                    <option value="on">Always on</option>
                    <option value="off">Off</option>
                  </select>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-label">Preview font family</div>
                <div class="select-wrapper">
                  <select bind:value={settings.previewFont}>
                    <option value="sans">Sans-Serif (Standard)</option>
                    <option value="serif">Serif (Literary)</option>
                    <option value="mono">Monospace (Code)</option>
                  </select>
                </div>
              </div>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Focus Mode (Hides UI chrome)</span>
                  <input type="checkbox" bind:checked={settings.focusMode} />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          {:else if activeSettingsTab === 'editor'}
            <div class="settings-section">
              <h3>Editor</h3>

              <div class="settings-group">
                <div class="settings-label">Editor font size ({settings.fontSize}px)</div>
                <input
                  class="range-slider"
                  type="range"
                  min="11"
                  max="28"
                  bind:value={settings.fontSize}
                />
              </div>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Wrap editor lines</span>
                  <input type="checkbox" bind:checked={settings.lineWrap} />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Show line numbers</span>
                  <input type="checkbox" bind:checked={settings.showLineNumbers} />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <div class="settings-group">
                <div class="settings-label">Tab size</div>
                <div class="segmented-control">
                  <button
                    class:active={settings.tabSize === 2}
                    onclick={() => (settings.tabSize = 2)}>2 spaces</button
                  >
                  <button
                    class:active={settings.tabSize === 4}
                    onclick={() => (settings.tabSize = 4)}>4 spaces</button
                  >
                </div>
              </div>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Enable editor spellcheck</span>
                  <input type="checkbox" bind:checked={settings.spellcheck} />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          {:else if activeSettingsTab === 'files'}
            <div class="settings-section">
              <h3>Files & AutoSave</h3>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Autosave existing files</span>
                  <input type="checkbox" bind:checked={settings.autosave} />
                  <span class="switch-slider"></span>
                </label>
              </div>

              {#if settings.autosave}
                <div class="settings-group">
                  <div class="settings-label">Autosave delay</div>
                  <div class="select-wrapper">
                    <select bind:value={settings.autosaveDelayMs}>
                      <option value={500}>0.5 seconds</option>
                      <option value={1500}>1.5 seconds</option>
                      <option value={3000}>3 seconds</option>
                    </select>
                  </div>
                </div>
              {/if}

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Restore full session on startup</span>
                  <input type="checkbox" bind:checked={settings.restoreSession} />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Keep untitled drafts silently when closing tabs</span>
                  <input type="checkbox" bind:checked={settings.keepDraftsSilently} />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <p class="settings-note">
                Closing the app temp-saves open tabs in your OS app-data folder and restores them
                next launch without writing your Markdown files. Closing a tab still asks Save /
                Don't Save / Cancel unless silent untitled drafts are enabled (path-backed files
                always prompt).
              </p>
            </div>
          {:else if activeSettingsTab === 'about'}
            <div class="settings-section">
              <h3>About & Licenses</h3>

              <div class="about-branding">
                <div class="about-logo"><BookOpenText size={32} /></div>
                <div class="about-meta">
                  <h4>Tuxedo MD</h4>
                  <div class="about-meta-row">
                    <span>v{editionVersion ?? APP_VERSION}</span>
                    <span class:pro={isFullEdition} class="edition" title={editionLabel}
                      >{isFullEdition ? 'PRO' : 'CE'}</span
                    >
                  </div>
                </div>
              </div>

              <p class="settings-note">
                {isFullEdition
                  ? 'Pro is enabled for advanced local workflows, publishing, intelligence, and customization.'
                  : 'Community includes complete local Markdown editing. Pro adds advanced local workflows, publishing, intelligence, and customization.'}
              </p>
              {#if editionWarning}
                <p class="settings-note" role="alert">
                  <strong>Edition check:</strong>
                  {editionWarning}
                </p>
              {/if}

              {#if updatesSupported}
                <h3>Updates</h3>
                <div class="settings-group toggle-group">
                  <label class="switch-container">
                    <span>Check for updates automatically</span>
                    <input type="checkbox" bind:checked={settings.autoCheckUpdates} />
                    <span class="switch-slider"></span>
                  </label>
                </div>
                <div class="settings-group">
                  <div class="settings-label">Update channel</div>
                  <div class="select-wrapper">
                    <select bind:value={settings.updateChannel}>
                      <option value="auto">Auto (follow installed build)</option>
                      <option value="stable">Stable</option>
                      <option value="beta">Beta</option>
                    </select>
                  </div>
                </div>
                <div class="settings-group">
                  <button type="button" class="settings-action" onclick={() => oncheckupdates?.()}
                    >Check now</button
                  >
                </div>
                <p class="settings-note">
                  GitHub releases power in-app updates for direct Windows, macOS, and Linux builds.
                  Store builds update through the Mac App Store or Microsoft Store instead.
                </p>
              {/if}

              <div class="licenses-section">
                <div class="licenses-header">
                  <h5>Third-party Licenses</h5>
                  <div class="licenses-search">
                    <Search size={14} />
                    <input
                      type="text"
                      placeholder="Search package licenses..."
                      bind:value={licenseSearch}
                    />
                  </div>
                </div>

                <div class="licenses-list">
                  {#if licensesLoading}
                    <div class="loading-state">Loading dependency licenses...</div>
                  {:else if licensesError}
                    <div class="error-state">Error loading licenses: {licensesError}</div>
                  {:else if filteredLicensesList.length === 0}
                    <div class="empty-state">No packages found matching search filter.</div>
                  {:else}
                    {#each filteredLicensesList as [pkgName, pkgInfo] (pkgName)}
                      <div class="license-card">
                        <button
                          class="license-card-header"
                          onclick={() => {
                            expandedLicensePackage =
                              expandedLicensePackage === pkgName ? null : pkgName;
                          }}
                        >
                          <div class="license-pkg-info">
                            <span class="pkg-name">{pkgName}</span>
                            <span class="pkg-license"
                              >{Array.isArray(pkgInfo.licenses)
                                ? pkgInfo.licenses.join(', ')
                                : pkgInfo.licenses || 'Unknown'}</span
                            >
                          </div>
                          <span class="expand-icon">
                            {#if expandedLicensePackage === pkgName}
                              <ChevronUp size={16} />
                            {:else}
                              <ChevronDown size={16} />
                            {/if}
                          </span>
                        </button>
                        {#if expandedLicensePackage === pkgName}
                          <div class="license-card-body">
                            {#if pkgInfo.publisher}
                              <p class="license-meta">
                                <strong>Publisher:</strong>
                                {pkgInfo.publisher}
                              </p>
                            {/if}
                            {#if pkgInfo.repository}
                              <p class="license-meta">
                                <strong>Repository:</strong>
                                <a
                                  href={pkgInfo.repository}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onclick={(event) => {
                                    event.preventDefault();
                                    void onopenexternalurl?.(pkgInfo.repository!);
                                  }}>{pkgInfo.repository}</a
                                >
                              </p>
                            {/if}
                            {#if pkgInfo.licenseText}
                              <pre class="license-text">{pkgInfo.licenseText}</pre>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </main>
      </div>
    </dialog>
  </div>
{/if}

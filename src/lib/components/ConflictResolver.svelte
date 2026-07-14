<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import Modal from './Modal.svelte';
  import { AlertTriangle, Monitor, Cloud, Copy } from 'lucide-svelte';

  let choices = $state<Record<string, 'local' | 'remote' | 'both'>>({});

  // Initialize default choices (prefer remote since it's the "newer" from another device)
  $effect(() => {
    if (appState.pendingConflicts.length > 0) {
      const defaults: Record<string, 'local' | 'remote' | 'both'> = {};
      for (const c of appState.pendingConflicts) {
        if (!choices[c.notePath]) {
          defaults[c.notePath] = c.remoteModified > c.localModified ? 'remote' : 'local';
        }
      }
      if (Object.keys(defaults).length > 0) {
        choices = { ...choices, ...defaults };
      }
    }
  });

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function getPreviewText(content: string): string {
    // Strip HTML tags and get first 200 chars
    const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > 200 ? text.substring(0, 200) + '…' : text;
  }

  function handleResolve() {
    const resolutions = appState.pendingConflicts.map(c => ({
      notePath: c.notePath,
      choice: choices[c.notePath] || 'both'
    }));
    appState.resolveConflicts(resolutions);
  }

  function selectAllLocal() {
    const updated: Record<string, 'local' | 'remote' | 'both'> = {};
    for (const c of appState.pendingConflicts) updated[c.notePath] = 'local';
    choices = updated;
  }

  function selectAllRemote() {
    const updated: Record<string, 'local' | 'remote' | 'both'> = {};
    for (const c of appState.pendingConflicts) updated[c.notePath] = 'remote';
    choices = updated;
  }
</script>

<Modal
  show={appState.showConflictResolver}
  title="Sync Conflicts"
  onClose={() => {}}
  closeOnEsc={false}
  closeOnOverlay={false}
  maxWidth="640px"
>
  {#snippet titleIcon()}
    <AlertTriangle size={18} style="color: var(--semantic-warning);" />
  {/snippet}

  {#snippet children()}
    <div class="conflict-resolver">
      <p class="conflict-desc">
        {appState.pendingConflicts.length} note{appState.pendingConflicts.length > 1 ? 's have' : ' has'} been edited on both this device and another device.
        Choose which version to keep for each note.
      </p>

      {#if appState.pendingConflicts.length > 1}
        <div class="bulk-actions flex-row">
          <button class="bulk-btn" onclick={selectAllLocal}>
            <Monitor size={14} /> Keep All Local
          </button>
          <button class="bulk-btn" onclick={selectAllRemote}>
            <Cloud size={14} /> Keep All Remote
          </button>
        </div>
      {/if}

      <div class="conflict-list">
        {#each appState.pendingConflicts as conflict}
          <div class="conflict-card">
            <div class="conflict-card-header">
              <span class="conflict-note-name">{conflict.noteName}</span>
            </div>

            <div class="conflict-versions flex-row">
              <button
                class="version-btn"
                class:selected={choices[conflict.notePath] === 'local'}
                onclick={() => choices = { ...choices, [conflict.notePath]: 'local' }}
              >
                <div class="version-header flex-row">
                  <Monitor size={14} />
                  <span class="version-label">This Device</span>
                </div>
                <span class="version-time">{formatDate(conflict.localModified)}</span>
                <p class="version-preview">{getPreviewText(conflict.localContent)}</p>
              </button>

              <button
                class="version-btn"
                class:selected={choices[conflict.notePath] === 'remote'}
                onclick={() => choices = { ...choices, [conflict.notePath]: 'remote' }}
              >
                <div class="version-header flex-row">
                  <Cloud size={14} />
                  <span class="version-label">Google Drive</span>
                </div>
                <span class="version-time">{formatDate(conflict.remoteModified)}</span>
                <p class="version-preview">{getPreviewText(conflict.remoteContent)}</p>
              </button>
            </div>

            <button
              class="both-btn"
              class:selected={choices[conflict.notePath] === 'both'}
              onclick={() => choices = { ...choices, [conflict.notePath]: 'both' }}
            >
              <Copy size={14} />
              Keep Both (other version saved in Conflicts folder)
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/snippet}

  {#snippet footer()}
    <div class="conflict-footer flex-row">
      <span class="conflict-footer-hint">The non-chosen version is always saved as a backup.</span>
      <button class="resolve-btn" onclick={handleResolve}>
        Apply Choices
      </button>
    </div>
  {/snippet}
</Modal>

<style>
  .conflict-resolver {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .conflict-desc {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .bulk-actions {
    gap: var(--spacing-sm);
    padding: var(--spacing-xs) 0;
  }

  .bulk-btn {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .bulk-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .conflict-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    max-height: 60vh;
    overflow-y: auto;
  }

  .conflict-card {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    padding: var(--spacing-md);
    background: var(--bg-surface);
  }

  .conflict-card-header {
    margin-bottom: var(--spacing-sm);
  }

  .conflict-note-name {
    font-weight: 700;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .conflict-versions {
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-sm);
  }

  .version-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: var(--spacing-sm);
    border: 2px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    background: var(--bg-base);
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
  }

  .version-btn:hover {
    border-color: var(--text-tertiary);
  }

  .version-btn.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg-base));
  }

  .version-header {
    gap: 6px;
    width: 100%;
  }

  .version-label {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-primary);
  }

  .version-time {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .version-preview {
    font-size: 11px;
    color: var(--text-secondary);
    margin: 4px 0 0;
    line-height: 1.4;
    max-height: 60px;
    overflow: hidden;
    word-break: break-word;
  }

  .both-btn {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    width: 100%;
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: var(--font-size-xs);
    border: 2px solid var(--border-color);
    border-radius: var(--radius-comfortable);
    background: var(--bg-base);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .both-btn:hover {
    border-color: var(--text-tertiary);
  }

  .both-btn.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg-base));
    color: var(--text-primary);
  }

  .conflict-footer {
    justify-content: space-between;
    width: 100%;
    gap: var(--spacing-md);
  }

  .conflict-footer-hint {
    font-size: 11px;
    color: var(--text-tertiary);
    flex: 1;
  }

  .resolve-btn {
    padding: var(--spacing-sm) var(--spacing-lg);
    font-size: var(--font-size-sm);
    font-weight: 700;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-comfortable);
    cursor: pointer;
    transition: opacity 0.15s ease;
    white-space: nowrap;
  }

  .resolve-btn:hover {
    opacity: 0.9;
  }

  @media (max-width: 600px) {
    .conflict-versions {
      flex-direction: column;
    }

    .version-btn {
      width: 100%;
    }

    .conflict-list {
      max-height: 50vh;
    }

    .version-preview {
      max-height: 45px;
    }

    .conflict-footer {
      flex-direction: column;
      gap: var(--spacing-sm);
    }

    .resolve-btn {
      width: 100%;
      min-height: 44px;
    }

    .bulk-actions {
      flex-wrap: wrap;
    }

    .bulk-btn {
      min-height: 44px;
      flex: 1;
      justify-content: center;
    }
  }
</style>

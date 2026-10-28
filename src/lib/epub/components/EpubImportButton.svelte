<script lang="ts">
  import { BookPlus } from 'lucide-svelte';
  import { appState } from '../../stores/appState.svelte';
  import { EpubManager } from '../services/EpubManager';

  let {
    variant = 'button',
    label = 'Add Book',
    class: customClass = '',
    onImportComplete
  }: {
    variant?: 'button' | 'icon' | 'dropdown-item';
    label?: string;
    class?: string;
    onImportComplete?: () => void;
  } = $props();

  let fileInput: HTMLInputElement | null = $state(null);
  let isImporting = $state(false);

  function triggerFilePicker() {
    fileInput?.click();
  }

  async function handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const filesToImport: Array<{ file: Blob; name: string }> = [];
    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i];
      if (file.name.toLowerCase().endsWith('.epub') || file.type.includes('epub')) {
        filesToImport.push({ file, name: file.name });
      }
    }

    // Reset input value so same files can be chosen again if needed
    input.value = '';

    if (filesToImport.length === 0) {
      appState.showToast('Please select valid .epub files.', 'warning');
      return;
    }

    isImporting = true;
    appState.showToast(`Importing ${filesToImport.length} book${filesToImport.length > 1 ? 's' : ''}...`, 'info', 3000);

    try {
      const results = await EpubManager.importEpubFiles(filesToImport, appState.activeNotebook);
      
      let successCount = 0;
      let duplicateCount = 0;
      let drmCount = 0;
      let errorCount = 0;

      for (const res of results) {
        if (res.success) {
          successCount++;
        } else if (res.duplicate) {
          duplicateCount++;
          appState.showToast(res.message || 'Book already exists in library.', 'warning', 4000);
        } else if (res.drmProtected) {
          drmCount++;
          appState.showToast('This book is DRM-protected and cannot be opened.', 'error', 5000);
        } else {
          errorCount++;
          appState.showToast(res.error || 'Failed to import book.', 'error', 4000);
        }
      }

      if (successCount > 0) {
        appState.showToast(
          `Successfully added ${successCount} book${successCount > 1 ? 's' : ''} to library!`,
          'success',
          3500
        );
        onImportComplete?.();
      }
    } catch (e: any) {
      console.error('[EpubImport] Import failed:', e);
      appState.showToast(e?.message || 'Error importing EPUB book.', 'error');
    } finally {
      isImporting = false;
    }
  }
</script>

<input
  bind:this={fileInput}
  type="file"
  accept=".epub,application/epub+zip"
  multiple
  style="display: none;"
  onchange={handleFileChange}
/>

{#if variant === 'icon'}
  <button
    type="button"
    class="epub-import-icon-btn {customClass}"
    onclick={triggerFilePicker}
    disabled={isImporting}
    title={label}
    aria-label={label}
  >
    <BookPlus size={16} />
  </button>
{:else if variant === 'dropdown-item'}
  <button
    type="button"
    class="epub-import-menu-item flex-row {customClass}"
    onclick={triggerFilePicker}
    disabled={isImporting}
  >
    <BookPlus size={16} />
    <span>{isImporting ? 'Importing...' : label}</span>
  </button>
{:else}
  <button
    type="button"
    class="btn-pill btn-pill-outline flex-row epub-import-pill-btn {customClass}"
    onclick={triggerFilePicker}
    disabled={isImporting}
  >
    <BookPlus size={15} />
    <span>{isImporting ? 'Importing...' : label}</span>
  </button>
{/if}

<style>
  .epub-import-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-standard);
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    cursor: pointer;
    transition: all var(--motion-duration-fast) ease;
  }

  .epub-import-icon-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--accent);
    border-color: var(--accent);
  }

  .epub-import-icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .epub-import-menu-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    width: 100%;
    padding: var(--spacing-xs) var(--spacing-sm);
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    border-radius: var(--radius-sm);
    text-align: left;
  }

  .epub-import-menu-item:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--accent);
  }

  .epub-import-pill-btn {
    gap: var(--spacing-xs);
    height: 32px;
    font-size: var(--font-size-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>

<script lang="ts">
  import { epubReader } from '../stores/epubReader.svelte';
  import { X, RotateCcw, Sun, Moon, BookOpen, Columns, AlignLeft, AlignJustify } from 'lucide-svelte';

  const fonts = [
    { id: 'publisher', label: 'Default' },
    { id: 'serif', label: 'Serif' },
    { id: 'sans', label: 'Sans' },
    { id: 'mono', label: 'Mono' },
    { id: 'dyslexic', label: 'Dyslexic' },
  ] as const;

  const themes = [
    { id: 'app', label: 'App', bg: 'var(--bg-base, #ffffff)', text: 'var(--text-primary, #000)' },
    { id: 'paper', label: 'Paper', bg: '#f7f4ec', text: '#2c2b29' },
    { id: 'sepia', label: 'Sepia', bg: '#f4ecd8', text: '#5b4636' },
    { id: 'dark', label: 'Dark', bg: '#1c1c1e', text: '#e0e0e0' },
    { id: 'black', label: 'OLED', bg: '#000000', text: '#a0a0a0' },
  ] as const;

  function setFontSize(delta: number) {
    const newSize = Math.max(12, Math.min(36, epubReader.settings.fontSize + delta));
    epubReader.updateSettings({ fontSize: newSize });
  }

  function setLineHeight(lh: number) {
    epubReader.updateSettings({ lineHeight: lh });
  }

  function setSpacing(spacing: number) {
    epubReader.updateSettings({ paragraphSpacing: spacing });
  }
</script>

<div class="settings-backdrop" onclick={() => epubReader.isSettingsOpen = false} role="presentation">
  <div class="settings-sheet" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Reading Settings">
    <div class="sheet-header">
      <div class="sheet-title">Reading Settings</div>
      <button 
        class="icon-btn" 
        onclick={() => epubReader.isSettingsOpen = false} 
        aria-label="Close settings"
      >
        <X size={18} />
      </button>
    </div>

    <div class="sheet-content">
      <!-- Reading Flow -->
      <div class="setting-group">
        <label class="group-label">Layout</label>
        <div class="btn-toggle-row">
          <button 
            class="toggle-btn {epubReader.settings.flow === 'paginated' ? 'active' : ''}"
            onclick={() => epubReader.updateSettings({ flow: 'paginated' })}
          >
            Paginated
          </button>
          <button 
            class="toggle-btn {epubReader.settings.flow === 'scrolled' ? 'active' : ''}"
            onclick={() => epubReader.updateSettings({ flow: 'scrolled' })}
          >
            Continuous Scroll
          </button>
        </div>
      </div>

      <!-- Two-page spread & Page Turn Animation (Paginated only) -->
      {#if epubReader.settings.flow === 'paginated'}
        <div class="setting-group row-between">
          <label class="group-label" for="spread-toggle">Two-Page Spread</label>
          <input 
            id="spread-toggle"
            type="checkbox" 
            checked={epubReader.settings.twoPageSpread}
            onchange={(e) => epubReader.updateSettings({ twoPageSpread: (e.target as HTMLInputElement).checked })}
            class="checkbox-input"
          />
        </div>

        <div class="setting-group row-between">
          <div>
            <label class="group-label" for="page-anim-toggle" style="margin-bottom: 2px;">Page Turn Animation</label>
            <div style="font-size: 11px; opacity: 0.65;">Smooth slide transition</div>
          </div>
          <input 
            id="page-anim-toggle"
            type="checkbox" 
            checked={epubReader.settings.animatePageTurn}
            onchange={(e) => epubReader.updateSettings({ animatePageTurn: (e.target as HTMLInputElement).checked })}
            class="checkbox-input"
          />
        </div>
      {/if}

      <!-- Theme selection -->
      <div class="setting-group">
        <label class="group-label">Theme</label>
        <div class="theme-palette">
          {#each themes as t (t.id)}
            <button 
              class="theme-btn {epubReader.settings.theme === t.id ? 'active' : ''}"
              style="background: {t.bg}; color: {t.text};"
              onclick={() => epubReader.updateSettings({ theme: t.id })}
              title={t.label}
              aria-label={t.label}
            >
              <span>{t.label}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Typography: Font Family -->
      <div class="setting-group">
        <label class="group-label">Font Family</label>
        <div class="btn-toggle-row">
          {#each fonts as f (f.id)}
            <button 
              class="toggle-btn {epubReader.settings.fontFamily === f.id ? 'active' : ''}"
              onclick={() => epubReader.updateSettings({ fontFamily: f.id })}
            >
              {f.label}
            </button>
          {/each}
        </div>
      </div>

      <!-- Font Size -->
      <div class="setting-group row-between">
        <label class="group-label">Font Size</label>
        <div class="stepper-row">
          <button class="step-btn" onclick={() => setFontSize(-1)} aria-label="Decrease font size">A-</button>
          <span class="step-val">{epubReader.settings.fontSize}px</span>
          <button class="step-btn" onclick={() => setFontSize(1)} aria-label="Increase font size">A+</button>
        </div>
      </div>

      <!-- Line Height -->
      <div class="setting-group row-between">
        <label class="group-label">Line Spacing</label>
        <div class="btn-toggle-row small">
          <button 
            class="toggle-btn {epubReader.settings.lineHeight <= 1.4 ? 'active' : ''}" 
            onclick={() => setLineHeight(1.3)}
          >Tight</button>
          <button 
            class="toggle-btn {epubReader.settings.lineHeight > 1.4 && epubReader.settings.lineHeight < 1.8 ? 'active' : ''}" 
            onclick={() => setLineHeight(1.6)}
          >Normal</button>
          <button 
            class="toggle-btn {epubReader.settings.lineHeight >= 1.8 ? 'active' : ''}" 
            onclick={() => setLineHeight(1.9)}
          >Loose</button>
        </div>
      </div>

      <!-- Text Alignment -->
      <div class="setting-group row-between">
        <label class="group-label">Text Align</label>
        <div class="btn-toggle-row small">
          <button 
            class="toggle-btn {epubReader.settings.textAlign === 'publisher' ? 'active' : ''}" 
            onclick={() => epubReader.updateSettings({ textAlign: 'publisher' })}
          >Default</button>
          <button 
            class="toggle-btn {epubReader.settings.textAlign === 'left' ? 'active' : ''}" 
            onclick={() => epubReader.updateSettings({ textAlign: 'left' })}
          >Left</button>
          <button 
            class="toggle-btn {epubReader.settings.textAlign === 'justify' ? 'active' : ''}" 
            onclick={() => epubReader.updateSettings({ textAlign: 'justify' })}
          >Justify</button>
        </div>
      </div>

      <!-- Margins -->
      <div class="setting-group">
        <div class="row-between" style="margin-bottom: 6px;">
          <label class="group-label" for="margin-slider">Margins / Page Width</label>
          <span class="step-val">{epubReader.settings.marginPercent}%</span>
        </div>
        <input 
          id="margin-slider"
          type="range" 
          min="5" 
          max="25" 
          step="1"
          value={epubReader.settings.marginPercent}
          onchange={(e) => epubReader.updateSettings({ marginPercent: parseInt((e.target as HTMLInputElement).value, 10) })}
          class="range-slider"
        />
      </div>

      <!-- Hyphenation & Invert Images & Keep Screen Awake -->
      <div class="setting-group row-between">
        <label class="group-label" for="hyphen-toggle">Hyphenation</label>
        <input 
          id="hyphen-toggle"
          type="checkbox" 
          checked={epubReader.settings.hyphenation}
          onchange={(e) => epubReader.updateSettings({ hyphenation: (e.target as HTMLInputElement).checked })}
          class="checkbox-input"
        />
      </div>

      <div class="setting-group row-between">
        <label class="group-label" for="invert-images-toggle">Dim/Tone Images in Dark Themes</label>
        <input 
          id="invert-images-toggle"
          type="checkbox" 
          checked={epubReader.settings.invertImagesInDark}
          onchange={(e) => epubReader.updateSettings({ invertImagesInDark: (e.target as HTMLInputElement).checked })}
          class="checkbox-input"
        />
      </div>

      <div class="setting-group row-between">
        <label class="group-label" for="wake-lock-toggle">Keep Screen Awake While Reading</label>
        <input 
          id="wake-lock-toggle"
          type="checkbox" 
          checked={epubReader.settings.keepScreenAwake}
          onchange={(e) => epubReader.updateSettings({ keepScreenAwake: (e.target as HTMLInputElement).checked })}
          class="checkbox-input"
        />
      </div>

      <!-- Reset -->
      <div class="sheet-footer">
        <button class="reset-btn" onclick={() => epubReader.resetSettingsToDefault()}>
          <RotateCcw size={14} />
          <span>Reset to Defaults</span>
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    z-index: 9999;
    display: flex;
    justify-content: flex-end;
    animation: fadeIn 0.15s ease-out;
  }

  .settings-sheet {
    width: 360px;
    max-width: 90vw;
    height: 100%;
    background: var(--bg-surface, var(--bg-base, #ffffff));
    color: var(--text-primary, #111827);
    border-left: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
    animation: slideInRight 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .sheet-header {
    height: 52px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    font-weight: 600;
    font-size: 0.95rem;
  }

  .sheet-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .setting-group.row-between {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .group-label {
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--text-secondary, #4b5563);
  }

  .btn-toggle-row {
    display: flex;
    gap: 4px;
    background: var(--hover-bg, rgba(0, 0, 0, 0.04));
    padding: 3px;
    border-radius: 8px;
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  }

  .btn-toggle-row.small {
    padding: 2px;
  }

  .toggle-btn {
    flex: 1;
    background: none;
    border: none;
    padding: 6px 8px;
    font-size: 0.8rem;
    color: var(--text-secondary, #4b5563);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    text-align: center;
  }

  .toggle-btn.active {
    background: var(--bg-surface, #ffffff);
    color: var(--accent, #3b82f6);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .theme-palette {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }

  .theme-btn {
    height: 38px;
    border-radius: 8px;
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.15));
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }

  .theme-btn.active {
    outline: 2px solid var(--accent, #3b82f6);
    outline-offset: 2px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }

  .stepper-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .step-btn {
    background: var(--hover-bg, rgba(0, 0, 0, 0.06));
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    color: var(--text-primary, #111827);
  }

  .step-val {
    font-size: 0.85rem;
    font-weight: 600;
    min-width: 42px;
    text-align: center;
    color: var(--text-primary, #111827);
  }

  .checkbox-input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent, #3b82f6);
    cursor: pointer;
  }

  .range-slider {
    width: 100%;
    accent-color: var(--accent, #3b82f6);
    cursor: pointer;
  }

  .sheet-footer {
    padding-top: 12px;
    border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
    display: flex;
    justify-content: center;
  }

  .reset-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #6b7280);
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    cursor: pointer;
    padding: 6px 12px;
    border-radius: 6px;
  }

  .reset-btn:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.05));
    color: var(--text-primary, #111827);
  }

  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary, #6b7280);
    padding: 6px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.06));
    color: var(--text-primary, #111827);
  }

  @keyframes slideInRight {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>

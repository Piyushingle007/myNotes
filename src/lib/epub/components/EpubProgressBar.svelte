<script lang="ts">
  import { epubReader } from '../stores/epubReader.svelte';

  let isScrubbing = $state<boolean>(false);
  let scrubPercentage = $state<number>(0);

  let currentPercent = $derived(
    isScrubbing ? scrubPercentage : Math.round(epubReader.percentage * 100)
  );

  function handleInput(e: Event) {
    isScrubbing = true;
    const target = e.target as HTMLInputElement;
    scrubPercentage = parseInt(target.value, 10);
  }

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    epubReader.pushJumpHistory();
    epubReader.goToFraction(val / 100);
    isScrubbing = false;
  }
</script>

<div class="progress-bar-container" onclick={(e) => e.stopPropagation()} role="presentation">
  <div class="progress-slider-wrapper">
    <input 
      type="range" 
      min="0" 
      max="100" 
      step="1"
      value={currentPercent}
      oninput={handleInput}
      onchange={handleChange}
      class="progress-slider"
      aria-label="Book progress"
    />
  </div>

  <div class="progress-meta-row">
    <div class="chapter-info" title={epubReader.chapterTitle || 'Reading'}>
      {epubReader.chapterTitle || 'Reading'}
    </div>
    
    <div class="progress-stats">
      <span class="percent-badge">{currentPercent}%</span>
      <span class="bullet">·</span>
      <span class="eta-text">~{epubReader.estimatedMinutesLeftInBook}m left</span>
      <span class="bullet">·</span>
      <span class="chapter-eta-text">~{epubReader.estimatedMinutesLeftInChapter}m in ch.</span>
    </div>
  </div>
</div>

<style>
  .progress-bar-container {
    width: 100%;
    max-width: 680px;
    margin: 0 auto;
    padding: 10px 18px calc(10px + env(safe-area-inset-bottom, 0px)) 18px;
    background: var(--bg-surface, var(--bg-base, #ffffff));
    color: var(--text-primary, #111827);
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.08);
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
    border-bottom: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    user-select: none;
  }

  .progress-slider-wrapper {
    width: 100%;
    display: flex;
    align-items: center;
  }

  .progress-slider {
    width: 100%;
    height: 5px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border-color, rgba(0, 0, 0, 0.15));
    border-radius: 4px;
    outline: none;
    cursor: pointer;
  }

  .progress-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent, #3b82f6);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    transition: transform 0.1s ease;
  }

  .progress-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }

  .progress-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent, #3b82f6);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    border: none;
  }

  .progress-meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--text-secondary, #6b7280);
    gap: 12px;
  }

  .chapter-info {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 50%;
    color: var(--text-primary, #374151);
  }

  .progress-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .percent-badge {
    font-weight: 600;
    color: var(--accent, #3b82f6);
  }

  .bullet {
    opacity: 0.5;
  }
</style>

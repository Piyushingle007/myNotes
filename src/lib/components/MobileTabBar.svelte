<script lang="ts">
  import { Home, Tag as TagIcon, Library, Calculator, Target, Wallet } from 'lucide-svelte';
  import { appState } from '../stores/appState.svelte';
  import { mobileNav } from '../stores/mobileNav.svelte';

  interface Props {
    /** Optional hook to let the host reset any local search input on tab change. */
    onNavigate?: () => void;
  }

  let { onNavigate }: Props = $props();

  const tabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'tags', label: 'Tags', icon: TagIcon },
    { id: 'library', label: 'Library', icon: Library },
    { id: 'num', label: 'Num', icon: Calculator },
    { id: 'budget', label: 'Budget', icon: Wallet },
    { id: 'focus', label: 'Focus', icon: Target },
  ] as const;

  function select(id: (typeof tabs)[number]['id']) {
    mobileNav.goToTab(id);
    onNavigate?.();
  }
</script>

<!-- Android Bottom Navigation Bar (Spotify Style) -->
<nav class="android-bottom-nav flex-row" aria-label="Primary">
  {#each tabs as tab}
    <button
      type="button"
      class="nav-tab flex-col"
      class:active={appState.activeTab === tab.id}
      aria-current={appState.activeTab === tab.id ? 'page' : undefined}
      aria-label={tab.label}
      onclick={() => select(tab.id)}
    >
      <tab.icon size={22} />
      <span>{tab.label}</span>
    </button>
  {/each}
</nav>

<style>
  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .flex-col {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .android-bottom-nav {
    position: absolute;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    left: calc(16px + env(safe-area-inset-left, 0px));
    right: calc(16px + env(safe-area-inset-right, 0px));
    height: 60px;
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-pill);
    box-shadow: 0 8px 32px 0 color-mix(in srgb, var(--bg-base) 40%, transparent);
    justify-content: space-around;
    align-items: stretch;
    z-index: 10;
    padding: 0 var(--spacing-xs);
  }

  .nav-tab {
    position: relative;
    flex: 1 1 0;
    min-width: 48px;
    min-height: 48px;
    padding: var(--spacing-xs) var(--spacing-sm);
    color: var(--text-secondary);
    gap: 2px;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-pill);
    transition: color 0.2s ease, transform 0.15s ease;
    background: none;
    border: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .nav-tab:active {
    transform: scale(0.92);
  }

  .nav-tab.active {
    color: var(--accent);
  }

  /* Clear active indicator dot above the label */
  .nav-tab.active::before {
    content: '';
    position: absolute;
    top: 6px;
    left: 50%;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: var(--accent);
    transform: translateX(-50%);
  }

  .nav-tab span {
    font-size: var(--font-size-xs);
    font-weight: 750;
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-tab {
      transition: none;
    }
  }
</style>



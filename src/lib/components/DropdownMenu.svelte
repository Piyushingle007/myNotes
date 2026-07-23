<script lang="ts">
  import { computePosition, offset, flip, shift } from '@floating-ui/dom';
  import { ChevronRight } from 'lucide-svelte';
  import { onMount } from 'svelte';

  export interface MenuItem {
    label: string;
    action?: () => void;
    variant?: 'default' | 'danger';
    children?: MenuItem[];
  }

  interface Props {
    items: MenuItem[];
    onClose?: () => void;
  }

  let { items, onClose }: Props = $props();

  let activeSubmenu = $state<number | null>(null);
  let submenuRefs: HTMLDivElement[] = [];
  let itemRefs: HTMLButtonElement[] = [];

  function handleItemClick(item: MenuItem, index: number) {
    if (item.children) {
      if (activeSubmenu === index) {
        activeSubmenu = null;
      } else {
        activeSubmenu = index;
        positionSubmenu(index);
      }
    } else if (item.action) {
      item.action();
      onClose?.();
    }
  }

  async function positionSubmenu(index: number) {
    // Wait for submenu to render
    setTimeout(async () => {
      const trigger = itemRefs[index];
      const submenu = submenuRefs[index];
      if (!trigger || !submenu) return;
      
      const { x, y } = await computePosition(trigger, submenu, {
        placement: 'right-start',
        middleware: [offset(4), flip(), shift({ padding: 8 })]
      });
      
      submenu.style.left = `${x}px`;
      submenu.style.top = `${y}px`;
      submenu.style.opacity = '1';
      submenu.style.pointerEvents = 'auto';
    }, 0);
  }
</script>

<div class="dropdown-menu">
  {#each items as item, index}
    <div class="menu-item-wrapper">
      <button 
        bind:this={itemRefs[index]}
        class="menu-item {item.variant === 'danger' ? 'danger' : ''}"
        onclick={(e) => { e.stopPropagation(); handleItemClick(item, index); }}
        onmouseenter={() => { 
          if (item.children && activeSubmenu !== index) {
            activeSubmenu = index; 
            positionSubmenu(index);
          } else if (!item.children && activeSubmenu !== null) {
            activeSubmenu = null;
          }
        }}
      >
        <span>{item.label}</span>
        {#if item.children}
          <ChevronRight size={14} class="chevron" />
        {/if}
      </button>

      {#if item.children && activeSubmenu === index}
        <div 
          bind:this={submenuRefs[index]} 
          class="submenu"
        >
          <!-- Using self-reference for recursion wasn't requested exactly, but this works for 2 levels -->
          <div class="dropdown-menu">
            {#each item.children as child}
              <button 
                class="menu-item {child.variant === 'danger' ? 'danger' : ''}"
                onclick={(e) => { e.stopPropagation(); child.action?.(); onClose?.(); }}
              >
                <span>{child.label}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .dropdown-menu {
    display: flex;
    flex-direction: column;
    background: var(--bg-surface-elevated, #1e2227);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    padding: 4px;
    min-width: 160px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  }
  .menu-item-wrapper {
    position: relative; /* for submenu positioning */
  }
  .menu-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-normal, #e0e0e0);
    font-size: 0.85rem;
    cursor: pointer;
    text-align: left;
  }
  .menu-item:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .menu-item.danger {
    color: #ef4444;
  }
  .menu-item.danger:hover {
    background: rgba(239, 68, 68, 0.1);
  }
  .chevron {
    color: var(--text-muted, #a0a0a0);
  }
  
  .submenu {
    position: fixed; /* so it can escape overflow */
    z-index: 10000;
    opacity: 0;
    pointer-events: none;
    top: 0;
    left: 0;
  }
</style>

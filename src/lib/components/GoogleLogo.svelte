<script lang="ts">
  let { size = 24 } = $props();
</script>

<svg 
  width={size} 
  height={size} 
  viewBox="0 0 24 24" 
  fill="none" 
  xmlns="http://www.w3.org/2000/svg"
  class="google-logo-svg"
>
  <!-- Main paper card -->
  <path d="M19 9H14V4H5V20H19V9Z" fill="var(--bg-surface)" stroke="var(--border-highlight)" stroke-width="1.5" stroke-linejoin="round"/>
  
  <!-- Folded corner (Yellow) -->
  <path d="M14 4V9H19L14 4Z" fill="#FBBC05" stroke="var(--border-highlight)" stroke-width="1.5" stroke-linejoin="round"/>
  
  <!-- Google Colored Stripes inside the note -->
  <!-- Top line: Blue -->
  <line x1="8" y1="12" x2="16" y2="12" stroke="#4285F4" stroke-width="2" stroke-linecap="round"/>
  <!-- Middle line: Red -->
  <line x1="8" y1="15" x2="16" y2="15" stroke="#EA4335" stroke-width="2" stroke-linecap="round"/>
  <!-- Bottom line: Green -->
  <line x1="8" y1="18" x2="13" y2="18" stroke="#34A853" stroke-width="2" stroke-linecap="round"/>
</svg>

<style>
  .google-logo-svg {
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
  }
</style>

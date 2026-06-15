<script lang="ts">
  let { size = 24 } = $props();
</script>

<svg 
  width={size} 
  style="height: auto; aspect-ratio: 1 / 1;"
  viewBox="279 39 122 122" 
  role="img" 
  xmlns="http://www.w3.org/2000/svg"
  class="google-logo-svg"
>
  <title>MyNotes App Icon</title>
  <desc>A centered rounded-square note icon with colorful Google-style lines.</desc>

  <rect x="280" y="40" width="120" height="120" rx="28" fill="#FFFFFF" stroke="#E0E0E0" stroke-width="1"/>

  <rect x="305" y="75" width="70" height="9" rx="4.5" fill="#4285F4"/>
  <rect x="305" y="98" width="70" height="9" rx="4.5" fill="#EA4335"/>
  <rect x="305" y="121" width="44" height="9" rx="4.5" fill="#FBBC05"/>
  <rect x="357" y="121" width="18" height="9" rx="4.5" fill="#34A853"/>
</svg>

<style>
  .google-logo-svg {
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
  }
</style>

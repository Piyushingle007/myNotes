<script lang="ts">
  let { size = 24 } = $props();
</script>

<svg 
  width={size} 
  style="height: auto; aspect-ratio: 680 / 480;"
  viewBox="0 0 680 480" 
  role="img" 
  xmlns="http://www.w3.org/2000/svg"
  class="google-logo-svg"
>
  <title>MyNote — Material You redesigned logo</title>
  <desc>MyNote logo in Material Design 3 style, featuring tonal blobs in M3 lavender and rose, a pill icon mark, and a mixed-weight wordmark with a pen-nib accent</desc>

  <defs>
    <linearGradient id="iconGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6750A4"/>
      <stop offset="100%" stop-color="#4F378B"/>
    </linearGradient>
    <linearGradient id="pageGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#EADDFF"/>
      <stop offset="100%" stop-color="#D0BCFF"/>
    </linearGradient>
  </defs>

  <!-- TONAL BLOB FIELD -->
  <path d="M80,60 C120,30 200,50 230,100 C260,150 240,210 200,230 C160,250 100,230 70,190 C40,150 40,90 80,60 Z" fill="#E8DEF8" opacity="0.9"/>
  <path d="M560,40 C610,55 650,100 640,155 C630,210 585,235 545,220 C505,205 480,165 490,120 C500,75 510,25 560,40 Z" fill="#FFD8E4" opacity="0.85"/>
  <path d="M60,340 C90,305 145,310 165,345 C185,380 170,425 140,440 C110,455 65,440 50,410 C35,380 30,375 60,340 Z" fill="#CCF0D4" opacity="0.75"/>
  <path d="M565,320 C610,310 650,340 648,385 C646,430 610,455 572,445 C534,435 515,405 520,370 C525,335 520,330 565,320 Z" fill="#E8DEF8" opacity="0.6"/>

  <!-- Tonal dots -->
  <circle cx="175" cy="170" r="5" fill="#6750A4" opacity="0.12"/>
  <circle cx="200" cy="300" r="3.5" fill="#B58392" opacity="0.20"/>
  <circle cx="500" cy="180" r="4" fill="#6750A4" opacity="0.10"/>
  <circle cx="480" cy="350" r="3" fill="#B58392" opacity="0.18"/>
  <circle cx="135" cy="390" r="5.5" fill="#6750A4" opacity="0.09"/>
  <circle cx="545" cy="120" r="3" fill="#D0BCFF" opacity="0.55"/>
  <circle cx="160" cy="120" r="2.5" fill="#FFB3C8" opacity="0.50"/>

  <!-- Ring accents -->
  <circle cx="530" cy="240" r="18" fill="none" stroke="#D0BCFF" stroke-width="2" opacity="0.7"/>
  <circle cx="158" cy="268" r="12" fill="none" stroke="#FFD8E4" stroke-width="1.8" opacity="0.8"/>
  <circle cx="88" cy="160" r="22" fill="none" stroke="#E8DEF8" stroke-width="1.5" opacity="0.6"/>
  <circle cx="588" cy="370" r="15" fill="none" stroke="#CCF0D4" stroke-width="2" opacity="0.65"/>

  <!-- ICON MARK -->
  <rect x="272" y="68" width="136" height="136" rx="36" fill="#EADDFF"/>
  <rect x="284" y="80" width="112" height="112" rx="28" fill="url(#iconGrad)"/>
  <rect x="308" y="100" width="64" height="76" rx="8" fill="url(#pageGrad)"/>
  <polygon points="350,100 372,100 372,122" fill="#B69DF8" opacity="0.9"/>
  <polygon points="350,100 372,122 350,122" fill="#21005E" opacity="0.28"/>
  <rect x="316" y="134" width="36" height="3" rx="1.5" fill="#6750A4" opacity="0.45"/>
  <rect x="316" y="143" width="28" height="3" rx="1.5" fill="#6750A4" opacity="0.35"/>
  <rect x="316" y="152" width="32" height="3" rx="1.5" fill="#6750A4" opacity="0.25"/>
  <rect x="316" y="161" width="22" height="3" rx="1.5" fill="#6750A4" opacity="0.15"/>

  <!-- Pen nib -->
  <g transform="translate(357,158) rotate(-40)">
    <rect x="-3.5" y="-20" width="7" height="20" rx="2.5" fill="#FFB3C8"/>
    <rect x="-3.5" y="-20" width="7" height="5" rx="2" fill="#FF8FAB"/>
    <polygon points="-3.5,0 3.5,0 0,9" fill="#FF6E91"/>
    <line x1="0" y1="-1" x2="0" y2="8" stroke="#BF004A" stroke-width="0.8" opacity="0.5"/>
    <ellipse cx="0" cy="11" rx="2" ry="2.5" fill="#B3261E" opacity="0.75"/>
  </g>

  <!-- WORDMARK -->
  <text x="340" y="243" text-anchor="middle" font-family="'DM Sans','Google Sans','Helvetica Neue',sans-serif" font-size="22" font-weight="200" letter-spacing="12" fill="#6750A4" opacity="0.70">MY</text>
  <text x="340" y="302" text-anchor="middle" font-family="'DM Sans','Google Sans','Helvetica Neue',sans-serif" font-size="66" font-weight="700" letter-spacing="-1.5" fill="#21005E">Note</text>

  <!-- Underline -->
  <rect x="230" y="314" width="200" height="4.5" rx="2.25" fill="#D0BCFF" opacity="0.8"/>
  <rect x="230" y="314" width="116" height="4.5" rx="2.25" fill="#6750A4"/>
  <circle cx="348" cy="316.25" r="3.5" fill="#FFB3C8"/>

  <!-- Divider -->
  <circle cx="224" cy="340" r="2.5" fill="#D0BCFF"/>
  <line x1="230" y1="340" x2="450" y2="340" stroke="#D0BCFF" stroke-width="0.8" stroke-linecap="round"/>
  <circle cx="456" cy="340" r="2.5" fill="#D0BCFF"/>

  <!-- Chip -->
  <rect x="294" y="354" width="92" height="24" rx="12" fill="#E8DEF8"/>
  <text x="340" y="371" text-anchor="middle" font-family="'DM Sans','Google Sans',sans-serif" font-size="10" font-weight="500" letter-spacing="2.5" fill="#4F378B">NOTES</text>

  <!-- Tagline -->
  <text x="340" y="414" text-anchor="middle" font-family="'DM Sans','Google Sans',sans-serif" font-size="11.5" font-weight="300" letter-spacing="3.5" fill="#79747E">Think it. Write it. Keep it.</text>

  <circle cx="340" cy="438" r="3" fill="#D0BCFF"/>
</svg>

<style>
  .google-logo-svg {
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
  }
</style>

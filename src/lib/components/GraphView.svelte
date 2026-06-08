<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '../stores/appState.svelte';

  interface GraphNode {
    id: string;
    label: string;
    path: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
  }

  interface GraphEdge {
    source: string;
    target: string;
  }

  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let containerElement = $state<HTMLDivElement | null>(null);
  
  // Simulation variables
  let nodes = $state<GraphNode[]>([]);
  let edges = $state<GraphEdge[]>([]);
  let width = 300;
  let height = 300;
  
  // Interaction variables
  let zoom = $state(1.0);
  let panX = $state(0);
  let panY = $state(0);
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let draggedNode: GraphNode | null = null;
  let hoveredNode = $state<GraphNode | null>(null);

  // Parse wikilinks reactively from notes
  $effect(() => {
    const newNodes: GraphNode[] = [];
    const newEdges: GraphEdge[] = [];
    
    // Create nodes
    appState.notes.forEach(note => {
      // Find if we already have this node to preserve position
      const old = nodes.find(n => n.path === note.path);
      newNodes.push({
        id: note.path,
        label: note.name,
        path: note.path,
        x: old ? old.x : (Math.random() - 0.5) * 100 + width / 2,
        y: old ? old.y : (Math.random() - 0.5) * 100 + height / 2,
        vx: old ? old.vx : 0,
        vy: old ? old.vy : 0,
        radius: note.path === appState.activeNotePath ? 8 : 5
      });
      
      // Parse [[Wiki-links]]
      const matches = note.content.match(/\[\[(.*?)\]\]/g);
      if (matches) {
        matches.forEach(m => {
          const targetTitle = m.slice(2, -2).trim();
          // Find matching note in workspace
          const targetNote = appState.notes.find(n => n.name.toLowerCase() === targetTitle.toLowerCase());
          if (targetNote) {
            newEdges.push({
              source: note.path,
              target: targetNote.path
            });
          }
        });
      }
    });

    nodes = newNodes;
    edges = newEdges;
  });

  // Simple Force-Directed Graph Simulation Tick
  function tickSimulation() {
    const k = 0.08; // spring constant
    const rep = 800; // repulsion charge
    const centerGravity = 0.01;
    const damping = 0.85;

    // 1. Repulsion between all pairs of nodes
    for (let i = 0; i < nodes.length; i++) {
      const n1 = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const n2 = nodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        if (dist < 250) {
          const force = rep / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          
          if (n1 !== draggedNode) {
            n1.vx -= fx;
            n1.vy -= fy;
          }
          if (n2 !== draggedNode) {
            n2.vx += fx;
            n2.vy += fy;
          }
        }
      }
    }

    // 2. Attraction along edges
    edges.forEach(edge => {
      const n1 = nodes.find(n => n.id === edge.source);
      const n2 = nodes.find(n => n.id === edge.target);
      if (!n1 || !n2) return;

      const dx = n2.x - n1.x;
      const dy = n2.y - n1.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      
      // Target length of spring is 80px
      const force = (dist - 80) * k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (n1 !== draggedNode) {
        n1.vx += fx;
        n1.vy += fy;
      }
      if (n2 !== draggedNode) {
        n2.vx -= fx;
        n2.vy -= fy;
      }
    });

    // 3. Central gravity & Update positions
    nodes.forEach(node => {
      if (node === draggedNode) return;

      const dx = width / 2 - node.x;
      const dy = height / 2 - node.y;
      
      node.vx += dx * centerGravity;
      node.vy += dy * centerGravity;

      node.x += node.vx;
      node.y += node.vy;
      
      // Apply damping
      node.vx *= damping;
      node.vy *= damping;
    });
  }

  // Canvas Drawing
  function draw() {
    if (!canvasElement) return;
    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Background grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = panX % gridSize; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = panY % gridSize; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.save();
    // Apply pan & zoom
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // 1. Draw Links (Edges)
    ctx.lineWidth = 1.5;
    edges.forEach(edge => {
      const n1 = nodes.find(n => n.id === edge.source);
      const n2 = nodes.find(n => n.id === edge.target);
      if (!n1 || !n2) return;

      ctx.beginPath();
      ctx.moveTo(n1.x, n1.y);
      ctx.lineTo(n2.x, n2.y);
      
      // If either node is active note, highlight green link, otherwise gray
      const isHighlighted = n1.path === appState.activeNotePath || n2.path === appState.activeNotePath;
      ctx.strokeStyle = isHighlighted ? 'rgba(30, 215, 96, 0.4)' : '#333333';
      ctx.stroke();
    });

    // 2. Draw Nodes
    nodes.forEach(node => {
      const isActive = node.path === appState.activeNotePath;
      const isHovered = hoveredNode === node;

      // Glow effect for active note
      if (isActive) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = 'var(--accent)';
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, isActive ? 8 : 5, 0, 2 * Math.PI);
      ctx.fillStyle = isActive 
        ? 'var(--accent)' 
        : isHovered 
          ? '#ffffff' 
          : 'var(--text-secondary)';
      ctx.fill();

      // Outline
      ctx.strokeStyle = '#121212';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.shadowBlur = 0; // reset

      // Labels
      ctx.font = isActive ? 'bold 11px var(--font-sans)' : '10px var(--font-sans)';
      ctx.fillStyle = isActive 
        ? '#ffffff' 
        : isHovered 
          ? '#e0e0e0' 
          : 'var(--text-tertiary)';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, node.x, node.y - 12);
    });

    ctx.restore();
  }

  // Animation Loop
  let animationFrameId: number;
  function updateLoop() {
    tickSimulation();
    draw();
    animationFrameId = requestAnimationFrame(updateLoop);
  }

  // Canvas Resize Handler
  function resize() {
    if (containerElement && canvasElement) {
      width = containerElement.clientWidth;
      height = containerElement.clientHeight;
      canvasElement.width = width;
      canvasElement.height = height;
    }
  }

  // Interactivity Handlers
  function getMousePos(e: MouseEvent) {
    if (!canvasElement) return { x: 0, y: 0 };
    const rect = canvasElement.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function toSimCoords(pos: { x: number; y: number }) {
    return {
      x: (pos.x - panX) / zoom,
      y: (pos.y - panY) / zoom
    };
  }

  function handleMouseDown(e: MouseEvent) {
    const mousePos = getMousePos(e);
    const simPos = toSimCoords(mousePos);

    // Check if clicked a node
    const clicked = nodes.find(node => {
      const dx = node.x - simPos.x;
      const dy = node.y - simPos.y;
      return Math.sqrt(dx * dx + dy * dy) < (node.radius + 6);
    });

    if (clicked) {
      draggedNode = clicked;
    } else {
      isDragging = true;
      dragStart = { x: mousePos.x - panX, y: mousePos.y - panY };
    }
  }

  function handleMouseMove(e: MouseEvent) {
    const mousePos = getMousePos(e);
    const simPos = toSimCoords(mousePos);

    if (draggedNode) {
      draggedNode.x = simPos.x;
      draggedNode.y = simPos.y;
    } else if (isDragging) {
      panX = mousePos.x - dragStart.x;
      panY = mousePos.y - dragStart.y;
    }

    // Handle hover states
    hoveredNode = nodes.find(node => {
      const dx = node.x - simPos.x;
      const dy = node.y - simPos.y;
      return Math.sqrt(dx * dx + dy * dy) < (node.radius + 6);
    }) || null;
  }

  function handleMouseUp(e: MouseEvent) {
    if (draggedNode) {
      // If drag was very minor, select the note
      appState.selectNote(draggedNode.path);
      draggedNode = null;
    }
    isDragging = false;
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const mousePos = getMousePos(e);
    const simPosBefore = toSimCoords(mousePos);

    // Zoom factor multiplier
    const zoomIntensity = 0.1;
    if (e.deltaY < 0) {
      zoom = Math.min(zoom * (1 + zoomIntensity), 3.0);
    } else {
      zoom = Math.max(zoom * (1 - zoomIntensity), 0.5);
    }

    // Re-adjust pan to zoom into mouse cursor
    panX = mousePos.x - simPosBefore.x * zoom;
    panY = mousePos.y - simPosBefore.y * zoom;
  }

  onMount(() => {
    resize();
    window.addEventListener('resize', resize);
    
    // Start animation loop
    updateLoop();
    
    // Setup initial center
    panX = width / 6;
    panY = height / 6;

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  });
</script>

<div class="visualizer-container flex-col" bind:this={containerElement}>
  <div class="visualizer-header flex-row">
    <span class="vis-title">NOTE VISUALIZER</span>
    <span class="vis-subtitle">Drag to pan · Scroll to zoom</span>
  </div>
  
  <canvas 
    bind:this={canvasElement}
    onmousedown={handleMouseDown}
    onmousemove={handleMouseMove}
    onmouseup={handleMouseUp}
    onwheel={handleWheel}
  ></canvas>
</div>

<style>
  .visualizer-container {
    width: 280px;
    height: 100%;
    background-color: var(--bg-surface);
    border-left: 1px solid var(--border-color);
    overflow: hidden;
    position: relative;
    flex-shrink: 0;
  }

  .flex-col {
    display: flex;
    flex-direction: column;
  }

  .flex-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .visualizer-header {
    padding: 16px;
    background-color: rgba(24, 24, 24, 0.8);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border-color);
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 5;
    justify-content: space-between;
  }

  .vis-title {
    font-size: 10px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 1px;
  }

  .vis-subtitle {
    font-size: 9px;
    color: var(--text-secondary);
  }

  canvas {
    width: 100%;
    height: 100%;
    cursor: grab;
  }

  canvas:active {
    cursor: grabbing;
  }
</style>

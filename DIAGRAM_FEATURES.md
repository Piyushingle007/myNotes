# Draw.io Integration & Native Feature Implementation Plan

## 📊 Summary

This document outlines the draw.io (diagrams.net) integration options and a comprehensive feature list for native implementation.

**Current Status:**
- ✅ **Draw.io Integration**: Completed - Users can now choose between Native Editor and Draw.io in Settings
- ✅ **Native Editor**: Basic shapes (rect, ellipse, diamond, line, arrow, text, freehand)

---

## 🔗 Integration Approach (COMPLETED)

### How It Works
1. **DrawIOEditor.svelte** - Embeds diagrams.net via iframe
2. **Communication** - Uses postMessage API to send/receive diagram data
3. **Format Conversion** - Converts between our JSON format and draw.io's mxGraph XML
4. **User Preference** - Toggle in Settings → Diagram Editor → Native/Draw.io

### Benefits of Draw.io Integration
- ✅ Full-featured professional diagramming
- ✅ All shape libraries (UML, BPMN, AWS, etc.)
- ✅ Smart connectors with routing
- ✅ Layers and groups
- ✅ No development needed for advanced features

### Limitations
- ⚠️ Requires internet connection
- ⚠️ External dependency
- ⚠️ Format conversion may lose some details
- ⚠️ Different UX from native app

---

## 🎨 Native Editor Current Features

| Feature | Status | Notes |
|---------|--------|-------|
| Rectangle | ✅ | With rounded corners |
| Ellipse | ✅ | |
| Diamond | ✅ | |
| Line | ✅ | |
| Arrow | ✅ | Single arrowhead |
| Text | ✅ | Multi-line support |
| Freehand Drawing | ✅ | Pen tool |
| Stroke Color | ✅ | 10 presets + custom |
| Fill Color | ✅ | 10 presets |
| Stroke Width | ✅ | 1, 2, 4, 6 px |
| Selection | ✅ | Click to select |
| Move | ✅ | Drag to reposition |
| Resize | ✅ | Corner handles |
| Delete | ✅ | Del key or button |
| Z-Order | ✅ | Bring forward/send backward |
| Grid | ✅ | Visual guide |
| Zoom | ❌ | Not implemented |
| Undo/Redo | ❌ | Not implemented |
| Copy/Paste | ❌ | Not implemented |
| Multi-select | ❌ | Not implemented |

---

## 📋 Draw.io Features to Implement Natively

Below is a prioritized list of all draw.io features grouped by category.

### 🔷 Priority 1: Essential (High Impact, Medium Effort)

#### 1.1 Additional Basic Shapes
```
- [ ] Rounded Rectangle (adjustable radius)
- [ ] Triangle
- [ ] Pentagon
- [ ] Hexagon
- [ ] Star (5-point, 6-point)
- [ ] Parallelogram
- [ ] Trapezoid
- [ ] Cloud shape
- [ ] Cylinder (database)
- [ ] Document shape
- [ ] Callout/Speech bubble
```

#### 1.2 Connectors & Lines
```
- [ ] Curved connectors (Bezier)
- [ ] Orthogonal connectors (right-angle routing)
- [ ] Multiple arrow styles:
    - [ ] Classic arrow
    - [ ] Diamond (filled/open)
    - [ ] Circle (filled/open)
    - [ ] Dash arrow
    - [ ] None
- [ ] Bidirectional arrows
- [ ] Dashed/dotted lines
- [ ] Connection points (anchors on shapes)
- [ ] Auto-routing around shapes
```

#### 1.3 Core Editing
```
- [ ] Undo/Redo stack
- [ ] Copy/Paste (Ctrl+C/V)
- [ ] Duplicate shape (Ctrl+D)
- [ ] Multi-select (Shift+click or rubber band)
- [ ] Group/Ungroup shapes
- [ ] Lock/Unlock shapes
- [ ] Snap to grid (optional)
- [ ] Guides & alignment aids
```

### 🔷 Priority 2: Enhanced UX (Medium Impact, Medium Effort)

#### 2.1 Canvas Controls
```
- [ ] Zoom in/out (scroll wheel + buttons)
- [ ] Pan/drag canvas
- [ ] Fit to window
- [ ] Zoom to selection
- [ ] Minimap navigator
- [ ] Grid toggle (show/hide)
- [ ] Grid size settings
```

#### 2.2 Shape Styling
```
- [ ] Gradient fills
- [ ] Pattern fills (diagonal lines, dots)
- [ ] Opacity/transparency slider
- [ ] Shadow (drop shadow, inner shadow)
- [ ] Rounded corners slider
- [ ] Border radius per-corner
- [ ] Double stroke/outline
```

#### 2.3 Text Enhancements
```
- [ ] Text inside shapes (not separate)
- [ ] Text alignment (left/center/right)
- [ ] Vertical alignment (top/middle/bottom)
- [ ] Word wrap in shapes
- [ ] Font selection (limited set)
- [ ] Bold/italic/underline
- [ ] Text color separate from stroke
- [ ] Connector labels
```

#### 2.4 Alignment & Distribution
```
- [ ] Align left/center/right
- [ ] Align top/middle/bottom
- [ ] Distribute horizontally
- [ ] Distribute vertically
- [ ] Match width/height
- [ ] Align to grid
```

### 🔷 Priority 3: Advanced Features (Lower Priority, Higher Effort)

#### 3.1 Flowchart Shapes
```
- [ ] Process (rectangle)
- [ ] Decision (diamond) ✅ Have
- [ ] Terminator (rounded ends)
- [ ] Data (parallelogram)
- [ ] Document shape
- [ ] Multi-document
- [ ] Predefined process
- [ ] Manual input
- [ ] Manual operation
- [ ] Preparation
- [ ] Display
- [ ] Loop limit
- [ ] Stored data
- [ ] Merge
- [ ] Or
- [ ] Summing junction
```

#### 3.2 UML Shapes
```
- [ ] Class box (with compartments)
- [ ] Interface
- [ ] Package
- [ ] Object
- [ ] Component
- [ ] Node
- [ ] Use case (ellipse) ✅ Have
- [ ] Actor (stick figure)
- [ ] Lifeline
- [ ] Activation bar
- [ ] Note
```

#### 3.3 ER Diagram Shapes
```
- [ ] Entity (rectangle)
- [ ] Weak entity (double rectangle)
- [ ] Relationship (diamond)
- [ ] Attribute (ellipse)
- [ ] Derived attribute (dashed ellipse)
- [ ] Multivalued attribute (double ellipse)
- [ ] Primary key (underlined)
```

#### 3.4 Network/Architecture Shapes
```
- [ ] Server
- [ ] Client/Desktop
- [ ] Mobile device
- [ ] Router
- [ ] Switch
- [ ] Firewall
- [ ] Cloud
- [ ] Database cylinder
- [ ] Load balancer
- [ ] User icon
```

### 🔷 Priority 4: Advanced Professional (Optional)

#### 4.1 Layers
```
- [ ] Multiple layers
- [ ] Layer visibility toggle
- [ ] Layer lock
- [ ] Layer reordering
- [ ] Move shapes between layers
```

#### 4.2 Images & Icons
```
- [ ] Insert image from file
- [ ] Insert image from URL
- [ ] Crop/resize images
- [ ] Icon library (basic set)
- [ ] SVG import
```

#### 4.3 Containers & Swimlanes
```
- [ ] Container shape (holds children)
- [ ] Collapsible containers
- [ ] Swimlane pool
- [ ] Vertical/horizontal swimlanes
```

#### 4.4 Export Options
```
- [ ] Export as PNG (current SVG can be converted)
- [ ] Export as SVG ✅ (already rendering SVG)
- [ ] Export as PDF
- [ ] Copy as image to clipboard
- [ ] Export as JSON (native format)
```

---

## 🛠 Implementation Recommendations

### Quick Wins (Can implement immediately)
1. **Undo/Redo** - Track shape changes in a history stack
2. **Copy/Paste** - Clipboard API
3. **Multi-select** - Modify selection to be array-based
4. **More shapes** - Just add render cases for triangle, star, etc.
5. **Dashed lines** - SVG `stroke-dasharray` attribute

### Example: Adding Triangle Shape

```typescript
// In diagram.ts
export type DiagramShapeType =
  | 'rect' | 'ellipse' | 'diamond' | 'text' | 'line' | 'arrow' | 'draw'
  | 'triangle' // Add new type
  | 'star'
  | 'hexagon';

// In renderShape()
case 'triangle': {
  const points = `${s.x + s.w/2},${s.y} ${s.x + s.w},${s.y + s.h} ${s.x},${s.y + s.h}`;
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
```

### Example: Add Undo/Redo

```typescript
// In DiagramEditor.svelte
let history = $state<DiagramShape[][]>([]);
let historyIndex = $state(-1);

function pushHistory() {
  history = [...history.slice(0, historyIndex + 1), structuredClone(shapes)];
  historyIndex = history.length - 1;
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    shapes = structuredClone(history[historyIndex]);
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    shapes = structuredClone(history[historyIndex]);
  }
}
```

---

## 📊 Comparison Matrix

| Feature | Draw.io | Native (Current) | Native (Planned) |
|---------|---------|------------------|------------------|
| Basic Shapes | 100+ | 6 | 20+ |
| Connectors | Smart routing | Simple lines | Bezier + orthogonal |
| Styling | Full | Basic | Enhanced |
| Layers | ✅ | ❌ | Optional |
| UML/BPMN | ✅ | ❌ | Partial |
| Offline | ❌ | ✅ | ✅ |
| Speed | Medium | Fast | Fast |
| File Size | Larger | Small | Small |
| Learning Curve | Steeper | Easy | Easy |

---

## 🚀 Next Steps

1. **Use Draw.io** for complex professional diagrams (UML, BPMN, architecture)
2. **Enhance Native** for quick sketches and simple flowcharts
3. **Implement Priority 1** features first for best ROI
4. **Consider hybrid** - Use native for new diagrams, draw.io for editing complex imported ones

---

*Document generated: June 2025*


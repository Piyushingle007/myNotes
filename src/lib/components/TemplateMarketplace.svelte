<script lang="ts">
  import { appState } from '../stores/appState.svelte';

  interface Template {
    id: string;
    title: string;
    description: string;
    icon: string;
    category: string;
    content: string;
  }

  const templates: Template[] = [
    {
      id: 'meeting',
      title: 'Meeting Notes',
      description: 'Document agendas, discussions, and assign action items.',
      icon: '📝',
      category: 'Work',
      content: `# Meeting Notes: Project Sync\n\n**Date:** \${new Date().toLocaleDateString()}\n**Attendees:** \n\n## Agenda\n- [ ] Review current progress\n- [ ] Discuss blockers\n- [ ] Align on next deliverables\n\n## Discussion Notes\n- \n\n## Action Items\n- [ ] @name - Follow up on tasks`
    },
    {
      id: 'journal',
      title: 'Daily Journal',
      description: 'Reflect on your day, record gratitude, and plan ahead.',
      icon: '📓',
      category: 'Personal',
      content: `# Daily Reflection: \${new Date().toLocaleDateString()}\n\n## Gratitude\n1. \n2. \n3. \n\n## Achievements Today\n- \n\n## Learnings & Blockers\n- \n\n## Focus for Tomorrow\n- [ ] `
    },
    {
      id: 'weekly',
      title: 'Weekly Planner',
      description: 'Set objectives, outline schedule, and track tasks.',
      icon: '🗓️',
      category: 'Productivity',
      content: `# Weekly Planner: Week of \${new Date().toLocaleDateString()}\n\n## Goals this Week\n- [ ] Goal 1\n- [ ] Goal 2\n\n## Schedule\n- **Monday:** \n- **Tuesday:** \n- **Wednesday:** \n- **Thursday:** \n- **Friday:** \n\n## Tasks Checklist\n- [ ] Task A\n- [ ] Task B`
    },
    {
      id: 'spec',
      title: 'Technical Spec',
      description: 'Write software design, objectives, and implementation plans.',
      icon: '🛠️',
      category: 'Development',
      content: `# Technical Spec: Feature Name\n\n**Author:** \n**Status:** Draft\n**Date:** \n\n## 1. Objective\nDescribe the problem, context, and goals of this project.\n\n## 2. Design & Architecture\nOutline system components and data flows.\n\n## 3. Implementation Details\nList files, schemas, APIs, and key changes.\n\n## 4. Verification\n- [ ] Run unit tests\n- [ ] Manual test validation`
    },
    {
      id: 'blog',
      title: 'Blog Draft',
      description: 'Structure writing for blog posts or articles.',
      icon: '✍️',
      category: 'Creative',
      content: `# Article: Title Here\n\n**Date:** \n**Tags:** #writing #draft\n\n## Hook / Summary\n[Introduce the article and hook the reader]\n\n## Point 1\n[Details...]\n\n## Point 2\n[Details...]\n\n## Conclusion & CTA\n[Wrap up and call to action]`
    },
    {
      id: 'checklist',
      title: 'Project Checklist',
      description: 'Organize tasks into structured phase checkboxes.',
      icon: '✅',
      category: 'Productivity',
      content: `# Project checklist: Untitled\n\n## Phase 1: Planning\n- [ ] Gather requirements\n- [ ] Design mockup\n\n## Phase 2: Core Development\n- [ ] Initialize repository\n- [ ] Create layout\n- [ ] Implement local state\n\n## Phase 3: Launch\n- [ ] Verify build compiles\n- [ ] Deploy to web server`
    }
  ];

  let selectedCategory = $state<string>('All');
  const categories = ['All', 'Work', 'Productivity', 'Personal', 'Development', 'Creative'];

  const filteredTemplates = $derived.by(() => {
    if (selectedCategory === 'All') return templates;
    return templates.filter(t => t.category === selectedCategory);
  });

  async function useTemplate(template: Template) {
    const title = prompt(`Enter title for your ${template.title}:`, template.title);
    if (title === null) return;
    
    // Evaluate date templates dynamically
    let parsedContent = template.content;
    if (template.id === 'meeting' || template.id === 'journal' || template.id === 'weekly') {
      const today = new Date().toLocaleDateString();
      parsedContent = template.content.replace('${new Date().toLocaleDateString()}', today);
    }
    
    const folder = template.category === 'Work' || template.category === 'Development' ? 'Work' : null;
    if (folder) {
      await appState.storage.createDirectory(folder);
    }

    const cleanTitle = title.trim() || template.title;
    let path = folder ? `${folder}/${cleanTitle}.md` : `${cleanTitle}.md`;

    // Ensure unique path
    let version = 1;
    let finalPath = path;
    while (appState.notes.some(n => n.path === finalPath)) {
      finalPath = folder 
        ? `${folder}/${cleanTitle} (${version}).md`
        : `${cleanTitle} (${version}).md`;
      version++;
    }

    await appState.storage.writeNote(finalPath, parsedContent);
    await appState.refreshNotes();
    appState.selectNote(finalPath);
  }
</script>

<div class="template-container">
  <div class="header-section">
    <h1 class="title">Template Library</h1>
    <p class="subtitle">Kickstart your next note or document with one of our pre-built premium markdown structures.</p>
  </div>

  <!-- Filter chips -->
  <div class="filter-chips">
    {#each categories as cat}
      <button 
        class="chip" 
        class:active={selectedCategory === cat}
        onclick={() => selectedCategory = cat}
      >
        {cat}
      </button>
    {/each}
  </div>

  <!-- Templates Grid -->
  <div class="templates-grid">
    {#each filteredTemplates as temp (temp.id)}
      <div class="md3-card-outlined template-card" onclick={() => useTemplate(temp)}>
        <div class="card-icon">{temp.icon}</div>
        <div class="card-body">
          <span class="category-tag">{temp.category}</span>
          <h3 class="card-title">{temp.title}</h3>
          <p class="card-desc">{temp.description}</p>
        </div>
        <button class="md3-btn md3-btn-tonal use-btn">Use Template</button>
      </div>
    {/each}
  </div>
</div>

<style>
  .template-container {
    padding: 32px;
    max-width: 1200px;
    margin: 0 auto;
    overflow-y: auto;
    height: 100%;
    animation: fadeIn 0.3s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .header-section {
    margin-bottom: 28px;
  }

  .title {
    font-family: var(--font-sans);
    font-size: 32px;
    font-weight: 800;
    margin-bottom: 6px;
    letter-spacing: -0.5px;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 15px;
  }

  /* Filter Chips */
  .filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 32px;
  }

  .chip {
    padding: 6px 16px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-color);
    background-color: var(--bg-surface);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    transition: var(--transition-fast);
  }

  .chip:hover {
    background-color: rgba(120, 120, 120, 0.05);
    border-color: var(--text-tertiary);
  }

  .chip.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
    border-color: transparent;
  }

  /* Grid layout */
  .templates-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 20px;
  }

  .template-card {
    cursor: pointer;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 24px;
    height: 250px;
    position: relative;
    transition: var(--transition-standard);
  }

  .template-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lvl3);
  }

  .card-icon {
    font-size: 36px;
    margin-bottom: 12px;
  }

  .card-body {
    flex-grow: 1;
    margin-bottom: 16px;
  }

  .category-tag {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--primary);
    font-weight: 700;
  }

  .card-title {
    font-size: 18px;
    font-weight: 700;
    margin: 4px 0 6px 0;
    color: var(--text-primary);
  }

  .card-desc {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .use-btn {
    width: 100%;
  }

  @media (max-width: 768px) {
    .template-container {
      padding: 16px;
    }
    .title {
      font-size: 26px;
    }
    .templates-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

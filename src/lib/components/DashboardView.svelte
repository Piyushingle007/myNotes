<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  
  // Calculate total word count
  const totalWords = $derived.by(() => {
    let count = 0;
    appState.notes.forEach(note => {
      const words = note.content.trim().split(/\s+/).filter(Boolean).length;
      count += words;
    });
    return count;
  });

  // Calculate streak (consecutive days with notes in the last week, mock or calculated)
  const streak = $derived.by(() => {
    // Basic streak calculation: count how many of the last 30 days have a note modified
    const dates = new Set<string>();
    appState.notes.forEach(note => {
      const d = new Date(note.modified).toISOString().split('T')[0];
      dates.add(d);
    });
    
    let currentStreak = 0;
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(today.getDate() - i);
      const dString = checkDate.toISOString().split('T')[0];
      if (dates.has(dString)) {
        currentStreak++;
      } else if (i === 0) {
        // Allow no notes today yet, check yesterday
        continue;
      } else {
        break;
      }
    }
    return currentStreak;
  });

  // Quick Action Handlers
  function handleNewNote() {
    const name = prompt('Enter note title:', 'Untitled Note');
    if (name !== null) {
      appState.createNote(name);
    }
  }

  function handleDailyLog() {
    appState.createDailyNote();
  }

  function goToTemplates() {
    appState.activeTab = 'templates';
  }

  function openNote(path: string) {
    appState.selectNote(path);
  }

  // Format date
  function formatDate(timestamp: number) {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
</script>

<div class="dashboard-container">
  <div class="header-section">
    <span class="md3-label-large date-badge">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
    <h1 class="welcome-title">Welcome to your workspace</h1>
    <p class="subtitle">Capture your thoughts, plan tasks, and organize ideas beautifully.</p>
  </div>

  <!-- Stats Grid -->
  <div class="stats-grid">
    <div class="md3-card-filled stat-card">
      <div class="stat-icon">📄</div>
      <div class="stat-info">
        <span class="stat-val">{appState.notes.length}</span>
        <span class="stat-label">Total Notes</span>
      </div>
    </div>
    <div class="md3-card-filled stat-card">
      <div class="stat-icon">✍️</div>
      <div class="stat-info">
        <span class="stat-val">{totalWords}</span>
        <span class="stat-label">Words Written</span>
      </div>
    </div>
    <div class="md3-card-filled stat-card">
      <div class="stat-icon">🔥</div>
      <div class="stat-info">
        <span class="stat-val">{streak} day{streak === 1 ? '' : 's'}</span>
        <span class="stat-label">Writing Streak</span>
      </div>
    </div>
    <div class="md3-card-filled stat-card sync-status-card">
      <div class="stat-icon">☁️</div>
      <div class="stat-info">
        <span class="stat-val status-text {appState.syncStatus}">
          {appState.googleConnected ? 'Synced' : 'Offline'}
        </span>
        <span class="stat-label">
          {appState.googleConnected ? appState.googleUserEmail : 'Google Drive Disconnected'}
        </span>
      </div>
    </div>
  </div>

  <!-- Quick Actions Section -->
  <div class="actions-section">
    <h2 class="section-title">Quick Actions</h2>
    <div class="actions-grid">
      <button class="md3-btn" onclick={handleNewNote}>
        <span class="icon">+</span> Create New Note
      </button>
      <button class="md3-btn md3-btn-tonal" onclick={handleDailyLog}>
        <span class="icon">🗓️</span> Daily Log Entry
      </button>
      <button class="md3-btn md3-btn-outlined" onclick={goToTemplates}>
        <span class="icon">✨</span> Browse Templates
      </button>
    </div>
  </div>

  <!-- Main Content Layout (Pinned & Recents) -->
  <div class="main-dashboard-layout">
    <!-- Pinned Notes -->
    <div class="dashboard-block">
      <div class="block-header">
        <h2 class="section-title">Pinned Notes</h2>
        <span class="badge">{appState.pinnedNotes.length}</span>
      </div>
      
      {#if appState.pinnedNotes.length === 0}
        <div class="md3-card-outlined empty-state">
          <p class="empty-text">No notes pinned yet. Pin notes from the document list to access them quickly here.</p>
        </div>
      {:else}
        <div class="notes-grid">
          {#each appState.pinnedNotes as note (note.path)}
            <div class="md3-card-outlined note-card" onclick={() => openNote(note.path)}>
              <div class="note-card-header">
                <span class="note-title">{note.name.replace(/\.md$/, '')}</span>
                <button class="pin-btn active" onclick={(e) => { e.stopPropagation(); appState.togglePin(note.path); }}>📌</button>
              </div>
              <p class="note-preview">{note.content.substring(0, 100) || 'Empty note...'}</p>
              <div class="note-meta">
                <span class="note-path">{note.path}</span>
                <span class="note-time">{formatDate(note.modified)}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Recent Notes -->
    <div class="dashboard-block">
      <div class="block-header">
        <h2 class="section-title">Recent Documents</h2>
      </div>
      
      {#if appState.recentNotes.length === 0}
        <div class="md3-card-outlined empty-state">
          <p class="empty-text">No notes created yet. Start typing to see your history!</p>
        </div>
      {:else}
        <div class="notes-grid">
          {#each appState.recentNotes as note (note.path)}
            <div class="md3-card-outlined note-card" onclick={() => openNote(note.path)}>
              <div class="note-card-header">
                <span class="note-title">{note.name.replace(/\.md$/, '')}</span>
                <button 
                  class="pin-btn" 
                  class:active={appState.pinnedPaths.includes(note.path)}
                  onclick={(e) => { e.stopPropagation(); appState.togglePin(note.path); }}
                >
                  📌
                </button>
              </div>
              <p class="note-preview">{note.content.substring(0, 100) || 'Empty note...'}</p>
              <div class="note-meta">
                <span class="note-path">{note.path}</span>
                <span class="note-time">{formatDate(note.modified)}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .dashboard-container {
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
    margin-bottom: 32px;
  }

  .date-badge {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
    padding: 6px 14px;
    border-radius: var(--radius-full);
    display: inline-block;
    margin-bottom: 12px;
    font-weight: 600;
  }

  .welcome-title {
    font-family: var(--font-sans);
    font-size: 36px;
    font-weight: 800;
    color: var(--text-primary);
    line-height: 1.2;
    margin-bottom: 8px;
    letter-spacing: -0.5px;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 16px;
  }

  /* Stats Cards */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
    margin-bottom: 36px;
  }

  .stat-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    border-radius: var(--radius-l);
  }

  .stat-icon {
    font-size: 28px;
    background: rgba(120, 120, 120, 0.08);
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-m);
  }

  .stat-info {
    display: flex;
    flex-direction: column;
  }

  .stat-val {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .stat-label {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .status-text.syncing {
    color: var(--semantic-info);
  }
  .status-text.idle {
    color: var(--semantic-success);
  }
  .status-text.error {
    color: var(--semantic-error);
  }

  /* Quick Actions */
  .actions-section {
    margin-bottom: 40px;
  }

  .section-title {
    font-family: var(--font-sans);
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 16px;
    color: var(--text-primary);
    letter-spacing: -0.2px;
  }

  .actions-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  /* Dashboard Grid */
  .main-dashboard-layout {
    display: flex;
    flex-direction: column;
    gap: 36px;
  }

  .block-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }

  .badge {
    background-color: var(--bg-surface-variant);
    color: var(--text-secondary);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: 12px;
    font-weight: 600;
  }

  .empty-state {
    padding: 32px;
    text-align: center;
    color: var(--text-tertiary);
  }

  .notes-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .note-card {
    cursor: pointer;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: 180px;
    position: relative;
    padding: 18px;
  }

  .note-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8px;
  }

  .note-title {
    font-weight: 600;
    font-size: 16px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80%;
  }

  .pin-btn {
    opacity: 0.3;
    transition: var(--transition-fast);
    font-size: 14px;
  }

  .note-card:hover .pin-btn, .pin-btn.active {
    opacity: 1;
  }

  .note-preview {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    flex-grow: 1;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    margin-bottom: 12px;
  }

  .note-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .note-path {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 50%;
  }

  @media (max-width: 768px) {
    .dashboard-container {
      padding: 16px;
    }
    .welcome-title {
      font-size: 28px;
    }
    .stats-grid {
      grid-template-columns: 1fr;
    }
    .actions-grid {
      flex-direction: column;
      width: 100%;
    }
    .actions-grid button {
      width: 100%;
    }
    .notes-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

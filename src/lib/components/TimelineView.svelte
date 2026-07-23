<script lang="ts">
  import { appState } from '../stores/appState.svelte';
  import { ReminderService, type ParsedDate } from '../services/ReminderService';
  import { Calendar, Clock, ChevronRight, FileText } from 'lucide-svelte';
  
  let dates = $derived.by(() => {
    return ReminderService.scanNotesForDates(appState.notes);
  });
  
  let upcomingDates = $derived(dates.filter(d => d.date.getTime() >= Date.now()));
  let pastDates = $derived(dates.filter(d => d.date.getTime() < Date.now()).reverse());
  
  let onThisDayDates = $derived(dates.filter(d => {
    const today = new Date();
    return d.date.getMonth() === today.getMonth() && 
           d.date.getDate() === today.getDate() && 
           d.date.getFullYear() !== today.getFullYear();
  }));
  
  function getNoteTitle(noteId: string): string {
    const note = appState.notes.find(n => n.id === noteId);
    return note?.title || 'Untitled Note';
  }
  
  function openNote(noteId: string) {
    const note = appState.notes.find(n => n.id === noteId);
    if (note) {
      appState.activeNote = note;
      appState.activeTab = 'home';
    }
  }

  function formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date);
  }
  
  function formatTime(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }
</script>

<div class="timeline-view">
  <div class="header">
    <Calendar size={20} class="icon" />
    <h2>Timeline</h2>
  </div>

  <div class="sections">
    <section class="timeline-section upcoming">
      <h3>Upcoming</h3>
      {#if upcomingDates.length === 0}
        <div class="empty-state">No upcoming dates found in your notes.</div>
      {:else}
        <div class="timeline">
          {#each upcomingDates as item}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="timeline-item">
              <div class="date-column">
                <span class="day">{formatDate(item.date)}</span>
                <span class="time">{formatTime(item.date)}</span>
              </div>
              <div class="content-column" onclick={() => openNote(item.noteId)}>
                <div class="text-match">"{item.text}"</div>
                <div class="note-ref">
                  <FileText size={12} />
                  <span>{getNoteTitle(item.noteId)}</span>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="timeline-section past">
      <h3>Past</h3>
      {#if pastDates.length === 0}
        <div class="empty-state">No past dates found.</div>
      {:else}
        <div class="timeline">
          {#each pastDates as item}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="timeline-item past-item">
              <div class="date-column">
                <span class="day">{formatDate(item.date)}</span>
                <span class="time">{formatTime(item.date)}</span>
              </div>
              <div class="content-column" onclick={() => openNote(item.noteId)}>
                <div class="text-match">"{item.text}"</div>
                <div class="note-ref">
                  <FileText size={12} />
                  <span>{getNoteTitle(item.noteId)}</span>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    {#if onThisDayDates.length > 0}
      <section class="timeline-section on-this-day">
        <h3>On This Day</h3>
        <div class="timeline">
          {#each onThisDayDates as item}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="timeline-item">
              <div class="date-column">
                <span class="day">{formatDate(item.date)}</span>
                <span class="time">{item.date.getFullYear()}</span>
              </div>
              <div class="content-column" onclick={() => openNote(item.noteId)}>
                <div class="text-match">"{item.text}"</div>
                <div class="note-ref">
                  <FileText size={12} />
                  <span>{getNoteTitle(item.noteId)}</span>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .timeline-view {
    padding: var(--spacing-md);
    height: 100%;
    overflow-y: auto;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-xl);
  }

  .header h2 {
    font-size: var(--font-size-xl);
    font-weight: 700;
    margin: 0;
  }

  .header .icon {
    color: var(--accent);
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2xl);
  }

  .timeline-section h3 {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
    padding-bottom: var(--spacing-2xs);
  }

  .empty-state {
    color: var(--text-tertiary);
    font-style: italic;
    font-size: var(--font-size-sm);
    padding: var(--spacing-md) 0;
  }

  .timeline {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    position: relative;
  }

  .timeline::before {
    content: '';
    position: absolute;
    left: 110px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--border-color);
  }

  .timeline-item {
    display: flex;
    gap: var(--spacing-lg);
    position: relative;
    padding: var(--spacing-xs) 0;
  }

  .timeline-item::after {
    content: '';
    position: absolute;
    left: 106px;
    top: 16px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg-primary);
  }

  .past-item::after {
    background: var(--text-tertiary);
  }

  .date-column {
    width: 90px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
    padding-top: 4px;
  }

  .date-column .day {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .date-column .time {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .content-column {
    flex: 1;
    background: var(--bg-secondary);
    padding: var(--spacing-sm);
    border-radius: var(--radius-standard);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: all var(--motion-duration-fast);
  }

  .content-column:hover {
    border-color: var(--border-highlight);
    background: var(--bg-hover);
    transform: translateY(-2px);
  }

  .text-match {
    font-size: var(--font-size-base);
    font-weight: 500;
    margin-bottom: var(--spacing-2xs);
    color: var(--text-primary);
  }

  .note-ref {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .past-item .content-column {
    opacity: 0.7;
  }
</style>

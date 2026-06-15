<script lang="ts">
	import { appState } from '../stores/appState.svelte';
	import {
		type TaskData,
		type TaskGroup,
		formatDueDate,
		isOverdue,
		isDueToday,
		priorityRank,
		priorityLabel,
		priorityColor,
		dueDateColor,
		getTaskGroup,
		GROUP_LABELS,
		GROUP_ORDER,
		todayStr,
		tomorrowStr,
	} from '../utils/taskTypes';

	// ── Reactive State ──
	let hideCompleted = $state(true);
	let sortBy = $state<'due' | 'priority' | 'note'>('due');

	// Refresh tasks from all notes when view mounts or notes change
	$effect(() => {
		// Track notes array so we re-extract when notes change
		const _ = appState.notes.length;
		appState.refreshTasks();
	});

	// ── Filtered & Sorted Tasks ──
	const filtered = $derived.by(() => {
		let list = appState.allTasks.slice();
		if (hideCompleted) list = list.filter(t => !t.completed);

		list.sort((a, b) => {
			// Completed always last
			if (a.completed !== b.completed) return a.completed ? 1 : -1;

			if (sortBy === 'priority') {
				const d = priorityRank(a.priority) - priorityRank(b.priority);
				if (d) return d;
			} else if (sortBy === 'note') {
				const d = a.noteTitle.localeCompare(b.noteTitle);
				if (d) return d;
			} else {
				// Sort by due date
				const ad = a.dueDate ?? '9999-99-99';
				const bd = b.dueDate ?? '9999-99-99';
				if (ad !== bd) return ad < bd ? -1 : 1;
			}
			return a.text.localeCompare(b.text);
		});
		return list;
	});

	// ── Group tasks ──
	const grouped = $derived.by(() => {
		const groups = new Map<TaskGroup, TaskData[]>();
		for (const g of GROUP_ORDER) groups.set(g, []);
		for (const task of filtered) {
			const group = getTaskGroup(task);
			groups.get(group)!.push(task);
		}
		return groups;
	});

	const openCount = $derived(appState.allTasks.filter(t => !t.completed).length);
	const totalCount = $derived(appState.allTasks.length);

	// ── Navigate to note ──
	function openTaskNote(task: TaskData) {
		appState.selectNote(task.notePath);
		appState.activeTab = 'home';
	}

	// ── Toggle task in note ──
	// This is a read-only view — toggling requires modifying the note content.
	// For now, clicking navigates to the note where the user can toggle directly.
</script>

<div class="tasks-view">
	<!-- Header -->
	<div class="tasks-header">
		<div class="tasks-title-row">
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
				<polyline points="22 4 12 14.01 9 11.01"/>
			</svg>
			<h2>Tasks</h2>
			{#if openCount > 0}
				<span class="tasks-badge">{openCount}</span>
			{/if}
		</div>
		<p class="tasks-subtitle">{totalCount} task{totalCount !== 1 ? 's' : ''} across all notes</p>
	</div>

	<!-- Controls -->
	<div class="tasks-controls">
		<button
			class="tasks-ctl"
			class:active={hideCompleted}
			onclick={() => (hideCompleted = !hideCompleted)}
			title="Hide completed tasks"
		>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				{#if hideCompleted}
					<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
					<line x1="1" y1="1" x2="23" y2="23"/>
				{:else}
					<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
					<circle cx="12" cy="12" r="3"/>
				{/if}
			</svg>
			Hide done
		</button>

		<div class="tasks-sort">
			<span class="sort-label">Sort:</span>
			{#each [['due', 'Due Date'], ['priority', 'Priority'], ['note', 'Note']] as [v, label]}
				<button
					class="tasks-ctl"
					class:active={sortBy === v}
					onclick={() => (sortBy = v as 'due' | 'priority' | 'note')}
				>{label}</button>
			{/each}
		</div>
	</div>

	<!-- Task List -->
	<div class="tasks-list">
		{#if filtered.length === 0}
			<div class="tasks-empty">
				<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
					<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
					<polyline points="22 4 12 14.01 9 11.01"/>
				</svg>
				<p>
					{#if openCount === 0 && totalCount > 0}
						All tasks completed! 🎉
					{:else}
						No tasks yet. Use the task list button in the editor toolbar to add tasks to your notes.
					{/if}
				</p>
			</div>
		{:else}
			{#each GROUP_ORDER as group}
				{@const tasks = grouped.get(group) ?? []}
				{#if tasks.length > 0}
					<div class="task-group">
						<div class="task-group-header">
							<span class="group-label">{GROUP_LABELS[group]}</span>
							<span class="group-count">{tasks.length}</span>
						</div>
						{#each tasks as task (task.id)}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="task-row"
								class:done={task.completed}
								class:overdue={isOverdue(task.dueDate) && !task.completed}
								onclick={() => openTaskNote(task)}
							>
								<div class="task-check-col">
									<span
										class="task-check"
										class:checked={task.completed}
									></span>
								</div>
								<div class="task-content">
									<div class="task-text-row">
										{#if task.priority}
											<span
												class="task-priority-dot"
												style="background: {priorityColor(task.priority)}"
												title="{priorityLabel(task.priority)} priority"
											></span>
										{/if}
										<span class="task-text">{task.text}</span>
										{#if task.flagged}
											<svg class="task-flag" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
												<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
												<line x1="4" y1="22" x2="4" y2="15" stroke="currentColor" stroke-width="2"/>
											</svg>
										{/if}
									</div>
									<div class="task-meta-row">
										{#if task.dueDate}
											<span
												class="task-due-badge"
												style="color: {dueDateColor(task.dueDate)}"
											>
												<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
													<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
													<line x1="16" y1="2" x2="16" y2="6"/>
													<line x1="8" y1="2" x2="8" y2="6"/>
													<line x1="3" y1="10" x2="21" y2="10"/>
												</svg>
												{formatDueDate(task.dueDate)}
											</span>
										{/if}
										{#if task.priority}
											<span class="task-priority-label" style="color: {priorityColor(task.priority)}">
												{priorityLabel(task.priority)}
											</span>
										{/if}
										<span class="task-note-link">
											<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
												<polyline points="14 2 14 8 20 8"/>
											</svg>
											{task.noteTitle}
										</span>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{/each}
		{/if}
	</div>
</div>

<style>
	.tasks-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		background: var(--bg-primary, #111317);
	}

	/* ── Header ── */
	.tasks-header {
		padding: 20px 24px 12px;
		flex-shrink: 0;
	}
	.tasks-title-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.tasks-title-row svg {
		color: var(--accent, #00adb5);
		opacity: 0.9;
	}
	.tasks-title-row h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary, #fff);
		letter-spacing: -0.3px;
	}
	.tasks-badge {
		background: var(--accent, #00adb5);
		color: #fff;
		font-size: 11px;
		font-weight: 700;
		padding: 1px 7px;
		border-radius: 10px;
		min-width: 18px;
		text-align: center;
	}
	.tasks-subtitle {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--text-muted, #888);
		padding-left: 32px;
	}

	/* ── Controls ── */
	.tasks-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 24px 12px;
		flex-shrink: 0;
		flex-wrap: wrap;
	}
	.tasks-sort {
		display: flex;
		gap: 4px;
		margin-left: auto;
		align-items: center;
	}
	.sort-label {
		font-size: 11px;
		color: var(--text-muted, #888);
		margin-right: 2px;
	}
	.tasks-ctl {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		border: 1px solid var(--border-color, rgba(255,255,255,0.08));
		border-radius: 6px;
		background: var(--bg-secondary, rgba(255,255,255,0.04));
		color: var(--text-secondary, #aaa);
		font-size: 12px;
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
	}
	.tasks-ctl:hover {
		background: var(--bg-hover, rgba(255,255,255,0.08));
		color: var(--text-primary, #fff);
	}
	.tasks-ctl.active {
		background: var(--accent, #00adb5);
		color: #fff;
		border-color: var(--accent, #00adb5);
	}

	/* ── Task List ── */
	.tasks-list {
		flex: 1;
		overflow-y: auto;
		padding-bottom: 20px;
	}

	.tasks-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 24px;
		color: var(--text-muted, #888);
		font-size: 13px;
		text-align: center;
	}
	.tasks-empty p {
		margin: 0;
		max-width: 300px;
		line-height: 1.5;
	}

	/* ── Group ── */
	.task-group {
		margin-bottom: 4px;
	}
	.task-group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 24px 6px;
		position: sticky;
		top: 0;
		background: var(--bg-primary, #111317);
		z-index: 1;
	}
	.group-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary, #aaa);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	.group-count {
		font-size: 11px;
		color: var(--text-muted, #666);
		background: var(--bg-secondary, rgba(255,255,255,0.04));
		padding: 1px 6px;
		border-radius: 8px;
	}

	/* ── Task Row ── */
	.task-row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 10px 24px;
		cursor: pointer;
		transition: background 0.12s ease;
		border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.04));
	}
	.task-row:hover {
		background: var(--bg-hover, rgba(255,255,255,0.04));
	}
	.task-row.done {
		opacity: 0.5;
	}
	.task-row.overdue {
		border-left: 2px solid #ef4444;
	}

	/* ── Checkbox ── */
	.task-check-col {
		flex-shrink: 0;
		padding-top: 2px;
	}
	.task-check {
		display: block;
		width: 18px;
		height: 18px;
		border: 2px solid #a855f7;
		border-radius: 50%;
		position: relative;
		transition: all 0.2s ease;
	}
	.task-check.checked {
		background: #a855f7;
		border-color: #a855f7;
	}
	.task-check.checked::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 5px;
		width: 4px;
		height: 8px;
		border: solid #fff;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}

	/* ── Task Content ── */
	.task-content {
		flex: 1;
		min-width: 0;
	}
	.task-text-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.task-priority-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.task-text {
		font-size: 13px;
		color: var(--text-primary, #fff);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.done .task-text {
		text-decoration: line-through;
		color: var(--text-muted, #888);
	}
	.task-flag {
		color: #f59e0b;
		flex-shrink: 0;
	}

	/* ── Task Meta Row ── */
	.task-meta-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 4px;
		font-size: 11px;
		flex-wrap: wrap;
	}
	.task-due-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-weight: 500;
	}
	.task-priority-label {
		font-weight: 600;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	.task-note-link {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--text-muted, #666);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 200px;
	}
	.task-note-link:hover {
		color: var(--accent, #00adb5);
	}

	/* ── Scrollbar ── */
	.tasks-list::-webkit-scrollbar {
		width: 5px;
	}
	.tasks-list::-webkit-scrollbar-track {
		background: transparent;
	}
	.tasks-list::-webkit-scrollbar-thumb {
		background: var(--border-color, rgba(255,255,255,0.1));
		border-radius: 3px;
	}
</style>

// ── Custom TipTap TaskItem with metadata (due date, priority, flag, reminder) ──
//
// Extends the official @tiptap/extension-task-item to persist task metadata
// as HTML data-* attributes. These attributes survive save/load and Google
// Drive sync because they live inside the note's HTML body.

import TaskItem from '@tiptap/extension-task-item';
import { mergeAttributes, type CommandProps } from '@tiptap/core';

export const TaskItemExtended = TaskItem.extend({
  name: 'taskItem',

  addAttributes() {
    return {
      ...this.parent?.(),

      // Due date as YYYY-MM-DD
      dueDate: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-due-date') || null,
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.dueDate) return {};
          return { 'data-due-date': attributes.dueDate };
        },
      },

      // Priority: 'low' | 'medium' | 'high'
      priority: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-priority') || null,
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.priority) return {};
          return { 'data-priority': attributes.priority };
        },
      },

      // Flagged / starred
      flagged: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-flagged') === 'true',
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.flagged) return {};
          return { 'data-flagged': 'true' };
        },
      },

      // Reminder as ISO datetime
      reminder: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-reminder') || null,
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.reminder) return {};
          return { 'data-reminder': attributes.reminder };
        },
      },
    };
  },

  // Override renderHTML to include all metadata attributes
  renderHTML({ node, HTMLAttributes }) {
    return [
      'li',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': this.name,
        'data-checked': node.attrs.checked ? 'true' : 'false',
      }),
      [
        'label',
        [
          'input',
          {
            type: 'checkbox',
            checked: node.attrs.checked ? 'checked' : null,
          },
        ],
        ['span'],
      ],
      ['div', 0],
    ];
  },

  // Add command to update task metadata
  addCommands() {
    return {
      ...this.parent?.(),

      setTaskMeta:
        (attrs: {
          checked?: boolean;
          dueDate?: string | null;
          priority?: string | null;
          flagged?: boolean;
          reminder?: string | null;
        }) =>
        ({ tr, state, dispatch }: CommandProps) => {
          const { selection } = state;
          const { $from } = selection;

          // Walk up from cursor to find the taskItem node
          let taskItemPos: number | null = null;
          let taskItemNode = null;
          for (let depth = $from.depth; depth >= 0; depth--) {
            const node = $from.node(depth);
            if (node.type.name === 'taskItem') {
              taskItemPos = $from.before(depth);
              taskItemNode = node;
              break;
            }
          }

          if (taskItemPos === null || !taskItemNode) return false;

          if (dispatch) {
            const newAttrs = { ...taskItemNode.attrs, ...attrs };
            tr.setNodeMarkup(taskItemPos, undefined, newAttrs);
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

export default TaskItemExtended;

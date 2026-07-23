import * as chrono from 'chrono-node';
import type { Note } from '../stores/appState.svelte';

export interface ParsedDate {
  text: string;
  date: Date;
  index: number;
  noteId: string;
}

export class ReminderService {
  static parseDateString(text: string): Date | null {
    return chrono.parseDate(text);
  }

  static extractDates(text: string): chrono.ParsedResult[] {
    return chrono.parse(text);
  }

  static scanNotesForDates(notes: Note[]): ParsedDate[] {
    const dates: ParsedDate[] = [];
    
    for (const note of notes) {
      if (!note.content) continue;
      
      const results = chrono.parse(note.content);
      for (const result of results) {
        if (result.date()) {
          dates.push({
            text: result.text,
            date: result.date(),
            index: result.index,
            noteId: note.id
          });
        }
      }
    }
    
    return dates.sort((a, b) => a.date.getTime() - b.date.getTime());
  }
}

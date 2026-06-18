import { TagDatabase } from './TagSchema';
import { appState, parseHtmlMetadata } from '../stores/appState.svelte';

export async function runTagDbTest() {
  console.log('--- STARTING TAG DATABASE VERIFICATION TEST ---');
  const db = new TagDatabase('TestVault');
  
  try {
    // 1. Clean up existing data by deleting test database first if needed
    db.close();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(`myNotesMetadata_TestVault`);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    
    // Re-instantiate database
    const testDb = new TagDatabase('TestVault');

    // 2. Add a new tag
    console.log('Adding tag "Work"...');
    const tag1 = await testDb.addTag('Work');
    console.log('Added tag:', tag1);
    if (tag1.name !== 'Work' || tag1.normalizedName !== 'work') {
      throw new Error('Tag name or normalized name was not set correctly');
    }

    // 3. Add a case-insensitive duplicate tag "WORK" and verify it returns the existing one
    console.log('Adding duplicate tag "WORK" (case-insensitive check)...');
    const tag2 = await testDb.addTag('WORK');
    console.log('Result for duplicate tag:', tag2);
    if (tag2.id !== tag1.id) {
      throw new Error('Case-insensitive duplicate tag was created with a different ID');
    }

    // 4. Verify tag count is still 1
    const tagsList = await testDb.listTags();
    console.log('Current tags in DB:', tagsList);
    if (tagsList.length !== 1) {
      throw new Error(`Expected exactly 1 tag, but found ${tagsList.length}`);
    }

    // 5. Add a second unique tag "Personal"
    console.log('Adding tag "Personal"...');
    const tagPersonal = await testDb.addTag('Personal');
    console.log('Added tag:', tagPersonal);
    
    const updatedTagsList = await testDb.listTags();
    if (updatedTagsList.length !== 2) {
      throw new Error(`Expected 2 tags in DB, found ${updatedTagsList.length}`);
    }

    // 6. Test note-tag relations mapping
    const notePath = 'Notebook/Budget.html';
    console.log(`Associating note "${notePath}" with tag "Work" (${tag1.id})...`);
    await testDb.addRelation(notePath, tag1.id);

    console.log(`Associating note "${notePath}" with tag "Personal" (${tagPersonal.id})...`);
    await testDb.addRelation(notePath, tagPersonal.id);

    // 7. Retrieve tags for note
    const tagsForNote = await testDb.getTagsForNote(notePath);
    console.log(`Tags associated with "${notePath}":`, tagsForNote);
    if (tagsForNote.length !== 2 || !tagsForNote.includes(tag1.id) || !tagsForNote.includes(tagPersonal.id)) {
      throw new Error('Relations were not retrieved correctly for note');
    }

    // 8. Retrieve notes for tag
    const notesForTag = await testDb.getNotesForTag(tag1.id);
    console.log(`Notes associated with tag "Work" (${tag1.id}):`, notesForTag);
    if (notesForTag.length !== 1 || notesForTag[0] !== notePath) {
      throw new Error('Relations were not retrieved correctly for tag');
    }

    // 9. Remove one relation
    console.log(`Removing association between "${notePath}" and tag "Personal" (${tagPersonal.id})...`);
    await testDb.removeRelation(notePath, tagPersonal.id);
    
    const remainingTagsForNote = await testDb.getTagsForNote(notePath);
    console.log(`Remaining tags for "${notePath}":`, remainingTagsForNote);
    if (remainingTagsForNote.length !== 1 || remainingTagsForNote[0] !== tag1.id) {
      throw new Error('Relation removal failed');
    }

    // 10. Delete tag globally
    console.log(`Deleting tag "Work" (${tag1.id}) globally...`);
    await testDb.deleteTag(tag1.id);

    const finalTags = await testDb.listTags();
    console.log('Final tags in DB:', finalTags);
    if (finalTags.some(t => t.id === tag1.id)) {
      throw new Error('Tag was not deleted globally');
    }

    const finalRelations = await testDb.getTagsForNote(notePath);
    console.log('Final relations for note:', finalRelations);
    if (finalRelations.includes(tag1.id)) {
      throw new Error('Tag relations were not deleted after global tag deletion');
    }

    testDb.close();

    // 11. Test appState integration CRUD APIs
    console.log('Testing appState Tag APIs...');
    
    // Create a temporary test note in sandbox
    const testNotePath = 'Daily Notes/TempTestNote.html';
    
    // Write note directly to storage so we can read/use it
    await appState.storage.writeNote(testNotePath, `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="id" content="${testNotePath}">
<meta name="title" content="TempTestNote">
<meta name="tags" content="">
<meta name="pinned" content="false">
<meta name="created" content="${new Date().toISOString()}">
<meta name="modified" content="${new Date().toISOString()}">
<title>TempTestNote</title>
</head>
<body>
<h1>TempTestNote</h1>
</body>
</html>`);

    // Refresh notes to load it into appState
    await appState.refreshNotes();
    
    // Associate tag using appState.addTagToNote
    console.log('Adding tag "Projects" to note...');
    await appState.addTagToNote(testNotePath, 'Projects');
    
    let tempNote = appState.notes.find(n => n.path === testNotePath);
    if (!tempNote) throw new Error('Temp note not found after tag addition');
    let parsedMeta = parseHtmlMetadata(tempNote.content);
    console.log('Note tags after addition:', parsedMeta.meta.tags);
    if (!parsedMeta.meta.tags.includes('Projects')) {
      throw new Error('addTagToNote failed to add tag to note file');
    }

    // Rename tag using appState.renameTag
    console.log('Renaming tag "Projects" to "Milestones"...');
    await appState.renameTag('Projects', 'Milestones');
    
    tempNote = appState.notes.find(n => n.path === testNotePath);
    parsedMeta = parseHtmlMetadata(tempNote!.content);
    console.log('Note tags after rename:', parsedMeta.meta.tags);
    if (parsedMeta.meta.tags.includes('Projects') || !parsedMeta.meta.tags.includes('Milestones')) {
      throw new Error('renameTag failed to update note tags');
    }

    // Delete tag using appState.deleteTag
    console.log('Deleting tag "Milestones"...');
    await appState.deleteTag('Milestones');
    
    tempNote = appState.notes.find(n => n.path === testNotePath);
    parsedMeta = parseHtmlMetadata(tempNote!.content);
    console.log('Note tags after delete:', parsedMeta.meta.tags);
    if (parsedMeta.meta.tags.includes('Milestones')) {
      throw new Error('deleteTag failed to remove tag from note');
    }

    // Clean up temporary note
    await appState.storage.deleteNote(testNotePath);
    await appState.refreshNotes();

    console.log('--- ALL TAG DATABASE & API VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
  } catch (error) {
    db.close();
    console.error('--- TAG DATABASE VERIFICATION TEST FAILED! ---', error);
    throw error;
  }
}

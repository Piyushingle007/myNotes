import type { ReadingProgress, ReadingProgressSyncFile } from '../types';
import { epubManager } from '../services/EpubManager';
import type { GoogleDriveSync } from '../../sync/GoogleDriveSync';

export const PROGRESS_SYNC_FILENAME = 'reading-progress.json';

/**
 * Pure function to merge local and remote reading progress dictionaries.
 * Resolves conflicts by newest `updatedAt` timestamp per book.
 * Identifies books where remote progress moved ahead of local progress.
 */
export function mergeProgressMaps(
  localMap: Record<string, ReadingProgress>,
  remoteMap: Record<string, ReadingProgress>
): {
  merged: Record<string, ReadingProgress>;
  hasLocalChangesToUpload: boolean;
  remoteAdvanced: Record<string, ReadingProgress>;
} {
  const merged: Record<string, ReadingProgress> = {};
  const remoteAdvanced: Record<string, ReadingProgress> = {};
  let hasLocalChangesToUpload = false;

  const allBookIds = new Set([...Object.keys(localMap), ...Object.keys(remoteMap)]);

  for (const id of allBookIds) {
    const local = localMap[id];
    const remote = remoteMap[id];

    if (local && !remote) {
      merged[id] = local;
      hasLocalChangesToUpload = true;
    } else if (!local && remote) {
      merged[id] = remote;
      remoteAdvanced[id] = remote;
    } else if (local && remote) {
      if ((remote.updatedAt || 0) > (local.updatedAt || 0)) {
        merged[id] = remote;
        // Check if remote is further ahead in reading percentage
        if ((remote.percentage || 0) > (local.percentage || 0) || (remote.cfi !== local.cfi)) {
          remoteAdvanced[id] = remote;
        }
      } else if ((local.updatedAt || 0) > (remote.updatedAt || 0)) {
        merged[id] = local;
        hasLocalChangesToUpload = true;
      } else {
        // Equal timestamps - preserve local
        merged[id] = local;
      }
    }
  }

  return { merged, hasLocalChangesToUpload, remoteAdvanced };
}

/**
 * Sync reading progress to/from Google Drive.
 * 1. Downloads reading-progress.json from Drive (if exists).
 * 2. Merges with local IndexedDB progress (newest write wins per book).
 * 3. Saves updated remote progress into local IndexedDB.
 * 4. Uploads merged progress to Drive if local had newer changes.
 */
export async function syncReadingProgressWithDrive(
  driveSync: GoogleDriveSync
): Promise<{
  synced: boolean;
  remoteAdvanced: Record<string, ReadingProgress>;
}> {
  if (!driveSync.hasToken()) {
    return { synced: false, remoteAdvanced: {} };
  }

  const progStore = epubManager.getProgressStore();
  const localMap = await progStore.getAllProgress();

  const rootFolderId = await driveSync.getOrCreateSyncFolder();
  const remoteFile = await driveSync.findFile(PROGRESS_SYNC_FILENAME, rootFolderId);

  let remoteMap: Record<string, ReadingProgress> = {};
  let remoteFileId = remoteFile?.id;

  if (remoteFileId) {
    try {
      const rawText = await driveSync.downloadFile(remoteFileId);
      const parsed: ReadingProgressSyncFile = JSON.parse(rawText);
      if (parsed && parsed.progress) {
        remoteMap = parsed.progress;
      }
    } catch (e) {
      console.warn('[EpubProgressSync] Failed to parse remote progress file:', e);
    }
  }

  const { merged, hasLocalChangesToUpload, remoteAdvanced } = mergeProgressMaps(localMap, remoteMap);

  // Save any remote updates into local IndexedDB
  for (const id of Object.keys(remoteAdvanced)) {
    const updatedProg = remoteAdvanced[id];
    await progStore.saveProgress(updatedProg);
  }

  // Upload to Drive if local had newer changes or remote file was absent
  if (hasLocalChangesToUpload || !remoteFileId) {
    const syncPayload: ReadingProgressSyncFile = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      progress: merged,
    };
    const content = JSON.stringify(syncPayload, null, 2);
    await driveSync.uploadFile(PROGRESS_SYNC_FILENAME, content, remoteFileId, rootFolderId);
  }

  return { synced: true, remoteAdvanced };
}

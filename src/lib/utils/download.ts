import { isTauri } from './platform';

export async function saveOrShareBlob(blob: Blob, filename: string, mime: string): Promise<boolean> {
	if (isTauri()) {
		try {
			const dialog = await import('@tauri-apps/plugin-dialog');
			const fs = await import('@tauri-apps/plugin-fs');
			const filePath = await dialog.save({
				defaultPath: filename,
				title: `Save ${filename}`
			});
			if (filePath) {
				const buffer = await blob.arrayBuffer();
				await fs.writeFile(filePath, new Uint8Array(buffer));
				return true;
			}
			return false;
		} catch (err) {
			console.warn('Tauri save dialog failed, falling back to anchor download:', err);
		}
	}
	if (
		typeof navigator !== 'undefined' &&
		navigator.share &&
		navigator.canShare &&
		navigator.canShare({
			files: [new File([blob], filename, { type: mime })]
		})
	) {
		try {
			const file = new File([blob], filename, { type: mime });
			await navigator.share({
				files: [file],
				title: filename,
				text: `Shared from myNotes: ${filename}`
			});
			return true;
		} catch (shareErr) {
			console.warn('Share failed, downloading instead', shareErr);
		}
	}

	// Fallback to Anchor download
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
	return false;
}

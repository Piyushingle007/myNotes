export async function saveOrShareBlob(blob: Blob, filename: string, mime: string): Promise<boolean> {
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

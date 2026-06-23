<script lang="ts">
	import { onDestroy, tick, untrack, mount, unmount } from 'svelte';
	import * as XLSX from 'xlsx-js-style';
	import { get } from 'svelte/store';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Placeholder from '@tiptap/extension-placeholder';

	import { Table } from '@tiptap/extension-table';
	import { TableRow } from '@tiptap/extension-table-row';
	import { TableCell } from '@tiptap/extension-table-cell';
	import { TableHeader } from '@tiptap/extension-table-header';
	import Link from '@tiptap/extension-link';
	import Image from '@tiptap/extension-image';
	import Highlight from '@tiptap/extension-highlight';
	import Typography from '@tiptap/extension-typography';
	import Underline from '@tiptap/extension-underline';
	import Subscript from '@tiptap/extension-subscript';
	import Superscript from '@tiptap/extension-superscript';
	import { Color } from '@tiptap/extension-color';
	import { TextStyle } from '@tiptap/extension-text-style';
	import FontFamily from '@tiptap/extension-font-family';
	import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
	import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
	import TextAlign from '@tiptap/extension-text-align';
	import { common, createLowlight } from 'lowlight';
	import MarkdownIt from 'markdown-it';
	import markdownItMark from 'markdown-it-mark';
	import markdownItSup from 'markdown-it-sup';
	import markdownItSub from 'markdown-it-sub';
	import katex from 'katex';
	import 'katex/dist/katex.min.css';
	import { Extension, Node as TiptapNode, Mark as TiptapMark, mergeAttributes } from '@tiptap/core';
	import { Plugin, PluginKey, EditorState, TextSelection, NodeSelection } from '@tiptap/pm/state';
	import { Decoration, DecorationSet } from '@tiptap/pm/view';
	import { DOMSerializer, DOMParser as PMParser } from '@tiptap/pm/model';
	import { writable, derived } from 'svelte/store';
	import { appState, parseHtmlMetadata, generateHtmlNote } from '../stores/appState.svelte';
	import { debounce } from '../utils/debounce';
	import GraphView from './GraphView.svelte';
	import DiagramEditor from './DiagramEditor.svelte';
	import DrawIOEditor from './DrawIOEditor.svelte';
	import MermaidEditor from './MermaidEditor.svelte';
	import MetricsBlock from './MetricsBlock.svelte';
	import { renderDiagramSVG, decodeDiagram } from '../utils/diagram';
	import ErrorBanner from './ErrorBanner.svelte';
	import CanvasEditor from './CanvasEditor.svelte';
	import NotebookEditor from './NotebookEditor.svelte';
	import type { Stroke, CanvasBackground } from '../utils/canvasTypes';

	function extractCanvasData(html: string): { strokes: Stroke[], background: CanvasBackground } {
		const result = { strokes: [] as Stroke[], background: 'blank' as CanvasBackground };
		if (!html) return result;
		
		if (typeof DOMParser !== 'undefined') {
			try {
				const parser = new DOMParser();
				const doc = parser.parseFromString(html, 'text/html');
				const scriptTag = doc.getElementById('canvas-data');
				if (scriptTag && scriptTag.textContent) {
					const data = JSON.parse(scriptTag.textContent);
					if (data.strokes) result.strokes = data.strokes;
					if (data.background) result.background = data.background;
				}
			} catch (e) {
				console.error('Failed to extract canvas data:', e);
			}
		} else {
			// Regex fallback (broken up <script> to avoid Svelte compiler parsing errors)
			const match = html.match(new RegExp('<' + 'script\\s+id="canvas-data"\\s+type="application/json">([\\s\\S]*?)</' + 'script>', 'i'));
			if (match && match[1]) {
				try {
					const data = JSON.parse(match[1]);
					if (data.strokes) result.strokes = data.strokes;
					if (data.background) result.background = data.background;
				} catch (e) {
					console.error('Failed to parse regex-extracted canvas data:', e);
				}
			}
		}
		return result;
	}

	function injectCanvasData(html: string, strokes: Stroke[], background: CanvasBackground): string {
		const dataString = JSON.stringify({ strokes, background });
		const scriptTag = '<' + 'script id="canvas-data" type="application/json">' + dataString + '</' + 'script>';
		
		if (typeof DOMParser !== 'undefined') {
			try {
				const parser = new DOMParser();
				const doc = parser.parseFromString(html, 'text/html');
				const existingScript = doc.getElementById('canvas-data');
				if (existingScript) {
					existingScript.textContent = dataString;
				} else {
					const head = doc.head || doc.getElementsByTagName('head')[0];
					if (head) {
						const newScript = doc.createElement('script');
						newScript.id = 'canvas-data';
						newScript.type = 'application/json';
						newScript.textContent = dataString;
						head.appendChild(newScript);
					}
				}
				return doc.documentElement.outerHTML;
			} catch (e) {
				console.error('Failed to inject canvas data using DOMParser:', e);
			}
		}
		
		// Regex fallback (broken up script tags to avoid Svelte compiler parsing errors)
		const cleanHtml = html.replace(new RegExp('<' + 'script\\s+id="canvas-data"\\s+type="application/json">([\\s\\S]*?)</' + 'script>', 'gi'), '');
		if (cleanHtml.includes('</head>')) {
			return cleanHtml.replace('</head>', scriptTag + '\n</head>');
		} else if (cleanHtml.includes('<body>')) {
			return cleanHtml.replace('<body>', '<body>\n' + scriptTag);
		}
		return cleanHtml + '\n' + scriptTag;
	}

	let resolvedAssetsMap = new Map<string, string>(); // relative path -> blob URL

	function getRelativeFilePath(src: string): string {
		const decoded = decodeURIComponent(src);
		const notePath = $activeNotePath;
		if (notePath) {
			const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
			return noteDir ? `${noteDir}/${decoded}` : decoded;
		}
		return decoded;
	}

	async function resolveLocalAssets() {
		if (!editor || !editor.view.dom) return;
		
		// 1. Resolve Images
		const imgs = editor.view.dom.querySelectorAll('img');
		for (const img of Array.from(imgs)) {
			const src = img.getAttribute('src');
			if (!src) continue;
			
			// If it's a relative local path
			if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:') && !src.startsWith('blob:') && !src.startsWith('asset:')) {
				const resolvedPath = getRelativeFilePath(src);
				if (resolvedAssetsMap.has(resolvedPath)) {
					img.src = resolvedAssetsMap.get(resolvedPath)!;
				} else {
					try {
						const blob = await appState.readBlob(resolvedPath);
						if (blob) {
							const url = URL.createObjectURL(blob);
							resolvedAssetsMap.set(resolvedPath, url);
							img.src = url;
						}
					} catch (e) {
						console.warn('Failed to load local image:', resolvedPath, e);
					}
				}
			}
		}

		// 2. Resolve PDF Embeds
		const embeds = editor.view.dom.querySelectorAll('.pdf-embed');
		for (const embed of Array.from(embeds)) {
			const iframe = embed.querySelector('iframe');
			const pdfSrc = embed.getAttribute('data-pdf-src');
			if (!iframe || !pdfSrc) continue;
			
			const currentSrc = iframe.getAttribute('src');
			if (currentSrc && !currentSrc.startsWith('blob:')) {
				const resolvedPath = getRelativeFilePath(pdfSrc);
				if (resolvedAssetsMap.has(resolvedPath)) {
					iframe.src = resolvedAssetsMap.get(resolvedPath)!;
				} else {
					try {
						const blob = await appState.readBlob(resolvedPath);
						if (blob) {
							const pdfBlob = new Blob([blob], { type: 'application/pdf' });
							const url = URL.createObjectURL(pdfBlob);
							resolvedAssetsMap.set(resolvedPath, url);
							iframe.src = url;
						}
					} catch (e) {
						console.warn('Failed to load local PDF:', resolvedPath, e);
					}
				}
			}
		}
	}

	function clearResolvedAssets() {
		for (const url of resolvedAssetsMap.values()) {
			URL.revokeObjectURL(url);
		}
		resolvedAssetsMap.clear();
	}

	const FontSize = Extension.create({
		name: 'fontSize',
		addOptions() {
			return {
				types: ['textStyle'],
			};
		},
		addGlobalAttributes() {
			return [
				{
					types: this.options.types,
					attributes: {
						fontSize: {
							default: null,
							parseHTML: element => element.style.fontSize?.replace(/['"]+/g, ''),
							renderHTML: attributes => {
								if (!attributes.fontSize) {
									return {};
								}
								return {
									style: `font-size: ${attributes.fontSize}`,
								};
							},
						},
					},
				},
			];
		},
	});

	// Types
	interface VersionEntry {
		timestamp: string;
		size: number;
	}
	interface AiStreamEvent {
		event_type: string;
		text: string | null;
		error: string | null;
	}
	interface NoteTitleEntry {
		title: string;
		path: string;
	}

	// Mock/Adapters for Tauri native API imports
	const convertFileSrc = (src: string, protocol?: string) => src;
	const getCurrentWindow = () => ({
		listen: () => () => {},
		minimize: () => {},
		toggleMaximize: () => {},
		close: () => {},
		onDragDropEvent: (handler: any) => Promise.resolve(() => {}),
	});
	const readFile = async (path: string) => new Uint8Array();
	const openFile = async (path: string) => {};
	const openUrl = async (url: string) => {
		window.open(url, '_blank');
	};
	const copyFileTo = async (src: string, dest: string) => {};
	const copyImageToClipboardCmd = async (path: string) => {};
	const writeBytesTo = async (path: string, bytes: Uint8Array) => {};
	const copyPngToClipboard = async (bytes: Uint8Array) => {};
	const saveDialog = async (options?: any) => '';
	async function listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
		return () => {};
	}

	// Mock frontmatter and API methods
	function parseFrontmatter(rawContent: string): { meta: any; content: string } {
		const meta: any = {
			id: '',
			title: '',
			tags: [],
			pinned: false,
			created: '',
			modified: ''
		};
		let content = rawContent;
		if (rawContent.startsWith('---')) {
			const endIdx = rawContent.indexOf('---', 3);
			if (endIdx !== -1) {
				const yamlText = rawContent.substring(3, endIdx);
				content = rawContent.substring(endIdx + 3);
				const lines = yamlText.split('\n');
				for (const line of lines) {
					const colonIdx = line.indexOf(':');
					if (colonIdx !== -1) {
						const key = line.substring(0, colonIdx).trim().toLowerCase();
						let val = line.substring(colonIdx + 1).trim();
						if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
						if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
						if (key === 'id') meta.id = val;
						else if (key === 'title') meta.title = val;
						else if (key === 'pinned') meta.pinned = val === 'true';
						else if (key === 'tags') {
							meta.tags = val.replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean);
						}
						else if (key === 'created') meta.created = val;
						else if (key === 'modified') meta.modified = val;
					}
				}
			}
		}
		return { meta, content };
	}

	function mockReadNote(path: string, content: string) {
		const parsed = path.endsWith('.html') ? parseHtmlMetadata(content) : parseFrontmatter(content);
		if (!parsed.meta.title) {
			parsed.meta.title = path.split('/').pop()?.replace(/\.(md|html)$/, '') || 'Untitled';
		}
		if (!parsed.meta.id) {
			parsed.meta.id = path;
		}
		parsed.meta.pinned = appState.favorites.includes(path);
		return {
			path,
			meta: parsed.meta,
			content: parsed.content,
			raw: content
		};
	}

	// Browser-friendly note operations
	async function saveNote(path: string, meta: any, body: string) {
		appState.activeNoteContent = body;
		const noteIdx = appState.notes.findIndex(n => n.path === path);
		if (noteIdx !== -1) {
			appState.notes[noteIdx].content = body;
			appState.notes[noteIdx].modified = Date.now();
		}
		await appState.saveActiveNote();
	}

	async function readNote(path: string) {
		const note = appState.notes.find(n => n.path === path);
		if (!note) throw new Error('File not found: ' + path);
		return mockReadNote(path, note.content);
	}

	async function renameNote(path: string, newTitle: string) {
		await appState.renameNote(path, newTitle);
		const parts = path.split('/');
		parts[parts.length - 1] = `${newTitle}.html`;
		return parts.join('/');
	}

	async function saveImage(destPath: string, bytes: Uint8Array | number[] | null) {
		return destPath;
	}

	async function saveAttachment(destPath: string, bytes: Uint8Array | number[]) {
		return destPath;
	}

	async function readClipboardImage() {
		return null;
	}

	async function addQuickAccess(path: string) {}
	async function removeQuickAccess(path: string) {}
	async function getQuickAccess(): Promise<any[]> { return []; }
	async function getNoteVersions(id: string) { return []; }
	async function getNoteVersionContent(id: string, timestamp: string) { return ''; }
	async function createVersion(path: string, id: string) {}
	async function aiAsk(prompt: string, context: string, customPrompt: string | null, requestId?: string) {}

	async function getAllNoteTitles() {
		return appState.notes.map(n => ({
			title: n.name,
			path: n.path
		}));
	}

	// Local writable stores to keep HelixNotes references intact
	const activeNotePath = writable<string | null>(null);
	const activeNote = writable<any>(null);
	const appConfig = writable<any>({
		active_vault: 'Local Sandbox',
		hide_title_in_body: true,
		default_view_mode: false,
	});
	const editorDirty = writable<boolean>(false);
	const sourceMode = writable<boolean>(localStorage.getItem('mynotes_editor_source_mode') === 'true');
	const readOnly = writable<boolean>(false);
	let savedSelection: { from: number; to: number } | null = null;
	let savedScrollTop: number | null = null;
	const quickAccessPaths = writable<string[]>([]);
	const notes = writable<any[]>([]);
	const navHistory = (() => {
		const { subscribe, set, update } = writable<string[]>([]);
		return {
			subscribe,
			set,
			update,
			go: (direction: number) => null as string | null
		};
	})();
	const canGoBack = writable<boolean>(false);
	const canGoForward = writable<boolean>(false);
	const viewerNote = writable<any>(null);
	const notebooks = writable<any[]>([]);

	// Bidirectional sync between appState and our local writable stores
	$effect(() => {
		if (appState.activeNotePath !== get(activeNotePath)) {
			activeNotePath.set(appState.activeNotePath);
		}
	});

	$effect(() => {
		const unsubscribe = activeNotePath.subscribe(path => {
			if (path !== appState.activeNotePath) {
				if (path) appState.selectNote(path);
			}
		});
		return unsubscribe;
	});

	$effect(() => {
		const mappedNotes = appState.notes.map(n => {
			const parsed = parseHtmlMetadata(n.content);
			return {
				path: n.path,
				relative_path: n.path,
				meta: {
					id: n.path,
					title: n.name,
					tags: parsed.meta.tags || [],
					pinned: appState.favorites.includes(n.path),
					created: new Date(n.created).toISOString(),
					modified: new Date(n.modified).toISOString()
				},
				preview: n.content.substring(0, 100)
			};
		});
		notes.set(mappedNotes);
	});

	$effect(() => {
		const mappedNotebooks = appState.notebooks.map(nb => ({
			name: nb.split('/').pop() || nb,
			path: nb,
			relative_path: nb,
			children: [],
			note_count: 0
		}));
		notebooks.set(mappedNotebooks);
	});

	$effect(() => {
		const currentPath = appState.activeNotePath;
		if (currentPath) {
			const note = appState.notes.find(n => n.path === currentPath);
			if (note) {
				const activeNoteVal = get(activeNote);
				if (!activeNoteVal || activeNoteVal.path !== currentPath || activeNoteVal.content !== note.content) {
					activeNote.set(mockReadNote(currentPath, note.content));
				}
			} else {
				activeNote.set(null);
			}
		} else {
			activeNote.set(null);
		}
	});

	const canvasData = $derived.by(() => {
		const rawContent = appState.activeNoteContent || '';
		return extractCanvasData(rawContent);
	});
	const canvasStrokes = $derived(canvasData.strokes);
	const canvasBackground = $derived(canvasData.background);
	let canvasPerformSaveImmediate = $state<(() => void) | undefined>(undefined);

	async function handleCanvasSave(strokes: Stroke[], background: CanvasBackground, thumbnail: string) {
		if (get(viewerNote)) return; // viewer files are never written back
		if (!$activeNote || !$activeNotePath) return;

		const bodyHtml = $sourceMode ? sourceContent : (editor ? editor.getHTML() : '');
		$activeNote.meta.thumbnail = thumbnail;
		
		let fullHtml = generateHtmlNote($activeNote.meta, bodyHtml);
		fullHtml = injectCanvasData(fullHtml, strokes, background);
		
		$activeNote.content = fullHtml;
		await saveNote($activeNotePath, $activeNote.meta, fullHtml);
		$editorDirty = false;
	}

	async function handleNotebookSave(content: string, thumbnail: string) {
		if (get(viewerNote)) return;
		if (!$activeNote || !$activeNotePath) return;

		$activeNote.meta.thumbnail = thumbnail;
		$activeNote.content = content;

		// Lightweight save path for notebooks — bypasses the heavy 
		// saveActiveNote → refreshNotes → reindex chain.
		// Notebook content is binary stroke data, not structural metadata,
		// so we skip search reindexing, tag syncing, and HTML parsing.
		appState.activeNoteContent = content;
		const noteIdx = appState.notes.findIndex(n => n.path === $activeNotePath);
		if (noteIdx !== -1) {
			appState.notes[noteIdx].content = content;
			appState.notes[noteIdx].modified = Date.now();
		}
		try {
			await appState.storage.writeNote($activeNotePath, content);
			appState.editorDirty = false;
			// Trigger debounced sync if enabled (non-blocking)
			if (appState.syncEnabled && appState.googleConnected) {
				appState.triggerDebouncedSync();
			}
		} catch (e: any) {
			console.error('Notebook save failed:', e);
		}
		$editorDirty = false;
	}

	$effect(() => {
		const unsubscribe = editorDirty.subscribe(dirty => {
			if (dirty !== appState.editorDirty) {
				appState.editorDirty = dirty;
			}
		});
		return unsubscribe;
	});

	$effect(() => {
		if (appState.editorDirty !== get(editorDirty)) {
			editorDirty.set(appState.editorDirty);
		}
	});


	$effect(() => {
		readOnly.set(appState.isReadOnly);
	});

	$effect(() => {
		const unsubscribe = readOnly.subscribe(val => {
			if (appState.isReadOnly !== val) {
				appState.isReadOnly = val;
			}
		});
		return unsubscribe;
	});

	$effect(() => {
		sourceMode.set(appState.sourceMode);
	});

	$effect(() => {
		const unsubscribe = sourceMode.subscribe(val => {
			if (appState.sourceMode !== val) {
				appState.setSourceMode(val);
			}
		});
		return unsubscribe;
	});


	const modKey = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl';
	let isMobile = $derived(appState.isMobile);

	// Track virtual keyboard height on mobile via visualViewport
	let keyboardHeight = $state(0);
	$effect(() => {
		if (isMobile && typeof window !== 'undefined' && window.visualViewport) {
			const vv = window.visualViewport;
			const updateHeight = () => { keyboardHeight = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)); };
			vv.addEventListener('resize', updateHeight);
			vv.addEventListener('scroll', updateHeight);
			return () => {
				vv.removeEventListener('resize', updateHeight);
				vv.removeEventListener('scroll', updateHeight);
			};
		}
	});

	let newTagVal = $state('');
	let showDropdown = $state(false);
	let selectedIndex = $state(0);

	let filteredSuggestions = $derived(
		appState.tags
			.map(t => t.name)
			.filter(name => {
				const currentTags = ($activeNote?.meta?.tags || []).map((t: string) => t.toLowerCase());
				const normalized = name.toLowerCase();
				if (currentTags.includes(normalized)) return false;
				
				const query = newTagVal.trim().toLowerCase();
				if (query) return normalized.includes(query);
				return true;
			})
			.sort((a, b) => a.localeCompare(b))
	);

	$effect(() => {
		if (newTagVal !== undefined) {
			selectedIndex = 0;
		}
	});

	async function selectSuggestion(suggestion: string) {
		if ($activeNotePath) {
			await appState.addTagToNote($activeNotePath, suggestion);
		}
		newTagVal = '';
		showDropdown = false;
		selectedIndex = 0;
	}

	async function handleTagInputKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			if (showDropdown && filteredSuggestions.length > 0) {
				e.preventDefault();
				selectedIndex = (selectedIndex + 1) % filteredSuggestions.length;
			} else if (!showDropdown) {
				showDropdown = true;
			}
		} else if (e.key === 'ArrowUp') {
			if (showDropdown && filteredSuggestions.length > 0) {
				e.preventDefault();
				selectedIndex = (selectedIndex - 1 + filteredSuggestions.length) % filteredSuggestions.length;
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			showDropdown = false;
			selectedIndex = 0;
			(e.target as HTMLInputElement)?.blur();
		} else if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			if (showDropdown && filteredSuggestions.length > 0 && selectedIndex >= 0 && selectedIndex < filteredSuggestions.length) {
				const selectedTag = filteredSuggestions[selectedIndex];
				await selectSuggestion(selectedTag);
			} else {
				const cleanName = newTagVal.trim().replace(/,/g, '');
				if (cleanName) {
					if ($activeNotePath) {
						await appState.addTagToNote($activeNotePath, cleanName);
					}
					newTagVal = '';
					showDropdown = false;
					selectedIndex = 0;
				}
			}
		}
	}

	async function removeTag(tag: string) {
		if ($activeNotePath) {
			await appState.removeTagFromNote($activeNotePath, tag);
		}
	}

	function toggleReadMode() {
		const newReadOnly = !$readOnly;
		const editorBody = editorElement?.closest('.editor-body') as HTMLElement | null;

		if (newReadOnly) {
			// Switch Edit -> Read Mode
			if (editor) {
				const { from, to } = editor.state.selection;
				savedSelection = { from, to };
				if (editorBody) {
					savedScrollTop = editorBody.scrollTop;
				}
				if ($editorDirty) {
					forceSave();
				}
				ignoreNextUpdate = true; // Ignore update transaction triggered by setEditable
				editor.setEditable(false);
			}
			$readOnly = true;
			tick().then(() => {
				resolveLocalAssets();
			});
		} else {
			// Switch Read -> Edit Mode
			if (editor) {
				ignoreNextUpdate = true; // Ignore update transaction triggered by setEditable
				editor.setEditable(true);
			}
			$readOnly = false;

			tick().then(() => {
				if (editor) {
					editor.commands.focus();
					if (savedSelection) {
						editor.commands.setTextSelection(savedSelection);
					}
					if (savedScrollTop !== null && editorBody) {
						editorBody.scrollTop = savedScrollTop;
					}
				}
				resolveLocalAssets();
			});
		}

		if ($activeNotePath) {
			localStorage.setItem('mynotes_mode_' + $activeNotePath, newReadOnly ? 'read' : 'edit');
		}
	}

	function handleDeleteActiveNote() {
		const path = $activeNotePath;
		if (!path) return;
		appState.showConfirmation({
			title: 'Delete Note',
			message: 'Do you really want to delete this note? This action is permanent.',
			confirmText: 'Delete',
			onConfirm: async () => {
				$activeNotePath = null;
				await appState.deleteNote(path);
			}
		});
	}

	async function updateNoteTitle(newTitle: string) {
		if ($activeNote && $activeNotePath) {
			const oldPath = $activeNotePath;
			$activeNote.meta.title = newTitle;
			if (titleWasStripped) strippedTitle = newTitle;
			$editorDirty = true;
			await forceSave();
			const filename = oldPath.split('/').pop() ?? '';
			const stem = filename.replace(/\.md$/, '');
			if (stem !== newTitle) {
				try {
					const newPath = await renameNote(oldPath, newTitle);
					loadedPath = newPath;
					$activeNotePath = newPath;
					notes.update(list => list.map(n =>
						n.path === oldPath
							? { ...n, path: newPath, relative_path: n.relative_path.replace(/[^/]+$/, newTitle + '.md'), meta: { ...n.meta, title: newTitle } }
							: n
					));
					refreshWikiLinkTitles();
				} catch (err) {
					console.error('Failed to rename note file:', err);
					notes.update(list => list.map(n =>
						n.path === oldPath ? { ...n, meta: { ...n.meta, title: newTitle } } : n
					));
				}
			} else {
				notes.update(list => list.map(n =>
					n.path === oldPath ? { ...n, meta: { ...n.meta, title: newTitle } } : n
				));
			}
		}
	}

	$effect(() => {
		if (typeof window !== 'undefined') {
			const handleKeyDown = (e: KeyboardEvent) => {
				const isMod = e.ctrlKey || e.metaKey;
				if (isMod && e.shiftKey && e.key.toLowerCase() === 'r') {
					e.preventDefault();
					toggleReadMode();
				}
			};
			window.addEventListener('keydown', handleKeyDown);
			return () => {
				window.removeEventListener('keydown', handleKeyDown);
			};
		}
	});

	let editorElement = $state<HTMLDivElement>(null!);
	let sourceElement = $state<HTMLTextAreaElement>(null!);
	const LARGE_DOC_CHARS = 100_000;
	let isLargeDoc = $state(false);
	let editor = $state<Editor | null>(null);
	let editorReady = $state(false);
	let sourceContent = $state('');
	let sourceHistory: Array<{ content: string; cursor: number }> = [];
	let sourceHistoryIndex = -1;
	let sourceHistoryTimer: ReturnType<typeof setTimeout> | null = null;
	let loadedPath = '';
	let pendingContent = $state<string | null>(null);
	let ignoreNextUpdate = false;
	let isLoadingNote = $state(false);
	let fixingBlobsPromise: Promise<void> = Promise.resolve();
	let hasPendingBlobs = false;
	let lastSourceMode = $sourceMode;
	let linkContextMenu = $state<{ x: number; y: number; href: string; anchor: HTMLAnchorElement } | null>(null);
	let titleWasStripped = false;
	let strippedTitle = '';
	let strippedHeadingPrefix = '';

	const standardFonts = [
		{ name: 'Sans-Serif', value: 'var(--font-sans)' },
		{ name: 'Serif', value: 'Georgia, Cambria, "Times New Roman", Times, serif' },
		{ name: 'Monospace', value: 'var(--font-mono)' },
		{ name: 'Dyslexic', value: '"OpenDyslexic", "Comic Sans MS", cursive' },
		{ name: 'Handwritten', value: '"Caveat", "Dancing Script", "Pacifico", cursive' }
	];

	let headingDropdown = $state(false);
	let colorDropdown = $state(false);
	let highlightDropdown = $state(false);
	let alignDropdown = $state(false);
	let insertDropdown = $state(false);
	let tablePickerOpen = $state(false);
	let fontDropdown = $state(false);

	let customFonts = $state<Array<{ name: string; value: string }>>([]);
	let newFontInput = $state('');
	let customTextColorInput = $state('#000000');
	let customHighlightColorInput = $state('#ffff00');
	let recentTextColors = $state<string[]>([]);
	let recentHighlightColors = $state<string[]>([]);

	// Save/load recents and custom fonts
	$effect(() => {
		try {
			const savedFonts = localStorage.getItem('mynotes_custom_fonts');
			if (savedFonts) {
				customFonts = JSON.parse(savedFonts);
			}
			const savedRecentText = localStorage.getItem('mynotes_recent_text_colors');
			if (savedRecentText) {
				recentTextColors = JSON.parse(savedRecentText);
			}
			const savedRecentHighlight = localStorage.getItem('mynotes_recent_highlight_colors');
			if (savedRecentHighlight) {
				recentHighlightColors = JSON.parse(savedRecentHighlight);
			}
		} catch (e) {
			console.error('Failed to load settings from localStorage:', e);
		}
	});

	function saveCustomFonts() {
		try {
			localStorage.setItem('mynotes_custom_fonts', JSON.stringify(customFonts));
		} catch (e) {
			console.error('Failed to save custom fonts:', e);
		}
	}

	function addCustomFont() {
		const name = newFontInput.trim();
		if (!name) return;
		if (
			standardFonts.some(f => f.name.toLowerCase() === name.toLowerCase()) ||
			customFonts.some(f => f.name.toLowerCase() === name.toLowerCase())
		) {
			newFontInput = '';
			return;
		}
		customFonts = [...customFonts, { name, value: name }];
		saveCustomFonts();
		newFontInput = '';
	}

	function removeCustomFont(name: string) {
		customFonts = customFonts.filter(f => f.name !== name);
		saveCustomFonts();
	}

	function saveRecentColors(type: 'text' | 'highlight') {
		try {
			if (type === 'text') {
				localStorage.setItem('mynotes_recent_text_colors', JSON.stringify(recentTextColors));
			} else {
				localStorage.setItem('mynotes_recent_highlight_colors', JSON.stringify(recentHighlightColors));
			}
		} catch (e) {
			console.error('Failed to save recent colors:', e);
		}
	}

	function addRecentColor(color: string, type: 'text' | 'highlight') {
		if (!color) return;
		if (type === 'text') {
			recentTextColors = [color, ...recentTextColors.filter(c => c !== color)].slice(0, 5);
			saveRecentColors('text');
		} else {
			recentHighlightColors = [color, ...recentHighlightColors.filter(c => c !== color)].slice(0, 5);
			saveRecentColors('highlight');
		}
	}

	function applyCustomTextColor(color: string) {
		if (!color.startsWith('#')) {
			if (/^[0-9a-fA-F]{3,6}$/.test(color)) {
				color = '#' + color;
			} else {
				return;
			}
		}
		setTextColor(color);
		addRecentColor(color, 'text');
	}

	function applyCustomHighlightColor(color: string) {
		if (!color.startsWith('#') && !color.startsWith('rgba') && !color.startsWith('rgb')) {
			if (/^[0-9a-fA-F]{3,6}$/.test(color)) {
				color = '#' + color;
			} else {
				return;
			}
		}
		setHighlightColor(color);
		addRecentColor(color, 'highlight');
	}

	function setFontFamily(fontValue: string) {
		if (!editor) return;
		if (fontValue === '') {
			editor.chain().focus().unsetFontFamily().run();
		} else {
			editor.chain().focus().setFontFamily(fontValue).run();
		}
		setTimeout(() => { fontDropdown = false; }, 20);
	}

	let allFonts = $derived([...standardFonts, ...customFonts]);

	let activeFontLabel = $derived.by(() => {
		if (!editorState || !editor) return 'Font';
		const currentFont = editor.getAttributes('textStyle').fontFamily;
		if (!currentFont) return 'Default Font';
		const found = allFonts.find(f => f.value === currentFont || f.name === currentFont);
		return found ? found.name : currentFont;
	});

	// Font Size states
	let fontSizeDropdown = $state(false);
	let customSizes = $state<string[]>([]);
	let newSizeInput = $state('');
	const standardSizes = ['12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px', '48px'];
	let allSizes = $derived([...standardSizes, ...customSizes]);

	// Load custom sizes
	$effect(() => {
		if (typeof window !== 'undefined') {
			const savedSizes = localStorage.getItem('mynotes_custom_sizes');
			if (savedSizes) {
				try {
					customSizes = JSON.parse(savedSizes);
				} catch (e) {
					console.error('Failed to parse custom sizes:', e);
				}
			}
		}
	});

	function saveCustomSizes() {
		if (typeof window !== 'undefined') {
			try {
				localStorage.setItem('mynotes_custom_sizes', JSON.stringify(customSizes));
			} catch (e) {
				console.error('Failed to save custom sizes:', e);
			}
		}
	}

	function addCustomSize() {
		const size = newSizeInput.trim();
		if (!size) return;
		if (standardSizes.includes(size) || customSizes.includes(size)) {
			newSizeInput = '';
			return;
		}
		customSizes = [...customSizes, size];
		saveCustomSizes();
		newSizeInput = '';
	}

	function removeCustomSize(size: string) {
		customSizes = customSizes.filter(s => s !== size);
		saveCustomSizes();
	}

	function setFontSize(sizeValue: string) {
		if (!editor) return;
		if (sizeValue === '') {
			editor.chain().focus().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
		} else {
			editor.chain().focus().setMark('textStyle', { fontSize: sizeValue }).run();
		}
		setTimeout(() => { fontSizeDropdown = false; }, 20);
	}

	let activeSizeLabel = $derived.by(() => {
		if (!editorState || !editor) return '14px';
		const currentSize = editor.getAttributes('textStyle').fontSize;
		return currentSize ? currentSize : '14px';
	});

	function closeAllDropdowns() {
		headingDropdown = false;
		colorDropdown = false;
		highlightDropdown = false;
		alignDropdown = false;
		insertDropdown = false;
		tablePickerOpen = false;
		fontDropdown = false;
		fontSizeDropdown = false;
		exportDropdownOpen = false;
		moreMenuOpen = false;
	}

	function exportAsHtml() {
		exportDropdownOpen = false;
		if (!$activeNotePath || !$activeNote) return;
		const bodyHtml = $sourceMode ? sourceContent : (editor ? editor.getHTML() : ($activeNote ? parseHtmlMetadata($activeNote.content).content : ''));
		const fullHtml = generateHtmlNote($activeNote.meta, bodyHtml);
		const filename = ($activeNote.meta.title || $activeNote.name || 'note') + '.html';
		const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		appState.showToast(`Exported ${filename} successfully.`, 'success');
	}

	function exportAsMarkdown() {
		exportDropdownOpen = false;
		if (!$activeNotePath || !$activeNote) return;
		
		let htmlContent = '';
		if ($sourceMode) {
			htmlContent = sourceContent;
		} else if (editor) {
			htmlContent = editor.getHTML();
		} else {
			htmlContent = $activeNote.content;
			if (htmlContent.includes('<html') || htmlContent.includes('<body')) {
				htmlContent = parseHtmlMetadata(htmlContent).content;
			}
		}

		let markdown = '';
		if (editor) {
			try {
				const parser = PMParser.fromSchema(editor.schema);
				const tempEl = document.createElement('div');
				tempEl.innerHTML = htmlContent;
				const docNode = parser.parse(tempEl);
				markdown = prosemirrorToMarkdown(docNode);
			} catch (e) {
				console.error('Failed to convert HTML to Markdown:', e);
				markdown = htmlContent.replace(/<[^>]+>/g, '');
			}
		} else {
			markdown = htmlContent.replace(/<[^>]+>/g, '');
		}

		const filename = ($activeNote.meta.title || $activeNote.name || 'note') + '.md';
		const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		appState.showToast(`Exported ${filename} successfully.`, 'success');
	}

	async function exportAsPdf() {
		exportDropdownOpen = false;
		if (!$activeNote) return;

		const toastId = appState.showToast('Generating PDF…', 'info', 0, undefined, true);
		try {
			const [{ jsPDF }, html2canvasMod] = await Promise.all([
				import('jspdf'),
				import('html2canvas')
			]);
			const html2canvas = (html2canvasMod as any).default || html2canvasMod;

			// Build a clean, light, print-friendly render target off-screen so the
			// output looks like a document regardless of the current editor theme.
			const sourceEl = (editor ? editor.view.dom : editorElement) as HTMLElement;
			const clone = sourceEl.cloneNode(true) as HTMLElement;
			clone.style.cssText = 'color:#111111; background:transparent;';

			const container = document.createElement('div');
			container.style.cssText = [
				'position:fixed', 'left:-99999px', 'top:0', 'width:794px', /* ~A4 @96dpi */
				'padding:48px', 'background:#ffffff', 'color:#111111',
				'font-family:Georgia, "Times New Roman", serif', 'line-height:1.6', 'box-sizing:border-box'
			].join(';');

			const titleEl = document.createElement('h1');
			titleEl.textContent = $activeNote.meta.title || $activeNote.name || 'Note';
			titleEl.style.cssText = 'font-family:inherit; color:#111111; margin:0 0 20px; font-size:28px;';
			container.appendChild(titleEl);
			container.appendChild(clone);
			document.body.appendChild(container);

			const canvas = await html2canvas(container, {
				scale: 2,
				backgroundColor: '#ffffff',
				useCORS: true,
				logging: false
			});
			document.body.removeChild(container);

			const pdf = new jsPDF('p', 'mm', 'a4');
			const pageW = pdf.internal.pageSize.getWidth();
			const pageH = pdf.internal.pageSize.getHeight();
			const imgW = pageW;
			const imgH = (canvas.height * imgW) / canvas.width;
			const imgData = canvas.toDataURL('image/jpeg', 0.92);

			let heightLeft = imgH;
			let position = 0;
			pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
			heightLeft -= pageH;
			while (heightLeft > 0) {
				position -= pageH;
				pdf.addPage();
				pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
				heightLeft -= pageH;
			}

			const filename = ($activeNote.meta.title || $activeNote.name || 'note') + '.pdf';
			pdf.save(filename);
			appState.updateToast(toastId, { message: `Exported ${filename}`, type: 'success', loading: false, duration: 3000 });
		} catch (e) {
			console.error('PDF export failed, falling back to print dialog:', e);
			appState.updateToast(toastId, { message: 'PDF render failed — opening print dialog instead.', type: 'warning', loading: false, duration: 4000 });
			window.print();
		}
	}


	let exportDropdownOpen = $state(false);
	let moreMenuOpen = $state(false);
	let anyDropdownOpen = $derived(headingDropdown || colorDropdown || highlightDropdown || alignDropdown || insertDropdown || tablePickerOpen || fontDropdown || fontSizeDropdown || exportDropdownOpen || moreMenuOpen);
	let editorState = $state(0);
	let editorStateRaf = 0; // RAF handle for batching toolbar updates


	// AI
	let aiMenu = $state<{ x: number; y: number } | null>(null);
	let aiLoading = $state(false);
	let aiResult = $state<string | null>(null);
	let aiError = $state<string | null>(null);
	let aiSelectionFrom = $state(0);
	let aiSelectionTo = $state(0);
	let aiSelectedText = $state('');
	let aiCustomPrompt = $state('');
	let aiShowCustom = $state(false);
	let aiTranslateMenu = $state(false);
	let aiWholeNote = $state(false);
	let aiEmptyNote = $state(false);
	let aiOriginalMarkdown = $state('');
	let aiMediaPlaceholders = $state<Map<string, string>>(new Map());
	let aiStreamUnlisten: (() => void) | null = null;

	// Bubble Menu
	let bubbleMenuCoords = $state<{ x: number; y: number } | null>(null);
	let showBubbleMenu = $derived(!!bubbleMenuCoords && !$readOnly && !$sourceMode);

	function updateBubbleMenu() {
		if (!editor || editor.state.selection.empty || !(editor.state.selection instanceof TextSelection) || $readOnly || $sourceMode) {
			bubbleMenuCoords = null;
			return;
		}
		
		try {
			const { from, to } = editor.state.selection;
			const fromCoords = editor.view.coordsAtPos(from);
			const toCoords = editor.view.coordsAtPos(to);
			
			const editorBody = document.querySelector('.editor-body') as HTMLElement | null;
			if (!editorBody) return;
			const rect = editorBody.getBoundingClientRect();
			const computedStyle = window.getComputedStyle(editorBody);
			const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
			const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
			const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
			const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;

			// Viewport coordinates of selection center
			const left = (fromCoords.left + toCoords.left) / 2;
			const top = Math.min(fromCoords.top, toCoords.top);
			
			// Clamp selection center to prevent floating bubble menu from going off-screen horizontally
			const menuWidth = 272; // Width of bubble menu container
			const halfWidth = menuWidth / 2;
			let clampedLeft = left;
			if (rect.width > menuWidth + 16) {
				const minLeft = rect.left + halfWidth + 8;
				const maxLeft = rect.right - halfWidth - 8;
				clampedLeft = Math.max(minLeft, Math.min(maxLeft, left));
			} else {
				clampedLeft = rect.left + rect.width / 2;
			}

			// Convert to editor-body relative coordinates, adjusting for borders, padding, and scroll
			const x = clampedLeft - rect.left - borderLeft - paddingLeft + editorBody.scrollLeft;
			const y = top - rect.top - borderTop - paddingTop + editorBody.scrollTop - 44; // 44px above selection
			
			bubbleMenuCoords = { x, y };
		} catch (e) {
			bubbleMenuCoords = null;
		}
	}


	// Outline
	let showOutline = $state(false);
	interface OutlineHeading { level: number; text: string; pos: number; }
	let outlineHeadings = $state<OutlineHeading[]>([]);

	function updateOutline() {
		if (!editor) { outlineHeadings = []; return; }
		const headings: OutlineHeading[] = [];
		editor.state.doc.descendants((node, pos) => {
			if (node.type.name === 'heading') {
				headings.push({ level: node.attrs.level, text: node.textContent, pos });
			}
		});
		outlineHeadings = headings;
	}

	function scrollToHeading(pos: number) {
		if (!editor) return;
		editor.commands.setTextSelection(pos + 1);
		editor.commands.scrollIntoView();
		editor.view.focus();
	}

	// Version history
	let showHistory = $state(false);
	let showGraph = $state(false);
	let historyVersions = $state<VersionEntry[]>([]);
	let historyPreview = $state<string | null>(null);
	let historySelected = $state<VersionEntry | null>(null);
	let historyLoading = $state(false);

	// In-note search
	let noteSearchOpen = $state(false);
	let noteSearchQuery = $state('');
	let noteSearchIndex = $state(0);
	let noteSearchResults = $state<{from: number, to: number}[]>([]);
	let noteSearchInput = $state<HTMLInputElement>(null!);
	const noteSearchPluginKey = new PluginKey('noteSearch');

	// Slash commands
	let slashMenu = $state<{ x: number; y: number; query: string; from: number; to: number } | null>(null);
	let slashSelectedIndex = $state(0);
	let slashTablePicker = $state(false);
	let slashTableHover = $state({ rows: 0, cols: 0 });
	let slashColorPicker = $state(false);
	let slashColorHex = $state('#4b6abf');
	let slashColorInputEl = $state<HTMLInputElement | null>(null);
	const colorPresets = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b', '#000000', '#ffffff'];

	interface SlashCommand {
		label: string;
		description?: string;
		aliases: string[];
		icon: string;
		action: () => void;
		category: 'insert' | 'text' | 'utility';
		badge?: string;
	}

	function insertTimestamp(kind: 'date' | 'time' | 'datetime') {
		if (!editor) return;
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
		const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
		const text = kind === 'date' ? date : kind === 'time' ? time : `${date} ${time}`;
		editor.chain().focus().insertContent(text).run();
	}

	function getSlashCommands(): SlashCommand[] {
		return [
			// ═══ CATEGORY: INSERT ═══
			{
				label: 'Table',
				description: 'Insert a pre-formatted 3x3 table',
				aliases: ['table', 'grid'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
				action: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
				category: 'insert'
			},
			{
				label: 'Diagram',
				description: 'Draw shapes, arrows & flowcharts on a canvas',
				aliases: ['diagram', 'draw', 'drawio', 'flowchart', 'sketch', 'canvas', 'whiteboard'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M10 6.5h4a3 3 0 0 1 3 3V14"/></svg>',
				action: () => openDiagramInsert(),
				category: 'insert',
				badge: 'New'
			},

			{
				label: 'Bullet List',
				description: 'Start a bulleted list',
				aliases: ['ul', 'unordered', 'bullets', 'list', 'bullet'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg>',
				action: () => editor?.chain().focus().toggleBulletList().run(),
				category: 'insert'
			},
			{
				label: 'Numbered List',
				description: 'Start a numbered list',
				aliases: ['ol', 'ordered', 'number', 'list'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="9" font-size="8" fill="currentColor" stroke="none">1</text><text x="1" y="15" font-size="8" fill="currentColor" stroke="none">2</text><text x="1" y="21" font-size="8" fill="currentColor" stroke="none">3</text></svg>',
				action: () => editor?.chain().focus().toggleOrderedList().run(),
				category: 'insert'
			},
			{
				label: 'Blockquote',
				description: 'Insert a quote section',
				aliases: ['quote', 'blockquote', 'citation'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
				action: () => editor?.chain().focus().toggleBlockquote().run(),
				category: 'insert'
			},
			{
				label: 'Callout Box',
				description: 'Insert a highlighted alert box',
				aliases: ['callout', 'box', 'alert', 'note', 'tip', 'warning'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>',
				action: () => editor?.chain().focus().insertContent({ type: 'callout', attrs: { type: 'note' }, content: [{ type: 'paragraph' }] }).run(),
				category: 'insert',
				badge: 'New'
			},
			{
				label: 'Cal Block',
				description: 'Insert an inline calculation sheet',
				aliases: ['cal', 'calc', 'metric', 'metrics', 'calculate', 'spreadsheet', 'cal block'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>',
				action: () => editor?.chain().focus().insertContent({ type: 'metrics', attrs: { id: 'metrics_' + Math.random().toString(36).substring(2, 9), title: 'Cal Block', data: '[]', excludeChecked: false } }).command(({ tr }) => {
					const { selection } = tr;
					if (selection instanceof NodeSelection) {
						tr.setSelection(TextSelection.near(tr.doc.resolve(selection.to)));
					}
					return true;
				}).run(),
				category: 'insert',
				badge: 'New'
			},
			{
				label: 'Code Block',
				description: 'Insert a syntax-highlighted code block',
				aliases: ['code', 'codeblock', 'pre', 'snippet'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
				action: () => editor?.chain().focus().toggleCodeBlock().run(),
				category: 'insert'
			},
			{
				label: 'Collapsible Section',
				description: 'Insert a collapsible details block',
				aliases: ['details', 'accordion', 'collapse', 'toggle', 'summary'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="10 8 14 12 10 16"/></svg>',
				action: () => insertDetails(),
				category: 'insert',
				badge: 'New'
			},
			{
				label: 'Horizontal Rule',
				description: 'Insert a divider line',
				aliases: ['hr', 'divider', 'line', 'separator', 'rule'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="12" x2="22" y2="12"/></svg>',
				action: () => editor?.chain().focus().setHorizontalRule().run(),
				category: 'insert'
			},
			{
				label: 'Page Break',
				description: 'Insert a printed page break',
				aliases: ['pagebreak', 'page', 'break', 'newpage', 'print'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="9" x2="22" y2="9" stroke-dasharray="4 2"/><line x1="2" y1="15" x2="22" y2="15" stroke-dasharray="4 2"/><path d="M6 5v4M18 5v4M6 15v4M18 15v4"/></svg>',
				action: () => editor?.chain().focus().insertContent({ type: 'pageBreak' }).run(),
				category: 'insert'
			},
			{
				label: 'Math Block',
				description: 'Insert a LaTeX formula block',
				aliases: ['math', 'latex', 'equation', 'formula', 'tex', 'katex'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h6l4 14h6"/><path d="M7 19l10-14"/></svg>',
				action: () => openMathInsert('block'),
				category: 'insert'
			},
			{
				label: 'Math Inline',
				description: 'Insert a LaTeX inline formula',
				aliases: ['mathinline', 'inline-math', 'imath', 'inlinemath'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h2l3 8h2"/><path d="M8 12l8-4"/></svg>',
				action: () => openMathInsert('inline'),
				category: 'insert'
			},

			// ═══ CATEGORY: TEXT ═══
			{
				label: 'Heading 1',
				description: 'Large heading',
				aliases: ['h1', 'heading1', 'title', 'large'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h8M4 4v16M12 4v16M17 12l3-2v8"/></svg>',
				action: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
				category: 'text'
			},
			{
				label: 'Heading 2',
				description: 'Medium heading',
				aliases: ['h2', 'heading2', 'subtitle', 'medium'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h8M4 4v16M12 4v16"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>',
				action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
				category: 'text'
			},
			{
				label: 'Heading 3',
				description: 'Small heading',
				aliases: ['h3', 'heading3', 'small'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h8M4 4v16M12 4v16"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 01-2 2m2 0a2 2 0 01-2 2c-1.5 0-3.5 0-3.5-1.5"/></svg>',
				action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
				category: 'text'
			},
			{
				label: 'Text',
				description: 'Normal text',
				aliases: ['text', 'p', 'paragraph', 'normal'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>',
				action: () => editor?.chain().focus().setParagraph().run(),
				category: 'text'
			},

			// ═══ CATEGORY: UTILITY ═══
			{
				label: 'Date',
				description: 'Insert today\'s date',
				aliases: ['date', 'today', 'day'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
				action: () => insertTimestamp('date'),
				category: 'utility'
			},
			{
				label: 'Time',
				description: 'Insert current time',
				aliases: ['time', 'clock'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
				action: () => insertTimestamp('time'),
				category: 'utility'
			},
			{
				label: 'Date & Time',
				description: 'Insert current date & time',
				aliases: ['datetime', 'now', 'timestamp', 'stamp'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><circle cx="18" cy="17" r="4"/><path d="M18 15.5v1.5l1 1"/></svg>',
				action: () => insertTimestamp('datetime'),
				category: 'utility'
			},
			{
				label: 'Color',
				description: 'Insert colored text',
				aliases: ['color', 'colour', 'hex', 'rgb', 'swatch', 'palette'],
				icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
				action: () => { slashColorPicker = true; },
				category: 'utility'
			}
		];
	}

	let allFontsList = $derived([
		{ name: 'Default Font', value: '' },
		...allFonts
	]);

	let allSizesList = $derived([
		{ name: 'Default Size', value: '' },
		...allSizes.map(s => ({ name: s, value: s }))
	]);

	const slashColorsList = [
		{ name: 'Black', value: '#000000' },
		{ name: 'Dark grey', value: '#333333' },
		{ name: 'Medium grey', value: '#666666' },
		{ name: 'Light grey', value: '#b5b5b5' },
		{ name: 'Purple', value: '#a855f7' },
		{ name: 'Pink', value: '#ec4899' },
		{ name: 'Red', value: '#ef4444' },
		{ name: 'Orange', value: '#f97316' },
		{ name: 'Yellow', value: '#eab308' },
		{ name: 'Green', value: '#22c55e' },
		{ name: 'Teal', value: '#06b6d4' },
		{ name: 'Light blue', value: '#3b82f6' }
	];

	let slashFiltered = $derived.by(() => {
		// Get all potential font items
		const fontItems = allFontsList.map(f => ({
			type: 'font' as const,
			label: f.name,
			value: f.value,
			action: () => {
				setFontFamily(f.value);
				closeSlashMenu();
			}
		}));

		// Get all potential size items
		const sizeItems = allSizesList.map(s => ({
			type: 'size' as const,
			label: s.name,
			value: s.value,
			action: () => {
				setFontSize(s.value);
				closeSlashMenu();
			}
		}));

		// Get all potential color items
		const colorItems = slashColorsList.map(c => ({
			type: 'color' as const,
			label: c.name,
			value: c.value,
			action: () => {
				setTextColor(c.value);
				closeSlashMenu();
			}
		}));

		// Get all potential command items
		const commandItems = getSlashCommands().map(cmd => ({
			type: 'command' as const,
			label: cmd.label,
			description: cmd.description,
			aliases: cmd.aliases,
			icon: cmd.icon,
			action: cmd.action,
			category: cmd.category,
			badge: cmd.badge
		}));

		if (!slashMenu) {
			return {
				fonts: fontItems,
				sizes: sizeItems,
				colors: colorItems,
				commands: commandItems,
				flatList: [...fontItems, ...sizeItems, ...colorItems, ...commandItems]
			};
		}

		const q = slashMenu.query.toLowerCase().trim();
		if (!q) {
			return {
				fonts: fontItems,
				sizes: sizeItems,
				colors: colorItems,
				commands: commandItems,
				flatList: [...fontItems, ...sizeItems, ...colorItems, ...commandItems]
			};
		}

		// Filter fonts
		const filteredFonts = fontItems.filter(f => 
			f.label.toLowerCase().includes(q)
		);

		// Filter sizes
		const filteredSizes = sizeItems.filter(s => 
			s.label.toLowerCase().includes(q)
		);

		// Filter colors
		const filteredColors = colorItems.filter(c =>
			c.label.toLowerCase().includes(q)
		);

		// Filter commands
		const filteredCommands = commandItems.filter(cmd =>
			cmd.label.toLowerCase().includes(q) ||
			cmd.aliases.some(a => a.includes(q))
		);

		return {
			fonts: filteredFonts,
			sizes: filteredSizes,
			colors: filteredColors,
			commands: filteredCommands,
			flatList: [...filteredFonts, ...filteredSizes, ...filteredColors, ...filteredCommands]
		};
	});
	let titleInput = $state<HTMLInputElement>(null!);
	let linkModal = $state(false);
	let linkModalUrl = $state('');
	let linkModalInput = $state<HTMLInputElement>(null!);
	let linkSelectionFrom = 0;
	let linkSelectionTo = 0;
	let linkModalDisplayText = '';
	let linkSuggestIndex = $state(0);
	let linkSuggestTitles = $state<NoteTitleEntry[]>([]);
	let linkSuggestFiltered = $derived.by(() => {
		const q = linkModalUrl.trim().toLowerCase();
		if (!q || q.startsWith('http://') || q.startsWith('https://') || q.startsWith('mailto:')) return [];
		return linkSuggestTitles.filter(e => e.title.toLowerCase().includes(q)).slice(0, 8);
	});
	let textContextMenu = $state<{ x: number; y: number } | null>(null);
	let tableContextMenu = $state<{ x: number; y: number } | null>(null);
	let tablePickerHover = $state({ rows: 0, cols: 0 });
	let imageToolbar = $state<{ pos: number; x: number; y: number; size: string; src: string } | null>(null);
	let diagramToolbar = $state<{ pos: number; x: number; y: number; size: string; align: string } | null>(null);
	let copyToast = $state<'copying' | 'done' | null>(null);

	// Math insert/edit modal (opened by /math slash command or double-click on existing math node)
	let mathModal = $state<{ kind: 'block' | 'inline'; editPos: number | null; tex: string } | null>(null);

	// ═══ DIAGRAM (native draw.io-style) editor wiring ═══
	let diagramModal = $state<{ pos: number | null; data: string } | null>(null);
	let currentDiagramEditorType = $state<'native' | 'drawio' | 'mermaid' | null>(null);
	function openDiagramInsert() {
		diagramModal = { pos: null, data: '' };
		currentDiagramEditorType = appState.diagramEditorType;
	}
	function openDiagramEditor(pos: number, data: string) {
		diagramModal = { pos, data };
		const d = decodeDiagram(data);
		if (d.mermaidCode) {
			currentDiagramEditorType = 'mermaid';
		} else if (d.drawioXml) {
			currentDiagramEditorType = 'drawio';
		} else if (d.shapes.length > 0) {
			currentDiagramEditorType = 'native';
		} else {
			currentDiagramEditorType = appState.diagramEditorType;
		}
	}
	function cancelDiagram() {
		diagramModal = null;
		currentDiagramEditorType = null;
	}
	function changeDiagramEditorType(type: 'native' | 'drawio' | 'mermaid', currentData?: string) {
		currentDiagramEditorType = type;
		if (currentData !== undefined && diagramModal) {
			diagramModal.data = currentData;
		}
	}
	function commitDiagram(encoded: string) {
		if (!editor || !diagramModal) return;
		const { pos } = diagramModal;
		diagramModal = null;
		currentDiagramEditorType = null;
		if (pos !== null) {
			const node = editor.state.doc.nodeAt(pos);
			if (node && node.type.name === 'diagram') {
				const newNode = editor.schema.nodes.diagram.create({
					data: encoded,
					size: node.attrs.size || 'medium',
					align: node.attrs.align || 'center'
				});
				const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, newNode);
				editor.view.dispatch(tr);
			}
		} else {
			editor.chain().focus().insertContent({ type: 'diagram', attrs: { data: encoded } }).run();
		}
		$editorDirty = true;
		autoSave();
	}

	function openMathInsert(kind: 'block' | 'inline') {
		mathModal = { kind, editPos: null, tex: '' };
	}
	function openMathEdit(pos: number, kind: 'block' | 'inline', tex: string) {
		mathModal = { kind, editPos: pos, tex };
	}
	function cancelMathModal() {
		mathModal = null;
	}
	function commitMathModal() {
		if (!editor || !mathModal) return;
		const { kind, editPos, tex } = mathModal;
		const trimmed = tex.trim();
		mathModal = null;
		if (!trimmed) return;
		if (editPos !== null) {
			const node = editor.state.doc.nodeAt(editPos);
			if (node && (node.type.name === 'mathBlock' || node.type.name === 'mathInline')) {
				const tr = editor.state.tr.setNodeAttribute(editPos, 'tex', trimmed);
				editor.view.dispatch(tr);
			}
		} else {
			const nodeType = kind === 'block' ? 'mathBlock' : 'mathInline';
			editor.chain().focus().insertContent({ type: nodeType, attrs: { tex: trimmed } }).run();
		}
	}
	const katexCache = new Map<string, string>();
	function renderKatex(tex: string, displayMode: boolean): string {
		const key = (displayMode ? 'B:' : 'I:') + tex;
		let html = katexCache.get(key);
		if (html === undefined) {
			try {
				html = katex.renderToString(tex, { displayMode, throwOnError: false });
			} catch {
				html = `<span class="katex-error">${tex}</span>`;
			}
			katexCache.set(key, html);
		}
		return html;
	}

	let mathObserver: IntersectionObserver | null = null;
	const mathPending = new WeakMap<Element, () => void>();
	function observeMath(dom: HTMLElement, render: () => void) {
		if (!mathObserver) {
			const root = (editorElement?.closest('.editor-body') as Element) ?? null;
			mathObserver = new IntersectionObserver((entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					const fn = mathPending.get(e.target);
					if (fn) { mathPending.delete(e.target); mathObserver!.unobserve(e.target); fn(); }
				}
			}, { root, rootMargin: '1000px 0px' });
		}
		mathPending.set(dom, render);
		mathObserver.observe(dom);
	}

	function renderMathPreview(tex: string, displayMode: boolean): string {
		if (!tex.trim()) return '';
		try {
			return katex.renderToString(tex, { displayMode, throwOnError: false });
		} catch (e: any) {
			return `<span class="math-modal-preview-error">${e?.message || String(e)}</span>`;
		}
	}

	// External-file viewer mode UI
	let viewerImportPickerOpen = $state(false);
	let viewerImportBusy = $state(false);
	let viewerToast = $state<string | null>(null);
	let viewerFlatNotebooks = $derived.by(() => {
		if (!viewerImportPickerOpen) return [] as Array<{ path: string; name: string; depth: number }>;
		const out: Array<{ path: string; name: string; depth: number }> = [];
		const walk = (list: any[], depth: number) => {
			for (const nb of list) {
				out.push({ path: nb.path, name: nb.name, depth });
				if (nb.children?.length) walk(nb.children, depth + 1);
			}
		};
		walk($notebooks, 0);
		return out;
	});

	function viewerFlash(msg: string) {
		viewerToast = msg;
		setTimeout(() => { viewerToast = null; }, 1500);
	}

	function closeViewer() {
		$viewerNote = null;
		$activeNote = null;
		$activeNotePath = null;
		$readOnly = false;
		appState.setFocusMode(false);
	}

	async function viewerImportTo(folderPath: string) {
		const v = $viewerNote;
		const vaultRoot = $appConfig?.active_vault;
		if (!v || !vaultRoot || viewerImportBusy) return;
		viewerImportBusy = true;
		try {
			const filename = v.path.split('/').pop() || 'imported.md';
			const baseName = filename.replace(/\.md$/i, '');
			const folder = folderPath ? `${vaultRoot}/${folderPath}` : vaultRoot;
			let dest = `${folder}/${filename}`;
			// Conflict resolution: append (2), (3)... if file exists
			let n = 2;
			// readNote throws if file doesn't exist; use it as an existence probe
			while (true) {
				try { await readNote(dest); } catch { break; }
				dest = `${folder}/${baseName} (${n}).md`;
				n++;
				if (n > 100) throw new Error('Could not find a free filename');
			}
			await copyFileTo(v.path, dest);
			// Switch to the imported note as a real vault note
			$viewerNote = null;
			$readOnly = false;
			appState.setFocusMode(false);
			viewerImportPickerOpen = false;
			const content = await readNote(dest);
			$activeNote = content;
			$activeNotePath = dest;
			$editorDirty = false;
			loadNote(dest, content.content);
			viewerFlash('Imported');
		} catch (e: any) {
			console.error('[Viewer] import failed', e);
			viewerFlash('Import failed: ' + (e?.message || String(e)));
		} finally {
			viewerImportBusy = false;
		}
	}
	let noteRelativePath = $derived($activeNotePath && $appConfig?.active_vault ? $activeNotePath.replace($appConfig.active_vault + '/', '') : '');
	let noteFolder = $derived(noteRelativePath ? noteRelativePath.substring(0, noteRelativePath.lastIndexOf('/')) : '');
	let isQuickAccess = $derived(noteRelativePath ? $quickAccessPaths.includes(noteRelativePath) : false);

	const lowlight = createLowlight(common);
	const codeLanguages = [...lowlight.listLanguages(), 'mermaid'].sort();
	const mdit = MarkdownIt({ html: true, linkify: false, breaks: false })
		.use(markdownItMark)
		.use(markdownItSup)
		.use(markdownItSub);
	// Disable indented code blocks - tab-indented text should stay as text, not become code
	mdit.disable('code');

	function normalizePath(p: string): string {
		const parts = p.split('/');
		const resolved: string[] = [];
		for (const seg of parts) {
			if (seg === '..') {
				resolved.pop();
			} else if (seg !== '.') {
				resolved.push(seg);
			}
		}
		return resolved.join('/');
	}

	const CustomImage = Image.extend({
		addAttributes() {
			return {
				...this.parent?.(),
				size: {
					default: 'full',
					parseHTML: (element: HTMLElement) => element.getAttribute('data-size') || 'full',
					renderHTML: (attributes: Record<string, any>) => {
						return { 'data-size': attributes.size };
					},
				},
			};
		},
	});

	function cellColorAttributes() {
		return {
			backgroundColor: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute('data-bg-color') || element.style.backgroundColor || null,
				renderHTML: (attributes: Record<string, any>) => {
					if (!attributes.backgroundColor) return {};
					const bg = attributes.backgroundColor;
					// Determine if we need light text for dark backgrounds
					const darkBgs = ['#1e293b', '#374151', '#7f1d1d', '#713f12', '#14532d', '#1e3a5f', '#4c1d95', '#831843', '#0c4a6e', '#064e3b'];
					const needsLight = darkBgs.includes(bg);
					const style = needsLight
						? `background-color: ${bg}; color: #f1f5f9`
						: `background-color: ${bg}`;
					return { style, 'data-bg-color': bg };
				},
			},
		};
	}

	const CustomTableCell = TableCell.extend({
		addAttributes() {
			return { ...this.parent?.(), ...cellColorAttributes() };
		},
	});

	const CustomTableHeader = TableHeader.extend({
		addAttributes() {
			return { ...this.parent?.(), ...cellColorAttributes() };
		},
	});

	const PdfEmbed = TiptapNode.create({
		name: 'pdfEmbed',
		group: 'block',
		atom: true,
		addAttributes() {
			return {
				src: { default: null },
				name: { default: 'file.pdf' },
			};
		},
		parseHTML() {
			return [{
				tag: 'div[data-pdf-src]',
				getAttrs: (el: HTMLElement) => ({
					src: el.getAttribute('data-pdf-src'),
					name: el.getAttribute('data-pdf-name') || 'file.pdf',
				}),
			}];
		},
		renderHTML({ HTMLAttributes }) {
			const src = HTMLAttributes.src || '';
			const name = HTMLAttributes.name || 'file.pdf';
			const showInline = !isMobile && ($appConfig?.pdf_preview ?? false);
			if (showInline) {
				const vaultRoot = $appConfig?.active_vault ?? '';
				const pdfHeight = $appConfig?.pdf_height ?? 600;
				const absPath = normalizePath(`${vaultRoot}/${decodeURIComponent(src)}`);
				const displaySrc = convertFileSrc(absPath);
				return ['div', mergeAttributes({ 'data-pdf-src': src, 'data-pdf-name': name, class: 'pdf-embed' }),
					['iframe', { src: displaySrc, width: '100%', height: `${pdfHeight}px`, frameborder: '0' }],
					['div', { class: 'pdf-footer' },
						['p', { class: 'pdf-label' }, name],
						['button', { class: 'pdf-download-btn', 'data-download-src': src, title: 'Download PDF' }, 'Download']
					]
				];
			}
			// Non-inline: render as a clickable link (mobile + desktop with setting off)
			return ['div', mergeAttributes({ 'data-pdf-src': src, 'data-pdf-name': name, class: 'pdf-embed-mobile' }),
				['a', { href: decodeURIComponent(src), class: 'pdf-link-mobile' },
					['span', { class: 'pdf-icon-mobile' }, '\uD83D\uDCC4'],
					['span', {}, name],
				],
			];
		},
	});

	function decodeDataURL(dataUrl: string): string {
		try {
			const parts = dataUrl.split(',');
			if (parts.length < 2) return '';
			const base64 = parts[1];
			const binString = atob(base64);
			const bytes = new Uint8Array(binString.length);
			for (let i = 0; i < binString.length; i++) {
				bytes[i] = binString.charCodeAt(i);
			}
			return new TextDecoder('utf-8').decode(bytes);
		} catch (e) {
			console.error('Failed to decode data URL:', e);
			return '';
		}
	}

	const FileAttachment = TiptapNode.create({
		name: 'fileAttachment',
		group: 'block',
		atom: true,
		draggable: true,
		addAttributes() {
			return {
				src: { default: null },
				filename: { default: 'file' },
				filesize: { default: 0 },
				filetype: { default: '' }
			};
		},
		parseHTML() {
			return [{
				tag: 'div[data-file-attachment]',
				getAttrs: (el: HTMLElement) => ({
					src: el.getAttribute('data-file-src'),
					filename: el.getAttribute('data-file-name') || 'file',
					filesize: Number(el.getAttribute('data-file-size') || '0'),
					filetype: el.getAttribute('data-file-type') || ''
				}),
			}];
		},
		renderHTML({ HTMLAttributes }) {
			const src = HTMLAttributes.src || '';
			const filename = HTMLAttributes.filename || 'file';
			const filesize = HTMLAttributes.filesize || 0;
			const filetype = HTMLAttributes.filetype || '';
			return ['div', {
				'data-file-attachment': '',
				'data-file-src': src,
				'data-file-name': filename,
				'data-file-size': filesize.toString(),
				'data-file-type': filetype,
				class: 'file-attachment-block'
			}];
		},
		addNodeView() {
			return ({ node, getPos }) => {
				const dom = document.createElement('div');
				dom.className = 'file-attachment-block';

				const src = node.attrs.src || '';
				const filename = node.attrs.filename || 'file';
				const filesize = node.attrs.filesize || 0;
				const filetype = node.attrs.filetype || '';

				const sizeKB = Math.round(filesize / 1024);
				const ext = filename.split('.').pop()?.toLowerCase() || '';

				let isText = filetype.startsWith('text/') || ['txt', 'md', 'js', 'ts', 'css', 'html', 'json', 'csv', 'xml', 'yaml', 'yml', 'sql', 'sh', 'py', 'go', 'rs', 'java', 'c', 'cpp'].includes(ext);
				let isAudio = filetype.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext);
				let isVideo = filetype.startsWith('video/') || ['mp4', 'webm', 'ogv', 'mov', 'mkv'].includes(ext);
				let isPdf = filetype === 'application/pdf' || ext === 'pdf';

				let isSpreadsheet = ['xlsx', 'xls', 'csv', 'tsv', 'ods'].includes(ext) || filetype.includes('spreadsheet') || filetype === 'text/csv' || filetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

				if (isPdf) {
					dom.className = 'file-attachment-block pdf-preview-container';
					const header = document.createElement('div');
					header.className = 'file-header';
					const title = document.createElement('div');
					title.className = 'file-title';
					title.innerHTML = `<span class="file-icon">📕</span> <span class="file-name">${filename}</span> <span class="file-size">(${sizeKB} KB)</span>`;
					const actions = document.createElement('div');
					actions.className = 'file-actions';
					const downloadBtn = document.createElement('button');
					downloadBtn.className = 'file-action-btn';
					downloadBtn.innerHTML = '📥 Download';
					downloadBtn.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						downloadFile(src);
					};
					actions.appendChild(downloadBtn);
					header.appendChild(title);
					header.appendChild(actions);
					dom.appendChild(header);

					const iframeContainer = document.createElement('div');
					iframeContainer.className = 'pdf-iframe-wrapper';
					const iframe = document.createElement('iframe');
					iframe.src = src;
					iframe.className = 'pdf-preview-iframe';
					iframe.setAttribute('frameborder', '0');
					iframeContainer.appendChild(iframe);
					dom.appendChild(iframeContainer);

				} else if (isSpreadsheet) {
					dom.className = 'file-attachment-block spreadsheet-preview-container';
					const header = document.createElement('div');
					header.className = 'file-header';
					header.style.background = '#202020';
					header.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
					
					const title = document.createElement('div');
					title.className = 'file-title';
					title.style.color = '#ffffff';
					
					const excelIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="margin-right: 2px; display: block;">
						<rect x="2" y="2" width="20" height="20" rx="4" fill="#107c41"/>
						<path d="M7 6h3.5l2 4 2-4H18l-3.5 6 3.5 6h-3.5l-2-4-2 4H7l3.5-6z" fill="#ffffff"/>
					</svg>`;
					
					title.innerHTML = `${excelIcon} <span class="file-name" style="color: #ffffff; max-width: 450px;">${filename}</span>`;
					
					const actions = document.createElement('div');
					actions.className = 'file-actions';
					actions.style.gap = '12px';
					
					const infoIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3498db" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="cursor: pointer; display: block;" title="Download File"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
					
					const infoBtn = document.createElement('div');
					infoBtn.innerHTML = infoIcon;
					infoBtn.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						downloadFile(src);
					};
					
					const sizeLabel = document.createElement('span');
					sizeLabel.className = 'file-size';
					sizeLabel.style.color = '#888888';
					sizeLabel.textContent = `${sizeKB} kB`;
					
					actions.appendChild(infoBtn);
					actions.appendChild(sizeLabel);
					header.appendChild(title);
					header.appendChild(actions);
					dom.appendChild(header);

					const contentContainer = document.createElement('div');
					contentContainer.className = 'spreadsheet-preview-content';
					contentContainer.innerHTML = '<div class="spreadsheet-loading">Loading spreadsheet preview...</div>';
					dom.appendChild(contentContainer);

					fetch(src)
						.then(res => res.arrayBuffer())
						.then(buffer => {
							const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellStyles: true });
							contentContainer.innerHTML = '';
							
							if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
								contentContainer.innerHTML = '<div class="spreadsheet-error">No sheets found in workbook.</div>';
								return;
							}

							const tableWrapper = document.createElement('div');
							tableWrapper.className = 'spreadsheet-table-wrapper';
							
							const tabsContainer = document.createElement('div');
							tabsContainer.className = 'spreadsheet-tabs';
							
							contentContainer.appendChild(tableWrapper);
							contentContainer.appendChild(tabsContainer);

							function renderSheet(sheetName: string) {
								const sheet = workbook.Sheets[sheetName];
								const ref = sheet['!ref'];
								if (!ref) {
									tableWrapper.innerHTML = '<div class="spreadsheet-empty">Empty Sheet</div>';
									return;
								}
								
								const range = XLSX.utils.decode_range(ref);
								const merges = sheet['!merges'] || [];
								const mergeMap = new Set<string>();
								const mergeAttrs: Record<string, {rowspan?: number, colspan?: number}> = {};
								
								merges.forEach(merge => {
									const startCell = XLSX.utils.encode_cell(merge.s);
									const rowspan = merge.e.r - merge.s.r + 1;
									const colspan = merge.e.c - merge.s.c + 1;
									mergeAttrs[startCell] = {
										rowspan: rowspan > 1 ? rowspan : undefined,
										colspan: colspan > 1 ? colspan : undefined
									};
									
									for (let r = merge.s.r; r <= merge.e.r; r++) {
										for (let c = merge.s.c; c <= merge.e.c; c++) {
											if (r === merge.s.r && c === merge.s.c) continue;
											mergeMap.add(`${r},${c}`);
										}
									}
								});

								let maxRow = range.s.r;
								let maxCol = range.s.c;
								for (let r = range.s.r; r <= range.e.r; r++) {
									for (let c = range.s.c; c <= range.e.c; c++) {
										const cellRef = XLSX.utils.encode_cell({ r, c });
										if (sheet[cellRef]) {
											maxRow = Math.max(maxRow, r);
											maxCol = Math.max(maxCol, c);
										}
									}
								}

								const cols = sheet['!cols'] || [];
								let html = '<table class="spreadsheet-table"><colgroup>';
								for (let c = range.s.c; c <= maxCol; c++) {
									const colWidth = cols[c]?.wpx || cols[c]?.width || 120;
									const widthVal = typeof colWidth === 'number' ? Math.max(colWidth * 8, 80) : 120;
									html += `<col style="width: ${widthVal}px; min-width: ${widthVal}px;" />`;
								}
								html += '</colgroup>';

								for (let r = range.s.r; r <= maxRow; r++) {
									html += '<tr>';
									for (let c = range.s.c; c <= maxCol; c++) {
										if (mergeMap.has(`${r},${c}`)) continue;
										
										const cellRef = XLSX.utils.encode_cell({ r, c });
										const cell = sheet[cellRef];
										
										let content = '';
										let cellStyle = '';
										let attrs = '';
										
										if (cell) {
											content = cell.w || cell.v || '';
											content = String(content)
												.replace(/&/g, '&amp;')
												.replace(/</g, '&lt;')
												.replace(/>/g, '&gt;')
												.replace(/"/g, '&quot;');
												
											if (cell.s) {
												const s = cell.s;
												if (s.fill && s.fill.fgColor && s.fill.fgColor.rgb) {
													const rgb = s.fill.fgColor.rgb;
													const colorHex = rgb.length === 8 ? rgb.substring(2) : rgb;
													cellStyle += `background-color: #${colorHex} !important;`;
												}
												if (s.font) {
													if (s.font.bold) cellStyle += 'font-weight: bold;';
													if (s.font.italic) cellStyle += 'font-style: italic;';
													if (s.font.color && s.font.color.rgb) {
														const rgb = s.font.color.rgb;
														const colorHex = rgb.length === 8 ? rgb.substring(2) : rgb;
														cellStyle += `color: #${colorHex} !important;`;
													}
												}
												if (s.alignment) {
													if (s.alignment.horizontal) {
														cellStyle += `text-align: ${s.alignment.horizontal};`;
													}
													if (s.alignment.vertical) {
														cellStyle += `vertical-align: ${s.alignment.vertical};`;
													}
												}
											}
										}
										
										const mAttr = mergeAttrs[cellRef];
										if (mAttr) {
											if (mAttr.rowspan) attrs += ` rowspan="${mAttr.rowspan}"`;
											if (mAttr.colspan) attrs += ` colspan="${mAttr.colspan}"`;
										}
										
										if (cellStyle) {
											attrs += ` style="${cellStyle}"`;
										}
										
										html += `<td${attrs}>${content}</td>`;
									}
									html += '</tr>';
								}
								html += '</table>';
								tableWrapper.innerHTML = html;
							}

							if (workbook.SheetNames.length > 1) {
								workbook.SheetNames.forEach((sheetName, index) => {
									const tab = document.createElement('button');
									tab.className = 'spreadsheet-tab-btn' + (index === 0 ? ' active' : '');
									tab.textContent = sheetName;
									tab.onclick = (e) => {
										e.preventDefault();
										e.stopPropagation();
										tabsContainer.querySelectorAll('.spreadsheet-tab-btn').forEach(btn => btn.classList.remove('active'));
										tab.classList.add('active');
										renderSheet(sheetName);
									};
									tabsContainer.appendChild(tab);
								});
							} else {
								tabsContainer.style.display = 'none';
							}

							renderSheet(workbook.SheetNames[0]);
						})
						.catch(err => {
							console.error('Error loading Excel preview:', err);
							contentContainer.innerHTML = '<div class="spreadsheet-error">Could not display excel preview. Click Download to open.</div>';
						});

				} else if (isText) {
					dom.className = 'file-attachment-block text-preview-container';
					const header = document.createElement('div');
					header.className = 'file-header';
					const title = document.createElement('div');
					title.className = 'file-title';
					title.innerHTML = `<span class="file-icon">📝</span> <span class="file-name">${filename}</span> <span class="file-size">(${sizeKB} KB)</span>`;
					const actions = document.createElement('div');
					actions.className = 'file-actions';
					const copyBtn = document.createElement('button');
					copyBtn.className = 'file-action-btn';
					copyBtn.innerHTML = '📋 Copy Text';
					copyBtn.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						let text = '';
						if (src.startsWith('data:')) {
							text = decodeDataURL(src);
						} else {
							text = src;
						}
						navigator.clipboard.writeText(text);
						appState.showToast('Text copied to clipboard!', 'success');
					};
					const downloadBtn = document.createElement('button');
					downloadBtn.className = 'file-action-btn';
					downloadBtn.innerHTML = '📥 Download';
					downloadBtn.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						downloadFile(src);
					};
					actions.appendChild(copyBtn);
					actions.appendChild(downloadBtn);
					header.appendChild(title);
					header.appendChild(actions);
					dom.appendChild(header);

					const textContentContainer = document.createElement('pre');
					textContentContainer.className = 'text-preview-content';
					let decodedText = 'Loading contents...';
					if (src.startsWith('data:')) {
						decodedText = decodeDataURL(src);
					} else {
						decodedText = src;
					}
					textContentContainer.textContent = decodedText;
					dom.appendChild(textContentContainer);

				} else if (isAudio) {
					dom.className = 'file-attachment-block audio-preview-container';
					const header = document.createElement('div');
					header.className = 'file-header';
					const title = document.createElement('div');
					title.className = 'file-title';
					title.innerHTML = `<span class="file-icon">🎵</span> <span class="file-name">${filename}</span> <span class="file-size">(${sizeKB} KB)</span>`;
					const actions = document.createElement('div');
					actions.className = 'file-actions';
					const downloadBtn = document.createElement('button');
					downloadBtn.className = 'file-action-btn';
					downloadBtn.innerHTML = '📥 Download';
					downloadBtn.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						downloadFile(src);
					};
					actions.appendChild(downloadBtn);
					header.appendChild(title);
					header.appendChild(actions);
					dom.appendChild(header);

					const audioContainer = document.createElement('div');
					audioContainer.className = 'audio-player-wrapper';
					const audio = document.createElement('audio');
					audio.src = src;
					audio.controls = true;
					audio.className = 'audio-preview-element';
					audioContainer.appendChild(audio);
					dom.appendChild(audioContainer);

				} else if (isVideo) {
					dom.className = 'file-attachment-block video-preview-container';
					const header = document.createElement('div');
					header.className = 'file-header';
					const title = document.createElement('div');
					title.className = 'file-title';
					title.innerHTML = `<span class="file-icon">🎥</span> <span class="file-name">${filename}</span> <span class="file-size">(${sizeKB} KB)</span>`;
					const actions = document.createElement('div');
					actions.className = 'file-actions';
					const downloadBtn = document.createElement('button');
					downloadBtn.className = 'file-action-btn';
					downloadBtn.innerHTML = '📥 Download';
					downloadBtn.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						downloadFile(src);
					};
					actions.appendChild(downloadBtn);
					header.appendChild(title);
					header.appendChild(actions);
					dom.appendChild(header);

					const videoContainer = document.createElement('div');
					videoContainer.className = 'video-player-wrapper';
					const video = document.createElement('video');
					video.src = src;
					video.controls = true;
					video.className = 'video-preview-element';
					videoContainer.appendChild(video);
					dom.appendChild(videoContainer);

				} else {
					dom.className = 'file-attachment-block card-preview-container';
					const card = document.createElement('div');
					let icon = '📎';
					let colorClass = 'other';
					if (['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) {
						icon = '📦';
						colorClass = 'archive';
					} else if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) {
						icon = '📘';
						colorClass = 'document';
					} else if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) {
						icon = '📊';
						colorClass = 'spreadsheet';
					} else if (['ppt', 'pptx', 'odp'].includes(ext)) {
						icon = '📙';
						colorClass = 'presentation';
					}

					card.className = `file-card ${colorClass}`;
					card.innerHTML = `
						<div class="file-card-left">
							<span class="file-card-icon">${icon}</span>
						</div>
						<div class="file-card-middle">
							<div class="file-card-name">${filename}</div>
							<div class="file-card-meta">${sizeKB} KB • ${ext.toUpperCase()} File</div>
						</div>
						<div class="file-card-right">
							<button class="file-card-download-btn" title="Download File">📥</button>
						</div>
					`;

					card.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						downloadFile(src);
					};
					dom.appendChild(card);
				}

				return { dom };
			};
		}
	});

	const MathBlock = TiptapNode.create({
		name: 'mathBlock',
		group: 'block',
		atom: true,
		addAttributes() {
			return { tex: { default: '' } };
		},
		parseHTML() {
			return [{
				tag: 'div[data-math-block]',
				getAttrs: (el: HTMLElement) => ({ tex: decodeURIComponent(el.getAttribute('data-math-block') || '') }),
			}];
		},
		renderHTML({ HTMLAttributes }) {
			const tex = HTMLAttributes.tex || '';
			const rendered = renderKatex(tex, true);
			return ['div', { 'data-math-block': encodeURIComponent(tex), class: 'math-block', contenteditable: 'false' }, ['div', { innerHTML: rendered }]];
		},
		addNodeView() {
			return ({ node, getPos }) => {
				const dom = document.createElement('div');
				dom.classList.add('math-block');
				dom.contentEditable = 'false';
				dom.setAttribute('data-math-block', encodeURIComponent(node.attrs.tex));
				const render = () => { dom.innerHTML = renderKatex(node.attrs.tex, true); };
				if (isLargeDoc) { dom.textContent = node.attrs.tex; observeMath(dom, render); } else { render(); }
				dom.addEventListener('dblclick', (e) => {
					e.preventDefault();
					e.stopPropagation();
					const pos = typeof getPos === 'function' ? getPos() : null;
					if (pos !== null && pos !== undefined) openMathEdit(pos, 'block', node.attrs.tex);
				});
				return { dom, destroy() { mathObserver?.unobserve(dom); mathPending.delete(dom); } };
			};
		},
	});

	const MathInline = TiptapNode.create({
		name: 'mathInline',
		group: 'inline',
		inline: true,
		atom: true,
		addAttributes() {
			return { tex: { default: '' } };
		},
		parseHTML() {
			return [{
				tag: 'span[data-math-inline]',
				getAttrs: (el: HTMLElement) => ({ tex: decodeURIComponent(el.getAttribute('data-math-inline') || '') }),
			}];
		},
		renderHTML({ HTMLAttributes }) {
			const tex = HTMLAttributes.tex || '';
			const rendered = renderKatex(tex, false);
			return ['span', { 'data-math-inline': encodeURIComponent(tex), class: 'math-inline', contenteditable: 'false' }, ['span', { innerHTML: rendered }]];
		},
		addNodeView() {
			return ({ node, getPos }) => {
				const dom = document.createElement('span');
				dom.classList.add('math-inline');
				dom.contentEditable = 'false';
				dom.setAttribute('data-math-inline', encodeURIComponent(node.attrs.tex));
				const render = () => { dom.innerHTML = renderKatex(node.attrs.tex, false); };
				if (isLargeDoc) { dom.textContent = node.attrs.tex; observeMath(dom, render); } else { render(); }
				dom.addEventListener('dblclick', (e) => {
					e.preventDefault();
					e.stopPropagation();
					const pos = typeof getPos === 'function' ? getPos() : null;
					if (pos !== null && pos !== undefined) openMathEdit(pos, 'inline', node.attrs.tex);
				});
				return { dom, destroy() { mathObserver?.unobserve(dom); mathPending.delete(dom); } };
			};
		},
	});

	// ═══ DIAGRAM NODE (native draw.io-style canvas, stored as JSON, rendered as SVG) ═══
	const Diagram = TiptapNode.create({
		name: 'diagram',
		group: 'block',
		atom: true,
		draggable: true,
		addAttributes() {
			return {
				data: { default: '' },
				size: { default: 'medium' },
				align: { default: 'center' }
			};
		},
		parseHTML() {
			return [{
				tag: 'div[data-diagram]',
				getAttrs: (el: HTMLElement) => ({
					data: el.getAttribute('data-diagram') || '',
					size: el.getAttribute('data-size') || 'medium',
					align: el.getAttribute('data-align') || 'center'
				}),
			}];
		},
		renderHTML({ HTMLAttributes }) {
			// Serialize with an embedded SVG so exports (HTML/PDF) display the diagram,
			// while keeping the JSON in data-diagram for re-editing.
			const data = HTMLAttributes.data || '';
			const size = HTMLAttributes.size || 'medium';
			const align = HTMLAttributes.align || 'center';
			const dom = document.createElement('div');
			dom.setAttribute('data-diagram', data);
			dom.setAttribute('data-size', size);
			dom.setAttribute('data-align', align);
			dom.className = 'diagram-block';
			try {
				const d = decodeDiagram(data);
				if (d.mermaidCode) {
					dom.setAttribute('data-diagram-type', 'mermaid');
				} else {
					dom.removeAttribute('data-diagram-type');
				}
				const hasContent = d.shapes.length > 0 || !!d.drawioSvg || !!d.drawioXml || !!d.mermaidSvg || !!d.mermaidCode;
				if (hasContent) dom.innerHTML = renderDiagramSVG(d);
			} catch (e) { /* ignore */ }
			return dom;
		},
		addNodeView() {
			return ({ node, getPos, editor }) => {
				const dom = document.createElement('div');
				dom.className = 'diagram-block';
				dom.setAttribute('data-diagram', node.attrs.data || '');
				dom.setAttribute('data-size', node.attrs.size || 'medium');
				dom.setAttribute('data-align', node.attrs.align || 'center');
				
				let lastRenderedData = node.attrs.data || '';
				let lastRenderedSize = node.attrs.size || 'medium';
				let lastRenderedAlign = node.attrs.align || 'center';

				const render = () => {
					const enc = dom.getAttribute('data-diagram') || '';
					let inner = '';
					try {
						const d = decodeDiagram(enc);
						if (d.mermaidCode) {
							dom.setAttribute('data-diagram-type', 'mermaid');
						} else {
							dom.removeAttribute('data-diagram-type');
						}
						const hasContent = d.shapes.length > 0 || !!d.drawioSvg || !!d.drawioXml || !!d.mermaidSvg || !!d.mermaidCode;
						inner = hasContent ? renderDiagramSVG(d) : '';
					} catch (e) { /* ignore */ }
					dom.innerHTML = inner || (appState.isReadOnly ? '<div class="diagram-empty">Empty diagram</div>' : '<div class="diagram-empty">✎ Empty diagram — double-click to edit</div>');
				};
				render();
				let lastTap = 0;

				// UI-M-012: reliable diagram tap handling via unified Pointer Events.
				// Using pointerdown (one event per physical input) avoids the historical
				// race where a touchstart was followed by a synthetic mousedown on mobile,
				// which caused double-edits / cursor jumps. A single tap never focuses the
				// editor (so the soft keyboard stays closed); a double tap within the delay
				// opens the diagram editor.
				const handlePointerDown = (e: PointerEvent) => {
					if (appState.isReadOnly) return;
					if (e.button === 2) return; // ignore right-click / context menu
					const target = e.target as HTMLElement;
					if (target.closest('button') || target.closest('.mermaid-render-toolbar') || target.closest('input') || target.closest('a')) {
						return;
					}

					const now = Date.now();
					const DOUBLE_PRESS_DELAY = 320;

					if (now - lastTap < DOUBLE_PRESS_DELAY) {
						e.preventDefault();
						e.stopPropagation();
						const pos = typeof getPos === 'function' ? getPos() : null;
						if (pos !== null && pos !== undefined) {
							openDiagramEditor(pos, node.attrs.data || '');
						}
						lastTap = 0;
					} else {
						lastTap = now;
					}
				};

				dom.addEventListener('pointerdown', handlePointerDown);
				return {
					dom,
					stopEvent(event) {
						// Prevent pointer/touch events on the diagram block from focusing the
						// editor and opening the mobile virtual keyboard (UI-M-012).
						if (
							event.type === 'pointerdown' ||
							event.type === 'pointerup' ||
							event.type === 'mousedown' ||
							event.type === 'touchstart' ||
							event.type === 'click' ||
							event.type === 'touchend'
						) {
							return true;
						}
						return false;
					},
					ignoreMutation() {
						return true;
					},
					update(updatedNode: any) {
						if (updatedNode.type.name !== 'diagram') return false;
						
						// Update reference to node for closure access in double-click event handler
						node = updatedNode;

						const newData = updatedNode.attrs.data || '';
						const newSize = updatedNode.attrs.size || 'medium';
						const newAlign = updatedNode.attrs.align || 'center';
						
						const changed =
							newData !== lastRenderedData ||
							newSize !== lastRenderedSize ||
							newAlign !== lastRenderedAlign;
							
						dom.setAttribute('data-diagram', newData);
						dom.setAttribute('data-size', newSize);
						dom.setAttribute('data-align', newAlign);
						
						if (changed) {
							lastRenderedData = newData;
							lastRenderedSize = newSize;
							lastRenderedAlign = newAlign;
							render();
						}
						
						return true;
					}
				};
			};
		},
	});

	const HeadingShortcuts = Extension.create({
		name: 'headingShortcuts',
		addKeyboardShortcuts() {
			const toggle = (level: 1 | 2 | 3 | 4 | 5 | 6) => () =>
				this.editor.chain().focus().toggleHeading({ level }).run();
			return {
				'Mod-1': toggle(1),
				'Mod-2': toggle(2),
				'Mod-3': toggle(3),
				'Mod-4': toggle(4),
				'Mod-5': toggle(5),
				'Mod-6': toggle(6),
				'Mod-0': () => this.editor.chain().focus().setParagraph().run(),
			};
		},
	});

	const PageBreak = TiptapNode.create({
		name: 'pageBreak',
		group: 'block',
		atom: true,
		parseHTML() {
			return [
				{ tag: 'div[data-page-break]' },
				{
					tag: 'div',
					getAttrs: (el: HTMLElement) => {
						const style = el.getAttribute('style') || '';
						return style.includes('page-break-after') ? {} : false;
					},
				},
			];
		},
		renderHTML() {
			return ['div', { 'data-page-break': 'true', style: 'page-break-after: always; break-after: page;', class: 'page-break' }];
		},
	});

	// ═══ CUSTOM EDITING / TYPING EXPERIENCE EXTENSIONS ═══

	const AutoClosePairs = new Map([
		['(', ')'],
		['[', ']'],
		['{', '}'],
		['"', '"'],
		["'", "'"],
		['`', '`']
	]);

	const SelectionWrappers = new Map([
		['*', '*'],
		['_', '_'],
		['~', '~'],
		['`', '`'],
		['(', ')'],
		['[', ']'],
		['{', '}'],
		['"', '"'],
		["'", "'"]
	]);

	const TypingKeyboardShortcuts = Extension.create({
		name: 'typingKeyboardShortcuts',
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: new PluginKey('typingKeyboardShortcuts'),
					props: {
						handleTextInput(view, from, to, text) {
							const { state, dispatch } = view;
							const { selection } = state;
							
							// 1. Selection wrapping
							if (!selection.empty) {
								const wrapper = SelectionWrappers.get(text);
								if (wrapper) {
									const selectedText = state.doc.textBetween(selection.from, selection.to);
									const tr = state.tr.replaceWith(
										selection.from,
										selection.to,
										state.schema.text(text + selectedText + wrapper)
									);
									const newFrom = selection.from + text.length;
									const newTo = newFrom + selectedText.length;
									tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo));
									dispatch(tr);
									return true;
								}
							}
							
							// 2. Auto-close pairs
							if (selection.empty) {
								const closer = AutoClosePairs.get(text);
								if (closer) {
									const tr = state.tr.insertText(text + closer, selection.from);
									const newPos = selection.from + text.length;
									dispatch(tr.setSelection(TextSelection.create(tr.doc, newPos, newPos)));
									return true;
								}
								
								// 3. Step over closing character
								const nextChar = state.doc.textBetween(selection.from, selection.from + 1);
								if (text === nextChar && Array.from(AutoClosePairs.values()).includes(text)) {
									const newPos = selection.from + 1;
									dispatch(state.tr.setSelection(TextSelection.create(state.tr.doc, newPos, newPos)));
									return true;
								}
							}
							
							return false;
						},
						handleKeyDown(view, event) {
							const { state, dispatch } = view;
							const { selection } = state;
							
							// 4. Backspace inside empty pair
							if (event.key === 'Backspace' && selection.empty && selection.from > 0) {
								const prevChar = state.doc.textBetween(selection.from - 1, selection.from);
								const nextChar = state.doc.textBetween(selection.from, selection.from + 1);
								const expectedCloser = AutoClosePairs.get(prevChar);
								if (expectedCloser && expectedCloser === nextChar) {
									const tr = state.tr.delete(selection.from - 1, selection.from + 1);
									dispatch(tr);
									return true;
								}
							}
							return false;
						}
					}
				})
			];
		}
	});

	function findActiveBlockDecoration(state: EditorState): DecorationSet {
		const { selection, doc } = state;
		const resolvedFrom = selection.$from;
		
		let depth = resolvedFrom.depth;
		while (depth > 0) {
			const node = resolvedFrom.node(depth);
			if (node.type.isBlock) {
				const from = resolvedFrom.before(depth);
				const to = resolvedFrom.after(depth);
				if (from >= 0 && to <= doc.content.size) {
					const deco = Decoration.node(from, to, { class: 'has-focus' });
					return DecorationSet.create(doc, [deco]);
				}
			}
			depth--;
		}
		return DecorationSet.empty;
	}

	const focusActiveBlockPlugin = new Plugin({
		key: new PluginKey('focusActiveBlock'),
		state: {
			init(_, state) {
				return findActiveBlockDecoration(state);
			},
			apply(tr, oldDeco, oldState, newState) {
				if (tr.docChanged || tr.selectionSet) {
					return findActiveBlockDecoration(newState);
				}
				return oldDeco.map(tr.mapping, tr.doc);
			}
		},
		props: {
			decorations(state) {
				return this.getState(state);
			}
		}
	});

	const FocusModeHighlight = Extension.create({
		name: 'focusModeHighlight',
		addProseMirrorPlugins() {
			return [focusActiveBlockPlugin];
		}
	});

	const TypewriterScrolling = Extension.create({
		name: 'typewriterScrolling',
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: new PluginKey('typewriterScrolling'),
					view(editorView) {
						return {
							update(view, prevState) {
								if (!appState.typewriterScrollEnabled) return;
								const { state } = view;
								const { selection } = state;
								if (selection.empty && (!prevState || !prevState.selection.eq(selection))) {
									setTimeout(() => {
										try {
											const getScrollContainer = (el: HTMLElement): HTMLElement => {
												let parent = el.parentElement;
												while (parent && parent !== document.body && parent !== document.documentElement) {
													const style = window.getComputedStyle(parent);
													const overflowY = style.overflowY;
													if (overflowY === 'auto' || overflowY === 'scroll') {
														return parent;
													}
													parent = parent.parentElement;
												}
												// Fallback to editor-body if found, otherwise document.documentElement
												const editorBody = document.querySelector('.editor-body') as HTMLElement | null;
												if (editorBody) {
													const style = window.getComputedStyle(editorBody);
													if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
														return editorBody;
													}
												}
												return document.documentElement;
											};

											const container = getScrollContainer(view.dom);
											if (!container) return;
											
											const caretCoords = view.coordsAtPos(selection.from);
											if (!caretCoords) return;
											
											const rect = container.getBoundingClientRect();
											const multiplier = isMobile ? 0.12 : 0.7;
											const targetY = rect.top + rect.height * multiplier;
											const diff = caretCoords.top - targetY;
											
											if (Math.abs(diff) > 10) {
												if (container === document.documentElement || container === document.body) {
													window.scrollBy(0, diff);
												} else {
													container.scrollTop += diff;
												}
											}
										} catch (e) {
											console.warn('[TypewriterScroll] failed:', e);
										}
									}, 0);
								}
							}
						};
					}
				})
			];
		}
	});


	const Callout = TiptapNode.create({
		name: 'callout',
		group: 'block',
		content: 'block+',
		defining: true,
		addAttributes() {
			return {
				type: {
					default: 'note',
					parseHTML: (el: HTMLElement) => el.getAttribute('data-callout-type') || 'note',
					renderHTML: (attrs) => ({ 'data-callout-type': attrs.type }),
				},
			};
		},
		parseHTML() {
			return [{
				tag: 'div[data-type="callout"]',
			}];
		},
		renderHTML({ HTMLAttributes }) {
			const type = HTMLAttributes['data-callout-type'] || HTMLAttributes.type || 'note';
			return ['div', { 'data-type': 'callout', 'data-callout-type': type, class: `callout callout-${type}` }, 0];
		},
	});

	const Metrics = TiptapNode.create({
		name: 'metrics',
		group: 'block',
		atom: true,
		draggable: true,
		addAttributes() {
			return {
				id: {
					default: null,
					parseHTML: (el: HTMLElement) => el.getAttribute('data-id') || 'metrics_' + Math.random().toString(36).substring(2, 9),
					renderHTML: (attrs) => ({ 'data-id': attrs.id || 'metrics_' + Math.random().toString(36).substring(2, 9) })
				},
				title: {
					default: 'Cal Block',
					parseHTML: (el: HTMLElement) => el.getAttribute('data-title') || 'Cal Block',
					renderHTML: (attrs) => ({ 'data-title': attrs.title })
				},
				data: {
					default: '[]',
					parseHTML: (el: HTMLElement) => el.getAttribute('data-metrics') || '[]',
					renderHTML: (attrs) => ({ 'data-metrics': attrs.data })
				},
				excludeChecked: {
					default: false,
					parseHTML: (el: HTMLElement) => el.getAttribute('data-exclude-checked') === 'true',
					renderHTML: (attrs) => ({ 'data-exclude-checked': String(attrs.excludeChecked) })
				},
				showIncome: {
					default: false,
					parseHTML: (el: HTMLElement) => {
						const hasIncomeAttr = el.hasAttribute('data-income');
						const showIncomeAttr = el.getAttribute('data-show-income') === 'true';
						if (!hasIncomeAttr) {
							return false;
						}
						return showIncomeAttr;
					},
					renderHTML: (attrs) => ({ 'data-show-income': String(attrs.showIncome) })
				},
				showInflows: {
					default: false,
					parseHTML: (el: HTMLElement) => {
						const hasIncomeAttr = el.hasAttribute('data-income');
						const showIncomeAttr = el.getAttribute('data-show-income') === 'true';
						const showInflowsAttr = el.getAttribute('data-show-inflows');
						if (showInflowsAttr !== null) {
							return showInflowsAttr === 'true';
						}
						if (!hasIncomeAttr && showIncomeAttr) {
							return true;
						}
						return false;
					},
					renderHTML: (attrs) => ({ 'data-show-inflows': String(attrs.showInflows) })
				},
				showExpenses: {
					default: false,
					parseHTML: (el: HTMLElement) => el.getAttribute('data-show-expenses') === 'true',
					renderHTML: (attrs) => ({ 'data-show-expenses': String(attrs.showExpenses) })
				},
				showMin: {
					default: false,
					parseHTML: (el: HTMLElement) => el.getAttribute('data-show-min') === 'true',
					renderHTML: (attrs) => ({ 'data-show-min': String(attrs.showMin) })
				},
				showMax: {
					default: false,
					parseHTML: (el: HTMLElement) => el.getAttribute('data-show-max') === 'true',
					renderHTML: (attrs) => ({ 'data-show-max': String(attrs.showMax) })
				},
				showMedian: {
					default: false,
					parseHTML: (el: HTMLElement) => el.getAttribute('data-show-median') === 'true',
					renderHTML: (attrs) => ({ 'data-show-median': String(attrs.showMedian) })
				},
				showSavings: {
					default: null,
					parseHTML: (el: HTMLElement) => {
						const attr = el.getAttribute('data-show-savings');
						if (attr === 'true') return true;
						if (attr === 'false') return false;
						return null;
					},
					renderHTML: (attrs) => {
						if (attrs.showSavings === null || attrs.showSavings === undefined) return {};
						return { 'data-show-savings': String(attrs.showSavings) };
					}
				},
				income: {
					default: 0,
					parseHTML: (el: HTMLElement) => parseFloat(el.getAttribute('data-income') || '0') || 0,
					renderHTML: (attrs) => ({ 'data-income': String(attrs.income || 0) })
				},
				visibleTagTotals: {
					default: '[]',
					parseHTML: (el: HTMLElement) => el.getAttribute('data-visible-tag-totals') || '[]',
					renderHTML: (attrs) => ({ 'data-visible-tag-totals': attrs.visibleTagTotals || '[]' })
				},
				incomeLabel: {
					default: '',
					parseHTML: (el: HTMLElement) => el.getAttribute('data-income-label') || '',
					renderHTML: (attrs) => ({ 'data-income-label': attrs.incomeLabel || '' })
				},
				currencyCode: {
					default: '',
					parseHTML: (el: HTMLElement) => el.getAttribute('data-currency-code') || '',
					renderHTML: (attrs) => ({ 'data-currency-code': attrs.currencyCode || '' })
				},
				incomeSources: {
					default: '[]',
					parseHTML: (el: HTMLElement) => el.getAttribute('data-income-sources') || '[]',
					renderHTML: (attrs) => ({ 'data-income-sources': attrs.incomeSources || '[]' })
				},
				tagsMetadata: {
					default: '[]',
					parseHTML: (el: HTMLElement) => el.getAttribute('data-tags-metadata') || '[]',
					renderHTML: (attrs) => ({ 'data-tags-metadata': attrs.tagsMetadata || '[]' })
				},
				incomePlaceholder: {
					default: '',
					parseHTML: (el: HTMLElement) => el.getAttribute('data-income-placeholder') || '',
					renderHTML: (attrs) => ({ 'data-income-placeholder': attrs.incomePlaceholder || '' })
				}
			};
		},
		parseHTML() {
			return [{
				tag: 'div[data-type="metrics"]',
			}];
		},
		renderHTML({ HTMLAttributes }) {
			const dataStr = HTMLAttributes['data-metrics'] || '[]';
			const excludeChecked = HTMLAttributes['data-exclude-checked'] === 'true' || HTMLAttributes['data-exclude-checked'] === true;
			const showInflows = HTMLAttributes['data-show-inflows'] === 'true' || HTMLAttributes['data-show-inflows'] === true;
			const showExpenses = HTMLAttributes['data-show-expenses'] === 'true' || HTMLAttributes['data-show-expenses'] === true;
			const showMin = HTMLAttributes['data-show-min'] === 'true' || HTMLAttributes['data-show-min'] === true;
			const showMax = HTMLAttributes['data-show-max'] === 'true' || HTMLAttributes['data-show-max'] === true;
			const showMedian = HTMLAttributes['data-show-median'] === 'true' || HTMLAttributes['data-show-median'] === true;
			const incomeVal = parseFloat(HTMLAttributes['data-income'] || '0') || 0;
			const showSavingsAttr = HTMLAttributes['data-show-savings'];
			let shouldShowSavings = false;
			if (showSavingsAttr === 'true' || showSavingsAttr === true) {
				shouldShowSavings = true;
			} else if (showSavingsAttr === 'false' || showSavingsAttr === false) {
				shouldShowSavings = false;
			} else {
				shouldShowSavings = incomeVal > 0;
			}
			const showIncome = shouldShowSavings && (HTMLAttributes['data-show-income'] === 'true' || HTMLAttributes['data-show-income'] === true);
			const titleStr = HTMLAttributes['data-title'] || 'Metrics List';
			const idStr = HTMLAttributes['data-id'] || 'metrics_' + Math.random().toString(36).substring(2, 9);

			const incomeLabelAttr = HTMLAttributes['data-income-label'] || '';
			const currencyCodeAttr = HTMLAttributes['data-currency-code'] || '';
			const incomeLabel = incomeLabelAttr || appState.defaultIncomeLabel || 'Income';
			const currencyCode = currencyCodeAttr || appState.defaultCurrency || '₹';
			
			const container = document.createElement('div');
			container.setAttribute('data-type', 'metrics');
			container.setAttribute('data-id', idStr);
			container.setAttribute('data-title', titleStr);
			container.setAttribute('data-metrics', dataStr);
			container.setAttribute('data-exclude-checked', String(excludeChecked));
			container.setAttribute('data-show-income', String(showIncome));
			container.setAttribute('data-show-inflows', String(showInflows));
			container.setAttribute('data-show-expenses', String(showExpenses));
			container.setAttribute('data-show-min', String(showMin));
			container.setAttribute('data-show-max', String(showMax));
			container.setAttribute('data-show-median', String(showMedian));
			if (HTMLAttributes['data-show-savings'] !== undefined && HTMLAttributes['data-show-savings'] !== null) {
				container.setAttribute('data-show-savings', String(HTMLAttributes['data-show-savings']));
			}
			if (HTMLAttributes['data-visible-tag-totals']) {
				container.setAttribute('data-visible-tag-totals', HTMLAttributes['data-visible-tag-totals']);
			}
			container.setAttribute('data-income', String(incomeVal));
			if (incomeLabelAttr) {
				container.setAttribute('data-income-label', incomeLabelAttr);
			}
			if (currencyCodeAttr) {
				container.setAttribute('data-currency-code', currencyCodeAttr);
			}
			if (HTMLAttributes['data-income-sources']) {
				container.setAttribute('data-income-sources', HTMLAttributes['data-income-sources']);
			}
			if (HTMLAttributes['data-income-placeholder']) {
				container.setAttribute('data-income-placeholder', HTMLAttributes['data-income-placeholder']);
			}

			// Write the latest tagsMetadata from appState.calcTags to the HTML
			const currentCalcTags = appState.calcTags || [];
			const tagsMetadataJson = JSON.stringify(currentCalcTags.map(tag => ({
				id: tag.id,
				name: tag.name,
				color: tag.color,
				enabled: tag.enabled,
				createdAt: tag.createdAt
			})));
			container.setAttribute('data-tags-metadata', tagsMetadataJson);

			container.className = 'metrics-block-print';
			
			// Build static HTML representation for export/print
			try {
				const NUMBER_REGEX = /(?<!\d)-?(?:\d+(?:\.\d+)?|\.\d+)/g;
				const cleanText = (text: string) => {
					let t = String(text || '');
					t = t.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '');
					t = t.replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '');
					return t;
				};
				const getRowNumbers = (text: string) => {
					const cleaned = cleanText(text);
					const matches = cleaned.match(NUMBER_REGEX);
					if (!matches) return [];
					return matches.map(m => parseFloat(m)).filter(n => !isNaN(n));
				};

				const rows = JSON.parse(dataStr);
				
				// Migrate legacy rows that have a separate value column if needed
				const migratedRows = rows.map((r: any) => {
					if (r.value !== undefined && r.value !== null && String(r.value).trim() !== '') {
						return {
							checked: !!r.checked,
							label: (r.label || '').trim() + ' ' + String(r.value).trim(),
							tagId: r.tagId
						};
					}
					return {
						checked: !!r.checked,
						label: r.label || '',
						tagId: r.tagId
					};
				});

				if (Array.isArray(migratedRows)) {
					const header = document.createElement('div');
					header.className = 'metrics-print-header';
					header.innerHTML = `<strong>📊 ${titleStr}</strong>`;
					container.appendChild(header);

					const table = document.createElement('table');
					table.className = 'metrics-print-table';
					table.style.width = '100%';
					table.style.borderCollapse = 'collapse';
					table.style.marginTop = '8px';
					
					const tbody = document.createElement('tbody');

					// Prepend Income row if showIncome is true
					if (showIncome) {
						const trIncome = document.createElement('tr');
						trIncome.style.fontWeight = 'bold';
						trIncome.style.borderBottom = '1px solid rgba(0, 0, 0, 0.08)';
						
						const tdCheck = document.createElement('td');
						tdCheck.style.width = '24px';
						tdCheck.style.padding = '4px 0';
						tdCheck.textContent = '💵';
						trIncome.appendChild(tdCheck);
						
						const tdLabel = document.createElement('td');
						tdLabel.style.padding = '4px 8px';
						tdLabel.textContent = incomeLabel;
						trIncome.appendChild(tdLabel);
						
						const tdValue = document.createElement('td');
						tdValue.style.padding = '4px 0';
						tdValue.style.textAlign = 'right';
						tdValue.style.fontFamily = 'monospace';
						tdValue.textContent = `${currencyCode} ${incomeVal.toLocaleString()}`;
						trIncome.appendChild(tdValue);
						
						tbody.appendChild(trIncome);
					}
					
					migratedRows.forEach(r => {
						const tr = document.createElement('tr');
						tr.style.borderBottom = '1px solid rgba(0, 0, 0, 0.04)';
						
						const tdCheck = document.createElement('td');
						tdCheck.style.width = '24px';
						tdCheck.style.padding = '4px 0';
						tdCheck.textContent = r.checked ? '☑' : '☐';
						tr.appendChild(tdCheck);
						
						const tdLabel = document.createElement('td');
						tdLabel.style.padding = '4px 8px';
						tdLabel.textContent = r.label || '';
						tr.appendChild(tdLabel);
						
						const tdValue = document.createElement('td');
						tdValue.style.padding = '4px 0';
						tdValue.style.textAlign = 'right';
						tdValue.style.fontFamily = 'monospace';
						
						const rowNumbers = getRowNumbers(r.label);
						if (rowNumbers.length > 0) {
							const total = rowNumbers.reduce((sum, n) => sum + n, 0);
							tdValue.textContent = (total > 0 ? '+' : '') + total.toLocaleString();
							if (total > 0) tdValue.style.color = '#22c55e';
							else if (total < 0) tdValue.style.color = '#ff4d4d';
						} else {
							tdValue.textContent = '';
						}
						
						tr.appendChild(tdValue);
						tbody.appendChild(tr);
					});

					// Append Remaining Budget/Savings row if enabled
					if (shouldShowSavings) {
						let net = 0;
						migratedRows.forEach(r => {
							if (excludeChecked && r.checked) return;
							const rowNumbers = getRowNumbers(r.label);
							net += rowNumbers.reduce((a, b) => a + b, 0);
						});
						const savingsVal = incomeVal + net;

						const trSavings = document.createElement('tr');
						trSavings.style.fontWeight = 'bold';
						trSavings.style.borderTop = '2px double rgba(0, 0, 0, 0.15)';
						
						const tdCheck = document.createElement('td');
						tdCheck.style.width = '24px';
						tdCheck.style.padding = '6px 0';
						tdCheck.textContent = '⚖';
						trSavings.appendChild(tdCheck);
						
						const tdLabel = document.createElement('td');
						tdLabel.style.padding = '6px 8px';
						tdLabel.textContent = 'Remaining Budget';
						trSavings.appendChild(tdLabel);
						
						const tdValue = document.createElement('td');
						tdValue.style.padding = '6px 0';
						tdValue.style.textAlign = 'right';
						tdValue.style.fontFamily = 'monospace';
						tdValue.textContent = `${currencyCode} ${savingsVal.toLocaleString()}`;
						if (savingsVal > 0) tdValue.style.color = '#22c55e';
						else if (savingsVal < 0) tdValue.style.color = '#ff4d4d';
						trSavings.appendChild(tdValue);
						
						tbody.appendChild(trSavings);
					}

					table.appendChild(tbody);
					container.appendChild(table);

					const visibleTagTotalsAttr = HTMLAttributes['data-visible-tag-totals'] || '[]';
					try {
						const visibleTagsArray = JSON.parse(visibleTagTotalsAttr);
						if (Array.isArray(visibleTagsArray) && visibleTagsArray.length > 0) {
							const totals: Record<string, number> = {};
							migratedRows.forEach(r => {
								if (excludeChecked && r.checked) return;
								const rowNumbers = getRowNumbers(r.label);
								if (rowNumbers.length > 0) {
									const sum = rowNumbers.reduce((a, b) => a + b, 0);
									if (r.tagId) {
										totals[r.tagId] = (totals[r.tagId] || 0) + sum;
									}
								}
							});
							
							const totalsDiv = document.createElement('div');
							totalsDiv.className = 'metrics-print-totals';
							totalsDiv.style.marginTop = '8px';
							totalsDiv.style.display = 'flex';
							totalsDiv.style.flexWrap = 'wrap';
							totalsDiv.style.gap = '8px';
							
							visibleTagsArray.forEach((tagId: string) => {
								const tag = appState.calcTags.find(t => t.id === tagId);
								const totalVal = totals[tagId] || 0;
								if (tag) {
									const chip = document.createElement('span');
									chip.style.fontSize = '11px';
									chip.style.border = `1px solid ${tag.color || '#888'}33`;
									chip.style.borderRadius = '12px';
									chip.style.padding = '2px 8px';
									chip.style.display = 'inline-flex';
									chip.style.alignItems = 'center';
									chip.style.gap = '4px';
									chip.innerHTML = `<span style="width: 6px; height: 6px; border-radius: 50%; background: ${tag.color || '#888'}; display: inline-block;"></span> <b>${tag.name}:</b> ${totalVal > 0 ? '+' : ''}${totalVal.toLocaleString()}`;
									totalsDiv.appendChild(chip);
								}
							});
							
							if (totalsDiv.childNodes.length > 0) {
								container.appendChild(totalsDiv);
							}
						}
					} catch (err) {}
				}
			} catch (e) {}
			
			return container;
		},
		addNodeView() {
			return ({ node, getPos, editor }) => {
				const dom = document.createElement('div');
				dom.className = 'metrics-block-view-container';
				dom.contentEditable = 'false';
				
				let currentNode = node;
				const nodeStore = writable(node);
				
				const component = mount(MetricsBlock, {
					target: dom,
					props: {
						nodeStore,
						getPos,
						editor,
						updateAttributes: (attrs: any) => {
							const pos = typeof getPos === 'function' ? getPos() : null;
							if (pos !== null && pos !== undefined) {
								editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {
									...currentNode.attrs,
									...attrs
								}));
							}
						}
					}
				});
				
				return {
					dom,
					update(updatedNode) {
						if (updatedNode.type.name !== 'metrics') return false;
						currentNode = updatedNode;
						nodeStore.set(updatedNode);
						return true;
					},
					destroy() {
						unmount(component);
					},
					selectNode() {
						// Do nothing to prevent ProseMirror selection highlights and browser input text auto-selection
					},
					deselectNode() {
						// Do nothing
					},
					stopEvent(event) {
						if (event.type.startsWith('drag') || event.type === 'drop') {
							return true;
						}
						const target = event.target as HTMLElement | null;
						if (target) {
							// Stop all events inside the metrics block to prevent ProseMirror from stealing focus or intercepting keystrokes
							if (target.closest('.metrics-card-wrapper')) {
								if (event.type === 'mousedown' || event.type === 'touchstart') {
									const pos = typeof getPos === 'function' ? getPos() : null;
									if (pos !== null && pos !== undefined) {
										const { selection } = editor.state;
										if (selection instanceof NodeSelection && selection.from === pos) {
											// Clear the node selection by setting the selection to a text selection near it
											const resolvedPos = editor.state.doc.resolve(pos + node.nodeSize);
											const newSelection = TextSelection.near(resolvedPos);
											editor.view.dispatch(editor.state.tr.setSelection(newSelection));
										}
									}
								}
								return true;
							}
						}
						return false;
					},
					ignoreMutation(mutation) {
						return true;
					}
				};
			};
		}
	});

	const MermaidRenderer = Extension.create({
		name: 'mermaidRendererOptIn',
		addProseMirrorPlugins() {
			console.info('[HelixNotes] Mermaid renderer (opt-in) initialised');

			let mermaidPromise: Promise<any> | null = null;
			const svgCache = new Map<string, string>();
			let renderCounter = 0;

			function loadMermaid(): Promise<any> {
				if (!mermaidPromise) {
					mermaidPromise = import('mermaid')
						.then((m) => {
							const lib = m.default;
							const isDark = document.documentElement.classList.contains('dark');
							lib.initialize({
								startOnLoad: false,
								theme: isDark ? 'dark' : 'default',
								securityLevel: 'strict',
								fontFamily: 'inherit',
							});
							return lib;
						})
						.catch((e) => { console.error('[Mermaid] load failed', e); return null; });
				}
				return mermaidPromise;
			}

			function showError(container: HTMLElement, msg: string) {
				container.innerHTML = '';
				container.classList.remove('mermaid-render-loading');
				container.classList.add('mermaid-render-error');
				
				// Card container
				const card = document.createElement('div');
				card.className = 'diagram-error-card flex-col';
				card.setAttribute('role', 'alert');
				card.setAttribute('aria-live', 'assertive');

				// Header
				const header = document.createElement('div');
				header.className = 'error-card-header flex-row';
				header.style.display = 'flex';
				header.style.alignItems = 'center';
				header.style.gap = 'var(--spacing-xs)';
				header.style.color = 'var(--semantic-error)';
				
				// Exclamation triangle SVG icon
				header.innerHTML = `
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
						<line x1="12" y1="9" x2="12" y2="13"></line>
						<line x1="12" y1="17" x2="12.01" y2="17"></line>
					</svg>
					<span class="error-card-title" style="font-size: var(--font-size-xs); font-weight: 700; color: var(--text-primary);">Diagram Render Failed</span>
				`;

				// Message
				const message = document.createElement('span');
				message.className = 'error-card-message';
				message.style.fontSize = 'var(--font-size-xs)';
				message.style.lineHeight = 'var(--line-height-normal)';
				message.style.color = 'var(--text-secondary)';
				message.style.wordBreak = 'break-word';
				message.textContent = msg;

				card.appendChild(header);
				card.appendChild(message);

				// Actions
				const actions = document.createElement('div');
				actions.className = 'error-card-actions flex-row';
				actions.style.marginTop = 'var(--spacing-3xs)';
				
				const retryBtn = document.createElement('button');
				retryBtn.type = 'button';
				retryBtn.className = 'mermaid-render-btn mermaid-render-btn-small';
				retryBtn.textContent = '↻ Retry';
				retryBtn.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					renderInto(container, container.getAttribute('data-mermaid-source') || '');
				};
				
				actions.appendChild(retryBtn);
				card.appendChild(actions);

				container.appendChild(card);
			}

			function addRetryButton(container: HTMLElement, source: string) {
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'mermaid-render-btn mermaid-render-btn-small';
				btn.textContent = '↻ Retry';
				btn.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					renderInto(container, source);
				};
				container.appendChild(btn);
			}

			async function svgToPngBlob(svgEl: SVGElement, scale = 2): Promise<Blob> {
				const clone = svgEl.cloneNode(true) as SVGElement;
				if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
				const svgString = new XMLSerializer().serializeToString(clone);
				const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
				const url = URL.createObjectURL(svgBlob);
				try {
					const img = new window.Image();
					await new Promise<void>((resolve, reject) => {
						img.onload = () => resolve();
						img.onerror = () => reject(new Error('SVG image load failed'));
						img.src = url;
					});
					const bbox = svgEl.getBoundingClientRect();
					const width = Math.max(Math.round(bbox.width || 800), 100);
					const height = Math.max(Math.round(bbox.height || 600), 100);
					const canvas = document.createElement('canvas');
					canvas.width = width * scale;
					canvas.height = height * scale;
					const ctx = canvas.getContext('2d');
					if (!ctx) throw new Error('Canvas not supported');
					ctx.scale(scale, scale);
					ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#1e1e1e' : '#ffffff';
					ctx.fillRect(0, 0, width, height);
					ctx.drawImage(img, 0, 0, width, height);
					return await new Promise<Blob>((resolve, reject) => {
						canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
					});
				} finally {
					URL.revokeObjectURL(url);
				}
			}

			function flashToast(container: HTMLElement, msg: string) {
				const existing = container.querySelector('.mermaid-render-toast');
				if (existing) existing.remove();
				const toast = document.createElement('div');
				toast.className = 'mermaid-render-toast';
				toast.textContent = msg;
				container.appendChild(toast);
				setTimeout(() => { if (toast.parentElement) toast.remove(); }, 1500);
			}

			async function copyDiagram(container: HTMLElement) {
				const svgEl = container.querySelector('svg') as SVGElement | null;
				if (!svgEl) return;
				try {
					const blob = await svgToPngBlob(svgEl);
					const buf = new Uint8Array(await blob.arrayBuffer());
					await copyPngToClipboard(buf);
					flashToast(container, 'Copied');
				} catch (e: any) {
					console.error('[Mermaid] copy failed', e);
					flashToast(container, 'Copy failed: ' + (e?.message || String(e)));
				}
			}

			async function saveDiagram(container: HTMLElement) {
				const svgEl = container.querySelector('svg') as SVGElement | null;
				if (!svgEl) return;
				try {
					const dest = await saveDialog({
						defaultPath: 'diagram.png',
						filters: [
							{ name: 'PNG Image', extensions: ['png'] },
							{ name: 'SVG Image', extensions: ['svg'] },
						],
					});
					if (!dest) return;
					const lower = dest.toLowerCase();
					if (lower.endsWith('.svg')) {
						const clone = svgEl.cloneNode(true) as SVGElement;
						if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
						const svgString = new XMLSerializer().serializeToString(clone);
						await writeBytesTo(dest, new TextEncoder().encode(svgString));
					} else {
						const blob = await svgToPngBlob(svgEl);
						const buf = new Uint8Array(await blob.arrayBuffer());
						await writeBytesTo(dest, buf);
					}
					flashToast(container, 'Saved');
				} catch (e: any) {
					console.error('[Mermaid] save failed', e);
					flashToast(container, 'Save failed: ' + (e?.message || String(e)));
				}
			}

			function addToolbar(container: HTMLElement, source: string) {
				const toolbar = document.createElement('div');
				toolbar.className = 'mermaid-render-toolbar';
				const isAndroid = /android/i.test(navigator.userAgent);

				if (!isAndroid) {
					const copyBtn = document.createElement('button');
					copyBtn.type = 'button';
					copyBtn.className = 'mermaid-render-action';
					copyBtn.title = 'Copy as PNG';
					copyBtn.textContent = 'Copy';
					copyBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); copyDiagram(container); };
					toolbar.appendChild(copyBtn);
				}

				const saveBtn = document.createElement('button');
				saveBtn.type = 'button';
				saveBtn.className = 'mermaid-render-action';
				saveBtn.title = 'Save as PNG or SVG';
				saveBtn.textContent = 'Save';
				saveBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); saveDiagram(container); };

				const reRenderBtn = document.createElement('button');
				reRenderBtn.type = 'button';
				reRenderBtn.className = 'mermaid-render-action';
				reRenderBtn.title = 'Re-render diagram';
				reRenderBtn.textContent = '↻';
				reRenderBtn.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					svgCache.delete(source);
					renderInto(container, source);
				};

				toolbar.appendChild(saveBtn);
				toolbar.appendChild(reRenderBtn);
				container.appendChild(toolbar);
			}

			async function renderInto(container: HTMLElement, source: string) {
				container.innerHTML = '';
				container.classList.remove('mermaid-render-error', 'mermaid-render-idle');
				container.classList.add('mermaid-render-loading');

				const cached = svgCache.get(source);
				if (cached) {
					container.classList.remove('mermaid-render-loading');
					container.innerHTML = cached;
					addToolbar(container, source);
					return;
				}

				const mermaid = await loadMermaid();
				if (!mermaid) {
					showError(container, 'Mermaid library failed to load.');
					return;
				}
				try {
					const parseOk = await mermaid.parse(source, { suppressErrors: true });
					if (!parseOk) {
						showError(container, 'Invalid mermaid syntax.');
						return;
					}
					const id = `mermaid-${++renderCounter}`;
					const { svg } = await mermaid.render(id, source);
					svgCache.set(source, svg);
					if (container.isConnected) {
						container.classList.remove('mermaid-render-loading');
						container.innerHTML = svg;
						addToolbar(container, source);
					}
				} catch (e: any) {
					showError(container, 'Render failed: ' + (e?.message || String(e)));
				}
			}

			function makeIdleButton(source: string): HTMLElement {
				const container = document.createElement('div');
				container.className = 'mermaid-render mermaid-render-idle';
				container.contentEditable = 'false';
				container.setAttribute('data-mermaid-source', source);

				const cached = svgCache.get(source);
				if (cached) {
					container.classList.remove('mermaid-render-idle');
					container.innerHTML = cached;
					addToolbar(container, source);
					return container;
				}

				const btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'mermaid-render-btn';
				btn.textContent = '▶  Render diagram';
				btn.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					renderInto(container, source);
				};
				container.appendChild(btn);
				return container;
			}

			function buildDecorations(doc: any): DecorationSet {
				const decos: any[] = [];
				doc.descendants((node: any, pos: number) => {
					if (node.type.name === 'codeBlock' && node.attrs.language === 'mermaid') {
						const source = node.textContent;
						if (!source.trim()) return;
						decos.push(
							Decoration.widget(
								pos + node.nodeSize,
								() => makeIdleButton(source),
								{ side: 1, key: 'mermaid:' + source.length + ':' + (svgCache.has(source) ? 'r' : 'i') },
							),
						);
					}
				});
				return DecorationSet.create(doc, decos);
			}

			const pluginKey = new PluginKey('mermaidRendererOptIn');
			return [
				new Plugin({
					key: pluginKey,
					state: {
						init: (_, state) => buildDecorations(state.doc),
						apply: (tr, old, _oldState, newState) => {
							if (!tr.docChanged) return old;
							return buildDecorations(newState.doc);
						},
					},
					props: {
						decorations(state) { return pluginKey.getState(state); },
					},
				}),
			];
		},
	});

	let codeLangDropdown = $state<{ pos: number; x: number; y: number; current: string; openUp?: boolean; alignRight?: boolean } | null>(null);
	let codeLangSearchQuery = $state('');
	let filteredCodeLanguages = $derived.by(() => {
		const q = codeLangSearchQuery.trim().toLowerCase();
		if (!q) return codeLanguages;
		return codeLanguages.filter(lang => lang.toLowerCase().includes(q));
	});

	function openCodeLangDropdown(pos: number, current: string, triggerEl: HTMLElement) {
		const rect = triggerEl.getBoundingClientRect();
		const spaceBelow = window.innerHeight - rect.bottom;
		const openUp = spaceBelow < 280 && rect.top > 280;
		const dropdownWidth = 200;
		const alignRight = rect.left + dropdownWidth > window.innerWidth;
		codeLangDropdown = { 
			pos, 
			x: alignRight ? rect.right : rect.left, 
			y: openUp ? rect.top - 4 : rect.bottom + 4, 
			current,
			openUp,
			alignRight
		};
		codeLangSearchQuery = '';
	}

	function selectCodeLang(lang: string) {
		if (!editor || !codeLangDropdown) return;
		const { pos } = codeLangDropdown;
		const startPos = pos - 1; // Start of the codeBlock node

		const node = editor.state.doc.nodeAt(startPos);
		if (node && node.type.name === 'codeBlock') {
			const tr = editor.state.tr.setNodeMarkup(startPos, undefined, {
				...node.attrs,
				language: lang || null
			});
			editor.view.dispatch(tr);
			
			// Force refocusing editor cursor inside the code block safely
			editor.commands.focus();
		}
		codeLangDropdown = null;
	}

	function closeCodeLangDropdown() {
		codeLangDropdown = null;
	}

	// ── In-note search extension ──
	const NoteSearchExtension = Extension.create({
		name: 'noteSearch',
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: noteSearchPluginKey,
					state: {
						init() { return DecorationSet.empty; },
						apply(tr, old) {
							const meta = tr.getMeta(noteSearchPluginKey);
							if (meta !== undefined) return meta;
							return old.map(tr.mapping, tr.doc);
						},
					},
					props: {
						decorations(state) {
							return this.getState(state);
						},
					},
				}),
			];
		},
	});

	// Color swatch decorations: render a small filled square before every hex/rgb/hsl color
	// literal (in normal text AND code blocks), VSCode-style. These are view-only widget
	// decorations, so they never touch the document/markdown - the note stores only the plain
	// color text and the swatch is re-derived on load.
	const colorSwatchPluginKey = new PluginKey('colorSwatch');
	const COLOR_LITERAL_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|(?:rgb|rgba|hsl|hsla)\([^)\n]{1,64}\)/g;

	function makeColorSwatch(color: string): HTMLElement {
		const span = document.createElement('span');
		span.className = 'color-swatch';
		span.contentEditable = 'false';
		span.style.backgroundColor = color;
		return span;
	}

	function buildColorSwatchDecorations(doc: any): DecorationSet {
		const decos: any[] = [];
		doc.descendants((node: any, pos: number) => {
			if (!node.isText || !node.text) return;
			const text: string = node.text;
			COLOR_LITERAL_RE.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = COLOR_LITERAL_RE.exec(text)) !== null) {
				const color = m[0];
				// Validate with the browser's own CSS parser so junk (rgb(foo), #12345) gets no swatch.
				if (!CSS.supports('color', color)) continue;
				const at = pos + m.index;
				decos.push(Decoration.widget(at, () => makeColorSwatch(color), { side: -1, key: 'cs:' + color + '@' + at }));
			}
		});
		return DecorationSet.create(doc, decos);
	}

	const ColorSwatch = Extension.create({
		name: 'colorSwatch',
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: colorSwatchPluginKey,
					state: {
						init: (_, state) => buildColorSwatchDecorations(state.doc),
						apply: (tr, old, _oldState, newState) => {
							if (!tr.docChanged) return old;
							return buildColorSwatchDecorations(newState.doc);
						},
					},
					props: {
						decorations(state) { return colorSwatchPluginKey.getState(state); },
					},
				}),
			];
		},
	});

	const MoveLineShortcuts = Extension.create({
		name: 'moveLineShortcuts',
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: new PluginKey('moveLineShortcuts'),
					props: {
						handleDOMEvents: {
							keydown(view, event) {
								if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return false;
								event.preventDefault();
								const { state, dispatch } = view;
								const resolvedPos = state.selection.$from;
								// Find the top-level block index
								const depth = 1; // top-level blocks in doc
								if (resolvedPos.depth < depth) return true;
								const parentPos = resolvedPos.before(depth);
								const parentNode = state.doc.nodeAt(parentPos);
								if (!parentNode) return true;
								const parentIndex = resolvedPos.index(0);
								if (event.key === 'ArrowUp') {
									if (parentIndex <= 0) return true;
									const prevPos = resolvedPos.posAtIndex(parentIndex - 1, 0);
									const prevNode = state.doc.nodeAt(prevPos);
									if (!prevNode) return true;
									const tr = state.tr;
									const cursorOffset = resolvedPos.pos - parentPos;
									// Delete current block, insert it before previous block
									const curSlice = state.doc.slice(parentPos, parentPos + parentNode.nodeSize);
									tr.delete(parentPos, parentPos + parentNode.nodeSize);
									const insertAt = tr.mapping.map(prevPos);
									tr.insert(insertAt, curSlice.content);
									const newCursorPos = Math.min(insertAt + cursorOffset, tr.doc.content.size);
									tr.setSelection((state.selection.constructor as any).near(tr.doc.resolve(newCursorPos)));
									dispatch(tr.scrollIntoView());
								} else {
									if (parentIndex >= state.doc.childCount - 1) return true;
									const nextPos = resolvedPos.posAtIndex(parentIndex + 1, 0);
									const nextNode = state.doc.nodeAt(nextPos);
									if (!nextNode) return true;
									const tr = state.tr;
									const cursorOffset = resolvedPos.pos - parentPos;
									// Delete next block, insert it before current block
									const nextSlice = state.doc.slice(nextPos, nextPos + nextNode.nodeSize);
									tr.delete(nextPos, nextPos + nextNode.nodeSize);
									const insertAt = tr.mapping.map(parentPos);
									tr.insert(insertAt, nextSlice.content);
									const newCursorPos = Math.min(tr.mapping.map(parentPos) + cursorOffset, tr.doc.content.size);
									tr.setSelection((state.selection.constructor as any).near(tr.doc.resolve(newCursorPos)));
									dispatch(tr.scrollIntoView());
								}
								return true;
							},
						},
					},
				}),
			];
		},
	});

	// Tab inserts a tab character in plain paragraphs/headings.
	// Priority 50 < default 100, so list/task/table/codeblock extensions handle Tab first for their own nodes.
	const TabIndent = Extension.create({
		name: 'tabIndent',
		priority: 50,
		addKeyboardShortcuts() {
			return {
				Tab: () => {
					const sel = this.editor.state.selection;
					const from = sel.$from;
					const node = from.node();
					if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return false;
					// Don't intercept if inside a list or task item (their extensions handle Tab first,
					// but guard here too in case of priority edge cases)
					for (let d = from.depth - 1; d > 0; d--) {
						const name = from.node(d).type.name;
						if (name === 'listItem' || name === 'taskItem') return false;
					}
					return this.editor.commands.insertContent('\t');
				},
			};
		},
	});

	const CustomCodeBlockLowlight = CodeBlockLowlight.extend({
		addNodeView() {
			return ({ node, getPos }) => {
				const dom = document.createElement('div');
				dom.className = 'code-block-container';

				const header = document.createElement('div');
				header.className = 'code-block-header';

				const langBtn = document.createElement('button');
				langBtn.type = 'button';
				langBtn.className = 'code-block-lang-btn';
				
				const lang = node.attrs.language || '';
				const langLabel = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : 'Auto';
				langBtn.innerHTML = `<span>${langLabel}</span> <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 4px; display: inline-block; vertical-align: middle;"><polyline points="6 9 12 15 18 9"/></svg>`;

				langBtn.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					const pos = getPos();
					if (typeof pos === 'number') {
						openCodeLangDropdown(pos + 1, node.attrs.language || '', langBtn);
					}
				};

				const clearBtn = document.createElement('button');
				clearBtn.type = 'button';
				clearBtn.className = 'code-block-clear-btn';
				clearBtn.title = 'Clear Code';
				
				const clearIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
				clearBtn.innerHTML = clearIcon;

				clearBtn.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (!editor) return;
					appState.showConfirmation({
						title: 'Clear code block?',
						message: 'Clear all code in this block?',
						confirmText: 'Clear',
						onConfirm: () => {
							if (!editor) return;
							const pos = getPos();
							if (typeof pos === 'number') {
								const node = editor.state.doc.nodeAt(pos);
								if (node) {
									const tr = editor.state.tr.delete(pos + 1, pos + node.nodeSize - 1);
									editor.view.dispatch(tr);
									editor.commands.focus();
									appState.showToast('Code cleared', 'info');
								}
							}
						}
					});
				};

				const copyBtn = document.createElement('button');
				copyBtn.type = 'button';
				copyBtn.className = 'code-block-copy-btn';
				copyBtn.title = 'Copy Code';

				const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
				const checkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27c93f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

				copyBtn.innerHTML = copyIcon;

				copyBtn.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					const codeText = node.textContent;
					navigator.clipboard.writeText(codeText);
					copyBtn.innerHTML = checkIcon;
					copyBtn.classList.add('copied');
					setTimeout(() => {
						copyBtn.innerHTML = copyIcon;
						copyBtn.classList.remove('copied');
					}, 1500);
					appState.showToast('Code copied to clipboard!', 'success');
				};

				const actionsWrapper = document.createElement('div');
				actionsWrapper.className = 'code-block-actions';
				actionsWrapper.style.display = 'flex';
				actionsWrapper.style.alignItems = 'center';
				actionsWrapper.style.gap = '8px';

				actionsWrapper.appendChild(clearBtn);
				actionsWrapper.appendChild(copyBtn);

				header.appendChild(langBtn);
				header.appendChild(actionsWrapper);

				const pre = document.createElement('pre');
				const code = document.createElement('code');
				
				if (node.attrs.language) {
					code.classList.add(`language-${node.attrs.language}`);
				}
				
				pre.appendChild(code);
				dom.appendChild(header);
				dom.appendChild(pre);

				return {
					dom,
					contentDOM: code,
					update(updatedNode) {
						if (updatedNode.type.name !== 'codeBlock') return false;
						
						const newLang = updatedNode.attrs.language || '';
						const newLangLabel = newLang ? newLang.charAt(0).toUpperCase() + newLang.slice(1) : 'Auto';
						langBtn.querySelector('span')!.textContent = newLangLabel;
						
						code.className = '';
						if (newLang) {
							code.classList.add(`language-${newLang}`);
						}
						
						return true;
					}
				};
			};
		}
	});

	function executeSlashCommand(index: number) {
		const items = slashFiltered.flatList;
		if (index < 0 || index >= items.length || !slashMenu || !editor) return;
		const cmd = items[index];
		// Color opens a sub-picker too
		if (cmd.type === 'command' && cmd.label === 'Color') {
			slashColorPicker = true;
			slashSelectedIndex = 0;
			editor.chain().focus().deleteRange({ from: slashMenu.from, to: slashMenu.to }).run();
			tick().then(() => slashColorInputEl?.focus());
			return;
		}
		// Delete the slash trigger text (/ + query)
		editor.chain().focus().deleteRange({ from: slashMenu.from, to: slashMenu.to }).run();
		slashMenu = null;
		slashSelectedIndex = 0;
		// Execute after the deletion is applied
		tick().then(() => cmd.action());
	}

	function slashInsertTable(rows: number, cols: number) {
		if (!editor) return;
		editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
		closeSlashMenu();
	}

	function insertColor(color: string) {
		if (!editor) return;
		const c = (color || '').trim();
		if (!c || !CSS.supports('color', c)) { closeSlashMenu(); return; }
		editor.chain().focus().insertContent(c).run();
		closeSlashMenu();
	}

	// Track whether the user just typed a slash (vs cursor moving into existing text)
	let slashTypedByUser = false;

	function closeSlashMenu() {
		slashMenu = null;
		slashSelectedIndex = 0;
		slashTablePicker = false;
		slashTableHover = { rows: 0, cols: 0 };
		slashColorPicker = false;
	}

	$effect(() => {
		if (!slashMenu || slashSelectedIndex < 0) return;
		slashSelectedIndex; // track
		tick().then(() => {
			document.querySelector('.slash-menu .selected')?.scrollIntoView({ block: 'nearest' });
		});
	});

	$effect(() => {
		if (!wikiLinkMenu || wikiLinkSelectedIndex < 0) return;
		wikiLinkSelectedIndex; // track
		tick().then(() => {
			document.querySelector('.wiki-link-menu .wiki-link-item.selected')?.scrollIntoView({ block: 'nearest' });
		});
	});

	function updateSlashMenu() {
		const wasSlashTyped = slashTypedByUser;
		slashTypedByUser = false;
		if (!editor) return;
		if (slashTablePicker || slashColorPicker) return; // a sub-picker is open, don't interfere
		const { state } = editor;
		const { selection } = state;
		const resolvedFrom = selection.$from;

		// Only in empty-ish context (paragraph, heading)
		const parentNode = resolvedFrom.parent;
		if (parentNode.type.name !== 'paragraph' && parentNode.type.name !== 'heading') {
			closeSlashMenu();
			return;
		}

		const textBefore = parentNode.textContent.slice(0, resolvedFrom.parentOffset);
		// Match "." at start of line or after whitespace
		const match = textBefore.match(/(^|\s)\.([^\s]*)$/);
		if (!match) {
			closeSlashMenu();
			return;
		}

		// Only open the menu if the user typed the slash, or the menu is already open
		// This prevents triggering when clicking/arrowing into existing paths like /usr/local/bin
		if (!slashMenu && !wasSlashTyped) {
			return;
		}

		const query = match[2];
		const slashOffset = textBefore.length - match[0].length + (match[1].length); // position of "/"
		const from = resolvedFrom.start() + slashOffset;
		const to = resolvedFrom.pos;

		// Get cursor coordinates for menu positioning
		const coords = editor.view.coordsAtPos(from);

		let x = coords.left;

		// Keep menu within viewport (account for virtual keyboard on mobile)
		if (x + 240 > window.innerWidth) x = window.innerWidth - 250;
		const visibleBottom = window.innerHeight - keyboardHeight;
		const menuHeight = 300;
		let y = coords.bottom + 4;
		if (y + menuHeight > visibleBottom) y = coords.top - menuHeight - 4;
		if (y < 4) y = 4;

		slashMenu = { x, y, query, from, to };
		slashSelectedIndex = 0;
	}

	const SlashCommands = Extension.create({
		name: 'slashCommands',
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: new PluginKey('slashCommands'),
					props: {
						handleTextInput: (_view, _from, _to, text) => {
							if (text === '.') {
								slashTypedByUser = true;
							}
							return false;
						},
						handleKeyDown: (_view, event) => {
							if (!slashMenu) return false;
							if (slashColorPicker) {
								if (event.key === 'Escape') {
									event.preventDefault();
									closeSlashMenu();
								}
								return true; // the picker's own inputs handle the rest
							}
							if (slashTablePicker) {
								if (event.key === 'Escape') {
									event.preventDefault();
									closeSlashMenu();
									return true;
								}
								if (event.key === 'Tab') {
									event.preventDefault();
									if (slashTableHover.rows > 0 && slashTableHover.cols > 0) {
										slashInsertTable(slashTableHover.rows, slashTableHover.cols);
									}
									return true;
								}
								if (event.key === 'ArrowRight') {
									event.preventDefault();
									slashTableHover = { rows: Math.max(1, slashTableHover.rows), cols: Math.min(10, (slashTableHover.cols || 0) + 1) };
									return true;
								}
								if (event.key === 'ArrowLeft') {
									event.preventDefault();
									slashTableHover = { rows: Math.max(1, slashTableHover.rows), cols: Math.max(1, slashTableHover.cols - 1) };
									return true;
								}
								if (event.key === 'ArrowDown') {
									event.preventDefault();
									slashTableHover = { rows: Math.min(8, (slashTableHover.rows || 0) + 1), cols: Math.max(1, slashTableHover.cols) };
									return true;
								}
								if (event.key === 'ArrowUp') {
									event.preventDefault();
									slashTableHover = { rows: Math.max(1, slashTableHover.rows - 1), cols: Math.max(1, slashTableHover.cols) };
									return true;
								}
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									if (slashTableHover.rows > 0 && slashTableHover.cols > 0) {
										slashInsertTable(slashTableHover.rows, slashTableHover.cols);
									}
									return true;
								}
								return true;
							}
							if (event.key === 'ArrowDown') {
								event.preventDefault();
								slashSelectedIndex = (slashSelectedIndex + 1) % Math.max(1, slashFiltered.flatList.length);
								return true;
							}
							if (event.key === 'ArrowUp') {
								event.preventDefault();
								slashSelectedIndex = (slashSelectedIndex - 1 + slashFiltered.flatList.length) % Math.max(1, slashFiltered.flatList.length);
								return true;
							}
							if (event.key === 'Enter' || event.key === 'Tab') {
								if (slashFiltered.flatList.length > 0) {
									event.preventDefault();
									executeSlashCommand(slashSelectedIndex);
									return true;
								}
								closeSlashMenu();
								return false;
							}
							if (event.key === 'Escape') {
								event.preventDefault();
								closeSlashMenu();
								return true;
							}
							return false;
						},
					},
				}),
			];
		},
	});

	// ── Wiki-links ──

	let wikiLinkMenu = $state<{ x: number; y: number; query: string; from: number } | null>(null);
	let wikiLinkSelectedIndex = $state(0);
	let wikiLinkTitlesCache = $state<NoteTitleEntry[]>([]);
	let wikiLinkTypedByUser = false;
	// Disambiguation state: when ]] auto-close finds multiple matches
	let wikiLinkDisambigEntries = $state<NoteTitleEntry[] | null>(null);
	let wikiLinkDisambigRef = $state<string | null>(null);
	let wikiLinkDisambigDisplay = $state<string | null>(null);
	// Navigation disambiguation: when clicking a wikilink with multiple matches
	let wikiLinkNavDisambig = $state<{ entries: NoteTitleEntry[]; x: number; y: number } | null>(null);
	let wikiLinkNavDisambigIndex = $state(0);

	let wikiLinkFiltered = $derived.by(() => {
		// When disambiguating, show only the exact matches
		if (wikiLinkDisambigEntries) return wikiLinkDisambigEntries;
		if (!wikiLinkMenu) return wikiLinkTitlesCache;
		let q = wikiLinkMenu.query.toLowerCase();
		if (!q) return wikiLinkTitlesCache;
		// Strip |alias, #heading, ^block - only use the note name part for filtering
		const pipeIdx = q.indexOf('|');
		if (pipeIdx >= 0) q = q.slice(0, pipeIdx);
		q = q.replace(/#.*$/, '').replace(/\^.*$/, '').trim();
		if (!q) return wikiLinkTitlesCache;
		// Score: 0 = exact, 1 = starts-with, 2 = word-start, 3 = contains
		const scored = wikiLinkTitlesCache
			.map(entry => {
				const t = entry.title.toLowerCase();
				let score: number;
				if (t === q) score = 0;
				else if (t.startsWith(q)) score = 1;
				else if (t.includes(' ' + q) || t.includes('-' + q)) score = 2;
				else if (t.includes(q)) score = 3;
				else score = -1;
				return { entry, score };
			})
			.filter(x => x.score >= 0)
			.sort((a, b) => a.score - b.score)
			.map(x => x.entry);
		return scored;
	});

	// Set of lowercase titles that appear more than once (for disambiguation display)
	let wikiLinkDuplicateTitles = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const e of wikiLinkTitlesCache) {
			const key = e.title.toLowerCase();
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		const dupes = new Set<string>();
		for (const [key, count] of counts) {
			if (count > 1) dupes.add(key);
		}
		return dupes;
	});

	function wikiLinkFolderPath(entry: NoteTitleEntry): string {
		const vaultRoot = $appConfig?.active_vault;
		if (!vaultRoot || !entry.path) return '';
		// Normalize Windows backslashes so the folder subtitle shows there too.
		const path = entry.path.replace(/\\/g, '/');
		const root = vaultRoot.replace(/\\/g, '/');
		const rel = path.startsWith(root + '/') ? path.slice(root.length + 1) : path;
		const parts = rel.split('/');
		// Return parent folder(s), excluding the filename
		return parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
	}

	async function refreshWikiLinkTitles() {
		try {
			wikiLinkTitlesCache = await getAllNoteTitles();
		} catch (e) {
			console.error('Failed to load note titles:', e);
		}
	}

	function closeWikiLinkMenu() {
		wikiLinkMenu = null;
		wikiLinkSelectedIndex = 0;
		wikiLinkDisambigEntries = null;
		wikiLinkDisambigRef = null;
		wikiLinkDisambigDisplay = null;
	}

	function wikiLinkRelPath(entry: NoteTitleEntry): string | null {
		const vaultRoot = $appConfig?.active_vault;
		if (!vaultRoot || !entry.path || !entry.path.startsWith(vaultRoot + '/')) return null;
		return entry.path.slice(vaultRoot.length + 1).replace(/\.md$/, '');
	}

	function insertWikiLink(entry: NoteTitleEntry, originalRef?: string) {
		if (!editor || !wikiLinkMenu) return;
		const { from } = wikiLinkMenu;
		// Delete the [[ trigger and query text
		const to = editor.state.selection.from;
		editor.chain().focus().deleteRange({ from, to }).run();
		// Insert the wiki-link mark
		// For ambiguous titles, use vault-relative path as the ref so it survives source-mode roundtrips
		const displayText = entry.title;
		let titleAttr = originalRef || entry.title;
		if (entry.path && wikiLinkDuplicateTitles.has(entry.title.toLowerCase())) {
			const relPath = wikiLinkRelPath(entry);
			if (relPath) {
				// Preserve any #heading or ^block anchors from the original ref
				const anchor = originalRef ? originalRef.replace(/^[^#^]*/, '') : '';
				titleAttr = relPath + anchor;
			}
		}
		tick().then(() => {
			if (!editor) return;
			editor.chain().focus()
				.insertContent({
					type: 'text',
					text: displayText,
					marks: [{ type: 'wikiLink', attrs: { title: titleAttr, path: entry.path } }],
				})
				.run();
		});
		closeWikiLinkMenu();
	}

	function executeWikiLinkCommand(index: number) {
		const items = wikiLinkFiltered;
		if (index < 0 || index >= items.length) return;
		if (wikiLinkDisambigEntries) {
			// In disambiguation mode: use stored display/ref
			insertWikiLink({ ...items[index], title: wikiLinkDisambigDisplay || items[index].title }, wikiLinkDisambigRef || undefined);
		} else {
			insertWikiLink(items[index]);
		}
	}

	const WikiLink = TiptapMark.create({
		name: 'wikiLink',
		inclusive: false,
		excludes: 'link',
		addAttributes() {
			return {
				title: { default: null },
				path: { default: null },
			};
		},
		parseHTML() {
			return [
				{
					tag: 'span[data-wiki-link]',
					getAttrs: (el: HTMLElement) => ({
						title: el.getAttribute('data-title') || null,
						path: el.getAttribute('data-path') || null,
					}),
				},
				{
					tag: 'a[data-wiki-link]',
					getAttrs: (el: HTMLElement) => ({
						title: el.getAttribute('data-title') || null,
						path: el.getAttribute('data-path') || null,
					}),
				},
			];
		},
		renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
			return ['span', {
				'data-wiki-link': '',
				'data-path': HTMLAttributes.path || '',
				'data-title': HTMLAttributes.title || '',
				class: 'wiki-link',
			}, 0];
		},
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: new PluginKey('wikiLinkClick'),
					props: {
						handleDOMEvents: {
							click: (view, event) => {
								const target = event.target as HTMLElement;
								const wikiLinkEl = target.closest?.('span[data-wiki-link]') as HTMLElement | null;
								if (wikiLinkEl) {
									event.preventDefault();
									event.stopPropagation();
									const path = wikiLinkEl.getAttribute('data-path') || '';
									const title = wikiLinkEl.getAttribute('data-title') || wikiLinkEl.textContent || '';
									navigateToWikiLink(path, title, event as MouseEvent);
									return true;
								}
								return false;
							},
						},
					},
				}),
			];
		},
	});

	const WikiLinkAutocomplete = Extension.create({
		name: 'wikiLinkAutocomplete',
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: new PluginKey('wikiLinkAutocomplete'),
					props: {
						handleKeyDown: (_view, event) => {
							if (!wikiLinkMenu) return false;
							if (event.key === 'ArrowDown') {
								event.preventDefault();
								wikiLinkSelectedIndex = (wikiLinkSelectedIndex + 1) % Math.max(1, wikiLinkFiltered.length);
								return true;
							}
							if (event.key === 'ArrowUp') {
								event.preventDefault();
								wikiLinkSelectedIndex = (wikiLinkSelectedIndex - 1 + wikiLinkFiltered.length) % Math.max(1, wikiLinkFiltered.length);
								return true;
							}
							if (event.key === 'Enter' || event.key === 'Tab') {
								if (wikiLinkFiltered.length > 0) {
									event.preventDefault();
									executeWikiLinkCommand(wikiLinkSelectedIndex);
									return true;
								}
								closeWikiLinkMenu();
								return false;
							}
							if (event.key === 'Escape') {
								event.preventDefault();
								closeWikiLinkMenu();
								return true;
							}
							return false;
						},
						handleTextInput: (view, from, to, text) => {
							if (!$appConfig?.enable_wiki_links) return false;
							// Detect [[ opening: flag so onTransaction opens the menu on mobile
							if (text === '[') {
								const charBefore = from > 0 ? view.state.doc.textBetween(from - 1, from) : '';
								if (charBefore === '[') wikiLinkTypedByUser = true;
							}
							// Detect ]] closing: auto-resolve the current text as a wiki-link
							if (text === ']' && wikiLinkMenu) {
								const state = view.state;
								const textBefore = state.doc.textBetween(wikiLinkMenu.from, state.selection.from);
								if (textBefore.endsWith(']')) {
									// Supports Obsidian syntax: [[note|alias]], [[note#heading]], [[note^block]]
									const rawQuery = textBefore.slice(2, -1); // strip the [[ and trailing ]
									if (rawQuery.trim()) {
										const pipeIdx = rawQuery.indexOf('|');
										const noteRef = (pipeIdx >= 0 ? rawQuery.slice(0, pipeIdx) : rawQuery).trim();
										const display = (pipeIdx >= 0 ? rawQuery.slice(pipeIdx + 1) : noteRef).trim();
										// Strip #heading and ^block for title matching
										const titleForLookup = noteRef.replace(/#.*$/, '').replace(/\^.*$/, '').trim();
										const matches = wikiLinkTitlesCache.filter(e => e.title.toLowerCase() === titleForLookup.toLowerCase());
										if (matches.length === 1) {
											insertWikiLink({ ...matches[0], title: display }, noteRef);
										} else if (matches.length > 1) {
											// Keep the menu open but filter to only the matching entries
											wikiLinkMenu = { ...wikiLinkMenu!, query: titleForLookup };
											// Override filtered results to only show exact matches
											wikiLinkDisambigEntries = matches;
											wikiLinkDisambigRef = noteRef;
											wikiLinkDisambigDisplay = display;
											wikiLinkSelectedIndex = 0;
										} else {
											// Insert as unresolved wiki-link (no path)
											const menuFrom = wikiLinkMenu.from;
											const curTo = state.selection.from;
											closeWikiLinkMenu();
											// Delete [[ text + query + the trailing ]
											editor?.chain().focus().deleteRange({ from: menuFrom, to: curTo }).run();
											tick().then(() => {
												editor?.chain().focus().insertContent({
													type: 'text',
													text: display,
													marks: [{ type: 'wikiLink', attrs: { title: noteRef, path: '' } }],
												}).run();
											});
										}
									} else {
										closeWikiLinkMenu();
									}
									return true;
								}
							}
							return false;
						},
					},
				}),
			];
		},
	});

	function updateWikiLinkMenu() {
		wikiLinkTypedByUser = false;
		if (!editor || !$appConfig?.enable_wiki_links) return;
		const { state } = editor;
		const { selection } = state;
		const resolvedFrom = selection.$from;
		const parentNode = resolvedFrom.parent;
		if (parentNode.type.name !== 'paragraph' && parentNode.type.name !== 'heading') {
			closeWikiLinkMenu();
			return;
		}
		// Build textBefore from the actual ProseMirror node content so positions are accurate
		// (parentNode.textContent flattens images/atoms, causing position miscalculation)
		let textBefore = '';
		const cursorOffset = resolvedFrom.parentOffset;
		parentNode.forEach((child, offset) => {
			if (offset >= cursorOffset) return false;
			if (child.isText) {
				textBefore += child.text!.slice(0, Math.min(child.nodeSize, cursorOffset - offset));
			}
		});
		// Match [[ at start of line or after whitespace
		const match = textBefore.match(/\[\[([^\]]*)$/);
		if (!match) {
			closeWikiLinkMenu();
			return;
		}
		// Refresh titles when the menu first opens so newly created notes are found
		if (!wikiLinkMenu) refreshWikiLinkTitles();
		const query = match[1];
		// Calculate from as cursor position minus the matched text length ("[[query")
		const from = resolvedFrom.pos - match[0].length;
		const coords = editor.view.coordsAtPos(from);
		let x = coords.left;
		if (x + 280 > window.innerWidth) x = window.innerWidth - 290;
		const visibleBottom = window.innerHeight - keyboardHeight;
		const menuHeight = 360;
		let y = coords.bottom + 4;
		if (y + menuHeight > visibleBottom) y = coords.top - menuHeight - 4;
		if (y < 4) y = 4;
		wikiLinkMenu = { x, y, query, from };
		wikiLinkSelectedIndex = 0;
	}

	async function navigateToWikiLink(path: string, title: string, clickEvent?: MouseEvent) {
		// title may contain #heading or ^block anchors - strip for note lookup
		const noteTitle = title.replace(/#.*$/, '').replace(/\^.*$/, '').trim();
		if (!path) {
			// Try path-based resolution first (for disambiguated refs like "folder/note")
			const vaultRoot = $appConfig?.active_vault;
			if (noteTitle.includes('/') && vaultRoot) {
				const fullPath = vaultRoot + '/' + noteTitle + '.md';
				const pathMatch = wikiLinkTitlesCache.find(e => e.path === fullPath);
				if (pathMatch) {
					path = pathMatch.path;
				} else {
					const lastSegment = noteTitle.split('/').pop()!;
					const segMatches = wikiLinkTitlesCache.filter(e => e.title.toLowerCase() === lastSegment.toLowerCase());
					if (segMatches.length === 1) path = segMatches[0].path;
					else if (segMatches.length > 1) {
						let x = clickEvent ? clickEvent.clientX : window.innerWidth / 2 - 140;
						let y = clickEvent ? clickEvent.clientY + 8 : window.innerHeight / 2 - 100;
						if (x + 280 > window.innerWidth) x = window.innerWidth - 290;
						if (y + 200 > window.innerHeight) y = Math.max(4, window.innerHeight - 200);
						wikiLinkNavDisambig = { entries: segMatches, x, y };
						wikiLinkNavDisambigIndex = 0;
						return;
					}
				}
			}
		}
		if (!path) {
			const matches = wikiLinkTitlesCache.filter(e => e.title.toLowerCase() === noteTitle.toLowerCase());
			if (matches.length === 1) {
				path = matches[0].path;
			} else if (matches.length > 1) {
				let x = clickEvent ? clickEvent.clientX : window.innerWidth / 2 - 140;
				let y = clickEvent ? clickEvent.clientY + 8 : window.innerHeight / 2 - 100;
				if (x + 280 > window.innerWidth) x = window.innerWidth - 290;
				if (y + 200 > window.innerHeight) y = Math.max(4, window.innerHeight - 200);
				wikiLinkNavDisambig = { entries: matches, x, y };
				wikiLinkNavDisambigIndex = 0;
				return;
			} else {
				// Offer to create the note (use clean title, not the anchor ref)
				const cleanTitle = noteTitle.includes('/') ? noteTitle.split('/').pop()! : noteTitle;
				const notebookRel = $activeNotePath
					? $activeNotePath.substring(($appConfig?.active_vault?.length ?? 0) + 1).split('/').slice(0, -1).join('/')
					: null;
				try {
					await appState.createNote(cleanTitle, notebookRel || null);
				} catch (e) {
					console.error('Failed to create note:', e);
				}
				return;
			}
		}
		try {
			const content = await readNote(path);
			$activeNote = { ...content, content: content.content };
			$activeNotePath = path;
		} catch (e) {
			console.error('Failed to navigate to wiki-link:', e);
		}
	}

	async function navigateToWikiLinkDirect(entry: NoteTitleEntry) {
		wikiLinkNavDisambig = null;
		try {
			const content = await readNote(entry.path);
			$activeNote = { ...content, content: content.content };
			$activeNotePath = entry.path;
		} catch (e) {
			console.error('Failed to navigate to wiki-link:', e);
		}
	}

	const textColors = [
		{ name: 'Default', value: '' },
		{ name: 'Red', value: '#ef4444' },
		{ name: 'Orange', value: '#f97316' },
		{ name: 'Amber', value: '#f59e0b' },
		{ name: 'Green', value: '#22c55e' },
		{ name: 'Blue', value: '#3b82f6' },
		{ name: 'Purple', value: '#a855f7' },
		{ name: 'Pink', value: '#ec4899' },
	];

	const highlightColors = [
		{ name: 'Yellow', value: 'rgba(250, 230, 100, 0.25)', swatch: '#f5e050' },
		{ name: 'Green', value: 'rgba(100, 210, 130, 0.22)', swatch: '#5cc870' },
		{ name: 'Blue', value: 'rgba(100, 170, 240, 0.22)', swatch: '#6aabf0' },
		{ name: 'Purple', value: 'rgba(180, 130, 240, 0.22)', swatch: '#a878e8' },
		{ name: 'Pink', value: 'rgba(240, 140, 180, 0.22)', swatch: '#e88aaa' },
		{ name: 'Red', value: 'rgba(240, 120, 120, 0.22)', swatch: '#e07070' },
		{ name: 'Orange', value: 'rgba(240, 170, 90, 0.25)', swatch: '#e8a050' },
		{ name: 'Cyan', value: 'rgba(80, 210, 230, 0.22)', swatch: '#50cce0' },
	];



	const cellColors = [
		{ name: 'None', value: '' },
		{ name: 'Light Red', value: '#fde8e8' },
		{ name: 'Light Orange', value: '#fef3e2' },
		{ name: 'Light Yellow', value: '#fef9e7' },
		{ name: 'Light Green', value: '#e6f8e0' },
		{ name: 'Light Blue', value: '#e0f0fe' },
		{ name: 'Light Purple', value: '#f0e6fe' },
		{ name: 'Light Pink', value: '#fde8f0' },
		{ name: 'Light Gray', value: '#f3f4f6' },
		{ name: 'Dark Red', value: '#7f1d1d' },
		{ name: 'Dark Amber', value: '#713f12' },
		{ name: 'Dark Green', value: '#14532d' },
		{ name: 'Dark Blue', value: '#1e3a5f' },
		{ name: 'Dark Purple', value: '#4c1d95' },
		{ name: 'Dark Pink', value: '#831843' },
		{ name: 'Dark Teal', value: '#064e3b' },
		{ name: 'Dark Cyan', value: '#0c4a6e' },
		{ name: 'Slate', value: '#1e293b' },
		{ name: 'Gray', value: '#374151' },
	];

	function resolveImageSrc(src: string): string {
		// Already a proxied, asset, data, or blob URL
		if (src.startsWith('data:') || src.startsWith('asset:') || src.startsWith('blob:') || src.startsWith('imgproxy:') || src.startsWith('http://imgproxy.localhost') || src.startsWith('https://imgproxy.localhost')) {
			return src;
		}
		// Already an asset-localhost URL
		if (src.startsWith('http://asset.localhost') || src.startsWith('https://asset.localhost')) {
			return src;
		}
		// External http/https URLs: proxy through Tauri's imgproxy protocol
		// to bypass WebKitGTK restrictions on loading external resources
		if (src.startsWith('http://') || src.startsWith('https://')) {
			return convertFileSrc(src, 'imgproxy');
		}
		// Decode percent-encoding (%20 → space, etc.) for filesystem resolution
		let decoded = decodeURIComponent(src);
		// Fix multiple leading slashes (from broken saves)
		if (decoded.match(/^\/{2,}/)) {
			decoded = decoded.replace(/^\/{2,}/, '/');
		}
		if (decoded.startsWith('/')) {
			return convertFileSrc(normalizePath(decoded));
		}
		// Paths containing .helixnotes/ are vault-root relative (our own attachments)
		if (decoded.includes('.helixnotes/')) {
			const vaultRoot = $appConfig?.active_vault;
			if (vaultRoot) {
				// Extract from .helixnotes/ onward in case of prefixed subdir paths
				const idx = decoded.indexOf('.helixnotes/');
				return convertFileSrc(`${vaultRoot}/${decoded.substring(idx)}`);
			}
		}
		// Standard markdown: resolve relative paths against the note's directory
		const notePath = $activeNotePath;
		if (notePath) {
			const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
			return convertFileSrc(normalizePath(`${noteDir}/${decoded}`));
		}
		// Last fallback: vault root
		const vaultRoot = $appConfig?.active_vault;
		if (vaultRoot) {
			return convertFileSrc(normalizePath(`${vaultRoot}/${decoded}`));
		}
		return src;
	}

	const autoSave = debounce(async () => {
		if (get(viewerNote)) return; // never autosave external viewer files
		if (!$activeNote || !$activeNotePath || !$editorDirty) return;
		// Only fix blob images if a paste occurred (avoids full doc scan on every save)
		if (hasPendingBlobs) {
			hasPendingBlobs = false;
			fixingBlobsPromise = fixBlobImages();
		}
		await fixingBlobsPromise;
		try {
			const bodyHtml = $sourceMode ? sourceContent : (editor ? editor.getHTML() : '');
			const textOnly = bodyHtml.replace(/<[^>]+>/g, '').trim();
			if (!textOnly && $activeNote.content && $activeNote.content.replace(/<[^>]+>/g, '').trim().length > 10) {
				console.warn('Auto-save blocked: refusing to overwrite note with empty content');
				return;
			}
			const fileContent = generateHtmlNote($activeNote.meta, bodyHtml);
			await saveNote($activeNotePath, $activeNote.meta, fileContent);
			$editorDirty = false;
		} catch (e) {
			console.error('Auto-save failed:', e);
		}
	}, isMobile ? 1500 : 500);

	export async function forceSave() {
		if (get(viewerNote)) return; // viewer files are never written back
		if (!$activeNote || !$activeNotePath) return;
		await fixingBlobsPromise;

		if (appState.editorMode === 'canvas') {
			if (canvasPerformSaveImmediate) {
				canvasPerformSaveImmediate();
			}
			return;
		}

		try {
			const bodyHtml = $sourceMode ? sourceContent : (editor ? editor.getHTML() : '');
			const textOnly = bodyHtml.replace(/<[^>]+>/g, '').trim();
			if (!textOnly && $activeNote.content && $activeNote.content.replace(/<[^>]+>/g, '').trim().length > 10) {
				console.warn('Force-save blocked: refusing to overwrite note with empty content');
				return;
			}
			const fileContent = generateHtmlNote($activeNote.meta, bodyHtml);
			await saveNote($activeNotePath, $activeNote.meta, fileContent);
			$editorDirty = false;
		} catch (e) {
			console.error('Save failed:', e);
		}
	}

	// Sync editor editable state when readOnly store changes (from titlebar or editor)
	$effect(() => {
		const ro = $readOnly;
		untrack(() => {
			if (editor) {
				if (ro && $editorDirty) forceSave();
				ignoreNextUpdate = true; // Ignore update transaction triggered by setEditable
				editor.setEditable(!ro);
			}
		});
	});

	// Belt-and-suspenders: viewer mode is always read-only, regardless of any other path
	// that might toggle setEditable. Re-asserts every time the editor or viewer state changes.
	$effect(() => {
		const v = $viewerNote;
		untrack(() => {
			if (editor && v) editor.setEditable(false);
		});
	});

	async function toggleHistory() {
		showHistory = !showHistory;
		historyPreview = null;
		historySelected = null;
		if (showHistory && $activeNote) {
			historyLoading = true;
			try {
				historyVersions = await getNoteVersions($activeNote.meta.id);
			} catch (e) {
				console.error('Failed to load versions:', e);
				historyVersions = [];
			}
			historyLoading = false;
		}
	}

	async function previewVersion(v: VersionEntry) {
		if (!$activeNote) return;
		historySelected = v;
		try {
			historyPreview = await getNoteVersionContent($activeNote.meta.id, v.timestamp);
		} catch (e) {
			console.error('Failed to load version:', e);
		}
	}

	async function restoreVersion() {
		if (!$activeNote || !$activeNotePath || !historySelected) return;
		try {
			const raw = historyPreview ?? await getNoteVersionContent($activeNote.meta.id, historySelected.timestamp);
			// The raw content includes frontmatter - parse out the body
			const fmEnd = raw.indexOf('---', 4);
			const body = fmEnd > 0 ? raw.substring(raw.indexOf('\n', fmEnd) + 1) : raw;
			if (editor) {
				editor.commands.setContent(markdownToHtml(body));
				resolveLocalAssets();
			}
			$editorDirty = true;
			autoSave();
			historyPreview = null;
			historySelected = null;
			showHistory = false;
		} catch (e) {
			console.error('Failed to restore version:', e);
		}
	}

	async function handleCreateVersion() {
		if (!$activeNote || !$activeNotePath) return;
		// Save current content first so the snapshot is up to date
		await forceSave();
		try {
			await createVersion($activeNotePath, $activeNote.meta.id);
			// Refresh the version list
			historyVersions = await getNoteVersions($activeNote.meta.id);
		} catch (e) {
			console.error('Failed to create version:', e);
		}
	}

	function formatVersionDate(iso: string): string {
		try {
			const d = new Date(iso);
			const now = new Date();
			const diffMs = now.getTime() - d.getTime();
			const diffMins = Math.floor(diffMs / 60000);
			if (diffMins < 1) return 'Just now';
			if (diffMins < 60) return `${diffMins}m ago`;
			const diffHours = Math.floor(diffMins / 60);
			if (diffHours < 24) return `${diffHours}h ago`;
			const diffDays = Math.floor(diffHours / 24);
			if (diffDays < 7) return `${diffDays}d ago`;
			return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
		} catch {
			return iso;
		}
	}

	function formatVersionSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	function clearEditorHistory() {
		if (!editor) return;
		// Recreate editor state with same doc/schema/plugins but fresh plugin state (clears undo/redo)
		const { doc, schema, plugins } = editor.state;
		const newState = EditorState.create({ doc, schema, plugins });
		editor.view.updateState(newState);
	}

	export function focusTitle() {
		tick().then(() => {
			if (titleInput) {
				titleInput.focus();
				titleInput.select();
			}
		});
	}

	async function editorNavigateHistory(direction: -1 | 1) {
		const path = navHistory.go(direction);
		if (!path) return;
		flushSave();
		try {
			const content = await readNote(path);
			$activeNote = content;
			$activeNotePath = path;
			$editorDirty = false;
		} catch {}
	}

	/** Flush unsaved editor content to disk (synchronous serialize + fire-and-forget save).
	 *  Call BEFORE updating $activeNote/$activeNotePath stores when switching notes. */
	export function flushSave() {
		if (!$editorDirty || !$activeNote || !$activeNotePath) return;
		try {
			const bodyHtml = $sourceMode ? sourceContent : (editor ? editor.getHTML() : '');
			const fileContent = generateHtmlNote($activeNote.meta, bodyHtml);
			saveNote($activeNotePath, $activeNote.meta, fileContent);
		} catch (e) {
			console.error('Pre-switch save failed:', e);
		}
		$editorDirty = false;
	}

	export function loadNote(path: string, content: string) {
		clearResolvedAssets();
		content = content || '';
		loadedPath = path;
		
		if (path.endsWith('.notebook.json') || appState.editorMode === 'notebook') {
			isLoadingNote = false;
			return;
		}

		lastSourceMode = $sourceMode;
		isLoadingNote = true;
		isLargeDoc = content.length > LARGE_DOC_CHARS;

		// Clear saved selection and scroll positions when loading a new file
		savedSelection = null;
		savedScrollTop = null;

		// Restore previous mode for this file if persisted
		const savedMode = localStorage.getItem('mynotes_mode_' + path);
		let shouldBeReadOnly = false;
		const isViewer = !!get(viewerNote);
		const isNewNote = $activeNote?.meta.title === 'Untitled' && !content.replace(/^---[\s\S]*?---\s*/, '').trim();

		if (savedMode === 'read') {
			shouldBeReadOnly = true;
		} else if (savedMode === 'edit') {
			shouldBeReadOnly = false;
		} else {
			shouldBeReadOnly = isViewer ? true : (isNewNote ? false : ($appConfig?.default_view_mode ?? false));
		}

		$readOnly = shouldBeReadOnly;
		if (editor) editor.setEditable(!shouldBeReadOnly);
		const editorBody = editorElement?.closest('.editor-body') as HTMLElement | null;
		if ($sourceMode) {
			sourceContent = path.endsWith('.html') ? parseHtmlMetadata(content).content : stripTitleH1(content);
			resetSourceHistory(sourceContent);
			if (editorBody) editorBody.scrollTop = 0;
			isLoadingNote = false;
		} else if (editorElement && editor) {
			// Editor already exists, just swap content
			const html = path.endsWith('.html') ? parseHtmlMetadata(content).content : markdownToHtml(content);
			ignoreNextUpdate = true;
			editor.commands.setContent(html);
			// Clear undo/redo history so it doesn't bleed across notes
			clearEditorHistory();
			// Reset scroll and cursor after all ProseMirror/Svelte DOM updates settle
			tick().then(() => {
				if (editorBody) editorBody.scrollTop = 0;
				// Explicitly reset ProseMirror selection to start so TipTap's focus()
				// (triggered by checkbox clicks etc.) doesn't scroll to the old note's cursor position.
				if (editor) {
					const tr = editor.state.tr.setSelection(TextSelection.atStart(editor.state.doc));
					// No tr.scrollIntoView() - must not trigger any scroll
					editor.view.dispatch(tr);
				}
				resolveLocalAssets();
				requestAnimationFrame(() => { if (editorBody) editorBody.scrollTop = 0; });
				isLoadingNote = false;
			});
		} else {
			// Editor element not in DOM yet (first note load).
			// Store content and let the $effect on editorElement handle init.
			pendingContent = content;
			isLoadingNote = false;
		}
	}

	function triggerCreateNote() {
		appState.showPrompt({
			title: 'New Note',
			message: 'Enter title for the new note:',
			value: 'Untitled Note',
			placeholder: 'Note title...',
			onConfirm: (title) => {
				const trimmed = title.trim();
				if (trimmed) {
					appState.createNote(trimmed, appState.activeNotebook);
				}
			}
		});
	}

	function stripTitleH1(md: string): string {
		const title = $activeNote?.meta.title;
		if (!$appConfig?.hide_title_in_body || !title) {
			titleWasStripped = false;
			strippedTitle = '';
			strippedHeadingPrefix = '';
			return md;
		}
		// Find the first non-empty line
		const lines = md.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (line === '') continue;
			// Check if it's a heading (any level) matching the note title
			// Normalize: lowercase, collapse whitespace, strip common separators (- - _)
			const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s\-—_]+/g, ' ');
			const match = line.match(/^(#{1,6})\s+(.+)$/);
			if (match && normalize(match[2]) === normalize(title)) {
				titleWasStripped = true;
				strippedTitle = title.trim();
				strippedHeadingPrefix = match[1]; // preserve original heading level (e.g. "##")
				lines.splice(i, 1);
				// Also remove a trailing blank line after the heading if present
				if (i < lines.length && lines[i].trim() === '') {
					lines.splice(i, 1);
				}
				return lines.join('\n');
			}
			break; // First non-empty line isn't a matching heading, stop
		}
		titleWasStripped = false;
		strippedTitle = '';
		strippedHeadingPrefix = '';
		return md;
	}

	function restoreTitleH1(md: string): string {
		if (!titleWasStripped || !strippedTitle) return md;
		return `${strippedHeadingPrefix} ${strippedTitle}\n\n${md}`;
	}

	function editorToMarkdown(): string {
		if (!editor) return '';
		const md = prosemirrorToMarkdown(editor.state.doc);
		return restoreTitleH1(md);
	}

	function isImageNode(node: any): boolean {
		if (node.type.name === 'image') return true;
		if (node.type.name !== 'paragraph') return false;
		let hasImage = false;
		let hasOther = false;
		node.forEach((child: any) => {
			if (child.type.name === 'image') hasImage = true;
			else hasOther = true;
		});
		return hasImage && !hasOther;
	}

	function prosemirrorToMarkdown(doc: any): string {
		const entries: { text: string; isImage: boolean }[] = [];
		doc.forEach((node: any) => {
			const isEmpty = node.type.name === 'paragraph' && node.childCount === 0;
			// Preserve every empty paragraph as <!-- --> so markdown round-trip keeps the user's
			// vertical spacing exactly. markdownToHtml converts the marker back to <p></p> on load.
			if (isEmpty) {
				entries.push({ text: '<!-- -->', isImage: false });
				return;
			}
			entries.push({ text: serializeNode(node), isImage: isImageNode(node) });
		});
		// Join: skip extra \n separator before image nodes so they don't get unwanted blank lines
		let result = '';
		for (let i = 0; i < entries.length; i++) {
			if (i === 0) {
				result = entries[i].text;
			} else {
				const separator = entries[i].isImage ? '' : '\n';
				result += separator + entries[i].text;
			}
		}
		return result.replace(/\n{3,}/g, '\n\n').trim() + '\n';
	}

	function serializeNode(node: any): string {
		switch (node.type.name) {
			case 'paragraph': {
				const align = node.attrs.textAlign;
				if (align && align !== 'left') {
					return `<p style="text-align: ${align}">${serializeInline(node)}</p>\n`;
				}
				return serializeInline(node) + '\n';
			}
			case 'heading': {
				const align = node.attrs.textAlign;
				if (align && align !== 'left') {
					return `<h${node.attrs.level} style="text-align: ${align}">${serializeInline(node)}</h${node.attrs.level}>\n`;
				}
				return '#'.repeat(node.attrs.level) + ' ' + serializeInline(node) + '\n';
			}
			case 'codeBlock': {
				const lang = node.attrs.language || '';
				const code = node.textContent.replace(/\n+$/, '');
				return '```' + lang + '\n' + code + '\n```\n';
			}
			case 'blockquote': {
				const blocks: string[] = [];
				node.forEach((child: any) => {
					const lines = serializeNode(child).replace(/\n$/, '').split('\n');
					blocks.push(lines.map((l: string) => '> ' + l).join('\n'));
				});
				return blocks.join('\n>\n') + '\n';
			}
			case 'bulletList': {
				const items: string[] = [];
				node.forEach((child: any) => items.push('- ' + serializeListItem(child)));
				return items.join('') + '\n';
			}
			case 'orderedList': {
				const items: string[] = [];
				let i = node.attrs.start || 1;
				node.forEach((child: any) => { items.push(`${i++}. ` + serializeListItem(child)); });
				return items.join('') + '\n';
			}
			case 'taskList': {
				const items: string[] = [];
				node.forEach((child: any) => {
					const checked = child.attrs.checked ? 'x' : ' ';
					items.push(`- [${checked}] ` + serializeListItem(child));
				});
				return items.join('') + '\n';
			}
			case 'listItem':
			case 'taskItem':
				return serializeListItem(node);
			case 'horizontalRule':
				return '---\n';
			case 'pageBreak':
				return '<div style="page-break-after: always;"></div>\n';
			case 'table': {
				// Preserve tables as raw HTML
				const tempDiv = document.createElement('div');
				const frag = DOMSerializer.fromSchema(editor!.schema).serializeNode(node);
				tempDiv.appendChild(frag);
				return tempDiv.innerHTML + '\n';
			}
			case 'pdfEmbed': {
				const src = node.attrs.src || '';
				const name = node.attrs.name || '';
				return `<div data-pdf-src="${src}" data-pdf-name="${name}" class="pdf-embed"></div>\n`;
			}
			case 'mathBlock': {
				const tex = node.attrs.tex || '';
				return `$$\n${tex}\n$$\n`;
			}
			case 'details': {
				// Preserve details as raw HTML
				const detDiv = document.createElement('div');
				const detFrag = DOMSerializer.fromSchema(editor!.schema).serializeNode(node);
				detDiv.appendChild(detFrag);
				return detDiv.innerHTML + '\n';
			}
			case 'image': {
				const src = stripAssetSrc(node.attrs.src || '');
				if (!src) return ''; // Skip images with unresolved blob: URLs
				const alt = node.attrs.alt || '';
				const size = node.attrs['data-size'] || node.attrs.size || 'full';
				const sizeSuffix = size && size !== 'full' ? `|size=${size}` : '';
				return `![${alt}${sizeSuffix}](${src})\n`;
			}
			default:
				return node.textContent || '';
		}
	}

	function serializeListItem(node: any): string {
		const parts: string[] = [];
		node.forEach((child: any) => {
			if (child.type.name === 'paragraph') {
				parts.push(serializeInline(child));
			} else if (child.type.name === 'bulletList' || child.type.name === 'orderedList' || child.type.name === 'taskList') {
				// Indent nested lists so markdown parsers recognize nesting
				// Use 4 spaces - works for both bullet (- ) and ordered (1. ) parent markers
				const nested = serializeNode(child).replace(/\n$/, '');
				const indented = nested.split('\n').map((line: string) => '    ' + line).join('\n');
				parts.push(indented);
			} else {
				parts.push(serializeNode(child));
			}
		});
		return parts.join('\n') + '\n';
	}

	function serializeInline(node: any): string {
		if (node.childCount === 0) return '';
		const parts: string[] = [];
		node.forEach((child: any, _offset: number, index: number) => {
			if (child.isText) {
				let text = child.text || '';
				// Preserve leading tabs/em-spaces as HTML entities so they survive markdown roundtrip
				// (markdown parsers strip tab whitespace, but &emsp; passes through as HTML)
				// Tabs come from initial indent; em-spaces (U+2003) come from prior &emsp; roundtrips
				if (index === 0) {
					text = text.replace(/^[\t\u2003]+/, (ws: string) => '&emsp;'.repeat(ws.length));
				}
				// Apply marks
				for (const mark of child.marks) {
					switch (mark.type.name) {
						case 'bold': text = `**${text}**`; break;
						case 'italic': text = `*${text}*`; break;
						case 'strike': text = `~~${text}~~`; break;
						case 'code': text = `\`${text}\``; break;
						case 'underline': text = `<u>${text}</u>`; break;
						case 'subscript': text = `~${text}~`; break;
						case 'superscript': text = `^${text}^`; break;
						case 'highlight': {
							const color = mark.attrs?.color;
							if (color) {
								text = `<mark data-color="${color}">${text}</mark>`;
							} else {
								text = `==${text}==`;
							}
							break;
						}
						case 'textStyle': {
							const c = mark.attrs?.color;
							const f = mark.attrs?.fontFamily;
							const s = mark.attrs?.fontSize;
							const styleParts = [];
							if (c) styleParts.push(`color: ${c}`);
							if (f) styleParts.push(`font-family: ${f.replace(/"/g, '&quot;')}`);
							if (s) styleParts.push(`font-size: ${s}`);
							if (styleParts.length > 0) {
								text = `<span style="${styleParts.join('; ')}">${text}</span>`;
							}
							break;
						}
						case 'link': text = `[${text}](${mark.attrs.href})`; break;
						case 'wikiLink': {
							const wlTitle = mark.attrs.title || text;
							// If display text differs from the reference, emit [[ref|display]] (Obsidian alias syntax)
							text = wlTitle !== text ? `[[${wlTitle}|${text}]]` : `[[${wlTitle}]]`;
							break;
						}
					}
				}
				parts.push(text);
			} else if (child.type.name === 'image') {
				const src = stripAssetSrc(child.attrs.src || '');
				if (!src) return; // Skip images with unresolved blob: URLs
				const alt = child.attrs.alt || '';
				const size = child.attrs['data-size'] || child.attrs.size || 'full';
				const sizeSuffix = size && size !== 'full' ? `|size=${size}` : '';
				if (parts.length > 0 && parts[parts.length - 1] !== '\n') {
					parts.push('\n');
				}
				parts.push(`![${alt}${sizeSuffix}](${src})`);
			} else if (child.type.name === 'mathInline') {
				parts.push(`$${child.attrs.tex || ''}$`);
			} else if (child.type.name === 'hardBreak') {
				parts.push('  \n');
			}
		});
		return parts.join('');
	}

	function autofocus(el: HTMLElement) {
		requestAnimationFrame(() => el.focus());
	}

	// ── In-note search functions ──
	let noteSearchTimer: ReturnType<typeof setTimeout> | null = null;

	function updateNoteSearch(query: string) {
		if (noteSearchTimer) clearTimeout(noteSearchTimer);
		if (!query) {
			noteSearchResults = [];
			noteSearchIndex = 0;
			if (!$sourceMode && editor) {
				const tr = editor.state.tr.setMeta(noteSearchPluginKey, DecorationSet.empty);
				editor.view.dispatch(tr);
			}
			return;
		}
		noteSearchTimer = setTimeout(() => {
			if ($sourceMode) {
				updateNoteSearchSource(query);
			} else {
				updateNoteSearchWysiwyg(query);
			}
		}, 100);
	}

	function updateNoteSearchWysiwyg(query: string) {
		if (!editor) return;
		const results: {from: number, to: number}[] = [];
		const lowerQuery = query.toLowerCase();
		editor.state.doc.descendants((node, pos) => {
			if (!node.isText || !node.text) return;
			const text = node.text.toLowerCase();
			let idx = text.indexOf(lowerQuery);
			while (idx !== -1) {
				results.push({ from: pos + idx, to: pos + idx + query.length });
				idx = text.indexOf(lowerQuery, idx + 1);
			}
		});
		noteSearchResults = results;
		if (noteSearchIndex >= results.length) noteSearchIndex = 0;
		applySearchDecorations();
	}

	function updateNoteSearchSource(query: string) {
		const results: {from: number, to: number}[] = [];
		const lowerQuery = query.toLowerCase();
		const text = sourceContent.toLowerCase();
		let idx = text.indexOf(lowerQuery);
		while (idx !== -1) {
			results.push({ from: idx, to: idx + query.length });
			idx = text.indexOf(lowerQuery, idx + 1);
		}
		noteSearchResults = results;
		if (noteSearchIndex >= results.length) noteSearchIndex = 0;
		scrollToSourceMatch();
	}

	function scrollToSourceMatch(focusTextarea = false) {
		if (!sourceElement || noteSearchResults.length === 0) return;
		const match = noteSearchResults[noteSearchIndex];
		// Only steal focus when navigating (Enter/Shift+Enter), not while typing
		if (focusTextarea) sourceElement.focus();
		sourceElement.setSelectionRange(match.from, match.to);
		// Scroll the match into view
		const linesBefore = sourceContent.substring(0, match.from).split('\n').length;
		const lineHeight = parseFloat(getComputedStyle(sourceElement).lineHeight) || 20;
		const targetScroll = (linesBefore - 1) * lineHeight - sourceElement.clientHeight / 2;
		sourceElement.scrollTop = Math.max(0, targetScroll);
	}

	function resetSourceHistory(content: string) {
		sourceHistory = [{ content, cursor: content.length }];
		sourceHistoryIndex = 0;
		if (sourceHistoryTimer) {
			clearTimeout(sourceHistoryTimer);
			sourceHistoryTimer = null;
		}
	}

	function pushSourceHistoryImmediate() {
		if (!sourceElement) return;
		if (sourceHistoryTimer) {
			clearTimeout(sourceHistoryTimer);
			sourceHistoryTimer = null;
		}
		const entry = { content: sourceContent, cursor: sourceElement.selectionStart };
		// Don't push duplicate
		if (sourceHistoryIndex >= 0 && sourceHistory[sourceHistoryIndex]?.content === entry.content) return;
		// Truncate any redo history
		sourceHistory = sourceHistory.slice(0, sourceHistoryIndex + 1);
		sourceHistory.push(entry);
		sourceHistoryIndex++;
		// Limit stack size
		if (sourceHistory.length > 200) {
			sourceHistory.shift();
			sourceHistoryIndex--;
		}
	}

	function pushSourceHistoryDebounced() {
		if (sourceHistoryTimer) clearTimeout(sourceHistoryTimer);
		sourceHistoryTimer = setTimeout(() => {
			sourceHistoryTimer = null;
			pushSourceHistoryImmediate();
		}, 300);
	}

	function sourceUndo() {
		// Flush any pending debounced snapshot first
		if (sourceHistoryTimer) {
			clearTimeout(sourceHistoryTimer);
			sourceHistoryTimer = null;
			pushSourceHistoryImmediate();
		}
		if (sourceHistoryIndex <= 0) return;
		sourceHistoryIndex--;
		const entry = sourceHistory[sourceHistoryIndex];
		sourceContent = entry.content;
		tick().then(() => {
			sourceElement?.setSelectionRange(entry.cursor, entry.cursor);
		});
	}

	function sourceRedo() {
		if (sourceHistoryIndex >= sourceHistory.length - 1) return;
		sourceHistoryIndex++;
		const entry = sourceHistory[sourceHistoryIndex];
		sourceContent = entry.content;
		tick().then(() => {
			sourceElement?.setSelectionRange(entry.cursor, entry.cursor);
		});
	}

	function applySearchDecorations() {
		if (!editor) return;
		const decorations = noteSearchResults.map((m, i) =>
			Decoration.inline(m.from, m.to, { class: i === noteSearchIndex ? 'note-search-match note-search-active' : 'note-search-match' })
		);
		const decoSet = DecorationSet.create(editor.state.doc, decorations);
		const tr = editor.state.tr.setMeta(noteSearchPluginKey, decoSet);
		editor.view.dispatch(tr);
		scrollToCurrentMatch();
	}

	function scrollToCurrentMatch() {
		if (!editor || noteSearchResults.length === 0) return;
		requestAnimationFrame(() => {
			const el = editor?.view.dom.querySelector('.note-search-active');
			if (el) {
				el.scrollIntoView({ block: 'center', behavior: 'smooth' });
			}
		});
	}

	function noteSearchNext() {
		if (noteSearchResults.length === 0) return;
		noteSearchIndex = (noteSearchIndex + 1) % noteSearchResults.length;
		if ($sourceMode) {
			scrollToSourceMatch(true);
		} else {
			applySearchDecorations();
		}
	}

	function noteSearchPrev() {
		if (noteSearchResults.length === 0) return;
		noteSearchIndex = (noteSearchIndex - 1 + noteSearchResults.length) % noteSearchResults.length;
		if ($sourceMode) {
			scrollToSourceMatch(true);
		} else {
			applySearchDecorations();
		}
	}

	export function openNoteSearch() {
		noteSearchOpen = true;
	}

	function closeNoteSearch() {
		noteSearchOpen = false;
		noteSearchQuery = '';
		noteSearchResults = [];
		noteSearchIndex = 0;
		if (!$sourceMode && editor) {
			const tr = editor.state.tr.setMeta(noteSearchPluginKey, DecorationSet.empty);
			editor.view.dispatch(tr);
			editor.commands.focus();
		}
	}

	function stripAssetSrc(src: string): string {
		// blob: URLs are not persistable - they were temporary browser references
		if (src.startsWith('blob:')) return '';
		// Convert imgproxy:// URLs back to original external URLs for saving
		if (src.startsWith('imgproxy:') || src.startsWith('http://imgproxy.localhost') || src.startsWith('https://imgproxy.localhost')) {
			try {
				const url = new URL(src);
				return decodeURIComponent(url.pathname.substring(1));
			} catch {
				return src;
			}
		}
		// Convert asset:// URLs back to relative paths for saving
		if (!src.startsWith('asset:') && !src.startsWith('http://asset.localhost')) return src;
		let absPath = '';
		try {
			const url = new URL(src);
			absPath = decodeURIComponent(url.pathname);
		} catch {
			return src;
		}
		// Clean up any leading double/triple slashes (URL parsing artifact)
		absPath = absPath.replace(/^\/{2,}/, '/');
		// Make relative to note directory (matches how resolveImageSrc works)
		const notePath = $activeNotePath;
		if (notePath) {
			const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
			if (absPath.startsWith(noteDir + '/')) {
				return absPath.substring(noteDir.length + 1);
			}
		}
		// Fallback: make relative to vault root
		const vaultRoot = $appConfig?.active_vault;
		if (vaultRoot && absPath.startsWith(vaultRoot + '/')) {
			return absPath.substring(vaultRoot.length + 1);
		}
		return absPath;
	}

	function htmlToMarkdown(html: string): string {
		let md = html;
		// Preserve styled spans and marks
		const styledSpans: string[] = [];
		md = md.replace(/<span style=["']([^"']*)["']>(.*?)<\/span>/gi, (match) => {
			styledSpans.push(match);
			return `%%STYLESPAN_${styledSpans.length - 1}%%`;
		});
		const styledMarks: string[] = [];
		md = md.replace(/<mark data-color=["']([^"']*)["']>(.*?)<\/mark>/gi, (match) => {
			styledMarks.push(match);
			return `%%STYLEMARK_${styledMarks.length - 1}%%`;
		});
		// Code blocks MUST be converted before inline code to avoid corruption
		md = md.replace(/<pre><code[^>]*class="language-(\w+)"[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, lang, code) => {
			const stripped = code.replace(/<[^>]+>/g, '');
			const decoded = stripped.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
			return '```' + lang + '\n' + decoded + '\n```\n';
		});
		md = md.replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
			const stripped = code.replace(/<[^>]+>/g, '');
			const decoded = stripped.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
			return '```\n' + decoded + '\n```\n';
		});
		md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
		md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
		md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n');
		md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n');
		md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n');
		md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n');
		md = md.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
		md = md.replace(/<b>(.*?)<\/b>/gi, '**$1**');
		md = md.replace(/<em>(.*?)<\/em>/gi, '*$1*');
		md = md.replace(/<i>(.*?)<\/i>/gi, '*$1*');
		md = md.replace(/<s>(.*?)<\/s>/gi, '~~$1~~');
		md = md.replace(/<del>(.*?)<\/del>/gi, '~~$1~~');
		md = md.replace(/<u>(.*?)<\/u>/gi, '<u>$1</u>');
		md = md.replace(/<sub>(.*?)<\/sub>/gi, '~$1~');
		md = md.replace(/<sup>(.*?)<\/sup>/gi, '^$1^');
		md = md.replace(/<code>(.*?)<\/code>/gi, '`$1`');
		md = md.replace(/<mark data-color="([^"]*)">(.*?)<\/mark>/gi, '<mark data-color="$1">$2</mark>');
		md = md.replace(/<mark>(.*?)<\/mark>/gi, '==$1==');
		md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
			return content
				.replace(/<p[^>]*>(.*?)<\/p>/gi, '> $1\n')
				.replace(/<br\s*\/?>/gi, '\n> ');
		});
		md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href, text) => {
			// Decode percent-encoded href back to readable form for markdown source
			// Spaces are re-encoded by markdownToHtml preprocessing before markdown-it parsing
			const decoded = decodeURIComponent(href);
			return `[${text}](${decoded})`;
		});
		md = md.replace(/<img[^>]*>/gi, (match) => {
			const srcMatch = match.match(/src="([^"]*)"/);
			const altMatch = match.match(/alt="([^"]*)"/);
			const sizeMatch = match.match(/data-size="([^"]*)"/);
			const src = srcMatch ? stripAssetSrc(srcMatch[1]) : '';
			const alt = altMatch ? altMatch[1] : '';
			const size = sizeMatch ? sizeMatch[1] : 'full';
			const sizeSuffix = size && size !== 'full' ? `|size=${size}` : '';
			return `![${alt}${sizeSuffix}](${src})`;
		});
		// Preserve metrics blocks as raw HTML
		const metricsBlocks: string[] = [];
		md = md.replace(/<div[^>]*data-type="metrics"[\s\S]*?<\/div>/gi, (match) => {
			metricsBlocks.push(match);
			return `\n%%METRICS_${metricsBlocks.length - 1}%%\n`;
		});

		// Preserve PDF embeds as raw HTML
		const pdfs: string[] = [];
		md = md.replace(/<div[^>]*data-pdf-src="([^"]*)"[^>]*>[\s\S]*?<\/div>/gi, (match, src) => {
			// Store with the relative path - we strip convertFileSrc URLs on save
			const nameMatch = match.match(/data-pdf-name="([^"]*)"/);
			const name = nameMatch ? nameMatch[1] : src.split('/').pop() || 'file.pdf';
			pdfs.push(`<div data-pdf-src="${src}" data-pdf-name="${name}" class="pdf-embed"></div>`);
			return `\n%%PDF_${pdfs.length - 1}%%\n`;
		});
		// Preserve details/accordion blocks as raw HTML
		const detailsBlocks: string[] = [];
		md = md.replace(/<details[\s\S]*?<\/details>/gi, (match) => {
			detailsBlocks.push(match);
			return `\n%%DETAILS_${detailsBlocks.length - 1}%%\n`;
		});
		// Preserve tables as raw HTML (markdown tables are too limited)
		const tables: string[] = [];
		md = md.replace(/<table[\s\S]*?<\/table>/gi, (match) => {
			tables.push(match);
			return `\n%%TABLE_${tables.length - 1}%%\n`;
		});

		md = md.replace(/<hr\s*\/?>/gi, '---\n');
		md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
			return content.replace(/<li[^>]*><p[^>]*>(.*?)<\/p><\/li>/gi, '- $1\n')
				.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
		});
		md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
			let i = 0;
			return content.replace(/<li[^>]*><p[^>]*>(.*?)<\/p><\/li>/gi, () => `${++i}. $1\n`)
				.replace(/<li[^>]*>(.*?)<\/li>/gi, () => `${++i}. $1\n`);
		});
		md = md.replace(/<li[^>]*data-checked="true"[^>]*>(.*?)<\/li>/gi, '- [x] $1\n');
		md = md.replace(/<li[^>]*data-checked="false"[^>]*>(.*?)<\/li>/gi, '- [ ] $1\n');
		md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
		md = md.replace(/<br\s*\/?>/gi, '\n');

		// Convert callout blocks to blockquotes
		md = md.replace(/<div[^>]*data-type="callout"[^>]*data-callout-type="([^"]*)"[^>]*>([\s\S]*?)<\/div>/gi, (_, type: string, inner: string) => {
			const typeUpper = type.toUpperCase();
			const lines = inner.trim().split('\n');
			const prefixed = lines.map((line: string) => line.trim() ? `> ${line}` : '>').join('\n');
			return `> [!${typeUpper}]\n` + prefixed + '\n\n';
		});

		md = md.replace(/<[^>]+>/g, '');
		md = md.replace(/&amp;/g, '&');
		md = md.replace(/&lt;/g, '<');
		md = md.replace(/&gt;/g, '>');
		md = md.replace(/&quot;/g, '"');
		md = md.replace(/&#39;/g, "'");
		md = md.replace(/\n{3,}/g, '\n\n');
		// Restore table HTML
		tables.forEach((table, i) => {
			md = md.replace(`%%TABLE_${i}%%`, '\n' + table + '\n');
		});
		// Restore PDF embeds
		pdfs.forEach((pdf, i) => {
			md = md.replace(`%%PDF_${i}%%`, '\n' + pdf + '\n');
		});
		// Restore metrics blocks
		metricsBlocks.forEach((block, i) => {
			md = md.replace(`%%METRICS_${i}%%`, '\n' + block + '\n');
		});
		// Restore details/accordion blocks
		detailsBlocks.forEach((block, i) => {
			md = md.replace(`%%DETAILS_${i}%%`, '\n' + block + '\n');
		});
		// Restore styled spans and marks
		styledSpans.forEach((span, i) => {
			md = md.replace(`%%STYLESPAN_${i}%%`, span);
		});
		styledMarks.forEach((mark, i) => {
			md = md.replace(`%%STYLEMARK_${i}%%`, mark);
		});
		return md.trim() + '\n';
	}

	function markdownToHtml(md: string): string {
		let src = stripTitleH1(md);

		// Pre-process: convert [[Note Title]] wiki-links to HTML anchors
		// Supports Obsidian syntax: [[note|alias]], [[note#heading]], [[note^block]]
		if ($appConfig?.enable_wiki_links) {
			src = src.replace(/\[\[([^\]]+)\]\]/g, (_, raw) => {
				// Split on pipe: [[note|display text]] → noteRef="note", display="display text"
				const pipeIdx = raw.indexOf('|');
				const noteRef = (pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw).trim();
				const display = (pipeIdx >= 0 ? raw.slice(pipeIdx + 1) : noteRef).trim();
				// Strip #heading and ^block anchors for title matching
				const titleForLookup = noteRef.replace(/#.*$/, '').replace(/\^.*$/, '').trim();
				// Try to resolve: first by vault-relative path (for disambiguated links), then by title
				const vaultRoot = $appConfig?.active_vault ?? '';
				let match: NoteTitleEntry | undefined;
				if (titleForLookup.includes('/') && vaultRoot) {
					const fullPath = vaultRoot + '/' + titleForLookup + '.md';
					match = wikiLinkTitlesCache.find(e => e.path === fullPath);
				}
				if (!match) {
					// Fallback: resolve by title (use the last segment if path-based)
					const titleOnly = titleForLookup.includes('/') ? titleForLookup.split('/').pop()! : titleForLookup;
					const titleLower = titleOnly.toLowerCase();
					const titleMatches = wikiLinkTitlesCache.filter(e => e.title.toLowerCase() === titleLower);
					if (titleMatches.length === 1) {
						match = titleMatches[0];
					} else if (titleMatches.length > 1) {
						// Multiple matches - prefer the shallowest path (closest to vault root)
						match = titleMatches.reduce((a, b) =>
							a.path.split('/').length <= b.path.split('/').length ? a : b
						);
					}
				}
				const path = match ? match.path : '';
				return `<span data-wiki-link data-path="${escapeHtml(path)}" data-title="${escapeHtml(noteRef)}" class="wiki-link">${escapeHtml(display)}</span>`;
			});
		}

		// Pre-process: fix image paths with multiple leading slashes (from broken saves)
		src = src.replace(/!\[([^\]]*)\]\((\/{2,})(home\/)/g, '![$1](/home/');

		// Pre-process: percent-encode spaces in image URLs so markdown-it parses them correctly
		src = src.replace(/!\[([^\]]*)\]\(([^)]*\s[^)]*)\)/g, (match, alt, url) => {
			return `![${alt}](${url.replace(/ /g, '%20')})`;
		});

		// Pre-process: percent-encode spaces in link URLs so markdown-it parses them correctly
		// Matches [text](url with spaces) but not ![image](url) (already handled above)
		src = src.replace(/(?<!!)\[([^\]]*)\]\(([^)]*\s[^)]*)\)/g, (_match, text, url) => {
			return `[${text}](${url.replace(/ /g, '%20')})`;
		});

		// Pre-process: transform PDF embed divs - iframes when inline preview is on, clickable links otherwise
		src = src.replace(/<div[^>]*data-pdf-src="([^"]*)"[^>]*data-pdf-name="([^"]*)"[^>]*>[^<]*<\/div>/gi, (_, pdfSrc, name) => {
			const vaultRoot = $appConfig?.active_vault ?? '';
			const absPath = normalizePath(`${vaultRoot}/${decodeURIComponent(pdfSrc)}`);
			const showInline = !isMobile && ($appConfig?.pdf_preview ?? false);
			if (showInline) {
				const pdfHeight = $appConfig?.pdf_height ?? 600;
				const displaySrc = convertFileSrc(absPath);
				return `<div data-pdf-src="${pdfSrc}" data-pdf-name="${name}" class="pdf-embed"><iframe src="${displaySrc}" width="100%" height="${pdfHeight}px"></iframe><div class="pdf-footer"><p class="pdf-label">${name}</p><button class="pdf-download-btn" data-download-src="${pdfSrc}" title="Download PDF">Download</button></div></div>`;
			}
			return `<div data-pdf-src="${pdfSrc}" data-pdf-name="${name}" class="pdf-embed-mobile"><a href="${decodeURIComponent(pdfSrc)}" class="pdf-link-mobile">\uD83D\uDCC4 ${name}</a></div>`;
		});

		// Pre-process: render KaTeX math - only outside fenced code blocks
		{
			const lines = src.split('\n');
			const outLines: string[] = [];
			let inFence = false;
			let mathBlock: string[] | null = null;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (/^```/.test(line)) { inFence = !inFence; outLines.push(line); continue; }
				if (inFence) { outLines.push(line); continue; }
				// Accumulate block math: $$ on its own line starts/ends a block
				if (line.trim() === '$$') {
					if (!mathBlock) { mathBlock = []; continue; }
					const tex = mathBlock.join('\n').trim();
					mathBlock = null;
					outLines.push(`<div data-math-block="${encodeURIComponent(tex)}" class="math-block"></div>`);
					continue;
				}
				if (mathBlock) { mathBlock.push(line); continue; }
				// Inline math: $...$ (skip content inside backticks)
				const processed = line.replace(/`[^`]*`/g, m => '\x00'.repeat(m.length));
				let result = line;
				let offset = 0;
				for (const m of processed.matchAll(/(?<!\$)\$(?![\s$])([^\n$]+?)(?<!\s)\$(?!\$)(?!\d)/g)) {
					const tex = m[1].trim();
					const html = `<span data-math-inline="${encodeURIComponent(tex)}" class="math-inline"></span>`;
					result = result.slice(0, m.index! + offset) + html + result.slice(m.index! + m[0].length + offset);
					offset += html.length - m[0].length;
				}
				outLines.push(result);
			}
			// If unclosed math block, just output the lines as-is
			if (mathBlock) { outLines.push('$$', ...mathBlock); }
			src = outLines.join('\n');
		}

		// Pre-process: convert task list syntax before markdown-it (it doesn't know TipTap's format)
		// Support indented (nested) and blockquoted task lists too
		src = src.replace(/^([\s>]*)-\s\[x\][^\S\n]+(.+)$/gm, '$1- <tiptask checked="true">$2</tiptask>');
		src = src.replace(/^([\s>]*)-\s\[x\][^\S\n]*$/gm, '$1- <tiptask checked="true">&nbsp;</tiptask>');
		src = src.replace(/^([\s>]*)-\s\[ \][^\S\n]+(.+)$/gm, '$1- <tiptask checked="false">$2</tiptask>');
		src = src.replace(/^([\s>]*)-\s\[ \][^\S\n]*$/gm, '$1- <tiptask checked="false">&nbsp;</tiptask>');

		// Pre-process: preserve blank lines before image-only lines
		// markdown-it collapses blank lines into paragraph breaks, losing the empty paragraph.
		// Insert a <div> marker that markdown-it passes through (html: true), then convert to <p></p>
		src = src.replace(/\n\n(!\[[^\]]*\]\([^)]*\)\s*$)/gm, '\n\n<div data-img-gap></div>\n\n$1');

		// Run markdown-it (single-pass parser - handles headings, bold, italic, strike, code, blockquote, lists, links, images, hr, tables, raw HTML)
		let html = mdit.render(src);

		// Post-process: convert blockquote alerts to callout blocks
		html = html.replace(/<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*<br\s*\/?>)?\s*([\s\S]*?)<\/blockquote>/gi, (_, type, innerContent) => {
			const typeLower = type.toLowerCase();
			return `<div data-type="callout" data-callout-type="${typeLower}" class="callout callout-${typeLower}"><p>${innerContent}</div>`;
		});

		// Post-process: convert image gap markers into empty paragraphs for ProseMirror
		html = html.replace(/<div data-img-gap><\/div>\n?/g, '<p></p>\n');

		// Post-process: strip trailing newlines inside code blocks (markdown-it adds them, TipTap shows them as blank lines)
		html = html.replace(/<code([^>]*)>\n?/g, '<code$1>');
		html = html.replace(/\n<\/code>/g, '</code>');

		// Post-process: convert list-separator comments back to empty paragraphs for TipTap
		html = html.replace(/<!-- -->/g, '<p></p>');

		// Post-process: convert task list items to TipTap format
		// Convert opening <li> + <tiptask> into data-attributed <li>, handles both tight and loose (with <p>) lists
		html = html.replace(/<li>(\s*(?:<p>)?)\s*<tiptask checked="(true|false)">([\s\S]*?)<\/tiptask>\s*(?:<\/p>)?/gi, (_, _pre, checked, text) => {
			return `<li data-type="taskItem" data-checked="${checked}">${text}`;
		});
		html = html.replace(/<ul>(\s*<li data-type="taskItem")/gi, '<ul data-type="taskList">$1');

		// Post-process: resolve image src paths and parse size attribute
		html = html.replace(/<img\s+src="([^"]*)"(?:\s+alt="([^"]*)")?[^>]*\/?>/gi, (_, imgSrc, altRaw) => {
			let alt = altRaw || '';
			let size = 'full';
			const sizeMatch = alt.match(/^(.*?)\|size=(small|medium|full)$/);
			if (sizeMatch) {
				alt = sizeMatch[1];
				size = sizeMatch[2];
			}
			return `<img src="${resolveImageSrc(imgSrc)}" alt="${alt}" data-size="${size}">`;
		});

		return html;
	}

	function escapeHtml(str: string): string {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	// When editorElement appears in DOM, initialize TipTap.
	// On mobile, pre-create editor with empty content so first note load is fast.
	$effect(() => {
		if (editorElement && !editor) {
			if (pendingContent !== null) {
				createEditor(pendingContent);
				pendingContent = null;
			} else if (isMobile) {
				createEditor('');
			}
		}
	});

	// Register the editor's forceSave function with appState
	$effect(() => {
		appState.onForceSave = forceSave;
		return () => {
			if (appState.onForceSave === forceSave) {
				appState.onForceSave = null;
			}
		};
	});

	// Close formatting dropdowns when clicking/tapping outside the formatting bar or export dropdown
	$effect(() => {
		if (!anyDropdownOpen) return;
		function onClickAway(e: Event) {
			const bar = document.querySelector('.editor-formatting-bar');
			const exp = document.querySelector('.export-dropdown-wrap');
			const more = document.querySelector('.more-dropdown-wrap');
			const targetNode = e.target as Node;
			const isInsideBar = bar && bar.contains(targetNode);
			const isInsideExp = exp && exp.contains(targetNode);
			const isInsideMore = more && more.contains(targetNode);
			if (!isInsideBar && !isInsideExp && !isInsideMore) {
				closeAllDropdowns();
			}
		}
		document.addEventListener('mousedown', onClickAway);
		document.addEventListener('touchstart', onClickAway);
		return () => {
			document.removeEventListener('mousedown', onClickAway);
			document.removeEventListener('touchstart', onClickAway);
		};
	});

	// Close in-note search when switching notes
	let prevSearchPath = '';
	$effect(() => {
		const path = $activeNotePath ?? '';
		if (prevSearchPath && path !== prevSearchPath) {
			noteSearchOpen = false;
			noteSearchQuery = '';
			noteSearchResults = [];
			noteSearchIndex = 0;
		}
		prevSearchPath = path;
	});

	// React to activeNotePath changes from external sources (e.g. search panel)
	$effect(() => {
		const path = $activeNotePath;
		const note = $activeNote;
		if (!path) {
			// Note was deselected (e.g. deleted) - destroy editor so it reinits on next note
			destroyEditor();
			loadedPath = '';
			return;
		}
		if (note && note.path === path) {
			if (path !== loadedPath) {
				// Detect if this is an atomic rename of the currently loaded note
				if (loadedPath && appState.lastRenamedPath && appState.lastRenamedPath.oldPath === loadedPath && appState.lastRenamedPath.newPath === path) {
					appState.lastRenamedPath = null; // Reset tracker
					loadedPath = path;
					return;
				}
				loadNote(path, note.content);
			}
		}
	});

	function destroyEditor() {
		flushSave();
		if (editor) {
			editor.destroy();
			editor = null;
		}
		mathObserver?.disconnect();
		mathObserver = null;
		editorReady = false;
		closeSlashMenu();
		clearResolvedAssets();
	}

	function createEditor(content: string) {
		if (!editorElement) return;
		destroyEditor();

		isLargeDoc = content.length > LARGE_DOC_CHARS;
		let html = '';
		if ($activeNotePath && $activeNotePath.endsWith('.html')) {
			if (content.includes('<html') || content.includes('<head') || content.includes('<body')) {
				html = parseHtmlMetadata(content).content;
			} else {
				html = content;
			}
		} else {
			html = markdownToHtml(content);
		}

		editor = new Editor({
			element: editorElement,
			editable: !$readOnly,
			extensions: [
				StarterKit.configure({ codeBlock: false }),
				Placeholder.configure({
					includeChildren: true,
					placeholder: ({ node, pos, editor }) => {
						if (node.type.name === 'detailsSummary') return 'Section title...';
						if (node.type.name === 'detailsContent') return 'Content...';
						if (node.type.name === 'codeBlock') return '';
						return 'Start writing...';
					},
				}),
				Table.configure({ resizable: true }),
				TableRow,
				CustomTableCell,
				CustomTableHeader,
				Link.configure({ openOnClick: false, HTMLAttributes: { class: 'editor-link' }, isAllowedUri: (url, ctx) => ctx.defaultValidate(url) || !url.startsWith('javascript:'), shouldAutoLink: (url) => /^https?:\/\//.test(url) }),
				CustomImage.configure({ inline: true, allowBase64: true, HTMLAttributes: { class: 'editor-image' } }),
				Highlight.configure({ multicolor: true }),
				Typography,
				Underline,
				Subscript,
				Superscript,
				TextStyle,
				FontFamily,
				FontSize,
				Color,
				CustomCodeBlockLowlight.configure({ lowlight, enableTabIndentation: true, defaultLanguage: 'text' }),
				MermaidRenderer,
				PdfEmbed,
				FileAttachment,
				MathBlock,
				MathInline,
				Diagram,
				PageBreak,
				Callout,
				Metrics,
				TypingKeyboardShortcuts,
				FocusModeHighlight,
				TypewriterScrolling,
				Details.configure({ persist: true, HTMLAttributes: { class: 'editor-details' } }),
				DetailsSummary,
				DetailsContent,
				Extension.create({
					name: 'collapsibleKeymap',
					addProseMirrorPlugins() {
						return [new Plugin({
							key: new PluginKey('collapsibleKeymap'),
							props: {
								handleDOMEvents: {
									keydown(view, event) {
										const isTab = event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
										const isEnter = event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
										if (!isTab && !isEnter) return false;
										const { schema, selection } = view.state;
										const from = selection.$from;
										let summaryDepth = -1;
										for (let d = from.depth; d >= 0; d--) {
											if (from.node(d).type === schema.nodes.detailsSummary) { summaryDepth = d; break; }
										}
										if (summaryDepth === -1) return false;
										event.preventDefault();
										const detailsDepth = summaryDepth - 1;
										const detailsNode = from.node(detailsDepth);
										let detailsContentPos: number | null = null;
										let pos = from.start(detailsDepth);
										for (let i = 0; i < detailsNode.childCount; i++) {
											const child = detailsNode.child(i);
											if (child.type === schema.nodes.detailsContent) { detailsContentPos = pos + 1; break; }
											pos += child.nodeSize;
										}
										if (detailsContentPos === null) return true;
										// Open the section if it is closed
										const domPos = view.domAtPos(from.pos);
										let domNode = domPos.node as HTMLElement;
										if (domNode.nodeType === 3) domNode = domNode.parentElement as HTMLElement;
										const detailsEl = domNode?.closest('[data-type="details"]') as HTMLElement | null;
										if (detailsEl) openDetailsEl(detailsEl);
										// Sync open state into document + move cursor (single transaction)
										const detailsPos = from.before(detailsDepth);
										view.dispatch(view.state.tr
											.setNodeMarkup(detailsPos, undefined, { open: true })
											.setSelection(TextSelection.create(view.state.doc, detailsContentPos))
										);
										return true;
									}
								}
							}
						})];
					}
				}),
				TextAlign.configure({ types: ['heading', 'paragraph'] }).extend({
					addKeyboardShortcuts: () => ({}),
				}),
				HeadingShortcuts,
				SlashCommands,
				MoveLineShortcuts,
				TabIndent,
				NoteSearchExtension,
				ColorSwatch,
				...($appConfig?.enable_wiki_links ? [WikiLink, WikiLinkAutocomplete] : []),
			],
			content: html,
			editorProps: {
				attributes: { class: 'editor-content', spellcheck: 'false' },
				handleDOMEvents: {
					// Prevent focus-caused scroll jumps when clicking details toggle buttons.
					// Pre-focusing with preventScroll means TipTap's focus() call sees
					// hasFocus()=true and skips its scrolling view.focus() call.
					// For task checkboxes: lock scroll on mousedown (before any dispatch fires)
					// so that any synchronous or async scroll caused by the toggle is reverted.
					mousedown: (view, event) => {
						const target = event.target as HTMLElement;
						if (target.closest('[data-type="details"] > button')) {
							event.preventDefault();
							if (!view.hasFocus()) {
								(view.dom as HTMLElement).focus({ preventScroll: true });
							}
						}
						if (target.closest('li[data-checked] > label')) {
							const editorBody = target.closest('.editor-body') as HTMLElement | null;
							if (editorBody) {
								const savedScroll = editorBody.scrollTop;
								const restore = () => { editorBody!.scrollTop = savedScroll; };
								editorBody.addEventListener('scroll', restore);
								// Remove after 200ms - covers synchronous, rAF, and setTimeout-based scrolls
								setTimeout(() => editorBody!.removeEventListener('scroll', restore), 200);
							}
						}
					},
					// Let task-list checkboxes be ticked in View Mode (read-only) without
					// entering edit mode - e.g. a shopping list on mobile, where editing would
					// pop the soft keyboard. TipTap leaves the checkbox clickable in read-only
					// but reverts the toggle on `change`; we intercept the click, cancel the
					// native toggle, and dispatch the attr change ourselves so it persists via
					// the normal onUpdate -> autoSave path. Edit mode keeps TipTap's behaviour.
					click: (view, event) => {
						const target = event.target as HTMLElement;

						// Handle clicking PDF download button in both edit and read modes
						const pdfDownloadBtn = target.closest('.pdf-download-btn') as HTMLElement | null;
						if (pdfDownloadBtn) {
							event.preventDefault();
							const downloadSrc = pdfDownloadBtn.getAttribute('data-download-src');
							if (downloadSrc) {
								downloadFile(downloadSrc);
								return true;
							}
						}

						// Handle clicking PDF link in both edit and read modes
						const pdfLinkMobile = target.closest('.pdf-link-mobile') as HTMLAnchorElement | null;
						if (pdfLinkMobile) {
							event.preventDefault();
							const href = pdfLinkMobile.getAttribute('href');
							if (href) {
								downloadFile(href);
								return true;
							}
						}

						const link = target.closest('a');
						if (link && get(readOnly)) {
							const href = link.getAttribute('href');
							if (href) {
								event.preventDefault();
								if (href.startsWith('http://') || href.startsWith('https://')) {
									openUrl(href);
									return true;
								} else if (isFileLink(href)) {
									downloadFile(href);
									return true;
								} else {
									const notePath = resolveNoteHref(href);
									if (notePath) {
										navigateToWikiLink(notePath, '');
										return true;
									}
								}
							}
						}

						if (!get(readOnly)) return false;
						if (get(viewerNote)) return false; // external viewer files are never saved
						const label = target.closest('li[data-checked] > label');
						if (!label) return false;
						// Cancel the native checkbox toggle (and the label->input click cascade)
						// so it doesn't fight our transaction; the node-view update will set the
						// visual state from the new doc value.
						event.preventDefault();
						const li = label.closest('li') as HTMLElement | null;
						if (!li) return false;
						// Probe position from the content <div> (the real contentDOM), not the <li>
						// outer node-view element, so posAtDOM lands inside the task item's content.
						const probe = (li.querySelector(':scope > div') as HTMLElement | null) || li;
						const pos = view.posAtDOM(probe, 0);
						const resolved = view.state.doc.resolve(pos);
						let itemPos = -1;
						let attrs: Record<string, any> | null = null;
						for (let d = resolved.depth; d >= 0; d--) {
							if (resolved.node(d).type.name === 'taskItem') {
								itemPos = resolved.before(d);
								attrs = resolved.node(d).attrs;
								break;
							}
						}
						if (itemPos < 0) {
							// Fallback: pos landed just before the item rather than inside it.
							const n = view.state.doc.nodeAt(pos);
							if (n && n.type.name === 'taskItem') { itemPos = pos; attrs = n.attrs; }
						}
						if (itemPos < 0 || !attrs) return false;
						view.dispatch(view.state.tr.setNodeMarkup(itemPos, undefined, { ...attrs, checked: !attrs.checked }));
						return true;
					},
					// Prevent native text drag - it causes copy-instead-of-move in Tauri's webview.
					// File drops from OS are handled by Tauri's onDragDropEvent listener instead.
					dragstart: (_view, event) => {
						const dt = event.dataTransfer;
						if (!dt || dt.files.length === 0) {
							event.preventDefault();
						}
					},
				},
				handleDrop: (_view, event) => handleFileDrop(event),
				handlePaste: (_view, event) => {
					const handled = handleFilePaste(event);
					if (!handled) hasPendingBlobs = true; // ProseMirror may insert blob: images from web paste
					return handled;
				},
				// Strip color / font styling from pasted HTML so the editor uses its own theme.
				// Keeps semantic marks (bold, italic, links, headings, alignment) - drops only the
				// inline visual styles that fight the app's theme (color, bg-color, font-family, font-size).
				transformPastedHTML: (html: string) => {
					if (!/style=|<font/i.test(html)) return html;
					try {
						const doc = new DOMParser().parseFromString(html, 'text/html');
						doc.querySelectorAll('[style]').forEach((el) => {
							const style = (el as HTMLElement).style;
							style.color = '';
							style.backgroundColor = '';
							style.fontFamily = '';
							style.fontSize = '';
							if (!style.cssText.trim()) el.removeAttribute('style');
						});
						doc.querySelectorAll('font').forEach((el) => {
							el.removeAttribute('color');
							el.removeAttribute('face');
							el.removeAttribute('size');
						});
						return doc.body.innerHTML;
					} catch (e) {
						console.warn('[paste] style strip failed', e);
						return html;
					}
				},
			},
			onTransaction: () => {
				// Batch toolbar state updates to once per frame - avoids ~35 isActive() calls per transaction during selection drag
				if (!editorStateRaf) {
					editorStateRaf = requestAnimationFrame(() => {
						editorStateRaf = 0;
						editorState++;
					});
				}
				// On mobile, only check menus when they're already open or user just typed trigger char
				if (!isMobile || slashMenu || slashTypedByUser) updateSlashMenu();
				if (!isMobile || wikiLinkMenu || wikiLinkTypedByUser) updateWikiLinkMenu();
				updateBubbleMenu();
			},
			onBlur: () => {
				bubbleMenuCoords = null;
			},
			onUpdate: () => {
				if (ignoreNextUpdate || isLoadingNote) {
					ignoreNextUpdate = false;
					return;
				}
				$editorDirty = true;
				autoSave();
				if (!isMobile && showOutline) updateOutline();
			},
		});
		editorReady = true;
		resolveLocalAssets();
		// Pre-load note titles for wiki-link autocomplete
		if ($appConfig?.enable_wiki_links) {
			refreshWikiLinkTitles();
		}
	}

	export function toggleOutlinePanel() {
		showOutline = !showOutline;
		if (showOutline) updateOutline();
	}

	export function toggleHistoryPanel() {
		toggleHistory();
	}

	export function triggerAiMenu() {
		openAiMenu();
	}

	export function toggleGraphView() {
		showGraph = !showGraph;
	}

	export function addLinkFromToolbar() {
		if (!editor) return;
		const { from, to } = editor.state.selection;
		linkSelectionFrom = from;
		linkSelectionTo = to;
		const previousUrl = editor?.getAttributes('link').href || '';
		linkModalUrl = decodeURIComponent(previousUrl);
		linkSuggestIndex = 0;
		linkModal = true;
		// Load note titles for autocomplete
		getAllNoteTitles().then(t => { linkSuggestTitles = t; }).catch(() => {});
		tick().then(() => linkModalInput?.focus());
	}

	function linkModalConfirm() {
		if (!editor) return;
		let url = linkModalUrl.trim();
		if (url === '') {
			editor.chain().focus().setTextSelection({ from: linkSelectionFrom, to: linkSelectionTo }).extendMarkRange('link').unsetLink().run();
		} else {
			if (url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) && !url.startsWith('/') && !url.startsWith('#') && !url.endsWith('.md')) {
				url = 'https://' + url;
			}
			// Store raw URL - encoding is handled during markdown serialization/parsing
			const href = url.replace(/[()]/g, (c) => encodeURIComponent(c));
			if (linkSelectionFrom === linkSelectionTo) {
				const text = linkModalDisplayText || url.replace(/\.md$/, '').split('/').pop() || url;
				editor.chain().focus().setTextSelection(linkSelectionFrom).insertContent({
					type: 'text',
					text,
					marks: [{ type: 'link', attrs: { href } }],
				}).run();
			} else {
				editor.chain().focus().setTextSelection({ from: linkSelectionFrom, to: linkSelectionTo }).setMark('link', { href }).run();
			}
		}
		linkModal = false;
		linkModalUrl = '';
		linkModalDisplayText = '';
	}

	function linkModalSelectNote(entry: NoteTitleEntry) {
		// Build a relative .md path from the selected note and confirm immediately
		const vaultRoot = $appConfig?.active_vault;
		const currentNote = $activeNotePath;
		if (vaultRoot && currentNote) {
			const noteDir = currentNote.substring(0, currentNote.lastIndexOf('/'));
			const targetRel = entry.path.startsWith(vaultRoot) ? entry.path.substring(vaultRoot.length + 1) : entry.path;
			const currentRel = noteDir.startsWith(vaultRoot) ? noteDir.substring(vaultRoot.length + 1) : noteDir;
			const targetParts = targetRel.split('/');
			const currentParts = currentRel ? currentRel.split('/') : [];
			let common = 0;
			while (common < targetParts.length && common < currentParts.length && targetParts[common] === currentParts[common]) common++;
			const ups = currentParts.length - common;
			linkModalUrl = (ups > 0 ? '../'.repeat(ups) : './') + targetParts.slice(common).join('/');
		} else {
			linkModalUrl = entry.title + '.md';
		}
		linkModalDisplayText = entry.title;
		linkModalConfirm();
	}

	function linkModalCancel() {
		linkModal = false;
		linkModalUrl = '';
		linkModalDisplayText = '';
		editor?.chain().focus().run();
	}

	function insertTable(rows: number, cols: number) {
		if (!editor) return;
		editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
		tablePickerOpen = false;
		tablePickerHover = { rows: 0, cols: 0 };
	}

	function setTextColor(color: string) {
		if (!editor) return;
		if (color === '') {
			editor.chain().focus().unsetColor().run();
		} else {
			editor.chain().focus().setColor(color).run();
		}
		setTimeout(() => { colorDropdown = false; }, 20);
	}

	function setHighlightColor(color: string) {
		if (!editor) return;
		if (color === '') {
			editor.chain().focus().unsetHighlight().run();
		} else {
			editor.chain().focus().setHighlight({ color }).run();
		}
		setTimeout(() => { highlightDropdown = false; }, 20);
	}

	function handleEditorClick(event: MouseEvent) {
		const target = event.target as HTMLElement;

		const wikiLinkEl = target.closest('span[data-wiki-link]') as HTMLElement | null;
		if (wikiLinkEl) {
			imageToolbar = null;
			diagramToolbar = null;
			event.preventDefault();
			event.stopPropagation();
			const path = wikiLinkEl.getAttribute('data-path') || '';
			const title = wikiLinkEl.getAttribute('data-title') || wikiLinkEl.textContent || '';
			navigateToWikiLink(path, title, event);
			return;
		}

		if (target.tagName === 'IMG' && editor) {
			if (appState.isReadOnly) return;
			diagramToolbar = null;
			event.preventDefault();
			event.stopPropagation();
			const pos = editor.view.posAtDOM(target, 0);
			// If toolbar is already open for this image, close it
			if (imageToolbar && imageToolbar.pos === pos) {
				imageToolbar = null;
				return;
			}
			const node = editor.state.doc.nodeAt(pos);
			const currentSize = node?.attrs.size || 'full';
			const imgSrc = node?.attrs.src || (target as HTMLImageElement).src || '';
			
			const rect = target.getBoundingClientRect();
			const toolbarW = isMobile ? 320 : 250;
			const toolbarH = 38;
			
			let x = rect.left + (rect.width - toolbarW) / 2;
			x = Math.max(8, Math.min(x, window.innerWidth - toolbarW - 8));
			
			let y = rect.bottom + 8;
			if (y + toolbarH > window.innerHeight) {
				y = rect.top - toolbarH - 8;
			}
			y = Math.max(8, Math.min(y, window.innerHeight - toolbarH - 8));

			imageToolbar = { pos, x, y, size: currentSize, src: imgSrc };
			
			const afterPos = pos + (node?.nodeSize || 1);
			editor.chain().setTextSelection(afterPos).run();
			return;
		}

		const diagramEl = target.closest('.diagram-block') as HTMLElement | null;
		if (diagramEl && editor) {
			if (appState.isReadOnly) return;
			if (target.closest('button') || target.closest('.mermaid-render-toolbar')) {
				return;
			}
			imageToolbar = null;
			event.preventDefault();
			event.stopPropagation();
			const pos = editor.view.posAtDOM(diagramEl, 0);
			if (diagramToolbar && diagramToolbar.pos === pos) {
				diagramToolbar = null;
				return;
			}
			const node = editor.state.doc.nodeAt(pos);
			const currentSize = node?.attrs.size || 'medium';
			const currentAlign = node?.attrs.align || 'center';
			
			const rect = diagramEl.getBoundingClientRect();
			const toolbarW = isMobile ? 320 : 280;
			const toolbarH = 38;
			
			let x = rect.left + (rect.width - toolbarW) / 2;
			x = Math.max(8, Math.min(x, window.innerWidth - toolbarW - 8));
			
			let y = rect.bottom + 8;
			if (y + toolbarH > window.innerHeight) {
				y = rect.top - toolbarH - 8;
			}
			y = Math.max(8, Math.min(y, window.innerHeight - toolbarH - 8));

			diagramToolbar = { pos, x, y, size: currentSize, align: currentAlign };
			if (!isMobile) {
				const afterPos = pos + (node?.nodeSize || 1);
				editor.chain().setTextSelection(afterPos).run();
			}
			return;
		}

		imageToolbar = null;
		diagramToolbar = null;
	}

	function setImageSize(size: string) {
		if (!editor || !imageToolbar) return;
		const { pos } = imageToolbar;
		const tr = editor.state.tr.setNodeAttribute(pos, 'size', size);
		editor.view.dispatch(tr);
		imageToolbar = { ...imageToolbar, size };
		$editorDirty = true;
		autoSave();
	}

	function setDiagramSize(size: string) {
		if (!editor || !diagramToolbar) return;
		const { pos } = diagramToolbar;
		const tr = editor.state.tr.setNodeAttribute(pos, 'size', size);
		editor.view.dispatch(tr);
		diagramToolbar = { ...diagramToolbar, size };
		$editorDirty = true;
		autoSave();
	}

	function setDiagramAlign(align: string) {
		if (!editor || !diagramToolbar) return;
		const { pos } = diagramToolbar;
		const tr = editor.state.tr.setNodeAttribute(pos, 'align', align);
		editor.view.dispatch(tr);
		diagramToolbar = { ...diagramToolbar, align };
		$editorDirty = true;
		autoSave();
	}

	function getImageAbsPath(src: string): string {
		// asset:// or http://asset.localhost → extract absolute path
		if (src.startsWith('asset:') || src.startsWith('http://asset.localhost')) {
			try {
				const url = new URL(src);
				let absPath = decodeURIComponent(url.pathname);
				absPath = absPath.replace(/^\/{2,}/, '/');
				return absPath;
			} catch { /* fall through */ }
		}
		// Relative path → resolve against note directory
		let decoded = decodeURIComponent(src);
		if (decoded.match(/^\/{2,}/)) decoded = decoded.replace(/^\/{2,}/, '/');
		if (decoded.startsWith('/')) return decoded;
		if (decoded.includes('.helixnotes/')) {
			const vaultRoot = $appConfig?.active_vault;
			if (vaultRoot) {
				const idx = decoded.indexOf('.helixnotes/');
				return `${vaultRoot}/${decoded.substring(idx)}`;
			}
		}
		const notePath = $activeNotePath;
		if (notePath) {
			const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
			return normalizePath(`${noteDir}/${decoded}`);
		}
		const vaultRoot = $appConfig?.active_vault;
		if (vaultRoot) return normalizePath(`${vaultRoot}/${decoded}`);
		return src;
	}

	async function copyImageToClipboard() {
		if (!imageToolbar) return;
		const absPath = getImageAbsPath(imageToolbar.src);
		imageToolbar = null;
		copyToast = 'copying';
		// Yield to let Svelte render the "Copying..." toast before blocking on IPC
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		try {
			await copyImageToClipboardCmd(absPath);
			copyToast = 'done';
		} catch (e) {
			console.error('Failed to copy image:', e);
			copyToast = null;
			return;
		}
		setTimeout(() => { copyToast = null; }, 1000);
	}

	function openImageInApp() {
		if (!imageToolbar) return;
		const absPath = getImageAbsPath(imageToolbar.src);
		openFile(absPath).catch(e => console.error('Failed to open image:', e));
		imageToolbar = null;
	}

	function handleEditorContextMenu(event: MouseEvent) {
		const target = event.target as HTMLElement;
		const anchor = target.closest('a');
		if (anchor) {
			const href = anchor.getAttribute('href');
			if (href) {
				event.preventDefault();
				event.stopPropagation();
				let lx = event.clientX;
				let ly = event.clientY;
				const lw = 200, lh = 200;
				if (lx + lw > window.innerWidth) lx = window.innerWidth - lw - 8;
				if (ly + lh > window.innerHeight) ly = window.innerHeight - lh - 8;
				if (lx < 4) lx = 4;
				if (ly < 4) ly = 4;
				linkContextMenu = { x: lx, y: ly, href, anchor };
				return;
			}
		}
		// Check if inside a table cell
		const cell = target.closest('td, th');
		if (cell) {
			event.preventDefault();
			event.stopPropagation();
			let x = event.clientX;
			let y = event.clientY;
			const menuWidth = 220;
			const menuHeight = 520;
			if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
			if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
			if (x < 4) x = 4;
			if (y < 4) y = 4;
			tableContextMenu = { x, y };
			return;
		}
		// Show text context menu for any right-click in editor
		event.preventDefault();
		event.stopPropagation();
		// Position menu, adjusting if it would overflow the viewport
		let x = event.clientX;
		let y = event.clientY;
		const menuWidth = 220;
		const menuHeight = 740;
		if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
		if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
		if (x < 4) x = 4;
		if (y < 4) y = 4;
		textContextMenu = { x, y };
	}

	function closeTextContextMenu() {
		textContextMenu = null;
		ctxHeadingSubmenu = false;
	}

	function closeTableContextMenu() {
		tableContextMenu = null;
	}

	function tblAddRowBefore() { editor?.chain().focus().addRowBefore().run(); closeTableContextMenu(); }
	function tblAddRowAfter() { editor?.chain().focus().addRowAfter().run(); closeTableContextMenu(); }
	function tblDeleteRow() { editor?.chain().focus().deleteRow().run(); closeTableContextMenu(); }
	function tblAddColBefore() { editor?.chain().focus().addColumnBefore().run(); closeTableContextMenu(); }
	function tblAddColAfter() { editor?.chain().focus().addColumnAfter().run(); closeTableContextMenu(); }
	function tblDeleteCol() { editor?.chain().focus().deleteColumn().run(); closeTableContextMenu(); }
	function tblMergeCells() { editor?.chain().focus().mergeCells().run(); closeTableContextMenu(); }
	function tblSplitCell() { editor?.chain().focus().splitCell().run(); closeTableContextMenu(); }
	function tblToggleHeaderRow() { editor?.chain().focus().toggleHeaderRow().run(); closeTableContextMenu(); }
	function tblToggleHeaderCol() { editor?.chain().focus().toggleHeaderColumn().run(); closeTableContextMenu(); }
	function tblDeleteTable() { editor?.chain().focus().deleteTable().run(); closeTableContextMenu(); }
	function tblSetCellColor(color: string) {
		if (!editor) return;
		if (color === '') {
			editor.chain().focus().setCellAttribute('backgroundColor', null).run();
		} else {
			editor.chain().focus().setCellAttribute('backgroundColor', color).run();
		}
		closeTableContextMenu();
	}

	async function ctxCut() {
		if (!editor) return;
		const { from, to } = editor.state.selection;
		if (from === to) { closeTextContextMenu(); return; }
		const text = editor.state.doc.textBetween(from, to, '\n');
		await navigator.clipboard.writeText(text);
		editor.chain().focus().deleteSelection().run();
		closeTextContextMenu();
	}

	async function ctxCopy() {
		if (!editor) return;
		const { from, to } = editor.state.selection;
		if (from === to) { closeTextContextMenu(); return; }
		const text = editor.state.doc.textBetween(from, to, '\n');
		await navigator.clipboard.writeText(text);
		closeTextContextMenu();
	}

	async function ctxPaste() {
		if (!editor) return;
		try {
			const text = await navigator.clipboard.readText();
			if (text) editor.chain().focus().insertContent(text).run();
		} catch (e) {
			console.error('Paste failed:', e);
		}
		closeTextContextMenu();
	}

	function ctxSelectAll() {
		if (!editor) return;
		editor.chain().focus().selectAll().run();
		closeTextContextMenu();
	}

	let ctxHeadingSubmenu = $state(false);

	function ctxSetHeading(level: number) {
		editor?.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 }).run();
		closeTextContextMenu();
	}

	function ctxSetParagraph() {
		editor?.chain().focus().setParagraph().run();
		closeTextContextMenu();
	}

	function ctxBold() {
		editor?.chain().focus().toggleBold().run();
		closeTextContextMenu();
	}

	function ctxItalic() {
		editor?.chain().focus().toggleItalic().run();
		closeTextContextMenu();
	}

	function ctxUnderline() {
		editor?.chain().focus().toggleUnderline().run();
		closeTextContextMenu();
	}

	function ctxStrike() {
		editor?.chain().focus().toggleStrike().run();
		closeTextContextMenu();
	}

	function ctxLink() {
		closeTextContextMenu();
		addLinkFromToolbar();
	}

	function ctxHighlight() {
		editor?.chain().focus().toggleHighlight({ color: highlightColors[0].value }).run();
		closeTextContextMenu();
	}

	function ctxCode() {
		editor?.chain().focus().toggleCode().run();
		closeTextContextMenu();
	}

	function ctxCodeBlock() {
		editor?.chain().focus().toggleCodeBlock().run();
		closeTextContextMenu();
	}

	function ctxBlockquote() {
		editor?.chain().focus().toggleBlockquote().run();
		closeTextContextMenu();
	}

	function ctxTimestamp() {
		insertTimestamp('datetime');
		closeTextContextMenu();
	}

	function openDetailsEl(el: HTMLElement) {
		if (!el.classList.contains('is-open')) {
			el.classList.add('is-open');
			(el.querySelector('[data-type="detailsContent"]') as HTMLElement | null)
				?.dispatchEvent(new Event('toggleDetailsContent'));
		}
	}

	function insertDetails() {
		if (!editor) return;
		editor.chain().focus().setDetails().run();
		requestAnimationFrame(() => {
			if (!editor) return;
			const domPos = editor.view.domAtPos(editor.state.selection.from);
			let node = domPos.node as HTMLElement;
			if (node.nodeType === 3) node = node.parentElement as HTMLElement;
			const detailsEl = node.closest('[data-type="details"]') as HTMLElement | null;
			if (detailsEl) openDetailsEl(detailsEl);
			// Sync open: true into the document so it saves with the note
			editor.chain().updateAttributes('details', { open: true }).run();
		});
	}

	function ctxDetails() {
		insertDetails();
		closeTextContextMenu();
	}

	function ctxBulletList() {
		editor?.chain().focus().toggleBulletList().run();
		closeTextContextMenu();
	}

	function ctxOrderedList() {
		editor?.chain().focus().toggleOrderedList().run();
		closeTextContextMenu();
	}


	// ── AI Actions ──

	function openAiMenu() {
		if (!editor) return;
		closeTextContextMenu();
		editor.commands.focus();

		const { from, to } = editor.state.selection;
		const hasSelection = from !== to;

		if (hasSelection) {
			const selectedText = editor.state.doc.textBetween(from, to, '\n');
			if (!selectedText.trim()) return;
			aiSelectionFrom = from;
			aiSelectionTo = to;
			aiSelectedText = selectedText;
			aiWholeNote = false;
		} else {
			const fullMarkdown = editorToMarkdown();
			if (!fullMarkdown.trim()) {
				aiEmptyNote = true;
				aiWholeNote = true;
				aiSelectedText = '';
				aiSelectionFrom = 0;
				aiSelectionTo = 0;
			} else {
				aiEmptyNote = false;
				aiSelectionFrom = 0;
				aiSelectionTo = editor.state.doc.content.size;
				aiOriginalMarkdown = fullMarkdown;

				// Replace images, PDF embeds, and HTML tags with placeholders so AI doesn't mangle them
				const placeholders = new Map<string, string>();
				let idx = 0;
				let textForAi = fullMarkdown;
				// Images: ![alt](src)
				textForAi = textForAi.replace(/!\[[^\]]*\]\([^)]*\)/g, (match) => {
					const key = `__MEDIA_${idx++}__`;
					placeholders.set(key, match);
					return key;
				});
				// PDF embeds
				textForAi = textForAi.replace(/<div[^>]*class="pdf-embed"[^>]*>[\s\S]*?<\/div>/gi, (match) => {
					const key = `__MEDIA_${idx++}__`;
					placeholders.set(key, match);
					return key;
				});
				// Inline HTML img tags
				textForAi = textForAi.replace(/<img[^>]*\/?>/gi, (match) => {
					const key = `__MEDIA_${idx++}__`;
					placeholders.set(key, match);
					return key;
				});
				aiMediaPlaceholders = placeholders;
				aiSelectedText = textForAi.trim();
				if (!aiSelectedText) return;
				aiWholeNote = true;
			}
		}

		aiResult = null;
		aiError = null;
		aiLoading = false;
		aiShowCustom = false;
		aiTranslateMenu = false;
		aiCustomPrompt = '';

		if (isMobile) {
			// Mobile: bottom sheet, no positioning needed
			aiMenu = { x: 0, y: 0 };
		} else if (hasSelection) {
			const coords = editor.view.coordsAtPos(from);
			let x = coords.left;
			let y = coords.top - 8;
			const menuWidth = 220;
			const menuHeight = 400;
			if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
			if (y - menuHeight < 0) y = coords.bottom + 8;
			else y = y - menuHeight;
			if (y < 4) y = 4;
			aiMenu = { x, y };
		} else {
			// Center the menu in the editor area
			const editorRect = editorElement?.getBoundingClientRect();
			const menuWidth = 220;
			const menuHeight = 400;
			let x = editorRect ? editorRect.left + (editorRect.width - menuWidth) / 2 : window.innerWidth / 2 - menuWidth / 2;
			let y = editorRect ? editorRect.top + 60 : 100;
			if (x < 4) x = 4;
			if (y < 4) y = 4;
			aiMenu = { x, y };
		}
	}

	function closeAiMenu() {
		if (aiStreamUnlisten) { aiStreamUnlisten(); aiStreamUnlisten = null; }
		aiMenu = null;
		aiLoading = false;
		aiResult = null;
		aiError = null;
		aiShowCustom = false;
		aiTranslateMenu = false;
		aiWholeNote = false;
		aiEmptyNote = false;
		aiOriginalMarkdown = '';
		aiMediaPlaceholders = new Map();
	}

	async function runAiAction(action: string, customPrompt?: string) {
		if (!editor) return;
		if (!aiEmptyNote && !aiSelectedText.trim()) return;
		// For empty notes, force action to 'custom' with a generate instruction
		if (aiEmptyNote) {
			action = 'custom';
			customPrompt = `Generate a note based on this prompt. Start your response with a title on the first line (no # prefix), then a blank line, then the content in markdown. Prompt: ${customPrompt || aiCustomPrompt}`;
			aiSelectedText = '(empty note)';
		}
		aiLoading = true;
		aiResult = '';
		aiError = null;
		aiShowCustom = false;
		aiTranslateMenu = false;

		// Cancel any previous stream listener
		if (aiStreamUnlisten) { aiStreamUnlisten(); aiStreamUnlisten = null; }

		const requestId = crypto.randomUUID();
		const unlisten = await listen<AiStreamEvent>('ai-stream', (event) => {
			const data = event.payload;
			if (data.event_type === 'text' && data.text) {
				aiResult = (aiResult ?? '') + data.text;
			} else if (data.event_type === 'done') {
				aiLoading = false;
				aiStreamUnlisten = null;
				unlisten();
			} else if (data.event_type === 'error') {
				aiError = data.error ?? 'Unknown error';
				aiLoading = false;
				aiStreamUnlisten = null;
				unlisten();
			}
		});
		aiStreamUnlisten = unlisten;

		try {
			await aiAsk(action, aiSelectedText, customPrompt ?? null, requestId);
		} catch (e) {
			aiError = String(e);
			aiLoading = false;
			unlisten();
			aiStreamUnlisten = null;
		}
	}

	async function aiApplyResult() {
		if (!editor || !aiResult) return;
		// Save a version snapshot before applying AI changes
		if ($activeNotePath && $activeNote && !aiEmptyNote) {
			try {
				await forceSave();
				await createVersion($activeNotePath, $activeNote.meta.id);
			} catch (e) {
				console.error('Failed to create version before AI apply:', e);
			}
		}
		if (aiEmptyNote) {
			// Parse title from first line, rest is content
			const lines = aiResult.split('\n');
			let title = lines[0]?.replace(/^#+\s*/, '').trim() || 'Untitled';
			const body = lines.slice(1).join('\n').replace(/^\n+/, '');
			if ($activeNote) {
				$activeNote.meta.title = title;
			}
			editor.commands.setContent(markdownToHtml(body));
		} else if (aiWholeNote) {
			// Restore media placeholders back to original markdown
			let finalMarkdown = aiResult;
			for (const [key, original] of aiMediaPlaceholders) {
				finalMarkdown = finalMarkdown.replace(key, original);
			}
			// Replace entire document - convert markdown back to HTML for TipTap
			editor.commands.setContent(markdownToHtml(finalMarkdown));
		} else {
			// Replace the selected range with the AI result (convert markdown → HTML so TipTap renders it properly)
			const html = markdownToHtml(aiResult);
			editor.chain().focus()
				.setTextSelection({ from: aiSelectionFrom, to: aiSelectionTo })
				.deleteSelection()
				.insertContent(html)
				.run();
		}
		$editorDirty = true;
		autoSave();
		closeAiMenu();
	}

	function aiDiscard() {
		closeAiMenu();
		editor?.commands.focus();
	}

	function closeLinkContextMenu() {
		linkContextMenu = null;
	}

	/** Resolve a link href to an absolute .md note path, or null if not a note link. */
	function resolveNoteHref(href: string): string | null {
		const decoded = decodeURIComponent(href);
		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return null;
		let absPath = decoded;
		if (!decoded.startsWith('/')) {
			const notePath = $activeNotePath;
			if (notePath) {
				const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
				absPath = normalizePath(`${noteDir}/${decoded}`);
			} else {
				const vaultRoot = $appConfig?.active_vault;
				if (vaultRoot) absPath = normalizePath(`${vaultRoot}/${decoded}`);
			}
		}
		return absPath.endsWith('.md') ? absPath : null;
	}

	function linkMenuOpen() {
		if (!linkContextMenu) return;
		const href = linkContextMenu.href;
		closeLinkContextMenu();
		// Internal .md note link - navigate within the app
		const notePath = resolveNoteHref(href);
		if (notePath) {
			navigateToWikiLink(notePath, '');
			return;
		}
		if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
			openUrl(href).catch(console.error);
		} else {
			openFile(resolveHrefToAbsPath(href)).catch(console.error);
		}
	}

	function linkMenuCopy() {
		if (!linkContextMenu) return;
		navigator.clipboard.writeText(linkContextMenu.href).catch(console.error);
		closeLinkContextMenu();
	}

	function linkMenuEdit() {
		if (!linkContextMenu || !editor) return;
		const anchor = linkContextMenu.anchor;
		const href = linkContextMenu.href;
		closeLinkContextMenu();
		// Select the link text so the modal edits the right link
		const pos = editor.view.posAtDOM(anchor, 0);
		if (pos >= 0) {
			editor.chain().focus().setTextSelection(pos).extendMarkRange('link').run();
		}
		const { from, to } = editor.state.selection;
		linkSelectionFrom = from;
		linkSelectionTo = to;
		linkModalUrl = decodeURIComponent(href);
		linkModalDisplayText = '';
		linkModal = true;
		getAllNoteTitles().then(t => { linkSuggestTitles = t; }).catch(() => {});
		tick().then(() => linkModalInput?.focus());
	}

	function linkMenuRemove() {
		if (!linkContextMenu || !editor) return;
		const anchor = linkContextMenu.anchor;
		const pos = editor.view.posAtDOM(anchor, 0);
		if (pos >= 0) {
			editor.chain()
				.focus()
				.setTextSelection(pos)
				.extendMarkRange('link')
				.unsetLink()
				.run();
			$editorDirty = true;
			autoSave();
		}
		closeLinkContextMenu();
	}

	function resolveHrefToAbsPath(href: string): string {
		const decoded = decodeURIComponent(href);
		if (decoded.startsWith('/')) return decoded;
		// .helixnotes/ paths are always relative to vault root, not the note's directory
		const vaultRoot = $appConfig?.active_vault;
		if (decoded.startsWith('.helixnotes/') && vaultRoot) {
			return normalizePath(`${vaultRoot}/${decoded}`);
		}
		const notePath = $activeNotePath;
		if (notePath) {
			const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
			return normalizePath(`${noteDir}/${decoded}`);
		}
		if (vaultRoot) return normalizePath(`${vaultRoot}/${decoded}`);
		return decoded;
	}

	function isFileLink(href: string): boolean {
		if (!href) return false;
		if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:') || href.startsWith('#')) return false;
		const ext = href.split('.').pop()?.toLowerCase() ?? '';
		if (ext === 'md' || ext === 'html') return false;
		return href.includes('.') && ext !== '';
	}

	async function downloadFile(href: string) {
		const absPath = resolveHrefToAbsPath(href);
		const filename = absPath.split('/').pop() || 'file';
		try {
			const blob = await appState.readBlob(absPath);
			if (blob) {
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = filename;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
				appState.showToast(`Downloaded ${filename} successfully.`, 'success');
			} else {
				// Fallback if the path is a valid URL or data URL
				if (href.startsWith('http') || href.startsWith('blob:') || href.startsWith('data:')) {
					const a = document.createElement('a');
					a.href = href;
					a.download = filename;
					document.body.appendChild(a);
					a.click();
					document.body.removeChild(a);
				} else {
					appState.showToast(`File not found or local storage access denied.`, 'error');
				}
			}
		} catch (e) {
			console.error('Failed to download file:', e);
			appState.showToast(`Failed to download ${filename}.`, 'error');
		}
	}

	async function linkMenuSaveAs() {
		if (!linkContextMenu) return;
		const href = linkContextMenu.href;
		closeLinkContextMenu();
		await downloadFile(href);
	}

	function handleFileDrop(event: DragEvent): boolean {
		const files = event.dataTransfer?.files;
		if (!files || files.length === 0) return false;
		event.preventDefault();
		for (const file of Array.from(files)) {
			if (file.type.startsWith('image/')) {
				insertImage(file);
			} else if (file.type === 'application/pdf') {
				insertPdf(file);
			} else {
				insertFileAttachment(file);
			}
		}
		return true;
	}

	function handleFilePaste(event: ClipboardEvent): boolean {
		const items = event.clipboardData?.items;
		if (!items) return false;
		for (const item of Array.from(items)) {
			const file = item.getAsFile();
			if (!file) continue;
			event.preventDefault();
			if (item.type.startsWith('image/')) {
				insertImage(file);
			} else if (file.type === 'application/pdf') {
				insertPdf(file);
			} else {
				insertFileAttachment(file);
			}
			return true;
		}
		// WebKitGTK fallback (bug #218519): older WebKitGTK versions return
		// empty DataTransferItemList for image pastes. Detect this and read
		// the image directly from the system clipboard via Rust/arboard.
		if (items.length === 0) {
			const hasText = event.clipboardData!.getData('text/plain');
			const hasHtml = event.clipboardData!.getData('text/html');
			if (!hasText && !hasHtml) {
				event.preventDefault();
				insertClipboardImage();
				return true;
			}
		}
		return false;
	}

	async function insertClipboardImage() {
		try {
			const data = await readClipboardImage();
			const relativePath = await saveImage('pasted-image.png', data);
			if (editor) {
				const displaySrc = resolveImageSrc(relativePath);
				editor.chain().focus().setImage({ src: displaySrc }).run();
			}
		} catch (e) {
			console.error('Clipboard image fallback failed:', e);
		}
	}

	async function compressImage(file: File | Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				const img = new window.Image();
				img.onload = () => {
					if (file.size < 300 * 1024) {
						resolve(e.target?.result as string);
						return;
					}
					const canvas = document.createElement('canvas');
					let width = img.width;
					let height = img.height;
					const MAX_WIDTH = 1200;
					const MAX_HEIGHT = 1200;

					if (width > height) {
						if (width > MAX_WIDTH) {
							height *= MAX_WIDTH / width;
							width = MAX_WIDTH;
						}
					} else {
						if (height > MAX_HEIGHT) {
							width *= MAX_HEIGHT / height;
							height = MAX_HEIGHT;
						}
					}

					canvas.width = width;
					canvas.height = height;
					const ctx = canvas.getContext('2d');
					if (!ctx) {
						resolve(e.target?.result as string);
						return;
					}
					ctx.drawImage(img, 0, 0, width, height);
					const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
					resolve(compressedBase64);
				};
				img.onerror = () => {
					resolve(e.target?.result as string);
				};
				img.src = e.target?.result as string;
			};
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	async function insertImage(file: File) {
		try {
			const base64 = await compressImage(file);
			if (editor) {
				editor.chain().focus().setImage({ src: base64 }).run();
			}
		} catch (e) {
			console.error('Failed to insert image:', e);
		}
	}

	function getMimeType(filename: string): string {
		const ext = filename.split('.').pop()?.toLowerCase() || '';
		const mimes: Record<string, string> = {
			pdf: 'application/pdf',
			txt: 'text/plain',
			md: 'text/markdown',
			html: 'text/html',
			json: 'application/json',
			js: 'application/javascript',
			ts: 'application/typescript',
			css: 'text/css',
			csv: 'text/csv',
			mp3: 'audio/mpeg',
			wav: 'audio/wav',
			ogg: 'audio/ogg',
			m4a: 'audio/mp4',
			mp4: 'video/mp4',
			webm: 'video/webm',
			mov: 'video/quicktime',
			zip: 'application/zip',
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif'
		};
		return mimes[ext] || 'application/octet-stream';
	}

	async function insertPdf(file: File) {
		await insertFileAttachment(file);
	}

	async function saveBlobImage(blobUrl: string): Promise<string | null> {
		try {
			const resp = await fetch(blobUrl);
			const blob = await resp.blob();
			return await compressImage(blob);
		} catch (e) {
			console.error('Failed to convert blob image to base64:', e);
			return null;
		}
	}

	async function fixBlobImages() {
		if (!editor) return;
		const { doc, tr } = editor.state;
		let changed = false;
		const promises: Array<{ pos: number; blobUrl: string }> = [];
		doc.descendants((node, pos) => {
			if (node.type.name === 'image' && node.attrs.src?.startsWith('blob:')) {
				promises.push({ pos, blobUrl: node.attrs.src });
			}
		});
		for (const { pos, blobUrl } of promises) {
			const savedSrc = await saveBlobImage(blobUrl);
			if (savedSrc && editor) {
				const currentTr = editor.state.tr;
				// Re-find the node since positions may have shifted
				let found = false;
				editor.state.doc.descendants((node, nodePos) => {
					if (!found && node.type.name === 'image' && node.attrs.src === blobUrl) {
						currentTr.setNodeAttribute(nodePos, 'src', savedSrc);
						found = true;
						changed = true;
					}
				});
				if (found) editor.view.dispatch(currentTr);
			}
		}
		if (changed) {
			$editorDirty = true;
			autoSave();
		}
	}

	async function insertFileAttachment(file: File) {
		try {
			const reader = new FileReader();
			reader.onload = () => {
				const base64 = reader.result as string;
				if (editor) {
					editor.chain().focus().insertContent({
						type: 'fileAttachment',
						attrs: {
							src: base64,
							filename: file.name,
							filesize: file.size,
							filetype: file.type || getMimeType(file.name)
						}
					}).run();
				}
			};
			reader.readAsDataURL(file);
		} catch (e) {
			console.error('Failed to insert attachment:', e);
		}
	}

	// Source mode toggle - only react to explicit user toggle, not note switches
	$effect(() => {
		const isSource = $sourceMode;
		// Only act if we have a loaded note
		if (!loadedPath) return;

		if (isSource && !lastSourceMode) {
			// Switching TO source: extract HTML body from editor
			sourceContent = editor ? editor.getHTML() : ($activeNote ? (loadedPath.endsWith('.html') ? parseHtmlMetadata($activeNote.content).content : $activeNote.content) : '');
			resetSourceHistory(sourceContent);
			lastSourceMode = true;
		} else if (!isSource && lastSourceMode) {
			lastSourceMode = false;
			if (isMobile) {
				// Mobile: editor stays in DOM, just update its content
				const content = sourceContent || ($activeNote ? (loadedPath.endsWith('.html') ? parseHtmlMetadata($activeNote.content).content : $activeNote.content) : '');
				if (editor) {
					ignoreNextUpdate = true;
					const html = loadedPath.endsWith('.html') ? content : markdownToHtml(content);
					editor.commands.setContent(html);
				}
			} else {
				// Desktop: destroy old editor (its DOM element is gone),
				// wait for DOM to swap textarea→div, then create editor on new element.
				destroyEditor();
				const content = sourceContent || ($activeNote ? (loadedPath.endsWith('.html') ? parseHtmlMetadata($activeNote.content).content : $activeNote.content) : '');
				tick().then(() => {
					if (editorElement && !editor) {
						createEditor(content);
					}
				});
			}
		}
	});

	// Tauri drag-drop listener for OS file drops (browser DragEvent doesn't have files in Tauri)
	let unlistenDragDrop: (() => void) | null = null;
	$effect(() => {
		const appWindow = getCurrentWindow();
		appWindow.onDragDropEvent((event: any) => {
			if (event.payload.type !== 'drop' || !editor || !$activeNote) return;
			const paths = event.payload.paths;
			for (const filePath of paths) {
				const name = filePath.split('/').pop() || 'file';
				const ext = name.split('.').pop()?.toLowerCase() || '';
				if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
					readFile(filePath).then((data) => {
						saveImage(name, Array.from(data)).then((relativePath) => {
							if (editor) {
								editor.chain().focus().setImage({ src: resolveImageSrc(relativePath) }).run();
							}
						});
					}).catch((e) => console.error('Failed to drop image:', e));
				} else if (ext === 'pdf') {
					readFile(filePath).then((data) => {
						saveAttachment(name, Array.from(data)).then((relativePath) => {
							if (editor) {
								editor.chain().focus().insertContent({
									type: 'fileAttachment',
									attrs: {
										src: relativePath,
										filename: name,
										filesize: data.length,
										filetype: 'application/pdf'
									}
								}).run();
							}
						});
					}).catch((e) => console.error('Failed to drop PDF:', e));
				} else {
					readFile(filePath).then((data) => {
						saveAttachment(name, Array.from(data)).then((relativePath) => {
							if (editor) {
								editor.chain().focus().insertContent({
									type: 'fileAttachment',
									attrs: {
										src: relativePath,
										filename: name,
										filesize: data.length,
										filetype: getMimeType(name)
									}
								}).run();
							}
						});
					}).catch((e) => console.error('Failed to drop file:', e));
				}
			}
		}).then((unlisten: any) => {
			unlistenDragDrop = unlisten;
		});
		return () => {
			unlistenDragDrop?.();
		};
	});

	onDestroy(() => {
		destroyEditor();
	});

	$effect(() => {
		const handleExportHtml = () => {
			exportAsHtml();
		};
		const handleExportMarkdown = () => {
			exportAsMarkdown();
		};
		const handleExportPdf = () => {
			exportAsPdf();
		};

		window.addEventListener('trigger-export-html', handleExportHtml);
		window.addEventListener('trigger-export-markdown', handleExportMarkdown);
		window.addEventListener('trigger-export-pdf', handleExportPdf);

		return () => {
			window.removeEventListener('trigger-export-html', handleExportHtml);
			window.removeEventListener('trigger-export-markdown', handleExportMarkdown);
			window.removeEventListener('trigger-export-pdf', handleExportPdf);
		};
	});
</script>

<div class="editor-container" class:mobile={isMobile} class:readonly={$readOnly} style="position: relative;">
	{#if isLoadingNote}
		<div class="editor-skeleton flex-col" style="position: absolute; inset: 0; background: var(--bg-editor, var(--bg-base)); z-index: 10; padding: var(--spacing-md); gap: var(--spacing-md); width: 100%; height: 100%; box-sizing: border-box;">
			<!-- Toolbar Skeleton -->
			<div class="skeleton-toolbar flex-row" style="display: flex; gap: var(--spacing-sm); padding: var(--spacing-xs) var(--spacing-sm); background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-standard); width: 100%; height: 40px; align-items: center; box-sizing: border-box;">
				<div class="skeleton-btn-group flex-row" style="display: flex; gap: var(--spacing-2xs);">
					<div class="skeleton-block skeleton-pulse" style="width: 28px; height: 28px; border-radius: 4px;"></div>
					<div class="skeleton-block skeleton-pulse" style="width: 28px; height: 28px; border-radius: 4px;"></div>
					<div class="skeleton-block skeleton-pulse" style="width: 28px; height: 28px; border-radius: 4px;"></div>
				</div>
				<div style="width: 1px; height: 16px; background-color: var(--border-color);"></div>
				<div class="skeleton-btn-group flex-row" style="display: flex; gap: var(--spacing-2xs);">
					<div class="skeleton-block skeleton-pulse" style="width: 48px; height: 28px; border-radius: 4px;"></div>
					<div class="skeleton-block skeleton-pulse" style="width: 28px; height: 28px; border-radius: 4px;"></div>
				</div>
				<div style="width: 1px; height: 16px; background-color: var(--border-color);"></div>
				<div class="skeleton-btn-group flex-row" style="display: flex; gap: var(--spacing-2xs);">
					<div class="skeleton-block skeleton-pulse" style="width: 28px; height: 28px; border-radius: 4px;"></div>
					<div class="skeleton-block skeleton-pulse" style="width: 28px; height: 28px; border-radius: 4px;"></div>
				</div>
			</div>
			<!-- Body Skeleton -->
			<div class="skeleton-body flex-col" style="display: flex; flex-direction: column; gap: var(--spacing-md); padding: var(--spacing-lg) var(--spacing-md) 0 var(--spacing-md); flex-grow: 1;">
				<div class="skeleton-block skeleton-pulse" style="width: 40%; height: 28px; border-radius: 6px; margin-bottom: var(--spacing-sm);"></div>
				<div class="skeleton-block skeleton-pulse" style="width: 90%; height: 14px; border-radius: 4px;"></div>
				<div class="skeleton-block skeleton-pulse" style="width: 85%; height: 14px; border-radius: 4px;"></div>
				<div class="skeleton-block skeleton-pulse" style="width: 95%; height: 14px; border-radius: 4px;"></div>
				<div class="skeleton-block skeleton-pulse" style="width: 60%; height: 14px; border-radius: 4px; margin-bottom: var(--spacing-md);"></div>
				
				<div class="skeleton-block skeleton-pulse" style="width: 80%; height: 14px; border-radius: 4px;"></div>
				<div class="skeleton-block skeleton-pulse" style="width: 85%; height: 14px; border-radius: 4px;"></div>
				<div class="skeleton-block skeleton-pulse" style="width: 30%; height: 14px; border-radius: 4px;"></div>
			</div>
		</div>
	{/if}

	{#if !$activeNote}
		<div class="empty-editor flex-col">
			<!-- Glow backdrop -->
			<div class="empty-glow"></div>
			
			<div class="empty-illustration-wrapper">
				<!-- Elegant, outline-only visual illustration representing writing/documentation -->
				<svg class="empty-visual-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
					<polyline points="14 2 14 8 20 8"></polyline>
					<line x1="16" y1="13" x2="8" y2="13"></line>
					<line x1="16" y1="17" x2="8" y2="17"></line>
					<polyline points="10 9 9 9 8 9"></polyline>
				</svg>
			</div>

			<h2 class="empty-editor-title">MyNotes Workspace</h2>
			<p class="empty-editor-subtitle">Select an existing document from the library, search using the command palette, or create a new file to get started.</p>

			<div class="empty-actions flex-row" style="gap: var(--spacing-sm); margin-top: var(--spacing-xs);">
				<button class="btn-pill btn-pill-primary flex-row" onclick={triggerCreateNote} style="gap: var(--spacing-2xs); padding: var(--spacing-xs) var(--spacing-md); cursor: pointer; border: none;">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
					<span>Create Note</span>
				</button>
				<button class="btn-pill btn-pill-outline flex-row" onclick={() => appState.showCommandPalette = true} style="gap: var(--spacing-2xs); padding: var(--spacing-xs) var(--spacing-md); cursor: pointer;">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
					<span>Search Notes</span>
				</button>
			</div>

			<div class="shortcuts-card flex-col">
				<span class="shortcuts-title">Keyboard Shortcuts</span>
				<div class="shortcuts-list flex-col">
					<div class="shortcut-row flex-row">
						<span class="shortcut-label">Create new note</span>
						<div class="shortcut-keys"><kbd>{modKey}</kbd> + <kbd>N</kbd></div>
					</div>
					<div class="shortcut-row flex-row">
						<span class="shortcut-label">Open search palette</span>
						<div class="shortcut-keys"><kbd>{modKey}</kbd> + <kbd>P</kbd></div>
					</div>
					<div class="shortcut-row flex-row">
						<span class="shortcut-label">Focus search input</span>
						<div class="shortcut-keys"><kbd>{modKey}</kbd> + <kbd>K</kbd></div>
					</div>
					<div class="shortcut-row flex-row">
						<span class="shortcut-label">Cycle active panels</span>
						<div class="shortcut-keys"><kbd>F6</kbd></div>
					</div>
				</div>
			</div>
		</div>
	{:else}
		{#if $viewerNote}
			<div class="viewer-banner">
				<svg class="viewer-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
				</svg>
				<span class="viewer-banner-label">Read-only viewer</span>
				<code class="viewer-banner-path" title={$viewerNote.path}>{$viewerNote.path}</code>
				<div class="viewer-banner-actions">
					<button type="button" class="viewer-banner-btn primary" onclick={() => (viewerImportPickerOpen = true)} disabled={viewerImportBusy || !$appConfig?.active_vault}>Import to vault…</button>
					<button type="button" class="viewer-banner-btn" onclick={closeViewer}>Close</button>
				</div>
				{#if viewerToast}
					<span class="viewer-banner-toast">{viewerToast}</span>
				{/if}
			</div>
		{/if}
		{#if !$viewerNote}
			{#if appState.saveError}
				<div style="padding: var(--spacing-sm) var(--spacing-md) 0 var(--spacing-md);">
					<ErrorBanner
						title="Save Error"
						message={appState.saveError}
						severity="error"
						retryAction={() => appState.saveActiveNote(true)}
						retryLabel="Retry Save"
						dismissAction={() => appState.saveError = null}
					/>
				</div>
			{/if}
		{/if}
		{#if !$viewerNote && !isMobile}
		<div class="editor-toolbar" class:mobile={isMobile}>
			<div class="editor-title" style="display: flex; align-items: center; gap: 8px; width: 100%;">
				<input
					bind:this={titleInput}
					type="text"
					readonly={$readOnly}
					value={$activeNote.meta.title}
					onkeydown={(e) => {
						if (e.key === 'Tab') {
							e.preventDefault();
							editor?.commands.focus('start');
						}
						if (e.key === 'Enter') {
							e.preventDefault();
							editor?.commands.focus('start');
						}
					}}
					onchange={(e) => updateNoteTitle(e.currentTarget.value)}
				/>
				{#if isMobile}
					<button
						class="icon-btn"
						style="padding: 6px; flex-shrink: 0;"
						class:active={appState.favorites.includes($activeNotePath || '')}
						onclick={() => {
							if ($activeNotePath) {
								appState.toggleFavorite($activeNotePath);
							}
						}}
						title={appState.favorites.includes($activeNotePath || '') ? 'Remove from Favorites' : 'Add to Favorites'}
					>
						<svg width="20" height="20" viewBox="0 0 24 24" fill={appState.favorites.includes($activeNotePath || '') ? 'var(--accent)' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
						</svg>
					</button>

					<!-- Mobile Download Note Button -->
					<div class="export-dropdown-wrap mobile">
						<button
							class="icon-btn"
							class:active={exportDropdownOpen}
							onclick={(e) => { e.stopPropagation(); exportDropdownOpen = !exportDropdownOpen; }}
							title="Export Note"
							style="padding: 6px; flex-shrink: 0; margin-left: 4px;"
						>
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
								<polyline points="7 10 12 15 17 10"/>
								<line x1="12" y1="15" x2="12" y2="3"/>
							</svg>
						</button>
						{#if exportDropdownOpen}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="fmt-dropdown export-dropdown mobile" onclick={(e) => e.stopPropagation()}>
								<button onclick={exportAsHtml}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 17h8"/><path d="M12 12v5"/><path d="m9 15 3 3 3-3"/></svg>
									Download HTML (.html)
								</button>
								<button onclick={exportAsMarkdown}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
									Markdown (.md)
								</button>
								<button onclick={exportAsPdf}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="9" cy="15" r="2"/><path d="M9 17v2h3"/></svg>
									PDF (Print)
								</button>
							</div>
						{/if}
					</div>

					<!-- Mobile Text/Canvas Mode Toggle -->
					{#if appState.editorMode !== 'notebook'}
						<div class="mode-segmented-control mobile" style="margin-left: 4px;">
							<button
								type="button"
								class="mode-segment-btn"
								class:active={appState.editorMode === 'text'}
								onclick={() => { void appState.switchEditorMode('text'); }}
								title="Text Mode"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="4 7 4 4 20 4 20 7"/>
									<line x1="9" y1="20" x2="15" y2="20"/>
									<line x1="12" y1="4" x2="12" y2="20"/>
								</svg>
							</button>
							<button
								type="button"
								class="mode-segment-btn"
								class:active={appState.editorMode === 'canvas'}
								onclick={() => { void appState.switchEditorMode('canvas'); }}
								title="Canvas Mode"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
									<path d="M12 20h9"/>
									<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
								</svg>
							</button>
						</div>
					{/if}

					<!-- Mobile Read/Edit Mode Toggle -->
					<div class="mode-segmented-control mobile" style="margin-left: 4px;">
						<button
							type="button"
							class="mode-segment-btn"
							class:active={!$readOnly}
							onclick={() => { if ($readOnly) toggleReadMode(); }}
							title="Edit Mode"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12 20h9"/>
								<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
							</svg>
						</button>
						<button
							type="button"
							class="mode-segment-btn"
							class:active={$readOnly}
							onclick={() => { if (!$readOnly) toggleReadMode(); }}
							title="Read-Only Mode"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
								<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
							</svg>
						</button>
					</div>

					{#if !$readOnly}
					<!-- Mobile Focus Mode Toggle -->
					<button
						class="icon-btn toggle-btn"
						class:active={appState.focusModeEnabled}
						style="padding: 6px; flex-shrink: 0; margin-left: 4px;"
						onclick={() => appState.setFocusMode(!appState.focusModeEnabled)}
						title="Toggle Focus Mode"
					>
						<svg class="focus-mode-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
						</svg>
					</button>

					<!-- Mobile Typewriter Scroll Toggle -->
					<button
						class="icon-btn toggle-btn"
						class:active={appState.typewriterScrollEnabled}
						style="padding: 6px; flex-shrink: 0; margin-left: 4px;"
						onclick={() => appState.setTypewriterScroll(!appState.typewriterScrollEnabled)}
						title="Toggle Typewriter Scrolling"
					>
						<svg class="typewriter-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line class="lock-line" x1="4" y1="12" x2="20" y2="12" stroke-dasharray="3,3"/>
							<polyline class="arrow-up" points="8 7 12 3 16 7"/>
							<polyline class="arrow-down" points="8 17 12 21 16 17"/>
						</svg>
					</button>
					{/if}

					<!-- Mobile Delete Note Button -->
					<button
						class="icon-btn delete-btn"
						style="padding: 6px; flex-shrink: 0; color: var(--semantic-error, #ff4d4d); margin-left: 4px;"
						onclick={handleDeleteActiveNote}
						title="Delete Note"
					>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
						</svg>
					</button>
				{/if}
			</div>
			{#if !isMobile}
			<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
			<div class="toolbar-actions" role="toolbar" aria-label="Note actions" aria-orientation="horizontal">
				{#if $canGoBack || $canGoForward}
				<div class="toolbar-group nav-history-btns" role="group" aria-label="Navigation history">
					<button type="button" class="nav-history-btn" disabled={!$canGoBack} onclick={() => editorNavigateHistory(-1)} aria-label="Go back" title="Back (Alt+←)">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
					</button>
					<button type="button" class="nav-history-btn" disabled={!$canGoForward} onclick={() => editorNavigateHistory(1)} aria-label="Go forward" title="Forward (Alt+→)">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
					</button>
				</div>
				<span class="toolbar-sep" aria-hidden="true"></span>
				{/if}

				<!-- Group: Editor Mode (Text / Canvas) -->
				{#if appState.editorMode !== 'notebook'}
					<div class="mode-segmented-control" role="radiogroup" aria-label="Editor mode">
						<button
							type="button"
							class="mode-segment-btn"
							class:active={appState.editorMode === 'text'}
							role="radio"
							aria-checked={appState.editorMode === 'text'}
							onclick={() => { void appState.switchEditorMode('text'); }}
							title="Text Editor"
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="4 7 4 4 20 4 20 7"/>
								<line x1="9" y1="20" x2="15" y2="20"/>
								<line x1="12" y1="4" x2="12" y2="20"/>
							</svg>
							<span>Text</span>
						</button>
						<button
							type="button"
							class="mode-segment-btn"
							class:active={appState.editorMode === 'canvas'}
							role="radio"
							aria-checked={appState.editorMode === 'canvas'}
							onclick={() => { void appState.switchEditorMode('canvas'); }}
							title="Drawing Canvas"
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12 20h9"/>
								<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
							</svg>
							<span>Canvas</span>
						</button>
					</div>
				{/if}

				<span class="toolbar-sep" aria-hidden="true"></span>

				<!-- Group: Editing Mode (Edit / Read) -->
				<div class="mode-segmented-control" role="radiogroup" aria-label="Editing mode">
					<button
						type="button"
						class="mode-segment-btn"
						class:active={!$readOnly}
						role="radio"
						aria-checked={!$readOnly}
						onclick={() => { if ($readOnly) toggleReadMode(); }}
						title={`Edit Mode (${modKey}+Shift+R)`}
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 20h9"/>
							<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
						</svg>
						<span>Edit</span>
					</button>
					<button
						type="button"
						class="mode-segment-btn"
						class:active={$readOnly}
						role="radio"
						aria-checked={$readOnly}
						onclick={() => { if (!$readOnly) toggleReadMode(); }}
						title={`Read-Only Mode (${modKey}+Shift+R)`}
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
							<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
						</svg>
						<span>Read</span>
					</button>
				</div>

				<span class="toolbar-sep" aria-hidden="true"></span>

				<!-- Group: View (Find / Outline) -->
				<div class="toolbar-group" role="group" aria-label="View">
					<button
						type="button"
						class="icon-btn"
						class:active={noteSearchOpen}
						aria-label="Find in note"
						aria-pressed={noteSearchOpen}
						onclick={() => noteSearchOpen ? closeNoteSearch() : openNoteSearch()}
						title={`Find in note (${modKey}+F)`}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
						</svg>
					</button>
					<button
						type="button"
						class="icon-btn"
						class:active={showOutline}
						aria-label="Document outline"
						aria-pressed={showOutline}
						onclick={() => { showOutline = !showOutline; if (showOutline) updateOutline(); }}
						title="Outline"
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>
						</svg>
					</button>
				</div>

				<span class="toolbar-sep" aria-hidden="true"></span>

				<!-- Group: Writing Modes (Focus / Typewriter / Source) -->
				<div class="toolbar-group" role="group" aria-label="Writing modes">
					{#if !$readOnly}
					<button
						type="button"
						class="icon-btn toggle-btn"
						class:active={appState.focusModeEnabled}
						aria-label="Focus mode"
						aria-pressed={appState.focusModeEnabled}
						onclick={() => appState.setFocusMode(!appState.focusModeEnabled)}
						title="Toggle Focus Mode"
					>
						<svg class="focus-mode-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
						</svg>
					</button>
					<button
						type="button"
						class="icon-btn toggle-btn"
						class:active={appState.typewriterScrollEnabled}
						aria-label="Typewriter scrolling"
						aria-pressed={appState.typewriterScrollEnabled}
						onclick={() => appState.setTypewriterScroll(!appState.typewriterScrollEnabled)}
						title="Toggle Typewriter Scrolling"
					>
						<svg class="typewriter-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line class="lock-line" x1="4" y1="12" x2="20" y2="12" stroke-dasharray="3,3"/>
							<polyline class="arrow-up" points="8 7 12 3 16 7"/>
							<polyline class="arrow-down" points="8 17 12 21 16 17"/>
						</svg>
					</button>
					{/if}
					<button
						type="button"
						class="icon-btn"
						class:active={$sourceMode}
						aria-label="Markdown source mode"
						aria-pressed={$sourceMode}
						onclick={() => ($sourceMode = !$sourceMode)}
						title="Toggle Markdown Editor"
					>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
							<path d="M5.854 4.854a.5.5 0 10-.708-.708l-3.5 3.5a.5.5 0 000 .708l3.5 3.5a.5.5 0 00.708-.708L2.707 8l3.147-3.146zm4.292 0a.5.5 0 01.708-.708l3.5 3.5a.5.5 0 010 .708l-3.5 3.5a.5.5 0 01-.708-.708L13.293 8l-3.147-3.146z" />
						</svg>
					</button>
				</div>

				<span class="toolbar-sep" aria-hidden="true"></span>

				<!-- Group: Document (Favorite / Export / More) -->
				<div class="toolbar-group" role="group" aria-label="Document">
					<button
						type="button"
						class="icon-btn"
						class:active={appState.favorites.includes($activeNotePath || '')}
						aria-label={appState.favorites.includes($activeNotePath || '') ? 'Remove from favorites' : 'Add to favorites'}
						aria-pressed={appState.favorites.includes($activeNotePath || '')}
						onclick={() => { if ($activeNotePath) appState.toggleFavorite($activeNotePath); }}
						title={appState.favorites.includes($activeNotePath || '') ? 'Remove from Favorites' : 'Add to Favorites'}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill={appState.favorites.includes($activeNotePath || '') ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
						</svg>
					</button>

					<!-- Export menu -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="export-dropdown-wrap" onkeydown={(e) => { if (e.key === 'Escape') { exportDropdownOpen = false; } }}>
						<button
							type="button"
							class="icon-btn"
							class:active={exportDropdownOpen}
							aria-label="Export note"
							aria-haspopup="menu"
							aria-expanded={exportDropdownOpen}
							onclick={(e) => { e.stopPropagation(); moreMenuOpen = false; exportDropdownOpen = !exportDropdownOpen; }}
							title="Export Note"
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
								<polyline points="7 10 12 15 17 10"/>
								<line x1="12" y1="15" x2="12" y2="3"/>
							</svg>
						</button>
						{#if exportDropdownOpen}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="fmt-dropdown export-dropdown" role="menu" aria-label="Export note" onclick={(e) => e.stopPropagation()}>
								<button type="button" role="menuitem" onclick={exportAsHtml}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 17h8"/><path d="M12 12v5"/><path d="m9 15 3 3 3-3"/></svg>
									Download HTML (.html)
								</button>
								<button type="button" role="menuitem" onclick={exportAsMarkdown}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
									Download Markdown (.md)
								</button>
								<button type="button" role="menuitem" onclick={exportAsPdf}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="9" cy="15" r="2"/><path d="M9 17v2h3"/></svg>
									Export as PDF
								</button>
							</div>
						{/if}
					</div>

					<!-- Overflow "More" menu (secondary actions) -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="more-dropdown-wrap" onkeydown={(e) => { if (e.key === 'Escape') { moreMenuOpen = false; } }}>
						<button
							type="button"
							class="icon-btn"
							class:active={moreMenuOpen}
							aria-label="More actions"
							aria-haspopup="menu"
							aria-expanded={moreMenuOpen}
							onclick={(e) => { e.stopPropagation(); exportDropdownOpen = false; moreMenuOpen = !moreMenuOpen; }}
							title="More actions"
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
							</svg>
						</button>
						{#if moreMenuOpen}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="fmt-dropdown more-dropdown" role="menu" aria-label="More actions" onclick={(e) => e.stopPropagation()}>
								<button type="button" role="menuitem" class:active={showHistory} onclick={() => { moreMenuOpen = false; toggleHistory(); }}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
									Version history
								</button>
								{#if $appConfig?.enable_wiki_links}
								<button type="button" role="menuitem" class:active={showGraph} onclick={() => { moreMenuOpen = false; showGraph = !showGraph; }}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><line x1="8.5" y1="7.5" x2="15.5" y2="16.5"/><line x1="15.5" y1="7.5" x2="8.5" y2="16.5"/></svg>
									Graph view
								</button>
								{/if}
								{#if $appConfig?.ai_provider}
								<button type="button" role="menuitem" onclick={() => { moreMenuOpen = false; openAiMenu(); }}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4l-2-2"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M9 13v2"/><path d="M15 13v2"/></svg>
									AI actions
								</button>
								{/if}
								<div class="more-dropdown-sep" role="separator"></div>
								<button type="button" role="menuitem" class="danger" onclick={() => { moreMenuOpen = false; handleDeleteActiveNote(); }}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
									Delete note
								</button>
							</div>
						{/if}
					</div>
				</div>
			</div>
			{/if}
		</div>
		{/if}

		{#if appState.editorMode !== 'canvas'}
		<div class="note-meta-bar" class:focus-mode={appState.focusModeEnabled}>
			{#if !appState.focusModeEnabled}
				<span class="note-folder" class:unfiled={!noteFolder}>
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
					{#if noteFolder}
						{#each noteFolder.split('/') as segment, i}
							{#if i > 0}<span class="path-sep">›</span>{/if}{segment}
						{/each}
					{:else}
						Unfiled Notes
					{/if}
				</span>
				{#if ($activeNote.meta.tags && $activeNote.meta.tags.length > 0) || !$readOnly}
					<span class="meta-divider">·</span>
				{/if}
				{#if ($activeNote.meta.tags && $activeNote.meta.tags.length > 0) || !$readOnly}
				<span class="note-tags">
					{#each $activeNote.meta.tags || [] as tag}
						{@const tagColor = appState.tagColorMap.get(tag.toLowerCase())}
						{#if $readOnly}
							<span class="note-tag" style={tagColor ? `background: ${tagColor}26; border-left: 2px solid ${tagColor}; color: ${tagColor}` : ''}>#{tag}</span>
						{:else}
							<span class="note-tag edit" style={tagColor ? `border-color: ${tagColor}66; background: ${tagColor}1a` : ''}>
								<span>#{tag}</span>
								<button type="button" class="tag-delete-btn" onclick={() => removeTag(tag)} aria-label="Remove tag">✕</button>
							</span>
						{/if}
					{/each}
					{#if !$readOnly}
						<div class="tag-input-container">
							<input
								type="text"
								class="note-tag-input"
								placeholder="+ Add tag"
								bind:value={newTagVal}
								onkeydown={handleTagInputKeydown}
								onfocus={() => showDropdown = true}
								onblur={() => showDropdown = false}
							/>
							{#if showDropdown && filteredSuggestions.length > 0}
								<ul class="tag-autocomplete-dropdown">
									{#each filteredSuggestions as suggestion, idx}
										{@const sugColor = appState.tagColorMap.get(suggestion.toLowerCase())}
										<li 
											class:active={idx === selectedIndex}
											onmousedown={(e) => { e.preventDefault(); selectSuggestion(suggestion); }}
										>
											{#if sugColor}<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: {sugColor}; margin-right: 5px; flex-shrink: 0;"></span>{/if}
											#{suggestion}
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				</span>
				{/if}
			{/if}

			<div class="note-status-group">
				{#if $editorDirty}
					<span class="status-badge save-status dirty" title="You have unsaved changes in this note">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
						</svg>
						Unsaved Changes
					</span>
				{:else}
					<span class="status-badge save-status clean" title="All changes saved to local storage">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
							<polyline points="17 21 17 13 7 13 7 21"/>
							<polyline points="7 3 7 8 15 8"/>
						</svg>
						Saved Locally
					</span>
				{/if}

				{#if !appState.syncEnabled || !appState.googleConnected}
					<span class="status-badge sync-status offline" title="Google Drive sync is disabled or offline. Go to layout settings to connect.">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M5 14c-.33 0-.66-.03-1-.1A4.5 4.5 0 0 0 8.5 19h7a4.5 4.5 0 0 0 4-2.5"/>
							<path d="M16 11c1 .5 2.5.5 3.5-1.5M10.3 5.3A5 5 0 0 1 19 8c0 .33-.03.66-.1 1"/>
							<line x1="2" y1="2" x2="22" y2="22"/>
						</svg>
						Sync Offline
					</span>
				{:else if appState.syncStatus === 'syncing'}
					<span class="status-badge sync-status syncing" title="Syncing changes to Google Drive...">
						<svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
						</svg>
						Syncing...
					</span>
				{:else if appState.syncStatus === 'error'}
					<span class="status-badge sync-status error" title="Sync failed. Click to retry sync." onclick={async (e) => { e.stopPropagation(); await appState.syncNotes(); }}>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
						</svg>
						Sync Error
					</span>
				{:else if !appState.isNoteSynced($activeNotePath)}
					<span class="status-badge sync-status pending" title="Local changes saved, waiting to sync with Google Drive. Click to sync now." onclick={async (e) => { e.stopPropagation(); await appState.syncNotes(); }}>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.47 0-.89.09-1.29.27A5 5 0 0 0 5 14c0 .34.05.67.15 1A4.5 4.5 0 0 0 8.5 19H17.5z"/>
							<polyline points="16 16 12 12 8 16"/>
							<line x1="12" y1="12" x2="12" y2="21"/>
						</svg>
						Pending Sync
					</span>
				{:else}
					<span class="status-badge sync-status synced" title={appState.lastSyncedTime ? 'Synced to Google Drive. Last sync: ' + new Date(appState.lastSyncedTime).toLocaleTimeString() : 'Synced to Google Drive'}>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.47 0-.89.09-1.29.27A5 5 0 0 0 5 14c0 .34.05.67.15 1A4.5 4.5 0 0 0 8.5 19H17.5z"/>
							<polyline points="9 15 11 17 15 13"/>
						</svg>
						Drive Synced
					</span>
				{/if}
			</div>
		</div>
		{/if}

		<div class="editor-body-wrapper">
			{#if noteSearchOpen}
				<div class="note-search-bar">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
					<input
						bind:this={noteSearchInput}
						type="text"
						class="note-search-input"
						placeholder="Find in note..."
						bind:value={noteSearchQuery}
						oninput={() => updateNoteSearch(noteSearchQuery)}
						onkeydown={(e) => {
							if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? noteSearchPrev() : noteSearchNext(); }
							if (e.key === 'Escape') { e.preventDefault(); closeNoteSearch(); }
						}}
						use:autofocus
					/>
					<span class="note-search-count">
						{#if noteSearchQuery && noteSearchResults.length > 0}
							{noteSearchIndex + 1} / {noteSearchResults.length}
						{:else if noteSearchQuery}
							No results
						{/if}
					</span>
					<button class="note-search-btn" onclick={noteSearchPrev} title="Previous (Shift+Enter)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
					</button>
					<button class="note-search-btn" onclick={noteSearchNext} title="Next (Enter)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
					</button>
					<button class="note-search-btn" onclick={closeNoteSearch} title="Close (Esc)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
					</button>
				</div>
			{/if}
			<div class="editor-body-row">
			<div class="editor-body" class:readonly={$readOnly} class:focus-mode-active={!$readOnly && appState.focusModeEnabled} class:typewriter-active={!$readOnly && appState.typewriterScrollEnabled}>
				{#if isMobile && appState.editorMode === 'text'}
					<div class="mobile-note-title-container" class:focus-mode={appState.focusModeEnabled}>
						<input
							type="text"
							readonly={$readOnly}
							value={$activeNote.meta.title}
							placeholder="Title"
							class="mobile-note-title-input"
							onchange={(e) => updateNoteTitle(e.currentTarget.value)}
						/>
					</div>
				{/if}
				{#if isMobile}
					<!-- Mobile: both views always in DOM, toggled via display to avoid slow editor re-creation -->
					<textarea
						class="source-editor"
						style={$sourceMode && appState.editorMode === 'text' ? '' : 'display:none'}
						bind:this={sourceElement}
						bind:value={sourceContent}
						readonly={$readOnly}
						onclick={() => { showOutline = false; }}
						oninput={() => {
							$editorDirty = true;
							autoSave();
							pushSourceHistoryDebounced();
						}}
						onkeydown={(e) => {
							const mod = e.ctrlKey || e.metaKey;
							if (e.key === 'Enter' && e.shiftKey && !mod) {
								e.preventDefault();
								const ta = sourceElement;
								const start = ta.selectionStart;
								const end = ta.selectionEnd;
								const val = ta.value;
								sourceContent = val.slice(0, start) + '  \n' + val.slice(end);
								tick().then(() => {
									const newPos = start + 3;
									ta.setSelectionRange(newPos, newPos);
								});
								$editorDirty = true;
								autoSave();
								pushSourceHistoryDebounced();
								return;
							}
							if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
								e.preventDefault();
								sourceUndo();
								return;
							}
							if ((mod && (e.key === 'z' || e.key === 'Z') && e.shiftKey) || (mod && (e.key === 'y' || e.key === 'Y'))) {
								e.preventDefault();
								sourceRedo();
								return;
							}
						}}
						spellcheck="false"
					></textarea>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="tiptap-wrapper" class:large-doc={isLargeDoc} style={!$sourceMode && appState.editorMode === 'text' ? '' : 'display:none'} spellcheck="false" bind:this={editorElement} onclick={(e) => { closeLinkContextMenu(); handleEditorClick(e); showOutline = false; }}></div>
				{:else}
					<div class="desktop-text-editor-container" style={appState.editorMode === 'text' ? 'display: contents;' : 'display: none;'}>
						<!-- Desktop: conditional rendering with line numbers -->
						{#if $sourceMode}
							{#if $appConfig?.show_line_numbers}
								<div class="line-numbers-clip" aria-hidden="true">
									<div class="line-numbers">
										{#each sourceContent.split('\n') as _, i}
											<span>{i + 1}</span>
										{/each}
									</div>
								</div>
							{/if}
							<textarea
								class="source-editor"
								class:with-line-numbers={$appConfig?.show_line_numbers}
								bind:this={sourceElement}
								bind:value={sourceContent}
								readonly={$readOnly}
								onclick={() => { showOutline = false; }}
								oninput={() => {
									$editorDirty = true;
									autoSave();
									pushSourceHistoryDebounced();
								}}
								onkeydown={(e) => {
									const mod = e.ctrlKey || e.metaKey;
									// Shift+Enter: insert two trailing spaces + newline for markdown hard break
									if (e.key === 'Enter' && e.shiftKey && !mod) {
										e.preventDefault();
										const ta = sourceElement;
										const start = ta.selectionStart;
										const end = ta.selectionEnd;
										const val = ta.value;
										sourceContent = val.slice(0, start) + '  \n' + val.slice(end);
										tick().then(() => {
											const newPos = start + 3;
											ta.setSelectionRange(newPos, newPos);
										});
										$editorDirty = true;
										autoSave();
										pushSourceHistoryDebounced();
										return;
									}
									// Undo
									if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
										e.preventDefault();
										sourceUndo();
										return;
									}
									// Redo
									if ((mod && (e.key === 'z' || e.key === 'Z') && e.shiftKey) || (mod && (e.key === 'y' || e.key === 'Y'))) {
										e.preventDefault();
										sourceRedo();
										return;
									}
									if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
										e.preventDefault();
										pushSourceHistoryImmediate();
										const ta = sourceElement;
										const val = ta.value;
										const start = ta.selectionStart;
										const lines = val.split('\n');
										// Find current line index
										let pos = 0;
										let curLine = 0;
										for (let i = 0; i < lines.length; i++) {
											if (pos + lines[i].length >= start) { curLine = i; break; }
											pos += lines[i].length + 1;
										}
										if (e.key === 'ArrowUp' && curLine > 0) {
											const tmp = lines[curLine];
											lines[curLine] = lines[curLine - 1];
											lines[curLine - 1] = tmp;
											sourceContent = lines.join('\n');
											tick().then(() => {
												const newPos = lines.slice(0, curLine - 1).join('\n').length + 1 + (start - pos);
												ta.setSelectionRange(newPos, newPos);
												pushSourceHistoryImmediate();
											});
										} else if (e.key === 'ArrowDown' && curLine < lines.length - 1) {
											const tmp = lines[curLine];
											lines[curLine] = lines[curLine + 1];
											lines[curLine + 1] = tmp;
											sourceContent = lines.join('\n');
											tick().then(() => {
												const newPos = lines.slice(0, curLine + 1).join('\n').length + 1 + (start - pos);
												ta.setSelectionRange(newPos, newPos);
												pushSourceHistoryImmediate();
											});
										}
										$editorDirty = true;
										autoSave();
									}
								}}
								onscroll={() => {
									if ($appConfig?.show_line_numbers) {
										const clip = sourceElement?.previousElementSibling as HTMLElement;
										const gutter = clip?.firstElementChild as HTMLElement;
										if (gutter) {
											gutter.style.transform = `translateY(-${sourceElement.scrollTop}px)`;
										}
									}
								}}
								spellcheck="false"
							></textarea>
						{:else}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="tiptap-wrapper" class:large-doc={isLargeDoc} spellcheck="false" bind:this={editorElement} onclick={(e) => { closeLinkContextMenu(); handleEditorClick(e); showOutline = false; }} oncontextmenu={handleEditorContextMenu}></div>
						{/if}
					</div>
				{/if}

				<!-- Canvas Mode Editor -->
				{#if appState.editorMode === 'canvas' && appState.activeNoteContent}
					<div class="canvas-editor-wrapper" style="display: block; position: absolute; inset: 0; z-index: 1;">
						<CanvasEditor 
							notePath={$activeNotePath || ''}
							initialStrokes={canvasStrokes}
							initialBackground={canvasBackground}
							onSave={handleCanvasSave}
							bind:performSaveImmediate={canvasPerformSaveImmediate}
						/>
					</div>
				{/if}

				<!-- Notebook Mode Editor -->
				{#if appState.editorMode === 'notebook' && appState.activeNoteContent}
					<div class="notebook-editor-wrapper" style="display: block; position: absolute; inset: 0; z-index: 1;">
						<NotebookEditor 
							notePath={$activeNotePath || ''}
							initialContent={appState.activeNoteContent}
							onSave={handleNotebookSave}
						/>
					</div>
				{/if}
				
				<!-- Floating Bubble Menu -->
				{#if showBubbleMenu && bubbleMenuCoords}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="bubble-menu-hud" style="left: {bubbleMenuCoords.x}px; top: {bubbleMenuCoords.y}px;" onclick={(e) => e.stopPropagation()}>
						<button class="bubble-btn" class:active={editor?.isActive('bold')} onmousedown={(e) => e.preventDefault()} onclick={() => editor?.chain().focus().toggleBold().run()} title="Bold">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
						</button>
						<button class="bubble-btn" class:active={editor?.isActive('italic')} onmousedown={(e) => e.preventDefault()} onclick={() => editor?.chain().focus().toggleItalic().run()} title="Italic">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
						</button>
						<button class="bubble-btn" class:active={editor?.isActive('underline')} onmousedown={(e) => e.preventDefault()} onclick={() => editor?.chain().focus().toggleUnderline().run()} title="Underline">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>
						</button>
						<button class="bubble-btn" class:active={editor?.isActive('highlight')} onmousedown={(e) => e.preventDefault()} onclick={() => editor?.chain().focus().toggleHighlight().run()} title="Highlight">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
						</button>
						<button class="bubble-btn" class:active={editor?.isActive('code')} onmousedown={(e) => e.preventDefault()} onclick={() => editor?.chain().focus().toggleCode().run()} title="Code">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
						</button>
						<div class="bubble-sep"></div>
						<button class="bubble-btn" onmousedown={(e) => e.preventDefault()} onclick={() => { addLinkFromToolbar(); bubbleMenuCoords = null; }} title="Link">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
						</button>
						<button class="bubble-btn" onmousedown={(e) => e.preventDefault()} onclick={() => { editor?.chain().focus().insertContent({ type: 'callout', attrs: { type: 'note' }, content: [{ type: 'paragraph' }] }).run(); bubbleMenuCoords = null; }} title="Callout Box">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
						</button>
					</div>
				{/if}


			</div>

			{#if showHistory}
				<div class="history-panel">
					<div class="history-header">
						<h3>Version History</h3>
						<div class="history-header-actions">
							<button class="history-create-btn" onclick={handleCreateVersion} title="Save current state as a version">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<line x1="12" y1="5" x2="12" y2="19" />
									<line x1="5" y1="12" x2="19" y2="12" />
								</svg>
							</button>
							<button class="history-close" onclick={() => { showHistory = false; historyPreview = null; historySelected = null; }}>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<line x1="18" y1="6" x2="6" y2="18" />
									<line x1="6" y1="6" x2="18" y2="18" />
								</svg>
							</button>
						</div>
					</div>
					{#if historyLoading}
						<div class="history-empty">Loading...</div>
					{:else if historyVersions.length === 0}
						<div class="history-empty">No versions yet. Versions are created automatically as you edit (at least 5 minutes apart).</div>
					{:else}
						<div class="history-list">
							{#each historyVersions as v}
								<button
									class="history-item"
									class:active={historySelected?.timestamp === v.timestamp}
									onclick={() => previewVersion(v)}
								>
									<span class="history-date">{formatVersionDate(v.timestamp)}</span>
									<span class="history-size">{formatVersionSize(v.size)}</span>
								</button>
							{/each}
						</div>
					{/if}
					{#if historySelected}
						<div class="history-actions">
							<button class="history-restore-btn" onclick={restoreVersion}>
								Restore this version
							</button>
						</div>
					{/if}
				</div>
			{/if}
			{#if showOutline}
				<div class="outline-panel">
					<div class="outline-header">
						<h3>Outline</h3>
						<button class="outline-close" onclick={() => { showOutline = false; }}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="18" y1="6" x2="6" y2="18" />
								<line x1="6" y1="6" x2="18" y2="18" />
							</svg>
						</button>
					</div>
					{#if outlineHeadings.length === 0}
						<div class="outline-empty">No headings in this note.</div>
					{:else}
						<div class="outline-list">
							{#each outlineHeadings as h}
								<button
									class="outline-item outline-level-{h.level}"
									onclick={() => scrollToHeading(h.pos)}
								>
									{h.text}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
			
			</div>
		</div>

		{#if editorReady && !$sourceMode && !$viewerNote && !$readOnly && appState.editorMode !== 'canvas' && appState.editorMode !== 'notebook'}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="editor-formatting-bar" 
				style={isMobile ? `${keyboardHeight > 0 ? `bottom: ${keyboardHeight}px;` : ''}${anyDropdownOpen ? 'overflow: visible;' : ''}` : ''} 
				onclick={() => { headingDropdown = false; colorDropdown = false; highlightDropdown = false; tablePickerOpen = false; alignDropdown = false; insertDropdown = false; fontDropdown = false; fontSizeDropdown = false; }}
			>

				<!-- ═══ DESKTOP formatting bar: full feature set ═══ -->

				<!-- Insert (+) dropdown -->
				<div class="fmt-dropdown-wrap">
					<button class="fmt-btn insert-btn" onclick={(e) => { e.stopPropagation(); insertDropdown = !insertDropdown; headingDropdown = false; colorDropdown = false; highlightDropdown = false; tablePickerOpen = false; alignDropdown = false; }} title="Insert">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
					</button>
					{#if insertDropdown}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="fmt-dropdown insert-dropdown" onclick={(e) => e.stopPropagation()}>
							<button onclick={() => { insertDropdown = false; document.querySelector<HTMLInputElement>('#insert-image-input')?.click(); }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 00-2.828 0L6 21"/></svg>
								Image
							</button>
							<button onclick={() => { insertDropdown = false; document.querySelector<HTMLInputElement>('#insert-file-input')?.click(); }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 01-2-2V4a2 2 0 012-2h8a2.4 2.4 0 011.704.706l3.588 3.588A2.4 2.4 0 0120 8v12a2 2 0 01-2 2z"/><path d="M14 2v5a1 1 0 001 1h5"/></svg>
								File
							</button>
							<button onclick={() => { insertDropdown = false; tablePickerOpen = true; }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>
								Table
							</button>
							<button onclick={() => { insertDropdown = false; editor?.chain().focus().insertContent({ type: 'metrics', attrs: { id: 'metrics_' + Math.random().toString(36).substring(2, 9), title: 'Cal Block', data: '[]', excludeChecked: false } }).command(({ tr }) => {
								const { selection } = tr;
								if (selection instanceof NodeSelection) {
									tr.setSelection(TextSelection.near(tr.doc.resolve(selection.to)));
								}
								return true;
							}).run(); }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>
								Calculation Box
							</button>


							<button onclick={() => { insertDropdown = false; editor?.chain().focus().setHorizontalRule().run(); }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>
								Horizontal Rule
							</button>
							<button onclick={() => { insertDropdown = false; editor?.chain().focus().toggleCodeBlock().run(); }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 9-3 3 3 3"/><path d="m14 15 3-3-3-3"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
								Code Block
							</button>
							<button onclick={() => { insertDropdown = false; editor?.chain().focus().toggleBlockquote().run(); }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 5H3"/><path d="M21 12H8"/><path d="M21 19H8"/><path d="M3 12v7"/></svg>
								Quote
							</button>
							<button onclick={() => { insertDropdown = false; insertDetails(); }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="7" x="8" y="3" rx="1"/><path d="m2 9 3 3-3 3"/><rect width="13" height="7" x="8" y="14" rx="1"/></svg>
								Collapsible Section
							</button>
							<button onclick={() => { insertDropdown = false; openDiagramInsert(); }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M10 6.5h4a3 3 0 0 1 3 3V14"/></svg>
								Diagram
							</button>
							<button onclick={() => { insertDropdown = false; insertTimestamp('datetime'); }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><circle cx="18" cy="17" r="4"/><path d="M18 15.5v1.5l1 1"/></svg>
								Date &amp; Time
							</button>
						</div>
					{/if}
				</div>

				<div class="fmt-sep"></div>

				<!-- Tab Indent / Outdent Buttons -->
				<button class="fmt-btn" onclick={() => {
					if (editor) {
						editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
							key: 'Tab',
							code: 'Tab',
							keyCode: 9,
							which: 9,
							bubbles: true,
							cancelable: true
						}));
					}
				}} title="Tab Indent">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M5 12h14"/>
						<polyline points="13 6 19 12 13 18"/>
						<line x1="21" y1="5" x2="21" y2="19"/>
					</svg>
				</button>
				<button class="fmt-btn" onclick={() => {
					if (editor) {
						editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
							key: 'Tab',
							code: 'Tab',
							keyCode: 9,
							which: 9,
							shiftKey: true,
							bubbles: true,
							cancelable: true
						}));
					}
				}} title="Shift+Tab Outdent">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M19 12H5"/>
						<polyline points="11 6 5 12 11 18"/>
						<line x1="3" y1="5" x2="3" y2="19"/>
					</svg>
				</button>

				<div class="fmt-sep"></div>

				<!-- Heading dropdown -->
				<div class="fmt-dropdown-wrap">
					<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('heading'))} onclick={(e) => { e.stopPropagation(); headingDropdown = !headingDropdown; colorDropdown = false; highlightDropdown = false; tablePickerOpen = false; alignDropdown = false; insertDropdown = false; fontDropdown = false; }} title="Heading">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/></svg>
					</button>
					{#if headingDropdown}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="fmt-dropdown" onclick={(e) => e.stopPropagation()}>
							<button class:active={(editorState >= 0 && editor?.isActive('heading', { level: 1 }))} onclick={() => { editor?.chain().focus().toggleHeading({ level: 1 }).run(); headingDropdown = false; }}>Heading 1</button>
							<button class:active={(editorState >= 0 && editor?.isActive('heading', { level: 2 }))} onclick={() => { editor?.chain().focus().toggleHeading({ level: 2 }).run(); headingDropdown = false; }}>Heading 2</button>
							<button class:active={(editorState >= 0 && editor?.isActive('heading', { level: 3 }))} onclick={() => { editor?.chain().focus().toggleHeading({ level: 3 }).run(); headingDropdown = false; }}>Heading 3</button>
							<button class:active={(editorState >= 0 && editor?.isActive('heading', { level: 4 }))} onclick={() => { editor?.chain().focus().toggleHeading({ level: 4 }).run(); headingDropdown = false; }}>Heading 4</button>
							<button class:active={(editorState >= 0 && editor?.isActive('paragraph'))} onclick={() => { editor?.chain().focus().setParagraph().run(); headingDropdown = false; }}>Paragraph</button>
						</div>
					{/if}
				</div>

				<div class="fmt-sep"></div>

				<!-- Font Family dropdown -->
				<div class="fmt-dropdown-wrap">
					<button class="fmt-btn font-select-btn" onclick={(e) => { e.stopPropagation(); fontDropdown = !fontDropdown; fontSizeDropdown = false; headingDropdown = false; colorDropdown = false; highlightDropdown = false; tablePickerOpen = false; alignDropdown = false; insertDropdown = false; }} title="Font Family">
						<svg class="font-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="4 7 4 4 20 4 20 7"/>
							<line x1="9" y1="20" x2="15" y2="20"/>
							<line x1="12" y1="4" x2="12" y2="20"/>
						</svg>
						<span class="font-label">{activeFontLabel}</span>
						<svg class="dropdown-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
					</button>
					{#if fontDropdown}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="fmt-dropdown font-dropdown-list" onclick={(e) => e.stopPropagation()}>
							<div class="font-options-container">
								<button class:active={!editor?.getAttributes('textStyle').fontFamily} onclick={() => setFontFamily('')} style="font-family: inherit;">
									Default Font
								</button>
								{#each allFonts as font}
									<div class="font-option-row">
										<button class:active={editor?.getAttributes('textStyle').fontFamily === font.value} onclick={() => setFontFamily(font.value)} style="font-family: {font.value};">
											{font.name}
										</button>
										{#if customFonts.some(f => f.name === font.name)}
											<button class="font-delete-btn" onclick={() => removeCustomFont(font.name)} title="Remove custom font">
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
											</button>
										{/if}
									</div>
								{/each}
							</div>

							<div class="dropdown-divider"></div>

							<div class="add-font-section">
								<span class="section-title">Add Custom Font</span>
								<div class="add-font-inputs">
									<input type="text" class="font-input" placeholder="e.g. Roboto" bind:value={newFontInput} onkeydown={(e) => { if (e.key === 'Enter') addCustomFont(); }} />
									<button class="apply-btn" onclick={addCustomFont}>Add</button>
								</div>
							</div>
						</div>
					{/if}
				</div>

				<!-- Font Size dropdown -->
				<div class="fmt-dropdown-wrap">
					<button class="fmt-btn font-select-btn" onclick={(e) => { e.stopPropagation(); fontSizeDropdown = !fontSizeDropdown; fontDropdown = false; headingDropdown = false; colorDropdown = false; highlightDropdown = false; tablePickerOpen = false; alignDropdown = false; insertDropdown = false; }} title="Font Size">
						<svg class="font-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M3 17L7 5L11 17" />
							<path d="M5 13H9" />
							<path d="M12 17L15 9L18 17" />
							<path d="M13.5 14.5H16.5" />
						</svg>
						<span class="font-label">{activeSizeLabel}</span>
						<svg class="dropdown-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
					</button>
					{#if fontSizeDropdown}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="fmt-dropdown font-dropdown-list" onclick={(e) => e.stopPropagation()}>
							<div class="font-options-container">
								<button class:active={!editor?.getAttributes('textStyle').fontSize} onclick={() => setFontSize('')}>
									Default Size
								</button>
								{#each allSizes as size}
									<div class="font-option-row">
										<button class:active={editor?.getAttributes('textStyle').fontSize === size} onclick={() => setFontSize(size)}>
											{size}
										</button>
										{#if customSizes.includes(size)}
											<button class="font-delete-btn" onclick={() => removeCustomSize(size)} title="Remove custom size">
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
											</button>
										{/if}
									</div>
								{/each}
							</div>

							<div class="dropdown-divider"></div>

							<div class="add-font-section">
								<span class="section-title">Add Custom Size</span>
								<div class="add-font-inputs">
									<input type="text" class="font-input" placeholder="e.g. 15px" bind:value={newSizeInput} onkeydown={(e) => { if (e.key === 'Enter') addCustomSize(); }} />
									<button class="apply-btn" onclick={addCustomSize}>Add</button>
								</div>
							</div>
						</div>
					{/if}
				</div>

				<div class="fmt-sep"></div>

				<!-- Text formatting -->
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('bold'))} onclick={() => editor?.chain().focus().toggleBold().run()} title={`Bold (${modKey}+B)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h9a4 4 0 010 8H7a1 1 0 01-1-1V5a1 1 0 011-1h7a4 4 0 010 8"/></svg>
				</button>
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('italic'))} onclick={() => editor?.chain().focus().toggleItalic().run()} title={`Italic (${modKey}+I)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>
				</button>
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('underline'))} onclick={() => editor?.chain().focus().toggleUnderline().run()} title={`Underline (${modKey}+U)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6a6 6 0 0012 0V4"/><line x1="4" x2="20" y1="20" y2="20"/></svg>
				</button>
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('strike'))} onclick={() => editor?.chain().focus().toggleStrike().run()} title={`Strikethrough (${modKey}+Shift+X)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 00-2.83 4"/><path d="M14 12a4 4 0 010 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>
				</button>

				<!-- Text color -->
				<div class="fmt-dropdown-wrap">
					<button class="fmt-btn" onclick={(e) => { e.stopPropagation(); colorDropdown = !colorDropdown; headingDropdown = false; highlightDropdown = false; tablePickerOpen = false; alignDropdown = false; insertDropdown = false; fontDropdown = false; }} title="Text Color">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="m6 16 6-12 6 12"/><path d="M8 12h8"/></svg>
						<span class="color-indicator" style="background: {editor?.getAttributes('textStyle').color || 'var(--accent)'}"></span>
					</button>
					{#if colorDropdown}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="fmt-dropdown color-picker-dropdown" onclick={(e) => e.stopPropagation()}>
							<div class="color-grid">
								{#each textColors as color}
									<button class="color-swatch" title={color.name} onclick={() => setTextColor(color.value)} style="background: {color.value || 'var(--text-primary)'}">
										{#if (color.value === '' && !editor?.getAttributes('textStyle').color) || editor?.getAttributes('textStyle').color === color.value}
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
										{/if}
									</button>
								{/each}
							</div>

							<div class="dropdown-divider"></div>

							<div class="custom-color-section">
								<span class="section-title">Custom</span>
								<div class="custom-color-inputs">
									<label class="native-picker-label">
										<input type="color" bind:value={customTextColorInput} oninput={() => applyCustomTextColor(customTextColorInput)} />
										<span class="picker-preview" style="background: {customTextColorInput}"></span>
									</label>
									<input type="text" class="hex-input" placeholder="#000000" bind:value={customTextColorInput} onkeydown={(e) => { if (e.key === 'Enter') applyCustomTextColor(customTextColorInput); }} />
									<button class="apply-btn" onclick={() => applyCustomTextColor(customTextColorInput)}>Apply</button>
								</div>
							</div>

							{#if recentTextColors.length > 0}
								<div class="dropdown-divider"></div>
								<div class="recent-colors-section">
									<span class="section-title">Recent</span>
									<div class="recent-swatches">
										{#each recentTextColors as color}
											<button class="color-swatch recent-swatch" title={color} onclick={() => setTextColor(color)} style="background: {color}">
												{#if editor?.getAttributes('textStyle').color === color}
													<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
												{/if}
											</button>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<div class="fmt-sep"></div>

				<!-- Link -->
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('link'))} onclick={addLinkFromToolbar} title={`Link (${modKey}+K)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
				</button>

				<div class="fmt-sep"></div>

				<!-- Lists -->
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('bulletList'))} onclick={() => editor?.chain().focus().toggleBulletList().run()} title={`Bullet List (${modKey}+Shift+8)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg>
				</button>
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('orderedList'))} onclick={() => editor?.chain().focus().toggleOrderedList().run()} title={`Ordered List (${modKey}+Shift+7)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h10"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 00-2.6-1.02"/></svg>
				</button>


				<div class="fmt-sep"></div>

				<!-- Undo / Redo -->
				<button class="fmt-btn" onclick={() => editor?.chain().focus().undo().run()} title={`Undo (${modKey}+Z)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 015.5 5.5 5.5 5.5 0 01-5.5 5.5H11"/></svg>
				</button>
				<button class="fmt-btn" onclick={() => editor?.chain().focus().redo().run()} title={`Redo (${modKey}+Shift+Z)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 004 14.5 5.5 5.5 0 009.5 20H13"/></svg>
				</button>

				<div class="fmt-sep"></div>

				<!-- Code & Code Block -->
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('code'))} onclick={() => editor?.chain().focus().toggleCode().run()} title={`Inline Code (${modKey}+E)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>
				</button>
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('codeBlock'))} onclick={() => editor?.chain().focus().toggleCodeBlock().run()} title={`Code Block (${modKey}+Alt+C)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 9-3 3 3 3"/><path d="m14 15 3-3-3-3"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
				</button>

				<!-- Blockquote -->
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('blockquote'))} onclick={() => editor?.chain().focus().toggleBlockquote().run()} title={`Quote (${modKey}+Shift+B)`}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 5H3"/><path d="M21 12H8"/><path d="M21 19H8"/><path d="M3 12v7"/></svg>
				</button>

				<!-- Collapsible Section -->
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('details'))} onclick={() => insertDetails()} title="Collapsible Section">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="7" x="8" y="3" rx="1"/><path d="m2 9 3 3-3 3"/><rect width="13" height="7" x="8" y="14" rx="1"/></svg>
				</button>

				<!-- Table -->
				<div class="fmt-dropdown-wrap">
					<button class="fmt-btn" onclick={(e) => { e.stopPropagation(); tablePickerOpen = !tablePickerOpen; headingDropdown = false; colorDropdown = false; highlightDropdown = false; alignDropdown = false; insertDropdown = false; }} title="Insert Table">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>
					</button>
					{#if tablePickerOpen}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="fmt-dropdown table-picker-dropdown" onclick={(e) => e.stopPropagation()}>
							<div class="table-picker-grid">
								{#each Array(8) as _, r}
									{#each Array(10) as _, c}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="table-picker-cell"
											class:active={r < tablePickerHover.rows && c < tablePickerHover.cols}
											onmouseenter={() => tablePickerHover = { rows: r + 1, cols: c + 1 }}
											onmousedown={(e) => { e.preventDefault(); insertTable(r + 1, c + 1); }}
											ontouchstart={(e) => { e.preventDefault(); insertTable(r + 1, c + 1); }}
										></div>
									{/each}
								{/each}
							</div>
							<div class="table-picker-label">
								{tablePickerHover.rows > 0 ? `${tablePickerHover.rows} x ${tablePickerHover.cols}` : 'Select size'}
							</div>
						</div>
					{/if}
				</div>

				<!-- Horizontal Rule -->
				<button class="fmt-btn" onclick={() => editor?.chain().focus().setHorizontalRule().run()} title="Horizontal Rule">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>
				</button>

				<div class="fmt-sep"></div>

				<!-- Highlight -->
				<div class="fmt-dropdown-wrap">
					<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('highlight'))} onclick={(e) => { e.stopPropagation(); highlightDropdown = !highlightDropdown; headingDropdown = false; colorDropdown = false; tablePickerOpen = false; alignDropdown = false; insertDropdown = false; fontDropdown = false; }} title={`Highlight (${modKey}+Shift+H)`}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4"/></svg>
						<span class="color-indicator" style="background: {editor?.getAttributes('highlight').color || 'var(--accent)'}"></span>
					</button>
					{#if highlightDropdown}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="fmt-dropdown color-picker-dropdown" onclick={(e) => e.stopPropagation()}>
							<div class="color-grid">
								{#each highlightColors as color}
									<button class="color-swatch" title={color.name} onclick={() => setHighlightColor(color.value)} style="background: {color.swatch}">
										{#if editor?.isActive('highlight', { color: color.value })}
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
										{/if}
									</button>
								{/each}
								<button class="color-swatch" title="Remove highlight" onclick={() => setHighlightColor('')} style="background: var(--bg-tertiary);">
									{#if !editor?.isActive('highlight')}
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
									{:else}
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
									{/if}
								</button>
							</div>

							<div class="dropdown-divider"></div>

							<div class="custom-color-section">
								<span class="section-title">Custom</span>
								<div class="custom-color-inputs">
									<label class="native-picker-label">
										<input type="color" bind:value={customHighlightColorInput} oninput={() => applyCustomHighlightColor(customHighlightColorInput)} />
										<span class="picker-preview" style="background: {customHighlightColorInput}"></span>
									</label>
									<input type="text" class="hex-input" placeholder="#ffff00" bind:value={customHighlightColorInput} onkeydown={(e) => { if (e.key === 'Enter') applyCustomHighlightColor(customHighlightColorInput); }} />
									<button class="apply-btn" onclick={() => applyCustomHighlightColor(customHighlightColorInput)}>Apply</button>
								</div>
							</div>

							{#if recentHighlightColors.length > 0}
								<div class="dropdown-divider"></div>
								<div class="recent-colors-section">
									<span class="section-title">Recent</span>
									<div class="recent-swatches">
										{#each recentHighlightColors as color}
											<button class="color-swatch recent-swatch" title={color} onclick={() => setHighlightColor(color)} style="background: {color}">
												{#if editor?.isActive('highlight', { color: color })}
													<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
												{/if}
											</button>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Subscript & Superscript -->
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('subscript'))} onclick={() => editor?.chain().focus().toggleSubscript().run()} title="Subscript">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 5 8 8"/><path d="m12 5-8 8"/><path d="M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 00-2.62-.44c-.42.24-.74.62-.9 1.07"/></svg>
				</button>
				<button class="fmt-btn" class:active={(editorState >= 0 && editor?.isActive('superscript'))} onclick={() => editor?.chain().focus().toggleSuperscript().run()} title="Superscript">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 19 8-8"/><path d="m12 19-8-8"/><path d="M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7.002c0-.472-.17-.93-.484-1.29a2.105 2.105 0 00-2.617-.436c-.42.239-.738.614-.899 1.06"/></svg>
				</button>

				<div class="fmt-sep"></div>

				<!-- Text Alignment -->
				<div class="fmt-dropdown-wrap">
					<button class="fmt-btn" onclick={(e) => { e.stopPropagation(); alignDropdown = !alignDropdown; headingDropdown = false; colorDropdown = false; highlightDropdown = false; tablePickerOpen = false; insertDropdown = false; }} title="Text Alignment">
						{#if (editorState >= 0 && editor?.isActive({ textAlign: 'center' }))}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H3"/><path d="M17 12H7"/><path d="M19 19H5"/></svg>
						{:else if (editorState >= 0 && editor?.isActive({ textAlign: 'right' }))}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H3"/><path d="M21 12H9"/><path d="M21 19H7"/></svg>
						{:else if (editorState >= 0 && editor?.isActive({ textAlign: 'justify' }))}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18"/><path d="M3 12h18"/><path d="M3 19h18"/></svg>
						{:else}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/></svg>
						{/if}
					</button>
					{#if alignDropdown}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="fmt-dropdown align-dropdown" onclick={(e) => e.stopPropagation()}>
							<button class:active={(editorState >= 0 && editor?.isActive({ textAlign: 'left' }))} onclick={() => { editor?.chain().focus().setTextAlign('left').run(); alignDropdown = false; }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/></svg>
								Left
							</button>
							<button class:active={(editorState >= 0 && editor?.isActive({ textAlign: 'center' }))} onclick={() => { editor?.chain().focus().setTextAlign('center').run(); alignDropdown = false; }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H3"/><path d="M17 12H7"/><path d="M19 19H5"/></svg>
								Center
							</button>
							<button class:active={(editorState >= 0 && editor?.isActive({ textAlign: 'right' }))} onclick={() => { editor?.chain().focus().setTextAlign('right').run(); alignDropdown = false; }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H3"/><path d="M21 12H9"/><path d="M21 19H7"/></svg>
								Right
							</button>
							<button class:active={(editorState >= 0 && editor?.isActive({ textAlign: 'justify' }))} onclick={() => { editor?.chain().focus().setTextAlign('justify').run(); alignDropdown = false; }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18"/><path d="M3 12h18"/><path d="M3 19h18"/></svg>
								Justify
							</button>
						</div>
					{/if}
				</div>

				<div class="fmt-sep"></div>

				<!-- Indent / Outdent -->
				<button class="fmt-btn" onclick={() => {
					if (!editor) return;
					// Try list indent first - run() returns true if it succeeded
					const sank = editor.chain().focus().sinkListItem('listItem').run();
					if (!sank) {
						const sankTask = editor.chain().focus().sinkListItem('taskItem').run();
						if (!sankTask && editor.state.selection.empty) {
							editor.chain().focus().insertContent('\t').run();
						}
					}
				}} title="Indent (Tab)">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="4" x2="21" y2="4"/><line x1="11" y1="9" x2="21" y2="9"/><line x1="11" y1="14" x2="21" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/><polyline points="3 9 7 11.5 3 14"/></svg>
				</button>
				<button class="fmt-btn" onclick={() => {
					if (!editor) return;
					const lifted = editor.chain().focus().liftListItem('listItem').run();
					if (!lifted) {
						const liftedTask = editor.chain().focus().liftListItem('taskItem').run();
						if (!liftedTask && editor.state.selection.empty) {
							// Remove leading tab/spaces from current line
							const { from } = editor.state.selection;
							const pos = editor.state.doc.resolve(from);
							const lineStart = pos.start(pos.depth);
							const lineText = editor.state.doc.textBetween(lineStart, pos.end(pos.depth));
							if (lineText.startsWith('\t')) {
								editor.chain().focus().command(({ tr }) => {
									tr.delete(lineStart, lineStart + 1);
									return true;
								}).run();
							} else if (lineText.startsWith('    ')) {
								editor.chain().focus().command(({ tr }) => {
									tr.delete(lineStart, lineStart + 4);
									return true;
								}).run();
							} else if (lineText.startsWith('  ')) {
								editor.chain().focus().command(({ tr }) => {
									tr.delete(lineStart, lineStart + 2);
									return true;
								}).run();
							}
						}
					}
				}} title="Outdent (Shift+Tab)">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="4" x2="21" y2="4"/><line x1="11" y1="9" x2="21" y2="9"/><line x1="11" y1="14" x2="21" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/><polyline points="7 9 3 11.5 7 14"/></svg>
				</button>
			</div>
		{/if}
	{/if}

	<!-- Hidden file inputs for Insert dropdown -->
	<input type="file" id="insert-image-input" accept="image/*" style="display:none" onchange={(e) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) insertImage(file);
		(e.target as HTMLInputElement).value = '';
	}} />
	<input type="file" id="insert-file-input" style="display:none" onchange={(e) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) {
			if (file.type.startsWith('image/')) insertImage(file);
			else if (file.type === 'application/pdf') insertPdf(file);
			else insertFileAttachment(file);
		}
		(e.target as HTMLInputElement).value = '';
	}} />
</div>

{#if linkContextMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="link-context-overlay" onclick={closeLinkContextMenu}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="link-context-menu" style="left: {linkContextMenu.x}px; top: {linkContextMenu.y}px" onclick={(e) => e.stopPropagation()}>
			<div class="link-context-url">{linkContextMenu.href}</div>
			<button onclick={linkMenuOpen}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
					<polyline points="15 3 21 3 21 9" />
					<line x1="10" y1="14" x2="21" y2="3" />
				</svg>
				Open Link
			</button>
			{#if isFileLink(linkContextMenu.href)}
			<button onclick={linkMenuSaveAs}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
				</svg>
				Save As...
			</button>
			{/if}
			<button onclick={linkMenuCopy}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
					<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
				</svg>
				Copy Link
			</button>
			<button onclick={linkMenuEdit}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
					<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
				</svg>
				Edit Link
			</button>
			<div class="link-context-sep"></div>
			<button class="danger" onclick={linkMenuRemove}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
				Remove Link
			</button>
		</div>
	</div>
{/if}

{#if textContextMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="text-ctx-overlay" onclick={closeTextContextMenu}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="text-ctx-menu" style="left: {textContextMenu.x}px; top: {textContextMenu.y}px" onclick={(e) => e.stopPropagation()}>
			<button onclick={ctxCut}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
				Cut
				<span class="text-ctx-shortcut">{modKey}+X</span>
			</button>
			<button onclick={ctxCopy}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
				Copy
				<span class="text-ctx-shortcut">{modKey}+C</span>
			</button>
			<button onclick={ctxPaste}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
				Paste
				<span class="text-ctx-shortcut">{modKey}+V</span>
			</button>
			<div class="text-ctx-sep"></div>
			<button onclick={ctxSelectAll}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7h8M8 12h8M8 17h8"/></svg>
				Select All
				<span class="text-ctx-shortcut">{modKey}+A</span>
			</button>
			<div class="text-ctx-sep"></div>
			<!-- Heading submenu -->
			<div class="text-ctx-submenu-wrap" onmouseenter={() => ctxHeadingSubmenu = true} onmouseleave={() => ctxHeadingSubmenu = false}>
				<button class="has-submenu">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M4 6v12M20 6v12"/></svg>
					Heading
					<svg class="submenu-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 6 15 12 9 18"/></svg>
				</button>
				{#if ctxHeadingSubmenu}
					<div class="text-ctx-submenu">
						<button class:active={(editorState >= 0 && editor?.isActive('heading', { level: 1 }))} onclick={() => ctxSetHeading(1)}>Heading 1</button>
						<button class:active={(editorState >= 0 && editor?.isActive('heading', { level: 2 }))} onclick={() => ctxSetHeading(2)}>Heading 2</button>
						<button class:active={(editorState >= 0 && editor?.isActive('heading', { level: 3 }))} onclick={() => ctxSetHeading(3)}>Heading 3</button>
						<button class:active={(editorState >= 0 && editor?.isActive('heading', { level: 4 }))} onclick={() => ctxSetHeading(4)}>Heading 4</button>
						<div class="text-ctx-sep"></div>
						<button class:active={(editorState >= 0 && editor?.isActive('paragraph'))} onclick={ctxSetParagraph}>Paragraph</button>
					</div>
				{/if}
			</div>
			<div class="text-ctx-sep"></div>
			<button onclick={ctxBold}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6zm0 8h9a4 4 0 014 4 4 4 0 01-4 4H6z"/></svg>
				Bold
				<span class="text-ctx-shortcut">{modKey}+B</span>
			</button>
			<button onclick={ctxItalic}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
				Italic
				<span class="text-ctx-shortcut">{modKey}+I</span>
			</button>
			<button onclick={ctxUnderline}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a6 6 0 006 6 6 6 0 006-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>
				Underline
				<span class="text-ctx-shortcut">{modKey}+U</span>
			</button>
			<button onclick={ctxStrike}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 00-3 3 3 3 0 003 3h6"/><line x1="4" y1="12" x2="20" y2="12"/><path d="M8 20h7a3 3 0 003-3 3 3 0 00-3-3H8"/></svg>
				Strikethrough
			</button>
			<button onclick={ctxHighlight}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
				Highlight
			</button>
			<div class="text-ctx-sep"></div>
			<button onclick={ctxLink}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
				Add Link
				<span class="text-ctx-shortcut">{modKey}+K</span>
			</button>
			<button onclick={ctxCode}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
				Inline Code
			</button>
			<button onclick={ctxCodeBlock}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 8 5 12 9 16"/><polyline points="15 8 19 12 15 16"/></svg>
				Code Block
			</button>
			<button onclick={ctxBlockquote}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h4v4l-2 6H3l2-6H3V6zm10 0h4v4l-2 6h-2l2-6h-2V6z"/></svg>
				Quote
			</button>
			<button onclick={ctxDetails}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="10 8 14 12 10 16"/></svg>
				Collapsible Section
			</button>
			<button onclick={ctxTimestamp}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><circle cx="18" cy="17" r="4"/><path d="M18 15.5v1.5l1 1"/></svg>
				Date &amp; Time
			</button>
			<div class="text-ctx-sep"></div>
			<button onclick={ctxBulletList}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.5" fill="currentColor"/><circle cx="3.5" cy="12" r="1.5" fill="currentColor"/><circle cx="3.5" cy="18" r="1.5" fill="currentColor"/></svg>
				Bullet List
			</button>
			<button onclick={ctxOrderedList}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" font-size="8" fill="currentColor" stroke="none" font-weight="600">1</text><text x="1" y="14" font-size="8" fill="currentColor" stroke="none" font-weight="600">2</text><text x="1" y="20" font-size="8" fill="currentColor" stroke="none" font-weight="600">3</text></svg>
				Numbered List
			</button>

			{#if $appConfig?.ai_provider}
				<div class="text-ctx-sep"></div>
				<button onclick={openAiMenu}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M12 2a4 4 0 014 4v1a1 1 0 001 1h1a4 4 0 010 8h-1a1 1 0 00-1 1v1a4 4 0 01-8 0v-1a1 1 0 00-1-1H6a4 4 0 010-8h1a1 1 0 001-1V6a4 4 0 014-4z" />
						<circle cx="12" cy="12" r="2" />
					</svg>
					AI Actions
				</button>
			{/if}
		</div>
	</div>
{/if}

{#if tableContextMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="table-ctx-overlay" onclick={closeTableContextMenu}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="table-ctx-menu" style="left: {tableContextMenu.x}px; top: {tableContextMenu.y}px" onclick={(e) => e.stopPropagation()}>
			<button onclick={tblAddRowBefore}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/><path d="M12 3v3"/><polyline points="9 4.5 12 2 15 4.5"/></svg>
				Add Row Above
			</button>
			<button onclick={tblAddRowAfter}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/><path d="M12 21v-3"/><polyline points="9 19.5 12 22 15 19.5"/></svg>
				Add Row Below
			</button>
			<button class="danger" onclick={tblDeleteRow}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
				Delete Row
			</button>
			<div class="table-ctx-sep"></div>
			<button onclick={tblAddColBefore}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v18M12 3v18M18 3v18"/><path d="M3 12h3"/><polyline points="4.5 9 2 12 4.5 15"/></svg>
				Add Column Left
			</button>
			<button onclick={tblAddColAfter}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v18M12 3v18M18 3v18"/><path d="M21 12h-3"/><polyline points="19.5 9 22 12 19.5 15"/></svg>
				Add Column Right
			</button>
			<button class="danger" onclick={tblDeleteCol}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
				Delete Column
			</button>
			<div class="table-ctx-sep"></div>
			<button onclick={tblMergeCells}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M14 9l-4 3 4 3"/></svg>
				Merge Cells
			</button>
			<button onclick={tblSplitCell}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M8 9l4 3-4 3"/><path d="M16 9l-4 3 4 3"/></svg>
				Split Cell
			</button>
			<div class="table-ctx-sep"></div>
			<button onclick={tblToggleHeaderRow}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><rect x="4" y="4" width="16" height="4" rx="1" fill="currentColor" opacity="0.2"/></svg>
				Toggle Header Row
			</button>
			<button onclick={tblToggleHeaderCol}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><rect x="4" y="4" width="4" height="16" rx="1" fill="currentColor" opacity="0.2"/></svg>
				Toggle Header Column
			</button>
			<div class="table-ctx-sep"></div>
			<div class="table-ctx-color-label">Cell Color</div>
			<div class="table-ctx-colors">
				{#each cellColors as color}
					<button
						class="table-ctx-color-swatch"
						title={color.name}
						style="background: {color.value || 'var(--bg-primary)'}; {color.value === '' ? 'border: 1px dashed var(--border-color);' : ''}"
						onclick={() => tblSetCellColor(color.value)}
					></button>
				{/each}
			</div>
			<div class="table-ctx-sep"></div>
			<button class="danger" onclick={tblDeleteTable}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
				Delete Table
			</button>
		</div>
	</div>
{/if}

{#if imageToolbar}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="img-toolbar-overlay" onclick={() => (imageToolbar = null)}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="img-toolbar" class:mobile={isMobile} style="left: {imageToolbar.x}px; top: {imageToolbar.y}px" onclick={(e) => e.stopPropagation()}>
			<button class:active={imageToolbar.size === 'small'} onclick={() => setImageSize('small')} title="Small (33%)">S</button>
			<button class:active={imageToolbar.size === 'medium'} onclick={() => setImageSize('medium')} title="Medium (50%)">M</button>
			<button class:active={imageToolbar.size === 'full'} onclick={() => setImageSize('full')} title="Full width">L</button>
			{#if !isMobile && !imageToolbar.src.startsWith('imgproxy:') && !imageToolbar.src.startsWith('http://imgproxy.localhost')}
				<span class="img-toolbar-sep"></span>
				<button onclick={copyImageToClipboard} title="Copy image">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
				</button>
				<button onclick={openImageInApp} title="Open in default app">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
				</button>
			{/if}
		</div>
	</div>
{/if}

{#if diagramToolbar}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="img-toolbar-overlay" onclick={() => (diagramToolbar = null)}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="img-toolbar" class:mobile={isMobile} style="left: {diagramToolbar.x}px; top: {diagramToolbar.y}px" onclick={(e) => e.stopPropagation()}>
			<!-- Sizing options -->
			<button class:active={diagramToolbar.size === 'small'} onclick={() => setDiagramSize('small')} title="Small (33%)">S</button>
			<button class:active={diagramToolbar.size === 'medium'} onclick={() => setDiagramSize('medium')} title="Medium (65%)">M</button>
			<button class:active={diagramToolbar.size === 'full'} onclick={() => setDiagramSize('full')} title="Full width">L</button>
			
			<span class="img-toolbar-sep"></span>
			
			<!-- Alignment options -->
			<button class:active={diagramToolbar.align === 'left'} onclick={() => setDiagramAlign('left')} title="Align left">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
			</button>
			<button class:active={diagramToolbar.align === 'center'} onclick={() => setDiagramAlign('center')} title="Align center">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="18" y1="18" x2="6" y2="18"/></svg>
			</button>
			<button class:active={diagramToolbar.align === 'right'} onclick={() => setDiagramAlign('right')} title="Align right">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="10" x2="7" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="7" y2="18"/></svg>
			</button>
			
			<span class="img-toolbar-sep"></span>
			
			<!-- Edit option -->
			<button onclick={() => {
				const pos = diagramToolbar?.pos;
				if (pos !== undefined && pos !== null && editor) {
					const node = editor.state.doc.nodeAt(pos);
					if (node) {
						openDiagramEditor(pos, node.attrs.data || '');
					}
				}
				diagramToolbar = null;
			}} title="Edit diagram">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
			</button>
		</div>
	</div>
{/if}

{#if copyToast}
	<div class="copy-toast" class:done={copyToast === 'done'}>
		{#if copyToast === 'copying'}
			<svg class="copy-toast-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
				<circle cx="12" cy="12" r="10" opacity="0.25" />
				<path d="M12 2a10 10 0 019.95 9" />
			</svg>
			Copying...
		{:else}
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="20 6 9 17 4 12" />
			</svg>
			Copied
		{/if}
	</div>
{/if}

<!-- Old task bar removed, replaced with floating HUD -->



{#if mathModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="math-modal-overlay" onclick={cancelMathModal}>
		<div class="math-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Math editor">
			<div class="math-modal-header">
				<span>{mathModal.editPos !== null ? 'Edit' : 'Insert'} {mathModal.kind === 'block' ? 'Math Block' : 'Inline Math'}</span>
				<button type="button" class="math-modal-close" onclick={cancelMathModal} aria-label="Close">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
				</button>
			</div>
			<textarea
				class="math-modal-input"
				placeholder="LaTeX, e.g. E = mc^2"
				bind:value={mathModal.tex}
				onkeydown={(e) => {
					if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commitMathModal(); }
					if (e.key === 'Escape') { e.preventDefault(); cancelMathModal(); }
				}}
				autofocus
			></textarea>
			<div class="math-modal-preview">
				{#if mathModal.tex.trim()}
					<div>{@html renderMathPreview(mathModal.tex, mathModal.kind === 'block')}</div>
				{:else}
					<span class="math-modal-preview-empty">Preview appears here…</span>
				{/if}
			</div>
			<div class="math-modal-footer">
				<span class="math-modal-hint">{modKey}+Enter to {mathModal.editPos !== null ? 'update' : 'insert'} · Esc to cancel</span>
				<div class="math-modal-actions">
					<button type="button" onclick={cancelMathModal}>Cancel</button>
					<button type="button" class="primary" onclick={commitMathModal} disabled={!mathModal.tex.trim()}>
						{mathModal.editPos !== null ? 'Update' : 'Insert'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if viewerImportPickerOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="viewer-import-overlay" onclick={() => (viewerImportPickerOpen = false)}>
		<div class="viewer-import-picker" onclick={(e) => e.stopPropagation()} role="dialog">
			<div class="viewer-import-header">
				<span>Import to folder</span>
				<button type="button" class="viewer-import-close" onclick={() => (viewerImportPickerOpen = false)} aria-label="Close">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
				</button>
			</div>
			<div class="viewer-import-list">
				<button type="button" class="viewer-import-item" onclick={() => viewerImportTo('')} disabled={viewerImportBusy}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
					Vault root
				</button>
				{#each viewerFlatNotebooks as nb (nb.path)}
					<button type="button" class="viewer-import-item" style="padding-left: {12 + nb.depth * 16}px" onclick={() => viewerImportTo(nb.path)} disabled={viewerImportBusy}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
						{nb.name}
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}

{#if codeLangDropdown}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="code-lang-overlay" onclick={closeCodeLangDropdown}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="code-lang-dropdown" class:open-up={codeLangDropdown.openUp} class:align-right={codeLangDropdown.alignRight} style="left: {codeLangDropdown.x}px; top: {codeLangDropdown.y}px" onclick={(e) => e.stopPropagation()}>
			<div class="code-lang-search-wrapper">
				<input
					type="text"
					class="code-lang-search"
					placeholder="Search language..."
					bind:value={codeLangSearchQuery}
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							closeCodeLangDropdown();
						} else if (e.key === 'Enter') {
							e.preventDefault();
							if (filteredCodeLanguages.length > 0) {
								selectCodeLang(filteredCodeLanguages[0]);
							}
						}
					}}
					autofocus
				/>
			</div>
			<div class="code-lang-options-list">
				<button
					class="code-lang-option"
					class:active={codeLangDropdown.current === ''}
					onclick={() => selectCodeLang('')}
				>Plain Text (auto)</button>
				{#each filteredCodeLanguages as lang}
					<button
						class="code-lang-option"
						class:active={codeLangDropdown.current === lang}
						onclick={() => selectCodeLang(lang)}
					>{lang}</button>
				{/each}
			</div>
		</div>
	</div>
{/if}

{#if slashMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="slash-menu-overlay" onclick={closeSlashMenu}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="slash-menu" style="left: {slashMenu.x}px; top: {slashMenu.y}px" onclick={(e) => e.stopPropagation()}>
			{#if slashTablePicker}
				<div class="slash-table-picker">
					<div class="slash-table-picker-grid">
						{#each Array(8) as _, r}
							{#each Array(10) as _, c}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="table-picker-cell"
									class:active={r < slashTableHover.rows && c < slashTableHover.cols}
									onmouseenter={() => slashTableHover = { rows: r + 1, cols: c + 1 }}
									onmousedown={(e) => { e.preventDefault(); slashInsertTable(r + 1, c + 1); }}
									ontouchstart={(e) => { e.preventDefault(); slashInsertTable(r + 1, c + 1); }}
								></div>
							{/each}
						{/each}
					</div>
					<div class="slash-table-picker-label">
						{slashTableHover.rows > 0 ? `${slashTableHover.rows} x ${slashTableHover.cols}` : 'Select table size'}
					</div>
				</div>
			{:else if slashColorPicker}
				<div class="slash-color-picker">
					<div class="slash-color-swatches">
						{#each colorPresets as c}
							<button class="slash-color-swatch" style="background: {c}" title={c} aria-label={c} onmousedown={(e) => { e.preventDefault(); insertColor(c); }}></button>
						{/each}
					</div>
					<div class="slash-color-row">
						<input type="color" class="slash-color-native" value={/^#[0-9a-fA-F]{6}$/.test(slashColorHex) ? slashColorHex : '#4b6abf'} oninput={(e) => { slashColorHex = (e.target as HTMLInputElement).value; }} title="Pick a color" />
						<input
							type="text"
							class="slash-color-input"
							bind:this={slashColorInputEl}
							value={slashColorHex}
							placeholder="#hex or rgb(...)"
							oninput={(e) => { slashColorHex = (e.target as HTMLInputElement).value; }}
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertColor(slashColorHex); } else if (e.key === 'Escape') { e.preventDefault(); closeSlashMenu(); } }}
						/>
						<button class="slash-color-insert" onmousedown={(e) => { e.preventDefault(); insertColor(slashColorHex); }}>Insert</button>
					</div>
				</div>
			{:else if slashFiltered.flatList.length === 0}
				<div class="slash-menu-empty">No matching commands</div>
			{:else}
				{#if slashFiltered.fonts.length > 0}
					<div class="slash-menu-category-header">Font Family</div>
					{#each slashFiltered.fonts as font, idx}
						<button
							class="slash-menu-item"
							class:selected={idx === slashSelectedIndex}
							onmouseenter={() => slashSelectedIndex = idx}
							onmousedown={(e) => { e.preventDefault(); executeSlashCommand(idx); }}
						>
							<span class="slash-menu-icon" style="font-family: {font.value || 'inherit'}; font-weight: 700;">Aa</span>
							<div class="slash-menu-details">
								<span class="slash-menu-label" style="font-family: {font.value || 'inherit'};">{font.label}</span>
							</div>
						</button>
					{/each}
					{#if slashFiltered.sizes.length > 0 || slashFiltered.colors.length > 0 || slashFiltered.commands.length > 0}
						<div class="slash-menu-category-divider"></div>
					{/if}
				{/if}

				{#if slashFiltered.sizes.length > 0}
					<div class="slash-menu-category-header">Font Size</div>
					{#each slashFiltered.sizes as size, idx}
						{@const globalIdx = slashFiltered.fonts.length + idx}
						<button
							class="slash-menu-item"
							class:selected={globalIdx === slashSelectedIndex}
							onmouseenter={() => slashSelectedIndex = globalIdx}
							onmousedown={(e) => { e.preventDefault(); executeSlashCommand(globalIdx); }}
						>
							<span class="slash-menu-icon" style="font-size: 11px; font-weight: 700;">{size.label.replace('px', '')}</span>
							<div class="slash-menu-details">
								<span class="slash-menu-label">{size.label}</span>
							</div>
						</button>
					{/each}
				{/if}

				{#if slashFiltered.colors.length > 0}
					{#if slashFiltered.fonts.length > 0 || slashFiltered.sizes.length > 0}
						<div class="slash-menu-category-divider"></div>
					{/if}
					<div class="slash-menu-category-header">Font Color</div>
					{#each slashFiltered.colors as color, idx}
						{@const globalIdx = slashFiltered.fonts.length + slashFiltered.sizes.length + idx}
						<button
							class="slash-menu-item"
							class:selected={globalIdx === slashSelectedIndex}
							onmouseenter={() => slashSelectedIndex = globalIdx}
							onmousedown={(e) => { e.preventDefault(); executeSlashCommand(globalIdx); }}
						>
							<span class="slash-menu-icon" style="color: {color.value}; font-weight: 700;">Aa</span>
							<div class="slash-menu-details">
								<span class="slash-menu-label" style="color: {color.value};">{color.label}</span>
							</div>
						</button>
					{/each}
				{/if}

				{#each slashFiltered.commands as cmd, i}
					{@const globalIdx = slashFiltered.fonts.length + slashFiltered.sizes.length + slashFiltered.colors.length + i}
					{#if i === 0 || cmd.category !== slashFiltered.commands[i - 1].category}
						{#if i > 0 || (i === 0 && (slashFiltered.fonts.length > 0 || slashFiltered.sizes.length > 0 || slashFiltered.colors.length > 0))}
							<div class="slash-menu-category-divider"></div>
						{/if}
						<div class="slash-menu-category-header">
							{cmd.category === 'insert' ? 'Insert Blocks' : cmd.category === 'text' ? 'Text Styles' : 'Utilities'}
						</div>
					{/if}
					<button
						class="slash-menu-item"
						class:selected={globalIdx === slashSelectedIndex}
						onmouseenter={() => slashSelectedIndex = globalIdx}
						onmousedown={(e) => { e.preventDefault(); executeSlashCommand(globalIdx); }}
					>
						<span class="slash-menu-icon">{@html cmd.icon}</span>
						<div class="slash-menu-details">
							<div class="slash-menu-details-row">
								<span class="slash-menu-label">{cmd.label}</span>
								{#if cmd.badge}
									<span class="slash-menu-badge">{cmd.badge}</span>
								{/if}
							</div>
							{#if cmd.description}
								<span class="slash-menu-desc">{cmd.description}</span>
							{/if}
						</div>
					</button>
				{/each}
			{/if}
		</div>
	</div>
{/if}

{#if wikiLinkMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="wiki-link-overlay" onclick={closeWikiLinkMenu}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="wiki-link-menu" style="left: {wikiLinkMenu.x}px; top: {wikiLinkMenu.y}px" onclick={(e) => e.stopPropagation()}>
			{#if wikiLinkFiltered.length === 0}
				<div class="wiki-link-empty">
					{wikiLinkMenu.query ? 'No matching notes' : 'Type to search notes...'}
				</div>
			{:else}
				{#each wikiLinkFiltered.slice(0, 12) as entry, i}
					<button
						class="wiki-link-item"
						class:selected={i === wikiLinkSelectedIndex}
						onmouseenter={() => wikiLinkSelectedIndex = i}
						onmousedown={(e) => { e.preventDefault(); if (wikiLinkDisambigEntries) { insertWikiLink({ ...entry, title: wikiLinkDisambigDisplay || entry.title }, wikiLinkDisambigRef || undefined); } else { insertWikiLink(entry); } }}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
						<span class="wiki-link-title-col">
							<span class="wiki-link-title">{entry.title}</span>
							{#if wikiLinkFolderPath(entry)}
								<span class="wiki-link-folder">{wikiLinkFolderPath(entry)}</span>
							{/if}
						</span>
					</button>
				{/each}
			{/if}
		</div>
	</div>
{/if}

{#if wikiLinkNavDisambig}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="wiki-link-overlay" onclick={() => wikiLinkNavDisambig = null}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="wiki-link-menu" style="left: {wikiLinkNavDisambig.x}px; top: {wikiLinkNavDisambig.y}px" onclick={(e) => e.stopPropagation()}>
			<div class="wiki-link-disambig-header">Multiple notes found - choose one:</div>
			{#each wikiLinkNavDisambig.entries as entry, i}
				<button
					class="wiki-link-item"
					class:selected={i === wikiLinkNavDisambigIndex}
					onmouseenter={() => wikiLinkNavDisambigIndex = i}
					onmousedown={(e) => { e.preventDefault(); navigateToWikiLinkDirect(entry); }}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
					<span class="wiki-link-title-col">
						<span class="wiki-link-title">{entry.title}</span>
						<span class="wiki-link-folder">{wikiLinkFolderPath(entry) || '(vault root)'}</span>
					</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

{#if aiMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="ai-menu-overlay" class:mobile={isMobile} onclick={closeAiMenu}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="ai-menu" class:mobile={isMobile} style={isMobile ? '' : `left: ${aiMenu.x}px; top: ${aiMenu.y}px`} onclick={(e) => e.stopPropagation()}>
			{#if aiResult !== null || aiLoading}
				<!-- Result view -->
				<div class="ai-result-header">
					<span class="ai-result-title">
						{#if aiLoading}
							<svg class="ai-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 019.95 9" /></svg>
							Generating...
						{:else}
							AI Result
						{/if}
					</span>
					<button class="ai-result-close" onclick={closeAiMenu}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
					</button>
				</div>
				{#if aiError}
					<div class="ai-error">{aiError}</div>
				{:else}
					<div class="ai-result-body">{aiResult}</div>
				{/if}
				{#if !aiLoading && aiResult && !aiError}
					<div class="ai-result-actions">
						<button class="ai-action-btn apply" onclick={aiApplyResult}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
							{aiEmptyNote ? 'Insert Note' : aiWholeNote ? 'Apply to Note' : 'Replace'}
						</button>
						<button class="ai-action-btn discard" onclick={aiDiscard}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
							Discard
						</button>
					</div>
				{/if}
			{:else if aiShowCustom}
				<!-- Custom prompt input -->
				<div class="ai-custom-header">
					<button class="ai-back-btn" onclick={() => aiShowCustom = false}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
					</button>
					<span>Custom Prompt</span>
				</div>
				<div class="ai-custom-body">
					<textarea
						class="ai-custom-input"
						placeholder="Tell AI what to do with the selected text..."
						bind:value={aiCustomPrompt}
						onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAiAction('custom', aiCustomPrompt); } }}
						use:autofocus
					></textarea>
					<button class="ai-custom-submit" onclick={() => runAiAction('custom', aiCustomPrompt)} disabled={!aiCustomPrompt.trim()}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
						Send
					</button>
				</div>
			{:else if aiTranslateMenu}
				<!-- Translate submenu -->
				<div class="ai-custom-header">
					<button class="ai-back-btn" onclick={() => aiTranslateMenu = false}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
					</button>
					<span>Translate to</span>
				</div>
				<button class="ai-menu-item" onclick={() => runAiAction('translate_en')}>English</button>
				<button class="ai-menu-item" onclick={() => runAiAction('translate_nl')}>Dutch</button>
				<button class="ai-menu-item" onclick={() => runAiAction('translate_de')}>German</button>
				<button class="ai-menu-item" onclick={() => runAiAction('translate_fr')}>French</button>
				<button class="ai-menu-item" onclick={() => runAiAction('translate_es')}>Spanish</button>
			{:else if aiEmptyNote}
				<!-- Empty note - generate from prompt -->
				<div class="ai-menu-label">Generate Note</div>
				<div class="ai-custom-body">
					<textarea
						class="ai-custom-input"
						placeholder="Describe the note you want to create..."
						bind:value={aiCustomPrompt}
						onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAiAction('custom', aiCustomPrompt); } }}
						use:autofocus
					></textarea>
					<button class="ai-custom-submit" onclick={() => runAiAction('custom', aiCustomPrompt)} disabled={!aiCustomPrompt.trim()}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4l-2-2"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M9 13v2"/><path d="M15 13v2"/></svg>
						Generate
					</button>
				</div>
			{:else}
				<!-- Action list -->
				<div class="ai-menu-label">{aiWholeNote ? 'AI Actions (Entire Note)' : 'AI Actions'}</div>
				<button class="ai-menu-item" onclick={() => runAiAction('improve')}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
					Improve Writing
				</button>
				<button class="ai-menu-item" onclick={() => runAiAction('fix_grammar')}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
					Fix Grammar
				</button>
				<button class="ai-menu-item" onclick={() => runAiAction('shorter')}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M4 6h10"/></svg>
					Make Shorter
				</button>
				<button class="ai-menu-item" onclick={() => runAiAction('longer')}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>
					Make Longer
				</button>
				<div class="ai-menu-sep"></div>
				<button class="ai-menu-item" onclick={() => runAiAction('professional')}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
					Professional Tone
				</button>
				<button class="ai-menu-item" onclick={() => runAiAction('friendly')}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
					Friendly Tone
				</button>
				<div class="ai-menu-sep"></div>
				<button class="ai-menu-item" onclick={() => runAiAction('summarize')}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="10" x2="16" y2="10"/><line x1="4" y1="14" x2="12" y2="14"/></svg>
					Summarize
				</button>
				<button class="ai-menu-item" onclick={() => runAiAction('explain')}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
					Explain
				</button>
				<button class="ai-menu-item" onclick={() => aiTranslateMenu = true}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>
					Translate
					<span class="ai-menu-arrow">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
					</span>
				</button>
				<div class="ai-menu-sep"></div>
				<button class="ai-menu-item" onclick={() => aiShowCustom = true}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
					Custom Prompt...
				</button>
			{/if}
		</div>
	</div>
{/if}

{#if linkModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="link-modal-overlay" onclick={linkModalCancel}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="link-modal" onclick={(e) => e.stopPropagation()}>
			<div class="link-modal-header">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); margin-right: 8px;">
					<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
					<path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
				</svg>
				<span>Insert Link</span>
			</div>
			<input
				type="text"
				class="link-modal-input"
				bind:this={linkModalInput}
				bind:value={linkModalUrl}
				oninput={() => { linkSuggestIndex = 0; }}
				onkeydown={(e) => {
					if (linkSuggestFiltered.length > 0) {
						if (e.key === 'ArrowDown') { e.preventDefault(); linkSuggestIndex = Math.min(linkSuggestIndex + 1, linkSuggestFiltered.length - 1); return; }
						if (e.key === 'ArrowUp') { e.preventDefault(); linkSuggestIndex = Math.max(linkSuggestIndex - 1, 0); return; }
						if (e.key === 'Enter') { e.preventDefault(); linkModalSelectNote(linkSuggestFiltered[linkSuggestIndex]); return; }
					} else {
						if (e.key === 'Enter') { e.preventDefault(); linkModalConfirm(); }
					}
					if (e.key === 'Escape') { e.preventDefault(); linkModalCancel(); }
				}}
				placeholder="URL or note name"
			/>
			{#if linkSuggestFiltered.length > 0}
				<div class="link-suggest-list">
					{#each linkSuggestFiltered as entry, i}
						<button
							class="link-suggest-item"
							class:selected={i === linkSuggestIndex}
							onmouseenter={() => linkSuggestIndex = i}
							onmousedown={(e) => { e.preventDefault(); linkModalSelectNote(entry); }}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
							<span class="link-suggest-title">{entry.title}</span>
						</button>
					{/each}
				</div>
			{/if}
			<div class="link-modal-actions">
				<button class="link-modal-btn cancel" onclick={linkModalCancel}>Cancel</button>
				<button class="link-modal-btn confirm" onclick={linkModalConfirm}>
					{linkModalUrl ? 'Apply' : 'Remove Link'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showGraph}
	<GraphView onclose={() => showGraph = false} onnavigate={(path, title) => { showGraph = false; navigateToWikiLink(path, title); }} />
{/if}

{#if diagramModal && currentDiagramEditorType}
	{#if currentDiagramEditorType === 'mermaid'}
		<MermaidEditor data={diagramModal.data} onSave={commitDiagram} onCancel={cancelDiagram} onChangeEditorType={changeDiagramEditorType} />
	{:else if currentDiagramEditorType === 'drawio'}
		<DrawIOEditor data={diagramModal.data} onSave={commitDiagram} onCancel={cancelDiagram} onChangeEditorType={changeDiagramEditorType} />
	{:else}
		<DiagramEditor data={diagramModal.data} onSave={commitDiagram} onCancel={cancelDiagram} onChangeEditorType={changeDiagramEditorType} />
	{/if}
{/if}

<style>
	.mode-segmented-control {
		display: inline-flex;
		align-items: center;
		background: var(--bg-surface);
		border: 1px solid var(--border-highlight);
		border-radius: 6px;
		padding: 2px;
		gap: 2px;
		height: 24px;
		user-select: none;
	}

	.mode-segmented-control.mobile {
		height: 28px;
		border-radius: 6px;
	}

	.mode-segment-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 8px;
		font-size: 11px;
		font-weight: 600;
		border-radius: 4px;
		border: none;
		background: none;
		color: var(--text-secondary);
		cursor: pointer;
		transition: color 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.15s ease, border-color 0.2s;
		height: 18px;
		gap: 4px;
	}

	.mode-segmented-control.mobile .mode-segment-btn {
		height: 22px;
		padding: 0 6px;
	}

	.mode-segment-btn:hover {
		color: var(--text-primary);
		background: var(--bg-mid-dark);
		transform: scale(1.03);
	}

	.mode-segment-btn.active {
		color: var(--accent);
		background: rgba(0, 173, 181, 0.08);
		border: 1px solid rgba(0, 173, 181, 0.2);
		transform: scale(1.05);
	}

	.mode-segment-btn.active:hover {
		background: rgba(0, 173, 181, 0.15);
	}

	/* Spacing, typography, and visual centering overrides for Read Mode */
	.editor-body.readonly :global(.tiptap) {
		cursor: default;
	}

	.editor-body.readonly :global(.tiptap a) {
		cursor: pointer;
	}

	.editor-body.readonly :global(.tiptap pre) {
		cursor: default;
	}

	.editor-body.readonly :global(.tiptap [data-type="taskList"] label) {
		cursor: pointer;
	}

	.editor-title input[readonly] {
		cursor: default;
	}

	@media (min-width: 768px) {
		.editor-body.readonly .tiptap-wrapper {
			max-width: 800px;
			margin: 0 auto;
			width: 100%;
			padding: 20px 40px;
		}
		.editor-container.readonly .editor-toolbar {
			max-width: 800px;
			margin: 0 auto;
					width: 100%;
			padding-left: 40px;
			padding-right: 40px;
		}
	}

	/* ── Task Action Bar (HUD) ── */
	.task-action-bar-hud {
		position: absolute;
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 6px;
		z-index: 99;
		height: 38px;
		transition: top 0.1s ease, left 0.1s ease;
		box-sizing: border-box;
	}

	/* Desktop layout styling: seamless inline overlay */
	.editor-container:not(.mobile) .task-action-bar-hud {
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
	}

	/* Mobile layout styling: floating card overlay */
	.editor-container.mobile .task-action-bar-hud {
		background: #1e1e24;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 8px;
		padding: 4px 10px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
	}

	.task-bar-capsule {
		background: transparent;
		border: 1px dashed rgba(255, 255, 255, 0.25);
		color: rgba(255, 255, 255, 0.7);
		font-size: 11px;
		padding: 4px 10px;
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}
	.task-bar-capsule:hover {
		border-color: rgba(255, 255, 255, 0.45);
		color: white;
		background: rgba(255, 255, 255, 0.05);
	}
	.task-bar-capsule.active {
		background: rgba(168, 85, 247, 0.12);
		border-color: #a855f7;
		color: #a855f7;
	}

	.task-icon-btn-wrap {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.task-bar-icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.6);
		cursor: pointer;
		position: relative;
		overflow: hidden;
		transition: all 0.15s;
	}
	.task-bar-icon-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: white;
	}
	.task-bar-icon-btn.active {
		color: var(--accent);
	}

	.task-overlay-input {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.task-badge-label {
		font-size: 11px;
		color: var(--accent);
		font-weight: 500;
		max-width: 80px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.task-bar-trash {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.4);
		cursor: pointer;
		margin-left: auto;
		transition: all 0.15s;
	}
	.task-bar-trash:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	/* ── Task Detail Modal ── */
	.task-detail-modal {
		background: rgba(18, 22, 28, 0.95);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 12px;
		padding: 24px;
		width: 450px;
		max-width: 90vw;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		color: var(--text-primary);
	}

	.task-detail-header {
		align-items: center;
		padding-bottom: 12px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}

	.detail-label {
		font-size: 11px;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--text-muted);
		letter-spacing: 0.5px;
	}

	.detail-sub {
		font-size: 11px;
		color: var(--text-muted);
	}

	.detail-text-display {
		background: rgba(0, 0, 0, 0.2);
		border: 1px solid rgba(255, 255, 255, 0.04);
		padding: 10px 12px;
		border-radius: 6px;
		font-size: 13px;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.task-detail-date-input, .task-detail-datetime-input {
		opacity: 1;
		position: static;
		background: rgba(0, 0, 0, 0.2);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
		padding: 4px 8px;
		border-radius: 6px;
		outline: none;
		font-size: 12px;
	}

	.priority-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		margin-right: 6px;
	}

	.task-detail-flag-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: var(--text-secondary);
		padding: 6px 12px;
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
		transition: all 0.15s;
	}
	.task-detail-flag-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
	}
	.task-detail-flag-btn.active {
		background: rgba(245, 158, 11, 0.15);
		border-color: #f59e0b;
		color: #f59e0b;
	}

	.task-detail-delete-btn {
		background: rgba(239, 68, 68, 0.15);
		border: 1px solid rgba(239, 68, 68, 0.25);
		color: #ef4444;
		padding: 6px 12px;
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
		align-items: center;
		gap: 4px;
	}
	.task-detail-delete-btn:hover {
		background: #ef4444;
		color: white;
	}

	.task-detail-close-btn {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
		padding: 6px 16px;
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
	}
	.task-detail-close-btn:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	/* ── TipTap Metadata Badges in Editor ── */
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-due-date] > div::after) {
		content: " 📅 " attr(data-due-date);
		font-size: 10px;
		font-weight: 500;
		padding: 1px 5px;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 4px;
		margin-left: 8px;
		color: var(--text-secondary);
		display: inline-block;
		white-space: nowrap;
		pointer-events: none;
	}
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-priority="high"] > div::before) {
		content: "●";
		color: #ef4444;
		margin-right: 4px;
		font-size: 12px;
		pointer-events: none;
	}
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-priority="medium"] > div::before) {
		content: "●";
		color: #f59e0b;
		margin-right: 4px;
		font-size: 12px;
		pointer-events: none;
	}
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-priority="low"] > div::before) {
		content: "●";
		color: #3b82f6;
		margin-right: 4px;
		font-size: 12px;
		pointer-events: none;
	}
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-flagged="true"] > div::after) {
		content: " 🚩";
		margin-left: 4px;
		color: #f59e0b;
		pointer-events: none;
	}

	.editor-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 100%;
		flex-grow: 1;
		background: var(--bg-editor);
	}

	.empty-editor {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		width: 100%;
		padding: var(--spacing-xl) var(--spacing-lg);
		box-sizing: border-box;
		color: var(--text-secondary);
		gap: var(--spacing-md);
		overflow-y: auto;
		text-align: center;
	}

	.empty-glow {
		position: absolute;
		width: 250px;
		height: 250px;
		border-radius: 50%;
		background: radial-gradient(circle, color-mix(in srgb, var(--accent) 15%, transparent) 0%, transparent 70%);
		top: 30%;
		left: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: 0;
	}

	.empty-illustration-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100px;
		height: 100px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--text-primary) 3%, transparent);
		border: 1px solid color-mix(in srgb, var(--text-primary) 5%, transparent);
		margin-bottom: var(--spacing-xs);
		z-index: 1;
		transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s;
	}

	.empty-illustration-wrapper:hover {
		transform: scale(1.05) translateY(-4px);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
		box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 8%, transparent);
	}

	.empty-visual-icon {
		filter: drop-shadow(0 4px 12px color-mix(in srgb, var(--accent) 20%, transparent));
		animation: empty-float 4s ease-in-out infinite;
	}

	@keyframes empty-float {
		0%, 100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-6px);
		}
	}

	.empty-editor-title {
		font-size: var(--font-size-xl);
		font-weight: 800;
		color: var(--text-primary);
		margin: 0;
		letter-spacing: -0.5px;
		z-index: 1;
	}

	.empty-editor-subtitle {
		font-size: var(--font-size-sm);
		color: var(--text-tertiary);
		max-width: 480px;
		line-height: 1.6;
		margin: 0 0 var(--spacing-xs) 0;
		z-index: 1;
	}

	.empty-actions {
		display: flex;
		gap: var(--spacing-sm);
		z-index: 1;
	}

	.shortcuts-card {
		display: flex;
		flex-direction: column;
		background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
		border: 1px solid var(--border-color);
		backdrop-filter: blur(8px);
		border-radius: var(--radius-comfortable, 8px);
		padding: var(--spacing-md);
		width: 100%;
		max-width: 320px;
		margin-top: var(--spacing-lg);
		gap: var(--spacing-xs);
		box-shadow: var(--shadow-subtle, 0 4px 12px rgba(0,0,0,0.1));
		z-index: 1;
		transition: border-color 0.2s;
	}

	.shortcuts-card:hover {
		border-color: color-mix(in srgb, var(--text-primary) 12%, transparent);
	}

	.shortcuts-title {
		font-size: var(--font-size-xs);
		font-weight: 700;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		text-align: left;
	}

	.shortcuts-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.shortcut-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
	}

	.shortcut-label {
		font-size: var(--font-size-xs);
		color: var(--text-tertiary);
		text-align: left;
	}

	.shortcut-keys {
		display: flex;
		gap: var(--spacing-3xs);
		align-items: center;
	}

	.shortcut-keys kbd {
		background: var(--bg-mid-dark, rgba(255, 255, 255, 0.05));
		border: 1px solid var(--border-color);
		border-radius: var(--radius-subtle, 4px);
		padding: var(--spacing-3xs) var(--spacing-2xs);
		font-size: 10px;
		font-family: var(--font-mono, monospace);
		color: var(--text-secondary);
		box-shadow: 0 1px 0 var(--border-color);
	}

	.editor-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 20px 4px;
		flex-shrink: 0;
	}

	.nav-history-btns {
		display: flex;
		align-items: center;
		gap: 2px;
		margin-right: auto;
		flex-shrink: 0;
	}

	.nav-history-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: none;
		color: var(--text-tertiary);
		border-radius: 5px;
		cursor: pointer;
		padding: 0;
		transition: color 0.15s, background 0.15s, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.nav-history-btn:hover {
		color: var(--text-primary);
		background: var(--bg-hover);
		transform: scale(1.12);
	}

	.nav-history-btn:active {
		transform: scale(0.92);
	}

	.nav-history-btn:disabled {
		opacity: 0.3;
		cursor: default;
		pointer-events: none;
	}

	.editor-title {
		flex: 1;
	}

	.editor-title input {
		width: 100%;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 22px;
		font-weight: 700;
		outline: none;
		padding: 0;
		-webkit-user-select: text !important;
		user-select: text !important;
	}

	.editor-title input::placeholder {
		color: var(--text-tertiary);
	}

	.note-meta-bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		padding: 0 20px 10px;
		flex-shrink: 0;
	}

	.note-meta-bar.focus-mode {
		padding: 0 20px 6px;
		justify-content: flex-end;
	}

	.note-status-group {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-left: auto;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 4px;
		font-weight: 500;
		letter-spacing: 0.01em;
		transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
		border: 1px solid transparent;
		user-select: none;
	}

	.status-badge:hover {
		filter: brightness(1.1);
		box-shadow: 0 0 8px rgba(16, 185, 129, 0.15);
		transform: translateY(-0.5px);
	}

	.status-badge svg {
		flex-shrink: 0;
		opacity: 0.95;
	}

	/* Local Save status colors */
	.status-badge.save-status.clean {
		color: #10b981;
		background: rgba(16, 185, 129, 0.1);
		border: 1px solid rgba(16, 185, 129, 0.2);
	}

	.status-badge.save-status.dirty {
		color: var(--semantic-warning, #ffa42b);
		background: rgba(250, 204, 21, 0.1);
		border: 1px solid rgba(250, 204, 21, 0.2);
	}

	/* Google Drive Sync status colors */
	.status-badge.sync-status.offline {
		color: var(--text-tertiary);
		background: rgba(124, 124, 124, 0.08);
		border: 1px solid rgba(124, 124, 124, 0.15);
	}

	.status-badge.sync-status.syncing {
		color: var(--semantic-info, #539df5);
		background: rgba(83, 157, 245, 0.1);
		border: 1px solid rgba(83, 157, 245, 0.2);
	}

	.status-badge.sync-status.error {
		color: var(--semantic-error, #f3727f);
		background: rgba(243, 114, 127, 0.15);
		border: 1px solid rgba(243, 114, 127, 0.25);
		cursor: pointer;
	}

	.status-badge.sync-status.error:hover {
		background: rgba(243, 114, 127, 0.22);
		border-color: rgba(243, 114, 127, 0.4);
	}

	.status-badge.sync-status.pending {
		color: var(--semantic-warning, #ffa42b);
		background: rgba(250, 204, 21, 0.1);
		border: 1px solid rgba(250, 204, 21, 0.2);
		cursor: pointer;
	}

	.status-badge.sync-status.pending:hover {
		background: rgba(250, 204, 21, 0.18);
		border-color: rgba(250, 204, 21, 0.35);
	}

	.status-badge.sync-status.synced {
		color: #10b981;
		background: rgba(16, 185, 129, 0.1);
		border: 1px solid rgba(16, 185, 129, 0.2);
	}

	.status-badge svg.spin {
		animation: status-spin 1.2s linear infinite;
	}

	@keyframes status-spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	@media (max-width: 768px) {
		.note-status-group {
			margin-left: 0;
			width: 100%;
			margin-top: 4px;
			justify-content: flex-start;
		}

		.note-meta-bar.focus-mode {
			padding: 0 16px 4px;
		}

		.note-meta-bar.focus-mode .note-status-group {
			margin-top: 0;
			width: auto;
			margin-left: auto;
			justify-content: flex-end;
		}
	}

	.note-folder {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-tertiary);
		letter-spacing: 0.01em;
	}

	.note-folder.unfiled {
		opacity: 0.6;
		font-style: italic;
	}

	.path-sep {
		font-size: 10px;
		opacity: 0.5;
	}

	.meta-divider {
		font-size: 11px;
		color: var(--text-tertiary);
		opacity: 0.4;
		user-select: none;
	}

	.note-tags {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
	}

	.note-tag {
		font-size: 11px;
		color: var(--text-tertiary);
		background: var(--bg-tertiary);
		padding: 1px 7px;
		border-radius: 10px;
		letter-spacing: 0.01em;
	}

	.note-tag.edit {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 4px 1px 7px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--text-secondary);
		border-radius: 12px;
		transition: all 0.2s ease;
		user-select: none;
	}

	.note-tag.edit:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.2);
	}

	.tag-delete-btn {
		background: none;
		border: none;
		padding: 0;
		color: var(--text-tertiary);
		font-size: 8px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		width: 12px;
		height: 12px;
		line-height: 12px;
		transition: all 0.2s ease;
	}

	.tag-delete-btn:hover {
		background: rgba(255, 255, 255, 0.15);
		color: var(--semantic-error, #ff4d4d);
	}

	.note-tag-input {
		background: transparent;
		border: 1px dashed rgba(255, 255, 255, 0.15);
		color: var(--text-secondary);
		font-size: 11px;
		padding: 1px 8px;
		border-radius: 10px;
		outline: none;
		width: 75px;
		transition: all 0.2s ease;
	}

	.note-tag-input:focus {
		width: 110px;
		border-color: var(--accent);
		border-style: solid;
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.03);
	}

	.note-tag-input::placeholder {
		color: var(--text-tertiary);
		opacity: 0.6;
	}

	.tag-input-container {
		position: relative;
		display: inline-block;
	}

	.tag-autocomplete-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		background: #181818;
		border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
		border-radius: var(--radius-standard, 8px);
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
		padding: 4px;
		margin: 0;
		list-style: none;
		min-width: 140px;
		max-height: 180px;
		overflow-y: auto;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tag-autocomplete-dropdown li {
		padding: 6px 10px;
		font-size: 11px;
		color: var(--text-secondary);
		border-radius: var(--radius-subtle, 4px);
		cursor: pointer;
		user-select: none;
		transition: background-color 0.15s ease, color 0.15s ease;
		white-space: nowrap;
		text-align: left;
	}

	.tag-autocomplete-dropdown li:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
	}

	.tag-autocomplete-dropdown li.active {
		background: var(--accent, rgba(255, 255, 255, 0.15));
		color: var(--text-primary);
		font-weight: 600;
	}

	.tag-autocomplete-dropdown::-webkit-scrollbar {
		width: 4px;
	}
	.tag-autocomplete-dropdown::-webkit-scrollbar-track {
		background: transparent;
	}
	.tag-autocomplete-dropdown::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.15);
		border-radius: 2px;
	}
	.tag-autocomplete-dropdown::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.3);
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* UI-D-023: grouped, overflow-aware desktop toolbar chrome */
	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.toolbar-sep {
		width: 1px;
		height: 18px;
		background: var(--border-color);
		flex-shrink: 0;
		opacity: 0.7;
	}

	.more-dropdown-wrap {
		position: relative;
	}

	.more-dropdown {
		top: calc(100% + 4px) !important;
		bottom: auto !important;
		right: 0 !important;
		left: auto !important;
		min-width: 180px;
	}

	.more-dropdown button {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.more-dropdown button.active {
		color: var(--text-accent);
		background: var(--accent-light);
	}

	.more-dropdown button.danger {
		color: var(--semantic-error, #ff4d4d);
	}

	.more-dropdown button.danger:hover {
		background: color-mix(in srgb, var(--semantic-error, #ff4d4d) 14%, transparent);
	}

	.more-dropdown-sep {
		height: 1px;
		background: var(--border-color);
		margin: 4px 0;
	}

	.save-indicator {
		font-size: 11px;
		color: var(--text-tertiary);
		background: var(--bg-tertiary);
		padding: 2px 8px;
		border-radius: 4px;
	}

	.readonly-indicator {
		font-size: 11px;
		color: var(--accent);
		background: var(--accent-light);
		padding: 2px 8px;
		border-radius: 4px;
		font-weight: 500;
	}

	.icon-btn {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		transition: background-color 0.15s, color 0.15s, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
		transform: scale(1.1);
	}

	.icon-btn:active {
		transform: scale(0.93);
	}

	.icon-btn.active {
		color: var(--text-accent);
		background: var(--accent-light);
	}

	/* Toggle buttons (Zen Focus Mode + Typewriter Scroll):
	   OFF = clearly muted/unfocused, ON = clearly highlighted. */
	.icon-btn.toggle-btn {
		color: var(--text-tertiary);
		opacity: 0.5;
	}

	.icon-btn.toggle-btn:hover {
		color: var(--text-primary);
		opacity: 1;
	}

	.icon-btn.toggle-btn.active {
		color: var(--accent);
		background: var(--accent-light);
		opacity: 1;
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}

	/* Ensure Zen Focus and Typewriter Scroll icons remain clean outlines (non-bold) */
	.icon-btn :global(.focus-mode-icon),
	.icon-btn :global(.typewriter-icon) {
		fill: none !important;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}

	.editor-formatting-bar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 6px 20px;
		border-top: 1px solid var(--border-light);
		flex-shrink: 0;
		flex-wrap: wrap;
	}

	@media (min-width: 768px) {
		.editor-container {
			display: grid;
			grid-template-columns: 1fr auto;
			grid-template-rows: auto auto 1fr;
			height: 100%;
			width: 100%;
			flex-grow: 1;
		}

		.editor-toolbar {
			grid-column: 1 / span 2;
			grid-row: 1;
		}

		.note-meta-bar {
			grid-column: 1;
			grid-row: 2;
		}

		.editor-body-wrapper {
			grid-column: 1;
			grid-row: 3;
			overflow: hidden;
			height: 100%;
		}

		.editor-formatting-bar {
			grid-column: 2;
			grid-row: 2 / span 2;
			display: flex;
			flex-direction: column;
			width: 44px;
			height: 100%;
			border-top: none !important;
			border-left: 1px solid var(--border-light);
			padding: 10px 4px !important;
			flex-wrap: nowrap !important;
			overflow: visible !important;
			scrollbar-width: none;
			gap: 8px;
			align-items: center;
			justify-content: flex-start;
			background: var(--bg-surface);
		}

		.editor-formatting-bar::-webkit-scrollbar {
			display: none;
		}

		.editor-formatting-bar .fmt-sep {
			width: 24px !important;
			height: 3px !important;
			background: var(--text-tertiary) !important;
			opacity: 1 !important;
			margin: 6px 0 !important;
		}

		.editor-formatting-bar .fmt-dropdown {
			left: auto !important;
			right: calc(100% + 8px) !important;
			top: -6px !important;
			bottom: auto !important;
		}

		/* Align specific lower dropdowns to bottom to prevent viewport overflow */
		.editor-formatting-bar .table-picker-dropdown,
		.editor-formatting-bar .color-picker-dropdown,
		.editor-formatting-bar .align-dropdown {
			bottom: -6px !important;
			top: auto !important;
		}

		/* Style font select button as square icon-only button in vertical bar */
		.editor-formatting-bar .font-select-btn {
			min-width: 30px !important;
			max-width: 30px !important;
			width: 30px !important;
			height: 30px !important;
			padding: 0 !important;
			justify-content: center !important;
		}

		.editor-formatting-bar .font-select-btn .font-label,
		.editor-formatting-bar .font-select-btn .dropdown-arrow {
			display: none !important;
		}

		.editor-formatting-bar .font-select-btn .font-icon {
			display: block !important;
		}
	}

	.fmt-btn {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 5px 7px;
		border-radius: 6px;
		font-size: 13px;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 30px;
		height: 30px;
		position: relative;
	}

	.fmt-btn :global(svg) {
		width: 18px;
		height: 18px;
	}

	.fmt-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.fmt-btn.active {
		background: var(--accent-light);
		color: var(--text-accent);
	}

	.fmt-sep {
		width: 1px;
		height: 16px;
		background: var(--border-color);
		margin: 0 3px;
		flex-shrink: 0;
	}

	.fmt-dropdown-wrap {
		position: relative;
	}

	.fmt-dropdown {
		position: absolute;
		bottom: calc(100% + 4px);
		left: 0;
		background: var(--bg-surface) !important;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: var(--shadow-lg);
		padding: 4px;
		z-index: 100;
		min-width: 140px;
	}

	.fmt-dropdown button {
		display: block;
		width: 100%;
		padding: 6px 12px;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		border-radius: 4px;
		text-align: left;
	}

	.fmt-dropdown button:hover {
		background: var(--bg-hover);
	}

	.fmt-dropdown button.active {
		color: var(--text-accent);
		background: var(--accent-light);
	}

	.color-indicator {
		position: absolute;
		bottom: 2px;
		left: 50%;
		transform: translateX(-50%);
		width: 12px;
		height: 2px;
		border-radius: 1px;
	}

	.color-grid-dropdown {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
		padding: 8px;
		min-width: auto;
		width: 140px;
	}

	.color-grid-dropdown .color-swatch {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		min-width: 0;
	}

	.color-grid-dropdown .color-swatch:hover {
		transform: scale(1.15);
	}

	/* ═══ Custom Color Picker & Font Selector Dropdown Styles ═══ */
	.color-picker-dropdown {
		padding: 10px;
		width: 180px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.color-picker-dropdown .color-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
	}

	.color-picker-dropdown .color-swatch {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: 1px solid var(--border-color);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		min-width: 0;
		transition: transform 0.15s ease, border-color 0.15s ease;
	}

	.color-picker-dropdown .color-swatch:hover {
		transform: scale(1.15);
		border-color: var(--accent);
	}

	.dropdown-divider {
		height: 1px;
		background: var(--border-color);
		margin: 4px 0;
	}

	.custom-color-section, .recent-colors-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.section-title {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		font-weight: 600;
	}

	.custom-color-inputs {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 28px;
	}

	.native-picker-label {
		position: relative;
		display: block;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: 1px solid var(--border-color);
		cursor: pointer;
		overflow: hidden;
		flex-shrink: 0;
	}

	.native-picker-label input[type="color"] {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
		padding: 0;
		margin: 0;
		border: none;
	}

	.picker-preview {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: 4px;
	}

	.hex-input {
		flex: 1;
		width: 100%;
		height: 100%;
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		color: var(--text-primary);
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 0 6px;
		min-width: 0;
		outline: none;
		transition: border-color 0.15s ease;
	}

	.hex-input:focus {
		border-color: var(--accent);
	}

	.apply-btn {
		height: 100%;
		padding: 0 8px !important;
		background: var(--accent) !important;
		color: white !important;
		font-size: 11px !important;
		font-weight: 500;
		border-radius: 6px !important;
		border: none;
		cursor: pointer;
		width: auto !important;
		text-align: center !important;
		display: flex !important;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: background 0.15s ease;
	}

	.apply-btn:hover {
		background: var(--accent-hover) !important;
	}

	.recent-swatches {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.recent-swatches .recent-swatch {
		width: 24px !important;
		height: 24px !important;
	}

	.font-select-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		height: 28px;
		min-width: 80px;
		max-width: 120px;
		justify-content: space-between;
	}

	.font-select-btn .font-icon {
		display: none;
	}

	.font-select-btn .font-label {
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.font-dropdown-list {
		min-width: 180px;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.font-options-container {
		display: flex;
		flex-direction: column;
		max-height: 200px;
		overflow-y: auto;
		gap: 2px;
	}

	.font-option-row {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
	}

	.font-option-row button {
		flex: 1;
		text-align: left;
	}

	.font-delete-btn {
		width: 24px !important;
		height: 24px !important;
		padding: 0 !important;
		display: flex !important;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		border-radius: 4px;
		cursor: pointer;
	}

	.font-delete-btn:hover {
		background: var(--bg-hover) !important;
	}

	.add-font-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.add-font-inputs {
		display: flex;
		gap: 6px;
		height: 28px;
	}

	.font-input {
		flex: 1;
		width: 100%;
		height: 100%;
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		color: var(--text-primary);
		font-size: 11px;
		padding: 0 6px;
		min-width: 0;
		outline: none;
		transition: border-color 0.15s ease;
	}

	.font-input:focus {
		border-color: var(--accent);
	}

	.insert-dropdown {
		min-width: 180px;
	}

	.insert-dropdown button {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.insert-btn {
		color: var(--accent);
	}

	.align-dropdown {
		min-width: 120px;
	}

	.align-dropdown button {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.editor-body-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.note-search-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.note-search-input {
		flex: 1;
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-size: 13px;
		outline: none;
		min-width: 0;
	}
	.note-search-input::placeholder {
		color: var(--text-secondary);
	}
	.note-search-count {
		font-size: 12px;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.note-search-btn {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 2px;
		border-radius: 4px;
		display: flex;
		align-items: center;
	}
	.note-search-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
	:global(.note-search-match) {
		background: rgba(255, 200, 0, 0.3);
		border-radius: 2px;
	}
	:global(.note-search-active) {
		background: rgba(255, 150, 0, 0.6);
	}

	.editor-body-row {
		flex: 1;
		display: flex;
		flex-direction: row;
		overflow: hidden;
		min-height: 0;
	}

	.editor-body {
		flex: 1;
		overflow-y: auto;
		overflow-anchor: none;
		padding: 8px 20px;
		min-width: 0;
		position: relative;
	}

	/* Inset the scrollbar off the window's right edge so the window resize handle
	   (ResizeHandles in +layout) has clean space and doesn't swallow the scrollbar. */
	.editor-container:not(.mobile) .editor-body {
		margin-right: 8px;
	}

	.editor-body::-webkit-scrollbar {
		width: 8px;
	}

	.editor-body::-webkit-scrollbar-thumb {
		background: var(--text-tertiary);
		border-radius: 4px;
	}

	.editor-body::-webkit-scrollbar-thumb:hover {
		background: var(--text-secondary);
	}

	.editor-body:has(.source-editor) {
		overflow: hidden;
	}

	.history-panel {
		width: 240px;
		border-left: 1px solid var(--border-light);
		background: var(--bg-secondary);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		flex-shrink: 0;
	}

	.history-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 14px;
		border-bottom: 1px solid var(--border-light);
	}

	.history-header h3 {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		margin: 0;
	}

	.history-header-actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.history-create-btn,
	.history-close {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 2px;
		border-radius: 4px;
		display: flex;
		align-items: center;
	}

	.history-create-btn:hover,
	.history-close:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.history-empty {
		padding: 16px 14px;
		font-size: 12px;
		color: var(--text-tertiary);
		line-height: 1.5;
	}

	.history-list {
		flex: 1;
		overflow-y: auto;
		padding: 4px 6px;
	}

	.history-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 8px 10px;
		border: none;
		border-radius: 6px;
		background: none;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.history-item:hover {
		background: var(--bg-hover);
	}

	.history-item.active {
		background: var(--accent-light);
	}

	.history-date {
		font-size: 12px;
		color: var(--text-primary);
	}

	.history-item.active .history-date {
		color: var(--accent);
		font-weight: 500;
	}

	.history-size {
		font-size: 11px;
		color: var(--text-tertiary);
	}

	.history-actions {
		padding: 8px 10px;
		border-top: 1px solid var(--border-light);
	}

	.history-restore-btn {
		width: 100%;
		padding: 7px 12px;
		border: 1px solid var(--accent);
		border-radius: 6px;
		background: var(--accent-light);
		color: var(--accent);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.history-restore-btn:hover {
		background: var(--accent);
		color: white;
	}

	.outline-panel {
		width: 220px;
		border-left: 1px solid var(--border-light);
		background: var(--bg-secondary);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		flex-shrink: 0;
	}

	.outline-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 14px;
		border-bottom: 1px solid var(--border-light);
	}

	.outline-header h3 {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		margin: 0;
	}

	.outline-close {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 2px;
		border-radius: 4px;
		display: flex;
		align-items: center;
	}

	.outline-close:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.outline-empty {
		padding: 16px 14px;
		font-size: 12px;
		color: var(--text-tertiary);
		line-height: 1.5;
	}

	.outline-list {
		flex: 1;
		overflow-y: auto;
		padding: 4px 0;
	}

	.outline-item {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: 4px 14px;
		font-size: 12px;
		color: var(--text-secondary);
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.5;
	}

	.outline-item:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.outline-level-1 { padding-left: 14px; font-weight: 600; }
	.outline-level-2 { padding-left: 26px; font-weight: 500; }
	.outline-level-3 { padding-left: 38px; }
	.outline-level-4 { padding-left: 50px; }
	.outline-level-5 { padding-left: 62px; }
	.outline-level-6 { padding-left: 74px; }

	.source-editor {
		width: 100%;
		height: 100%;
		border: none;
		background: none;
		color: var(--text-primary);
		font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
		font-size: var(--editor-font-size, 14px);
		line-height: 1.3;
		resize: none;
		outline: none;
		padding: 0;
		margin: 0;
		user-select: text;
		white-space: pre;
		overflow-x: auto;
	}

	.source-editor.with-line-numbers {
		padding-left: 48px;
	}

	.line-numbers-clip {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 44px;
		overflow: hidden;
		pointer-events: none;
	}

	.line-numbers {
		padding-top: 8px;
		font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
		font-size: var(--editor-font-size, 14px);
		line-height: 1.3;
		color: var(--text-secondary);
		opacity: 0.5;
		text-align: right;
		user-select: none;
		will-change: transform;
	}

	.line-numbers span {
		display: block;
		padding-right: 12px;
	}

	.tiptap-wrapper {
		height: 100%;
		user-select: text;
	}

	:global(.tiptap-wrapper .tiptap) {
		outline: none;
		min-height: 100%;
		user-select: text;
		font-size: var(--editor-font-size, 14px);
		font-family: var(--editor-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
		overflow: hidden;
	}

	:global(.tiptap-wrapper .tiptap p) {
		margin: 0 0 0.75em;
		line-height: var(--editor-line-height, 1.65);
	}

	:global(.tiptap-wrapper .tiptap h1) {
		font-size: 1.75em;
		font-weight: 700;
		margin: 1.5em 0 0.5em;
		line-height: 1.2;
	}

	:global(.tiptap-wrapper .tiptap h2) {
		font-size: 1.4em;
		font-weight: 600;
		margin: 1.25em 0 0.5em;
		line-height: 1.3;
	}

	:global(.tiptap-wrapper .tiptap h3) {
		font-size: 1.2em;
		font-weight: 600;
		margin: 1em 0 0.5em;
		line-height: 1.3;
	}

	:global(.tiptap-wrapper .tiptap h4) {
		font-size: 1.05em;
		font-weight: 600;
		margin: 0.9em 0 0.4em;
		line-height: 1.35;
	}

	:global(.tiptap-wrapper .tiptap h1:first-child),
	:global(.tiptap-wrapper .tiptap h2:first-child),
	:global(.tiptap-wrapper .tiptap h3:first-child),
	:global(.tiptap-wrapper .tiptap h4:first-child) {
		margin-top: 0;
	}

	:global(.tiptap-wrapper .tiptap strong) {
		font-weight: 600;
	}

	:global(.tiptap-wrapper .tiptap code) {
		background: color-mix(in srgb, var(--accent) 8%, var(--bg-tertiary));
		padding: 2px 6px;
		border-radius: 4px;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.9em;
	}

	:global(.tiptap-wrapper .tiptap pre:not(.text-preview-content)) {
		background: var(--bg-surface);
		border: 1px solid var(--border-highlight);
		border-radius: 8px;
		padding: 38px 16px 16px 16px;
		margin: 1.5em 0;
		position: relative;
		overflow: hidden;
		box-shadow: var(--shadow-medium, 0 4px 12px rgba(0, 0, 0, 0.15));
	}

	:global(.tiptap-wrapper .tiptap pre:not(.text-preview-content) code) {
		display: block;
		overflow-x: auto;
		background: none;
		padding: 0;
		font-size: 13px;
		line-height: 1.5;
	}

	/* Terminal window header bar */
	:global(.tiptap-wrapper .tiptap pre:not(.text-preview-content))::before {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 30px;
		background-color: var(--bg-mid-dark);
		border-bottom: 1px solid var(--border-highlight);
		/* Three window control dots (red, yellow, green) */
		background-image: 
			radial-gradient(circle 3px at 16px 15px, #ff5f56 100%, transparent 100%),
			radial-gradient(circle 3px at 28px 15px, #ffbd2e 100%, transparent 100%),
			radial-gradient(circle 3px at 40px 15px, #27c93f 100%, transparent 100%);
		z-index: 1;
		pointer-events: none;
	}

	:global(.tiptap-wrapper .tiptap pre:not(.text-preview-content))::after {
		content: attr(data-language) ' ▾';
		position: absolute;
		top: 4px;
		right: 8px;
		padding: 2px 8px;
		border-radius: 4px;
		background: var(--bg-surface);
		border: 1px solid var(--border-highlight);
		color: var(--text-secondary);
		font-size: 11px;
		font-family: var(--font-sans, sans-serif);
		cursor: pointer;
		opacity: 0.9;
		pointer-events: auto;
		z-index: 10;
		text-transform: capitalize;
		transition: background-color 0.15s, border-color 0.15s, opacity 0.15s;
	}

	:global(.tiptap-wrapper .tiptap pre:not(.text-preview-content)[data-language=""])::after {
		content: 'Plain Text ▾';
	}

	:global(.tiptap-wrapper .tiptap pre:not(.text-preview-content):hover)::after {
		opacity: 1;
		background: var(--bg-card-hover);
		border-color: var(--accent);
		color: var(--text-primary);
	}

	/* Premium Custom Code Block Styles */
	:global(.code-block-container) {
		margin: 1.5em 0;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		overflow: hidden;
		background: #1e1e1e !important; /* Force a premium dark theme for code blocks */
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
	}

	:global(.code-block-header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 12px;
		background: #252526 !important;
		border-bottom: 2px solid rgba(255, 255, 255, 0.15);
		user-select: none;
	}

	:global(.code-block-lang-btn) {
		display: flex;
		align-items: center;
		padding: 4px 8px;
		font-size: 11px;
		font-weight: 600;
		border: none;
		background: transparent;
		color: #b0b0b0;
		cursor: pointer;
		border-radius: 4px;
		transition: background-color 0.15s, color 0.15s;
		font-family: var(--font-sans, sans-serif);
	}

	:global(.code-block-lang-btn:hover) {
		background: rgba(255, 255, 255, 0.06);
		color: #ffffff;
	}

	:global(.code-block-copy-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 6px;
		border: none;
		background: transparent;
		color: #b0b0b0;
		cursor: pointer;
		border-radius: 4px;
		transition: background-color 0.15s, color 0.15s, transform 0.1s;
	}

	:global(.code-block-copy-btn:hover) {
		background: rgba(255, 255, 255, 0.06);
		color: #ffffff;
	}

	:global(.code-block-copy-btn:active) {
		transform: scale(0.95);
	}

	:global(.code-block-copy-btn.copied) {
		color: #27c93f;
	}

	:global(.code-block-clear-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 6px;
		border: none;
		background: transparent;
		color: #b0b0b0;
		cursor: pointer;
		border-radius: 4px;
		transition: background-color 0.15s, color 0.15s, transform 0.1s;
	}

	:global(.code-block-clear-btn:hover) {
		background: rgba(255, 255, 255, 0.06);
		color: #ff5f56;
	}

	:global(.code-block-clear-btn:active) {
		transform: scale(0.95);
	}

	.code-lang-dropdown.open-up {
		transform: translateY(-100%) !important;
	}

	.code-lang-dropdown.open-up.align-right {
		transform: translate(-100%, -100%) !important;
	}

	:global(.code-block-container pre) {
		margin: 0 !important;
		padding: 14px 16px !important;
		background: transparent !important;
		border: none !important;
		border-radius: 0 !important;
		box-shadow: none !important;
		overflow: hidden;
	}

	:global(.code-block-container pre::before) {
		display: none !important;
	}

	:global(.code-block-container pre::after) {
		display: none !important;
	}

	:global(.code-block-container pre code) {
		display: block;
		overflow-x: auto;
		background: none;
		padding: 0;
		font-size: 13px;
		line-height: 1.5;
		color: #d4d4d4 !important;
		font-family: 'JetBrains Mono', 'Fira Code', var(--font-mono, monospace);
	}

	/* Syntax highlighting - light mode */
	:global(.tiptap pre code .hljs-keyword),
	:global(.tiptap pre code .hljs-selector-tag),
	:global(.tiptap pre code .hljs-built_in) { color: #d73a49; }
	:global(.tiptap pre code .hljs-string),
	:global(.tiptap pre code .hljs-addition) { color: #032f62; }
	:global(.tiptap pre code .hljs-number),
	:global(.tiptap pre code .hljs-literal) { color: #005cc5; }
	:global(.tiptap pre code .hljs-comment),
	:global(.tiptap pre code .hljs-quote) { color: #6a737d; font-style: italic; }
	:global(.tiptap pre code .hljs-function),
	:global(.tiptap pre code .hljs-title) { color: #6f42c1; }
	:global(.tiptap pre code .hljs-type),
	:global(.tiptap pre code .hljs-title.class_) { color: #e36209; }
	:global(.tiptap pre code .hljs-variable),
	:global(.tiptap pre code .hljs-template-variable) { color: #e36209; }
	:global(.tiptap pre code .hljs-attr),
	:global(.tiptap pre code .hljs-attribute) { color: #005cc5; }
	:global(.tiptap pre code .hljs-tag) { color: #22863a; }
	:global(.tiptap pre code .hljs-name) { color: #22863a; }
	:global(.tiptap pre code .hljs-meta) { color: #005cc5; }
	:global(.tiptap pre code .hljs-deletion) { color: #b31d28; background: #ffeef0; }
	:global(.tiptap pre code .hljs-symbol),
	:global(.tiptap pre code .hljs-bullet) { color: #005cc5; }
	:global(.tiptap pre code .hljs-regexp) { color: #032f62; }
	:global(.tiptap pre code .hljs-params) { color: #24292e; }
	:global(.tiptap pre code .hljs-punctuation) { color: #24292e; }
	:global(.tiptap pre code .hljs-property) { color: #005cc5; }
	:global(.tiptap pre code .hljs-selector-class) { color: #6f42c1; }
	:global(.tiptap pre code .hljs-selector-id) { color: #005cc5; }
	:global(.tiptap pre code .hljs-operator) { color: #d73a49; }

	/* Syntax highlighting - dark mode and custom dark code block container */
	:global(.dark .tiptap pre code .hljs-keyword), :global(.code-block-container pre code .hljs-keyword),
	:global(.dark .tiptap pre code .hljs-selector-tag), :global(.code-block-container pre code .hljs-selector-tag),
	:global(.dark .tiptap pre code .hljs-built_in), :global(.code-block-container pre code .hljs-built_in) { color: #ff7b72; }
	:global(.dark .tiptap pre code .hljs-string), :global(.code-block-container pre code .hljs-string),
	:global(.dark .tiptap pre code .hljs-addition), :global(.code-block-container pre code .hljs-addition) { color: #a5d6ff; }
	:global(.dark .tiptap pre code .hljs-number), :global(.code-block-container pre code .hljs-number),
	:global(.dark .tiptap pre code .hljs-literal), :global(.code-block-container pre code .hljs-literal) { color: #79c0ff; }
	:global(.dark .tiptap pre code .hljs-comment), :global(.code-block-container pre code .hljs-comment),
	:global(.dark .tiptap pre code .hljs-quote), :global(.code-block-container pre code .hljs-quote) { color: #8b949e; font-style: italic; }
	:global(.dark .tiptap pre code .hljs-function), :global(.code-block-container pre code .hljs-function),
	:global(.dark .tiptap pre code .hljs-title), :global(.code-block-container pre code .hljs-title) { color: #d2a8ff; }
	:global(.dark .tiptap pre code .hljs-type), :global(.code-block-container pre code .hljs-type),
	:global(.dark .tiptap pre code .hljs-title.class_), :global(.code-block-container pre code .hljs-title.class_) { color: #ffa657; }
	:global(.dark .tiptap pre code .hljs-variable), :global(.code-block-container pre code .hljs-variable),
	:global(.dark .tiptap pre code .hljs-template-variable), :global(.code-block-container pre code .hljs-template-variable) { color: #ffa657; }
	:global(.dark .tiptap pre code .hljs-attr), :global(.code-block-container pre code .hljs-attr),
	:global(.dark .tiptap pre code .hljs-attribute), :global(.code-block-container pre code .hljs-attribute) { color: #79c0ff; }
	:global(.dark .tiptap pre code .hljs-tag), :global(.code-block-container pre code .hljs-tag) { color: #7ee787; }
	:global(.dark .tiptap pre code .hljs-name), :global(.code-block-container pre code .hljs-name) { color: #7ee787; }
	:global(.dark .tiptap pre code .hljs-meta), :global(.code-block-container pre code .hljs-meta) { color: #79c0ff; }
	:global(.dark .tiptap pre code .hljs-deletion), :global(.code-block-container pre code .hljs-deletion) { color: #ffdcd7; background: #67060c; }
	:global(.dark .tiptap pre code .hljs-symbol), :global(.code-block-container pre code .hljs-symbol),
	:global(.dark .tiptap pre code .hljs-bullet), :global(.code-block-container pre code .hljs-bullet) { color: #79c0ff; }
	:global(.dark .tiptap pre code .hljs-regexp), :global(.code-block-container pre code .hljs-regexp) { color: #a5d6ff; }
	:global(.dark .tiptap pre code .hljs-params), :global(.code-block-container pre code .hljs-params) { color: #c9d1d9; }
	:global(.dark .tiptap pre code .hljs-punctuation), :global(.code-block-container pre code .hljs-punctuation) { color: #c9d1d9; }
	:global(.dark .tiptap pre code .hljs-property), :global(.code-block-container pre code .hljs-property) { color: #79c0ff; }
	:global(.dark .tiptap pre code .hljs-selector-class), :global(.code-block-container pre code .hljs-selector-class) { color: #d2a8ff; }
	:global(.dark .tiptap pre code .hljs-selector-id), :global(.code-block-container pre code .hljs-selector-id) { color: #79c0ff; }
	:global(.dark .tiptap pre code .hljs-operator), :global(.code-block-container pre code .hljs-operator) { color: #ff7b72; }

	.math-modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 2200;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.math-modal {
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 8px;
		width: 480px;
		max-width: 90vw;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
	}
	.math-modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-weight: 500;
		font-size: 14px;
		color: var(--text-primary);
	}
	.math-modal-close {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-secondary);
		padding: 4px;
		display: flex;
	}
	.math-modal-close:hover { color: var(--text-primary); }
	.math-modal-input {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 13px;
		min-height: 80px;
		padding: 10px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		resize: vertical;
		outline: none;
	}
	.math-modal-input:focus { border-color: var(--accent); }
	.math-modal-preview {
		min-height: 60px;
		padding: 14px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--bg-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow-x: auto;
		color: var(--text-primary);
	}
	.math-modal-preview-empty {
		color: var(--text-tertiary);
		font-size: 13px;
	}
	.math-modal-preview :global(.math-modal-preview-error) {
		color: #d32f2f;
		font-size: 12px;
		font-family: var(--font-mono, monospace);
	}
	.math-modal-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.math-modal-hint {
		font-size: 11px;
		color: var(--text-tertiary);
	}
	.math-modal-actions {
		display: flex;
		gap: 8px;
	}
	.math-modal-actions button {
		appearance: none;
		padding: 6px 14px;
		border-radius: 5px;
		cursor: pointer;
		font-size: 13px;
		font-family: inherit;
		border: 1px solid var(--border);
		background: var(--bg-secondary);
		color: var(--text-primary);
	}
	.math-modal-actions button:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.math-modal-actions button.primary {
		background: var(--accent);
		color: var(--accent-fg, white);
		border-color: var(--accent);
	}
	.math-modal-actions button.primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}
	.math-modal-actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.math-modal {
			width: calc(100% - 32px);
			max-width: 480px;
			padding: 14px;
			gap: 10px;
		}
		.math-modal-footer {
			flex-direction: column;
			align-items: stretch;
			gap: 8px;
		}
		.math-modal-hint {
			display: none;
		}
		.math-modal-actions {
			display: flex;
			gap: 8px;
			width: 100%;
		}
		.math-modal-actions button {
			flex: 1;
			text-align: center;
			padding: 8px 14px;
		}
	}

	.viewer-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 14px;
		background: var(--bg-tertiary, var(--bg-secondary));
		border-bottom: 1px solid var(--border);
		font-size: 13px;
		color: var(--text-primary);
		flex-shrink: 0;
	}
	.viewer-banner-icon {
		flex-shrink: 0;
		color: var(--accent, var(--text-secondary));
	}
	.viewer-banner-label {
		font-weight: 500;
		flex-shrink: 0;
	}
	.viewer-banner-path {
		color: var(--text-secondary);
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}
	.viewer-banner-actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.viewer-banner-btn {
		appearance: none;
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 4px 12px;
		font-size: 12px;
		cursor: pointer;
		font-family: inherit;
	}
	.viewer-banner-btn:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.viewer-banner-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.viewer-banner-btn.primary {
		background: var(--accent);
		color: var(--accent-fg, white);
		border-color: var(--accent);
	}
	.viewer-banner-btn.primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}
	.viewer-banner-toast {
		font-size: 12px;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.viewer-import-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 2100;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.viewer-import-picker {
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 8px;
		min-width: 320px;
		max-width: 480px;
		max-height: 70vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
	}
	.viewer-import-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		font-weight: 500;
		font-size: 14px;
	}
	.viewer-import-close {
		appearance: none;
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 4px;
		display: flex;
	}
	.viewer-import-close:hover {
		color: var(--text-primary);
	}
	.viewer-import-list {
		overflow-y: auto;
		padding: 6px 0;
	}
	.viewer-import-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		appearance: none;
		background: none;
		border: none;
		color: var(--text-primary);
		padding: 8px 14px;
		text-align: left;
		font-size: 13px;
		cursor: pointer;
		font-family: inherit;
	}
	.viewer-import-item:hover:not(:disabled) {
		background: var(--bg-secondary);
	}
	.viewer-import-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.viewer-import-item svg {
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.code-lang-overlay {
		position: fixed;
		inset: 0;
		z-index: 2000;
	}

	.code-lang-dropdown {
		position: fixed;
		background: var(--bg-surface) !important;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: var(--shadow-lg);
		padding: 4px;
		max-height: 320px;
		display: flex;
		flex-direction: column;
		min-width: 200px;
		z-index: 2001;
	}

	.code-lang-dropdown.align-right {
		transform: translateX(-100%);
	}

	.code-lang-search-wrapper {
		padding: 6px;
		border-bottom: 1px solid var(--border-color);
		margin-bottom: 4px;
	}

	.code-lang-search {
		width: 100%;
		box-sizing: border-box;
		padding: 6px 10px;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 13px;
		outline: none;
		transition: border-color 0.15s;
	}

	.code-lang-search:focus {
		border-color: var(--accent);
	}

	.code-lang-options-list {
		flex: 1;
		overflow-y: auto;
		max-height: 240px;
	}

	.code-lang-options-list::-webkit-scrollbar {
		width: 5px;
	}

	.code-lang-options-list::-webkit-scrollbar-track {
		background: transparent;
	}

	.code-lang-options-list::-webkit-scrollbar-thumb {
		background: var(--border-color);
		border-radius: 3px;
	}

	.code-lang-option {
		display: block;
		width: 100%;
		padding: 5px 10px;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 12px;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		cursor: pointer;
		border-radius: 4px;
		text-align: left;
	}

	.code-lang-option:hover {
		background: var(--bg-hover);
	}

	.code-lang-option.active {
		color: var(--text-accent);
		background: var(--accent-light);
	}

	:global(.tiptap-wrapper .tiptap blockquote) {
		border-left: 3px solid var(--accent);
		padding-left: 16px;
		margin: 1em 0;
		color: var(--text-secondary);
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"]) {
		margin: 1em 0;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		position: relative;
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"] > button) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		position: absolute;
		top: 8px;
		left: 6px;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-secondary);
		padding: 0;
		border-radius: 4px;
		transition: background 0.15s;
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"] > button:hover) {
		background: var(--bg-tertiary);
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"] > button::after) {
		content: '▶';
		font-size: 10px;
		transition: transform 0.2s;
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"].is-open > button::after) {
		transform: rotate(90deg);
	}

	@starting-style {
		:global(.tiptap-wrapper .tiptap [data-type="details"].is-open > button::after) {
			transform: rotate(0deg);
		}
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"] summary) {
		padding: 10px 14px 10px 32px;
		font-weight: 600;
		background: var(--bg-secondary);
		transition: background 0.15s;
		list-style: none;
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"] summary::-webkit-details-marker) {
		display: none;
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"] summary:hover) {
		background: var(--bg-tertiary);
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"] [data-type="detailsContent"]) {
		padding: 10px 14px;
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"] [data-type="detailsContent"] > p:first-child) {
		margin-top: 0;
	}

	:global(.tiptap-wrapper .tiptap [data-type="details"] [data-type="detailsContent"] > p:last-child) {
		margin-bottom: 0;
	}

	:global(.tiptap-wrapper .tiptap ul),
	:global(.tiptap-wrapper .tiptap ol) {
		padding-left: 24px;
		margin: 0.5em 0;
	}

	:global(.tiptap-wrapper .tiptap ul:not([data-type="taskList"])) {
		list-style-type: disc;
	}

	:global(.tiptap-wrapper .tiptap ul:not([data-type="taskList"]) ul) {
		list-style-type: circle;
	}

	:global(.tiptap-wrapper .tiptap ul:not([data-type="taskList"]) ul ul) {
		list-style-type: square;
	}

	:global(.tiptap-wrapper .tiptap ol) {
		list-style-type: decimal;
	}

	:global(.tiptap-wrapper .tiptap ol ol) {
		list-style-type: lower-alpha;
	}

	:global(.tiptap-wrapper .tiptap ol ol ol) {
		list-style-type: lower-roman;
	}

	:global(.tiptap-wrapper .tiptap li) {
		margin: 0.25em 0;
		line-height: var(--editor-line-height, 1.65);
	}

	:global(.tiptap-wrapper .tiptap li p) {
		margin: 0;
	}

	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"]) {
		list-style: none;
		padding-left: 0;
	}

	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-type="taskItem"]) {
		display: flex;
		align-items: center;
		padding: 6px 10px;
		border-radius: 8px;
		border: 1px solid transparent;
		transition: all 0.2s ease;
		background: transparent;
		position: relative;
		margin: 6px 0;
	}
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-type="taskItem"]:hover) {
		background: rgba(255, 255, 255, 0.02);
		border-color: rgba(255, 255, 255, 0.04);
	}
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-type="taskItem"]:focus-within) {
		background: rgba(255, 255, 255, 0.05) !important;
		border-color: rgba(255, 255, 255, 0.12) !important;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}
	@media (min-width: 768px) {
		:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-type="taskItem"]:focus-within) {
			padding-right: 390px; /* Leave space for inline HUD options on the right */
		}
	}

	/* Drag handle ::before */
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-type="taskItem"]::before) {
		content: "⋮⋮";
		color: rgba(255, 255, 255, 0.2);
		font-family: monospace;
		font-size: 14px;
		cursor: grab;
		margin-right: 6px;
		opacity: 0;
		transition: opacity 0.2s ease;
		display: inline-flex;
		align-items: center;
		user-select: none;
		flex-shrink: 0;
	}
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-type="taskItem"]:hover::before),
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-type="taskItem"]:focus-within::before) {
		opacity: 1;
	}

	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li label) {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li label input[type="checkbox"]) {
		appearance: none;
		-webkit-appearance: none;
		width: 18px;
		height: 18px;
		border: 2px solid #a855f7; /* Signature purple/violet matching Evernote */
		border-radius: 50%;
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
		background: transparent;
		transition: background 0.15s, border-color 0.15s;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-checked="true"] label input[type="checkbox"]) {
		background: #a855f7;
		border-color: #a855f7;
	}

	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-checked="true"] label input[type="checkbox"]::after) {
		content: '';
		position: absolute;
		left: 5px;
		top: 2px;
		width: 4px;
		height: 8px;
		border: solid white;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}

	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li label input[type="checkbox"]:hover) {
		background: rgba(168, 85, 247, 0.1);
		border-color: #a855f7;
	}

	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li > div) {
		flex: 1;
		min-width: 0;
	}

	/* Strike through only the direct paragraph content of a checked task item. */
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-checked="true"] > div > p) {
		text-decoration: line-through;
		color: var(--text-tertiary);
	}

	/* Hide pseudo-element metadata badges when the row is focused (to clear space for HUD) */
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-type="taskItem"]:focus-within > div::after),
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li[data-type="taskItem"]:focus-within > div::before) {
		display: none !important;
	}

	:global(.tiptap-wrapper .tiptap hr) {
		border: none;
		border-top: 2.5px solid var(--border-highlight, var(--border-color, #ccc));
		margin: 2em 0;
		opacity: 0.85;
	}

	:global(.tiptap-wrapper .tiptap a) {
		color: var(--text-accent);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--text-accent) 40%, transparent);
	}

	:global(.tiptap-wrapper .tiptap a::after) {
		content: '↗';
		display: inline;
		font-size: 0.65em;
		margin-left: 2px;
		opacity: 0.5;
		vertical-align: 15%;
	}

	:global(.tiptap-wrapper .tiptap a[href$=".md"]::after) {
		content: '⤴';
	}

	:global(.tiptap-wrapper .tiptap a:hover) {
		text-decoration-color: var(--text-accent);
	}

	:global(.tiptap-wrapper .tiptap a:hover::after) {
		opacity: 0.8;
	}

	:global(.tiptap-wrapper .tiptap img) {
		display: block;
		max-width: 100%;
		height: auto;
		border-radius: 8px;
		margin: 1em 0;
		cursor: pointer;
	}

	:global(.tiptap-wrapper .tiptap img:hover) {
		outline: none;
	}

	:global(.tiptap-wrapper .tiptap img.ProseMirror-selectednode) {
		outline: none !important;
		box-shadow: none !important;
		background: none !important;
	}

	:global(.tiptap-wrapper .tiptap .ProseMirror-selectednode) {
		outline: none !important;
	}

	:global(.tiptap-wrapper .tiptap img::selection) {
		background: transparent;
	}

	:global(.tiptap-wrapper .tiptap img::-moz-selection) {
		background: transparent;
	}

	:global(.tiptap-wrapper .tiptap img[data-size="small"]) {
		max-width: 33%;
	}

	:global(.tiptap-wrapper .tiptap img[data-size="medium"]) {
		max-width: 65%;
	}

	:global(.tiptap-wrapper .tiptap img[data-size="full"]) {
		max-width: 100%;
	}

	.img-toolbar-overlay {
		position: fixed;
		inset: 0;
		z-index: 1500;
	}

	.img-toolbar {
		position: fixed;
		display: flex;
		align-items: center;
		gap: 2px;
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: var(--shadow-lg);
		padding: 3px;
		z-index: 1501;
		transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s;
	}

	.img-toolbar.mobile {
		width: calc(100% - 32px) !important;
		max-width: 320px !important;
		justify-content: space-around !important;
		padding: 6px 8px !important;
		border-radius: 12px !important;
		border: 1px solid var(--border-color) !important;
		box-shadow: var(--shadow-xl) !important;
	}

	.img-toolbar.mobile button {
		padding: 6px 10px !important;
		font-size: 13px !important;
	}

	.img-toolbar button {
		padding: 5px 14px;
		border: none;
		background: none;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		border-radius: 5px;
	}

	.img-toolbar button:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.img-toolbar button.active {
		background: var(--accent-light) !important;
		color: var(--text-accent) !important;
		font-weight: 700;
	}

	.img-toolbar-sep {
		width: 1px;
		height: 16px;
		background: var(--border-color);
		margin: 0 2px;
	}

	.img-toolbar button svg {
		display: block;
	}

	.copy-toast {
		position: fixed;
		bottom: 24px;
		right: 24px;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		min-width: 100px;
		justify-content: center;
		background: var(--accent);
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		font-size: 13px;
		font-weight: 500;
		color: white;
		z-index: 9999;
		animation: toast-in 0.15s ease-out;
	}

	.copy-toast.done {
		background: var(--accent);
	}

	.copy-toast-spinner {
		animation: copy-spin 0.8s linear infinite;
	}

	@keyframes toast-in {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	@keyframes copy-spin {
		to { transform: rotate(360deg); }
	}

	:global(.tiptap-wrapper .tiptap mark) {
		padding: 0px 5px 2px;
		border-radius: 3px;
		color: #333 !important;
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}

	:global(.dark .tiptap-wrapper .tiptap mark) {
		color: #eee !important;
	}

	:global(.tiptap-wrapper .tiptap .tableWrapper) {
		overflow-x: auto;
		margin: 1em 0;
	}

	:global(.tiptap-wrapper .tiptap table) {
		border-collapse: collapse;
		width: 100%;
		table-layout: fixed;
		overflow: hidden;
	}

	:global(.tiptap-wrapper .tiptap th),
	:global(.tiptap-wrapper .tiptap td) {
		border: 1px solid var(--border-color);
		padding: 8px 12px;
		text-align: left;
		vertical-align: top;
		position: relative;
		min-width: 80px;
		box-sizing: border-box;
	}

	:global(.tiptap-wrapper .tiptap th) {
		background: var(--bg-tertiary);
		font-weight: 600;
	}

	:global(.tiptap-wrapper .tiptap td > p),
	:global(.tiptap-wrapper .tiptap th > p) {
		margin: 0;
	}

	/* UI-M-006: On mobile, let tables size to their content and scroll
	   horizontally inside the wrapper instead of squishing columns. */
	@media (max-width: 768px) {
		:global(.tiptap-wrapper .tiptap .tableWrapper) {
			-webkit-overflow-scrolling: touch;
		}
		:global(.tiptap-wrapper .tiptap table) {
			table-layout: auto;
			width: max-content;
			min-width: 100%;
		}
		:global(.tiptap-wrapper .tiptap td),
		:global(.tiptap-wrapper .tiptap th) {
			min-width: 120px;
		}
	}

	:global(.tiptap-wrapper .tiptap .selectedCell::after) {
		content: "";
		position: absolute;
		inset: 0;
		background: var(--accent-light);
		pointer-events: none;
		z-index: 1;
	}

	:global(.tiptap-wrapper .tiptap .column-resize-handle) {
		position: absolute;
		right: -2px;
		top: 0;
		bottom: -2px;
		width: 4px;
		background: var(--accent);
		pointer-events: none;
		z-index: 2;
	}

	:global(.tiptap-wrapper .tiptap.resize-cursor) {
		cursor: col-resize;
	}

	:global(.tiptap-wrapper .tiptap > .is-empty::before) {
		content: attr(data-placeholder);
		color: var(--text-tertiary);
		pointer-events: none;
		float: left;
		height: 0;
		padding-left: 2px;
	}

	/* Suppress placeholder on task list / details containers - overlaps with checkbox / toggle button */
	:global(.tiptap-wrapper .tiptap > ul[data-type="taskList"].is-empty::before),
	:global(.tiptap-wrapper .tiptap > [data-type="details"].is-empty::before) {
		content: none;
	}

	/* Show placeholder on the paragraph inside task item content div */
	:global(.tiptap-wrapper .tiptap ul[data-type="taskList"] li > div > p.is-empty::before) {
		content: attr(data-placeholder);
		color: var(--text-tertiary);
		pointer-events: none;
		float: left;
		height: 0;
		padding-left: 2px;
	}

	/* Show placeholder on paragraphs inside collapsible section summary and content */
	:global(.tiptap-wrapper .tiptap [data-type="detailsSummary"] p.is-empty::before),
	:global(.tiptap-wrapper .tiptap [data-type="detailsContent"] p.is-empty::before) {
		content: attr(data-placeholder);
		color: var(--text-tertiary);
		pointer-events: none;
		float: left;
		height: 0;
		padding-left: 2px;
	}


	.link-context-overlay {
		position: fixed;
		inset: 0;
		z-index: 1500;
	}

	.link-context-menu {
		position: fixed;
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		box-shadow: var(--shadow-lg);
		padding: 4px;
		min-width: 180px;
		z-index: 1501;
	}

	.link-context-url {
		padding: 6px 12px;
		font-size: 11px;
		color: var(--text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 240px;
		border-bottom: 1px solid var(--border-light);
		margin-bottom: 4px;
	}

	.link-context-menu button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 12px;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		border-radius: 6px;
		text-align: left;
	}

	.link-context-menu button:hover {
		background: var(--bg-hover);
	}

	.link-context-menu button.danger {
		color: var(--danger);
	}

	.link-context-menu button.danger:hover {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
	}

	.link-context-sep {
		height: 1px;
		background: var(--border-light);
		margin: 4px 0;
	}

	.link-modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2000;
	}

	.link-modal {
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		box-shadow: var(--shadow-lg);
		padding: 20px;
		width: 400px;
		max-width: 90vw;
	}

	.link-modal-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.link-modal-input {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 14px;
		outline: none;
		box-sizing: border-box;
	}

	.link-modal-input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent-light);
	}

	.link-modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 16px;
	}

	.link-modal-btn {
		padding: 7px 16px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		border: none;
	}

	.link-modal-btn.cancel {
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}

	.link-modal-btn.cancel:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.link-modal-btn.confirm {
		background: var(--accent);
		color: white;
	}

	.link-modal-btn.confirm:hover {
		opacity: 0.9;
	}

	.link-suggest-list {
		max-height: 240px;
		overflow-y: auto;
		margin-top: 8px;
		border: 1px solid var(--border-light);
		border-radius: 8px;
		padding: 4px;
	}

	.link-suggest-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 10px;
		border: none;
		border-radius: 6px;
		background: none;
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		text-align: left;
	}

	.link-suggest-item:hover,
	.link-suggest-item.selected {
		background: var(--accent-light);
		color: var(--accent);
	}

	.link-suggest-item svg {
		flex-shrink: 0;
		color: var(--text-tertiary);
	}

	.link-suggest-item:hover svg,
	.link-suggest-item.selected svg {
		color: var(--accent);
	}

	.link-suggest-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Text context menu */
	.text-ctx-overlay {
		position: fixed;
		inset: 0;
		z-index: 1500;
	}

	.text-ctx-menu {
		position: fixed;
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		box-shadow: var(--shadow-lg);
		padding: 4px;
		min-width: 200px;
		max-height: calc(100vh - 16px);
		overflow-y: auto;
		z-index: 1501;
	}

	.text-ctx-menu button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 12px;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		border-radius: 6px;
		text-align: left;
	}

	.text-ctx-menu button:hover {
		background: var(--bg-hover);
	}

	.text-ctx-shortcut {
		margin-left: auto;
		font-size: 11px;
		color: var(--text-tertiary);
		font-family: inherit;
	}

	.text-ctx-sep {
		height: 1px;
		background: var(--border-light);
		margin: 4px 0;
	}

	.text-ctx-submenu-wrap {
		position: relative;
	}

	.text-ctx-submenu-wrap > button.has-submenu {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 12px;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		border-radius: 6px;
		text-align: left;
	}

	.text-ctx-submenu-wrap > button.has-submenu:hover {
		background: var(--bg-hover);
	}

	.text-ctx-submenu-wrap .submenu-arrow {
		margin-left: auto;
		color: var(--text-tertiary);
	}

	.text-ctx-submenu {
		position: absolute;
		left: 100%;
		top: -4px;
		margin-left: 2px;
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		box-shadow: var(--shadow-lg);
		padding: 4px;
		min-width: 140px;
		z-index: 1502;
	}

	.text-ctx-submenu button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 12px;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		border-radius: 6px;
		text-align: left;
	}

	.text-ctx-submenu button:hover {
		background: var(--bg-hover);
	}

	.text-ctx-submenu button.active {
		color: var(--accent);
		font-weight: 600;
	}

	/* Table grid size picker */
	.table-picker-dropdown {
		padding: 8px;
		min-width: auto;
		width: auto;
	}

	.table-picker-grid {
		display: grid;
		grid-template-columns: repeat(10, 18px);
		grid-template-rows: repeat(8, 18px);
		gap: 2px;
	}

	.table-picker-cell {
		width: 18px;
		height: 18px;
		border: 1px solid var(--border-color);
		border-radius: 2px;
		cursor: pointer;
		transition: background 0.05s;
		background: var(--bg-secondary);
	}

	.table-picker-cell:hover,
	.table-picker-cell.active {
		background: var(--accent-light);
		border-color: var(--accent);
	}

	.table-picker-label {
		text-align: center;
		font-size: 11px;
		color: var(--text-secondary);
		margin-top: 6px;
		font-weight: 500;
	}

	/* Table context menu */
	.table-ctx-overlay {
		position: fixed;
		inset: 0;
		z-index: 1500;
	}

	.table-ctx-menu {
		position: fixed;
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		box-shadow: var(--shadow-lg);
		padding: 4px;
		min-width: 200px;
		max-height: calc(100vh - 16px);
		overflow-y: auto;
		z-index: 1501;
	}

	.table-ctx-menu button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 12px;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		border-radius: 6px;
		text-align: left;
	}

	.table-ctx-menu button:hover {
		background: var(--bg-hover);
	}

	.table-ctx-menu button.danger {
		color: var(--danger);
	}

	.table-ctx-menu button.danger:hover {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
	}

	.table-ctx-sep {
		height: 1px;
		background: var(--border-light);
		margin: 4px 0;
	}

	.table-ctx-color-label {
		padding: 4px 12px 2px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.table-ctx-colors {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 4px;
		padding: 4px 10px 6px;
	}

	.table-ctx-color-swatch {
		width: 26px;
		height: 26px;
		border-radius: 5px;
		border: 1px solid var(--border-color);
		cursor: pointer;
		transition: transform 0.1s;
		padding: 0;
	}

	.table-ctx-color-swatch:hover {
		transform: scale(1.15);
		border-color: var(--accent);
	}

	/* PDF embeds */
	:global(.tiptap .math-block) {
		margin: 16px 0;
		padding: 12px;
		text-align: center;
		overflow-x: auto;
		cursor: default;
	}
	:global(.tiptap .math-inline) {
		cursor: default;
	}
	:global(.tiptap .mermaid-render) {
		position: relative;
		margin: 4px 0 16px;
		padding: 12px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 8px;
		text-align: center;
		overflow-x: auto;
		cursor: default;
		min-height: 32px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	:global(.tiptap .mermaid-render-toolbar) {
		position: absolute;
		top: 6px;
		right: 6px;
		display: flex;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	:global(.tiptap .mermaid-render:hover .mermaid-render-toolbar) {
		opacity: 1;
	}
	:global(.tiptap .mermaid-render-action) {
		appearance: none;
		background: var(--bg-primary);
		color: var(--text-secondary);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 3px 9px;
		font-size: 11px;
		cursor: pointer;
		font-family: inherit;
		line-height: 1.3;
	}
	:global(.tiptap .mermaid-render-action:hover) {
		color: var(--text-primary);
		border-color: var(--accent);
	}
	:global(.tiptap .mermaid-render-toast) {
		position: absolute;
		bottom: 8px;
		right: 8px;
		background: var(--text-primary);
		color: var(--bg-primary);
		padding: 4px 10px;
		border-radius: 5px;
		font-size: 12px;
		max-width: 80%;
		pointer-events: none;
		animation: mermaid-toast-fade 1.5s ease;
	}
	@keyframes mermaid-toast-fade {
		0% { opacity: 0; transform: translateY(4px); }
		15% { opacity: 1; transform: translateY(0); }
		70% { opacity: 1; }
		100% { opacity: 0; }
	}
	:global(.tiptap .mermaid-render svg) {
		max-width: 100%;
		height: auto;
	}
	:global(.tiptap .mermaid-render-loading::before) {
		content: 'Rendering diagram…';
		color: var(--text-secondary);
		font-size: 13px;
	}
	:global(.tiptap .mermaid-render-error) {
		width: 100%;
		box-sizing: border-box;
	}
	:global(.tiptap .diagram-error-card) {
		display: flex;
		flex-direction: column;
		background: color-mix(in srgb, var(--semantic-error) 8%, var(--bg-surface));
		border: 1px solid color-mix(in srgb, var(--semantic-error) 15%, var(--border-color));
		border-radius: var(--radius-standard);
		padding: var(--spacing-sm) var(--spacing-md);
		gap: var(--spacing-xs);
		box-sizing: border-box;
		align-items: flex-start;
		margin: var(--spacing-xs) 0;
	}
	:global(.tiptap .mermaid-render-btn) {
		appearance: none;
		background: var(--bg-tertiary, var(--bg-primary));
		color: var(--text-primary);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px 14px;
		font-size: 13px;
		cursor: pointer;
		font-family: inherit;
	}
	:global(.tiptap .mermaid-render-btn:hover) {
		background: var(--accent);
		color: var(--accent-fg, white);
		border-color: var(--accent);
	}
	:global(.tiptap .mermaid-render-btn-small) {
		padding: 3px 10px;
		font-size: 12px;
	}
	:global(.tiptap .pdf-embed) {
		margin: 12px 0;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		background: var(--bg-secondary);
	}
	:global(.tiptap .pdf-embed iframe) {
		display: block;
		border: none;
		width: 100%;
	}
	:global(.tiptap .pdf-embed .pdf-footer) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 12px;
		background: var(--bg-secondary);
		border-top: 1px solid var(--border);
	}
	:global(.tiptap .pdf-embed .pdf-label) {
		font-size: 12px;
		color: var(--text-secondary);
		margin: 0;
	}
	:global(.tiptap .pdf-embed .pdf-download-btn) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 4px;
		padding: 4px 10px;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.2s;
	}
	:global(.tiptap .pdf-embed .pdf-download-btn:hover) {
		filter: brightness(0.9);
	}
	:global(.tiptap .page-break) {
		position: relative;
		margin: 12px 0;
		height: 20px;
		border: none;
		pointer-events: none;
		user-select: none;
	}
	:global(.tiptap .page-break::before) {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 0;
		border-top: 2px dashed var(--text-tertiary, #aaa);
		opacity: 0.5;
	}
	:global(.tiptap .page-break::after) {
		content: 'Page Break';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: var(--bg-primary, #fff);
		padding: 0 8px;
		font-size: 11px;
		color: var(--text-tertiary, #aaa);
		white-space: nowrap;
	}
	:global(.tiptap .pdf-embed-mobile) {
		margin: 8px 0;
	}
	:global(.tiptap .pdf-link-mobile) {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 16px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		color: var(--text-primary);
		font-size: 15px;
		font-weight: 500;
		text-decoration: none;
		cursor: pointer;
	}
	:global(.tiptap .pdf-link-mobile:active) {
		background: var(--bg-hover);
	}
	:global(.tiptap .pdf-icon-mobile) {
		font-size: 20px;
		line-height: 1;
	}

	/* Slash commands menu */
	.slash-menu-overlay {
		position: fixed;
		inset: 0;
		z-index: 1500;
	}

	.slash-menu {
		position: fixed;
		background: #1e1e1e;
		border: 1px solid #2d2d2d;
		border-radius: 10px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		padding: 6px 4px;
		min-width: 280px;
		max-height: 360px;
		overflow-y: auto;
		z-index: 1501;
	}

	.slash-menu::-webkit-scrollbar {
		width: 6px;
	}

	.slash-menu::-webkit-scrollbar-thumb {
		background: #444;
		border-radius: 3px;
	}

	.slash-menu-category-divider {
		height: 1px;
		background: #2d2d2d;
		margin: 6px 4px;
	}

	.slash-menu-category-header {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #666666;
		font-weight: 700;
		padding: 8px 12px 4px 12px;
	}

	.slash-menu-item {
		display: flex;
		align-items: center;
		gap: 12px;
		width: calc(100% - 8px);
		margin: 0 4px;
		padding: 8px 10px;
		border: none;
		background: none;
		color: #e0e0e0;
		font-size: 13px;
		cursor: pointer;
		border-radius: 6px;
		text-align: left;
		transition: background 0.15s ease;
	}

	.slash-menu-item:hover,
	.slash-menu-item.selected {
		background: #2d2d2d;
		color: #ffffff;
	}

	.slash-menu-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background: #2b2b2b;
		color: #aaaaaa;
		flex-shrink: 0;
	}

	.slash-menu-item:hover .slash-menu-icon,
	.slash-menu-item.selected .slash-menu-icon {
		background: #3a3a3a;
		color: #ffffff;
	}

	.slash-menu-details {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.slash-menu-details-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.slash-menu-label {
		font-weight: 500;
		font-size: 13px;
		color: #e0e0e0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.slash-menu-item:hover .slash-menu-label,
	.slash-menu-item.selected .slash-menu-label {
		color: #ffffff;
	}

	.slash-menu-badge {
		background: rgba(59, 130, 246, 0.15);
		color: #60a5fa;
		border: 1px solid rgba(59, 130, 246, 0.3);
		border-radius: 4px;
		padding: 1px 5px;
		font-size: 9px;
		font-weight: 600;
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.slash-menu-desc {
		font-size: 11px;
		color: #777777;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.slash-menu-item:hover .slash-menu-desc,
	.slash-menu-item.selected .slash-menu-desc {
		color: #999999;
	}

	.slash-menu-empty {
		padding: 16px;
		color: #666666;
		font-size: 13px;
		text-align: center;
	}

	.slash-font-picker-section {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px;
		margin: 0 4px;
	}

	.slash-font-picker-section.has-scroller {
		max-height: 106px;
		overflow-y: auto;
	}

	.slash-font-picker-section::-webkit-scrollbar {
		width: 4px;
	}

	.slash-font-picker-section::-webkit-scrollbar-thumb {
		background: #444;
		border-radius: 2px;
	}

	.slash-font-item {
		display: block;
		width: 100%;
		padding: 8px 12px;
		border: none;
		background: none;
		color: #e0e0e0;
		font-size: 13px;
		cursor: pointer;
		border-radius: 6px;
		text-align: left;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.slash-font-item:hover,
	.slash-font-item.selected {
		background: #2d2d2d;
		color: #ffffff;
	}

	.slash-size-picker-section {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px;
		margin: 0 4px;
	}

	.slash-size-picker-section.has-scroller {
		max-height: 106px;
		overflow-y: auto;
	}

	.slash-size-picker-section::-webkit-scrollbar {
		width: 4px;
	}

	.slash-size-picker-section::-webkit-scrollbar-thumb {
		background: #444;
		border-radius: 2px;
	}

	.slash-size-item {
		display: block;
		width: 100%;
		padding: 8px 12px;
		border: none;
		background: none;
		color: #e0e0e0;
		font-size: 13px;
		cursor: pointer;
		border-radius: 6px;
		text-align: left;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.slash-size-item:hover,
	.slash-size-item.selected {
		background: #2d2d2d;
		color: #ffffff;
	}

	/* Callout block styling */
	:global(.tiptap-wrapper .tiptap [data-type="callout"]) {
		margin: 1.25em 0;
		padding: 14px 16px 14px 18px;
		border-left: 4px solid var(--accent);
		border-radius: 0 8px 8px 0;
		background: var(--bg-secondary);
	}

	:global(.tiptap-wrapper .tiptap [data-type="callout"]::before) {
		display: block;
		font-weight: 700;
		font-size: 11px;
		margin-bottom: 6px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	:global(.tiptap-wrapper .tiptap [data-type="callout"] > p:first-of-type) {
		margin-top: 0;
	}

	:global(.tiptap-wrapper .tiptap [data-type="callout"] > p:last-of-type) {
		margin-bottom: 0;
	}

	:global(.tiptap-wrapper .tiptap [data-type="callout"].callout-note) {
		border-color: #3b82f6;
		background: rgba(59, 130, 246, 0.07);
	}
	:global(.tiptap-wrapper .tiptap [data-type="callout"].callout-note::before) {
		content: "ℹ️ NOTE";
		color: #3b82f6;
	}

	:global(.tiptap-wrapper .tiptap [data-type="callout"].callout-tip) {
		border-color: #10b981;
		background: rgba(16, 185, 129, 0.07);
	}
	:global(.tiptap-wrapper .tiptap [data-type="callout"].callout-tip::before) {
		content: "💡 TIP";
		color: #10b981;
	}

	:global(.tiptap-wrapper .tiptap [data-type="callout"].callout-important) {
		border-color: #8b5cf6;
		background: rgba(139, 92, 246, 0.07);
	}
	:global(.tiptap-wrapper .tiptap [data-type="callout"].callout-important::before) {
		content: "🔥 IMPORTANT";
		color: #8b5cf6;
	}

	:global(.tiptap-wrapper .tiptap [data-type="callout"].callout-warning) {
		border-color: #f59e0b;
		background: rgba(245, 158, 11, 0.07);
	}
	:global(.tiptap-wrapper .tiptap [data-type="callout"].callout-warning::before) {
		content: "⚠️ WARNING";
		color: #f59e0b;
	}

	:global(.tiptap-wrapper .tiptap [data-type="callout"].callout-caution) {
		border-color: #ef4444;
		background: rgba(239, 68, 68, 0.07);
	}
	:global(.tiptap-wrapper .tiptap [data-type="callout"].callout-caution::before) {
		content: "🚫 CAUTION";
		color: #ef4444;
	}

	.slash-table-picker {
		padding: 8px;
	}

	.slash-table-picker-grid {
		display: grid;
		grid-template-columns: repeat(10, 18px);
		grid-template-rows: repeat(8, 18px);
		gap: 2px;
	}

	.slash-table-picker-label {
		text-align: center;
		font-size: 11px;
		color: var(--text-secondary);
		margin-top: 6px;
		font-weight: 500;
	}

	/* Color swatch preview shown before a color literal (VSCode-style decorator) */
	:global(.tiptap-wrapper .tiptap .color-swatch) {
		display: inline-block;
		width: 0.8em;
		height: 0.8em;
		border-radius: 3px;
		margin-right: 0.3em;
		vertical-align: baseline;
		border: 1px solid var(--border-color);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
		user-select: none;
	}

	/* /color slash sub-picker */
	.slash-color-picker {
		padding: 8px;
		width: 210px;
	}
	.slash-color-swatches {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 6px;
		margin-bottom: 8px;
	}
	.slash-color-swatch {
		width: 100%;
		aspect-ratio: 1;
		border-radius: 5px;
		border: 1px solid var(--border-color);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
		cursor: pointer;
		padding: 0;
	}
	.slash-color-swatch:hover {
		transform: scale(1.1);
	}
	.slash-color-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.slash-color-native {
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: none;
		cursor: pointer;
		flex-shrink: 0;
	}
	.slash-color-input {
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 12px;
		font-family: monospace;
		outline: none;
	}
	.slash-color-insert {
		padding: 6px 10px;
		border: none;
		border-radius: 6px;
		background: var(--accent);
		color: #fff;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		flex-shrink: 0;
	}

	/* AI Menu */
	.ai-menu-overlay {
		position: fixed;
		inset: 0;
		z-index: 1600;
	}

	.ai-menu {
		position: fixed;
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		box-shadow: var(--shadow-lg);
		padding: 4px;
		min-width: 320px;
		max-width: 480px;
		z-index: 1601;
		max-height: 80vh;
		overflow-y: auto;
	}

	.ai-menu-label {
		padding: 6px 12px 4px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.ai-menu-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 12px;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		border-radius: 6px;
		text-align: left;
	}

	.ai-menu-item:hover {
		background: var(--bg-hover);
	}

	.ai-menu-sep {
		height: 1px;
		background: var(--border-light);
		margin: 4px 0;
	}

	.ai-menu-arrow {
		margin-left: auto;
		color: var(--text-tertiary);
		display: flex;
		align-items: center;
	}

	.ai-result-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px 4px;
	}

	.ai-result-title {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.ai-spinner {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.ai-result-close {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 2px;
		border-radius: 4px;
		display: flex;
		align-items: center;
	}

	.ai-result-close:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.ai-result-body {
		padding: 8px 12px;
		font-size: 13px;
		color: var(--text-primary);
		line-height: 1.6;
		max-height: 50vh;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.ai-error {
		padding: 8px 12px;
		font-size: 12px;
		color: var(--danger);
		line-height: 1.5;
	}

	.ai-result-actions {
		display: flex;
		gap: 6px;
		padding: 6px 10px 8px;
		border-top: 1px solid var(--border-light);
	}

	.ai-action-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 6px 10px;
		border: none;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.ai-action-btn.apply {
		background: var(--accent);
		color: white;
	}

	.ai-action-btn.apply:hover {
		opacity: 0.9;
	}

	.ai-action-btn.discard {
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
	}

	.ai-action-btn.discard:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.ai-custom-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.ai-back-btn {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 2px;
		border-radius: 4px;
		display: flex;
		align-items: center;
	}

	.ai-back-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.ai-custom-body {
		padding: 6px 10px 8px;
	}

	.ai-custom-input {
		width: 100%;
		min-height: 60px;
		padding: 8px 10px;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 13px;
		font-family: inherit;
		resize: vertical;
		outline: none;
		box-sizing: border-box;
	}

	.ai-custom-input:focus {
		border-color: var(--accent);
	}

	.ai-custom-input::placeholder {
		color: var(--text-tertiary);
	}

	.ai-custom-submit {
		margin-top: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		width: 100%;
		padding: 7px 12px;
		border: none;
		border-radius: 6px;
		background: var(--accent);
		color: white;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}

	.ai-custom-submit:hover:not(:disabled) {
		opacity: 0.9;
	}

	.ai-custom-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Wiki-link styles */
	:global(.tiptap-wrapper .tiptap .wiki-link) {
		color: var(--accent);
		text-decoration: underline dotted;
		text-underline-offset: 3px;
		cursor: pointer;
		border-radius: 2px;
		padding: 0 1px;
	}

	:global(.tiptap-wrapper .tiptap .wiki-link:hover) {
		background: var(--accent-light);
		text-decoration: underline solid;
	}

	:global(.tiptap-wrapper .tiptap .wiki-link[data-path=""]) {
		color: var(--text-tertiary);
		text-decoration: underline dashed;
	}

	.wiki-link-overlay {
		position: fixed;
		inset: 0;
		z-index: 1600;
	}

	.wiki-link-menu {
		position: fixed;
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		box-shadow: var(--shadow-lg);
		width: 280px;
		max-height: 360px;
		overflow-y: auto;
		padding: 4px;
		z-index: 1601;
	}

	.wiki-link-empty {
		padding: 12px 14px;
		font-size: 12px;
		color: var(--text-tertiary);
		text-align: center;
	}

	.wiki-link-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 10px;
		border: none;
		border-radius: 6px;
		background: none;
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		text-align: left;
	}

	.wiki-link-item:hover,
	.wiki-link-item.selected {
		background: var(--accent-light);
		color: var(--accent);
	}

	.wiki-link-item svg {
		flex-shrink: 0;
		color: var(--text-tertiary);
	}

	.wiki-link-item:hover svg,
	.wiki-link-item.selected svg {
		color: var(--accent);
	}

	.wiki-link-title-col {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-width: 0;
	}

	.wiki-link-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wiki-link-folder {
		font-size: 11px;
		color: var(--text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wiki-link-disambig-header {
		padding: 8px 10px 4px;
		font-size: 11px;
		color: var(--text-tertiary);
		font-weight: 500;
	}

	/* ═══ MOBILE (class-based, not media-query, for Android high-DPI) ═══ */
	.editor-container.mobile {
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.editor-container.mobile .editor-toolbar {
		padding: 8px 16px 6px 16px;
		flex-shrink: 0;
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
	}

	.toolbar-actions.mobile {
		gap: 4px;
	}

	.toolbar-actions.mobile .icon-btn {
		min-width: 32px;
		min-height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.toolbar-actions.mobile .save-indicator,
	.toolbar-actions.mobile .readonly-indicator {
		font-size: 12px;
	}

	.editor-container.mobile .editor-title input {
		font-size: 20px;
		padding: 4px 0;
	}

	.editor-container.mobile .editor-body-wrapper {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.editor-container.mobile .editor-body-row {
		min-height: 0;
	}

	.editor-container.mobile .editor-body {
		min-height: 0;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding: 0;
	}

	.editor-container.mobile .tiptap-wrapper {
		min-height: 0;
	}

	.editor-container.mobile .editor-formatting-bar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 500;
		padding: 4px 8px;
		padding-bottom: calc(4px + env(safe-area-inset-bottom));
		overflow-x: auto;
		flex-wrap: nowrap;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
		gap: 1px;
		background: var(--bg-surface) !important;
		border-top: 1px solid var(--border-color);
		/* UI-M-012: keep the keyboard-anchored bar scrolling horizontally only and
		   prevent the scroll from chaining into the page/editor body. */
		touch-action: pan-x;
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
	}

	.editor-container.mobile .editor-formatting-bar::-webkit-scrollbar {
		display: none;
	}

	.editor-container.mobile .fmt-btn {
		min-width: 38px;
		height: 38px;
		flex-shrink: 0;
		padding: 6px;
	}

	.editor-container.mobile .fmt-sep {
		height: 20px;
		margin: 0 2px;
	}

	.editor-container.mobile .fmt-dropdown,
	.editor-container.mobile .insert-dropdown {
		position: fixed !important;
		bottom: calc(48px + env(safe-area-inset-bottom)) !important;
		left: 50% !important;
		transform: translateX(-50%) !important;
		right: auto !important;
		width: calc(100vw - 32px) !important;
		max-width: 280px !important;
		max-height: 50vh;
		overflow-y: auto;
		z-index: 2000 !important;
		box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.2) !important;
		background: var(--bg-surface) !important;
		border: 1px solid var(--border-color) !important;
		border-radius: 8px !important;
	}

	.editor-container.mobile .table-picker-dropdown {
		max-width: 220px !important;
	}

	.editor-container.mobile .color-picker-dropdown {
		max-width: 240px !important;
	}

	.editor-container.mobile .fmt-dropdown button {
		padding: 12px 16px;
		font-size: 15px;
		min-height: 44px;
	}

	.editor-container.mobile .insert-dropdown {
		position: absolute;
		bottom: calc(100% + 4px);
		left: 0;
		right: auto;
		min-width: 200px;
		max-width: calc(100vw - 16px);
	}

	.editor-container.mobile .shortcuts-hint {
		display: none;
	}

	.editor-container.mobile .empty-editor p {
		font-size: 16px;
	}

	.editor-container.mobile :global(.editor-content) {
		padding: 8px 16px 220px !important;
		font-size: 16px !important;
	}

	.editor-container.mobile .source-editor {
		padding: 8px 16px 220px;
		font-size: 15px;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-x: hidden;
	}

	.editor-container.mobile .editor-body-row {
		position: relative;
	}

	.editor-container.mobile .editor-body-row:has(.history-panel) > .editor-body,
	.editor-container.mobile .editor-body-row:has(.outline-panel) > .editor-body {
		display: none;
	}

	.editor-container.mobile .history-panel,
	.editor-container.mobile .outline-panel {
		position: static;
		flex: 1;
		min-height: 0;
		width: 100% !important;
		max-width: 100%;
		border-left: none;
	}

	.editor-container.mobile .history-item {
		padding: 12px 12px;
		min-height: 48px;
	}

	.editor-container.mobile .history-list {
		padding-bottom: 80px;
	}

	.editor-container.mobile .history-restore-btn {
		padding: 14px 16px;
		font-size: 15px;
	}

	.editor-container.mobile .history-actions {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 12px;
		padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
		background: var(--bg-surface) !important;
		border-top: 1px solid var(--border-light);
		z-index: 51;
	}

	.editor-container.mobile .note-search-bar {
		padding: 8px 12px;
	}

	.editor-container.mobile .note-search-bar input {
		padding: 8px 10px;
		font-size: 15px;
	}

	/* ═══ AI Menu - Mobile Bottom Sheet ═══ */
	.ai-menu-overlay.mobile {
		background: rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.ai-menu.mobile {
		position: relative;
		left: auto !important;
		top: auto !important;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		border-radius: 16px 16px 0 0;
		border-bottom: none;
		max-height: 70vh;
		padding: 8px 4px calc(env(safe-area-inset-bottom, 0px) + 8px);
	}

	.ai-menu.mobile .ai-menu-label {
		padding: 10px 16px 6px;
		font-size: 12px;
	}

	.ai-menu.mobile .ai-menu-item {
		padding: 12px 16px;
		font-size: 15px;
		min-height: 44px;
		border-radius: 8px;
	}

	.ai-menu.mobile .ai-menu-sep {
		margin: 4px 8px;
	}

	.ai-menu.mobile .ai-result-header {
		padding: 12px 16px 8px;
	}

	.ai-menu.mobile .ai-result-body {
		padding: 8px 16px;
		font-size: 15px;
		max-height: 40vh;
	}

	.ai-menu.mobile .ai-result-actions {
		padding: 8px 16px 4px;
		gap: 10px;
	}

	.ai-menu.mobile .ai-result-actions button {
		padding: 10px 16px;
		font-size: 14px;
		min-height: 44px;
	}

	.ai-menu.mobile .ai-custom-body {
		padding: 8px 12px;
	}

	.ai-menu.mobile .ai-custom-input {
		font-size: 15px;
		min-height: 80px;
	}

	.ai-menu.mobile .ai-custom-submit {
		padding: 10px 16px;
		font-size: 14px;
		min-height: 44px;
	}

	.ai-menu.mobile .ai-custom-header {
		padding: 10px 12px;
		font-size: 15px;
	}

	.ai-menu.mobile .ai-back-btn {
		min-width: 44px;
		min-height: 44px;
	}

	.ai-menu.mobile .ai-error {
		padding: 12px 16px;
		font-size: 14px;
	}

	/* ═══ TYPING / EDITING ENHANCEMENTS STYLES ═══ */

	.editor-body.focus-mode-active :global(.tiptap > *) {
		opacity: 0.25;
		transition: opacity 0.25s ease-in-out;
	}

	/* Keep active block or any block containing the active block at opacity 1 */
	.editor-body.focus-mode-active :global(.tiptap > *.has-focus),
	.editor-body.focus-mode-active :global(.tiptap > *:has(.has-focus)) {
		opacity: 1;
	}

	/* Also make sure that the focused node itself has opacity 1 */
	.editor-body.focus-mode-active :global(.has-focus) {
		opacity: 1 !important;
	}

	/* Dim siblings inside active block containers (e.g. other items in a list) */
	.editor-body.focus-mode-active :global(.tiptap > *:has(.has-focus) > *:not(.has-focus):not(:has(.has-focus))) {
		opacity: 0.25;
	}

	/* Enable smooth opacity changes on all nested elements when moving focus */
	.editor-body.focus-mode-active :global(.tiptap *) {
		transition: opacity 0.25s ease-in-out;
	}

	.editor-body.typewriter-active :global(.tiptap) {
		padding-bottom: 50vh !important;
	}

	.bubble-menu-hud {
		position: absolute;
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 4px;
		background: #1a1a1a;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 20px;
		padding: 4px 6px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		z-index: 100;
		animation: bubble-fade-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) both;
		transform: translateX(-50%);
	}

	@keyframes bubble-fade-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(4px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0) scale(1);
		}
	}

	.bubble-btn {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.bubble-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
		transform: scale(1.08);
	}

	.bubble-btn:active {
		transform: scale(0.95);
	}

	.bubble-btn.active {
		color: var(--accent) !important;
		background: rgba(0, 173, 181, 0.15);
	}

	.bubble-sep {
		width: 1px;
		height: 16px;
		background: rgba(255, 255, 255, 0.15);
		margin: 0 4px;
	}
	.export-dropdown-wrap {
		position: relative;
	}

	.export-dropdown {
		top: calc(100% + 4px) !important;
		bottom: auto !important;
		right: 0 !important;
		left: auto !important;
		min-width: 180px;
	}

	.export-dropdown button {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.export-dropdown.mobile {
		right: 0 !important;
		left: auto !important;
	}

	@media print {
		:global(body), :global(html) {
			background: #fff !important;
			color: #000 !important;
		}
		:global(.app-container), :global(.sidebar), :global(.note-list), :global(.editor-toolbar), :global(.editor-formatting-bar), :global(.icon-btn), :global(.mode-segmented-control), :global(.fmt-btn), :global(.fmt-sep), :global(.pdf-download-btn), :global(.nav-history-btns) {
			display: none !important;
		}
		:global(.editor-container) {
			margin: 0 !important;
			padding: 0 !important;
			border: none !important;
			width: 100% !important;
			max-width: 100% !important;
			box-shadow: none !important;
		}
		:global(.editor-body) {
			padding: 0 !important;
			margin: 0 !important;
			overflow: visible !important;
			height: auto !important;
		}
		:global(.tiptap-wrapper) {
			padding: 0 !important;
			margin: 0 !important;
			max-width: 100% !important;
			width: 100% !important;
		}
		:global(.tiptap) {
			color: #000 !important;
			background: transparent !important;
		}
	}

	/* ═══ Diagram node - Clean Evernote-style design ═══ */
	:global(.diagram-block) {
		display: block;
		margin: 24px auto;
		padding: 16px; /* 16px padding on all 4 sides */
		border-radius: 12px;
		border: 1px solid var(--border-color, #2a2d35);
		background: #ffffff;
		cursor: pointer;
		transition: all 0.2s ease;
		overflow: hidden;
		width: fit-content; /* hug the diagram size dynamically */
		max-width: 100%;
		box-sizing: border-box;
	}

	:global(.diagram-block[data-diagram-type="mermaid"]) {
		width: 100% !important; /* Force container to stretch so max-width scales it proportional to page width */
	}

	:global(.diagram-block[data-diagram-type="mermaid"] svg) {
		width: 100% !important;
		height: auto !important;
		max-width: 100% !important;
	}

	/* Diagram Sizing */
	:global(.diagram-block[data-size="small"]) {
		max-width: 33%;
	}
	:global(.diagram-block[data-size="medium"]) {
		max-width: 65%;
	}
	:global(.diagram-block[data-size="full"]) {
		max-width: 100%;
		width: fit-content;
	}
	@media (max-width: 768px) {
		:global(.diagram-block[data-size="full"]) {
			width: 100%;
		}
	}

	/* Diagram Alignment */
	:global(.diagram-block[data-align="left"]) {
		margin-left: 0;
		margin-right: auto;
	}
	:global(.diagram-block[data-align="center"]) {
		margin-left: auto;
		margin-right: auto;
	}
	:global(.diagram-block[data-align="right"]) {
		margin-left: auto;
		margin-right: 0;
	}

	:global(.diagram-block:hover) {
		border-color: var(--accent, #38bdf8);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
	}

	:global(.diagram-block.ProseMirror-selectednode) {
		border-color: var(--accent, #38bdf8);
		box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
	}

	:global(.diagram-block svg) {
		display: block;
		max-width: 100%;
		height: auto;
		background: transparent;
	}

	/* Automatically invert colors in dark themes for dark mode rendering (white bg -> dark, dark lines -> light) */
	:global(:root:not(.theme-paper):not(.theme-sakura):not(.theme-matcha) .diagram-block) {
		filter: invert(0.9) hue-rotate(180deg);
	}

	:global(.diagram-empty) {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 40px 24px;
		background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
		color: #6c757d;
		font-size: 14px;
		font-weight: 500;
		gap: 8px;
		min-height: 150px;
	}

	:global(.diagram-empty::before) {
		content: '📊';
		font-size: 28px;
	}

	@media print {
		:global(.diagram-block) {
			border: 1px solid #ddd !important;
			box-shadow: none !important;
		}
	}

	/* Rich File Attachment Styles */
	:global(.file-attachment-block) {
		margin: 16px 0;
		max-width: 850px;
		width: 100%;
		border: 1px solid var(--border-highlight, rgba(0, 0, 0, 0.1));
		border-radius: 8px;
		background: var(--bg-surface, #f9f9f9);
		overflow: hidden;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
		transition: transform 0.2s ease, box-shadow 0.2s ease;
		box-sizing: border-box;
	}

	:global(.file-attachment-block:hover) {
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}

	:global(.file-header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		background: var(--bg-primary, #ffffff);
		border-bottom: 1px solid var(--border-highlight, rgba(0, 0, 0, 0.1));
		user-select: none;
	}

	:global(.file-title) {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary, #333333);
	}

	:global(.file-icon) {
		font-size: 16px;
	}

	:global(.file-name) {
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.file-size) {
		font-weight: normal;
		font-size: 11px;
		color: var(--text-secondary, #666666);
	}

	:global(.file-actions) {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	:global(.file-action-btn) {
		padding: 4px 8px;
		font-size: 11px;
		font-weight: 500;
		border-radius: 4px;
		border: 1px solid var(--border-highlight, rgba(0, 0, 0, 0.1));
		background: var(--bg-surface, #f9f9f9);
		color: var(--text-primary, #333333);
		cursor: pointer;
		transition: background-color 0.15s ease, border-color 0.15s ease;
	}

	:global(.file-action-btn:hover) {
		background: var(--bg-mid-dark, #eeeeee);
		border-color: var(--text-secondary, #666666);
	}

	/* Text preview specific styles */
	:global(.text-preview-content) {
		margin: 0;
		padding: 12px 16px;
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-primary, #333333);
		background: var(--bg-surface, #f9f9f9);
		max-height: 300px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-all;
	}

	/* PDF preview specific styles */
	:global(.pdf-iframe-wrapper) {
		width: 100%;
		max-width: 850px;
		margin: 0;
		height: 80vh;
		min-height: 700px;
		background: #525659;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}

	:global(.pdf-preview-iframe) {
		width: 100%;
		height: 100%;
		border: none;
		display: block;
	}

	/* Audio preview specific styles */
	:global(.audio-player-wrapper) {
		padding: 16px;
		display: flex;
		justify-content: center;
		background: var(--bg-surface, #f9f9f9);
	}

	:global(.audio-preview-element) {
		width: 100%;
		max-width: 500px;
	}

	/* Video preview specific styles */
	:global(.video-player-wrapper) {
		padding: 0;
		background: #000;
		display: flex;
		justify-content: center;
		max-height: 450px;
	}

	:global(.video-preview-element) {
		max-width: 100%;
		max-height: 450px;
		display: block;
	}

	/* Spreadsheet preview specific styles */
	:global(.spreadsheet-preview-content) {
		background: #ffffff !important;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		padding: 0;
	}

	:global(.spreadsheet-loading) {
		padding: 32px;
		text-align: center;
		color: #666666;
		font-size: 13px;
		font-style: italic;
		background: #ffffff !important;
	}

	:global(.spreadsheet-error) {
		padding: 32px;
		text-align: center;
		color: #e74c3c;
		font-size: 13px;
		background: #ffffff !important;
	}

	:global(.spreadsheet-tabs) {
		display: flex;
		background: #1a1a1a !important;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		padding: 0 12px;
		gap: 6px;
		overflow-x: auto;
		user-select: none;
	}

	:global(.spreadsheet-tab-btn) {
		padding: 10px 16px;
		font-size: 12px;
		font-weight: 600;
		border: none;
		border-bottom: 2px solid transparent;
		background: none;
		color: #888888;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.2s ease;
	}

	:global(.spreadsheet-tab-btn:hover) {
		color: #ffffff;
		background: rgba(255, 255, 255, 0.05);
	}

	:global(.spreadsheet-tab-btn.active) {
		color: #27ae60 !important;
		border-bottom-color: #27ae60 !important;
		background: rgba(39, 174, 96, 0.15) !important;
	}

	:global(.spreadsheet-table-wrapper) {
		width: 100%;
		overflow: auto;
		max-height: 450px;
		background: #ffffff !important;
	}

	:global(.spreadsheet-table) {
		border-collapse: collapse;
		width: max-content;
		min-width: 100%;
		background: #ffffff !important;
		table-layout: auto !important; /* Critical override of Tiptap's table-layout: fixed! */
	}

	:global(.spreadsheet-table tr) {
		background: transparent !important;
	}

	:global(.spreadsheet-table td), :global(.spreadsheet-table th) {
		border: 1px solid #d0d0d0 !important;
		padding: 6px 12px !important;
		font-size: 12px;
		min-width: 100px;
		max-width: 300px;
		white-space: nowrap !important; /* Force nowrap to prevent vertical word wrapping! */
		overflow: hidden;
		text-overflow: ellipsis;
		background-color: transparent;
		color: #333333; /* Default dark text color, overridden by inline styles */
	}

	:global(.spreadsheet-table th) {
		font-weight: 600;
		background: #f1f3f4 !important;
		color: #333333;
		position: sticky;
		top: 0;
		z-index: 1;
		border-bottom: 2px solid #c0c0c0 !important;
	}

	:global(.spreadsheet-table tr:hover) {
		background: rgba(0, 0, 0, 0.02) !important;
	}

	/* Evernote-style Visual File Card Styles */
	:global(.file-card) {
		display: flex;
		align-items: center;
		padding: 12px 16px;
		background: var(--bg-surface, #f9f9f9);
		cursor: pointer;
		position: relative;
		border-left: 4px solid var(--text-secondary, #666666);
		transition: background-color 0.2s ease;
	}

	:global(.file-card:hover) {
		background: var(--bg-primary, #ffffff);
	}

	:global(.file-card.archive) {
		border-left-color: #f39c12; /* orange */
	}

	:global(.file-card.document) {
		border-left-color: #3498db; /* blue */
	}

	:global(.file-card.spreadsheet) {
		border-left-color: #2ecc71; /* green */
	}

	:global(.file-card.presentation) {
		border-left-color: #e74c3c; /* red */
	}

	:global(.file-card-left) {
		margin-right: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	:global(.file-card-icon) {
		font-size: 24px;
	}

	:global(.file-card-middle) {
		flex: 1;
		min-width: 0; /* truncate helper */
	}

	:global(.file-card-name) {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary, #333333);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.file-card-meta) {
		font-size: 11px;
		color: var(--text-secondary, #666666);
		margin-top: 2px;
	}

	:global(.file-card-right) {
		margin-left: 14px;
		display: flex;
		align-items: center;
	}

	:global(.file-card-download-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: rgba(0, 0, 0, 0.04);
		border: 1px solid var(--border-highlight, rgba(0, 0, 0, 0.08));
		border-radius: 50%;
		font-size: 14px;
		cursor: pointer;
		opacity: 0.6;
		transition: all 0.2s ease;
		color: var(--text-primary, #333333);
		padding: 0;
		margin: 0;
	}

	:global(.file-card:hover .file-card-download-btn) {
		opacity: 1;
		background: rgba(0, 0, 0, 0.08);
		border-color: var(--text-secondary, #666666);
		transform: scale(1.05);
	}

	.mobile-note-title-container {
		width: 100%;
		padding: 16px 20px 8px 20px;
		background-color: transparent;
	}
	.mobile-note-title-container.focus-mode {
		display: none;
	}
	.mobile-note-title-input {
		width: 100%;
		font-size: 28px;
		font-weight: 800;
		color: var(--text-primary);
		border: none;
		outline: none;
		background: transparent;
		padding: 0;
		margin: 0;
		letter-spacing: -0.8px;
	}
	.mobile-note-title-input::placeholder {
		color: var(--text-tertiary);
		opacity: 0.5;
	}
</style>

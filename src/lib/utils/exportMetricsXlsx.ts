import ExcelJS from 'exceljs';
import { saveOrShareBlob } from './download';

export function cleanText(text: string): string {
	let t = String(text || '');
	// Strip YYYY-MM-DD
	t = t.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '');
	// Strip MM/DD/YYYY, DD/MM/YYYY, MM-DD-YYYY, DD-MM-YYYY
	t = t.replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '');
	return t;
}

export function getRowNumbers(text: string): number[] {
	const cleaned = cleanText(text);
	const regex = /-?(?:\d+(?:\.\d+)?|\.\d+)/g;
	const numbers: number[] = [];
	let match;
	
	while ((match = regex.exec(cleaned)) !== null) {
		const valStr = match[0];
		const start = match.index;
		const end = regex.lastIndex;
		
		let isTouching = false;
		
		if (start > 0) {
			const prevChar = cleaned[start - 1];
			if (/[a-zA-Z0-9]/.test(prevChar)) {
				isTouching = true;
			}
			if (/[-+/]/.test(prevChar)) {
				let idx = start - 1;
				while (idx > 0 && /\s/.test(cleaned[idx - 1])) {
					idx--;
				}
				if (idx > 0 && /[a-zA-Z0-9]/.test(cleaned[idx - 1])) {
					isTouching = true;
				}
			}
		}
		
		if (end < cleaned.length) {
			const nextChar = cleaned[end];
			if (/[a-zA-Z0-9]/.test(nextChar)) {
				isTouching = true;
			}
			if (/[-+/]/.test(nextChar)) {
				let idx = end;
				while (idx < cleaned.length - 1 && /\s/.test(cleaned[idx + 1])) {
					idx++;
				}
				if (idx < cleaned.length - 1 && /[a-zA-Z0-9]/.test(cleaned[idx + 1])) {
					isTouching = true;
				}
			}
		}
		
		if (!isTouching) {
			const num = parseFloat(valStr);
			if (!isNaN(num)) {
				numbers.push(num);
			}
		}
	}
	
	return numbers;
}

export function getCleanDescription(text: string): string {
	let t = text || '';
	t = t.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '');
	t = t.replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '');
	t = t.replace(/-?(?:\d+(?:\.\d+)?|\.\d+)/g, '');
	t = t.replace(/#\S+/g, '');
	t = t.replace(/\s+/g, ' ');
	t = t.trim().replace(/^[-–—,.\s]+|[-–—,.\s]+$/g, '');
	return t || 'Entry';
}

export function extractRowDate(text: string): string {
	const dmyRegex = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/;
	let match = dmyRegex.exec(text);
	if (match) {
		let day = match[1].padStart(2, '0');
		let month = match[2].padStart(2, '0');
		let year = match[3];
		if (year.length === 2) year = '20' + year;
		return `${year}-${month}-${day}`;
	}
	const ymdRegex = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/;
	match = ymdRegex.exec(text);
	if (match) {
		let year = match[1];
		let month = match[2].padStart(2, '0');
		let day = match[3].padStart(2, '0');
		return `${year}-${month}-${day}`;
	}
	return '—';
}

export interface MetricsExportRow {
	label: string;
	cleanedLabel: string;
	date: string;
	value: number;
	tags: { name: string; color?: string }[];
	counted: boolean;
}

export interface CategoryAnalysisItem {
	rank: number;
	name: string;
	color?: string;
	total: number;
	pct: number;
}

export interface InsightsData {
	largestExpense: number;
	smallestExpense: number;
	averageExpense: number;
	mostUsedCategory: string;
	topCategory: string;
}

export interface MetricsExportData {
	title: string;
	currency: string;
	incomeLabel: string;
	income: number;
	rows: MetricsExportRow[];
	stats: {
		count: number;
		sum: number;
		average: number;
		min: number;
		max: number;
		median: number;
		inflows: number;
		expenses: number;
		net: number;
	};
	savings: number;
	categoryTotals: CategoryAnalysisItem[];
	untaggedTotal: number;
	largeIncomeThreshold: number;
	largeExpenseThreshold: number;
	insights: InsightsData;
	exportedAt: string;
	boxId: string;
}

function cleanHex(hex: string | undefined): string {
	if (!hex) return '';
	return hex.replace('#', '').toUpperCase();
}

function toARGB(hex: string | undefined, defaultHex = 'FFFFFF'): string {
	if (!hex) return 'FF' + defaultHex;
	const clean = cleanHex(hex);
	if (clean.length === 6) return 'FF' + clean;
	return 'FF' + defaultHex;
}

function getLuminance(hex: string | undefined): number {
	if (!hex) return 255;
	const clean = cleanHex(hex);
	const r = parseInt(clean.substring(0, 2), 16) || 0;
	const g = parseInt(clean.substring(2, 4), 16) || 0;
	const b = parseInt(clean.substring(4, 6), 16) || 0;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function populateWorksheet(worksheet: ExcelJS.Worksheet, data: MetricsExportData): void {

	// Column definitions (Col A is left margin spacer)
	worksheet.columns = [
		{ key: 'spacer', width: 3 },
		{ key: 'date', width: 14 },
		{ key: 'label', width: 32 },
		{ key: 'amount', width: 16 },
		{ key: 'category', width: 22 },
		{ key: 'included', width: 12 }
	];

	// Formatting Helpers
	const fontName = 'Segoe UI';
	const currencyFmt = `"${data.currency}"#,##0.00`;
	
	const borderLight = {
		top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
		bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
		left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
		right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } }
	};

	let r = 1;

	// Row height helper
	const getRow = (num: number) => worksheet.getRow(num);

	// 1. Report Header Banner
	getRow(r).height = 10;
	r++; // Top spacer row

	worksheet.mergeCells(`B${r}:F${r}`);
	const titleCell = worksheet.getCell(`B${r}`);
	titleCell.value = (data.title || 'Calculation').toUpperCase();
	titleCell.font = { name: fontName, size: 22, bold: true, color: { argb: 'FF1F4E79' } };
	titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
	getRow(r).height = 35;
	r++;

	worksheet.mergeCells(`B${r}:F${r}`);
	const subtitleCell = worksheet.getCell(`B${r}`);
	subtitleCell.value = 'Financial Report & Analysis';
	subtitleCell.font = { name: fontName, size: 12, italic: true, color: { argb: 'FF6B7280' } };
	subtitleCell.alignment = { vertical: 'middle', horizontal: 'left' };
	getRow(r).height = 20;
	r++;

	worksheet.mergeCells(`B${r}:F${r}`);
	const metaCell = worksheet.getCell(`B${r}`);
	const formattedDate = new Date(data.exportedAt).toLocaleDateString('en-GB', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
	metaCell.value = `Generated from myNotes · ${formattedDate} · ${data.currency}`;
	metaCell.font = { name: fontName, size: 9, color: { argb: 'FF9CA3AF' } };
	metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
	for (let col = 2; col <= 6; col++) {
		worksheet.getCell(r, col).border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
	}
	getRow(r).height = 18;
	r += 2; // Spacing before KPI cards

	// 2. KPI Cards (2x2 Grid using merged cells: B:C and D:F)
	const valueRow1 = r;
	const labelRow1 = r + 1;
	const valueRow2 = r + 2;
	const labelRow2 = r + 3;

	getRow(valueRow1).height = 28;
	getRow(labelRow1).height = 18;
	getRow(valueRow2).height = 28;
	getRow(labelRow2).height = 18;

	const cardConfig = [
		{
			startCol: 2, // B
			endCol: 3,   // C
			startColName: 'B',
			endColName: 'C',
			valueRow: valueRow1,
			labelRow: labelRow1,
			val: data.income,
			label: data.incomeLabel || 'Income',
			isCurrency: true,
			bg: 'FFE8F5E9',
			text: 'FF2E7D32'
		},
		{
			startCol: 4, // D
			endCol: 6,   // F
			startColName: 'D',
			endColName: 'F',
			valueRow: valueRow1,
			labelRow: labelRow1,
			val: data.stats.expenses,
			label: 'Expenses',
			isCurrency: true,
			bg: 'FFFDECEA',
			text: 'FFC62828'
		},
		{
			startCol: 2, // B
			endCol: 3,   // C
			startColName: 'B',
			endColName: 'C',
			valueRow: valueRow2,
			labelRow: labelRow2,
			val: data.savings,
			label: data.savings >= 0 ? 'Safe to Spend' : 'Overspent',
			isCurrency: true,
			bg: data.savings >= 0 ? 'FFE8F5E9' : 'FFFDECEA',
			text: data.savings >= 0 ? 'FF2E7D32' : 'FFC62828'
		},
		{
			startCol: 4, // D
			endCol: 6,   // F
			startColName: 'D',
			endColName: 'F',
			valueRow: valueRow2,
			labelRow: labelRow2,
			val: data.stats.count,
			label: 'Transactions',
			isCurrency: false,
			bg: 'FFF1F5F9',
			text: 'FF475569'
		}
	];

	cardConfig.forEach(card => {
		// Merge cells for value and label
		worksheet.mergeCells(`${card.startColName}${card.valueRow}:${card.endColName}${card.valueRow}`);
		worksheet.mergeCells(`${card.startColName}${card.labelRow}:${card.endColName}${card.labelRow}`);

		// Style value cells in range
		for (let col = card.startCol; col <= card.endCol; col++) {
			const cell = worksheet.getCell(card.valueRow, col);
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: card.bg } };
			cell.border = {
				top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
				left: col === card.startCol ? { style: 'thin', color: { argb: 'FFCBD5E1' } } : undefined,
				right: col === card.endCol ? { style: 'thin', color: { argb: 'FFCBD5E1' } } : undefined
			};
		}

		// Style label cells in range
		for (let col = card.startCol; col <= card.endCol; col++) {
			const cell = worksheet.getCell(card.labelRow, col);
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: card.bg } };
			cell.border = {
				bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
				left: col === card.startCol ? { style: 'thin', color: { argb: 'FFCBD5E1' } } : undefined,
				right: col === card.endCol ? { style: 'thin', color: { argb: 'FFCBD5E1' } } : undefined
			};
		}

		// Format top-left value cell
		const vCell = worksheet.getCell(`${card.startColName}${card.valueRow}`);
		vCell.value = card.val;
		vCell.numFmt = card.isCurrency ? currencyFmt : '#,##0';
		vCell.font = { name: fontName, size: 16, bold: true, color: { argb: card.text } };
		vCell.alignment = { horizontal: 'center', vertical: 'middle' };

		// Format top-left label cell
		const lCell = worksheet.getCell(`${card.startColName}${card.labelRow}`);
		lCell.value = card.label;
		lCell.font = { name: fontName, size: 9, bold: true, color: { argb: 'FF6B7280' } };
		lCell.alignment = { horizontal: 'center', vertical: 'middle' };
	});

	r += 5; // Spacing before transactions (occupies rows r to r+3, r+4 is spacer row, transactions start at r+5)

	// 3. Transactions Section
	worksheet.mergeCells(`B${r}:F${r}`);
	const txHeadingCell = worksheet.getCell(`B${r}`);
	txHeadingCell.value = 'TRANSACTIONS';
	txHeadingCell.font = { name: fontName, size: 13, bold: true, color: { argb: 'FF1F4E79' } };
	txHeadingCell.alignment = { vertical: 'middle' };
	getRow(r).height = 24;
	r++;

	// Headers
	const headers = ['Date', 'Label', 'Amount', 'Category', 'Included'];
	headers.forEach((h, idx) => {
		const cell = worksheet.getCell(r, idx + 2); // Start at Col B (index 2)
		cell.value = h;
		cell.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
		cell.alignment = { horizontal: 'center', vertical: 'middle' };
		cell.border = borderLight;
	});
	getRow(r).height = 24;
	const headerRowIndex = r;
	r++;

	// Row data
	data.rows.forEach((row, index) => {
		const isCounted = row.counted;
		const isEven = index % 2 === 0;
		const rowFillColor = isEven ? 'FFF8FAFC' : 'FFFFFFFF';
		const rowStyle = isCounted 
			? { font: { name: fontName, size: 10, color: { argb: 'FF334155' } } }
			: { font: { name: fontName, size: 10, color: { argb: 'FF94A3B8' }, italic: true, strike: true } };

		const rowFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFillColor } };

		// Date (Col B)
		const dCell = worksheet.getCell(`B${r}`);
		if (row.date && row.date !== '—') {
			const parts = row.date.split('-');
			if (parts.length === 3) {
				const year = parseInt(parts[0], 10);
				const month = parseInt(parts[1], 10) - 1;
				const day = parseInt(parts[2], 10);
				dCell.value = new Date(Date.UTC(year, month, day));
				dCell.numFmt = 'dd/mm/yyyy';
			} else {
				dCell.value = row.date;
			}
		} else {
			dCell.value = '—';
		}
		dCell.font = rowStyle.font;
		dCell.fill = rowFill;
		dCell.alignment = { horizontal: 'center', vertical: 'middle' };
		dCell.border = borderLight;

		// Label (Col C)
		const lCell = worksheet.getCell(`C${r}`);
		lCell.value = row.cleanedLabel;
		lCell.font = rowStyle.font;
		lCell.fill = rowFill;
		lCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
		lCell.border = borderLight;

		// Amount (Col D)
		const aCell = worksheet.getCell(`D${r}`);
		aCell.value = row.value;
		aCell.numFmt = currencyFmt;
		aCell.border = borderLight;
		aCell.fill = rowFill;

		// Amount Coloring: dynamic color tokens by magnitude/sign
		let amtColor = 'FF334155'; // default slate
		if (!isCounted) {
			amtColor = 'FF94A3B8';
		} else if (row.value > 0) {
			amtColor = row.value >= data.largeIncomeThreshold ? 'FF1B5E20' : 'FF2E7D32';
		} else if (row.value < 0) {
			amtColor = row.value <= data.largeExpenseThreshold ? 'FF8E1B1B' : 'FFC62828';
		} else {
			amtColor = 'FF6B7280';
		}
		aCell.font = { 
			name: 'Consolas', 
			size: 10, 
			bold: isCounted, 
			color: { argb: amtColor },
			italic: !isCounted,
			strike: !isCounted
		};
		aCell.alignment = { horizontal: 'right', vertical: 'middle' };

		// Category Tags (Col E)
		const cCell = worksheet.getCell(`E${r}`);
		cCell.border = borderLight;
		cCell.fill = rowFill;
		
		if (row.tags && row.tags.length > 0) {
			const tagCount = row.tags.length;
			if (tagCount === 1) {
				const tag = row.tags[0];
				const tagHex = cleanHex(tag.color) || 'CCCCCC';
				const luminance = getLuminance(tag.color);
				cCell.value = tag.name;
				cCell.font = {
					name: fontName,
					size: 9,
					bold: true,
					color: { argb: luminance < 140 ? 'FFFFFFFF' : 'FF1E293B' }
				};
				cCell.fill = {
					type: 'pattern',
					pattern: 'solid',
					fgColor: { argb: toARGB(tag.color, 'CCCCCC') }
				};
			} else {
				// Multiple tags: soft neutral gray pill
				cCell.value = row.tags.map(t => t.name).join(', ');
				cCell.font = { name: fontName, size: 9, color: { argb: 'FF475569' } };
				cCell.fill = {
					type: 'pattern',
					pattern: 'solid',
					fgColor: { argb: 'FFF1F5F9' }
				};
			}
		} else {
			cCell.value = '—';
			cCell.font = { name: fontName, size: 10, color: { argb: 'FF94A3B8' }, italic: true };
		}
		cCell.alignment = { horizontal: 'center', vertical: 'middle' };

		// Included (Col F)
		const incCell = worksheet.getCell(`F${r}`);
		incCell.value = isCounted ? '✓ Included' : '✗ Excluded';
		incCell.font = { 
			name: fontName, 
			size: 9, 
			bold: isCounted, 
			color: { argb: isCounted ? 'FF2E7D32' : 'FF94A3B8' },
			italic: !isCounted
		};
		incCell.fill = rowFill;
		incCell.alignment = { horizontal: 'center', vertical: 'middle' };
		incCell.border = borderLight;

		getRow(r).height = 22;
		r++;
	});

	// Freeze header row & show autofilter
	worksheet.views = [{ state: 'frozen', ySplit: headerRowIndex, showGridLines: false }];
	worksheet.autoFilter = { from: { row: headerRowIndex, column: 2 }, to: { row: headerRowIndex, column: 6 } };

	r += 2; // Spacing before summary

	// 4. Financial Summary Grid
	worksheet.mergeCells(`B${r}:F${r}`);
	const summaryHeadingCell = worksheet.getCell(`B${r}`);
	summaryHeadingCell.value = 'FINANCIAL SUMMARY';
	summaryHeadingCell.font = { name: fontName, size: 13, bold: true, color: { argb: 'FF1F4E79' } };
	summaryHeadingCell.alignment = { vertical: 'middle' };
	getRow(r).height = 24;
	r++;

	const summaryRows = [
		{ label: data.incomeLabel || 'Income', val: data.income, type: 'n', z: currencyFmt },
		{ label: 'Inflows', val: data.stats.inflows, type: 'n', z: currencyFmt },
		{ label: 'Expenses', val: data.stats.expenses, type: 'n', z: currencyFmt },
		{ label: 'Net Total', val: data.stats.net, type: 'n', z: currencyFmt },
		{ label: 'Savings', val: data.savings, type: 'n', z: currencyFmt },
		{ label: 'Count', val: data.stats.count, type: 'n', z: '#,##0' },
		{ label: 'Average', val: data.stats.average, type: 'n', z: currencyFmt },
		{ label: 'Min', val: data.stats.min, type: 'n', z: currencyFmt },
		{ label: 'Max', val: data.stats.max, type: 'n', z: currencyFmt },
		{ label: 'Median', val: data.stats.median, type: 'n', z: currencyFmt }
	];

	summaryRows.forEach(item => {
		const isPrimaryMetric = ['Income', 'Inflows', 'Expenses', 'Net Total', 'Savings'].includes(item.label);
		const labelColor = isPrimaryMetric ? 'FF0F172A' : 'FF475569';
		const valueColor = isPrimaryMetric 
			? (item.label === 'Expenses' || item.val < 0 ? 'FFC62828' : 'FF2E7D32')
			: 'FF334155';

		const keyCell = worksheet.getCell(`B${r}`);
		keyCell.value = item.label;
		keyCell.font = { name: fontName, size: 10, bold: isPrimaryMetric, color: { argb: labelColor } };
		keyCell.border = borderLight;
		keyCell.alignment = { vertical: 'middle', horizontal: 'left' };

		const valCell = worksheet.getCell(`C${r}`);
		valCell.value = item.val;
		valCell.numFmt = item.z;
		valCell.font = { name: 'Consolas', size: 10, bold: isPrimaryMetric, color: { argb: valueColor } };
		valCell.border = borderLight;
		valCell.alignment = { vertical: 'middle', horizontal: 'right' };

		// Border consistency across the row
		for (let col = 4; col <= 6; col++) {
			worksheet.getCell(r, col).border = borderLight;
		}

		getRow(r).height = 20;
		r++;
	});

	r += 2; // Spacing before Category Analysis

	// 5. Category Analysis Section
	worksheet.mergeCells(`B${r}:F${r}`);
	const catHeadingCell = worksheet.getCell(`B${r}`);
	catHeadingCell.value = 'CATEGORY ANALYSIS';
	catHeadingCell.font = { name: fontName, size: 13, bold: true, color: { argb: 'FF1F4E79' } };
	catHeadingCell.alignment = { vertical: 'middle' };
	getRow(r).height = 24;
	r++;

	const catHeaders = ['Rank', 'Category', 'Amount', '% of Total', 'Data Bar'];
	catHeaders.forEach((ch, idx) => {
		const cell = worksheet.getCell(r, idx + 2);
		cell.value = ch;
		cell.font = { name: fontName, size: 10, bold: true, color: { argb: 'FF1F4E79' } };
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6ECF5' } };
		cell.alignment = { horizontal: 'center', vertical: 'middle' };
		cell.border = borderLight;
	});
	getRow(r).height = 24;
	r++;

	const startCatRow = r;
	data.categoryTotals.forEach(cat => {
		// Rank (Col B)
		const rankCell = worksheet.getCell(`B${r}`);
		rankCell.value = cat.rank;
		rankCell.font = { name: fontName, size: 10, color: { argb: 'FF475569' } };
		rankCell.alignment = { horizontal: 'center', vertical: 'middle' };
		rankCell.border = borderLight;

		// Category chip (Col C)
		const nameCell = worksheet.getCell(`C${r}`);
		nameCell.value = cat.name;
		nameCell.alignment = { horizontal: 'center', vertical: 'middle' };
		nameCell.border = borderLight;
		if (cat.color) {
			const luminance = getLuminance(cat.color);
			nameCell.font = {
				name: fontName,
				size: 9,
				bold: true,
				color: { argb: luminance < 140 ? 'FFFFFFFF' : 'FF1E293B' }
			};
			nameCell.fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: toARGB(cat.color) }
			};
		} else {
			nameCell.font = { name: fontName, size: 10, color: { argb: 'FF334155' } };
		}

		// Amount (Col D)
		const amtCell = worksheet.getCell(`D${r}`);
		amtCell.value = cat.total;
		amtCell.numFmt = currencyFmt;
		amtCell.font = { name: 'Consolas', size: 10, color: { argb: cat.total < 0 ? 'FFC62828' : 'FF2E7D32' } };
		amtCell.alignment = { horizontal: 'right', vertical: 'middle' };
		amtCell.border = borderLight;

		// % of Total (Col E)
		const pctCell = worksheet.getCell(`E${r}`);
		pctCell.value = cat.pct;
		pctCell.numFmt = '0.0%';
		pctCell.font = { name: 'Consolas', size: 10, color: { argb: 'FF475569' } };
		pctCell.alignment = { horizontal: 'right', vertical: 'middle' };
		pctCell.border = borderLight;

		// Data Bar numeric placeholder value (Col F)
		const barCell = worksheet.getCell(`F${r}`);
		barCell.value = cat.pct;
		barCell.numFmt = '0.0%';
		barCell.font = { name: 'Consolas', size: 10, color: { argb: 'FF94A3B8' } };
		barCell.alignment = { horizontal: 'right', vertical: 'middle' };
		barCell.border = borderLight;

		getRow(r).height = 22;
		r++;
	});
	const endCatRow = r - 1;

	// Native ExcelJS Conditional Formatting for Data Bars on Column F
	if (endCatRow >= startCatRow) {
		worksheet.addConditionalFormatting({
			ref: `F${startCatRow}:F${endCatRow}`,
			rules: [
				{
					type: 'dataBar',
					gradient: true,
					color: { argb: 'FF1F4E79' },
					cfvo: [
						{ type: 'num', value: 0 },
						{ type: 'num', value: 1 }
					]
				} as any
			]
		});
	}

	r += 2; // Spacing before Quick Insights

	// 6. Quick Insights
	worksheet.mergeCells(`B${r}:F${r}`);
	const insightsHeadingCell = worksheet.getCell(`B${r}`);
	insightsHeadingCell.value = 'QUICK INSIGHTS';
	insightsHeadingCell.font = { name: fontName, size: 13, bold: true, color: { argb: 'FF1F4E79' } };
	insightsHeadingCell.alignment = { vertical: 'middle' };
	getRow(r).height = 24;
	r++;

	const formatCurrency = (val: number) => {
		const symbol = data.currency;
		const sign = val < 0 ? '-' : '';
		return `${sign}${symbol}${Math.abs(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	};

	const insightBullets = [
		`• Largest Expense: ${data.insights.largestExpense !== 0 ? formatCurrency(data.insights.largestExpense) : 'None'}`,
		`• Smallest Expense: ${data.insights.smallestExpense !== 0 ? formatCurrency(data.insights.smallestExpense) : 'None'}`,
		`• Average Expense: ${data.insights.averageExpense !== 0 ? formatCurrency(data.insights.averageExpense) : 'None'}`,
		`• Most-Used Category: ${data.insights.mostUsedCategory}`,
		`• Top Category (by sum): ${data.insights.topCategory}`
	];

	insightBullets.forEach(bullet => {
		worksheet.mergeCells(`B${r}:F${r}`);
		const bulletCell = worksheet.getCell(`B${r}`);
		bulletCell.value = bullet;
		bulletCell.font = { name: fontName, size: 10, color: { argb: 'FF334155' } };
		bulletCell.alignment = { vertical: 'middle' };
		getRow(r).height = 18;
		r++;
	});

	r += 2; // Spacing before footer

	// 7. Footer Metadata
	worksheet.mergeCells(`B${r}:F${r}`);
	const footerCell = worksheet.getCell(`B${r}`);
	footerCell.value = `Generated by myNotes · v2 · box ${data.boxId} · ${data.currency}`;
	footerCell.font = { name: fontName, size: 9, italic: true, color: { argb: 'FF9CA3AF' } };
	footerCell.alignment = { vertical: 'middle', horizontal: 'center' };
	getRow(r).height = 20;

}

export async function buildMetricsWorkbook(data: MetricsExportData): Promise<ExcelJS.Workbook> {
	const workbook = new ExcelJS.Workbook();
	const worksheet = workbook.addWorksheet('Report', {
		views: [{ showGridLines: false }]
	});
	populateWorksheet(worksheet, data);
	return workbook;
}

export async function exportMetricsToXlsx(data: MetricsExportData): Promise<boolean> {
	const wb = await buildMetricsWorkbook(data);
	const buf = await wb.xlsx.writeBuffer();
	const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
	const filename = `${(data.title || 'calculation').replace(/[^\w.-]+/g, '_')}.xlsx`;
	return saveOrShareBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export async function exportMultipleMetricsToXlsx(filename: string, sheets: { sheetTitle: string; data: MetricsExportData }[]): Promise<boolean> {
	const workbook = new ExcelJS.Workbook();
	workbook.creator = 'myNotes';
	workbook.lastModifiedBy = 'myNotes';
	workbook.created = new Date();
	workbook.modified = new Date();

	const usedNames = new Set<string>();

	for (const sheet of sheets) {
		let safeName = sheet.sheetTitle
			.replace(/[\\/?*\[\]:]/g, '')
			.trim();
		if (!safeName) safeName = 'Sheet';
		safeName = safeName.substring(0, 30);

		let uniqueName = safeName;
		let count = 1;
		while (usedNames.has(uniqueName.toLowerCase())) {
			const suffix = ` (${count})`;
			uniqueName = safeName.substring(0, 30 - suffix.length) + suffix;
			count++;
		}
		usedNames.add(uniqueName.toLowerCase());

		const worksheet = workbook.addWorksheet(uniqueName, {
			views: [{ showGridLines: false }]
		});
		populateWorksheet(worksheet, sheet.data);
	}

	const buf = await workbook.xlsx.writeBuffer();
	const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
	return saveOrShareBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

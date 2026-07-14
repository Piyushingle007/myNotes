import MarkdownIt from 'markdown-it';
import markdownItMark from 'markdown-it-mark';
import markdownItSup from 'markdown-it-sup';
import markdownItSub from 'markdown-it-sub';

export interface NoteTitleEntry {
  title: string;
  path: string;
}

export interface MarkdownConverterOptions {
  enableWikiLinks?: boolean;
  wikiLinkTitlesCache?: NoteTitleEntry[];
  activeNotePath?: string;
  activeVault?: string;
  isMobile?: boolean;
  pdfHeight?: number;
  pdfPreview?: boolean;
  hideTitleInBody?: boolean;
  activeNoteTitle?: string;
  imageResolver?: (src: string) => string;
  assetStripper?: (src: string) => string;
}

// Helper to escape HTML tags
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Helper to normalize path
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

// Strip H1 title
function stripTitleH1(md: string, title?: string, hideTitleInBody?: boolean): string {
  if (!hideTitleInBody || !title) {
    return md;
  }
  const lines = md.split('\n');
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s\-—_]+/g, ' ');
  const normalizedTitle = normalize(title);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match && normalize(match[2]) === normalizedTitle) {
      lines[i] = ''; // remove this line
      break;
    }
  }
  return lines.join('\n');
}

export function createMarkdownConverter() {
  const mdit = MarkdownIt({ html: true, linkify: false, breaks: false })
    .use(markdownItMark)
    .use(markdownItSup)
    .use(markdownItSub);
  
  mdit.disable('code');

  function markdownToHtml(md: string, options: MarkdownConverterOptions = {}): string {
    const {
      enableWikiLinks = true,
      wikiLinkTitlesCache = [],
      activeNotePath = '',
      activeVault = '',
      isMobile = false,
      pdfHeight = 600,
      pdfPreview = false,
      hideTitleInBody = false,
      activeNoteTitle = '',
      imageResolver = (src: string) => src
    } = options;

    let src = stripTitleH1(md, activeNoteTitle, hideTitleInBody);

    // Pre-process: convert [[Note Title]] wiki-links to HTML anchors
    if (enableWikiLinks) {
      src = src.replace(/\[\[([^\]]+)\]\]/g, (_, raw) => {
        const pipeIdx = raw.indexOf('|');
        const noteRef = (pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw).trim();
        const display = (pipeIdx >= 0 ? raw.slice(pipeIdx + 1) : noteRef).trim();
        const titleForLookup = noteRef.replace(/#.*$/, '').replace(/\^.*$/, '').trim();
        
        let match: NoteTitleEntry | undefined;
        if (titleForLookup.includes('/') && activeVault) {
          const fullPath = activeVault + '/' + titleForLookup + '.md';
          match = wikiLinkTitlesCache.find(e => e.path === fullPath);
        }
        if (!match) {
          const titleOnly = titleForLookup.includes('/') ? titleForLookup.split('/').pop()! : titleForLookup;
          const titleLower = titleOnly.toLowerCase();
          const titleMatches = wikiLinkTitlesCache.filter(e => e.title.toLowerCase() === titleLower);
          if (titleMatches.length === 1) {
            match = titleMatches[0];
          } else if (titleMatches.length > 1) {
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
    src = src.replace(/(?<!!)\[([^\]]*)\]\(([^)]*\s[^)]*)\)/g, (_match, text, url) => {
      return `[${text}](${url.replace(/ /g, '%20')})`;
    });

    // Pre-process: transform PDF embed divs
    src = src.replace(/<div[^>]*data-pdf-src="([^"]*)"[^>]*data-pdf-name="([^"]*)"[^>]*>[^<]*<\/div>/gi, (_, pdfSrc, name) => {
      const absPath = normalizePath(`${activeVault}/${decodeURIComponent(pdfSrc)}`);
      const showInline = !isMobile && pdfPreview;
      if (showInline) {
        return `<div data-pdf-src="${pdfSrc}" data-pdf-name="${name}" class="pdf-embed"><iframe src="${absPath}" width="100%" height="${pdfHeight}px"></iframe><div class="pdf-footer"><p class="pdf-label">${name}</p><button class="pdf-download-btn" data-download-src="${pdfSrc}" title="Download PDF">Download</button></div></div>`;
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
        if (line.trim() === '$$') {
          if (!mathBlock) { mathBlock = []; continue; }
          const tex = mathBlock.join('\n').trim();
          mathBlock = null;
          outLines.push(`<div data-math-block="${encodeURIComponent(tex)}" class="math-block"></div>`);
          continue;
        }
        if (mathBlock) { mathBlock.push(line); continue; }
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
      if (mathBlock) { outLines.push('$$', ...mathBlock); }
      src = outLines.join('\n');
    }

    // Pre-process: convert task list syntax
    src = src.replace(/^([\s>]*)-\s\[x\][^\S\n]+(.+)$/gm, '$1- <tiptask checked="true">$2</tiptask>');
    src = src.replace(/^([\s>]*)-\s\[x\][^\S\n]*$/gm, '$1- <tiptask checked="true">&nbsp;</tiptask>');
    src = src.replace(/^([\s>]*)-\s\[ \][^\S\n]+(.+)$/gm, '$1- <tiptask checked="false">$2</tiptask>');
    src = src.replace(/^([\s>]*)-\s\[ \][^\S\n]*$/gm, '$1- <tiptask checked="false">&nbsp;</tiptask>');

    // Pre-process: preserve blank lines before image-only lines
    src = src.replace(/\n\n(!\[[^\]]*\]\([^)]*\)\s*$)/gm, '\n\n<div data-img-gap></div>\n\n$1');

    // Render HTML
    let html = mdit.render(src);

    // Post-process: convert blockquote alerts to callout blocks
    html = html.replace(/<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*<br\s*\/?>)?\s*([\s\S]*?)<\/blockquote>/gi, (_, type, innerContent) => {
      const typeLower = type.toLowerCase();
      return `<div data-type="callout" data-callout-type="${typeLower}" class="callout callout-${typeLower}"><p>${innerContent}</div>`;
    });

    // Post-process: convert image gap markers
    html = html.replace(/<div data-img-gap><\/div>\n?/g, '<p></p>\n');

    // Post-process: strip trailing newlines inside code blocks
    html = html.replace(/<code([^>]*)>\n?/g, '<code$1>');
    html = html.replace(/\n<\/code>/g, '</code>');

    // Post-process: convert list-separator comments
    html = html.replace(/<!-- -->/g, '<p></p>');

    // Post-process: convert task list items to TipTap format
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
      return `<img src="${imageResolver(imgSrc)}" alt="${alt}" data-size="${size}">`;
    });

    return html;
  }

  function htmlToMarkdown(html: string, options: MarkdownConverterOptions = {}): string {
    const {
      activeNotePath = '',
      activeVault = '',
      assetStripper = (src: string) => src
    } = options;

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

    // Code blocks MUST be converted before inline code
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
      const decoded = decodeURIComponent(href);
      return `[${text}](${decoded})`;
    });

    md = md.replace(/<img[^>]*>/gi, (match) => {
      const srcMatch = match.match(/src="([^"]*)"/);
      const altMatch = match.match(/alt="([^"]*)"/);
      const sizeMatch = match.match(/data-size="([^"]*)"/);
      const src = srcMatch ? assetStripper(srcMatch[1]) : '';
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

    // Preserve tables as raw HTML
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

    // Restore raw blocks
    tables.forEach((table, i) => {
      md = md.replace(`%%TABLE_${i}%%`, '\n' + table + '\n');
    });
    pdfs.forEach((pdf, i) => {
      md = md.replace(`%%PDF_${i}%%`, '\n' + pdf + '\n');
    });
    metricsBlocks.forEach((block, i) => {
      md = md.replace(`%%METRICS_${i}%%`, '\n' + block + '\n');
    });
    detailsBlocks.forEach((block, i) => {
      md = md.replace(`%%DETAILS_${i}%%`, '\n' + block + '\n');
    });
    styledSpans.forEach((span, i) => {
      md = md.replace(`%%STYLESPAN_${i}%%`, span);
    });
    styledMarks.forEach((mark, i) => {
      md = md.replace(`%%STYLEMARK_${i}%%`, mark);
    });

    return md.trim() + '\n';
  }

  return {
    markdownToHtml,
    htmlToMarkdown
  };
}

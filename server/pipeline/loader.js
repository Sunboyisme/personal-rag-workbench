const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { titleFromPath } = require('./importFormats');
const { decodeMultipartFilename } = require('../utils/encoding');

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function parseFrontmatter(content) {
  const normalized = String(content || '').replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: normalized.trim(), tags: [], aliases: [] };
  }
  const frontmatter = YAML.parse(match[1]) || {};
  const body = match[2].trim();
  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.map(String)
    : typeof frontmatter.tags === 'string'
      ? frontmatter.tags.split(/[,\s]+/).filter(Boolean)
      : [];
  const aliases = Array.isArray(frontmatter.aliases)
    ? frontmatter.aliases.map(String)
    : [];
  return { frontmatter, body, tags, aliases };
}

function extractWikilinks(text) {
  const links = [];
  let match;
  const re = new RegExp(WIKILINK_RE.source, 'g');
  while ((match = re.exec(text)) !== null) {
    const raw = match[1].trim();
    const [target, alias] = raw.split('|').map((s) => s.trim());
    links.push({ target, alias: alias || target, raw: match[0] });
  }
  return links;
}

function extractHeadingTitle(body) {
  const match = String(body || '').match(/^#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : null;
}

function loadMarkdownContent(content, meta = {}) {
  const { frontmatter, body, tags, aliases } = parseFrontmatter(content);
  const links = extractWikilinks(body);
  const headingTitle = extractHeadingTitle(body);
  return {
    ...meta,
    title: frontmatter.title || headingTitle || meta.title || meta.filename || '未命名',
    content: body,
    frontmatter,
    tags,
    aliases,
    links,
  };
}

async function loadSourceFile(filePath, filename, options = {}) {
  const decodedName = decodeMultipartFilename(filename);
  const relativePath = decodeMultipartFilename(options.relativePath || decodedName);
  const ext = path.extname(decodedName).toLowerCase();
  const title = relativePath.includes('/')
    ? titleFromPath(relativePath)
    : path.basename(decodedName, ext);

  if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
    const raw = fs.readFileSync(filePath, 'utf8');
    return loadMarkdownContent(raw, { filename: decodedName, title, sourceFormat: ext.slice(1) });
  }

  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(filePath));
    return loadMarkdownContent(data.text || '', { filename: decodedName, title, sourceFormat: 'pdf' });
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return loadMarkdownContent(result.value || '', { filename: decodedName, title, sourceFormat: 'docx' });
  }

  throw new Error(`不支持的文件类型: ${ext}`);
}

module.exports = {
  parseFrontmatter,
  extractWikilinks,
  extractHeadingTitle,
  loadMarkdownContent,
  loadSourceFile,
};

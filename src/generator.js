import { AIClient } from './ai-client.js';
import { PromptReader } from './prompt-reader.js';
import { FileGenerator } from './file-generator.js';
import { getConfig } from './config.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import readline from 'node:readline/promises';
import { stdin as stdinInput, stdout as stdoutOutput } from 'node:process';

export async function readAllFilesInDir(dirPath) {
  const resolvedDir = path.resolve(dirPath);
  let entries;
  try {
    entries = await fs.readdir(resolvedDir, { withFileTypes: true });
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return '';
    throw error;
  }

  const files = entries
    .filter(e => e.isFile())
    .map(e => path.join(resolvedDir, e.name))
    .sort((a, b) => a.localeCompare(b));

  const contents = [];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf-8');
    contents.push(`ARCHIVO: ${path.basename(filePath)}\n\n${content}`);
  }
  return contents.join('\n\n');
}

export async function listTxtFilesInDir(dirPath) {
  const resolvedDir = path.resolve(dirPath);
  const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
  const txtFiles = entries
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.txt'))
    .map(e => path.join(resolvedDir, e.name));

  return txtFiles.sort((a, b) => a.localeCompare(b));
}

export async function readRequiredFile(filePath, humanName) {
  try {
    return await fs.readFile(path.resolve(filePath), 'utf-8');
  } catch (error) {
    throw new Error(`No se pudo leer ${humanName} (${filePath}): ${error.message}`);
  }
}

function sha12(text) {
  return crypto.createHash('sha256').update(text ?? '', 'utf8').digest('hex').slice(0, 12);
}

function logPromptParts({ globalInstructions, formatterExamples, researchContent }) {
  const parts = [
    ['prompts/promts.txt', globalInstructions],
    ['ejemplo-fromater/*', formatterExamples],
    ['informacion-txt/*.txt', researchContent]
  ];

  for (const [name, content] of parts) {
    const length = content?.length ?? 0;
    console.log(`  🧾 ${name}: ${length} chars (sha ${sha12(content)})`);
  }

  const total = (globalInstructions?.length ?? 0) + (formatterExamples?.length ?? 0) + (researchContent?.length ?? 0);
  const approxTokens = Math.ceil(total / 4);
  console.log(`  📏 Total aprox: ${total} chars (~${approxTokens} tokens)`);
}

export function buildUserContent({ formatterExamples, researchContent }) {
  return JSON.stringify(
    {
      formatterExamples: formatterExamples ?? '',
      input: researchContent ?? '',
    },
    null,
    2
  );
}

export function createMessages({ globalInstructions, formatterExamples, researchContent }) {
  return [
    { role: 'system', content: globalInstructions },
    { role: 'user', content: buildUserContent({ formatterExamples, researchContent }) }
  ];
}

function extractOutputDirFromGlobalInstructions(globalInstructions) {
  if (!globalInstructions) return null;

  const patterns = [
    /genera\s+y\s+guarda\s+el\s+md\s+en\s+esta\s+dirre?cion\s*:\s*(.+)/i,
    /genera\s+el\s+md\s+en\s+esta\s+dirre?cion\s*:\s*(.+)/i
  ];

  for (const re of patterns) {
    const match = globalInstructions.match(re);
    if (!match) continue;

    const raw = (match[1] ?? '').trim();
    const cleaned = raw.replace(/^['"]|['"]$/g, '').trim();
    if (!cleaned) return null;
    return cleaned;
  }

  return null;
}

function extractSeoTitleFromResearchContent(researchContent) {
  if (!researchContent) return null;

  const lines = researchContent.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (/^t[íi]tulo\s+seo\s+recomendado\s*:/i.test(line)) {
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = (lines[j] ?? '').trim();
        if (!candidate) continue;
        return candidate;
      }
      return null;
    }
  }

  return null;
}

function extractFirstNonEmptyLine(text) {
  if (!text) return null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = (rawLine ?? '').trim();
    if (line) return line;
  }
  return null;
}

function slugifyFilename(input) {
  const s = String(input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  const maxLen = 60;
  if (s.length <= maxLen) return s || 'articulo';

  const hardClip = s.slice(0, maxLen).replace(/-+$/g, '');
  const lastDash = hardClip.lastIndexOf('-');
  const softClip = lastDash > 0 ? hardClip.slice(0, lastDash) : hardClip;

  return softClip || hardClip || 'articulo';
}

function stripOuterMarkdownCodeFence(text) {
  if (!text) return text;
  const trimmed = text.trim();

  const fenceMatch = trimmed.match(/^```(?:\w+)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (!fenceMatch) return text;

  return (fenceMatch[1] ?? '').trim() + '\n';
}

function stripYamlCodeFenceAroundFrontmatter(text) {
  if (!text) return text;
  const trimmed = text.trim();

  // Remove ```yaml or ``` blocks that wrap the frontmatter
  const yamlFenceMatch = trimmed.match(/^```(?:yaml)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (yamlFenceMatch) {
    return (yamlFenceMatch[1] ?? '').trim() + '\n';
  }

  return text;
}

function sanitizeForMdx(text) {
  if (!text) return text;

  // MDX interpreta `<2` (o `< 2`) como inicio de una etiqueta JSX inválida.
  // Escapamos solo el caso donde `<` va seguido de un número (con espacios opcionales).
  return text.replace(/<(?=\s*\d)/g, '&lt;');
}

function safeYamlDoubleQuoted(value) {
  const s = String(value ?? '');
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ').trim()}"`;
}

function ensureFrontmatterBlock(markdown) {
  const text = String(markdown ?? '');
  const hasFrontmatter = /^---\s*\r?\n[\s\S]*?\r?\n---/m.test(text);
  if (hasFrontmatter) return text;
  return `---\n---\n\n${text.trimStart()}`;
}

function upsertFrontmatterField(markdown, key, valueLine) {
  const text = ensureFrontmatterBlock(markdown);
  return text.replace(
    /^---\s*\r?\n([\s\S]*?)\r?\n---/,
    (full, body) => {
      const hasKey = new RegExp(`^\\s*${key}\\s*:`, 'im').test(body);
      const newBody = hasKey ? body.replace(new RegExp(`^\\s*${key}\\s*:\\s*.*$`, 'im'), valueLine) : `${valueLine}\n${body}`;
      return `---\n${newBody}\n---`;
    }
  );
}

function enforceRequiredFrontmatter(article, fields) {
  let out = ensureFrontmatterBlock(article);

  const title = String(fields?.title ?? '').trim();
  const description = String(fields?.description ?? '').trim() || title;
  const pubDate = String(fields?.pubDate ?? '').trim();
  const keywords = Array.isArray(fields?.keywords) ? fields.keywords.join(', ') : String(fields?.keywords ?? '').trim();

  if (title) out = upsertFrontmatterField(out, 'title', `title: ${safeYamlDoubleQuoted(title)}`);
  if (description) out = upsertFrontmatterField(out, 'description', `description: ${safeYamlDoubleQuoted(description)}`);
  if (keywords) out = upsertFrontmatterField(out, 'keywords', `keywords: ${safeYamlDoubleQuoted(keywords)}`);
  if (typeof fields?.draft === 'boolean') out = upsertFrontmatterField(out, 'draft', `draft: ${fields.draft ? 'true' : 'false'}`);

  if (pubDate) out = upsertFrontmatterField(out, 'pubDate', `pubDate: ${pubDate}`);

  const tags = Array.isArray(fields?.tags) ? fields.tags.map((t) => String(t ?? '').trim()).filter(Boolean) : [];
  if (tags.length) {
    const rendered = `[${tags.map((t) => safeYamlDoubleQuoted(t)).join(', ')}]`;
    out = upsertFrontmatterField(out, 'tags', `tags: ${rendered}`);
  }

  // Remove slug field if present (not part of Astro schema)
  out = out.replace(/^\s*slug\s*:.*$\r?\n?/im, '');

  return out;
}

function extractFormatExampleFromMarkdown(sourceMarkdown) {
  const src = String(sourceMarkdown ?? '');
  if (!src.trim()) return '';

  const front = extractFrontmatterBlock(src);
  const frontBlock = front ? `---\n${front}\n---\n` : '';
  const withoutFront = src.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '');
  const lines = withoutFront.split(/\r?\n/).slice(0, 40).join('\n').trim();
  const head = lines ? `${lines}\n` : '';

  const combined = `${frontBlock}${head}`.trim();
  return combined ? `${combined}\n` : '';
}

function enforceTitle(article, desiredTitle) {
  if (!article || !desiredTitle) return article;
  const title = String(desiredTitle).trim();
  if (!title) return article;

  let out = article;

  // Update YAML frontmatter title if present at the top.
  out = out.replace(
    /^---\s*\r?\n([\s\S]*?)\r?\n---/,
    (full, body) => {
      const hasTitle = /^\s*title\s*:/im.test(body);
      let newBody;
      if (hasTitle) {
        newBody = body.replace(/^\s*title\s*:\s*.*$/im, `title: "${title.replace(/"/g, '\\"')}"`);
      } else {
        newBody = `title: "${title.replace(/"/g, '\\"')}"\n${body}`;
      }
      return `---\n${newBody}\n---`;
    }
  );

  // If the article contains a top-level H1, make it match too (optional but helps consistency).
  out = out.replace(/^(?:---[\s\S]*?\r?\n---\r?\n)?\s*#\s+.*$/m, (line) => {
    if (line.trim().startsWith('#')) {
      return `# ${title}`;
    }
    return line;
  });

  return out;
}

function enforceDraft(article, desiredDraft) {
  if (!article) return article;
  const draftValue = Boolean(desiredDraft);
  const serialized = draftValue ? 'true' : 'false';

  const hasFrontmatter = /^---\s*\r?\n[\s\S]*?\r?\n---/m.test(article);
  if (!hasFrontmatter) {
    return `---\ndraft: ${serialized}\n---\n\n${article.trimStart()}`;
  }

  return article.replace(
    /^---\s*\r?\n([\s\S]*?)\r?\n---/,
    (full, body) => {
      const hasDraft = /^\s*draft\s*:/im.test(body);
      const newBody = hasDraft ? body.replace(/^\s*draft\s*:\s*.*$/im, `draft: ${serialized}`) : `draft: ${serialized}\n${body}`;
      return `---\n${newBody}\n---`;
    }
  );
}

function pickMetaDescription(item) {
  if (!item || typeof item !== 'object') return '';
  const d =
    item.description ??
    item.descripcion ??
    item.meta_descripcion ??
    item.metaDescription ??
    item.meta_description ??
    '';
  return String(d ?? '').trim();
}

function pickKeywords(item) {
  if (!item || typeof item !== 'object') return '';
  const k =
    item.keywords ??
    item.variaciones_keywords ??
    item.palabras_clave ??
    [];
  if (Array.isArray(k)) {
    return k.map((kw) => String(kw ?? '').trim()).filter(Boolean).join(', ');
  }
  return String(k ?? '').trim();
}

function pickTag(item, plan) {
  const t = String(item?.tag ?? plan?.tag ?? plan?.constraints?.tag ?? '').trim();
  return t;
}

function toIsoDateOnly(d) {
  try {
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.valueOf())) return '';
    return date.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findRepoRoot(startDir) {
  const maxUp = 6;
  let current = path.resolve(startDir);
  for (let i = 0; i <= maxUp; i++) {
    const candidate = path.join(current, 'src', 'content', 'blog');
    if (await fileExists(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function extractFrontmatterBlock(markdown) {
  if (!markdown) return null;
  const m = String(markdown).match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

function extractFrontmatterExampleFromMarkdown(sourceMarkdown) {
  const src = String(sourceMarkdown ?? '');
  if (!src.trim()) return '';
  const front = extractFrontmatterBlock(src);
  if (!front) return '';
  const combined = `---\n${front}\n---`.trim();
  return combined ? `${combined}\n` : '';
}

function extractFrontmatterField(frontmatterBody, key) {
  if (!frontmatterBody || !key) return '';
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+)\\s*$`, 'im');
  const m = String(frontmatterBody).match(re);
  if (!m) return '';
  const raw = String(m[1] ?? '').trim();
  return raw.replace(/^['"]|['"]$/g, '').trim();
}

async function listContentFilesRecursive(dirPath) {
  const out = [];
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && /\.(md|mdx)$/i.test(e.name)) {
        out.push(full);
      }
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

async function summarizeExistingBlogPosts(repoRoot, blogDirOverride = '') {
  const blogDirRaw = String(blogDirOverride ?? '').trim();
  const blogDir = blogDirRaw ? path.resolve(blogDirRaw) : path.join(repoRoot, 'src', 'content', 'blog');
  if (!(await fileExists(blogDir))) return [];

  const files = await listContentFilesRecursive(blogDir);
  const summaries = [];

  for (const fp of files) {
    const raw = await fs.readFile(fp, 'utf-8');
    const fm = extractFrontmatterBlock(raw);
    const title = extractFrontmatterField(fm, 'title');
    const pubDate = extractFrontmatterField(fm, 'pubDate');
    const rel = path.relative(blogDir, fp).replace(/\\/g, '/');
    const id = rel.replace(/\.(md|mdx)$/i, '');
    if (!title) continue;
    summaries.push({ id, title, pubDate });
  }

  return summaries;
}

async function readProjectFrontmatterExample(blogDir) {
  try {
    const resolved = path.resolve(blogDir);
    if (!(await fileExists(resolved))) return '';
    const mdFiles = await listMarkdownFilesByMtimeDesc(resolved);
    if (mdFiles.length === 0) return '';
    const raw = await fs.readFile(mdFiles[0], 'utf-8');
    return extractFrontmatterExampleFromMarkdown(raw);
  } catch {
    return '';
  }
}

function wordCount(text) {
  const clean = String(text ?? '')
    .replace(/---[\s\S]*?---/g, ' ')
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 0;
  return clean.split(' ').length;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function tryParseJsonFromModelOutput(text) {
  const raw = stripOuterMarkdownCodeFence(text);
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { value: null, error: new Error('Empty output') };
  try {
    return { value: JSON.parse(trimmed), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

function validatePlanTitles(plan, maxLen = 72) {
  const issues = [];
  const candidates = normalizePlanItems(plan);

  const starters = new Set([
    'que',
    'qué',
    'cual',
    'cuál',
    'por',
    'porqué',
    'porqué',
    'donde',
    'dónde',
    'cuando',
    'cuándo',
    'como',
    'cómo',
    'si',
  ]);

  for (let i = 0; i < candidates.length; i++) {
    const t = String(candidates[i]?.title ?? '').trim();
    if (!t) {
      issues.push({ index: i, type: 'missing_title' });
      continue;
    }
    if (t.length > maxLen) {
      issues.push({ index: i, type: 'title_too_long', length: t.length, maxLen, title: t });
    }

    const first = t
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    if (first && !starters.has(first)) {
      issues.push({ index: i, type: 'title_starter_not_question_word', title: t });
    }
  }
  return issues;
}

async function listJsonFilesByMtimeDesc(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
      .map((e) => path.join(dirPath, e.name));

    const withStat = await Promise.all(
      files.map(async (fp) => {
        const st = await fs.stat(fp);
        return { fp, mtimeMs: st.mtimeMs };
      })
    );

    return withStat.sort((a, b) => b.mtimeMs - a.mtimeMs).map((x) => x.fp);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function listMarkdownFilesByMtimeDesc(dirPath) {
  try {
    const files = await listContentFilesRecursive(dirPath);
    const withStat = await Promise.all(
      files.map(async (fp) => {
        const st = await fs.stat(fp);
        return { fp, mtimeMs: st.mtimeMs };
      })
    );
    return withStat.sort((a, b) => b.mtimeMs - a.mtimeMs).map((x) => x.fp);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function ask(rl, question, { defaultValue = '' } = {}) {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const raw = await rl.question(`${question}${suffix}: `);
  const v = String(raw ?? '').trim();
  return v || defaultValue;
}

async function askChoice(rl, question, choices) {
  for (const c of choices) {
    console.log(`  ${c.key}) ${c.label}`);
  }
  const keySet = new Set(choices.map((c) => String(c.key)));
  while (true) {
    const v = await ask(rl, question, { defaultValue: String(choices[0]?.key ?? '') });
    if (keySet.has(String(v))) return String(v);
    console.log('Opción inválida.');
  }
}

function normalizePlanItems(plan) {
  if (Array.isArray(plan)) return plan;
  if (!plan || typeof plan !== 'object') return [];

  const candidates =
    (Array.isArray(plan.articles) && plan.articles) ||
    (Array.isArray(plan.investigations) && plan.investigations) ||
    (Array.isArray(plan.investigaciones) && plan.investigaciones) ||
    [];

  return candidates;
}

function pickTitle(item) {
  if (!item || typeof item !== 'object') return '';
  const t =
    item.title ??
    item.titulo ??
    item.seo_title ??
    item.seoTitle ??
    item.meta_title ??
    item.metaTitle ??
    '';
  return String(t ?? '').trim();
}

function pickBaseName(item, fallbackTitle, index) {
  const fileField = String(item?.nombre_archivo_md ?? item?.filename ?? '').trim();
  if (fileField) {
    const base = fileField.replace(/\.(md|mdx)$/i, '').trim();
    if (base) return slugifyFilename(base);
  }

  const urlField = String(item?.url_optimizada ?? item?.url ?? item?.slug ?? '').trim();
  if (urlField) return slugifyFilename(urlField);

  const title = String(fallbackTitle ?? '').trim();
  if (title) return slugifyFilename(title);

  return `articulo-${index + 1}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const config = getConfig();
  const outputFormat = typeof args.format === 'string' && args.format.trim()
    ? String(args.format).trim().toLowerCase()
    : config.outputFormat;

  console.log(`\n🚀 Iniciando generador de artículos`);
  console.log(`📡 Proveedor: ${config.provider}`);
  console.log(`📄 Formato: ${outputFormat}\n`);

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const toolRootDir = path.resolve(scriptDir, '..');

  const resolveFromToolRoot = (p) => (path.isAbsolute(p) ? p : path.resolve(toolRootDir, p));
  const resolveDirFromCwdOrToolRoot = async (p) => {
    const cwdResolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    if (await fileExists(cwdResolved)) return cwdResolved;
    return resolveFromToolRoot(p);
  };

  const promptsDirResolved = typeof args.promptsDir === 'string' && args.promptsDir.trim()
    ? path.resolve(String(args.promptsDir))
    : await resolveDirFromCwdOrToolRoot(config.promptsDir);
  const infoDirResolved = typeof args.infoDir === 'string' && args.infoDir.trim()
    ? path.resolve(String(args.infoDir))
    : await resolveDirFromCwdOrToolRoot(config.infoDir);
  const formatterDirResolved = typeof args.formatterDir === 'string' && args.formatterDir.trim()
    ? path.resolve(String(args.formatterDir))
    : await resolveDirFromCwdOrToolRoot(config.formatterDir);
  const outDirResolved = typeof args.analysisOutDir === 'string' && args.analysisOutDir.trim()
    ? path.resolve(String(args.analysisOutDir))
    : resolveFromToolRoot(config.analysisOutDir);

  const promptReader = new PromptReader(promptsDirResolved);

  try {
    const command = args._[0] || '';
    const targetPath = args._[0] && !['analyze', 'generate-plan'].includes(args._[0]) ? args._[0] : args._[1];
    const repoRoot = (await findRepoRoot(process.cwd())) ?? process.cwd();
    const blogContentDirResolved =
      typeof args.blogContentDir === 'string' && args.blogContentDir.trim()
        ? path.resolve(String(args.blogContentDir))
        : path.isAbsolute(config.blogContentDir)
          ? config.blogContentDir
          : path.resolve(repoRoot, config.blogContentDir);

    const resolveMdOutputDir = (rawPath) => {
      const raw = String(rawPath ?? '').trim();
      if (!raw) return '';
      if (path.isAbsolute(raw)) return raw;
      const normalized = raw.replace(/\//g, path.sep);
      if (/^src[\\/]/i.test(normalized)) return path.resolve(repoRoot, normalized);
      return path.resolve(toolRootDir, normalized);
    };

    const analysisPromptPath = args.analysisPrompt
      ? path.resolve(String(args.analysisPrompt))
      : path.join(promptsDirResolved, 'promts-analysis.txt');
    const articlePromptPath = args.prompt
      ? path.resolve(String(args.prompt))
      : path.join(promptsDirResolved, 'promts.txt');

    console.log(`  📖 Leyendo prompt de análisis (prompts/${path.basename(analysisPromptPath)})...`);
    const analysisInstructions = await readRequiredFile(
      analysisPromptPath,
      `prompts/${path.basename(analysisPromptPath)}`
    );
    console.log(`  📖 Leyendo prompt de generación (prompts/${path.basename(articlePromptPath)})...`);
    const articleInstructions = await readRequiredFile(
      articlePromptPath,
      `prompts/${path.basename(articlePromptPath)}`
    );

    const outputDirFromPrompt = extractOutputDirFromGlobalInstructions(articleInstructions);
    const getOutDirOverride = () => (args.outDir ? resolveMdOutputDir(String(args.outDir)) : '');
    const fileGenerator = new FileGenerator(
      getOutDirOverride() || resolveMdOutputDir(outputDirFromPrompt || config.outputDir),
      outputFormat
    );

    const useProjectFrontmatter =
      Boolean(args.noProjectFrontmatter)
        ? false
        : Boolean(args.useProjectFrontmatter) || Boolean(config.useProjectFrontmatter);

    let formatterExamples = '';
    if (useProjectFrontmatter) {
      formatterExamples = await readProjectFrontmatterExample(blogContentDirResolved);
    }
    if (!formatterExamples) {
      console.log('  📖 Leyendo ejemplos de formato (ejemplo-fromater)...');
      formatterExamples = await readAllFilesInDir(formatterDirResolved);
    }

    const getAIClient = () => new AIClient();

    if (argv.length === 0) {
      const rl = readline.createInterface({ input: stdinInput, output: stdoutOutput });
      try {
        const choice = await askChoice(rl, 'Selecciona una opción', [
          { key: '1', label: `Analizar artículo (.md) y guardar investigación (JSON) en ${outDirResolved}` },
          { key: '2', label: `Generar artículos desde una investigación (JSON) en ${outDirResolved}` },
          { key: '0', label: 'Salir' },
        ]);

        if (choice === '0') return;

        if (choice === '1') {
          const lang = await askChoice(rl, 'Idioma del artículo', [
            { key: 'es', label: 'Español' },
            { key: 'en', label: 'English' },
          ]);
          args.lang = lang;

          const blogDir = blogContentDirResolved;
          const mdFiles = await listMarkdownFilesByMtimeDesc(blogDir);

          let inputPath;
          const defaultArticle = 'src/content/blog/como-posicionar-mi-web-en-los-primeros-lugares-de-google.md';
          const shown = mdFiles.slice(0, 40);
          if (shown.length) {
            console.log(`\n📄 Artículos encontrados para analizar (mostrando ${shown.length}):\n`);
            for (let i = 0; i < shown.length; i++) {
              console.log(`  ${i + 1}) ${path.relative(repoRoot, shown[i]).replace(/\\/g, '/')}`);
            }
            console.log(`  0) Escribir ruta manual`);

            const pickRaw = await ask(rl, 'Selecciona el número del .md', { defaultValue: '1' });
            const pick = parseInt(pickRaw, 10);
            if (Number.isFinite(pick) && pick > 0 && pick <= shown.length) {
              inputPath = shown[pick - 1];
            } else {
              const inputPathRaw = await ask(rl, 'Ruta del artículo a investigar (.md)', { defaultValue: defaultArticle });
              inputPath = path.resolve(inputPathRaw);
            }
          } else {
            const inputPathRaw = await ask(rl, 'Ruta del artículo a investigar (.md)', { defaultValue: defaultArticle });
            inputPath = path.resolve(inputPathRaw);
          }

          const slug = path.basename(inputPath).replace(/\.(md|mdx)$/i, '');
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const outputPath = path.join(outDirResolved, `analysis-${slug}-${stamp}.json`);

          await fs.mkdir(outDirResolved, { recursive: true });

          const maxTitleLen = 72;
          const existingPosts = await summarizeExistingBlogPosts(repoRoot, blogContentDirResolved);

          console.log(`\n▶ Analizando: ${inputPath}`);
          const sourceContent = await readRequiredFile(inputPath, 'artículo fuente');
          const wc = wordCount(sourceContent);

          const researchContent = JSON.stringify(
            {
              language: lang,
              sourceArticle: { path: inputPath, wordCount: wc, md: sourceContent },
              constraints: { maxTitleLength: maxTitleLen },
              existingSitePosts: existingPosts.slice(0, 400),
            },
            null,
            2
          );

          const formatterFromExampleForAnalysis = extractFrontmatterExampleFromMarkdown(sourceContent);
          const effectiveFormatterExamplesForAnalysis = [formatterExamples, formatterFromExampleForAnalysis].filter(Boolean).join('\n\n');
          logPromptParts({ globalInstructions: analysisInstructions, formatterExamples: effectiveFormatterExamplesForAnalysis, researchContent });
          console.log('  🤖 Generando análisis/plan...');
          const modelOutput = stripOuterMarkdownCodeFence(
            await getAIClient().generate(
              createMessages({ globalInstructions: analysisInstructions, formatterExamples: effectiveFormatterExamplesForAnalysis, researchContent })
            )
          );

          await fs.writeFile(outputPath, modelOutput, 'utf-8');
          console.log(`  ✅ Investigación guardada: ${outputPath}`);

          const parsed = tryParseJsonFromModelOutput(modelOutput);
          if (parsed.value) {
            const issues = validatePlanTitles(parsed.value, maxTitleLen);
            if (issues.length) {
              console.log(`  ⚠️ Validación: ${issues.length} título(s) fuera de regla (max ${maxTitleLen})`);
            }
          }

          const go = await ask(rl, '¿Generar artículos ahora desde este JSON? (s/n)', { defaultValue: 'n' });
          if (go.toLowerCase() !== 's') return;

          const mdOutDir = await ask(rl, 'Directorio donde se guardarán los .md', {
            defaultValue: outputDirFromPrompt || config.outputDir,
          });
          args.plan = outputPath;
          args.outDir = resolveMdOutputDir(mdOutDir);
          args.formatFrom = inputPath;
        }

        if (choice === '2') {
          const lang = await askChoice(rl, 'Idioma del artículo', [
            { key: 'es', label: 'Español' },
            { key: 'en', label: 'English' },
          ]);
          args.lang = lang;

          const files = await listJsonFilesByMtimeDesc(outDirResolved);
          if (files.length === 0) {
            throw new Error(`No hay archivos .json en ${outDirResolved}`);
          }

          console.log(`\n📂 Investigaciones encontradas en /out:\n`);
          for (let i = 0; i < files.length; i++) {
            console.log(`  ${i + 1}) ${path.basename(files[i])}`);
          }

          const idxRaw = await ask(rl, 'Selecciona el número del JSON', { defaultValue: '1' });
          const idx = Math.max(1, Math.min(files.length, parseInt(idxRaw, 10) || 1));
          args.plan = files[idx - 1];

          const mdOutDir = await ask(rl, 'Directorio donde se guardarán los .md', {
            defaultValue: outputDirFromPrompt || config.outputDir,
          });
          args.outDir = resolveMdOutputDir(mdOutDir);
        }
      } finally {
        rl.close();
      }
    }

    if (command === 'analyze') {
      const inputPath = args.input ? path.resolve(String(args.input)) : null;
      if (!inputPath) {
        throw new Error('Falta --input con la ruta del artículo .md a analizar');
      }
      const outputPath = args.output
        ? path.resolve(String(args.output))
        : path.resolve(outDirResolved, `analysis-${path.basename(inputPath).replace(/\.(md|mdx)$/i, '')}.json`);
      const maxTitleLen = Number.isFinite(Number(args.maxTitleLen)) ? Number(args.maxTitleLen) : 72;

      const existingPosts = await summarizeExistingBlogPosts(repoRoot, blogContentDirResolved);

      console.log(`\n▶ Analizando: ${inputPath}`);
      const sourceContent = await readRequiredFile(inputPath, 'artículo fuente');
      const wc = wordCount(sourceContent);

      const mdOutDirDefault = getOutDirOverride() || resolveMdOutputDir(outputDirFromPrompt || config.outputDir);
      const researchContent = JSON.stringify(
        {
          language: args.lang ? String(args.lang) : '',
          mdOutputDir: mdOutDirDefault,
          sourceArticle: {
            path: inputPath,
            wordCount: wc,
            md: sourceContent,
          },
          constraints: {
            maxTitleLength: maxTitleLen,
            singleTagForAllNewArticles: args.tag ? String(args.tag).trim() : '',
            draft: typeof args.draft !== 'undefined' ? String(args.draft) : '',
          },
          existingSitePosts: existingPosts.slice(0, 400),
        },
        null,
        2
      );
      const formatterFromExampleForAnalysis = extractFrontmatterExampleFromMarkdown(sourceContent);
      const effectiveFormatterExamplesForAnalysis = [formatterExamples, formatterFromExampleForAnalysis].filter(Boolean).join('\n\n');
      logPromptParts({ globalInstructions: analysisInstructions, formatterExamples: effectiveFormatterExamplesForAnalysis, researchContent });

      console.log('  🤖 Generando análisis/plan...');
      const messages = createMessages({ globalInstructions: analysisInstructions, formatterExamples: effectiveFormatterExamplesForAnalysis, researchContent });
      const modelOutput = stripOuterMarkdownCodeFence(await getAIClient().generate(messages));

      console.log('  💾 Guardando plan...');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, modelOutput, 'utf-8');
      console.log(`  ✅ Plan guardado: ${outputPath}`);

      const parsed = tryParseJsonFromModelOutput(modelOutput);
      if (parsed.value) {
        const issues = validatePlanTitles(parsed.value, maxTitleLen);
        if (issues.length) {
          console.log(`  ⚠️ Validación: ${issues.length} título(s) fuera de regla (max ${maxTitleLen})`);
        }
      } else {
        console.log('  ⚠️ No pude validar títulos: el plan no parece JSON válido');
      }

      console.log('\n✨ Proceso completado\n');
      return;
    }

    if (command === 'generate-plan' || args.plan) {
      const planPath = args.plan ? path.resolve(String(args.plan)) : null;
      if (!planPath) {
        throw new Error('Falta --plan con la ruta del archivo JSON del plan');
      }
      const planRaw = await readRequiredFile(planPath, 'plan JSON');
      const parsed = tryParseJsonFromModelOutput(planRaw);
      if (!parsed.value) {
        throw new Error(`Plan no es JSON válido: ${parsed.error?.message || 'error'}`);
      }

      const plan = parsed.value;
      const articles = normalizePlanItems(plan);
      if (!Array.isArray(articles) || articles.length === 0) {
        throw new Error('El plan no contiene artículos (esperado: array o { "articles"/"investigations": [...] })');
      }

      const formatterFromPathRaw =
        (typeof args.formatFrom === 'string' && args.formatFrom.trim()) ||
        (typeof plan?.sourceArticle?.path === 'string' && plan.sourceArticle.path.trim()) ||
        (typeof plan?.constraints?.sourceArticlePath === 'string' && plan.constraints.sourceArticlePath.trim()) ||
        '';
      const formatterFromPath = formatterFromPathRaw ? resolveMdOutputDir(formatterFromPathRaw) : '';
      const formatterFromMarkdown = formatterFromPath && (await fileExists(formatterFromPath))
        ? await readRequiredFile(formatterFromPath, 'artículo de formato')
        : '';
      const formatterFromExample = extractFrontmatterExampleFromMarkdown(formatterFromMarkdown);

      const planMdOutputDir =
        typeof plan?.mdOutputDir === 'string' && plan.mdOutputDir.trim()
          ? plan.mdOutputDir.trim()
          : typeof plan?.constraints?.mdOutputDir === 'string' && plan.constraints.mdOutputDir.trim()
            ? plan.constraints.mdOutputDir.trim()
            : '';
      const mdOutDirFinal =
        getOutDirOverride() ||
        (planMdOutputDir ? resolveMdOutputDir(planMdOutputDir) : '') ||
        resolveMdOutputDir(outputDirFromPrompt || config.outputDir);

      console.log(`\n📂 Plan cargado: ${articles.length} artículo(s)\n`);

      for (let i = 0; i < articles.length; i++) {
        const item = articles[i];
        const desiredTitle = pickTitle(item);
        const baseName = pickBaseName(item, desiredTitle, i);

        console.log(`\n▶ Generando (${i + 1}/${articles.length}): ${desiredTitle || baseName}`);
        const effectiveFormatterExamples = [formatterExamples, formatterFromExample].filter(Boolean).join('\n\n');
        const description = pickMetaDescription(item);
        const tag = pickTag(item, plan);
        const pubDate = toIsoDateOnly(item?.pubDate) || toIsoDateOnly(new Date());
        const tags = tag ? [tag] : [];
        const researchContent = JSON.stringify(
          {
            planPath,
            item,
            language: args.lang ? String(args.lang) : '',
            mdOutputDir: mdOutDirFinal,
          },
          null,
          2
        );

        logPromptParts({ globalInstructions: articleInstructions, formatterExamples: effectiveFormatterExamples, researchContent });

        console.log('  🤖 Generando artículo...');
        const messages = createMessages({ globalInstructions: articleInstructions, formatterExamples: effectiveFormatterExamples, researchContent });
        const generated = sanitizeForMdx(stripYamlCodeFenceAroundFrontmatter(stripOuterMarkdownCodeFence(await getAIClient().generate(messages))));
        const keywords = pickKeywords(item);
        const article = enforceRequiredFrontmatter(enforceDraft(enforceTitle(generated, desiredTitle), true), {
          title: desiredTitle,
          description,
          keywords,
          pubDate,
          tags,
          draft: true,
        });

        console.log('  💾 Guardando archivo...');
        const perRunFileGenerator = mdOutDirFinal === fileGenerator.outputDir ? fileGenerator : new FileGenerator(mdOutDirFinal, outputFormat);
        const outputPath = await perRunFileGenerator.save(article, baseName);
        console.log(`  ✅ Guardado: ${outputPath}`);
      }

      console.log('\n✨ Proceso completado\n');
      return;
    }

    if (!targetPath) {
      const researchFiles = await listTxtFilesInDir(infoDirResolved);
      if (researchFiles.length === 0) {
        throw new Error(`No hay archivos .txt en ${infoDirResolved}`);
      }

      console.log(`\n📂 Encontrados ${researchFiles.length} archivos en informacion-txt\n`);

      for (const researchFile of researchFiles) {
        console.log(`\n▶ Investigación: ${researchFile}`);
        console.log('  📖 Leyendo investigación...');
        const researchContent = await promptReader.readPrompt(researchFile);

        const baseNameFromFile = promptReader.extractFilename(researchFile);
        const desiredTitle = extractSeoTitleFromResearchContent(researchContent) || extractFirstNonEmptyLine(researchContent);
        const baseName = desiredTitle ? slugifyFilename(desiredTitle) : baseNameFromFile;

        logPromptParts({ globalInstructions: articleInstructions, formatterExamples, researchContent });

        console.log('  🤖 Generando artículo...');
        const messages = createMessages({ globalInstructions: articleInstructions, formatterExamples, researchContent });
        const article = enforceDraft(
          enforceTitle(sanitizeForMdx(stripYamlCodeFenceAroundFrontmatter(stripOuterMarkdownCodeFence(await getAIClient().generate(messages)))), desiredTitle),
          true
        );

        console.log('  💾 Guardando archivo...');
        const outputPath = await fileGenerator.save(article, baseName);
        console.log(`  ✅ Guardado: ${outputPath}`);
      }
    } else {
      const promptFiles = await promptReader.resolveTargetFiles(targetPath);

      if (promptFiles.length === 0) {
        console.log('❌ No hay archivos .txt para procesar');
        return;
      }

      console.log(`📂 Encontrados ${promptFiles.length} prompts\n`);

      for (const promptFile of promptFiles) {
        console.log(`\n▶ Procesando: ${promptFile}`);

        try {
          console.log('  📖 Leyendo contenido...');
          const researchContent = await promptReader.readPrompt(promptFile);

          const baseNameFromFile = promptReader.extractFilename(promptFile);
          const desiredTitle = extractSeoTitleFromResearchContent(researchContent) || extractFirstNonEmptyLine(researchContent);
          const baseName = desiredTitle ? slugifyFilename(desiredTitle) : baseNameFromFile;

          logPromptParts({ globalInstructions: articleInstructions, formatterExamples, researchContent });

          console.log('  🤖 Generando artículo...');
          const messages = createMessages({ globalInstructions: articleInstructions, formatterExamples, researchContent });
          const article = enforceDraft(
            enforceTitle(sanitizeForMdx(stripYamlCodeFenceAroundFrontmatter(stripOuterMarkdownCodeFence(await getAIClient().generate(messages)))), desiredTitle),
            true
          );

          console.log('  💾 Guardando archivo...');
          const outputPath = await fileGenerator.save(article, baseName);

          console.log(`  ✅ Guardado: ${outputPath}`);
        } catch (error) {
          console.error(`  ❌ Error: ${error.message}`);
        }
      }
    }

    console.log('\n✨ Proceso completado\n');
  } catch (error) {
    console.error(`\n❌ Error fatal: ${error.message}\n`);
    process.exit(1);
  }
}

const entryScriptPath = process.argv[1];
const isExecutedDirectly = entryScriptPath ? import.meta.url === pathToFileURL(entryScriptPath).href : false;
if (isExecutedDirectly) {
  main();
}

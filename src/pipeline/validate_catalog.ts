import path from 'path';
import { isAllowedCategory } from './category_manager.js';
import { groupDuplicateTools } from './dedup_groups.js';
import { isBlankishString, loadAllTools } from './note_generator.js';
import { EntryType, ToolConjunto, ToolStatus } from './types.js';

const ENTRY_TYPES = new Set<EntryType>(['tool', 'product_showcase', 'tech_tip', 'job_remote', 'tech_product']);
const STATUSES = new Set<ToolStatus>(['to_try', 'in_use', 'archived']);
const CONJUNTOS = new Set<ToolConjunto>(['recursos', 'inspiracion', 'producto', 'consejos']);

function literalNull(value: unknown): boolean {
  return typeof value === 'string' && ['null', 'undefined'].includes(value.trim().toLowerCase());
}

/** Devuelve errores de esquema, categoría y duplicados. Lista vacía = catálogo válido. */
export function validateCatalog(): string[] {
  const tools = loadAllTools();
  const errors: string[] = [];

  for (const tool of tools) {
    const fm = tool.frontmatter;
    const where = path.relative(process.cwd(), tool.filePath);
    if (!fm.name || !fm.name.trim()) errors.push(`${where}: falta name`);
    if (!fm.url || isBlankishString(fm.url)) errors.push(`${where}: url vacía o nula`);
    if (!isAllowedCategory(fm.category)) errors.push(`${where}: categoría no permitida "${fm.category || ''}"`);
    if (!fm.entry_type || !ENTRY_TYPES.has(fm.entry_type)) {
      errors.push(`${where}: entry_type inválido "${fm.entry_type || ''}"`);
    }
    if (!fm.status || !STATUSES.has(fm.status)) errors.push(`${where}: status inválido "${fm.status || ''}"`);
    if (fm.conjunto && !CONJUNTOS.has(fm.conjunto)) errors.push(`${where}: conjunto inválido "${fm.conjunto}"`);
    if (!Array.isArray(fm.tags)) errors.push(`${where}: tags debe ser una lista`);
    else if (fm.tags.some((tag) => literalNull(tag))) errors.push(`${where}: tags contiene "null"`);
    if (!fm.date_added) errors.push(`${where}: falta date_added`);

    for (const [key, value] of Object.entries(fm)) {
      if (literalNull(value)) errors.push(`${where}: ${key} guarda la cadena "null"`);
      if (Array.isArray(value) && value.some((item) => literalNull(item))) {
        errors.push(`${where}: ${key} contiene la cadena "null"`);
      }
    }
  }

  for (const group of groupDuplicateTools(tools)) {
    errors.push(`Duplicado: ${group.map((tool) => path.relative(process.cwd(), tool.filePath)).join(' + ')}`);
  }

  return errors;
}

function main() {
  const errors = validateCatalog();
  if (errors.length === 0) {
    console.log(`[Validate] Catálogo válido (${loadAllTools().length} fichas, sin duplicados).`);
    return;
  }
  console.error(`[Validate] ${errors.length} problema(s):`);
  for (const error of errors.slice(0, 80)) console.error(' - ' + error);
  if (errors.length > 80) console.error(` - ... y ${errors.length - 80} más`);
  process.exit(1);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry.endsWith('validate_catalog.ts') || entry.endsWith('validate_catalog.js')) {
  main();
}

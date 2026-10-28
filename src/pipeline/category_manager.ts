import fs from 'fs';
import path from 'path';
import { ToolCategory } from './types.js';

export interface CategoryDefinition {
  name: string;
  section: 'all' | 'tools' | 'tips' | 'jobs' | 'products';
  icon: string;
  color: string; // 'sky' | 'emerald' | 'amber' | 'violet' | 'rose' | 'indigo' | 'cyan' | 'purple' | 'teal' | 'slate'
  description?: string;
  isDefault?: boolean;
}

export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  { name: 'CLI & Terminal', section: 'tools', icon: '🛠️', color: 'emerald', description: 'Herramientas de línea de comandos, TUI y utilidades de terminal', isDefault: true },
  { name: 'Frontend & UI', section: 'tools', icon: '🎨', color: 'rose', description: 'Bibliotecas de componentes, CSS, diseño web y galerías', isDefault: true },
  { name: 'Backend & APIs', section: 'tools', icon: '⚙️', color: 'sky', description: 'Frameworks de servidor, pasarelas de API y microservicios', isDefault: true },
  { name: 'DevOps & Cloud', section: 'tools', icon: '🐳', color: 'cyan', description: 'Docker, CI/CD, despliegues e infraestructura en la nube', isDefault: true },
  { name: 'AI & Machine Learning', section: 'tools', icon: '🤖', color: 'purple', description: 'Modelos de lenguaje, agentes de IA, RAG y pipelines de ML', isDefault: true },
  { name: 'Data Engineering & ETL', section: 'tools', icon: '🔄', color: 'emerald', description: 'Extracción no estructurada, pipelines de datos, ETL/ELT e ingesta hacia almacenes de datos', isDefault: true },
  { name: 'Document AI & Extracción', section: 'tools', icon: '📑', color: 'purple', description: 'Extracción inteligente de PDFs, facturas, formularios KYC a JSON con LLMs', isDefault: true },
  { name: 'Agentes & Protocolo MCP', section: 'tools', icon: '🤖', color: 'cyan', description: 'Servidores Model Context Protocol (MCP), frameworks de memoria y agentes de IA', isDefault: true },
  { name: 'Prompts, Art & Video', section: 'tools', icon: '🎬', color: 'violet', description: 'Generación de video, arte 3D y audio con inteligencia artificial', isDefault: true },
  { name: 'Databases & Storage', section: 'tools', icon: '🗄️', color: 'amber', description: 'Bases de datos SQL/NoSQL, ORMs, almacenamiento y cachés', isDefault: true },
  { name: 'Productivity & Tools', section: 'tools', icon: '⚡', color: 'teal', description: 'Utilidades para desarrolladores, métricas y optimización', isDefault: true },
  { name: 'Documentation & Resources', section: 'tools', icon: '📚', color: 'indigo', description: 'Guías, libros, cheat sheets y documentación estática', isDefault: true },
  { name: 'Empresas & Productos', section: 'tools', icon: '🏢', color: 'indigo', description: 'Productos y herramientas desarrolladas por empresas o startups', isDefault: true },
  { name: 'Productos Tecnológicos & Hardware', section: 'products', icon: '🖥️', color: 'amber', description: 'Placas, microcontroladores, periféricos y gadgets físicos', isDefault: true },
  { name: 'Consejos & Buenas Prácticas', section: 'tips', icon: '💡', color: 'violet', description: 'Trucos de código, comandos y patrones de arquitectura', isDefault: true },
  { name: 'Trabajo & Freelance', section: 'jobs', icon: '💼', color: 'sky', description: 'Vacantes de empleo remoto y oportunidades de contratación', isDefault: true },
  { name: 'Other', section: 'all', icon: '📦', color: 'slate', description: 'Recursos varios y clasificaciones generales', isDefault: true },
];

const CATEGORIES_FILE = path.resolve(process.cwd(), 'data/categories.json');

export function ensureCategoriesFile(): void {
  const dir = path.dirname(CATEGORIES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(CATEGORIES_FILE)) {
    fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(DEFAULT_CATEGORIES, null, 2), 'utf-8');
  }
}

export function getAllCategories(): CategoryDefinition[] {
  ensureCategoriesFile();
  try {
    const raw = fs.readFileSync(CATEGORIES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Combinar con los defaults asegurando que los defaults no se pierdan
      const map = new Map<string, CategoryDefinition>();
      DEFAULT_CATEGORIES.forEach((c) => map.set(c.name.toLowerCase(), c));
      parsed.forEach((c: CategoryDefinition) => {
        if (c && c.name) {
          map.set(c.name.toLowerCase(), {
            ...c,
            isDefault: DEFAULT_CATEGORIES.some((d) => d.name.toLowerCase() === c.name.toLowerCase()),
          });
        }
      });
      return Array.from(map.values());
    }
  } catch (err) {
    console.warn('[Category Manager] Error leyendo data/categories.json:', err);
  }
  return DEFAULT_CATEGORIES;
}

export function getAllCategoryNames(): string[] {
  return getAllCategories().map((c) => c.name);
}

export function saveAllCategories(categories: CategoryDefinition[]): void {
  ensureCategoriesFile();
  fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(categories, null, 2), 'utf-8');
}

export function addCustomCategory(newCat: Partial<CategoryDefinition> & { name: string }): CategoryDefinition {
  const cleanName = newCat.name.trim();
  if (!cleanName) throw new Error('El nombre de la categoría es requerido.');

  const all = getAllCategories();
  const existingIdx = all.findIndex((c) => c.name.toLowerCase() === cleanName.toLowerCase());

  const categoryItem: CategoryDefinition = {
    name: cleanName,
    section: newCat.section || 'tools',
    icon: newCat.icon?.trim() || '🏷️',
    color: newCat.color || 'sky',
    description: newCat.description?.trim() || `Herramientas y recursos de ${cleanName}`,
    isDefault: existingIdx >= 0 ? all[existingIdx].isDefault : false,
  };

  if (existingIdx >= 0) {
    all[existingIdx] = categoryItem;
  } else {
    all.push(categoryItem);
  }

  saveAllCategories(all);
  return categoryItem;
}

export function deleteCustomCategory(name: string): boolean {
  const all = getAllCategories();
  const target = all.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!target) return false;
  if (target.isDefault) {
    throw new Error(`La categoría estándar "${target.name}" no se puede eliminar.`);
  }

  const filtered = all.filter((c) => c.name.toLowerCase() !== name.toLowerCase());
  saveAllCategories(filtered);
  return true;
}

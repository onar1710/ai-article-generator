import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

export class PromptReader {
  constructor(promptsDir = config.promptsDir) {
    this.promptsDir = promptsDir;
  }

  async resolveTargetFiles(targetPath) {
    if (!targetPath) {
      return await this.getPromptFiles();
    }

    const resolved = path.resolve(targetPath);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch (error) {
      throw new Error(`Ruta no válida: ${targetPath}`);
    }

    if (stat.isFile()) {
      if (!resolved.toLowerCase().endsWith('.txt')) {
        throw new Error(`El archivo debe ser .txt: ${targetPath}`);
      }
      return [resolved];
    }

    if (stat.isDirectory()) {
      const files = await fs.readdir(resolved);
      return files
        .filter(file => file.toLowerCase().endsWith('.txt'))
        .map(file => path.join(resolved, file));
    }

    throw new Error(`La ruta no es archivo ni carpeta: ${targetPath}`);
  }

  async getPromptFiles() {
    try {
      const preferred = path.join(this.promptsDir, 'informacion.txt');
      try {
        const stat = await fs.stat(preferred);
        if (stat.isFile()) {
          return [preferred];
        }
      } catch {
        // ignore
      }

      const files = await fs.readdir(this.promptsDir);
      return files
        .filter(file => file.toLowerCase().endsWith('.txt'))
        .map(file => path.join(this.promptsDir, file));
    } catch (error) {
      throw new Error(`Error leyendo directorio prompts: ${error.message}`);
    }
  }

  async readPrompt(filename) {
    const filePath = path.isAbsolute(filename) ? filename : path.join(this.promptsDir, filename);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      throw new Error(`Error leyendo ${filename}: ${error.message}`);
    }
  }

  extractFilename(promptFile) {
    return path.basename(promptFile, '.txt');
  }
}

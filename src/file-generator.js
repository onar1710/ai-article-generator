import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

export class FileGenerator {
  constructor(outputDir = config.outputDir, outputFormat = config.outputFormat) {
    this.outputDir = outputDir;
    this.format = outputFormat;
  }

  async ensureOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      throw new Error(`Error creando directorio outputs: ${error.message}`);
    }
  }

  async save(content, baseName) {
    await this.ensureOutputDir();
    
    const filename = `${baseName}.${this.format}`;
    const filePath = path.join(this.outputDir, filename);

    try {
      await fs.writeFile(filePath, content, 'utf-8');
      return filePath;
    } catch (error) {
      throw new Error(`Error guardando ${filename}: ${error.message}`);
    }
  }
}

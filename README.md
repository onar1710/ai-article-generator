# AI Article Generator

Generador de artículos para el blog (Markdown/MDX) usando un proveedor de IA compatible con el formato de **Chat Completions**.

Este módulo está pensado para:
- Analizar un artículo existente del sitio y generar una investigación/plan (JSON).
- Generar nuevos artículos (.md / .mdx) a partir de ese plan, guardándolos en la carpeta que definas (por ejemplo `src/content/blog/`).

## Qué hace (resumen)

- Lee instrucciones globales desde `prompts/promts.txt` (generación) y `prompts/promts-analysis.txt` (análisis).
- Para el “formato”:
  - Por defecto intenta leer el **frontmatter real del proyecto** desde `BLOG_CONTENT_DIR` (ej: `src/content/blog/`) y usa solo ese bloque `--- ... ---` como ejemplo.
  - Si no encuentra frontmatter en el proyecto, usa ejemplos desde `ejemplo-fromater/` (si existe).
- En modo análisis:
  - toma un artículo fuente `.md/.mdx` del repo,
  - le pasa al modelo el artículo + constraints + lista de posts existentes del sitio,
  - guarda el resultado como JSON en `./out/analysis-*.json`.
- En modo generación desde plan:
  - lee un JSON (plan),
  - genera 1..N artículos,
  - fuerza frontmatter mínimo para evitar errores típicos de YAML/MDX,
  - guarda archivos en el directorio de salida configurado.

## Requisitos

- Node.js (proyecto ESM).
- Una API key de alguno de los proveedores soportados.

## Instalación

```bash
cd ai-article-generator
npm install
```

## Configuración (.env)

Copia `.env.example` a `.env` dentro de `ai-article-generator/` y completa tus keys:

```env
# Salida de archivos: md o mdx
OUTPUT_FORMAT=mdx

# Directorio de salida por defecto para los .md/.mdx generados
# (puede ser relativo al repo raíz cuando empieza con src/…)
OUTPUT_DIR=src/content/blog

# Directorio de prompts (opcional)
PROMPTS_DIR=./prompts

# Directorios (opcionales)
ANALYSIS_OUT_DIR=./out
INFO_DIR=./informacion-txt
FORMATTER_DIR=./ejemplo-fromater

# Frontmatter del proyecto (recomendado)
USE_PROJECT_FRONTMATTER=true
BLOG_CONTENT_DIR=./src/content/blog

# Keys por proveedor (usa el que corresponda al AI_PROVIDER)
GROK_API_KEY=tu_key
KIMI_API_KEY=tu_key
MIMO_API_KEY=tu_key

# Proveedor/modelo por función (recomendado)
# ANALYSIS = opción (1) y comando "analyze"
AI_PROVIDER_ANALYSIS=
AI_MODEL_ANALYSIS=
# SOURCE = opción (3) y comando "analyze-source"
AI_PROVIDER_SOURCE=
AI_MODEL_SOURCE=
# GENERATE = generación de artículos
AI_PROVIDER_GENERATE=
AI_MODEL_GENERATE=

# Fallback (si NO pones los de arriba)
AI_PROVIDER=grok

# Opcionales (model/temperature/tokens)
GROK_MODEL=grok-beta
GROK_TEMPERATURE=1.0
GROK_MAX_TOKENS=50000

KIMI_MODEL=kimi-k2.5
KIMI_TEMPERATURE=1.0
KIMI_MAX_TOKENS=50000

MIMO_MODEL=MiMo-V2.5
MIMO_TEMPERATURE=1.0
MIMO_MAX_TOKENS=50000
MIMO_TIMEOUT_MS=300000
AI_TIMEOUT_MS=300000
```

## Proveedores soportados

- Grok (x.ai)
- Kimi (moonshot)
- Mimo (Xiaomi)

## Cómo se usa

La herramienta se ejecuta con:

```bash
npm run generate
```

Si la ejecutas sin argumentos, abre un menú interactivo:

- (1) Analizar un artículo del sitio y guardar investigación JSON en `./out/`
- (2) Generar artículos desde una investigación JSON existente en `./out/`
- (3) Analizar una fuente original (`.txt`) y generar un JSON con ideas en `./out/`

### Modo CLI: analizar un artículo (plan JSON)

Genera un plan en JSON a partir de un artículo existente:

```bash
node src/generator.js analyze --input "src/content/blog/mi-articulo.md" --lang es
```

Opcionales útiles:

- `--output "ruta.json"` para elegir el nombre/ubicación del JSON
- `--maxTitleLen 72` para validar títulos del plan
- `--tag "Mi Tag"` para forzar una sola etiqueta para todos los artículos nuevos (como constraint para el modelo)
- `--draft true|false` como constraint del plan
- `--analysisPrompt "ruta/prompt.txt"` para usar otro prompt de análisis

Salida:
- Se guarda un `analysis-*.json` en `ai-article-generator/out/`.

### Modo CLI: generar artículos desde un plan JSON

Genera N artículos a partir del JSON:

```bash
node src/generator.js generate-plan --plan "out/analysis-mi-articulo.json" --lang es --outDir "src/content/blog"
```

Notas:
- `--outDir` soporta rutas relativas al repo raíz si empiezan con `src/…`.
- También intenta detectar un `mdOutputDir` dentro del propio plan.
- Puedes forzar de dónde sale el “formato” con:
  - `--blogContentDir "ruta"` (frontmatter real del proyecto)
  - `--noProjectFrontmatter` (usar `ejemplo-fromater/`)

### Modo CLI: analizar una fuente original (.txt) y generar ideas (JSON)

Genera un JSON con ideas de artículos a partir de un texto fuente (noticia/nota de prensa):

```bash
node src/generator.js analyze-source --input "fuente-original-analisis.txt" --lang es
```

Opcionales útiles:
- `--output "ruta.json"` para elegir el nombre/ubicación del JSON
- `--sourcePrompt "prompts/promts-fuente-original.txt"` para usar otro prompt
- `--tag "Mi Tag"` para forzar una etiqueta (se pasa como constraint al modelo)

### Modo legacy: generar desde `.txt` (informacion-txt)

Si no usas plan JSON, también existe un flujo “directo” por archivos `.txt`:

- Si no pasas ruta, procesa todos los `.txt` en `./informacion-txt/`.
- Si pasas una ruta, puede ser un `.txt` o una carpeta con `.txt`.

Ejemplos:

```bash
node src/generator.js informacion-txt/mi-investigacion.txt
node src/generator.js informacion-txt/
```

## Qué valida y qué “arregla” al guardar

Para evitar errores comunes al compilar MDX/Astro:

- Asegura que exista un bloque de frontmatter `--- ... ---`.
- Inserta/actualiza campos mínimos:
  - `title`
  - `description`
  - `pubDate`
  - `draft` (por defecto los nuevos salen `true`)
  - `tags` cuando el plan trae una etiqueta
- Limpia wrappers como ```mdx ... ``` si el modelo devuelve el artículo dentro de un code fence.
- Escapa patrones que rompen MDX como `<2` (MDX lo interpreta como JSX).

## Estructura del módulo

- `src/generator.js` → CLI (menú interactivo + comandos `analyze` / `generate-plan`)
- `src/ai-client.js` → cliente unificado para llamar a la API del proveedor
- `src/config.js` → carga `.env` y define endpoint/model/keys
- `src/prompt-reader.js` → lectura y resolución de archivos `.txt`
- `src/file-generator.js` → guardado de `.md/.mdx` en disco
- `src/generate-article.js` → helper para generar y guardar un solo artículo (usado por integraciones)

## Carpetas importantes

- `prompts/`
  - `promts.txt` (instrucciones de generación)
  - `promts-analysis.txt` (instrucciones de análisis/plan)
- `out/` (auto)
  - aquí se guardan los planes JSON generados (analysis-*.json)
- `src/content/blog/` (proyecto)
  - aquí están los posts existentes; se usa el frontmatter del post más reciente como ejemplo (configurable con `BLOG_CONTENT_DIR`)
- `ejemplo-fromater/` (opcional)
  - ejemplos de formato; si la carpeta no existe, el sistema continúa sin fallar
- `informacion-txt/` (opcional)
  - entrada “legacy” por `.txt` si no quieres usar plan JSON

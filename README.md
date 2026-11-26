# NexIA — IHC

Prototipo académico de plataforma de estudio: subes tus apuntes (PDF, DOCX, TXT/MD) y NexIA los convierte en temas, lecciones, preguntas, flashcards y repasos.

## Tecnologías

Solo **HTML5**, **CSS3** y **JavaScript** (vanilla). Sin frameworks.

- **Base de datos local:** IndexedDB del navegador (con respaldo en `localStorage`). Justificación: hace falta persistir cuentas, materiales y progreso sin montar un servidor.
- **IA opcional:** puedes pegar una clave de API compatible con OpenAI (OpenAI, Groq, OpenRouter u Ollama local) en Perfil. Las peticiones salen desde el navegador al proveedor; si no hay clave, el tutor local (recuperación sobre tu material) sigue funcionando.

## Cómo abrirla

1. Abre `index.html` o `login.html` en el navegador (Chrome/Edge recomendados).
2. Crea una cuenta con correo **@gmail.com**, entra con la cuenta demo, o usa «Entrar con cuenta demo».
3. En la app: **Explorar un tema** → sube un archivo, pega texto o prueba el material de ejemplo.
4. (Opcional) Configura la IA en **Perfil** (menú superior derecho → **Mi perfil**).

## Cómo ver la base de datos (IndexedDB)

Los datos (Gmail, documentos, progreso, espacios, etc.) se guardan en el navegador, no en un servidor. Para inspeccionarlos:

### Chrome o Edge

1. Abre la app (`login.html` o `app.html`) e inicia sesión.
2. Pulsa **F12** (o clic derecho → **Inspeccionar**).
3. Ve a la pestaña **Application** (en español: **Aplicación**).
4. En el menú izquierdo: **Storage** → **IndexedDB** → **nexia**.
5. Abre cada almacén (tabla) y revisa los registros:

| Almacén (`store`) | Qué contiene |
|-------------------|--------------|
| `users` | Cuentas: correo, nombre, huella de contraseña, preferencias |
| `materials` | Documentos analizados (temas, conceptos, preguntas) |
| `attempts` | Intentos de práctica / espacios |
| `saved` | Favoritos y fragmentos subrayados |
| `reviews` | Repasos programados |
| `activity` | Actividad diaria (racha, etc.) |
| `spaces` | Espacios compartidos y códigos |

También puedes ver:

- **Local Storage** → claves `nexia:session` (sesión) y `nexia:ai` (ajustes de IA).
- Si IndexedDB falla (modo muy restringido), la app usa respaldo en `localStorage` con prefijo `nexia:db:`.

### Firefox

1. **F12** → pestaña **Almacenamiento**.
2. **IndexedDB** → **nexia** → mismos almacenes.

### Nota

Borrar datos del sitio (o usar otra ventana de incógnito) elimina cuentas y materiales de **ese** navegador. No hay sincronización entre dispositivos.

## Cómo añadir / activar la IA

La IA **ya está integrada** de forma opcional (`js/core/ai.js`). No hace falta otro lenguaje: el navegador habla directo con el proveedor.

### Pasos en la interfaz

1. Entra a la app.
2. Arriba a la derecha: tu avatar / **Mi cuenta** → **Mi perfil**.
3. Sección **Asistente con IA (opcional)**:
   - Activa **Usar IA en el tutor**.
   - Elige proveedor (OpenAI, Groq, OpenRouter, Ollama local o URL personalizada).
   - Revisa **modelo** y **URL base** (se rellenan con el proveedor).
   - Pega tu **clave de API**.
   - **Guardar ajustes de IA**.
   - (Opcional) **Probar conexión**.
4. Abre una lección y usa el **Tutor NexIA**: si la IA está bien configurada, responde con el modelo; si falla o no hay clave, usa el **tutor local**.

### Dónde conseguir una clave (ejemplos)

- [OpenAI](https://platform.openai.com/) → API keys  
- [Groq](https://console.groq.com/) → API keys (suele tener cuota gratuita)  
- [OpenRouter](https://openrouter.ai/) → varias modelos con una sola clave  
- **Ollama** en tu PC: instala Ollama, corre un modelo y usa URL `http://127.0.0.1:11434/v1` (sin clave real o con un valor cualquiera según tu setup)

### Qué se envía al proveedor

Solo cuando el tutor usa IA: tu pregunta + un extracto del concepto/material actual. La clave se guarda en **este navegador** (`localStorage` → `nexia:ai`); NexIA no tiene servidor propio que la reciba.

### Sin clave

El programa sigue funcionando: análisis local, lecciones, práctica, espacios y tutor basado en el texto del material.

## Pruebas del núcleo

```bash
node tests/run.js
```

Valida la extracción de PDF/DOCX/TXT y el analizador con documentos sintéticos en memoria.

## Estructura

- `js/core/` — utilidades, extracción, analizador, muestra, store, auth, IA
- `js/app/` — interfaz, estado, vistas y enrutador (`#/inicio`, `#/explorar`, `#/espacios`, …)
- Perfil: solo desde el menú de la esquina superior derecha (ya no está en el lateral)
- `css/` — estilos globales, app y extensiones (modo oscuro, toasts, IA)

## Límites honestos

- El análisis del documento es **local y determinista** (no es un LLM).
- Los PDF escaneados (solo imagen) o cifrados no se pueden leer; usa pegar texto.
- Las cuentas no son un login de servidor: viven en **este dispositivo y navegador**.
- El correo de registro/login debe ser **@gmail.com** (la cuenta demo es la excepción).

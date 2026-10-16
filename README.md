# 🚀 Awesome Dev Toolkit & Segundo Cerebro

> Colección curada y categorizada de herramientas, bibliotecas y repositorios técnicos descubiertos en **X/Twitter**, sincronizados automáticamente con notas individuales de **Obsidian** y un catálogo interactivo con IA (Gemini 3.8 Flash).

[![Total Tools](https://img.shields.io/badge/Herramientas_guardadas-2-blue?style=for-the-badge&logo=bookmark)]()
[![Gemini Powered](https://img.shields.io/badge/Clasificado_con-Gemini_3.8_Flash-8E75C2?style=for-the-badge&logo=google)]()
[![Obsidian Ready](https://img.shields.io/badge/Obsidian-Segundo_Cerebro-7C3AED?style=for-the-badge&logo=obsidian)]()

---

## 📑 Tabla de Contenidos

- [🛠️ CLI & Terminal](#cli-terminal) (2)

---


### 🛠️ CLI & Terminal

- **[Lazygit](https://github.com/jesseduffield/lazygit)** ⭐ **52.000** `🟢 En uso`  
  Una interfaz de usuario de terminal simple y rápida para comandos de git, escrita en Go con gocui. [📝 Ver nota](content/tools/lazygit.md) `#git` `#terminal` `#go` `#productivity`

- **[Astral UV](https://github.com/astral-sh/uv)** ⭐ **48.000** `🟡 Por probar`  
  Gestor de paquetes y entornos de Python extremadamente rápido escrito en Rust, diseñado como reemplazo directo de pip y virtualenv. [📝 Ver nota](content/tools/astral-uv.md) `#python` `#rust` `#package-manager` `#cli`



---

## 🛠️ Cómo Usar Este Proyecto

### 1. Iniciar el Dashboard Web y Servidor de Ingesta
```bash
npm run dev
```
Abre `http://localhost:4000` en tu navegador para ver el catálogo con buscador instantáneo (`Cmd+K`), filtros por tecnología y notas personales.

### 2. Añadir un recurso rápidamente desde la terminal
```bash
npm run add "https://github.com/astral-sh/uv"
```

### 3. Usar como Segundo Cerebro en Obsidian
Abre la carpeta `content/tools` directamente como un **Vault en Obsidian** (o añade esta carpeta a tu Vault existente). Cada herramienta tiene su propio archivo `.md` con frontmatter YAML compatible con Dataview y notas de uso personal.

### 4. Guardado en 1-Clic desde X (Bookmarklet)
Arrastra el enlace desde la carpeta `bookmarklet/` a tu barra de favoritos de Chrome/Brave/Firefox. Al ver un tweet interesante en X, haz clic en el botón y se enviará directo a tu toolkit local.

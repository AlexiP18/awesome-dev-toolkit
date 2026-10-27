---
name: 'Git: Deshacer el último commit manteniendo los cambios'
url: 'https://x.com/tech_tips_daily/status/1789012345678901234'
category: Consejos & Buenas Prácticas
tags:
  - git
  - terminal
  - productivity
  - workflow
status: in_use
date_added: 2026-10-25T00:00:00.000Z
source_tweet: 'https://x.com/tech_tips_daily/status/1789012345678901234'
author: '@tech_tips_daily'
author_handle: tech_tips_daily
entry_type: tech_tip
created_at: '2026-10-25T18:05:48.979Z'
---
# 💡 Git: Deshacer el último commit manteniendo los cambios

> Si hiciste un commit por error o necesitas modificar archivos antes de enviarlo, usa `git reset --soft HEAD~1` para mantener todos tus cambios intactos en el área de staging.

## 📌 Puntos Clave & Pasos del Consejo
- `git reset --soft HEAD~1`: Deshace el commit pero deja los cambios listos en staging (`staged`).
- `git reset HEAD~1` (o `--mixed`): Deshace el commit y saca los cambios a tu directorio de trabajo (sin perder nada).
- Evita usar `--hard` a menos que quieras descartar completamente los cambios realizados.

## 📝 Aplicación Práctica & Contexto
- Comando imprescindible al comitear antes de correr los tests o si olvidaste incluir un archivo en el mensaje de commit.

## 🔗 Referencias
- Tweet con el consejo completo: [Ver en X](https://x.com/tech_tips_daily/status/1789012345678901234)

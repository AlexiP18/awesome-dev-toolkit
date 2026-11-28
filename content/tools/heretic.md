---
name: Heretic
url: 'https://x.com/0xCodila/status/2124927759310848452'
category: AI & Machine Learning
conjunto: recursos
tags:
  - llm
  - modelos-locales
  - ollama
  - abliteration
status: to_try
date_added: '2026-11-24'
created_at: '2026-11-24T04:17:07.859Z'
source_tweet: 'https://x.com/0xCodila/status/2124927759310848452'
author: codila
author_handle: 0xCodila
entry_type: tool
company: codila
classified_by: Importado del vault
---
# Heretic

> Herramienta open source que elimina las negativas de modelos LLM abiertos y locales editando los pesos, sin reentrenar.

**👤 Publicado / Recomendado por:** codila ([@0xCodila](https://x.com/0xCodila))

## 💡 ¿Por qué destaca?
- Localiza la parte del modelo responsable de rechazar y la elimina de los pesos

- Prueba ~100 variantes y muestra negativas restantes y divergencia KL

- Elegir la variante con KL bajo para no degradar el modelo

- Resultado exportable a Ollama o LM Studio; el tuit no trae el enlace al repo

## 📝 Notas Personales (Segundo Cerebro)
- this repo gives your AI f*cking BALLS...

it kills LLM CENSORSHIP in open & local AI models:

forever. for free. 43k stars on GitHub.

here's full guide and how it works:

first understand how it works:

• the problem: AI labs train models to refuse, jailbreak prompts only trick them for one chat
• Heretic finds the exact part inside the model that says "no" and cuts it out of the weights - no retraining
• it tries 100 versions, then shows how many refusals are left and how much the model's brain changed - you keep best one

here's how to setup this for FREE:

1 → Open Claude Code on your PC/Mac and paste photo below (there's my prompt that do everything for you). The more memory, the bigger model

2 → pick one of the 3 models it shows, or name the one you already run in Ollama or LM Studio

3 → it installs everything itself and starts Heretic in a new window, a 4B model takes ~45 min on a strong GPU

4 → the step everyone skips: at the end, don't just grab the fewest refusals. Check KL too: the lower it is, the less the model got dumber

5 → save that row and type "saved". Claude Code puts the uncensored model into Ollama or LM Studio

the result: new/the same local model with almost no refusals, running offline on your own PC/Mac

save this. repo below

then read article on REA that explain where to use these models:

## 🔗 Referencias
- Enlace de referencia: [https://x.com/0xCodila/status/2124927759310848452](https://x.com/0xCodila/status/2124927759310848452)
- Sitio Web oficial: [https://x.com/0xCodila/status/2124927759310848452](https://x.com/0xCodila/status/2124927759310848452)

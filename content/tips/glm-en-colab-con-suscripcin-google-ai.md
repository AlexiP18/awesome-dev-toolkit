---
name: GLM en Colab con suscripción Google AI
url: 'https://x.com/superalesha/status/2126011712692224264'
category: AI & Machine Learning
conjunto: consejos
tags:
  - colab
  - llm
  - gpu
  - inferencia
status: to_try
date_added: '2026-11-27'
created_at: '2026-11-27T04:14:38.836Z'
source_tweet: 'https://x.com/superalesha/status/2126011712692224264'
author: Alexey Fateev
author_handle: superalesha
entry_type: tech_tip
company: Alexey Fateev
classified_by: Importado del vault
---
# 💡 GLM en Colab con suscripción Google AI

> Consejo para aprovechar las unidades de cómputo de Colab incluidas en Google AI y servir un LLM grande como API local para agentes de código.

**👤 Publicado / Recomendado por:** Alexey Fateev ([@superalesha](https://x.com/superalesha))

## 📌 Puntos Clave & Pasos del Consejo
- Instancia G4 con RTX PRO 6000 Blackwell 96 GB a 10,05 CU/h

- Un script lanza el modelo y expone endpoints OpenAI y Anthropic en 127.0.0.1:18100

- Imprime snippets para Claude Code, Codex u OpenCode; el repo está en una respuesta y no venía en el tuit

## 📝 Aplicación Práctica & Contexto
- If you pay for a Gemini or Google AI subscription, you're sitting on a 96 GB RTX PRO 6000 Blackwell in Colab and probably haven't touched it.

1 script launches GLM-5.3-Flash Uncensored (321B) at 102 tok/s in ~10 minutes and gives you a local API endpoint for your coding harness.

Google bundles Colab compute units straight into Google AI plans, and a G4 instance (RTX PRO 6000 Blackwell 96 GB + 176 GB RAM + Zen 5 EPYC) only burns 10.05 CU/hr. That's cheaper than H100 (~18.05 CU/hr) with 16 GB more VRAM:

- Google AI Pro ($20/mo, 200 CU): ~20 hours
- Google AI Ultra 5x ($100/mo, 1,000 CU): ~99 hours
- Google AI Ultra 20x ($200/mo, 2,000 CU): ~199 hours

I tested 3 public abliterated EXL3 tiers on Project Maya + DFlash2 and packed them into 1 launcher with SSH port forwarding to 127.0.0.1:18100 (OpenAI /v1 and Anthropic /v1/messages, with tool calls, thinking, vision, and 0 refusals):

- 2.51 bpw (default, 98.1 GiB, 131K ctx): 102.3 tok/s decode, 1,190 / 2,255 tok/s prefill (~10 min cold start, ~22s warm)
- 2.51 bpw at 262K ctx: 98.9 tok/s decode
- 3.05 bpw (117.5 GiB, 131K ctx): 89.0 tok/s decode
- 4.05 bpw (153.8 GiB, 131K ctx): 71.8 tok/s decode

It prints your local URL, port, model ID, and ready-to-paste snippets for Claude Code, Codex, or OpenCode as soon as the tunnel is live, and ships with stop(.)sh so you don't burn units while idle. Link to the repo in the reply.

## 🔗 Referencias
- Tweet con el consejo completo: [https://x.com/superalesha/status/2126011712692224264](https://x.com/superalesha/status/2126011712692224264)
- Sitio Web oficial: [https://x.com/superalesha/status/2126011712692224264](https://x.com/superalesha/status/2126011712692224264)

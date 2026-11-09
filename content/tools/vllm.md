---
name: vLLM
url: 'https://github.com/vllm-project/vllm'
website_url: 'https://docs.vllm.ai/'
category: AI & Machine Learning
tags:
  - inferencia
  - self-hosted
  - open-source
  - pagedattention
  - gpu
  - llm
status: to_try
date_added: '2026-11-06'
created_at: '2026-11-06T04:04:14.690Z'
source_tweet: 'https://x.com/nahid_pro09/status/2087762950845284595'
author: Nahid
author_handle: nahid_pro09
entry_type: tool
classified_by: DeepSeek Directo (deepseek-flash)
conjunto: recursos
---
# vLLM

> Motor de inferencia open-source para servir modelos de pesos abiertos en tu propio hardware, con PagedAttention y batching continuo para maximizar el throughput sin factura por token.

**👤 Publicado / Recomendado por:** Nahid ([@nahid_pro09](https://x.com/nahid_pro09))

## 💡 ¿Por qué destaca?
- Soporte de modelos Hugging Face (Llama, Qwen, DeepSeek, Mistral) con pesos abiertos

- PagedAttention y continuous batching para alta concurrencia y menor uso de VRAM

- Servidor compatible con la API de OpenAI, por lo que puedes sustituir un proveedor cloud por tu propia instancia

- Alternativa sin coste por token frente a APIs gestionadas cuando ya dispones de GPUs

## 📝 Notas Personales (Segundo Cerebro)
- Recomendado como plan B frente a la API de Fireworks si el gasto en tokens crece o necesitas privacidad de datos: despliega vLLM en una GPU propia o alquilada y expón el endpoint a tus herramientas OpenAI-compatible.

## 🔗 Referencias
- Repositorio de código (GitHub): [https://github.com/vllm-project/vllm](https://github.com/vllm-project/vllm)
- Sitio Web oficial: [https://docs.vllm.ai/](https://docs.vllm.ai/)
- Tweet origen: [Ver en X](https://x.com/nahid_pro09/status/2087762950845284595)

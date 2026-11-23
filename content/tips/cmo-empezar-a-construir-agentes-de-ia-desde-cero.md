---
name: Cómo empezar a construir agentes de IA desde cero
url: 'https://x.com/santtiagom_/status/2124243921882517649'
category: Agentes & Protocolo MCP
conjunto: consejos
tags:
  - agentes-ia
  - llm
  - tool-calling
  - agent-loop
status: to_try
date_added: '2026-11-22'
created_at: '2026-11-22T04:14:33.729Z'
source_tweet: 'https://x.com/santtiagom_/status/2124243921882517649'
author: santi
author_handle: santtiagom_
entry_type: tech_tip
company: santi
classified_by: Importado del vault
---
# 💡 Cómo empezar a construir agentes de IA desde cero

> Guía para aprender agentes de IA entendiendo primero los fundamentos antes de usar frameworks como LangChain o CrewAI.

**👤 Publicado / Recomendado por:** santi ([@santtiagom_](https://x.com/santtiagom_))

## 📌 Puntos Clave & Pasos del Consejo
- Cinco conceptos clave: LLMs, tool calling, estado y contexto, agent loop y manejo de errores

- Construir primero un agente simple con un loop y un par de tools, por ejemplo uno que investigue errores en logs

- Implementar límites, timeouts y reintentos para evitar loops

- Después profundizar en memoria, orquestación, guardrails y evals

## 📝 Aplicación Práctica & Contexto
- si querés aprender a construir agentes de IA, te recomiendo empezar por entender cómo funcionan antes de meterte con frameworks como LangChain o CrewAI.

un agente es un sistema donde un modelo de IA puede decidir qué acciones realizar, utilizar tools y analizar sus resultados para completar una tarea.

hay 5 conceptos clave:

1) LLMs -> cómo procesan el contexto, generan respuestas y cuáles son sus limitaciones.

2) tool calling -> cómo el modelo solicita ejecutar funciones y tu código se encarga de validarlas, ejecutarlas y devolver los resultados.

3) estado y contexto -> cómo administrar el historial, los resultados de las tools y el progreso para que el agente pueda continuar trabajando.

4) agent loop -> el ciclo donde el modelo decide qué hacer, solicita tools, analiza los resultados y repite hasta completar la tarea.

5) manejo de errores -> qué pasa cuando una tool falla, el modelo toma una mala decisión o el agente queda atrapado en un loop. cómo implementar límites, timeouts y reintentos.

mi recomendación es construir primero un agente sencillo desde cero, con un loop y un par de tools.

por ejemplo, uno que investigue errores en una aplicación consultando logs y datos. el modelo decide qué revisar y utiliza los resultados para investigar las causas.

después podés profundizar en memoria, orquestación, guardrails y evals.

## 🔗 Referencias
- Tweet con el consejo completo: [https://x.com/santtiagom_/status/2124243921882517649](https://x.com/santtiagom_/status/2124243921882517649)
- Sitio Web oficial: [https://x.com/santtiagom_/status/2124243921882517649](https://x.com/santtiagom_/status/2124243921882517649)

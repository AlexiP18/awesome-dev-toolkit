---
name: improve
url: 'https://github.com/shadcn/improve'
category: Agentes & Protocolo MCP
conjunto: recursos
tags:
  - agent-skills
  - code-review
  - planificacion
  - tokens
  - shadcn
status: to_try
date_added: '2026-11-18'
created_at: '2026-11-18T04:20:53.958Z'
source_tweet: 'https://x.com/doodi_dev/status/2121456841767235997'
author: 두디 Doodi
author_handle: doodi_dev
entry_type: tool
company: 두디 Doodi
classified_by: Importado del vault
---
# improve

> Skill de agente de shadcn que audita todo el repositorio y redacta planes de trabajo para que modelos más baratos los implementen.

**👤 Publicado / Recomendado por:** 두디 Doodi ([@doodi_dev](https://x.com/doodi_dev))

## 💡 ¿Por qué destaca?
- /improve escanea el repo y genera planes markdown en plans/ con rutas, código actual, comandos de verificación y condiciones de parada

- /improve execute: un modelo barato implementa en carpeta aparte y el caro revisa; el merge lo decide la persona

- Revisa 9 áreas (seguridad, rendimiento, tests…) citando archivo y línea

- MIT; instalación con npx skills add shadcn/improve

## 📝 Notas Personales (Segundo Cerebro)
- ⭐ improve ⭐
https://github.com/shadcn/improve

1. shadcn이 코드 전체를 점검하고 다른 AI가 따라 할 작업 계획서를 써주는 에이전트 스킬을 공개함

2. 가장 똑똑한 비싼 모델은 코드 파악, 할 일 고르기, 계획서 쓰기만 맡음. 실제 구현은 싼 모델한테 넘김. 스킬은 코드를 직접 고치지 않음

3. /improve 하면 저장소를 훑고 문제 목록 표를 보여줌. 고른 것만 plans/ 폴더에 마크다운 계획서로 만들어줌. 계획서에는 파일 경로, 현재 코드, 확인 명령, 멈춰야 할 조건까지 들어 있음

4. /improve execute 하면 싼 모델이 따로 만든 작업 폴더에서 계획서대로 구현하고, 비싼 모델이 결과를 검토함. 합치는 건 사람이 정함. 보안·성능·테스트 등 9가지 분야를 보고 문제마다 파일과 줄 번호를 근거로 붙임

5. MIT 무료, 스타 1만 개. Agent Skills 형식을 지원하는 에이전트면 사용 가능

설치: npx skills add shadcn/improve

비싼 모델은 계획만, 싼 모델은 작업만 시키는 구조라 토큰비 아끼고 싶은 사람한테 좋을 듯

━━━━━━━━━━
🇺🇸
1. shadcn released an agent skill that audits a whole codebase and writes work plans for other AIs to follow

2. Your most capable (expensive) model only understands the code, picks what to do, and writes the plan. Cheaper models do the actual building. The skill never edits code itself

3. Run /improve and it scans the repo and shows a table of problems. Pick some and it writes each one as a markdown plan in plans/, with file paths, current code, check commands, and when to stop

4. /improve execute has a cheaper model build the plan in a separate work folder, then the expensive model reviews the result. Merging is up to you. It looks at 9 areas like security, performance, and tests, and every finding cites a file and line number

5. Free under MIT, 10.5k stars. Works with any agent that supports the Agent Skills format

Install: npx skills add shadcn/improve

Expensive model plans, cheap model works. Sounds great for anyone trying to save on token costs

#AI #AgentSkills #AIAgents #OpenSource #CodingAgents

## 🔗 Referencias
- Repositorio de código (GitHub): [https://github.com/shadcn/improve](https://github.com/shadcn/improve)
- Tweet origen: [Ver en X](https://x.com/doodi_dev/status/2121456841767235997)

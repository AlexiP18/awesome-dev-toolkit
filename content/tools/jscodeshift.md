---
name: jscodeshift
url: 'https://github.com/meta/jscodeshift'
category: Other
conjunto: recursos
tags:
  - codemods
  - javascript
  - refactor
status: to_try
date_added: '2026-11-25'
created_at: '2026-11-25T04:11:51.781Z'
source_tweet: 'https://x.com/0xChaseTM/status/2124999022666543477'
author: Chase
author_handle: 0xChaseTM
entry_type: tool
company: Chase
classified_by: Importado del vault
---
# jscodeshift

> Toolkit de codemods para aplicar la misma migración de API o imports en todo el repo.

**👤 Publicado / Recomendado por:** Chase ([@0xChaseTM](https://x.com/0xChaseTM))

## 💡 ¿Por qué destaca?
- Migraciones masivas con codemods

- Proyecto de Meta

## 📝 Notas Personales (Segundo Cerebro)
- this is f***ing gem

SpaceXAI engineer Lauren Tan shared how her Grok Bot agents verify their own fixes automatically

she built the loop so a failed check sends the agent back to the code

use these 10 GitHub repos to build her workflow:

→ Issue context

> github MCP server (34,7k) - gives the coding agent the issue, PR diff and CI results
https://t.co/AAr4j3T07m

> spec Kit (151k) - sets the task scope and acceptance criteria before coding starts
https://t.co/GGsxpj56Dh

→ Verification skills

> pstack (18,8k) - packages Lauren Tan’s replay steps and pass criteria into a reusable skill
https://t.co/sJRsJQdg9E

> matt pocock Skills (331k) - guides the agent from bug diagnosis to a failing test
https://t.co/COw1Eg8csr

→ Browser replay and profiling

> playwright MCP (40,1k) - drives the same browser actions before and after the patch
https://t.co/lGlDxEh1iv

> chrome devtools MCP (59k) - records the traces used to compare frame times
https://t.co/smeQjIBpDM

> playwright (101k) - runs the saved regression test in CI
https://t.co/8gRg2s3Bk0

→ Codebase maintenance

> ast-grep (16,7k) - finds other instances of a problematic code pattern
https://t.co/5eWyqQlxwp

> jscodeshift (10k) - applies the same API or import migration across the repo
https://t.co/jAExERgdeG

> eslint (27,6k) - catches forbidden imports and recurring violations in CI
https://t.co/BeKltCWeOH

How it works:

1. grok bot routes the report to cursor
2. lauren’s pstack skill saves the replay steps and what counts as a pass

3. playwright MCP repeats the interaction
4. chrome devtools MCP captures the trace

38 ms baseline → 22 ms still over the 16 ms budget → 14 ms passes

5. second agent reruns the check on the exact commit and attaches both traces to the PR

Save this to build a verification loop your agents can run on their own

## 🔗 Referencias
- Repositorio de código (GitHub): [https://github.com/meta/jscodeshift](https://github.com/meta/jscodeshift)
- Tweet origen: [Ver en X](https://x.com/0xChaseTM/status/2124999022666543477)

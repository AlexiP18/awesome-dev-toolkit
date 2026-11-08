---
name: Floci
url: 'https://github.com/floci-io/floci'
category: DevOps & Cloud
tags:
  - aws
  - localstack
  - emulador
  - docker
  - devops
  - s3
  - lambda
  - eks
  - kubernetes
  - testcontainers
stars: 30513
status: to_try
date_added: '2026-11-06'
created_at: '2026-11-06T04:08:24.631Z'
source_tweet: 'https://x.com/josesilesdata/status/2087163414439235666'
author: José Siles | AI | Data
author_handle: josesilesdata
entry_type: tool
company: floci-io
classified_by: DeepSeek Directo (deepseek-flash)
---
# Floci

> Emulador local de AWS escrito en Java que expone 69 servicios de AWS (S3, Lambda, DynamoDB, EKS, IAM, Athena, API Gateway, Step Functions) en localhost:4566, permitiendo practicar y testear sin cuenta ni tarjeta de crédito.

**👤 Publicado / Recomendado por:** José Siles | AI | Data ([@josesilesdata](https://x.com/josesilesdata))

## 💡 ¿Por qué destaca?
- 69 servicios de AWS emulados en un único endpoint localhost:4566, incluyendo S3, Lambda, DynamoDB, IAM, Athena, API Gateway, Step Functions y EKS

- No es una emulación simulada: RDS levanta un PostgreSQL real y EKS un Kubernetes real mediante contenedores de verdad, donde la compatibilidad importa

- Rendimiento extremo: arranque en 24 ms, imagen Docker de solo 90 MB y ~13 MiB de consumo en reposo

- Licencia MIT, sin token, sin cuenta y sin feature gates; compatible con flujos tipo LocalStack y Testcontainers

## 📝 Notas Personales (Segundo Cerebro)
- Ideal para desarrollo y testing de infraestructura AWS en local, ejecutar suites de integración en CI sin coste cloud y para estudiantes o entornos sin acceso a una cuenta AWS real; apunta tus SDKs y AWS CLI al endpoint http://localhost:4566 y define credenciales dummy.

## 🔗 Referencias
- Repositorio de código (GitHub): [https://github.com/floci-io/floci](https://github.com/floci-io/floci)
- Tweet origen: [Ver en X](https://x.com/josesilesdata/status/2087163414439235666)

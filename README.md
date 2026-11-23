# AskouT Hunter

Descobre eventos e os leva ao AskouT, só pelos endpoints de serviço `/hunter/*` (Bearer `HUNTER_SERVICE_TOKEN`). Sistema separado do AskouT e desligável pela aba Hunter da gestão. Decisões e passagem: `docs/HUNTER.md` no repositório AskouT.

Estado: esqueleto (fase 2). Pronto: cliente da ponte, nota de confiança (pesos 25/25/20/15/10/5), deduplicação, decisão por candidato em modo observação, esquema `hunter_*` em `sql/`. Falta: conectores, Gemini, fila 06h/18h, banco e painel, publicação.

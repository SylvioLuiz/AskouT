# AskouT

Menos tempo combinando. Mais tempo juntos.

## Estado atual (Fase 1, entrega 1)

| Item | Estado |
|---|---|
| Monorepo (npm workspaces) | estrutura criada |
| `packages/availability-engine` | **implementado e testado** (15 testes passando, typecheck limpo) |
| `apps/api/prisma/schema.prisma` | escrito, **ainda não validado** com `prisma validate` |
| View `friendships` + constraints (SQL) | escrito, **ainda não executado** em um Postgres |
| API (auth, perfis, seguir) | **não iniciada** |
| Front end (web, painéis, design system) | **não iniciado** |

Nada acima é simulado: o que consta como implementado roda e tem teste.

## Rodar os testes do motor

    cd packages/availability-engine
    npm test          # requer Node >= 22
    npm run typecheck # requer typescript

## Regras do motor de compatibilidade (confirmadas)

Por participante, para o intervalo proposto:
1. Indisponibilidade manual explícita prevalece.
2. Compromisso externo ocupado gera conflito.
3. Disponibilidade manual cobrindo o intervalo inteiro = disponível; cobrindo só parte = parcial.
4. Sem informação = não informado (nunca indisponível).

Classificação do intervalo:
- qualquer participante sem informação: **Aguardando informações**
- todos disponíveis: **Verde**
- (disponíveis + parciais) >= metade: **Laranja**
- demais casos: **Vermelho**

Ordenação do "Encontrar melhor data": verde, laranja, aguardando, vermelho; depois mais disponíveis, mais parciais, menos sem informação e, por último, o horário mais cedo.

## Próximos passos

1. API (NestJS + Prisma): cadastro, login, perfil, seguir/aprovar/bloquear, consultas de amizade com testes.
2. Expansão de recorrência (RRULE) para slots concretos antes de chamar o motor.
3. Agenda manual e criação de encontros usando o motor.
4. Design system e navegação do app web.

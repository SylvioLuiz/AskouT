/**
 * Quem consulta sem conta (modo visitante). Nenhuma conta tem este id: segue ninguém, não tem bloqueio nem papel em local.
 * Só as leituras públicas (PublicService) usam, e elas tiram da resposta tudo que é de pessoa.
 */
export const VISITOR_ID = '00000000-0000-0000-0000-000000000000';

import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';

export interface AccountExportFile {
  /** Nome sugerido para o arquivo. */
  filename: string;
  data: Record<string, unknown>;
}

/**
 * Direitos do titular (LGPD): baixar uma cópia dos próprios dados e apagar a conta.
 */
export class AccountService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** Cópia dos dados da pessoa em JSON. Não inclui arquivos de imagem e vídeo, só o que existe sobre eles. */
  async exportData(userId: string): Promise<AccountExportFile> {
    const profile = await this.deps.users.findProfileById(userId);
    if (!profile) throw notFound('Conta não encontrada');
    const now = this.deps.clock.now();
    const sections = await this.deps.account.exportData(userId);
    return {
      filename: `askout-meus-dados-${profile.username}-${now.toISOString().slice(0, 10)}.json`,
      data: {
        generatedAt: now.toISOString(),
        notes: 'Cópia dos seus dados no AskouT. Fotos e vídeos não vão neste arquivo, apenas o registro de que existem. Mensagens de outras pessoas não são suas e não aparecem aqui.',
        ...sections,
      },
    };
  }

  /**
   * Apaga a conta e tudo o que depende dela. Não tem volta.
   * Confirmação: digitar o próprio @usuário e, em conta com senha, a senha. Conta que entra só com Google ou Apple não tem senha para digitar.
   */
  async deleteAccount(userId: string, input: { username?: unknown; password?: unknown }): Promise<{ deleted: true }> {
    const { users, hasher, account, clock } = this.deps;
    const user = await users.findById(userId);
    const profile = await users.findProfileById(userId);
    if (!user || !profile) throw notFound('Conta não encontrada');

    if (typeof input.username !== 'string' || input.username.trim().replace(/^@/, '').toLowerCase() !== profile.username.toLowerCase()) {
      throw validationError('Confirmação incorreta', { username: 'Digite o seu @usuário exatamente como ele aparece' });
    }
    if (user.role === 'ADMIN') throw forbidden('Contas de administração não podem ser apagadas por aqui. Peça para outra pessoa da gestão mudar o seu papel antes.');

    if (!(await account.hasExternalIdentity(user.id))) {
      if (typeof input.password !== 'string' || input.password === '') throw validationError('Confirmação incorreta', { password: 'Digite a sua senha' });
      if (!(await hasher.verify(input.password, user.passwordHash))) throw validationError('Confirmação incorreta', { password: 'Senha incorreta' });
    }

    if ((await account.activeBoostCount(user.id, clock.now())) > 0) {
      throw conflict('Você tem um impulsionamento pago em andamento. Espere terminar ou fale com o suporte antes de apagar a conta.');
    }

    await account.deleteAccount(user.id);
    return { deleted: true };
  }
}

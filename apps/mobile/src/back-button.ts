/**
 * Botão "voltar" do Android: volta uma tela no app (histórico do WebView). Na primeira tela, manda o app para
 * segundo plano em vez de fechar, como os apps do Android fazem. Antes de voltar, o app web pode tratar o toque
 * (fechar uma folha aberta, por exemplo) cancelando o evento "askout:back".
 */
export interface BackButtonDeps {
  addListener: (event: 'backButton', cb: (e: { canGoBack: boolean }) => void) => unknown;
  minimizeApp: () => unknown;
  goBack: () => void;
  /** Dispara "askout:back"; devolve false quando o app web cancelou (já tratou o toque). */
  dispatch: () => boolean;
}

export function installBackButton(deps: BackButtonDeps): void {
  deps.addListener('backButton', ({ canGoBack }) => {
    if (!deps.dispatch()) return;
    if (canGoBack) deps.goBack();
    else void deps.minimizeApp();
  });
}

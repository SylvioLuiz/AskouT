#if canImport(ActivityKit)
import ActivityKit
import Foundation

/// Live Activity da chegada do amigo no NOW (tela bloqueada e Dynamic Island), como o carro chegando no Uber.
///
/// Usado pelo app (que registra a atividade, ver ArrivalActivities.swift) e pela extensão de widget (que desenha,
/// ver ArrivalLiveActivity.swift). Quem abre, atualiza e fecha é o servidor, por push (apps/api, ApnsSender.liveActivity):
/// os nomes dos campos aqui são as chaves de `attributes` e `content-state` desse push. Não renomeie sem mudar lá.
@available(iOS 16.1, *)
struct ArrivalAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// "ana está a caminho" / "ana chegou".
        var title: String
        /// "Chega em ~8 min · 650 m até Bar do Zé" / "Chegou em Bar do Zé".
        var body: String
        /// 0 no começo do trajeto, 1 na chegada.
        var progress: Double
        var arrived: Bool
    }

    /// Nome de quem está chegando (a inicial vai no círculo).
    var name: String
    /// `arrival:<encontro>:<pessoa>`: identifica a chegada no servidor.
    var tag: String
    /// Tela do app que abre ao tocar (`/now/encontro/<id>`).
    var url: String
    /// Token assinado com que o app registra o token desta atividade no servidor (sem login).
    var registration: String
}
#endif

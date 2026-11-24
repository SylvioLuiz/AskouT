import Capacitor
import Foundation
import WidgetKit

/// Widgets da tela inicial e da tela bloqueada (extensão AskouTWidgets): o app só avisa o iPhone para buscar de novo.
///
/// O widget lê a sessão do Keychain compartilhado (a mesma da folha de compartilhar, ShareSessionPlugin.swift) e busca
/// `GET /me/widgets` sozinho. O app chama `reload()` ao ir para o segundo plano (apps/mobile/src/main.ts), para o
/// widget já mostrar o que mudou dentro do app (confirmou presença, ligou o NOW, aceitou um convite...).
@objc(WidgetsPlugin)
public class WidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetsPlugin"
    public let jsName = "AskouTWidgets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "reload", returnType: CAPPluginReturnPromise),
    ]

    static func reloadAll() {
        WidgetCenter.shared.reloadAllTimelines()
    }

    @objc func reload(_ call: CAPPluginCall) {
        Self.reloadAll()
        call.resolve()
    }
}

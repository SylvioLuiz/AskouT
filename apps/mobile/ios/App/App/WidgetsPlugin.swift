import Capacitor
import Foundation
import Security
import WidgetKit

/// Widgets da tela inicial e da tela bloqueada (extensão AskouTWidgets): o app só avisa o iPhone para buscar de novo.
///
/// O widget lê a sessão do Keychain compartilhado (a mesma da folha de compartilhar, ShareSessionPlugin.swift) e busca
/// `GET /me/widgets` sozinho. O app chama `reload()` ao ir para o segundo plano (apps/mobile/src/main.ts), para o
/// widget já mostrar o que mudou dentro do app (confirmou presença, ligou o NOW, aceitou um convite...).
///
/// `setTheme({ theme })`: o tema escolhido no app ("light", "dark" ou "system"; apps/web/src/lib/theme.ts) vai para o
/// mesmo Keychain compartilhado, e os widgets se redesenham com ele ("system" segue o iPhone).
@objc(WidgetsPlugin)
public class WidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetsPlugin"
    public let jsName = "AskouTWidgets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "reload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTheme", returnType: CAPPluginReturnPromise),
    ]

    static func reloadAll() {
        WidgetCenter.shared.reloadAllTimelines()
    }

    @objc func reload(_ call: CAPPluginCall) {
        Self.reloadAll()
        call.resolve()
    }

    @objc func setTheme(_ call: CAPPluginCall) {
        guard let theme = call.getString("theme"), ["light", "dark", "system"].contains(theme), let data = theme.data(using: .utf8) else {
            call.reject("Tema inválido")
            return
        }
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: ShareSessionPlugin.service,
            kSecAttrAccount as String: "theme",
        ]
        if let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String, !prefix.isEmpty {
            query[kSecAttrAccessGroup as String] = "\(prefix)br.com.askout.shared"
        }
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        Self.reloadAll()
        if status == errSecSuccess { call.resolve() } else { call.reject("Keychain \(status)") }
    }
}

import Capacitor
import Foundation
import Security

/// Sessão do AskouT para a folha de compartilhar (Share Extension, ShareExtension/ShareViewController.swift).
///
/// O app web chama `set({ token, apiBase })` ao entrar (e a cada token novo) e `clear()` ao sair
/// (ponte `window.AskouTShareSession`, ver apps/web/src/lib/share-session.ts). O token fica no Keychain, no grupo
/// compartilhado "<TeamID>.br.com.askout.shared", que só o app e a extensão do mesmo time conseguem ler.
/// Fica só neste aparelho (`ThisDeviceOnly`) e disponível depois do primeiro desbloqueio (a extensão abre com o
/// iPhone desbloqueado, mas o envio pode continuar com a tela apagando).
@objc(ShareSessionPlugin)
public class ShareSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareSessionPlugin"
    public let jsName = "AskouTShareSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    static let service = "br.com.askout.session"

    private var accessGroup: String? {
        guard let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String, !prefix.isEmpty else { return nil }
        return "\(prefix)br.com.askout.shared"
    }

    private func baseQuery() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: "session",
        ]
        if let group = accessGroup { query[kSecAttrAccessGroup as String] = group }
        return query
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty, let apiBase = call.getString("apiBase"), apiBase.hasPrefix("http") else {
            call.reject("Sessão inválida")
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: ["token": token, "apiBase": apiBase]) else {
            call.reject("Sessão inválida")
            return
        }
        SecItemDelete(baseQuery() as CFDictionary)
        var add = baseQuery()
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        // Os widgets (AskouTWidgets) leem a mesma sessão: entrou ou trocou de conta, eles buscam de novo.
        WidgetsPlugin.reloadAll()
        if status == errSecSuccess { call.resolve() } else { call.reject("Keychain \(status)") }
    }

    @objc func clear(_ call: CAPPluginCall) {
        SecItemDelete(baseQuery() as CFDictionary)
        WidgetsPlugin.reloadAll()
        call.resolve()
    }
}

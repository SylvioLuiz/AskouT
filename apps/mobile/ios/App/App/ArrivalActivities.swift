import Capacitor
import Foundation
import UIKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Live Activity da chegada ao vivo do NOW, do lado do app (o desenho fica na extensão ArrivalWidget).
///
/// Quem abre, atualiza e fecha a atividade é o servidor, por push. O app só faz duas coisas:
/// 1. guarda o token "push-to-start" do iPhone (iOS 17.2+), que o app web manda ao servidor como `apnsls:<token>`
///    (ponte `window.AskouTPush.liveActivityToken`, ver apps/web/src/lib/push.ts);
/// 2. quando o servidor abre uma atividade, manda o token dela para `<API>/notifications/push/live-activity`, com o
///    `registration` assinado que veio dentro da atividade (sem login: o iPhone pode abrir o app em segundo plano só
///    para isso). Depois disso as atualizações vão direto para a atividade.
final class ArrivalActivities {
    static let shared = ArrivalActivities()

    private let queue = DispatchQueue(label: "br.com.askout.arrival-activities")
    private var watching = Set<String>()
    private var startToken: String?
    private var waiters: [(String?) -> Void] = []

    /// Chamado ao abrir o app (inclusive quando o iPhone abre em segundo plano para entregar o token da atividade).
    func start() {
        #if canImport(ActivityKit)
        guard #available(iOS 16.1, *) else { return }
        for activity in Activity<ArrivalAttributes>.activities { watch(activity) }
        Task {
            for await activity in Activity<ArrivalAttributes>.activityUpdates { self.watch(activity) }
        }
        if #available(iOS 17.2, *) {
            if let data = Activity<ArrivalAttributes>.pushToStartToken { setStartToken(Self.hex(data)) }
            Task {
                for await data in Activity<ArrivalAttributes>.pushToStartTokenUpdates { self.setStartToken(Self.hex(data)) }
            }
        }
        #endif
    }

    /// Token "push-to-start" (hexadecimal), esperando até `timeout` se o iPhone ainda não entregou. `nil` em iPhone
    /// sem suporte (antes do iOS 17.2) ou com as Atividades ao Vivo desligadas para o AskouT.
    func currentStartToken(timeout: TimeInterval, done: @escaping (String?) -> Void) {
        #if canImport(ActivityKit)
        guard #available(iOS 17.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else { done(nil); return }
        queue.async {
            if let token = self.startToken { done(token); return }
            self.waiters.append(done)
            self.queue.asyncAfter(deadline: .now() + timeout) {
                guard !self.waiters.isEmpty else { return }
                let pending = self.waiters
                self.waiters = []
                pending.forEach { $0(nil) }
            }
        }
        #else
        done(nil)
        #endif
    }

    private func setStartToken(_ token: String) {
        queue.async {
            self.startToken = token
            let pending = self.waiters
            self.waiters = []
            pending.forEach { $0(token) }
        }
    }

    #if canImport(ActivityKit)
    @available(iOS 16.1, *)
    private func watch(_ activity: Activity<ArrivalAttributes>) {
        let first: Bool = queue.sync { self.watching.insert(activity.id).inserted }
        guard first else { return }
        let registration = activity.attributes.registration
        Task {
            for await data in activity.pushTokenUpdates {
                self.register(registration: registration, token: Self.hex(data))
            }
        }
    }
    #endif

    private func register(registration: String, token: String) {
        guard let url = Self.apiURL(path: "/notifications/push/live-activity") else { return }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["registration": registration, "token": token])
        // Com o app em segundo plano, o iPhone dá alguns segundos: segura até o registro sair.
        DispatchQueue.main.async {
            var task: UIBackgroundTaskIdentifier = .invalid
            task = UIApplication.shared.beginBackgroundTask {
                UIApplication.shared.endBackgroundTask(task)
                task = .invalid
            }
            URLSession.shared.dataTask(with: request) { _, _, _ in
                DispatchQueue.main.async {
                    if task != .invalid {
                        UIApplication.shared.endBackgroundTask(task)
                        task = .invalid
                    }
                }
            }.resume()
        }
    }

    /// Endereço da API de `public/askout-native.json` (gerado no build, como no "Responder" das notificações).
    private static func apiURL(path: String) -> URL? {
        guard let file = Bundle.main.url(forResource: "askout-native", withExtension: "json", subdirectory: "public"),
              let data = try? Data(contentsOf: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let base = json["apiUrl"] as? String, base.hasPrefix("https://") else { return nil }
        return URL(string: base + path)
    }

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

/// Ponte para o app web: `AskouTLiveActivity.startToken()` devolve o token "push-to-start" (ou nada).
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "AskouTLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startToken", returnType: CAPPluginReturnPromise),
    ]

    @objc func startToken(_ call: CAPPluginCall) {
        ArrivalActivities.shared.currentStartToken(timeout: 5) { token in
            if let token = token {
                call.resolve(["token": token])
            } else {
                call.resolve([:])
            }
        }
    }
}

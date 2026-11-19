import AVFoundation
import Capacitor

/// Mensagens de voz do chat tocadas pelo próprio iPhone (`window.AskouTAudio`, ver apps/mobile/src/audio-bridge.ts).
///
/// Pelo WebView (Web Audio com a sessão em "playback"), o iPhone trata o chat como um player de música e mostra o
/// áudio na central de controle e na tela de bloqueio. Aqui a sessão é `.playback` com `.duckOthers`: toca no
/// alto-falante mesmo no modo silencioso, abaixa a música de outro app enquanto toca, e por ser uma sessão que se
/// mistura com as outras o sistema não coloca o AskouT no "Tocando agora".
///
/// Formatos que o iPhone não abre (ex.: WebM gravado no Android) voltam com o código `UNSUPPORTED`: o app web então
/// converte para WAV e chama de novo. Qualquer outra falha faz o app web voltar a tocar pelo jeito antigo.
@objc(AudioPlugin)
public class AudioPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate {
    public let identifier = "AudioPlugin"
    public let jsName = "AskouTAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    /// Quantos áudios ficam guardados no aparelho para tocar de novo sem reenviar.
    private static let keep = 12

    private var player: AVAudioPlayer?
    private var currentKey: String?
    private var files: [String: URL] = [:]
    private var order: [String] = []

    private lazy var dir: URL = {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("askout-audio", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func fileExtension(_ mime: String?) -> String {
        let base = (mime ?? "").split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
        switch base {
        case "audio/mp4", "audio/x-m4a", "audio/m4a", "video/mp4": return "m4a"
        case "audio/aac": return "aac"
        case "audio/mpeg", "audio/mp3": return "mp3"
        case "audio/wav", "audio/wave", "audio/x-wav": return "wav"
        case "audio/webm", "video/webm": return "webm"
        case "audio/ogg": return "ogg"
        case "audio/x-caf": return "caf"
        default: return "m4a"
        }
    }

    private func remember(_ key: String, _ url: URL) {
        if let old = files[key], old != url { try? FileManager.default.removeItem(at: old) }
        files[key] = url
        order.removeAll { $0 == key }
        order.append(key)
        while order.count > AudioPlugin.keep {
            let oldest = order.removeFirst()
            if oldest == currentKey { order.append(oldest); break }
            if let file = files.removeValue(forKey: oldest) { try? FileManager.default.removeItem(at: file) }
        }
    }

    private func forget(_ key: String) {
        if let file = files.removeValue(forKey: key) { try? FileManager.default.removeItem(at: file) }
        order.removeAll { $0 == key }
    }

    private func release() {
        player?.delegate = nil
        player?.stop()
        player = nil
        currentKey = nil
    }

    /// Devolve o som aos outros apps (a música volta ao volume normal).
    private func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty, key.count <= 200 else {
            call.reject("Áudio inválido", "INVALID")
            return
        }
        let offsetMs = call.getDouble("offsetMs") ?? 0
        let data = call.getString("data")
        let ext = fileExtension(call.getString("mime"))
        DispatchQueue.main.async {
            var url = self.files[key]
            if let data = data {
                guard let bytes = Data(base64Encoded: data), !bytes.isEmpty else {
                    call.reject("Áudio inválido", "INVALID")
                    return
                }
                let file = self.dir.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
                do {
                    try bytes.write(to: file, options: .atomic)
                } catch {
                    call.reject("Não foi possível preparar o áudio", "WRITE")
                    return
                }
                self.remember(key, file)
                url = file
            }
            guard let source = url else {
                call.reject("Áudio ainda não carregado", "MISSING")
                return
            }
            self.release()
            let next: AVAudioPlayer
            do {
                next = try AVAudioPlayer(contentsOf: source)
            } catch {
                self.forget(key)
                call.reject("Formato de áudio não suportado", "UNSUPPORTED")
                return
            }
            guard next.duration > 0 else {
                self.forget(key)
                call.reject("Formato de áudio não suportado", "UNSUPPORTED")
                return
            }
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
                try session.setActive(true)
            } catch {
                call.reject("Não foi possível tocar o áudio", "SESSION")
                return
            }
            next.delegate = self
            next.prepareToPlay()
            next.currentTime = min(max(0, offsetMs / 1000), max(0, next.duration - 0.05))
            guard next.play() else {
                self.deactivate()
                call.reject("Não foi possível tocar o áudio", "PLAY")
                return
            }
            self.player = next
            self.currentKey = key
            call.resolve(["durationMs": next.duration * 1000, "positionMs": next.currentTime * 1000])
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let position = (self.player?.currentTime ?? 0) * 1000
            self.release()
            self.deactivate()
            call.resolve(["positionMs": position])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.release()
            self.deactivate()
            call.resolve()
        }
    }

    public func audioPlayerDidFinishPlaying(_ finished: AVAudioPlayer, successfully flag: Bool) {
        guard finished === player, let key = currentKey else { return }
        release()
        deactivate()
        notifyListeners("stopped", data: ["key": key, "positionMs": 0, "finished": true])
    }

    public func audioPlayerDecodeErrorDidOccur(_ failed: AVAudioPlayer, error: Error?) {
        guard failed === player, let key = currentKey else { return }
        release()
        deactivate()
        notifyListeners("stopped", data: ["key": key, "positionMs": 0, "finished": true])
    }

    /// Ligação, alarme, Siri: o iPhone corta o som. Para aqui e avisa o app web para mostrar o áudio pausado.
    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        DispatchQueue.main.async {
            guard let current = self.player, let key = self.currentKey else { return }
            let position = current.currentTime * 1000
            self.release()
            self.deactivate()
            self.notifyListeners("stopped", data: ["key": key, "positionMs": position, "finished": false])
        }
    }
}

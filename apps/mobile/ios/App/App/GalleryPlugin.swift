import UIKit
import Photos
import PhotosUI
import AVFoundation
import Capacitor

/// Galeria do iPhone dentro do app (`window.AskouTGallery`, ver apps/mobile/src/gallery-bridge.ts):
/// lista as fotos e vídeos mais recentes com miniatura, entrega o arquivo inteiro da mídia escolhida e
/// cuida do acesso (total, limitado ou negado). Usada na tela de criar story, no estilo do Instagram.
@objc(GalleryPlugin)
public class GalleryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GalleryPlugin"
    public let jsName = "AskouTGallery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "access", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "file", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
    ]

    private let imageManager = PHCachingImageManager()
    private let work = DispatchQueue(label: "br.com.askout.gallery", qos: .userInitiated)
    /// Pasta dos arquivos entregues ao app web: apagados depois de lidos (`discard`) ou ao abrir de novo.
    private lazy var outDir: URL = {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("askout-gallery", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private func accessName(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "full"
        case .limited: return "limited"
        case .notDetermined: return "prompt"
        default: return "denied"
        }
    }

    @objc func access(_ call: CAPPluginCall) {
        call.resolve(["access": accessName(PHPhotoLibrary.authorizationStatus(for: .readWrite))])
    }

    @objc func request(_ call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            call.resolve(["access": self.accessName(status)])
        }
    }

    private func fetchOptions() -> PHFetchOptions {
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        return options
    }

    /// Página de miniaturas, da mídia mais nova para a mais antiga: `{ items: [{ id, kind, thumb, seconds? }], more }`.
    @objc func recent(_ call: CAPPluginCall) {
        let offset = max(0, call.getInt("offset") ?? 0)
        let limit = min(120, max(1, call.getInt("limit") ?? 60))
        let edge = CGFloat(min(600, max(120, call.getInt("thumbSize") ?? 360)))
        work.async {
            let assets = PHAsset.fetchAssets(with: self.fetchOptions())
            let end = min(assets.count, offset + limit)
            var items: [[String: Any]] = []
            if offset < end {
                let options = PHImageRequestOptions()
                options.isSynchronous = true
                options.deliveryMode = .highQualityFormat
                options.resizeMode = .fast
                options.isNetworkAccessAllowed = true
                let target = CGSize(width: edge, height: edge * 4 / 3)
                for index in offset..<end {
                    let asset = assets.object(at: index)
                    var thumb = ""
                    self.imageManager.requestImage(for: asset, targetSize: target, contentMode: .aspectFill, options: options) { image, _ in
                        if let data = image?.jpegData(compressionQuality: 0.7) {
                            thumb = "data:image/jpeg;base64," + data.base64EncodedString()
                        }
                    }
                    var item: [String: Any] = ["id": asset.localIdentifier, "kind": asset.mediaType == .video ? "VIDEO" : "IMAGE", "thumb": thumb]
                    if asset.mediaType == .video { item["seconds"] = asset.duration }
                    items.append(item)
                }
            }
            call.resolve(["items": items, "more": end < assets.count])
        }
    }

    /// Grava a mídia inteira num arquivo temporário: foto em JPEG (HEIC vira JPEG), vídeo como está (ou exportado em MP4).
    @objc func file(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            call.reject("Mídia não encontrada")
            return
        }
        let name = UUID().uuidString
        if asset.mediaType == .video {
            exportVideo(asset, name: name, call: call)
        } else {
            exportImage(asset, name: name, call: call)
        }
    }

    private func exportImage(_ asset: PHAsset, name: String, call: CAPPluginCall) {
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        options.version = .current
        options.deliveryMode = .highQualityFormat
        imageManager.requestImageDataAndOrientation(for: asset, options: options) { data, _, _, _ in
            self.work.async {
                guard let data = data, let image = UIImage(data: data) else {
                    call.reject("Não foi possível abrir esta foto")
                    return
                }
                // Desenha já na orientação certa: o JPEG sai em pé, sem depender de metadados.
                let format = UIGraphicsImageRendererFormat.default()
                format.scale = 1
                let upright = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: image.size)) }
                guard let jpeg = upright.jpegData(compressionQuality: 0.9) else {
                    call.reject("Não foi possível abrir esta foto")
                    return
                }
                let url = self.outDir.appendingPathComponent(name + ".jpg")
                do {
                    try jpeg.write(to: url)
                    call.resolve(["path": url.absoluteString, "mime": "image/jpeg", "name": "foto.jpg"])
                } catch {
                    call.reject("Não foi possível abrir esta foto")
                }
            }
        }
    }

    private func exportVideo(_ asset: PHAsset, name: String, call: CAPPluginCall) {
        let options = PHVideoRequestOptions()
        options.isNetworkAccessAllowed = true
        options.version = .current
        options.deliveryMode = .highQualityFormat
        imageManager.requestAVAsset(forVideo: asset, options: options) { avAsset, _, _ in
            guard let avAsset = avAsset else {
                call.reject("Não foi possível abrir este vídeo")
                return
            }
            if let urlAsset = avAsset as? AVURLAsset {
                let ext = urlAsset.url.pathExtension.lowercased()
                let target = self.outDir.appendingPathComponent(name + "." + (ext.isEmpty ? "mov" : ext))
                do {
                    try FileManager.default.copyItem(at: urlAsset.url, to: target)
                    let mime = ext == "mp4" || ext == "m4v" ? "video/mp4" : "video/quicktime"
                    call.resolve(["path": target.absoluteString, "mime": mime, "name": "video." + (ext.isEmpty ? "mov" : ext)])
                    return
                } catch {
                    // Sem acesso direto ao arquivo: exporta abaixo.
                }
            }
            // Câmera lenta e vídeos editados chegam como composição: exporta para MP4.
            guard let session = AVAssetExportSession(asset: avAsset, presetName: AVAssetExportPresetHighestQuality) else {
                call.reject("Não foi possível abrir este vídeo")
                return
            }
            let target = self.outDir.appendingPathComponent(name + ".mp4")
            session.outputURL = target
            session.outputFileType = .mp4
            session.shouldOptimizeForNetworkUse = true
            session.exportAsynchronously {
                if session.status == .completed {
                    call.resolve(["path": target.absoluteString, "mime": "video/mp4", "name": "video.mp4"])
                } else {
                    call.reject("Não foi possível abrir este vídeo")
                }
            }
        }
    }

    /// Apaga um arquivo entregue por `file` (o app web já leu).
    @objc func discard(_ call: CAPPluginCall) {
        if let path = call.getString("path"), let url = URL(string: path), url.isFileURL, url.path.hasPrefix(outDir.path) {
            try? FileManager.default.removeItem(at: url)
        }
        call.resolve()
    }

    /// Acesso limitado: abre a escolha do sistema de quais fotos o app vê.
    @objc func manage(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController else {
                call.resolve()
                return
            }
            PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: controller) { _ in
                call.resolve()
            }
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }
}

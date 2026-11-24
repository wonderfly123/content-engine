import AVFoundation
import Photos
import UniformTypeIdentifiers

/// Turns a picked clip into a 1080p HEVC file ready to upload. The finished reel is 1080x1920, so
/// sending the 4K original only costs time. Clips kept in iCloud are downloaded here, with progress.
enum ClipExporter {
    struct Output {
        let file: URL
        let filename: String
        let size: Int
        let contentType: String
    }

    /// Full picture for the editor to cut from: used when the phone cannot rebuild the cut itself (an upload link).
    static let fullPreset = AVAssetExportPresetHEVC1920x1080
    /// A small copy, about a tenth of the size: enough for the editor to watch and listen. The finished
    /// video is then rebuilt on the phone from the camera original (LocalCut).
    static let proxyPreset = AVAssetExportPresetMediumQuality

    /// From the photo library (needs access to it): downloads from iCloud if needed, then exports.
    static func export(assetID: String, preset: String, onProgress: @escaping @Sendable (_ stage: String, _ fraction: Double) -> Void) async throws -> Output {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [assetID], options: nil).firstObject else {
            throw UploadError(message: "That clip could not be opened from your library.")
        }
        let options = PHVideoRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        options.progressHandler = { fraction, _, _, _ in onProgress("Downloading from iCloud", fraction) }
        let session: AVAssetExportSession = try await withCheckedThrowingContinuation { continuation in
            PHImageManager.default().requestExportSession(forVideo: asset, options: options, exportPreset: preset) { session, info in
                if let session {
                    continuation.resume(returning: session)
                } else {
                    let reason = (info?[PHImageErrorKey] as? Error)?.localizedDescription ?? "It may still be in iCloud; check your connection."
                    continuation.resume(throwing: UploadError(message: "Your phone could not load that clip. \(reason)"))
                }
            }
        }
        let original = PHAssetResource.assetResources(for: asset).first?.originalFilename ?? "clip.mov"
        return try await run(session, named: original, onProgress: onProgress)
    }

    /// From a file the picker handed over (no library access): exports that copy.
    static func export(file: URL, named: String, preset: String, onProgress: @escaping @Sendable (_ stage: String, _ fraction: Double) -> Void) async throws -> Output {
        guard let session = AVAssetExportSession(asset: AVURLAsset(url: file), presetName: preset) else {
            throw UploadError(message: "That clip is in a format this phone cannot convert.")
        }
        return try await run(session, named: named, onProgress: onProgress)
    }

    private static func run(_ session: AVAssetExportSession, named: String, onProgress: @escaping @Sendable (String, Double) -> Void) async throws -> Output {
        let type: AVFileType = session.supportedFileTypes.contains(.mp4) ? .mp4 : .mov
        let ext = type == .mp4 ? "mp4" : "mov"
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).\(ext)")
        let watcher = Task {
            for await state in session.states(updateInterval: 0.3) {
                if case .exporting(let progress) = state { onProgress("Getting it ready", progress.fractionCompleted) }
            }
        }
        defer { watcher.cancel() }
        do {
            try await session.export(to: out, as: type)
        } catch {
            try? FileManager.default.removeItem(at: out)
            throw UploadError(message: "That clip could not be prepared. \(error.localizedDescription)")
        }
        let size = (try? out.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 0 else { throw UploadError(message: "That clip came out empty. Try picking it again.") }
        let stem = (named as NSString).deletingPathExtension
        return Output(file: out, filename: "\(stem.isEmpty ? "clip" : stem).\(ext)", size: size, contentType: type == .mp4 ? "video/mp4" : "video/quicktime")
    }
}

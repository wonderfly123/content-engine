import AVFoundation
import Photos

/// Which library clip each uploaded clip came from. The server only has a small copy; the original
/// stays in the photo library, and this is how the phone finds it again.
enum LocalClips {
    private static let key = "localClips"
    private static let lock = NSLock()

    private static var map: [String: String] {
        get { UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    static func remember(mediaID: String, assetID: String) {
        lock.withLock { map[mediaID.lowercased()] = assetID }
    }

    static func assetID(for mediaID: String) -> String? {
        lock.withLock { map[mediaID.lowercased()] }
    }
}

/// The editor's cut, rebuilt on the phone from the camera originals: the same shots in the same
/// order (the edit list), at full quality, with the sound taken from the editor's own preview so
/// the music and voice mix is exactly what it made.
enum LocalCut {
    struct Built {
        let asset: AVComposition
        let video: AVVideoComposition
    }

    static let size = CGSize(width: 1080, height: 1920)
    private static let fps: Int32 = 30
    private static let scale: Int32 = 600

    /// True when every shot's original is on this phone.
    static func canBuild(_ cut: Cut) -> Bool {
        guard let shots = cut.shots, !shots.isEmpty else { return false }
        let ids = shots.compactMap { LocalClips.assetID(for: $0.mediaId) }
        guard ids.count == shots.count else { return false }
        return PHAsset.fetchAssets(withLocalIdentifiers: Array(Set(ids)), options: nil).count == Set(ids).count
    }

    /// `soundFrom`: the editor's preview (its sound is laid under the rebuilt picture); nil for a silent rebuild.
    /// `cloud`: where to get a clip that is not on this phone (the server's copy), by its media id.
    static func build(_ cut: Cut, soundFrom: URL?, cloud: ((String) async throws -> URL)? = nil) async throws -> Built {
        try await build(shots: CutEdits.shots(for: cut) ?? cut.shots ?? [], soundFrom: soundFrom, cloud: cloud)
    }

    static func build(shots: [Cut.Shot], soundFrom: URL?, cloud: ((String) async throws -> URL)? = nil) async throws -> Built {
        guard !shots.isEmpty else { throw UploadError(message: "This cut has no edit list.") }
        let composition = AVMutableComposition()
        guard let picture = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw UploadError(message: "The cut could not be put together on this phone.")
        }
        var originals: [String: AVAsset] = [:]
        var instructions: [AVMutableVideoCompositionInstruction] = []
        var cursor = CMTime.zero

        for shot in shots {
            if originals[shot.mediaId] == nil { originals[shot.mediaId] = try await source(shot.mediaId, cloud: cloud) }
            let asset = originals[shot.mediaId]!
            guard let source = try await asset.loadTracks(withMediaType: .video).first else { throw UploadError(message: "One of the clips has no picture.") }
            let (natural, transform) = try await source.load(.naturalSize, .preferredTransform)
            let length = try await asset.load(.duration)

            // The same frame count the editor rendered for this shot, so cuts stay on the beat.
            let frames = max(1, Int64((shot.dur / shot.speed * Double(fps)).rounded()))
            let shown = CMTime(value: frames * Int64(scale / fps), timescale: scale)
            let start = CMTime(seconds: shot.in, preferredTimescale: scale)
            let wanted = CMTime(seconds: shot.dur, preferredTimescale: scale)
            let taken = CMTimeRange(start: start, duration: min(wanted, max(.zero, length - start)))
            guard taken.duration > .zero else { continue }

            try picture.insertTimeRange(taken, of: source, at: cursor)
            picture.scaleTimeRange(CMTimeRange(start: cursor, duration: taken.duration), toDuration: shown)

            let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: picture)
            layer.setTransform(fill(natural: natural, transform: transform, cropX: shot.cropX), at: cursor)
            let instruction = AVMutableVideoCompositionInstruction()
            instruction.timeRange = CMTimeRange(start: cursor, duration: shown)
            instruction.layerInstructions = [layer]
            instructions.append(instruction)
            cursor = cursor + shown
        }
        guard cursor > .zero else { throw UploadError(message: "The cut came out empty.") }

        if let soundFrom {
            let preview = AVURLAsset(url: soundFrom)
            if let sound = try? await preview.loadTracks(withMediaType: .audio).first,
               let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                let length = (try? await preview.load(.duration)) ?? cursor
                try? track.insertTimeRange(CMTimeRange(start: .zero, duration: min(cursor, length)), of: sound, at: .zero)
            }
        }

        let video = AVMutableVideoComposition()
        video.renderSize = size
        video.frameDuration = CMTime(value: 1, timescale: fps)
        video.instructions = instructions
        // Phone footage is often HDR; the finished video is standard range, like the editor's own render.
        video.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
        video.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
        video.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
        return Built(asset: composition, video: video)
    }

    /// Writes the rebuilt cut to a file: 1080x1920 HEVC, ready to post.
    static func export(_ built: Built, onProgress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        // The 1080p preset keeps the size of a vertical frame on current systems; the check below
        // falls back to the full-quality preset if it ever comes out smaller.
        for preset in [AVAssetExportPresetHEVC1920x1080, AVAssetExportPresetHEVCHighestQuality] {
            guard let session = AVAssetExportSession(asset: built.asset, presetName: preset) else { continue }
            session.videoComposition = built.video
            session.shouldOptimizeForNetworkUse = true
            let out = FileManager.default.temporaryDirectory.appendingPathComponent("final-\(UUID().uuidString).mp4")
            let watcher = Task {
                for await state in session.states(updateInterval: 0.3) {
                    if case .exporting(let progress) = state { onProgress(progress.fractionCompleted) }
                }
            }
            defer { watcher.cancel() }
            do {
                try await session.export(to: out, as: .mp4)
            } catch {
                try? FileManager.default.removeItem(at: out)
                throw UploadError(message: "The video could not be made on this phone. \(error.localizedDescription)")
            }
            if let track = try? await AVURLAsset(url: out).loadTracks(withMediaType: .video).first,
               let made = try? await track.load(.naturalSize), Int(made.width) == Int(size.width), Int(made.height) == Int(size.height) {
                return out
            }
            try? FileManager.default.removeItem(at: out)
        }
        throw UploadError(message: "The video did not come out at 1080 by 1920.")
    }

    /// Upright, filling 1080x1920. A clip that is not 9:16 is cropped at `cropX` (0 = left, 1 = right), else centred.
    private static func fill(natural: CGSize, transform: CGAffineTransform, cropX: Double?) -> CGAffineTransform {
        let upright = CGRect(origin: .zero, size: natural).applying(transform)
        let w = abs(upright.width), h = abs(upright.height)
        guard w > 0, h > 0 else { return transform }
        let factor = max(size.width / w, size.height / h)
        let overflowX = w * factor - size.width
        let overflowY = h * factor - size.height
        let dx = -overflowX * CGFloat(cropX ?? 0.5)
        let dy = -overflowY / 2
        return transform
            .concatenating(CGAffineTransform(translationX: -upright.minX, y: -upright.minY))
            .concatenating(CGAffineTransform(scaleX: factor, y: factor))
            .concatenating(CGAffineTransform(translationX: dx, y: dy))
    }

    /// A clip to cut from: the camera original when it is in this phone's library, else the server's copy.
    static func source(_ mediaID: String, cloud: ((String) async throws -> URL)?) async throws -> AVAsset {
        if let assetID = LocalClips.assetID(for: mediaID), PHAsset.fetchAssets(withLocalIdentifiers: [assetID], options: nil).count > 0 {
            return try await original(assetID)
        }
        guard let cloud else { throw UploadError(message: "One of the clips is not on this phone.") }
        return AVURLAsset(url: try await cloud(mediaID))
    }

    /// The camera original from the library, downloaded from iCloud first if it is not on the phone.
    private static func original(_ assetID: String) async throws -> AVAsset {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [assetID], options: nil).firstObject else {
            throw UploadError(message: "One of the clips is no longer in your library.")
        }
        let options = PHVideoRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        return try await withCheckedThrowingContinuation { continuation in
            PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { found, _, info in
                if let found {
                    continuation.resume(returning: found)
                } else {
                    let reason = (info?[PHImageErrorKey] as? Error)?.localizedDescription ?? "It may still be in iCloud."
                    continuation.resume(throwing: UploadError(message: "Your phone could not load one of the clips. \(reason)"))
                }
            }
        }
    }
}

/// Changes made to a cut in the phone's editor (trimmed, reordered or removed shots), kept on the
/// phone per cut. The cut plays, and is exported, with them.
enum CutEdits {
    private static func key(_ cut: Cut) -> String { "cutEdit.\(cut.previewId)" }

    static func shots(for cut: Cut) -> [Cut.Shot]? {
        guard let data = UserDefaults.standard.data(forKey: key(cut)) else { return nil }
        return try? JSONDecoder().decode([Cut.Shot].self, from: data)
    }

    static func save(_ shots: [Cut.Shot], for cut: Cut) {
        UserDefaults.standard.set(try? JSONEncoder().encode(shots), forKey: key(cut))
    }

    static func clear(_ cut: Cut) {
        UserDefaults.standard.removeObject(forKey: key(cut))
    }
}

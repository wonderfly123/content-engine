import SwiftUI
import UIKit

/// The clips being sent for one upload link: each is prepared (downloaded from iCloud if needed,
/// shrunk to 1080p), uploaded in parts, then the batch is sent to the editor in one go.
@MainActor
final class Uploader: ObservableObject {
    enum Source {
        case asset(String)
        case file(URL, name: String)
    }

    enum Stage: Equatable {
        case waiting
        case preparing(String)
        case uploading
        case done
        case failed(String)
    }

    struct Clip: Identifiable {
        let id = UUID()
        let source: Source
        var name: String
        var stage: Stage = .waiting
        var fraction: Double = 0
        var size: Int = 0
        var mediaId: String?
    }

    @Published var link: UploadLink?
    /// Where this uploader sends clips: the link's thread, or a chat the person is signed in to.
    private var target: UploadTarget?
    @Published var clips: [Clip] = []
    @Published var sending = false
    @Published var sentCount = 0
    @Published var sendError: String?

    private static let linkKey = "uploadLink"
    private static let maxAtOnce = 2
    private nonisolated static let partsAtOnce = 4
    private var running = 0
    private var proxies = false

    /// For an upload link (remembered between launches).
    init() {
        if let saved = UserDefaults.standard.string(forKey: Self.linkKey), let parsed = UploadLink(saved) {
            link = parsed
            target = UploadTarget(link: parsed)
        }
    }

    /// For a chat, signed in. Sends small copies and remembers which library clip each came from,
    /// so the phone can rebuild the editor's cut from the originals.
    init(target: UploadTarget) {
        self.target = target
        proxies = true
    }

    var finished: [Clip] { clips.filter { $0.stage == .done } }
    var busy: Bool { clips.contains { if case .failed = $0.stage { return false }; return $0.stage != .done } }
    var unsent: Int { finished.count - sentCount }

    @discardableResult
    func useLink(_ text: String) -> Bool {
        guard let parsed = UploadLink(text) else { return false }
        if parsed != link {
            clips = []
            sentCount = 0
            sendError = nil
        }
        link = parsed
        target = UploadTarget(link: parsed)
        UserDefaults.standard.set("\(parsed.base.absoluteString)/u/\(parsed.token)", forKey: Self.linkKey)
        return true
    }

    func forgetLink() {
        link = nil
        target = nil
        clips = []
        sentCount = 0
        sendError = nil
        UserDefaults.standard.removeObject(forKey: Self.linkKey)
    }

    func add(_ sources: [(Source, String)]) {
        clips.append(contentsOf: sources.map { Clip(source: $0.0, name: $0.1) })
        pump()
    }

    func retry(_ id: UUID) {
        update(id) { $0.stage = .waiting; $0.fraction = 0 }
        pump()
    }

    func remove(_ id: UUID) {
        clips.removeAll { $0.id == id && $0.stage != .uploading }
    }

    /// Tells the thread about every finished clip, with what the video is about. One message, one edit.
    func send(description: String, seconds: Int?) async {
        guard let target, unsent > 0 else { return }
        sending = true
        sendError = nil
        defer { sending = false }
        let ids = finished.compactMap(\.mediaId)
        do {
            try await UploadAPI(target: target).done(mediaIds: ids, description: description.trimmingCharacters(in: .whitespacesAndNewlines), seconds: seconds)
            sentCount = finished.count
        } catch {
            sendError = error.localizedDescription
        }
    }

    // MARK: - One clip at a time, a few in flight

    private func pump() {
        while running < Self.maxAtOnce, let next = clips.first(where: { $0.stage == .waiting }) {
            running += 1
            update(next.id) { $0.stage = .preparing("Starting") }
            UIApplication.shared.isIdleTimerDisabled = true
            Task {
                await process(next.id, next.source)
                running -= 1
                if running == 0 { UIApplication.shared.isIdleTimerDisabled = false }
                pump()
            }
        }
    }

    private func update(_ id: UUID, _ change: (inout Clip) -> Void) {
        guard let i = clips.firstIndex(where: { $0.id == id }) else { return }
        change(&clips[i])
    }

    private func process(_ id: UUID, _ source: Source) async {
        guard let target else { return }
        let api = UploadAPI(target: target)
        // Keeps going for a while if the app is put in the background mid-step; the part uploads themselves carry on regardless.
        let background = UIApplication.shared.beginBackgroundTask(withName: "clip-\(id)")
        defer { UIApplication.shared.endBackgroundTask(background) }

        let progress: @Sendable (String, Double) -> Void = { [weak self] stage, fraction in
            // Progress arrives late; never let it overwrite a clip that has already moved on.
            Task { @MainActor in self?.update(id) { if case .preparing = $0.stage { $0.stage = .preparing(stage); $0.fraction = fraction } } }
        }
        var output: ClipExporter.Output?
        var mediaId: String?
        do {
            switch source {
            case .asset(let assetID):
                output = try await ClipExporter.export(assetID: assetID, preset: proxies ? ClipExporter.proxyPreset : ClipExporter.fullPreset, onProgress: progress)
            case .file(let url, let name):
                // No way back to the original from a copied file: send the full picture.
                output = try await ClipExporter.export(file: url, named: name, preset: ClipExporter.fullPreset, onProgress: progress)
            }
            guard let output else { return }
            update(id) { $0.name = output.filename; $0.size = output.size; $0.stage = .uploading; $0.fraction = 0 }

            let started = try await api.start(filename: output.filename, size: output.size, contentType: output.contentType)
            mediaId = started.mediaId
            if proxies, case .asset(let assetID) = source { LocalClips.remember(mediaID: started.mediaId, assetID: assetID) }
            update(id) { $0.mediaId = started.mediaId }
            let etags = try await uploadParts(of: output, started: started, api: api) { [weak self] sent in
                Task { @MainActor in self?.update(id) { if $0.stage == .uploading { $0.fraction = Double(sent) / Double(max(1, output.size)) } } }
            }
            try await api.complete(mediaId: started.mediaId, etags: etags)
            update(id) { $0.stage = .done; $0.fraction = 1 }
        } catch {
            if let mediaId { await api.abort(mediaId: mediaId) }
            update(id) { $0.stage = .failed(error.localizedDescription); $0.mediaId = nil }
        }
        if let output { try? FileManager.default.removeItem(at: output.file) }
        if case .file(let url, _) = source, clips.first(where: { $0.id == id })?.stage == .done { try? FileManager.default.removeItem(at: url) }
    }

    /// Splits the file into the server's part size and sends a few parts at a time; each part is
    /// tried up to four times, with a fresh link for every retry.
    private nonisolated func uploadParts(of output: ClipExporter.Output, started: UploadAPI.Started, api: UploadAPI, onSent: @escaping @Sendable (Int64) -> Void) async throws -> [Int: String] {
        let numbers = Array(1...started.partCount)
        let urls = try await api.partURLs(mediaId: started.mediaId, partNumbers: numbers)
        let tally = Tally(onSent: onSent)
        let handle = try FileHandle(forReadingFrom: output.file)
        defer { try? handle.close() }

        return try await withThrowingTaskGroup(of: (Int, String).self) { group in
            var etags: [Int: String] = [:]
            var inFlight = 0
            for n in numbers {
                if inFlight >= Self.partsAtOnce, let (done, etag) = try await group.next() {
                    etags[done] = etag
                    inFlight -= 1
                }
                try handle.seek(toOffset: UInt64((n - 1) * started.partSize))
                let data = try handle.read(upToCount: started.partSize) ?? Data()
                let part = FileManager.default.temporaryDirectory.appendingPathComponent("\(started.mediaId)-\(n).part")
                try data.write(to: part)
                let first = urls[n]
                inFlight += 1
                group.addTask {
                    defer { try? FileManager.default.removeItem(at: part) }
                    var attempt = 0
                    while true {
                        do {
                            let url: URL
                            if attempt == 0, let first {
                                url = first
                            } else if let fresh = try await api.partURLs(mediaId: started.mediaId, partNumbers: [n])[n] {
                                url = fresh
                            } else {
                                throw UploadError(message: "The server gave no link for part \(n).")
                            }
                            let etag = try await PartTransfer.shared.put(file: part, to: url) { tally.set(n, $0) }
                            tally.finish(n, Int64(data.count))
                            return (n, etag)
                        } catch is CancellationError {
                            throw CancellationError()
                        } catch {
                            tally.set(n, 0)
                            if attempt >= 3 { throw error }
                            try await Task.sleep(for: .seconds(1 << attempt))
                            attempt += 1
                        }
                    }
                }
            }
            for try await (done, etag) in group { etags[done] = etag }
            return etags
        }
    }
}

/// Bytes sent so far across the parts in flight and the parts finished.
private final class Tally: @unchecked Sendable {
    private let lock = NSLock()
    private var finished: Int64 = 0
    private var inFlight: [Int: Int64] = [:]
    private let onSent: @Sendable (Int64) -> Void

    init(onSent: @escaping @Sendable (Int64) -> Void) { self.onSent = onSent }

    func set(_ part: Int, _ bytes: Int64) {
        let total = lock.withLock { inFlight[part] = bytes; return finished + inFlight.values.reduce(0, +) }
        onSent(total)
    }

    func finish(_ part: Int, _ bytes: Int64) {
        let total = lock.withLock { inFlight[part] = nil; finished += bytes; return finished + inFlight.values.reduce(0, +) }
        onSent(total)
    }
}

import Foundation

/// Sends the parts of a clip to storage on a background URLSession, so they keep going while the
/// phone is locked or the app is in the background. Each part is a small file on disk (background
/// sessions upload from files only), removed once it is sent.
final class PartTransfer: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    static let shared = PartTransfer()

    /// Handed over by the system when it wakes the app for finished uploads.
    var backgroundCompletion: (() -> Void)?

    private struct Pending {
        let continuation: CheckedContinuation<String, Error>
        let onBytes: @Sendable (Int64) -> Void
    }

    private let lock = NSLock()
    private var pending: [Int: Pending] = [:]
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "io.nekter.uploader.parts")
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.httpMaximumConnectionsPerHost = 4
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// PUTs one part file to its presigned URL and returns the ETag storage answers with.
    /// Tried on the background session first. If the system refuses the transfer outright (the
    /// Simulator does, with "unknown error"), the part is sent directly while the app is open.
    func put(file: URL, to url: URL, onBytes: @escaping @Sendable (Int64) -> Void) async throws -> String {
        do {
            return try await putInBackground(file: file, to: url, onBytes: onBytes)
        } catch let error as URLError where error.code == .unknown || error.code == .backgroundSessionWasDisconnected || error.code == .backgroundSessionInUseByAnotherProcess {
            return try await putDirectly(file: file, to: url, onBytes: onBytes)
        }
    }

    private func putDirectly(file: URL, to url: URL, onBytes: @escaping @Sendable (Int64) -> Void) async throws -> String {
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        let size = Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        let (_, res) = try await URLSession.shared.upload(for: req, fromFile: file)
        let http = res as? HTTPURLResponse
        guard let http, (200..<300).contains(http.statusCode), let etag = http.value(forHTTPHeaderField: "ETag") else {
            throw UploadError(message: "A part failed to upload (\(http?.statusCode ?? 0)).")
        }
        onBytes(size)
        return etag
    }

    private func putInBackground(file: URL, to url: URL, onBytes: @escaping @Sendable (Int64) -> Void) async throws -> String {
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        let task = session.uploadTask(with: req, fromFile: file)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.withLock { pending[task.taskIdentifier] = Pending(continuation: continuation, onBytes: onBytes) }
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        lock.withLock { pending[task.taskIdentifier] }?.onBytes(totalBytesSent)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let waiting = lock.withLock({ pending.removeValue(forKey: task.taskIdentifier) }) else { return }
        if let error {
            waiting.continuation.resume(throwing: error)
            return
        }
        let http = task.response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        guard (200..<300).contains(status), let etag = http?.value(forHTTPHeaderField: "ETag") else {
            waiting.continuation.resume(throwing: UploadError(message: "A part failed to upload (\(status))."))
            return
        }
        waiting.continuation.resume(returning: etag)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundCompletion?()
            self.backgroundCompletion = nil
        }
    }
}

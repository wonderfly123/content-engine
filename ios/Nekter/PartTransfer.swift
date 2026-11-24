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
    func put(file: URL, to url: URL, onBytes: @escaping @Sendable (Int64) -> Void) async throws -> String {
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

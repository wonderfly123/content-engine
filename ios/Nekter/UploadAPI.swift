import Foundation

/// An upload link: the texted `https://app.nekter.io/u/<token>`. The token is the key to one thread.
struct UploadLink: Equatable {
    let base: URL
    let token: String

    /// Accepts the full link, `nekter://u/<token>`, or the bare 43-character token.
    init?(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let match = trimmed.range(of: "[A-Za-z0-9_-]{43}", options: .regularExpression) else { return nil }
        token = String(trimmed[match])
        if let url = URL(string: trimmed), url.scheme == "https", let host = url.host {
            base = URL(string: "https://\(host)")!
        } else {
            base = URL(string: "https://app.nekter.io")!
        }
    }

    var uploads: URL { base.appendingPathComponent("api/u/\(token)/uploads") }
}

struct UploadError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Where clips go: an upload link's routes (the link is the key), or a chat's routes for someone signed in.
struct UploadTarget: Sendable {
    let uploads: URL
    /// The signed-in person's access token; nil for an upload link.
    let token: (@Sendable () async -> String?)?

    init(link: UploadLink) {
        uploads = link.uploads
        token = nil
    }

    init(conversationID: String, token: @escaping @Sendable () async -> String?) {
        uploads = Config.appBase.appendingPathComponent("api/conversations/\(conversationID)/uploads")
        self.token = token
    }
}

/// The upload routes (the same ones the website uses): start, part URLs, complete, done.
struct UploadAPI: Sendable {
    let target: UploadTarget

    struct Started: Decodable { let mediaId: String; let partSize: Int; let partCount: Int }
    struct PartURL: Decodable { let partNumber: Int; let url: String }
    private struct PartURLs: Decodable { let urls: [PartURL] }
    private struct Failure: Decodable { let message: String?; let error: String? }

    func start(filename: String, size: Int, contentType: String) async throws -> Started {
        try await post(target.uploads, ["filename": filename, "size": size, "contentType": contentType])
    }

    /// Presigned PUT URLs, 50 at a time (the server's limit per call).
    func partURLs(mediaId: String, partNumbers: [Int]) async throws -> [Int: URL] {
        var out: [Int: URL] = [:]
        for start in stride(from: 0, to: partNumbers.count, by: 50) {
            let batch = Array(partNumbers[start..<min(start + 50, partNumbers.count)])
            let res: PartURLs = try await post(target.uploads.appendingPathComponent("\(mediaId)/parts"), ["partNumbers": batch], retries: 3)
            for p in res.urls { if let u = URL(string: p.url) { out[p.partNumber] = u } }
        }
        return out
    }

    func complete(mediaId: String, etags: [Int: String]) async throws {
        let parts = etags.keys.sorted().map { ["partNumber": $0, "etag": etags[$0]!] as [String: Any] }
        let _: Ignored = try await post(target.uploads.appendingPathComponent("\(mediaId)/complete"), ["parts": parts], retries: 3)
    }

    func abort(mediaId: String) async {
        let _: Ignored? = try? await post(target.uploads.appendingPathComponent("\(mediaId)/abort"), [:])
    }

    func done(mediaIds: [String], description: String?, seconds: Int?) async throws {
        var body: [String: Any] = ["mediaIds": mediaIds]
        if let description, !description.isEmpty { body["description"] = description }
        if let seconds { body["seconds"] = seconds }
        let _: Ignored = try await post(target.uploads.appendingPathComponent("done"), body)
    }

    private struct Ignored: Decodable { init(from decoder: Decoder) throws {} }

    /// `retries`: only for calls that are safe to repeat when the connection drops (part URLs, complete).
    private func post<T: Decodable>(_ url: URL, _ body: [String: Any], retries: Int = 0) async throws -> T {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        if let token = await target.token?() { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        var attempt = 0
        while true {
            do {
                let (data, res) = try await URLSession.shared.data(for: req)
                let status = (res as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(status) else {
                    let failure = try? JSONDecoder().decode(Failure.self, from: data)
                    throw UploadError(message: failure?.message ?? failure?.error ?? "The server answered \(status).")
                }
                return try JSONDecoder().decode(T.self, from: data)
            } catch let error as URLError {
                if attempt >= retries { throw UploadError(message: "The connection dropped. \(error.localizedDescription)") }
                try await Task.sleep(for: .seconds(1 << attempt))
                attempt += 1
            }
        }
    }
}

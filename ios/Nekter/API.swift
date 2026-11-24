import Foundation

// What the server sends, trimmed to what the screens show.

struct Brand: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct ThreadSummary: Decodable, Identifiable, Hashable {
    struct Last: Decodable, Hashable { let body: String; let direction: String }
    let id: String
    let kind: String?
    let status: String
    let title: String?
    let lastMessage: Last?

    var name: String { title ?? (kind.map { "New \($0)" } ?? "New video") }
}

struct Cut: Decodable, Identifiable, Hashable {
    struct Music: Decodable, Hashable { let title: String; let silentId: String }
    let key: String
    let title: String
    let seconds: Double
    let previewId: String
    let hookOptions: [String]
    let caption: String
    let music: Music?
    /// The edit list: which clip, from where, for how long, at what speed. Absent from an older server.
    let shots: [Shot]?
    var id: String { key }

    struct Shot: Codable, Hashable {
        var mediaId: String
        /// Where in the clip the shot starts, and how much of the clip it uses (seconds).
        var `in`: Double
        var dur: Double
        var speed: Double
        var cropX: Double?
        var sound: Bool?
    }
}

struct EditorJob: Decodable, Hashable {
    let id: String
    let status: String
    let cuts: [Cut]
    let approvable: Bool
}

struct ChatMessage: Decodable, Identifiable, Hashable {
    let id: String
    let direction: String
    let body: String
    let editor: EditorJob?
    var mine: Bool { direction == "in" }
}

struct ThreadDetail: Decodable {
    struct Conversation: Decodable {
        let id: String
        let kind: String?
        let title: String?
        let status: String
    }
    struct Step: Decodable, Hashable { let label: String }
    struct Editor: Decodable { let running: Bool; let steps: [Step] }
    struct Clip: Decodable, Identifiable { let id: String; let filename: String; let status: String }
    let conversation: Conversation
    let messages: [ChatMessage]
    let clips: [Clip]
    let editor: Editor
}

struct CutSchedule: Decodable {
    /// ready | approved | scheduled | posted, or nil when the chat has no cut yet.
    let stage: String?
    let when: String?
}

/// The website's own routes, called as the signed-in person.
struct API: Sendable {
    let token: @Sendable () async -> String?

    private struct Brands: Decodable { let brands: [Brand] }
    private struct Threads: Decodable { let threads: [ThreadSummary] }
    private struct Started: Decodable { let conversationId: String? }
    private struct Failure: Decodable { let error: String?; let message: String? }
    private struct Ignored: Decodable { init(from decoder: Decoder) throws {} }

    func brands() async throws -> [Brand] {
        let res: Brands = try await send("GET", "api/brands")
        return res.brands
    }

    func threads(brandID: String) async throws -> [ThreadSummary] {
        let res: Threads = try await send("GET", "api/conversations", query: ["brandId": brandID])
        return res.threads
    }

    /// The New reel / New story buttons. Returns the new chat's id.
    func startThread(brandID: String, kind: String) async throws -> String {
        let res: Started = try await send("POST", "api/conversations", body: ["brandId": brandID, "kind": kind])
        guard let id = res.conversationId else { throw UploadError(message: "The chat was not created.") }
        return id
    }

    func thread(_ id: String) async throws -> ThreadDetail {
        try await send("GET", "api/conversations/\(id)")
    }

    func say(_ text: String, in id: String) async throws {
        let _: Ignored = try await send("POST", "api/conversations/\(id)/messages", body: ["body": text], timeout: 300)
    }

    func approve(_ id: String) async throws {
        let _: Ignored = try await send("POST", "api/conversations/\(id)/approve", body: [:])
    }

    func schedule(_ id: String) async throws -> CutSchedule {
        try await send("GET", "api/conversations/\(id)/schedule")
    }

    /// `when`: "now", "tonight", or an ISO date-time.
    func setSchedule(_ id: String, when: String) async throws {
        let _: Ignored = try await send("POST", "api/conversations/\(id)/schedule", body: ["when": when])
    }

    func unschedule(_ id: String) async throws {
        let _: Ignored = try await send("DELETE", "api/conversations/\(id)/schedule")
    }

    /// A ten-minute link to play a video. The route answers with a redirect; the link is where it points.
    func mediaURL(_ mediaID: String) async throws -> URL {
        var req = URLRequest(url: Config.appBase.appendingPathComponent("api/media/\(mediaID)"))
        if let token = await token() { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (_, res) = try await URLSession.shared.data(for: req, delegate: NoRedirect())
        guard let http = res as? HTTPURLResponse, (300..<400).contains(http.statusCode), let location = http.value(forHTTPHeaderField: "Location"), let url = URL(string: location) else {
            throw UploadError(message: "That video could not be opened.")
        }
        return url
    }

    private func send<T: Decodable>(_ method: String, _ path: String, query: [String: String] = [:], body: [String: Any]? = nil, timeout: TimeInterval = 60) async throws -> T {
        var parts = URLComponents(url: Config.appBase.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { parts.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var req = URLRequest(url: parts.url!, timeoutInterval: timeout)
        req.httpMethod = method
        guard let token = await token() else { throw UploadError(message: "Please sign in again.") }
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, res) = try await URLSession.shared.data(for: req)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let failure = try? JSONDecoder().decode(Failure.self, from: data)
            throw UploadError(message: failure?.message ?? failure?.error ?? "The server answered \(status).")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest) async -> URLRequest? {
        nil
    }
}

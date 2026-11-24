import AuthenticationServices
import CryptoKit
import Foundation
import Security

/// Who is signed in. Google sign-in runs in the phone's own sign-in sheet (Google does not allow it
/// inside an app's web view) through Supabase, the same account system the website uses.
@MainActor
final class AuthStore: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    struct Session: Codable {
        var accessToken: String
        var refreshToken: String
        var expiresAt: Date
        var email: String?
    }

    @Published private(set) var session: Session?
    @Published var error: String?
    @Published var busy = false

    private var refreshing: Task<Session, Error>?
    private var webSession: ASWebAuthenticationSession?

    override init() {
        super.init()
        session = Keychain.load()
    }

    var signedIn: Bool { session != nil }

    // MARK: - Sign in

    func signInWithGoogle() {
        guard !busy else { return }
        busy = true
        error = nil
        let verifier = Self.randomURLSafe(64)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).urlSafeBase64
        var parts = URLComponents(url: Config.supabaseURL.appendingPathComponent("auth/v1/authorize"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [
            .init(name: "provider", value: "google"),
            .init(name: "redirect_to", value: Config.authCallback),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "s256"),
        ]
        let web = ASWebAuthenticationSession(url: parts.url!, callbackURLScheme: Config.authScheme) { [weak self] callback, failure in
            Task { @MainActor in
                guard let self else { return }
                defer { self.busy = false; self.webSession = nil }
                if let failure {
                    if (failure as? ASWebAuthenticationSessionError)?.code != .canceledLogin { self.error = failure.localizedDescription }
                    return
                }
                let items = callback.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems } ?? []
                guard let code = items.first(where: { $0.name == "code" })?.value else {
                    self.error = items.first(where: { $0.name == "error_description" })?.value?.replacingOccurrences(of: "+", with: " ") ?? "Sign-in did not finish."
                    return
                }
                do {
                    self.store(try await Self.token(grant: "pkce", body: ["auth_code": code, "code_verifier": verifier]))
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
        web.presentationContextProvider = self
        webSession = web
        if !web.start() {
            busy = false
            error = "Could not open the sign-in sheet."
        }
    }

    func signOut() {
        session = nil
        Keychain.clear()
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }

    // MARK: - Tokens

    /// A token good for at least another minute, refreshed first when it is about to run out. Nil when signed out.
    func token() async -> String? {
        guard let current = session else { return nil }
        if current.expiresAt.timeIntervalSinceNow > 60 { return current.accessToken }
        if refreshing == nil {
            let refreshToken = current.refreshToken
            refreshing = Task { try await Self.token(grant: "refresh_token", body: ["refresh_token": refreshToken]) }
        }
        defer { refreshing = nil }
        do {
            let fresh = try await refreshing!.value
            store(fresh)
            return fresh.accessToken
        } catch {
            // The refresh token was refused (signed out elsewhere, or expired): sign in again.
            if (error as? UploadError) != nil { signOut() }
            return nil
        }
    }

    private func store(_ fresh: Session) {
        session = fresh
        Keychain.save(fresh)
    }

    private struct TokenResponse: Decodable {
        struct User: Decodable { let email: String? }
        let access_token: String
        let refresh_token: String
        let expires_in: Double
        let user: User?
    }

    private struct TokenFailure: Decodable {
        let error_description: String?
        let msg: String?
    }

    private nonisolated static func token(grant: String, body: [String: String]) async throws -> Session {
        var parts = URLComponents(url: Config.supabaseURL.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [.init(name: "grant_type", value: grant)]
        var req = URLRequest(url: parts.url!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, res) = try await URLSession.shared.data(for: req)
        guard let http = res as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let failure = try? JSONDecoder().decode(TokenFailure.self, from: data)
            throw UploadError(message: failure?.error_description ?? failure?.msg ?? "Sign-in was refused.")
        }
        let t = try JSONDecoder().decode(TokenResponse.self, from: data)
        return Session(accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date().addingTimeInterval(t.expires_in), email: t.user?.email)
    }

    private static func randomURLSafe(_ bytes: Int) -> String {
        var data = Data(count: bytes)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return data.urlSafeBase64
    }
}

private extension Data {
    var urlSafeBase64: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

/// The session lives in the Keychain, not in plain preferences.
private enum Keychain {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "io.nekter.uploader",
        kSecAttrAccount as String: "session",
    ]

    static func load() -> AuthStore.Session? {
        var q = query
        q[kSecReturnData as String] = true
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(AuthStore.Session.self, from: data)
    }

    static func save(_ session: AuthStore.Session) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        SecItemDelete(query as CFDictionary)
        var q = query
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    static func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

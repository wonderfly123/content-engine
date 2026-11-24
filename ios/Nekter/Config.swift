import Foundation

/// Where the app talks to. The key is Supabase's publishable key: it is public by design (the
/// website ships the same one to every browser) and only identifies the project.
enum Config {
    static let appBase = URL(string: "https://app.nekter.io")!
    static let supabaseURL = URL(string: "https://agcqvlcrkkhjbrtwhnia.supabase.co")!
    static let supabaseKey = "sb_publishable_V-zxneIWg93M18YmDeN_sw_niUIc-if"
    /// Where Google sign-in hands control back to the app. Must be in Supabase's allowed redirect URLs.
    static let authCallback = "nekter://auth"
    static let authScheme = "nekter"
}

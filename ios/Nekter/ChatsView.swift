import SwiftUI

/// Your chats for one brand, newest first, with New reel / New story.
struct ChatsView: View {
    @EnvironmentObject private var auth: AuthStore
    @AppStorage("brandID") private var brandID = ""
    @State private var brands: [Brand] = []
    @State private var threads: [ThreadSummary] = []
    @State private var loading = true
    @State private var error: String?
    @State private var path: [String] = []

    private var api: API { API(token: { [auth] in await auth.token() }) }
    private var brand: Brand? { brands.first { $0.id == brandID } ?? brands.first }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if loading && threads.isEmpty {
                    ProgressView()
                } else if brands.isEmpty {
                    ContentUnavailableView("No brand yet", systemImage: "sparkles", description: Text(error ?? "Finish setting up a brand on the website, then pull to refresh."))
                } else if threads.isEmpty {
                    ContentUnavailableView("No chats yet", systemImage: "bubble.left.and.bubble.right", description: Text(error ?? "Tap + to start a reel or a story."))
                } else {
                    List(threads) { thread in
                        NavigationLink(value: thread.id) {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(thread.name).font(.headline).lineLimit(1)
                                    if thread.status != "open" { Text("Closed").font(.caption2).foregroundStyle(.secondary) }
                                }
                                if let last = thread.lastMessage {
                                    Text(last.body).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(brand?.name ?? "Chats")
            .navigationDestination(for: String.self) { ChatView(threadID: $0, api: api) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        if brands.count > 1 {
                            Picker("Brand", selection: $brandID) {
                                ForEach(brands) { Text($0.name).tag($0.id) }
                            }
                        }
                        if let email = auth.session?.email { Text(email) }
                        Button("Sign out", role: .destructive) { auth.signOut() }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("New reel") { start("reel") }
                        Button("New story") { start("story") }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(brand == nil)
                }
            }
            .refreshable { await load() }
            .task { await load() }
            .onChange(of: brandID) { Task { await load() } }
            .onChange(of: path) { if path.isEmpty { Task { await load() } } }
        }
    }

    private func load() async {
        defer { loading = false }
        do {
            brands = try await api.brands()
            if brand?.id != brandID { brandID = brand?.id ?? "" }
            guard let brand else { threads = []; return }
            threads = try await api.threads(brandID: brand.id)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func start(_ kind: String) {
        guard let brand else { return }
        Task {
            do {
                path = [try await api.startThread(brandID: brand.id, kind: kind)]
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

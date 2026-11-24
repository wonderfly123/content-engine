import AVKit
import Photos
import SwiftUI

/// One chat: what you said, what the editor said, its cuts to watch, approve and schedule, and a
/// paperclip that sends clips from your library.
struct ChatView: View {
    let threadID: String
    let api: API

    @StateObject private var uploader: Uploader
    @State private var detail: ThreadDetail?
    @State private var schedule: CutSchedule?
    @State private var draft = ""
    @State private var sending = false
    @State private var picking = false
    @State private var error: String?

    init(threadID: String, api: API) {
        self.threadID = threadID
        self.api = api
        _uploader = StateObject(wrappedValue: Uploader(target: UploadTarget(conversationID: threadID, token: api.token)))
    }

    private var open: Bool { detail?.conversation.status == "open" }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(detail?.messages ?? []) { message in
                        MessageRow(threadID: threadID, message: message, api: api, schedule: schedule, act: act)
                    }
                    if detail?.editor.running == true {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text(detail?.editor.steps.last?.label ?? "The editor is working").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    ForEach(uploader.clips) { ClipRow(clip: $0).environmentObject(uploader) }
                    if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(16)
            }
            .onChange(of: detail?.messages.count) { withAnimation { proxy.scrollTo("end") } }
            .onChange(of: uploader.clips.count) { withAnimation { proxy.scrollTo("end") } }
        }
        .safeAreaInset(edge: .bottom) { if open { composer } }
        .navigationTitle(detail?.conversation.title ?? (detail?.conversation.kind.map { "New \($0)" } ?? "Chat"))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $picking) { ClipPicker { uploader.add($0) }.ignoresSafeArea() }
        .task {
            // Refreshed every few seconds while the chat is on screen, so the editor's steps and cuts appear.
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(detail?.editor.running == true ? 3 : 8))
            }
        }
        // Like the website: once a batch has finished uploading, it is sent to the editor as one message.
        .onChange(of: uploader.busy) {
            guard !uploader.busy, uploader.unsent > 0 else { return }
            Task {
                await uploader.send(description: "", seconds: nil)
                if let failure = uploader.sendError { error = failure }
                await load()
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Button {
                Task {
                    if PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined {
                        _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                    }
                    picking = true
                }
            } label: {
                Image(systemName: "paperclip").font(.title3).frame(width: 40, height: 40)
            }
            TextField("Message the editor", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 18))
            Button {
                say(draft)
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 32))
            }
            .tint(.orange)
            .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func load() async {
        do {
            detail = try await api.thread(threadID)
            schedule = try? await api.schedule(threadID)
            if error != nil, !sending { error = nil }
        } catch {
            if detail == nil { self.error = error.localizedDescription }
        }
    }

    private func say(_ text: String) {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !sending else { return }
        sending = true
        draft = ""
        Task {
            defer { sending = false }
            do {
                try await api.say(body, in: threadID)
                error = nil
            } catch {
                draft = body
                self.error = error.localizedDescription
            }
            await load()
        }
    }

    /// Approve, schedule and unschedule, then show what changed.
    private func act(_ work: @escaping () async throws -> Void) {
        Task {
            do {
                try await work()
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            await load()
        }
    }
}

private struct MessageRow: View {
    let threadID: String
    let message: ChatMessage
    let api: API
    let schedule: CutSchedule?
    let act: (@escaping () async throws -> Void) -> Void

    var body: some View {
        VStack(alignment: message.mine ? .trailing : .leading, spacing: 10) {
            Text(message.body)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(message.mine ? AnyShapeStyle(Color.orange.opacity(0.2)) : AnyShapeStyle(.quaternary), in: RoundedRectangle(cornerRadius: 18))
                .textSelection(.enabled)
            if let job = message.editor {
                ForEach(job.cuts) { CutCard(cut: $0, api: api, threadID: threadID, jobID: job.id, reload: { act {} }) }
                if job.approvable || (job.status == "approved" && schedule?.stage != nil) {
                    CutActions(threadID: threadID, schedule: schedule, approvable: job.approvable, api: api, act: act)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: message.mine ? .trailing : .leading)
    }
}

/// A cut: tap to play, with its caption and hook options underneath.
private struct CutCard: View {
    let cut: Cut
    let api: API
    let threadID: String
    let jobID: String
    let reload: () -> Void
    /// "Making the video 40%" while the phone's version is exported and sent; nil otherwise.
    @State private var sending: String?
    @State private var player: AVPlayer?
    @State private var loading = false
    @State private var failed: String?
    @State private var fromOriginals = false
    @State private var editing = false
    @State private var edited = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 14).fill(.black)
                if let player {
                    VideoPlayer(player: player).clipShape(RoundedRectangle(cornerRadius: 14))
                } else if loading {
                    ProgressView().tint(.white)
                } else {
                    Button {
                        play()
                    } label: {
                        Image(systemName: "play.circle.fill").font(.system(size: 56)).foregroundStyle(.white)
                    }
                }
            }
            .aspectRatio(9.0 / 16.0, contentMode: .fit)
            .frame(maxWidth: 260)
            Text("\(cut.title) · \(Int(cut.seconds.rounded()))s").font(.subheadline.weight(.semibold))
            if fromOriginals { Label("Full quality, from your phone's originals", systemImage: "sparkles").font(.caption).foregroundStyle(.orange) }
            if cut.shots?.isEmpty == false {
                Button {
                    player?.pause()
                    editing = true
                } label: {
                    Label(edited ? "Edited on this phone" : "Edit shots", systemImage: "scissors").font(.subheadline)
                }
                .buttonStyle(.bordered)
            }
            if edited || fromOriginals {
                Button {
                    useThisVersion()
                } label: {
                    HStack(spacing: 6) {
                        if sending != nil { ProgressView() }
                        Text(sending ?? "Use this version").font(.subheadline.weight(.semibold))
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
                .disabled(sending != nil)
            }
            if let music = cut.music { Label(music.title, systemImage: "music.note").font(.caption).foregroundStyle(.secondary) }
            if !cut.caption.isEmpty { Text(cut.caption).font(.footnote).textSelection(.enabled) }
            if !cut.hookOptions.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Hooks").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(cut.hookOptions, id: \.self) { Text("• \($0)").font(.footnote) }
                }
            }
            if let failed { Text(failed).font(.caption).foregroundStyle(.red) }
        }
        .frame(maxWidth: 300, alignment: .leading)
        .onDisappear { player?.pause() }
        .onAppear { edited = CutEdits.shots(for: cut) != nil }
        .sheet(isPresented: $editing) {
            ShotEditorView(cut: cut, api: api) {
                // Saved or reset: the next play rebuilds the cut.
                edited = CutEdits.shots(for: cut) != nil
                player = nil
                fromOriginals = false
            }
        }
    }

    /// Makes the cut on the phone (with any edits), sends the file, and makes it the one the chat posts.
    private func useThisVersion() {
        player?.pause()
        failed = nil
        sending = "Getting the sound"
        Task {
            defer { sending = nil }
            var leftovers: [URL] = []
            defer { leftovers.forEach { try? FileManager.default.removeItem(at: $0) } }
            do {
                // The sound comes from the editor's own preview; a local copy keeps the export off the network.
                let (downloaded, _) = try await URLSession.shared.download(from: try await api.mediaURL(cut.previewId))
                let sound = FileManager.default.temporaryDirectory.appendingPathComponent("sound-\(UUID().uuidString).mp4")
                try FileManager.default.moveItem(at: downloaded, to: sound)
                leftovers.append(sound)

                let shots = CutEdits.shots(for: cut) ?? cut.shots ?? []
                sending = "Making the video"
                let built = try await LocalCut.build(shots: shots, soundFrom: sound, cloud: { try await api.mediaURL($0) })
                let file = try await LocalCut.export(built) { fraction in
                    Task { @MainActor in if sending != nil { sending = "Making the video \(Int(fraction * 100))%" } }
                }
                leftovers.append(file)
                let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                let seconds = try await built.asset.load(.duration).seconds

                sending = "Sending it"
                var put = URLRequest(url: try await api.startFinal(threadID, jobID: jobID, cutKey: cut.key, size: size))
                put.httpMethod = "PUT"
                put.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
                let (_, answer) = try await URLSession.shared.upload(for: put, fromFile: file)
                guard let http = answer as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    throw UploadError(message: "The video could not be sent.")
                }
                try await api.completeFinal(threadID, jobID: jobID, cutKey: cut.key, size: size, seconds: seconds, shots: shots)

                // The server's cut is now this one: nothing left to keep on the phone.
                CutEdits.clear(cut)
                edited = false
                fromOriginals = false
                player = nil
                reload()
            } catch {
                failed = error.localizedDescription
            }
        }
    }

    private func play() {
        loading = true
        failed = nil
        Task {
            defer { loading = false }
            do {
                let preview = try await api.mediaURL(cut.previewId)
                // With the originals on this phone, the cut is rebuilt from them at full quality; the
                // editor's own preview is the fallback (another phone, or a clip since deleted).
                // A cut changed in the phone's editor is always rebuilt, from the server's clips if need be.
                let local = LocalCut.canBuild(cut)
                if local || edited, let built = try? await LocalCut.build(cut, soundFrom: preview, cloud: { try await api.mediaURL($0) }) {
                    let item = AVPlayerItem(asset: built.asset)
                    item.videoComposition = built.video
                    let fresh = AVPlayer(playerItem: item)
                    player = fresh
                    fromOriginals = local
                    fresh.play()
                    return
                }
                let fresh = AVPlayer(url: preview)
                player = fresh
                fresh.play()
            } catch {
                failed = error.localizedDescription
            }
        }
    }
}

/// Under the latest cut: Approve, then when it posts.
private struct CutActions: View {
    let threadID: String
    let schedule: CutSchedule?
    let approvable: Bool
    let api: API
    let act: (@escaping () async throws -> Void) -> Void

    @State private var pickingTime = false
    @State private var when = Date().addingTimeInterval(3600)

    var body: some View {
        let id = threadID
        VStack(alignment: .leading, spacing: 8) {
            switch schedule?.stage {
            case "scheduled":
                Text("Scheduled\(schedule?.when.flatMap(Self.pretty).map { " for \($0)" } ?? "")").font(.subheadline.weight(.medium))
                Button("Unschedule") { act { try await api.unschedule(id) } }.buttonStyle(.bordered)
            case "posted":
                Label("Posted", systemImage: "checkmark.seal.fill").font(.subheadline.weight(.medium)).foregroundStyle(.green)
            case "approved":
                Text("Approved. When should it post?").font(.subheadline.weight(.medium))
                HStack {
                    Button("Now") { act { try await api.setSchedule(id, when: "now") } }
                    Button("Tonight") { act { try await api.setSchedule(id, when: "tonight") } }
                    Button("Pick a time") { pickingTime = true }
                }
                .buttonStyle(.bordered)
            default:
                if approvable {
                    Button {
                        act { try await api.approve(id) }
                    } label: {
                        Label("Approve", systemImage: "checkmark").font(.headline)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
                }
            }
        }
        .sheet(isPresented: $pickingTime) {
            NavigationStack {
                DatePicker("Post at", selection: $when, in: Date()...).datePickerStyle(.graphical).padding()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { pickingTime = false } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Schedule") {
                                pickingTime = false
                                let iso = ISO8601DateFormatter().string(from: when)
                                act { try await api.setSchedule(id, when: iso) }
                            }
                        }
                    }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private static func pretty(_ iso: String) -> String? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        return date?.formatted(date: .abbreviated, time: .shortened)
    }
}

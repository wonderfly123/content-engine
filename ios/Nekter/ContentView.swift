import Photos
import SwiftUI

/// Signed in: your chats. With only a texted link: that link's upload screen. Otherwise: sign in.
struct ContentView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var uploader: Uploader

    var body: some View {
        if auth.signedIn {
            ChatsView()
        } else if uploader.link != nil {
            UploadView()
        } else {
            SignInView()
        }
    }
}

/// Paste the link from the text (for someone adding clips without an account).
struct LinkEntryView: View {
    @EnvironmentObject private var uploader: Uploader
    @State private var text = ""
    @State private var invalid = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Spacer()
            Text("Nekter").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            Text("Add your clips").font(.largeTitle.bold())
            Text("Paste the link from the text we sent you.").foregroundStyle(.secondary)
            TextField("https://app.nekter.io/u/…", text: $text, axis: .vertical)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
            if invalid { Text("That doesn't look like an upload link.").font(.footnote).foregroundStyle(.red) }
            Button {
                if let pasted = UIPasteboard.general.string { text = pasted }
            } label: {
                Label("Paste", systemImage: "doc.on.clipboard").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            Button {
                invalid = !uploader.useLink(text)
            } label: {
                Text("Continue").font(.headline).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(.orange)
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Spacer()
            Spacer()
        }
        .padding(24)
    }
}

private struct UploadView: View {
    @EnvironmentObject private var uploader: Uploader
    @State private var picking = false
    @State private var description = ""
    @State private var seconds: Int?

    private let lengths: [(String, Int?)] = [("Editor's pick", nil), ("15s", 15), ("30s", 30), ("60s", 60)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Nekter").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                    Text("Add your clips").font(.largeTitle.bold())
                    Text("Pick them from your library. They keep uploading if you lock your phone.").foregroundStyle(.secondary)
                }

                if uploader.sentCount == 0 {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("What's this one about?").font(.subheadline.weight(.medium))
                        TextField("e.g. The cider stand we built for opening day. End on the sign.", text: $description, axis: .vertical)
                            .lineLimit(3...6)
                            .padding(12)
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                        Text("Length").font(.subheadline.weight(.medium)).padding(.top, 4)
                        HStack {
                            ForEach(lengths, id: \.0) { label, value in
                                Button(label) { seconds = value }
                                    .buttonStyle(.bordered)
                                    .tint(seconds == value ? .orange : .gray)
                            }
                        }
                    }
                }

                Button {
                    Task {
                        // Asked once. Without access the picker still works, just with an extra copy.
                        if PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined {
                            _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                        }
                        picking = true
                    }
                } label: {
                    Label(uploader.clips.isEmpty ? "Add clips" : "Add more clips", systemImage: "plus")
                        .font(.title3.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)

                ForEach(uploader.clips) { clip in ClipRow(clip: clip) }

                if uploader.unsent > 0 && !uploader.busy {
                    Button {
                        Task { await uploader.send(description: description, seconds: seconds) }
                    } label: {
                        HStack {
                            if uploader.sending { ProgressView().tint(.white) }
                            Text("Send \(uploader.unsent) \(uploader.unsent == 1 ? "clip" : "clips") to the editor").font(.headline)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.primary)
                    .disabled(uploader.sending)
                }
                if let error = uploader.sendError { Text(error).font(.footnote).foregroundStyle(.red) }

                if uploader.sentCount > 0 && uploader.unsent == 0 && !uploader.busy {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sent to the editor.").font(.headline)
                        Text("We'll text you what we're making, then again when the first cut is ready.").font(.subheadline)
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.green.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
                }

                Button("Use another link") { uploader.forgetLink() }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $picking) {
            ClipPicker { picked in uploader.add(picked) }.ignoresSafeArea()
        }
    }
}

struct ClipRow: View {
    @EnvironmentObject private var uploader: Uploader
    let clip: Uploader.Clip

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(clip.name).font(.subheadline.weight(.medium)).lineLimit(1)
                    Text(status).font(.caption).foregroundStyle(isFailed ? .red : .secondary)
                }
                Spacer()
                switch clip.stage {
                case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                case .failed:
                    Button { uploader.retry(clip.id) } label: { Image(systemName: "arrow.clockwise") }
                    Button { uploader.remove(clip.id) } label: { Image(systemName: "xmark") }.foregroundStyle(.secondary)
                case .waiting: Button { uploader.remove(clip.id) } label: { Image(systemName: "xmark") }.foregroundStyle(.secondary)
                default: EmptyView()
                }
            }
            if showsBar { ProgressView(value: min(1, max(0, clip.fraction))).tint(.orange) }
        }
        .padding(12)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    private var isFailed: Bool { if case .failed = clip.stage { return true }; return false }
    private var showsBar: Bool {
        switch clip.stage {
        case .preparing, .uploading: return true
        default: return false
        }
    }
    private var size: String { ByteCountFormatter.string(fromByteCount: Int64(clip.size), countStyle: .file) }
    private var status: String {
        switch clip.stage {
        case .waiting: return "Waiting"
        case .preparing(let what): return "\(what)… \(Int(clip.fraction * 100))%"
        case .uploading: return "Uploading \(Int(clip.fraction * 100))% of \(size)"
        case .done: return "Uploaded · \(size)"
        case .failed(let why): return why
        }
    }
}

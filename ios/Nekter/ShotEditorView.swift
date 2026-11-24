import AVKit
import SwiftUI

/// The small editor: the cut's shots in order, each one trimmable, removable and movable, with the
/// result playing above. Changes stay on the phone until the cut is exported.
struct ShotEditorView: View {
    let cut: Cut
    let api: API
    let onDone: () -> Void

    struct Row: Identifiable, Equatable {
        let id = UUID()
        var shot: Cut.Shot
    }

    @Environment(\.dismiss) private var dismiss
    @State private var rows: [Row] = []
    @State private var player = AVPlayer()
    @State private var building = false
    @State private var error: String?
    @State private var preview: URL?
    @State private var rebuild: Task<Void, Never>?

    private static let step = 0.1
    private static let shortest = 0.2

    private var total: Double { rows.reduce(0) { $0 + $1.shot.dur / $1.shot.speed } }
    private var talks: Bool { rows.contains { $0.shot.sound == true } }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ZStack {
                    Color.black
                    VideoPlayer(player: player)
                    if building { ProgressView().tint(.white) }
                }
                .aspectRatio(9.0 / 16.0, contentMode: .fit)
                .frame(maxHeight: 320)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.vertical, 8)

                HStack {
                    Text("\(rows.count) \(rows.count == 1 ? "shot" : "shots") · \(String(format: "%.1f", total))s").font(.subheadline.weight(.medium))
                    Spacer()
                    EditButton()
                }
                .padding(.horizontal, 16)
                if talks {
                    Text("This cut has someone talking. Trimming can put the sound out of step for now.")
                        .font(.caption).foregroundStyle(.orange).padding(.horizontal, 16).frame(maxWidth: .infinity, alignment: .leading)
                }
                if let error { Text(error).font(.caption).foregroundStyle(.red).padding(.horizontal, 16) }

                List {
                    ForEach($rows) { $row in
                        ShotRow(number: (rows.firstIndex(of: row) ?? 0) + 1, shot: $row.shot, api: api, step: Self.step, shortest: Self.shortest)
                    }
                    .onMove { rows.move(fromOffsets: $0, toOffset: $1) }
                    .onDelete { rows.remove(atOffsets: $0) }
                }
                .listStyle(.plain)
            }
            .navigationTitle("Edit shots")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Reset") {
                        CutEdits.clear(cut)
                        rows = (cut.shots ?? []).map { Row(shot: $0) }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let shots = rows.map(\.shot)
                        if shots == (cut.shots ?? []) { CutEdits.clear(cut) } else { CutEdits.save(shots, for: cut) }
                        onDone()
                        dismiss()
                    }
                    .disabled(rows.isEmpty)
                }
            }
            .task {
                rows = (CutEdits.shots(for: cut) ?? cut.shots ?? []).map { Row(shot: $0) }
                preview = try? await api.mediaURL(cut.previewId)
                refresh()
            }
            .onChange(of: rows) { refresh() }
            .onDisappear { player.pause() }
        }
    }

    /// Rebuilds the picture a moment after the last change, so dragging a control does not rebuild on every tick.
    private func refresh() {
        rebuild?.cancel()
        let shots = rows.map(\.shot)
        guard !shots.isEmpty else { player.replaceCurrentItem(with: nil); return }
        rebuild = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            building = true
            defer { building = false }
            do {
                let built = try await LocalCut.build(shots: shots, soundFrom: preview, cloud: { try await api.mediaURL($0) })
                guard !Task.isCancelled else { return }
                let item = AVPlayerItem(asset: built.asset)
                item.videoComposition = built.video
                player.replaceCurrentItem(with: item)
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// One shot: a frame from where it starts, and controls for where it starts and how long it runs.
private struct ShotRow: View {
    let number: Int
    @Binding var shot: Cut.Shot
    let api: API
    let step: Double
    let shortest: Double
    @State private var frame: UIImage?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8).fill(.quaternary)
                if let frame { Image(uiImage: frame).resizable().scaledToFill() }
            }
            .frame(width: 54, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 6) {
                Text("Shot \(number) · \(String(format: "%.1f", shot.dur / shot.speed))s\(shot.speed == 1 ? "" : " · \(String(format: "%g", shot.speed))x")")
                    .font(.subheadline.weight(.medium))
                Nudge(label: "Starts at", value: String(format: "%.1fs", shot.in)) {
                    shot.in = max(0, shot.in - step)
                } more: {
                    shot.in += step
                }
                Nudge(label: "Uses", value: String(format: "%.1fs of the clip", shot.dur)) {
                    shot.dur = max(shortest * shot.speed, shot.dur - step * shot.speed)
                } more: {
                    shot.dur += step * shot.speed
                }
            }
        }
        .padding(.vertical, 4)
        .task(id: "\(shot.mediaId)-\(Int(shot.in * 10))") { await loadFrame() }
    }

    private func loadFrame() async {
        guard let asset = try? await LocalCut.source(shot.mediaId, cloud: { try await api.mediaURL($0) }) else { return }
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 216, height: 384)
        if let image = try? await generator.image(at: CMTime(seconds: shot.in, preferredTimescale: 600)).image {
            frame = UIImage(cgImage: image)
        }
    }
}

/// A value with a minus and a plus beside it.
private struct Nudge: View {
    let label: String
    let value: String
    let less: () -> Void
    let more: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: 56, alignment: .leading)
            Button(action: less) { Image(systemName: "minus.circle.fill") }.buttonStyle(.borderless)
            Text(value).font(.caption.monospacedDigit()).frame(minWidth: 96, alignment: .center)
            Button(action: more) { Image(systemName: "plus.circle.fill") }.buttonStyle(.borderless)
        }
        .font(.title3)
        .tint(.orange)
    }
}

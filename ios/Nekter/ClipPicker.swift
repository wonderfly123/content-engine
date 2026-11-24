import Photos
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The system video picker. With library access a pick is just an id, so the clip is read straight
/// from the library (iCloud download with progress, no extra copy). Without it, the picker hands
/// over a file, which is copied into the app.
struct ClipPicker: UIViewControllerRepresentable {
    let onPicked: ([(Uploader.Source, String)]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPicked: onPicked) }

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .videos
        config.selectionLimit = 0
        config.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: PHPickerViewController, context: Context) {}

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onPicked: ([(Uploader.Source, String)]) -> Void
        init(onPicked: @escaping ([(Uploader.Source, String)]) -> Void) { self.onPicked = onPicked }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            let canRead = status == .authorized || status == .limited
            Task { @MainActor in
                var picked: [(Uploader.Source, String)] = []
                for result in results {
                    let name = result.itemProvider.suggestedName ?? "clip"
                    if canRead, let id = result.assetIdentifier, PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).count > 0 {
                        picked.append((.asset(id), name))
                    } else if let file = await Self.copy(result.itemProvider) {
                        picked.append((.file(file, name: name), name))
                    }
                }
                onPicked(picked)
            }
        }

        /// The picker's file only lives inside the callback, so it is copied before returning.
        private static func copy(_ provider: NSItemProvider) async -> URL? {
            await withCheckedContinuation { continuation in
                provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, _ in
                    guard let url else { return continuation.resume(returning: nil) }
                    let kept = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).\(url.pathExtension.isEmpty ? "mov" : url.pathExtension)")
                    do {
                        try FileManager.default.copyItem(at: url, to: kept)
                        continuation.resume(returning: kept)
                    } catch {
                        continuation.resume(returning: nil)
                    }
                }
            }
        }
    }
}

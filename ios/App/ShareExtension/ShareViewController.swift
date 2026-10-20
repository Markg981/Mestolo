import UIKit
import UniformTypeIdentifiers

/// UI-less Share Extension: reads the shared URL / text / image, hands an image over through the
/// App Group container, then opens the main app with `mestolo://share?url=...&text=...`.
/// The app routes that link to the import flow (src/lib/import/share-url.ts).
class ShareViewController: UIViewController {
    private let appGroup = "group.com.markg981.mestolo"

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await handle() }
    }

    private func handle() async {
        var items: [URLQueryItem] = []
        let providers = (extensionContext?.inputItems as? [NSExtensionItem])?.flatMap { $0.attachments ?? [] } ?? []

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
               !url.isFileURL {
                items.append(URLQueryItem(name: "url", value: url.absoluteString))
                break
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                      let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                items.append(URLQueryItem(name: "text", value: String(text.prefix(8000))))
                break
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
                      let name = await saveImage(provider) {
                // Image hand-over: file in the App Group container. The app does not consume it yet
                // (documented follow-up in docs/ios-share-extension.md).
                items.append(URLQueryItem(name: "image", value: name))
                break
            }
        }

        var components = URLComponents()
        components.scheme = "mestolo"
        components.host = "share"
        components.queryItems = items.isEmpty ? nil : items
        if let url = components.url { openHostApp(url) }
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func saveImage(_ provider: NSItemProvider) async -> String? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        let dir = container.appendingPathComponent("shared", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let item = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) else { return nil }
        var data: Data?
        if let url = item as? URL { data = try? Data(contentsOf: url) }
        else if let image = item as? UIImage { data = image.jpegData(compressionQuality: 0.85) }
        else if let raw = item as? Data { data = raw }
        guard let data else { return nil }
        let name = "\(UUID().uuidString).jpg"
        do { try data.write(to: dir.appendingPathComponent(name)) } catch { return nil }
        return name
    }

    /// Share extensions cannot call UIApplication.shared; walk the responder chain to reach it.
    private func openHostApp(_ url: URL) {
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let r = responder {
            if r.responds(to: selector) && r !== self {
                _ = r.perform(selector, with: url)
                return
            }
            responder = r.next
        }
    }
}

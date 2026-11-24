import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var enteringLink = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Spacer()
            Text("Nekter").font(.largeTitle.bold())
            Text("Send clips, get edits back, approve and schedule them.").foregroundStyle(.secondary)
            Spacer()
            Button {
                auth.signInWithGoogle()
            } label: {
                HStack {
                    if auth.busy { ProgressView().tint(.white) }
                    Text("Continue with Google").font(.headline)
                }
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
            .disabled(auth.busy)
            if let error = auth.error { Text(error).font(.footnote).foregroundStyle(.red) }
            Button("I have an upload link") { enteringLink = true }
                .font(.subheadline)
                .frame(maxWidth: .infinity)
                .padding(.top, 4)
        }
        .padding(24)
        .sheet(isPresented: $enteringLink) { LinkEntryView() }
    }
}

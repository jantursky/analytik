import AppKit
import MenubarCore
import SwiftUI

struct ConnectScreen: View {
  let model: AppModel
  @Environment(\.palette) private var p
  @State private var pasted = ""
  @State private var server = ""
  @State private var site = ""
  @State private var token = ""
  @State private var name = ""
  @State private var dashboard = ""
  @State private var serverIsGuess = false
  @State private var clipboardLink: ConnectionLink?
  @State private var result: Result?

  enum Result: Equatable {
    case testing
    case ok(String)
    case failed(String)
  }

  private var credentials: Credentials? { Connection.credentials(serverURL: server, siteId: site, token: token) }

  var body: some View {
    VStack(spacing: 0) {
      ScreenHeader(title: "Connect a site", back: model.list.isEmpty ? nil : { model.screen = .stats })
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          intro
          linkGroup
          detailsGroup
          resultLine
          actions
        }
        .padding(16)
      }
    }
    .onAppear(perform: load)
  }

  // MARK: Parts

  private var intro: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("Read-only access with a share link").font(Typeface.ui(14, .bold))
      Text("In the dashboard open Settings → Sharing, create a link for the Overview and Live views, and copy the Mac app link. Paste it below and everything fills in.")
        .font(Typeface.ui(13)).foregroundStyle(p.textMuted).fixedSize(horizontal: false, vertical: true)
    }
  }

  private var linkGroup: some View {
    SettingsGroup(title: "Mac app link") {
      VStack(alignment: .leading, spacing: 10) {
        if let clipboardLink, pasted.isEmpty { clipboardBanner(clipboardLink) }
        TextField("analytik://connect?… or analytik-sites:…", text: $pasted)
          .field(mono: true)
          .onChange(of: pasted) { _, text in
            if SiteBundle.decode(text) != nil { model.importSites(text) } else if let link = ConnectionLink.parse(text) { apply(link) }
          }
      }
      .padding(12)
    }
  }

  private var detailsGroup: some View {
    SettingsGroup(
      title: "Details",
      footer: serverIsGuess ? "The server was guessed from the dashboard address. Check that your Analytik routes are mounted there." : nil
    ) {
      VStack(alignment: .leading, spacing: 12) {
        labeled("Server URL") { TextField("https://example.com/api/analytik", text: $server).field(mono: true) }
        labeled("Site id") { TextField("site_…", text: $site).field(mono: true) }
        labeled("Share link token") { SecureField("Token", text: $token).field(mono: true) }
        labeled("Name (optional)") { TextField("My shop", text: $name).field() }
        labeled("Dashboard address (optional)") { TextField("https://example.com/", text: $dashboard).field(mono: true) }
      }
      .padding(12)
    }
  }

  private var actions: some View {
    HStack {
      AppButton(title: "Test connection") { Task { await test() } }
        .disabled(credentials == nil || result == .testing)
      Spacer()
      AppButton(title: "Connect", variant: .primary) { save() }
        .disabled(credentials == nil)
    }
  }

  private func clipboardBanner(_ link: ConnectionLink) -> some View {
    HStack(spacing: 8) {
      Image(systemName: "doc.on.clipboard").foregroundStyle(p.accentText)
      Text("Link on the clipboard\(link.name.map { ": \($0)" } ?? "")").font(Typeface.ui(13, .medium)).lineLimit(1)
      Spacer(minLength: 8)
      AppButton(title: "Use it", variant: .primary, compact: true) { apply(link) }
    }
    .padding(10)
    .background(p.accentSoft, in: RoundedRectangle(cornerRadius: Layout.radiusControl))
  }

  private func labeled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(Typeface.ui(13, .semibold))
      content()
    }
  }

  @ViewBuilder private var resultLine: some View {
    switch result {
    case .testing:
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text("Testing…").font(Typeface.ui(13)).foregroundStyle(p.textMuted)
      }
    case .ok(let siteName):
      status("Connected to \(siteName)", symbol: "checkmark.circle.fill", color: p.successText, background: p.successSoft)
    case .failed(let text):
      status(text, symbol: "exclamationmark.triangle.fill", color: p.danger, background: p.dangerSoft)
    case nil:
      EmptyView()
    }
  }

  private func status(_ text: String, symbol: String, color: Color, background: Color) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: symbol).foregroundStyle(color)
      Text(text).font(Typeface.ui(13)).foregroundStyle(p.text).fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 0)
    }
    .padding(12)
    .background(background, in: RoundedRectangle(cornerRadius: Layout.radiusControl))
    .transition(.opacity)
  }

  // MARK: Actions

  /// A link that came in by address, or is on the clipboard now.
  private func load() {
    if let link = model.prefill {
      apply(link)
      model.prefill = nil
    } else if let text = NSPasteboard.general.string(forType: .string) {
      clipboardLink = ConnectionLink.parse(text)
    }
  }

  private func apply(_ link: ConnectionLink) {
    server = link.serverURL
    serverIsGuess = link.serverIsGuess
    site = link.siteId
    token = link.token
    if let linkName = link.name, name.isEmpty { name = linkName }
    dashboard = link.dashboardURL ?? dashboard
    result = nil
    clipboardLink = nil
  }

  private func test() async {
    guard let credentials else { return }
    withAnimation(Motion.hover) { result = .testing }
    do {
      let snapshot = try await StatsClient(credentials: credentials).fetch()
      withAnimation(Motion.hover) { result = .ok(snapshot.siteName) }
      if name.isEmpty { name = snapshot.siteName }
    } catch {
      withAnimation(Motion.hover) { result = .failed(Format.message(error as? StatsError ?? .malformed)) }
    }
  }

  private func save() {
    guard let credentials else { return }
    let label = name.trimmingCharacters(in: .whitespaces)
    let connection = Connection(
      name: label.isEmpty ? credentials.siteId : label, serverURL: credentials.baseURL.absoluteString, siteId: credentials.siteId,
      dashboardURL: dashboard.trimmingCharacters(in: .whitespaces).isEmpty ? nil : dashboard.trimmingCharacters(in: .whitespaces))
    if !model.add(connection, token: credentials.token) {
      result = .failed("The Keychain refused to store the token.")
    }
  }
}

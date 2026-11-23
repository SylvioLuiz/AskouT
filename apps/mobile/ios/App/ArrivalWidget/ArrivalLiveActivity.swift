import ActivityKit
import SwiftUI
import WidgetKit

/// Extensão de widget do AskouT: só a Live Activity da chegada ao vivo do NOW.
@main
struct ArrivalWidgetBundle: WidgetBundle {
    var body: some Widget {
        ArrivalLiveActivity()
    }
}

/// Cores do site (askout.com.br): fundo escuro translúcido, texto claro e a barra em degradê.
private enum Brand {
    static let ink = Color(red: 0.969, green: 0.953, blue: 1.0)
    static let muted = Color(red: 0.710, green: 0.678, blue: 0.812)
    static let card = Color(red: 20 / 255, green: 16 / 255, blue: 34 / 255)
    static let track = Color.white.opacity(0.1)
    static let pink = Color(red: 1.0, green: 0.310, blue: 0.690)
    static let violet = Color(red: 0.639, green: 0.361, blue: 1.0)
    static let gradient = LinearGradient(
        stops: [
            .init(color: Color(red: 1.0, green: 0.769, blue: 0.541), location: 0),
            .init(color: Color(red: 1.0, green: 0.435, blue: 0.569), location: 0.30),
            .init(color: pink, location: 0.55),
            .init(color: violet, location: 0.80),
            .init(color: Color(red: 0.353, green: 0.784, blue: 1.0), location: 1),
        ],
        startPoint: .leading,
        endPoint: .trailing
    )
}

@available(iOS 16.1, *)
struct ArrivalLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ArrivalAttributes.self) { context in
            ArrivalCard(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Brand.card.opacity(0.85))
                .activitySystemActionForegroundColor(Brand.ink)
                .widgetURL(link(context.attributes))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Initial(name: context.attributes.name, size: 40)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.arrived ? "✓" : "\(percent(context.state.progress))%")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Brand.muted)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.title)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Brand.ink)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(context.state.body)
                            .font(.caption)
                            .foregroundStyle(Brand.muted)
                            .lineLimit(2)
                        ArrivalBar(progress: context.state.progress, arrived: context.state.arrived)
                    }
                }
            } compactLeading: {
                Initial(name: context.attributes.name, size: 22)
            } compactTrailing: {
                ProgressRing(progress: context.state.progress)
                    .frame(width: 18, height: 18)
            } minimal: {
                ProgressRing(progress: context.state.progress)
                    .frame(width: 18, height: 18)
            }
            .widgetURL(link(context.attributes))
        }
    }

    private func link(_ attributes: ArrivalAttributes) -> URL? {
        URL(string: "br.com.askout:/" + attributes.url)
    }
}

private func percent(_ progress: Double) -> Int {
    Int((min(1, max(0, progress)) * 100).rounded())
}

/// O cartão da tela bloqueada, igual ao exemplo do site: "AskouT · agora", foto (inicial), título, texto e a barra.
@available(iOS 16.1, *)
private struct ArrivalCard: View {
    let attributes: ArrivalAttributes
    let state: ArrivalAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("ASKOUT")
                Spacer()
                Text("agora")
            }
            .font(.system(size: 11, weight: .bold))
            .tracking(0.9)
            .foregroundStyle(Brand.muted)

            HStack(spacing: 10) {
                Initial(name: attributes.name, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.title)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Brand.ink)
                        .lineLimit(1)
                    Text(state.body)
                        .font(.system(size: 13))
                        .foregroundStyle(Brand.muted)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
            }

            ArrivalBar(progress: state.progress, arrived: state.arrived)
                .padding(.top, 2)
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 14)
    }
}

/// Barra de 6 pt em degradê; começa com um pedaço visível (10%) e brilha em rosa na chegada, como no site.
private struct ArrivalBar: View {
    let progress: Double
    let arrived: Bool

    var body: some View {
        GeometryReader { geo in
            let filled = arrived ? 1 : 0.1 + 0.9 * min(1, max(0, progress))
            ZStack(alignment: .leading) {
                Capsule().fill(Brand.track)
                Capsule()
                    .fill(Brand.gradient)
                    .frame(width: geo.size.width * filled)
                    .shadow(color: arrived ? Brand.pink.opacity(0.8) : .clear, radius: 7)
            }
        }
        .frame(height: 6)
    }
}

/// Círculo com a inicial de quem chega, no degradê da marca (a Live Activity não baixa fotos da internet).
private struct Initial: View {
    let name: String
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Brand.pink, Brand.violet], startPoint: .topLeading, endPoint: .bottomTrailing))
            Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                .font(.system(size: size * 0.45, weight: .heavy))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

/// Anel de progresso para a Dynamic Island compacta.
private struct ProgressRing: View {
    let progress: Double

    var body: some View {
        ZStack {
            Circle().stroke(Brand.track, lineWidth: 3)
            Circle()
                .trim(from: 0, to: max(0.05, min(1, progress)))
                .stroke(Brand.gradient, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
    }
}

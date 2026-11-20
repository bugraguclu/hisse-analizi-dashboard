import SwiftUI

/// Financial color tokens shared by the iOS companion app and WidgetKit extensions.
enum WidgetPalette {
    static let brand = Color(red: 0.106, green: 0.310, blue: 0.494)
    static let positive = Color(red: 0.086, green: 0.639, blue: 0.290)
    static let negative = Color(red: 0.863, green: 0.149, blue: 0.149)
    static let neutral = Color.secondary

    static func changeColor(_ value: Double?) -> Color {
        guard let value, value.isFinite else { return neutral }
        if value > 0 { return positive }
        if value < 0 { return negative }
        return neutral
    }
}

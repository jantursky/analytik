import Foundation

@testable import MenubarCore

/// Recorded shapes of the three routes (with the extra fields the server sends, which the app must ignore).
enum Fixtures {
  static let shared = """
    {"site":{"id":"site_a","name":"Shop","domain":"shop.test","timezone":"Europe/Bratislava","currency":"EUR","privacyMode":"strict","createdAt":1},"views":["overview","realtime"]}
    """
  static let overview = """
    {"visitors":{"value":120,"previous":100,"change":0.2},"sessions":{"value":130,"previous":110,"change":0.18},
     "pageviews":{"value":400,"previous":0,"change":null},"bounceRate":{"value":0.4,"previous":0.5,"change":-0.2},
     "avgDurationMs":{"value":1000,"previous":900,"change":0.1},"revenue":{"value":12345,"previous":10000,"change":0.2345},
     "orders":{"value":3,"previous":2,"change":0.5},"conversionRate":{"value":0.02,"previous":0.01,"change":1},
     "revenuePerVisitor":{"value":100,"previous":90,"change":0.1},"currency":"EUR","online":4,"otherCurrencies":[],"future":true}
    """
  static let realtime = """
    {"online":7,"recent":[],"locations":[]}
    """
  static let breakdown = """
    [{"key":"/","visitors":80,"sessions":90,"pageviews":150,"revenue":0,"orders":0,"conversionRate":0},
     {"key":"/pricing","visitors":30,"sessions":30,"pageviews":40,"revenue":0,"orders":0,"conversionRate":0}]
    """

  static let credentials = Credentials(
    baseURL: URL(string: "https://stats.example.com/api/analytik")!, siteId: "site_a", token: "t0ken-t0ken-t0ken-t0ken-1")

  static let snapshot = Snapshot(
    siteName: "Shop",
    overview: Overview(
      visitors: Delta(value: 1, previous: 1, change: 0), pageviews: Delta(value: 1, previous: 1, change: 0),
      revenue: Delta(value: 0, previous: 0, change: nil), currency: "EUR", online: 2),
    online: 2, topPages: [], fetchedAt: Date(timeIntervalSince1970: 1_000))
}

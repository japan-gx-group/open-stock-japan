// ロゴのワードマーク用: フォントファイルから文字列のアウトライン（SVG の path データ）を取り出す（macOS 専用）。
// 使い方: swift scripts/brand/outline-text.swift <フォントファイル> <文字列> <ウェイト> <サイズ> <字間>
//   例: swift scripts/brand/outline-text.swift InstrumentSans.woff2 "OpenStock" 650 100 -1.8
// 出力は JSON（d = path データ。ベースラインが y = 0、幅・キャップハイトなどの寸法つき）。
// いまのロゴの寸法と組み方は docs/brand.md を参照。
import Foundation
import CoreText
import CoreGraphics

let args = CommandLine.arguments
guard args.count >= 6 else { FileHandle.standardError.write("usage\n".data(using: .utf8)!); exit(2) }
let data = try! Data(contentsOf: URL(fileURLWithPath: args[1])) as CFData
guard let descriptors = CTFontManagerCreateFontDescriptorsFromData(data) as? [CTFontDescriptor], let base = descriptors.first else {
  FileHandle.standardError.write("font could not be loaded\n".data(using: .utf8)!); exit(1)
}
let text = args[2]
let weight = Double(args[3])!
let size = CGFloat(Double(args[4])!)
let tracking = CGFloat(Double(args[5])!)

let wghtAxis = NSNumber(value: 0x77676874) // 'wght'
let descriptor = CTFontDescriptorCreateCopyWithAttributes(base, [kCTFontVariationAttribute: [wghtAxis: NSNumber(value: weight)]] as CFDictionary)
let font = CTFontCreateWithFontDescriptor(descriptor, size, nil)

let attributes: [NSAttributedString.Key: Any] = [
  NSAttributedString.Key(kCTFontAttributeName as String): font,
  NSAttributedString.Key(kCTKernAttributeName as String): tracking,
]
let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
func f(_ v: CGFloat) -> String { String(format: "%.2f", Double(v)).replacingOccurrences(of: "-0.00", with: "0.00") }

var d = ""
for run in CTLineGetGlyphRuns(line) as! [CTRun] {
  let count = CTRunGetGlyphCount(run)
  var glyphs = [CGGlyph](repeating: 0, count: count)
  var positions = [CGPoint](repeating: .zero, count: count)
  CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
  CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
  let runFont = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName as String] as! CTFont
  for i in 0..<count {
    guard let path = CTFontCreatePathForGlyph(runFont, glyphs[i], nil) else { continue }
    let ox = positions[i].x
    path.applyWithBlock { pointer in
      let element = pointer.pointee
      let p = element.points
      // フォントの座標は上が正。SVG は下が正なので y を反転する（ベースラインが y = 0）
      switch element.type {
      case .moveToPoint: d += "M\(f(p[0].x + ox)) \(f(-p[0].y))"
      case .addLineToPoint: d += "L\(f(p[0].x + ox)) \(f(-p[0].y))"
      case .addQuadCurveToPoint: d += "Q\(f(p[0].x + ox)) \(f(-p[0].y)) \(f(p[1].x + ox)) \(f(-p[1].y))"
      case .addCurveToPoint: d += "C\(f(p[0].x + ox)) \(f(-p[0].y)) \(f(p[1].x + ox)) \(f(-p[1].y)) \(f(p[2].x + ox)) \(f(-p[2].y))"
      case .closeSubpath: d += "Z"
      @unknown default: break
      }
    }
  }
}
let width = CTLineGetTypographicBounds(line, nil, nil, nil)
let info: [String: Any] = [
  "d": d, "width": Double(width), "capHeight": Double(CTFontGetCapHeight(font)), "xHeight": Double(CTFontGetXHeight(font)),
  "ascent": Double(CTFontGetAscent(font)), "descent": Double(CTFontGetDescent(font)),
  "family": CTFontCopyFamilyName(font) as String, "variation": (CTFontCopyVariation(font) as NSDictionary?)?.description ?? "none",
]
let json = try! JSONSerialization.data(withJSONObject: info, options: [.sortedKeys])
print(String(data: json, encoding: .utf8)!)

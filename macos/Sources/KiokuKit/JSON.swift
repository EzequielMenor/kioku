import Foundation

/// Valor JSON tolerante: el daemon es la fuente de verdad y aquí solo se lee lo que hace falta, sin fallar por un
/// campo nuevo o ausente.
public enum JSON: Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    public init(any value: Any?) {
        switch value {
        case nil, is NSNull: self = .null
        case let s as String: self = .string(s)
        case let n as NSNumber:
            // JSONSerialization entrega booleanos y números como NSNumber: se distinguen por el tipo CF.
            self = CFGetTypeID(n) == CFBooleanGetTypeID() ? .bool(n.boolValue) : .number(n.doubleValue)
        case let a as [Any]: self = .array(a.map { JSON(any: $0) })
        case let o as [String: Any]: self = .object(o.mapValues { JSON(any: $0) })
        default: self = .null
        }
    }

    public static func parse(_ data: Data) -> JSON? {
        guard !data.isEmpty, let any = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return nil }
        return JSON(any: any)
    }

    public static func parse(_ text: String) -> JSON? { parse(Data(text.utf8)) }

    public subscript(key: String) -> JSON {
        if case .object(let o) = self { return o[key] ?? .null }
        return .null
    }

    public subscript(index: Int) -> JSON {
        if case .array(let a) = self, index >= 0, index < a.count { return a[index] }
        return .null
    }

    public var string: String? { if case .string(let s) = self { return s }; return nil }
    public var double: Double? { if case .number(let n) = self { return n }; return nil }
    public var int: Int? { double.map { Int($0) } }
    public var bool: Bool { if case .bool(let b) = self { return b }; return false }
    public var array: [JSON] { if case .array(let a) = self { return a }; return [] }
    public var object: [String: JSON]? { if case .object(let o) = self { return o }; return nil }
    public var isNull: Bool { self == .null }

    /// Representación para `JSONSerialization` (cuerpos de peticiones).
    public var any: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return b
        case .number(let n): return n
        case .string(let s): return s
        case .array(let a): return a.map { $0.any }
        case .object(let o): return o.mapValues { $0.any }
        }
    }

    /// Texto JSON compacto (para mostrar valores de propiedades).
    public var compact: String {
        switch self {
        case .string(let s):
            let data = (try? JSONSerialization.data(withJSONObject: [s], options: [.fragmentsAllowed])) ?? Data()
            let text = String(decoding: data, as: UTF8.self)
            return String(text.dropFirst().dropLast())
        case .number(let n): return n == n.rounded() && abs(n) < 1e15 ? String(Int(n)) : String(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        default:
            let data = (try? JSONSerialization.data(withJSONObject: any, options: [.sortedKeys])) ?? Data()
            return String(decoding: data, as: UTF8.self)
        }
    }
}

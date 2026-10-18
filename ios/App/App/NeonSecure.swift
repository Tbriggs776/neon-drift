import Foundation
import Capacitor
import Security
import LocalAuthentication

/* The sign-in kept in the device's Keychain, and Face ID in front of it.
   Ported from the Razzle Dazzle app (RazzleSecure.swift), same account and team.

   WHY: Supabase keeps the session in the web view's localStorage, and WebKit writes
   localStorage to disk lazily: the app killed just after supabase-js has rotated the refresh
   token can come back holding the OLD token, which the server refuses as already used, and the
   pilot is signed out. The Keychain is written at once, survives a relaunch, and is this app's
   alone.

   KeychainItem: one generic password per key, service "com.tylerbriggs.neondrift.auth",
   readable after the device's first unlock since boot and never copied to another device
   (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly) -- so a background token refresh can still
   read it, and a backup restored elsewhere does not carry the session.

   Face ID: LAPolicy.deviceOwnerAuthentication, so a device without Face ID or Touch ID, or a
   face that is not read, falls back to the device passcode rather than locking anyone out.
   The page decides WHEN to ask (src/appLock.js). */

private let service = "com.tylerbriggs.neondrift.auth"

private func query(_ key: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: service,
     kSecAttrAccount as String: key]
}

public class NeonSecurePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NeonSecurePlugin"
    public let jsName = "NeonSecure"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
    ]

    @objc func getItem(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("key is required"); return }
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecSuccess, let data = out as? Data, let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
        } else {
            call.reject("Keychain read failed (\(status))")
        }
    }

    @objc func setItem(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("key and value are required"); return
        }
        let data = Data(value.utf8)
        let update: [String: Any] = [kSecValueData as String: data]
        var status = SecItemUpdate(query(key) as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query(key)
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        status == errSecSuccess ? call.resolve() : call.reject("Keychain write failed (\(status))")
    }

    @objc func removeItem(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("key is required"); return }
        let status = SecItemDelete(query(key) as CFDictionary)
        status == errSecSuccess || status == errSecItemNotFound ? call.resolve() : call.reject("Keychain delete failed (\(status))")
    }

    /// { available, kind: "faceID" | "touchID" | "opticID" | "passcode" | "none" }
    @objc func biometry(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var error: NSError?
        let can = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        var kind = "none"
        if can {
            switch ctx.biometryType {
            case .faceID: kind = "faceID"
            case .touchID: kind = "touchID"
            default:
                if #available(iOS 17.0, *), ctx.biometryType == .opticID { kind = "opticID" } else { kind = "passcode" }
            }
        }
        call.resolve(["available": can, "kind": kind])
    }

    /// Resolves { ok: true } or { ok: false, reason }.
    @objc func authenticate(_ call: CAPPluginCall) {
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Not now"
        let reason = call.getString("reason") ?? "Unlock Neon Drift"
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in
            DispatchQueue.main.async {
                call.resolve(ok ? ["ok": true] : ["ok": false, "reason": error?.localizedDescription ?? "Not unlocked"])
            }
        }
    }
}

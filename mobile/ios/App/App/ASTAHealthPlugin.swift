import Capacitor
import HealthKit
import Security
import UIKit

// Health reads stay native, including when the WebView is suspended.
// Only competition totals leave the device; no raw samples or unrelated health types.
@MainActor final class ASTAHealthStore {
    static let shared = ASTAHealthStore()
    private let store = HKHealthStore()
    private let steps = HKObjectType.quantityType(forIdentifier: .stepCount)!
    private var observer: HKObserverQuery?
    private var token: String?
    private var owner: String?
    private var enabled = false
    private var epoch = UUID()
    private var running: Task<Void, Never>?
    private var lastSynced: String?
    private var message: String?
    private var today: Int?
    private let base = "https://lightsteelblue-giraffe-860469.hostingersite.com"
    private let service = "com.asta.health-session"
    private let iso = ISO8601DateFormatter()
    private init() {
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var result: CFTypeRef?
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecReturnData as String:true]
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data, let saved = try? JSONSerialization.jsonObject(with:data) as? [String:Any] {
            token = saved["token"] as? String; owner = saved["owner"] as? String
            enabled = saved["enabled"] as? Bool ?? false; lastSynced = saved["lastSynced"] as? String
        }
        if enabled { observe() }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object:nil, queue:.main) { _ in
            Task { @MainActor in await ASTAHealthStore.shared.sync() }
        }
    }
    private func persist() {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service]
        SecItemDelete(query as CFDictionary)
        guard let token = token, let owner = owner else { return }
        var saved: [String:Any] = ["token":token,"owner":owner,"enabled":enabled]
        saved["lastSynced"] = lastSynced
        guard let data = try? JSONSerialization.data(withJSONObject:saved) else { return }
        var item = query; item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary,nil)
    }
    func setSession(_ next: String?, owner nextOwner: String?) {
        if owner != nextOwner {
            epoch = UUID(); running?.cancel(); running = nil
            enabled = false; today = nil; lastSynced = nil; message = nil
            if let observer = observer { store.stop(observer); self.observer = nil }
            store.disableBackgroundDelivery(for:steps) { _,_ in }
        }
        token = next; owner = nextOwner; persist()
        if enabled { observe(); Task { await sync() } }
        publish()
    }
    func connect() async throws {
        guard HKHealthStore.isHealthDataAvailable(), token != nil else { throw issue("Sign in on an iPhone to connect Apple Health.") }
        try await store.requestAuthorization(toShare: [], read: [steps])
        // A completed prompt does not reveal whether read access was granted.
        enabled = true; persist(); observe()
        do { try await store.enableBackgroundDelivery(for: steps, frequency: .hourly) }
        catch { message = "Background updates unavailable. ASTA will sync when opened." }
        await sync()
    }
    func disconnect() {
        epoch = UUID(); enabled = false; running?.cancel(); running = nil
        if let observer = observer { store.stop(observer); self.observer = nil }
        store.disableBackgroundDelivery(for: steps) { _,_ in }
        today = nil; lastSynced = nil; message = nil; persist(); publish()
    }
    func state() -> [String:Any] {
        var value: [String:Any] = ["available":HKHealthStore.isHealthDataAvailable(),"enabled":enabled,"syncing":running != nil]
        value["todaySteps"] = today; value["lastSyncedAt"] = lastSynced; value["message"] = message
        return value
    }
    private func publish() { NotificationCenter.default.post(name:Notification.Name("ASTAHealthChanged"), object:nil, userInfo:state()) }
    private func observe() {
        guard observer == nil, enabled else { return }
        let query = HKObserverQuery(sampleType:steps, predicate:nil) { _,completion,error in
            Task { @MainActor in
                if error == nil { await self.sync() }
                completion() // Always acknowledge, including denial/offline/sign-out.
            }
        }
        observer = query; store.execute(query)
    }
    private func issue(_ text:String) -> Error { NSError(domain:"ASTAHealth",code:1,userInfo:[NSLocalizedDescriptionKey:text]) }
    private func count(from:Date, to:Date) async throws -> Int? {
        guard to > from else { return 0 }
        // Exclude manually entered steps and third-party writers. Apple's
        // cumulative statistics merge overlap from iPhone and Apple Watch.
        let date = HKQuery.predicateForSamples(withStart:from,end:to,options:[.strictStartDate,.strictEndDate])
        let sources: Set<HKSource> = try await withCheckedThrowingContinuation { continuation in
            let q = HKSourceQuery(sampleType:steps,samplePredicate:date) { _,sources,error in
                if let error = error { continuation.resume(throwing:error) }
                else { continuation.resume(returning:Set((sources ?? []).filter { $0.bundleIdentifier.hasPrefix("com.apple.health.") })) }
            }; store.execute(q)
        }
        guard !sources.isEmpty else { return nil }
        let manual = HKQuery.predicateForObjects(withMetadataKey:HKMetadataKeyWasUserEntered,allowedValues:[true])
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates:[date,HKQuery.predicateForObjects(from:sources),NSCompoundPredicate(notPredicateWithSubpredicate:manual)])
        return try await withCheckedThrowingContinuation { continuation in
            let q = HKStatisticsQuery(quantityType:steps,quantitySamplePredicate:predicate,options:.cumulativeSum) { _,result,error in
                if let error = error { continuation.resume(throwing:error) }
                else { continuation.resume(returning:result?.sumQuantity().map { Int($0.doubleValue(for:.count()).rounded()) }) }
            }; store.execute(q)
        }
    }
    private func api(_ path:String, token:String, body:[String:Any]? = nil) async throws -> [String:Any] {
        var request = URLRequest(url:URL(string:base+path)!,timeoutInterval:12)
        request.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization")
        if let body = body { request.httpMethod = "POST"; request.setValue("application/json",forHTTPHeaderField:"Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject:body) }
        let (data,response) = try await URLSession.shared.data(for:request)
        let value = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any] ?? [:]
        guard let status = response as? HTTPURLResponse, (200..<300).contains(status.statusCode) else { throw issue(value["message"] as? String ?? "Sync unavailable. Open ASTA and check your connection.") }
        return value
    }
    func sync() async {
        guard enabled, let token = token else { return }
        if let running = running { await running.value; return }
        let current = epoch
        let task = Task { @MainActor in
            defer { if self.epoch == current { self.running = nil; self.publish() } }
            do {
                let now = Date()
                let total = try await self.count(from:Calendar.current.startOfDay(for:now),to:now)
                guard self.epoch == current, !Task.isCancelled else { return }
                self.today = total
                let data = try await self.api("/health/competitions?windowsOnly=true",token:token)
                for race in data["competitions"] as? [[String:Any]] ?? [] {
                    guard self.epoch == current, !Task.isCancelled else { return }
                    guard race["status"] as? String == "RUNNING", let id = race["entryId"] as? String,
                          let startText = race["windowStart"] as? String, let endText = race["windowEnd"] as? String,
                          let start = self.iso.date(from:startText), let end = self.iso.date(from:endText), start < now else { continue }
                    let through = min(now,end)
                    guard let count = try await self.count(from:start,to:through) else { continue }
                    guard self.epoch == current, !Task.isCancelled else { return }
                    _ = try await self.api("/health/competitions/steps",token:token,body:["entryId":id,"steps":count,"windowStart":startText,"windowEnd":self.iso.string(from:through),"observedAt":self.iso.string(from:Date())])
                }
                guard self.epoch == current, !Task.isCancelled else { return }
                if total == nil {
                    self.message = "No readable steps today. Allow Steps for ASTA in Health, or take a short walk and try again."
                } else { self.message = nil; self.lastSynced = self.iso.string(from:Date()); self.persist() }
            } catch {
                guard self.epoch == current, !Task.isCancelled else { return }
                self.message = error.localizedDescription
            }
        }
        running = task; publish(); await task.value
    }
}

@objc(ASTAHealthPlugin)
public class ASTAHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ASTAHealthPlugin"
    public let jsName = "ASTAHealth"
    public let pluginMethods: [CAPPluginMethod] = ["setSession","connect","disconnect","refresh","status"].map { CAPPluginMethod(name:$0,returnType:CAPPluginReturnPromise) }
    private var observer: NSObjectProtocol?
    public override func load() {
        observer = NotificationCenter.default.addObserver(forName:Notification.Name("ASTAHealthChanged"),object:nil,queue:.main) { [weak self] notification in
            self?.notifyListeners("changed",data:notification.userInfo as? [String:Any] ?? [:])
        }
    }
    deinit { if let observer = observer { NotificationCenter.default.removeObserver(observer) } }
    @objc func setSession(_ call:CAPPluginCall) { Task { @MainActor in ASTAHealthStore.shared.setSession(call.getString("token"),owner:call.getString("owner")); call.resolve() } }
    @objc func connect(_ call:CAPPluginCall) { Task { @MainActor in do { try await ASTAHealthStore.shared.connect(); call.resolve(ASTAHealthStore.shared.state()) } catch { call.reject(error.localizedDescription) } } }
    @objc func disconnect(_ call:CAPPluginCall) { Task { @MainActor in ASTAHealthStore.shared.disconnect(); call.resolve(ASTAHealthStore.shared.state()) } }
    @objc func refresh(_ call:CAPPluginCall) { Task { @MainActor in await ASTAHealthStore.shared.sync(); call.resolve(ASTAHealthStore.shared.state()) } }
    @objc func status(_ call:CAPPluginCall) { Task { @MainActor in call.resolve(ASTAHealthStore.shared.state()) } }
}

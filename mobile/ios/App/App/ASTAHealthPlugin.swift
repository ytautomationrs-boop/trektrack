import Capacitor
import HealthKit
import Security
import CryptoKit
import DeviceCheck
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
    private var poolsEnabled = false
    private var activityEnabled = false
    private var setupHandled = false
    private var attestKey: String?
    private var poolObservers: [HKObserverQuery] = []
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
            setupHandled = saved["setupHandled"] as? Bool ?? false
            activityEnabled = saved["activityEnabled"] as? Bool ?? false
            enabled = saved["enabled"] as? Bool ?? false; poolsEnabled = saved["poolsEnabled"] as? Bool ?? false; attestKey = saved["attestKey"] as? String; lastSynced = saved["lastSynced"] as? String
        }
        if enabled { observe(); observePools() }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object:nil, queue:.main) { _ in
            Task { @MainActor in await ASTAHealthStore.shared.sync() }
        }
    }
    private func persist() {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service]
        SecItemDelete(query as CFDictionary)
        guard let token = token, let owner = owner else { return }
        var saved: [String:Any] = ["token":token,"owner":owner,"enabled":enabled,"poolsEnabled":poolsEnabled,"activityEnabled":activityEnabled,"setupHandled":setupHandled]
        saved["lastSynced"] = lastSynced; saved["attestKey"] = attestKey
        guard let data = try? JSONSerialization.data(withJSONObject:saved) else { return }
        var item = query; item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary,nil)
    }
    func setSession(_ next: String?, owner nextOwner: String?) {
        if owner != nextOwner {
            epoch = UUID(); running?.cancel(); running = nil
            enabled = false; setupHandled = false; activityEnabled = false; poolsEnabled = false; attestKey = nil; poolObservers.forEach { store.stop($0) }; poolObservers.removeAll(); today = nil; lastSynced = nil; message = nil
            if let observer = observer { store.stop(observer); self.observer = nil }
            store.disableBackgroundDelivery(for:steps) { _,_ in }
        }
        token = next; owner = nextOwner; persist()
        if enabled { observe(); Task { await sync() } }
        publish()
    }
    func prepare() async throws {
        guard !setupHandled else { if enabled { Task { await sync() } }; return }
        try await connect()
    }
    func connect() async throws {
        guard HKHealthStore.isHealthDataAvailable(), token != nil else { throw issue("Sign in on an iPhone to connect Apple Health.") }
        setupHandled = true; persist()
        if !activityEnabled { try await store.requestAuthorization(toShare: [], read: poolReadTypes) }
        activityEnabled = true
        // A completed prompt does not reveal whether read access was granted.
        enabled = true; persist(); observe()
        do { try await store.enableBackgroundDelivery(for: steps, frequency: .hourly) }
        catch { message = "Background updates unavailable. ASTA will sync when opened." }
        Task { await sync() }
    }
    func disconnect() {
        epoch = UUID(); setupHandled = true; enabled = false; activityEnabled = false; poolsEnabled = false; attestKey = nil; poolObservers.forEach { store.stop($0) }; poolObservers.removeAll(); running?.cancel(); running = nil
        if let observer = observer { store.stop(observer); self.observer = nil }
        store.disableBackgroundDelivery(for: steps) { _,_ in }
        today = nil; lastSynced = nil; message = nil; persist(); publish()
    }
    func state() -> [String:Any] {
        var value: [String:Any] = ["available":HKHealthStore.isHealthDataAvailable(),"enabled":enabled,"poolsEnabled":poolsEnabled,"syncing":running != nil,"activityEnabled":activityEnabled,"setupHandled":setupHandled]
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
        guard let status = response as? HTTPURLResponse, (200..<300).contains(status.statusCode) else {
            if (response as? HTTPURLResponse)?.statusCode == 403 && path == "/pools/health/snapshot" { attestKey = nil; persist() }
            throw issue(value["message"] as? String ?? "Sync unavailable. Open ASTA and check your connection.") }
        return value
    }
    private var poolReadTypes: Set<HKObjectType> { [steps, HKObjectType.workoutType(), HKObjectType.categoryType(forIdentifier:.sleepAnalysis)!] }
    func connectPools() async throws {
        guard HKHealthStore.isHealthDataAvailable(), token != nil else { throw issue("Sign in on an iPhone to connect Apple Health.") }
        setupHandled = true; persist()
        if !activityEnabled { try await store.requestAuthorization(toShare:[],read:poolReadTypes) }
        activityEnabled = true
        _ = try await verifiedPoolKey(token:token!)
        poolsEnabled = true; enabled = true; persist(); observe(); observePools()
        try? await store.enableBackgroundDelivery(for:steps,frequency:.hourly)
        Task { await sync() }
    }
    private func verifiedPoolKey(token:String) async throws -> String {
        if let key = attestKey { return key }
        let service = DCAppAttestService.shared
        guard service.isSupported else { throw issue("This iPhone cannot verify wallet Pool activity.") }
        let challenge = try await api("/pools/device/challenge",token:token,body:["purpose":"register"])
        guard let nonce = challenge["nonce"] as? String else { throw issue("Device verification is unavailable.") }
        let key = try await service.generateKey()
        let attestation = try await service.attestKey(key,clientDataHash:Data(SHA256.hash(data:Data(nonce.utf8))))
        _ = try await api("/pools/device/register",token:token,body:["nonce":nonce,"keyId":key,"attestation":attestation.base64EncodedString()])
        attestKey = key; persist(); return key
    }
    private func sendPoolActivity(_ body:[String:Any],token:String) async throws {
        let key = try await verifiedPoolKey(token:token)
        let challenge = try await api("/pools/device/challenge",token:token,body:["purpose":"activity"])
        guard let nonce = challenge["nonce"] as? String else { throw issue("Activity verification is unavailable.") }
        var signed = body; signed["nonce"] = nonce
        let payload = try JSONSerialization.data(withJSONObject:signed,options:[.sortedKeys])
        let assertion = try await DCAppAttestService.shared.generateAssertion(key,clientDataHash:Data(SHA256.hash(data:payload)))
        _ = try await api("/pools/health/snapshot",token:token,body:["keyId":key,"payload":payload.base64EncodedString(),"assertion":assertion.base64EncodedString()])
    }
    private func observePools() {
        guard poolsEnabled, poolObservers.isEmpty else { return }
        for type in [HKObjectType.workoutType() as HKSampleType, HKObjectType.categoryType(forIdentifier:.sleepAnalysis)!] {
            let query = HKObserverQuery(sampleType:type,predicate:nil) { _,completion,error in
                Task { @MainActor in if error == nil { await self.sync() }; completion() }
            }
            poolObservers.append(query); store.execute(query)
            store.enableBackgroundDelivery(for:type,frequency:.hourly) { _,_ in }
        }
    }
    private func poolSamples(type:HKSampleType,from:Date,to:Date) async throws -> [HKSample] {
        let date = HKQuery.predicateForSamples(withStart:from,end:to,options:[.strictStartDate,.strictEndDate])
        return try await withCheckedThrowingContinuation { continuation in
            let q = HKSampleQuery(sampleType:type,predicate:date,limit:HKObjectQueryNoLimit,sortDescriptors:nil) { _,samples,error in
                if let error = error { continuation.resume(throwing:error); return }
                continuation.resume(returning:(samples ?? []).filter { $0.sourceRevision.source.bundleIdentifier.hasPrefix("com.apple.") && ($0.metadata?[HKMetadataKeyWasUserEntered] as? Bool != true) })
            }; store.execute(q)
        }
    }
    func dailyActivity(metrics: [String]) async throws -> [String:Any] {
        guard enabled else { return ["values":[:]] }
        let now = Date(), start = Calendar.current.startOfDay(for:Date())
        let selected = Set(metrics), current = epoch
        var values:[String:Double] = [:]
        if selected.contains("steps"), let total = try await count(from:start,to:now) { values["steps"] = Double(total) }
        if activityEnabled && !selected.isDisjoint(with:["steps","running","cycling","swimming"]) {
            let workouts = try await poolSamples(type:HKObjectType.workoutType(),from:start,to:now).compactMap { $0 as? HKWorkout }
            for (metric,kind) in [("walkingDistance",HKWorkoutActivityType.walking),("running",.running),("cycling",.cycling),("swimming",.swimming)] where selected.contains(metric == "walkingDistance" ? "steps" : metric) {
                var lastEnd = start, distance = 0.0
                let matches = workouts.filter {$0.workoutActivityType == kind}.sorted {$0.startDate < $1.startDate}
                for workout in matches {
                    if workout.startDate < lastEnd { continue }
                    lastEnd = workout.endDate
                    distance += workout.totalDistance?.doubleValue(for:.meter()) ?? 0
                }
                // HealthKit intentionally cannot distinguish denied read access from no data.
                if !matches.isEmpty { values[metric] = distance / 1000 }
            }
        }
        if activityEnabled && selected.contains("sleep") {
            let samples = try await poolSamples(type:HKObjectType.categoryType(forIdentifier:.sleepAnalysis)!,from:start.addingTimeInterval(-86400),to:now).compactMap {$0 as? HKCategorySample}.filter {[1,3,4,5].contains($0.value)}.sorted {$0.startDate < $1.startDate}
            var intervals:[(Date,Date)] = []
            for sample in samples {
                if let last = intervals.last, sample.startDate <= last.1 { intervals[intervals.count-1] = (last.0,max(last.1,sample.endDate)) }
                else { intervals.append((sample.startDate,sample.endDate)) }
            }
            var sessions:[(Date,Date,Double)] = []
            for interval in intervals {
                let hours = interval.1.timeIntervalSince(interval.0)/3600
                if let last = sessions.last, interval.0.timeIntervalSince(last.1) <= 5400 { sessions[sessions.count-1] = (last.0,interval.1,last.2+hours) }
                else { sessions.append((interval.0,interval.1,hours)) }
            }
            if let main = sessions.filter({$0.1 >= start}).max(by:{$0.2 < $1.2}) { values["sleep"] = main.2 }
        }
        guard epoch == current else { return ["values":[:]] }
        return ["values":values]
    }

    private func syncPools(token:String,current:UUID,now:Date) async throws {
        guard poolsEnabled else { return }
        let data = try await api("/pools/health/windows",token:token)
        for window in data["windows"] as? [[String:Any]] ?? [] {
            guard epoch == current, !Task.isCancelled else { return }
            guard let id = window["poolId"] as? String, let day = window["day"] as? Int,
                  let startText = window["windowStart"] as? String, let endText = window["windowEnd"] as? String,
                  let start = iso.date(from:startText), let end = iso.date(from:endText), let metrics = window["metrics"] as? [String] else { continue }
            let through = min(end,now)
            var values:[String:Double] = [:]
            var body:[String:Any] = ["poolId":id,"day":day,"windowStart":startText,"windowEnd":iso.string(from:through),"observedAt":iso.string(from:Date())]
            if metrics.contains("steps"), let total = try await count(from:start,to:through) { values["steps"] = Double(total) }
            if metrics.contains(where:{ ["running","cycling","swimming"].contains($0) }) {
                let workouts = try await poolSamples(type:HKObjectType.workoutType(),from:start,to:through).compactMap { $0 as? HKWorkout }
                for (metric,kind) in [("running",HKWorkoutActivityType.running),("cycling",.cycling),("swimming",.swimming)] where metrics.contains(metric) {
                    // Ignore overlapping recordings so duplicate Watch workouts cannot double distance.
                    var lastEnd = start; var distance = 0.0
                    for workout in workouts.filter({$0.workoutActivityType == kind}).sorted(by:{$0.startDate < $1.startDate}) {
                        if workout.startDate < lastEnd { continue }; lastEnd = workout.endDate
                        distance += workout.totalDistance?.doubleValue(for:.meter()) ?? 0
                    }
                    values[metric] = distance / 1000
                }
            }
            if metrics.contains("sleep") {
                let samples = try await poolSamples(type:HKObjectType.categoryType(forIdentifier:.sleepAnalysis)!,from:start.addingTimeInterval(-86400),to:through).compactMap { $0 as? HKCategorySample }.filter { [1,3,4,5].contains($0.value) }.sorted {$0.startDate < $1.startDate}
                var intervals:[(Date,Date)] = []
                for sample in samples {
                    if let last = intervals.last, sample.startDate <= last.1 { intervals[intervals.count-1] = (last.0,max(last.1,sample.endDate)) }
                    else { intervals.append((sample.startDate,sample.endDate)) }
                }
                var sessions:[(Date,Date,Double)] = []
                for interval in intervals {
                    let hours = interval.1.timeIntervalSince(interval.0)/3600
                    if let last = sessions.last, interval.0.timeIntervalSince(last.1) <= 5400 { sessions[sessions.count-1] = (last.0,interval.1,last.2+hours) }
                    else { sessions.append((interval.0,interval.1,hours)) }
                }
                if let main = sessions.filter({$0.1 >= start && $0.1 < end}).max(by:{$0.2 < $1.2}) {
                    values["sleep"] = main.2; body["sleepStart"] = iso.string(from:main.0); body["sleepEnd"] = iso.string(from:main.1)
                }
            }
            guard epoch == current, !Task.isCancelled else { return }
            body["values"] = values
            try await sendPoolActivity(body,token:token)
        }
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
                try await self.syncPools(token:token,current:current,now:now)
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
    public let pluginMethods: [CAPPluginMethod] = ["setSession","connect","connectPools","disconnect","refresh","status","dailyActivity","prepare","openSettings"].map { CAPPluginMethod(name:$0,returnType:CAPPluginReturnPromise) }
    private var observer: NSObjectProtocol?
    public override func load() {
        observer = NotificationCenter.default.addObserver(forName:Notification.Name("ASTAHealthChanged"),object:nil,queue:.main) { [weak self] notification in
            self?.notifyListeners("changed",data:notification.userInfo as? [String:Any] ?? [:])
        }
    }
    deinit { if let observer = observer { NotificationCenter.default.removeObserver(observer) } }
    @objc func setSession(_ call:CAPPluginCall) { Task { @MainActor in ASTAHealthStore.shared.setSession(call.getString("token"),owner:call.getString("owner")); call.resolve() } }
    @objc func connect(_ call:CAPPluginCall) { Task { @MainActor in do { try await ASTAHealthStore.shared.connect(); call.resolve(ASTAHealthStore.shared.state()) } catch { call.reject(error.localizedDescription) } } }
    @objc func connectPools(_ call:CAPPluginCall) { Task { @MainActor in do { try await ASTAHealthStore.shared.connectPools(); call.resolve(ASTAHealthStore.shared.state()) } catch { call.reject(error.localizedDescription) } } }
    @objc func disconnect(_ call:CAPPluginCall) { Task { @MainActor in ASTAHealthStore.shared.disconnect(); call.resolve(ASTAHealthStore.shared.state()) } }
    @objc func refresh(_ call:CAPPluginCall) { Task { @MainActor in await ASTAHealthStore.shared.sync(); call.resolve(ASTAHealthStore.shared.state()) } }
    @objc func dailyActivity(_ call:CAPPluginCall) { Task { @MainActor in do { call.resolve(try await ASTAHealthStore.shared.dailyActivity(metrics:call.getArray("metrics",String.self) ?? [])) } catch { call.reject(error.localizedDescription) } } }
    @objc func prepare(_ call:CAPPluginCall) { Task { @MainActor in do { try await ASTAHealthStore.shared.prepare(); call.resolve(ASTAHealthStore.shared.state()) } catch { call.reject(error.localizedDescription) } } }
    @objc func openSettings(_ call:CAPPluginCall) { Task { @MainActor in
        guard let url = URL(string:UIApplication.openSettingsURLString) else { call.reject("Settings are unavailable."); return }
        let opened = await UIApplication.shared.open(url)
        if opened { call.resolve() } else { call.reject("Could not open Settings.") }
    } }
    @objc func status(_ call:CAPPluginCall) { Task { @MainActor in call.resolve(ASTAHealthStore.shared.state()) } }
}

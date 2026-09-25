import Foundation
import WatchConnectivity
import Security

// Watch traffic uses native networking, so scoring can wake the companion in
// the background without loading the web app. The JWT stays in phone Keychain.
final class WatchBridge: NSObject, WCSessionDelegate {
    static let shared = WatchBridge()
    private let queue = DispatchQueue(label:"com.asta.watchbridge")
    private let base = "https://lightsteelblue-giraffe-860469.hostingersite.com"
    private var token: String?
    private var epoch: String = ""
    private var events: [[String:Any]] = []
    private var refreshing = false
    override private init() {
        super.init()
        let query:[String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"com.asta.watch-session",kSecReturnData as String:true]
        var value: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary,&value) == errSecSuccess,let data=value as? Data,let saved=(try? JSONSerialization.jsonObject(with:data)) as? [String:String] { token=saved["token"];epoch=saved["epoch"] ?? "" }
        if WCSession.isSupported() { WCSession.default.delegate=self;WCSession.default.activate() }
    }
    func setToken(_ next:String?) { queue.async {
        if self.token == next {self.load();return}
        self.token=next;self.epoch=UUID().uuidString;self.events=[]
        let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"com.asta.watch-session"]
        SecItemDelete(query as CFDictionary)
        if let next=next,let data=try? JSONSerialization.data(withJSONObject:["token":next,"epoch":self.epoch]) {
            var item=query;item[kSecValueData as String]=data;item[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(item as CFDictionary,nil)
        }
        self.publish();self.load()
    }}
    func refresh(){queue.async{self.load()}}
    func publishGame(_ event:[String:Any]){queue.async{
        guard self.token != nil,let id=event["id"] as? String else{return}
        if event["status"] as? String != "LIVE" {self.events.removeAll{$0["id"] as? String == id};self.publish();return}
        let old=self.events.first{$0["id"] as? String == id}
        let oldVersion=(old?["game"] as? [String:Any])?["version"] as? Int ?? 0
        let version=(event["game"] as? [String:Any])?["version"] as? Int ?? 0
        if version>=oldVersion{self.events.removeAll{$0["id"] as? String == id};self.events.insert(event,at:0);self.publish()}
    }}
    private func context()->[String:Any]{["epoch":epoch,"signedIn":token != nil,"events":events]}
    private func publish(){guard WCSession.isSupported(),WCSession.default.activationState == .activated else{return};try? WCSession.default.updateApplicationContext(context())}
    private func api(_ path:String,body:[String:Any]?=nil,completion:@escaping(Result<[String:Any],Error>)->Void){
        guard let token=token,let url=URL(string:base+path) else {completion(.failure(NSError(domain:"ASTA",code:401,userInfo:[NSLocalizedDescriptionKey:"Open ASTA and sign in on your iPhone."])));return}
        var request=URLRequest(url:url,timeoutInterval:12);request.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization")
        if let body=body{request.httpMethod="POST";request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try? JSONSerialization.data(withJSONObject:body)}
        URLSession.shared.dataTask(with:request){data,response,error in
            let object=data.flatMap{try? JSONSerialization.jsonObject(with:$0)} as? [String:Any] ?? [:]
            self.queue.async {
                if let error=error {completion(.failure(error));return}
                guard let response=response as? HTTPURLResponse,(200..<300).contains(response.statusCode) else {completion(.failure(NSError(domain:"ASTA",code:(response as? HTTPURLResponse)?.statusCode ?? 500,userInfo:[NSLocalizedDescriptionKey:object["message"] as? String ?? "Could not save the point. Retry when connected."])));return}
                completion(.success(object))
            }
        }.resume()
    }
    private func merge(_ incoming:[[String:Any]]) {
        events=incoming.map { event in
            guard let old=events.first(where:{$0["id"] as? String == event["id"] as? String}) else{return event}
            let oldVersion=(old["game"] as? [String:Any])?["version"] as? Int ?? 0
            let nextVersion=(event["game"] as? [String:Any])?["version"] as? Int ?? 0
            return oldVersion>nextVersion ? old : event
        }
    }
    private func load(){
        guard token != nil,!refreshing else {publish();return};refreshing=true;let owner=epoch
        api("/social-events/watch"){result in
            self.refreshing=false;guard owner==self.epoch else{return}
            if case .success(let data)=result{self.merge(data["events"] as? [[String:Any]] ?? []);self.publish()}
        }
    }
    func session(_ session:WCSession,activationDidCompleteWith activationState:WCSessionActivationState,error:Error?){refresh()}
    func sessionDidBecomeInactive(_ session:WCSession){}
    func sessionDidDeactivate(_ session:WCSession){session.activate()}
    func session(_ session:WCSession,didReceiveMessage message:[String:Any],replyHandler:@escaping([String:Any])->Void){queue.async{
        if message["action"] as? String == "refresh" {
            let owner=self.epoch
            self.api("/social-events/watch"){result in
                guard owner==self.epoch else{replyHandler(["error":"Account changed. Open ASTA on iPhone."]);return}
                switch result{case .success(let data):self.merge(data["events"] as? [[String:Any]] ?? []);self.publish();replyHandler(self.context());case .failure(let error):replyHandler(["error":error.localizedDescription])}
            };return
        }
        guard message["epoch"] as? String == self.epoch,self.token != nil,let id=message["eventId"] as? String,let operation=message["operationId"] as? String,let side=message["side"] as? Int,let value=message["value"] as? Int else{replyHandler(["error":"Account changed. Open ASTA on iPhone."]);return}
        let owner=self.epoch
        self.api("/social-events/\(id.addingPercentEncoding(withAllowedCharacters:.urlPathAllowed) ?? id)/game",body:["action":"score","operationId":operation,"version":0,"side":side,"value":value]){result in
            guard owner==self.epoch else{replyHandler(["error":"Account changed. Open ASTA on iPhone."]);return}
            switch result{
            case .success(let saved):
                if let index=self.events.firstIndex(where:{$0["id"] as? String == id}) {
                    let oldVersion=(self.events[index]["game"] as? [String:Any])?["version"] as? Int ?? 0
                    let version=(saved["game"] as? [String:Any])?["version"] as? Int ?? 0
                    if version>=oldVersion{var compact=saved["game"] as? [String:Any] ?? [:];compact.removeValue(forKey:"actions");compact.removeValue(forKey:"operationIds");self.events[index]["game"]=compact;self.events[index]["score"]=saved["score"]}
                }
                self.publish();NotificationCenter.default.post(name:Notification.Name("ASTAWatchScoreChanged"),object:nil,userInfo:["eventId":id,"game":saved["game"] ?? [:],"status":saved["status"] ?? "LIVE"]);var response=self.context();response["ack"]=operation;replyHandler(response)
            case .failure(let error):replyHandler(["error":error.localizedDescription])
            }
        }
    }}
}

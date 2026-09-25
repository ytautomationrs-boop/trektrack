import SwiftUI
import WatchConnectivity
import WatchKit

struct WatchPoint:Codable,Identifiable {
    var id:String;var eventId:String;var epoch:String;var side:Int;var value:Int
}
final class WatchModel:NSObject,ObservableObject,WCSessionDelegate {
    @Published var events:[[String:Any]]=[]
    @Published var pending:[WatchPoint]=[]
    @Published var error=""
    @Published var signedIn=false
    private var epoch=""
    private var sending=false
    override init(){
        super.init()
        epoch=UserDefaults.standard.string(forKey:"epoch") ?? ""
        if let data=UserDefaults.standard.data(forKey:"pending"),let points=try? JSONDecoder().decode([WatchPoint].self,from:data){pending=points}
        WCSession.default.delegate=self;WCSession.default.activate()
    }
    private func save(){UserDefaults.standard.set(try? JSONEncoder().encode(pending),forKey:"pending");UserDefaults.standard.set(epoch,forKey:"epoch")}
    private func apply(_ data:[String:Any]){
        if let message=data["error"] as? String{error=message;return}
        guard let next=data["epoch"] as? String else{return}
        if next != epoch{pending=[];epoch=next;save()}
        signedIn=data["signedIn"] as? Bool ?? false
        events=(data["events"] as? [[String:Any]] ?? []).map{event in
            guard let old=events.first(where:{$0["id"] as? String == event["id"] as? String}) else{return event}
            let oldVersion=(old["game"] as? [String:Any])?["version"] as? Int ?? 0
            let nextVersion=(event["game"] as? [String:Any])?["version"] as? Int ?? 0
            return oldVersion>nextVersion ? old : event
        }
        if let ack=data["ack"] as? String{pending.removeAll{$0.id==ack};save()}
        error=""
    }
    func add(eventId:String,side:Int,value:Int){
        guard signedIn else{return}
        pending.append(WatchPoint(id:UUID().uuidString,eventId:eventId,epoch:epoch,side:side,value:value));save()
        WKInterfaceDevice.current().play(.click);flush()
    }
    func refresh(){
        guard WCSession.default.isReachable else{error="Keep your iPhone nearby. Points wait here until you reconnect.";return}
        WCSession.default.sendMessage(["action":"refresh"],replyHandler:{data in DispatchQueue.main.async{self.apply(data);if data["error"] == nil{self.flush()}}},errorHandler:{error in DispatchQueue.main.async{self.error=error.localizedDescription}})
    }
    func flush(){
        guard !sending,let point=pending.first else{return}
        guard WCSession.default.isReachable else{error="Waiting for iPhone. Your points are saved on this watch.";return}
        sending=true;error=""
        WCSession.default.sendMessage(["action":"score","epoch":point.epoch,"eventId":point.eventId,"operationId":point.id,"side":point.side,"value":point.value],replyHandler:{data in DispatchQueue.main.async{
            self.sending=false;self.apply(data)
            if data["ack"] as? String == point.id{self.flush()}
        }},errorHandler:{error in DispatchQueue.main.async{self.sending=false;self.error="Not saved yet. \(error.localizedDescription)"}})
    }
    func discard(){guard !sending else{return};pending=[];save();error="";refresh()}
    func session(_ session:WCSession,activationDidCompleteWith activationState:WCSessionActivationState,error:Error?){DispatchQueue.main.async{self.apply(session.receivedApplicationContext);self.refresh()}}
    func sessionReachabilityDidChange(_ session:WCSession){if session.isReachable{DispatchQueue.main.async{self.refresh()}}}
    func session(_ session:WCSession,didReceiveApplicationContext applicationContext:[String:Any]){DispatchQueue.main.async{self.apply(applicationContext)}}
}
@main struct ASTAWatchApp:App {
    @StateObject private var model=WatchModel()
    @Environment(\.scenePhase) private var phase
    var body:some Scene{WindowGroup{WatchHome().environmentObject(model).tint(Color(red:0.40,green:0.07,blue:0.16)).onChange(of:phase){_,phase in if phase == .active{model.refresh()}}}}
}
struct WatchHome:View {
    @EnvironmentObject var model:WatchModel
    @State private var selected:String?
    @State private var discarding=false
    var body:some View{
        NavigationStack{
            ScrollView{
                VStack(spacing:10){
                    Text("ASTA").font(.headline).foregroundStyle(.white)
                    if let id=selected,let event=model.events.first(where:{$0["id"] as? String == id}){
                        GameControls(event:event)
                        Button("Other games"){selected=nil}.font(.caption)
                    }else{
                        ForEach(model.events.indices,id:\.self){index in
                            let event=model.events[index]
                            Button(event["name"] as? String ?? "Game"){selected=event["id"] as? String}
                        }
                        if model.events.isEmpty{Text(model.signedIn ? "Start a full game you host in ASTA on your iPhone. It will appear here." : "Open ASTA and sign in on your iPhone.").font(.caption).multilineTextAlignment(.center)}
                    }
                    if !model.pending.isEmpty{Text("\(model.pending.count) points waiting to save").font(.caption2).foregroundStyle(.yellow)}
                    if !model.error.isEmpty{Text(model.error).font(.caption2).foregroundStyle(.yellow);Button("Retry"){model.refresh()};if !model.pending.isEmpty{Button("Discard unsaved",role:.destructive){discarding=true}.font(.caption2)}}
                    Button("Refresh"){model.refresh()}.font(.caption2)
                }.padding(.horizontal,4)
            }.confirmationDialog("Discard unsaved points?",isPresented:$discarding,titleVisibility:.visible){Button("Discard",role:.destructive){model.discard()}}
        }
    }
}
struct GameControls:View {
    @EnvironmentObject var model:WatchModel
    let event:[String:Any]
    private var game:[String:Any]{event["game"] as? [String:Any] ?? [:]}
    private var score:[String:Any]{event["score"] as? [String:Any] ?? [:]}
    private var teams:[String]{game["teams"] as? [String] ?? ["Team A","Team B"]}
    private var choices:[[String:Any]]{event["choices"] as? [[String:Any]] ?? []}
    private var playable:Bool{game["runningSince"] is String && !(score["winner"] is Int)}
    var body:some View{
        VStack(spacing:8){
            Text(event["name"] as? String ?? "Live game").font(.caption).lineLimit(2)
            if let running=game["runningSince"] as? String,let start=ISO8601DateFormatter.asta.date(from:running){Text(start.addingTimeInterval(-(game["elapsedMs"] as? Double ?? 0)/1000),style:.timer).monospacedDigit().font(.caption)}
            HStack(alignment:.top,spacing:6){
                ForEach(0..<2,id:\.self){side in
                    VStack(spacing:6){
                        Text(teams.indices.contains(side) ? teams[side] : "Team").font(.caption2).lineLimit(2)
                        Text((score["display"] as? [String])?[side] ?? "0").font(.title2.bold()).monospacedDigit()
                        if let sets=score["sets"] as? [Int],score["setSport"] as? Bool == true{Text("\(sets[side]) sets").font(.caption2)}
                        ForEach(choices.indices,id:\.self){index in
                            let choice=choices[index];let value=choice["value"] as? Int ?? 1
                            Button{model.add(eventId:event["id"] as? String ?? "",side:side,value:value)}label:{VStack(spacing:2){Text("+\(value)").font(.headline);Text(choice["label"] as? String ?? "Point").font(.system(size:10))}.frame(maxWidth:.infinity,minHeight:38)}.buttonStyle(.borderedProminent).disabled(!playable)
                        }
                    }.frame(maxWidth:.infinity)
                }
            }
            if !playable{Text("Resume or finish the game on iPhone.").font(.caption2)}
            Text("Scores shown are saved scores.").font(.system(size:10)).foregroundStyle(.secondary)
        }
    }
}
private extension ISO8601DateFormatter{static let asta:ISO8601DateFormatter={let f=ISO8601DateFormatter();f.formatOptions=[.withInternetDateTime,.withFractionalSeconds];return f}()}

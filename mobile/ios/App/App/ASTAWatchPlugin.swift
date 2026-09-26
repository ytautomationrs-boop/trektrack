import Capacitor

class ASTABridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(ASTAWatchPlugin()); bridge?.registerPluginInstance(ASTAAuthPlugin()) }
}
@objc(ASTAWatchPlugin)
public class ASTAWatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ASTAWatchPlugin"
    public let jsName = "ASTAWatch"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name:"setSession",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"refresh",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"publishGame",returnType:CAPPluginReturnPromise)]
    private var observer:NSObjectProtocol?
    public override func load(){
        observer=NotificationCenter.default.addObserver(forName:Notification.Name("ASTAWatchScoreChanged"),object:nil,queue:.main){[weak self] notification in
            if let data=notification.userInfo as? [String:Any]{self?.notifyListeners("scoreChanged",data:data)}
        }
    }
    deinit{if let observer=observer{NotificationCenter.default.removeObserver(observer)}}
    @objc func setSession(_ call: CAPPluginCall) {
        WatchBridge.shared.setToken(call.getString("token"))
        call.resolve()
    }
    @objc func publishGame(_ call:CAPPluginCall) {
        if let event=call.getObject("event"){WatchBridge.shared.publishGame(event)}
        call.resolve()
    }
    @objc func refresh(_ call: CAPPluginCall) { WatchBridge.shared.refresh();call.resolve() }
}

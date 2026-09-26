import Capacitor
import AuthenticationServices
import GoogleSignIn

@objc(ASTAAuthPlugin)
public class ASTAAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "ASTAAuthPlugin"
    public let jsName = "ASTAAuth"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name:"apple",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"google",returnType:CAPPluginReturnPromise)]
    private var pending: CAPPluginCall?
    private var signInWindow: UIWindow?
    @objc func apple(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("Sign-in is already open."); return }
            guard let nonce=call.getString("nonce"), !nonce.isEmpty else {call.reject("Missing sign-in challenge.");return}
            guard let window=self.bridge?.viewController?.view.window else {call.reject("Open ASTA before signing in.");return}
            self.signInWindow=window
            self.pending=call
            let request=ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes=[.email,.fullName]
            request.nonce=nonce
            let controller=ASAuthorizationController(authorizationRequests:[request])
            controller.delegate=self;controller.presentationContextProvider=self
            controller.performRequests()
        }
    }
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return signInWindow ?? ASPresentationAnchor()
    }
    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        defer { pending=nil; signInWindow=nil }
        guard let credential=authorization.credential as? ASAuthorizationAppleIDCredential,
              let data=credential.identityToken,let token=String(data:data,encoding:.utf8) else {pending?.reject("Apple did not return a sign-in token.");return}
        pending?.resolve(["identityToken":token,"authorizationCode":credential.authorizationCode.flatMap{String(data:$0,encoding:.utf8)} ?? ""])
    }
    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        pending?.reject((error as NSError).code == ASAuthorizationError.canceled.rawValue ? "Sign-in cancelled." : "Apple sign-in could not finish. Please try again.")
        pending=nil; signInWindow=nil
    }
    @objc func google(_ call:CAPPluginCall){
        DispatchQueue.main.async {
            guard let viewController=self.bridge?.viewController, let clientId=call.getString("clientId"), let serverClientId=call.getString("serverClientId"),let nonce=call.getString("nonce") else {call.reject("Google sign-in is not configured.");return}
            GIDSignIn.sharedInstance.configuration=GIDConfiguration(clientID:clientId,serverClientID:serverClientId)
            GIDSignIn.sharedInstance.signIn(withPresenting:viewController,hint:nil,additionalScopes:nil,nonce:nonce){result,error in
                guard let token=result?.user.idToken?.tokenString else {call.reject(error?.localizedDescription ?? "Google sign-in cancelled.");return}
                call.resolve(["identityToken":token])
            }
        }
    }
}

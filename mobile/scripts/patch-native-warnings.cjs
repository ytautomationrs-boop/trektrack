// Narrow, idempotent compatibility fixes for the pinned native plugins.
// Fail on upstream source changes rather than silently applying a partial patch.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'node_modules');
function replace(file, before, after) {
  const target = path.join(root, file);
  const source = fs.readFileSync(target, 'utf8');
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Native patch needs review: ${file}`);
  fs.writeFileSync(target, source.replace(before, after));
}
replace('@capacitor/camera/ios/Sources/CameraPlugin/CameraPlugin.swift',
  'DispatchQueue.global(qos: .utility).async {\n                    let assets',
  'DispatchQueue.global(qos: .utility).async { [self] in\n                    let assets');
replace('@capacitor/filesystem/ios/Sources/FilesystemPlugin/LegacyFilesystemImplementation.swift',
  '        let responseType = call.getString("responseType", "text")\n',
  '        // Download responses are written as raw file data.\n');
replace('@capacitor/keyboard/ios/Sources/KeyboardPlugin/Keyboard.m',
  '@implementation KeyboardPlugin\n',
  '@implementation KeyboardPlugin\n// Getters are supplied by CAP_PLUGIN in KeyboardPlugin.m.\n@dynamic identifier, jsName, pluginMethods;\n');
const helper = '@ebarooni/capacitor-calendar/ios/Plugin/Utils/ImplementationHelper.swift';
// Three permission continuations are safe to resume from the EventKit callback.
for (let i = 0; i < 3; i++) {
  const target=path.join(root, helper); const source=fs.readFileSync(target,'utf8');
  fs.writeFileSync(target,source.replace('let requestAccessHandler: (Bool, Error?) -> Void', 'let requestAccessHandler: @Sendable (Bool, Error?) -> Void'));
}
if ((fs.readFileSync(path.join(root,helper),'utf8').match(/let requestAccessHandler: @Sendable/g)||[]).length !== 3) throw new Error('Calendar callback patch needs review');
replace(helper, 'var reminderObject: JSObject = [', 'let reminderObject: JSObject = [');
replace(helper, 'static func eventAttendeeToJSObject(_ attendee: EKParticipant) -> JSObject {\n        var obj:', 'static func eventAttendeeToJSObject(_ attendee: EKParticipant) -> JSObject {\n        let obj:');
for (const key of ['startDate','dueDate','completionDate','notes','url','location','recurrence','alerts']) {
  // Preserve the plugin's existing absent/null semantics for partial edits.
  replace('@ebarooni/capacitor-calendar/ios/Plugin/Models/Inputs/ModifyReminderInput.swift',
    `call.hasOption("${key}")`, `(call.options["${key}"].map { !($0 is NSNull) } ?? false)`);
}
console.log('Native plugin compatibility patches applied.');

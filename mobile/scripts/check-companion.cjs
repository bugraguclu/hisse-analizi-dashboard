const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plist = require('@expo/plist').default;
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = JSON.parse(read('app.json')).expo;
const project = read('ios/HisseAnalizi.xcodeproj/project.pbxproj');
assert.equal((project.match(/productType = "com.apple.product-type.application";/g) ?? []).length, 1);
assert.equal((project.match(/productType = "com.apple.product-type.app-extension";/g) ?? []).length, 1);
assert.ok(project.includes('HisseCompanionIntents.swift in Sources'));
assert.ok(project.includes('HisseWidgets.appex in Copy Files'));
const main = plist.parse(read('ios/HisseAnalizi/HisseAnalizi.entitlements'));
const widget = plist.parse(read('ios/HisseWidgets/HisseWidgets.entitlements'));
for (const key of ['com.apple.security.application-groups', 'keychain-access-groups']) {
  assert.deepEqual(main[key], widget[key], `${key} differs between app and widget`);
}
assert.deepEqual(widget['com.apple.security.application-groups'], [`group.${app.ios.bundleIdentifier}`]);
const info = plist.parse(read('ios/HisseWidgets/HisseWidgets-Info.plist'));
assert.equal(info.HisseAppGroup, `group.${app.ios.bundleIdentifier}`);
assert.equal(info.CFBundleExecutable, '$(EXECUTABLE_NAME)');
assert.equal(info.CFBundleVersion, app.ios.buildNumber);
assert.equal(info.NSExtension.NSExtensionPointIdentifier, 'com.apple.widgetkit-extension');
assert.equal(info.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
const source = read('modules/hisse-companion/ios/Shared/SecureStore.swift');
assert.equal(read('ios/HisseWidgets/Shared/SecureStore.swift'), source, 'Generated widget source is stale');
for (const file of fs.readdirSync(path.join(root, 'targets/HisseWidgets'))) {
  assert.equal(read(`ios/HisseWidgets/${file}`), read(`targets/HisseWidgets/${file}`), `Generated ${file} is stale`);
}
assert.ok(fs.existsSync(path.join(root, 'ios/HisseWidgets/PrivacyInfo.xcprivacy')));
const mainPrivacy = plist.parse(read('ios/HisseAnalizi/PrivacyInfo.xcprivacy'));
assert.ok(mainPrivacy.NSPrivacyAccessedAPITypes.some((api) =>
  api.NSPrivacyAccessedAPIType === 'NSPrivacyAccessedAPICategoryUserDefaults' && api.NSPrivacyAccessedAPITypeReasons.includes('1C8F.1')),
  'Main app must declare its shared App Group preferences access');
console.log('Companion: one app, one embedded widget, matching shared credentials and current sources.');

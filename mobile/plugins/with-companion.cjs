const fs = require('node:fs');
const path = require('node:path');
const { withEntitlementsPlist, withInfoPlist, withXcodeProject, withPodfileProperties } = require('expo/config-plugins');
const plist = require('@expo/plist');

const TARGET = 'HisseWidgets';

module.exports = function withCompanion(config) {
  const bundle = config.ios.bundleIdentifier;
  const appGroup = `group.${bundle}`;
  const keychainGroup = `$(AppIdentifierPrefix)${bundle}.companion`;
  const entitlements = {
    'com.apple.security.application-groups': [appGroup],
    'keychain-access-groups': [keychainGroup],
  };
  const metadata = { HisseAppGroup: appGroup, HisseKeychainGroup: keychainGroup };
  config.extra = {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      build: {
        ...config.extra?.eas?.build,
        experimental: { ios: { appExtensions: [{
          targetName: TARGET,
          bundleIdentifier: `${bundle}.widgets`,
          entitlements,
        }] } },
      },
    },
  };
  config = withEntitlementsPlist(config, (mod) => {
    for (const [key, groups] of Object.entries(entitlements)) {
      mod.modResults[key] = [...new Set([...(mod.modResults[key] ?? []), ...groups])];
    }
    return mod;
  });
  config = withInfoPlist(config, (mod) => {
    Object.assign(mod.modResults, metadata);
    return mod;
  });
  config = withPodfileProperties(config, (mod) => {
    mod.modResults['ios.deploymentTarget'] = '17.0';
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const main = project.getFirstTarget();
    const mainList = project.pbxXCConfigurationList()[main.firstTarget.buildConfigurationList];
    for (const { value } of mainList.buildConfigurations) {
      project.pbxXCBuildConfigurationSection()[value].buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '17.0';
    }
    const root = mod.modRequest.projectRoot;
    const ios = mod.modRequest.platformProjectRoot;
    const dest = path.join(ios, TARGET);
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(path.join(root, 'modules/hisse-companion/ios/Shared'), path.join(dest, 'Shared'), { recursive: true });
    for (const file of fs.readdirSync(path.join(root, 'targets/HisseWidgets'))) {
      fs.copyFileSync(path.join(root, 'targets/HisseWidgets', file), path.join(dest, file));
    }
    fs.writeFileSync(path.join(dest, `${TARGET}-Info.plist`), plist.default.build({
      CFBundleDisplayName: 'Hisse Analizi',
      CFBundleExecutable: '$(EXECUTABLE_NAME)',
      CFBundleInfoDictionaryVersion: '6.0',
      CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
      CFBundleName: '$(PRODUCT_NAME)', CFBundlePackageType: 'XPC!',
      CFBundleShortVersionString: config.version, CFBundleVersion: config.ios.buildNumber,
      NSExtension: { NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' },
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false },
      ...metadata,
    }));
    fs.writeFileSync(path.join(dest, `${TARGET}.entitlements`), plist.default.build(entitlements));
    fs.writeFileSync(path.join(dest, 'PrivacyInfo.xcprivacy'), plist.default.build({
      NSPrivacyTracking: false, NSPrivacyTrackingDomains: [], NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [{
        NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
        NSPrivacyAccessedAPITypeReasons: ['1C8F.1'],
      }],
    }));
    const existing = Object.entries(project.pbxNativeTargetSection()).find(([, value]) => value?.name?.replaceAll('"', '') === TARGET);
    const exists = Boolean(existing);
    if (!exists) {
      const target = project.addTarget(TARGET, 'app_extension', TARGET, `${bundle}.widgets`);
      const sourcePaths = [
        ...fs.readdirSync(path.join(dest, 'Shared')).filter((name) => name.endsWith('.swift')).map((name) => `${TARGET}/Shared/${name}`),
        ...fs.readdirSync(dest).filter((name) => name.endsWith('.swift')).map((name) => `${TARGET}/${name}`),
      ];
      project.addBuildPhase(sourcePaths, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
      project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
      project.addBuildPhase([`${TARGET}/PrivacyInfo.xcprivacy`], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
      const configurations = project.pbxXCBuildConfigurationSection();
      const list = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
      for (const { value } of list.buildConfigurations) {
        Object.assign(configurations[value].buildSettings, {
          SWIFT_VERSION: '5.9', IPHONEOS_DEPLOYMENT_TARGET: '17.0',
          TARGETED_DEVICE_FAMILY: '"1,2"', SDKROOT: 'iphoneos',
          CODE_SIGN_ENTITLEMENTS: `"${TARGET}/${TARGET}.entitlements"`,
          APPLICATION_EXTENSION_API_ONLY: 'YES', GENERATE_INFOPLIST_FILE: 'NO',
          CURRENT_PROJECT_VERSION: config.ios.buildNumber, MARKETING_VERSION: config.version,
          SWIFT_ACTIVE_COMPILATION_CONDITIONS: '"$(inherited)"',
        });
      }
      const intents = 'HisseCompanionIntents.swift';
      fs.copyFileSync(path.join(root, 'targets', intents), path.join(ios, intents));
      project.addSourceFile(intents, { target: main.uuid }, project.getFirstProject().firstProject.mainGroup);
    } else {
      fs.copyFileSync(path.join(root, 'targets/HisseCompanionIntents.swift'), path.join(ios, 'HisseCompanionIntents.swift'));
    }
    // Updates to the parent app identity/version also apply when prebuild reuses a target.
    const widget = Object.entries(project.pbxNativeTargetSection()).find(([, value]) => value?.name?.replaceAll('"', '') === TARGET)[1];
    const list = project.pbxXCConfigurationList()[widget.buildConfigurationList];
    for (const { value } of list.buildConfigurations) {
      Object.assign(project.pbxXCBuildConfigurationSection()[value].buildSettings, {
        PRODUCT_BUNDLE_IDENTIFIER: `"${bundle}.widgets"`,
        CURRENT_PROJECT_VERSION: config.ios.buildNumber, MARKETING_VERSION: config.version,
      });
    }
    return mod;
  });
};

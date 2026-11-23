Pod::Spec.new do |s|
  s.name = 'HisseCompanion'
  s.version = '1.0.0'
  s.summary = 'Hisse Analizi widget pairing and calendar reminders'
  s.description = s.summary
  s.license = { :type => 'UNLICENSED' }
  s.author = 'Hisse Analizi'
  s.homepage = 'https://github.com/bugraguclu/hisse-analizi-dashboard'
  s.source = { :git => s.homepage }
  s.platform = :ios, '17.0'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'WidgetKit', 'UserNotifications', 'Security'
end

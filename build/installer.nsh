!macro customInstall
  ; Register separate URL protocol handlers
  WriteRegStr HKCU "Software\Classes\MantraAIURLHttp" "" "MantraAI Browser HTTP URL"
  WriteRegStr HKCU "Software\Classes\MantraAIURLHttp" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\MantraAIURLHttp\DefaultIcon" "" "$INSTDIR\MantraAI Browser.exe,0"
  WriteRegStr HKCU "Software\Classes\MantraAIURLHttp\shell\open\command" "" "$\"$INSTDIR\MantraAI Browser.exe$\" $\"%1$\""

  WriteRegStr HKCU "Software\Classes\MantraAIURLHttps" "" "MantraAI Browser HTTPS URL"
  WriteRegStr HKCU "Software\Classes\MantraAIURLHttps" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\MantraAIURLHttps\DefaultIcon" "" "$INSTDIR\MantraAI Browser.exe,0"
  WriteRegStr HKCU "Software\Classes\MantraAIURLHttps\shell\open\command" "" "$\"$INSTDIR\MantraAI Browser.exe$\" $\"%1$\""

  ; Register browser capabilities in Windows Default Apps
  WriteRegStr HKCU "Software\MantraAI Browser\Capabilities" "ApplicationName" "MantraAI Browser"
  WriteRegStr HKCU "Software\MantraAI Browser\Capabilities" "ApplicationDescription" "Browse the web with MantraAI Browser"
  WriteRegStr HKCU "Software\MantraAI Browser\Capabilities" "ApplicationIcon" "$INSTDIR\MantraAI Browser.exe,0"
  WriteRegStr HKCU "Software\MantraAI Browser\Capabilities\URLAssociations" "http" "MantraAIURLHttp"
  WriteRegStr HKCU "Software\MantraAI Browser\Capabilities\URLAssociations" "https" "MantraAIURLHttps"
  WriteRegStr HKCU "Software\RegisteredApplications" "MantraAI Browser" "Software\MantraAI Browser\Capabilities"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\RegisteredApplications" "MantraAI Browser"
    DeleteRegKey HKCU "Software\MantraAI Browser"
    DeleteRegKey HKCU "Software\Classes\MantraAIURLHttp"
    DeleteRegKey HKCU "Software\Classes\MantraAIURLHttps"
  ${endIf}
!macroend

# iOS Share Extension

Permette di condividere un link, un testo o una immagine da Safari, Instagram ecc. verso Mestolo.
L'estensione apre l'app con `mestolo://share?url=...` (o `text=...`, `image=...`); l'app intercetta il
link con `@capacitor/app` (`appUrlOpen`, componente `ShareUrlListener`) e lo manda al flusso di import
(`/import/link` o `/import/text`) con la stessa logica del Web Share Target Android (`sharedToImportPath`).

Stato: sorgenti e target `ShareExtension` sono nel repo (target, entitlements, embed e privacy manifest in
`project.pbxproj`), ma non sono mai stati compilati (sviluppato su Windows): la prima build e' quella del
workflow `mobile-ios.yml`. I "Passi in Xcode" qui sotto servono solo come riferimento/verifica o se il target va ricreato.

## File nel repo
- `ios/App/ShareExtension/ShareViewController.swift`, `Info.plist`, `ShareExtension.entitlements`
- `ios/App/App/App.entitlements` (App Group dell'app principale)
- `ios/App/App/Info.plist`: registrato lo schema URL `mestolo`

## Passi in Xcode (su Mac)
1. Apri `ios/App/App.xcodeproj`. File > New > Target > iOS > Share Extension. Nome `ShareExtension`,
   linguaggio Swift, Bundle ID `com.markg981.mestolo.ShareExtension`. Quando chiede di attivare lo schema, accetta.
2. Elimina i file generati (`ShareViewController.swift`, `MainInterface.storyboard`, `Info.plist`) e
   aggiungi al target quelli di `ios/App/ShareExtension/` (spunta solo il target ShareExtension).
3. Target ShareExtension > Build Settings: `Info.plist File` = `ShareExtension/Info.plist`,
   `Code Signing Entitlements` = `ShareExtension/ShareExtension.entitlements`. Deployment target uguale a quello dell'app.
4. Target App > Signing & Capabilities: aggiungi `App Groups` con `group.com.markg981.mestolo`
   e imposta `Code Signing Entitlements` = `App/App.entitlements`. Stessa capability sul target ShareExtension.
5. Signing: stesso Team per entrambi i target; sul portale Apple Developer registra l'App Group e abilitalo
   sugli App ID `com.markg981.mestolo` e `com.markg981.mestolo.ShareExtension`.
6. App target > Build Phases: verifica che `ShareExtension.appex` sia in "Embed Foundation Extensions".
7. Se cambi `CAP_APP_ID`, aggiorna l'App Group in `ShareViewController.swift` e nei due `.entitlements`.
8. Test su dispositivo: Safari > Condividi > Mestolo deve aprire l'app su `/import/link?url=...`.

## Note e follow-up
- Le immagini vengono salvate nel container App Group (`shared/<uuid>.jpg`) e l'app riceve `image=<nome>`,
  ma oggi la ignora: serve un piccolo plugin Capacitor (o Filesystem) per leggere il file e passarlo
  all'import da foto. Per ora i link/testi sono completamente supportati.
- L'apertura dell'app dall'estensione usa la responder chain (`openURL:`), tecnica diffusa ma non documentata da Apple.

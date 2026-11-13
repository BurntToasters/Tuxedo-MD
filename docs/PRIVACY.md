# Privacy

Tuxedo MD is a local-first Markdown editor. Notes stay in the files you open. The app has no account, does not sync those files to a cloud service, and does not collect telemetry. Settings and the temporary session copy used to restore open tabs stay on this computer as well.

Preview and export stay on the machine. Tuxedo MD renders the preview locally. Export writes an HTML file on your computer, or passes that HTML to the system print dialog. The document is not uploaded for either of those features. If you open an https or mailto link from a note, the system opens that address, and the note remains in the file you opened.

The optional updater can request GitHub release manifests when update checks are enabled. Those manifests are published with the public releases of [BurntToasters/Tuxedo-MD](https://github.com/BurntToasters/Tuxedo-MD). The request asks whether a newer release is available. It is not a usage report, and it does not include your notes. If you install an update, the app downloads that release from GitHub. Store builds do not use this updater. They update through the Mac App Store or Microsoft Store.

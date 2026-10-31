cask "teledrive" do
  version "0.1.3"
  sha256 "921d375267d4897c756d4e7320b056857fb6e343e789dc7aacff261c8ef54080"

  url "https://downloads.sourceforge.net/project/teledrive/v#{version}/teledrive.dmg",
      verified: "downloads.sourceforge.net/project/teledrive/"
  name "TeleDrive"
  desc "Fast, unlimited cloud storage powered by Telegram MTProto"
  homepage "https://teledrive.space"

  livecheck do
    url "https://github.com/senapati484/teledrive/releases"
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :catalina"

  app "TeleDrive.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/TeleDrive.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/com.teledrive.app",
    "~/Library/Caches/com.teledrive.app",
    "~/Library/Preferences/com.teledrive.app.plist",
    "~/Library/Saved Application State/com.teledrive.app.savedState",
  ]
end

(function () {
  var fallbackTag = "v0.2.12";
  var repo = "https://github.com/anmutu/keyway";
  var templates = {
    "mac-arm": "Keyway_{version}_aarch64.dmg",
    "mac-intel": "Keyway_{version}_x64.dmg",
    windows: "Keyway_{version}_x64-setup.exe",
    "windows-msi": "Keyway_{version}_x64_en-US.msi",
    appimage: "Keyway_{version}_amd64.AppImage",
    deb: "Keyway_{version}_amd64.deb",
    rpm: "Keyway-{version}-1.x86_64.rpm",
  };

  function releasePage(tag) {
    return repo + "/releases/tag/" + encodeURIComponent(tag);
  }

  function assetUrl(kind, release) {
    var tag = release && release.tag_name;
    var template = templates[kind];
    if (!tag || !template) return repo + "/releases";
    var version = tag.replace(/^v/, "");
    var name = template.replace("{version}", version);
    if (!release.assets || release.assets.length === 0) {
      return repo + "/releases/download/" + encodeURIComponent(tag) + "/" + encodeURIComponent(name);
    }
    var asset = (release.assets || []).find(function (item) { return item.name === name; });
    return asset && asset.browser_download_url ? asset.browser_download_url : releasePage(tag);
  }

  function validRelease(release) {
    return release && /^v\d+\.\d+\.\d+$/.test(release.tag_name || "");
  }

  function syncPrimaryDownload() {
    var primary = document.getElementById("primaryDownload");
    if (!primary) return;
    var macArm = document.querySelector('[data-release-asset="mac-arm"]');
    var macIntel = document.querySelector('[data-release-asset="mac-intel"]');
    var windows = document.querySelector('[data-release-asset="windows"]');
    var appimage = document.querySelector('[data-release-asset="appimage"]');
    var all = "https://github.com/anmutu/keyway/releases";
    var ua = navigator.userAgent || "";
    var isWindows = /Windows/i.test(ua);
    var isLinux = /Linux/i.test(ua) && !/Android/i.test(ua);
    var isMac = /Macintosh|Mac OS X/i.test(ua);
    var isMobile = /Android|iPhone|iPad|iPod/i.test(ua) || (isMac && navigator.maxTouchPoints > 1);
    var lang = document.documentElement.getAttribute("lang") === "en" ? "en" : "zh";
    if (isMobile) {
      primary.href = all;
      primary.textContent = lang === "en" ? "View all downloads" : "查看全部下载";
    } else if (isWindows && windows) {
      primary.href = windows.href;
      primary.textContent = lang === "en" ? "Download for Windows" : "下载 Windows 版";
    } else if (isLinux && appimage) {
      primary.href = appimage.href;
      primary.textContent = lang === "en" ? "Download for Linux" : "下载 Linux 版";
    } else if (isMac) {
      primary.href = "#platform-downloads";
      primary.textContent = lang === "en" ? "Choose your Mac download" : "选择 macOS 安装包";
    } else {
      primary.href = all;
      primary.textContent = lang === "en" ? "View all downloads" : "查看全部下载";
    }
    var nav = document.getElementById("navDownload");
    if (nav) nav.href = primary.href;
  }

  function applyRelease(release) {
    if (!validRelease(release)) return;
    document.querySelectorAll("[data-release-asset]").forEach(function (element) {
      element.href = assetUrl(element.getAttribute("data-release-asset"), release);
    });
    var version = document.querySelector("[data-release-version]");
    if (version) {
      var lang = document.documentElement.getAttribute("lang") === "en" ? "en" : "zh";
      version.textContent = lang === "en"
        ? "Latest stable release " + release.tag_name + " · macOS / Windows / Linux"
        : "最新正式版 " + release.tag_name + " · macOS / Windows / Linux";
    }
    syncPrimaryDownload();
  }

  var fallback = { tag_name: fallbackTag, assets: [] };
  applyRelease(fallback);
  fetch(repo + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (release) { if (validRelease(release)) applyRelease(release); })
    .catch(function () {});
})();

import { parseApkFile, parseApkUrl } from "../src/browser.js";

let currentIconUrl = null;
const out = document.getElementById("output");
const iconWrap = document.getElementById("iconWrap");
const apkFileInput = document.getElementById("apkFile");
const apkFilePath = document.getElementById("apkFilePath");
const apkUrlInput = document.getElementById("apkUrl");
const loadResourcesInput = document.getElementById("loadResources");
const parseFileBtn = document.getElementById("parseFileBtn");
const parseUrlBtn = document.getElementById("parseUrlBtn");
const fileTab = document.getElementById("fileTab");
const urlTab = document.getElementById("urlTab");
const filePanel = document.getElementById("filePanel");
const urlPanel = document.getElementById("urlPanel");
const defaultFilePathLabel = apkFilePath.textContent;

function getParseOptions() {
  return {
    loadResources: loadResourcesInput.checked,
  };
}

function resetPreview() {
  if (currentIconUrl) {
    URL.revokeObjectURL(currentIconUrl);
    currentIconUrl = null;
  }

  out.textContent = "parsing...";
  iconWrap.innerHTML = "";
}

function setActiveTab(mode) {
  const isFile = mode === "file";
  fileTab.classList.toggle("is-active", isFile);
  urlTab.classList.toggle("is-active", !isFile);
  fileTab.setAttribute("aria-selected", String(isFile));
  urlTab.setAttribute("aria-selected", String(!isFile));
  filePanel.classList.toggle("is-active", isFile);
  urlPanel.classList.toggle("is-active", !isFile);
}

function renderResult(result) {
  if (result.iconBlob) {
    currentIconUrl = URL.createObjectURL(result.iconBlob);
    iconWrap.innerHTML = `<img src="${currentIconUrl}" alt="App icon">`;
  }

  const text = [];
  text.push(`appName: ${result.appName}`);
  text.push(`package: ${result.packageName}`);
  text.push(`versionCode: ${result.versionCode}`);
  text.push(`versionName: ${result.versionName}`);
  text.push("");

  result.signatures.forEach((signature, index) => {
    text.push(`scheme: ${signature.scheme}`);

    if (!signature.found || !signature.certificate) {
      text.push(`Signer #${index + 1} certificate not found`);
      return;
    }

    const cert = signature.certificate;
    text.push(`Signer #${index + 1} certificate DN: ${cert.dn}`);
    text.push(`Signer #${index + 1} certificate SHA-256 digest: ${cert.sha256}`);
    text.push(`Signer #${index + 1} certificate SHA-1 digest: ${cert.sha1}`);
    text.push(`Signer #${index + 1} certificate MD5 digest: ${cert.md5}`);
  });

  out.textContent = text.join("\n");
}

async function parseSelectedFile() {
  const file = apkFileInput.files[0];
  if (!file) return;

  resetPreview();

  try {
    const result = await parseApkFile(file, getParseOptions());
    renderResult(result);
  } catch (err) {
    out.textContent = `error: ${err.message}`;
  }
}

function updateFilePathLabel() {
  const file = apkFileInput.files[0];
  apkFilePath.textContent = file ? file.name : defaultFilePathLabel;
}

async function parseCurrentUrl() {
  const url = apkUrlInput.value.trim();
  if (!url) return;

  resetPreview();

  try {
    const result = await parseApkUrl(url, getParseOptions());
    renderResult(result);
  } catch (err) {
    out.textContent = `error: ${err.message}`;
  }
}

fileTab.addEventListener("click", () => setActiveTab("file"));
urlTab.addEventListener("click", () => setActiveTab("url"));
parseFileBtn.addEventListener("click", () => apkFileInput.click());
parseUrlBtn.addEventListener("click", parseCurrentUrl);
apkFileInput.addEventListener("change", () => {
  updateFilePathLabel();
  parseSelectedFile();
});

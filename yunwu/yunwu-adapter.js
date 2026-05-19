(function () {
  "use strict";

  // Redirect CDN-hosted PDF.js worker to local copy so it works same-origin
  var PDF_WORKER_CDN_RE = /cdnjs\.cloudflare\.com.*pdf\.worker/i;
  var PDF_WORKER_LOCAL = "./assets/pdf.worker.min.js";
  var OriginalWorker = window.Worker;
  window.Worker = function PatchedWorker(url, options) {
    if (typeof url === "string" && PDF_WORKER_CDN_RE.test(url)) {
      url = PDF_WORKER_LOCAL;
    }
    return new OriginalWorker(url, options);
  };
  window.Worker.prototype = OriginalWorker.prototype;

  var LEGACY_ENDPOINT = "https://api.bltcy.ai/v1/images/edits";
  var YUNWU_MODEL_ENDPOINT = "/yunwu-api/v1beta/models/";
  var YUNWU_IMAGES_EDITS_ENDPOINT = "/yunwu-api/v1/images/edits";
  var DEFAULT_LEGACY_MODEL = "gemini-3.1-flash-image-preview-2k";
  var GPT_IMAGE_MODEL = "gpt-image-2-all";
  var MODEL_KEY = "pdf2img_model";
  var MODEL_MAP = {
    "gemini-3.1-flash-image-preview-2k": "gemini-3.1-flash-image-preview",
    "nano-banana-2-2k": "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview": "gemini-3-pro-image-preview",
    "gpt-image-2-all": "gpt-image-2-all"
  };
  var MODEL_TEXT = {
    "gemini-3.1-flash-image-preview-2k": "gemini-3.1-flash-image-preview",
    "nano-banana-2-2k": "gemini-3-pro-image-preview",
    "0.1元/次": "0.083 元/次",
    "0.2元/次": "0.165 元/次",
    "Key 仅保存在浏览器本地，不会上传至任何服务器": "Key 存在本浏览器；生成时会转发给 Yunwu API，本站不保存",
    "API Key 仅保存在浏览器本地": "API Key 存在本浏览器，生成时转发给 Yunwu API"
  };
  var SIZE_TEXT = {
    "1024x1024": "2048×2048",
    "1024×1024": "2048×2048",
    "1344x756": "2688×1512",
    "1344×756": "2688×1512",
    "768x1344": "1536×2688",
    "768×1344": "1536×2688",
    "1152x864": "2304×1728",
    "1152×864": "2304×1728",
    "864x1152": "1728×2304",
    "864×1152": "1728×2304"
  };

  try {
    var storedModel = localStorage.getItem(MODEL_KEY);
    if (storedModel && !MODEL_MAP[storedModel]) {
      localStorage.setItem(MODEL_KEY, DEFAULT_LEGACY_MODEL);
    }
  } catch (error) {}

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function yunwuFetch(input, init) {
    var url = typeof input === "string" ? input : input && input.url;
    if (url === LEGACY_ENDPOINT && init && init.body instanceof FormData) {
      return sendToYunwu(init.body, init);
    }
    return nativeFetch(input, init);
  };

  async function sendToYunwu(form, init) {
    var rawModel = String(form.get("model") || DEFAULT_LEGACY_MODEL);
    if (rawModel === GPT_IMAGE_MODEL) {
      return sendToYunwuImagesEdits(form, init);
    }

    var model = MODEL_MAP[rawModel] || "gemini-3.1-flash-image-preview";
    var apiKey = readBearerToken(init.headers);
    var endpoint = YUNWU_MODEL_ENDPOINT + encodeURIComponent(model) + ":generateContent";
    if (apiKey) endpoint += "?key=" + encodeURIComponent(apiKey);

    var response;
    try {
      response = await nativeFetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: apiKey ? "Bearer " + apiKey : "",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(await buildGenerateContentPayload(form))
      });
    } catch (error) {
      return jsonResponse(
        {
          error: {
            message: "Yunwu 代理请求失败，请稍后重试"
          }
        },
        502
      );
    }
    var payload = await parseJson(response);

    if (!response.ok) {
      return jsonResponse(
        {
          error: normalizeError(payload, response.status)
        },
        response.status
      );
    }

    var images = extractImages(payload);
    return jsonResponse({ data: images.length ? images : [] }, response.status);
  }

  async function sendToYunwuImagesEdits(form, init) {
    var apiKey = readBearerToken(init.headers);
    var upload = buildImagesEditsForm(form);
    var response;

    try {
      response = await nativeFetch(YUNWU_IMAGES_EDITS_ENDPOINT, {
        method: "POST",
        headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
        body: upload
      });
    } catch (error) {
      return jsonResponse(
        {
          error: {
            message: "Yunwu Images 请求失败，请稍后重试"
          }
        },
        502
      );
    }

    var payload = await parseJson(response);
    if (!response.ok) {
      return jsonResponse(
        {
          error: normalizeError(payload, response.status)
        },
        response.status
      );
    }

    var images = extractImages(payload);
    return jsonResponse({ data: images.length ? images : [] }, response.status);
  }

  function buildImagesEditsForm(form) {
    var upload = new FormData();
    upload.append("model", GPT_IMAGE_MODEL);
    upload.append("prompt", withAspectRatioPrefix(String(form.get("prompt") || ""), String(form.get("aspect_ratio") || "")));
    upload.append("response_format", String(form.get("response_format") || "url"));

    form.getAll("image").forEach(function (file) {
      if (file instanceof Blob) upload.append("image", file);
    });

    return upload;
  }

  function withAspectRatioPrefix(prompt, aspectRatio) {
    var prefixMap = {
      "16:9": "横版 16:9",
      "9:16": "竖屏 9:16",
      "4:3": "4:3",
      "3:4": "3:4",
      "1:1": "1:1 方形构图"
    };
    var prefix = prefixMap[aspectRatio];
    if (!prefix || prompt.indexOf(prefix) === 0) return prompt;
    return prefix + "，" + prompt;
  }

  async function buildGenerateContentPayload(form) {
    var prompt = String(form.get("prompt") || "").trim();
    var aspectRatio = String(form.get("aspect_ratio") || "1:1");
    var imageSize = resolutionToImageSize(String(form.get("size") || form.get("image_size") || ""));
    var parts = [];

    if (prompt) parts.push({ text: prompt });

    var images = form.getAll("image");
    for (var index = 0; index < images.length; index += 1) {
      var file = images[index];
      if (file instanceof Blob) {
        parts.push({
          inline_data: {
            mime_type: file.type || "image/png",
            data: await blobToBase64(file)
          }
        });
      }
    }

    return {
      contents: [
        {
          role: "user",
          parts: parts
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: imageSize
        }
      }
    };
  }

  function resolutionToImageSize(size) {
    var match = size.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (!match) return "2K";
    var longEdge = Math.max(Number(match[1]), Number(match[2]));
    if (longEdge >= 3500) return "4K";
    if (longEdge >= 1500) return "2K";
    return "1K";
  }

  async function blobToBase64(blob) {
    var buffer = await blob.arrayBuffer();
    var bytes = new Uint8Array(buffer);
    var binary = "";
    var chunkSize = 0x8000;
    for (var index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  function readBearerToken(headers) {
    var auth = "";
    if (headers instanceof Headers) {
      auth = headers.get("Authorization") || headers.get("authorization") || "";
    } else if (Array.isArray(headers)) {
      var pair = headers.find(function (item) {
        return item && String(item[0]).toLowerCase() === "authorization";
      });
      auth = pair ? pair[1] : "";
    } else if (headers && typeof headers === "object") {
      auth = headers.Authorization || headers.authorization || "";
    }
    return String(auth).replace(/^Bearer\s+/i, "").trim();
  }

  async function parseJson(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), {
      status: status || 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  function normalizeError(payload, status) {
    if (payload && payload.error) return payload.error;
    return {
      message: "Yunwu API request failed (HTTP " + status + ")"
    };
  }

  function extractImages(payload) {
    var output = [];
    if (!payload) return output;

    if (Array.isArray(payload.data)) {
      payload.data.forEach(function (item) {
        if (item && item.url) output.push({ url: item.url });
        if (item && item.b64_json) output.push({ url: dataUrl(item.b64_json, item.mimeType) });
      });
    }

    var candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    candidates.forEach(function (candidate) {
      var parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
      parts.forEach(function (part) {
        var inline = part.inlineData || part.inline_data;
        if (inline && inline.data) {
          output.push({ url: dataUrl(inline.data, inline.mimeType || inline.mime_type) });
        }
        var file = part.fileData || part.file_data;
        if (file && file.fileUri) output.push({ url: file.fileUri });
        if (file && file.file_uri) output.push({ url: file.file_uri });
      });
    });

    return output;
  }

  function dataUrl(base64, mimeType) {
    if (/^data:/i.test(base64)) return base64;
    return "data:" + (mimeType || "image/png") + ";base64," + base64;
  }

  function replaceText(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent || /^(SCRIPT|STYLE|TEXTAREA|INPUT)$/i.test(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var text = node.nodeValue;
      Object.keys(MODEL_TEXT).forEach(function (key) {
        text = text.split(key).join(MODEL_TEXT[key]);
      });
      Object.keys(SIZE_TEXT).forEach(function (key) {
        text = text.split(key).join(SIZE_TEXT[key]);
      });
      text = text.replace(/\b1K\b/g, "2K").replace(/\b4K\b/g, "2K");
      if (text !== node.nodeValue) node.nodeValue = text;
    }
  }

  function findSettingsCard(root) {
    var headings = Array.from(root.querySelectorAll("h2"));
    var heading = headings.find(function (node) {
      return (node.textContent || "").trim() === "参数设置";
    });
    return heading ? heading.closest(".editorial-card, .bg-white") : null;
  }

  function enhanceModelPicker(settingsCard) {
    if (!settingsCard) return;
    var headings = Array.from(settingsCard.querySelectorAll("p"));
    var modelHeading = headings.find(function (node) {
      return (node.textContent || "").trim() === "模型";
    });
    var modelGrid = modelHeading && modelHeading.parentElement && modelHeading.parentElement.querySelector(".grid");
    if (!modelGrid || modelGrid.querySelector('[data-yunwu-model="' + GPT_IMAGE_MODEL + '"]')) return;

    var isActive = false;
    try {
      isActive = localStorage.getItem(MODEL_KEY) === GPT_IMAGE_MODEL;
    } catch (error) {}

    var button = document.createElement("button");
    button.type = "button";
    button.dataset.yunwuModel = GPT_IMAGE_MODEL;
    button.className = isActive
      ? "py-2.5 rounded-xl text-sm font-medium text-center transition-all bg-blue-500 text-white shadow-md"
      : "py-2.5 rounded-xl text-sm font-medium text-center transition-all bg-slate-100 text-slate-600 hover:bg-slate-200";
    button.innerHTML = 'gpt-image-2-all<br><span class="text-xs opacity-75">0.06 元/次</span>';
    button.addEventListener("click", function () {
      try {
        localStorage.setItem(MODEL_KEY, GPT_IMAGE_MODEL);
      } catch (error) {}
      window.location.reload();
    });

    modelGrid.appendChild(button);
    if (isActive) deactivateSiblingModelButtons(modelGrid, button);
  }

  function deactivateSiblingModelButtons(modelGrid, activeButton) {
    Array.from(modelGrid.querySelectorAll("button")).forEach(function (button) {
      if (button === activeButton) return;
      button.className = "py-2.5 rounded-xl text-sm font-medium text-center transition-all bg-slate-100 text-slate-600 hover:bg-slate-200";
    });
  }

  function enforceOnly2KResolution(settingsCard) {
    if (!settingsCard) return;
    var buttons = Array.from(settingsCard.querySelectorAll("button")).filter(function (button) {
      return /\dK\s*·\s*\d+[×x]\d+/i.test((button.textContent || "").replace(/\s+/g, " "));
    });
    if (!buttons.length) return;

    var twoKButtons = buttons.filter(function (button) {
      return /2K/i.test(button.textContent || "");
    });

    buttons.forEach(function (button) {
      var text = button.textContent || "";
      if (/1K|4K/i.test(text) && twoKButtons.length) {
        button.style.display = "none";
        button.setAttribute("aria-hidden", "true");
      }
    });

    if (!twoKButtons.length) {
      buttons.forEach(function (button) {
        button.textContent = "2K · 2048×2048";
        button.style.display = "";
        button.removeAttribute("aria-hidden");
      });
      return;
    }

    var activeTwoK = twoKButtons.some(function (button) {
      return button.style.display !== "none" && /bg-purple-500|text-white/.test(button.className || "");
    });
    if (!activeTwoK) {
      setTimeout(function () {
        var firstVisibleTwoK = twoKButtons.find(function (button) {
          return button.style.display !== "none";
        });
        if (firstVisibleTwoK) firstVisibleTwoK.click();
      }, 0);
    }
  }

  function enhanceYunwuUI() {
    var root = document.getElementById("root");
    if (!root || !root.firstElementChild) return;
    var settingsCard = findSettingsCard(root);
    enhanceModelPicker(settingsCard);
    enforceOnly2KResolution(settingsCard);
    replaceText(root);
  }

  var frame = 0;
  function scheduleEnhance() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(enhanceYunwuUI);
  }

  var observer = new MutationObserver(scheduleEnhance);
  window.addEventListener("DOMContentLoaded", function () {
    var root = document.getElementById("root");
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });
    scheduleEnhance();
  });
})();

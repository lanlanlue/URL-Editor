/**
 * @file aiPromptHelper.js
 * Universal AI prompt constant and clipboard helper for external AI tools
 * (Chrome sidebar Ask Gemini, ChatGPT, Claude) as a zero-cost fallback
 * when local on-device Gemini Nano is unavailable or unassisted workflow is desired.
 */

/**
 * Universal AI prompt instructing external LLMs to extract URLs, generate concise
 * labels, and 1 to 3 hashtag categories formatted for direct URL-Editor Smart Paste ingestion.
 *
 * Format: [標籤名稱](URL) #tag1 #tag2 (one item per line)
 */
export const UNIVERSAL_AI_PROMPT = `請從以下文字或當前頁面中，萃取所有有效的 HTTP/HTTPS 網址，並整理為每行一筆的 Markdown 格式：
[label](url) #tag1 #tag2

格式規範：
1. 每一行輸出格式必須為：[標籤名稱](URL) #tag1 #tag2
   - 標準格式範例：[label](url) #tag1 #tag2
2. 標籤名稱（label）：請給出簡明、具描述性的網站名稱或服務標題（繁體中文或原文，請勿空白）。
3. 網址（url）：必須為包含 http:// 或 https:// 的完整合法 URL。
4. 分類標籤（#tag）：請產生 1 到 3 個相關的小寫分類標籤（例如 #tools #docs #ai），以半形空格分隔，開頭帶 #。
5. 嚴格輸出限制：
   - 只輸出整理後的清單，不要加上任何開頭問候語、前言、結尾說明或備註。
   - 不要使用 Markdown 程式碼區塊（請勿使用 \`\`\` 或 \`\`\`markdown 包裹）。
   - 過濾掉無效網址、內部錨點（#）或非 HTTP/HTTPS 協議（如 javascript:、mailto: 等）。
   - 若未找到任何有效網址，請留空或回傳空白。

範例輸出：
[Google](https://www.google.com) #search #portal
[GitHub](https://github.com) #git #code #developer
[MDN Web Docs](https://developer.mozilla.org) #docs #web #reference`;

/**
 * Defensive fallback copying text via temporary off-screen textarea and document.execCommand('copy').
 * Used when Async Clipboard API is blocked, unpermitted, or in insecure contexts.
 *
 * @param {string} text - The text to copy.
 * @returns {boolean} True if copy succeeded, false otherwise.
 */
function copyFallback(text) {
  if (
    typeof document === 'undefined' ||
    !document.body ||
    typeof document.createElement !== 'function' ||
    typeof document.execCommand !== 'function'
  ) {
    return false;
  }

  let textarea;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    // Position off-screen and invisible to avoid UI displacement
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    document.body.appendChild(textarea);

    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const successful = document.execCommand('copy');
    return Boolean(successful);
  } catch {
    return false;
  } finally {
    if (textarea && textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
  }
}

/**
 * Copies the universal AI prompt (optionally concatenated with raw user text)
 * to the system clipboard using navigator.clipboard.writeText with graceful fallback.
 *
 * @param {string} [rawText] - Optional input text/links to append to the prompt.
 * @returns {Promise<boolean>} Resolves to true on success, false on failure.
 */
export async function copyUniversalAiPrompt(rawText) {
  try {
    let promptText = UNIVERSAL_AI_PROMPT;
    if (typeof rawText === 'string' && rawText.trim().length > 0) {
      promptText = `${UNIVERSAL_AI_PROMPT}\n\n---\n${rawText.trim()}`;
    }

    // 1. Try modern Async Clipboard API
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(promptText);
        return true;
      } catch {
        // Modern clipboard write rejected (e.g. NotAllowedError / document focus issue)
        // Fall through to legacy DOM execCommand fallback
      }
    }

    // 2. Legacy DOM fallback
    return copyFallback(promptText);
  } catch {
    // Top-level defensive guard
    return false;
  }
}

export default {
  UNIVERSAL_AI_PROMPT,
  copyUniversalAiPrompt,
};

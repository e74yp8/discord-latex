window.MathJax = {
    tex: {
        inlineMath: [['mthjxinline', 'mthjxinlineend']],
        displayMath: [['mthjxblock', 'mthjxblockend']]
    },
    svg: {
        fontCache: 'global'
    },
    startup: {
        typeset: false
    },
    options: {
        enableMenu: false // 禁用右鍵菜單，避免與 Discord 衝突
    }
};

const DEBUG = true; 
const logger = (...args) => {
    if (DEBUG) console.log('%c[LaTeX]', 'color: #3a71c1; font-weight: bold;', ...args);
};

require('mathjax-full/es5/tex-svg-full');

const ScrollerModule = BdApi.Webpack.getByKeys("scrollerInner", "navigationDescription") || BdApi.Webpack.getByKeys("scrollerInner");

const CLASS_SCROLLER_INNER = ScrollerModule ? ScrollerModule.scrollerInner : "scrollerInner-2PPAp2";

if (DEBUG) {
    logger("Module Classes Check:", { 
        scroller: CLASS_SCROLLER_INNER,
    });
}

export default class Plugin {
    observer = null;
    switchId = 0; 

    start() {
        logger("Plugin Started");
        this.onSwitch();
    }

    stop() {
        logger("Plugin Stopped");
        if (this.observer) this.observer.disconnect();
    }

    async typeset() {
        try {
            if (window.MathJax && window.MathJax.typesetPromise) {
                await window.MathJax.typesetPromise();
            } else if (window.MathJax && window.MathJax.typeset) {
                window.MathJax.typeset();
            }
        } catch (error) {
            console.warn("[LaTeX Plugin] Typeset error:", error);
        }
    }

    onSwitch = async () => {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        
        const currentSwitchId = ++this.switchId;
        logger(`Switching Channel (ID: ${currentSwitchId})...`);
        
        let channels = document.querySelector("." + CLASS_SCROLLER_INNER) || document.querySelector("[class*='scrollerInner']");
        
        if (!channels) {
            for (let i = 0; i < 20; i++) {
                if (this.switchId !== currentSwitchId) return;
                
                await new Promise(r => setTimeout(r, 100));
                channels = document.querySelector("." + CLASS_SCROLLER_INNER) || document.querySelector("[class*='scrollerInner']");
                if (channels) break;
            }
        }

        if (this.switchId !== currentSwitchId) return;

        if (channels) {
            logger("Scroller found! Attaching Observer.");
            this.observer = new MutationObserver(this.handleMutations);
            
            // 使用 ID 選擇器，這是最穩健的方法，因為 Discord 訊息內容幾乎總是有 id="message-content-..."
            const messages = channels.querySelectorAll("[id^='message-content']");
            logger(`Found ${messages.length} existing messages using ID selector`);
            
            let needsTypeset = false;
            messages.forEach(msg => {
                if (this.parseMessage(msg)) needsTypeset = true;
            });
            
            if (needsTypeset) {
                logger("Initial Typeset Triggered");
                this.typeset();
            }

            this.observer.observe(channels, {
                childList: true,
                subtree: true,
                characterData: true,
            });
        } else {
            console.error("[LaTeX Plugin] Failed to find scroller element!");
        }
    }

    handleMutations = (mutationsList) => {
        let needsTypeset = false;

        for (const mutation of mutationsList) {
            if (mutation.type === "childList") {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof Element)) continue;

                    // 檢查新增節點本身是否是訊息內容 (使用 id 檢查)
                    if (node.id && node.id.startsWith("message-content")) {
                        if (this.parseMessage(node)) needsTypeset = true;
                    } 
                    // 檢查是否包含訊息內容
                    else {
                        const contents = node.querySelectorAll("[id^='message-content']");
                        if (contents.length > 0) {
                            contents.forEach(content => {
                                if (this.parseMessage(content)) needsTypeset = true;
                            });
                        }
                        // 備用方案：如果新增的是 messageListItem，仍然嘗試查找 class
                        else if (node.classList.contains("messageListItem_c19a55") || node.querySelector("[class*='messageContent']")) {
                             const content = node.querySelector("[class*='messageContent']");
                             if (content && this.parseMessage(content)) needsTypeset = true;
                        }
                    }
                }
            } else if (mutation.type === "characterData") {
                // 編輯訊息時
                const target = mutation.target.parentElement;
                if (target) {
                    const messageContent = target.closest("[id^='message-content']");
                    if (messageContent) {
                         if (this.parseMessage(messageContent)) needsTypeset = true;
                    }
                }
            }
        }

        if (needsTypeset) {
            logger("New content detected, triggering typeset");
            this.typeset();
        }
    };

    parseMessage(messageContent) {
        if (!messageContent) return false;
        let containsTex = false;

        const codeElements = messageContent.querySelectorAll("code");
        if (DEBUG && codeElements.length > 0) logger(`Found ${codeElements.length} code elements`);

        codeElements.forEach((codeElement) => {
            const rawText = codeElement.innerText || codeElement.textContent;
            if (!rawText) return;
            
            const codeText = rawText.trim();
            const sanitize = x => x.replace(/\\unicode/g, ''); 
            
            if (DEBUG) {
                 logger(`Checking Content: '${codeText.substring(0, 10)}...'`);
            }

            const findReplaceTarget = (el) => el.closest("pre") || el;
            let targetElement = findReplaceTarget(codeElement);
            if (targetElement.dataset.latexProcessed) return;

            let mathContent = null;
            let isBlock = false;

            // Regex 匹配，更寬鬆且準確
            // 匹配 $$ ... $$ 或 \[ ... \]
            const blockMatch = codeText.match(/^(\$\$|\\\[)([\s\S]*)(\$\$|\\\])$/);
            if (blockMatch) {
                mathContent = blockMatch[2];
                isBlock = true;
            } else {
                // 匹配 $ ... $ 或 \( ... \)
                const inlineMatch = codeText.match(/^(\$|\\\()([\s\S]*)(\$|\\\))$/);
                if (inlineMatch) {
                    mathContent = inlineMatch[2];
                    isBlock = false;
                }
            }

            if (mathContent !== null) {
                const tag = isBlock ? "mthjxblock" : "mthjxinline";
                const endTag = isBlock ? "mthjxblockend" : "mthjxinlineend";
                
                targetElement.outerHTML = "<span>" + tag + sanitize(mathContent) + endTag + "</span>";
                containsTex = true;
                logger("LaTeX Rendered!");
            } else {
                if (DEBUG) logger("Not matched as LaTeX:", codeText);
            }
        });

        return containsTex;
    }
};

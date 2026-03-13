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

// RegexPatterns
// Anchored to ensure we don't accidentally replace a code block that contains mixed content (text + latex),
// which would result in the text being deleted. We allow surrounding whitespace.
const BLOCK_MATH_REGEX = /^\s*(\$\$|\\\[)([\s\S]+?)(\$\$|\\\])\s*$/;
const INLINE_MATH_REGEX = /^\s*(\$|\\\()([\s\S]+?)(\$|\\\))\s*$/;

export default class Plugin {
    observer = null;
    switchId = 0; 
    classScrollerInner = "scrollerInner-2PPAp2";
    typesetPromiseChain = Promise.resolve();

    start() {
        logger("Plugin Started");
        this.getScrollerClass();
        this.onSwitch();
    }
    
    getScrollerClass() {
        try {
            let ScrollerModule;
            // Safe check for BdApi
            const api = window.BdApi;
            if (api) {
                if (api.Webpack && api.Webpack.getByKeys) {
                    ScrollerModule = api.Webpack.getByKeys("scrollerInner", "navigationDescription") || api.Webpack.getByKeys("scrollerInner");
                } else if (api.findModuleByProps) {
                    ScrollerModule = api.findModuleByProps("scrollerInner", "navigationDescription") || api.findModuleByProps("scrollerInner");
                }
            }

            if (ScrollerModule && ScrollerModule.scrollerInner) {
                this.classScrollerInner = ScrollerModule.scrollerInner;
            }
            
            if (DEBUG) {
                logger("Module Classes Check:", { 
                    scroller: this.classScrollerInner,
                });
            }
        } catch (e) {
            console.warn("[LaTeX Plugin] Scroller class resolution failed:", e);
        }
    }


    stop() {
        logger("Plugin Stopped");
        if (this.observer) this.observer.disconnect();
    }

    async typeset(elements) {
        // Chain typeset calls to prevent "MathJax is already typesetting" errors
        this.typesetPromiseChain = this.typesetPromiseChain.then(async () => {
            try {
                if (window.MathJax) {
                    // Method 1: typesetPromise (Preferred)
                    if (window.MathJax.typesetPromise) {
                        if (elements && elements.length > 0) {
                            await window.MathJax.typesetPromise(elements);
                        } else if (!elements) {
                            await window.MathJax.typesetPromise();
                        }
                    } 
                    // Method 2: typeset (Synchronous fallback)
                    else if (window.MathJax.typeset) {
                        if (elements && elements.length > 0) {
                            window.MathJax.typeset(elements);
                        } else {
                            window.MathJax.typeset();
                        }
                    }
                }
            } catch (error) {
                console.warn("[LaTeX Plugin] Typeset error:", error);
            }
        });
        
        await this.typesetPromiseChain;
    }

    onSwitch = async () => {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        
        const currentSwitchId = ++this.switchId;
        logger(`Switching Channel (ID: ${currentSwitchId})...`);
        
        // Use class property instead of global constant
        let channels = document.querySelector("." + this.classScrollerInner) || document.querySelector("[class*='scrollerInner']");
        
        if (!channels) {
            for (let i = 0; i < 20; i++) {
                if (this.switchId !== currentSwitchId) return;
                
                await new Promise(r => setTimeout(r, 100));
                channels = document.querySelector("." + this.classScrollerInner) || document.querySelector("[class*='scrollerInner']");
                if (channels) break;
            }
        }

        if (this.switchId !== currentSwitchId) return;

        if (channels) {
            logger("Scroller found! Attaching Observer.");
            this.observer = new MutationObserver(this.handleMutations);
            
            const messages = channels.querySelectorAll("[id^='message-content']");
            logger(`Found ${messages.length} existing messages using ID selector`);
            
            const elementsToTypeset = [];
            messages.forEach(msg => {
                const newElements = this.parseMessage(msg);
                if (newElements && newElements.length > 0) {
                    elementsToTypeset.push(...newElements);
                }
            });
            
            if (elementsToTypeset.length > 0) {
                logger(`Initial Typeset Triggered for ${elementsToTypeset.length} elements`);
                this.typeset(elementsToTypeset);
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
        const elementsToTypeset = [];

        for (const mutation of mutationsList) {
            if (mutation.type === "childList") {
                // Determine if we are inside a message content block (e.g. edited message)
                if (mutation.target instanceof Element && mutation.target.closest("[id^='message-content']")) {
                     const messageContent = mutation.target.closest("[id^='message-content']");
                     const newElements = this.parseMessage(messageContent);
                     if (newElements) elementsToTypeset.push(...newElements);
                }

                for (const node of mutation.addedNodes) {
                    if (!(node instanceof Element)) continue;

                    // Standard new message handling
                    if (node.id && node.id.startsWith("message-content")) {
                         const newElements = this.parseMessage(node);
                         if (newElements) elementsToTypeset.push(...newElements);
                    } 
                    else {
                        const contents = node.querySelectorAll("[id^='message-content']");
                        if (contents.length > 0) {
                            contents.forEach(content => {
                                const newElements = this.parseMessage(content);
                                if (newElements) elementsToTypeset.push(...newElements);
                            });
                        }
                        // Fallback for list items
                        else if (node.classList.contains("messageListItem_c19a55") || node.querySelector("[class*='messageContent']")) {
                             const content = node.querySelector("[class*='messageContent']");
                             if (content) {
                                  const newElements = this.parseMessage(content);
                                  if (newElements) elementsToTypeset.push(...newElements);
                             }
                        }
                    }
                }
            } else if (mutation.type === "characterData") {
                const target = mutation.target.parentElement;
                if (target) {
                    const messageContent = target.closest("[id^='message-content']");
                    if (messageContent) {
                         const newElements = this.parseMessage(messageContent);
                         if (newElements) elementsToTypeset.push(...newElements);
                    }
                }
            }
        }

        if (elementsToTypeset.length > 0) {
            logger(`New content detected, triggering typeset for ${elementsToTypeset.length} elements`);
            this.typeset(elementsToTypeset);
        }
    };

    parseMessage(messageContent) {
        if (!messageContent) return null;
        const newElements = [];

        const codeElements = messageContent.querySelectorAll("code");
        if (DEBUG && codeElements.length > 0) logger(`Found ${codeElements.length} code elements`);

        codeElements.forEach((codeElement) => {
            // Prefer textContent for raw text, innerText as fallback
            const rawText = codeElement.textContent || codeElement.innerText;
            if (!rawText) return;
            
            const codeText = rawText.trim();
            const sanitize = x => x.replace(/\\unicode/g, ''); 
            
            if (DEBUG) {
                 logger(`Checking Content: '${codeText.substring(0, 20)}...'`);
            }

            const findReplaceTarget = (el) => el.closest("pre") || el;
            let targetElement = findReplaceTarget(codeElement);
            if (targetElement.dataset.latexProcessed) return;

            let mathContent = null;
            let isBlock = false;

            const blockMatch = codeText.match(BLOCK_MATH_REGEX);
            if (blockMatch) {
                mathContent = blockMatch[2];
                isBlock = true;
            } else {
                const inlineMatch = codeText.match(INLINE_MATH_REGEX);
                if (inlineMatch) {
                    mathContent = inlineMatch[2];
                    isBlock = false;
                }
            }

            if (mathContent !== null) {
                const tag = isBlock ? "mthjxblock" : "mthjxinline";
                const endTag = isBlock ? "mthjxblockend" : "mthjxinlineend";
                
                const span = document.createElement('span');
                span.innerHTML = tag + sanitize(mathContent) + endTag;
                span.dataset.latexProcessed = "true"; 
                
                targetElement.replaceWith(span);
                newElements.push(span);
                logger("LaTeX Rendered!");
            } else {
                if (DEBUG) logger("Not matched as LaTeX:", codeText);
            }
        });

        return newElements.length > 0 ? newElements : null;
    }
};
